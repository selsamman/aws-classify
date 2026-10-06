# aws-classify

aws-classify lets a browser or React Native application call AWS Lambda methods
through shared TypeScript request classes. Response implementations run on the
backend; the framework handles dispatch, serialization, application sessions and
WebSocket notifications back to clients. Browser OIDC authentication is optional.

Applications typically combine `cloud`, `web` and optionally `mobile` directories,
with shared request classes in a private `common/requests` npm workspace. You can
also add the framework to selected parts of an existing project.

**[Read the user guide](https://selsamman.github.io/aws-classify/)** for manual
project setup, existing-project integration, copyable Serverless configuration,
authentication, API reference and framework repository setup.

| Package | Purpose |
| --- | --- |
| [aws-classify-client](aws-classify-client) | Client calls, notifications and optional managed browser authentication |
| [aws-classify-server](aws-classify-server) | Lambda dispatch, sessions, trusted identity context and notifications |
| [aws-classify-common](aws-classify-common) | Shared framework contracts and types |

For a complete web/mobile/backend example, see
[aws-classify-example-simple-chat](https://github.com/selsamman/aws-classify-example-simple-chat).
Architecture, implementation decisions and validation records remain in
[`docs`](docs); test-runner details are in [`tests/README.md`](tests/README.md).

The guide source is in [`usersguide`](usersguide). Run `npm run guide:install`,
then `npm run guide:dev` to preview it.
