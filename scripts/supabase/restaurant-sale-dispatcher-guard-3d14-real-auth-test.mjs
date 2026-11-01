import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Refusing non-loopback PostgreSQL');
assert.equal(process.env.PGDATABASE, 'pr338_3d14_real_auth', 'Refusing a database not named pr338_3d14_real_auth');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN, 'Set PGPORT and PSQL_BIN');

const root = process.cwd();
const migrations = [
  'supabase/migrations/20260916072854_license_expiry_entitlement_contract_r1.sql',
  'supabase/migrations/20260624002218_fase1_mobile_staff_timeout_fix.sql',
  'supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql',
  'supabase/migrations/20260829140000_cash_multi_admin_stations.sql',
  'supabase/migrations/20260829145747_cash_multi_admin_station_server_guard_r1.sql',
  'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql'
].map(file => resolve(root, file));
const fixturePath = resolve(root, 'supabase/tests/fixtures/restaurant_sale_dispatcher_guard_3d14_real_auth_setup.sql');
const testPath = resolve(root, 'supabase/tests/restaurant_sale_dispatcher_guard_3d14_real_auth_test.sql');

function extractFunction(source, signature) {
  const normalized = source.replace(/\r/g, '');
  const lower = normalized.toLowerCase();
  const start = lower.indexOf(`create or replace function ${signature.toLowerCase()}`);
  assert.notEqual(start, -1, `Function source not found: ${signature}`);
  const markers = ['\n$function$;', '\n$$;'];
  const ends = markers
    .map(marker => lower.indexOf(marker, start))
    .filter(index => index !== -1)
    .sort((a, b) => a - b);
  assert.ok(ends.length > 0, `Function terminator not found: ${signature}`);
  const end = ends[0];
  const marker = markers.find(value => lower.indexOf(value, start) === end);
  return normalized.slice(start, end + marker.length);
}

const sourceFiles = migrations.map(file => readFileSync(file, 'utf8'));
const authFunctions = [
  [0, 'private.license_entitlement_state_v1('],
  [0, 'private.require_active_admin_session('],
  [1, 'private.touch_license_staff_session_seen('],
  [0, 'private.validate_pos_sync_context('],
  [2, 'private.resolve_pos_actor_type('],
  [2, 'private.assert_pos_permission('],
  [2, 'private.resolve_cash_actor_key('],
  [3, 'private.resolve_cash_station_for_device('],
  [4, 'private.assert_cash_session_station('],
  [4, 'private.assert_cash_sale_station_for_request_v1('],
  [5, 'private.assert_restaurant_sale_dispatcher_context_v1(']
].map(([index, signature]) => extractFunction(sourceFiles[index], signature));

authFunctions.push(
  'revoke all on function private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text) from public, anon, authenticated, service_role;'
);

const functionsFile = join(tmpdir(), `pr338-3d14-real-auth-${process.pid}.sql`);
const psql = (...args) => {
  const result = spawnSync(process.env.PSQL_BIN, ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', env: process.env, windowsHide: true
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, `psql failed with ${result.status}`);
};

try {
  writeFileSync(functionsFile, authFunctions.join('\n\n') + '\n', 'utf8');
  psql('-f', fixturePath, '-f', functionsFile, '-f', testPath);
} finally {
  rmSync(functionsFile, { force: true });
}
