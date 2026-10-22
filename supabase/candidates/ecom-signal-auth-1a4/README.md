# Phase 1A.4 — QA only / HOLD

No commercial migration, receiver mount, `order_created`, scheduler or shared ACL
change is enabled. Apply only against authorized `odlrhijtfyavryeqivaa`, after
catalog/ledger/inventory review. Never `db push` this repository.

Executed installation order (preserve source snapshots and remote ledger):

1. 1A.2 `foundation.sql`, `bridge.sql`; 1A.3 timestamped hardening; this folder's
   `20261022181404_qa_ecom_bridge_1a4_lifecycle.sql`, in one temporary migration.
2. `20261022182254_qa_ecom_bridge_1a4_recovery_progress.sql` resets collection
   progress during authorized identity recovery, and adds temporary race probes.
3. `20261022183224_qa_ecom_bridge_1a4_live_session_collection.sql` preserves an
   idle identity while its Lanzo session is still authorized, and prunes expired
   unused vaults in bounded batches. It supersedes the first collector predicate.
   The initial source is preserved as executed, not silently rewritten.

`prepare-ecom-lifecycle-1a4.mjs` reproduces the initial candidate from the pinned
1A.3 source and `collection.sql`; the subsequent corrections must also be applied.
TTL is server-only, allowlisted to 120/300/600/900 seconds; default candidate 600.
Lanzo session and entitlement still cap expiry. Client TTL assertions are ignored.

The collector keysets our private identity inventory by UUID; it does not scan
offset pages of Auth users while deleting them. SQL discovers only tagged Auth
users matching that inventory. Each deletion rechecks exact ID, role, immutable
app_metadata and binding. Mutable email/user_metadata are never authority.
Retirement holds the same grant locks as the publisher. No new grant is issued
for a retired identity. Owner recovery verifies deletion before resetting it.

`collect({batchSize:25,maxBatches:4,after:null})` processes at most 100 identity
rows per execution; maximum accepted settings are 100 × 10. Completion and
retry attempts/backoff persist on each identity. A crash after Auth DELETE and
before ack retries the same ID; 404 is success. Restart from null to revisit
deferred failures, or resume the returned cursor to continue a budget-limited
sweep. `complete` means this pass ended, not that future retries are unnecessary.
The worker also stops starting work after 45 seconds (maximum configurable 60s).
An in-flight Auth GET/DELETE pair can add up to 30s, and its ack up to 15s, under
the existing per-request 15s timeout. A partially deleted identity remains unacked
at the previous cursor and is retried idempotently, never silently skipped.

Expired grants lose vault ciphertext in batches while retaining tombstone and
Auth session binding. Auth users with current Lanzo authority remain inventoried
until revocation/session expiry or anomaly quarantine. Retention removes at most
100 identities, after 30 days of completed Auth cleanup, only with no live Lanzo
session, Auth user, unrevoked grant, lease or vault. Receipts are deleted before
their grants. Never erase a live session's unique runtime tombstone.

No production cron is installed. A proposed five-minute worker would add 8,640
Edge invocations/30 days if hosted on Edge, plus retries; SQL/batch budgets and
existing project usage must be reviewed before enabling it. Monitoring should
export counts/durations/retry backlog, not tokens, email, fingerprints or payloads.

Self-service quarantine is reactive at the next authorized broker prepare. It
detects Auth sessions without a grant binding and MFA factors, retires that exact
identity and revokes under the emission barrier. It does **not** bound direct
Auth requests, prevent password changes, or certify a global Auth rate limit.
Keep HOLD_SECURITY pending explicit residual-risk/architecture decision.

Rollback: stop QA processes; revoke only inventoried synthetic Lanzo sessions;
run the incremental collector and verify exact Auth IDs absent; remove own fixture
rows and execute the reviewed cleanup migration, including this folder's three
RPCs, anomaly helper and policy table before the 1A.3/1A.2 object rollback.
No CASCADE, shared ACL rollback, migration repair, global Auth setting or secret
rotation. Keep all remote migration history. Test server secrets are local to
ignored `.tmp/ecom-native-1a4`, never installed in Edge or committed.

The six shared ACL REVOKEs and exact rollback remain in the separate R2 proposal.
The 24-check rehearsal includes successful cash adoption/close under each known
client role and rolls back every synthetic financial write. Persistent application
still requires the owner's specific approval and confirmation of direct external
infrastructure consumers.
