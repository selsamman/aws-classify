---
title: Sample applications
description: Explore a complete application without needing to copy its structure into your project.
---

The guide teaches the pieces; sample repositories show them working together.
Use a sample as a runnable starting point, or read just the parts relevant to
your application.

## Simple chat: web, mobile and AWS

[aws-classify-example-simple-chat](https://github.com/selsamman/aws-classify-example-simple-chat)
is the first sample. Users register a name, discover connected sessions and send
messages. It demonstrates shared request classes, saved response state and
server-to-client notifications in web and Expo clients.

| Directory | What to look for |
| --- | --- |
| `common/requests` | Shared `ChatServerRequest` and `ChatClientRequest` classes, imported as `@simple-chat/requests` |
| `cloud/src/responses` | Lambda response methods and notification sends |
| `web/src/responses` | Browser notification implementations |
| `web/src/store` | Client setup, local session persistence and UI state |
| `mobile` | Expo client, native session storage and device-specific startup |
| `cloud/scripts` | Local development, database startup and site publication |

Install once from the sample repository root. Its private npm workspaces link
the shared requests into `cloud`, `web` and `mobile`. You do not publish the
request package or synchronize copies of source files.

Follow the sample's own README for current prerequisites, installation and
deployment. That repository may depend on published framework versions or a
local checkout during development. Check its configuration when adapting it;
the guide's [manual deployment](getting-started/deployment.md) chapter uses
the installed package's YAML includes.

The chat sample is not an OIDC/security acceptance fixture. For authenticated
application setup, follow [the authentication chapter](guides/authentication.md).
The framework's dedicated tests validate authentication independently.

More sample repositories can be linked here as they become available. The guide
does not require any sample or a future `create-aws-classify` generator to follow
the manual setup or existing-project integration path.
