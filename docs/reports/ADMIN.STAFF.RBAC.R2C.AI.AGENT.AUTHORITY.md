# ADMIN.STAFF.RBAC.R2C - AI AGENT STAFF AUTHORITY

Status at authoring: PARTIAL/BLOCKED pending canonical production migration gates and independent review. The implementation is committed on the requested branch, but production was not changed.

## Execution identity

- Repository: fdxruli/Lanzo-POS
- Expected and actual current remote main: 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Base: origin/main at 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Branch: codex/admin-staff-ai-agent-authority-r2c
- PR: #229, Draft, https://github.com/fdxruli/Lanzo-POS/pull/229
- Historical R2B migration was not edited or reopened.

## Authority map before R2C

Client entry: OperationalDiagnostics -> AIAgentDashboard -> analyzeWithAI or validateAIConnection. The Edge Function is lanzo-ai-agent. Analysis calls begin_ai_agent_analysis, then provider, then complete_ai_agent_analysis cleanup.

Client usage entry points: src/services/aiService.js getAIAgentUsageStatus and validateAIConnection; src/services/aiAgentUsageService.js getAIAgentUsage.

Postgres entry points audited: get_ai_agent_usage, get_ai_agent_usage_unlimited, begin_ai_agent_analysis, complete_ai_agent_analysis, ensure_current_license_period, ai_agent_usage, and private.resolve_device_actor_session. Before R2C the shared unlimited helper validated license, entitlement, device, and current actor/session but did not require Staff actor_permissions.ai_agents.

Pre-R2C authority order: entitlement -> device/token -> actor/session -> period/quota lookup; begin then reserved usage. The missing Staff permission check meant a valid entitled Staff actor could reach the real reservation path.

## R2C design

- Plan authority remains the merged plan/license AI entitlement. Entitlement is independent from Staff permission.
- Admin requires a valid current Admin actor/session, valid tenant/license context, entitlement, and existing quota rules. Admin does not require a Staff permission key.
- Staff requires a valid current Staff actor/session, tenant/license context, entitlement, and an explicit boolean true ai_agents permission.
- Missing, null, malformed, or false ai_agents is denied. No existing Staff row is auto-granted.
- private.default_staff_permissions now includes ai_agents=false in the new forward-only migration.
- private.normalize_staff_permissions allows ai_agents and preserves only boolean values; unknown keys remain ignored.
- Server gate is in get_ai_agent_usage_unlimited immediately after actor/session resolution and before period creation, usage counting, or reservation work. begin_ai_agent_analysis already crosses get_ai_agent_usage first.
- Edge Function changes are limited to the stable public error mapping AI_AGENT_PERMISSION_REQUIRED and a focused denial test. The Edge Function still calls begin before the provider and complete remains cleanup-only.
- Client ActorRuntime fences are present in OperationalDiagnostics, AIAgentDashboard, aiService, and aiAgentUsageService. Auth context selects the current Admin or Staff session cache key.

## Files changed

- src/components/dashboard/OperationalDiagnostics.jsx
- src/components/dashboard/AIAgentDashboard.jsx
- src/services/aiAgentUsageService.js
- src/services/aiService.js
- src/services/auth/aiAgentAuthorization.js
- src/services/auth/__tests__/aiAgentAuthorization.test.js
- supabase/migrations/20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql
- supabase/functions/lanzo-ai-agent/index.ts
- supabase/functions/lanzo-ai-agent/index.test.ts
- scripts/supabase/ai-agent-authority-r2c-contract.node-test.mjs
- docs/reports/ADMIN.STAFF.RBAC.R2C.AI.AGENT.AUTHORITY.md

## Production read-only evidence before migration

- Project: odlrhijtfyavryeqivaa
- TOTAL_ACTIVE_STAFF: 6
- STAFF_WITH_AI_AGENTS_KEY: 0
- STAFF_AI_AGENTS_TRUE: 0
- STAFF_AI_AGENTS_FALSE: 0
- Missing or null key: 6
- Current AI usage rows at audit: completed 13, failed 1, reserved 0.
- Production migration ledger latest version: 20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.
- Existing AI ACL audit: get_ai_agent_usage and get_ai_agent_usage_unlimited are SECURITY DEFINER with empty search_path and service_role-only execution in the audited production state; complete_ai_agent_analysis remains service_role-only. The new migration also explicitly revokes public, anon, and authenticated on the unlimited helper and grants service_role.
- Existing security advisor finding preserved and not auto-remediated: three private tables have RLS disabled. This is unrelated scope and remains a separate finding.

