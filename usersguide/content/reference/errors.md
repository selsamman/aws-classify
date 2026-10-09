---
title: Errors and troubleshooting
description: Distinguish member failures, gateway rejection, login expiry and notification transport errors.
---

Handle network calls with `try`/`catch`, then decide whether the user should retry,
sign in, correct input, or refresh state.

| Symptom | What to check |
| --- | --- |
| `Request class not registered` | Create the proxy through Classify and ensure the backend registers its implementation |
| Missing/unknown interface or method | Match static interface names and deployed request/response versions |
| A response method's error | Validate the input or apply the recovery appropriate to that application method |
| HTTP 401/403 | Gateway token signature, issuer, audience, expiry and route scopes |
| Protected/public method refused | Match client/server suffixes and use the correct fixed dispatch entry point |
| Session refused after enabling auth/account change | Clear the old protected session ID; legacy/unowned or another user's state cannot be adopted |
| Browser CORS error | Allow the frontend origin and headers; ensure OPTIONS is not captured by protected ANY dispatch |
| WebSocket send failure | Check session existence/expiry, active attachment and producer IAM |
| A callback URL returns 403 | Deploy that page or use the site's root; authenticated CloudFront does not rewrite API 403 responses into an SPA |

Framework/member exceptions retain the serialized response contract: the HTTP
response can be 200 while the proxy rejects the exception. Gateway rejection
happens before dispatch and is a separate HTTP error. Do not decide success only
from the HTTP status when bypassing the client library.

## Managed authentication errors

```ts
import {LoginRequiredError, AuthenticationChangedError} from 'aws-classify-client';

try {
    await counter.getCount();
} catch (error) {
    if (error instanceof LoginRequiredError) {
        // Offer the login button; do not silently send a public request.
    } else if (error instanceof AuthenticationChangedError) {
        // This work belongs to a cancelled login/session. Discard its result.
    } else {
        // Show an appropriate application error or retry option.
    }
}
```

Managed refresh failure clears credentials and requires a new login. Invalid,
expired or cancelled callback transactions cannot be reused. Start a new login
instead of retrying an old callback URL.

An unsuccessful `initSocket()` can return `false`; authorization and cancellation
can also reject. Handle both before enabling features that depend on notifications.
Use bounded reconnection/backoff rather than a tight retry loop.

## Local versus deployed behavior

Offline `--noAuth` is for functional development. It supplies no validated
identity or scope grants, and cannot prove IAM or provider compatibility.
Test protected/public behavior, browser login and socket attachment against the
actual deployed path, including CloudFront when you use it.

Browser logout closes this client's session and socket. It does not immediately
revoke a copied token at a native JWT authorizer. See
[authentication](../guides/authentication.md#log-out-locally-then-redirect) for that boundary.
