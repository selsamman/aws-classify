import {deserialize, serialize} from "js-freeze-dry";
import {ClassDef} from "./ClassDef";
import {LambdaRequest, LambdaResponse} from "./aws-classify-common";
import {DynamoDBDocument} from "@aws-sdk/lib-dynamodb";
import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import {APIGatewayProxyEvent, Context} from "aws-lambda";
import {ClassifyResponse} from "./ClassifyResponse";

const ddbClient = new DynamoDBClient({ region: process.env.DD_REGION, endpoint: process.env.DD_ENDPOINT });
const ddbDocClient = DynamoDBDocument.from(ddbClient);

export class ClassifyServerless {

    logLevel: Partial<typeof EndPointsLogging> = {};
    classDefs : Map<any, ClassDef<any, any>> = new Map();
    requests : Map<any, any> = new Map();

    log : (_message: string) => void = msg => console.log(msg);

    setLogger(log : (_message: string) => void) {
        this.log = log;
    }

    setLogLevel(logLevel : Partial<typeof EndPointsLogging>) {
        this.logLevel = logLevel;
    }

    registerResponse<T>(responseClass : new () => T,
                            authorizer? : (_endPoint: T, _method: string, _args: IArguments) => Promise<boolean>) {

        // Find ultimate base class
        let clientClass = responseClass;
        while (Object.getPrototypeOf(clientClass).prototype)
            clientClass = Object.getPrototypeOf(clientClass);
        if (clientClass === responseClass)
            throw ('ClassifyServerless.registerResponse: Response class must extend a request class');

        // Get interface name as static property of request class
        const interfaceName = clientClass['interfaceName'];
        if (!interfaceName)
            throw ('ClassifyServerless.registerResponse: Request must have interfaceName as a static property')

        this.classDefs.set(interfaceName, {serverClass: responseClass, clientClass, authorizer});
        (responseClass as any).__interfaceName__ = interfaceName;
    }

    async dispatch (ev: APIGatewayProxyEvent, context : Context, classes  = {}) {

        const request = deserialize(ev.body as string, classes) as LambdaRequest;
        const logName = `${request.interfaceName}.${request.methodName}`;
        let sessionId = request.sessionId; //  May be empty

        // Pseudo interface/method to request socket access and return a session id to use in connect
        // session id will be passed in sec-websocket-protocol on connect request
        if (logName === '$WebSocket.$authorize') {
            const socketResult = await getSessionData(sessionId, "");
            if (!socketResult) {
                sessionId = context.awsRequestId;
                await saveSessionData(sessionId, undefined,undefined, undefined);
            }
            const lambdaResponse : LambdaResponse = {
                data: process.env.IS_OFFLINE ? 'ws://localhost:3001' :`wss://${process.env.APIG_ENDPOINT}`,
                exception: undefined,
                cargo: undefined,
                sessionId: sessionId,
            }
            return serialize(lambdaResponse, classes);
        }

        if (this.logLevel.data && this.logLevel.calls)
            this.log(`Lambda ${logName} invoked with ${ev.body}`);
        else if (this.logLevel.calls)
            this.log(`Lambda ${logName} invoked`);

        const classDef = this.classDefs.get(request.interfaceName);
        if (!classDef)
            throw new Error(`No Response defined for ${request.interfaceName}`)
        if (!classDef.clientClass.prototype[request.methodName])
            throw new Error(`${request.methodName} not found in ${request.interfaceName} client request class`);

        // If authorizer passed in make sure request is authorized
        if (!classDef.authorizer || await classDef.authorizer(request.interfaceName, request.methodName, request.args)) {

            // Instantiate the class
            const obj = new classDef.serverClass() as ClassifyResponse;

            // Retrieve session data from DynamoDB base on sessionId in request
            const result = await getSessionData(sessionId, request.interfaceName);
            if (!result)
                sessionId = context.awsRequestId;
            else {
                const sessionData = result[`interface_${request.interfaceName}`];
                if (sessionData) // Enrich it with session data
                    Object.assign(obj, deserialize(sessionData, classes));
            }

            obj.__sessionId__  = sessionId;
            obj.__connectionId__ = result?.connectionId;

            // Call the class method and catch any exceptions it might throw to pass back
            let fnResponse;
            try {
                fnResponse = await obj[request.methodName].call(obj, ...request.args);
            } catch (e : any) {

                if (this.logLevel.calls)
                    this.log(`Lambda ${logName} had exception ${e}`);

                const lambdaResponse : LambdaResponse = {
                    data: undefined,
                    exception: e.message,
                    cargo: undefined,
                    sessionId: sessionId,
                }

                return serialize(lambdaResponse, classes);
            }

            const updatedSessionData = serialize(obj, classes);
            if (!result || updatedSessionData !== result.sessionData)
                sessionId  = await saveSessionData(sessionId, request.interfaceName, updatedSessionData, undefined);

            // Formulate response
            const lambdaResponse : LambdaResponse = {
                data: fnResponse,
                exception: undefined,
                cargo: undefined,
                sessionId,
            };
            const response = serialize(lambdaResponse, classes);

            if (this.logLevel.data && this.logLevel.calls)
                this.log(`Lambda ${logName} responded with ${response}`);
            else if (this.logLevel.calls)
                this.log(`Lambda ${logName} responded`);

            return response;

        } else {
            this.log(`Lambda ${logName} not authorized`);
            throw new Error("Not Authorized");
        }
    }

