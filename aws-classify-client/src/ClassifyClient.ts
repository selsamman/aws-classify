import {LambdaRequest, LambdaResponse, EndPointsLogging} from "./aws-classify-common";
import {deserialize, serialize} from "js-freeze-dry";
import axios from "axios";

export class ClassifyClient {

    // eslint-disable-next-line no-restricted-globals
    constructor(
        getSession : () => Promise<string>, setSession : (sessionId: string) => Promise<void>, postURL = '/api/dispatch') {
        this.postURL = postURL;
        this.getSession = getSession;
        this.setSession = setSession;
    }
    getSession;
    setSession;
    postURL: string;
    webSocketURL = "";
    logLevel: Partial<typeof EndPointsLogging> = {};
    listener: ((data: unknown) => void) | undefined;
    socket: WebSocket | undefined = undefined;
    socketRequested = false;
    messageCallback: { [key: string]: (data: LambdaRequest) => void } = {};
    session = "default";

    eventDisconnect : (() => void) | undefined;

    onDisconnect (cb : () => void) {
        this.eventDisconnect = cb;
    }

    eventConnect : (() => void) | undefined;

    onConnect (cb : () => void) {
        this.eventConnect = cb;
    }

    log: (message: string) => void = msg => console.log(msg);

    setLogger(log: (message: string) => void) {
        this.log = log;
    }

    setLogLevel(logLevel: Partial<typeof EndPointsLogging>) {
        this.logLevel = logLevel;
    }

    setListener(listener: (data: any) => void) {
        this.listener = listener;
    }

    async initSocket(classes : any = {}) {

        if (this.socket || this.socketRequested)
            return;
        this.socketRequested = true;

        const request: LambdaRequest = {
            interfaceName: '$WebSocket',
            methodName: '$authorize',
            args: [],
            sessionId: await this.getSession()
        };
        const body = serialize(request);

        if (this.logLevel.calls)
            this.log(`Endpoint ${request.interfaceName}.${request.methodName} requesting`);

        // Make requests and parse response
        this.log(`contacting ${this.postURL}`);
        const rawResponse = await axios.post(
            this.postURL,
            body,
            {
                headers: {'Content-Type': 'text/plain'},
                transformRequest: [],
                transformResponse: []
            }
        );

        const response: LambdaResponse = deserialize(rawResponse.data, classes as LambdaResponse);
        if (response.sessionId) {

            this.webSocketURL = response.data;
            this.setSession(response.sessionId);

            if (this.logLevel.calls)
                this.log(`Endpoint ${request.interfaceName}.${request.methodName} responded`);

            this.socket = new WebSocket(this.webSocketURL, [
                `${response.sessionId}`
            ]);
            this.socket.addEventListener('open',  (event) => {
                console.log("socket open");
                this.socketRequested = false;
                if (this.eventConnect)
                    this.eventConnect();
                console.log(event)
            });
            this.socket.onerror = error => {
                console.log(error);
                this.socket?.close();
            };

            this.socket.addEventListener('message', (ev: MessageEvent) => {
                try {
                    const request = deserialize(ev.data, classes) as LambdaRequest;
                    const methodKey = `${request.interfaceName}.${request.methodName}`;
                    const callback = this.messageCallback[methodKey];
                    if (callback)
                        callback(request);
                    else
                        console.log(`unknown websocket request ${methodKey}`);
                } catch (e) {
                    console.log(`${e} on Websocket message parsing`)
                }
            });

            this.socket.addEventListener('error', function (event) {
                console.log(event)
            });

            this.socket.addEventListener('close',  () => {
                console.log("socket close");
                if (this.eventDisconnect)
                    this.eventDisconnect();
                this.socket = undefined;
            });
        }
        else
            console.log('sessionId not returned');
    }

    createResponse<T>(responseClass : new () => T/*, classes: any = {}*/) : T {

        // Find ultimate base class
        let clientClass = responseClass;
        while (Object.getPrototypeOf(clientClass).prototype)
            clientClass = Object.getPrototypeOf(clientClass);
        if (clientClass === responseClass)
            throw ('ClassifyClient.registerResponse: Response class must extend a request class');

        // Get interface name as static property of request class
        const interfaceName = (clientClass as any)['interfaceName'];
        if (!interfaceName)
            throw ('ClassifyClient.registerResponse: Request must have interfaceName as a static property')

        // Create the response object
        const responseObj = new responseClass();

        for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(responseObj))) {

            const endPoint = `${interfaceName}.${methodName}`;

            if (methodName === 'constructor' || typeof (responseObj as any)[methodName] !== 'function')
                continue;

            this.log(`creating endpoint for ${endPoint}`);
            this.messageCallback[endPoint] = (data: LambdaRequest) => {
                const methodName = endPoint.split(".")[1];
                if (this.logLevel.data)
                    this.log(`Endpoint ${endPoint} reached with ${JSON.stringify(data)}`);
                else if (this.logLevel.calls)
                    this.log(`Endpoint ${endPoint} reached`);

                (responseObj as any)[methodName].apply(responseObj, data.args);
            };
        }
        return responseObj;
    }

    createRequest<T>(requestClass: new () => T, classes: any = {}) {

        const interfaceName = (requestClass as any)['interfaceName'];

        if (!interfaceName)
            throw ('ClassifyServerless.createRequester: Request must have interfaceName as a static property')

        const requestObj = new requestClass();

        for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(requestObj))) {

            if (methodName === 'constructor' || typeof (requestObj as any)[methodName] !== 'function')
                continue;

            (requestObj as any)[methodName] = async (...args: any) => {

                try {

                    const request: LambdaRequest = {
                        interfaceName: interfaceName,
                        args, methodName,
                        sessionId: await this.getSession()
                    };
                    const body = serialize(request, classes);

                    // Log request
                    if (this.logLevel.data)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested ${body}`);
                    else if (this.logLevel.calls)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested`);

                    // Make requests and parse response

                    const rawResponse = await axios.post(
                        this.postURL,
                        body,
                        {
                            headers: {'Content-Type' : 'text/plain'},
                            transformRequest: [],
                            transformResponse: []
                        }
                     );
                    const response: LambdaResponse = deserialize(rawResponse.data, classes as LambdaResponse);

                    if (response.sessionId)
                        await this.setSession(response.sessionId);

                    // Log response
                    if (this.logLevel.data)
                        this.log(`Endpoint ${interfaceName}.${methodName}} responded with ${rawResponse}`);
                    else if (this.logLevel.calls)
                        this.log(`Endpoint ${interfaceName}.${methodName} responded ${response.exception ? 'with exception' : 'successfully'}`);

                    // Handle exceptions
                    if (response.exception)
                        throw new Error(response.exception);

                    // Pass side-data to listener
                    if (response.cargo && this.listener)
                        this.listener(response.cargo);

                    return response.data;

                    // Catch any exception, so it can be logged and then rethrown
                } catch (e: any) {

                    if (this.logLevel.exceptions)
                        this.log(e.message as string);
                    throw e;
                }
            }
        }
        return requestObj;
    }
}
