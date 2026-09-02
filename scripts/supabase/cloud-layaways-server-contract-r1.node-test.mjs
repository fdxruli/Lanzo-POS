import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260902010950_cloud_layaways_server_contract_r1.sql'
);
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/gu, '\n');
const readSource = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

const service = readSource('src/services/layawayFinancialService.js');
const repository = readSource('src/services/salesCloud/salesCloudRepository.js');
const cashier = readSource('src/services/salesCloud/salesCloudCashierService.js');
const canonical = readSource('src/services/financial/financialCanonicalV1.js');
const constants = readSource('src/services/sync/syncConstants.js');
const projectionRegistry = readSource('src/services/financial/financialProjectionRegistry.js');
const intentLedger = readSource('src/services/financial/financialIntentLedger.js');
const envExample = readSource('.env.example');

const functionBody = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${marker}`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `incomplete function: ${marker}`);
  return source.slice(start, end + '$function$;'.length);
};

const countStandalone = (source, token) => (source.match(new RegExp(`^${token};$`, 'gmu')) || []).length;

test('cloud layaway migration is one forward-only, fail-closed transaction', () => {
  assert.equal(countStandalone(migration, 'begin'), 1);
  assert.equal(countStandalone(migration, 'commit'), 1);
  assert.match(migration, /create table if not exists public\.pos_layaways\s*\(/u);
  assert.match(migration, /create table if not exists public\.pos_layaway_payments\s*\(/u);
  assert.match(migration, /create table if not exists public\.pos_layaway_inventory_reservations\s*\(/u);
  assert.match(migration, /constraint pos_layaways_license_id_id_uk unique \(license_id, id\)/u);
  assert.match(migration, /constraint pos_layaway_payments_layaway_fk[\s\S]*references public\.pos_layaways\(license_id, id\)/u);
  assert.match(migration, /constraint pos_layaway_reservations_layaway_fk[\s\S]*references public\.pos_layaways\(license_id, id\)/u);
  assert.match(migration, /alter table public\.pos_layaways enable row level security/u);
  assert.match(migration, /alter table public\.pos_layaway_payments enable row level security/u);
  assert.match(migration, /alter table public\.pos_layaway_inventory_reservations enable row level security/u);
  for (const table of ['pos_layaways', 'pos_layaway_payments', 'pos_layaway_inventory_reservations']) {
    assert.match(
      migration,
      new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`, 'u'),
      `direct DML must remain revoked for ${table}`
    );
  }
  assert.doesNotMatch(migration, /grant all on public\.pos_layaway/u);
});

