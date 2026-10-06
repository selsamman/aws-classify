# aws-classify-common

aws-classify connects browser and React Native applications to AWS Lambda through
shared TypeScript request classes. This common package supplies framework request,
response and authentication types, plus the `reqBody()` placeholder used in shared
request methods.

Applications usually keep their own request classes in a private npm workspace
such as `common/requests`, consumed by both client and backend. That application
workspace depends on this framework package; the two have different purposes.

See the **[aws-classify user guide](https://selsamman.github.io/aws-classify/)** for
workspace setup, contracts and the client/server tutorials, and the
[simple chat application](https://github.com/selsamman/aws-classify-example-simple-chat)
for a complete example.
