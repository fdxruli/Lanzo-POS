import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Refusing non-loopback PostgreSQL');
assert.equal(process.env.PGDATABASE, 'pr338_3d14_fixture', 'Refusing a database not named pr338_3d14_fixture');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN, 'Set PGPORT and PSQL_BIN');

const root = process.cwd();
const migrationPath = resolve(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const idempotencyPath = resolve(root, 'supabase/migrations/20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql');
const fixturePath = resolve(root, 'supabase/tests/fixtures/restaurant_sale_dispatcher_guard_3d14_setup.sql');
const testPath = resolve(root, 'supabase/tests/restaurant_sale_dispatcher_guard_3d14_test.sql');

function extractFunction(source, signature, terminator) {
  const lower = source.toLowerCase();
  const start = lower.indexOf(`create or replace function ${signature.toLowerCase()}`);
  assert.notEqual(start, -1, `Function source not found: ${signature}`);
  const end = lower.indexOf(terminator.toLowerCase(), start);
  assert.notEqual(end, -1, `Function terminator not found: ${signature}`);
  return source.slice(start, end + terminator.length);
}

const migration = readFileSync(migrationPath, 'utf8');
const idempotencySource = readFileSync(idempotencyPath, 'utf8');
const helperSql = extractFunction(
  migration,
  'private.assert_restaurant_sale_dispatcher_context_v1(',
  '\nrevoke all on function private.assert_restaurant_sale_dispatcher_context_v1'
).replace(/\r?\nrevoke all on function private\.assert_restaurant_sale_dispatcher_context_v1[\s\S]*$/i, '');
const idempotencySql = extractFunction(
  idempotencySource,
  'private.r2b_assert_sale_idempotency_v1(',
  '\n$function$;'
);

const helperFile = join(tmpdir(), `pr338-3d14-helper-${process.pid}.sql`);
const idempotencyFile = join(tmpdir(), `pr338-r2b-idempotency-${process.pid}.sql`);
const psql = (...args) => {
  const result = spawnSync(process.env.PSQL_BIN, ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', env: process.env, windowsHide: true
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, `psql failed with ${result.status}`);
};

try {
  writeFileSync(helperFile, helperSql, 'utf8');
  writeFileSync(idempotencyFile, idempotencySql, 'utf8');
  psql('-f', fixturePath, '-f', idempotencyFile, '-f', helperFile, '-f', testPath);
} finally {
  rmSync(helperFile, { force: true });
  rmSync(idempotencyFile, { force: true });
}
