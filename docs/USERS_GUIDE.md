# Public user guide

The user documentation now lives in the standalone Docusaurus project at
`usersguide/`. The target public URL is https://selsamman.github.io/aws-classify/.
Root and component READMEs provide short introductions and link to the guide.
`docs/` remains the home for architecture, implementation decisions and validation
records; `tests/README.md` remains the test-runner documentation.

## Decisions

- The guide has its own `package.json` and lockfile and is **not** another root
  workspace. `private: true` prevents npm publication; the website is public.
- Tutorial applications use `cloud/`, `web/`, optional `mobile/`, and the private
  `common/requests/` package, matching the simple-chat example without a
  `packages/` wrapper. The application may keep its existing directory layout.
- New-project and existing-project paths both explain manual setup. Complete
  copyable/downloadable Serverless configurations cover authentication-disabled
  deployment and optional authentication. Focused examples demonstrate calls,
  saved state and notifications. Complete consuming applications stay in sample
  repositories; the guide links to the simple-chat repository.
- Tutorials, feature chapters, API/configuration references and repository setup
  have separate navigation. The optional future `create-aws-classify` generator
  is not implemented or required.
- Removed bisync configuration, dependency and its now-unnecessary override.
  README duplication is removed, and workspace imports replace source copying.
- Publication uses generated files on the `gh-pages` branch with GitHub Pages
  configured to publish its root. No workflow or custom domain is added.
  Publication commits generated files; source changes remain
  uncommitted on the existing working branch.
- Release-status notes were removed at the maintainer's request for coordinated
  README and npm publication. The guide preserves the local-logout boundary, external-token
  support, native/mobile limitations and untested Okta/custom-domain behavior.

## Maintenance

From the repository root:

```sh
npm run guide:install
npm run build
npm run guide:check
npm run guide:build
npm run guide:serve
```

`guide:check` extracts and compiles the complete tutorial TypeScript files against
framework declarations, parses package JSON and the downloadable YAML, and checks
included framework configuration files. Docusaurus fails on broken internal
links. Download files are generated from the displayed YAML before development,
building and publication; they are ignored rather than maintained twice.

Publish with configured GitHub write credentials:

```sh
npm run guide:publish
```

The guide's repository chapter documents editing and publication. Keep source
changes reviewable and commit them separately from generated-site publication.
Source/edit links become available remotely after those source changes are
committed and pushed by the maintainer.

The publication script builds a temporary checkout containing only generated
files, handles the initially absent `gh-pages` branch, and uses a normal push.
It preserves deployment history and refuses concurrent updates instead of forcing
them. Docusaurus 3.10.2's built-in deployment command failed on the first absent
branch, so publication uses this small repository-owned script.

## Validation — 2026-10-06

- Production Docusaurus build passed with strict internal-link checking.
- Eight complete tutorial TypeScript files typechecked; displayed/downloadable
  YAML parsed and framework includes resolved.
- Both complete Serverless examples packaged in an isolated local consuming
  project, including bundled handlers. Packaging resolves AWS configuration but
  does not deploy resources. A flow-style audience expression that produced a
  YAML parser warning was replaced with a portable block list and rechecked.
- Framework builds/typechecks passed; existing offline regression suite passed
  **120 checks** (22 harness, 94 client, 4 authenticated routing).
- Packed-consumer checks passed: legacy constructor/callback compatibility,
  exports/subpaths, declarations, CommonJS runtime and browser bundling.
- Framework dependency audit: **zero vulnerabilities** after removing bisync.
- Guide dependency audit: **28 high reports**, all stemming from the unpatched
  `braces` advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  npm reports no available fix. Patched overrides for tinypool,
  serialize-javascript, postcss-selector-parser and uuid removed the initial
  critical/moderate reports; the production build passes with these overrides.
  This residual issue concerns deeply nested glob input to the build tooling;
  the published static site does not run Node dependency code. Build only trusted
  source, and revisit upstream patches rather than claiming a clean guide audit.
- Browser inspection verified desktop navigation and light/dark rendering.
  Download links were corrected to native anchors, avoiding automatic trailing
  slashes on YAML filenames.

- Mobile inspection at 390px verified reading layout and the expandable navigation
  menu; desktop inspection at 1440px verified sidebar navigation and both themes.
- Published generated files to the new `gh-pages` branch. GitHub Pages is configured
  with source `gh-pages` at `/`, build type `legacy`, and public URL
  **https://selsamman.github.io/aws-classify/**. No repository workflow was added.
- All **18 public pages and both YAML downloads** returned HTTP 200 and matched
  the local production files by SHA-256. Live browser navigation was also checked;
  the final homepage was left open for review. Validation output and a screenshot
  are under ignored `.test-results/`.
- No AWS resources were deployed for this documentation task. Source changes are
  uncommitted; only generated-site publication created/pushed a deployment commit.
  Existing untracked `.DS_Store` files were preserved.
- Repeated publication of the unchanged build detected that the deployed files
  already match and created no additional commit.
- After removing the npm release-status notes, tutorial checks and the production
  build passed again. The revised guide was republished; all 18 public pages and
  both downloads matched the updated local build.
