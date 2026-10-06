# aws-classify-client

aws-classify connects browser and React Native applications to AWS Lambda through
shared TypeScript request classes. This client package creates request proxies,
receives WebSocket notifications and optionally manages browser OIDC login,
refresh and local logout. Your application supplies its UI and provider navigation.

It is typically installed alongside `aws-classify-server` in a project containing
web/mobile clients and a backend, with shared request classes in a private npm
workspace such as `common/requests`. Existing applications can adopt it incrementally.

See the **[aws-classify user guide](https://selsamman.github.io/aws-classify/)** for
setup, examples, authentication and API reference, and the
[simple chat application](https://github.com/selsamman/aws-classify-example-simple-chat)
for a complete example.
