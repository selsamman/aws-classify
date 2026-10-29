# Review of the follow-on acceptance run

Reviewed the added completed turn `01a15983-cc24-7222-ae78-e2eed1f092fd`
in `Independent aws-classify guide adoption…`, the updated app and final report.
This supplements the [first review](2026-10-20-review.md); it does not retroactively
change that run's evidence or update the retained first-run reference source.

## Additional evidence accepted

The app now implements a narrow claim-based policy: only docs-user-a may address
the sole session associated with docs-user-b. It no longer leaves pairing wholly
unimplemented. Browser actions exercised A-to-B notification, updating/readback
of B's state, denying B's reciprocal send, a foreign-session attempt, disconnected
send failure, reconnect/no immediate replay, and successful delivery afterward.
Two accounts were used; the agent handled shared Cognito browser SSO explicitly.
The run also exercised persisted state, validation and local logout/public access.
A clean build and normal cleanup were recorded again, including explicit stack
nonexistence. The provider-script recovery/ownership concerns from the first
review remain unchanged.

## Completion claims still need correction

- **Public member on protected dispatch:** the reported result is `Login required`
  from a separately constructed managed client. That does not demonstrate the
  protected endpoint rejecting an authenticated public-member request. The
  helper clients are constructed before login completion and are not shown to
  possess valid credentials for that attempt. Repeat with a valid authenticated
  request and show that the server rejects the wrong dispatch entry point.
- **Protected member on public dispatch / foreign-session adoption:** HTTP 500
  shows failure, but does not establish its intended authorization cause. Keep
  valid control requests and capture a server-side rejection reason or an assertion
  that the protected response method was not entered and protected state was
  unchanged. Do not classify every internal error as a security-test success.
- **Replacement connection:** closing B, reconnecting B and receiving another send
  verifies reconnect. It does not verify the latest-attachment rule while an older
  connection for the same application session is still alive. Establish two
  concurrent attachments and identify which receives a uniquely labeled send.
- **Logout socket closure:** A reload occurs before logout, and no subsequent
  `initSocket` is recorded. Connect and verify a socket immediately before logout,
  then observe that connection closing and protected sends becoming unavailable.
- **Refresh:** still not run. The provider script does not arrange a short token
  lifetime and the agent again treats the bounded test window as a reason to skip.
  This is not a demonstrated provider/environment blocker. Configure a supported
  short lifetime and wait for a real refresh; verify the exchange and continued
  protected access, without exporting token values.
- **Scope rejection:** granting invoke and observing success does not test a token
  missing the route scope. The combined login/scope/logout PASS remains too broad.
- **Local authenticated matrix:** still not repeated/completed; the checklist
  correctly leaves the relevant entries unchecked. Other unchecked entries now
  conflict with the narrative's claimed provisioning/cleanup completion.

## Publication diagnosis remains unproven

The first 247-second deployment again completed with `Published 3 files` after
standalone publish and a concurrent no-change deploy had reported missing outputs.
A later command explicitly observed `UPDATE_COMPLETE`, but the next recorded
publication used the fallback uploader, not the standard publisher. There is no
successful completion -> standard frontend-only publish sequence establishing
that the missing-output error persists on a settled stack. The template already
contains the required outputs. Keep this check inconclusive, not a confirmed
missing-template-output defect; do not preserve the fallback as a required fixture
feature on that evidence.

## Remaining gate

Retain the added two-account and peer-operation evidence as useful progress.
Do not call the full matrix complete. Run the exact remaining cases above, use
unique messages and explicit expected assertions, and reconcile every checklist
entry before cleanup. Keep genuine product failures distinct from unexecuted or
incorrectly constructed negative tests. No AWS operations were performed during
this review; the conclusions are from the session record and source inspection.
