import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

assert.ok(process.argv.includes('--isolated-fixture'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN);
assert.equal(process.env.PGDATABASE, 'lanzo_admin_supervision_fixture', 'Dedicated empty fixture database required');
const args = ['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'];
const sql = (query) => {
  writeFileSync('.tmp-admin-supervision-query.sql', query);
  const result = spawnSync(process.env.PSQL_BIN, [...args,'-f','.tmp-admin-supervision-query.sql'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
};
assert.equal(sql("select count(*) from information_schema.tables where table_schema in ('public','private')"),'0');
for (const file of ['supabase/tests/fixtures/restaurant_origin_cancel_3d13_setup.sql',
  'supabase/tests/fixtures/restaurant_admin_supervision_context.sql',
  'supabase/migrations/20261010013258_restaurant_admin_supervision_r1.sql']) sql(readFileSync(file,'utf8'));

// The dispatcher, cancellation, ownership/capability and upsert functions above
// are the actual migration. Financial leaves below are controlled fixture effects.
sql(`drop function public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text);
create function public.pos_close_restaurant_order_after_checkout_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_local_order_id text,p_paid_sale_id text,p_paid_sale_folio text,p_paid_total numeric,p_payment_summary jsonb,p_idempotency_key text)
  returns jsonb language plpgsql as $$ begin
  perform private.assert_restaurant_settlement_permit_v1(private.validate_pos_sync_context($1,$2,$3,$4),$5);
  update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id=$6,updated_at=now() where local_order_id=$5;
  return jsonb_build_object('success',true,'found',true,'order',jsonb_build_object('status','delivered','fulfillment_status','delivered')); end $$;
create or replace function private.execute_split_sale_financial_v1(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_split jsonb,p_internal_idempotency_key text)
returns jsonb language plpgsql as $$ declare v public.pos_restaurant_orders; c jsonb; begin
c:=private.validate_pos_sync_context($1,$2,$3,$4); v:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,$5->>'parent_order_id');
perform private.assert_restaurant_table_actor_v1(c,v,'split'); perform private.assert_restaurant_settlement_permit_v1(c,v.local_order_id);
insert into public.pos_sales values('split-'||v.local_order_id,v.local_order_id,50);
update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id='split-'||v.local_order_id,updated_at=now() where id=v.id;
return jsonb_build_object('success',true); end $$;`);

const license = '00000000-0000-0000-0000-000000000001';
const owner = '00000000-0000-0000-0000-0000000000aa';
const version = '2026-10-01T00:00:00Z';
const seed = (id, staff = owner) => sql(`insert into public.pos_restaurant_orders(id,license_id,local_order_id,sale_id,created_by_device_id,created_by_staff_user_id,updated_at,payment_status,total)
values('${id}','${license}','${id}','${id}','00000000-0000-0000-0000-00000000000a',${staff ? `'${staff}'` : 'null'},'${version}','unpaid',50)`);
const caps = (id, actor='staff-a',device='A') => JSON.parse(sql(`select public.pos_restaurant_table_capabilities_v1('fixture-license','${device}','valid','${actor}','${id}')`));
const call = (operation,id,actor='admin',device='B',suffix='attempt') => {
  if(operation==='cancel') return `select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','${device}','valid','${actor}','${id}','${version}','QA reason','${id}-${suffix}')`;
  const payload = operation==='split' ? { cash_session_id:'cash-a',parent_order_id:id,parent_order_version:version }
    : {cash_session_id:'cash-a',sale:{id,total:50},items:[],payments:[],restaurant_settlement:{parent_order_id:id,parent_order_version:version}};
  return `select public.pos_execute_financial_operation_v1('fixture-license','${device}','valid','${actor}','${id}-${suffix}','fixture-hash','sale.${operation}','${JSON.stringify(payload)}')`;
};
const rejected = (query,code) => {
  const result=spawnSync(process.env.PSQL_BIN,[...args,'-c',query],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0); assert.match(result.stderr,new RegExp(code));
};
const results=[];
seed('owner');
assert.equal(caps('owner').capabilities.canEditTable,true);
assert.equal(caps('owner','staff-b').capabilities.canViewTable,true);
for(const key of ['canEditTable','canCheckoutTable','canSplitTable','canCancelTable']) assert.equal(caps('owner','staff-b').capabilities[key],false);
assert.equal(caps('owner','staff-a','B').capabilities.canCheckoutTable,true);
assert.equal(caps('owner','staff-a','B').capabilities.canEditTable,false);
assert.equal(caps('owner','admin','B').capabilities.canCancelTable,true);
assert.equal(caps('owner','admin','B').capabilities.canEditTable,false);
seed('legacy',null); assert.equal(caps('legacy').capabilities.canCheckoutTable,false);
for(const operation of ['cashier','cashier_inventory','credit','split','cancel']) rejected(call(operation,'owner','staff-b','A',operation),'RESTAURANT_TABLE_OWNER_REQUIRED');
rejected(call('cashier','owner','expired'),'ACTOR_SESSION_INVALID');
rejected(call('cashier','owner','no-pos','A'),'POS_PERMISSION_DENIED');
rejected(call('cancel','owner','no-refunds','A'),'POS_PERMISSION_DENIED');
rejected(call('cashier','owner').replace('fixture-license','fixture-other'),'RESTAURANT_ORDER_NOT_FOUND');
rejected(call('cashier','owner').replace(version,'2026-09-01T00:00:00Z'),'RESTAURANT_ORDER_VERSION_CONFLICT');
rejected("select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','A','valid','staff-b','{\"id\":\"owner\"}','[]','[]','cash-a',null,'direct')",'RESTAURANT_TABLE_OWNER_REQUIRED');
rejected("select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','B','valid','admin','{\"id\":\"owner\"}','[]','[]','cash-a',null,'direct-admin')",'RESTAURANT_SETTLEMENT_CONTRACT_REQUIRED');
assert.equal(sql('select count(*) from public.pos_sales'),'0');
const edit = (actor,device='A',expected=version,extra={}) => `select public.pos_upsert_restaurant_order_unlimited('fixture-license','${device}','valid','${actor}',
  '${JSON.stringify({localOrderId:'owner',saleId:'owner',expectedParentVersion:expected,total:50,subtotal:50,...extra})}',
  '[{"localLineId":"line-owner","productId":"pizza","productName":"Pizza","quantity":1,"unitPrice":50,"lineTotal":50}]','edit-${actor}-${device}-${expected}')`;
rejected(edit('staff-b','A',version,{createdByStaffUserId:owner}),'RESTAURANT_TABLE_OWNER_REQUIRED');
rejected(edit('admin','B',version,{createdByDeviceId:'00000000-0000-0000-0000-00000000000b'}),'ADMIN_REMOTE_EDIT_BLOCKED');
rejected(edit('staff-a','A','2026-09-01T00:00:00Z'),'RESTAURANT_ORDER_VERSION_CONFLICT');
sql(edit('staff-a'));
assert.equal(sql("select created_by_staff_user_id from public.pos_restaurant_orders where id='owner'"),owner);
for(const [operation,actor,device] of [['cashier','staff-a','A'],['cashier','admin','B'],['split','admin','B'],['cancel','admin','B']]) {
  const id=`authorized-${operation}-${actor}`; seed(id); sql(call(operation,id,actor,device));
  assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='${id}'`),'1');
  assert.equal(sql(`select created_by_staff_user_id from public.pos_restaurant_orders where id='${id}'`),owner);
  if(operation==='cancel') sql(call(operation,id,actor,device));
  else rejected(call(operation,id,actor,device,'second'),'RESTAURANT_ORDER_NOT_ACTIVE|RESTAURANT_ORDER_ALREADY_PAID');
}
const run = (query,name) => new Promise(resolve=>{
  const child=spawn(process.env.PSQL_BIN,[...args,'-c',query],{env:{...process.env,PGAPPNAME:name},windowsHide:true});
  let output=''; child.stdout.on('data',chunk=>{output+=chunk}); child.stderr.on('data',chunk=>{output+=chunk});
  child.on('exit',code=>resolve({code,output}));
});
for(const [index,[first,second]] of [['cashier','cashier'],['cashier','cancel'],['cancel','cashier'],['split','cashier'],['cancel','split'],['cancel','cancel']].entries()) {
  const id=`race-admin-${index}`; seed(id); const name=`admin-supervision-race-${index}`;
  const winner=run(`begin; select private.lock_restaurant_order_settlement_v1('${license}','${id}'); select pg_sleep(1); ${call(first,id,'admin','B','first')}; commit;`,name);
  let acquired=false;
  for(let attempt=0;attempt<80;attempt++) {
    acquired=sql(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='${name}' and l.locktype='advisory' and l.granted)`) === 't';
    if(acquired) break; await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.ok(acquired);
  const loser=run(`begin; ${call(second,id,'staff-a','A','second')}; commit;`,`${name}-loser`);
  const [win,lose]=await Promise.all([winner,loser]); assert.equal(win.code,0,win.output); assert.notEqual(lose.code,0,lose.output);
  assert.equal(Number(sql(`select count(*) from public.pos_sales where local_order_id='${id}'`)),first==='cancel'?0:1);
  assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='${id}'`),'1');
  results.push({first,second,result:'SERIALIZED_ONE_EFFECT'});
}
assert.equal(sql('select count(*) from private.restaurant_settlement_permits'),'0');
writeFileSync('.tmp-sql-admin-supervision-results.json',JSON.stringify({authority:'PASS',concurrency:results,financialLeaves:'CONTROLLED_TEST_DOUBLES'},null,2));
console.log('SQL authority and six real multi-session concurrency cases PASS');
