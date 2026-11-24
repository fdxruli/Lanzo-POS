# POS sync transactional frontier — Block 1

Status: Draft candidate only. This migration has not been installed in Production and is not safe to install alone before Blocks 2–4.

## Contract

`next_pos_change_seq()` now registers a transaction-scoped shared advisory marker for the license and the first sequence allocated by that transaction. A short, per-license session advisory lock coordinates only sequence allocation and marker registration; it is explicitly released before the event row, business effects, or later events are written. Further events in the same transaction reuse the first marker. A transaction-local witness avoids repeating the marker lookup; PostgreSQL savepoint rollback restores that setting together with the transaction locks.

The reader helper briefly takes the matching shared coordinator lock, reads the sequence high-water mark and pending markers from `pg_locks`, then releases the lock before reading tenant data. Its safe frontier is one less than the earliest pending event sequence, or the sequence high-water mark when no marker is pending. A marker without a matching sequence marker fails closed at zero. Rollback releases markers; sequence gaps therefore do not stall later pulls.

The read functions are `VOLATILE`, keep the existing `SECURITY DEFINER` owner and empty `search_path`, and require `READ COMMITTED`. Frontier capture finishes before the legacy payload query, which uses a later statement snapshot. The safe sequence filter makes that later snapshot compatible: newly started writes allocate above the captured sequence high-water mark, and any earlier uncommitted write is held below the safe frontier. Broadcast remains only a notification.

Responses keep four facts separate:

- `latest_change_seq`: last delivered event while another safe page remains; otherwise the safe frontier, which proves the reader consumed the complete relevant range including gaps.
- `safe_change_seq`: the captured tenant frontier.
- `has_more`: true only when the `limit + 1` lookahead contains more safe events than fit in this page.
- `sync_deferred`: true while a transaction for this license still holds a marker.

Customer and credit V2 responses retain `sync_deferred` inside their existing `payload` envelope. A cursor already beyond the safe frontier is returned unchanged with `cursor_ahead_of_safe_frontier=true`. This flag is diagnostic, not a complete historical-hole detector: a cursor previously advanced unsafely can still be at or below today's safe frontier. Block 3/4F must define legacy recovery without treating absence of this flag as proof that no historical event was missed. The SQL never silently rewinds a cursor.

## Reader coverage

All seven Production readers use the same safe frontier and cursor binder. Existing public rate-limited wrappers keep their signatures and resolve the stable `_unlimited` function names at call time. The V2 customer wrappers also keep their existing envelope. Layaway is the existing direct public reader, not a new handler.

| Reader | Existing public/versioned path | Frontier and cursor rule | Deferred signal |
| --- | --- | --- | --- |
| General events | `pos_pull_sync_events_unlimited` → `pos_pull_sync_events` | Safe event page; safe cursor after final page | Top-level `sync_deferred` |
| Catalog | `pos_pull_product_catalog_changes_unlimited` → `pos_pull_product_catalog_changes` | Safe events and matching category/product/batch projections | Top-level `sync_deferred` |
| Customers | `pos_pull_customer_changes_unlimited` → `pos_pull_customer_changes`; `pos_pull_customer_changes_v2` | Safe customer events/projections | Top-level legacy; V2 `payload.sync_deferred` |
| Credit | `pos_pull_customer_credit_changes_unlimited` → `pos_pull_customer_credit_changes`; `pos_pull_customer_credit_changes_v2` | Safe ledger/customer/cash projections | Top-level legacy; V2 `payload.sync_deferred` |
| Sales | `pos_pull_sales_changes_unlimited` → `pos_pull_sales_changes` | Safe sale/item/payment projections | Top-level `sync_deferred` |
| Cash | `pos_pull_cash_changes_unlimited` → `pos_pull_cash_changes` | Safe cash-session/movement projections | Top-level `sync_deferred` |
| Layaway | `pos_pull_layaway_changes` | Existing relevant-event page bounded by the same frontier; tombstones retained | Top-level `sync_deferred` |

The unbounded readers remain `service_role` only. The layaway reader keeps its existing public grants and permission checks. Private helpers remain closed to API roles. RLS is unchanged. Direct `service_role` writes to the event table and sequence are revoked so event creation must pass through the registered writer.

## Migration and transition

Candidate: `supabase/migrations/20261124183143_pos_sync_transactional_frontier_v1.sql`.

