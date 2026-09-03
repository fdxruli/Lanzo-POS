import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903172023_cloud_layaways_read_rpc_serialization_hardening_r1.sql'),
  'utf8'
);
const authMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql'),
  'utf8'
);
const repository = fs.readFileSync(
  path.join(root, 'src/services/salesCloud/salesCloudRepository.js'),
  'utf8'
);
const layawayDb = fs.readFileSync(
  path.join(root, 'src/services/db/layaways.js'),
  'utf8'
);
const layawayFinancial = fs.readFileSync(
  path.join(root, 'src/services/layawayFinancialService.js'),
  'utf8'
);

const functionBody = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'missing function marker: ' + marker);
  const end = source.indexOf('$function$;', start);
  assert.notEqual(end, -1, 'missing function terminator: ' + marker);
  return source.slice(start, end);
};

const jsonKey = (key) => new RegExp("['\"]" + key + "['\"]\\s*,", 'u');
const absentJsonKeys = [
  'license_id',
  'request_hash',
  'idempotency_key',
  'last_idempotency_key',
  'cash_session_id',
  'cash_station_id',
  'device_id',
  'staff_user_id',
  'created_by_device_id',
  'created_by_staff_user_id',
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
  'metadata',
  'deleted_at',
  'refund_id',
  'refund_cash_movement_id',
  'sale_id',
  'sale_item_id'
];