## Migration and production gate

Migration file: supabase/migrations/20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql

The repository Supabase CLI is unavailable: supabase command is not installed and supabase/.temp/cli-latest is only a placeholder file. Therefore db push --dry-run and the canonical migration apply could not be executed. I did not use raw production DDL or a noncanonical schema_migrations write, and I did not call supabase_apply_migration without the required dry-run and test gates.

Production apply result: NO. Production ledger, Staff rows, and AI usage rows were not mutated by this task. Post-migration fields are N/A; the current read-only production state remains the pre-migration state above.

No rollback fixtures or production test rows were created. FIXTURE_RESIDUE=0. No real production AI/provider call was made. REAL_PRODUCTION_AI_USAGE_MUTATIONS=0.

## Verification

- R2C static contract: PASS, 4 tests.
- AI authority unit tests: PASS, 4 tests.
- ActorRuntime/session focused suite: PASS, 5 files and 40 tests.
- PR127 global comparison contract: PASS, 10 tests.
- R2B and idempotency static contracts: PASS, 7 tests.
- Migration ledger baseline contracts: PASS, 11 tests.
- Focused ESLint scope: PASS. Global npm lint remains failing on pre-existing unrelated errors; one R2C dependency warning was fixed.
- Production build: PASS. Vite/PWA emitted existing glob warnings.
- Edge Function Deno suite: NOT RUN because Deno is unavailable. The focused test was added and statically asserted by the R2C contract test.
- Direct public RPC matrix, direct internal service_role fixture matrix, Staff round-trip, revocation fixture, actor-switch fixture, cleanup-after-revocation fixture, db push dry-run, and remote CI: NOT RUN because the canonical migration/test environment was unavailable. These are required independent review gates.

## Required field register

- CURRENT_MAIN_SHA: 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- BRANCH: codex/admin-staff-ai-agent-authority-r2c
- PR_NUMBER: 229
- FINAL_HEAD_SHA: c53de0f1d711998e47e0d3eaf9961ca934b7350c
- COMMITS: 1 (c53de0f1d711998e47e0d3eaf9961ca934b7350c)
- PR_STATE: Draft
- SUPABASE_CHANGED: NO
- PRODUCTION_APPLIED: NO
- EDGE_FUNCTION_CHANGED: YES, source only
- EDGE_FUNCTION_DEPLOYED: NO
- EDGE_FUNCTION_NAME: lanzo-ai-agent
- EDGE_FUNCTION_REVISION: N/A
- MIGRATIONS: 20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql, repository only
- POST_MIGRATION_ACTIVE_STAFF: N/A; production unchanged, read-only current total 6
- POST_MIGRATION_AI_TRUE: N/A; production unchanged, read-only current true count 0
- REAL_STAFF_AUTO_GRANTED_AI: 0
- REAL_PRODUCTION_AI_USAGE_MUTATIONS: 0
- FIXTURE_RESIDUE: 0
- R2B_SALE_AUTHORITY_CHANGED: NO
- R2B_MIGRATION_CHANGED: NO
- IDEMPOTENCY_ARCHITECTURE_CHANGED: NO
- OG_V2_CHANGED: NO
- GRANULAR_PRODUCT_RBAC_STARTED: NO
- R2D_STARTED: NO

## Final verdict

Implementation is ready for independent review as a Draft PR, but it is not a production closure. The final status is BLOCKED until canonical Supabase dry-run/apply, direct RPC/fixture matrix, Edge Function runtime tests, remote CI, and exact final differential verification can be run.

NO MERGE. PR REMAINS DRAFT. NO FORCE PUSH. NO HISTORICAL MIGRATION EDIT. R2B NOT REOPENED. R2D NOT STARTED.


## CLOSEOUT.R1

Closeout run date: 2026-08-25. Existing PR #229 remains the only PR; no merge, force-push, historical migration edit, R2B reopen, or R2D start was performed.

### Closeout identity

- Starting PR head: 48638115253d4c6899616c92d25767351409696a
- Closeout source head before this report update: 7f2486f9c7935f4837e972b037f1817b1a3d030f
- Base/main: 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Branch: codex/admin-staff-ai-agent-authority-r2c
- PR: #229, Draft, open, not merged
- Closeout commit: 7f2486f9c7935f4837e972b037f1817b1a3d030f (tenant-scoped AI history)

