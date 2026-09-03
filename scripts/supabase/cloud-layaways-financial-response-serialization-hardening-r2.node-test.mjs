import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

const migration = read('supabase/migrations/20260903180000_cloud_layaways_financial_response_serialization_hardening_r2.sql');
const serverMigration = read('supabase/migrations/20260902010950_cloud_layaways_server_contract_r1.sql');
const authMigration = read('supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql');
const packageJson = JSON.parse(read('package.json'));
const repository = read('src/services/salesCloud/salesCloudRepository.js');
const cashier = read('src/services/salesCloud/salesCloudCashierService.js');
const localRepository = read('src/services/salesCloud/salesCloudLocalRepository.js');
const layawayDb = read('src/services/db/layaways.js');
const layawayFinancial = read('src/services/layawayFinancialService.js');

const functionBody = (source, marker, terminator = '$function$;') => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'missing function: ' + marker);
  const end = source.indexOf(terminator, start);
  assert.ok(end > start, 'incomplete function: ' + marker);
  return source.slice(start, end + terminator.length);
};

const jsonKey = (key) => new RegExp("['\"]" + key + "['\"]\\s*,", 'u');
const countStandalone = (source, token) => (source.match(new RegExp('^' + token + ';$', 'gmu')) || []).length;

const forbiddenOutputKeys = [
  'license_id',
  'request_hash',
  'last_idempotency_key',
  'cash_session_id',
  'cash_station_id',
  'device_id',
  'staff_user_id',
  'created_by_device_id',
  'created_by_staff_user_id',
  'actor_device_id',
  'actor_staff_user_id',
  'actor_key',
  'actor_name',
  'performed_by_actor_key',
  'unit_cost',
  'total_cost',
  'previous_stock',
  'new_stock',
  'previous_batch_stock',
  'new_batch_stock',
  'committed_before',
  'committed_after',
  'stock_before',
  'stock_after',
  'batch_stock_before',
  'batch_stock_after',
  'metadata',
  'deleted_at',
  'refund_id',
  'refund_cash_movement_id',
  'customer_ledger_id',
  'local_payload',
  'idempotency_key',
  'folio_sequence',
  'ecommerce_order_id',
  'ecommerce_order_code',
  'sale_item_id'
];

