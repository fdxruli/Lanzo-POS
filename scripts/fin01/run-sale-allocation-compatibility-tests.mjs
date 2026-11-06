import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { financialRequestHashV1 } from '../../src/services/financial/financialCanonicalV1.js';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

const database='fin01_cert_compatibility';
const raw=sql=>queryLoopbackPostgres(sql,database);
const lit=s=>`'${String(s).replaceAll("'","''")}'`;
const json=s=>`${lit(JSON.stringify(s))}::jsonb`;
const contract={contract_version:2,capabilities:['historical_credit_preservation_v1','customer_projection_safe_apply_v1','financial_operation_result_v1']};
const contexts=[
  {version:1,tenant:'10000000-0000-0000-0000-000000000002',license:'fixture-b',device:'device-c',token:'other-owner',cash:'cash-c'},
  {version:2,tenant:'10000000-0000-0000-0000-000000000001',license:'fixture-a',device:'device-a',token:'owner-session-a',cash:'cash-a'}
];
const auth=c=>[c.license,c.device,'synthetic-device',c.token].map(lit).join(',');
const fixture=(c,sql)=>c.version===1?raw(sql):raw(`begin;select private.pos_fin01_enter_pilot_v2(${json(contract)},${auth(c)});${sql};select private.pos_fin01_leave_pilot_v2('${c.tenant}');commit;`);
const call=async(c,name,args=[],v2=false)=>{
  const text=await raw(`set role anon;select public.${name}(${auth(c)}${args.length?','+args.join(','):''}${v2?','+json(contract):''})`);
  const r=JSON.parse(text);return v2?{...r.payload,envelope:r}:r;
};
const pay=(c,id,amount,allocations=[],key=randomUUID())=>call(c,c.version===2?'pos_record_customer_payment_v2':'pos_record_customer_payment',
  [lit(id),lit(amount)+'::numeric',lit('efectivo'),lit(c.cash),lit('Synthetic compatibility payment'),json(allocations),lit(key)],c.version===2);
const summary=(c,id)=>call(c,c.version===2?'pos_get_customer_credit_summary_v2':'pos_get_customer_credit_summary',[lit(id)],c.version===2);
const cancel=async(c,id,key=randomUUID())=>{
  const request={sale_id:id,reason:'Synthetic compatibility cancellation'};
  if(c.version===1) return call(c,'pos_cancel_cloud_sale',[lit(id),lit(request.reason),lit(key)]);
  const {requestHash}=await financialRequestHashV1({operationType:'sale.cancel',request,actorKey:'admin:30000000-0000-0000-0000-000000000001'});
  return call(c,'pos_execute_financial_operation_v2',[lit(key),lit(requestHash),lit('sale.cancel'),json(request)],true);
};
const customer=async c=>{
  const id='compat-customer-'+randomUUID();
  await fixture(c,`insert into public.pos_customers(id,license_id,name,credit_limit) values (${lit(id)},'${c.tenant}','Synthetic compatibility customer',1000)`);
  return id;
};
const sale=async(c,id,amount,soldAt='2026-01-01T00:00:00Z')=>{
  const saleId='compat-sale-'+randomUUID(),product='compat-product-'+randomUUID();
  await fixture(c,`insert into public.pos_products(id,license_id,name,name_key,price,cost,stock) values (${lit(product)},'${c.tenant}','Synthetic',${lit(product)},${amount},1,100)`);
  const s={id:saleId,total:amount,subtotal:amount,amount_paid:0,balance_due:amount,sold_at:soldAt,payment_method:'credit'};
  const items=[{product_id:product,quantity:1,unit_price:amount,line_total:amount,line_subtotal:amount}];
  const r=JSON.parse(await fixture(c,`select public.pos_create_cloud_sale_credit_unlimited(${auth(c)},${json(s)},${json(items)},'[]',${lit(c.cash)},${lit(id)},${lit(randomUUID())})`));
  assert.equal(r.success,true,JSON.stringify(r));return r.sale.id;
};
const state=(c,id)=>raw(`select jsonb_build_object('debt',(select debt from public.pos_customers where license_id='${c.tenant}' and id=${lit(id)}),
  'payments',(select count(*) from public.pos_customer_ledger where license_id='${c.tenant}' and customer_id=${lit(id)} and type='PAYMENT'),
  'cash',(select count(*) from public.pos_cash_movements where license_id='${c.tenant}' and metadata->>'customer_id'=${lit(id)}),
  'ledger',(select count(*) from public.pos_customer_ledger where license_id='${c.tenant}' and customer_id=${lit(id)}))`).then(JSON.parse);
