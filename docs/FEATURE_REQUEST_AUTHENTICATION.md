# Feature request: OIDC authentication and test validation

Status: Stage 1 baseline test expansion and AWS validation implemented; Stage 2
authentication remains planned. Exact authentication APIs and the open decisions
below must be settled during implementation.

Recorded: 2026-10-05. Repository baseline: `861098f`.

This document carries the requirements and decisions from the project revival
discussion into subsequent implementation sessions. It is self-contained for
the aws-classify work. GramSurfer is a consuming use case, not the source of
framework-specific role or scope policy.

## 1. Scope and implementation order

The approved work has two stages:

1. Establish better offline coverage and a separate deployment-required test
   command for the existing framework.
2. Add provider-neutral authentication integration, scope support, public and
   authenticated dispatch, and secure WebSocket attachment. Implement the
   deployed authentication tests alongside these features.

Complete the framework work before GramSurfer depends on it. Separate commits
or PRs should make the baseline test work and functional enhancements reviewable
independently. One session need not implement the entire feature.

The originating architecture is
`../gramsurfer-backend/docs/TECHNICAL_ARCHITECTURE.md`, relative to the repository
root, revised 2026-10-04. Sections 6.3.1–6.3.5 provide the framework requirements;
sections 14, 22, and 23 explain completion notifications, security boundaries,
and deployment. The relevant requirements are recorded below rather than
requiring access to that sibling repository or this chat.

Out of scope:

- GramSurfer broadcaster/admin mapping, ownership rules, and final scope names
  or policies. These belong to the consuming application.
- GramSurfer's S3 authorization, presigned uploads, encoding, scheduling,
  Step Functions implementation, and other application features.
- Production Cognito provisioning, login UI, password management, token
  issuance, and token refresh implementation inside aws-classify.
- JWT signature verification or a Cognito emulator inside aws-classify.
- Custom-domain testing, Route 53 setup, and custom ACM certificates.
- GitHub deployment workflows and GitHub-to-AWS OIDC setup; these can follow
  later. Initially maintainers and PR reviewers run AWS tests locally.
- The planned Docusaurus migration and separate client/server README content.

## 2. Existing baseline and discoveries

The following bullets describe the starting baseline. Stage 1 now provides 12
local harness regressions, four AWS-runner cleanup/ownership regressions, 12
focused unit checks, and 23 independent behavior cases (51 default checks).
The behavior cases also passed against real AWS in `us-east-1`, both directly
and through default CloudFront, on 2026-10-05. Static content, callbacks, IAM and
TTL/expiry checks passed. The initial runner needed a completed-deletion status
fix; saved-manifest recovery successfully removed the owned stack and deployment
bucket. Recovery and deleted-stack detection have regression coverage.

Stage 1 corrected the fixture's unawaited callback and added the missing
`dynamodb:DeleteItem` permission. Failure tests also found that client socket
initialization kept its in-flight flag set after authorization/open failure;
`initSocket()` now releases it in a finally block so another attempt can retry.
That is the only client runtime change in this baseline work. Session ownership
and OIDC/socket credentials are still Stage 2 work.

The runner and usage/recovery instructions are in `tests/server/aws-test.js` and
`tests/README.md`. AWS run reports are local ignored artifacts under
`.test-results/aws/`; no credentials or environment snapshots are stored.


- The repository uses one root npm lockfile and private client/server/request
  test workspaces under `tests/`. Tests consume the actual local libraries.
- `aws-classify-common` supplies shared definitions. Compatibility re-exports
  preserve old client/server common subpaths. Bisync now mirrors README files
  only; it has no role in source code or tests.
- Node.js 20.19+ is required for the workspace; Node.js 22 is recommended. The
  test service uses Serverless Framework 4 and Serverless Offline 14.
- The last completed validation passed nine offline harness tests and five
  client integration tests, library builds, typechecks, packaged consumer
  checks, and a zero-vulnerability audit. Re-run checks when implementing.
- The harness already checks startup failure, partial startup, timeout,
  cancellation, occupied ports, restart, and termination of stubborn process
  groups. Preserve these protections.
