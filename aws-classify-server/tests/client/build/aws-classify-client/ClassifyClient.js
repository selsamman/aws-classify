"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassifyClient = void 0;
const js_freeze_dry_1 = require("js-freeze-dry");
const axios_1 = __importDefault(require("axios"));
class ClassifyClient {
    // eslint-disable-next-line no-restricted-globals
    constructor(getSession, setSession, postURL = '/api/dispatch') {
        this.webSocketURL = "";
        this.logLevel = {};
        this.socket = undefined;
        this.socketRequested = false;
        this.messageCallback = {};
        this.session = "default";
        this.log = msg => console.log(msg);
        this.postURL = postURL;
        this.getSession = getSession;
        this.setSession = setSession;
    }
    onDisconnect(cb) {
        this.eventDisconnect = cb;
    }
    onConnect(cb) {
        this.eventConnect = cb;
    }
    setLogger(log) {
        this.log = log;
    }
    setLogLevel(logLevel) {
        this.logLevel = logLevel;
    }
    setListener(listener) {
        this.listener = listener;
    }
    async initSocket(classes = {}) {
        if (this.socket || this.socketRequested)
            return true;
        this.socketRequested = true;
        const request = {
            interfaceName: '$WebSocket',
            methodName: '$authorize',
            args: [],
            sessionId: await this.getSession()
        };
        const body = (0, js_freeze_dry_1.serialize)(request);
        if (this.logLevel.calls)
            this.log(`Endpoint ${request.interfaceName}.${request.methodName} requesting`);
        // Make requests and parse response
        this.log(`contacting ${this.postURL}`);
        const rawResponse = await axios_1.default.post(this.postURL, body, {
            headers: { 'Content-Type': 'text/plain' },
            transformRequest: [],
            transformResponse: []
        });
        const response = (0, js_freeze_dry_1.deserialize)(rawResponse.data, classes);
        if (response.sessionId) {
            this.webSocketURL = response.data;
            this.setSession(response.sessionId);
            if (this.logLevel.calls)
                this.log(`Endpoint ${request.interfaceName}.${request.methodName} responded`);
            this.socket = new WebSocket(this.webSocketURL, [
                `${response.sessionId}`
            ]);
            this.socket.onerror = error => {
                this.log(error.toString());
                this.socket?.close();
            };
            this.socket.addEventListener('message', (ev) => {
                try {
                    const request = (0, js_freeze_dry_1.deserialize)(ev.data, classes);
                    const methodKey = `${request.interfaceName}.${request.methodName}`;
                    const callback = this.messageCallback[methodKey];
                    if (callback)
                        callback(request);
                    else
                        this.log(`unknown websocket request ${methodKey}`);
                }
                catch (e) {
                    this.log(`${e} on Websocket message parsing`);
                }
            });
            this.socket.addEventListener('error', (_event) => {
                this.log('Websocket Error');
            });
            this.socket.addEventListener('close', event => {
                this.log(`Websocket closing ${event.code}`);
                if (this.eventDisconnect)
                    this.eventDisconnect();
                this.socket = undefined;
            });
            try {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject('Timed out waiting for socket open'), 5000);
                    this.socket?.addEventListener('open', (event) => {
                        this.log("WebSocket open");
                        this.socketRequested = false;
                        if (this.eventConnect)
                            this.eventConnect();
                        clearTimeout(timeout);
                        resolve(true);
                    });
                });
            }
            catch (e) {
                this.log(e.toString());
                return false;
            }
            return true;
        }
        else {
            this.log('sessionId not returned from Lambda');
            return false;
        }
    }
    createResponse(responseClass /*, classes: any = {}*/) {
        // Find ultimate base class
        let clientClass = responseClass;
        while (Object.getPrototypeOf(clientClass).prototype)
            clientClass = Object.getPrototypeOf(clientClass);
        if (clientClass === responseClass)
            throw ('ClassifyClient.registerResponse: Response class must extend a request class');
        // Get interface name as static property of request class
        const interfaceName = clientClass['interfaceName'];
        if (!interfaceName)
            throw ('ClassifyClient.registerResponse: Request must have interfaceName as a static property');
        // Create the response object
        const responseObj = new responseClass();
        for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(responseObj))) {
            const endPoint = `${interfaceName}.${methodName}`;
            if (methodName === 'constructor' || typeof responseObj[methodName] !== 'function')
                continue;
            this.log(`creating endpoint for ${endPoint}`);
            this.messageCallback[endPoint] = (data) => {
                const methodName = endPoint.split(".")[1];
                if (this.logLevel.data)
                    this.log(`Endpoint ${endPoint} reached with ${JSON.stringify(data)}`);
                else if (this.logLevel.calls)
                    this.log(`Endpoint ${endPoint} reached`);
                responseObj[methodName].apply(responseObj, data.args);
            };
        }
        return responseObj;
    }
    createRequest(requestClass, classes = {}) {
        const interfaceName = requestClass['interfaceName'];
        if (!interfaceName)
            throw ('ClassifyServerless.createRequester: Request must have interfaceName as a static property');
        const requestObj = new requestClass();
        for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(requestObj))) {
            if (methodName === 'constructor' || typeof requestObj[methodName] !== 'function')
                continue;
            requestObj[methodName] = async (...args) => {
                try {
                    const request = {
                        interfaceName: interfaceName,
                        args, methodName,
                        sessionId: await this.getSession()
                    };
                    const body = (0, js_freeze_dry_1.serialize)(request, classes);
                    // Log request
                    if (this.logLevel.data)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested ${body}`);
                    else if (this.logLevel.calls)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested`);
                    // Make requests and parse response
                    const rawResponse = await axios_1.default.post(this.postURL, body, {
                        headers: { 'Content-Type': 'text/plain' },
                        transformRequest: [],
                        transformResponse: []
                    });
                    const response = (0, js_freeze_dry_1.deserialize)(rawResponse.data, classes);
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
                }
                catch (e) {
                    if (this.logLevel.exceptions)
                        this.log(e.message);
                    throw e;
                }
            };
        }
        return requestObj;
    }
}
exports.ClassifyClient = ClassifyClient;