const results=[];
const filter=process.argv.find(x=>x.startsWith('--only='))?.slice(7);
const report=process.argv.find(x=>x.startsWith('--report='))?.slice(9)||'compatibility-results';
assert.match(report,/^[a-z0-9-]+$/);
const test=async(c,name,body)=>{
  const label=`V${c.version} ${name}`;if(filter&&!new RegExp(filter).test(label))return;
  try {await body();results.push({protocol:`V${c.version}`,name,status:'PASS'});}
  catch(e) {results.push({protocol:`V${c.version}`,name,status:'FAIL',error:e.message});}
  console.log(results.at(-1).status,label);
  await fs.writeFile(`work/sql-compatibility/${report}.json`,JSON.stringify(results,null,2));
};
// A real V1 tenant remains protocol 1. It never receives an outer V2 witness.
await raw(`update public.licenses set features=features||'{"cloud_sales_cancellations":true}' where id in (${contexts.map(c=>lit(c.tenant)).join(',')});
 select private.resolve_cash_station_for_device('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',true);
 insert into public.pos_cash_sessions(id,license_id,device_id,actor_key,responsible_name,cash_station_id)
 values ('cash-c','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','admin:30000000-0000-0000-0000-000000000003','Synthetic V1','cash_station_device_20000000-0000-0000-0000-000000000003') on conflict do nothing;`);