test('cloud layaway capability remains disabled until an explicit rollout', () => {
  assert.match(migration, /create or replace function private\.assert_cloud_layaways_enabled\(/u);
  assert.match(migration, /->'features'->>'cloud_layaways'/u);
  assert.match(migration, /raise exception 'CLOUD_LAYAWAYS_DISABLED'/u);
  assert.doesNotMatch(migration, /update\s+public\.(plans|licenses)\b/iu);
  assert.match(constants, /VITE_ENABLE_CLOUD_LAYAWAYS/u);
  assert.match(constants, /cloud_layaways/u);
  assert.match(envExample, /^VITE_ENABLE_CLOUD_LAYAWAYS=false$/mu);
});

test('dispatcher validates capability, station, actor, session, idempotency, and hash before effects', () => {
  const dispatcher = functionBody(
    migration,
    'create or replace function public.pos_execute_financial_operation_v1('
  );
  const capability = dispatcher.indexOf('perform private.assert_cloud_layaways_enabled(v_context);');
  const station = dispatcher.indexOf('private.resolve_financial_cash_station_v1');
  const session = dispatcher.indexOf('CASH_SESSION_NOT_OPEN');
  const actor = dispatcher.indexOf('CASH_SESSION_FORBIDDEN');
  const rateLimit = dispatcher.indexOf('public.enforce_pos_rpc_rate_limit_v2(');
  const reservation = dispatcher.indexOf('private.reserve_financial_operation_v1(');
  const actorResolution = dispatcher.indexOf('v_actor_key := private.resolve_cash_actor_key(v_context);');
  assert.ok(actorResolution >= 0 && rateLimit > actorResolution && capability > rateLimit && station > capability && session > station && actor > session && reservation > actor);
  assert.match(dispatcher, /RPC_RATE_LIMITED/u);
  assert.match(dispatcher, /private\.assert_pos_permission\(v_context, 'pos'\)/u);
  assert.match(dispatcher, /private\.layaway_request_cash_session_id_v1\(p_request\)/u);
  assert.match(dispatcher, /p_request_hash/u);
  assert.match(dispatcher, /v_canonical->>'cash_session_id'/u);
  assert.doesNotMatch(dispatcher, /p_request->>['"]cash_station_id['"]/u);
  for (const operation of ['layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete']) {
    assert.match(dispatcher, new RegExp(`['"]${operation.replace('.', '\\.')}['"]`, 'u'));
  }
  for (const alias of ['cash_session_id', 'cashSessionId', 'cajaId']) {
    assert.match(migration, new RegExp(`['"]${alias}['"]`, 'u'));
  }
  assert.match(migration, /status <> 'open'/u);
  assert.match(migration, /cash_station_id is distinct from p_cash_station_id/u);
  assert.match(migration, /actor_key is distinct from p_actor_key/u);
});

test('create/payment/cancel are cash-atomic and never allocate a folio', () => {
  const create = functionBody(migration, 'create or replace function private.execute_layaway_create_financial_v1(');
  const payment = functionBody(migration, 'create or replace function private.execute_layaway_payment_financial_v1(');
  const cancel = functionBody(migration, 'create or replace function private.execute_layaway_cancel_financial_v1(');

  for (const body of [create, payment]) {
    assert.doesNotMatch(body, /next_pos_sale_folio\(/u);
    assert.match(body, /'folio', null/u);
    assert.match(body, /'sale', null/u);
    assert.match(body, /insert into public\.pos_cash_movements/u);
    assert.match(body, /source, reference_type, reference_id/u);
    assert.match(body, /'layaway_payment', 'layaway', v_layaway_id/u);
    assert.match(body, /private\.recalculate_pos_cash_session_totals\(/u);
  }
  assert.match(create, /v_payment_amount > 0/u);
  assert.match(payment, /LAYAWAY_PAYMENT_EXCEEDS_BALANCE/u);
  assert.match(cancel, /retain_money/u);
  assert.match(cancel, /'salida'/u);
  assert.match(cancel, /'layaway_refund', 'layaway', v_layaway_id/u);
  assert.match(cancel, /refund_id/u);
  assert.doesNotMatch(cancel, /next_pos_sale_folio\(/u);
});

test('delivery locks the server layaway, allocates one folio, consumes reservations once, and does not touch cash', () => {
  const completion = functionBody(
    migration,
    'create or replace function private.execute_layaway_completion_financial_v1('
  );
  const lock = completion.indexOf('for update');
  const folio = completion.indexOf('private.next_pos_sale_folio(');
  const sale = completion.indexOf('insert into public.pos_sales');
  assert.ok(lock >= 0 && folio > lock && sale > folio, 'delivery must lock before allocating its folio and sale');
  assert.match(completion, /status = 'cancelled'/u);
  assert.match(completion, /status = 'completed'/u);
  assert.match(completion, /paid_total/u);
  assert.match(completion, /LAYAWAY_ITEMS_MISMATCH/u);
  assert.match(completion, /jsonb_array_length\(v_request_payments\) <> 1/u);
  assert.match(completion, /canonical_layaway_item_v1/u);
  assert.match(completion, /private\.consume_layaway_stock_v1\(/u);
  assert.match(completion, /layaway_id\)/u);
  assert.match(completion, /v_subtotal/u);
  assert.match(completion, /v_discount_total/u);
  assert.match(completion, /LAYAWAY_TAX_SOURCE_UNRESOLVED/u);
  assert.match(completion, /cash_effect_status[^\n]*'not_required'/u);
  assert.doesNotMatch(completion, /insert into public\.pos_cash_movements/u);
  assert.match(completion, /'cash_movement', null/u);
  assert.match(completion, /'layaway_payments'/u);
});

test('apparel inventory uses server reservations, variant checks, release, and one-time consumption', () => {
  const reserve = functionBody(migration, 'create or replace function private.reserve_layaway_stock_v1(');
  const release = functionBody(migration, 'create or replace function private.release_layaway_stock_v1(');
  const consume = functionBody(migration, 'create or replace function private.consume_layaway_stock_v1(');
  assert.match(reserve, /for update/u);
  assert.match(reserve, /committed_stock/u);
  assert.match(reserve, /INSUFFICIENT_CLOUD_STOCK/u);
  assert.match(reserve, /LAYAWAY_VARIANT_MISMATCH/u);
  assert.match(reserve, /LAYAWAY_BATCH_MISMATCH/u);
  assert.match(reserve, /LAYAWAY_PRICE_MISMATCH/u);
  assert.match(reserve, /layaway_authoritative_item_v1/u);
  assert.match(reserve, /order by private\.layaway_request_text_v1/u);
  assert.match(reserve, /insert into public\.pos_layaway_inventory_reservations/u);
  assert.match(release, /status = 'released'/u);
  assert.match(release, /committed_stock = greatest/u);
  assert.match(release, /order by r\.product_id, coalesce\(r\.batch_id, ''\), r\.item_index/u);
  assert.match(consume, /status = 'consumed'/u);
  assert.match(consume, /private\.record_pos_inventory_movement\(/u);
  assert.match(consume, /status = 'reserved'/u);
  assert.match(consume, /returning \* into v_batch/u);
  assert.match(consume, /returning \* into v_product/u);
});

test('authenticated read RPCs expose layaway snapshots and incremental change evidence', () => {
  for (const rpc of ['pos_get_layaway', 'pos_pull_layaway_changes']) {
    const body = functionBody(migration, `create or replace function public.${rpc}(`);
    assert.match(body, /security definer/u);
    assert.match(body, /set search_path = ''/u);
    assert.match(body, /private\.validate_pos_sync_context\(/u);
    assert.match(body, /private\.assert_cloud_layaways_enabled\(/u);
    assert.match(body, /private\.assert_pos_permission\(v_context, 'pos'\)/u);
  }
  assert.match(migration, /revoke all on function public\.pos_get_layaway\([^;]+ from public, anon, authenticated;/u);
  assert.match(migration, /grant execute on function public\.pos_get_layaway\([^;]+ to anon, authenticated;/u);
  assert.match(migration, /revoke all on function public\.pos_pull_layaway_changes\([^;]+ from public, anon, authenticated;/u);
  assert.match(migration, /grant execute on function public\.pos_pull_layaway_changes\([^;]+ to anon, authenticated;/u);
  for (const entity of ['layaway', 'layaway_payment', 'layaway_inventory_reservation', 'cash_movement', 'product', 'product_batch']) {
    assert.match(migration, new RegExp(`['"]${entity}['"]`, 'u'));
  }
});

test('client routes cloud layaways through the shared intent and confirmed projections only', () => {
  for (const operation of ['layaway.create', 'layaway.payment', 'layaway.cancel']) {
    assert.ok(repository.includes(`operationType: '${operation}'`), `repository adapter is missing ${operation}`);
  }
  assert.match(repository, /executeNewFinancialIntent\(/u);
  assert.match(cashier, /applyCloudLayawayMutationProjection/u);
  assert.match(cashier, /applyLayawayFinancialResponseProjection/u);
  assert.match(service, /processCloudLayawayCreate/u);
  assert.match(service, /processCloudLayawayPayment/u);
  assert.match(service, /processCloudLayawayCancel/u);
  assert.match(service, /salesCloudRepository\.getLayaway/u);
  assert.match(service, /layawayRepository\.create/u);
  assert.match(service, /layawayRepository\.convertToSale/u);
  assert.match(canonical, /cash_session_id/u);
  assert.match(projectionRegistry, /'layaway\.create'/u);
  assert.match(projectionRegistry, /'layaway\.payment'/u);
  assert.match(projectionRegistry, /'layaway\.cancel'/u);
  assert.match(intentLedger, /'layaway\.create'/u);
  assert.match(intentLedger, /'layaway\.payment'/u);
  assert.match(intentLedger, /'layaway\.cancel'/u);
  assert.doesNotMatch(service, /registerMovement\(/u);
});
