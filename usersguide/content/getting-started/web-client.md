---
title: Create the web client
description: Create, run, build and publish a React and TypeScript SPA with Vite.
---

Follow [project setup](project-layout.md) to create the root workspaces and
shared request package. If `web` does not yet exist, run from the project root:

```bash
npm create vite@latest web -- --template react-ts
npm install
npm install aws-classify-client @my-app/requests@0.1.0 --workspace web
```

Use a Node version supported by your selected Vite release. The current recipe
uses Node 22.12 or later. Vite is a frontend recipe choice; aws-classify hosting
accepts any build that produces static files.

Replace the generated Vite configuration with:

```typescript title="web/vite.config.ts"
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {'/api': 'http://127.0.0.1:4000'},
  },
});
```

Keep the generated `dev`, `build` and `preview` scripts and Vite client types
(`"types": ["vite/client"]` in `tsconfig.app.json`, or `src/vite-env.d.ts`
in older templates).
Implement your UI in `web/src/App.tsx`. Import the shared requests and create a
client using the relative `/api/dispatch` endpoint as shown in
[your first call](first-call.md). The generated `src/main.tsx` mounts `App`.

Save the [cloud configuration and root scripts](deployment.md), then start the
database, API and Vite together:

```bash
npm run cloud:offline
```

Open `http://127.0.0.1:3000`. The proxy keeps requests on the browser's origin;
the backend runs on port 4000. See [local development](local-development.md)
for backend debugging and authentication.

Build from the root with `npm run build --workspace web`. Vite produces
`web/dist/index.html` and fingerprinted bundles in `web/dist/assets/`. Deploy
and publish using `npm run cloud:deploy:dev`. For subsequent frontend updates:

```bash
npm run build --workspace web
npx aws-classify cloud publish --config cloud/serverless.yml --stage dev --source web/dist
```

The publisher uploads the output, removes obsolete files and invalidates
CloudFront. HTML requires revalidation; fingerprinted `assets/` files receive
long-lived immutable caching. Client-side deep links require hosting rewrites
or hash routing configured by your application.

To keep a public homepage at `/` and move the application under `/app`, follow
[static public pages](../guides/static-pages.md).
