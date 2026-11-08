import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');
const migration = read('supabase/migrations/20261108074334_lanzo_staff_customer_payments_permission_stage_5b.sql');
const staffSettings = read('src/components/settings/StaffUsersSettings.jsx');
const actorIdentity = read('src/services/auth/actorIdentity.js');
const service = read('src/services/customerCredit/customerCreditRepository.js');
const localRepository = read('src/services/db/customerCreditRepository.js');
const page = read('src/pages/CustomersPage.jsx');
const packageJson = JSON.parse(read('package.json'));

test('legacy and explicit Staff permission values resolve without broadening related permissions', () => {
  assert.match(migration, /'customer_payments', false/u);
  assert.match(migration, /'customers', 'customer_payments', 'reports'/u);
  assert.match(migration, /if p_permissions \? 'customer_payments' then[\s\S]*?'false'::jsonb[\s\S]*?else[\s\S]*?v_result->'customers'/u);
  assert.match(migration, /if v_result->'customers' is distinct from 'true'::jsonb[\s\S]*?'customer_payments'/u);
  assert.match(actorIdentity, /!Object\.prototype\.hasOwnProperty\.call\(permissions \|\| \{\}, 'customer_payments'\)[\s\S]*?permissions\?\.customers === true/u);
  assert.match(actorIdentity, /if \(!hasCustomersPermission\)[\s\S]*?permission !== 'customer_payments'/u);
  assert.match(staffSettings, /customer_payments: 'Registrar abonos'/u);
  assert.match(staffSettings, /normalized\.customer_payments = normalized\.customers === true/u);
  assert.match(staffSettings, /customer_payments: true/u);
});

test('Cloud authorization reads the current active Staff row under a lock', () => {
  const guardStart = migration.indexOf('create or replace function private.assert_customer_payment_permission');
  const guardEnd = migration.indexOf('$function$;', guardStart);
  const guard = migration.slice(guardStart, guardEnd);

  assert.ok(guardStart >= 0 && guardEnd > guardStart);
  assert.match(guard, /if v_actor_type = 'admin' then\s+return;/u);
  assert.match(guard, /s\.id = v_staff_user_id\s+and s\.license_id = v_license_id\s+and s\.is_active is true\s+for share/u);
  assert.match(guard, /v_current_permissions->'customers' is distinct from 'true'::jsonb/u);
  assert.match(guard, /if v_current_permissions \? 'customer_payments' then[\s\S]*?= 'true'::jsonb then\s+return;[\s\S]*?else[\s\S]*?Legacy permission maps/u);
  assert.match(guard, /POS_PERMISSION_DENIED:customer_payments/u);
  assert.match(migration, /revoke all on function private\.assert_customer_payment_permission\(jsonb\)\s+from public, anon, authenticated, service_role/u);
});

test('completed payment idempotency is returned before the new permission guard', () => {
  const patchStart = migration.indexOf('do $payment_core_guard$');
  const patchEnd = migration.indexOf('$payment_core_guard$;', patchStart);
  const corePatch = migration.slice(patchStart, patchEnd);

  assert.ok(patchStart >= 0 && patchEnd > patchStart);
  assert.match(corePatch, /v_completed_position[\s\S]*?v_processing_position[\s\S]*?v_anchor_position/u);
  assert.match(corePatch, /v_completed_position > v_anchor_position or v_processing_position > v_anchor_position/u);
  assert.match(corePatch, /v_definition := replace\(v_definition, v_anchor, v_insertion \|\| v_anchor\)/u);
  assert.match(corePatch, /perform private\.assert_customer_payment_permission\(v_context\)/u);
  assert.match(migration, /public\.pos_record_customer_payment_v2\(/u);
  assert.match(migration, /STAFF_CUSTOMER_PAYMENTS_V2_GRANTS_MISSING/u);
  // Legacy callers remain supported only through the known rate-limited
  // wrapper that forwards into the guarded payment core.
  assert.match(migration, /p\.proname = 'pos_record_customer_payment'[\s\S]*?LEGACY_RPC_ROUTE_MISMATCH/u);
  assert.match(migration, /enforce_pos_rpc_rate_limit_v2[\s\S]*?pos_record_customer_payment_unlimited/u);
  assert.match(migration, /da5ca36d00b29a3163907fed17786a7853805e79561ee4da173bd8681c90300c/u);
  assert.match(migration, /LEGACY_RPC_CONTRACT_MISMATCH/u);
  assert.doesNotMatch(migration, /LEGACY_RPC_EXPOSED/u);
  assert.doesNotMatch(migration, /\b(?:grant|revoke)\s+[^;]*\bpos_record_customer_payment\s*\(/iu);
});

test('the client checks current ActorRuntime permission and preserves Cloud recovery results', () => {
  assert.match(service, /actorRuntimeController\.capture\('customers'\)/u);
  assert.match(service, /actorHandle\.assertCurrent\('customer_payments'\)/u);
  assert.match(service, /actorHandle\s*\n\s*\}\);/u);
  assert.match(service, /CUSTOMER_PAYMENT_RESULT_REQUIRES_REVIEW/u);
  assert.match(localRepository, /actorHandle\?\.assertCurrent\('customer_payments'\)/u);
  assert.match(page, /canRegisterAbonos = settingsAccess\.isAdmin/u);
  assert.match(page, /show=\{isAbonoModalOpen && \(canRegisterAbonos \|\| isAbonoConfirmationPending\)\}/u);
  assert.match(page, /CUSTOMER_PAYMENT_PERMISSION_DENIED/u);
  assert.match(packageJson.scripts['test:staff-customer-payments-permission-5b'], /staff-customer-payments-permission-5b-contract\.node-test\.mjs/u);
});

test('the migration does not add financial storage or rewrite money state', () => {
  assert.equal((migration.match(/create or replace function/giu) || []).length, 1);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+public\.(pos_customer_ledger|pos_customers|pos_cash_sessions|pos_cash_movements)/iu);
  assert.doesNotMatch(migration, /create\s+(table|sequence)\b/iu);
});
