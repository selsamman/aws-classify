---
title: Static public pages alongside a SPA
description: Serve public HTML at the root and an optional application under a separate directory.
---

Public pages and the SPA share one S3 bucket and CloudFront distribution. The
public homepage always lives at `/`; ordinary Sign In links navigate to `/app`.
Authentication and application routing belong to your application. Vite and
Minista are examples here: handwritten HTML or another generator works too.

## Configure the SPA directory

Add this setting to the root `package.json`, alongside `workspaces`:

```json
{"awsClassify": {"spaDirectory": "app"}}
```

Use a relative directory without leading/trailing slashes, such as `app` or
`member/app`. Segments may contain letters, digits, underscores and hyphens;
`api` and its descendants are reserved. The examples assume `cloud/serverless.yml`
is one level below that root package. Both the publisher and hosting resolver
read the same setting; keep this layout or adapt your own hosting configuration.

Add the optional include **after** your existing website include:

```yaml
resources:
  - ${file(${self:custom.yml}/resources-website.yml)}
  - ${file(${self:custom.yml}/resources-static-pages.yml)}
  - ${file(${self:custom.yml}/resources-dynamodb.yml)}
```

With authentication, keep `resources-website-authenticated.yml` as the first
include. The optional include also works with `resources-custom-website.yml`.
It adds a viewer-request function only to the default static behavior; API
behaviors, origins and authorization settings are retained. It replaces the
legacy homepage error fallback with a normal 403 and sets the static cache
policy's minimum/default TTL to zero, so HTML `no-cache` is respected.

Only `/app` and `/app/` rewrite to `/app/index.html`. Query parameters, including
OIDC callback parameters, remain on the request. `/`, `/about.html`, asset URLs,
`/api/*` and SPA deep links are unchanged. Configure application-specific deep
link rewrites yourself or use hash routing. A missing public file must not
silently become a successful homepage response.

## Move the Vite build beneath that directory

Replace `web/vite.config.ts` from the [web-client recipe](../getting-started/web-client.md)
with this complete configuration:

```typescript
import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const {awsClassify: {spaDirectory}} = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  plugins: [react()],
  base: `/${spaDirectory}/`,
  build: {outDir: `dist/${spaDirectory}`},
  server: {
    host: '127.0.0.1', port: 3000, strictPort: true,
    proxy: {'/api': 'http://127.0.0.1:4000'},
  },
});
```

Vite's `base` prefixes generated asset URLs; `outDir` places files at the matching
publish path. Keep the `/api` proxy absolute. If using React Router's
`BrowserRouter`, set `basename={import.meta.env.BASE_URL}`; the router base alone
does not create CloudFront deep-link rewrites. Avoid callback routes that need
extra rewrites: register `https://YOUR_HOST/app` with your identity provider and
use that exact URL as managed authentication's `redirectUri`. After processing
`completeLogin(window.location.href)`, remove callback parameters from history.
When entering without a session, restore authentication or call `beginLogin()`
and navigate using its returned authorization request as in the
[authentication guide](authentication.md). Use `/` as the provider's registered
post-logout URL, and navigate to `/` after local logout. Visiting `/` never
selects a signed-in SPA automatically.

## Optional public-page recipe with Minista

This recipe targets Minista 5 and Node 22.12 or later. Add `"public-site"` to the
root workspaces. Create its package file:

```json title="public-site/package.json"
{
  "name": "public-site",
  "private": true,
  "type": "module",
  "scripts": {"dev": "minista", "build": "minista build"}
}
```

Install from the root:

```bash
npm install --save-dev minista@^5 vite@^8.1 typescript @types/react @types/react-dom --workspace public-site
npm install react@^19 react-dom@^19 --workspace public-site
```

Create `public-site/vite.config.ts`:

```typescript
import {defineConfig, pluginSsg} from 'minista';
export default defineConfig({plugins: [pluginSsg()], build: {outDir: 'dist'}});
```

Create `public-site/tsconfig.json` to use automatic JSX and Minista's types:

```json title="public-site/tsconfig.json"
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "types": ["minista/client"]
  },
  "exclude": ["node_modules", "dist"]
}
```

