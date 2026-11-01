import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runRestaurantCancellationScenarios } from './pr352-r6-cancellation.mjs';

test('cancellation scenarios stop on a failed SQL operation and do not report results', async () => {
  const calls = [];
  await assert.rejects(runRestaurantCancellationScenarios({
    createLegacyOrder: async (...args) => { calls.push(['seed', ...args]); },
    query: async (sql) => { calls.push(['query', sql]); throw new Error('synthetic PostgreSQL failure'); },
    paidOrderId: 'r6-cancel-paid',
  }), /synthetic PostgreSQL failure/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], 'r6-cancel-valid');
});

test('all mandatory SQL operations precede a structured result and paid ID is safely quoted', async () => {
  const calls = [];
  const result = await runRestaurantCancellationScenarios({
    createLegacyOrder: async (id, key) => { calls.push({ seed: id, key }); },
    query: async (sql) => {
      calls.push({ sql });
      return sql.includes('pos_upsert_restaurant_order_unlimited') ? '{"success":true}' : '';
    },
    paidOrderId: "r6-cancel-paid'quoted",
  });
  assert.deepEqual(result.map(({ name }) => name), ['C1', 'C4', 'C2', 'C3', 'C6']);
  assert.equal(calls.length, 7);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C3_EFFECTS')).sql, /r6-cancel-paid''quoted/);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C1_C4_EFFECTS')).sql, /transaction_id=pg_current_xact_id\(\)/);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C6_ROLLBACK_EFFECTS')).sql, /R6_C6_PERMIT_ROLLBACK_LEAK/);
});

test('staff seed failure cannot produce cancellation evidence', async () => {
  let queryCount = 0;
  await assert.rejects(runRestaurantCancellationScenarios({
    createLegacyOrder: async () => {},
    query: async () => (++queryCount === 2 ? '{"success":false}' : ''),
    paidOrderId: 'r6-cancel-paid',
  }), /C2 synthetic staff order/);
});

test('test expectations match the captured RPC and bridge source contracts', async () => {
  const writer = await readFile('supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql', 'utf8');
  const bridge = await readFile('docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql', 'utf8');
  assert.match(writer, /assert_pos_permission\(v_context, 'refunds'\)/);
  assert.match(writer, /v_idem\.status = 'completed' and v_idem\.response_payload is not null then return v_idem\.response_payload/);
  assert.match(writer, /RESTAURANT_ORDER_ALREADY_CANCELLED/);
  assert.match(bridge, /RESTAURANT_TABLE_OWNER_REQUIRED/);
  assert.match(bridge, /RESTAURANT_ORDER_ALREADY_PAID/);
  assert.match(bridge, /delete from private\.restaurant_bridge_cancel_permits where transaction_id=pg_current_xact_id\(\)/);
});
