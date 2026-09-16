import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260916083608_license_expired_material_downgrade_r1.sql',
  import.meta.url
);
const sqlTestUrl = new URL(
  '../../supabase/tests/license_expired_material_downgrade_r1_test.sql',
  import.meta.url
);

const [migration, sqlTest] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(sqlTestUrl, 'utf8')
]);

const functionBody = (qualifiedName) => {
  const start = migration.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `${qualifiedName} must be versioned`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${qualifiedName} must have a complete body`);
  return migration.slice(start, end + '$function$;'.length);
};

test('materialization uses the canonical lifecycle after a row lock', () => {
  const body = functionBody('private.materialize_expired_license_to_free_v1');
  const lock = body.indexOf('for update of l');
  const entitlement = body.indexOf('private.license_entitlement_state_v1', lock);
  assert.ok(lock >= 0, 'license row must be locked');
  assert.ok(entitlement > lock, 'canonical entitlement must be re-evaluated after lock');
  assert.match(body, /lifecycle_state <> 'expired'/u);
  assert.match(body, /is_entitled is not false/u);
  assert.match(body, /lower\(coalesce\(v_license\.status::text, ''\)\) <> 'active'/u);
});

test('primitive is single-license and has no scheduler or batch behavior', () => {
  const body = functionBody('private.materialize_expired_license_to_free_v1');
  assert.match(body, /p_license_id uuid/u);
  assert.doesNotMatch(body, /cron\.|schedule\s*\(/iu);
  assert.doesNotMatch(body, /for\s+v_.*in\s+select[\s\S]*public\.licenses/iu);
  assert.doesNotMatch(migration, /cron\.schedule|insert\s+into\s+cron\.job/iu);
});

test('downgrade is non-destructive and explicitly preserves operational history', () => {
  const body = functionBody('private.materialize_expired_license_to_free_v1');
  for (const table of [
    'ecommerce_orders',
    'ecommerce_order_items',
    'ecommerce_order_inventory_reservations',
    'ecommerce_portals',
    'license_staff_users',
    'license_devices'
  ]) {
    assert.doesNotMatch(body, new RegExp(`delete\\s+from\\s+public\\.${table}`, 'iu'));
  }
  assert.match(body, /PLAN_DOWNGRADE_PUBLICATION_LIMIT/u);
  assert.match(body, /display_order asc, pp\.created_at asc, pp\.id asc/u);
  assert.match(sqlTest, /historical\/active order changed/u);
  assert.match(sqlTest, /active reservation changed/u);
});

test('plan hooks use current device_mode and purge residual plan feature keys', () => {
  const snapshot = functionBody('public.sync_license_plan_snapshot');
  const limits = functionBody('public.enforce_license_plan_limits_after_change');
  assert.match(snapshot, /jsonb_object_keys\(coalesce\(candidate\.features/u);
  assert.match(snapshot, /when v_plan\.code = 'free_trial' then 'free'/u);
  assert.match(limits, /d\.device_mode = 'staff_only'/u);
  assert.match(limits, /when 'admin_only' then 0[\s\S]*when 'shared' then 1/u);
  assert.doesNotMatch(limits, /coalesce\(d\.device_role, 'staff'\)/u);
});

test('SQL matrix covers lifecycle, idempotency, limits, history, ACL, and rollback', () => {
  for (const marker of [
    'Case A', 'Case B', 'Case C', 'Case D', 'Case F', 'Cases G/H',
    'Case I', 'Case J', 'Case K', 'Case L', 'Case M',
    'exactly one transition event', 'Materialization primitive ACL mismatch'
  ]) {
    assert.ok(sqlTest.includes(marker), `${marker} coverage must be present`);
  }
  assert.match(sqlTest, /begin;/iu);
  assert.match(sqlTest, /rollback;/iu);
});
