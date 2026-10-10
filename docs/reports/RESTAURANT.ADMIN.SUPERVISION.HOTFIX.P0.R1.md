# HOTFIX_RESTAURANT_ADMIN_SUPERVISION_P0_R1

2026-10-10, America/Mexico_City. PR #352 remains Draft, stacked on #338.
Initial HEAD `54aa94f352dcb9ae3cbbcf44fd20b5c1fae344f9`; #338
`fb17e9a43929d54087ab937cb760a8cd6e087c36`. Main was revalidated as
`a8547bfc34f483d1d72020114510c8ebea74aace`; it was not modified.
No merge, production SQL/data write or production frontend deployment is authorized.

## Findings and changes

Both original failures were reproduced before editing, using the prior audit
harness and captured production definitions. A second read-only `pg_proc` query
on the production project confirmed all nine relevant writers/wrappers: the
status and item public wrappers, their unlimited leaves, aggregation, archive,
POS cancellation, checkout close and upsert. The wrappers delegate to their
unlimited leaves after rate limiting. Existing terminal triggers remain intact.

The common Kitchen mapper now includes `expectedParentVersion` and
`interventionReason`. Previously only the repository's local-sale helper added
them; direct mapper consumers missed the version. The canonical version is the
exact Cloud parent `updatedAt` timestamp, not the integer `serverVersion` and
never the device's `updatedAt` or `Date.now()`. Existing Cloud preflight compares
commercial snapshots and actor/session bindings before accepting a newer token.
SQL still rejects missing and obsolete tokens. SQL incompatibility details
explicitly require an upgrade and preservation of local drafts. Updated clients
translate version, missing-contract and authority errors into Spanish notices
without invoking actor-session recovery for those errors.

Legacy Kitchen parent cancellation is rejected for every actor. Its unchanged
public wrapper cannot bypass the hardened unlimited leaf. Operational
pending/preparing/ready/delivered calls retain the existing Kitchen permission
contract. Complete Kitchen rejection uses the existing item API for pending or
preparing products, preserves product cancellation evidence, and keeps the POS
parent open. Partial rejection is reported as partial, not as a financial closure.
Canceling the last product no longer cancels the parent through aggregation.
Every eligible item change advances the parent timestamp and server version,
even when aggregate status stays unchanged, preventing stale POS overwrites.

A private, RLS-enabled transaction/tenant/parent permit table and a parent trigger
protect actual terminal columns, including `fulfillment_status`, `cancelled_at`
and the `cancelledFromPos` metadata marker. The authorized versioned POS cancel
RPC alone inserts a permit after session, owner/Admin, refunds, parent lock,
version, reason, idempotency and financial-state checks; it removes the permit
after the parent write in the same transaction. Browser roles cannot mint it.
Exceptions roll back permits, audit and state. Existing cancellation receipts and
audit remain durable; retries do not repeat effects. Paid parents cannot be
cancelled, cancelled parents cannot reopen, and cancellation evidence cannot be
removed. Archiving confirmed history remains possible; Kitchen delivery cannot
be followed by archiving an unpaid live parent, which would hide it from POS.

No stock, price, financial calculation, historical creator, Free/Local or local
Kitchen code was changed. Admin remote edit remains
`BLOCKED_PENDING_INVENTORY_CONTRACT`. Origin reservation reconciliation retains
its receipt-before-release contract; viewing devices never own origin holds.

## Frontend contract matrix and P0-A HOLD

| Field | Observed Production / #338 mapper | Previous #352 common mapper | Hotfix common mapper |
| --- | --- | --- | --- |
| localOrderId / saleId | Present | Present | Present |
| expectedParentVersion | Absent | Absent; local-sale repository added it | Exact Cloud token or null |
| interventionReason | Absent | Absent; local-sale repository added it | Explicit reason or null |
| createdByDeviceId / createdByStaffUserId | Absent | Absent | Absent: server derives identity |
| updatedAt / serverVersion | Absent | Absent | Absent: no device-derived version |

Production was revalidated through Vercel: READY deployment
`dpl_23HyEet81tZXYQRk1R1nC4DQQGdV` publishes
`a8547bfc34f483d1d72020114510c8ebea74aace` from main. The mandatory contract
comparison executes its actual mapper and #338's mapper as captured source
fixtures; only relative import paths are adjusted. Neither sends a version.

| Combination | Evidence / result |
| --- | --- |
| Old frontend + old SQL | Historical real upsert definition accepts the old payload; no integrated QA claim |
| Transitional frontend + old SQL | NOT IMPLEMENTED / NOT CERTIFIED; final #352 capability RPC is absent on old SQL |
| Transitional frontend + new SQL | NOT CERTIFIED; needs the separate bridge rollout below |
| Final #352 + new SQL | Focal mapper, authority, hydration, preflight, reservation and SQL tests; integrated QA pending |
| Old frontend + new SQL | Explicit rejection of missing version; old assets cannot be repaired by server-side inference |

