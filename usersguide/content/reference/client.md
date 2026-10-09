---
title: Client API
description: ClassifyClient construction, calls, notifications and authentication options.
---

Import `ClassifyClient` from `aws-classify-client`. Create one long-lived instance
for your application session and authentication namespace.

## Construction and request proxies

```ts
new ClassifyClient(getSession, setSession, postURL?, authentication?)
client.createRequest(RequestClass, classes?)
```

| Argument | Meaning |
| --- | --- |
| `getSession` | `() => Promise<string>`; returns the application session ID or `''` for a new session |
| `setSession` | `(id: string) => Promise<void>`; persists the returned ID and resolves after the write completes |
| `postURL` | Dispatch URL; defaults to `/api/dispatch` |
| `authentication` | Optional external-token or managed options; omit for the original unauthenticated mode |
| `classes` | Serialization class map when your payloads contain custom classes |

`createRequest()` returns an instance whose own request-prototype methods call
the backend. The shared class needs a unique static `interfaceName`. Requests
resolve to the returned data; framework/member failures reject with an error.
An ID in your persistence callback is application state association, not proof
of authentication.

## Notifications

| Method | Behavior |
| --- | --- |
| `createResponse(ResponseClass)` | Registers client callback methods from a class extending the shared client request class |
| `initSocket(classes?)` | Authorizes and opens the socket; returns `Promise<boolean>`. Authorization/cancellation errors can reject |
| `onConnect(callback)` | Sets the callback for a successful open |
| `onDisconnect(callback)` | Sets the callback for the current connection closing |
| `setListener(callback)` | Receives response cargo when provided by the backend |

Register client response methods before `initSocket()`. Repeated initialization
does not open another socket while one is active/requested. Failed initialization
permits a later retry. Notification callback return values are not sent back to
the server; the server receives the result of sending to API Gateway, not an
acknowledgment that the browser completed its callback. Handle callback errors in
your client implementation.

For a manual disconnect, close `client.socket` if present. Local authenticated
logout also closes it and invalidates pending socket work. Follow
[the notification chapter](../guides/notifications.md) for reconnection.

## Shared authentication routing

Both authenticated modes accept:

| Option | Meaning |
| --- | --- |
| `publicSuffix` | Required nonempty identifier suffix; must match server configuration |
| `publicURL` | Optional public dispatch URL; defaults to protected URL plus `/public` |
| `getPublicSession`, `setPublicSession` | Optional paired callbacks for separate anonymous session persistence |

Public calls are identified by the exposed method suffix. They omit Authorization
and use an independent session, in client-local memory unless those callbacks
are supplied. Never share protected and public session storage.

## External-token mode

`ClientAuthenticationOptions` adds `getAccessToken`, a synchronous or asynchronous
function returning `string | undefined`. Classify calls it for every protected
request, including socket authorization. Your token manager handles login,
refresh, persistence and credential disposal. An absent token fails before
transport. Do not configure `managed` at the same time.

## Managed browser mode

`ManagedClientAuthenticationOptions` adds a `managed` object:

| Option | Default / requirements |
| --- | --- |
| `issuer` | Required trusted HTTPS OIDC issuer |
| `clientId` | Required registered public-client ID |
| `redirectUri` | Required exact registered return URL; HTTPS except localhost development |
| `scopes` | Required array including `openid` and your requested API scopes |
| `storageKey` | `default`; distinguishes applications/namespaces on the same origin |
| `transactionLifetimeSeconds` | `600`; allowed range 60–1800 |
| `refreshLeewaySeconds` | `30`; allowed range 0–300 |
| `metadata` | Optional explicit issuer/authorization/token/JWKS metadata instead of discovery; optional end-session endpoint |

Managed mode needs browser Web Crypto and `sessionStorage`. It supports OIDC code
with S256 PKCE and query responses. It does not implement native mobile/SSR/popup
login. HTTPS endpoint checks, state/nonce and ID-token validation protect login
completion; API Gateway independently validates access tokens for API operations.

| Method | Return value and behavior |
| --- | --- |
| `beginLogin()` | `Promise<AuthorizationRequest>`; starts a pending transaction, clears previous protected activity/session and returns immutable endpoint/parameters |
| `completeLogin(returnUrl)` | `Promise<void>`; consumes and validates the transaction, exchanges the code and saves private credentials |
| `logout()` | `Promise<LocalLogoutResult>`; performs local cleanup without navigation; returns an optional `idTokenHint` for provider logout |

`AuthorizationRequest` contains `authorizationEndpoint` and a read-only string
`parameters` map. Application code preserves those generated parameters and
performs navigation. `LocalLogoutResult.idTokenHint` is a credential: use it only
to construct provider logout, and do not log it.

Transactions and credentials survive same-tab reload/navigation. Namespace
configuration must be identical after return. Refresh is on demand; one in-flight
refresh per tab/namespace handles rotating tokens. Public calls never need it.
No cross-tab/global logout is provided. A browser can copy sessionStorage when
opening a tab with an opener; use independent/noopener tabs when you need separate
sessions. Browser restoration and same-origin script access follow normal
sessionStorage behavior.

Both managed and external clients can use local `logout()`. External clients
still need their own credential cleanup and a new instance after the next login.
Authentication-disabled clients reject lifecycle operations requiring an enabled
mode. Managed `beginLogin()` and `completeLogin()` require managed mode.

See [browser login](../guides/authentication.md) for complete navigation examples
and [errors](errors.md) for login-required/cancellation handling.

## Logging

`setLogger(callback)` replaces the client logger. `setLogLevel(options)` enables
individual logging fields such as `calls`, `exceptions` and `data`. Payload logging
can contain application data; keep it off where data is sensitive. Token and
socket credentials must not be added to application diagnostics.
