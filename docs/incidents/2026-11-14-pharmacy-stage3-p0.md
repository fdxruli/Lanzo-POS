# P0 Cloud checkout: Pharmacy Stage 3 deferred validation

Status: candidate correction, NOT installed; no production recovery claim.
Base main: `98976ad7c15cfdba7d54fde46f6db08553828a17`. Initially inspected main was `b46115c00456c556a578ec5fb8a296b264bc3dc7` (reference `b3cf26a6` is its parent). The intervening #516 changes only preparation-station UI and its tests, outside this SQL/checkout path.
Production was accessed only through read-only catalog/log queries. No business rows were read or changed, no checkout was replayed there, and no migration/merge/deployment was executed.

## A. Confirmed causes and forensic evidence

Migration `20261112040000_pharmacy_stage3_atomic_dispensations.sql` is registered in Production with name `pharmacy_stage3_atomic_dispensations`.
All four Stage 3 function bodies matched the canonical migration byte for byte (MD5 below). Their owner is `postgres`, mode INVOKER, configuration `search_path=''`, and function ACL contains only the owner. All four triggers are enabled (`O`).

| Function suffix (private.pharmacy_stage3_) | Original body MD5 | Trigger |
|---|---|---|
| dispense_on_sale_item | 67b260c087b0633795bc623a013663a3 | trg_pharmacy_stage3_dispense_insert, AFTER INSERT |
| track_batch | 350df7832a00b73d379dc576dd032570 | trg_pharmacy_stage3_batch_update, AFTER UPDATE OF batch_id |
| require_final_batch | 7e42cfb86755add1f81755bc3a87ee94 | trg_pharmacy_stage3_final_batch, AFTER INSERT, DEFERRABLE INITIALLY DEFERRED |
| immutable_dispensation | 739ba9e8b476d3ce40c4b9abcb4d8654 | trg_pharmacy_stage3_disp_immutable, BEFORE UPDATE/DELETE |

Independent log queries reproduced these database events (UTC):

| Time | SQLSTATE | Application / command | Context |
|---|---|---|---|
| 2026-11-14 05:23:51.871 | 42501 | postgrest / COMMIT | private.pharmacy_stage3_require_final_batch(), line 3 at IF |
| 2026-11-14 05:24:34.737 | 42501 | postgrest / COMMIT | same |
| 2026-11-14 05:25:15.282 | 42501 | postgrest / COMMIT | same |

Exact error: `permission denied for schema private`. The parsed login is `authenticator`; logs do not expose the effective SET ROLE. Catalog checks show that `anon`, `authenticated`, `authenticator`, and `service_role` lack USAGE on `private`. `postgres` is NOSUPERUSER/BYPASSRLS and has USAGE.

The financial RPC and sale wrappers are SECURITY DEFINER, owned by postgres. Immediate triggers execute inside that privileged call. When it returns, the deferred trigger remains queued; at COMMIT it executes as the calling role. The isolated reproduction logs `true` from the RPC, then the client role, then 42501 at COMMIT. The deferred query touches the private schema even if there is no dispensation. Consequently ordinary stores are exposed too. The PostgreSQL transaction aborts, including the sale, inventory, cash and financial receipt; an internal `success=true` is not a committed receipt.

Edge logs independently show POST /rpc/pos_execute_financial_operation_v1 HTTP 401 at 05:24:29.805 and 05:25:10.763 (also 05:23:46.868). PostgREST timeout messages exist at 05:24:36.388/.412. These times are compatible with the reported incident but no shared request/intent identifier was obtained. `INCIDENT_UNKNOWN` and timeouts therefore remain **without conclusive correlation** to an individual aborted transaction. A separate HTTP 200 at 05:23:33.437 cannot be classified as a sale from these logs alone. Do not infer that every preceding operation rolled back.

A second defect was demonstrated during the matrix: absent fraction/optional prescription flags can make `v_required` NULL; `IF NOT v_required` then does not skip prescription validation for an ordinary pharmacy product. The user explicitly authorized this second, focused correction during the investigation. This was reproduced locally, not established as a historical production pharmacy incident.