- Existing integration tests mostly cover successful HTTP calls, persisted
  counts, same-client and cross-client callbacks, session isolation, user index
  queries, and deletion. A global session count makes them order-dependent.
- The fixture's `ServerResponse.sendCount()` does not await its callback send.
  Fix this fixture issue so failures propagate and Lambda completion does not
  leave an unfinished send.
- The explicit policy in `aws-classify-server/yml/provider-iam.yml` omits
  `dynamodb:DeleteItem`, although the session deletion helpers use it. Check
  the generated deployed policy, and include the permissions required by the
  supported operations. Offline success does not prove IAM correctness.
- The current dispatch authorizer callback receives interface/method/arguments,
  without a validated identity context. The HTTP definitions attach no Gateway
  authorizer. The client does not supply an authentication token.
- `ClassifyClient.initSocket()` first makes an HTTP `$WebSocket.$authorize`
  request. That returns an existing or new application session ID and the
  WebSocket URL. `$connect` accepts the ID in `Sec-WebSocket-Protocol`, checks
  for a database record, and saves the connection ID.
- That session ID associates saved application state with a connection. It can
  reconnect to surviving state after a socket disconnect, but does not restore
  deleted state. Currently possession of an existing ID is sufficient to attach;
  there is no authenticated owner check or separate connection credential.
- Full Serverless packaging/deployment has not been validated against AWS.
  Earlier local handler bundling passed; packaging with dummy credentials
  stopped at AWS account resolution.

Useful implementation locations:

| Concern | Files |
| --- | --- |
| Client requests and socket handshake | `aws-classify-client/src/ClassifyClient.ts` |
| Shared protocol and future context types | `aws-classify-common/src/` |
| Dispatch, registration, sessions and notifications | `aws-classify-server/src/ClassifyServerless.ts` |
| Lambda entry points and WebSocket handlers | `aws-classify-server/src/dispatch.ts`, `src/index.ts` |
| Application authorization callback type | `aws-classify-server/src/ClassDef.ts` |
| Infrastructure includes | `aws-classify-server/yml/` |
| Offline harness and fixture | `tests/server/` |
| Shared request classes and behavior tests | `tests/requests/`, `tests/client/` |

## 3. Provider-neutral authentication responsibilities

The consuming application defines its Gateway authorizer and identity provider.
API Gateway validates tokens before invoking authenticated HTTP dispatch.
aws-classify attaches that configuration and exposes the resulting trusted
context. It must not decode an unchecked token and treat its claims as identity.

The framework supports Cognito through ordinary HTTP API JWT authorizers,
without hard-coding Cognito resource IDs, issuer URLs, app clients, authorizer
names, or scope names. Preserve an extension point for other compatible Gateway
authorizers; document how their trusted context is adapted.

The client obtains the current access token through an application-supplied,
potentially asynchronous callback. Read it for each protected request, including
the socket authorization request, and send it as an Authorization bearer token.
Login, requested scopes, token storage, and refreshing tokens belong to the
application. Public calls do not need to carry the access token.

Authentication must be explicitly enabled so existing npm consumers retain
their current constructors, public exports, callbacks, and deployment behavior.
An application enabling protected dispatch must fail configuration validation
if its required authorizer is absent; it must not silently deploy an open route.
The exact configuration/API for this opt-in remains to be designed.

## 4. Two fixed HTTP dispatch entry points

In authenticated mode, supply these framework function definitions:

| Export | Route | Gateway authorizer | Permitted calls |
| --- | --- | --- | --- |
| `responseHandler` | `ANY /api/dispatch` | Application-supplied | Exposed members without the public suffix |
| `publicResponseHandler` | `ANY /api/dispatch/public` | None | Exposed members with the public suffix |

Both handlers share the core dispatch implementation. Adding application members
must not create additional Gateway routes or Lambda definitions.

`custom.awsClassify.publicSuffix` configures the convention, with `Public` as
the architecture's example. Client routing uses the configured suffix. Server
enforcement independently uses the fixed entry point, never a payload flag:

- Public dispatch rejects non-public members before invocation.
- Authenticated dispatch rejects public-suffixed members, even with a valid token.
- A matching suffix does not make an otherwise unexposed method callable.
- Both client and server use the same convention, including explicit handling
  of invalid or ambiguous suffix configuration.

The framework's internal `$WebSocket.$authorize` operation must use protected
dispatch in authenticated mode. Define its treatment explicitly; it must not
become a public bypass or accidentally fail ordinary suffix classification.

## 5. Scope support and application authorization

The framework transports and exposes scope information. It does not assign
roles, define application permissions, or automatically map members to scopes.
Member-level authorization stays in application member code or the existing
application authorization callback.

Support the application-supplied authorizer object, including optional scopes:

```yaml
provider:
  httpApi:
    authorizers:
      applicationJwt:
        type: jwt
        identitySource: $request.header.Authorization
        issuerUrl: ${env:OIDC_ISSUER_URL}
        audience:
          - ${env:OIDC_AUDIENCE}

custom:
  awsClassify:
    authorizer:
      name: applicationJwt
      scopes:
        - example/invoke
    publicSuffix: Public
```

The names and scope above are illustrative, not framework defaults or GramSurfer
policy. Wire this object into the authenticated event's `httpApi.authorizer`.
Scopes remain optional for applications choosing another token policy.

API Gateway route scopes mean that at least one configured scope must match.
Document that OR behavior. Since protected members share a route, its Gateway
scope requirements apply to the whole route. Applications needing more specific
or all-of checks perform them through the validated request context.

Expose read-only granted scopes to application code. A helper such as
`hasScope(name)` is optional; final helper names are not agreed. Preserve existing
authorization callback compatibility when adding context access.

The authentication documentation should explain access tokens versus ID tokens
and AWS's recommendation to require scopes when distinguishing API access tokens.
The consuming application decides its final access-token and scope policy.

## 6. Validated context and session ownership

For an HTTP API JWT authorizer, use
`event.requestContext.authorizer.jwt.claims` and `.scopes`. Preserve the validated
subject, issuer, granted scopes, and claims the application needs in a
provider-neutral per-request context.

- Refresh context for every invocation. Public dispatch has no authenticated
  identity, even if a caller sends identity-looking fields or a bearer token.
- Make context available to response methods and authorization callbacks
  without breaking their existing APIs.
- Keep context out of serialized response state and persisted session data.
  A reusable Lambda instance must not retain another request's context.
- Identity, scope grants, ownership, and admin status never come from request
  arguments, an unchecked token, or restored client-controlled state.
- Persist separate trusted session ownership metadata when binding a session
  to identity. Protect it from application `setUserId()` and serialized state.
  Existing `userId` associations are not an authenticated identity source.
- Verify ownership before using an existing session for protected work. Define
  principal comparison so issuer differences cannot create subject collisions.
- Preserve the existing serialized member-error contract unless a deliberate
  compatibility change is approved. Gateway authentication failures are separate
  from member exceptions.

## 7. Secure WebSocket attachment

An HTTP JWT authorizer does not secure `$connect`. Existing session IDs alone
must not grant attachment to authenticated notification sessions.

Agreed direction:

1. A protected HTTP request obtains validated identity and establishes or
   verifies application-session ownership.
2. It issues a short-lived, unpredictable, single-use connection credential
   bound to that authorized session.
3. The browser supplies that credential when opening the socket.
4. `$connect` validates and atomically consumes it before recording the connection.
5. Reconnection obtains a fresh credential while retaining eligible saved state.

Explicitly reject expired, replayed, malformed, or wrong-session credentials and
attempts to authorize another user's session. Expiry must be checked during
validation; database TTL deletion is not an authorization mechanism. Concurrent
connection attempts must not both consume the same credential successfully.

Do not log raw bearer tokens or connection credentials. Final transport,
storage, expiry, and connection lifecycle policy remain open decisions below.

GramSurfer's completion Lambda needs to notify the initiating user's authorized
session after asynchronous work. Preserve trusted server-side notification
helpers for that use case without requiring a browser token in workflow state.
Application permission to target another session remains application policy.

