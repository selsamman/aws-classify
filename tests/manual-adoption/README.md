# Manual adoption acceptance fixture

This directory preserves the reference app and evidence from the independent
user-guide adoption exercise. Its AWS deployments were disposable; the consumer
source and review records remain available for future reference.

## Exercise closed — 2026-10-23

The user closed the exercise after the adoption run and follow-up reviews. It
established that an independent agent could build and deploy a working application
from the guide with a separately provisioned Cognito provider. The review found no
confirmed substantial documentation blocker requiring another adoption run before
starting the real application.

The resulting changes clarify provider setup/callback order, deployment completion
before publication, and independent guide publication. The tools now diagnose an
in-progress stack operation rather than treating absent outputs as a template
problem. The claimed missing-output template defect was not established.

Remaining acceptance/evidence gaps stay recorded in the reviews; closing the
exercise does not turn those cases into passes. Completing the contrived test
matrix or promoting its provider scripts is deferred, and is not a release or
application-development gate. The existing automated/AWS suites remain available
for their intended coverage. Revisit this material if a real application exposes
a specific problem or a future change warrants a focused regression test.

## Current status

The first independent exercise completed on 2026-10-20. It is a valid partial
smoke test, not a completed acceptance matrix. Read the
[review and corrected findings](2026-10-20-review.md). The
[follow-on review](2026-10-20-follow-on-review.md) records additional two-account
coverage and the remaining incomplete or insufficiently demonstrated cases. The
[refresh retry review](2026-10-20-refresh-review.md) records the improved provider
configuration, verified cleanup and remaining evidence gap.

- `reference-app/` retains consumer source and its npm lockfile, with an explicit
  service-name/provider-scope requirement and the corrected Vite port. It has no
  operational Cognito setup/cleanup commands and remains a partial reference.
- `evidence/2026-10-20/` preserves the original report/checklist and provider scripts
  as text. The review supersedes the original report's failure classifications.
- The scripts need ownership, interrupted-run recovery and idempotency corrections
  before promotion. No reusable provider fixture has been declared ready.
- The [adoption prompt](../../docs/DOCS_ADOPTION_TEST_PROMPT.md) now requires guide
  snapshot capture, deployment completion and actual peer-pairing coverage.

## Optional future fixture promotion

1. Publish the intended npm packages and guide. Run the prompt in a fresh chat,
   outside the framework checkout, using only the public guide for library usage.
   Preserve the working application, provider setup/cleanup scripts, checklist,
   observed failures and workarounds.
2. In a separate revision session, review those artifacts and move the application
   and reusable support tooling here. This session may inspect framework test
   infrastructure to reuse established provisioning and ownership/cleanup patterns.
   Keep provider provisioning separate from the consumer application configuration.
3. Add a private package, with its own dependency installation/lockfile outside
   the root workspaces. Resolve the framework packages from npm, without workspace
   aliases or repository source imports. Keep all support files outside the four
   published packages. No production helper or CLI feature is implied.
4. Implement and document setup, callback configuration, test-user preparation,
   resource inspection and cleanup entry points. Add focused tests for interrupted
   setup, repeat cleanup, account/region mismatches and ownership checks. Verify
   the complete lifecycle in AWS before calling the fixture ready.

The repository already has relevant internal examples: Cognito CloudFormation
resources in `tests/server/auth-resources.yml`, test-user creation in
`tests/server/auth-test.js`, callback updates in
`tests/server/managed-browser-test.js`, and manifest-based cleanup in
`tests/server/aws-test.js`. These are revision-session references, not additional
instructions for the first blind guide-adoption run.

## Routine acceptance and fresh adoption

If this reference is developed into a maintained acceptance fixture, run its
screen and checklist against explicitly selected published versions. Record guide revision, package versions,
AWS account/region, unique names, browser and actual results for every run.
Preserve the evidence locally; never commit tokens, passwords or run credentials.

For a future substantial guide setup change, a focused fresh-directory adoption
pass may be useful when the affected instructions cannot be checked adequately
with existing example checks. A maintained application's successful run alone cannot prove that a new
reader can follow revised installation or configuration instructions. Use the
adoption prompt without supplying the maintained implementation as a shortcut.

## Setup requirements if the fixture is promoted

Use a run-specific namespace supplied explicitly by the operator. Generate the
full list of resource names before creation; record the actual AWS account ID
and region. Existing unrelated resources are never adopted or updated. Reusing a
run is allowed only with its matching manifest and verified ownership.

Prefer a small separate CloudFormation stack for Cognito pool/client/domain/API
scope resources, controlled by the setup script through the AWS SDK. Use SDK calls
for synthetic test users and any post-deployment callback update. Direct SDK
provisioning is also acceptable if the first run yields a simpler reliable script,
provided every created resource is recorded immediately and recoverably.

Setup must provide issuer, browser client ID, login domain and requested scopes
for the application. Provision the provider before the authenticated application;
update the registered return URLs once the CloudFront hostname is known. Keep
secrets in process memory or explicitly private local storage, outside Git and
reports. Separate non-secret outputs from test-user credentials.

Record creation intent before each operation and the returned identifiers after
it. On interruption between those steps, reconcile only the exact named/tagged
run resources. Retain enough information to resume setup or perform cleanup
without recreating the app or recovering a browser login.

## Cleanup requirements if the fixture is promoted

Provide one standalone cleanup entry point taking a saved run manifest. It must
work after a new shell/session, interrupted setup, failed deployment, successful
Serverless removal or partially completed previous cleanup.

First use the normal app removal path: `aws-classify cloud remove` for the supplied
website stack, which empties its content bucket before Serverless removal. Plain
`serverless remove` alone can encounter a nonempty bucket. Observe actual stack
completion before declaring removal successful.

Then remove run-owned resources outside that stack, including a separate Cognito
stack or directly provisioned domain/client/resource server/users/pool. Inventory
and handle any retained deployment buckets, bucket objects, log groups or other
resources actually created by the fixture and not removed with the app. Do not
assume that every resource of these types needs a separate deletion.

If normal removal fails, retain diagnostic output and attempt independent cleanup
where safe. Report app-stack failure separately from provider cleanup. A fallback
must target exact manifest IDs/names with verified ownership; never perform broad
account-wide or prefix-only deletion.

Cleanup must check account and region before mutations, tolerate already absent
resources, respect dependency order, wait for asynchronous deletion, record
per-resource results, and exit unsuccessfully if owned resources remain or their
state cannot be verified. Preserve the manifest until everything is verified
removed. Include a read-only remaining-resource report for manual recovery.
