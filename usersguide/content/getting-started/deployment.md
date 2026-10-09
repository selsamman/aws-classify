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
  bucketName: ${self:service}-${self:custom.stage}-${aws:accountId}
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

## Build, deploy and upload your frontend

From your project root, build the frontend with its existing build command:

```bash
npm run build --workspace web
```

From `cloud`, resolve the configuration and deploy:

```bash
npx serverless print --stage dev
npx serverless deploy --stage dev
npx serverless info --stage dev --verbose
```

The CloudFormation outputs include `WebsiteUrl` and `CloudFrontId`. Deploying the
stack does not upload your frontend build. With AWS CLI configured, upload that
build to the bucket named by `custom.bucketName`, then invalidate the distribution:

```bash
aws s3 sync ../web/dist s3://YOUR-CONTENT-BUCKET --delete
aws cloudfront create-invalidation --distribution-id YOUR-DISTRIBUTION-ID --paths '/*'
```

Use your frontend's actual output directory if it is not `web/dist`. The upload
command makes that content bucket match the build directory; use the bucket
created for this application. Open `https://<WebsiteUrl>` and try your first call.
The relative `/api/dispatch` URL now shares the website's origin through CloudFront.

The chat example automates the build/upload/invalidation sequence. Its scripts
are an option when you want a runnable starting point; manual deployment is
fully supported.

## Use an existing host or service

If your frontend is already hosted, omit `resources-website.yml` and the bucket
name. Keep the functions and session table, and supply the API URL to the client.
Cross-origin browser calls require an explicit CORS policy; authenticated calls
also need unauthenticated preflight handling. See [existing projects](../existing-projects.md).

Keep one namespace per deployment stage so development and production sessions
do not share a table. The supplied DynamoDB IAM include grants access to all
tables; production services can narrow it to their session-table ARN as described
in the [configuration reference](../reference/serverless.md).

## Remove a development deployment

Empty its content bucket before removing the stack, because CloudFormation
cannot remove a nonempty S3 bucket:

```bash
aws s3 rm s3://YOUR-CONTENT-BUCKET --recursive
npx serverless remove --stage dev
```

These commands remove that stage's website and session data. Confirm the names
refer to the development deployment you intend to remove. Your deployment
artifact bucket can also retain files; inspect it after stack removal.

Next, add [notifications](../guides/notifications.md),
[OIDC authentication](../guides/authentication.md), or a
[custom domain](../guides/custom-domain.md).