### Actual checkout path

1. `PaymentModal.jsx` opens, derives `effectiveTotal` from `orderTotals`, initializes cash received, and uses Money arithmetic for change.
2. `handleDenominationClick(100)` only calls `setAmountPaid`; its button is `type="button"`. It does not call an RPC. Submit guards `canConfirm`/`isSubmitting` and passes amount, received cash and change to `onConfirm`.
3. `PosModals.jsx` wires `onConfirm={handleProcessOrder}`. `usePosCheckout.js` checks actor/snapshot and an open cash session, then calls `salesService.processSale` with the snapshot and pharmacy data.
4. Cloud mapping/repository selects `sale.cashier` (6B), `sale.cashier_inventory` (6C) or `sale.credit`, builds an immutable financial intent and dispatches `pos_execute_financial_operation_v1` through the financial ledger.
5. The server validates the POS license/device/session/permissions, binds the operation/hash to its origin, obtains the receipt/idempotency context, and delegates to the sale writer. Writers insert `pos_sales` and `pos_sale_items`; immediate pharmacy validation records prescription/dispensation, and 6C can assign a batch after INSERT within the same transaction.
6. COMMIT runs the final batch constraint trigger. This is the first demonstrated failure for ordinary sales in the incident. Pharmacy with missing requirements can fail earlier and must continue to do so.
7. The financial ledger handles explicit rejection separately from ambiguity. An ambiguous dispatch seeks the existing financial receipt; COMPLETED recovers the result, CONFLICT blocks, unresolved status remains pending. Explicit retry requires the existing origin/evidence and authoritative NOT_FOUND; the patch introduces no redispatch or retry.

Structural scope: any transaction queuing this trigger and reaching deferred execution under a role without private USAGE, including ordinary sales, pharmacy OTC/prescription sales, 6B/6C/credit and other pos_sale_items writers. It is not proof that every such production path failed. Executing constraints before returning from the privileged context can differ. Direct client inserts/updates are denied and are not a supported workaround. Immediate auxiliary INVOKER triggers are unchanged; this fix does not grant direct DML access to private data or promise direct service-role DML support.

## B. Controlled reproduction and limits

Runner: `python scripts/supabase/pharmacy_stage3_deferred_pg_regression.py --isolated-fixture`.
It creates/removes a dedicated Docker container without publishing ports, uses PostgreSQL 17 pinned by image digest, real SQL transactions and COMMIT, pgcrypto, enabled RLS/policies, real constraints/triggers, and a NOSUPERUSER/BYPASSRLS postgres owner. The client connects as authenticator and SET LOCAL ROLE anon/authenticated. Synthetic data only.

**Coverage boundary:** the 267 financial functions and associated schema/policies start from the repository's PR338 financial snapshot. Pharmacy Stages 1–3 are installed from canonical files, and the four Stage 3 bodies were matched against Production. Current production financial entry/wrapper definitions were inspected, but some differ from the historical fixture (restaurant transition and direct-recipe extensions). Complete current financial-backend parity, those added paths, Realtime delivery, actual Android/PWA, and production checkout are **NO DEMOSTRADO**. No missing dependency is replaced with a mock. Full current-backend validation remains an installation gate.

The before phase asserts the observed defect; a PASS there means the failure was reproduced, not that original checkout worked. After phase applies the new migration twice to verify idempotence. The evidence JSON records role, operation, business type, exact PostgreSQL error/context, and before/after counts for sales, items, inventory, receipts, dispensed quantity, cash amount, cash rows and payments. Ordinary 6B intentionally has no inventory application; 6C/credit decrement stock by 2 once. Cash sales receive 100, return 80, and register 20. Credit registers 5 cash and 15 debt. Rejected transactions leave the captured state identical; confirmed operation replay preserves it exactly.

The matrix and detailed evidence are generated below from the final run.

## C. Focused correction and security

Canonical file: `supabase/migrations/20261114055610_pharmacy_stage3_deferred_batch_security.sql`.
Version: `20261114055610`, generated with `supabase migration new`.
SHA-256: `269585fd54688b6e821682df9138eeb36875b68d110867d810ce2e2772989e7c`.

