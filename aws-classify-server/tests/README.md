# Running the tests

Use Node.js 20.19 or later (Node.js 22 is recommended). The test service uses
Serverless Framework 4, Serverless Offline 14, and the AWS Node.js 22 runtime.
The library packages do not require Serverless at runtime.

From the repository root:

```sh
npm run install:tests
npm test
```

Serverless Framework 4 requires its normal sign-in or a configured access/license
key. To sign in, run `npx serverless login` from
`aws-classify-server/tests/server`. No Java installation, global Serverless
installation, DynamoDB download, or real AWS credentials are needed for offline
requests. The harness supplies dummy AWS credentials to its subprocesses.

`npm test` runs the harness regression tests, then the browser client integration
suite. To run either separately:

```sh
npm --prefix aws-classify-server/tests/server run test:harness
npm --prefix aws-classify-server/tests/client test
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
npm --prefix aws-classify-server/tests/server start
# Or attach a debugger to port 9229:
npm --prefix aws-classify-server/tests/server run debug
```

Stop it with Ctrl-C before running the integration tests. The same startup and
shutdown code is used for both manual runs and Jest.

For tests against the deployed test service, set `WebsiteURL` to its website URL
and run `npm --prefix aws-classify-server/tests/client run test:online`. That suite
resets the deployed service's test sessions; deploy the fixture explicitly with
`npm --prefix aws-classify-server/tests/server run deploy` when needed.
