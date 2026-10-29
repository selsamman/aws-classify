# Partial reference smoke app

This is the consumer source and npm lockfile from the first independent adoption
exercise (published aws-classify 0.2.3), with a few maintenance changes: the service
name is now required through `MANUAL_ADOPTION_SERVICE`, the API scope through
`OIDC_SCOPE`, and Vite uses the documented port 3000. The parent framework
workspaces do not include this app. It imports published packages, not local source.

It is a reference for the observed public/protected counter, login and caller
notification smoke flow. It is **not** a completed acceptance fixture: there is no
pairing operation, peer-session fields remain empty, and peer buttons can only
reject. Reconnect, route mismatch, refresh and ownership cases remain unverified.
See the [review](../2026-10-20-review.md) before using it as acceptance evidence.

Install from this directory with `npm ci --workspaces --include-workspace-root`.
Use a Node/npm combination supported by the pinned frontend dependencies; the
original run used Node 20.19.5 and npm 11.6.3. Do not replace the framework versions
without recording that this is a new test of a different published release.

Supply a unique new `MANUAL_ADOPTION_SERVICE`, `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`
and `OIDC_SCOPE` in your environment. For local routing, use a separate copy of
`cloud/serverless.yml` with `custom.serverless-offline.noAuth: true`, and pass that
config to `aws-classify cloud offline --web web` as described in the public guide.
For deployed managed login also set `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID`,
`VITE_OIDC_REDIRECT_URI` and `VITE_OIDC_SCOPE` before building the frontend. The
provider must be provisioned separately. Register the exact site root return URL.

The root scripts retain the tested `acceptance` stage. Await each deploy/publish
command's completion before starting the next. Connect the socket before using
Set count, which awaits notification delivery. Public routing uses matching
explicit `publicMethods` lists; the word “Public” in a method name has no effect.

Provider creation and cleanup scripts from the original run are archived only as
text under `../evidence/2026-10-20`; they have known recovery/ownership defects and
are not supported commands. The app removal command removes the supplied website
stack, but an externally provisioned Cognito provider needs separate cleanup.
No cloud lifecycle was rerun after copying this source into the repository.