Effective changes:

```sql
ALTER FUNCTION private.pharmacy_stage3_require_final_batch() SECURITY DEFINER;

-- Inside the original SECURITY INVOKER dispense_on_sale_item body only:
v_required := coalesce(v_antibiotic or v_special='IV'
  or v_product.requires_prescription is true
  or coalesce(v_product.prescription_type,'otc') <> 'otc', false);
```

The migration transaction checks the exact original validator body, owner, return type, zero arguments, empty search_path, restricted EXECUTE ACL and active deferred trigger before altering its mode. It verifies the dispense function's owner, invoker mode, search_path, ACL and original/already-corrected body hash before replacing it. Unexpected drift aborts the entire migration. No retrospective migration edits.

The final validator intentionally bypasses RLS as its postgres owner. It is read-only, returns only NULL or the existing fixed error, accepts no client arguments, uses qualified relations, and scopes the dispensation to NEW.license_id/NEW.id with batch license/product correspondence. Immediate guards and FK/uniqueness constraints retain sale/product/tenant integrity. Clients cannot manipulate those NEW rows through direct DML. Production catalog confirms anon/authenticated have no INSERT/UPDATE on sale items, SELECT on private dispensations or EXECUTE on this function. Private pharmacy tables are owned by postgres, RLS enabled and not forced, owner-only ACL, with no policies. No GRANT, RLS change or policy change is introduced.

The NULL correction cannot turn a TRUE prescription requirement into FALSE: coalesce changes only NULL. Classification, fractions I–III, required fields, doctor data, dates, quantity, retained-prescription reuse, sealing/retention, lot validation and immutable confirmed dispensations retain their original branches. `track_batch` and `immutable_dispensation` are untouched. UI, authentication, financial contracts, receipt recovery and retry behavior are untouched.

## D. Validation status

- PostgreSQL regression: 50/50 assertions PASS, within the coverage boundary above.
- JavaScript: 5 files, 57 tests PASS (pharmacy mapping/dispensation/classification, financial explicit retry and receipt reconciliation).
- Canonical migration filename/version scan: PASS (350 unique canonical versions).
- SQL body diff: only the boolean coalesce changed in dispense_on_sale_item; final_batch body unchanged.
- Root cause confirmed: YES. Code/migration prepared: YES.
- Full current financial-backend parity: NO DEMOSTRADO.
- Android/PWA QA and real pharmacy QA: PENDING.
- Migration installed in Production: NO. PR merged: NO. Production checkout recovered: NO DEMOSTRADO.
- GitHub/Vercel checks: see the Draft PR's checks for its exact commit; local regression is not a claim that remote checks passed.

## E. Installation gate and manual QA

Candidate is conditioned on closing the documented current-financial-fixture parity gap and review. Do not install just because this focused regression passes. Review this single Draft, validate current financial dependencies with representative roles, then obtain separate merge/installation authorization. This task grants neither.

For an authorized installation: ensure the reviewed SQL is on current GitHub main, record that main SHA, compare this file's exact SHA-256, verify production definitions/preconditions and the complete canonical ledger/pending-version set, and stop on drift or any unexpected migration. Install only this reviewed migration with version/name/ledger traceability; do not copy a divergent Dashboard variant or run a general db push. Re-read function mode/body/ACL/search_path, trigger and ledger afterwards.

Before any financial retry, resolve the earlier intent's receipt and check history/cash/inventory for an already confirmed operation. Manual QA after separately authorized installation: ordinary cash checkout with the $100 button, correct change, one history sale, one cash movement and one inventory effect; pharmacy ordinary product, a valid prescription dispensation with correct lot/quantity, and critical missing/invalid prescription and invalid/missing batch rejections. Confirm rollback and retained/immutable protections. Stop on ambiguous outcome; no automatic payment retry.

## Matrix evidence (final isolated run)

All matrix operations use `public.pos_execute_financial_operation_v1`; role is anon except 6B ordinary (authenticated), with session_user authenticator. State is shown as sales/items/inventory/cash/payments/receipts/dispensations; stock and cash amount are separate. Values are synthetic.

