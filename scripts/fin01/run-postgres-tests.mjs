import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

// Deliberately fixed loopback endpoint and synthetic database. No remote URLs,
// credentials or environment-derived connection strings are accepted.
const out = 'docs/reports/fin01-r22/';
const tenant = '10000000-0000-0000-0000-000000000001';
const lit = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;
const results = [];
const filter = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const reportName = process.argv.find((arg) => arg.startsWith('--report='))?.slice(9) || 'postgres-tests';
if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error('FIXTURE_REPORT_NAME_INVALID');
const database = process.argv.find((arg) => arg.startsWith('--database='))?.slice(11) || 'fin01_cert_final';
const q = (sql) => queryLoopbackPostgres(sql, database);
const data = async (sql) => JSON.parse(await q(sql));
const test = async (area, name, body) => {
  if (filter && !new RegExp(filter).test(name)) return;
  try { await body(); results.push({area,name,status:'PASS'}); }
  catch (error) { results.push({area,name,status:'FAIL',error:error.message}); }
  await fs.writeFile(`${out}${reportName}.json`,JSON.stringify(results,null,2));
  process.stdout.write(`${results.at(-1).status} ${area}: ${name}\n`);
};
const client = async (debt=0,limit=1000) => {
  const id = `customer-${randomUUID()}`;
  await q(`insert into public.pos_customers(id,license_id,name,debt,debt_cents,credit_limit) values(${lit(id)},'${tenant}','Synthetic',${debt},${Math.round(debt*100)},${limit});
    ${debt>0 ? `insert into public.pos_customer_ledger(id,license_id,customer_id,type,amount,balance_after,debt_cents_after,actor_name) values(${lit(randomUUID())},'${tenant}',${lit(id)},'INITIAL_BALANCE',${debt},${debt},${Math.round(debt*100)},'Fixture');` : ''}`);
  return id;
};
const manifest = (entries, source=randomUUID()) => ({version:1,tenant_id:tenant,source_id:source,batch_id:randomUUID(),entries,
  customer_count:entries.length,total_cents:entries.reduce((sum,e)=>sum+e.amount_cents,0)});
const entry = (id,cents=125001) => ({customer_id:id,source_customer_id:id,amount_cents:cents});
const batchSql = (m,action,id=null,token='owner-session-a',device='device-a',confirm=false) =>
  `public.pos_historical_credit_batch_v1('fixture-a',${lit(device)},'synthetic-device',${lit(token)},${lit(action)},${json(m)},${lit(id)}::uuid,${confirm})`;
const batch = (m,action,id=null,token='owner-session-a',device='device-a',confirm=false) => data(`set role anon; select ${batchSql(m,action,id,token,device,confirm)};`);
const approve = (m,token='owner-session-a',device='device-a') => batch(m,'authorize',null,token,device,true);
const debt = (id) => q(`select debt_cents from public.pos_customers where license_id='${tenant}' and id=${lit(id)};`).then(Number);
const effects = () => data(`select jsonb_build_object('sales',(select count(*) from public.pos_sales),'payments',(select count(*) from public.pos_sale_payments),
  'ledger',(select count(*) from public.pos_customer_ledger),'cash',(select count(*) from public.pos_cash_movements),'inventory',(select count(*) from public.pos_inventory_movements),
  'receipts',(select count(*) from private.pos_historical_credit_receipts),'idempotency',(select count(*) from public.pos_idempotency_keys));`);
const product = async (price=150) => {
  const id=`product-${randomUUID()}`;
  await q(`insert into public.pos_products(id,license_id,name,name_key,price,cost,stock) values(${lit(id)},'${tenant}','Synthetic',${lit(id)},${price},1,100);`);
  return id;
};
const saleSql = (id,productId,total,{paid=0,payments=[],key=randomUUID(),device='device-a',token='owner-session-a',cash='cash-a',route='pos_create_cloud_sale_credit_unlimited'}={}) => {
  const saleId=`sale-${key}`;
  const sale={id:saleId,subtotal:total,total,discount_total:0,tax_total:0,amount_paid:paid,change_amount:payments.reduce((sum,p)=>sum+(p.change_amount||0),0),balance_due:total-paid,payment_method:paid?'mixed_credit':'credit'};
  const items=[{product_id:productId,quantity:1,unit_price:total,line_subtotal:total,line_total:total}];
  return `public.${route}('fixture-a',${lit(device)},'synthetic-device',${lit(token)},${json(sale)},${json(items)},${json(payments)},${lit(cash)},${lit(id)},${lit(key)})`;
};
const sale = (...a) => data(`select ${saleSql(...a)};`);
const payment = (id,amount,device='device-a',token='owner-session-a',cash='cash-a') => data(`select public.pos_record_customer_payment_unlimited('fixture-a',${lit(device)},'synthetic-device',${lit(token)},${lit(id)},${amount},'efectivo',${lit(cash)},'Synthetic test','[]',${lit(randomUUID())});`);
const publicPayment = (id,amount,key,device='device-a',token='owner-session-a',cash='cash-a') => data(`begin; select public.pos_record_customer_payment('fixture-a',${lit(device)},'synthetic-device',${lit(token)},${lit(id)},${amount},'efectivo',${lit(cash)},'PAY-N01 synthetic','[]',${lit(key)}); commit;`);
const rejects = async (fn, pattern) => { await assert.rejects(fn,pattern); };
assert.match(await q('show server_version;'),/^17\./);

