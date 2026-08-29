import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const migrationName = '20260829214848_sale_batch_allocation_null_compat_r1.sql';
const migration = readFileSync(join(migrationsDir, migrationName), 'utf8').replace(/\r\n/gu, '\n');
const r2bMigration = readFileSync(
  join(migrationsDir, '20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql'),
  'utf8'
).replace(/\r\n/gu, '\n');
const sqlTest = readFileSync(
  join(repoRoot, 'supabase', 'tests', 'admin_staff_rbac_r2b_sale_financial_authority_test.sql'),
  'utf8'
).replace(/\r\n/gu, '\n');
const mapper = readFileSync(
  join(repoRoot, 'src', 'services', 'salesCloud', 'salesCloudCashierMapper.js'),
  'utf8'
).replace(/\r\n/gu, '\n');

const functionSignature = 'private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)';

test('sale batch compatibility migration is narrow and fail-closed', () => {
  assert.deepEqual(
    readdirSync(migrationsDir).filter((name) => name.includes('sale_batch_allocation_null_compat')),
    [migrationName]
  );
  assert.match(migration, /begin;[\s\S]*commit;\s*$/u);
  assert.match(migration, new RegExp(functionSignature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(migration, /pg_get_functiondef\(v_signature::regprocedure\)/u);
  assert.match(migration, /execute v_definition;/u);

  for (const alias of [
    "v_item_payload->'batches_used'",
    "v_item_payload->'batchesUsed'",
    "v_item_payload->'metadata'->'batches_used'",
    "v_item_payload->'metadata'->'batchesUsed'"
  ]) {
    assert.match(migration, new RegExp(`nullif\\(${alias.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}, 'null'::jsonb\\)`));
  }
  assert.match(migration, /jsonb_typeof\(v_raw_batches\) <> ''array'''/u);
  assert.match(migration, /BATCH_ALLOCATION_INVALID/u);
  assert.match(migration, /CLOUD_BATCH_ALLOCATION_MISMATCH/u);
  assert.doesNotMatch(migration, /case\s+when\s+jsonb_typeof\(v_raw_batches\)[\s\S]*?'\[\]'::jsonb/iu);

  assert.doesNotMatch(migration, /\balter\s+function\b/iu);
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\./iu);
  assert.doesNotMatch(migration, /^\s*(?:insert\s+into|update\s+public\.|delete\s+from)\b/imu);
  assert.doesNotMatch(migration, /\bgrant\s+execute\b/iu);
  assert.match(migration, new RegExp(`revoke all on function ${functionSignature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('R2B authority markers remain outside the narrow batch patch', () => {
  for (const marker of [
    'SALE_PRICE_MISMATCH',
    'r2bClientUnitCostIgnored',
    'r2b_finalize_inventory_costs_v1',
    'DISCOUNT_PERMISSION_REQUIRED',
    'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED',
    'MANUAL_ITEM_PRICE_POLICY_REQUIRED',
    'private.r2b_assert_sale_idempotency_v1',
    'private.validate_pos_sync_context',
    'private.assert_pos_permission',
    'CLOUD_PRODUCT_NOT_AVAILABLE',
    'CLOUD_BATCH_NOT_AVAILABLE'
  ]) assert.match(r2bMigration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(migration, /owner and ACL/iu);
  assert.match(migration, /No public wrapper, actor check, price\/cost\/discount authority/u);
});

test('rollback SQL exercises null, strict malformed, valid, and mismatch batch cases', () => {
  assert.match(sqlTest, /^begin;/mu);
  assert.match(sqlTest, /rollback;\s*$/u);
  for (const marker of [
    'S1_ABSENT',
    'S2_TOP_LEVEL_SNAKE_NULL',
    'S3_TOP_LEVEL_CAMEL_NULL',
    'S4_METADATA_SNAKE_NULL',
    'S5_METADATA_CAMEL_NULL',
    'S6_EMPTY_ARRAY',
    'S7_OBJECT_DENIED',
    'S8_STRING_DENIED',
    'S9_NUMBER_DENIED',
    'S10_INVALID_ARRAY_ITEM_DENIED',
    'S11_VALID_BATCH_ARRAY',
    'S12_ALLOCATION_MISMATCH',
    'CLOUD_BATCH_ALLOCATION_MISMATCH',
    "(v_authorized->'items'->0) ? 'batches_used'"
  ]) assert.match(sqlTest, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(sqlTest, /^\s*commit\s*;/imu);
});

test('cashier mapper omits null batch metadata without changing manual arrays', () => {
  assert.match(mapper, /batchesUsed: explicitBatchesUsed \?\? undefined/u);
  assert.match(mapper, /const mapItem =/u);
  assert.match(mapper, /mapLocalCheckoutToCloudSale/u);
  assert.match(mapper, /mapLocalCreditCheckoutToCloudSale/u);
});
