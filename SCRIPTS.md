# Repository scripts

Run the commands below from the repository root. The root `package.json` requires
Node.js 20.19 or later and uses npm workspaces with one root lockfile. The user
guide has its own dependencies and lockfile and is not a root workspace.


## package.json scripts

Invoke scripts with `npm run <name>` (`npm test` is shorthand for `npm run test`).
Chained steps stop at the first failure.

### Setup, build, and dependency checks

| Script | What it does |
| --- | --- |
| `install:tests` | Runs `npm ci --ignore-scripts`, then `npm rebuild serverless`, then the root build. Recreates the installed dependencies from the lockfile, skips general install lifecycle hooks, and explicitly prepares the Serverless executable and libraries. Requires registry access when dependencies are not cached. |
| `build` | Builds `aws-classify-common`, then client, then server. Each produces ESM, CommonJS, and TypeScript declarations under its `lib/` directory. |
| `typecheck` | Runs the root build, then typechecks the requests, server, and client test workspaces. The server check also checks its browser TypeScript configuration. It is not a guide typecheck. |
| `audit` | Runs `npm audit --omit=dev --audit-level=high` against the root workspace. Includes production dependencies of published tools as well as libraries; excludes development-only dependencies. Reports lower severities but blocks on high/critical findings. Requires registry access. For the full maintainer report, run `npm audit` directly. |

### Tests

| Script | What it does |
| --- | --- |
| `test` | Runs the server harness regression tests, the client Jest integration suite, the separate offline authentication suite, and the tools tests, in that order. The client `pretest` hook rebuilds the libraries. Offline integration starts local Dynalite and Serverless services; Serverless 4 requires its normal sign-in or access/license key. Real AWS credentials are not required for these offline requests. |
| `test:tools` | Runs `node --test test/*.test.cjs` in `aws-classify-tools`, covering the CLI and its supporting tools. Also included in `npm test`. |
| `test:release` | Runs `node --test tests/release.test.cjs`, the release/versioning/publication regression and recovery tests. Separate from `npm test`; used by release CI. |
| `test:packed` | Builds the libraries and runs `tests/packed-consumer.js`. Packs all four public packages, installs the tarballs into a temporary consumer, checks the tools CLI, legacy imports, TypeScript compatibility, runtime configuration, and browser bundling. Uses registry dependencies and removes its temporary consumer/cache afterward. Separate from `npm test`; used by release CI. |
| `test:aws` | Builds the libraries, then runs `tests/server/aws-test.js` through the server workspace. Creates a disposable real AWS deployment, checks API/WebSocket/CloudFront behavior, records diagnostics under `.test-results/aws/`, and attempts owned-resource cleanup. Requires AWS credentials and Serverless authentication; creates billable resources. Supports options such as `--suffix`, `--profile`, `--region`, `--auth`, `--static-pages`, and recovery via `--cleanup`. See [tests/README.md](tests/README.md) for prerequisites and cleanup details. |
| `test:aws:auth` | Calls `test:aws` with `--auth`, selecting the authenticated AWS fixture and checks. Has the same build, credentials, resource, report, and cleanup requirements. |
| `test:static-pages:recipe` | Runs `tests/static-pages-recipe.cjs`. Extracts the guide's Vite/Minista recipe into a fresh consumer workspace, installs dependencies, builds the SPA and public pages, typechecks, and checks generated HTML, metadata, navigation, and assets. Requires Node 22.12 or later and registry access. Keeps the fixture and `verification.json` under `.test-results/static-pages-recipe/` by default. An optional first argument selects a fresh output directory. Does not deploy to AWS. |

Examples:

```sh
npm run test:aws -- --suffix sam --profile review --region us-east-1
npm run test:aws:auth -- --suffix auth
npm run test:aws -- --cleanup /absolute/path/to/run.json
npm run test:static-pages:recipe -- /absolute/path/to/new-fixture
```

### Releases

The four public packages share a synchronized version. See
[docs/RELEASING.md](docs/RELEASING.md) for the release procedure.

| Script | What it does |
| --- | --- |
| `release:version` | Runs `scripts/release-version.cjs`. Requires a version argument, e.g. `npm run release:version -- 0.3.0-rc.1`. Updates all four public package versions, internal workspace references, and corresponding lockfile entries. Writes workspace manifests and the root lockfile; refuses version downgrades. Review and commit the result before making the GitHub release. |
| `release:check` | Runs `scripts/release-check.cjs`. Validates synchronized package versions, exact internal references, and lockfile consistency. Optionally verifies `RELEASE_TAG` equals `v<version>` and `RELEASE_PRERELEASE` (`true` or `false`) matches the version. Does not build or publish. Used by release CI. |
| `release:publish` | Runs `scripts/release-publish.cjs`. Packs and validates all four packages, checks existing registry content and rollback protection, uploads missing versions under a temporary release tag, waits for matching registry integrity, then promotes `latest` (stable) or `next` (prerelease). Writes tarballs and `manifest.json` under `.test-results/release/<version>/`. Real publication is gated to the GitHub release workflow. Locally use `npm run release:publish -- --dry-run`; this still packs files and reads the registry but skips real publication/tag promotion. Build first: packing uses `--ignore-scripts`. |

