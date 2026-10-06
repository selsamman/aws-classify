/** Identity comes exclusively from an API Gateway authorizer, never the request body. */
export interface AuthenticatedIdentity {
    readonly subject: string;
    readonly issuer: string;
    readonly scopes: readonly string[];
    readonly claims: Readonly<Record<string, unknown>>;
}
export interface RequestContext {
    readonly dispatch: 'legacy' | 'protected' | 'public';
    readonly identity: AuthenticatedIdentity | undefined;
    readonly offline: boolean;
    hasScope(scope: string): boolean;
}
export interface ManagedAuthenticationOptions {
    issuer: string;
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    /** Separate multiple application clients on the same origin. */
    storageKey?: string;
    /** Defaults to 600 seconds; allowed range 60–1800. */
    transactionLifetimeSeconds?: number;
    /** Refresh before expiry; defaults to 30 seconds, allowed range 0–300. */
    refreshLeewaySeconds?: number;
    /** Explicit trusted discovery metadata when discovery cannot be used. */
    metadata?: {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        jwks_uri: string;
        end_session_endpoint?: string;
    };
}
interface ClientAuthenticationRouting {
    publicSuffix: string;
    publicURL?: string;
    /** Optional persistence for a separate anonymous session. Defaults to client-local memory. */
    getPublicSession?: () => Promise<string>;
    setPublicSession?: (sessionId: string) => Promise<void>;
}
/** Existing external-token interface remains extendable by consumers. */
export interface ClientAuthenticationOptions extends ClientAuthenticationRouting {
    getAccessToken: () => string | undefined | Promise<string | undefined>;
    managed?: never;
}
export interface ManagedClientAuthenticationOptions extends ClientAuthenticationRouting {
    managed: ManagedAuthenticationOptions;
    getAccessToken?: never;
}
export interface AuthorizationRequest {
    readonly authorizationEndpoint: string;
    readonly parameters: Readonly<Record<string, string>>;
}
export interface LocalLogoutResult {
    /** Only for constructing a provider logout URL. Treat as a credential. */
    readonly idTokenHint?: string;
}
export function validatePublicSuffix(suffix: string): string {
    if (typeof suffix !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(suffix))
        throw new Error('publicSuffix must be a nonempty identifier suffix beginning with a letter');
    return suffix;
}
export interface SocketAuthorization {
    url: string;
    credential: string;
    expiresAt: number;
}
