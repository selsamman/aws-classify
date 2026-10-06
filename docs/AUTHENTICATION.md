# Authentication and owned notification sessions

Authentication is opt-in. Existing three-argument `ClassifyClient` construction,
three-argument authorization callbacks, exports/subpaths, and the legacy
`functions.yml` and website templates remain supported. In the implemented
external-token mode, login, token storage and refresh belong to the application.
Roles, member permissions and production identity-provider resources remain
application-owned.

The [managed client lifecycle](CLIENT_AUTHENTICATION_LIFECYCLE.md), implemented
2026-10-06, provides optional `managed` configuration and `beginLogin()`,
`completeLogin(returnUrl)` and `logout()`. Classify owns OIDC code-with-S256-PKCE
transactions, private tab credentials, refresh and local cleanup; application
code constructs provider URLs and navigates. The external `getAccessToken()`
integration below remains available. See the lifecycle guide for configuration,
reload/tabs, failure handling, logout hints and validation results.

## Part 1: HTTP integration and trusted request context

Use the authenticated functions include instead of the legacy include. Export
`responseHandler`, `publicResponseHandler`, `webSocketConnect`, and
`webSocketDisconnect` from your application's response-handler module.

```yaml
custom:
  directories:
    responseHandlers: src/responses/index
  yml: node_modules/aws-classify-server/yml
  awsClassify:
    authorizer:
      name: applicationJwt
      scopes: [example/invoke, example/alternate] # optional
    publicSuffix: Public

provider:
  httpApi:
    authorizers:
      applicationJwt:
        type: jwt
        identitySource: $request.header.Authorization
        issuerUrl: ${env:OIDC_ISSUER_URL}
        audience: [${env:OIDC_AUDIENCE}]
  logs:
    websocket:
      fullExecutionData: false

functions:
  - ${file(${self:custom.yml}/functions-authenticated.yml)}
```

The include enables authentication on all four framework functions through
function environment variables. Its file resolver validates the authorizer
reference, optional scopes, public suffix, and socket logging before packaging.
A missing or undefined named authorizer fails configuration resolution; there
is no fallback to an open protected route. A suffix must match
`^[A-Za-z][A-Za-z0-9_]*$`; it is required on both client and server. Execution
tracing must stay disabled because handshake headers contain credentials.

The two fixed HTTP entry points share dispatch code:

| Handler | Route | Permitted members |
| --- | --- | --- |
| `responseHandler` | `ANY /api/dispatch` | Exposed methods without the suffix; protected by the supplied Gateway authorizer |
| `publicResponseHandler` | `ANY /api/dispatch/public` | Exposed methods ending with the suffix; no authorizer |

A method must be an own function on the registered request prototype.
`constructor`, inherited Object methods, and response-only methods are refused.
The fixed handler decides the category; URL query parameters and payload flags
cannot change it. `$WebSocket.$authorize` is an internal protected operation,
independent of the suffix. Public dispatch cannot invoke it.

API Gateway validates tokens. For JWT authorizers, the framework reads only
`requestContext.authorizer.jwt.claims` and `.scopes`; it never decodes a client
JWT to establish identity. Configure access-token audiences/issuers and route
scopes appropriate to your provider. Gateway scope requirements are **OR**:
at least one configured scope must match. All protected members share those
route requirements. Use application code for narrower or all-of policy.

AWS recommends requiring scopes to distinguish API access tokens from ID tokens;
a JWT authorizer by itself is not a general access-versus-ID-token discriminator.
See [AWS JWT authorizer behavior](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html).

```ts
const client = new ClassifyClient(getSession, setSession, '/api/dispatch', {
    publicSuffix: 'Public',
    getAccessToken: async () => applicationTokenManager.currentAccessToken(),
    // publicURL: '/api/dispatch/public', // derived from postURL by default
});
```

The optional fourth constructor argument enables client routing. The token
callback runs for every protected call, including socket authorization, and may
refresh the token. An absent token fails before transport. Public calls omit the
Authorization header and use a separate anonymous session, stored in client
memory by default. Supply both `getPublicSession` and `setPublicSession` to
persist it separately. These must not share the protected session storage.
Supply `publicURL` explicitly if a custom protected URL cannot derive its public
partner by appending `/public`.

