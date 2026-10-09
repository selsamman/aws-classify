---
title: Publish the three packages together
description: Choose one version and release common, client and server through one GitHub workflow.
---

The three libraries share a release version. You choose that number once;
the release tools update the package files and the workflow publishes them
together. The private repository, test workspaces and user guide are not
published to npm.

## Configure publishing once

Each library's `package.json` identifies the same GitHub repository using
`repository.url`, with `repository.directory` pointing to its workspace folder.
The repository URL must match the GitHub repository running the publish workflow.
If you maintain a fork, update this metadata as well as the trusted publisher
settings below.

For each npm package—`aws-classify-common`, `aws-classify-client` and
`aws-classify-server`—configure a GitHub trusted publisher with these values:

| Setting | Value |
| --- | --- |
| Organization or user | `selsamman` |
| Repository | `aws-classify` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty; this workflow does not use a GitHub environment |
| Allowed actions | Enable both **npm publish** and **npm dist-tag** |

The workflow uses npm 11.21.0 on Node 24 and obtains npm authorization through
GitHub OIDC. It does not need an npm token secret. Direct publishing and tag
management are separate npm permissions; see
[npm trusted publisher setup](https://docs.npmjs.com/trusted-publishers/).

Add a GitHub repository Actions secret named `SERVERLESS_ACCESS_KEY` for the
Serverless v4 offline tests. Obtain it through your Serverless account; put the
value in GitHub's secret settings. The tests use local services and dummy AWS
credentials. This release workflow does not deploy AWS resources.

## Choose the version

From the repository root, set an unpublished version:

```bash
npm run release:version -- 0.2.0
npm run release:check
```

The first command updates all three library `version` fields, every workspace
reference to those libraries, and the root lockfile. Client and server depend on
the **exact same version** of common. The command leaves private package versions
alone and does not create a Git commit or tag.

For the next release, supply the next number, such as `0.2.1`. You do not need to
edit six dependency references by hand. The checker rejects mismatched versions,
stale references and lockfile drift.

## Check and publish a release

```bash
npm run typecheck
npm test
npm run test:release
npm run test:packed
npm run audit
npm run release:publish -- --dry-run
```

The dry run packs and checks all three libraries and simulates npm publication.
It does not upload versions or change distribution tags. Review the generated
tarballs and manifest under `.test-results/release/<version>/` if needed.

Commit and push the version changes, lockfile, release scripts and workflow.
Then create and **publish a GitHub Release** with a tag matching the version:
`v0.2.0` for `0.2.0`. Point the tag at the commit you checked. A draft release or
ordinary push does not publish packages.

The workflow repeats the checks, then:

1. Builds and packs all three packages from the same release commit.
2. Checks registry versions and contents before the first upload.
3. Publishes common, client and server under `release-<version>`.
4. Verifies that all three uploaded versions match the packed contents.
5. Points all three `latest` tags at that version.

Only one release job runs at a time. GitHub retains the tarballs and manifest
as an Actions artifact, including after a failed publishing attempt.

## Recover a failed run

Fix the reported configuration or service error, then **rerun the failed GitHub
workflow for the same release**. Already uploaded packages are skipped only when
their integrity matches the newly built tarballs. Different contents at an
existing version require a new version; npm versions are immutable.

npm may take several minutes to process successful uploads. The publisher waits
up to ten minutes for all three versions to become visible before updating tags.
If it times out, wait for npm processing to finish, then open the failed run in
GitHub Actions and choose **Re-run failed jobs**. Ensure **Allow npm dist-tag** is
enabled for each package's trusted publisher; permission to publish alone does
not allow updating `latest`. You do not need a new release or package version
when the uploaded contents already match.

An upload failure leaves `latest` unchanged. npm performs uploads and tag changes
as individual operations, so this is not an atomic transaction. A failure during
the final tag updates can briefly leave the three `latest` tags mixed; the same
rerun finishes those updates without republishing identical packages. A rerun of
an older release refuses to move a tag backwards past a newer version.

Keep the same release commit when recovering. If the source needs changing,
choose a new synchronized version and create a new release.

## Publish a prerelease

Use a version such as `0.3.0-rc.1`, tag it `v0.3.0-rc.1`, and mark the GitHub
Release as a prerelease. It follows the same process but promotes **`next`**,
leaving `latest` alone. The checker requires the GitHub prerelease setting and
version to agree. To promote stable code, choose its stable version and publish
a matching stable GitHub Release.
