# Synchronized npm releases

The release workflow is `.github/workflows/publish.yml`. Publishing a GitHub
Release triggers one job for common, client and server. It publishes the library
workspaces explicitly, never the private root package. Source changes are not
automatically committed or tagged by the version tools.

The user-facing walkthrough is `usersguide/content/repository/releases.md`.

## Initial configuration

Configure a trusted publisher on **each** of the three npm packages:

- GitHub owner `selsamman`, repository `aws-classify`, workflow `publish.yml`.
- No GitHub environment name (the workflow does not set one).
- Allow both `npm publish` and `npm dist-tag`.

The workflow installs npm **11.21.0** on Node 24. This npm version supports OIDC
distribution-tag management. These two npm permissions are independent; merely
allowing publication is insufficient for the final promotion step. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Set the GitHub repository Actions secret **SERVERLESS_ACCESS_KEY** for the
Serverless v4 offline integration suite. No real AWS credentials or npm token
are needed by this workflow. The access key must come from the maintainer's
Serverless account; it has not been copied from this machine or configured by
the implementation task.

## Prepare a release

```sh
npm run release:version -- 0.2.0
npm run release:check
npm run typecheck
npm test
npm run test:release
npm run test:packed
npm run audit
npm run release:publish -- --dry-run
```

The version command updates all three public package versions, exact internal
references (including private test consumers), and existing workspace lockfile
entries without changing unrelated locked dependencies. It refuses malformed
versions, build metadata and downgrades. Private workspace versions stay as they
are. All updates are validated; an unsuccessful write/check restores originals.

Review, commit and push source changes. Publish the matching GitHub Release,
for example `v0.2.0`. GitHub prerelease status must agree with semver: prereleases
target `next`, stable versions target `latest`. Release names need not be semver;
the **tag** must be `v<package-version>`.

## Publication and failure behavior

- Builds, typechecks, regression tests, release failure/recovery tests, packed
  consumer checks and dependency audit run before registry writes.
- The publisher creates all three tarballs before uploading. It verifies built
  entry points and server configuration files, computes SHA-512 integrity, and
  records a manifest under `.test-results/release/<version>/`.
- All three registry versions are inspected before any upload. Existing versions
  are skipped only if their integrity matches. Read failures are not interpreted
  as missing packages. Conflicting existing content fails the release.
- Uploads occur in dependency order: **common, client, server**, under the
  version-specific `release-<version>` tag. Stable/prerelease promotion starts
  only after all three registry versions match the packed content.
- The workflow serializes releases and does not cancel a running publication.
  It refuses to move `latest`/`next` backwards. Tarballs and the manifest are
  retained as GitHub Actions artifacts for 14 days.
- npm has no multi-package atomic transaction. New versions are accessible by
  explicit version while awaiting promotion. Final distribution-tag changes
  are also separate requests: a failure during promotion can leave mixed tags.
  Rerun the same release workflow to converge them, without republishing
  identical versions. Do not change the release commit to repair an upload.
- The publisher's real-write CLI is restricted to the GitHub release event.
  Local `--dry-run` runs npm publish simulations and never changes versions or
  tags in the registry. This restriction prevents casual local invocation; npm
  authentication remains the authorization boundary.

## Validation — 2026-10-09

The initial prepared library version is **0.2.0** (previous common/client 0.1.0,
server 0.1.9). Internal dependencies and lockfile entries are synchronized.

Local validation passed, including the complete release pipeline on Node
24.21.0 and npm 11.21.0 (the versions selected by the workflow at validation):

- Release behavior tests: 16 cases covering synchronization, invalid versions,
  manifest/lock/tag drift, partial uploads, partial tag promotion, conflicting
  immutable contents, rollback protection, prereleases, dry runs, registry read
  failures, missing build output and eventual registry visibility.
- Framework build/typechecks and all 120 existing offline regression checks.
- Packed consumer compatibility against synchronized library tarballs.
- npm publish dry runs for all three actual tarballs, with public registry
  preflight reads and no registry writes.
- Packed tarball integrity was identical between the existing Node 20/npm 10
  environment and the workflow's Node 24/npm 11 environment.
- Official actionlint v1.7.12 validation of the release workflow.
- Zero-vulnerability framework audit. Updated the existing development-only
  Handlebars lockfile entry from 4.7.9 to 4.7.10 for newly reported advisories.

No GitHub Actions execution or live npm/OIDC publication has been performed.
Those require committed/pushed source, the npm trusted publisher configuration,
the Serverless Actions secret, and a published GitHub Release. No source commit,
Git tag, npm version or npm distribution-tag change was made by this task.
