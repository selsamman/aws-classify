import {InMemoryWebStorage, OidcClient, WebStorageStateStore} from 'oidc-client-ts';
import type {SigninResponse} from 'oidc-client-ts';
import type {AuthorizationRequest, ManagedAuthenticationOptions} from 'aws-classify-common';

export class LoginRequiredError extends Error {
    constructor() { super('Login required'); this.name = 'LoginRequiredError'; }
}
export class AuthenticationChangedError extends Error {
    constructor() { super('Authentication changed; result discarded'); this.name = 'AuthenticationChangedError'; }
}
interface Credentials {
    accessToken: string;
    refreshToken?: string;
    idToken: string;
    expiresAt: number;
    subject: string;
    scope?: string;
}
interface Transaction {id: string; state: string; nonce: string; created: number}
interface Scope {
    generation: number;
    listeners: Set<() => void>;
    refresh?: Promise<string>;
}
// Instances in the same tab/namespace share cancellation and refresh rotation.
const scopes = new WeakMap<Storage, Map<string, Scope>>();

export class ManagedAuthentication {
    private readonly storage: Storage;
    private readonly prefix: string;
    private readonly scope: Scope;
    private readonly options: ManagedAuthenticationOptions;
    private readonly lifetime: number;
    private readonly leeway: number;
    private keys?: ReturnType<(typeof import('jose'))['createRemoteJWKSet']>;