It is one transaction. A read-only catalog preflight pins the current Production function bodies, owners, `search_path`, sequence configuration, and writer/allocator call paths; drift aborts before changes. The cutover barrier runs last: it sets sequence cache to 1, drains old allocators with an `ACCESS EXCLUSIVE` sequence lock, then drains event reads/inserts with an `ACCESS EXCLUSIVE` table lock, drops the old sequence default, and revokes direct writer grants. `lock_timeout=5s` makes the candidate abort rather than wait indefinitely. The barriers remain held through commit. Block 4F must pause new POS writers and drain active POS transactions before applying it; a lock timeout is a fail-closed fallback, not a substitute for planned quiescence. The barrier also briefly pauses event reads, so schedule and observe both sides of that pause.

Production preflight verified PostgreSQL 17.6, sequence `CACHE 1`, the expected recorder/allocation path, the seven real reader definitions, public wrappers, and customer/credit V2 wrappers. The migration also aborts if those pinned definitions drift. It adds no table, persistent snapshot, polling path, or server session record.

Do not install before these transition conditions are resolved:

1. Block 4F schedules the bounded cutover and checks `lock_timeout`/rollback behavior against the then-current Production catalog.
2. Direct service-role writers, if any are introduced before cutover, must be moved behind `record_pos_sync_event`; the migration preflight rejects unregistered database-function writers and the ACL revokes raw table/sequence access.
3. Devices using old cursors may already have a historical hole. `cursor_ahead_of_safe_frontier` does not identify every such device. Block 3/4F must define recovery for legacy cursor history independently; this Block 1 does not reset cursors or implement historical recovery. A legacy client that ignores `sync_deferred` is not guaranteed prompt recovery.
4. Every consuming client must continue using independent incremental cursors; write ACKs do not advance these readers.

## Final exact-candidate validation

The matrix below ran against the exact SQL file in branch commit `d52b87d85e968f0cd3c214b6757ad342195fe2a8` (base `main`: `8bc4395a5cf911603ba7a6b4848dd958e92a1bf4`). SHA-256: `5762cfa725c06f45328abfcfe94638a59e93749fe7e456c2faf3638ac5de9da6`. The isolated Docker lab ran PostgreSQL 17.6 with independent connections, 2 CPUs and 4 GiB RAM. The current overlay had about 55 GiB free before and after the bounded benchmark; WAL files were not deleted or altered manually. Production was queried read-only to verify the referenced function definitions. A missing permission helper and three catalog serializers were added to the disposable candidate fixture using verified definitions; no fixture repair or test write touched Production or the repository.

- **101/102 interleaving:** A allocated 101 and held its transaction; B allocated 102 and committed. The real reader returned no events, cursor/safe frontier 100, and `sync_deferred=true`. After A committed, the reader returned 101 and 102, advancing to 102.
- **All seven readers and wrappers:** general, catalog, customer, credit, sales, cash, and layaway readers were invoked with a transaction holding 111 while 112 committed. All seven, six public legacy wrappers, and customer/credit V2 kept the cursor at 110, returned `has_more=false`, and preserved `sync_deferred=true` (inside the V2 payload envelope). After the pending transaction committed, general pull recovered 111 and 112. Permission and entity filters stayed in effect.
- **Page limit and lookahead:** five real general events at limit 2 arrived as `[113,114]`, `[115,116]`, `[117]`; `has_more` was true, true, false and `latest_change_seq` advanced with the returned pages. With 118 safe, 119 pending, and 120–122 committed, limit 1 returned only 118, `has_more=false`, safe/latest 118, deferred true. After 119 committed, pages recovered 119–122 in order with lookahead true until the final page. The lookahead did not advance the cursor over safe events that had not been returned.
- **Per-reader hard caps:** requested limit 100,000 against actual readers and committed streams larger than their internal caps. General, customer, credit, catalog, sales, and cash each returned 999 events with `has_more=true`, then the remaining six with `has_more=false` from a 1,005-event relevant stream. Layaway returned 499 of 501 relevant event/projection pairs, then the remaining two; `has_more` was true then false. This verifies the `limit + 1` lookahead is inside each reader's clamp and cursor binding.
- **Projections and tombstones:** catalog pages contained the matching category/product and batch projections; product deletion returned a tombstone with `deleted_at`. Customer, credit, sales, cash, and layaway pulls returned their required related records; the customer pull excluded a foreign-tenant row.
- **Rollback, savepoints, same-transaction reuse, and cancellation:** full rollback left no event and released the marker; sequence gaps did not stall the frontier. A later event in one transaction reused the existing marker. Rolling back a savepoint after an existing marker retained it; rolling back the savepoint that first acquired it released it and cleared its witness, allowing a later event to register again. Reading from the writing transaction deferred its own uncommitted event; the following pull recovered it after commit. Cancelling a sleeping writer rolled back its event, closed the connection, and left zero advisory locks.
- **License isolation:** while license A held a pending marker, license B completed a write and read in 0.262 s, returned its own events and safe cursor 160, and was not deferred.
- **Prior deadlock interleaving:** with the real `apply_sale_inventory_effects_direct_rest_inv5` helper, B held product p2 while A updated p1 then waited on p2; candidate B recorded and committed, A resumed, and both completed (stock `19|18`, three movements). A test-only baseline recorder that takes the rejected late exclusive per-license transaction lock reproduced PostgreSQL's advisory-lock/transactionid deadlock; B aborted (stock `19|19`, two movements). This is a focused reproduction of the old lock placement/interleaving, not a byte-for-byte copy of the unavailable historical function.
- **Financial routes:** the existing real-financial lab runner passed its executed normal, batch, split, shared-product concurrent sale, payment/cash, credit, replay-idempotency, and inventory-effect assertions against the candidate. The result was `PASS_FOR_EXECUTED_CASES`. This is evidence for the exercised routes, not a claim that every financial path was covered.
- **Security:** Admin, POS-only Staff, inventory-only Staff, products-only Staff, and Staff without an applicable read permission were exercised. Missing permission, wrong-license device, and invalid token were rejected. Anon access to an existing public wrapper worked; direct access to unlimited readers, private allocator/recorder, and raw event/sequence writes remained denied. Event-table RLS remained enabled with the same four policies. ACL/RLS definitions were not broadened.