for(const c of contexts) {
 await test(c,'general payment and actual legacy summary read',async()=>{
   const id=await customer(c),s=await sale(c,id,20),r=await pay(c,id,5);assert.equal(r.success,true);
   const read=await summary(c,id);assert.equal(read.debt,15);assert.equal(read.customer.debt,15);
   assert.equal(read.pending_credit_sales.length,1,'summary must return a financially backed pending note');
   const note=read.pending_credit_sales[0];assert.equal(note.id,s);assert.equal(note.current_balance_due,15);assert.equal(note.assigned_payments_total,5);
   assert.equal(note.total,20);assert.equal(note.amount_paid,0);assert.equal(note.balance_due,20);
   assert.equal(read.total_paid,5);assert.equal(read.total_charged,20);assert.ok(Array.isArray(read.ledger_entries));
   assert.equal(read.last_payment.amount,-5);
 });
 await test(c,'FIFO distributes across two sales',async()=>{
   const id=await customer(c),a=await sale(c,id,10),b=await sale(c,id,20,'2026-01-02');const r=await pay(c,id,15);
   assert.deepEqual(r.ledger_entry.allocation_payload.map(x=>[x.sale_id,x.amount_applied]),[[a,10],[b,5]]);
   const read=await summary(c,id);assert.equal(read.pending_credit_sales.length,1);assert.equal(read.pending_credit_sales[0].id,b);
   assert.equal(read.pending_credit_sales[0].current_balance_due,15);assert.equal(read.credit_sales.find(x=>x.id===a).current_balance_due,0);
 });
 await test(c,'specific payment preserves other notes and accepts existing camelCase fields',async()=>{
   const id=await customer(c),a=await sale(c,id,20),b=await sale(c,id,20);const r=await pay(c,id,5,[{saleId:b,amountApplied:5,previousSaleBalance:900,newSaleBalance:0}]);
   assert.equal(r.success,true);assert.equal(r.ledger_entry.allocation_payload[0].previous_sale_balance,20);
   const read=await summary(c,id);assert.equal(read.credit_sales.find(x=>x.id===a).current_balance_due,20);assert.equal(read.credit_sales.find(x=>x.id===b).current_balance_due,15);
 });
 await test(c,'legacy partial specific allocation preserves the unallocated remainder explicitly',async()=>{
   const id=await customer(c),s=await sale(c,id,20);const r=await pay(c,id,5,[{sale_id:s,amount_applied:3}]);
   assert.equal(r.success,true,'the previous public contract accepted allocations below the total');
   assert.equal(r.new_debt,15);assert.equal(r.unallocated_amount,2);assert.equal(r.ledger_entry.allocation_payload[0].amount_applied,3);
   const read=await summary(c,id);assert.equal(read.debt,15);assert.equal(read.pending_credit_sales.length,0);
   assert.equal(read.credit_sales[0].current_balance_due,null,'do not invent an assignment for the remainder');
 });
 await test(c,'retry keeps one payment and never replays a receipt as current debt',async()=>{
   const id=await customer(c);await sale(c,id,20);const key=randomUUID(),first=await pay(c,id,5,[],key);
   await pay(c,id,2);const before=await state(c,id),retry=await pay(c,id,5,[],key);
   assert.equal(retry.ledger_entry.id,first.ledger_entry.id);assert.equal(retry.new_debt,15);
   assert.deepEqual(await state(c,id),before);assert.equal((await summary(c,id)).debt,13);
 });
 await test(c,'unpaid sale cancellation is idempotent',async()=>{
   const id=await customer(c),s=await sale(c,id,20),key=randomUUID();assert.equal((await cancel(c,s,key)).success,true);
   const before=await state(c,id);await cancel(c,s,key);assert.deepEqual(await state(c,id),before);assert.equal(before.debt,0);
 });
 await test(c,'allocated sale cancellation safely rejects without refund',async()=>{
   const id=await customer(c),s=await sale(c,id,20);await pay(c,id,5);const before=await state(c,id);
   for(let i=0;i<2;i++) {
     if(c.version===1) assert.equal((await cancel(c,s)).code,'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS');
     else await assert.rejects(()=>cancel(c,s),/FINANCIAL_LEGACY_OPERATION_REJECTED:SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS/);
   }
   assert.deepEqual(await state(c,id),before);
 });
 await test(c,'historical debt without sales remains payable',async()=>{
   const id=await customer(c);await fixture(c,`update public.pos_customers set debt=20,debt_cents=2000 where id=${lit(id)}`);
   const r=await pay(c,id,5);assert.equal(r.success,true);assert.equal(r.new_debt,15);assert.equal(r.unallocated_amount,5);
   const read=await summary(c,id);assert.equal(read.debt,15);assert.deepEqual(read.pending_credit_sales,[]);
 });
 await test(c,'unverified historical assignments are preserved byte for byte',async()=>{
   const id=await customer(c),s=await sale(c,id,20),old='legacy-'+randomUUID();
   await fixture(c,`insert into public.pos_customer_ledger(id,license_id,customer_id,type,amount,balance_after,debt_cents_after,allocation_payload,actor_name)
    values (${lit(old)},'${c.tenant}',${lit(id)},'PAYMENT',-5,15,1500,${json([{sale_id:s,amount_applied:5}])},'Synthetic legacy');select private.recalculate_pos_customer_debt('${c.tenant}',${lit(id)})`);
   const before=await raw(`select to_jsonb(l) from public.pos_customer_ledger l where id=${lit(old)}`);
   const r=await pay(c,id,2);assert.equal(r.success,true);assert.deepEqual(r.ledger_entry.allocation_payload,[]);assert.equal(r.new_debt,13);
   await assert.rejects(()=>pay(c,id,1,[{sale_id:s,amount_applied:1}]),/UNRECONCILED/);
   const read=await summary(c,id);assert.equal(read.pending_credit_sales.length,0);assert.equal(read.credit_sales[0].current_balance_due,null);
   assert.equal(await raw(`select to_jsonb(l) from public.pos_customer_ledger l where id=${lit(old)}`),before);
 });
 await test(c,'concurrent specific payments cannot overallocate despite sufficient global debt',async()=>{
   const id=await customer(c),s=await sale(c,id,20);await sale(c,id,20);
   const r=await Promise.allSettled([pay(c,id,15,[{sale_id:s,amount_applied:15}]),pay(c,id,15,[{sale_id:s,amount_applied:15}])]);
   assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.match(r.find(x=>x.status==='rejected').reason.message,/EXCEEDS_SALE/);
   assert.equal((await summary(c,id)).debt,25);
 });
 await test(c,'concurrent retry with the same key creates one cash/ledger payment',async()=>{
   const id=await customer(c);await sale(c,id,20);const key=randomUUID();const r=await Promise.all([pay(c,id,5,[],key),pay(c,id,5,[],key)]);
   assert.equal(r[0].ledger_entry.id,r[1].ledger_entry.id);assert.equal((await state(c,id)).payments,1);assert.equal((await state(c,id)).cash,1);
 });
 await test(c,'invalid, cancelled, missing and other-tenant sale IDs reject atomically',async()=>{
   const id=await customer(c),s=await sale(c,id,20),other=await customer(c),foreign=await sale(c,other,20);
   const z=await sale(c,id,20);assert.equal((await cancel(c,z)).success,true);
   const cross=contexts.find(x=>x.version!==c.version),crossCustomer=await customer(cross),crossSale=await sale(cross,crossCustomer,20);
   for(const sale_id of ['missing',foreign,z,crossSale]) {const before=await state(c,id);await assert.rejects(()=>pay(c,id,5,[{sale_id,amount_applied:5}]),/SALE_NOT_ELIGIBLE/);assert.deepEqual(await state(c,id),before);}
   for(const allocations of [[{sale_id:s,amount_applied:3},{sale_id:s,amount_applied:2}], [{sale_id:s,amount_applied:-1}], [{sale_id:s,amount_applied:0}], [{sale_id:s,amount_applied:21}]]) await assert.rejects(()=>pay(c,id,5,allocations),/ALLOCATION/);
 });
 await test(c,'all original serializer fields retain exactly their previous meanings',async()=>{
   const id=await customer(c),s=await sale(c,id,20);await pay(c,id,5);
   const catalog=JSON.parse(await fs.readFile('docs/reports/customer-payment-sale-allocations-v1/compatibility/production-catalog.json','utf8'));
   const reference=catalog.find(x=>x.proname==='pos_sale_to_jsonb').definition
     .replace('private.pos_sale_to_jsonb(', 'pg_temp.original_sale_serializer(');
   const equal=await raw(reference+`;select (private.pos_sale_to_jsonb(s) - array['original_balance_due','assigned_payments_total','credit_allocation_status','current_balance_due']) = pg_temp.original_sale_serializer(s) from public.pos_sales s where id=${lit(s)}`);
   assert.equal(equal,'t');
 });
 await test(c,'an allocation projection error rolls back payment, cash, debt and idempotency',async()=>{
   const id=await customer(c),s=await sale(c,id,20),before=await state(c,id);
   await raw(`create function public.compat_fail_projection() returns trigger language plpgsql as $$begin raise exception 'COMPAT_PROJECTION_FAILURE';end$$;
     create trigger compat_fail_projection before update on public.pos_sales for each row when (new.id=${lit(s)}) execute function public.compat_fail_projection()`);
   try {await assert.rejects(()=>pay(c,id,5),/COMPAT_PROJECTION_FAILURE/);assert.deepEqual(await state(c,id),before);}
   finally {await raw('drop trigger compat_fail_projection on public.pos_sales;drop function public.compat_fail_projection()');}
 });
 await test(c,'partial allocation invalidates every affected note without assigning the remainder',async()=>{
   const id=await customer(c),a=await sale(c,id,20),b=await sale(c,id,20);
   const cursor=Number(await raw(`select coalesce(max(change_seq),0) from public.pos_sync_events where license_id='${c.tenant}'`));
   const r=await pay(c,id,5,[{sale_id:a,amount_applied:3}]);assert.equal(r.unallocated_amount,2);
   const read=await summary(c,id);assert.equal(read.credit_sales.length,2);assert.ok(read.credit_sales.every(s=>s.current_balance_due===null));
   const pull=await call(c,'pos_pull_sales_changes',[String(cursor),'500']);
   assert.ok(pull.sales.some(s=>s.id===a&&s.current_balance_due===null));
   assert.ok(pull.sales.some(s=>s.id===b&&s.current_balance_due===null));
 });
 await test(c,'invalid actor and foreign customer cannot create financial effects',async()=>{
   const id=await customer(c);await sale(c,id,20);const before=await state(c,id);
   await assert.rejects(()=>pay({...c,token:'invalid-session'},id,5),/ACTOR_SESSION_INVALID|ADMIN_SESSION_INVALID|STAFF_SESSION_INVALID/);
   const other=contexts.find(x=>x.version!==c.version),foreign=await customer(other);await sale(other,foreign,20);
   const targetBefore=await state(other,foreign);const r=await pay(c,foreign,5);assert.equal(r.success,false);assert.equal(r.code,'CUSTOMER_NOT_FOUND');
   assert.deepEqual(await state(other,foreign),targetBefore);assert.deepEqual(await state(c,id),before);
 });
 if(c.version===2) {
   await test(c,'second V2 device reads live notes, customer projection, events and cursors',async()=>{
     const id=await customer(c),s=await sale(c,id,20);
     const cursor=Number(await raw(`select coalesce(max(change_seq),0) from public.pos_sync_events where license_id='${c.tenant}'`));
     await pay(c,id,5);
     const peer={...c,device:'device-b',token:'owner-session-b',cash:'cash-b'};
     const read=await summary(peer,id);assert.equal(read.envelope.contract_version,2);assert.equal(read.envelope.family,'customer_credit');
     assert.equal(read.envelope.customer_id,id);assert.equal(read.credit_sales.find(x=>x.id===s).current_balance_due,15);
     const pull=await call(peer,'pos_pull_sales_changes',[String(cursor),'500']);
     assert.ok(pull.latest_change_seq>cursor);assert.ok(pull.sales.some(x=>x.id===s&&x.balance_due===20&&x.current_balance_due===15));
     const credit=await call(peer,'pos_pull_customer_credit_changes_v2',[String(cursor),'500'],true);
     assert.ok(credit.customers.some(x=>x.id===id&&x.debt===15));assert.ok(credit.ledger_entries.some(x=>x.customer_id===id&&x.type==='PAYMENT'&&x.allocation_payload[0].amount_applied===5));
     assert.ok(credit.envelope.cursor.change_seq>cursor);
     await fs.writeFile('work/sql-compatibility/second-device-pull.json',JSON.stringify({sales:pull,credit:credit.envelope,summary:read.envelope},null,2));
   });
   await test(c,'V2 protocol admission rejects invalid contracts and V1 mutation bypasses',async()=>{
     const id=await customer(c);await sale(c,id,20);const before=await state(c,id);
     await assert.rejects(()=>call(c,'pos_record_customer_payment_v2',[lit(id),'5',lit('efectivo'),lit(c.cash),lit('Synthetic'),"'[]'::jsonb",lit(randomUUID()),json({contract_version:1,capabilities:[]})]),/CLOUD_SYNC_CONTRACT_INVALID/);
     await assert.rejects(()=>pay({...c,version:1},id,5),/CLOUD_CLIENT_UPDATE_REQUIRED/);
     await assert.rejects(()=>raw(`set role anon;select public.pos_record_customer_payment_unlimited(${auth(c)},${lit(id)},5,'efectivo','cash-a','Synthetic','[]',${lit(randomUUID())})`),/permission denied/);
     assert.deepEqual(await state(c,id),before);
   });
   await test(c,'staff customers permission is checked before payment effects',async()=>{
     const id=await customer(c);await sale(c,id,20);const before=await state(c,id);
     const previous=await raw("select permissions from public.license_staff_users where id='50000000-0000-0000-0000-000000000001'");
     await raw("update public.license_staff_users set permissions=permissions||'{\"customers\":false}' where id='50000000-0000-0000-0000-000000000001'");
     try {await assert.rejects(()=>pay({...c,token:'staff-session'},id,5),/POS_PERMISSION_DENIED:customers/);assert.deepEqual(await state(c,id),before);}
     finally {await raw(`update public.license_staff_users set permissions=${lit(previous)}::jsonb where id='50000000-0000-0000-0000-000000000001'`);}
   });
 }

}
console.log(JSON.stringify({executed:results.length,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length}));
process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
