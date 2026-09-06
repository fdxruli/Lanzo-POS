import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260906000029_cloud_layaways_read_rpc_transaction_mode_r1.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const readRpcMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903172023_cloud_layaways_read_rpc_serialization_hardening_r1.sql'),
  'utf8'
);
const repository = fs.readFileSync(
  path.join(root, 'src/services/salesCloud/salesCloudRepository.js'),
  'utf8'
);
const layawayFinancial = fs.readFileSync(
  path.join(root, 'src/services/layawayFinancialService.js'),
  'utf8'
);
const sqlRegression = fs.readFileSync(
  path.join(root, 'supabase/tests/cloud_layaways_read_rpc_transaction_mode_r1_test.sql'),
  'utf8'
);

test('read RPC transaction-mode migration changes only volatility', () => {
  assert.match(migration, /^begin;\s*$/imu);
  assert.match(migration, /^commit;\s*$/imu);
  assert.match(
    migration,
    /alter\s+function\s+public\.pos_get_layaway\(text,\s*text,\s*text,\s*text,\s*text\)\s+volatile;/iu
  );
  assert.match(
    migration,
    /alter\s+function\s+public\.pos_pull_layaway_changes\(text,\s*text,\s*text,\s*text,\s*bigint,\s*integer\)\s+volatile;/iu
  );
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/iu);
  assert.doesNotMatch(migration, /\b(drop|truncate|insert|update|delete)\b/iu);
  assert.doesNotMatch(migration, /execute\s+immediate|format\s*\(/iu);
  assert.doesNotMatch(migration, /to_jsonb\s*\(|row_to_json\s*\(/iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS|--include-all|migration\s+repair|db\s+(push|pull)/iu);
});

test('security, authorization, allowlists, and signatures remain protected', () => {
  for (const marker of [
    'create or replace function public.pos_get_layaway(',
    'create or replace function public.pos_pull_layaway_changes('
  ]) {
    const start = readRpcMigration.indexOf(marker);
    assert.notEqual(start, -1, `missing prior read RPC definition: ${marker}`);
    const end = readRpcMigration.indexOf('$function$;', start);
    assert.notEqual(end, -1, `missing prior read RPC terminator: ${marker}`);
    const body = readRpcMigration.slice(start, end);
    assert.match(body, /security\s+definer/iu);
    assert.match(body, /set\s+search_path\s*=\s*''/iu);
    assert.match(body, /private\.validate_pos_sync_context\s*\(/u);
    assert.match(body, /private\.assert_cloud_layaways_enabled\s*\(/u);
    assert.match(body, /private\.assert_pos_permission\s*\(v_context,\s*'pos'\)/u);
    assert.doesNotMatch(body, /\bto_jsonb\s*\(|\brow_to_json\s*\(/iu);
  }

  assert.match(
    readRpcMigration,
    /grant\s+execute\s+on\s+function\s+public\.pos_get_layaway\(text,\s*text,\s*text,\s*text,\s*text\)\s+to\s+anon,\s+authenticated;/iu
  );
  assert.match(
    readRpcMigration,
    /grant\s+execute\s+on\s+function\s+public\.pos_pull_layaway_changes\(text,\s*text,\s*text,\s*text,\s*bigint,\s*integer\)\s+to\s+anon,\s+authenticated;/iu
  );
  assert.match(repository, /supabaseClient\.rpc\('pos_get_layaway',/u);
  assert.match(repository, /supabaseClient\.rpc\('pos_pull_layaway_changes',/u);
  assert.match(layawayFinancial, /salesCloudRepository\.getLayaway\s*\(/u);
  assert.match(layawayFinancial, /processCloudLayawayCompletion\s*\(/u);
  assert.ok(
    layawayFinancial.indexOf('salesCloudRepository.getLayaway(')
      < layawayFinancial.indexOf('salesCloudCashierService.processCloudLayawayCompletion('),
    'completion must read the authoritative layaway before creating the sale'
  );
});

test('SQL regression test checks installed pg_proc metadata without financial writes', () => {
  assert.match(sqlRegression, /pg_proc/iu);
  assert.match(sqlRegression, /provolatile/iu);
  assert.match(sqlRegression, /prosecdef/iu);
  assert.match(sqlRegression, /search_path/iu);
  assert.match(sqlRegression, /has_function_privilege/iu);
  assert.match(sqlRegression, /private\.validate_pos_sync_context/iu);
  assert.doesNotMatch(sqlRegression, /\b(insert|update|delete|truncate|drop)\b/iu);
  assert.doesNotMatch(sqlRegression, /execute\s+immediate|format\s*\(/iu);
});
