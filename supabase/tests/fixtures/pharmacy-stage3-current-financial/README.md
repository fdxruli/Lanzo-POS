# PR #518: current financial dependency slice (2026-11-14)

This is isolated test data, NOT a migration or a deployment package. All definitions
were obtained from Production `odlrhijtfyavryeqivaa` using read-only pg_catalog SELECTs.
No production business rows, credentials or clinical records are included.

Run from the repository root:

```sh
python scripts/supabase/pharmacy_stage3_deferred_pg_regression.py --isolated-fixture --current-financial
```

The runner creates a new portless PostgreSQL 17 container, installs the existing
PR338 financial fixture and canonical Pharmacy Stages 1–3, then loads this narrow
current overlay. It compares 50 function definitions (MD5 of pg_get_functiondef,
normalizing only CR), owners, security modes, search_paths and effective EXECUTE
ACLs with the live catalog manifest before any financial test. `postgres` is
NOSUPERUSER/BYPASSRLS; sessions log in as authenticator and SET LOCAL ROLE clients.

- `catalog.json`: 50 scoped functions and live metadata/hashes. Thirty-three
  definitions match the historical fixture; seventeen are new or different.
- `overlay.json`: only those 17 verbatim current definitions and metadata. Existing
  production behavior is reproduced, never corrected here. ACL restoration is
  local only. The unchanged `resolve_pos_actor_type(jsonb)` also has its live
  default EXECUTE ACL reproduced; the older fixture had redundant explicit named
  grants in addition to PUBLIC (same effective EXECUTE rights).
- `tables.sql`: exact canonical DDL for the three private tables needed by the
  current transition/pilot guards, including their existing RLS/ACL controls.
  Synthetic transition state uses the canonical default; pilot state is empty
  except in the explicit v1-rejection case. No production tenant configuration
  is copied or inferred.
- `triggers.sql`: existing live QA-pilot guard triggers on the eight relevant
  financial tables, reproduced only in the container. The application migration
  does not add/change any of them.
- `validation.json`: complete 56-case final result, exact errors and captured
  before/after state; all PASS. No production recovery claim.
- `production-preconditions.json`: results of a read-only equivalent of every
  P0 migration precondition. All predicates matched; owners were postgres.

## Comparison boundary

Entry: pos_execute_financial_operation_v1 → public 6B/6C/credit wrappers →
`*_unlimited` → R2B authorization/idempotency → `*_legacy_r2b` sale writers →
inventory allocation/application → pos_sale_items immediate/deferred triggers.
The manifest also pins receipt reserve/complete, canonicalization, origin context,
credit authorization, cash/debt recalculation and directly relevant stock guards.
The existing item batch-snapshot trigger is identical; the QA-pilot guard is
materially new relative to the historical fixture and is included intact.

Material differences reproduced:

1. Dispatcher/authorizer acquire the shared restaurant-transition transaction
   lock. Restaurant alias, dispatcher-origin and duplicate-parent guards precede
   delegation. For tested ordinary/pharmacy orders no restaurant parent exists.
2. 6B refuses stock-controlled legacy items. 6C sets/restores its transaction-local
   internal authorization around the same 6B core, then applies inventory.
   Therefore the positive 6B fixture now uses a non-stock service, while a separate
   tracked-product case proves the current rejection remains intact. This is not
   a change to the commercial contract.
3. Credit validates current credit-sale permission and debt/precision/limit before
   inserting; its inventory-required defenses remain active. The valid synthetic
   actor is an actual admin session, not a permission stub.
4. Current 6C supports `directPartialInventoryAuthorization`. Its resolver and
   both new helpers are loaded verbatim. Ordinary/medication cases have no such
   authorization/GUC; the unchanged normal allocation branch executes. Cooking
   recipe partial fulfillment is a different, explicitly gated contract, not a
   medical prescription, and is not newly certified by this test.
5. Current QA-pilot triggers prevent v1 writes for protocol-2 pilots without an
   admission witness. The dedicated negative case confirms that refusal. We do
   not forge an admission or certify v2 pilot onboarding.

Neither changed code nor any inspected delta commits independently, runs
SET CONSTRAINTS to bypass pharmacy, disables triggers, changes the sale-item
insert contract, or removes receipt identity. The 6B row-inserting leaf,
apply_sale_inventory_effects, normal allocation delegates and receipt reserve/
complete helpers match the historical fixture. Current credit still inserts
sale/items before applying inventory in the same enclosing transaction.

The batch-missing negative uses an untracked prescription product without any
batch: it reaches the real final guard without relying on the now-forbidden
tracked-product 6B path or on disabling 6C allocation. Valid batches are tested
through the current 6C and credit paths. A second negative mutates the batch's
product in an uncommitted synthetic owner transaction to prove final validation
fails closed after privilege elevation.

This closes the specific compatibility uncertainty for the tested 6B/6C/credit
P0 paths. It is not an audit of all 267 original functions, all production tables,
restaurant/split/layaway flows, external Realtime delivery, v2 pilot onboarding,
concurrency throughput, Android/PWA or live checkout. Those exclusions do not
introduce an alternative financial implementation or a mocked authorization path.

The corrective SQL remains byte-for-byte unchanged, SHA-256:
`269585fd54688b6e821682df9138eeb36875b68d110867d810ce2e2772989e7c`.
Merge and installation require separate user authorization; production recovery
requires the subsequent manual QA.
