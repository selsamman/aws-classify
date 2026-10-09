import type {APIGatewayProxyEvent, APIGatewayProxyEventV2} from 'aws-lambda';
import type {AuthenticatedIdentity, RequestContext} from 'aws-classify-common';
export type HttpEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;
export interface ServerAuthenticationOptions {
    connectionCredentialSeconds?: number;
    /** Adapt ONLY the trusted requestContext.authorizer emitted by a configured Gateway authorizer. */
    identityAdapter?: (authorizer: unknown) => AuthenticatedIdentity | undefined;
}
export function jwtIdentity(authorizer: any): AuthenticatedIdentity | undefined {
    const jwt = authorizer?.jwt;
    if (!jwt || typeof jwt.claims?.sub !== 'string' || !jwt.claims.sub || typeof jwt.claims?.iss !== 'string' || !jwt.claims.iss) return undefined;
    return {subject: jwt.claims.sub, issuer: jwt.claims.iss, scopes: jwt.scopes || [], claims: jwt.claims};
}
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
export function requestContext(event: HttpEvent, mode: RequestContext['dispatch'], options?: ServerAuthenticationOptions): RequestContext {
    let identity: AuthenticatedIdentity | undefined;
    const offline = process.env.IS_OFFLINE === 'true';
    if (mode === 'protected') {
        identity = offline ? undefined : (options?.identityAdapter || jwtIdentity)((event.requestContext as any)?.authorizer);
        if (!identity && !offline) throw new Error('Validated identity required');
        if (identity) {
            if (typeof identity.subject !== 'string' || !identity.subject || typeof identity.issuer !== 'string' || !identity.issuer || !identity.claims || typeof identity.claims !== 'object' || Array.isArray(identity.claims) || !Array.isArray(identity.scopes) || !identity.scopes.every(scope => typeof scope === 'string')) throw new Error('Invalid authorizer identity');
            // Copy and deeply freeze to avoid changing the Gateway event or trusting mutable grants.
            identity = freeze(JSON.parse(JSON.stringify(identity)));
        }
    }
    return Object.freeze({dispatch: mode, identity, offline, hasScope: (scope: string) => identity?.scopes.includes(scope) || false});
}
