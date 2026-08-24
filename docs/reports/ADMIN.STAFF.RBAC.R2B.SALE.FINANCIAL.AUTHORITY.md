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

## 30. Remaining risks

Remote CI is not yet complete on the current PR head: Vercel is green and `PR127 Global Comparison` is in progress. Supabase CLI post-apply dry-run was blocked by temporary-role authentication failures, although pre-apply dry-run, migration ledger alignment, read-only function/grant checks, direct RPC tests, security-advisor filtering, and performance advisors passed. E-commerce tax semantics remain fail-closed rather than newly inferred. Independent review is required before any readiness or merge decision.

## 31. AI P0 explicitly deferred to R2C

AI permissions, AI P0, and granular product-level RBAC are explicitly out of scope and were not started. `AI_PERMISSION_CHANGED = NO`; `GRANULAR_PRODUCT_RBAC_STARTED = NO`.

## 32. Exact final verdict

The server-authority closure is implemented and production-applied with no known bypass in the audited public online sale wrappers. Final status is initially `PARTIAL` pending remote CI and independent review; it is not `BLOCKED` because canonical price, cost, manual-item handling, replay classification, public wrapper authority, discount permission, arithmetic, cash, inventory, credit, tenant, and idempotency controls are determined and directly exercised.

## Final deliverable

BASE_SHA = `69c3fe376683d3bac2e5710ff5fcd072c676e72b`
BRANCH = `codex/sale-price-discount-server-authority-r2b`
PR_NUMBER = `227`
PR_STATE = `OPEN / DRAFT / NOT MERGED`
FINAL_HEAD_SHA = `615cd0c16747ad892c7c4b74cee198b83d7b9228` — implementation head; report metadata follows in the administrative commit

COMMITS = `2 — 615cd0c16747ad892c7c4b74cee198b83d7b9228 implementation; report metadata update`
FILES_CHANGED = `7 exact files listed in Section 5`

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
STAFF_POS_FALSE = PASS — existing server `pos` permission gate remains fail closed

ADMIN_NORMAL_SALE = PASS
ADMIN_DISCOUNT = PASS

UNIT_PRICE_AUTHORITY = PASS
UNIT_COST_AUTHORITY = PASS
ARITHMETIC_AUTHORITY = PASS
PRODUCT_TENANT_AUTHORITY = PASS
BATCH_AUTHORITY = PASS

CASH_INTEGRATION = PASS
INVENTORY_INTEGRATION = PASS
CREDIT_INTEGRATION = PASS

ACTOR_SWITCH = PASS
PERMISSION_REVOCATION = PASS
IDEMPOTENCY = PASS

SUPABASE_CHANGED = YES
MIGRATIONS = `20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql`
PRODUCTION_APPLIED = YES
PRODUCTION_LEDGER_VERSION = `20260824230045`
PRODUCTION_VERIFIED = YES
FIXTURE_RESIDUE = `none; all R2B and cash regression fixtures roll back`

GIT_DIFF_CHECK = PASS
LINT = PASS
BUILD = PASS
FOCUSED_TESTS = PASS
DIRECT_RPC_TESTS = PASS
REMOTE_CI = `Vercel PASS; PR127 Global Comparison IN_PROGRESS on PR #227`
DIFFERENTIAL_REGRESSIONS = `PASS locally; PR127 Global Comparison pending`

AI_PERMISSION_CHANGED = NO
GRANULAR_PRODUCT_RBAC_STARTED = NO

FINAL_STATUS = `PARTIAL`
ADMIN.STAFF.RBAC.R2B: PARTIAL

NO MERGE.
PR REMAINS DRAFT.
R2C NOT STARTED.

Await independent review.