    constructor(options: ManagedAuthenticationOptions, invalidate: () => void) {
        if (typeof window === 'undefined' || !globalThis.crypto?.subtle) throw new Error('Managed authentication requires a secure browser context');
        for (const url of [options.issuer, options.redirectUri, ...Object.values(options.metadata || {})]) {
            if (url) {
                const parsed = new URL(url);
                if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Authentication URLs require HTTPS');
                if (parsed.username || parsed.password || parsed.hash) throw new Error('Invalid authentication URL');
            }
        }
        if (!options.clientId || !options.scopes?.includes('openid') || options.scopes.some(s => !s || /\s/.test(s))) throw new Error('clientId and scopes including openid required');
        if (options.metadata && options.metadata.issuer !== options.issuer) throw new Error('Metadata issuer mismatch');
        this.lifetime = options.transactionLifetimeSeconds ?? 600;
        this.leeway = options.refreshLeewaySeconds ?? 30;
        if (!Number.isFinite(this.lifetime) || this.lifetime < 60 || this.lifetime > 1800 || !Number.isFinite(this.leeway) || this.leeway < 0 || this.leeway > 300) throw new Error('Invalid authentication timing');
        this.options = {...options, scopes: [...options.scopes], metadata: options.metadata && {...options.metadata}};
        this.storage = window.sessionStorage;
        this.prefix = `aws-classify:oidc:${JSON.stringify([options.storageKey || 'default', options.issuer, options.clientId, options.redirectUri, options.scopes])}:`;
        let namespaces = scopes.get(this.storage);
        if (!namespaces) scopes.set(this.storage, namespaces = new Map());
        let scope = namespaces.get(this.prefix);
        if (!scope) namespaces.set(this.prefix, scope = {generation: 0, listeners: new Set()});
        this.scope = scope;
        this.scope.listeners.add(invalidate);
    }
    private client(stateStore = new WebStorageStateStore({store: new InMemoryWebStorage()})) {
        return new OidcClient({authority: this.options.issuer, client_id: this.options.clientId,
            redirect_uri: this.options.redirectUri, scope: this.options.scopes.join(' '),
            response_type: 'code', response_mode: 'query', loadUserInfo: false,
            stateStore, metadata: this.options.metadata, requestTimeoutInSeconds: 15});
    }
    private assert(generation: number) {
        if (generation !== this.scope.generation) throw new AuthenticationChangedError();
    }
    private read(): Credentials | undefined {
        const value = this.storage.getItem(this.prefix + 'credentials');
        if (!value) return undefined;
        try {
            const credentials = JSON.parse(value) as Credentials;
            if (!credentials.accessToken || !credentials.idToken || !credentials.subject || !Number.isFinite(credentials.expiresAt)) throw new Error();
            return credentials;
        } catch { this.clear(); throw new LoginRequiredError(); }
    }
    /** Synchronous cancellation always precedes asynchronous session cleanup. */
    clear(): string | undefined {
        let hint: string | undefined;
        try { hint = JSON.parse(this.storage.getItem(this.prefix + 'credentials') || '{}').idToken; } catch { /* corrupt private cache */ }
        ++this.scope.generation;
        this.scope.refresh = undefined;
        // Notify first: even storage failures must disable transports.
        for (const invalidate of this.scope.listeners) invalidate();
        this.storage.removeItem(this.prefix + 'credentials');
        this.storage.removeItem(this.prefix + 'transaction');
        return hint;
    }
    prepareCompletion(): void {
        ++this.scope.generation;
        this.scope.refresh = undefined;
        for (const invalidate of this.scope.listeners) invalidate();
        this.storage.removeItem(this.prefix + 'credentials');
    }
    async beginLogin(): Promise<AuthorizationRequest> {
        const generation = this.scope.generation;
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        const request = await this.client().createSigninRequest({nonce});
        this.assert(generation);
        this.storage.setItem(this.prefix + 'transaction', JSON.stringify({id: request.state.id,
            state: request.state.toStorageString(), nonce, created: Date.now()} as Transaction));
        const url = new URL(request.url), parameters: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {parameters[key] = value;});
        url.search = '';
        return Object.freeze({authorizationEndpoint: url.href, parameters: Object.freeze(parameters)});
    }
    async completeLogin(returnUrl: string): Promise<void> {
        const generation = this.scope.generation;
        const raw = this.storage.getItem(this.prefix + 'transaction');
        // Consume even malformed/failed callbacks before any await or exchange.
        this.storage.removeItem(this.prefix + 'transaction');
        try {
            if (!raw) throw new Error('No pending login transaction');
            const transaction = JSON.parse(raw) as Transaction;
            const callback = new URL(returnUrl), registered = new URL(this.options.redirectUri);
            if (callback.origin !== registered.origin || callback.pathname !== registered.pathname || callback.hash) throw new Error('Login return URL mismatch');
            registered.searchParams.forEach((value, key) => {if (callback.searchParams.get(key) !== value) throw new Error('Login return URL mismatch');});
            for (const key of ['state', 'code', 'error', 'iss']) if (callback.searchParams.getAll(key).length > 1) throw new Error('Duplicate login response parameter');
            if (callback.searchParams.get('state') !== transaction.id) throw new Error('Login state mismatch');
            if (!Number.isFinite(transaction.created) || Date.now() - transaction.created > this.lifetime * 1000 || transaction.created > Date.now()) throw new Error('Login transaction expired');
            if (callback.searchParams.has('iss') && callback.searchParams.get('iss') !== this.options.issuer) throw new Error('Login issuer mismatch');
            if (callback.searchParams.has('code') === callback.searchParams.has('error')) throw new Error('Invalid login response');
            const store = new WebStorageStateStore({store: new InMemoryWebStorage()});
            await store.set(transaction.id, transaction.state);
            const client = this.client(store);
            const response = await client.processSigninResponse(returnUrl);
            const credentials = await this.validate(response, client, transaction.nonce);
            this.assert(generation);
            this.storage.setItem(this.prefix + 'credentials', JSON.stringify(credentials));
        } catch (error) {
            // An old completion must never clear a newer login.
            if (generation === this.scope.generation) this.clear();
            throw error;
        }
    }
    private async validate(response: SigninResponse, client: OidcClient, nonce?: string, previous?: Credentials): Promise<Credentials> {
        if (!response.access_token || /[\r\n]/.test(response.access_token) || response.token_type?.toLowerCase() !== 'bearer' || !response.expires_at || response.expires_at * 1000 <= Date.now()) throw new Error('Invalid token response');
        let subject = previous?.subject;
        // The OIDC library carries the previous ID token forward when refresh omits it.
        // That previously validated login token may now be expired; the new access token
        // has its own lifetime, enforced here and independently by Gateway.
        if (response.id_token && (!previous || response.id_token !== previous.idToken)) {
            const metadata = await client.metadataService.getMetadata();
            if (metadata.issuer !== this.options.issuer || !metadata.jwks_uri) throw new Error('Discovery issuer/keys mismatch');
            // Keep JOSE's Web Crypto/encoder initialization out of legacy imports.
            const {createRemoteJWKSet, jwtVerify} = await import('jose');
            if (!this.keys) this.keys = createRemoteJWKSet(new URL(metadata.jwks_uri));
            const {payload} = await jwtVerify(response.id_token, this.keys, {issuer: this.options.issuer,
                audience: this.options.clientId, algorithms: ['RS256', 'PS256', 'ES256'], requiredClaims: ['sub', 'iat', 'exp'], clockTolerance: 30});
            if (typeof payload.sub !== 'string' || !payload.sub || (nonce && payload.nonce !== nonce) ||
                (payload.azp !== undefined && payload.azp !== this.options.clientId) ||
                (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.options.clientId) ||
                (previous && previous.subject !== payload.sub)) throw new Error('ID token authentication mismatch');
            subject = payload.sub;
        } else if (!previous) throw new Error('ID token required');
        return {accessToken: response.access_token, refreshToken: response.refresh_token || previous?.refreshToken,
            idToken: response.id_token || previous!.idToken, subject: subject!, expiresAt: response.expires_at, scope: response.scope || previous?.scope};
    }
    async getAccessToken(): Promise<string> {
        const generation = this.scope.generation;
        const credentials = this.read();
        if (!credentials) throw new LoginRequiredError();
        if (credentials.expiresAt * 1000 > Date.now() + this.leeway * 1000) return credentials.accessToken;
        if (this.scope.refresh) return this.scope.refresh;
        const refresh = (async () => {
            try {
                if (!credentials.refreshToken) throw new LoginRequiredError();
                const client = this.client();
                const response = await client.useRefreshToken({state: {refresh_token: credentials.refreshToken,
                    id_token: credentials.idToken, scope: credentials.scope, session_state: null,
                    profile: {sub: credentials.subject, iss: this.options.issuer, aud: this.options.clientId,
                        exp: credentials.expiresAt, iat: 0}}});
                const next = await this.validate(response, client, undefined, credentials);
                this.assert(generation);
                this.storage.setItem(this.prefix + 'credentials', JSON.stringify(next));
                return next.accessToken;
            } catch {
                this.assert(generation);
                this.clear();
                throw new LoginRequiredError();
            } finally { if (generation === this.scope.generation) this.scope.refresh = undefined; }
        })();
        this.scope.refresh = refresh;
        return refresh;
    }
}