**P0_A_STATUS = HOLD_ADDITIONAL_TRANSITION_PHASE_REQUIRED.** A JavaScript bundle
already loaded in an old tab cannot send a version its mapper never recorded.
Allowing its write or substituting the current SQL version would violate optimistic
concurrency. A frontend-only rollout also cannot make the old backend enforce a
version it ignores. The same is true for cached service workers, resumed sessions,
stale Dexie and intermittent devices. A successful Preview does not prove cutover.
No fallback to a blind write, local settlement or SetupModal was added. The old
bundle's upgrade UX is not certified; therefore P0-A is not reported resolved.

## Required separate rollout, no deployment in this task

1. Implement and test a compatibility bridge with an authenticated read-only
   contract/capability endpoint and strict versioned writes. Specify a safe,
   server-enforced maintenance/upgrade gate for obsolete writers. Preserve old
   local drafts and business/session bindings; do not clear storage or reopen a
   setup flow. Detect unsupported clients by absence of the required contract,
   not by browser-supplied authorization claims.
2. Prepare the transitional frontend against old SQL and bridge SQL. Keep Admin
   capabilities disabled until backend confirmation. Demonstrate read/hydration,
   authorized origin edits, stale snapshot refusal, QuickCaja, split, reconnect,
   asset/service-worker caching and Free offline in all four combinations.
3. Obtain isolated active staging, real Auth/Realtime and integrated finance/
   inventory QA. Verify a recoverable backup and test recovery. Certify all
   three required CI workflows on the immutable candidate SHA. Only after these
   gates may a separate approval evaluate SQL deployment and client cutover.
4. Activate Admin capabilities after backend confirmation; keep remote product
   editing disabled. Merge #338 and subsequently #352 only by separate decisions.

`FRONTEND_SQL_COMPATIBILITY = HOLD`, `BACKUP_READINESS = UNVERIFIED`,
`SQL_DEPLOYMENT_READINESS = HOLD`, `MERGE_READINESS = HOLD`.

## Reproducible tests and limits

Use an empty `lanzo_admin_supervision_fixture` on loopback PostgreSQL 17, with
`PGHOST=127.0.0.1`, dedicated `PGPORT`, `PGUSER`, `PGDATABASE` and `PSQL_BIN`.

```text
node scripts/supabase/restaurant-admin-supervision-test.mjs --isolated-fixture
node scripts/supabase/restaurant-admin-supervision-hotfix-test.mjs --isolated-fixture
```

The original seven races retain their real sessions and lock barriers. Three
additional actual-session races cover cross-parent line IDs, cross-tenant line
IDs and Kitchen item change versus POS update. Published Kitchen wrapper/item
bodies are captured in `restaurant_hotfix_kitchen_wrappers.sql`; only rate-limit,
auth-context and financial leaf effects are controlled test doubles. SQL queries
to production in this task only read catalogs/history, never application rows.
The historical audit harness at the initial SHA reproduces the pre-hotfix bypass;
its rollback test is historical and is not a rollback procedure for this hotfix.

| Requested SQL cases | Evidence |
| --- | --- |
| 01–06 | Existing owner/version/foreign/Admin/session/cross-license harness |
| 07–11 | Actual operational Kitchen leaf, actual public wrapper, terminal column/metadata aliases, published item leaf |
| 12–15 | Owner origin refunds retry, Admin audited cancel, paid denial, terminal reopening denial |
| 16–17 | Original cancel/cancel and checkout/cancel sessions |
| 18 | New real Kitchen/POS race; same-aggregate parent version regression |
| 19–20 | New actual unique-line contention for parents/tenants |
| 21 | Existing financial alias/forged Split-child permit denials |
| 22 | SQL durable Admin audit plus frontend origin receipt/reconciliation tests; real two-device inventory QA UNVERIFIED |
| 23–24 | Confirmed retry and forced precommit error/rollback |

259 focal Restaurant/frontend tests passed before final Kitchen UI additions;
the new Kitchen rejection suite adds three cases. Final results, lint baseline
classification, builds, immutable CI runs and Preview SHA are recorded in the
external final closeout and PR description, not inferred from an earlier run.
No timeout, assertion, gate or unrelated Ecommerce code is weakened.

## Migration history and recovery

Only the unapplied `20261010013258_restaurant_admin_supervision_r1.sql` changes;
historically applied dependencies are untouched. Fresh production history and
function reads must remain part of a future deployment revalidation. Its old and
new git-blob hashes belong in the closeout. Tests apply definitions only to the
disposable fixture: `MIGRATIONS_APPLIED = NONE` means no application database.

The old seven-function restore does not cover the two newly replaced Kitchen
functions or the new trigger. Production rollback readiness remains HOLD.
A recovery procedure must stop new sensitive writes, preserve interventions and
receipts, reconcile committed operations, and restore/revoke the complete object
set only after isolated recovery testing. Restoring the old vulnerable Kitchen
API is not an acceptable automatic rollback. Transactionality is not proof of
backup or recovery readiness.
