# Managed browser authentication lifecycle

Implemented in the working tree on 2026-10-06. Authentication remains opt-in.
The existing external `getAccessToken()` mode and authentication-disabled
three-argument constructor remain available. Server identity, ownership and
permissions still come exclusively from API Gateway's authorizer context.

## Responsibilities and supported flow

Classify manages the pending login transaction, code exchange, private
credentials, on-demand refresh and local logout. Application code constructs
provider URLs and controls navigation, registration, requested scopes and member
policy. There are no provider navigation callbacks or built-in vendor profiles.

Managed mode supports browser OIDC authorization code with S256 PKCE, query-mode
responses and public clients without a secret. It uses `oidc-client-ts` for the
protocol and JOSE for ID-token signature, issuer, audience, authorized-party,
subject and lifetime validation. State and nonce are checked against the retained
transaction. Supported signing algorithms are RS256, PS256 and ES256; ID-token
clock tolerance is 30 seconds. Token responses must provide a Bearer access
token with a positive lifetime; initial code completion must include an ID token. Client ID-token validation establishes only the
local login session; it cannot authorize an API request. Gateway independently
validates each API access token and scopes. Browser login success alone does not
prove API issuer/audience/scope compatibility.

The issuer must provide trusted OIDC discovery (including matching issuer and
JWKS), or application configuration must provide explicit metadata. Token and
key endpoints must allow the browser's requests. Direct cross-origin API calls
also require Gateway CORS and unauthenticated OPTIONS handling; the test fixture
uses an explicit preflight route alongside the authenticated ANY dispatch route.
The default CloudFront application/API path is same-origin. URLs require HTTPS except
localhost/127.0.0.1 development. Managed mode requires browser Web Crypto and
sessionStorage; it does not add React Native, SSR, popup or native redirect
support. JOSE is loaded only during managed token validation, so its encoder/crypto
initialization does not affect legacy imports. Importing the package and using
legacy/external mode requires neither
browser storage nor OIDC setup.

## Configuration and APIs

```ts
import {ClassifyClient} from 'aws-classify-client';

const client = new ClassifyClient(
    async () => sessionStorage.getItem('application-protected-session') || '',
    async id => { sessionStorage.setItem('application-protected-session', id); },
    '/api/dispatch',
    {
        managed: {
            issuer: 'https://issuer.example',
            clientId: 'registered-public-client',
            redirectUri: 'https://application.example/login-return',
            scopes: ['openid', 'example/invoke'],
            // storageKey: 'application',
            // transactionLifetimeSeconds: 600,
            // refreshLeewaySeconds: 30,
            // metadata: {
            //     issuer: 'https://issuer.example',
            //     authorization_endpoint: 'https://provider.example/authorize',
            //     token_endpoint: 'https://provider.example/token',
            //     jwks_uri: 'https://issuer.example/keys',
            //     end_session_endpoint: 'https://provider.example/logout',
            // },
        },
    },
);
```

The fourth argument accepts the original extendable
`ClientAuthenticationOptions` interface for external mode, or
`ManagedClientAuthenticationOptions` for managed mode. Both use the existing
public routing options and paired public-session callbacks. Configuring both
credential owners, or neither in an authentication-enabled client, fails at
construction. `ManagedAuthenticationOptions`, `AuthorizationRequest` and
`LocalLogoutResult` are exported by both client and common packages.

```ts
interface AuthorizationRequest {
    readonly authorizationEndpoint: string;
    readonly parameters: Readonly<Record<string, string>>;
}
interface LocalLogoutResult {
    readonly idTokenHint?: string;
}

const authorization = await client.beginLogin();
const loginUrl = new URL(authorization.authorizationEndpoint);
for (const [name, value] of Object.entries(authorization.parameters)) {
    loginUrl.searchParams.set(name, value);
}
// Add provider-specific optional parameters without replacing generated ones.
window.location.assign(loginUrl.href);

// Reconstruct the same configured client on the registered return page.
try {
    await client.completeLogin(window.location.href); // Promise<void>, no tokens
} finally {
    // Application owns history/navigation, including removing sensitive callbacks.
    history.replaceState(null, '', 'https://application.example/login-return');
}
```

`beginLogin()` cancels previous protected activity, clears the protected
application session and credentials, and creates one pending transaction with
random state/nonce and S256 challenge. It returns an immutable endpoint/parameter
request. Applications must preserve generated parameters and use that endpoint.
The opaque authorization code is exchanged using the retained verifier; callback
parameters cannot select the issuer or token endpoint.

`completeLogin(returnUrl)` accepts only the configured origin/path and fixed
redirect query parameters, rejects fragments/duplicate protocol parameters,
checks state, expiry and optional returned issuer, and consumes the pending
transaction before exchange. Failed, cancelled, expired and completed
transactions cannot be reused. Provider error callbacks also consume the
transaction. A callback failure leaves protected activity disabled. Starting a
new login is the explicit recovery path. Completion returns no credentials or
claims and starts with a fresh protected application-session ID.

## Persistence, reload, tabs and refresh