## Bounded benchmark

Baseline and candidate used the same PG 17.6 lab, fixture, exported Production functions, loopback connections, warmed paths, and controlled resets. Single/multi-event samples used four clients; contention used two writers and two readers for five seconds. Pulls used a 500-event page. WAL deltas were measured between LSNs after checkpointing, with seed data excluded.

| Scenario | Operations | Baseline p50 / p95 | Candidate p50 / p95 | WAL per event (baseline / candidate) |
| --- | ---: | ---: | ---: | ---: |
| One event per transaction | 1,200 transactions each | 1.547 / 2.544 ms | 2.187 / 4.738 ms | 1,018.6 / 1,008.7 bytes |
| Ten events per transaction | 800 transactions, 8,000 events each | 17.195 / 28.242 ms | 24.124 / 34.498 ms | 1,015.4 / 1,005.7 bytes |
| Pull, limit 500 (balanced repeat) | 400 pulls each | 9.562 / 41.348 ms | 14.145 / 58.669 ms | 0 / 0 bytes |
| Writers with concurrent readers | 5 seconds; 2 writers, 2 readers | 2.069 / 8.720 ms; 2,561 writes | 2.889 / 23.606 ms; 1,943 writes | 1,101.2 / 1,099.0 bytes |
| Pulls during writer contention | 5 seconds; 2 readers | 18.633 / 52.982 ms; 403 pulls | 45.211 / 79.767 ms; 217 pulls | 0 / 0 bytes |

The candidate used two transaction-scoped advisory markers per transaction with one or ten events; the baseline used none. No lock waiters were observed in the sampled contention runs. The candidate has measurable latency/throughput cost in this small CPU-limited lab, particularly for pulls during contention; this needs a focused follow-up before 4F and is not a Production performance estimate. WAL per event was comparable or slightly lower, with zero pull WAL in the balanced repeat. Thus the bounded candidate run gives no evidence of WAL amplification. The previous lab container was already gone, so its exact disk/WAL capacity cannot be forensically confirmed; the bounded samples do not reproduce WAL exhaustion, but cannot prove its original cause.

## QA boundaries

- **QA SQL:** the exact candidate matrix above passed on real PostgreSQL with independent connections. The clone was isolated; Production remained read-only.
- **QA automatizado de cliente:** no client file changed in Block 1 and client suites were not rerun for this SQL-only closure. The earlier recorded run had 9 focused Vitest files / 113 tests and FIN01 V2 / 7 tests passing; those results are not presented as a rerun on this exact SQL candidate.
- **QA manual:** no physical-device test or Preview/Muse test was requested or run. Cross-device manual QA remains for roadmap closure.
- **Production:** no migration installation, data write, cursor reset, or `supabase db push` was performed.

## Remaining scope

This is Block 1 only. Stable multipage snapshots and mutable-order pagination remain Block 2; client recovery policy for legacy cursors and final `sync_deferred` handling remain Block 3; writer pause/drain, transition compatibility, final combined QA, and any Production rollout remain Block 4F. The measured lab latency cost also needs review before 4F. This Draft must not be installed or merged by itself.
