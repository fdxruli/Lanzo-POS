import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260916072854_license_expiry_entitlement_contract_r1.sql',
  import.meta.url
);
const sqlTestUrl = new URL(
  '../../supabase/tests/license_expiry_entitlement_contract_r1_test.sql',
  import.meta.url
);
const boundariesUrl = new URL(
  '../../supabase/migrations/20260916073309_license_expiry_entitlement_boundaries_r1_1.sql',
  import.meta.url
);

const [migration, boundaries, sqlTest] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(boundariesUrl, 'utf8'),
  readFile(sqlTestUrl, 'utf8')
]);

const functionBody = (qualifiedName) => {
  const start = migration.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `${qualifiedName} must be versioned`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${qualifiedName} must have a complete body`);
  return migration.slice(start, end + '$function$;'.length);
};

test('canonical lifecycle owns the seven-day boundary and fails administrative blocks closed', () => {
  const canonical = functionBody('private.license_entitlement_state_v1');
  assert.match(canonical, /administratively_blocked/u);
  assert.match(canonical, /source\.is_lifetime/u);
  assert.match(canonical, /source\.expires_at \+ interval '7 days'/u);
  assert.match(canonical, /derived_state in \('active', 'grace_period'\)/u);
  assert.match(canonical, /else '\{\}'::jsonb/u);
});

test('major capability boundaries consume canonical effective entitlement', () => {
  for (const name of [
    'private.ecommerce_license_feature_text',
    'private.ecommerce_admin_authorize_v2',
    'private.generate_license_operational_notifications',
    'private.require_active_admin_session',
    'private.validate_pos_sync_context',
    'public.ensure_current_license_period',
    'public.verify_device_license_unified_unlimited'
  ]) {
    assert.match(functionBody(name), /license_entitlement_state_v1/u, `${name} must use canonical lifecycle`);
  }

  assert.match(functionBody('private.get_support_ticket_context'), /validate_pos_sync_context/u);
  assert.match(functionBody('public.get_ai_agent_usage_unlimited'), /validate_pos_sync_context/u);
  assert.match(functionBody('public.validate_pos_rpc_rate_limit_context'), /validate_pos_sync_context/u);
});

test('ecommerce denies new expired operations while the SQL matrix preserves active and grace', () => {
  assert.match(sqlTest, /active Pro public portal was not resolved/u);
  assert.match(sqlTest, /grace Pro public portal was not resolved/u);
  assert.match(sqlTest, /expired Pro public portal remained resolvable/u);
  assert.match(sqlTest, /expired Pro checkout was not denied at portal boundary/u);
  assert.match(sqlTest, /expired Pro cloud context unexpectedly authorized/u);
  assert.match(sqlTest, /rollback;/iu);
});

test('phase 1 migration is capability-only and contains no tenant-data deletion', () => {
  const sql = `${migration}\n${boundaries}`;
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(ecommerce|pos_|licenses|license_)/iu);
  assert.doesNotMatch(sql, /update\s+public\.licenses[\s\S]{0,160}set\s+plan_id/iu);
  assert.doesNotMatch(sql, /drop\s+(table|column)/iu);
});

test('login, staff creation, and ecommerce realtime admissions are canonical', () => {
  assert.match(boundaries, /ecommerce_order_notifications_enabled[\s\S]+license_entitlement_state_v1/u);
  for (const signature of [
    'private.admin_create_staff_user_impl',
    'public.activate_license_on_device_unlimited',
    'public.admin_enroll_owner_on_device',
    'public.admin_login_on_device',
    'public.staff_login_on_device_unlimited',
    'public.verify_staff_session_unlimited'
  ]) {
    assert.ok(boundaries.includes(signature), `${signature} must be guarded by the boundary migration`);
  }
});
