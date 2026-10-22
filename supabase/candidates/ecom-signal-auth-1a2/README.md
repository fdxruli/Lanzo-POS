# Native Auth bridge — QA candidate, HOLD

`foundation.sql` retains R2's canonical authority checks. Apply `bridge.sql`
after it, in the same transaction. These files deliberately remain outside
`supabase/migrations`. No general db push, Auth global setting, shared ACL or
commercial event is part of this candidate.

Receiver: `lanzo_ecom_bridge_receiver`, no membership in authenticator, anon or
authenticated. It retains the six existing PUBLIC EXECUTEs until the separate
R2 ACL proposal is specifically approved. Therefore strict isolation is HOLD.

Identity key: canonical Lanzo device + actor session. Four runtime slots per
identity; global QA limit ten identities; 20 broker attempts/device/minute;
120 Auth operations/runtime. Slots and revoked grants are tombstones: retries
cannot resurrect them. This is a bounded experiment, not production sizing.

The broker runs only server-side and derives its password/AES key from the
existing server service credential with separate purposes. Refresh/access
tokens are encrypted with AES-GCM and grant ID as authenticated context. Only
the access JWT is returned. No new signing key, global hook or JWT TTL change.
The vault v1 must be drained before any future service credential rotation.

Prepare validates Lanzo online and reserves an identity-wide lease. Finish
revalidates authority, lease and native Auth session. A crashed lease is
quarantined rather than stolen. Abort tombstones the grant; bounded collector
retires identity before deleting only exact tagged synthetic Auth accounts.
Run collector repeatedly; a bounded scan that fails to find an orphan requires
explicit reconciliation. The collector is an admin-only operation, not cron.

Publish and revoke take the SAME grant row lock until commit. Publish queues
`realtime.send` in that transaction. A publisher that obtains the lock first
commits its queue entry before revoke can confirm. Once revoke commits, a new
publisher observes revoked_at and excludes it. Queued pre-barrier messages can
arrive later. Privileged callers can bypass any helper: the future commercial
sender MUST use this contract; direct REST Broadcast is not covered.

The canonical license, plan, device, actor and Lanzo session rows are locked
while checking eligibility. This does not serialize arbitrary administrative
changes to sibling-device counts. A future commercial sender needs integration
review of all entitlement/device writers; no shared writer was changed here.

Grant TTL 120s is independent of native JWT TTL. RLS checks current binding for
new joins; it cannot erase cached WebSocket authority. Legitimate client drops
transport/tokens at context cleanup and expiry; server stops future queueing
after revoke. Auth self-service and natural JWT expiry need empirical evidence.

Cleanup order: stop traffic; retire/revoke grants; collect tagged Auth users;
verify none remain; run `rollback.sql`; delete the exact synthetic Lanzo fixture
IDs from `.tmp/ecom-native-qa/fixture-cleanup.sql` (skip QA-schema statements
after schema removal); delete the QA Edge Function. Keep migration ledger audit
entries and document them; never repair/delete ledger to hide the experiment.

Run `node --test scripts/supabase/ecom-native-bridge.node-test.mjs`. These tests
are controlled doubles, not Hosted/React render certification.