    registerRequest<T>(requestClass : new () => T, classes : any = {}) {

        const interfaceName = requestClass['interfaceName'];
        if (!interfaceName)
            throw ('ClassifyServerless.registerRequest: Request must have interfaceName as a static property')

        for (const methodName of Object.getOwnPropertyNames(requestClass.prototype)) {

            if (methodName === 'constructor' || typeof (requestClass.prototype)[methodName] !== 'function')
                continue;

            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const expressServer = this;

            requestClass.prototype[methodName] =  async function (...args : any) {

                try {

                    // Build request
                    const sessionId = this['__sessionId__'];
                    const connectionId = this['__connectionId__'];
                    if (!sessionId)
                        throw new Error(`You must instantiate ${interfaceName} using the ClassifyServerless.createRequest`);
                    if (!connectionId)
                        throw new Error(`WebSocket handshake not established for ${interfaceName}`);
                    const request: LambdaRequest = {
                        interfaceName: interfaceName,
                        args, methodName,
                        sessionId
                    };
                    const payload = serialize(request, classes);

                    // Log request
                    if (expressServer.logLevel.data && expressServer.logLevel.requests)
                        expressServer.log(`Request ${interfaceName} emitting with ${payload}`);
                    else if (expressServer.logLevel && expressServer.logLevel.requests)
                        expressServer.log(`Request ${interfaceName} emitting`);


                    // Post request to the gateway to be sent to src
                    const endpoint = process.env.IS_OFFLINE ? 'http://localhost:3001' :`https://${process.env.APIG_ENDPOINT}`;
                    if (expressServer.logLevel.calls)
                        expressServer.log(`creating APIGatewayManagementApiClient for endpoint ${endpoint}`)
                    const client = new ApiGatewayManagementApiClient({endpoint});
                    if (expressServer.logLevel.data)
                        expressServer.log(`posting to ${connectionId} ${payload}`);
                    const post = new PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: Buffer.from(payload)
                    });
                    await client.send(post);

                    // Catch any exception, so it can be logged and then rethrown
                } catch (e: any) {

                    if (expressServer.logLevel.exceptions)
                        expressServer.log(e.message as string);
                    throw e;
                }
            }
            if (this.logLevel.create)
                this.log(`${interfaceName} bound to ${requestClass.name}.${methodName}`);

        }
        return requestClass;

    }
    getSessionId<T>(responseObj : T) {
        const sessionId = responseObj['__sessionId__'];
        if (!sessionId)
            throw Error('ClassifyServerless.getSessionId: no session id');
        return sessionId;
    }

    createRequest<T, U>(responseObj : U, requestClass : new () => T) : T {
        const obj = new requestClass();
        obj['__sessionId__'] = responseObj['__sessionId__'];
        obj['__connectionId__'] = responseObj['__connectionId__'];
        return obj;
    }
    async createRequestForSession<T>(sessionId : string, requestClass : new () => T) : Promise<T> {
        // Get connection Id
        const result = await getSessionData(sessionId);
        if (!result)
            throw new Error(`ClassifyResponse.createRequestForSession: invalid session id`)
        if (!result.connectionId)
            throw new Error(`WebSocket handshake not established for session`);

        // Create request
        const obj = new requestClass();
        obj['__sessionId__'] = sessionId;
        obj['__connectionId__'] = result.connectionId;
        return obj;
    }

    async createResponse<T, R>(responseClass : new () => T, sessionId : string, callback : (_obj : T) => Promise<R>, classes : any = {}) {

        const interfaceName = (responseClass as any).__interfaceName__;
        if (!interfaceName)
            throw new Error(`ClassifyResponse.createResponse: Failed to call registerResponse for ${responseClass.name}`)

        const result = await getSessionData(sessionId, interfaceName);
        if (!result)
            throw new Error(`ClassifyResponse.createResponse: invalid session id for interface ${interfaceName}`)
        const sessionData = result[`interface_${interfaceName}`];

        // Instantiate the class
        const obj = (new responseClass()) as any;

        // Enrich it with session data
        if (sessionData)
            Object.assign(obj, deserialize(sessionData, classes));
        obj.__sessionId__ = sessionId;
        obj.__connectionId__ = result.connectionId;

        if (this.logLevel.calls)
            this.log(`creating response for ${interfaceName} with sessionId=${sessionId} connectionId= ${obj.__connectionId__} sessionData=${sessionData}`);

        const ret : R = await callback(obj as unknown as T);

        const updatedSessionData = serialize(obj, classes);
        if (updatedSessionData !== result.sessionData) {
            if (this.logLevel.calls)
                this.log(`saving session data for ${interfaceName} with sessionId=${sessionId} connectionId= ${obj.__connectionId__} sessionData=${updatedSessionData}`);

            await saveSessionData(sessionId, interfaceName, updatedSessionData, undefined);
        }

        return ret;
    }
}
export async function getSessionData (sessionId : string, interfaceName = "") {
    if (sessionId) {
        const data = await ddbDocClient.get({
            TableName: 'classifySessionStore',
            Key: { sessionId },
            ConsistentRead: true,
            ProjectionExpression: `interface_${interfaceName}, connectionId, updated`
        });
        return data.Item;
    }
    return undefined;
}
export async function saveSessionData(sessionId : string, interfaceName? : string, sessionData? : string, connectionId?: string) {

        const updateExpressionComponents = ['updated = :time'];
        const expressionAttributeValues = {':time' : new Date().getTime()};
        if (sessionData && interfaceName) {
            updateExpressionComponents.push(`interface_${interfaceName} = :data`);
            expressionAttributeValues[`:data`] = sessionData;
        }
        if (connectionId) {
            updateExpressionComponents.push('connectionId = :connectionId');
            expressionAttributeValues[':connectionId'] = connectionId;
        }

        // First try and out data only if the session id exists
        await ddbDocClient.update({
            TableName: 'classifySessionStore',
            Key: { sessionId },
            UpdateExpression: `set ${updateExpressionComponents.join(", ")}`,
            ExpressionAttributeValues: expressionAttributeValues
        });
        return sessionId;
}

export const EndPointsLogging = {
    create : true,
    connect : true,
    exceptions : true,
    calls : true,
    requests : false,
    data : false,
}
