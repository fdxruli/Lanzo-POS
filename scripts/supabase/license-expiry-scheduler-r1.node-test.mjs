import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260916204753_license_expiry_scheduler_r1.sql',
  import.meta.url
);
const sqlTestUrl = new URL(
  '../../supabase/tests/license_expiry_scheduler_r1_test.sql',
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

test('batch delegates entitlement and materialization to Phase 1 and Phase 2', () => {
  const body = functionBody('private.materialize_expired_licenses_batch_v1');
  assert.match(body, /private\.license_entitlement_state_v1\(l\.id\)/u);
  assert.match(body, /entitlement\.lifecycle_state = 'expired'/u);
  assert.match(body, /entitlement\.is_entitled is false/u);
  assert.match(body, /private\.materialize_expired_license_to_free_v1\(v_candidate\.license_id\)/u);
  assert.doesNotMatch(body, /update\s+public\.licenses\s+l?\s*set\s+plan_id/iu);
  assert.doesNotMatch(body, /insert\s+into\s+public\.license_events/iu);
});

test('batch is bounded, deterministic, non-blocking and failure-isolated', () => {
  const body = functionBody('private.materialize_expired_licenses_batch_v1');
  assert.match(body, /pg_try_advisory_xact_lock\(v_lock_namespace, v_lock_key\)/u);
  assert.match(body, /'status', 'already_running'/u);
  assert.match(body, /limit v_limit/u);
  assert.match(body, /grace_period_ends asc,[\s\S]*expires_at asc,[\s\S]*l\.id asc/u);
  assert.match(body, /begin[\s\S]*when others then[\s\S]*result_code,[\s\S]*'FAILED'/u);
  assert.match(body, /occurred_at > now\(\) - interval '6 hours'/u);
});

test('notification is Admin-only and deduped from the Phase 2 period id', () => {
  const body = functionBody('private.materialize_expired_licenses_batch_v1');
  assert.match(body, /private\.create_pos_notification_once/u);
  assert.match(body, /license_plan_downgraded_to_free:' \|\| \(v_result->>'period_id'\)/u);
  assert.match(body, /target_scope = 'admin'/u);
  assert.match(body, /p_action_route => '\/configuracion\?tab=license'/u);
  assert.match(body, /Tus datos se conservaron/u);
  assert.doesNotMatch(body, /PLAN_EXPIRED_DOWNGRADED_TO_FREE'[\s\S]*insert into public\.license_events/iu);
});

test('observability is private, sanitized and retained for 90 days', () => {
  assert.match(migration, /create table if not exists private\.license_lifecycle_scheduler_runs/u);
  assert.match(migration, /create table if not exists private\.license_lifecycle_scheduler_run_items/u);
  assert.match(migration, /enable row level security/iu);
  assert.match(migration, /revoke all on table private\.license_lifecycle_scheduler_runs[\s\S]*from public, anon, authenticated/iu);
  assert.match(migration, /\(token\|password\|authorization\|bearer\)/iu);
  assert.match(migration, /started_at < now\(\) - interval '90 days'/u);
  assert.doesNotMatch(migration, /delete\s+from\s+cron\.job_run_details/iu);
});

test('cron registration is exactly hourly, stable and calls only the batch', () => {
  assert.match(migration, /pg_catalog\.pg_extension where extname = 'pg_cron'/u);
  assert.doesNotMatch(migration, /create extension(?: if not exists)? pg_cron/iu);
  assert.match(migration, /v_expected_name constant text := 'license-expiry-materialization-v1'/u);
  assert.match(migration, /v_expected_schedule constant text := '0 \* \* \* \*'/u);
  assert.match(migration, /v_expected_command constant text := 'SELECT private\.materialize_expired_licenses_batch_v1\(25\);'/u);
  assert.match(migration, /cron\.alter_job/u);
  assert.match(migration, /cron\.schedule/u);
  assert.match(migration, /LICENSE_LIFECYCLE_SCHEDULER_DUPLICATE_JOB/u);
});

test('SQL matrix covers A through O, ACL, cron and transactional rollback', () => {
  for (const marker of [
    'Case A', 'Cases B/C', 'Case D', 'Cases E/M', 'Case F', 'Case G',
    'Case H', 'Case I', 'Cases J/K', 'Case L', 'Case N', 'Case O',
    'Scheduler batch ACL mismatch', 'Scheduler cron registration mismatch'
  ]) {
    assert.ok(sqlTest.includes(marker), `${marker} coverage must be present`);
  }
  assert.match(sqlTest, /^begin;/imu);
  assert.match(sqlTest, /rollback;\s*$/iu);
});
