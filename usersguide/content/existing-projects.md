---
title: Add to an existing project
description: Adopt aws-classify incrementally without reorganizing your existing application.
---

You can keep your frontend, backend and directory names. Start with one request
class and one response implementation, then adopt the other features when you
need them. A project generator or a copy of the chat application is not required.

## Choose the pieces you need

| You already have… | Add… |
| --- | --- |
| A browser or React Native application | `aws-classify-client`, session-ID persistence and request proxies |
| A Serverless AWS backend | `aws-classify-server`, registered response classes, dispatch/socket handlers and a session table |
| Shared TypeScript code | Request classes and DTOs in that existing package |
| Separate frontend hosting | An API URL, CORS/preflight configuration and your existing deployment process |
| A token manager or authentication SDK | External `getAccessToken()` integration |
| A compatible browser OIDC provider | Optional managed login completion, refresh and local logout |

## Share your request classes

If you already have a private shared workspace, put your request classes there.
Otherwise add a small package such as `common/requests`, using
[the workspace setup](getting-started/project-layout.md). Import it by its
package name from every app that uses the contract.

Your bundler needs to consume its TypeScript entry. If it only accepts JavaScript
dependencies, give the shared package a build step:

```json
{
  "name": "@my-app/requests",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {"build": "tsc"}
}
```

Set that package's TypeScript `outDir` to `dist`, enable declaration output, and
build it before the client and backend. Choose a module format compatible with
your build tools. Keep its `aws-classify-common` dependency from the initial
workspace example. This solves shared imports through a package boundary; there
is no need to copy source files with bisync.

## Add one backend operation

Follow [the first-call example](getting-started/first-call.md) for the request,
response and registration. Export the framework handlers from a module that
imports and registers your response classes.

Merge the [Serverless configuration](getting-started/deployment.md) into your
existing service rather than replacing the entire file. Preserve your other
functions, plugins and resources. The required environment/configuration pieces
are described in the [Serverless reference](reference/serverless.md).

HTTP dispatch is at `/api/dispatch`; all registered members share that route.
For server-to-client notifications add the `$connect` and `$disconnect` handlers.
The stock functions include supplies all three, or four in authenticated mode.
If you configure HTTP-only functions manually, document that notifications are
not available and omit calls to `initSocket()`.

## Add the client where it belongs

Create one long-lived `ClassifyClient`, provide asynchronous get/set callbacks
for the application session ID, and create the request proxy. Keep calling your
other APIs normally; aws-classify does not take over your frontend routing,
application store or UI components.

For an already hosted frontend, use an absolute dispatch URL:

```ts
const client = new ClassifyClient(
    getSession,
    setSession,
    'https://YOUR-API.execute-api.YOUR-REGION.amazonaws.com/api/dispatch',
);
```

Configure API Gateway CORS for the allowed frontend origin and the headers you
send. In authenticated mode, provide an unauthenticated `OPTIONS /api/dispatch`
route if your authenticated `ANY` route captures preflight. The
[authentication chapter](guides/authentication.md) explains that case.

## Adopt authentication deliberately

The original mode is unauthenticated. If these calls need protection, opt into
the authenticated includes and either managed browser OIDC or an existing token
manager. Clear legacy session IDs during migration: authenticated mode will not
adopt old unowned application state. Existing roles and member permissions remain
your application's decisions.

Managed authentication supports browser APIs; it does not add native mobile
login. A React Native application can obtain tokens through its platform login
library and use the external-token integration.

## Test one step at a time

Make one client call, confirm session persistence, then add notifications and
authentication separately. Verify the actual API/CloudFront path you deploy.
Local offline calls are useful for application development but do not establish
that API Gateway authentication or AWS IAM is configured correctly.

For a full application to compare against, use the [chat example](examples.md).
