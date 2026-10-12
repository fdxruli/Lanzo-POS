import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

// Requires the isolated production-helper fixture. The financial dispatcher
// and settlement lock are production bodies; sale side effects are controlled
// fixture functions. Never point this fixture runner at a deployed database.
assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Fixture must use loopback');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN, 'Set PGPORT and PSQL_BIN');
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const sql = (query) => {
  const result = spawnSync(process.env.PSQL_BIN, [...args, '-c', query], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const run = (query, applicationName) => new Promise((resolve) => {
  const child = spawn(process.env.PSQL_BIN, [...args, '-c', query], {
    env: { ...process.env, PGAPPNAME: applicationName }, windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  child.on('exit', (code) => resolve({ code, output }));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const license = '00000000-0000-0000-0000-000000000001';
const version = '2026-10-01T00:00:00Z';
const call = (operation, id, suffix) => {
  if (operation === 'cancel') return `select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid',null,'${id}','${version}','QA race','${id}-${suffix}');`;
  const payload = operation === 'split' ? { cash_session_id: 'cash-a', parent_order_id: id,
    parent_order_version: version } : { cash_session_id: 'cash-a', sale: { id, total: 50 },
    items: [], payments: [], restaurant_settlement: { parent_order_id: id, parent_order_version: version } };
  return `select public.pos_execute_financial_operation_v1('fixture-license','A','valid',null,'${id}-${suffix}','fixture-hash','sale.${operation}', '${JSON.stringify(payload)}'::jsonb);`;
};
const results = [];
const runId = Date.now();
for (const [index, [first, second]] of [['cancel','cashier'], ['cashier','cancel'], ['cancel','split'],
  ['split','cancel'], ['cancel','cancel'], ['cancel','cancel']].entries()) {
  const id = `race-3d13-${runId}-${index}`;
  sql(`insert into public.pos_restaurant_orders(id,license_id,local_order_id,created_by_device_id,updated_at,payment_status,total)
    values('${id}','${license}','${id}','00000000-0000-0000-0000-00000000000a','${version}','unpaid',50);`);
  const applicationName = `3d13-first-${index}`;
  const winner = run(`begin; select private.lock_restaurant_order_settlement_v1('${license}','${id}');
    select pg_sleep(2); ${call(first, id, 'first')} commit;`, applicationName);
  let acquired = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    acquired = sql(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where a.application_name='${applicationName}' and l.locktype='advisory' and l.granted);`) === 't';
    if (acquired) break;
    await delay(25);
  }
  assert.ok(acquired, 'Winner acquired the real settlement advisory lock');
  const loser = run(`begin; ${call(second, id, 'second')} commit;`, `3d13-second-${index}`);
  const [win, lose] = await Promise.all([winner, loser]);
  assert.equal(win.code, 0, win.output);
  assert.notEqual(lose.code, 0, 'Only one fresh transition may win');
  assert.match(lose.output, first === 'cancel' ? /RESTAURANT_ORDER_ALREADY_CANCELLED/ : /RESTAURANT_ORDER_ALREADY_PAID/);
  const state = JSON.parse(sql(`select jsonb_build_object('status',status,'payment',payment_status,
    'sales',(select count(*) from public.pos_sales where local_order_id='${id}'),
    'events',(select count(*) from public.pos_sync_events where entity_id='${id}' and operation='cancel'),
    'cancelLedger',(select count(*) from public.pos_idempotency_keys where entity_id='${id}'))
    from public.pos_restaurant_orders where local_order_id='${id}';`));
  assert.equal(state.sales, first === 'cancel' ? 0 : 1);
  assert.equal(state.events, first === 'cancel' ? 1 : 0);
  assert.equal(state.cancelLedger, first === 'cancel' ? 1 : 0);
  assert.equal(first === 'cancel' ? state.status : state.payment, first === 'cancel' ? 'cancelled' : 'paid');
  results.push({ first, second, result: 'SERIALIZED', ...state });
}
console.log(JSON.stringify(results, null, 2));
