import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertRaceState, cancellationContenderSql, runRestaurantFinancialRaces, settlementSql } from './pr352-r6-financial-races.mjs';

const valid = { parentCount:1,parentStatus:'ready',paymentStatus:'paid',paidSaleId:'test-order',
  sales:1,payments:1,operations:1,inventory:1,stock:19,cashMovements:1,
  cancelledItems:0,cancelKeys:0,permits:0,operationKey:'test-key' };

test('financial final state rejects contradictory or duplicate effects', () => {
  assert.doesNotThrow(()=>assertRaceState(valid,'test-order','test-key',20));
  for (const [field, value] of Object.entries({parentCount:2,parentStatus:'cancelled',paymentStatus:'unpaid',
    paidSaleId:'other',sales:2,payments:2,operations:2,inventory:2,stock:18,cashMovements:2,
    cancelledItems:1,cancelKeys:1,permits:1,operationKey:'other'})) {
    assert.throws(()=>assertRaceState({...valid,[field]:value},'test-order','test-key',20),undefined,field);
  }
  assert.throws(() => assertRaceState({...valid, parentStatus: null}, 'test-order', 'test-key', 20));
  assert.throws(() => assertRaceState({...valid, cashMovements: null}, 'test-order', 'test-key', 20));
});

test('captured dispatcher and cancellation take the same parent lock before settlement effects', async () => {
  const dispatcher = await readFile('supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql', 'utf8');
  const body = dispatcher.slice(dispatcher.indexOf('CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1('));
  assert.ok(body.indexOf('private.lock_restaurant_order_settlement_v1(') > 0);
  assert.ok(body.indexOf('private.lock_restaurant_order_settlement_v1(') < body.indexOf('private.reserve_financial_operation_v1('));
  const bridge = await readFile('docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql', 'utf8');
  const cancellation = bridge.slice(bridge.indexOf('create function private.prepare_restaurant_bridge_cancel_v1('));
  assert.match(cancellation.slice(0, 2200), /private\.lock_restaurant_order_settlement_v1\(/);
  const harness = await readFile('scripts/supabase/pr352-r6-financial-races.mjs', 'utf8');
  assert.match(harness, /pg_blocking_pids\(c\.pid\)/);
  assert.match(harness, /hashtext\('restaurant_split:' \|\|/);
  assert.match(harness, /hl\.objsubid=2/);
  assert.match(harness, /contender\.finish\('commit;'\); holder\.finish\('commit;'\)/);
});

test('F1 contender invokes the authentic cancel RPC and requires the paid rejection', () => {
  const sql=cancellationContenderSql("order'one",'2026-10-30T00:00:00Z');
  assert.match(sql,/public\.pos_cancel_restaurant_order_from_pos_v1\(/);
  assert.match(sql,/'order''one'/);
  assert.match(sql,/state<>'P0001' or message<>'RESTAURANT_ORDER_ALREADY_PAID'/);
  assert.match(sql,/R6_CANCEL_UNEXPECTEDLY_ACCEPTED/);
});

test('F2 same K/H submissions are identical and retain parent and settlement context', () => {
  const first=settlementSql('r6-order','2026-10-30T00:00:00Z','same-key');
  const replay=settlementSql('r6-order','2026-10-30T00:00:00Z','same-key');
  assert.equal(first,replay);
  assert.match(first.slice(0, 900),/R6_FINANCIAL_RPC/, 'activity marker must survive default query truncation');
  assert.match(first,/private\.financial_operation_hash/);
  assert.match(first,/public\.pos_execute_financial_operation_v1/);
  assert.match(first,/'restaurant_settlement'.*'parent_order_id','r6-order'/);
  assert.match(first,/'same-key',h,'sale\.cashier_inventory'/);
  assert.notEqual(first,settlementSql('r6-order','2026-10-30T00:00:00Z','different-key'));
});

test('unexpected psql exit fails the race and runs session cleanup', async () => {
  let cleanupChecked=false;
  const query=async (sql)=>{
    if (sql.includes("current_database() ||")) return 'pr352_bridge_isolated|170006';
    if (sql.includes("'version',updated_at")) return JSON.stringify({version:'2026-10-30T00:00:00Z',stock:20});
    if (sql.includes('json_agg')) return '[]';
    if (sql.includes('count(*) from pg_stat_activity')) { cleanupChecked=true; return '0'; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  // A nonexistent executable exercises the actual spawn failure path without PostgreSQL.
  await assert.rejects(runRestaurantFinancialRaces({query,psqlBin:'pr352-definitely-missing-psql',env:process.env,
    createLegacyOrder:async()=> 'internal-test-id'}),/psql session exited during|psql unavailable/);
  assert.equal(cleanupChecked,true);
});
