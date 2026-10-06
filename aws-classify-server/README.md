# aws-classify-server

aws-classify connects browser and React Native applications to AWS Lambda through
shared TypeScript request classes. This server package registers Lambda response
implementations, dispatches client calls, persists application sessions and sends
WebSocket notifications. Optional authentication uses API Gateway's trusted
authorizer context; application code decides member permissions.

It is typically installed alongside `aws-classify-client` in a project containing
a backend and web/mobile clients, with shared request classes in a private npm
workspace such as `common/requests`. Its Serverless templates can also be merged
into an existing service.

See the **[aws-classify user guide](https://selsamman.github.io/aws-classify/)** for
copyable deployment configuration, tutorials and API reference, and the
[simple chat application](https://github.com/selsamman/aws-classify-example-simple-chat)
for a complete example.