| Decision | Implemented behavior |
| --- | --- |
| Private storage | Tab-scoped sessionStorage; transaction and credentials separated from application session IDs. No localStorage/cookie token persistence or application token setters |
| Namespace | `storageKey` (default `default`) plus issuer, client ID, redirect URI and scopes. Reconstruct exactly the same options after navigation/reload |
| Reload | Pending transaction and credentials survive navigation/reload in the same tab; credentials disappear when its sessionStorage is discarded |
| Tabs | Independent tab lifecycles; logout is local to the tab. No cross-tab broadcast, global logout, shared refresh lock or credentials |
| Application sessions | Protected get/set callbacks must use separate tab-scoped storage; public-session callbacks must never share that storage. Default public sessions stay in client memory |
| Transaction | One pending transaction; ten-minute default, configurable 60–1800 seconds. A new begin cancels the preceding transaction |
| Refresh | On demand before protected calls and socket authorization; default 30-second leeway, configurable 0–300. No background timers or iframe login |
| Rotation | One in-flight refresh per tab/namespace; replace returned refresh token, retain previous token when omitted. Missing/invalid/expired refresh grants clear credentials and require login |
| Logout hint | `logout()` captures the ID token before deletion and returns it after successful cleanup, only for application provider logout URL construction |

Use one long-lived client per application/namespace. Instances in the same
JavaScript realm/namespace share cancellation and rotation; a lifecycle change
invalidates earlier clients' protected work. Reconstructing after an actual
reload naturally creates a new realm. Do not use multiple live instances as
independent authentication sessions with the same namespace.

Browser-created tabs with an opener can initially copy sessionStorage, including
credentials/transactions. Open independent application tabs with `noopener`.
Copied storage is independent afterward; local logout does not clear the copy.
Browser session restoration can also preserve sessionStorage. This is a storage
policy choice, not global provider sign-out. Same-origin script/XSS can read
browser credentials; “private” means absent from Classify's public session/state
and request serialization, not inaccessible to application-origin JavaScript.
There is no automatic persistence migration from an application's existing token
manager. Clear old protected session storage when opting into managed mode.

Expired access tokens without usable refresh credentials fail before protected
transport. Refresh failure throws `LoginRequiredError`; cancellation/account
change throws `AuthenticationChangedError`. Public calls omit Authorization and
continue to use their separate anonymous session. A refresh response may omit a
new ID token: Classify retains the previously validated login token/hint while
using the new access token's expiry. If a new ID token is issued, its signature,
claims and stable subject are checked before accepting refreshed credentials.

## Local logout and application provider logout

```ts
const {idTokenHint} = await client.logout();
// A standard provider URL may use id_token_hint/post_logout_redirect_uri.
const url = buildProviderLogoutUrl({idTokenHint, returnUrl: signedOutUrl});
window.location.assign(url);
```

For Cognito the application builds `/logout` using `client_id` and `logout_uri`;
its registered signed-out return URL displays the signed-out application and
performs no token exchange. Other providers can require an ID-token hint or
different registration/parameters. Treat the returned hint as a credential: do
not log or persist it in application state. Repeated local logout is safe and
returns no hint after credentials have been discarded.

Logout synchronously disables protected transport and invalidates pending work
before awaiting cleanup. It discards credentials and transactions, cancels
socket attachment/open waits, closes the current socket and clears only the
protected application session. It never navigates, revokes provider tokens or
clears the separate public session. Session saves are serialized: if a save is
already inside an asynchronous application callback, logout's clear runs after
it. Await logout before reusing external storage; a cleanup failure rejects
while protected activity remains disabled. A repeated logout retries cleanup.

Generation guards reject late login/refresh/HTTP results and prevent old socket
open/message/close events from invoking callbacks or reopening connections.
Public in-flight requests remain usable. Cancellation does not undo server work
already accepted or callbacks delivered before cancellation. Application session
callbacks must resolve only after their write completes; fire-and-forget writes
and caller changes outside Classify cannot be ordered by these guards.

External-token clients may also call `logout()` to cancel protected work, close
the socket and clear their application session; their application must separately
clear its own credentials. An external-token client remains disabled afterward:
construct a new client after the application's next login/account change.
Legacy authentication-disabled clients retain their previous behavior; invoking
an authentication lifecycle method without its required mode fails explicitly.

Local/provider browser logout does not revoke copied access or refresh tokens,
terminate other clients' sockets, or immediately revoke server sessions. Native
Gateway JWT validation can accept retained access tokens until expiry. Stronger
server revocation is separate policy and is not implemented here.

## Validation

The lifecycle protocol/race tests extend the existing harness with real local
OIDC token/JWKS requests, signed ID tokens, PKCE verification and controlled
asynchronous races. They validate the integration mechanics; the local provider
is not evidence of Cognito or Okta compatibility.

The disposable AWS harness now additionally uses real headless Chrome and
Cognito's browser login/code endpoint, OAuth refresh rotation and browser logout.
It runs protected/public calls and real sockets through direct Gateway and
CloudFront's default hostname. The fixture application builds navigation URLs
and removes callback parameters itself. No custom domains, production provider
resources, GitHub workflow, commit or publication are part of this work.

Final run results are recorded in section 15 of
[the feature request](FEATURE_REQUEST_AUTHENTICATION.md). Okta has not been
validated. Standards-based design is not a tested provider compatibility claim.

## References

- [oidc-client-ts protocol API](https://authts.github.io/oidc-client-ts/classes/OidcClient.html)
- [JOSE](https://github.com/panva/jose)
- [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)
- [OIDC discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [Cognito authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [Cognito logout endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
- [OIDC provider logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)