await test('Authority','real owner context',async()=>assert.equal((await batch(null,'context')).tenant_id,tenant));
await test('Authority','Staff customers permission cannot authorize',async()=>assert.equal((await batch(null,'context',null,'staff-session')).code,'REJECTED_AUTHORITY'));
await test('Authority','non-owner Admin session is rejected',async()=>rejects(()=>batch(null,'context',null,'admin-session'),/ACTOR_SESSION_INVALID/));
await test('Authority','invalid session rejected',async()=>rejects(()=>batch(null,'context',null,'invalid'),/ACTOR_SESSION_INVALID/));
await test('Authority','revoked session rejected',async()=>{
  await q("update public.license_admin_sessions set revoked_at=now() where id='40000000-0000-0000-0000-000000000002';");
  try { await rejects(()=>batch(null,'context',null,'owner-session-b','device-b'),/ACTOR_SESSION_INVALID/); }
  finally { await q("update public.license_admin_sessions set revoked_at=null where id='40000000-0000-0000-0000-000000000002';"); }
});
await test('Authority','expired session rejected',async()=>{
  await q("update public.license_admin_sessions set expires_at=now()-interval '1 hour' where id='40000000-0000-0000-0000-000000000002';");
  try { await rejects(()=>batch(null,'context',null,'owner-session-b','device-b'),/ACTOR_SESSION_INVALID/); }
  finally { await q("update public.license_admin_sessions set revoked_at=null,expires_at=now()+interval '1 day' where id='40000000-0000-0000-0000-000000000002';"); }
});
await test('Authority','wrong tenant manifest rejected',async()=>{
  const m=manifest([entry(await client())]);m.tenant_id='10000000-0000-0000-0000-000000000002';
  await rejects(()=>approve(m),/HISTORICAL_MANIFEST_INVALID/);
});
await test('Authority','direct private tables denied to anon',async()=>rejects(()=>q('set role anon; select * from private.pos_historical_credit_authorizations;'),/permission denied/));
await test('Authority','direct private tables denied to authenticated',async()=>rejects(()=>q('set role authenticated; insert into private.pos_historical_credit_receipts default values;'),/permission denied/));
await test('Manifest','canonical hash independent of entry order and batch ID',async()=>{
  const m=manifest([entry(await client(),100),entry(await client(),200)]);
  assert.equal((await batch(m,'preview')).hash,(await batch({...m,batch_id:randomUUID(),entries:[...m.entries].reverse()},'preview')).hash);
});
for(const [name,mutate,pattern] of [
  ['wrong total',m=>m.total_cents++,/TOTAL_MISMATCH/],
  ['wrong count',m=>m.customer_count++,/TOTAL_MISMATCH/],
  ['fractional cents',m=>m.entries[0].amount_cents=1.1,/ENTRY_INVALID/],
  ['out of int32 range',m=>m.entries[0].amount_cents=2147483648,/ENTRY_INVALID/],
  ['duplicate destination',m=>{m.entries.push({...m.entries[0]});m.customer_count=2;m.total_cents*=2;},/DUPLICATE_CUSTOMER/],
  ['unknown bypass flag',m=>m.ignore_credit_limit=true,/MANIFEST_INVALID/]
]) await test('Manifest',name,async()=>{const m=manifest([entry(await client())]);mutate(m);await rejects(()=>approve(m),pattern);});
await test('Import','legacy financial import requires independent approval',async()=>{
  const id=await client(); const before=await effects();
  const response=await data(`select public.pos_migrate_local_customer_credit_unlimited('fixture-a','device-a','synthetic-device','owner-session-a','[]',${json([{customer_id:id,debt:123}])},'arbitrary');`);
  assert.equal(response.code,'PENDING_AUTHORIZATION');assert.deepEqual(await effects(),before);
});
let importedManifest, importedApproval;
await test('Import','owner approves and imports above limit without Caja or sales',async()=>{
  const id=await client(0,100);importedManifest=manifest([entry(id,125001)]);
  assert.equal((await batch(importedManifest,'preview')).results[0].over_limit,true);
  assert.equal((await batch(importedManifest,'authorize')).code,'PENDING_AUTHORIZATION');
  importedApproval=await approve(importedManifest);const before=await effects();
  const response=await batch(importedManifest,'consume',importedApproval.authorization_id);
  assert.equal(response.results[0].status,'IMPORTED');assert.equal(await debt(id),125001);
  const after=await effects();assert.equal(after.ledger,before.ledger+1);assert.equal(after.receipts,before.receipts+1);
  for(const key of ['sales','cash','inventory','payments'])assert.equal(after[key],before[key]);
});
await test('Import','lost response and replay return receipt without duplicates',async()=>{
  const before=await effects();const status=await batch(importedManifest,'status',null);
  assert.equal(status.state,'CONSUMED');assert.ok(status.results[0].ledger_id);
  assert.equal((await batch(importedManifest,'consume',importedApproval.authorization_id)).state,'CONSUMED');assert.deepEqual(await effects(),before);
});
await test('Import','same content different batch returns original authorization',async()=>{
  const response=await approve({...importedManifest,batch_id:randomUUID()});assert.equal(response.authorization_id,importedApproval.authorization_id);
});
await test('Import','same batch modified content conflicts',async()=>{
  const m=structuredClone(importedManifest);m.entries[0].amount_cents++;m.total_cents++;
  assert.equal((await approve(m)).code,'HISTORICAL_MANIFEST_CONFLICT');
  assert.equal((await batch(m,'consume',importedApproval.authorization_id)).code,'HISTORICAL_MANIFEST_CONFLICT');
});
await test('Import','same historical identity different amount conflicts',async()=>{
  const m=structuredClone(importedManifest);m.batch_id=randomUUID();m.entries[0].amount_cents++;m.total_cents++;
  const a=await approve(m);assert.equal((await batch(m,'consume',a.authorization_id)).results[0].status,'CONFLICT_DIFFERENT_BALANCE');
});
await test('Import','changing source cannot duplicate target balance',async()=>{
  const m={...importedManifest,batch_id:randomUUID(),source_id:randomUUID()};const a=await approve(m);const before=await effects();
  assert.equal((await batch(m,'consume',a.authorization_id)).results[0].status,'CONFLICT_EXISTING_CLOUD_LEDGER');assert.deepEqual(await effects(),before);
});
await test('Import','existing ledger never becomes silent success',async()=>{
  const m=manifest([entry(await client(75),7500)]);const a=await approve(m);
  assert.equal((await batch(m,'consume',a.authorization_id)).results[0].status,'CONFLICT_EXISTING_CLOUD_LEDGER');
});
await test('Import','partial batch reports exact imported and conflicted rows',async()=>{
  const first=await client(),second=await client(50);const m=manifest([entry(first,100),entry(second,200)]);const a=await approve(m);
  const response=await batch(m,'consume',a.authorization_id);assert.equal(response.state,'PARTIALLY_CONSUMED');assert.equal(response.success,false);
  assert.equal(response.imported,1);assert.equal(response.conflicts,1);assert.equal(await debt(first),100);assert.equal(await debt(second),5000);
});
await test('Import','expired approval requires a new explicit approval',async()=>{
  const m=manifest([entry(await client())]);const a=await approve(m);
  await q(`update private.pos_historical_credit_authorizations set expires_at=now()-interval '1 second' where id=${lit(a.authorization_id)};`);
  assert.equal((await batch(m,'consume',a.authorization_id)).code,'AUTHORIZATION_EXPIRED');
});
await test('Import','changed actor session invalidates pending approval',async()=>{
  const m=manifest([entry(await client())]);const a=await approve(m);
  assert.equal((await batch(m,'consume',a.authorization_id,'owner-session-b','device-b')).code,'AUTHORIZATION_SESSION_CHANGED');
});
await test('Import','two devices same target produce only one initial balance',async()=>{
  const id=await client(),m1=manifest([entry(id,100)]),m2=manifest([entry(id,100)]);
  const a1=await approve(m1),a2=await approve(m2,'owner-session-b','device-b');
  const responses=await Promise.all([batch(m1,'consume',a1.authorization_id),batch(m2,'consume',a2.authorization_id,'owner-session-b','device-b')]);
  assert.equal(responses.filter(r=>r.results[0].status==='IMPORTED').length,1);
  assert.equal(responses.filter(r=>r.results[0].status==='CONFLICT_EXISTING_CLOUD_LEDGER').length,1);assert.equal(await debt(id),100);
});
await test('Import','exception rolls back ledger, projection, receipts and consumption',async()=>{
  const id=await client();const m=manifest([entry(id)]);const a=await approve(m);const before=await effects();
  await q(`create function public.fixture_fail_import() returns trigger language plpgsql as $$ begin raise exception 'FIXTURE_PROJECTION_FAILURE'; end $$;
    create trigger fixture_fail_import before update on public.pos_customers for each row when (old.id=${lit(id)}) execute function public.fixture_fail_import();`);
  try{await rejects(()=>batch(m,'consume',a.authorization_id),/FIXTURE_PROJECTION_FAILURE/);assert.deepEqual(await effects(),before);assert.equal(await debt(id),0);
    assert.equal((await batch(m,'status',a.authorization_id)).state,'PENDING');}
  finally{await q('drop trigger fixture_fail_import on public.pos_customers; drop function public.fixture_fail_import();');}
});
await test('Upsert','older client with positive or malformed balances fails before overwrite',async()=>{
  const id=`upsert-${randomUUID()}`;const before=await effects();
  await rejects(()=>q(`select public.pos_upsert_customer_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${json({id,name:'Synthetic',debt:'malformed',debt_cents:999999999999999,credit_limit:100})},null,${lit(randomUUID())});`),/HISTORICAL_DEBT_PRESERVATION_REQUIRED/);
  assert.deepEqual(await effects(),before);
  assert.equal(Number(await q(`select count(*) from public.pos_customers where id=${lit(id)};`)),0);
});
await test('Upsert','ordinary directory create starts with zero debt',async()=>{
  const id=`upsert-${randomUUID()}`;const response=await data(`select public.pos_upsert_customer_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${json({id,name:'Synthetic',credit_limit:100})},null,${lit(randomUUID())});`);
  assert.equal(response.success,true);assert.equal(await debt(id),0);
});
await test('Upsert','directory edit and lower limit preserve debt',async()=>{
  const id=await client(1050);await q(`select public.pos_upsert_customer_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${json({id,name:'Synthetic edited',debt:0,credit_limit:500})},null,${lit(randomUUID())});`);
  assert.equal(await debt(id),105000);
});
await test('Upsert','Staff cannot change credit authority',async()=>{
  const id=await client();await rejects(()=>q(`select public.pos_upsert_customer_unlimited('fixture-a','device-a','synthetic-device','staff-session',${json({id,name:'Synthetic',credit_limit:2000})},null,${lit(randomUUID())});`),/CUSTOMER_CREDIT_LIMIT_AUTHORITY_REQUIRED/);
});
for(const [name,before,limit,amount,allowed] of [
  ['A inside limit',800,1000,150,true],['B exact equality',800,1000,200,true],['C one cent over',800,1000,200.01,false],
  ['D already above',1050,1000,0.01,false],['F zero limit',0,0,0.01,false],['one cent below',800,1000,199.99,true]
]) await test('Credit',name,async()=>{
  const id=await client(before,limit),pid=await product(amount),initial=await effects();
  if(allowed){assert.equal((await sale(id,pid,amount)).success,true);assert.equal(await debt(id),Math.round((before+amount)*100));}
  else{await rejects(()=>sale(id,pid,amount),/CREDIT_LIMIT_EXCEEDED/);assert.deepEqual(await effects(),initial);assert.equal(await debt(id),Math.round(before*100));}
});
await test('Credit','H completed replay survives lower limit',async()=>{
  const id=await client(800),pid=await product(150),key=randomUUID();const first=await sale(id,pid,150,{key});
  await q(`update public.pos_customers set credit_limit=0 where id=${lit(id)};`);const before=await effects();
  const replay=await sale(id,pid,150,{key});assert.deepEqual(replay,first);assert.deepEqual(await effects(),before);
});
await test('Credit','I changed request with same key conflicts in real authorizer',async()=>{
  const id=await client(),pid=await product(150),key=randomUUID();await sale(id,pid,150,{key});const before=await effects();
  // Different customer changes the canonical request hash while the sale key stays fixed.
  const other=await client();await rejects(()=>sale(other,pid,150,{key}),/IDEMPOTENCY/);
  assert.deepEqual(await effects(),before);
});
await test('Credit','J partial payment creates only net exposure',async()=>{
  const id=await client(700,900),pid=await product(300);const r=await sale(id,pid,300,{paid:200,payments:[{method:'card',amount:200,received_amount:200,change_amount:0}]});
  assert.equal(r.success,true);assert.equal(await debt(id),80000);
});
await test('Credit','K cash received and change are not extra applied payments',async()=>{
  const id=await client(700,800),pid=await product(300);const r=await sale(id,pid,300,{paid:250,payments:[{method:'cash',amount:250,received_amount:300,change_amount:50}]});
  assert.equal(r.success,true);assert.equal(await debt(id),75000);
});
await test('Concurrency','G two real sessions admit one 150 credit and end at 950',async()=>{
  const id=await client(800),p1=await product(150),p2=await product(150);
  const attempts=await Promise.allSettled([sale(id,p1,150),sale(id,p2,150,{device:'device-b',token:'owner-session-b',cash:'cash-b'})]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled'&&r.value.success).length,1);
  assert.equal(attempts.filter(r=>r.status==='rejected'&&/CREDIT_LIMIT_EXCEEDED/.test(r.reason.message)).length,1);assert.equal(await debt(id),95000);
});
await test('Credit','legacy public wrapper reaches the same SQL guard',async()=>{
  const id=await client(800),pid=await product(300);await rejects(()=>sale(id,pid,300,{route:'pos_create_cloud_sale_credit'}),/CREDIT_LIMIT_EXCEEDED/);
});
await test('Credit','N other tenant customer is inaccessible',async()=>{
  const id=`other-${randomUUID()}`;await q(`insert into public.pos_customers(id,license_id,name,credit_limit) values(${lit(id)},'10000000-0000-0000-0000-000000000002','Other fixture',1000);`);
  const pid=await product(150);await rejects(()=>sale(id,pid,150),/CUSTOMER_NOT_FOUND/);
});
await test('Credit','S closed Caja rejects with zero partial effects',async()=>{
  const id=await client(),pid=await product(150),before=await effects();await q("update public.pos_cash_sessions set status='closed' where id='cash-a';");
  try{await rejects(()=>sale(id,pid,150),/CASH_SESSION_NOT_OPEN/);assert.deepEqual(await effects(),before);}
  finally{await q("update public.pos_cash_sessions set status='open' where id='cash-a';");}
});
await test('Credit','E payment remains allowed above the credit limit',async()=>{
  const id=await client(1050),before=await effects();assert.equal((await payment(id,50)).success,true);
  assert.equal(await debt(id),100000);assert.equal((await effects()).cash,before.cash+1);
});
const payN01Evidence={};
await test('Payment','PAY-N01 overpayment with positive debt and empty ledger has no partial effects',async()=>{
  const id=await client();
  const key=`pay-n01-${randomUUID()}`;
  await q(`update public.pos_customers set debt=100,debt_cents=10000 where license_id='${tenant}' and id=${lit(id)};`);
  const snapshot=()=>data(`select jsonb_build_object(
    'customer',(select jsonb_build_object('debt',debt,'debt_cents',debt_cents) from public.pos_customers where license_id='${tenant}' and id=${lit(id)}),
    'ledger',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)}),
    'initial_balance',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)} and type='INITIAL_BALANCE'),
    'payment',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)} and type='PAYMENT'),
    'events',(select count(*) from public.pos_sync_events e where e.license_id='${tenant}' and (e.entity_id=${lit(id)} or e.metadata->>'customer_id'=${lit(id)})),
    'cash',(select count(*) from public.pos_cash_movements where license_id='${tenant}' and idempotency_key=${lit(key)}),
    'cash_status',(select status from public.pos_cash_sessions where license_id='${tenant}' and id='cash-a'),
    'historical_receipts',(select count(*) from private.pos_historical_credit_receipts where license_id='${tenant}' and customer_id=${lit(id)}),
    'idempotency',(select jsonb_build_object('status',status,'response_payload',response_payload) from public.pos_idempotency_keys where license_id='${tenant}' and idempotency_key=${lit(key)})
  );`);
  assert.equal((await q(`select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)};`)).trim(),'0');
  payN01Evidence.customer_id=id;payN01Evidence.idempotency_key=key;
  payN01Evidence.before=await snapshot();
  assert.equal(payN01Evidence.before.customer.debt_cents,10000);
  assert.equal(payN01Evidence.before.ledger,0);
  assert.equal(payN01Evidence.before.initial_balance,0);
  assert.equal(payN01Evidence.before.payment,0);
  assert.equal(payN01Evidence.before.events,0);
  assert.equal(payN01Evidence.before.cash,0);
  assert.equal(payN01Evidence.before.historical_receipts,0);
  assert.equal(payN01Evidence.before.idempotency,null);
  assert.equal(payN01Evidence.before.cash_status,'open');
  let response;
  try{
    response=await publicPayment(id,125,key);
    payN01Evidence.transaction='COMMIT_SUCCEEDED';
    payN01Evidence.sqlstate=null;
  }catch(error){
    payN01Evidence.transaction='ROLLBACK_ON_SQL_ERROR_AND_CONNECTION_CLOSE';
    payN01Evidence.sqlstate=error.code??null;
    payN01Evidence.sql_error=error.message;
    throw error;
  }
  payN01Evidence.response=response;
  payN01Evidence.after=await snapshot();
  payN01Evidence.retry_response=await publicPayment(id,125,key);
  payN01Evidence.after_retry=await snapshot();
  assert.equal(response.success,false);
  assert.equal(response.code,'PAYMENT_EXCEEDS_DEBT');
  assert.deepEqual(payN01Evidence.retry_response,response);
  assert.deepEqual(payN01Evidence.after.customer,payN01Evidence.before.customer);
  assert.equal(payN01Evidence.after.ledger,0);
  assert.equal(payN01Evidence.after.initial_balance,0);
  assert.equal(payN01Evidence.after.payment,0);
  assert.equal(payN01Evidence.after.events,0);
  assert.equal(payN01Evidence.after.cash,0);
  assert.equal(payN01Evidence.after.historical_receipts,0);
  assert.equal(payN01Evidence.after.cash_status,'open');
  assert.equal(payN01Evidence.after.idempotency.status,'completed');
  assert.deepEqual(payN01Evidence.after.idempotency.response_payload,response);
  assert.deepEqual(payN01Evidence.after_retry,payN01Evidence.after);
  await q(`delete from public.pos_idempotency_keys where license_id='${tenant}' and idempotency_key=${lit(key)};
    delete from public.pos_customers where license_id='${tenant}' and id=${lit(id)};`);
  assert.equal((await q(`select count(*) from public.pos_customers where license_id='${tenant}' and id=${lit(id)};`)).trim(),'0');
  payN01Evidence.synthetic_fixture_cleanup=true;
});
if(results.at(-1)?.name?.startsWith('PAY-N01')){
  results.at(-1).evidence=payN01Evidence;
  await fs.writeFile(`${out}${reportName}.json`,JSON.stringify(results,null,2));
}
const payN02Evidence={};
await test('Payment','PAY-N02 valid public payment replay creates no duplicate effects',async()=>{
  const id=await client();
  const key=`pay-n02-${randomUUID()}`;
  await q(`update public.pos_customers set debt=100,debt_cents=10000 where license_id='${tenant}' and id=${lit(id)};`);
  const snapshot=()=>data(`select jsonb_build_object(
    'customer',(select jsonb_build_object('debt',debt,'debt_cents',debt_cents) from public.pos_customers where license_id='${tenant}' and id=${lit(id)}),
    'ledger',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)}),
    'initial_balance',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)} and type='INITIAL_BALANCE'),
    'payment',(select count(*) from public.pos_customer_ledger where license_id='${tenant}' and customer_id=${lit(id)} and type='PAYMENT'),
    'events',(select count(*) from public.pos_sync_events e where e.license_id='${tenant}' and (e.entity_id=${lit(id)} or e.metadata->>'customer_id'=${lit(id)})),
    'cash',(select count(*) from public.pos_cash_movements where license_id='${tenant}' and idempotency_key=${lit(key)}),
    'cash_status',(select status from public.pos_cash_sessions where license_id='${tenant}' and id='cash-a'),
    'historical_receipts',(select count(*) from private.pos_historical_credit_receipts where license_id='${tenant}' and customer_id=${lit(id)}),
    'idempotency',(select jsonb_build_object('status',status,'response_payload',response_payload) from public.pos_idempotency_keys where license_id='${tenant}' and idempotency_key=${lit(key)})
  );`);
  payN02Evidence.customer_id=id;payN02Evidence.idempotency_key=key;
  payN02Evidence.before=await snapshot();
  payN02Evidence.first_response=await publicPayment(id,25,key);
  payN02Evidence.after=await snapshot();
  payN02Evidence.retry_response=await publicPayment(id,25,key);
  payN02Evidence.after_retry=await snapshot();
  assert.equal(payN02Evidence.first_response.success,true);
  assert.equal(payN02Evidence.before.customer.debt_cents,10000);
  assert.equal(payN02Evidence.before.ledger,0);
  assert.equal(payN02Evidence.after.customer.debt_cents,7500);
  assert.equal(payN02Evidence.after.initial_balance,1);
  assert.equal(payN02Evidence.after.payment,1);
  assert.equal(payN02Evidence.after.cash,1);
  assert.equal(payN02Evidence.after.idempotency.status,'completed');
  assert.deepEqual(payN02Evidence.retry_response,payN02Evidence.first_response);
  assert.deepEqual(payN02Evidence.after_retry,payN02Evidence.after);
});
if(results.at(-1)?.name?.startsWith('PAY-N02')){
  results.at(-1).evidence=payN02Evidence;
  await fs.writeFile(`${out}${reportName}.json`,JSON.stringify(results,null,2));
}
await test('Concurrency','payment and sale from two real sessions serialize without losing either',async()=>{
  const id=await client(800),pid=await product(200);
  const r=await Promise.all([payment(id,50),sale(id,pid,200,{device:'device-b',token:'owner-session-b',cash:'cash-b'})]);
  assert.ok(r.every(x=>x.success));assert.equal(await debt(id),95000);
});
await test('Concurrency','limit update and sale observe an allowed serial ordering',async()=>{
  const id=await client(800),pid=await product(150);
  const r=await Promise.allSettled([q(`begin;update public.pos_customers set credit_limit=850 where id=${lit(id)};select pg_sleep(0.3);commit;`),sale(id,pid,150)]);
  assert.equal(r[0].status,'fulfilled');const finalDebt=await debt(id);
  if(r[1].status==='fulfilled'){assert.equal(r[1].value.success,true);assert.equal(finalDebt,95000);}
  else{assert.match(r[1].reason.message,/CREDIT_LIMIT_EXCEEDED/);assert.equal(finalDebt,80000);}
});
await test('Concurrency','import and new credit never sum historical debt onto an existing ledger',async()=>{
  const id=await client(),pid=await product(150),m=manifest([entry(id,125000)]),a=await approve(m);
  const r=await Promise.allSettled([batch(m,'consume',a.authorization_id),sale(id,pid,150,{device:'device-b',token:'owner-session-b',cash:'cash-b'})]);
  const finalDebt=await debt(id);assert.ok([125000,15000].includes(finalDebt));
  if(finalDebt===125000){assert.equal(r[0].value.results[0].status,'IMPORTED');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/CREDIT_LIMIT_EXCEEDED/);}
  else{assert.equal(r[0].value.results[0].status,'CONFLICT_EXISTING_CLOUD_LEDGER');assert.equal(r[1].value.success,true);}
});
await test('Atomicity','two real credit children sharing a customer roll back together',async()=>{
  const id=await client(800),pid=await product(150),before=await effects();
  await rejects(()=>q(`begin;select ${saleSql(id,pid,150)};select ${saleSql(id,pid,150)};commit;`),/CREDIT_LIMIT_EXCEEDED/);
  assert.deepEqual(await effects(),before);assert.equal(await debt(id),80000);
});
await test('Concurrency','inverse ambient Caja and customer locks abort one transaction without partial effects',async()=>{
  const id=await client(800),pid=await product(150),before=await effects(),keyA=randomUUID(),keyB=randomUUID();
  const attempts=await Promise.allSettled([
    q(`begin;set local deadlock_timeout='100ms';select id from public.pos_cash_sessions where id='cash-a' for update;select pg_sleep(0.3);select ${saleSql(id,pid,150,{key:keyA})};commit;`),
    q(`begin;set local deadlock_timeout='100ms';select id from public.pos_customers where id=${lit(id)} for update;select pg_sleep(0.1);select id from public.pos_cash_sessions where id='cash-a' for update;select ${saleSql(id,pid,150,{key:keyB,device:'device-b',token:'owner-session-b',cash:'cash-b'})};commit;`)
  ]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const loser=attempts.findIndex(r=>r.status==='rejected');assert.match(attempts[loser].reason.message,/deadlock detected/);
  assert.equal(await debt(id),95000);const after=await effects();assert.equal(after.sales,before.sales+1);assert.equal(after.ledger,before.ledger+1);
  await rejects(()=>sale(id,pid,150,loser===0?{key:keyA}:{key:keyB,device:'device-b',token:'owner-session-b',cash:'cash-b'}),/CREDIT_LIMIT_EXCEEDED/);
  assert.deepEqual(await effects(),after);
});
await test('Inventory','admitted credit writes real stock and ledger atomically',async()=>{
  const id=await client(),pid=await product(150);await q(`update public.licenses set features=features||'{"cloud_sales_inventory":true}' where id='${tenant}';`);
  try{assert.equal((await sale(id,pid,150)).success,true);assert.equal(Number(await q(`select stock from public.pos_products where id=${lit(pid)};`)),99);assert.equal(await debt(id),15000);}
  finally{await q(`update public.licenses set features=features||'{"cloud_sales_inventory":false}' where id='${tenant}';`);}
});
await test('Atomicity','Q fault after inventory work rolls back sales, stock, ledger and Caja',async()=>{
  const id=await client(),pid=await product(150),before=await effects();
  await q(`update public.licenses set features=features||'{"cloud_sales_inventory":true}' where id='${tenant}';
    create function public.fixture_fail_charge() returns trigger language plpgsql as $$ begin raise exception 'FIXTURE_CHARGE_FAILURE'; end $$;
    create trigger fixture_fail_charge before insert on public.pos_customer_ledger for each row when (new.customer_id=${lit(id)} and new.type='CHARGE') execute function public.fixture_fail_charge();`);
  try{await rejects(()=>sale(id,pid,150),/FIXTURE_CHARGE_FAILURE/);assert.deepEqual(await effects(),before);assert.equal(Number(await q(`select stock from public.pos_products where id=${lit(pid)};`)),100);}
  finally{await q(`drop trigger fixture_fail_charge on public.pos_customer_ledger;drop function public.fixture_fail_charge();update public.licenses set features=features||'{"cloud_sales_inventory":false}' where id='${tenant}';`);}
});
await test('Credit','P authorized cancellation restores prior debt even after reducing the limit',async()=>{
  const id=await client(800),pid=await product(150),key=randomUUID();const original=await sale(id,pid,150,{key});
  await q(`update public.licenses set features=features||'{"cloud_sales_cancellations":true}' where id='${tenant}';update public.pos_customers set credit_limit=0 where id=${lit(id)};`);
  const response=await data(`select public.pos_cancel_cloud_sale_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${lit(original.sale.id)},'Synthetic cancellation',${lit(randomUUID())});`);
  assert.equal(response.success,true);assert.equal(await debt(id),80000);
});
await test('Credit','non-finite stored limit cannot bypass enforcement',async()=>{
  const id=await client(),pid=await product(150);await q(`update public.pos_customers set credit_limit='NaN'::numeric where id=${lit(id)};`);
  const before=await effects();await rejects(()=>sale(id,pid,150),/CUSTOMER_CREDIT_LIMIT_INVALID/);assert.deepEqual(await effects(),before);
});
await test('Upsert','non-finite credit limit is rejected',async()=>{
  const id=await client();await rejects(()=>q(`select public.pos_upsert_customer_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',${json({id,name:'Synthetic',credit_limit:'NaN'})},null,${lit(randomUUID())});`),/CUSTOMER_CREDIT_LIMIT_INVALID/);
});
await test('Authority','internal financial import remains inaccessible to anon',async()=>{
  await rejects(()=>q("set role anon;select public.pos_migrate_local_customer_credit_unlimited('fixture-a','device-a','synthetic-device','owner-session-a','[]','[]',null);"),/permission denied/);
});
await test('Import','explicit owner review can retry after a missing directory customer is synchronized',async()=>{
  const id=`missing-${randomUUID()}`,m=manifest([entry(id,10000)]),a=await approve(m);
  assert.equal((await batch(m,'consume',a.authorization_id)).state,'CONFLICT');
  await q(`insert into public.pos_customers(id,license_id,name,credit_limit) values(${lit(id)},'${tenant}','Synthetic recovered',0);`);
  assert.equal((await approve(m)).state,'PENDING');
  assert.equal((await batch(m,'consume',a.authorization_id)).results[0].status,'IMPORTED');
  assert.equal(await debt(id),10000);
  assert.equal(Number(await q(`select jsonb_array_length(approvals) from private.pos_historical_credit_authorizations where id=${lit(a.authorization_id)}::uuid;`)),2);
});
await test('Integrity','ledger and debt projections remain equal',async()=>{
  assert.equal(Number(await q(`select count(*) from public.pos_customers c where c.license_id='${tenant}' and c.debt_cents <> coalesce((select round(sum(l.amount)*100) from public.pos_customer_ledger l where l.license_id=c.license_id and l.customer_id=c.id and l.deleted_at is null),0);`)),0);
});
const summary={executed:results.length,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length};
console.log(JSON.stringify(summary));
process.exitCode=summary.fail?1:0;
