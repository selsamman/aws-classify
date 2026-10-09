---
title: Contracts and serialization
description: Define shared request methods and serialize data consistently across client and server.
---

Request classes belong in your shared workspace. They describe method names,
arguments and return types; implementations belong on the side that executes
them.

## Request class rules

- Give every class a stable, unique static `interfaceName`.
- Define exposed methods directly on that request class's prototype.
- Use `reqBody()` from `aws-classify-common` as the placeholder body.
- Extend the request class to implement server methods or client notifications.
- Export shared classes through the workspace package's entry point.

The framework creates call proxies, so don't instantiate a request with `new`
and expect its placeholders to make network calls. Use the client/server creation
helpers.

## Data and class instances

The framework uses `js-freeze-dry` for serialization. Plain values and objects
are the simplest contracts. Class instances and cyclic object graphs can also
be represented with consistent serializer registration/class maps.

```ts
import {serializable} from 'js-freeze-dry';

class Message {
    text = '';
}
serializable({Message});
```

For custom payload classes, import/register them on both sides and supply the
class map to the relevant proxy/socket/notification APIs when needed. Register
persisted response classes using the same object form. Keep constructors safe
for restoration: avoid performing side effects or requiring arguments.

Do not store SDK clients, open connections, access tokens or per-request identity
in serialized response fields. Put durable application data in your own storage
when it needs transactions, large datasets or lifecycle independent of sessions.

## Public and protected members

In authenticated mode the configured suffix marks anonymous methods, for
example `getVersionPublic()`. The server enforces the entry point independently:
a public route cannot call a protected method, and the protected route cannot
call a public-suffixed method. `$WebSocket.$authorize` is always protected.

TypeScript types are helpful to developers, but incoming data still crosses a
network boundary. Validate it in server response methods and apply application
permission checks from trusted context.

## Errors and notifications

Response-method exceptions become rejected client promises. See
[error handling](errors.md). Server-to-client notification methods are sends;
they do not return the result of the client callback or provide a delivery queue.
See [notifications](../guides/notifications.md) for the full flow.
