# aws-classify adoption report — 2026-10-20

## Result

The guide-supported workspace builds and deployed successfully with a disposable Cognito provider. The requested prefix contained Cognito's reserved word `aws`, so the user approved the disposable substitute `acd-20261018-k8r3-login`. Public/protected routing, managed PKCE login, persisted state, authenticated socket attachment/notification, validation handling and logout were exercised in a browser. The stack and provider were then removed and their absence verified.

## Evidence matrix

| Scenario | Result | Evidence |
|---|---|---|
| Install/typecheck/production bundle | PASS | `npm run build` completed: Vite bundled 153 modules; cloud `tsc --noEmit` passed. |
| Browser app opens in local mode | PASS | Opened at `http://127.0.0.1:5173/`; screen displayed session label and all controls. |
| Anonymous public request | PASS | Browser result: `public ping: "public ok 2026-10-19T21:08:55.015Z"`. |
| Protected call, validation error, persistence | PASS | After `docs-user-a` login, protected get returned 0; invalid count returned `Please supply a finite number`; after set/reload protected get returned 7. |
| Separate A/B, peer send and state update | NOT RUN | Fixture intentionally has no recipient-pairing operation; it does not enumerate or accept arbitrary client-supplied session IDs. |
| Socket attach and server notification | PASS | Authenticated `initSocket()` returned true; a subsequent set returned success and displayed `notification received: server count changed to 7`. |
| Socket disconnect/reconnect/replay and replacement attachment | NOT RUN | Not completed; no delivery queue is expected from the guide. |
| Public/protected wrong-route behavior | NOT RUN | Requires the remaining local test sequence. |
| Real Cognito login, scope and logout | PASS | Hosted-UI code+S256 PKCE callback completed; protected call succeeded, local logout cleared the protected session, and public ping still succeeded. Refresh was not due; A/B ownership was not completed. |
| Deploy CloudFront/API | PASS | Stack `aws-classify-docs-20261018-k8r3-acceptance` deployed; CloudFront `da8n0kk3kl8il.cloudfront.net` served the Cognito-configured screen. |
| Frontend-only republish / documented output discovery | FAIL | `aws-classify cloud publish` failed: `must output ContentBucket and CloudFrontId`; CloudFormation stack outputs were empty. |
| Cleanup | PASS | `cloud remove` emptied the run-owned content bucket and deleted the stack; later CloudFormation lookup returned `ValidationError`. Standalone `cleanup` removed the Cognito domain, app client, resource server and pool and verified pool absence. |

## Commands actually executed

Published framework packages resolved to `0.2.3`; Vite resolved to `8.3.4`; AWS SDK clients resolved to `3.1153.0`. `npm install` with bundled npm 10 crashed (`edgesOut`); the temporary npm 11.6.3 runner succeeded. The deployed run initially returned 500 because this fixture added an unguideed cloud-package ESM setting; removing it fixed the Lambda's CommonJS DynamoDB dependency and the public route passed.

No AWS application stack, S3 bucket, CloudFront distribution, DynamoDB table, users, credentials, tokens, or persistent Cognito resources remain from this run. Local runner processes should be stopped before a later session starts a new one.

## Documentation issues and workarounds

| Type | Guide page/section | Attempt and observed result | Proposed correction |
|---|---|---|---|
| Missing instruction | **Add browser login → Register the browser app** | The guide names Cognito as validated but gives no Cognito pool/client/domain/resource-server provisioning instructions. The assignment required external official AWS documentation and a script. | Add a minimal Cognito bootstrap appendix: pool, public no-secret client, code/S256, scopes, domain, test users, cleanup. |
| Provider/bootstrap gap | **Add browser login → Register the browser app** | Guide says register exact CloudFront callback, but provider must exist before deployment and Cognito refuses code flow with an empty callback (`InvalidOAuthFlowException`). Cognito also rejected the original prefix because it contains `aws`. | State Cognito requires a temporary callback at client creation and it must be replaced before test; warn that provider domain rules may reject chosen prefixes. |
| Contradiction | **Add browser login → Protect the backend** vs **Run locally → Start a working local environment** | Authenticated replacement YAML uses `${aws:accountId}`; offline run tried the ambient invalid credentials rather than using a local suffix. | Use the same documented `${env:AWS_CLASSIFY_ACCOUNT_ID, 'local'}` form in the authenticated YAML, or explicitly document the required local override. |
| Missing executable detail | **Run locally → Developing with authentication enabled** | It says `serverless offline --noAuth`; the guide's project command invokes `aws-classify cloud offline` and does not show how to pass that switch through. | Show the exact project script/argument syntax for `--noAuth`. |
| Apparent tooling/environment defect | Local runner | Serverless Offline emitted an `ERR_MODULE_NOT_FOUND` for `tsx/dist/esm/api/esm/index.mjs` while loading the TypeScript handler, though the public call returned successfully. | Pin/test the tool's tsx/Serverless Offline combinations and document supported Node/tsx versions. |
| Documentation/framework integration failure | **Deploy to AWS → Build, deploy and publish your frontend** | The documented frontend-only publish command failed because the generated stack did not output `ContentBucket` or `CloudFrontId`; CloudFormation outputs were empty. | Ensure the shipped authenticated website template exports those exact outputs, and add a post-deploy assertion to the guide. |

## Outside information/workarounds

Only the AWS SDK API documentation was used for disposable Cognito provisioning; all aws-classify setup/API/authentication/notifications/deployment details came from the supplied guide. Workarounds: npm 11.6.3 temporary runner due npm 10 resolver crash; temporary Cognito callback (required by AWS); substitute provider prefix approved by the user; guide's local bucket-account suffix to avoid live account lookup offline. No framework source, tests, sample source, or internal documentation was inspected.
