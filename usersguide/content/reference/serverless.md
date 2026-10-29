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
| `functions-authenticated.yml` | Protected/public HTTP dispatch and owned socket handlers; validates required authorizer configuration |
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
```

The name must refer to an authorizer defined under `provider.httpApi.authorizers`.
The scopes list is optional and uses Gateway's at-least-one/OR semantics. Choose
issuer/audience/scope requirements that admit API access tokens. Public methods
use `@Public()` on the shared request class or matching explicit `publicMethods`
lists on the client and server; method names do not determine public access.

The functions include enables authentication on each framework handler through
`AWS_CLASSIFY_AUTHENTICATION=true`. Its resolver
rejects absent authorizer definitions and unsafe full WebSocket execution tracing.
Keep `provider.logs.websocket.fullExecutionData: false`.

For an application-owned background notification Lambda, set `AWS_CLASSIFY_AUTHENTICATION=true`
too, and supply the same session namespace and WebSocket endpoint. The normal
functions include does not automatically configure unrelated producer Lambdas.

## Permissions

`resources-dynamodb.yml` creates the session table, without granting public access.
The supplied `provider-iam.yml` grants its listed operations only on
`AWSClassifySessionTable` and its indexes. Include it in
`provider.iam.role.statements` to give the default service execution role the
framework permissions. Its statement is equivalent to:

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

Serverless Framework automatically adds `execute-api:ManageConnections` to the
default service role when the service has WebSocket events. A background Lambda
using that shared role inherits the DynamoDB include and WebSocket permission;
it normally needs no extra IAM statements. A custom role or separate service
must receive its own table and WebSocket management permissions. Table creation,
API Gateway's permission to invoke a Lambda, and a producer's permission to send
a notification are separate concerns.

See [background notifications](../guides/notifications.md#notify-from-background-work)
for a complete producer example, its environment settings, and a narrower
notification-only policy. See also
[Serverless IAM behavior](https://www.serverless.com/framework/docs/providers/aws/guide/iam).

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
Use the tools commands in
[deployment](../getting-started/deployment.md). If you already host the client,
follow [advanced configuration](../existing-projects.md) for API origin/CORS
and deployment/removal commands without the supplied website.

For authenticated custom-domain hosting, maintain an application copy of the
authenticated resource template with the domain/certificate/DNS additions.
There is no stock authenticated custom-domain include. See
[custom domains](../guides/custom-domain.md) for the current validation boundary.
