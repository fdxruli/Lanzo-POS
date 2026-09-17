import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migrationDirectory = join(process.cwd(), 'supabase', 'migrations');
const migrationName = readdirSync(migrationDirectory)
  .find((name) => name.endsWith('_license_upgrade_restoration_hardening_r1.sql'));

assert.ok(migrationName, 'Phase 4 migration must exist');
const migration = readFileSync(join(migrationDirectory, migrationName), 'utf8');
const sqlTest = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'license_upgrade_restoration_hardening_r1_test.sql'),
  'utf8'
);
const phase2SqlTest = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'license_expired_material_downgrade_r1_test.sql'),
  'utf8'
);

const functionBody = (signature) => {
  const start = migration.indexOf(`create or replace function ${signature}`);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${signature} must have a body`);
  return migration.slice(start, end);
};

test('upgrade primitive locks first and re-evaluates lifecycle under that lock', () => {
  const body = functionBody('private.materialize_license_upgrade_v1');
  const lock = body.indexOf('for update of l');
  const entitlement = body.indexOf('private.license_entitlement_state_v1', lock);

  assert.ok(lock >= 0, 'license row must be locked');
  assert.ok(entitlement > lock, 'entitlement must be read after the row lock');
  assert.match(body, /lifecycle_state = 'active'/u);
  assert.match(body, /code', 'ALREADY_ON_PLAN'/u);
  assert.match(body, /ADMINISTRATIVELY_BLOCKED/u);
  assert.match(body, /make_interval\(months => v_duration_months\)/u);
});

test('upgrade closes the current period and creates exactly one paid successor', () => {
  const body = functionBody('private.materialize_license_upgrade_v1');

  assert.match(body, /update public\.license_periods[\s\S]*status = 'closed'/u);
  assert.match(body, /previous_period_id/u);
  assert.match(body, /insert into public\.license_periods/u);
  assert.match(body, /'active', v_now, v_expires_at/u);
  assert.match(body, /new_period_id/u);
  assert.match(body, /'PLAN_CHANGED'/u);
  assert.doesNotMatch(body, /old_features\s*\|\|\s*pro_features/iu);
});

test('restoration is narrow and never resurrects Staff sessions or device credentials', () => {
  const body = functionBody('private.materialize_license_upgrade_v1');

  assert.match(body, /PLAN_DOWNGRADE_PUBLICATION_LIMIT/u);
  assert.match(body, /ecommerce_product_eligible_for_plan_restore_v1/u);
  assert.match(body, /metadata = coalesce\(pp\.metadata, '\{\}'::jsonb\) - 'plan_downgrade_publication'/u);
  assert.match(body, /PLAN_DOWNGRADE_DEVICE_LIMIT/u);
  assert.match(body, /security_token = null/u);
  assert.match(body, /previous_security_token = null/u);
  assert.match(body, /requires_reauthentication', true/u);
  assert.match(body, /staff_sessions_reactivated', 0/u);
  assert.doesNotMatch(body, /update\s+public\.license_staff_sessions/iu);
});

test('the existing admin boundary delegates paid activation without removing Free administration', () => {
  const publicBoundary = functionBody('public.admin_change_license_plan');

  assert.match(publicBoundary, /private\.materialize_license_upgrade_v1/u);
  assert.match(publicBoundary, /private\.materialize_admin_license_to_free_v1/u);
  assert.match(migration, /revoke all on function private\.materialize_license_upgrade_v1[\s\S]*from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function private\.materialize_license_upgrade_v1[\s\S]*to service_role/u);
});

test('tenant guards use only the NEW shape of their own trigger relation', () => {
  const itemGuard = functionBody('private.ecommerce_order_item_phase4_tenant_scope_guard');
  const reservationGuard = functionBody('private.ecommerce_reservation_phase4_tenant_scope_guard');

  assert.match(itemGuard, /new\.options/u);
  assert.doesNotMatch(itemGuard, /new\.published_variant_id/u);
  assert.match(reservationGuard, /new\.published_variant_id/u);
  assert.doesNotMatch(reservationGuard, /new\.options/u);
  assert.match(migration, /ecommerce_order_items_phase4_tenant_scope_guard[\s\S]*ecommerce_order_item_phase4_tenant_scope_guard/u);
  assert.match(migration, /ecommerce_reservations_phase4_tenant_scope_guard[\s\S]*ecommerce_reservation_phase4_tenant_scope_guard/u);
});

test('roundtrip SQL covers retry, grace, stale scheduler candidate, security and tenant isolation', () => {
  for (const phrase of [
    'PLAN_EXPIRED_DOWNGRADED_TO_FREE',
    'LICENSE_UPGRADED_TO_PAID',
    'ALREADY_ON_PLAN',
    'grace renewal',
    'expired renewal',
    'LICENSE_ACTIVE',
    'Staff/device restoration',
    'cross-tenant order item',
    'R4 period history',
    'R4 retry'
  ]) {
    assert.match(sqlTest, new RegExp(phrase, 'u'));
  }
  assert.doesNotMatch(phase2SqlTest, /disable trigger ecommerce_order_items_phase4_tenant_scope_guard/u);
  assert.doesNotMatch(phase2SqlTest, /disable trigger ecommerce_reservations_phase4_tenant_scope_guard/u);
});