## 8. Stage 1: baseline test improvements

Make tests independent of execution order. Replace global counts and incidental
session creation assumptions with explicit fixture setup and isolated test data.
Await callback sends, bound callback waits, and close sockets on every exit path.

Priority offline coverage:

| Area | Cases |
| --- | --- |
| Errors | Thrown response method, malformed payload, unknown interface/method, and a successful request after a failure |
| Authorization hook behavior | Denied callback does not invoke the member or mutate its state; this is not proof of deployed authentication |
| Persistence | Recreated client with the same session; separate interfaces within one session; separate sessions retain separate state |
| Serialization | Multiple arguments, nulls, Unicode, nested objects, and registered-class state through both request and callback paths |
| Sockets | Invalid session, close/reconnect, repeated initialization, connection failure and retry |
| Notifications | Intended recipient only, nonexistent session, absent connection, and propagated send failure |
| User index | User reassignment, old/new index results, and deletion without affecting another user's sessions |

Add focused unit tests for controlled transport/AWS failures and expiry timestamp
calculations. Consider two additional harness cases: malformed configuration
output and a database process dying during startup. Preserve existing harness
tests rather than broadly rewriting the startup/shutdown machinery.

Functional tests may expose existing library defects. Report them explicitly
and distinguish a test-fixture correction from a library behavior change.

## 9. Deployment-required test command

Provide a separate command, provisionally `npm run test:aws`, outside the default
`npm test`. Initially it runs under a maintainer/reviewer's local AWS profile or
SSO credentials plus the normal Serverless authentication. It must never inherit
the offline harness's dummy credentials for deployment.

The command should:

1. Build the libraries and validate the selected AWS account/profile/region.
2. Create a uniquely named fixture stack, table, and globally unique bucket for
   the run. Never reset an unrelated shared or production table.
3. Deploy and upload the static fixture; wait for actual resource readiness.
4. Read HTTP, WebSocket, and default CloudFront endpoints from stack outputs.
5. Reuse the transport-independent behavior suite against real AWS.
6. Check uploaded static content and HTTP dispatch through default CloudFront,
   as well as direct API Gateway behavior and real WebSocket callbacks.
7. Save the exact commit, test results, useful stack events/Lambda diagnostics,
   and resource identifiers before cleanup. Do not expose credentials in logs.
8. Close clients, empty the run-owned content bucket as needed, and remove
   owned resources in a finally path, including after partial deployment.
   Report cleanup failure independently and provide recovery instructions.

Use generated AWS hostnames and CloudFront's default certificate. No custom
domain, hosted zone, or custom certificate is required. The existing
`resources-website.yml` is the default-certificate template; the custom website
template is not part of this test.

Check generated IAM for the supported DynamoDB operations and
`execute-api:ManageConnections`. Test actual callback delivery, rather than
inferring permissions solely from a template inspection.

Use bounded polling for index/query expectations: DynamoDB GSI reads are
eventually consistent. Check configured TTL and saved expiry values; do not wait
for AWS to delete expired items, which can take days. Verify authenticated header
forwarding and cache behavior through CloudFront when adding authentication.

Retain a separate explicit way to test an existing fixture endpoint if useful,
with clear ownership expectations. Default behavior should be a disposable run.
A failure must not silently become a skipped or successful AWS check.

## 10. Stage 2: authentication acceptance tests

Offline development uses `serverless offline --noAuth` when testing the new
routes. It bypasses Gateway authorizers and provides no validated OIDC identity.
Exercise dispatch/suffix functionality locally, without a Cognito emulator or
fake JWT verification. Any unit tests of context plumbing are not evidence that
token authentication or application security works in AWS.

The deployed fixture may provision temporary Cognito resources and test users
as a consuming application. These belong only to test infrastructure, not the
framework's published production includes. Use generic scope names and policies.

Required deployed cases:

- Anonymous, malformed, invalid-signature, expired, wrong-issuer, and
  wrong-audience/client tokens are rejected before protected dispatch executes.
- A valid access token with the configured scope reaches dispatch with the
  expected validated subject, issuer, scopes, and claims.