test('R2 migration is forward-only and contains no row-wide JSON serialization', () => {
  assert.equal(countStandalone(migration, 'begin'), 1);
  assert.equal(countStandalone(migration, 'commit'), 1);
  assert.doesNotMatch(migration, /\b(drop|truncate)\b/iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS/u);
  assert.doesNotMatch(migration, /update\s+public\.(plans|licenses)\b/iu);
  assert.doesNotMatch(migration, /--include-all|execute_sql|apply_migration|migration repair|db push|db pull/u);
  assert.doesNotMatch(migration, /\bto_jsonb\s*\(/u);
  assert.doesNotMatch(migration, /\brow_to_json\s*\(/u);
  assert.doesNotMatch(migration, /\bjsonb_populate_record\b/u);
  assert.match(migration, /create or replace function private\.public_financial_response_v1\(/u);
  assert.match(migration, /create or replace function public\.pos_execute_financial_operation_v1\(/u);
  assert.match(migration, /create or replace function public\.pos_get_financial_operation_receipt\(/u);
});

test('all recursive financial projections use explicit allowlists', () => {
  const projections = {
    layawayItem: {
      marker: 'create or replace function private.financial_layaway_item_allowlist_v2(',
      fields: [
        'id', 'product_id', 'product_name', 'product_sku', 'barcode', 'category_id',
        'category_name', 'rubro', 'batch_id', 'batch_sku', 'batch_expiry_date',
        'variant_id', 'size', 'color', 'quantity', 'unit_price', 'line_subtotal',
        'line_total', 'discount_amount', 'tax_amount'
      ]
    },
    layaway: {
      marker: 'create or replace function private.financial_layaway_allowlist_v2(',
      fields: [
        'id', 'customer_id', 'customer_name', 'customer_phone', 'total_amount',
        'paid_amount', 'balance_due', 'currency', 'deadline', 'status', 'items',
        'conversion_sale_id', 'retained_money', 'retained_amount', 'created_at',
        'updated_at', 'completed_at', 'cancelled_at', 'server_version'
      ]
    },
    layawayPayment: {
      marker: 'create or replace function private.financial_layaway_payment_allowlist_v2(',
      fields: [
        'id', 'layaway_id', 'payment_method', 'amount', 'status', 'cash_movement_id',
        'payment_type', 'created_at', 'refunded_at', 'server_version'
      ]
    },
    reservation: {
      marker: 'create or replace function private.financial_layaway_reservation_allowlist_v2(',
      fields: [
        'id', 'layaway_id', 'item_index', 'product_id', 'batch_id', 'quantity',
        'status', 'created_at', 'released_at', 'consumed_at', 'server_version'
      ]
    },
    cashMovement: {
      marker: 'create or replace function private.financial_cash_movement_allowlist_v2(',
      fields: [
        'id', 'type', 'amount', 'concept', 'source', 'reference_type',
        'reference_id', 'payment_id', 'created_at', 'server_version'
      ]
    },
    inventoryMovement: {
      marker: 'create or replace function private.financial_inventory_movement_allowlist_v2(',
      fields: [
        'id', 'product_id', 'batch_id', 'movement_type', 'quantity', 'reason',
        'source', 'layaway_id', 'created_at', 'server_version'
      ]
    },
    sale: {
      marker: 'create or replace function private.financial_sale_allowlist_v2(',
      fields: [
        'id', 'local_sale_id', 'layaway_id', 'origin', 'source_mode', 'effects_status',
        'status', 'fulfillment_status', 'payment_method', 'payment_status', 'folio',
        'local_folio', 'cloud_folio', 'pos_folio', 'sale_number', 'sales_channel',
        'customer_id', 'customer_name', 'customer_phone', 'subtotal', 'discount_total',
        'tax_total', 'total', 'amount_paid', 'change_amount', 'balance_due', 'currency',
        'sold_at', 'created_at', 'updated_at', 'committed_at', 'cancelled_at',
        'cancel_reason', 'cash_effect_status', 'inventory_effect_status',
        'credit_effect_status', 'server_version'
      ]
    },
    saleItem: {
      marker: 'create or replace function private.financial_sale_item_allowlist_v2(',
      fields: [
        'id', 'sale_id', 'product_id', 'product_name', 'product_sku', 'barcode',
        'category_id', 'category_name', 'quantity', 'unit_price', 'discount_amount',
        'tax_amount', 'line_total', 'batch_id', 'batch_sku', 'batch_expiry_date',
        'rubro', 'inventory_effect_status', 'inventory_movement_id', 'created_at',
        'server_version'
      ]
    },
    salePayment: {
      marker: 'create or replace function private.financial_sale_payment_allowlist_v2(',
      fields: [
        'id', 'sale_id', 'method', 'amount', 'received_amount', 'change_amount',
        'reference', 'cash_movement_id', 'created_at', 'server_version'
      ]
    },
    event: {
      marker: 'create or replace function private.financial_event_allowlist_v2(',
      fields: ['entity_type', 'entity_id', 'operation', 'change_seq', 'server_version', 'created_at']
    }
  };

  for (const [name, definition] of Object.entries(projections)) {
    const body = functionBody(migration, definition.marker);
    assert.match(body, /jsonb_build_object/u, name + ' must build an object');
    for (const field of definition.fields) {
      assert.match(body, jsonKey(field), name + ' lost ' + field);
    }
    for (const field of forbiddenOutputKeys) {
      assert.doesNotMatch(body, jsonKey(field), name + ' emits internal field ' + field);
    }
  }

  const arrayHelpers = [
    'financial_layaway_items_allowlist_v2',
    'financial_layaway_payments_allowlist_v2',
    'financial_layaway_reservations_allowlist_v2',
    'financial_cash_movements_allowlist_v2',
    'financial_inventory_movements_allowlist_v2',
    'financial_sale_items_allowlist_v2',
    'financial_sale_payments_allowlist_v2'
  ];
  for (const helper of arrayHelpers) {
    const body = functionBody(migration, 'create or replace function private.' + helper + '(');
    assert.match(body, /jsonb_array_elements/u, helper + ' must recurse into arrays');
    assert.match(body, /jsonb_agg/u, helper + ' must return an array');
  }

  assert.match(
    functionBody(migration, 'create or replace function private.financial_layaway_payment_allowlist_v2('),
    /case\s+lower\(/u,
    'payment type must be normalized instead of copying free-form metadata'
  );
  assert.doesNotMatch(
    functionBody(migration, 'create or replace function private.financial_layaway_item_allowlist_v2('),
    /\$1\s*\|\|/u
  );
});

test('operation-specific response allowlists preserve the client envelope and redact replay payloads', () => {
  const responseAllowlist = functionBody(
    migration,
    'create or replace function private.financial_layaway_response_allowlist_v2('
  );
  const publicResponse = functionBody(
    migration,
    'create or replace function private.public_financial_response_v1('
  );

  for (const operation of [
    'layaway.create',
    'layaway.payment',
    'layaway.cancel',
    'sale.layaway_complete'
  ]) {
    assert.match(responseAllowlist, new RegExp(operation.replace('.', '\\.'), 'u'));
    assert.match(publicResponse, new RegExp(operation.replace('.', '\\.'), 'u'));
  }

  for (const field of [
    'success', 'mode', 'layaway', 'payments', 'inventory_reservations',
    'cash_movements', 'cash_movement', 'cash_session', 'folio', 'sale',
    'event', 'change_seq', 'latest_change_seq'
  ]) {
    assert.match(responseAllowlist, jsonKey(field), 'envelope lost ' + field);
  }

  for (const field of [
    'duplicate', 'items', 'layaway_payments', 'inventory_movements', 'server_version'
  ]) {
    assert.match(responseAllowlist, jsonKey(field), 'completion envelope lost ' + field);
  }

  assert.match(responseAllowlist, /'cash_session',\s+null::jsonb/u);
  assert.match(responseAllowlist, /'cash_movement',\s+null::jsonb/u);
  assert.doesNotMatch(responseAllowlist, /p_response\s*\|\|/u);
  assert.doesNotMatch(responseAllowlist, /p_response\s*[,)]/u);
  assert.match(publicResponse, /private\.financial_layaway_response_allowlist_v2/u);
  assert.match(publicResponse, /jsonb_build_object\(\s*'idempotency_key'/u);
  assert.doesNotMatch(publicResponse, /jsonb_set/u);
  assert.match(publicResponse, /private\.sanitize_financial_response_idempotency_v1/u);
});

test('audited execution routes do not reach legacy serializers', () => {
  const routeMarkers = [
    'private.execute_layaway_create_financial_v1(',
    'private.execute_layaway_payment_financial_v1(',
    'private.execute_layaway_cancel_financial_v1(',
    'private.execute_layaway_completion_financial_v1('
  ];
  const legacy = /private\.(?:pos_layaway_to_jsonb|pos_layaway_payment_to_jsonb|pos_layaway_reservation_to_jsonb|pos_cash_movement_to_jsonb|pos_cash_session_to_jsonb|pos_sale_to_jsonb|pos_sale_item_to_jsonb|pos_sale_payment_to_jsonb|pos_inventory_movement_to_jsonb)\s*\(/u;

  for (const marker of routeMarkers) {
    const body = functionBody(migration, 'create or replace function ' + marker);
    assert.doesNotMatch(body, legacy, marker + ' still reaches a legacy serializer');
    assert.doesNotMatch(body, /\bto_jsonb\s*\(/u);
    assert.doesNotMatch(body, /\brow_to_json\s*\(/u);
    assert.match(body, /private\.pos_layaway_event_financial_to_jsonb_v2/u);
    assert.match(body, /jsonb_build_object/u);
    assert.match(body, /private\.assert_cloud_layaways_enabled/u);
  }

  const create = functionBody(migration, 'create or replace function private.execute_layaway_create_financial_v1(');
  const payment = functionBody(migration, 'create or replace function private.execute_layaway_payment_financial_v1(');
  const cancel = functionBody(migration, 'create or replace function private.execute_layaway_cancel_financial_v1(');
  const completion = functionBody(migration, 'create or replace function private.execute_layaway_completion_financial_v1(');

  for (const body of [create, payment, cancel, completion]) {
    assert.match(body, /'cash_session',\s+null/u);
  }
  for (const body of [create, payment, cancel]) {
    assert.match(body, /private\.financial_layaway_reservations_allowlist_v2/u);
    assert.match(body, /private\.pos_layaway_cash_movement_financial_to_jsonb_v2/u);
  }
  assert.match(completion, /private\.pos_layaway_sale_financial_to_jsonb_v2/u);
  assert.match(completion, /private\.pos_layaway_sale_item_financial_to_jsonb_v2/u);
  assert.match(completion, /private\.pos_layaway_sale_payment_financial_to_jsonb_v2/u);
  assert.match(completion, /private\.financial_inventory_movements_allowlist_v2/u);
  assert.match(completion, /'cash_movement',\s+null/u);
  assert.doesNotMatch(completion, /insert into public\.pos_cash_movements/u);
});

test('dispatcher keeps auth, tenant, capability, session, and idempotency controls', () => {
  const dispatcher = functionBody(
    migration,
    'create or replace function public.pos_execute_financial_operation_v1('
  );

  assert.match(dispatcher, /security definer/u);
  assert.match(dispatcher, /set search_path\s+to\s+''/u);
  assert.match(dispatcher, /private\.validate_pos_sync_context/u);
  assert.match(dispatcher, /private\.resolve_cash_actor_key/u);
  assert.match(dispatcher, /public\.enforce_pos_rpc_rate_limit_v2/u);
  assert.match(dispatcher, /private\.assert_cloud_layaways_enabled/u);
  assert.match(dispatcher, /private\.assert_pos_permission\(v_context, 'pos'\)/u);
  assert.match(dispatcher, /private\.resolve_financial_cash_station_v1/u);
  assert.match(dispatcher, /private\.layaway_request_cash_session_id_v1\(p_request\)/u);
  assert.match(dispatcher, /CASH_SESSION_NOT_FOUND/u);
  assert.match(dispatcher, /CASH_SESSION_STATION_MISMATCH/u);
  assert.match(dispatcher, /CASH_SESSION_NOT_OPEN/u);
  assert.match(dispatcher, /CASH_SESSION_FORBIDDEN/u);
  assert.match(dispatcher, /private\.reserve_financial_operation_v1/u);
  assert.match(dispatcher, /p_request_hash/u);
  assert.match(dispatcher, /v_canonical->>'cash_session_id'/u);

  for (const operation of [
    'layaway.create',
    'layaway.payment',
    'layaway.cancel',
    'sale.layaway_complete'
  ]) {
    assert.match(dispatcher, new RegExp(operation.replace('.', '\\.'), 'u'));
  }

  const completed = dispatcher.indexOf("if v_operation.status = 'completed' then");
  const replay = dispatcher.indexOf('private.public_financial_response_v1(', completed);
  const directReplay = dispatcher.indexOf('return v_operation.response_payload', completed);
  assert.ok(completed >= 0 && replay > completed, 'completed operations must be reprojected');
  assert.equal(directReplay, -1, 'completed operations must not return persisted JSON directly');

  for (const body of [
    functionBody(migration, 'create or replace function private.execute_layaway_create_financial_v1('),
    functionBody(migration, 'create or replace function private.execute_layaway_payment_financial_v1('),
    functionBody(migration, 'create or replace function private.execute_layaway_cancel_financial_v1('),
    functionBody(migration, 'create or replace function private.execute_layaway_completion_financial_v1(')
  ]) {
    assert.match(body, /license_id\s*=\s*v_license_id/u);
  }

  assert.match(serverMigration, /private\.assert_cloud_layaways_enabled\(v_context\)/u);
  assert.match(authMigration, /DEVICE_TOKEN_INVALID/u);
  assert.match(authMigration, /ACTOR_SESSION_INVALID/u);
});

test('replay receipt also passes through the operation-specific projection', () => {
  const receipt = functionBody(
    migration,
    'create or replace function public.pos_get_financial_operation_receipt(',
    '$$;'
  );
  assert.match(receipt, /security definer/u);
  assert.match(receipt, /set search_path\s*=\s*''/u);
  assert.match(receipt, /private\.validate_pos_sync_context/u);
  assert.match(receipt, /private\.assert_financial_operation_origin_v1/u);
  assert.match(receipt, /v_operation\.response_payload/u);
  assert.match(receipt, /private\.public_financial_response_v1\(/u);
  assert.doesNotMatch(receipt, /'result',\s*v_operation\.response_payload/u);
  assert.match(migration, /v_operation\.legacy_idempotency_key/u);
});

test('safe projections preserve the client contract and permitted effects', () => {
  for (const operation of [
    'layaway.create',
    'layaway.payment',
    'layaway.cancel',
    'sale.layaway_complete'
  ]) {
    assert.ok(
      repository.includes("operationType: '" + operation + "'"),
      'repository route is missing ' + operation
    );
  }
  assert.match(repository, /executeNewFinancialIntent\(/u);
  assert.match(repository, /sale\.layaway_complete/u);
  assert.match(cashier, /applyCloudLayawayMutationProjection/u);
  assert.match(cashier, /applyLayawayFinancialResponseProjection/u);
  assert.match(layawayFinancial, /processCloudLayaway(Create|Payment|Cancel)/u);
  assert.match(layawayDb, /cloudLayaway\.server_version/u);
  assert.match(layawayDb, /payment\.payment_method/u);
  assert.match(layawayDb, /cash_movement_id/u);
  assert.match(localRepository, /item\.sale_id/u);
  assert.match(localRepository, /payment\.sale_id/u);

  for (const field of [
    "'sale_id'", "'inventory_movement_id'", "'cash_movement_id'", "'payment_id'",
    "'layaway_id'", "'movement_type'", "'quantity'", "'amount'", "'server_version'"
  ]) {
    assert.ok(migration.includes(field), 'missing permitted field ' + field);
  }
});

test('auth boundary and public grants remain compatible', () => {
  for (const code of [
    'DEVICE_TOKEN_REQUIRED',
    'DEVICE_TOKEN_INVALID',
    'ACTOR_SESSION_REQUIRED',
    'ACTOR_SESSION_INVALID'
  ]) {
    assert.match(authMigration, new RegExp(code, 'u'));
  }

  assert.match(
    migration,
    /grant execute on function public\.pos_execute_financial_operation_v1\(\s*text, text, text, text, text, text, text, jsonb\s*\)\s+to anon, authenticated;/u
  );
  assert.match(
    migration,
    /grant execute on function public\.pos_get_financial_operation_receipt\(\s*text, text, text, text, text, text\s*\)\s+to anon, authenticated;/u
  );
  assert.match(migration, /revoke all on function public\.pos_execute_financial_operation_v1/u);
  assert.match(migration, /revoke all on function public\.pos_get_financial_operation_receipt/u);
});

test('package contract command includes the R2 audit and the existing contract suites', () => {
  const command = packageJson.scripts?.['test:cloud-layaways-contract'] || '';
  assert.match(command, /cloud-layaways-server-contract-r1\.node-test\.mjs/u);
  assert.match(command, /cloud-layaways-read-rpc-serialization-hardening-r1\.node-test\.mjs/u);
  assert.match(command, /cloud-layaways-financial-response-serialization-hardening-r2\.node-test\.mjs/u);
});
