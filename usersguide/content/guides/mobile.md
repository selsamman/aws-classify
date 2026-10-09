---
title: Add a mobile client
description: Use the same request contracts from a React Native or Expo application.
---

The shared request classes can serve both a web application and a mobile client.
Each client implements its own UI, persistence and notification response methods.
The [chat example](../examples.md) demonstrates this with Expo.

## Add the mobile workspace

Add `mobile` to the root workspace list, then install the client and your shared
requests package there:

```bash
npm install aws-classify-client @my-app/requests@0.1.0 --workspace mobile
```

Use the Node/Expo versions required by your mobile toolchain. Follow the example's
mobile README for device startup; those requirements can differ from the framework
repository's build requirements.

## Persist the application session

For React Native, asynchronous storage replaces browser `sessionStorage`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ClassifyClient} from 'aws-classify-client';

const client = new ClassifyClient(
    async () => (await AsyncStorage.getItem('my-app-session')) || '',
    async id => { await AsyncStorage.setItem('my-app-session', id); },
    'https://YOUR-API/api/dispatch',
);
```

Install the storage package through your Expo/React Native tooling. The server
session ID is independent of local UI state. Store it only as long as you want
the corresponding application session to be reused.

## Connect from a device

`127.0.0.1` on a physical device refers to the device, not your computer. For
offline development use the computer's reachable LAN address and configure the
backend's returned WebSocket endpoint consistently. The chat example's mobile
startup scripts handle its local API mode; follow its device instructions.

Create request proxies and register notification response classes the same way
as on the web. Open the socket when the app is active and reconnect with backoff
when necessary. Mobile operating systems can suspend background connections;
refresh state when resuming because notifications are not a durable delivery queue.

## Authentication on mobile

Managed `beginLogin()`/`completeLogin()` uses browser `sessionStorage`, Web Crypto
and query-mode navigation. It does not implement native mobile OAuth redirects.
Use a suitable platform authentication library, then supply the current access
token through [external-token mode](authentication.md#use-an-authentication-library-you-already-have).
Keep your protected session-ID storage separate from anonymous/public sessions,
clear it on account changes, and clear the platform credentials during logout.
