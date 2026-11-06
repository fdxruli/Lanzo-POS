import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

// Real PostgreSQL, real captured authority/payment/cancellation functions.
// Fixed disposable loopback database; never accepts production connection strings.
const database = 'fin01_cert_allocations';
const contract = '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]}';
const raw = sql => queryLoopbackPostgres(sql, database);
// Fixture seeding and direct legacy-core regressions use real V2 admission.
// Public V2 calls below are also exercised without this outer witness.
const q = sql => raw(`begin;select private.pos_fin01_enter_pilot_v2('${contract}','fixture-a','device-a','synthetic-device','owner-session-a');${sql};select private.pos_fin01_leave_pilot_v2('10000000-0000-0000-0000-000000000001');commit;`);
const lit = s => `'${String(s).replaceAll("'", "''")}'`;
const json = s => `${lit(JSON.stringify(s))}::jsonb`;
const tenant = '10000000-0000-0000-0000-000000000001';
const results = [];
const data = async s => JSON.parse(await q(s));
const test = async (name, body) => {
  try { await body(); results.push({ name, status: 'PASS' }); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
  console.log(`${results.at(-1).status} ${name}`);
  await fs.writeFile('work/fixture/allocation-results.json', JSON.stringify(results, null, 2));
};
const client = async () => {
  const id = `allocation-customer-${randomUUID()}`;
  await q(`insert into public.pos_customers(id,license_id,name,credit_limit) values (${lit(id)},'${tenant}','Synthetic allocation test',1000)`);
  return id;
};
const sale = async (customer, total, paid = 0, soldAt = '2026-01-01T00:00:00Z') => {
  const id = `allocation-sale-${randomUUID()}`;
  const s = { id, subtotal: total, total, amount_paid: paid, balance_due: total-paid, sold_at: soldAt, payment_method: paid ? 'mixed_credit' : 'credit' };
  const product = `allocation-product-${randomUUID()}`;
  await q(`insert into public.pos_products(id,license_id,name,name_key,price,cost,stock) values (${lit(product)},'${tenant}','Synthetic',${lit(product)},${total},1,100)`);
  const items = [{ product_id: product, quantity: 1, unit_price: total, line_total: total, line_subtotal: total }];
  const p = paid ? [{ method: 'cash', amount: paid, received_amount: paid }] : [];
  const r = await data(`select public.pos_create_cloud_sale_credit_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${json(s)},${json(items)},${json(p)},'cash-a',${lit(customer)},${lit(randomUUID())})`);
  assert.equal(r.success, true, JSON.stringify(r));
  return r.sale.id;
};
const paymentSql = (c, amount, allocations = [], key = randomUUID(), device = 'a') =>
  `public.pos_record_customer_payment_unlimited('fixture-a','device-${device}','synthetic-device','owner-session-${device}',${lit(c)},${lit(amount)}::numeric,'efectivo','cash-${device}','Synthetic allocation test',${json(allocations)},${lit(key)})`;
const pay = async (...a) => data(`select ${paymentSql(...a)}`);
const balances = c => data(`select jsonb_agg(private.pos_sale_to_jsonb(s) order by sold_at,id) from public.pos_sales s where customer_id=${lit(c)} and license_id='${tenant}'`);
const debt = c => q(`select debt from public.pos_customers where id=${lit(c)} and license_id='${tenant}'`).then(Number);
const counts = () => data(`select jsonb_build_object('ledger',(select count(*) from public.pos_customer_ledger),'cash',(select count(*) from public.pos_cash_movements),'cancellations',(select count(*) from public.pos_sale_cancellations),'idem',(select count(*) from public.pos_idempotency_keys))`);
const cancel = id => data(`select public.pos_cancel_cloud_sale_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${lit(id)},'Synthetic cancellation',${lit(randomUUID())})`);
await q(`update public.licenses set features=features||'{"cloud_sales_cancellations":true}' where id='${tenant}'`);
await test('$20 sale + $5 general payment, original amounts unchanged', async () => {
  const c = await client(); await sale(c, 20); const r = await pay(c, 5);
  assert.equal(r.success, true); assert.equal(await debt(c), 15);
  const [s] = await balances(c);
  assert.equal(s.total, 20); assert.equal(s.amount_paid, 0); assert.equal(s.balance_due, 20);
  assert.equal(s.current_balance_due, 15); assert.equal(s.assigned_payments_total, 5);
  assert.equal(r.sales[0].current_balance_due, 15);
  assert.deepEqual(r.ledger_entry.allocation_payload.map(a => [a.amount_applied,a.previous_sale_balance,a.new_sale_balance]), [[5,20,15]]);
});
await test('checkout deposit stays historical; later assigned payment reduces only live balance', async () => {
  const c=await client();await sale(c,30,10);await pay(c,5);
  const [s]=await balances(c);assert.equal(s.total,30);assert.equal(s.amount_paid,10);
  assert.equal(s.original_balance_due,20);assert.equal(s.assigned_payments_total,5);
  assert.equal(s.current_balance_due,15);assert.equal(await debt(c),15);
});
await test('FIFO oldest first, deterministic distribution across two sales', async () => {
  const c = await client(), a = await sale(c, 10), b = await sale(c, 20, 0, '2026-01-02T00:00:00Z');
  const r = await pay(c, 15);
  assert.deepEqual(r.ledger_entry.allocation_payload.map(x => [x.sale_id,x.amount_applied]), [[a,10],[b,5]]);
  assert.deepEqual((await balances(c)).map(x => x.current_balance_due), [0,15]);
  assert.equal(await debt(c), 15);
});
await test('specific sale, forged browser balances ignored, other sale unchanged', async () => {
  const c = await client(), a = await sale(c,20), b = await sale(c,30);
  const r = await pay(c,5,[{ sale_id:b, amount_applied:5, previous_sale_balance:900, new_sale_balance:0 }]);
  assert.equal(r.success,true);
  const rows = await balances(c);
  assert.equal(rows.find(x=>x.id===a).current_balance_due,20);
  assert.equal(rows.find(x=>x.id===b).current_balance_due,25);
  assert.equal(r.ledger_entry.allocation_payload[0].previous_sale_balance,30);
});
await test('same key sequential and concurrent retries produce one payment', async () => {
  const c = await client(); await sale(c,20); const key=randomUUID();
  const [a,b] = await Promise.all([pay(c,5,[],key),pay(c,5,[],key)]);
  assert.deepEqual(a,b); const before=await counts();
  assert.deepEqual(await pay(c,5,[],key),a); assert.deepEqual(await counts(),before);
  assert.equal(await debt(c),15);
});
await test('two concurrent payments cannot overpay or overallocate', async () => {
  const c=await client(); await sale(c,20);
  const r=await Promise.all([pay(c,15),pay(c,15,[],randomUUID(),'b')]);
  assert.equal(r.filter(x=>x.success).length,1);
  assert.equal(r.find(x=>!x.success).code,'PAYMENT_EXCEEDS_DEBT');
  assert.equal(await debt(c),5); assert.equal((await balances(c))[0].current_balance_due,5);
});
await test('two admissible concurrent payments serialize their balances', async () => {
  const c=await client(); await sale(c,20);
  const r=await Promise.all([pay(c,5),pay(c,5,[],randomUUID(),'b')]);
  assert.ok(r.every(x=>x.success)); assert.equal(await debt(c),10);
  assert.equal((await balances(c))[0].assigned_payments_total,10);
  assert.deepEqual(r.map(x=>x.ledger_entry.allocation_payload[0].previous_sale_balance).sort((a,b)=>a-b),[15,20]);
});
await test('concurrent specific payments cannot overallocate one sale even with enough global debt', async () => {
  const c=await client(), id=await sale(c,20);await sale(c,20);
  const allocations=[{sale_id:id,amount_applied:15}];
  const outcomes=await Promise.allSettled([pay(c,15,allocations),pay(c,15,allocations,randomUUID(),'b')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/EXCEEDS_SALE/);
  assert.equal(await debt(c),25);
  assert.equal((await balances(c)).find(x=>x.id===id).current_balance_due,5);
});
await test('a projection failure rolls back ledger, idempotency, debt, sales and cash together', async () => {
  const c=await client(), id=await sale(c,20), before=await counts();
  await q(`create function public.fixture_fail_allocation() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_ALLOCATION_PROJECTION_FAILURE';end$$;
    create trigger fixture_fail_allocation before update on public.pos_sales for each row when (new.id=${lit(id)}) execute function public.fixture_fail_allocation()`);
  try {
    await assert.rejects(()=>pay(c,5),/SYNTHETIC_ALLOCATION_PROJECTION_FAILURE/);
    assert.deepEqual(await counts(),before);assert.equal(await debt(c),20);
    assert.equal((await balances(c))[0].current_balance_due,20);
  } finally {await q('drop trigger fixture_fail_allocation on public.pos_sales;drop function public.fixture_fail_allocation()');}
});
await test('invalid, foreign tenant/customer, cancelled and duplicate sale rejection is atomic', async () => {
  const c=await client(), s=await sale(c,20), other=await client(), foreign=await sale(other,20);
  const cancelled=await sale(c,20); assert.equal((await cancel(cancelled)).success,true);
  const otherTenant='allocation-other-tenant-'+randomUUID();
  await q(`insert into public.pos_customers(id,license_id,name) values (${lit(otherTenant)},'10000000-0000-0000-0000-000000000002','Synthetic');
    insert into public.pos_sales(id,license_id,customer_id,total,balance_due,source_mode,credit_effect_status) values ('tenant-sale-${otherTenant}','10000000-0000-0000-0000-000000000002',${lit(otherTenant)},20,20,'cloud_committed','applied')`);
  for(const id of ['missing-sale',foreign,cancelled,`tenant-sale-${otherTenant}`]) {
    const before=await counts();
    await assert.rejects(()=>pay(c,5,[{sale_id:id,amount_applied:5}]),/SALE_NOT_ELIGIBLE/);
    assert.deepEqual(await counts(),before);
  }
  for(const allocations of [
    [{sale_id:s,amount_applied:2},{sale_id:s,amount_applied:3}],
    [{sale_id:s,amount_applied:25}], [{sale_id:s,amount_applied:6}],
    [{sale_id:s,amount_applied:'NaN'}], [{sale_id:s,amount_applied:-1}],
    [{sale_id:s,amount_applied:0.001}]
  ]) { const before=await counts(); await assert.rejects(()=>pay(c,5,allocations),/ALLOCATION/); assert.deepEqual(await counts(),before); }
  for(const amount of ['NaN','Infinity',-1,0,0.001]) await assert.rejects(()=>pay(c,amount),/AMOUNT_INVALID/);
  assert.equal(await debt(c),20);
});
await test('an inconsistent sale ledger base cannot be presented or assigned as a live balance', async () => {
  const c=await client(), id=await sale(c,20);await sale(c,20);
  await q(`update public.pos_customer_ledger set deleted_at=now() where id=(select credit_ledger_charge_id from public.pos_sales where id=${lit(id)});
    select private.recalculate_pos_customer_debt('${tenant}',${lit(c)})`);
  const row=(await balances(c)).find(x=>x.id===id);
  assert.equal(row.current_balance_due,null);assert.equal(row.credit_allocation_status,'unreconciled_sale');
  const before=await counts();await assert.rejects(()=>pay(c,5,[{sale_id:id,amount_applied:5}]),/ALLOCATION_EXCEEDS_SALE/);
  assert.deepEqual(await counts(),before);assert.equal(await debt(c),20);
});
await test('non-finite stored debt cannot admit a financial payment', async () => {
  const c=await client(), id=await sale(c,20);
  await q(`update public.pos_customer_ledger set amount='NaN'::numeric where id=(select credit_ledger_charge_id from public.pos_sales where id=${lit(id)})`);
  const before=await counts();await assert.rejects(()=>pay(c,5),/CUSTOMER_DEBT_INVALID/);
  assert.deepEqual(await counts(),before);
});
await test('cancellation of an allocated sale rejects repeatedly without refund or debt change', async () => {
  const c=await client(), s=await sale(c,20); await pay(c,5); const before=await counts();
  for(let i=0;i<2;i++) assert.equal((await cancel(s)).code,'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS');
  assert.deepEqual(await counts(),before); assert.equal(await debt(c),15);
});
await test('ordinary cancellation with checkout deposit reverses exactly original effects once', async () => {
  const c=await client(), s=await sale(c,30,10); const key=randomUUID();
  const sql=`select public.pos_cancel_cloud_sale_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${lit(s)},'Synthetic cancellation',${lit(key)})`;
  assert.equal((await data(sql)).success,true); const before=await counts();
  await data(sql); assert.deepEqual(await counts(),before); assert.equal(await debt(c),0);
});
await test('payment versus cancellation has a safe serial outcome', async () => {
  for(let i=0;i<3;i++) {
    const c=await client(), s=await sale(c,20);
    const r=await Promise.allSettled([pay(c,5),cancel(s)]);
    assert.ok(r.every(x=>x.status==='fulfilled'),JSON.stringify(r));
    const [p,z]=r.map(x=>x.value);
    if(p.success) {assert.equal(z.success,false);assert.equal(await debt(c),15);}
    else {assert.equal(z.success,true);assert.equal(await debt(c),0);}
  }
});
await test('historical unallocated payment unchanged; new general payment stays explicitly unallocated', async () => {
  const c=await client(), s=await sale(c,20), id=randomUUID();
  await q(`insert into public.pos_customer_ledger(id,license_id,customer_id,type,amount,balance_after,debt_cents_after,allocation_payload,reference_type,metadata,actor_name)
    values (${lit(id)},'${tenant}',${lit(c)},'PAYMENT',-5,15,1500,'[]','customer','{}','Synthetic'); select private.recalculate_pos_customer_debt('${tenant}',${lit(c)})`);
  const old=await q(`select to_jsonb(l) from public.pos_customer_ledger l where id=${lit(id)}`);
  const r=await pay(c,2); assert.equal(r.sale_allocation_status,'historical_unallocated');
  assert.deepEqual(r.ledger_entry.allocation_payload,[]);assert.equal(await debt(c),13);
  assert.equal((await balances(c))[0].current_balance_due,null);
  await assert.rejects(()=>pay(c,1,[{sale_id:s,amount_applied:1}]),/UNRECONCILED/);
  assert.equal(await q(`select to_jsonb(l) from public.pos_customer_ledger l where id=${lit(id)}`),old);
});
await test('second device pulls updated live balance through existing sale events', async () => {
  const c=await client(), s=await sale(c,20);
  const cursor=Number(await q('select coalesce(max(change_seq),0) from public.pos_sync_events'));
  await pay(c,5);
  const r=await data(`select public.pos_pull_sales_changes('fixture-a','device-b','synthetic-device','owner-session-b',${cursor},500)`);
  const row=r.sales.find(x=>x.id===s); assert.equal(row.current_balance_due,15); assert.equal(row.balance_due,20);
  assert.ok(r.events.some(x=>x.entity_id===s && x.metadata.reason==='customer_payment_allocation'));
  assert.ok(r.latest_change_seq>cursor);
});
await test('public roles cannot bypass V2 through internal payment core', async () => {
  await assert.rejects(()=>raw("set role anon;select public.pos_record_customer_payment_unlimited('fixture-a','device-a','synthetic-device','owner-session-a','missing',5,'efectivo','cash-a','Synthetic','[]','synthetic-denied')"),/permission denied/);
});
await test('real V2 payment envelope delegates once, projects debt and preserves receipt on retry', async () => {
  const c=await client(), s=await sale(c,20), key=randomUUID();
  const sql=`select public.pos_record_customer_payment_v2('fixture-a','device-a','synthetic-device','owner-session-a',${lit(c)},5,'efectivo','cash-a','Synthetic V2','[]',${lit(key)},'${contract}'::jsonb)`;
  const r=JSON.parse(await raw(`set role anon;${sql}`));
  assert.equal(r.contract_version,2);assert.equal(r.family,'customer_credit');
  assert.equal(r.customer_id,c);assert.equal(r.payload.sale_allocation_version,1);
  assert.equal(r.payload.sales[0].current_balance_due,15);assert.equal(r.payload.sales[0].id,s);
  assert.equal(r.payload.new_debt,15);
  const before=await counts();const retry=JSON.parse(await raw(`set role anon;${sql}`));
  assert.deepEqual(retry.payload,r.payload);assert.deepEqual(await counts(),before);
  assert.equal(await raw('select count(*) from private.pos_fin01_admissions_v2'), '0');
});
await test('actual V2 summary and recovered legacy delegate provide live financial notes', async () => {
  const c=await client();await sale(c,20);await pay(c,5);
  const r=JSON.parse(await raw(`set role anon;select public.pos_get_customer_credit_summary_v2('fixture-a','device-a','synthetic-device','owner-session-a',${lit(c)},'${contract}'::jsonb)`));
  assert.equal(r.payload.pending_credit_sales[0].current_balance_due,15);
  assert.equal(r.payload.credit_sales[0].original_balance_due,20);
  assert.equal(r.payload.credit_sales[0].assigned_payments_total,5);
  assert.equal(r.payload.sale_balances_authoritative,true);
});

console.log(JSON.stringify({passed:results.filter(x=>x.status==='PASS').length, failed:results.filter(x=>x.status==='FAIL').length}));
process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
