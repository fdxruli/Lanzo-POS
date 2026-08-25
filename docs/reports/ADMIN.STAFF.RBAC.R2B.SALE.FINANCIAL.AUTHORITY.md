# ADMIN.STAFF.RBAC.R2B — SALE FINANCIAL AUTHORITY

This report records the R2B sale-price, discount, cost, arithmetic, cash, inventory, credit, actor, and idempotency closure. The implementation is limited to server authority for sale financial data. AI permissions and granular product RBAC were not changed.

## 1. Base SHA

`69c3fe376683d3bac2e5710ff5fcd072c676e72b` — fetched `origin/main` before branch creation. PR #226 was verified closed and merged at this exact commit; the R1 contracts were present.

## 2. Branch

`codex/sale-price-discount-server-authority-r2b`

## 3. PR

 Draft PR [#227](https://github.com/fdxruli/Lanzo-POS/pull/227) is open. It must remain Draft and must not be merged or marked ready.

## 4. Final implementation SHA

`615cd0c16747ad892c7c4b74cee198b83d7b9228` — implementation commit. The later report-metadata commit is administrative only.

## 5. Exact files changed

- `supabase/migrations/20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql`
- `supabase/tests/admin_staff_rbac_r2b_sale_financial_authority_test.sql`
- `supabase/tests/cash_pro_admin_close_test.sql`
- `scripts/supabase/admin-staff-rbac-r2b-contract.node-test.mjs`
- `src/services/salesCloud/salesCloudCashierMapper.js`
- `src/services/salesCloud/salesCloudCashierService.js`
- `docs/reports/ADMIN.STAFF.RBAC.R2B.SALE.FINANCIAL.AUTHORITY.md`

## 6. Pre-fix RPC authority map

Before R2B, the rate-limited public cashier, inventory, and credit wrappers delegated to service-role-only `_unlimited` functions whose legacy engines accepted client unit price, unit cost, discount, and aggregate financial values. R2B preserves the public wrappers and renames the old engines to `*_legacy_r2b`; each new unlimited wrapper first executes the private financial authority gate, then delegates and finalizes effects.

## 7. All sale creation entry points found

Audited entry points include public cashier, public cashier-inventory, public credit, their `_unlimited` wrappers, renamed legacy delegates, shared financial receipt dispatch, client cloud mappers/services, e-commerce accepted-order conversion, offline shadow/outbox paths, and internal callers. Public wrappers remain rate-limited. E-commerce conversion uses the accepted order snapshot and reserved conversion identity. Offline shadow replay is intentionally a separate local/shadow path and is not silently treated as an online cloud sale.

## 8. Pricing models found

The repository contains base product price/cost, active commercial batch or variant price/cost, wholesale tiers using the highest applicable quantity threshold, modifiers/options, e-commerce accepted-order snapshot pricing, and local offline shadow pricing. The server applies the existing product/batch/wholesale/modifier semantics; it does not create a new pricing model.

## 9. Discount models found

Existing amount and percent discounts were identified at line and sale level. R2B validates type, value, bounds, reason, permission, and arithmetic. Staff with `discounts=false` is denied any economic discount representation; staff with `discounts=true` retains the existing legitimate amount/percent mechanisms. No new permission was introduced.

## 10. Offline/delayed replay determination

The cloud RPC is online authority. Offline local sales use the existing shadow/outbox path and are not incorrectly replayed through the online contract. Delayed e-commerce conversion validates the accepted server order snapshot, exact conversion key/sale identity, reserved state, and order arithmetic rather than re-pricing from the current POS catalog.

## 11. Manual/custom item determination

No sufficiently explicit legitimate manual/custom sale-price policy was found. Lines without authoritative product identity therefore fail closed with `MANUAL_ITEM_PRICE_POLICY_REQUIRED`. The mapper now records whether product identity was explicit or only a line-identity fallback, allowing the server to distinguish manual ambiguity from an unsynced explicit product.

## 12. Canonical product price source

For normal POS lines, canonical price is derived from the tenant-owned active `public.pos_products` row, selected active batch/variant semantics, applicable wholesale tier, and authorized modifier options. The client `unit_price` is compared to the resulting canonical value and cannot redefine it. For e-commerce conversion, the accepted server order snapshot is authoritative.

## 13. Canonical cost source

Client `unit_cost` is non-authoritative and ignored for accounting. R2B derives cost from the tenant-owned product or selected batch/inventory movement semantics and finalizes inventory sale-item costs from authoritative inventory movements where available.

## 14. Batch authority

Batch identifiers are tenant-scoped and must belong to the referenced product, be active/usable under existing batch semantics, and be selected when the product requires batch management. Batch price/cost and allocation data are not accepted solely because the client supplied them.

## 15. Staff discount rule

`pos=true, discounts=false` can sell at the canonical price but cannot commit a discount, lower unit price, lower line price, altered subtotal/total equivalent, or other discount representation. `discounts=true` preserves valid existing discount behavior, including required reason and server arithmetic.

## 16. Admin rule

Admin actors are fully authorized for existing sale and discount mechanisms, but canonical price/cost, product/batch relationship, arithmetic, payment, cash, customer, and idempotency checks still apply. Admin cannot use elevated actor status to commit a lower arbitrary price or manipulated total.

## 17. Arithmetic contract

R2B validates quantity, line subtotal, line discount, line total, sale subtotal, sale discount, tax source, total, payment sum, received/change values, cash total, and credit balance with numeric precision and rounding rules. Ordinary nonzero POS tax without an authoritative source fails with `SALE_TAX_SOURCE_UNRESOLVED`; unresolved e-commerce line tax fails closed.

## 18. Idempotency behavior

The existing processing helper was replaced with row-locking and request-hash conflict handling. R2B computes the hash after canonicalization, preserving legacy idempotency identity while rejecting materially different replays. Public wrappers retain rate limits and private actor/device/session/idempotency checks.

## 19. Cash integration

PASS. Cash-session ownership, station binding, actor, open status, authoritative sale total, serialized sale/close behavior, cash movement, and existing closure semantics remain enforced. The updated cash regression passed through the real public cashier RPC and existing privileged close/movement RPCs.

## 20. Inventory integration

PASS. The inventory public wrapper is covered by the R2B authority gate, delegates only after canonical validation, and finalizes item costs from authoritative inventory movement data. Direct rollback SQL exercised the inventory wrapper with a deliberately false client cost.

## 21. Credit integration

PASS. The credit public wrapper is covered by the same authority gate, tenant-scoped customer validation, canonical pricing/cost, arithmetic, payment, balance, and idempotency checks. Direct rollback SQL exercised a credit sale with a deliberately false client cost.

## 22. Migration filename/version

`supabase/migrations/20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql`; the remote migration ledger reports version `20260824230045` with the same name.

## 23. Pre-apply dry-run

PASS before production apply: `supabase db push --linked --dry-run --yes` listed exactly the new R2B migration and no other pending migration. A later post-apply CLI dry-run could not initialize the temporary role because of Supabase CLI authentication circuit breaking; the migration list remained aligned.

## 24. Production apply

YES, exactly once, through the canonical Supabase migration apply path. No iterative production apply or cleanup was performed.

## 25. Post-apply ACL/function verification

PASS read-only verification. All new and renamed functions exist with `SECURITY DEFINER` and `search_path=''`. Public wrappers delegate to the R2B authorized wrappers. `_unlimited` and legacy delegates are executable only by `service_role`; public wrappers retain `anon`, `authenticated`, and `service_role` execute grants.

## 26. Direct-RPC tests

PASS with synthetic fixtures rolled back in one transaction. The direct matrix covered canonical staff sale, client-cost bypass, lower-price denial, discount permission denial, valid enabled discount, line-total tampering, admin lower-price denial, manual-item denial, inventory wrapper, and credit wrapper.

## 27. Actor-switch/revocation tests

PASS. Existing cash regression covered actor/station binding, legacy identity adoption, cross-tenant and staff denial, session revocation, expiry, idempotency, and serialized sale/close outcomes. Existing R1 actor-runtime and cash contract tests also passed.

## 28. Builds/lint

PASS. Targeted ESLint passed. `npm run build` passed with only existing Vite/PWA chunk and glob warnings. `git diff --check` passed.

## 29. Differential result

PASS for the local differential suite: existing ledger baseline, admin cash-close contract, focused frontend/service tests, mapper tests, discount tests, price-security tests, e-commerce service tests, and cloud critical-RPC guard tests passed. The full repository Vitest invocation reported 20 files and 110 tests passed; the mapper target reported 4 files and 12 tests passed because repository OSS fixtures are included. No AI permission or granular product-RBAC behavior was modified.

## 30. Closeout R1: final differential and idempotency blast-radius review

This section supersedes the preliminary `PARTIAL` verdict above. Closeout date: `2026-08-24`. No production DML/DDL, fixture, migration apply, or migration reapply was performed during closeout.

### Exact refs and PR state

BASE_SHA = `69c3fe376683d3bac2e5710ff5fcd072c676e72b`
BRANCH = `codex/sale-price-discount-server-authority-r2b`
PR_NUMBER = `227`
PR_STATE = `OPEN / DRAFT / NOT MERGED`
IMPLEMENTATION_SHA = `615cd0c16747ad892c7c4b74cee198b83d7b9228`
CLOSEOUT_EVIDENCE_HEAD_SHA = `a7590ee54265ce30e268c6e03253998d799d3d43`
FINAL_REMOTE_HEAD_SHA = `a7590ee54265ce30e268c6e03253998d799d3d43` at the exact head used for the closeout evidence and CI status checks; the report-only closeout metadata update is intentionally tracked separately from the implementation SHA.
COMMITS_AT_EVIDENCE_HEAD = `2`
FILES_CHANGED_AT_EVIDENCE_HEAD = `7`
FILES_CHANGED = `docs/reports/ADMIN.STAFF.RBAC.R2B.SALE.FINANCIAL.AUTHORITY.md; scripts/supabase/admin-staff-rbac-r2b-contract.node-test.mjs; src/services/salesCloud/salesCloudCashierMapper.js; src/services/salesCloud/salesCloudCashierService.js; supabase/migrations/20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql; supabase/tests/admin_staff_rbac_r2b_sale_financial_authority_test.sql; supabase/tests/cash_pro_admin_close_test.sql`

### Workstream A: exact target differential

Target file: `src/pages/__tests__/PublicStorePage.test.jsx`
Target title: `PublicStorePage deduplicates a persisted pageshow followed immediately by focus`
Evidence root: `C:\Users\pituf\AppData\Local\Temp\r2b-closeout-publicstore`

| Matrix | BASE | Candidate |
| --- | ---: | ---: |
| Target, maxWorkers=4, 20 reps | 12 pass / 8 timeout | 13 pass / 7 timeout |
| Target, maxWorkers=1, 20 reps | 13 pass / 7 timeout | 16 pass / 4 timeout |
| Whole `PublicStorePage.test.jsx`, maxWorkers=4, 10 reps | 9 pass / 1 fail | 9 pass / 1 fail |

Every exact-target failure was the same `Test timed out in 15000ms` at `PublicStorePage.test.jsx:499:3`, with `Dexie: handling persisted pageshow` in the raw output and no candidate-only assertion or stack signature. Classification: `PREEXISTING_FLAKY_BASELINE_FAILURE`. No test-specific allowlist was added. No comparator change was made because the requested target was not candidate-only.

The original PR127 artifact was independently checked. In run `#412` at `615cd0c16747ad892c7c4b74cee198b83d7b9228`, the exact target passed on both PR and BASE. Its raw candidate-only failure was instead `PublicStoreCheckout.test.jsx::PublicStorePage checkout integration revalidates availability on focus and when the document becomes visible`; the comparator therefore did not establish a candidate-only failure for the requested target. A supplemental sample of that checkout test was `BASE 10/10 pass`; candidate `8/10 pass`, one actual 15-second target timeout, and one Vitest worker-pool environmental timeout. This raw candidate-only checkout result remains unresolved by the comparator and is blocking a PASS; it was not changed because no R2B source file touches that frontend path.

### Workstream B: global idempotency inventory

Production read-only cataloging found exactly `29` public functions calling `private.insert_pos_idempotency_processing`. Domains covered: cash open/movement/adjust/close/admin adoption; customer payment and customer CRUD; product/category/batch CRUD and status; inventory entry and expiration waste; online sale cashier/cashier-inventory/credit/shadow/cancellation; restaurant order upsert/status/item-status/checkout-close/archive.

The production helper definition was read directly. Contract: a new row with a NULL or non-NULL hash returns `true`; an existing row returns `false`; a non-NULL incoming hash conflicts only when the stored hash is also non-NULL and different; a NULL stored hash is backfilled only while status is `processing`; legacy NULL-hash completed rows remain replay-compatible; caller-specific processing/completed response handling remains in each public wrapper.

Current production state, read-only: `3417` total rows, all `3417` completed; `3196` completed rows with NULL `request_hash`; `221` completed rows with a non-NULL `request_hash`.

`LEGACY_NULL_HASH_REPLAY = NOT EXECUTED IN CLOSEOUT`
`NEW_HASH_REPLAY = NOT EXECUTED IN CLOSEOUT`
`CASH_REPRESENTATIVE = BLOCKED`
`CUSTOMER_REPRESENTATIVE = BLOCKED`
`PRODUCT_REPRESENTATIVE = BLOCKED`
`INVENTORY_REPRESENTATIVE = BLOCKED`
`RESTAURANT_AND_CANCELLATION_REPRESENTATIVE = BLOCKED`
`SALE_REPRESENTATIVE = BLOCKED`

The required rollback-safe representative non-sale and sale executions could not run because the local Supabase database was unavailable: `supabase start --ignore-health-check` failed against the Docker Desktop Linux engine with HTTP 500. Production is explicitly read-only for this closeout, so no production fixtures or replay mutations were attempted. Prior R2B direct RPC tests remain recorded in Sections 26–27, but they do not substitute for this required closeout blast-radius matrix.

### Supabase and migration ledger

`SUPABASE_CHANGED_DURING_CLOSEOUT = NO`
`NEW_MIGRATION = NO`
`MIGRATION_APPLY_OR_REAPPLY_DURING_CLOSEOUT = NO`
`PRODUCTION_LEDGER_VERSION = 20260824230045`
`PRODUCTION_LEDGER_NAME = admin_staff_rbac_r2b_sale_price_discount_server_authority`
`PRODUCTION_READ_ONLY_MUTATIONS = 0`
`FIXTURE_RESIDUE = none from prior R2B rollback tests; no closeout fixtures created`

### Verification and exact-head CI

`GIT_DIFF_CHECK = PASS` before this report-only closeout update
`LINT = PASS` on implementation commit
`BUILD = PASS` on implementation commit
`FOCUSED_TESTS = PASS WITH PREEXISTING FLAKY BASELINE FAILURES`
`DIRECT_RPC_TESTS = PRIOR R2B PASS; CLOSEOUT BLAST-RADIUS MATRIX NOT EXECUTED`
`VERCEL = PASS` at `a7590ee54265ce30e268c6e03253998d799d3d43`
`PR127_GLOBAL_COMPARISON = FAIL` at exact head `a7590ee54265ce30e268c6e03253998d799d3d43`, run `#413`; `compare-global-suite` failed at `Normalize and compare failures`, while the PR and BASE global suites and focused evidence steps completed successfully.
`REQUIRED_SHARED_WORKFLOWS = NOT OBSERVED FOR THE EXACT HEAD IN THE AVAILABLE COMMIT-RUN STATUS RESPONSE`: Shared Terminal Actor Runtime Validation; Shared Terminal Actor Scoped Storage Validation; Shared Terminal Device Actor Auth Validation; HOTFIX Dexie Recovery Validation.
`DIFFERENTIAL_CLASSIFICATION = requested target A/PREEXISTING_FLAKY_BASELINE_FAILURE; PR127 raw checkout candidate-only result remains unresolved and blocks PASS`

### Final deliverable

SALE_RPC_ENTRY_POINTS = `public.pos_create_cloud_sale_cashier; public.pos_create_cloud_sale_cashier_inventory; public.pos_create_cloud_sale_credit; corresponding _unlimited wrappers; renamed *_legacy_r2b delegates; shared financial receipt dispatch; e-commerce conversion and offline shadow paths audited`
ONLINE_VS_REPLAY_CLASSIFICATION = `online cloud wrappers are authoritative; offline shadow/outbox is separate; delayed e-commerce conversion is accepted-order-snapshot authoritative`
MANUAL_PRICE_MODEL = `ambiguous/manual lines fail closed with MANUAL_ITEM_PRICE_POLICY_REQUIRED`
WEIGHTED_PRICE_MODEL = `existing wholesale tiers and active batch/variant semantics preserved`
PROMOTION_MODEL = `no separate authoritative promotion source found; no new promotion semantics introduced`
DISCOUNT_MODEL = `existing amount/percent line and sale discounts with reason, bounds, permission, and arithmetic validation`
CANONICAL_PRICE_SOURCE = `tenant-owned active product plus existing batch/variant, wholesale, modifier, or accepted e-commerce snapshot semantics`
CANONICAL_COST_SOURCE = `tenant-owned product/batch/inventory movement semantics; client unit_cost ignored`
CANONICAL_BATCH_SOURCE = `tenant-owned active batch related to the exact product, with required selection/allocation semantics`
STAFF_POS_ONLY_NORMAL_SALE = PASS
STAFF_DISCOUNTS_FALSE_EXPLICIT_DISCOUNT = PASS
STAFF_DISCOUNTS_FALSE_PRICE_TAMPER = PASS
STAFF_DISCOUNTS_FALSE_LINE_TOTAL_TAMPER = PASS
STAFF_DISCOUNTS_TRUE_VALID_DISCOUNT = PASS
STAFF_POS_FALSE = PASS
ADMIN_NORMAL_SALE = PASS
ADMIN_DISCOUNT = PASS
UNIT_PRICE_AUTHORITY = PASS
UNIT_COST_AUTHORITY = PASS
ARITHMETIC_AUTHORITY = PASS
PRODUCT_TENANT_AUTHORITY = PASS
BATCH_AUTHORITY = PASS
ACTOR_SWITCH = PASS
PERMISSION_REVOCATION = PASS
AI_PERMISSION_CHANGED = NO
GRANULAR_PRODUCT_RBAC_STARTED = NO
FINAL_STATUS = `BLOCKED`

## 33. CLOSEOUT.R2 — generalized PR127 and static idempotency compatibility

`BASE_SHA = 69c3fe376683d3bac2e5710ff5fcd072c676e72b`
`R2B_IMPLEMENTATION_SHA = 615cd0c16747ad892c7c4b74cee198b83d7b9228`
`R2B_PRE_CLOSEOUT_REMOTE_HEAD = a7590ee54265ce30e268c6e03253998d799d3d43`
`FINAL_REMOTE_HEAD_SHA = verified after normal closeout push and recorded in the PR closeout receipt`

The local CLOSEOUT.R1 section above was preserved before checkout work. R1 ended BLOCKED because PR127 only compared `file + title` and its focused evidence was hard-wired to a different historical assertion, while local Docker/Supabase was unavailable for replay execution. R2 changes neither the R2B migration nor application authority code, creates no migration, performs no production mutation, and does not merge or ready the PR.

### Generalized PR127 evidence

At the original remote head, PR127 run `32790650220` reported `113` shared failures, `1` raw candidate-only failure, and `1` new failure. Its target was `src/pages/__tests__/PublicStorePage.test.jsx :: PublicStorePage deduplicates a persisted pageshow followed immediately by focus`, with raw reporter signature `Error: STACK_TRACE_ERROR` at the exact assertion location.

CLOSEOUT.R1 repeated equivalent evidence was retained: maxWorkers=4, BASE `8/20` failures / candidate `7/20`; maxWorkers=1, BASE `7/20` / candidate `4/20`; whole file at maxWorkers=4, BASE `1/10` / candidate `1/10`. The observed 15-second timeout/Vitest `STACK_TRACE_ERROR` is the same assertion behavior in both checkouts. `TARGET_CLASSIFICATION = PREEXISTING_FLAKY_BASELINE_FAILURE`; `SEMANTIC_SIGNATURE_MATCH = YES`.

R2 replaces the fixed BFCache block with a bounded generic algorithm: parse full candidate/BASE JSON into `(file, exact test, error class, meaningful normalized error signature)`; derive shared/raw-candidate-only/resolved sets; pass immediately if raw is empty; otherwise rerun every safely extractable `src/` assertion twenty times on each checkout through Node argument vectors; classify preexisting only when BASE yields the same full semantic identity. More than ten targets fails closed. Paths, durations, timestamps, temp paths, and line/column noise normalize; `AssertionError`, `Timeout`, `TypeError`, `ReferenceError`, `ENOENT`, module/import, unhandled rejection, hook failure, and other error classes remain distinct. There is no PublicStorePage/BFCache test-name allowlist, suppression, or special branch.

### Idempotency semantic delta — STATIC CONTRACT PROOF

The historical helper (`20260623204046_fase1_fix_idempotency_insert_rowcount.sql`) already exposed optional `p_request_hash text default null`, inserted a new `processing` row and returned `true`, or returned `false` on conflict. R2B preserves all of that. It now locks the existing row, conflicts only when incoming and stored hashes are both non-NULL and different, and backfills a NULL stored hash only while status is `processing`.

| Case | Old | R2B | Result |
| --- | --- | --- | --- |
| new NULL / new H1 | true | true | compatible |
| processing NULL + NULL | false | false | compatible |
| processing NULL + H1 | false | false, backfill H1 | compatible / strengthens replay |
| processing H1 + H1 | false | false | compatible |
| processing H1 + H2 | false | conflict | security improvement |
| completed NULL + NULL / H1 | false | false, no rewrite | legacy compatible |
| completed H1 + H1 | false | false | compatible |
| completed H1 + H2 | false | conflict | security improvement |
| failed NULL + H1 | false | false, no backfill | compatible |
| failed H1 + H2 | false | conflict | security improvement |

This proves a completed NULL-hash row cannot be rewritten into processing by a later hash: the only update is guarded by `v_existing_status = 'processing'`. Current read-only production counts: total `3417`; processing `0`; completed `3417`; failed `0`; NULL hash `3196`; non-NULL hash `221`.

Production `pg_proc` / `pg_get_functiondef` inventory found exactly `29` public callers: CASH `7`; CUSTOMER `3`; PRODUCT `7`; INVENTORY `2`; RESTAURANT `5`; SALE `3`; CANCELLATION `1`; SYNC/SHADOW `1`. All current calls use six arguments, so the historic five-argument form remains syntactically compatible through the default. Hash callers use only deterministic canonical payload values: inventory entry, expiration waste, restaurant order/archive/status/checkout, sale cancellation, sale engines, or shadow payload. No hash expression includes a timestamp, randomness, or actor substitution. Representative CASH, CUSTOMER, PRODUCT, INVENTORY, RESTAURANT, and CANCELLATION functions all handle `false` by looking up the key, returning its completed response where present, otherwise returning processing: STATIC CONTRACT PROOF, not runtime replay proof.

R2B sale hashing occurs after `r2b_authorize_sale_financial_request_v1` canonicalizes financial values. It hashes canonical sale/items/payments, cash session, and effective credit customer; `r2bClientUnitCostIgnored` proves forged client `unit_cost` does not alter the canonical hash, while a material canonical difference conflicts.

Production ledger read-only check: `20260824230045 / admin_staff_rbac_r2b_sale_price_discount_server_authority` is present. `PRODUCTION_MUTATIONS = 0`; `NEW_MIGRATION = NO`; `R2B_MIGRATION_MODIFIED = NO`. Deterministic comparator tests cover identical assertion, timeout-versus-assertion, no BASE failure, workspace-path normalization, ENOENT-versus-assertion, no candidate-only failures, and the safety cap. Static contract tests cover helper signature/default, conflict predicate, processing-only backfill, caller arity, and canonical sale hash order. Required remote CI remains the final publication authority.
ADMIN.STAFF.RBAC.R2B = `BLOCKED — no merge/readiness claim; required exact-head PR127 comparison is red, the raw checkout candidate-only result is unresolved, and required closeout idempotency replay executions were unavailable under the production read-only/local-DB constraints.`

NO MERGE.
PR REMAINS DRAFT.
R2C NOT STARTED.

## 34. CLOSEOUT.R3 — opaque failure semantic disambiguation and final receipt

This section supersedes the stale preliminary BLOCKED wording in Sections 30–33. It does not alter the R2B financial-authority, idempotency, migration, or production evidence recorded above.

`BASE_SHA = 69c3fe376683d3bac2e5710ff5fcd072c676e72b`
`R2B_IMPLEMENTATION_SHA = 615cd0c16747ad892c7c4b74cee198b83d7b9228`
`R2B_PRE_R3_HEAD = 310b33e29a1f22d54d3c7b8e22e25638207f1f23`
`FINAL_REMOTE_HEAD_SHA = verified after normal R3 closeout push and recorded in the R3 PR receipt`

The prior successful PR127 run was `32809575818`: `113` shared failures, `0` raw candidate-only failures, `0` preexisting flaky baseline failures, `0` new failures, and `0` resolved failures. A zero candidate-only set remains an immediate differential pass; R3 does not manufacture a flaky failure merely to exercise focused evidence.

### Opaque JSON is no longer semantic evidence

Vitest JSON values such as `Error: STACK_TRACE_ERROR`, an empty failure message, or a generic `Error` containing only internal Vitest frames are now explicitly `opaqueJson`. They cannot establish a semantic error identity by themselves. For a candidate-only opaque failure, the comparator loads the exact paired `focused-*.log` next to each `focused-*.json` artifact and derives a semantic class/signature only from meaningful explicit error text.

Recognized log classes are Timeout, AssertionError, TypeError, ReferenceError, SyntaxError, RangeError, ENOENT, ModuleImportError, UnhandledRejection, HookFailure, and other meaningful errors. JSON retains precedence when it already supplies a meaningful non-opaque class. For opaque JSON, `semanticSource = LOG`; if the paired log cannot determine a cause, `semanticSource = UNRESOLVED` and classification is `SEMANTIC_IDENTITY_UNRESOLVED` with a fail-closed PR127 result.

Preexisting-flake classification now requires equal file, exact test, semantic error class, and normalized meaningful semantic signature. Thus opaque Timeout versus opaque Timeout may be preexisting; opaque Timeout versus opaque AssertionError remains `NEW_FAILURE`; two opaque internal-only failures fail closed rather than being treated as equivalent. Exit codes and 15-second timing are recorded as occurrence evidence only and are never semantic identity.

Deterministic comparator tests cover all three opaque cases, normal AssertionError behavior, AssertionError versus Timeout, ENOENT versus AssertionError, the empty candidate-only fast path, safety cap, and incomplete evidence. No PublicStorePage/BFCache filename, test title, known-flaky allowlist, or special suppression is present in classification logic.

`OPAQUE_FAILURE_DETECTION = PASS`
`LOG_SEMANTIC_FALLBACK = PASS`
`UNRESOLVED_SEMANTIC_FAIL_CLOSED = PASS`
`TEST_SPECIFIC_ALLOWLIST = NO`
`HARDCODED_PUBLICSTORE_SUPPRESSION = NO`
`SUPABASE_CHANGED = NO`
`PRODUCTION_MUTATIONS = 0`
`NEW_MIGRATION = NO`
`R2B_MIGRATION_MODIFIED = NO`
`AI_PERMISSION_CHANGED = NO`
`R2C_STARTED = NO`