```ts
classifyServerless.registerResponse(Response, async (_interface, method, args, context) => {
    return method !== 'specialAction' || !!context?.hasScope('example/special');
});

// Inside a response method:
const context = classifyServerless.getRequestContext(this);
const subject = context?.identity?.subject;
const issuer = context?.identity?.issuer;
const allowed = context?.hasScope('example/special');
```

`RequestContext` exposes `dispatch`, `offline`, `identity`, and `hasScope(name)`.
Identity contains `subject`, `issuer`, read-only `scopes`, and deeply frozen
validated `claims`. The optional fourth callback argument preserves existing
callbacks. `getRequestContext()` also works in an authorization callback during
its invocation. Response-object lookup is bound to the current invocation.
AsyncLocalStorage isolates overlapping requests; lookup expires when dispatch
finishes, even if application code retained an old response object. Context is
never added to serialized response state or session records. Public requests
always have no identity, including when callers supply a bearer token or
identity-looking payload fields.

For another compatible Gateway authorizer, define it under
`provider.httpApi.authorizers`, then configure an adapter during module setup:

```ts
classifyServerless.configureAuthentication({
    publicSuffix: 'Public',
    identityAdapter: authorizer => {
        const trusted = (authorizer as {lambda?: {subject: string, issuer: string, scopes: string[]}})?.lambda;
        return trusted && {
            subject: trusted.subject,
            issuer: trusted.issuer,
            scopes: trusted.scopes,
            claims: {},
        };
    },
});
```

The adapter receives only Gateway's trusted authorizer context, not request
arguments, headers, or persisted state. It must return a stable nonempty issuer
and subject plus string scopes. The named authorizer must actually establish
that identity. Protect direct Lambda invocation with IAM; a fabricated event
from an IAM-authorized invoker is outside the browser/Gateway trust boundary.

Framework refusal and member exceptions retain the serialized error contract.
Gateway authentication failures remain HTTP 401/403 before dispatch. Framework
HTTP responses carry `Cache-Control: no-store`.

For default CloudFront hosting, use `resources-website-authenticated.yml` instead
of `resources-website.yml`. Its API behavior uses AWS's managed CachingDisabled
and AllViewerExceptHostHeader policies: it forwards Authorization, cookies and
query strings, substitutes the origin Host, and caches neither successful API
responses nor API 403 errors. It preserves 403 status instead of rewriting it as
an SPA page. Static hosting uses the existing cache policy. Legacy website
includes are unchanged. Applications maintaining their own distributions must
apply equivalent API behavior. No custom-domain acceptance is claimed here.

## Part 2: session ownership and socket credentials

Protected sessions store a separate `authOwner` equal to the unambiguous JSON
pair `[issuer, subject]`. Public sessions store the category `public`. These
metadata live outside interface state. `setUserId()` still manages an application
association/index and cannot alter ownership. Before restoring protected state,
the framework requires the current principal's ownership and an unexpired
session, using a strongly consistent read. Saves condition on that owner and
expiry so deletion/expiry cannot silently resurrect protected state.

Existing unowned, missing, expired, other-principal, and public sessions cannot
be reused as protected sessions. When enabling authentication or switching users,
clear the stored protected session ID and let an empty ID create a fresh owned
session. There is no automatic claim or migration of legacy state. Anonymous
calls cannot read a protected session's interface state. Session TTL is storage
cleanup; all authenticated authorization checks explicitly enforce expiry.

`initSocket()` makes the protected `$WebSocket.$authorize` request with a current
access token. In authenticated mode it returns a `SocketAuthorization` object:
`{url, credential, expiresAt}` plus the owned session ID. Legacy mode retains its
URL-string response and session-ID handshake.

