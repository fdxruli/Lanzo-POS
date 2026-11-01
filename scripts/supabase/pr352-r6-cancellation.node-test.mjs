import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runRestaurantCancellationScenarios } from './pr352-r6-cancellation.mjs';


// Deterministic Node doubles validate orchestration only; PostgreSQL observations require the isolated job.
function syntheticSnapshot(sql) {
  const match = sql.match(/o\.local_order_id='((?:''|[^'])*)'/);
  assert.ok(match, 'snapshot must scope its parent');
  const localId = match[1].replaceAll("''", "'");
  return JSON.stringify({ parent: { id: 'internal-' + localId, local_order_id: localId,
    updated_at: '2026-10-31 12:00:00+00', status: 'pending' }, items: [{ id: 'item-' + localId }],
    effects: { sales: 1, payments: 1, inventory: 1, cash: 1 }, cancelEvents: 0, permits: 0 });
}

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
      if (sql.includes("'cancelEvents'")) return syntheticSnapshot(sql);
      if (sql.includes("pr352_r6.c1_transaction_id")) return JSON.stringify({ backendPid: 301, transactionId: '9001', committed: true,
        scope: 'separate psql -c implicit transaction completed before C4' });
      if (sql.includes("current_setting('pr352_r6.c4_sqlstate')")) return JSON.stringify({
        sqlstate: 'P0001:RESTAURANT_ORDER_ALREADY_CANCELLED', backendPid: 302, transactionId: '9002',
      });
      if (sql.includes("current_setting('pr352_r6.c2_sqlstate')")) return 'P0001:RESTAURANT_TABLE_OWNER_REQUIRED';
      if (sql.includes("current_setting('pr352_r6.c3_sqlstate')")) return 'P0001:RESTAURANT_ORDER_ALREADY_PAID';
      if (sql.includes("current_setting('pr352_r6.c6_sqlstate')")) return 'P0001:R6_C6_ROLLBACK_PROBE';
      return sql.includes('pos_upsert_restaurant_order_unlimited') ? '{"success":true}' : '';
    },
    paidOrderId: "r6-cancel-paid'quoted",
  });
  assert.deepEqual(result.map(({ name }) => name), ['C1', 'C4', 'C2', 'C3', 'C6']);
  assert.equal(calls.length, 17);
  assert.ok(calls.findIndex(({ sql }) => sql?.includes('R6_C1_EFFECTS')) < calls.findIndex(({ sql }) => sql?.includes('R6_C4_REPLAY')), 'C4 must run in a separate query after C1 commits');
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C4_REPLAY')).sql, /2026-10-31 12:00:00\+00/);
  for (const row of result) {
    assert.equal(row.operation, 'public.pos_cancel_restaurant_order_from_pos_v1');
    assert.ok(row.actor && row.parentId && row.stateBefore?.parent && row.stateAfter?.parent);
    assert.ok(row.financialEffects?.before && row.financialEffects?.after);
    assert.equal(row.cleanup.permitRows, 0);
    assert.ok(row.sqlstate?.state);
  }
  assert.equal(result.find(({ name }) => name === 'C6').rollbackKind, 'plpgsql_subtransaction');
  assert.notEqual(result.find(({ name }) => name === 'C1').transactionBoundary.transactionId,
    result.find(({ name }) => name === 'C4').replayBoundary.transactionId);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C3_EFFECTS')).sql, /r6-cancel-paid''quoted/);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C1_EFFECTS')).sql, /transaction_id=pg_current_xact_id\(\)/);
  assert.match(calls.find(({ sql }) => sql?.includes('R6_C6_ROLLBACK_EFFECTS')).sql, /R6_C6_PERMIT_ROLLBACK_LEAK/);
});


test('wrong or missing observed SQLSTATE cannot produce replay evidence', async () => {
  for (const sqlstate of ['', '23505:wrong error']) {
    await assert.rejects(runRestaurantCancellationScenarios({
      createLegacyOrder: async () => {},
      query: async (sql) => sql.includes("'cancelEvents'") ? syntheticSnapshot(sql)
        : (sql.includes("pr352_r6.c1_transaction_id") ? JSON.stringify({ backendPid: 301, transactionId: '9001' })
          : (sql.includes("current_setting('pr352_r6.c4_sqlstate')") ? JSON.stringify({ sqlstate, backendPid: 302, transactionId: '9002' }) : '')),
      paidOrderId: 'r6-paid',
    }), /Expected values to be strictly equal/);
  }
});

test('staff seed failure cannot produce cancellation evidence', async () => {
  await assert.rejects(runRestaurantCancellationScenarios({
    createLegacyOrder: async () => {},
    query: async (sql) => sql.includes("'cancelEvents'") ? syntheticSnapshot(sql)
      : (sql.includes("pr352_r6.c1_transaction_id") ? JSON.stringify({ backendPid: 301, transactionId: '9001' })
        : (sql.includes("current_setting('pr352_r6.c4_sqlstate')") ? JSON.stringify({
          sqlstate: 'P0001:RESTAURANT_ORDER_ALREADY_CANCELLED', backendPid: 302, transactionId: '9002',
        }) : (sql.includes('pos_upsert_restaurant_order_unlimited') ? '{"success":false}' : ''))),
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
