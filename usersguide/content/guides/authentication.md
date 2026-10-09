---
title: Add browser login
description: Protect dispatch with API Gateway and manage standard OIDC browser login, refresh and local logout.
---

import Download from '@site/src/components/Download';

Authentication is optional. Turn it on when the application needs to know who
is calling its protected operations. API Gateway validates access tokens;
aws-classify exposes the resulting trusted identity and keeps application
sessions bound to that identity. Your application still chooses member permissions.

## Protect the backend

Configure a JWT authorizer for your provider's issuer and API audience. Use the
authenticated functions include and the authenticated CloudFront template.
This example is a complete replacement for the unauthenticated tutorial YAML:

```yaml title="cloud/serverless-authenticated.yml"
service: my-classify-app
frameworkVersion: '4'

custom:
  awsClassify:
    authorizer:
      name: applicationJwt
      scopes: [example/invoke]
    publicSuffix: Public
  directories:
    responseHandlers: src/responses/index
    includeFiles: ../node_modules/aws-classify-server/yml
  yml: ${self:custom.directories.includeFiles}
  stage: ${opt:stage, 'dev'}
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
  httpApi:
    authorizers:
      applicationJwt:
        type: jwt
        identitySource: $request.header.Authorization
        issuerUrl: ${env:OIDC_ISSUER_URL}
        audience:
          - ${env:OIDC_AUDIENCE}
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
  - ${file(${self:custom.yml}/functions-authenticated.yml)}

resources:
  - ${file(${self:custom.yml}/resources-website-authenticated.yml)}
  - ${file(${self:custom.yml}/resources-dynamodb.yml)}
```

<Download file="serverless-authenticated.yml">Download the authenticated configuration</Download>.
Save it as `serverless.yml`, or pass `--config serverless-authenticated.yml` to
your Serverless commands. Set `OIDC_ISSUER_URL` and `OIDC_AUDIENCE` in the
deployment environment. Choose the scopes your provider actually issues for
your API; `example/invoke` is a placeholder. Multiple Gateway route scopes are
**OR**, so a token needs at least one. Require scopes appropriate for access
tokens; do not use an ID token to call your API.

Export `publicResponseHandler` in addition to the other three framework handlers
from `cloud/src/responses/index.ts`. Protected dispatch accepts exposed methods
without `Public`; public dispatch accepts exposed methods ending in `Public`.
Use the same configurable suffix on the client and server. A payload flag cannot
change which entry point is allowed to invoke a method.

The authenticated CloudFront template forwards Authorization, disables API
caching and preserves authentication errors. The legacy static-hosting template
does not supply that behavior.

## Register the browser app with your provider

Use a public OIDC client with authorization code and S256 PKCE, without a client
secret. Register the application's exact login return and logout return URLs,
configure requested scopes, and enable refresh tokens if you want session renewal.
Cognito has been validated; Okta compatibility has not been deployed/tested.

For default CloudFront hosting, a convenient login return URL is the site's root
`https://YOUR-DISTRIBUTION.cloudfront.net/`. Process the `code` query on that page.
The authenticated distribution preserves 403 responses: it does not automatically
rewrite arbitrary SPA callback paths to `index.html`. If you choose another
callback path, deploy a page at that path or supply your own routing behavior.

The issuer's discovery, token and JWKS endpoints must allow the browser requests.
You can supply explicit metadata when discovery is unavailable. See the
[client reference](../reference/client.md) for managed options.

## Create a managed client

Use separate tab-scoped storage for the protected application-session ID:

```ts title="web/src/authenticated-client.ts"
import {ClassifyClient} from 'aws-classify-client';

export const authClient = new ClassifyClient(
    async () => sessionStorage.getItem('my-app-protected-session') || '',
    async id => { sessionStorage.setItem('my-app-protected-session', id); },
    '/api/dispatch',
    {
        publicSuffix: 'Public',
        managed: {
            issuer: 'https://YOUR-OIDC-ISSUER',
            clientId: 'YOUR-PUBLIC-CLIENT-ID',
            redirectUri: 'https://YOUR-APP/',
            scopes: ['openid', 'example/invoke'],
        },
    },
);
```

