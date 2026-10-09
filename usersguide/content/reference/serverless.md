---
title: Serverless configuration
description: The required variables, includes, environment values and optional hosting pieces.
---

Start with the complete [basic configuration](../getting-started/deployment.md)
or [authenticated configuration](../guides/authentication.md). This page explains
which pieces to retain when integrating them into another service.

## Required variables

| Configuration | Purpose |
| --- | --- |
| `custom.directories.responseHandlers` | Handler module path without extension; that module exports handlers and registers response classes |
| `custom.yml` | Directory containing the installed framework's YAML includes |
| `custom.domainName` | Session-table namespace used by the DynamoDB resource template |
| `custom.bucketName` | Content bucket name when using a supplied website template |
| `provider.environment.DOMAIN` | Must match `custom.domainName` for session-store access |
| `provider.environment.APIG_ENDPOINT` | WebSocket management endpoint from `apig.yml` |
| `provider.websocketsApiRouteSelectionExpression` | `$request.body.action` for the supplied socket setup |

`DOMAIN` is a namespace, not an assertion that a domain exists. Use a value
unique to the application/stage. Keep service/bucket names within AWS length and
character requirements. The starter app includes stage/account in its bucket name.

## YAML includes

| File | Use |
| --- | --- |
| `functions.yml` | Original unauthenticated HTTP/socket handlers |
| `functions-authenticated.yml` | Protected/public HTTP dispatch and owned socket handlers; validates required authorizer/suffix configuration |
| `resources-dynamodb.yml` | Session table, TTL and application user association index |
| `provider-iam.yml` | DynamoDB operations used by the session store, including deletion |
| `apig.yml` | WebSocket API/stage endpoint expression |
| `resources-website.yml` | Default CloudFront hostname and S3 website for unauthenticated mode |
| `resources-website-authenticated.yml` | Default-hostname hosting with Authorization forwarding, no API caching and preserved 403 errors |
| `resources-custom-website.yml` | Existing unauthenticated custom-domain hosting with ACM/Route 53 |
| `custom-cloudfront.yml` | Invalidation settings for consumers using a compatible invalidation plugin; not an upload/build command |

The session table uses `sessionId` as its partition key and `expires` for TTL.
The `userId` index is an application association; it is not authenticated ownership.
Authenticated owner and connection metadata are maintained separately by the
framework. Do not modify them through application session fields.

## Authentication opt-in

```yaml
custom:
  awsClassify:
    authorizer:
      name: applicationJwt
      scopes: [example/invoke]
    publicSuffix: Public
```

The name must refer to an authorizer defined under `provider.httpApi.authorizers`.
The scopes list is optional and uses Gateway's at-least-one/OR semantics. Choose
issuer/audience/scope requirements that admit API access tokens. Configure the
same suffix on the client. The suffix must match `^[A-Za-z][A-Za-z0-9_]*$`.

The functions include enables authentication on each framework handler through
`AWS_CLASSIFY_AUTHENTICATION=true` and `AWS_CLASSIFY_PUBLIC_SUFFIX`. Its resolver
rejects absent authorizer definitions and unsafe full WebSocket execution tracing.
Keep `provider.logs.websocket.fullExecutionData: false`.

For an application-owned background notification Lambda, set these mode variables
too, and supply the same session namespace and WebSocket endpoint. The normal
functions include does not automatically configure unrelated producer Lambdas.

## Permissions

The supplied DynamoDB IAM include grants its listed operations on `"*"`. In a
service with the supplied table, you can scope an application-owned statement:

```yaml
provider:
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
          Resource:
            - !GetAtt AWSClassifySessionTable.Arn
            - !Join ['', [!GetAtt AWSClassifySessionTable.Arn, '/index/*']]
```

Keep `execute-api:ManageConnections` permission for notification senders.
Serverless configures the WebSocket service permissions in the stock setup;
an independent producer role needs its own access to the relevant API/stage.

## Development environment

| Variable | Use |
| --- | --- |
| `DD_ENDPOINT` | Optional DynamoDB endpoint override; use a local endpoint for offline development |
| `DD_REGION` | DynamoDB client region override |
| `IS_OFFLINE` | Set by the local runner/Serverless Offline; never enable in deployed production functions |

Supply local dummy AWS SDK credentials and create the table before local requests.
Offline mode also uses the local WebSocket management port 3001. If you change
local ports, account for the framework's current local endpoint behavior.

## Hosting and existing applications

Website templates create resources but do not compile or upload your frontend.
Use your existing build/deployment scripts or the manual commands in
[deployment](../getting-started/deployment.md). If you already host the client,
omit website resources and configure the API origin/CORS instead.

For authenticated custom-domain hosting, maintain an application copy of the
authenticated resource template with the domain/certificate/DNS additions.
There is no stock authenticated custom-domain include. See
[custom domains](../guides/custom-domain.md) for the current validation boundary.
