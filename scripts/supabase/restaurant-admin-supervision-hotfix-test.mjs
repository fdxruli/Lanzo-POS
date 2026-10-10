import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

// Run after the seven-race harness, only in its disposable loopback fixture.
assert.ok(process.argv.includes('--isolated-fixture'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'lanzo_admin_supervision_fixture');
assert.ok(process.env.PSQL_BIN && process.env.PGPORT);
const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const execute = query => {
  writeFileSync('.tmp-hotfix-query.sql', query);
  return spawnSync(process.env.PSQL_BIN, [...args, '-f', '.tmp-hotfix-query.sql'], { encoding: 'utf8', windowsHide: true });
};
const sql = query => { const r = execute(query); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const denied = (query, code) => { const r = execute(query); assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, new RegExp(code)); };
const license = '00000000-0000-0000-0000-000000000001';
const version = '2026-10-01T00:00:00Z';
const seed = id => sql(`insert into public.pos_restaurant_orders(id,license_id,local_order_id,sale_id,created_by_device_id,created_by_staff_user_id,updated_at,total,payment_status)
values('${id}','${license}','${id}','${id}','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','${version}',50,'unpaid')`);
sql(`create function private.is_restaurant_order_status(text) returns boolean language sql as $$
select lower(trim($1)) in ('pending','preparing','ready','delivered','cancelled') $$;`);
// These two leaves isolate rate limiting, not authorization or Kitchen writes.
sql(`create function public.enforce_pos_rpc_rate_limit_v2(p_license_key text,p_device_fingerprint text,
p_staff_session_token text,p_rpc_name text,p_scope text,p_max_attempts integer,p_window_seconds integer,
p_block_seconds integer,p_code text,p_metadata jsonb) returns jsonb language sql as $$ select '{"allowed":true}'::jsonb $$;
create function public.build_pos_rpc_rate_limited_response(jsonb) returns jsonb language sql as $$ select '{"success":false}'::jsonb $$;`);
sql(readFileSync('supabase/tests/fixtures/restaurant_hotfix_kitchen_wrappers.sql', 'utf8'));
const status = (id, state, wrapper = false) => `select public.${wrapper ? 'pos_update_restaurant_order_status' : 'pos_update_restaurant_order_status_unlimited'}('fixture-license','B','valid','kitchen','${id}','${state}','hotfix-${id}-${state}-${wrapper}')`;
seed('hotfix-kitchen');
denied(status('hotfix-kitchen', 'cancelled'), 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED');
denied(status('hotfix-kitchen', 'cancelled', true), 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED');
for (const state of ['preparing', 'ready', 'delivered']) assert.equal(JSON.parse(sql(status('hotfix-kitchen', state))).success, true);
assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='hotfix-kitchen'`), '0');
assert.equal(sql(`select cancelled_at is null and payment_status='unpaid' from public.pos_restaurant_orders where id='hotfix-kitchen'`), 't');
denied(`update public.pos_restaurant_orders set archived_at=now() where id='hotfix-kitchen'`, 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED');
// Defense at the parent table covers aliases and alternative SECURITY DEFINER
// callers; a browser metadata marker does not mint a transaction permit.
for (const [i, assignment] of ["status='cancelled'", "fulfillment_status='cancelled'", 'cancelled_at=now()',
  `metadata='{"cancelledFromPos":true}'`, `metadata='{"cancelledFromPos":"true"}'`, `metadata='{"archived":true}'`].entries()) {
  const id = `hotfix-alias-${i}`; seed(id);
  denied(`update public.pos_restaurant_orders set ${assignment} where id='${id}'`, 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED');
  assert.equal(sql(`select status from public.pos_restaurant_orders where id='${id}'`), 'pending');
}
denied(`set role anon; insert into private.restaurant_parent_cancel_permits values(pg_current_xact_id(),'${license}','hotfix-kitchen')`, 'permission denied');
denied(`select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','B','valid','kitchen','hotfix-kitchen','${version}','Forged reason','hotfix-kitchen-pos')`, 'POS_PERMISSION_DENIED');
seed('hotfix-paid');
sql(`update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id='paid-fixture' where id='hotfix-paid'`);
denied(`select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','B','valid','admin','hotfix-paid','${version}','Admin reason','hotfix-paid-cancel')`, 'RESTAURANT_ORDER_ALREADY_PAID');
seed('hotfix-admin-edit');
const adminEdit = reason => `select public.pos_upsert_restaurant_order_unlimited('fixture-license','A','valid','admin',
'${JSON.stringify({ localOrderId: 'hotfix-admin-edit', saleId: 'hotfix-admin-edit', expectedParentVersion: version, total: 50, ...(reason ? { interventionReason: reason } : {}) })}',
'[{"localLineId":"line","productName":"Pizza","quantity":1,"unitPrice":50,"lineTotal":50}]','hotfix-admin-edit-${reason ? 'reason' : 'missing'}')`;
denied(adminEdit(null), 'RESTAURANT_INTERVENTION_REASON_REQUIRED');
assert.equal(JSON.parse(sql(adminEdit('Admin intervention'))).success, true);
assert.equal(sql(`select created_by_staff_user_id from public.pos_restaurant_orders where id='hotfix-admin-edit'`), '00000000-0000-0000-0000-0000000000aa');
assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='hotfix-admin-edit'`), '1');
seed('hotfix-items');
sql(`insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,product_name) values('hotfix-item','${license}','hotfix-items','Pizza')`);
const itemResult = JSON.parse(sql(`select public.pos_update_restaurant_order_item_status('fixture-license','B','valid','kitchen','hotfix-items','hotfix-item','cancelled','hotfix-item-cancel')`));
assert.equal(itemResult.success, true);
assert.equal(sql(`select status from public.pos_restaurant_order_items where id='hotfix-item'`), 'cancelled');
assert.equal(sql(`select status='pending' and cancelled_at is null and payment_status='unpaid' and updated_at <> '${version}'::timestamptz from public.pos_restaurant_orders where id='hotfix-items'`), 't');
denied(`select public.pos_upsert_restaurant_order_unlimited('fixture-license','A','valid','staff-a',
'{"localOrderId":"hotfix-items","saleId":"hotfix-items","expectedParentVersion":"${version}","total":50}',
'[{"localLineId":"line","productName":"Pizza","quantity":1,"unitPrice":50,"lineTotal":50}]','hotfix-stale-after-kitchen')`, 'RESTAURANT_ORDER_VERSION_CONFLICT');
seed('hotfix-cancel');
const cancel = `select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid','staff-a','hotfix-cancel','${version}','Origin reason','hotfix-origin-cancel')`;
assert.equal(JSON.parse(sql(cancel)).success, true);
assert.equal(JSON.parse(sql(cancel)).success, true);
denied(status('hotfix-cancel', 'pending'), 'RESTAURANT_ORDER_ALREADY_CANCELLED');
assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='hotfix-cancel'`), '1');
assert.equal(sql('select count(*) from private.restaurant_parent_cancel_permits'), '0');
// Administrative history cleanup preserves the durable cancellation evidence.
sql(`update public.pos_restaurant_orders set archived_at=now(), metadata=metadata || '{"archived":true}'::jsonb where id='hotfix-cancel'`);
assert.equal(sql(`select metadata->>'cancelledFromPos' from public.pos_restaurant_orders where id='hotfix-cancel'`), 'true');
seed('hotfix-rollback');
denied(`begin; select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','B','valid','admin','hotfix-rollback','${version}','Admin reason','hotfix-rollback'); select 1/0; commit;`, 'division by zero');
assert.equal(sql(`select status from public.pos_restaurant_orders where id='hotfix-rollback'`), 'pending');
assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='hotfix-rollback'`), '0');
assert.equal(sql('select count(*) from private.restaurant_parent_cancel_permits'), '0');
// Real multi-session contention, with a lock barrier rather than a timing sleep.
const openSession = name => {
  const child = spawn(process.env.PSQL_BIN, args, { env: { ...process.env, PGAPPNAME: name }, windowsHide: true });
  let output = '';
  child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
  return { child, done: new Promise(resolve => child.on('exit', code => resolve({ code, output }))) };
};
const waitFor = async predicate => {
  for (let i = 0; i < 80; i++) {
    if (sql(predicate) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Lock barrier was not reached');
};
for (const [i, victimLicense] of [license, '00000000-0000-0000-0000-000000000002'].entries()) {
  const id = `hotfix-line-attacker-${i}`, item = `hotfix-shared-${i}`, name = `hotfix-line-race-${i}`;
  seed(id);
  const winner = openSession(name);
  winner.child.stdin.write(`begin; insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,product_name)
values('${item}','${victimLicense}','victim-${i}','Victim value');\n`);
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${name}' and state='idle in transaction')`);
  const loser = openSession(`${name}-loser`);
  loser.child.stdin.end(`select public.pos_upsert_restaurant_order_unlimited('fixture-license','A','valid','staff-a',
'{"localOrderId":"${id}","saleId":"${id}","expectedParentVersion":"${version}","total":50}',
'[{"id":"${item}","localLineId":"line","productName":"Attacker value","quantity":1,"unitPrice":50,"lineTotal":50}]','${name}');\n`);
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${name}-loser' and wait_event_type='Lock')`);
  winner.child.stdin.end('commit;\n');
  const [win, lose] = await Promise.all([winner.done, loser.done]);
  assert.equal(win.code, 0, win.output); assert.notEqual(lose.code, 0, lose.output);
  assert.match(lose.output, /RESTAURANT_TABLE_SCOPE_DENIED/);
  assert.equal(sql(`select product_name from public.pos_restaurant_order_items where id='${item}'`), 'Victim value');
}
seed('hotfix-kitchen-race');
sql(`insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,product_name) values('hotfix-race-item','${license}','hotfix-kitchen-race','Pizza')`);
const winner = openSession('hotfix-kitchen-race');
winner.child.stdin.write(`begin; select private.lock_restaurant_order_settlement_v1('${license}','hotfix-kitchen-race');\n`);
await waitFor(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='hotfix-kitchen-race' and l.locktype='advisory' and l.granted)`);
const loser = openSession('hotfix-kitchen-race-loser');
loser.child.stdin.end(`select public.pos_upsert_restaurant_order_unlimited('fixture-license','A','valid','staff-a',
'{"localOrderId":"hotfix-kitchen-race","saleId":"hotfix-kitchen-race","expectedParentVersion":"${version}","total":50}',
'[{"localLineId":"line","productName":"Pizza","quantity":1,"unitPrice":50,"lineTotal":50}]','hotfix-kitchen-race-edit');\n`);
await waitFor(`select exists(select 1 from pg_stat_activity where application_name='hotfix-kitchen-race-loser' and wait_event_type='Lock')`);
winner.child.stdin.end(`select public.pos_update_restaurant_order_item_status('fixture-license','B','valid','kitchen','hotfix-kitchen-race','hotfix-race-item','preparing','hotfix-race-kitchen'); commit;\n`);
const [win, lose] = await Promise.all([winner.done, loser.done]);
assert.equal(win.code, 0, win.output); assert.notEqual(lose.code, 0, lose.output);
assert.match(lose.output, /RESTAURANT_ORDER_VERSION_CONFLICT/);
assert.equal(sql(`select status from public.pos_restaurant_order_items where id='hotfix-race-item'`), 'preparing');
console.log('HOTFIX SQL PASS: published wrappers, Kitchen-only actor, terminal aliases, item rejection, parent version, origin retry, paid guard, rollback; three additional real races PASS');
