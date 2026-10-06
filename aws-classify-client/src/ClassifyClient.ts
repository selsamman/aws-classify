import type {LambdaRequest, LambdaResponse, EndPointsLogging, ClientAuthenticationOptions, ManagedClientAuthenticationOptions, SocketAuthorization, AuthorizationRequest, LocalLogoutResult} from "aws-classify-common";
import {deserialize, serialize} from "js-freeze-dry";
import {validatePublicSuffix} from "aws-classify-common";
import axios from "axios";
import {ManagedAuthentication, AuthenticationChangedError, LoginRequiredError} from "./ManagedAuthentication";

export class ClassifyClient {

    // eslint-disable-next-line no-restricted-globals
    constructor(
        getSession : () => Promise<string>, setSession : (sessionId: string) => Promise<void>, postURL = '/api/dispatch', authentication?: ClientAuthenticationOptions | ManagedClientAuthenticationOptions) {
        this.postURL = postURL;
        if (authentication) {
            validatePublicSuffix(authentication.publicSuffix);
            if (!!authentication.managed === (typeof authentication.getAccessToken === 'function')) throw new Error('Supply exactly one of managed or getAccessToken');
            if (!!authentication.getPublicSession !== !!authentication.setPublicSession) throw new Error('Supply both public session callbacks');
            this.authentication = {...authentication};
        }
        this.getSession = getSession;
        this.setSession = setSession;
        if (authentication?.managed) this.managed = new ManagedAuthentication(authentication.managed, () => this.invalidateAuthentication());
    }
    private readonly authentication?: ClientAuthenticationOptions | ManagedClientAuthenticationOptions;
    private readonly managed?: ManagedAuthentication;
    private generation = 0;
    private protectedBlocked = false;
    private sessionQueue: Promise<void> = Promise.resolve();
    private cleanup: Promise<void> = Promise.resolve();
    private cancelSocketOpen?: () => void;
    private invalidateAuthentication() {
        ++this.generation;
        this.protectedBlocked = true;
        const socket = this.socket;
        this.socket = undefined;
        this.socketRequested = false;
        this.webSocketURL = '';
        this.cancelSocketOpen?.();
        this.cancelSocketOpen = undefined;
        let closeError: unknown;
        try { socket?.close(); } catch (error) { closeError = error; }
        const cleanup = this.sessionQueue.then(async () => {
            await this.setSession('');
            if (closeError) throw closeError;
        });
        this.cleanup = cleanup;
        this.sessionQueue = cleanup.catch(() => {});
        // Keep the rejection observable through lifecycle/request calls, without an unhandled rejection.
        void cleanup.catch(() => {});
    }
    private assertCurrent(generation: number, isPublic = false) {
        if (this.authentication && !isPublic && generation !== this.generation) throw new AuthenticationChangedError();
    }
    private async saveProtectedSession(id: string, generation: number) {
        if (!this.authentication) return this.setSession(id);
        const save = this.sessionQueue.then(async () => {
            this.assertCurrent(generation);
            await this.setSession(id);
            this.assertCurrent(generation);
        });
        this.sessionQueue = save.catch(() => {});
        return save;
    }
    async beginLogin(): Promise<AuthorizationRequest> {
        if (!this.managed) throw new Error('Managed authentication required');
        this.managed.clear();
        const generation = this.generation;
        await this.cleanup;
        this.assertCurrent(generation);
        return this.managed.beginLogin();
    }
    async completeLogin(returnUrl: string): Promise<void> {
        if (!this.managed) throw new Error('Managed authentication required');
        this.managed.prepareCompletion();
        const generation = this.generation;
        await this.cleanup;
        this.assertCurrent(generation);
        await this.managed.completeLogin(returnUrl);
        this.assertCurrent(generation);
        this.protectedBlocked = false;
    }
    async logout(): Promise<LocalLogoutResult> {
        if (!this.authentication) throw new Error('Authentication required');
        let idTokenHint: string | undefined;
        try {
            if (this.managed) idTokenHint = this.managed.clear();
            else this.invalidateAuthentication();
        } catch (error) {
            await this.cleanup;
            throw error;
        }
        await this.cleanup;
        return Object.freeze({idTokenHint});
    }
    private publicSession = '';
    private isPublic(method: string) { return !!this.authentication && method.endsWith(this.authentication.publicSuffix); }
    private async requestHeaders(isPublic = false, generation = this.generation) {
        const headers: Record<string, string> = {'Content-Type': 'text/plain'};
        if (this.authentication && !isPublic) {
            await this.cleanup;
            this.assertCurrent(generation);
            if (this.protectedBlocked) throw new LoginRequiredError();
            const token = this.managed ? await this.managed.getAccessToken() : await this.authentication.getAccessToken!();
            this.assertCurrent(generation);
            if (!token || /[\r\n]/.test(token)) throw new Error('Access token required');
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
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

    async initSocket(classes: any = {}): Promise<boolean> {
        const generation = this.generation;
        if (this.authentication && this.protectedBlocked) throw new LoginRequiredError();
        if (this.socket || this.socketRequested) return true;
        this.socketRequested = true;
        try {
            const sessionId = await this.getSession();
            const headers = await this.requestHeaders(false, generation);
            this.assertCurrent(generation);
            const request: LambdaRequest = {interfaceName: '$WebSocket', methodName: '$authorize', args: [], sessionId};
            const rawResponse = await axios.post(this.postURL, serialize(request), {headers, transformRequest: [], transformResponse: []});
            this.assertCurrent(generation);
            const response: LambdaResponse = deserialize(rawResponse.data, classes);
            if (response.exception) throw new Error(response.exception);
            if (!response.sessionId) return false;
            const authorization = response.data as SocketAuthorization;
            if (this.authentication && (!authorization?.credential || !authorization.url)) throw new Error('Connection credential required');
            await this.saveProtectedSession(response.sessionId, generation);
            this.assertCurrent(generation);
            this.webSocketURL = this.authentication ? authorization.url : response.data;
            const socket = new WebSocket(this.webSocketURL, [this.authentication ? authorization.credential : response.sessionId]);
            this.socket = socket;
            const current = () => this.socket === socket && (!this.authentication || generation === this.generation);
            socket.onerror = () => { if (current()) socket.close(); };
            socket.addEventListener('message', (event: MessageEvent) => {
                if (!current()) return;
                try {
                    const notification = deserialize(event.data, classes) as LambdaRequest;
                    const callback = this.messageCallback[`${notification.interfaceName}.${notification.methodName}`];
                    if (callback) callback(notification);
                } catch (error) { this.log(`${error} on Websocket message parsing`); }
            });
            socket.addEventListener('close', () => {
                if (!current()) return;
                this.socket = undefined;
                if (this.eventDisconnect) this.eventDisconnect();
            });
            try {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {finish(); reject(new Error('Timed out waiting for socket open'));}, 5000);
                    const finish = () => {
                        clearTimeout(timeout);
                        if (this.cancelSocketOpen === cancel) this.cancelSocketOpen = undefined;
                    };
                    const cancel = () => {finish(); reject(new AuthenticationChangedError());};
                    this.cancelSocketOpen = cancel;
                    socket.addEventListener('open', () => {
                        if (!current()) {cancel(); return;}
                        finish();
                        this.socketRequested = false;
                        if (this.eventConnect) this.eventConnect();
                        resolve();
                    });
                });
                this.assertCurrent(generation);
                return true;
            } catch (error) {
                socket.close();
                if (this.socket === socket) this.socket = undefined;
                this.assertCurrent(generation);
                return false;
            }
        } finally {
            if (!this.authentication || generation === this.generation) this.socketRequested = false;
        }
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

