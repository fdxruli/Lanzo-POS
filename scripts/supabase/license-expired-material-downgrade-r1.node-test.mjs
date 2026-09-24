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
const sessionConsistencyMigrationUrl = new URL(
  '../../supabase/migrations/20260924143303_license_downgrade_session_consistency_r1.sql',
  import.meta.url
);
const sessionConsistencySqlTestUrl = new URL(
  '../../supabase/tests/license_downgrade_session_consistency_r1_test.sql',
  import.meta.url
);

const [migration, sqlTest, sessionConsistencyMigration, sessionConsistencySqlTest] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(sqlTestUrl, 'utf8'),
  readFile(sessionConsistencyMigrationUrl, 'utf8'),
  readFile(sessionConsistencySqlTestUrl, 'utf8')
]);

const functionBody = (source, qualifiedName) => {
  const start = source.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `${qualifiedName} must be versioned`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `${qualifiedName} must have a complete body`);
  return source.slice(start, end + '$function$;'.length);
};

test('materialization uses the canonical lifecycle after a row lock', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
  const lock = body.indexOf('for update of l');
  const entitlement = body.indexOf('private.license_entitlement_state_v1', lock);
  assert.ok(lock >= 0, 'license row must be locked');
  assert.ok(entitlement > lock, 'canonical entitlement must be re-evaluated after lock');
  assert.match(body, /lifecycle_state <> 'expired'/u);
  assert.match(body, /is_entitled is not false/u);
  assert.match(body, /lower\(coalesce\(v_license\.status::text, ''\)\) <> 'active'/u);
});

test('primitive is single-license and has no scheduler or batch behavior', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
  assert.match(body, /p_license_id uuid/u);
  assert.doesNotMatch(body, /cron\.|schedule\s*\(/iu);
  assert.doesNotMatch(body, /for\s+v_.*in\s+select[\s\S]*public\.licenses/iu);
  assert.doesNotMatch(migration, /cron\.schedule|insert\s+into\s+cron\.job/iu);
});

test('downgrade is non-destructive and explicitly preserves operational history', () => {
  const body = functionBody(migration, 'private.materialize_expired_license_to_free_v1');
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
  const snapshot = functionBody(migration, 'public.sync_license_plan_snapshot');
  const limits = functionBody(sessionConsistencyMigration, 'public.enforce_license_plan_limits_after_change');
  assert.match(snapshot, /jsonb_object_keys\(coalesce\(candidate\.features/u);
  assert.match(snapshot, /when v_plan\.code = 'free_trial' then 'free'/u);
  assert.match(limits, /d\.device_mode = 'staff_only'/u);
  assert.match(limits, /when 'admin_only' then 0[\s\S]*when 'shared' then 1/u);
  assert.match(limits, /d\.activated_at asc nulls last/u);
  assert.match(limits, /d\.last_used_at desc nulls last/u);
  assert.match(limits, /d\.id asc/u);
  assert.doesNotMatch(limits, /coalesce\(d\.device_role, 'staff'\)/u);
});

test('phase 2 revokes actor sessions in the same downgrade transaction', () => {
  const limits = functionBody(sessionConsistencyMigration, 'public.enforce_license_plan_limits_after_change');
  const deviceBlock = limits.indexOf("'PLAN_DOWNGRADE_DEVICE_LIMIT'");
  const adminRevoke = limits.indexOf('update public.license_admin_sessions');
  const staffRevokeByDevice = limits.lastIndexOf('update public.license_staff_sessions');

  assert.ok(deviceBlock >= 0, 'device limit block must remain explicit');
  assert.ok(adminRevoke > deviceBlock, 'Admin sessions must be reconciled after the deterministic device set is chosen');
  assert.ok(staffRevokeByDevice > adminRevoke, 'Staff sessions on removed devices must also be reconciled');
  assert.match(limits, /security_token = null/u);
  assert.match(limits, /previous_security_token = null/u);
  assert.match(limits, /d\.id = any\(v_blocked_device_ids\)/u);
  assert.match(limits, /'admin_sessions_revoked', v_admin_sessions_revoked/u);
  assert.match(limits, /'staff_sessions_revoked', v_staff_sessions_revoked/u);
  assert.match(limits, /'blocked_device_ids', to_jsonb\(v_blocked_device_ids\)/u);
  assert.match(limits, /'active_device_ids_after', to_jsonb\(v_active_device_ids\)/u);
});

test('phase 2 historical repair is narrow, idempotent and audit-producing', () => {
  assert.match(sessionConsistencyMigration, /s\.revoked_at is null/u);
  assert.match(sessionConsistencyMigration, /s\.expires_at > now\(\)/u);
  assert.match(sessionConsistencyMigration, /d\.is_active is false/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_DEVICE_LIMIT/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_STAFF_NOT_INCLUDED/u);
  assert.match(sessionConsistencyMigration, /license_downgrade_session_consistency_r1_backfill/u);
  assert.match(sessionConsistencyMigration, /PLAN_DOWNGRADE_SESSION_RECONCILED/u);
});

test('phase 2 never mutates financial state', () => {
  for (const operation of ['update', 'insert into', 'delete from']) {
    assert.doesNotMatch(
      sessionConsistencyMigration,
      new RegExp(`${operation}\\s+public\\.pos_cash_sessions`, 'iu')
    );
  }
  assert.doesNotMatch(sessionConsistencyMigration, /cash_movements|ledger|counted_cash|closing_counted_amount/iu);
  assert.match(sessionConsistencySqlTest, /downgrade modified open cash sessions/u);
  assert.match(sessionConsistencySqlTest, /takeover modified open cash sessions/u);
});

test('phase 2 matrix covers sessions, tokens, ranking, retries, tenant isolation and phase 1 recovery', () => {
  for (const marker of [
    'Case A/B/C',
    'Case A/D',
    'Case C',
    'Case E',
    'Case audit',
    'Case F/G',
    'Case tenant isolation',
    'Case Phase 1 regression',
    'Case Phase 1 capacity regression',
    'Case finance',
    'Phase 2 trigger function ACL mismatch'
  ]) {
    assert.ok(sessionConsistencySqlTest.includes(marker), `${marker} coverage must be present`);
  }
  assert.match(sessionConsistencySqlTest, /FREE_DEVICE_TAKEOVER_REQUIRED/u);
  assert.match(sessionConsistencySqlTest, /FREE_DEVICE_TAKEOVER_SUCCESS/u);
  assert.match(sessionConsistencySqlTest, /DEVICE_LIMIT_REACHED/u);
  assert.match(sessionConsistencySqlTest, /begin;/iu);
  assert.match(sessionConsistencySqlTest, /rollback;/iu);
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