- Missing required scope is rejected; any-of route scope behavior is verified.
  The chosen test fixture policy distinguishes access tokens from ID tokens.
- Use genuinely expired or wrong-issuer/client tokens for those cases. Altering
  a token's payload only proves rejection of a bad signature.
- Public dispatch invokes exposed public members without a token, and rejects
  protected members. Protected dispatch rejects public-suffixed members.
- URL/payload manipulation and unexposed method names cannot bypass dispatch
  categories. Refusals occur before member execution or protected state changes.
- Generic application member/callback code can inspect scopes and deny a call.
  No GramSurfer-specific role mapping is embedded in these tests.
- Sequential requests by different users, followed by public requests, do not
  leak identity or scopes through warm Lambda instances or restored state.
- A caller cannot reuse another principal's authenticated session.
- Socket credentials enforce session binding, expiry, single use, and replay
  rejection, including concurrent consumption attempts and reconnects.
- Notifications reach the intended authorized session. A trusted background
  producer can notify it without weakening browser attachment checks.
- Existing unauthenticated consumers still work when authentication is not
  enabled. Verify packed-library installation, types, browser bundling, and
  existing public/subpath imports outside the repository workspace.

GramSurfer's broadcaster/admin enforcement, private S3 access, presigned
operations, and publication security are separate application acceptance tests
in that repository. They are not deferred framework requirements hidden in this
fixture.

## 11. Decisions to settle before the relevant implementation

These are open design details, not permission to weaken the requirements:

| Decision | Constraint |
| --- | --- |
| Client options and shared configuration | Preserve existing construction; configure token callback, protected/public URLs, and suffix without hard-coded provider policy |
| Trusted-context access and adapters | Per-request, compatible with existing callbacks, supports JWT context first, documents other authorizers |
| Authenticated deployment opt-in | Missing required authorizer fails validation; existing applications retain legacy behavior |
| Offline identity absence | Explicit local-development behavior only; never silently bypass required identity in a deployed authenticated service |
| Public API and authenticated session interaction | Define whether public calls use separate sessions and prevent anonymous access to protected state |
| Legacy session migration | Do not let possession of an old unbound session silently claim authenticated ownership |
| Connection credential transport/storage | Browser-compatible transport, unpredictability, atomic consumption, explicit expiry; no raw token logging |
| Logout/token expiry/revocation | Define how these affect existing sockets and protected sessions; authenticate-at-connect does not imply continuous validation |
| Connection lifecycle | Define duplicate connections, disconnect cleanup, reconnect races, and notification attempts after closure |
| Cloud test timing | Obtain real negative-case tokens without pretending forged tokens prove expiry/issuer checks |
| Release and migration documentation | Record configuration changes, new exports, compatibility guarantees, and any unavoidable breaking change |

Suggested work packages for separate sessions:

- A: independent baseline fixtures and additional offline coverage.
- B: disposable AWS deploy/test/cleanup runner and baseline deployed checks.
- C: HTTP authorizer/scopes integration, fixed dual dispatch, client token
  support, and trusted context; begin Cognito acceptance coverage alongside it.
- D: authenticated session ownership, secure socket credentials and lifecycle,
  followed by the complete deployed authentication and compatibility matrix.

Authenticated support is not complete or release-ready until D and the deployed
checks pass. Do not describe an intermediate HTTP-only implementation as securing
the existing WebSocket mechanism. Record actual AWS validation results and any
unavailable credentials distinctly from completed offline checks.

## 12. Reference documentation

- [Serverless HTTP API authorizers and scopes](https://www.serverless.com/framework/docs/providers/aws/events/http-api)
- [AWS HTTP API JWT enforcement](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [AWS Lambda HTTP API event format](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)
- [AWS WebSocket connection authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html)
- [Cognito scopes](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
- [Serverless Offline `noAuth`](https://github.com/dherault/serverless-offline#noauth)
- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)

GitHub OIDC, when revisited, concerns an automated runner obtaining temporary AWS
deployment credentials. It is independent of application user authentication
through Cognito/OIDC and is not required to run the local maintainer AWS command.
