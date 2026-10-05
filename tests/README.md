# Running the tests

Use Node.js 20.19 or later (Node.js 22 is recommended). The test service uses
Serverless Framework 4, Serverless Offline 14, and the AWS Node.js 22 runtime.
The library packages do not require Serverless at runtime.

From the repository root:

```sh
npm run install:tests
npm test
```

The repository uses npm workspaces and one root lockfile. The client, server,
and shared request fixtures are private packages. They import the local library
packages directly; no test sources are copied or synchronized. The installation
command installs all workspaces, prepares the Serverless executable, and builds
the libraries. Test and offline commands rebuild the
libraries before using them, so edits to library sources are included.

Serverless Framework 4 requires its normal sign-in or a configured access/license
key. To sign in, run `npx serverless login` from
`tests/server`. No Java installation, global Serverless
installation, DynamoDB download, or real AWS credentials are needed for offline
requests. The harness supplies dummy AWS credentials to its subprocesses.

`npm test` runs the harness regression tests and the browser client integration
suite. The client suite uses Jest 30.
To run the harness or integration tests separately:

```sh
npm run test:harness --workspace @aws-classify-tests/server
npm test --workspace @aws-classify-tests/client
npm run typecheck
```

The integration setup starts an in-memory Dynalite database on port 8000 and
creates the session table, including its `userId` index, from the shared
CloudFormation template resolved by `serverless print`. It then starts the
project-local Serverless executable. The HTTP, WebSocket, and Lambda invocation
listeners use ports 4000, 3001, and 3002. All ports must be free before startup.
Services bind to `127.0.0.1`.

Startup checks the actual listeners rather than Serverless log wording, with a
60-second deadline. Startup failures fail the test run and clean up services.
Teardown signals each owned process group, waits for shutdown, and forces
termination after five seconds if necessary. Tests close their client WebSockets
before service teardown. Local session data is discarded on each run.

The harness regression suite uses real Dynalite and a small fake Serverless
executable to exercise startup errors, partial startup, timeouts, cancellation,
occupied ports, restart, and termination of unresponsive subprocesses. It does
not require Serverless sign-in.

For a manually running offline backend:

```sh
npm start --workspace @aws-classify-tests/server
# Or attach a debugger to port 9229:
npm run debug --workspace @aws-classify-tests/server
```

Stop it with Ctrl-C before running the integration tests. The same startup and
shutdown code is used for both manual runs and Jest.

For tests against the deployed test service, set `WebsiteURL` to its website URL
and run `npm run test:online --workspace @aws-classify-tests/client`. That suite
resets the deployed service's test sessions; deploy the fixture explicitly with
`npm run deploy --workspace @aws-classify-tests/server` when needed.

## Security checks

From the repository root, run:

```sh
npm run audit
```

This audits the consolidated root lockfile, including the libraries, test
workspaces, and root tooling. It returns a failing exit code when an audit finds
an advisory or encounters an error.

The AWS SDK and Axios dependency minimums now match the reviewed, updated
versions. The updated server library requires Node.js 20 or later. The unused
`aws-lambda` deployment tool was removed; `@types/aws-lambda` supplies the types
used by this code.

Jest 30 and TypeScript ESLint 8 remove the vulnerable `braces` dependency from
the test and lint tools.