                const generation = this.generation;
                const isPublic = this.isPublic(methodName);
                try {
                    const request: LambdaRequest = {
                        interfaceName: interfaceName,
                        args, methodName,
                        sessionId: isPublic ? await (this.authentication?.getPublicSession?.() ?? Promise.resolve(this.publicSession)) : await this.getSession()
                    };
                    const headers = await this.requestHeaders(isPublic, generation);
                    this.assertCurrent(generation, isPublic);
                    const body = serialize(request, classes);

                    // Log request
                    if (this.logLevel.data)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested ${body}`);
                    else if (this.logLevel.calls)
                        this.log(`Endpoint ${interfaceName}.${methodName} requested`);

                    // Make requests and parse response

                    this.assertCurrent(generation, isPublic);
                    const rawResponse = await axios.post(
                        isPublic ? (this.authentication?.publicURL || `${this.postURL.replace(/\/$/, '')}/public`) : this.postURL,
                        body,
                        {
                            headers,
                            transformRequest: [],
                            transformResponse: []
                        }
                     );
                    this.assertCurrent(generation, isPublic);
                    const response: LambdaResponse = deserialize(rawResponse.data, classes as LambdaResponse);

                    if (response.sessionId) {
                        if (isPublic) {
                            this.publicSession = response.sessionId;
                            await this.authentication?.setPublicSession?.(response.sessionId);
                        } else await this.saveProtectedSession(response.sessionId, generation);
                    }

                    this.assertCurrent(generation, isPublic);
                    // Log response
                    if (this.logLevel.data)
                        this.log(`Endpoint ${interfaceName}.${methodName}} responded with ${rawResponse}`);
                    else if (this.logLevel.calls)
                        this.log(`Endpoint ${interfaceName}.${methodName} responded ${response.exception ? 'with exception' : 'successfully'}`);

                    // Handle exceptions
                    if (response.exception)
                        throw new Error(response.exception);

                    // Pass side-data to listener
                    this.assertCurrent(generation, isPublic);
                    if (response.cargo && this.listener)
                        this.listener(response.cargo);

                    this.assertCurrent(generation, isPublic);
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