### AI history tenant-isolation closeout

- AI_HISTORY_OLD_DB: LanzoDB1_ai_history. It is legacy/unresolved storage; the service no longer opens, imports, assigns, surfaces, or deletes it.
- AI_HISTORY_NEW_STORAGE: tenant-derived companion Dexie database runtime.databaseName + _ai_history, keyed by the canonical TenantRuntime opaqueId/databaseName/generation; no per-actor database is created.
- AI_HISTORY_SCOPE: TENANT.
- Tenant A save/read: PASS.
- Tenant A -> B absent: PASS.
- Tenant B -> A persistence: PASS.
- Same-tenant Admin/Staff shared history: PASS.
- TenantRuntime not-ready fail-closed: PASS.
- Legacy global history unresolved/not surfaced/not deleted: PASS.
- Stale async A write after B switch: PASS; stale write rejects with TENANT_RUNTIME_STALE and cannot write B.
- Focused history suite: 6/6.
- Affected tenant/runtime suite: 53/53.
- ESLint for changed history files: PASS.
- Production build: PASS; existing Vite dynamic-import warnings only.

### Production migration closeout

- Pre-apply canonical ledger comparison: PASS for the checked remote list: local 243, remote 242, remote-only 0, only pending version 20260825090000.
- The exact repository SQL was sent through the Supabase apply_migration operation and the function/default/ACL checks completed.
- Production project: odlrhijtfyavryeqivaa.
- Production migration ledger result: BLOCKED. The connector recorded version 20260825214805 with name 20260825090000_admin_staff_rbac_r2c_ai_agent_authority instead of the required exact canonical version 20260825090000. No manual schema_migrations edit or noncanonical repair was attempted.
- Post-apply read-only checks: default permissions include ai_agents=false; normalization accepts only boolean ai_agents; get_ai_agent_usage_unlimited(text,text,text,text) is SECURITY DEFINER with public/anon/authenticated execute=false and service_role execute=true; Staff gate is present before period lookup.
- Production Staff read-only counts after apply: active 6; explicit ai_agents key 0; ai_agents=true 0; ai_agents=false 0.
- R2C fixture matrix: missing key PASS; null PASS; boolean false PASS; malformed JSON string "true" FAIL because jsonb ->> text comparison treats it as true and the function reached AI_AGENT_LIMIT_DISABLED. This is a security-correctness blocker requiring an authorized forward-only correction; the already-applied R2C migration was not edited.
- Real production Staff permission mutations: 0.
- Real production AI/provider calls: 0.
- Fixture residue: 0 licenses, 0 Staff rows, 0 devices, 0 sessions with the fixture prefix; AI usage remains completed 13, failed 1, reserved 0.
- begin_ai_agent_analysis with Staff ai_agents=false: PASS; returned AI_AGENT_PERMISSION_REQUIRED before reservation and fixture usage delta was 0.

### Edge and CI closeout

- Edge Function: lanzo-ai-agent source was not deployed in this closeout. Local Deno is unavailable, the production denial matrix has the malformed-string failure above, and deployment was not attempted without a passing runtime gate.
- Existing production Edge Function remains unchanged at the pre-closeout version 10.
- Exact final-head remote CI was pending at source head 7f2486f9: Vercel pending; PR127 Global Comparison in progress; Shared Terminal Actor Runtime Validation in progress.
- No real provider call was made.

### CLOSEOUT.R1 verdict

BLOCKED. The local tenant history boundary is closed and verified, and the R2C SQL behavior is partially applied and read-only verified, but closure cannot be PASS because the production migration ledger version is not the exact canonical version and malformed Staff ai_agents string input fails open to period/quota work. The Edge Function was intentionally left undeployed pending an authorized correction and passing runtime matrix.

NO MERGE. PR REMAINS DRAFT. NO FORCE PUSH. NO HISTORICAL MIGRATION EDIT. R2B NOT REOPENED. R2D NOT STARTED.

## CLOSEOUT.R2

Closeout run date: 2026-08-25. This closeout used the existing PR #229 and existing branch only. No merge, force-push, historical applied-SQL edit, R2B reopen, or R2D start occurred.

### Closeout identity

