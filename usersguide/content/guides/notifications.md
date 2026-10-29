---
title: Send a notification back
description: Let a Lambda call a method implemented in the browser or mobile client.
---

Sometimes the server has news before the client asks: a message arrives, a job
finishes, or another user changes something. A client request class describes
what the server can tell the client, just as a server request class describes
what the client can ask the server.

## Define the notification contract

```ts title="common/requests/CounterClientRequest.ts"
import {reqBody} from 'aws-classify-common';

export class CounterClientRequest {
    static interfaceName = 'CounterClientRequest';
    async countChanged(count: number): Promise<void> { return reqBody(); }
}
```

Export it from `common/requests/index.ts`, alongside `CounterRequest`.

## Register a client implementation

```ts title="web/src/responses/CounterClientResponse.ts"
import {CounterClientRequest} from '@my-app/requests';

export class CounterClientResponse extends CounterClientRequest {
    async countChanged(count: number): Promise<void> {
        // Update your application's UI or store here.
        console.log('The server sent a new count:', count);
    }
}
```

Register the implementation before opening the socket:

```ts
import {client} from './classify';
import {CounterClientResponse} from './responses/CounterClientResponse';

client.createResponse(CounterClientResponse);
const opened = await client.initSocket();
if (!opened) throw new Error('Could not open the notification connection');
```

`initSocket()` first asks the HTTP backend to authorize a connection, then opens
the returned WebSocket URL. It saves the application session before connecting.
With authentication enabled, the handshake uses a short-lived, single-use
connection credential instead of treating the session ID as permission.

## Send from a response method

Register `CounterClientRequest` in the backend's handler module:

```ts
import {classifyServerless} from 'aws-classify-server';
import {CounterClientRequest} from '@my-app/requests';

classifyServerless.registerRequest(CounterClientRequest);
```

Then update the counter implementation's `setCount()` method:

```ts
async setCount(count: number): Promise<void> {
    if (!Number.isFinite(count)) throw new Error('Please supply a number');
    this.count = count;
    const notification = classifyServerless.createRequest(this, CounterClientRequest);
    await notification.countChanged(count);
}
```

Import both names into that module. Open the socket before calling this method.
Await the notification send so its failure reaches the caller. Decide whether
your application should fail the operation, retry, or save a message for later
when a recipient is disconnected. The framework does not provide a delivery queue.

## Notify from background work

A Step Functions task, scheduled Lambda or other IAM-authorized background job can
send to a trusted application session ID. It does not need an HTTP or WebSocket
event. Step Functions invokes the Lambda directly; the notification helper then
uses API Gateway's IAM-authorized WebSocket management API to reach the browser.

### Add a producer to the same Serverless service

Keep the authenticated configuration from [browser login](authentication.md),
including its provider environment, IAM include and session-table resource. Add
this entry alongside the framework functions in the existing `functions` list:

```yaml
functions:
  - ${file(${self:custom.yml}/functions-authenticated.yml)}
  - backgroundNotify:
      handler: src/notifications.handler
      environment:
        AWS_CLASSIFY_AUTHENTICATION: 'true'
```

The producer inherits `DOMAIN`, `APIG_ENDPOINT` and `DD_REGION` from
`provider.environment`. These identify the same session table, WebSocket API/stage
and region as the dispatch service. The authentication flag must be set explicitly:
`functions-authenticated.yml` sets it on the framework handlers, not on unrelated
application functions. Do not set `IS_OFFLINE` on deployed functions.

```ts title="cloud/src/notifications.ts"
import {classifyServerless} from 'aws-classify-server';
import {CounterClientRequest} from '@my-app/requests';

// Registration is required in this Lambda process too.
classifyServerless.registerRequest(CounterClientRequest);

export async function handler(event: {sessionId: string; count: number}): Promise<void> {
    const notification = await classifyServerless.createRequestForSession(
        event.sessionId,
        CounterClientRequest,
    );
    await notification.countChanged(event.count);
}
```

Get the session ID server-side with `classifyServerless.getSessionId(this)` in the
authorized application method that starts the job. Preserve it in the workflow
input and invoke this handler with `{sessionId, count}`. Your application must
authorize the job and its recipient; do not let a caller choose an arbitrary
notification session. No browser access token, fabricated user identity, public
HTTP endpoint or Lambda resource-policy grant to API Gateway is needed for this
producer. The workflow's execution role needs `lambda:InvokeFunction` on this
Lambda; that is separate from the Lambda's own execution permissions.

### Understand the inherited permissions

`resources-dynamodb.yml` creates the table; it does not make it publicly readable
or writable. AWS checks IAM permissions for table operations.
`provider-iam.yml` grants the framework's DynamoDB operations only on
`AWSClassifySessionTable` and its indexes. In the default shared-role setup, an
application Lambda in the same service inherits those grants.

Serverless Framework also adds `execute-api:ManageConnections` to the default
service role when the service contains WebSocket events, as the framework's
functions do. A producer using that same role therefore normally needs **no
additional DynamoDB or WebSocket IAM statement**. The framework's authenticated
AWS fixture uses this pattern in
[`tests/server/serverless-auth.yml`](https://github.com/selsamman/aws-classify/blob/master/tests/server/serverless-auth.yml)
with its `backgroundNotify` function. See
[Serverless IAM behavior](https://www.serverless.com/framework/docs/providers/aws/guide/iam).

### Use a separate role or service

A custom execution role does not automatically inherit `provider-iam.yml` or the
default role's WebSocket grants. A Lambda in another service also needs the
original service's session namespace, table region and management endpoint.

For the notification-only `createRequestForSession()` path above, add these
statements to the producer's execution role, alongside its normal logging
permissions. This example references resources in the same stack; for another
stack, supply the original table ARN and WebSocket API ID/stage through your
application's deployment configuration.

```yaml
- Effect: Allow
  Action: dynamodb:GetItem
  Resource: !GetAtt AWSClassifySessionTable.Arn
- Effect: Allow
  Action: execute-api:ManageConnections
  Resource:
    Fn::Sub: 'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${WebsocketsApi}/${sls:stage}/POST/@connections/*'
```

`createRequestForSession()` and the authenticated send read the session and current
connection; they do not update application session state. If the producer also
uses `createResponse()` to restore and save state, or uses other session helpers,
grant the additional DynamoDB operations those helpers need. The full framework
IAM include is suitable for the standard shared role.

The SDK signs notification requests with the Lambda execution-role credentials.
This IAM permission is distinct from the browser's token and socket credential.
See [AWS WebSocket management authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-control-access-iam.html).

### Handle completion independently of delivery

Persist the authoritative job result before attempting the notification. Missing
or expired sessions, disconnected clients and transport failures reject the send.
Decide whether to record the failure, retry or queue a message in application
code; a notification failure should not turn a successfully encoded artifact into
an encoding failure. The framework does not queue or replay notifications, and a
successful send is not an acknowledgment that the browser processed it.

## Reconnect and resume

Once a socket closes, `initSocket()` can establish another attachment. In
authenticated mode each reconnect needs a current access token and obtains a
new single-use credential. The latest successful connection becomes the
notification destination for that session.

Use `onDisconnect()` to schedule a retry with backoff while your application is
active. Do not retry indefinitely after logout or a login-required error.
Notifications are not automatically replayed, so refresh application state after
reconnecting if missing an update matters.

See [the client reference](../reference/client.md) for connection callbacks and
[the server reference](../reference/server.md) for alternate-session helpers.
