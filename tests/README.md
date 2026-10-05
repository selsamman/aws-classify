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
not require Serverless sign-in. It also checks malformed/incomplete resolved
configuration and database startup failure. AWS-runner regression tests verify
cleanup ownership guards and correct handling of retained deleted-stack records.

For a manually running offline backend:

```sh
npm start --workspace @aws-classify-tests/server
# Or attach a debugger to port 9229:
npm run debug --workspace @aws-classify-tests/server
```

Stop it with Ctrl-C before running the integration tests. The same startup and
shutdown code is used for both manual runs and Jest.

## Coverage

The default suite covers session persistence and isolation, multiple interfaces,
registered-class serialization, malformed/unknown requests, member failures and
recovery, authorization-hook denial, user-index reassignment and deletion,
callback routing, missing recipients/connections, and socket close/reconnect.
Each behavior test resets its own fixture data; callback waits have deadlines
and sockets close after failures as well as success. Index assertions poll reads
for up to ten seconds to accommodate real DynamoDB consistency.

Focused unit tests cover transport and database failures, callback send errors,
authorization denial before invocation/database access, expiry timestamps, and
socket initialization failure/retry. These use controlled mocks; they do not
validate AWS authentication. To run only these checks without starting services:

```sh
npm run test:unit --workspace @aws-classify-tests/client
```

## Disposable AWS validation

From the repository root:

```sh
npm run test:aws
# Optional personal prefix, AWS profile and region:
npm run test:aws -- --suffix sam --profile review --region us-east-1
```

This requires working AWS credentials and the normal Serverless 4 sign-in.
The AWS CLI is not required: the runner uses the AWS SDK's credential chain.
`--suffix` accepts a 1–10 character lowercase prefix starting with a letter.
Every run adds a timestamp and random component, producing a service such as
`aws-classify-tests-sam-<run-id>`. Concurrent reviewers can use the same profile
or prefix: stacks, tables, content buckets and deployment buckets remain unique.
The default region is `AWS_REGION`, or `us-east-1` when it is unset; stage is `dev`.

The command builds the libraries, reports its AWS caller identity, creates a
private deployment bucket, packages and checks IAM, deploys the fixture, uploads
static content, and runs the same 23 behavior cases through direct API Gateway
and default CloudFront. Both runs use real WebSockets. It also verifies the
uploaded website, configured DynamoDB TTL and saved expiry values. It does not
wait for TTL deletion. No custom domain, hosted zone or certificate is required.

The fixture incurs normal AWS charges while it exists. Creating/removing it
requires permissions for its CloudFormation, IAM, Lambda, API Gateway, DynamoDB,
S3 and CloudFront resources; diagnostics also read CloudWatch logs. API Gateway's
account-level logging role may require Serverless's account setup permissions.
The test creates synthetic data only and deletes it afterward.

Results, revision information, stack outputs/events and Lambda diagnostics are
saved under `.test-results/aws/<service>/`. The runner empties its content bucket
and removes its owned stack and deployment bucket in a finally path, including
after partial deployment or Ctrl-C. It refuses to reuse an existing stack or
remove resources from a different recorded account. Cleanup failures fail the
command independently of test results and print a recovery command:

```sh
npm run test:aws -- --cleanup /absolute/path/to/.test-results/aws/<service>/run.json
```

A forced process kill or machine shutdown cannot run cleanup; use that command
with the saved report. The runner keeps its artifacts bucket if stack deletion
fails so recovery can inspect/retry the deployment. Serverless may create shared
account-level infrastructure (for example, an API Gateway logging role); the
runner does not delete shared resources used by other services.

To target an already deployed **test fixture** explicitly:

```sh
TestAPIURL=https://<api-id>.execute-api.<region>.amazonaws.com/api/dispatch \
  npm run test:online --workspace @aws-classify-tests/client
# Or WebsiteURL=https://<distribution>.cloudfront.net
```

This manual command resets that fixture's sessions. It does not deploy or remove
resources. Never point it at an application or production table. The default
AWS command always creates a disposable fixture instead.

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

## Planned test and authentication work

The [authentication feature request](../docs/FEATURE_REQUEST_AUTHENTICATION.md)
records the baseline test/deployment work and the planned provider-neutral
authentication and secure WebSocket support. Authentication remains follow-up
work; the current fixture exercises the existing session protocol.
