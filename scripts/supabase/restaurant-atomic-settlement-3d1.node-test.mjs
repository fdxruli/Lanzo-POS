import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');
const migration = read('supabase/migrations/20261006181758_restaurant_atomic_settlement_3d1.sql');
const packageJson = JSON.parse(read('package.json'));

const functionBody = (name) => {
  const start = migration.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `incomplete function: ${name}`);
  return migration.slice(start, end + '$function$;'.length);
};

test('forward migration uses one shared tenant/order lock and protects lock order', () => {
  const lock = functionBody('private.lock_restaurant_order_settlement_v1');
  const dispatcher = functionBody('public.pos_execute_financial_operation_v1');
  const split = functionBody('private.execute_split_sale_financial_v1');

  assert.match(lock, /pg_advisory_xact_lock\(hashtext\(p_license_id::text\), hashtext\('restaurant_split:' \|\| p_local_order_id\)\)/u);
  assert.match(lock, /from public\.pos_restaurant_orders[\s\S]*?for update/u);
  assert.ok(dispatcher.indexOf('private.lock_restaurant_order_settlement_v1') < dispatcher.indexOf('from public.pos_cash_sessions'));
  assert.ok(dispatcher.indexOf('from public.pos_cash_sessions') < dispatcher.indexOf('private.reserve_financial_operation_v1'));
  assert.ok(dispatcher.indexOf('private.reserve_financial_operation_v1') < dispatcher.indexOf('when \'sale.cashier\''));
  assert.match(split, /private\.lock_restaurant_order_settlement_v1\(v_license_id, v_parent_order_id\)/u);
  assert.doesNotMatch(split, /pg_advisory_xact_lock/u);
  assert.ok(split.indexOf('v_order.updated_at is distinct from v_parent_order_version_at') < split.indexOf('v_child_response := public.pos_create_cloud_sale_'));
});

test('normal checkout closes inside the dispatcher transaction and projects a safe receipt', () => {
  const dispatcher = functionBody('public.pos_execute_financial_operation_v1');
  const response = functionBody('private.public_financial_response_v1');
  assert.match(dispatcher, /public\.pos_close_restaurant_order_after_checkout_unlimited\(/u);
  assert.ok(dispatcher.indexOf('public.pos_close_restaurant_order_after_checkout_unlimited(') < dispatcher.indexOf('private.complete_financial_operation_v1('));
  assert.match(dispatcher, /restaurant_settlement[\s\S]*?'paid_sale_id'/u);
  assert.match(response, /v_settlement := p_response->'restaurant_settlement'/u);
  for (const field of ['parent_order_id', 'payment_status', 'paid_sale_id', 'paid_sale_folio', 'total']) {
    assert.match(response, new RegExp(`'${field}'`, 'u'));
  }
});

test('legacy canonical requests remain unchanged and modern settlement is hash-bound', () => {
  const canonical = functionBody('private.canonical_financial_request_v1');
  const context = functionBody('private.canonical_restaurant_settlement_v1');
  assert.match(canonical, /\|\| private\.canonical_restaurant_settlement_v1\(v_request\)/u);
  assert.match(context, /if not \(coalesce\(p_request, '\{\}'::jsonb\) \? 'restaurant_settlement'\) then\s+return '\{\}'::jsonb/u);
  assert.match(context, /'parent_order_version', private\.financial_timestamp_v1/u);
  assert.match(context, /'contract_version', 1/u);
  assert.match(context, /RESTAURANT_ORDER_CONTEXT_INVALID/u);
});

test('paid sale identity is guarded at the table and migration stays forward-only', () => {
  const guard = functionBody('private.protect_restaurant_paid_sale_id_v1');
  assert.match(guard, /old\.payment_status[\s\S]*new\.paid_sale_id is distinct from old\.paid_sale_id/u);
  assert.match(migration, /pos_restaurant_orders_paid_sale_id_immutable_v1/u);
  assert.match(migration, /revoke all on function private\.lock_restaurant_order_settlement_v1/u);
  assert.match(migration, /set search_path to ''[\s\S]*set statement_timeout = '45s'[\s\S]*set lock_timeout = '20s'/u);
  assert.match(packageJson.scripts['test:restaurant-atomic-settlement-3d1'], /restaurant-atomic-settlement-3d1\.node-test\.mjs/u);
});
