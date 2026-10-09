---
title: Work on aws-classify
description: Install, build and validate the framework repository itself.
---

This section is for changes to the framework. If you are building an application
with it, use [project setup](../getting-started/project-layout.md) or
[existing-project integration](../existing-projects.md).

## Install the repository

```bash
git clone https://github.com/selsamman/aws-classify.git
cd aws-classify
npm run install:tests
```

Use Node.js 20.19 or later. The root is a private npm workspace project linking
the three libraries and the test applications. `install:tests` installs the root
lockfile, prepares Serverless and builds the libraries. Test contracts are a
private workspace package, not copied source.

The guide is a standalone Docusaurus project with its own lockfile; installing
the framework does not install documentation dependencies.

## Build and check

```bash
npm run build
npm run typecheck
npm test
npm run audit
npm run test:packed
```

The libraries produce ES-module/CommonJS builds and declarations. The offline
suite includes original behavior, configuration and authentication lifecycle/race
checks. Packed-consumer checks install tarballs outside the workspace to catch
accidental dependence on repository-only aliases or files.

Run the local test backend with `npm start --workspace @aws-classify-tests/server`,
or `npm run debug --workspace @aws-classify-tests/server` for backend debugging.
See the [test README](https://github.com/selsamman/aws-classify/blob/master/tests/README.md)
for ports, prerequisites and focused commands.

## Validate against AWS

```bash
npm run test:aws
npm run test:aws -- --auth
```

These commands provision disposable resources, run acceptance cases through
Gateway and default CloudFront, and clean up. They need AWS credentials,
appropriate resource permissions and the normal Serverless configuration. The
authenticated runner also needs a supported local Chrome executable for its
real Cognito browser flow. Follow the test README before starting a deployment;
its manifests support cleanup after an interrupted run.

Offline behavior is not proof of Gateway authentication, IAM or provider
compatibility. Record actual deployed results separately. Existing implementation
decisions and validation records remain in
[`/docs`](https://github.com/selsamman/aws-classify/tree/master/docs).

## Test local framework changes in your application

Build and pack the source you want to evaluate:

```bash
npm run build
npm pack --workspace aws-classify-common
npm pack --workspace aws-classify-client
npm pack --workspace aws-classify-server
```

Install those three local tarballs in your application's root/workspaces so
internal framework dependencies resolve to the same evaluated builds. For a
one-off evaluation, install common in the shared requests workspace, client in
the frontend and server in the backend, and ensure npm's resolved common version
matches the local tarball. Inspect `npm ls aws-classify-common aws-classify-client
aws-classify-server` afterward. The repository's `test:packed` is a reference
for validating a consumer outside the source checkout.

## Contributing documentation

For package releases, follow [publishing the three packages together](releases.md).
One version command synchronizes the libraries and their internal dependencies;
one GitHub Release starts the publishing workflow.

Read [maintaining the guide](documentation.md). The public tutorial/reference
lives in `/usersguide`; architecture, security decisions and implementation
records live in `/docs`. Sample applications are maintained in separate
repositories, beginning with the chat example.