Minista applies `src/layouts/index.tsx` to each page automatically. Create
`public-site/src/layouts/index.tsx` for the shared document and navigation:

```tsx
import type {LayoutProps} from 'minista/types';
export default function Layout({children}: LayoutProps) {
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head><body>
    <header><nav><a href="/">Home</a> <a href="/about.html">About</a>{' '}
      <a href="/app">Sign In</a></nav></header>
    <main>{children}</main><footer>My application</footer>
  </body></html>;
}
```

Create `public-site/src/pages/index.tsx`:

```tsx
import {Head} from 'minista/head';
export default function Home() {
  return <><Head><title>My application</title>
    <meta name="description" content="Welcome to my application." />
  </Head><h1>Welcome</h1><p>Public information goes here.</p></>;
}
```

Create `public-site/src/pages/about.tsx`:

```tsx
import {Head} from 'minista/head';
export default function About() {
  return <><Head><title>About</title>
    <meta name="description" content="About our application." />
  </Head><h1>About</h1><p>Who we are and what we do.</p></>;
}
```

These pages produce `index.html` and `about.html`.
Use `/about.html` in links: the S3 REST origin does not resolve `/about` or
`/about/` automatically. All public pages are complete documents; their shared
navigation is composed at build time. See Minista's [page routing](https://minista.dev/docs/guide/pages-routing)
and [Head API](https://minista.dev/docs/guide/head).

## Assemble and publish once

Keep the two builds separate. Create `scripts/assemble-site.mjs` in your project:

```javascript
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
const {awsClassify: {spaDirectory}} = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(spaDirectory)
    || spaDirectory.split('/')[0] === 'api') throw new Error('Invalid SPA directory');
rmSync('site-dist', {recursive: true, force: true});
cpSync('public-site/dist', 'site-dist', {recursive: true});
const destination = join('site-dist', spaDirectory);
if (existsSync(destination)) throw new Error('Public output collides with SPA directory');
mkdirSync(destination, {recursive: true});
cpSync(join('web/dist', spaDirectory), destination, {recursive: true});
```

Add a root script:

```json
{"scripts": {"build:site": "npm run build --workspace public-site && npm run build --workspace web && node scripts/assemble-site.mjs"}}
```

Run from the root:

```bash
npm run build:site
npx aws-classify cloud deploy --config cloud/serverless.yml --stage dev --publish --source site-dist
```

For subsequent frontend changes, run `build:site` and `cloud publish` with the
same `--source site-dist`. Update existing deployment scripts to use these too.
Never publish either partial build: the publisher deletes keys missing from its
source directory. Assembly happens after both builds finish, so cleaning either
build cannot erase the other. Expect:

```text
site-dist/index.html
site-dist/about.html
site-dist/app/index.html
site-dist/app/assets/<fingerprinted files>
```

The publisher gives HTML `Cache-Control: no-cache`, even inside `assets/`.
Root `assets/` and configured `app/assets/` non-HTML files get
`public, max-age=31536000, immutable`; other files require revalidation. Only put
fingerprinted files in those asset directories.

## Develop and verify

For SPA/API work, use `npm run cloud:offline` and open
`http://127.0.0.1:3000/app/`. For public-page editing, run
`npm run dev --workspace public-site -- --port 3003`. This separate server does
not serve the SPA: use port 3000 for application/authentication testing. Local
provider callback URLs must be registered separately from deployed URLs.

To test one origin before deployment, assemble the site and serve `site-dist`
with a static server that supports directory indexes. Proxy `/api` to port 4000
if testing backend calls. This is a preview of the files; CloudFront is the
final check for the entry rewrites and preserved error status.

After deployment, check `/` and `/about.html` show public documents,
`/app?code=...&state=...` and `/app/` serve the SPA without changing the browser
URL, and `/app/assets/...` returns the actual bundle. Check response headers
with `curl -I`: HTML must require revalidation and fingerprinted bundles must
be immutable. Check a missing public file remains an error, `/api/dispatch`
continues to reach the API, and protected API requests still require credentials.
Complete login at `/app`, then logout back to `/`.
