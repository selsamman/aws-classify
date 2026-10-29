# Manual acceptance checklist

Run Session A and Session B in independent/noopener browser contexts, so browsers do not clone `sessionStorage`.

- [ ] Local `npm run cloud:offline`, open two contexts, and record public ping, protected count, invalid-count rejection, and reload persistence.
- [ ] In both contexts connect/disconnect/reconnect WebSockets. Set count while connected, disconnect B, send, reconnect B, then send again; record delivery and lack/presence of replay.
- [ ] Verify unpaired `sendToPeer` fails. Pairing requires an application-owned authorization policy before cross-session sending can be accepted; this fixture deliberately never lists arbitrary sessions.
- [ ] With offline `--noAuth`, record that protected/public route functional behavior is not an identity/scope validation.
- [ ] `npm run cognito:setup`; source `scripts/provider.env`; deploy. Pass CloudFront root URL to `npm run cognito:callback -- URL`, rebuild/publish with the provider env sourced.
- [ ] Before login: public succeeds, protected is rejected. Login as A, protected call/socket succeeds; reload preserves it. Independently login B and ensure B cannot adopt A's protected session.
- [ ] Logout A: protected socket closes and public remains usable. Record whether refresh happens only if it naturally becomes due.
- [ ] Publish an innocuous frontend change with `cloud:publish:acceptance` without backend deployment; verify the output JSON and changed page.
- [ ] Remove stack, then `npm run cleanup`; retain the manifest until output verifies deletion.
