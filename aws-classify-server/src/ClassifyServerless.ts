import {deserialize, serialize} from "js-freeze-dry";
import {ClassDef} from "./ClassDef";
import type {LambdaRequest, LambdaResponse, RequestContext} from "aws-classify-common";
import {sessionStore as ddbDocClient} from "./SessionStore";
import {AsyncLocalStorage} from "node:async_hooks";
import {isPublicEndpoint} from "aws-classify-common";
import {HttpEvent, ServerAuthenticationOptions, requestContext} from "./Authentication";
import {ownedSession, sessionOwner, issueConnectionCredential} from "./AuthenticatedSessions";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import {Context} from "aws-lambda";
import {ClassifyResponse} from "./ClassifyResponse";


const updateDebounceInterval = 1000 * 60 * 10; // Don't update session unless 10 minutes have passed or data changed

export class ClassifyServerless {

    private authentication: ServerAuthenticationOptions | undefined;
    private readonly contexts = new AsyncLocalStorage<RequestContext>();
    private readonly activeContexts = new Set<RequestContext>();
    private readonly responseContexts = new WeakMap<object, RequestContext>();

    constructor() {
        if (process.env.AWS_CLASSIFY_AUTHENTICATION === 'true')
            this.configureAuthentication({});
    }
    configureAuthentication(options: ServerAuthenticationOptions) {
        const seconds = options.connectionCredentialSeconds ?? 60;
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error('connectionCredentialSeconds must be 1–300');
        this.authentication = Object.freeze({...options, connectionCredentialSeconds: seconds});
    }
    get authenticationEnabled() { return !!this.authentication; }
    getRequestContext(response?: object): RequestContext | undefined {
        const current = this.contexts.getStore();
        if (!current || !this.activeContexts.has(current)) return undefined;
        return response ? (this.responseContexts.get(response) === current ? current : undefined) : current;
    }

    logLevel: Partial<typeof EndPointsLogging> = {};
    classDefs : Map<any, ClassDef<any, any>> = new Map();
    requests : Map<any, any> = new Map();
    expirationMinutes = 60 * 24;

    log : (_message: string) => void = msg => console.log(msg);

    setExpirationMinutes(minutes : number) {
        this.expirationMinutes = minutes;
    }

    setLogger(log : (_message: string) => void) {
        this.log = log;
    }

    setLogLevel(logLevel : Partial<typeof EndPointsLogging>) {
        this.logLevel = logLevel;
    }

    registerResponse<T>(responseClass : new () => T,
                            authorizer? : (_endPoint: T, _method: string, _args: IArguments, _context?: RequestContext) => Promise<boolean>,
                            options?: {publicMethods?: readonly string[]}) {

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

        const methods = Object.getOwnPropertyNames(clientClass.prototype).filter(method => method !== 'constructor' && typeof clientClass.prototype[method] === 'function');
        const decorated = methods.filter(method => isPublicEndpoint(clientClass.prototype[method]));
        if (options?.publicMethods !== undefined && decorated.length) throw new Error('Use either @Public() or publicMethods, not both');
        const publicMethods = options?.publicMethods === undefined ? decorated : [...options.publicMethods];
        if (!publicMethods.every(method => typeof method === 'string' && methods.includes(method)) || new Set(publicMethods).size !== publicMethods.length)
            throw new Error('publicMethods must be unique request-class method names');

        this.classDefs.set(interfaceName, {serverClass: responseClass, clientClass, authorizer, publicMethods: new Set(publicMethods)});
        (responseClass as any).__interfaceName__ = interfaceName;
    }

    async dispatch(ev: HttpEvent, context: Context, classes = {}, entry: 'protected' | 'public' = 'protected') {
        if (entry === 'public' && !this.authentication) throw new Error('Public dispatch requires authentication configuration');
        const trusted = requestContext(ev, this.authentication ? entry : 'legacy', this.authentication);
        this.activeContexts.add(trusted);
        try { return await this.contexts.run(trusted, () => this.dispatchRequest(ev, context, classes, trusted)); }
        finally { this.activeContexts.delete(trusted); }
    }

