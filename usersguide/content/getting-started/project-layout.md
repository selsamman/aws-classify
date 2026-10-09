---
title: Set up your project
description: Share request classes with private npm workspaces, without copying source files.
---

Let's give the client and backend a shared vocabulary. You can follow this
layout for a new application, or jump to [existing projects](../existing-projects.md)
if your directories are already in place.

## Choose your directories

The [chat example](../examples.md) keeps the apps at the repository root:

```text
my-app/
  package.json
  package-lock.json
  common/
    requests/
      package.json
      index.ts
  cloud/
    package.json
    serverless.yml
    src/responses/
  web/
    package.json
    src/
  mobile/                 # include when you have a mobile app
    package.json
```

`cloud`, `web` and `mobile` each have their own dependencies and scripts. Listing
them as npm workspaces gives you one root installation and lockfile. The shared
requests package is linked into each app automatically; no source synchronization
or package publication is needed.

```json title="package.json"
{
  "name": "my-classify-app",
  "private": true,
  "workspaces": ["cloud", "web", "common/requests"]
}
```

Add `"mobile"` when that directory exists. Start with your preferred web or Expo
application tooling; aws-classify does not prescribe a UI framework.

## Create the shared package

```json title="common/requests/package.json"
{
  "name": "@my-app/requests",
  "version": "0.1.0",
  "private": true,
  "main": "./index.ts",
  "types": "./index.ts",
  "dependencies": {
    "aws-classify-common": "^0.2.0"
  }
}
```

`private: true` means this package is not published to npm. It can still be
imported by your applications. The source entry is convenient when the frontend
and backend build tools handle workspace TypeScript, as Vite, Expo and the chat
example's backend do. If your existing build cannot consume TypeScript outside
its source directory, compile this workspace and point `main` and `types` at the
output instead. See [integrating shared code](../existing-projects.md#share-your-request-classes).

Put request classes and shared data models here. Keep Lambda response
implementations in `cloud`, and client response implementations in `web` or
`mobile`. Both sides import the same request classes, without bundling each
other's implementations.

## Install the libraries

Give each app a `package.json` with a name and `private: true`, then run these
commands from the repository root:

```bash
npm install aws-classify-server js-freeze-dry --workspace cloud
npm install aws-classify-client --workspace web
npm install @my-app/requests@0.1.0 --workspace cloud --workspace web
npm install --save-dev typescript serverless@4 serverless-offline --workspace cloud
```

The matching private package is resolved from your workspace. The `web` package
keeps whatever UI and build dependencies your application already uses. For a
mobile workspace, install `aws-classify-client` and `@my-app/requests@0.1.0`
there too.

Use a supported Node.js release for your selected frontend/backend tools. The
framework repository uses Node 20.19 or later; the chat example's mobile toolchain
has its own requirements, documented in that example.

You are ready to [make your first call](first-call.md).
