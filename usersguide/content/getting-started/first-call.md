---
title: Make your first call
description: Define a shared request class, implement it in Lambda and call it from the browser.
---

Let's save a number on the backend and read it from the browser. We need three
pieces: a shared request class, its server implementation, and a client proxy.

## Define what the client can ask for

```ts title="common/requests/CounterRequest.ts"
import {reqBody} from 'aws-classify-common';

export class CounterRequest {
    static interfaceName = 'CounterRequest';

    async setCount(count: number): Promise<void> { return reqBody(); }
    async getCount(): Promise<number> { return reqBody(); }
}
```

```ts title="common/requests/index.ts"
export {CounterRequest} from './CounterRequest';
```

The method bodies are placeholders. `reqBody()` throws if a request has not been
registered; the framework replaces these methods on the client proxy. Use a
unique, stable `interfaceName` for each request class.

## Implement the response in Lambda

```ts title="cloud/src/responses/CounterResponse.ts"
import {CounterRequest} from '@my-app/requests';
import {serializable} from 'js-freeze-dry';

export class CounterResponse extends CounterRequest {
    count = 0;

    async setCount(count: number): Promise<void> {
        if (!Number.isFinite(count)) throw new Error('Please supply a number');
        this.count = count;
    }

    async getCount(): Promise<number> {
        return this.count;
    }
}

serializable({CounterResponse});
```

The fields on the response object are application session state. With the
session table configured, the framework restores them before a call and saves
them afterward. `serializable({CounterResponse})` registers the class with the
serializer; use the object form shown here.

Now export the framework handlers and register your implementation:

```ts title="cloud/src/responses/index.ts"
export {
    responseHandler,
    webSocketConnect,
    webSocketDisconnect,
} from 'aws-classify-server';

import {classifyServerless} from 'aws-classify-server';
import {CounterResponse} from './CounterResponse';

classifyServerless.registerResponse(CounterResponse);
```

One dispatch handler serves all registered request classes. Adding another
class or member does not require a new API Gateway route.

## Connect the browser

```ts title="web/src/classify.ts"
import {ClassifyClient} from 'aws-classify-client';
import {CounterRequest} from '@my-app/requests';

const sessionKey = 'my-app-session';
export const client = new ClassifyClient(
    async () => sessionStorage.getItem(sessionKey) || '',
    async id => { sessionStorage.setItem(sessionKey, id); },
    '/api/dispatch',
);

export const counter = client.createRequest(CounterRequest);
```

Call the proxy from a button handler or your application's startup code:

```ts
import {counter} from './classify';

await counter.setCount(7);
const count = await counter.getCount();
console.log(count); // 7
```

`getSession` and `setSession` store only the application session ID, not the
counter fields. An empty string starts a new session. Saving that ID lets the
same tab keep its state across page reloads. Each tab uses its own session here;
other persistence choices are explained in the [client reference](../reference/client.md).

Errors from response methods reject the client call, so handle them as you
would any other asynchronous operation. TypeScript describes the contract;
your server implementation still validates input.

These calls need a running backend. Continue with
[local development](local-development.md) or [AWS deployment](deployment.md).