| Case / business / operation | Original result | Corrected result | Corrected state | Stock before → after / cash amount |
|---|---|---|---|---|
| ordinary_6b / ordinary / sale.cashier | `42501: permission denied for schema private` | `COMMIT` | 1/1/0/1/1/1/0 | 20 → 20 / 20.0 |
| ordinary_credit / ordinary / sale.credit | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/0 | 20 → 18 / 5.0 |
| pharmacy_null_flags / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_REQUIRED` | `COMMIT` | 1/1/1/1/1/1/0 | 20 → 18 / 20.0 |
| common / ordinary / sale.cashier_inventory | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/0 | 18 → 16 / 20.0 |
| common_batch / ordinary / sale.cashier_inventory | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/0 | 20 → 18 / 20.0 |
| pharmacy_other / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_REQUIRED` | `COMMIT` | 1/1/1/1/1/1/0 | 20 → 18 / 20.0 |
| otc / pharmacy / sale.cashier_inventory | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/0 | 20 → 18 / 20.0 |
| antibiotic / pharmacy / sale.cashier_inventory | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/1 | 20 → 18 / 20.0 |
| fraction_iv / pharmacy / sale.cashier_inventory | `42501: permission denied for schema private` | `COMMIT` | 1/1/1/1/1/1/1 | 20 → 18 / 20.0 |
| missing_rx / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_REQUIRED` | `P0001: PHARMACY_PRESCRIPTION_REQUIRED` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| missing_batch / pharmacy / sale.cashier | `42501: permission denied for schema private` | `P0001: PHARMACY_DISPENSATION_BATCH_REQUIRED` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| wrong_batch / pharmacy / sale.cashier_inventory | `P0001: CLOUD_BATCH_NOT_AVAILABLE:iv-batch` | `P0001: CLOUD_BATCH_NOT_AVAILABLE:iv-batch` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| excess / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED` | `P0001: PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| I / pharmacy / sale.cashier_inventory | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:I` | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:I` | 0/0/0/0/0/0/0 | 20 → 20 / 0 |
| II / pharmacy / sale.cashier_inventory | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:II` | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:II` | 0/0/0/0/0/0/0 | 20 → 20 / 0 |
| III / pharmacy / sale.cashier_inventory | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:III` | `P0001: CLOUD_PRODUCT_NOT_AVAILABLE:III` | 0/0/0/0/0/0/0 | 20 → 20 / 0 |
| no_stamp / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_STAMP_REQUIRED` | `P0001: PHARMACY_PRESCRIPTION_STAMP_REQUIRED` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| no_retention / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_RETENTION_REQUIRED` | `P0001: PHARMACY_PRESCRIPTION_RETENTION_REQUIRED` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| expired / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_EXPIRED_OR_QUANTITY_INVALID` | `P0001: PHARMACY_PRESCRIPTION_EXPIRED_OR_QUANTITY_INVALID` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |
| doctor_missing / pharmacy / sale.cashier_inventory | `P0001: PHARMACY_PRESCRIPTION_FIELDS_INVALID` | `P0001: PHARMACY_PRESCRIPTION_FIELDS_INVALID` | 0/0/0/0/0/0/0 | 18 → 18 / 0 |

Every rejected row had identical captured before/after state. Before-fix successful RPC bodies failed at COMMIT with no persisted sale/receipt/effects. Expected original pharmacy ordinary rejection is recorded explicitly, not treated as working checkout.

Additional successful assertions: common-batch and antibiotic confirmed replays preserve state; retained prescription reuse rejected; both client roles denied private SELECT and direct validator execution; owner UPDATE/DELETE of confirmed dispensation rejected; final batch/product corruption within an uncommitted synthetic transaction rejected at COMMIT; repeated migration application; prescription quantity=2, correct batch/product/license correspondence, received=100/change=80/cash=20, completed receipts only, credit debt=15. I–III were rejected by the existing inactive-product gate before the additional pharmacy guard; this run does not claim that branch executed.
