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

Customer and credit V2 responses retain `sync_deferred` inside their existing `payload` envelope. A cursor already beyond the safe frontier is returned unchanged with `cursor_ahead_of_safe_frontier=true`; Block 3/4F must repair such a legacy cursor through a full recovery path. The SQL never silently rewinds it.

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
3. Devices using old cursors may already have a historical hole. Block 3/4F must force a recovery/resnapshot for `cursor_ahead_of_safe_frontier`; a legacy client that ignores `sync_deferred` is not guaranteed prompt recovery.
4. Every consuming client must continue using independent incremental cursors; write ACKs do not advance these readers.

## PostgreSQL 17.6 QA evidence

The isolated lab used independent PostgreSQL connections and the real Production recorder/read functions. Production itself was read-only; no test writes or migration were sent there.

- **101/102 interleaving:** A allocated 101 and stayed open; B allocated 102 and committed. The real general reader returned no events, cursor 100, safe frontier 100, and deferred true. After A committed, the next pull returned 101 then 102 and advanced to 102.
- **Reader matrix:** with A pending and B committed, actual general, catalog, customer, credit, sales, cash, and layaway readers all held the safe frontier at 218 and deferred. After A committed, each returned only its relevant event projections and advanced no further than the safe frontier. A second license advanced to 229 without waiting on the first.
- **Pagination:** 1,005 actual recorded product events were delivered in ordered pages of 999 and 6, with 1,005 unique sequence values. One transaction held two advisory markers for all 1,005 events.
- **Savepoints/rollback:** partial savepoint rollback, full rollback, and sequence gaps released markers; frontier then advanced. The witness/lock savepoint branch was exercised in the immediately preceding PG clone; the final inlined recorder was separately smoke-tested with consecutive same-transaction events.
- **Financial concurrency:** actual normal, batch, and split sale RPCs, idempotent replay, shared-product concurrent sales, and the real inventory helper completed. Concurrent normal/split sales both applied effects; final shared stock was 14 and all five sale audit rows reported `inventory_effect_status=applied`.
- **Prior deadlock:** a test-only baseline that took the rejected late exclusive per-license transaction lock reproduced the documented cycle with `apply_sale_inventory_effects_direct_rest_inv5`. The candidate’s real helper completed the same two-product lock-order interleaving without that cycle. The baseline recreated the lock placement/interleaving, not the unavailable historical function byte-for-byte.
- **Security:** Admin, POS-only Staff, inventory-only Staff, and Staff without applicable permissions were exercised; wrong-tenant device and wrong device token were rejected. Direct helper/writer execution and raw event/sequence writes were denied to API roles; RLS remained enabled and unchanged.
- **Final-candidate smoke:** the final migration compiled and committed on a fresh isolated PG 17.6 clone; the recorder’s default arguments worked, two same-transaction events returned consecutive sequences, and the frontier cleared after commit. The final candidate then processed 13,732 one-event transactions before the lab ran out of WAL space and PostgreSQL aborted that benchmark. That run is incomplete, not a valid final performance result.

The full-reader, finance, and security matrix above was run against the preceding candidate using the same marker/frontier and public-reader bodies. The final SQL revision retains that reader code and changes only lookahead cursor binding, transaction-local marker reuse, and the recorder wrapper; only the final migration smoke and savepoint checks were rerun after those edits. Re-run the focused full matrix against the final commit before considering merge.

The pre-final local `pgbench` samples are exploratory only: with four clients for 10 seconds, one event/transaction measured baseline p50/p95 0.320/1.082 ms and candidate 0.695/3.158 ms; a synthetic 100-event JSON page measured 0.872/3.039 ms and 1.566/7.801 ms respectively. They are not Production estimates, and are not final-code acceptance results. The final run exhausted the isolated lab WAL before a comparable sample completed.

Client suites run after the migration edits: 9 focused Vitest files, 113 tests passed; FIN01 cloud-sync V2 contract, 7 tests passed. No client file changed in Block 1. Physical-device/manual QA and Preview tests were not run.

## Remaining scope

This is Block 1 only. Stable multipage snapshots and mutable-order pagination remain Block 2; client recovery of an ahead cursor and the final `sync_deferred` retry path remain Block 3; transition, final combined QA, and any Production rollout remain Block 4F. This Draft must not be installed or merged by itself.
