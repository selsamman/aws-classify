---
title: Run locally
description: Configure and run the local HTTP, WebSocket, DynamoDB and frontend services.
---

Local development uses the same request classes and response implementations.
Three services stand in for AWS: an HTTP/WebSocket gateway from Serverless
Offline, a local DynamoDB-compatible database, and your frontend development
server.

## Prerequisite: configure the cloud service

Before starting your own project locally, save the [Serverless configuration](deployment.md)
as `cloud/serverless.yml` and add its root `package.json` scripts. The offline
command resolves that file to find your handlers and session-table definition;
it cannot start from request and response code alone. Complete Serverless v4
sign-in (or configure `SERVERLESS_ACCESS_KEY`) before running the commands;
Serverless configuration resolution is also used locally. Real AWS credentials
are needed for deployment, while the local backend uses dummy credentials.

## Start with a working local environment

The [simple chat example](../examples.md) already coordinates these services.
Install from its root, then start the backend and web client together:

```bash
npm install
npm run cloud:offline
```

The example starts Dynalite, creates the required table from the resolved
framework template, starts Serverless Offline and runs Vite. Its local database
is in memory: restarting the environment starts fresh application sessions.
See the example's README for its current Node and framework prerequisites.

For backend debugging:

```bash
npm run cloud:offline:debug
```

Attach your debugger to port 9229. Restart the backend after response-code
changes; the frontend development server handles frontend reloads.

## Run your own project

`aws-classify cloud offline` starts Dynalite, resolves the session-table
definition from Serverless, creates that local table, starts Serverless Offline,
and starts Vite when given `--web web`. It supplies local DynamoDB credentials
and endpoint settings; it never points the local backend at a production table.

Use `npm run cloud:offline:backend` when you want only the backend, including
when your frontend uses tooling other than Vite. `--web web` specifically requires
Vite installed in that workspace. Serverless Offline sets `IS_OFFLINE=true`;
this is a local development switch.

Normal offline startup initializes the database automatically. The separate
`npm run cloud:db:init` command only creates/checks the table: it requires an
already running DynamoDB-compatible service at `http://127.0.0.1:4567`. It does
not start that service. The bundled offline runner uses in-memory Dynalite, so
restarting it clears local sessions.

Before starting a Vite frontend, set its port and proxy the relative API URL
to the local backend. The tools wait for Vite on port 3000:

```ts
// Add to your existing Vite configuration.
server: {
    port: 3000,
    strictPort: true,
    proxy: {'/api': 'http://127.0.0.1:4000'},
}
```

Then run `npm run cloud:offline` from the project root and open
`http://127.0.0.1:3000`.

The WebSocket URL comes from the backend's `$WebSocket.$authorize` operation.
Your frontend does not need to invent a second socket endpoint.

## Developing with authentication enabled

First complete the [authenticated backend setup](../guides/authentication.md),
including the `publicResponseHandler` export. Save a local copy of that
configuration as `cloud/serverless-offline.yml`. In its existing
`custom.serverless-offline` section, add `noAuth: true`; keep all the other
local port/environment settings. This bypasses Gateway authorizers for local
functional testing. Keep this setting in the local configuration.

Set `OIDC_ISSUER_URL` and `OIDC_AUDIENCE` in your shell before starting locally
as well as for deployment. Routing-only development can use placeholder values
such as `https://example.invalid` and `local-api`; browser login needs real
provider configuration. Then run from the project root:

```bash
npx aws-classify cloud offline --config cloud/serverless-offline.yml --web web
```

This starts the database, initializes the table and supplies the local backend
environment. The tools do not forward `--noAuth` to Serverless; use the local
YAML setting above.

For routing-only work without a provider, create a local-only external-token
client using the session callbacks from the tutorial:

```ts
const client = new ClassifyClient(getSession, setSession, '/api/dispatch', {
    getAccessToken: async () => 'offline-development',
});
```

Import `ClassifyClient` as in the tutorial. Mark public methods on the shared
request class as described in [contracts](../reference/contracts.md#public-and-protected-members).
The client still requires a nonempty token for protected calls, but the local
`noAuth` configuration does not validate this placeholder. Use this client only
with the local backend; deployed protected calls need real access tokens.

You can work on protected/public routing locally. It does
not give you a validated user identity or scope grants. Offline sessions carry
an explicit unvalidated ownership marker, and the managed browser login still
needs a real compatible provider when you exercise it.

Use real AWS/provider validation for authentication and IAM. The
[repository test guide](../repository/setup.md) explains the framework's own
offline and disposable AWS suites.

For a device's network addresses and session storage, see [mobile clients](../guides/mobile.md).
