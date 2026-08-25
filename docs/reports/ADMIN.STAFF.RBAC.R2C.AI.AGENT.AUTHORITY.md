# ADMIN.STAFF.RBAC.R2C - AI AGENT STAFF AUTHORITY

Status at authoring: PARTIAL/BLOCKED pending canonical production migration gates and independent review. The implementation is committed on the requested branch, but production was not changed.

## Execution identity

- Repository: fdxruli/Lanzo-POS
- Expected and actual current remote main: 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Base: origin/main at 1c8d83ca657616d91dfcd1c0671b3a8d6972860b
- Branch: codex/admin-staff-ai-agent-authority-r2c
- PR: pending Draft PR creation at first report commit; this field is updated in the final report commit.
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
- PR_NUMBER: pending
- FINAL_HEAD_SHA: pending
- COMMITS: pending
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
