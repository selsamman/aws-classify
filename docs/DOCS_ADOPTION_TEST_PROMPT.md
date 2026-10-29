# Independent user-guide adoption test

Status: the original exercise was closed by the user on 2026-10-23. This prompt
is retained for optional future use, not as an outstanding task or a mandatory
release gate. See `tests/manual-adoption/README.md` for the closeout decision.
The full matrix below was the exercise's intended scope, not a claim that every
case passed. Start another run only when explicitly requested.

Run this in a new chat with no history from the documentation audit. The test
agent should receive only the prompt below, the revised user guide, and an empty
application directory. Do not fork the audit chat or pass its findings to the
agent. Provide a separate local guide preview or a read-only copy of
`usersguide/content` plus its downloadable configuration files.

The first run is reviewed in `tests/manual-adoption/2026-10-20-review.md`.
It established a partial smoke flow, not the full matrix. Do not provide that
review/reference implementation to a fresh adoption agent; use it to prepare and
evaluate the next run without supplying implementation answers.

## Permanent fixture lifecycle

This first run supplies the initial incarnation of a maintained manual acceptance
fixture. Its permanent repository home is `tests/manual-adoption`, outside all
published packages. Preserve the application, Cognito setup and cleanup scripts,
and manual scenario checklist for a separate revision session that will review
and install them there. Do not consult that fixture or the framework test source
during the first independent adoption run.

Later routine acceptance runs reuse the maintained application against published
versions. For substantial guide setup changes, consider a focused fresh-directory guide-only
adoption pass when useful; rerunning an existing application is not enough to validate those
instructions. See `tests/manual-adoption/README.md` for the revision-session
requirements, including ownership checks and cleanup after interrupted runs.

## Preparation by the person running the test

- Supply the guide location and an empty application directory in the prompt.
- Confirm the public guide contains the intended revision, including downloadable
  YAML. Capture page/download snapshots, source revision if available, retrieval
  time and package versions with the run evidence. npm and guide publication are
  separate. Compare findings with the exact guide snapshot actually read.
- Publish the revised framework packages and guide before starting. The agent
  installs the published npm packages and records the resolved versions; no local
  tarballs, workspace links or framework source checkout are part of this test.
- The environment has full AWS credentials. The prompt restricts work to uniquely
  named test resources; credentials do not restrict the agent's account access.
  Verify the AWS account ID before creating resources and record it in the test
  manifest. Ensure Serverless sign-in/access is also available.
- This prompt supplies a namespace for this run. For another run, replace every
  occurrence of that namespace with a new unique value before dispatch. If any
  supplied name is already in use, stop resource creation and report the collision;
  do not adopt or alter existing resources.
- Cognito provisioning is a separate prerequisite/bootstrap phase, described
  below. The guide explains the required provider configuration but does not
  supply a user-pool creation recipe. The agent may use official AWS documentation
  and script this setup with the AWS SDK. Keep that work and its evidence separate
  from the guide-only library adoption assessment. Do not put credentials here.
- The prompt is an acceptance checklist, not a recipe. Do not supply implementation
  hints or fixes learned during the audit.

## Prompt to send to the fresh agent

You are evaluating whether a new developer can adopt aws-classify using only its
user guide. Build and actually run a small application in a fresh directory.
Your primary deliverable is a working one-screen diagnostic app, accompanied by
an honest report of the documentation experience.