test('explicit projections contain the public allowlist and exclude internal fields', () => {
  const projections = {
    layaway: [
      'id', 'customer_id', 'customer_name', 'customer_phone', 'total_amount',
      'paid_amount', 'balance_due', 'currency', 'deadline', 'status', 'items',
      'conversion_sale_id', 'retained_money', 'retained_amount', 'created_at',
      'updated_at', 'completed_at', 'cancelled_at', 'server_version'
    ],
    item: [
      'id', 'product_id', 'product_name', 'product_sku', 'barcode', 'category_id',
      'category_name', 'rubro', 'batch_id', 'batch_sku', 'batch_expiry_date',
      'variant_id', 'size', 'color',
      'quantity', 'unit_price', 'line_subtotal', 'line_total', 'discount_amount',
      'tax_amount'
    ],
    payment: [
      'id', 'layaway_id', 'payment_method', 'amount', 'status', 'cash_movement_id',
      'payment_type', 'created_at', 'refunded_at', 'server_version'
    ],
    reservation: [
      'id', 'layaway_id', 'item_index', 'product_id', 'batch_id', 'quantity',
      'status', 'created_at', 'released_at', 'consumed_at', 'server_version'
    ],
    cash: [
      'id', 'type', 'amount', 'concept', 'source', 'reference_type', 'reference_id',
      'payment_id', 'created_at', 'server_version'
    ],
    inventory: [
      'id', 'product_id', 'batch_id', 'movement_type', 'quantity', 'reason',
      'source', 'layaway_id', 'created_at', 'server_version'
    ]
  };

  const bodies = {
    layaway: functionBody(migration, 'create or replace function private.pos_layaway_read_to_jsonb_v1('),
    item: functionBody(migration, 'create or replace function private.pos_layaway_public_items_to_jsonb_v1('),
    payment: functionBody(migration, 'create or replace function private.pos_layaway_payment_read_to_jsonb_v1('),
    reservation: functionBody(migration, 'create or replace function private.pos_layaway_reservation_read_to_jsonb_v1('),
    cash: functionBody(migration, 'create or replace function private.pos_layaway_public_cash_movement_to_jsonb_v1('),
    inventory: functionBody(migration, 'create or replace function private.pos_layaway_public_inventory_movement_to_jsonb_v1(')
  };

  for (const [name, fields] of Object.entries(projections)) {
    for (const field of fields) assert.match(bodies[name], jsonKey(field), name + ' lost ' + field);
    for (const field of absentJsonKeys) {
      assert.doesNotMatch(
        bodies[name],
        jsonKey(field),
        name + ' serializes forbidden field ' + field
      );
    }
  }

  assert.doesNotMatch(bodies.item, /item\s*\|\|/u, 'items must not spread arbitrary client JSON');
  assert.doesNotMatch(bodies.item, /attributes|variant_attributes|selected_modifiers/u);
  assert.match(bodies.payment, /case\s+lower\(/u, 'payment type must be normalized, not copied from metadata');

  const canonical = functionBody(migration, 'create or replace function private.canonical_layaway_item_v1(');
  assert.match(canonical, /'category_id'/u);
  assert.match(canonical, /'variant_id'/u);
  assert.doesNotMatch(canonical, /'attributes'|'variant_attributes'|'unit_cost'/u);
});

test('read RPCs keep tenant predicates and use only explicit movement projections', () => {
  const getBody = functionBody(migration, 'create or replace function public.pos_get_layaway(');
  const pullBody = functionBody(migration, 'create or replace function public.pos_pull_layaway_changes(');

  for (const body of [getBody, pullBody]) {
    assert.match(body, /security definer/u);
    assert.match(body, /set search_path\s*=\s*''/u);
    assert.match(body, /private\.validate_pos_sync_context/u);
    assert.match(body, /private\.assert_cloud_layaways_enabled\(v_context\)/u);
    assert.match(body, /private\.assert_pos_permission\(v_context, 'pos'\)/u);
    assert.match(body, /l\.license_id\s*=\s*v_license_id/u);
    assert.match(body, /p\.license_id\s*=\s*v_license_id/u);
    assert.match(body, /r\.license_id\s*=\s*v_license_id/u);
    assert.match(body, /m\.license_id\s*=\s*v_license_id/u);
    assert.doesNotMatch(body, /private\.pos_layaway_to_jsonb\s*\(/u);
    assert.doesNotMatch(body, /private\.pos_layaway_payment_to_jsonb\s*\(/u);
    assert.doesNotMatch(body, /private\.pos_layaway_reservation_to_jsonb\s*\(/u);
    assert.doesNotMatch(body, /private\.pos_cash_movement_to_jsonb\s*\(/u);
    assert.doesNotMatch(body, /private\.pos_inventory_movement_to_jsonb\s*\(/u);
    assert.doesNotMatch(body, /\bto_jsonb\s*\(/u);
    assert.doesNotMatch(body, /\brow_to_json\s*\(/u);
    assert.doesNotMatch(body, /execute\s+immediate|format\s*\(/iu);
  }

  assert.match(getBody, /m\.deleted_at\s+is\s+null/u);
  assert.match(pullBody, /e\.license_id\s*=\s*v_license_id/u);
  assert.match(pullBody, /latest_change_seq/u);
  assert.match(pullBody, /has_more/u);
});

test('auth, signatures, and client RPC parameters remain compatible', () => {
  for (const signature of [
    'public.pos_get_layaway(\n  p_license_key text,\n  p_device_fingerprint text,\n  p_security_token text,\n  p_staff_session_token text default null,\n  p_layaway_id text default null',
    'public.pos_pull_layaway_changes(\n  p_license_key text,\n  p_device_fingerprint text,\n  p_security_token text,\n  p_staff_session_token text default null,\n  p_since_change_seq bigint default 0,\n  p_limit integer default 500'
  ]) {
    assert.ok(migration.includes(signature), 'RPC signature changed: ' + signature.split('\n')[0]);
  }

  assert.match(migration, /grant execute on function public\.pos_get_layaway\(text, text, text, text, text\)\s+to anon, authenticated;/u);
  assert.match(migration, /grant execute on function public\.pos_pull_layaway_changes\(text, text, text, text, bigint, integer\)\s+to anon, authenticated;/u);

  assert.match(repository, /rpc\('pos_get_layaway',\s*\{\s*\.\.\.baseArgs,\s*\.\.\.params\s*\}\)/u);
  assert.match(repository, /p_layaway_id:\s*layawayId/u);
  assert.match(repository, /rpc\('pos_pull_layaway_changes',/u);
  assert.match(repository, /p_since_change_seq:/u);
  assert.match(repository, /p_limit:/u);

  for (const field of [
    'customer_id', 'customer_name', 'customer_phone', 'total_amount',
    'paid_amount', 'balance_due', 'currency', 'deadline', 'status', 'items',
    'conversion_sale_id', 'retained_money', 'retained_amount', 'created_at',
    'updated_at', 'completed_at', 'cancelled_at'
  ]) {
    assert.match(migration, jsonKey(field), 'public client field missing: ' + field);
  }
  assert.match(layawayDb, /cloudLayaway\.server_version/u);
  assert.match(layawayFinancial, /layaway\.conversionSaleId/u);
  assert.match(layawayFinancial, /layaway\.items/u);
});

test('invalid-token rejection and safe search_path are preserved by the auth boundary', () => {
  for (const code of [
    'DEVICE_TOKEN_REQUIRED',
    'DEVICE_TOKEN_INVALID',
    'ACTOR_SESSION_REQUIRED',
    'ACTOR_SESSION_INVALID'
  ]) {
    assert.match(authMigration, new RegExp(code, 'u'));
  }
  assert.match(authMigration, /extensions\.crypt\((?:p_actor_token|v_actor_token), ss\.session_token_hash\)/u);
  assert.match(authMigration, /d\.license_id\s*=\s*v_license\.id/u);
  assert.match(authMigration, /ss\.license_id\s*=\s*v_license\.id/u);
  assert.match(authMigration, /security definer[\s\S]*set search_path\s*=\s*''/u);

  const functions = [
    'private.pos_layaway_public_items_to_jsonb_v1(',
    'private.pos_layaway_read_to_jsonb_v1(',
    'private.pos_layaway_payment_read_to_jsonb_v1(',
    'private.pos_layaway_reservation_read_to_jsonb_v1(',
    'private.pos_layaway_public_cash_movement_to_jsonb_v1(',
    'private.pos_layaway_public_inventory_movement_to_jsonb_v1(',
    'public.pos_get_layaway(',
    'public.pos_pull_layaway_changes('
  ];
  for (const marker of functions) {
    assert.match(
      functionBody(migration, 'create or replace function ' + marker),
      /set search_path\s*=\s*''/u
    );
  }
});

test('migration is forward-only and does not toggle the feature or alter PR #264', () => {
  assert.match(migration, /^begin;\s*$/mu);
  assert.match(migration, /^commit;\s*$/mu);
  assert.doesNotMatch(migration, /\b(drop|truncate)\b/iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS/u);
  assert.doesNotMatch(migration, /update\s+public\.plans|update\s+public\.licenses/u);
  assert.doesNotMatch(migration, /--include-all|execute_sql|apply_migration|migration repair|db push|db pull/u);
  assert.doesNotMatch(migration, /to_jsonb\s*\(/u);
  assert.doesNotMatch(migration, /row_to_json\s*\(/u);
});
