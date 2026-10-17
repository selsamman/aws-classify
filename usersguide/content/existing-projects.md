---
title: Integrate with existing infrastructure
description: Advanced configuration for retaining separate frontend hosting or an existing Serverless service.
---

The easiest adoption path is to use the [complete tutorial configuration](getting-started/deployment.md)
and let the supplied templates and tools manage the API, sessions and website.
Where practical, replace overlapping hosting or API configuration with that setup
rather than maintaining two ways to provide the same resources. Keep unrelated
application resources and data.

Use this advanced section when you need to retain a specific part of your existing
infrastructure. Two common cases are a frontend already hosted elsewhere and an
existing Serverless Framework service containing other functions. Neither requires
a previous aws-classify deployment; having DNS records alone does not require
this integration path. Arbitrary AWS stacks need application-specific integration.

You can still reuse your UI and shared code with the tutorial deployment. A
project generator or a copy of the chat application is not required.

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

## Retain an existing Serverless service

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

## Retain separate frontend hosting

Create one long-lived `ClassifyClient`, provide asynchronous get/set callbacks
for the application session ID, and create the request proxy. Keep calling your
other APIs normally; aws-classify does not take over your frontend routing,
application store or UI components.

Omit the website resource include and `custom.bucketName` from the tutorial YAML.
Keep the dispatch/socket functions, environment settings, permissions and session
table. Use an absolute dispatch URL in the frontend:

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

### Deploy and remove without the supplied website

The tutorial scripts assume the supplied S3/CloudFront website. For separate
hosting, deploy only the backend from the project root:

```bash
npx aws-classify cloud deploy --config cloud/serverless.yml --stage dev
```

Leave out the frontend build and `--publish --source` arguments. Publish the
frontend through its existing hosting process. `aws-classify cloud publish`
requires the supplied `ContentBucket` and `CloudFrontId` stack outputs.

`aws-classify cloud remove` also requires `ContentBucket`, so it cannot remove
a backend-only stack. Install Serverless as a direct development dependency in `cloud`, then run its
removal command from that directory:

```bash
npm install --save-dev serverless@^4 --workspace cloud
cd cloud
npx serverless remove --config serverless.yml --stage dev
```

This removes the entire Serverless service. If you merged aws-classify into a
service with other functions, remove only its configuration/resources through
your existing deployment process when those other resources must remain.

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
