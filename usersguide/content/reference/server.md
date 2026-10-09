---
title: Server API
description: Register response methods, inspect trusted context and work with application sessions.
---

Import the singleton `classifyServerless` and framework handler exports from
`aws-classify-server`. Register your classes during module initialization.

## Response registration and dispatch

```ts
classifyServerless.registerResponse(ResponseClass, authorizationCallback?)
```

The response class extends its shared request class. Register it for serialization
with `serializable({ResponseClass})` from `js-freeze-dry`. Its persisted fields
hold application session state. Only exposed own request-prototype methods are
dispatchable; constructors, inherited Object methods and response-only helpers
are not public endpoints.

An optional asynchronous authorization callback receives
`(response, methodName, args, context?)` and returns a boolean. It is application
member policy, separate from Gateway's validation of the caller's token. Existing
three-argument callbacks still work.

| Export | Use |
| --- | --- |
| `responseHandler` | Original or protected HTTP dispatch |
| `publicResponseHandler` | Anonymous public dispatch in authenticated mode |
| `webSocketConnect` | `$connect` handshake |
| `webSocketDisconnect` | `$disconnect` cleanup |

Export handlers from the module named by `custom.directories.responseHandlers`.
That module must import and register the classes before handling requests.

## Trusted request context

```ts
const context = classifyServerless.getRequestContext(this);
```

Inside the authorization callback, `getRequestContext()` without a response
argument also works during invocation. Context is isolated per dispatch and
expires afterward; it does not belong in persisted response state.

| Field / method | Meaning |
| --- | --- |
| `dispatch` | `legacy`, `protected` or `public` |
| `offline` | Explicit offline development marker |
| `identity` | Validated issuer, subject, scopes and read-only claims; absent on public/offline requests |
| `hasScope(name)` | Checks the trusted granted scopes |

Default identity comes only from Gateway JWT-authorizer context. Another
compatible authorizer can use `configureAuthentication({identityAdapter})`; the adapter receives only Gateway's trusted authorizer
context. The application must configure an authorizer that really establishes
the identity. Client arguments, restored state and `setUserId()` are not identity
sources.

## Application session helpers

| Method | Use |
| --- | --- |
| `getSessionId(response)` | Read the current application session ID |
| `getUserId(response)` | Read its application-defined user association |
| `setUserId(response, userId)` | Set that association/index; does not establish identity or change authenticated ownership |
| `getSessionsForUserId(userId)` | Find associated session IDs |
| `setExpirationMinutes(minutes)` | Configure session expiration duration for framework saves |
| `deleteSessionsForUserId(userId)` | Delete associated application sessions |

The scan-based `getSessions()` and `deleteSessions()` helpers are intended for
tests/administration. Current scan/query helpers do not implement a complete
pagination traversal. Do not expose broad enumeration/deletion operations as
ordinary application members without appropriate application policy.

Authenticated ownership is the validated issuer/subject pair, separate from
application state. Missing, expired, unowned and other-principal sessions are
refused. DynamoDB TTL is background cleanup; authenticated checks enforce expiry
explicitly. Local browser logout clears its client session association and
credentials, not all server-side application rows.

Saved response fields are a session convenience, not transactional application
storage. Concurrent methods can update the same fields from different restored
snapshots; use your own database transactions for data needing stronger
concurrency guarantees.

## Notification helpers

```ts
classifyServerless.registerRequest(ClientRequestClass, classes?)
classifyServerless.createRequest(response, ClientRequestClass)
await classifyServerless.createRequestForSession(sessionId, ClientRequestClass)
await classifyServerless.createResponse(ResponseClass, sessionId, callback, classes?)
```

`registerRequest()` binds the notification methods. The first two creation helpers
send to the current or supplied session. `createResponse()` restores another
registered response object, runs the callback and persists its state, which is
useful when a notification also changes that session's application state.

Await notification methods. Missing/expired sessions, absent connections and
transport failures reject. Authenticated sends resolve the current connection
from the server-side session rather than trusting an old serialized connection.
An IAM-authorized background producer can use these helpers without a browser
token; choosing an allowed recipient remains application policy.

`configureAuthentication()` also accepts `connectionCredentialSeconds` (default
60, allowed 1–300), capped by application-session expiry. Every attachment
consumes one credential atomically. This protects socket attachment but does not
continuously revalidate a connected client's access token.

## Logging

Use `setLogger(callback)` and `setLogLevel(options)` for server diagnostics.
Keep application payload/response-state logging and Gateway full execution data
off when handling credentials or sensitive data. The deployment templates are
described in the [Serverless reference](serverless.md).
