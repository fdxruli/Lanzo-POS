import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Refusing non-loopback PostgreSQL');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN, 'Set PGPORT and PSQL_BIN');
const psql = (...args) => {
  const result = spawnSync(process.env.PSQL_BIN, ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', windowsHide: true
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, `psql failed with ${result.status}`);
};

psql('-f', 'supabase/tests/fixtures/restaurant_origin_cancel_3d13_setup.sql',
  '-f', 'supabase/tests/fixtures/restaurant_origin_cancel_3d13_test_context.sql',
  '-f', 'supabase/migrations/20261008013643_restaurant_origin_cancel_contract_3d13.sql',
  '-f', 'supabase/tests/restaurant_origin_cancel_3d13.sql');
const concurrency = spawnSync(process.execPath,
  ['scripts/supabase/restaurant-origin-cancel-3d13-concurrency.mjs', '--isolated-fixture'], {
    encoding: 'utf8', env: process.env, windowsHide: true
  });
process.stdout.write(concurrency.stdout || '');
process.stderr.write(concurrency.stderr || '');
assert.equal(concurrency.status, 0, `concurrency fixture failed with ${concurrency.status}`);
