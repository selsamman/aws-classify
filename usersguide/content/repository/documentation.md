---
title: Maintain and publish the guide
description: Build the standalone Docusaurus site and publish its generated files to GitHub Pages.
---

The site source lives in `/usersguide`. It is a standalone private npm project,
not a package published to npm or an additional framework workspace. “Private”
here describes npm publication; the GitHub Pages guide is public.

## Run and preview

From the framework repository root:

```bash
npm run guide:install
npm run guide:dev
```

For a production preview:

```bash
npm run guide:check
npm run guide:build
npm run guide:serve
```

`guide:check` compiles the complete tutorial TypeScript files against the built
framework declarations and checks the copyable configuration files. Build the
framework first with `npm run build` if those declarations are not present.
Docusaurus fails the build on broken internal links. Check navigation and code
examples in the production preview before publication.

`guide:build` generates downloadable YAML from the tutorial's code blocks, keeping
the copy buttons and downloadable files in agreement. The generated website is
ignored by Git; source, configuration, maintenance scripts and the guide lockfile
are tracked.

## Where content belongs

| Location | Content |
| --- | --- |
| `usersguide/content/getting-started` | Friendly step-by-step manual setup |
| `usersguide/content/existing-projects.md` | Incremental adoption in an existing application |
| `usersguide/content/guides` | Optional features and platform-specific instructions |
| `usersguide/content/reference` | APIs and configuration lookup |
| `usersguide/content/repository` | Working on the framework and publishing documentation |
| `docs` | Architecture, security boundaries, implementation decisions and validation records |

The root/package READMEs are short introductions linking to this public guide.
There is no README/source synchronization or bisync dependency.

## Publish to GitHub Pages

The project site is configured for `https://selsamman.github.io/aws-classify/`,
with base path `/aws-classify/`. Publication builds Docusaurus and sends the
generated site to `gh-pages`. It does not publish library packages to npm.

With GitHub write access configured, run:

```bash
npm run guide:publish
```

The command builds the current guide, creates a commit containing generated site
files on the deployment branch, and pushes that branch. It does not commit the
documentation source on your working branch. The publishing script handles the
first deployment and uses a normal push that preserves deployment history and
refuses to overwrite a concurrent publication. On the first publication, configure
repository **Settings → Pages → Deploy from a branch**, select `gh-pages` and
the root directory. Then verify the public homepage and a nested documentation
link after GitHub finishes its deployment.

Use a Git credential helper or SSH configuration; do not put credentials into
the guide, URLs or repository files. No AWS deployment workflow is needed for
this site. If a Pages workflow is introduced later, keep it specific to the
documentation build and explicitly configure that publication source.

See [Docusaurus deployment](https://docusaurus.io/docs/deployment) and
[GitHub Pages publication sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