### User guide

Install guide dependencies with `npm run guide:install` before using these commands.

| Script | What it does |
| --- | --- |
| `guide:install` | Runs `npm ci` in `usersguide` with workspaces disabled, using the guide's separate lockfile. |
| `guide:dev` | Starts the Docusaurus development server on `127.0.0.1` without opening a browser. The guide's `prestart` hook regenerates downloadable YAML configurations. |
| `guide:build` | Regenerates downloadable YAML through `prebuild`, then builds the static Docusaurus site into `usersguide/build/`. |
| `guide:serve` | Serves an already-built guide on `127.0.0.1` without opening a browser. Does not rebuild it. |
| `guide:check` | Runs `usersguide/scripts/check-examples.mjs`: regenerates downloads, extracts titled TypeScript/JSON tutorial files, parses JSON, typechecks TypeScript, and validates downloadable Serverless YAML and referenced includes. Requires library declarations from a prior root `npm run build`. |
| `guide:publish` | Runs the guide's `deploy` script: builds the site, then runs `usersguide/scripts/publish.mjs` to commit and push generated content to the configured GitHub repository's `gh-pages` branch. A changed build requires an interactive terminal, Git commit identity, Git Credential Manager, and browser GitHub sign-in. Publishes externally; not a preview command. |

## ./scripts

There are no `.mjs` files in root `./scripts`; its release utilities are `.cjs`
(CommonJS). They resolve the repository relative to their own file location.
Prefer their npm wrappers for normal use.

| File | Direct invocation / purpose |
| --- | --- |
| `scripts/release-version.cjs` | `node scripts/release-version.cjs <version>`. CLI wrapper around `setReleaseVersion`; reports validation failures with a nonzero exit code. Same writes as `release:version`. |
| `scripts/release-check.cjs` | `node scripts/release-check.cjs`. CLI wrapper around `checkRelease`, reading optional release metadata from the environment. Same checks as `release:check`. |
| `scripts/release-publish.cjs` | `node scripts/release-publish.cjs --dry-run` locally. Publication CLI and exported `publishRelease`/`registryJson` helpers. Implements packing, integrity/collision checks, resumable uploads, registry visibility polling, and distribution-tag promotion. Real CLI publication requires `GITHUB_ACTIONS=true`, `GITHUB_EVENT_NAME=release`, and `RELEASE_TAG`; CI supplies the release metadata. |
| `scripts/release-lib.cjs` | Shared implementation, not a standalone command. Exports `packages`, `validateVersion`, `checkRelease`, and `setReleaseVersion`. Requires canonical SemVer without a `v` prefix or build metadata and npm lockfile v3. Checks all workspace references to the public packages; version updates restore original files if writing or the final check fails. Running it directly performs no work. |

## usersguide/scripts (.mjs)

These are the repository's explicit `.mjs` utilities. Paths below assume invocation
from the repository root; each resolves its input/output paths relative to itself.

| File | Direct invocation / purpose |
| --- | --- |
| `usersguide/scripts/prepare-downloads.mjs` | `node usersguide/scripts/prepare-downloads.mjs`. Extracts the titled `cloud/serverless.yml` and `cloud/serverless-authenticated.yml` YAML blocks from the deployment and authentication guide pages into `usersguide/static/config/`. Creates the output directory and overwrites the generated downloads. Runs automatically before guide development/build and when checking examples. Also exports `prepareDownloads`; importing the module runs it immediately. |
| `usersguide/scripts/check-examples.mjs` | `node usersguide/scripts/check-examples.mjs`. Implements `guide:check`. Extracts only fenced `ts`/`json` blocks with a `title` filename from `usersguide/content/`; generates a requests index and checks the extracted tutorial project against built library declarations. Checks both generated YAML configurations and included server templates. Uses a temporary directory under `.test-results/`, removed in a `finally` block; regenerated downloads remain. It does not execute tutorial deployments or validate every code fence. |
| `usersguide/scripts/publish.mjs` | `node usersguide/scripts/publish.mjs`. Publishes an existing `usersguide/build/` (does not build it itself). Uses a temporary Git repository, fetches existing `gh-pages` history if present, replaces site content with the build, and commits/pushes only when changed. Validates the configured GitHub project and branch, uses browser authentication with credential storage disabled, and uses a normal push to reject concurrent updates. Removes its temporary repository afterward. Prefer `guide:publish` to build first. |