- Repository: fdxruli/Lanzo-POS
- Project: odlrhijtfyavryeqivaa
- Base SHA: 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Starting PR head SHA: b4d89e78ef77217d465d66abd681e004f79f388c
- Branch: codex/admin-staff-ai-agent-authority-r2c
- PR: #229, OPEN, DRAFT, not merged
- Remote head before this report append: e0b5356a7757aa76b97c208f982c01a373b608e6
- Closeout commits before this report append: 637e6f24f19218b45156245b62de76e669000c3c, f8b98c094158ffac787048d215208b5b44503420, 81cf250302057c1c81c45d96b9599a00baa4d039, a56f2ea40a0cac176abdbaca8a3d91a3a5f75e51, 1a6d7fda83654a12250becf3c3219348fccf8c26, e0b5356a7757aa76b97c208f982c01a373b608e6
- The last two commits contain the test-only AI-history connection cleanup hook and its test cleanup call. Production still reuses per-tenant connections.

### Canonical migration identity and production apply

- The originally applied repository migration was preserved byte-for-byte and renamed from 20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql to 20260825214805_20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql. The pre/post repository SQL hash was E1C0499F6645A5AF1C072EEDEDF85F7A2D382CECC98E5B76CF261DD5C18D8A1F.
- Production already recorded that original SQL under version 20260825214805 and name 20260825090000_admin_staff_rbac_r2c_ai_agent_authority. No schema_migrations row was edited.
- The strict correction is a separate forward-only migration: 20260825233834_20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority.sql.
- The correction requires jsonb_typeof(actor_permissions.ai_agents) = boolean and the JSONB value true. The old text comparison remains only in the historical applied migration; the strict migration uses the boolean-only predicate.
- The exact correction SQL was applied through the Supabase migration operation. The connector recorded version 20260825233834 with name 20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority. No manual ledger repair was performed.
- Canonical ledger dry-run before apply: only the strict correction was pending, remote-only count 0. Final ledger verification: no pending migrations and remote-only count 0.
- Production read-only Staff counts after correction: active 6; explicit ai_agents key 0; boolean true 0; boolean false 0; malformed 0.
- Global AI usage after correction: completed 13; failed 1; reserved 0.

### Runtime authority matrix

All generated fixtures were cleaned in the same controlled run. Every listed case passed:

- AI_MISSING, AI_NULL, AI_FALSE, AI_TRUE_STRING, AI_FALSE_STRING, AI_NUMBER_1, AI_NUMBER_0, AI_OBJECT, and AI_ARRAY: AI_AGENT_PERMISSION_REQUIRED.
- AI_TRUE_BOOLEAN: success=true.
- NORMALIZATION_BOOLEAN_TRUE: PASS.
- NORMALIZATION_BOOLEAN_FALSE: PASS.
- NORMALIZATION_STRING_TRUE: PASS and normalized to false.
- STAFF_PLAN_TRUE_AI_FALSE, STAFF_PLAN_TRUE_AI_MISSING, and STAFF_PLAN_TRUE_AI_MALFORMED: denied.
- STAFF_PLAN_TRUE_AI_TRUE: allowed.
- STAFF_PLAN_FALSE_AI_TRUE: denied by AI_AGENTS_NOT_AVAILABLE.
- STAFF_OTHER_PERMS_AI_FALSE: denied.
- STAFF_AI_TRUE_POS_FALSE: allowed; unrelated POS permission did not grant or remove AI authority.
- ADMIN_PLAN_TRUE: allowed through Admin actor/session authority.
- ADMIN_PLAN_FALSE: denied by AI_AGENTS_NOT_AVAILABLE.
- INVALID_STAFF_SESSION, EXPIRED_STAFF_SESSION, TENANT_MISMATCH, and AMBIGUOUS_ACTOR: all denied fail-closed.
- STAFF_PERMISSION_ROUND_TRIP: Admin update returned normalized boolean true.
- PERMISSION_REVOCATION: Admin update returned normalized boolean false and subsequent Staff use was denied.
- DIRECT_PUBLIC_RPC_AUTHORITY: public wrapper allowed valid boolean Staff authority and denied missing session.
- INTERNAL_SERVICE_ROLE_AUTHORITY: service_role could invoke the internal helper and valid Staff authority still governed the result.
- BEGIN_DENIAL_BEFORE_RESERVATION: AI_AGENT_PERMISSION_REQUIRED with usage delta 0.
- UNAUTHORIZED_RESERVATION_MUTATION: 0.
- AUTHORIZED_CLEANUP_AFTER_REVOCATION: begin reserved once, revocation disabled the Staff authority, and completion finalized the row as failed with no reserved residue.

