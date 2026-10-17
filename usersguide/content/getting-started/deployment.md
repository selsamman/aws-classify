---
title: Deploy to AWS
description: A complete Serverless configuration for Lambda, API Gateway, sessions and optional static hosting.
---

import Download from '@site/src/components/Download';

Your application supplies the response classes; aws-classify supplies reusable
Serverless resource templates. Let's connect them without requiring a domain
name or certificate.

## Before you deploy

Install the dependencies from [project setup](project-layout.md), configure AWS
credentials for your development account, and complete the normal Serverless
Framework v4 sign-in. Use a unique service name and a supported Lambda runtime.
Your account pays for deployed resources while they exist.

The example below assumes you run Serverless from `cloud`, the root npm install
hoists dependencies to `../node_modules`, and your handlers live in
`cloud/src/responses/index.ts`. If your package manager installs elsewhere,
change `custom.directories.includeFiles` accordingly. Serverless v4's built-in
TypeScript build handles the response source; your frontend keeps its own build.

## Copy this configuration

Save this as `cloud/serverless.yml`. You can also
<Download file="serverless.yml">download the file</Download>.

```yaml title="cloud/serverless.yml"
service: my-classify-app
frameworkVersion: '4'

custom:
  directories:
    responseHandlers: src/responses/index
    includeFiles: ../node_modules/aws-classify-server/yml
  yml: ${self:custom.directories.includeFiles}
  stage: ${opt:stage, 'dev'}
  # A session-table namespace; it does not require a DNS name.
  domainName: ${self:service}-${self:custom.stage}
  # aws-classify-tools supplies the account suffix for cloud commands and uses
  # "local" for offline runs, so this remains fully local-friendly.
  bucketName: ${self:service}-${self:custom.stage}-${env:AWS_CLASSIFY_ACCOUNT_ID, 'local'}
  serverless-offline:
    host: 127.0.0.1
    httpPort: 4000
    websocketPort: 3001
    lambdaPort: 3002
    useInProcess: true
    localEnvironment: true

plugins:
  - serverless-offline

provider:
  name: aws
  runtime: nodejs22.x
  region: ${opt:region, 'us-east-1'}
  websocketsApiRouteSelectionExpression: $request.body.action
  logs:
    websocket:
      fullExecutionData: false
  environment:
    APIG_ENDPOINT: ${file(${self:custom.yml}/apig.yml)}
    DOMAIN: ${self:custom.domainName}
    DD_REGION: ${self:provider.region}
  iam:
    role:
      statements:
        - ${file(${self:custom.yml}/provider-iam.yml)}

functions:
  - ${file(${self:custom.yml}/functions.yml)}

resources:
  - ${file(${self:custom.yml}/resources-website.yml)}
  - ${file(${self:custom.yml}/resources-dynamodb.yml)}
```

This is the authentication-disabled starting configuration. It creates HTTP
dispatch and socket handlers, the DynamoDB session table, and an S3/CloudFront
website. Add [authentication](../guides/authentication.md) before using those
endpoints for protected application operations.

This file is also required by the local-development commands: they resolve it
to discover the handlers and local session-table definition.

## Add local and deployment commands

Install the project tooling at the project root. It is a development dependency:
it is not included in the Lambda deployment artifact and it does not require a
global AWS CLI installation.

```bash
npm install --save-dev aws-classify-tools
```

Add scripts matching this layout to the root `package.json` (adjust `web`,
`cloud`, and the build command if your project uses different directories):

```json title="package.json"
{
  "scripts": {
    "cloud:offline": "aws-classify cloud offline --config cloud/serverless.yml --web web",
    "cloud:offline:backend": "aws-classify cloud offline --config cloud/serverless.yml --backend-only",
    "cloud:offline:debug": "aws-classify cloud offline --config cloud/serverless.yml --web web --debug",
    "cloud:db:init": "aws-classify cloud db:init --config cloud/serverless.yml",
    "cloud:deploy:dev": "npm run build --workspace web && aws-classify cloud deploy --config cloud/serverless.yml --stage dev --publish --source web/dist",
    "cloud:deploy:prod": "npm run build --workspace web && aws-classify cloud deploy --config cloud/serverless.yml --stage prod --publish --source web/dist",
    "cloud:remove:dev": "aws-classify cloud remove --config cloud/serverless.yml --stage dev"
  }
}
```

Before deploying, [run your application locally](local-development.md).
Then deploy with `npm run cloud:deploy:dev`. The tool resolves the Serverless
configuration using Serverless itself, reads the deployed CloudFormation outputs,
uploads the frontend to `ContentBucket`, deletes stale files, and invalidates the
reported `CloudFrontId`. The service name, stack name, bucket, and distribution
are therefore not duplicated in `package.json`.

To update only the frontend after deploying the stack, build it and publish:

```bash
npm run build --workspace web
npx aws-classify cloud publish --config cloud/serverless.yml --stage dev --source web/dist
```

Successful publication writes the stack outputs to `cloud/output.json` by default;
use `--output <path>` on publication to choose another file. Deployment without
`--publish` does not write this file.

Use your frontend's actual output directory if it is not `web/dist`. Open the
reported `WebsiteUrl` and try your first call. The relative `/api/dispatch` URL
now shares the website's origin through CloudFront.

Keep one namespace per deployment stage so development and production sessions
do not share a table. The supplied DynamoDB IAM include grants access to all
tables; production services can narrow it to their session-table ARN as described
in the [configuration reference](../reference/serverless.md).

## Remove a development deployment

Use the matching remove command, which empties the content bucket it discovers
from CloudFormation before removing the stack:

```bash
npm run cloud:remove:dev
```

These commands remove that stage's website and session data. Confirm the names
refer to the development deployment you intend to remove. Your deployment
artifact bucket can also retain files; inspect it after stack removal.

For separate frontend hosting or an existing Serverless service, see
[advanced configuration](../existing-projects.md). The commands above assume
the complete supplied website/API/session-table configuration.

Next, add [notifications](../guides/notifications.md),
[OIDC authentication](../guides/authentication.md), or a
[custom domain](../guides/custom-domain.md).
