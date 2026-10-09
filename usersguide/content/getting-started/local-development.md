---
title: Run locally
description: Understand the local HTTP, WebSocket and DynamoDB pieces and use the working chat example.
---

Local development uses the same request classes and response implementations.
Three services stand in for AWS: an HTTP/WebSocket gateway from Serverless
Offline, a local DynamoDB-compatible database, and your frontend development
server.

## Start with a working local environment

The [simple chat example](../examples.md) already coordinates these services.
Install from its root, then start the backend and web client together:

```bash
npm install
npm run dev --workspace cloud
```

The example starts Dynalite, creates the required table from the resolved
framework template, starts Serverless Offline and runs Vite. Its local database
is in memory: restarting the environment starts fresh application sessions.
See the example's README for its current Node and framework prerequisites.

For backend debugging:

```bash
npm run dev:debug --workspace cloud
```

Attach your debugger to port 9229. Restart the backend after response-code
changes; the frontend development server handles frontend reloads.

## Set up these pieces in your own project

Use the [copyable Serverless configuration](deployment.md), then supply a local
database and create the session table before starting Serverless Offline. The
`DOMAIN` environment variable is the session-table namespace. The local table
must be named `classifySessionStore.<DOMAIN>` and have the same keys/index as
`resources-dynamodb.yml`.

Set `DD_ENDPOINT` to your local database URL (for example,
`http://127.0.0.1:8000`) and `DD_REGION` to your development region before
starting the backend. Those values configure the framework's DynamoDB client.
Local SDK requests also need local dummy credentials, as supplied by the example's
startup scripts; do not point a local development setup at a production table.
Serverless Offline sets `IS_OFFLINE=true`; this is a local development switch.
The chat example is a useful reference for service startup, table creation,
shutdown and backend debugging scripts.

For a Vite frontend, proxy the relative API URL to the local backend:

```ts
// Add to your existing Vite configuration.
server: {
    proxy: {'/api': 'http://127.0.0.1:4000'},
}
```

The WebSocket URL comes from the backend's `$WebSocket.$authorize` operation.
Your frontend does not need to invent a second socket endpoint.

## Developing with authentication enabled

Start dual-route offline dispatch with `serverless offline --noAuth`. That lets
you work on protected/public routing and application behavior locally. It does
not give you a validated user identity or scope grants. Offline sessions carry
an explicit unvalidated ownership marker, and the managed browser login still
needs a real compatible provider when you exercise it.

Use real AWS/provider validation for authentication and IAM. The
[repository test guide](../repository/setup.md) explains the framework's own
offline and disposable AWS suites.

For a device's network addresses and session storage, see [mobile clients](../guides/mobile.md).