No real Staff row was changed. No provider request was made.

### Exact differential evidence

- Original actor-runtime workflow: run #132, ID 32904544213. Focused validation passed; the differential gate reported two candidate-only rows in the full-suite artifact.
- Exact candidate-only rows were:
  - src/pages/__tests__/PublicStorePage.siteVersion.test.jsx > PublicStorePage published site versions keeps v1 while only the draft changes, then renders v2 without changing catalogRevision — Error: STACK_TRACE_ERROR, line 107.
  - src/pages/__tests__/PublicStorePage.test.jsx > PublicStorePage deduplicates a persisted pageshow followed immediately by focus — Error: STACK_TRACE_ERROR, line 499.
- The 20-repetition focused candidate evidence reproduced neither failure; the full-suite-only ordering/scheduling behavior is classified ENVIRONMENTAL_VARIANCE, not an application regression. No comparator change and no test-specific allowlist were made.
- Final-head Shared Terminal Actor Runtime Validation #138 / ID 32913499375 completed SUCCESS. Its focused job passed diff check, ActorRuntime tests, tenant isolation, authentication regression, ESLint, and both builds. BASE repeated full-suite results were 3175 passed / 85 failed / 51 skipped / 3311 total in both repetitions; CANDIDATE results were 3185 passed / 85 failed / 51 skipped / 3321 total in both repetitions. The differential gate reproduced every candidate failure in BASE and reported zero differential regressions.
- Final-head PR127 Global Comparison #427 / ID 32913499309 completed SUCCESS, including candidate/base suites, focused evidence, normalization, and comparison.

### Edge and verification gates

- Edge Function: lanzo-ai-agent.
- Changed Edge source has the stable AI_AGENT_PERMISSION_REQUIRED mapping and the provider-before-reservation denial test.
- Local Deno is unavailable and the repository has no canonical Edge/Deno CI workflow. The production Edge Function was therefore not deployed; production remains version 10. EDGE_FUNCTION_TESTS=NOT_RUN and EDGE_FUNCTION_DEPLOYED=NO.
- Repository static R2C contract verification was performed against the final branch contents: canonical migration names, historical predicate preservation, strict boolean predicate/order, ACL, and history cleanup hook all passed.
- Earlier affected local Vitest evidence passed: combined PublicStore/AI-history/AI-authorization run 30/30; affected tenant/runtime suite 53/53. The full local suite retained known baseline failures plus one PublicStore STACK_TRACE_ERROR variance and was not represented as green.
- The remote focused workflow passed git diff --check, lint, builds, and its scoped tests. Final global/differential status was still pending at append time.

### Safety and scope register

- REAL_PRODUCTION_STAFF_PERMISSION_MUTATIONS=0.
- REAL_PRODUCTION_AI_USAGE_MUTATIONS=0.
- REAL_PRODUCTION_AI_PROVIDER_CALLS=0.
- REAL_STAFF_AUTO_GRANTED_AI=0.
- FIXTURE_RESIDUE=0: zero generated licenses, Staff/Admin users, devices, sessions, usage rows, rate limits, usage logs, audit rows, or license events remain.
- AI_HISTORY_TENANT_ISOLATION=PASS.
- LEGACY_AI_HISTORY_AUTO_ASSIGNED=NO.
- LEGACY_AI_HISTORY_DELETED=NO.
- R2B_SALE_AUTHORITY_CHANGED=NO.
- R2B_MIGRATION_CHANGED=NO.
- IDEMPOTENCY_ARCHITECTURE_CHANGED=NO.
- OG_V2_CHANGED=NO.
- GRANULAR_PRODUCT_RBAC_STARTED=NO.
- R2D_STARTED=NO.

### CLOSEOUT.R2 verdict

BLOCKED. The strict boolean Staff authority correction is applied and runtime-verified in production with zero real Staff or provider mutations, the required history cleanup is verified, and all available remote CI gates are green. Closure remains blocked because Edge runtime tests cannot be run through an available canonical Deno path; the changed Edge Function was therefore intentionally not deployed.

NO MERGE. PR #229 REMAINS DRAFT. NO FORCE PUSH. NO MANUAL MIGRATION LEDGER REPAIR. NO HISTORICAL APPLIED SQL EDIT. NO REAL PRODUCTION AI PROVIDER CALL. R2B NOT REOPENED. R2D NOT STARTED.
