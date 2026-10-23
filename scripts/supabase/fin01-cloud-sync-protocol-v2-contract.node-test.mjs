import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(join(
  repoRoot,
  'supabase',
  'migrations',
  '20261023033028_fin01_cloud_sync_protocol_v2_r1.sql'
), 'utf8').replace(/\r\n/gu, '\n');
const frontend = readFileSync(join(repoRoot, 'src/services/sync/cloudSyncProtocolV2.js'), 'utf8');
const frontendTest = readFileSync(join(repoRoot, 'src/services/sync/__tests__/cloudSyncProtocolV2.test.js'), 'utf8');

const endpoints = [
  'pos_upsert_customer_v2',
  'pos_delete_customer_v2',
  'pos_migrate_local_customers_v2',
  'pos_pull_customers_snapshot_v2',
  'pos_pull_customer_changes_v2',
  'pos_get_customer_credit_summary_v2',
  'pos_pull_customer_credit_snapshot_v2',
  'pos_pull_customer_credit_changes_v2',
  'pos_record_customer_payment_v2',
  'pos_execute_financial_operation_v2',
  'pos_get_financial_operation_receipt_v2'
];

const functionBody = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${marker}`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `incomplete function: ${marker}`);
  return source.slice(start, end + '$function$;'.length);
};

test('FIN01 V is a selective, fail-closed transaction tied to exact F and dependency hashes', () => {
  assert.match(migration, /^begin;$/mu);
  assert.match(migration, /^commit;$/mu);
  assert.match(migration, /version = '20261022135915'[\s\S]*name = 'fin01_historical_credit_owner_authorization'/u);
  assert.match(migration, /FIN01_V_DEPENDENCY_DRIFT/u);
  assert.match(migration, /FIN01_V_INTERNAL_CORE_ACL_DRIFT/u);
  assert.match(migration, /HISTORICAL_DEBT_PRESERVATION_REQUIRED/u);
  assert.match(migration, /relrowsecurity/u);
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.(pos_sales|pos_customer_ledger|pos_cash_movements|pos_inventory_movements)\b/iu);
  assert.doesNotMatch(migration, /\bupdate\s+public\.(licenses|plans|pos_customers)\b/iu);
});

test('discovery and all 11 RPCs are advertised with the exact frontend contract', () => {
  const definitions = [...migration.matchAll(/create or replace function public\.(pos_[a-z0-9_]+)\(/giu)]
    .map((match) => match[1])
    .filter((name) => name.endsWith('_v2') || name === 'pos_fin01_sync_contract_v1');
  assert.deepEqual(definitions, ['pos_fin01_sync_contract_v1', ...endpoints]);
  for (const endpoint of endpoints) assert.ok(migration.includes(`'${endpoint}'`), `missing discovery entry ${endpoint}`);
  assert.match(migration, /'historical_credit_preservation_v1'[\s\S]*'customer_projection_safe_apply_v1'/u);
  assert.match(frontend, /p_requested_contract: CLOUD_SYNC_CONTRACT_VERSION/u);
  assert.match(frontend, /p_sync_contract/u);
});

test('customer migration and financial replay use restricted shared cores, not public legacy dispatchers', () => {
  const batch = functionBody(migration, 'create or replace function public.pos_migrate_local_customers_v2(');
  assert.match(batch, /public\.pos_upsert_customer_unlimited\(/u);
  assert.match(batch, /migration:' \|\| p_batch_id \|\| ':customer:'/u);
  assert.doesNotMatch(batch, /public\.pos_migrate_local_customers\(/u);

  const execute = functionBody(migration, 'create or replace function public.pos_execute_financial_operation_v2(');
  assert.match(execute, /private\.pos_execute_financial_operation_core_v2\(/u);
  assert.doesNotMatch(execute, /public\.pos_execute_financial_operation_v1\(/u);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.pos_execute_financial_operation_v1\(/u);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.pos_execute_financial_operation_core_v2\(/u);
  assert.match(migration, /replace\(v_definition,[\s\S]*?'public\.pos_create_cloud_sale_credit\(',[\s\S]*?'private\.pos_fin01_create_credit_rate_limited_v2\('/u);
  assert.match(migration, /replace\(v_definition,[\s\S]*?'public\.pos_cancel_cloud_sale\(',[\s\S]*?'private\.pos_fin01_cancel_sale_rate_limited_v2\('/u);
  assert.match(migration, /public\.pos_create_cloud_sale_credit_unlimited\(/u);
  assert.match(migration, /public\.pos_cancel_cloud_sale_unlimited\(/u);
});

test('v2 envelopes preserve explicit debt states, tenant identity, cursors, and operation identity', () => {
  assert.match(migration, /'customer_projections',[\s\S]*private\.pos_fin01_customer_projections_v2/u);
  assert.match(migration, /'tenant_id', p_license_id/u);
  assert.match(migration, /'client_identity', private\.pos_fin01_client_identity_v2/u);
  assert.match(migration, /'debt_cents', v_debt_cents/u);
  assert.match(migration, /'HISTORICAL_PENDING'/u);
  assert.match(migration, /'KNOWN_ZERO'/u);
  assert.match(migration, /'KNOWN_POSITIVE'/u);
  assert.match(migration, /'CONFLICT'/u);
  assert.match(migration, /'ledger_reconciliation_complete', false/u);
  assert.match(migration, /'request_hash', p_request_hash/u);
  assert.match(migration, /'next_offset'/u);
  assert.match(migration, /'change_seq'/u);
  assert.match(frontendTest, /customers nested in financial responses/u);
});

test('private functions remain closed and public RPCs have only explicit caller grants', () => {
  assert.match(migration, /revoke all on function private\.pos_execute_financial_operation_core_v2[\s\S]*from public, anon, authenticated, service_role/u);
  for (const endpoint of ['pos_fin01_sync_contract_v1', ...endpoints]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${endpoint}\\(`, 'u'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${endpoint}\\([\\s\\S]*?to anon, authenticated;`, 'u'));
  }
  assert.match(migration, /notify pgrst, 'reload schema'/u);
});

test('frontend discovers v2 only and recursively projects nested financial customers', () => {
  assert.match(frontend, /const findCustomerRecords = \(payload\) => \{/u);
  assert.match(frontend, /pending\.pop\(\)/u);
  assert.match(frontend, /CLOUD_SYNC_PROTOCOL_PROJECTION_MISSING/u);
  assert.match(frontend, /CLOUD_CLIENT_UPDATE_REQUIRED/u);
  assert.match(frontendTest, /sale: \{ credit: \{ customer: nestedCustomer \} \}/u);
});