The authenticated protocol is `ac1.<base64url session UUID>.<256-bit random secret>`
in `Sec-WebSocket-Protocol`, echoed by `$connect`. It is not a bearer token or a
reusable session capability. The server stores only its SHA-256 hash and epoch
expiry against the owned session. Default validity is 60 seconds, capped by the
session's expiry. Module setup may set `connectionCredentialSeconds` from 1 to
300 through `configureAuthentication`; the test fixture uses 10 seconds.

Issuance replaces any outstanding credential for that session. `$connect`
validates syntax and session binding, and uses one DynamoDB transaction to
condition on owner, hash, credential expiry and session expiry, remove the
credential, record the current connection, and create a reverse connection
mapping. Expired, wrong-session, replaced, or replayed credentials fail. Two
simultaneous attempts with one credential have one winner. Connection metadata
uses the existing session table and TTL; no new production identity resources
are created. Existing PutItem/UpdateItem permissions authorize these transaction
operations; the deployed tests exercise the real IAM path.

Close the old client socket and call `initSocket()` again to obtain a fresh
credential for the same eligible session. A successful later attachment becomes
the current notification destination. An older connection may remain physically
open; notification sends resolve the current server-side connection instead of
using a stale connection serialized in interface state. In-flight sends can
race replacement; both attachments belong to the same principal. Old disconnects
cannot clear a replacement connection because cleanup conditions on connection
ID. Disconnect delivery and TTL cleanup are best effort; a missing connection
or Gateway transport failure is propagated to the notification producer.

Authentication is checked when issuing a connection credential. It is not
continuous token validation: an established socket is not automatically closed
on token expiry or provider revocation. Managed `logout()` closes the current browser socket and clears its protected
session; `beginLogin()` also clears it for account changes. External-token
applications must separately manage their credentials and use local logout or
equivalent cleanup.
Every protected HTTP call and reconnect requires a Gateway-valid token. Native
JWT validation does not check Cognito revocation, so a retained access token can
remain usable until expiry, including to obtain another socket credential.
Clearing a browser's credentials and closing its socket is local logout; it is
not remote token invalidation. The client provides formal local `logout()` cleanup. Applications
requiring immediate revocation/disconnection need an additional server-side
revocation policy. Do not enable execution tracing or log bearer tokens or
connection protocols in application/Gateway diagnostics.

Trusted background code can still call `createRequestForSession(sessionId,
RequestClass)` or `createResponse(ResponseClass, sessionId, callback)`. It needs
IAM and a trusted session ID, not a browser token in workflow state. These helpers
refuse public, unowned and expired notification sessions; notification requests
and sends also require a current connection. They do
not invent request identity for a background producer. Application permission
to target another session remains application policy; do not expose unrestricted
notification helpers as browser-callable members.

## Development, migration, and review

Run `serverless offline --noAuth` for dual-route functionality. Only the explicit
`IS_OFFLINE=true` development environment permits protected dispatch without
Gateway identity, marked `offline` with no identity/scopes and a separate
unvalidated ownership marker. No Cognito emulator or JWT verifier is provided.
Never set that environment variable on deployed authentication functions.

Review HTTP integration in `Authentication.ts` (common/server), client options,
context-bound dispatch, the configuration resolver, and the authenticated
functions/CloudFront includes. Review ownership/socket work in
`AuthenticatedSessions.ts`, session save conditions, socket entry points, client
handshake/reconnection changes, and live notification destination lookup.
`tests/client/auth.unit.test.ts`, `auth-offline/`, and `tests/server/auth-test.js`
cover both parts while retaining the existing harness and behavior suite.

Run `npm test`, `npm run typecheck`, `npm run audit`, and `npm run test:packed`.
`npm run test:aws` validates legacy deployed behavior;
`npm run test:aws -- --auth` validates the authenticated fixture directly and
through default CloudFront. The latter provisions temporary Cognito pools,
clients, users, custom test scopes and a default Cognito OAuth domain. It waits
for a genuine five-minute token to expire, refreshes other test tokens, and
cleans up the owned stack and bucket. See [test runner instructions](../tests/README.md)
and [the acceptance record](FEATURE_REQUEST_AUTHENTICATION.md) for actual results.