Replace those configuration values. Classify stores credentials and the pending
login transaction privately in tab-scoped `sessionStorage`; your get/set callbacks
store only the application session ID. Reconstruct the client with the same
options after navigation. Use one long-lived instance per authentication namespace.

## Start and complete login

On the login button:

```ts
const request = await authClient.beginLogin();
const url = new URL(request.authorizationEndpoint);
for (const [name, value] of Object.entries(request.parameters)) {
    url.searchParams.set(name, value);
}
window.location.assign(url.href);
```

Classify generates state, nonce and PKCE material before navigation. Preserve
those parameters if you add optional provider-specific parameters.

On your registered return page, reconstruct the same client and process the
callback before starting protected calls or socket attachment:

```ts
const returned = new URL(window.location.href);
if (returned.searchParams.has('code') || returned.searchParams.has('error')) {
    try {
        await authClient.completeLogin(returned.href);
    } finally {
        history.replaceState(null, '', 'https://YOUR-APP/');
    }
}
```

The return contains a temporary opaque code. Classify checks the retained
transaction, exchanges that code at the configured provider, validates the
authentication response, and manages the tokens. `completeLogin()` returns no
credentials. Protected requests and socket authorization use the current access
token, refreshing on demand when necessary and supported. Public methods remain
callable without login.

## Log out locally, then redirect

For Cognito managed login, application code builds the provider logout URL:

```ts
await authClient.logout();
const url = new URL('https://YOUR-COGNITO-DOMAIN/logout');
url.searchParams.set('client_id', 'YOUR-PUBLIC-CLIENT-ID');
url.searchParams.set('logout_uri', 'https://YOUR-APP/');
window.location.assign(url.href);
```

For a provider's OIDC end-session flow, use the ID-token hint returned by cleanup:

```ts
const {idTokenHint} = await authClient.logout();
const url = new URL('https://YOUR-PROVIDER/END-SESSION-ENDPOINT');
if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
url.searchParams.set('post_logout_redirect_uri', 'https://YOUR-APP/');
window.location.assign(url.href);
```

`logout()` never navigates. It stops protected activity, discards tab credentials,
clears the protected application session, cancels pending login/refresh/attachment
and closes its socket. Late results cannot restore the old client session. The
separate anonymous public session remains available. Provider logout ends the
provider's own browser login session and redirects back.

Logout is local to this tab. It does not revoke retained tokens or immediately
invalidate other clients on the server. Native Gateway JWT authorizers can accept
copied access tokens until expiry. Global or immediate server revocation needs a
separate policy; do not claim it from this lifecycle.

## Use an authentication library you already have

Supply `getAccessToken` instead of `managed`:

```ts
const client = new ClassifyClient(getSession, setSession, '/api/dispatch', {
    publicSuffix: 'Public',
    getAccessToken: async () => applicationTokenManager.currentAccessToken(),
});
```

The callback runs before each protected request, including socket authorization.
Your token manager owns login, storage, refresh and credential disposal. External
clients can use `logout()` for Classify cleanup, but must also clear their own
credentials. Construct a new external-token client after the next login.

## Apply application permissions

Use the trusted context in a registration callback or response method:

```ts
classifyServerless.registerResponse(CounterResponse, async (_response, method, _args, context) => {
    return method !== 'setCount' || !!context?.hasScope('example/write');
});
```

The issuer/subject identifies the owner of an authenticated application session.
Application `setUserId()` associations and client arguments cannot change it.
The framework defines no broadcaster, member or admin roles. Clear legacy
session IDs when enabling authentication; old unowned state is not automatically
adopted by a signed-in user.

## Cross-origin and local development

Prefer same-origin application/API hosting when available. A separate browser
origin requires Gateway CORS and an unauthenticated OPTIONS route if the protected
ANY route captures preflight. Return only the allowed origin/headers/methods from
that route; the actual protected request still requires a valid token. See the
[fixture implementation](https://github.com/selsamman/aws-classify/blob/master/tests/server/serverless-auth.yml)
for the pattern.

Offline `--noAuth` supports functional routing development, not verified user
identity. Never enable `IS_OFFLINE=true` on an AWS deployment. For detailed
storage, race, validation and security behavior, see the
[implementation lifecycle document](https://github.com/selsamman/aws-classify/blob/master/docs/CLIENT_AUTHENTICATION_LIFECYCLE.md).
