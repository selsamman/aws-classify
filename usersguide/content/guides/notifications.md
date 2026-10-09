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

An IAM-authorized Lambda or job can send to a trusted application session ID:

```ts
const notification = await classifyServerless.createRequestForSession(
    trustedSessionId,
    CounterClientRequest,
);
await notification.countChanged(42);
```

Register the client request in that producer process too. In authenticated mode,
configure its framework authentication mode and session-table/socket environment
consistently with the dispatch service, so it applies owned-session checks.
It needs DynamoDB access and `execute-api:ManageConnections` for the WebSocket
API. It does not need to retain a browser access token or fabricate a user
identity. Your application decides which recipients a producer may target.

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
