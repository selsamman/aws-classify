# Review of the refresh-focused retry

Reviewed the additional turns `01a15a0b-25ce-7230-ad4e-17509993766c`,
`01a15a1f-66cc-72d3-8904-2100d7d98873` and
`01a15a39-e4d8-7cb1-8bf3-5e201b0242f1` in the independent adoption chat.
This supplements the [follow-on review](2026-10-20-follow-on-review.md).

The retry made a concrete improvement: both Cognito client creation and the
subsequent callback update now explicitly set five-minute access/ID lifetimes
with minute units. This matters because omitted UpdateUserPoolClient attributes
reset to defaults, as described in the
[AWS API reference](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPoolClient.html).
The session was preserved and a later browser action occurred after more than
five minutes. Normal provider cleanup and explicit final application-stack
nonexistence were recorded again.

Refresh itself is not independently verified from the available evidence. The
post-expiry browser action is `refreshTab.click(7)`, whereas the initial protected
call used `click(8)` and the same app's prior test sequence identifies 7 as Public
ping and 8 as Protected get. The tool record available to this review contains
the calls, not their returned accessibility snapshots. Consequently this may be
another public call mistaken for protected success; an index mismatch alone is
not conclusive proof either way. The original browser tab is no longer available
for read-only inspection. Preserve this as UNVERIFIED, not a confirmed failure or
refresh PASS, unless the resulting screen/network record can be supplied.

A reliable test must explicitly target Protected get by its current semantic
label, record a successful protected response after the verified access-token
expiry, and preferably assert a refresh-token exchange/new issuance without
recording token values. Avoid numeric indices whose meaning is not preserved in
the evidence. Record expiry times and observation times consistently in UTC.

The standard combined deploy/publication succeeded again, including a no-change
deploy that printed `Published 3 files (2 removed)`. A fallback uploader also ran;
it remains no evidence that the standard settled-stack publisher needs replacement.
The standalone standard publish sequence remains unverified.

The retry addressed refresh setup and cleanup, not the other disputed negatives,
concurrent attachment replacement, live-socket logout, or missing-scope case.
The app's helper-client construction for wrong-route tests is unchanged. The
original ADOPTION-REPORT.md and checklist still say refresh was not due and still
carry the unproven missing-output defect. They were not reconciled with this retry.

This review performed no AWS mutations or new acceptance requests. It inspected
the session, current source and provider-script changes. The completed matrix
still cannot be signed off from the retained evidence.