Guide location: [supply revised guide URL or read-only guide directory]
Application directory: [supply empty absolute directory]
Package source: published npm packages only; record resolved versions.
Cloud authorization: create, exercise and remove resources belonging to this test
using the environment's AWS credentials. Do not modify existing applications,
shared provider resources, account settings, IAM users or credential policies.
Guide revision/snapshot: [supply expected revision; save pages actually used]
Region: us-east-1
Run namespace and Serverless service: aws-classify-docs-20261018-k8r3
Stage: acceptance
Serverless application stack: aws-classify-docs-20261018-k8r3-acceptance
Cognito user-pool name: aws-classify-docs-20261018-k8r3-users
Cognito app-client name: aws-classify-docs-20261018-k8r3-browser
Cognito domain prefix: acd-20261018-k8r3-login
Cognito resource-server identifier: aws-classify-docs-20261018-k8r3-api
Test usernames: docs-user-a and docs-user-b (only inside this test's user pool).
For other application-owned named resources, use the same run namespace;
preserve the guide's account/stage suffixes for globally unique bucket names.

Use the guide as your only source for aws-classify installation, configuration,
API usage, authentication, notifications, deployment and publication. You may
read ordinary frontend/TypeScript/AWS/provider documentation for their own setup,
and use normal package tooling and compiler diagnostics. Do not inspect the
framework implementation, tests, internal design documents, this audit chat, or
sample application source to discover missing instructions. Do not change the
framework or guide. If you need information absent from the guide, record the
exact gap and what you inferred; do not silently repair the instructions.

Before the guide-only adoption phase, provision a disposable Cognito provider
as an explicit bootstrap task. Write a small repeatable AWS SDK script in the
new application directory, using official AWS documentation for provisioning.
Create the named user pool, a public browser app client without a secret, a
Cognito login domain, resource-server API scopes and two test users. Configure
code flow with PKCE-compatible browser login, OpenID/API scopes, and refresh
support consistent with the guide's managed-client requirements. Use generated
test passwords kept out of reports/source control and suppress invitation emails.
Record created resource IDs in a local cleanup manifest; never include tokens or
passwords in that manifest. Provide a standalone cleanup script that reads the saved manifest and works
from a new session after interrupted setup, partial deployment or normal app
removal. Normal Serverless removal covers only its own stack; separately remove
Cognito and any run-owned resources it leaves behind. Use exact recorded IDs and
verified account/region/ownership, tolerate resources already absent, and report
anything still present. Preserve the manifest until removal is verified.

Provision the pool/client first to obtain provider settings, then deploy the app
and register its actual CloudFront root URL as the login/logout return URL before
browser testing. Make any required callback update through the bootstrap script.
Use these provider outputs to follow the guide's authentication instructions;
do not replace the framework's login lifecycle with Cognito sample application
code. Preserve the setup script and cite the AWS sources used. Report Cognito
provisioning separately: success there does not establish that the guide teaches
how to create a provider. Report unclear provider requirements or integration
instructions in the guide as documentation issues.

Build one screen with separate controls and visible timestamped results for:

1. An anonymous public operation and a protected operation. Show success and
   failure clearly. Exercise a returned value, an input validation error, and
   session state that survives a page reload while the backend remains running.
2. Two independent client sessions, A and B, using separate browser contexts or
   independently opened tabs. Identify each session visibly. Verify session
   isolation and avoid accidentally copying the first session into the second.
3. WebSocket connect, disconnect and reconnect, with visible connection status
   and received messages. Register callbacks before attaching the socket.
4. A server notification back to the caller, then A initiating a notification to
   B. Exercise the documented helper for another session and, separately, the
   helper that restores/updates another session's response state. The application
   must decide which recipient A may address; do not expose unrestricted session
   enumeration or treat a client-supplied session ID as authorization.
5. Sending while B is disconnected, reconnecting B, and sending again. Display
   actual errors and verify whether messages are replayed. Also test the same
   application session attaching a replacement connection, if the guide describes
   that behavior, and record which connection receives subsequent notifications.
6. Authentication-enabled public/protected routing. Use the documented local mode
   for functional development, clearly marking identities as unvalidated there.
   Attempt to invoke a protected member through public dispatch and a public
   member through protected dispatch; record the actual outcomes.
7. Against the provisioned Cognito provider and real AWS deployment: public access before login,
   protected rejection before login, login/callback completion, protected success,
   session persistence, authenticated socket attachment/reconnect, and logout.
   With two provider accounts, check that one cannot adopt the other's protected
   session. Exercise refresh only if the provider setup permits it. Distinguish
   a missing scope from application permission denial. Verify that public calls
   remain usable after local logout and that this client's protected socket closes.

Start with the guide's complete supplied deployment and directory conventions;
keep the UI plain. Implement the smallest reasonable application permission
policy needed for the recipient tests. Do not attempt every bespoke hosting
configuration or invent framework features. An independently deployed background
producer is an optional extension if the guide alone provides enough information;
report it separately from sends triggered by a response method.

First install, build and run locally. Operate the screen in a browser and inspect
network results; compilation or mocked tests alone do not count as a working app.
Keep an executable test checklist or small browser tests where useful. If access
is missing, finish everything independent of that access and list the exact
remaining prerequisite. Do not substitute fabricated JWTs or injected Gateway
claims for real authentication acceptance.

Deploy the named disposable stage and wait for the deployment process to exit
successfully before starting another stack operation. Do not infer completion
from a hostname or partially created resources. Then publish the frontend, test the deployed CloudFront/API path, republish a frontend
change without redeploying the backend, and verify the generated output JSON can
be read as documented. Remove only resources created for this test, including Cognito domain, app
client, resource server, users and user pool, and report cleanup results. If an
actual permissions or external-service failure prevents a check, mark it blocked
with the observed error; do not treat unavailable access as a pass. Never publish framework packages or the user guide as part of this test.

Deliver:

- The application, reproducible startup commands, and a brief usage README.
- Repeatable Cognito setup, callback-update and standalone cleanup scripts, plus
  their non-secret manifest format and manual acceptance checklist, ready for a
  later revision session to preserve as the internal maintained fixture.
- A matrix marking each scenario PASS, FAIL, BLOCKED or NOT RUN, with observed
  evidence. Separate offline functional checks from real AWS/provider validation.
- Concrete documentation issues with guide page/section or source line references,
  the instruction attempted, observed result, and proposed correction. Distinguish
  missing instructions, contradictions, environmental access problems and apparent
  implementation defects. Record every workaround and use of outside information.
- Installation source/version, commands actually executed, remaining processes,
  cloud resources and cleanup outcome. Never include credentials or token values.

Implement the minimal consent-based pairing policy needed to exercise A-to-B
notifications and state updates (for example, an invite that B explicitly accepts).
Leaving peer-session fields permanently empty does not implement those scenarios.
If pairing cannot be completed, report those requirements as unmet.

Preserve browser assertions/screenshots or a replayable interaction log as evidence.
Re-run any apparent publishing failure after deployment completion before assigning
it to the library/template. Require a real protected network request without a
valid token to assess Gateway rejection; a client-side login error alone is not
that test. Reconnect the socket before checking that logout closes it.

Continue through independent scenarios when one is blocked. Do not claim that
all permutations passed merely because the screen builds or a local call works.