    private async dispatchRequest(ev: HttpEvent, context: Context, classes: any, trusted: RequestContext) {

        const request = deserialize(ev.body as string, classes) as LambdaRequest;
        if (!request || typeof request.interfaceName !== 'string' || typeof request.methodName !== 'string' || !Array.isArray(request.args) || typeof request.sessionId !== 'string') throw new Error('Malformed dispatch request');
        const logName = `${request.interfaceName}.${request.methodName}`;
        let sessionId = request.sessionId; //  May be empty

        // Pseudo interface/method to request socket access and return a session id to use in connect
        // Legacy mode passes the session id; authenticated mode issues a separate credential.
        if (logName === '$WebSocket.$authorize') {
            if (this.authentication) {
                if (trusted.dispatch !== 'protected') throw new Error('Socket authorization requires protected dispatch');
                const session = await ownedSession(sessionId, sessionOwner(trusted), this.expirationMinutes);
                const data = await issueConnectionCredential(session, this.authentication.connectionCredentialSeconds!, process.env.IS_OFFLINE ? 'ws://localhost:3001' : `wss://${process.env.APIG_ENDPOINT}`);
                return serialize({data, sessionId: session.sessionId, exception: undefined, cargo: undefined}, classes);
            }
            const socketResult = await getSessionData(sessionId, "");
            if (!socketResult) {
                sessionId = context.awsRequestId;
                await saveSessionData(sessionId, undefined,undefined, undefined, undefined, this.expirationMinutes);
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
        if (request.methodName === 'constructor' || !Object.prototype.hasOwnProperty.call(classDef.clientClass.prototype, request.methodName) || typeof classDef.clientClass.prototype[request.methodName] !== 'function')
            throw new Error(`${request.methodName} not found in ${request.interfaceName} client request class`);

        if (this.authentication && classDef.publicMethods.has(request.methodName) !== (trusted.dispatch === 'public')) throw new Error('Member is not permitted on this dispatch endpoint');

        // If authorizer passed in make sure request is authorized
        if (!classDef.authorizer || await (this.authentication ? classDef.authorizer(request.interfaceName, request.methodName, request.args as any, trusted) : classDef.authorizer(request.interfaceName, request.methodName, request.args as any))) {

            // Instantiate the class
            const obj = new classDef.serverClass() as ClassifyResponse;

            // Retrieve session data from DynamoDB base on sessionId in request
            let orignalSessionData = "";
            const result = this.authentication ? await ownedSession(sessionId, sessionOwner(trusted), this.expirationMinutes) : await getSessionData(sessionId, request.interfaceName);
            if (this.authentication) sessionId = result.sessionId;
            if (!result)
                sessionId = context.awsRequestId;
            else {
                const sessionData = result[`interface_${request.interfaceName}`];
                if (sessionData) {// Enrich it with session data
                    orignalSessionData = deserialize(sessionData, classes)
                    Object.assign(obj, orignalSessionData);
                }
            }

            this.responseContexts.set(obj, trusted);
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
            if (!result || updatedSessionData !== orignalSessionData  || (Date.now() > (result.updated + updateDebounceInterval)))
                sessionId  = await saveSessionData(sessionId, request.interfaceName, updatedSessionData, undefined, obj.__userId__, this.expirationMinutes, this.authentication ? sessionOwner(trusted) : undefined);

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
                    let connectionId = this['__connectionId__'];
                    if (expressServer.authentication && sessionId) {
                        const live = await getSessionData(sessionId);
                        if (!live?.authOwner || live.authOwner === 'public' || !(live.expires > Math.floor(Date.now() / 1000))) throw new Error('Invalid authenticated notification session');
                        connectionId = live.connectionId;
                    }
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
                    throw new Error(`Unable to send message via Websocket ${e.message}`);
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
    getUserId<T>(responseObj : T) {
        const userId = responseObj['__userId__'];
        return userId;
    }
    setUserId<T>(responseObj : T, userId : string){
        responseObj['__userId__'] = userId;
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
        if (this.authentication && (!result.authOwner || result.authOwner === 'public' || !(result.expires > Math.floor(Date.now() / 1000)))) throw new Error('Invalid authenticated notification session');
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
        if (this.authentication && (!result.authOwner || result.authOwner === 'public' || !(result.expires > Math.floor(Date.now() / 1000)))) throw new Error('Invalid authenticated notification session');
        const sessionData = result[`interface_${interfaceName}`];

        // Instantiate the class
        const obj = (new responseClass()) as any;

        // Enrich it with session data
        if (sessionData)
            Object.assign(obj, deserialize(sessionData, classes));
        obj.__sessionId__ = sessionId;
        obj.__connectionId__ = result.connectionId;
        obj.__userId__ = result.userId;

        if (this.logLevel.calls)
            this.log(`creating response for ${interfaceName} with sessionId=${sessionId} connectionId= ${obj.__connectionId__} sessionData=${sessionData}`);

        const ret : R = await callback(obj as unknown as T);

        const updatedSessionData = serialize(obj, classes);
        if (updatedSessionData !== sessionData || (Date.now() > (result.updated + updateDebounceInterval))) {
            if (this.logLevel.calls)
                this.log(`saving session data for ${interfaceName} with sessionId=${sessionId} connectionId= ${obj.__connectionId__} sessionData=${updatedSessionData}`);

            await saveSessionData(sessionId, interfaceName, updatedSessionData, undefined, undefined, this.expirationMinutes, this.authentication ? result.authOwner : undefined);
        }

        return ret;
    }
    async getSessionsForUserId (userId : string) {
        if (userId) {
             const data = await ddbDocClient.query({
                TableName: `classifySessionStore.${process.env.DOMAIN}`,
                KeyConditionExpression: 'userId = :userId',
                IndexName: 'userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                ProjectionExpression: `sessionId`
            });
            return data.Items ? data.Items.filter(i => !this.authentication || !i.sessionId.startsWith('connection#')).map(i => i.sessionId) : [];
        }
        return [];
    }
    async getSessions () {  // For unit testing
         const data = await ddbDocClient.scan({
            TableName: `classifySessionStore.${process.env.DOMAIN}`,
            ProjectionExpression: `sessionId`
        });
        return data.Items ? data.Items.filter(i => !this.authentication || !i.sessionId.startsWith('connection#')).map(i => i.sessionId) : [];
    }
    async deleteSessionsForUserId (userId : string) {
        if (userId) {
            const data = await ddbDocClient.query({
                TableName: `classifySessionStore.${process.env.DOMAIN}`,
                KeyConditionExpression: 'userId = :userId',
                IndexName: 'userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                ProjectionExpression: `sessionId`
            });
            const keys = data.Items ? data.Items.map(i => i.sessionId) : [];
            await deleteSessionByKeys(keys);
        }
    }
    async deleteSessions () {
        const data = await ddbDocClient.scan({
            TableName: `classifySessionStore.${process.env.DOMAIN}`,
            ProjectionExpression: `sessionId`
        });
        const keys =  data.Items ? data.Items.map(i => i.sessionId) : [];
        await deleteSessionByKeys(keys);
    }
}
async function deleteSessionByKeys (keys : Array<string>) {
    for (let ix = 0; ix < keys.length; ++ix) {
        await ddbDocClient.delete({
            TableName: `classifySessionStore.${process.env.DOMAIN}`,
            Key: {sessionId: keys[ix]}
        });
    }
}

export async function getSessionData (sessionId : string, interfaceName = "") {
    if (sessionId) {
        const data = await ddbDocClient.get({
            TableName: `classifySessionStore.${process.env.DOMAIN}`,
            Key: { sessionId },
            ConsistentRead: true,
            ProjectionExpression: `interface_${interfaceName}, connectionId, userId, updated, expires, authOwner`
        });
        return data.Item;
    }
    return undefined;
}

export async function saveSessionData(sessionId : string, interfaceName? : string, sessionData? : string, connectionId?: string, userId?: string, expirationMinutes?: number, authOwner?: string) {


        const updateExpressionComponents = ['updated = :time'];
        const expressionAttributeValues = {':time' : new Date().getTime()};

        if (typeof expirationMinutes === 'number') {
            const expires = new Date();
            expires.setMinutes(expires.getMinutes() + expirationMinutes);
            updateExpressionComponents.push('expires = :expires');
            expressionAttributeValues[':expires'] = Math.floor(expires.getTime() / 1000);
        }

        if (sessionData && interfaceName) {
            updateExpressionComponents.push(`interface_${interfaceName} = :data`);
            expressionAttributeValues[`:data`] = sessionData;
        }

        if (connectionId) {
            updateExpressionComponents.push('connectionId = :connectionId');
            expressionAttributeValues[':connectionId'] = connectionId;
        }

        if (userId) {
            updateExpressionComponents.push('userId = :userId');
            expressionAttributeValues[':userId'] = userId;
        }

        // First try and out data only if the session id exists
        await ddbDocClient.update({
            TableName: `classifySessionStore.${process.env.DOMAIN}`,
            Key: { sessionId },
            UpdateExpression: `set ${updateExpressionComponents.join(", ")}`,
            ExpressionAttributeValues: {...expressionAttributeValues, ...(authOwner ? {':owner': authOwner, ':now': Math.floor(Date.now() / 1000)} : {})},
            ...(authOwner ? {ConditionExpression: 'authOwner = :owner AND expires > :now'} : {})
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
