import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  canonicalFinancialRequestV1,
  financialRequestHashV1,
  hashCanonicalFinancialRequestV1
} from '../../src/services/financial/financialCanonicalV1.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

const migrationName = '20260905020312_cloud_layaways_financial_request_canonicalization_r1.sql';
const migration = read(`supabase/migrations/${migrationName}`);
const readMigration = read('supabase/migrations/20260903172023_cloud_layaways_read_rpc_serialization_hardening_r1.sql');
const responseMigration = read('supabase/migrations/20260903180000_cloud_layaways_financial_response_serialization_hardening_r2.sql');
const timestampMigration = read('supabase/migrations/20260904161407_cloud_layaways_financial_timestamp_normalization_r1.sql');
const receiptMigration = read('supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql');
const serverMigration = read('supabase/migrations/20260902010950_cloud_layaways_server_contract_r1.sql');
const canonicalSource = read('src/services/financial/financialCanonicalV1.js');
const packageJson = JSON.parse(read('package.json'));

const functionBody = (source, marker, terminator = '$function$;') => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${marker}`);
  const end = source.indexOf(terminator, start);
  assert.ok(end > start, `incomplete function: ${marker}`);
  return source.slice(start, end + terminator.length);
};

const jsonKey = (key) => new RegExp("['\"]" + key + "['\"]\\s*,", 'u');

const realisticRequest = {
  layawayData: {
    id: 'layaway-realistic-1',
    customerId: 'customer-1',
    customerName: 'Cliente POS',
    customerPhone: '5550000000',
    totalAmount: '1750.00',
    currency: 'mxn',
    deadline: '2026-09-05',
    items: [{
      id: 'item-1',
      parentId: 'product-1',
      name: 'Camisa',
      sku: 'SKU-1',
      barCode: '750000000001',
      categoryId: 'category-1',
      categoryName: 'Ropa',
      batchId: 'batch-1',
      batchSku: 'BATCH-1',
      expiryDate: '2027-01-01',
      variantId: 'variant-1',
      talla: 'M',
      colorName: 'Azul',
      attributes: { material: 'Algodón', size: null, nested: { value: null } },
      variantAttributes: { size: 'M', color: null },
      qty: '2.00',
      price: '875.0000',
      cost: '500.0000',
      total: '1750.0000',
      discountAmount: null,
      taxAmount: null
    }]
  },
  initialPayment: {
    paymentId: 'payment-1',
    total: '350.00',
    paymentMethod: 'efectivo',
    paymentType: 'initial_deposit',
    cashSessionId: 'cash-1'
  },
  cashSessionId: 'cash-1',
  cash_station_id: 'attacker-controlled-field'
};

const recursivelyStripNulls = (value) => {
  if (Array.isArray(value)) return value.map(recursivelyStripNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, recursivelyStripNulls(entry)])
  );
};

test('migration is ordered, forward-only, and contains only canonical helper replacements', () => {
  assert.ok(Number(migrationName.slice(0, 14)) > 20260904161407);
  assert.equal((migration.match(/^begin;$/gmu) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gmu) || []).length, 1);
  assert.equal((migration.match(/create or replace function/giu) || []).length, 3);
  assert.doesNotMatch(migration, /\b(drop|truncate)\b/iu);
  assert.doesNotMatch(migration, /\b(insert|update|delete|alter\s+table|create\s+table)\b/iu);
  assert.doesNotMatch(migration, /execute\s+immediate|format\s*\(/iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS|update\s+public\.(plans|licenses)/u);
  assert.match(migration, /create or replace function private\.financial_compact_object_v1\(p_object jsonb\)/u);
  assert.match(migration, /create or replace function private\.canonical_layaway_financial_item_v1\(p_item jsonb\)/u);
  assert.match(migration, /create or replace function private\.canonical_layaway_request_v1\(/u);
});

test('client/server financial item contract has exact fields, aliases, defaults, and nested-null semantics', () => {
  const canonical = canonicalFinancialRequestV1('layaway.create', realisticRequest);
  const item = canonical.layaway.items[0];
  const itemBody = functionBody(
    migration,
    'create or replace function private.canonical_layaway_financial_item_v1('
  );

  const expectedFields = [
    'id', 'product_id', 'product_name', 'product_sku', 'barcode', 'category_id',
    'category_name', 'rubro', 'batch_id', 'batch_sku', 'batch_expiry_date',
    'variant_id', 'size', 'color', 'attributes', 'variant_attributes',
    'quantity', 'unit_price', 'unit_cost', 'line_total', 'discount_amount',
    'tax_amount'
  ];
  assert.deepEqual(Object.keys(item).sort(), expectedFields.sort());
  for (const field of expectedFields) assert.match(itemBody, jsonKey(field), `financial item lost ${field}`);

  for (const alias of [
    "array['product_id','productId','parentId']",
    "array['product_name','productName','name']",
    "array['product_sku','productSku','sku']",
    "array['barcode','barCode']",
    "array['category_id','categoryId']",
    "array['category_name','categoryName','rubro','category']",
    "array['batch_id','batchId']",
    "array['batch_sku','batchSku']",
    "array['batch_expiry_date','batchExpiryDate','expiryDate']",
    "array['variant_id','variantId']",
    "array['size','talla']",
    "array['color','colorName']",
    "array['quantity','qty']",
    "array['unit_price','unitPrice','price']",
    "array['unit_cost','unitCost','cost']",
    "array['line_total','lineTotal','total','exactTotal']",
    "array['discount_amount','discountAmount']",
    "array['tax_amount','taxAmount']"
  ]) assert.ok(itemBody.includes(alias), `financial item lost alias ${alias}`);

  assert.match(itemBody, /jsonb_typeof\(p_item->'attributes'\) = 'object'/u);
  assert.match(itemBody, /jsonb_typeof\(p_item->'variant_attributes'\) = 'object'/u);
  assert.match(itemBody, /jsonb_typeof\(p_item->'variantAttributes'\) = 'object'/u);
  assert.match(itemBody, /private\.financial_decimal_v1\(private\.financial_first_nonblank_scalar_v1\(p_item, array\['unit_cost','unitCost','cost'\]\)\)/u);
  assert.match(itemBody, /coalesce\(private\.financial_decimal_v1\(private\.financial_first_nonblank_scalar_v1\(p_item, array\['discount_amount','discountAmount'\]\)\), '0'\)/u);
  assert.match(itemBody, /coalesce\(private\.financial_decimal_v1\(private\.financial_first_nonblank_scalar_v1\(p_item, array\['tax_amount','taxAmount'\]\)\), '0'\)/u);
  assert.doesNotMatch(itemBody, /private\.canonical_layaway_item_v1\s*\(/u);
  assert.doesNotMatch(itemBody, /jsonb_strip_nulls\s*\(/u);

  assert.equal(item.unit_cost, '500');
  assert.equal(item.discount_amount, '0');
  assert.equal(item.tax_amount, '0');
  assert.deepEqual(item.attributes, {
    material: 'Algodón',
    size: null,
    nested: { value: null }
  });
  assert.deepEqual(item.variant_attributes, { size: 'M', color: null });
  assert.notDeepEqual(item.attributes, recursivelyStripNulls(item.attributes));
});

test('financial compaction is shallow and canonical request routes through the separated helper', () => {
  const compact = functionBody(
    migration,
    'create or replace function private.financial_compact_object_v1('
  );
  const request = functionBody(
    migration,
    'create or replace function private.canonical_layaway_request_v1('
  );

  assert.match(compact, /jsonb_each\(\$1\)/u);
  assert.match(compact, /entry\.value\s*<>\s*'null'::jsonb/u);
  assert.doesNotMatch(compact, /jsonb_strip_nulls\s*\(/u);
  assert.match(request, /private\.financial_compact_object_v1\(jsonb_build_object\(/u);
  assert.match(request, /private\.canonical_layaway_financial_item_v1\(value\)/u);
  assert.doesNotMatch(request, /private\.canonical_layaway_item_v1\s*\(/u);
  assert.doesNotMatch(request, /jsonb_strip_nulls\s*\(/u);
  assert.match(request, /private\.layaway_deadline_v1\(private\.financial_first_nonblank_scalar_v1\(/u);
});

test('layaway dates retain date-only and timestamp normalization and reject invalid calendar values', () => {
  const dateOnly = canonicalFinancialRequestV1('layaway.create', {
    layaway: { id: 'date-only', total_amount: '10', deadline: '2026-09-05', items: [] },
    initial_payment: null
  });
  const timestamp = canonicalFinancialRequestV1('layaway.create', {
    layaway: { id: 'timestamp', total_amount: '10', deadline: '2026-09-05T10:20:30.123456789-06:00', items: [] },
    initial_payment: null
  });

  assert.equal(dateOnly.layaway.deadline, '2026-09-05T00:00:00.000000Z');
  assert.equal(timestamp.layaway.deadline, '2026-09-05T16:20:30.123456Z');
  for (const invalid of [
    '2026-9-5',
    '2026-02-30',
    '2026-13-01',
    '',
    null,
    '2026-09-05T10:20:30',
    '2026-09-05T25:20:30.000000Z'
  ]) {
    assert.throws(
      () => canonicalFinancialRequestV1('layaway.create', {
        layaway: { id: 'invalid-date', total_amount: '10', deadline: invalid, items: [] },
        initial_payment: null
      }),
      /LAYAWAY_DEADLINE_REQUIRED|FINANCIAL_TIMESTAMP_INVALID/u,
      `invalid deadline accepted: ${String(invalid)}`
    );
  }
  assert.match(canonicalSource, /const DATE_ONLY_PATTERN = \/\^/u);
  assert.match(timestampMigration, /private\.layaway_deadline_v1\(p_value jsonb\)/u);
  assert.match(timestampMigration, /private\.financial_timestamp_v1\(to_jsonb\(v_raw \|\| 'T00:00:00\.000000Z'\)\)/u);
});

test('existing hash vectors A-E remain stable', async () => {
  const vectors = [
    ['A', 'sale.cancel', { sale_id: 'sale-1', reason: 'test' }, 'actor-a', null, null, 'b9a2aae4a9cbac969509bf776db9ac49d6169e4318151657d2d6842eb56d953b'],
    ['B', 'cash.movement', { cash_session_id: 'session-a', type: 'entrada', amount: '10', concept: 'float', source: null, reference_type: null, reference_id: null }, 'actor-a', 'session-a', 'station-a', '57142afa91156723a4695a48ecf277848c835da2d30c990f8625e0fc6b41b875'],
    ['C', 'sale.cashier', { cash_session_id: 'session-a', customer_id: null, items: [{ batch_allocations: [], product_id: 'product-a', quantity: '2', selected_modifiers: [] }], payments: [{ amount: '20', method: 'cash' }], sale: { id: 'sale-a', sold_at: '2026-01-02T03:04:05.000000Z', total: '20' } }, 'actor-a', 'session-a', 'station-a', '9aaf9ed23a8f01db515cee3e5469043af8240766d0c72d88663633812b8f5f88'],
    ['D', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-a', null, 'station-a', '1105cf39098eb4b6a855bb7bf29fe5269008cdfc2817b04a15aa7af2c01d1002'],
    ['E', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-b', null, 'station-b', 'f6b5a9675db1aba16d44140e9e345f4ac1e52e5f4197b16dc5ebe120660ba6a1']
  ];

  for (const [name, operationType, canonicalRequest, actorKey, cashSessionId, cashStationId, expected] of vectors) {
    await assert.doesNotReject(
      hashCanonicalFinancialRequestV1({ operationType, canonicalRequest, actorKey, cashSessionId, cashStationId }),
      name
    );
    assert.equal(
      await hashCanonicalFinancialRequestV1({ operationType, canonicalRequest, actorKey, cashSessionId, cashStationId }),
      `sha256:${expected}`,
      `vector ${name} changed`
    );
  }
});

test('actor, session, station, idempotency, tenant, and hash guards remain intact', async () => {
  const request = { opening_amount: '100', opening_origin: 'manual' };
  const common = { operationType: 'cash.open', request, cashStationId: 'station-a' };
  const actorA = await financialRequestHashV1({ ...common, actorKey: 'actor-a' });
  const actorB = await financialRequestHashV1({ ...common, actorKey: 'actor-b' });
  const sessionB = await financialRequestHashV1({ ...common, actorKey: 'actor-a', cashSessionId: 'session-b' });
  const stationB = await financialRequestHashV1({ ...common, actorKey: 'actor-a', cashStationId: 'station-b' });
  assert.notEqual(actorA.requestHash, actorB.requestHash);
  assert.notEqual(actorA.requestHash, sessionB.requestHash);
  assert.notEqual(actorA.requestHash, stationB.requestHash);

  assert.match(receiptMigration, /create or replace function private\.financial_operation_hash\(/u);
  assert.match(receiptMigration, /create or replace function private\.assert_financial_request_hash_v1\(/u);
  assert.match(receiptMigration, /p_request_hash is distinct from v_expected_hash/u);
  assert.match(responseMigration, /private\.reserve_financial_operation_v1\(/u);
  assert.match(responseMigration, /private\.lock_financial_operation_v1\(/u);
  assert.match(responseMigration, /private\.complete_financial_operation_v1\(/u);
  assert.match(responseMigration, /private\.canonical_layaway_request_v1\(p_operation_type, p_request\)/u);
  assert.match(serverMigration, /license_id\s*=\s*p_license_id/u);
  assert.doesNotMatch(migration, /assert_financial_request_hash_v1|reserve_financial_operation_v1|pos_execute_financial_operation_v1/u);
});

test('read redaction and R2 response allowlists are preserved', () => {
  const readCanonical = functionBody(
    readMigration,
    'create or replace function private.canonical_layaway_item_v1('
  );
  assert.match(readCanonical, /jsonb_strip_nulls\s*\(/u);
  assert.doesNotMatch(readCanonical, /'attributes'|'variant_attributes'|'unit_cost'/u);
  assert.doesNotMatch(migration, /create or replace function private\.canonical_layaway_item_v1\(/u);

  for (const helper of [
    'financial_layaway_item_allowlist_v2',
    'financial_layaway_allowlist_v2',
    'financial_layaway_payment_allowlist_v2',
    'financial_layaway_reservation_allowlist_v2',
    'financial_cash_movement_allowlist_v2',
    'financial_inventory_movement_allowlist_v2',
    'public_financial_response_v1'
  ]) assert.match(responseMigration, new RegExp(`private\\.${helper}\\(`), `R2 helper missing: ${helper}`);

  for (const forbidden of [
    'license_id', 'request_hash', 'cash_session_id', 'cash_station_id',
    'device_id', 'staff_user_id', 'actor_key', 'metadata', 'unit_cost',
    'total_cost', 'refund_id', 'idempotency_key'
  ]) {
    assert.doesNotMatch(readCanonical, jsonKey(forbidden), `read projection emits ${forbidden}`);
  }
  assert.match(packageJson.scripts['test:cloud-layaways-contract'], /cloud-layaways-financial-request-canonicalization-r1\.node-test\.mjs/u);
});
