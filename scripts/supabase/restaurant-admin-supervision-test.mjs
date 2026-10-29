import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { closePsqlSession, openPsqlSession } from './psql-session.mjs';

assert.ok(process.argv.includes('--isolated-fixture'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN);
assert.equal(process.env.PGDATABASE, 'lanzo_admin_supervision_fixture', 'Dedicated empty fixture database required');
const args = ['-X','-h','127.0.0.1','-p',process.env.PGPORT,'-U',process.env.PGUSER || 'postgres',
  '-d',process.env.PGDATABASE,'-q','-t','-A','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const PSQL_SESSION_TIMEOUT_MS = 30_000;
const OBSERVATION_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 25;
const sql = (query) => {
  writeFileSync('.tmp-admin-supervision-query.sql', query);
  const result = spawnSync(process.env.PSQL_BIN, [...args,'-f','.tmp-admin-supervision-query.sql'], {
    encoding: 'utf8', windowsHide: true, timeout: PSQL_SESSION_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024
  });
  assert.equal(result.status,0,`${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`);
  return result.stdout.trim();
};
if (process.env.PR352_FIXTURE_MODE === 'github-actions-postgres-service') {
  assert.equal(process.env.PGPORT, '5432');
  assert.equal(sql('select current_setting(\'server_version_num\')'), process.env.PR352_EXPECTED_SERVER_VERSION_NUM);
  assert.equal(sql("select shobj_description(oid,'pg_database') from pg_database where datname=current_database()"),
    'LANZO_PR352_EPHEMERAL_PG17_SERVICE');
}
assert.equal(sql("select count(*) from information_schema.tables where table_schema in ('public','private')"),'0');
for (const file of ['supabase/tests/fixtures/restaurant_origin_cancel_3d13_setup.sql',
  'supabase/tests/fixtures/restaurant_admin_supervision_context.sql',
  'supabase/tests/fixtures/pr352_financial_dispatcher_context.sql',
  'supabase/migrations/20261010013257_restaurant_cloud_transition_bridge_v1.sql',
  'supabase/migrations/20261010013258_restaurant_admin_supervision_r1.sql']) sql('BEGIN;'+readFileSync(file,'utf8')+'COMMIT;');
assert.equal(sql(`select
  (to_regprocedure('private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb)') is not null)::text||'|'||
  (to_regprocedure('private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text)') is not null)::text||'|'||
  (to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)') is not null)::text`), 'true|true|true');
assert.equal(sql(`select (not p.prosecdef)::text||'|'||
  (coalesce(p.proconfig,array[]::text[]) @> array['search_path=""'])::text||'|'||
  (not has_function_privilege('anon',p.oid,'execute'))::text||'|'||
  (not has_function_privilege('authenticated',p.oid,'execute'))::text||'|'||
  (not has_function_privilege('service_role',p.oid,'execute'))::text
  from pg_proc p where p.oid='private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text)'::regprocedure`), 'true|true|true|true|true');
assert.equal(sql(`select count(*)::text||'|'||bool_and(relrowsecurity)::text from pg_class
  where relnamespace='private'::regnamespace
    and relname in ('restaurant_table_interventions','restaurant_settlement_permits','restaurant_parent_cancel_permits')`), '3|true');
assert.equal(sql(`select exists(select 1 from pg_trigger where tgrelid='public.pos_restaurant_orders'::regclass
  and tgname='restaurant_parent_cancel_authority_v1' and not tgisinternal)::text`), 'true');
// Prior ten-race coverage exercises the enabled final Admin phase. Transition
// tests separately prove the default-disabled and maintenance states.
sql("select private.set_restaurant_transition_policy_v1(false,'00000000-0000-0000-0000-000000000001',true)");

// The dispatcher, cancellation, ownership/capability and upsert functions above
// are the actual migration. Financial leaves below are controlled fixture effects.
sql(`create or replace function private.reserve_financial_operation_v1(
  p_license_id uuid,p_idempotency_key text,p_request_hash text,p_operation_type text,p_canonical_request jsonb,
  p_verified_actor_key text,p_verified_device_id uuid,p_cash_session_id text default null,p_verified_cash_station_id text default null)
returns public.pos_financial_operations language plpgsql as $function$
declare v public.pos_financial_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_license_id::text||':'||p_idempotency_key,0));
  select * into v from public.pos_financial_operations
    where license_id=p_license_id and legacy_idempotency_key=p_idempotency_key for update;
  if found then
    if v.request_hash is distinct from p_request_hash or v.operation_type is distinct from p_operation_type
       or v.canonical_request is distinct from p_canonical_request then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001';
    end if;
    return v;
  end if;
  insert into public.pos_financial_operations(license_id,legacy_idempotency_key,operation_type,status,
    canonical_request,verified_actor_key,verified_device_id,verified_cash_session_id,request_hash)
  values(p_license_id,p_idempotency_key,p_operation_type,'processing',p_canonical_request,
    p_verified_actor_key,p_verified_device_id,p_cash_session_id,p_request_hash)
  returning * into v;
  return v;
end
$function$;
create or replace function private.complete_financial_operation_v1(p_license_id uuid,p_idempotency_key text,p_response jsonb)
returns void language plpgsql as $function$
begin
  update public.pos_financial_operations set status='completed',response_payload=p_response
    where license_id=p_license_id and legacy_idempotency_key=p_idempotency_key;
  if not found then raise exception 'FIXTURE_FINANCIAL_RESERVATION_MISSING'; end if;
end
$function$;
create or replace function private.public_financial_response_v1(p_operation_type text,p_response jsonb,p_external_key text,p_internal_key text)
returns jsonb language sql as $function$ select p_response $function$;

create or replace function private.pr352_record_sale_effects_v1(
  p_operation_type text,p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_sale jsonb,p_items jsonb,p_payments jsonb,p_cash_session_id text,p_internal_idempotency_key text)
returns jsonb language plpgsql as $function$
declare c jsonb; v_sale_id text; v_local_sale_id text;
begin
  perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,
    p_security_token,p_staff_session_token,jsonb_build_object('sale',p_sale));
  perform private.assert_restaurant_sale_dispatcher_context_v1(p_license_key,p_device_fingerprint,
    p_security_token,p_staff_session_token,p_sale,p_cash_session_id,p_internal_idempotency_key,p_operation_type);
  c:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_sale_id:=coalesce(nullif(btrim(p_sale->>'id'),''),nullif(btrim(p_sale->>'cloud_sale_id'),''),nullif(btrim(p_sale->>'cloudSaleId'),''));
  v_local_sale_id:=coalesce(nullif(btrim(p_sale->>'local_sale_id'),''),nullif(btrim(p_sale->>'localSaleId'),''),v_sale_id);
  perform private.assert_restaurant_settlement_permit_v1(c,v_local_sale_id);
  insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,cash_session_id,idempotency_key)
  values('sale-'||v_sale_id,v_local_sale_id,coalesce(nullif(p_sale->>'total','')::numeric,0),
    (c->>'license_id')::uuid,v_local_sale_id,(c->>'device_id')::uuid,private.resolve_cash_actor_key(c),
    p_cash_session_id,p_internal_idempotency_key);
  insert into public.pos_sale_payments(id) values('payment-'||p_internal_idempotency_key);
  if p_operation_type <> 'sale.credit' then
    insert into public.pos_cash_movements(id) values('cash-'||p_internal_idempotency_key);
  end if;
  if p_operation_type='sale.cashier_inventory' then
    insert into public.pos_inventory_movements(id,sale_id,quantity)
      values('inventory-'||p_internal_idempotency_key,'sale-'||v_sale_id,1);
  elsif p_operation_type='sale.credit' then
    insert into public.pos_customer_ledger(id) values('credit-'||p_internal_idempotency_key);
  end if;
  return jsonb_build_object('success',true,'sale',jsonb_build_object('id','sale-'||v_sale_id,'local_sale_id',v_local_sale_id));
end
$function$;
create or replace function public.pos_create_cloud_sale_cashier(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_sale jsonb,p_items jsonb,p_payments jsonb,p_cash_session_id text,p_internal_idempotency_key text)
returns jsonb language sql as $function$
  select private.pr352_record_sale_effects_v1('sale.cashier',$1,$2,$3,$4,$5,$6,$7,$8,$9)
$function$;
create or replace function public.pos_create_cloud_sale_cashier_inventory(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_sale jsonb,p_items jsonb,p_payments jsonb,p_cash_session_id text,p_internal_idempotency_key text)
returns jsonb language sql as $function$
  select private.pr352_record_sale_effects_v1('sale.cashier_inventory',$1,$2,$3,$4,$5,$6,$7,$8,$9)
$function$;
create or replace function public.pos_create_cloud_sale_credit(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_sale jsonb,p_items jsonb,p_payments jsonb,p_cash_session_id text,p_customer_id text,p_internal_idempotency_key text)
returns jsonb language sql as $function$
  select private.pr352_record_sale_effects_v1('sale.credit',$1,$2,$3,$4,$5,$6,$7,$8,$10)
$function$;

drop function public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text);
create function public.pos_close_restaurant_order_after_checkout_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_local_order_id text,p_paid_sale_id text,p_paid_sale_folio text,p_paid_total numeric,p_payment_summary jsonb,p_idempotency_key text)
returns jsonb language plpgsql as $function$ begin
  perform private.assert_restaurant_settlement_permit_v1(private.validate_pos_sync_context($1,$2,$3,$4),$5);
  update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id=$6,updated_at=now() where local_order_id=$5;
  return jsonb_build_object('success',true,'found',true,'order',jsonb_build_object('status','delivered','fulfillment_status','delivered'));
end $function$;
create or replace function private.execute_split_sale_financial_v1(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_split jsonb,p_internal_idempotency_key text)
returns jsonb language plpgsql as $function$
declare v public.pos_restaurant_orders; c jsonb; parent_id text;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  parent_id:=coalesce(nullif(btrim($5->>'parent_order_id'),''),nullif(btrim($5->>'parentOrderId'),''));
  v:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,parent_id);
  perform private.assert_restaurant_table_actor_v1(c,v,'split');
  perform private.assert_restaurant_settlement_permit_v1(c,v.local_order_id);
  insert into private.pr352_split_execution_observations(operation_key,parent_order_id)
    values($6,v.local_order_id);
  insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,cash_session_id,idempotency_key)
  values('split-'||v.local_order_id,v.local_order_id,50,v.license_id,v.local_order_id,(c->>'device_id')::uuid,
    private.resolve_cash_actor_key(c),$5->>'cash_session_id',$6);
  insert into public.pos_sale_payments(id) values('payment-'||$6);
  insert into public.pos_cash_movements(id) values('cash-'||$6);
  update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id='split-'||v.local_order_id,updated_at=now() where id=v.id;
  return jsonb_build_object('success',true,'sale',jsonb_build_object('id','split-'||v.local_order_id));
end
$function$;`);

const license = '00000000-0000-0000-0000-000000000001';
const owner = '00000000-0000-0000-0000-0000000000aa';
const version = '2026-10-01T00:00:00Z';
const seed = (id, staff = owner) => sql(`insert into public.pos_restaurant_orders(id,license_id,local_order_id,sale_id,created_by_device_id,created_by_staff_user_id,updated_at,payment_status,total)
values('${id}','${license}','${id}','${id}','00000000-0000-0000-0000-00000000000a',${staff ? `'${staff}'` : 'null'},'${version}','unpaid',50)`);
const caps = (id, actor='staff-a',device='A') => JSON.parse(sql(`select public.pos_restaurant_table_capabilities_v1('fixture-license','${device}','valid','${actor}','${id}')`));
const call = (operation,id,actor='admin',device='B',suffix='attempt') => {
  if(operation==='edit') return edit(actor,device,version,{},id);
  if(operation==='cancel') return `select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','${device}','valid','${actor}','${id}','${version}','QA reason','${id}-${suffix}')`;
  const payload = operation==='split' ? { cash_session_id:'cash-a',parent_order_id:id,parent_order_version:version }
    : {cash_session_id:'cash-a',sale:{id,total:50},items:[],payments:[],restaurant_settlement:{parent_order_id:id,parent_order_version:version}};
  return `select public.pos_execute_financial_operation_v1('fixture-license','${device}','valid','${actor}','${id}-${suffix}','fixture-hash','sale.${operation}','${JSON.stringify(payload)}')`;
};
const rejected = (query,code) => {
  const result=spawnSync(process.env.PSQL_BIN,[...args,'-c',query],{
    encoding:'utf8',windowsHide:true,timeout:PSQL_SESSION_TIMEOUT_MS,maxBuffer:10*1024*1024
  });
  assert.equal(result.error,undefined,`${result.error?.message || ''}\n${result.stderr || ''}`);
  assert.ok(result.status!==null&&result.status!==undefined,`${result.stdout || ''}${result.stderr || ''}`);
  assert.notEqual(result.status,0); assert.match(result.stderr,new RegExp(code));
  return result;
};
const results=[];
const sqlState = output => output.match(/ERROR:\s+([0-9A-Z]{5}):/i)?.[1] ?? null;
const persistSqlEvidence = () => writeFileSync('.tmp-sql-admin-supervision-results.json',JSON.stringify({
  installation:'PASS_POSTGRESQL_REAL',identityAliases:'PASS',historicalSaleGuard:'PASS',completedReplay:'PASS',
  splitAndAuthority:'PASS_CONTROLLED_FINANCIAL_LEAVES',concurrency:results,
  financialLeaves:'CONTROLLED_TEST_DOUBLES_NOT_INTEGRATED_CASH_CREDIT_INVENTORY'
},null,2));
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
for (const alias of ['cloud_sale_id','cloudSaleId','local_sale_id','localSaleId']) {
  const sale = JSON.stringify({ [alias]: 'owner' });
  rejected(`select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','A','valid','staff-b','${sale}','[]','[]','cash-a',null,'direct-${alias}')`, 'RESTAURANT_TABLE_OWNER_REQUIRED');
  rejected(`select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','B','valid','admin','${sale}','[]','[]','cash-a',null,'direct-admin-${alias}')`, 'RESTAURANT_SETTLEMENT_CONTRACT_REQUIRED');
}
rejected(`select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','A','valid','staff-b',
  '{"id":"unrelated-child","metadata":{"source":"split_bill_child","splitGroupId":"forged","splitParentId":"owner"}}',
  '[]','[]','cash-a',null,'forged-child')`, 'RESTAURANT_TABLE_OWNER_REQUIRED');
rejected("set role anon; select private.assert_restaurant_settlement_permit_v1('{}','owner')",'permission denied');
assert.equal(sql('select count(*) from public.pos_sales'),'0');

// SQL-02: raw sale, settlement, and metadata aliases cannot redirect the
// dispatcher to a second Restaurant parent before any ledger or sale effect.
seed('alias-parent-a'); seed('alias-parent-b');
const aliasPayload = sale => ({ cash_session_id:'cash-a', sale, items:[], payments:[],
  restaurant_settlement:{parent_order_id:'alias-parent-a',parent_order_version:version} });
for (const [key,sale] of [
  ['alias-local-id',{id:'alias-parent-a',local_sale_id:'alias-parent-b',total:50}],
  ['alias-metadata',{id:'alias-parent-a',total:50,metadata:{restaurant:{parentOrderId:'alias-parent-b'}}}],
  ['alias-metadata-snake',{id:'alias-parent-a',total:50,metadata:{restaurant:{parent_order_id:'alias-parent-b'}}}],
  ['alias-split-parent',{id:'alias-parent-a',total:50,metadata:{split_parent_id:'alias-parent-b'}}]
]) {
  const payload = JSON.stringify(aliasPayload(sale));
  rejected(`select public.pos_execute_financial_operation_v1('fixture-license','B','valid','admin','${key}','fixture-hash','sale.cashier','${payload}')`,
    'RESTAURANT_ORDER_CONTEXT_MISMATCH');
  assert.equal(sql(`select count(*) from public.pos_financial_operations where legacy_idempotency_key='${key}'`),'0');
}
seed('legacy-metadata-parent');
for (const [index,metadata] of [
  {splitParentId:'legacy-metadata-parent'},
  {split_parent_id:'legacy-metadata-parent'},
  {restaurant:{parentOrderId:'legacy-metadata-parent'}},
  {restaurant:{parent_order_id:'legacy-metadata-parent'}}
].entries()) {
  const sale = JSON.stringify({id:`metadata-bypass-${index}`,metadata});
  rejected(`select private.assert_restaurant_sale_dispatcher_context_v1('fixture-license','B','valid','admin','${sale}','cash-a','missing-metadata-receipt-${index}','sale.cashier')`,
    'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED');
}
sql(`insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,cash_session_id,idempotency_key)
  values('legacy-metadata-sale','legacy-metadata-parent',50,'${license}','legacy-metadata-parent',
    '00000000-0000-0000-0000-00000000000b','admin:a','cash-a','legacy-metadata-key');
  insert into public.pos_idempotency_keys(license_id,idempotency_key,operation_type,entity_type,entity_id,
    request_hash,response_payload,status) values('${license}','legacy-metadata-key','sales.cloud_commit','sale',
    'legacy-metadata-sale','fixture-legacy-hash','{"success":true}'::jsonb,'completed')`);
sql(`select private.assert_restaurant_sale_dispatcher_context_v1('fixture-license','B','valid','admin',
  '{"id":"legacy-metadata-sale","metadata":{"restaurant":{"parentOrderId":"legacy-metadata-parent"}}}',
  'cash-a','legacy-metadata-key','sale.cashier')`);
const splitAlias = JSON.stringify({cash_session_id:'cash-a',parent_order_id:'alias-parent-a',parentOrderId:'alias-parent-b',
  children:[{sale:{id:'child-a'}},{sale:{id:'child-b'}}]});
rejected(`select public.pos_execute_financial_operation_v1('fixture-license','B','valid','admin','alias-split-top','fixture-hash','sale.split','${splitAlias}')`,
  'RESTAURANT_ORDER_CONTEXT_MISMATCH');
const splitChildMetadataAlias = JSON.stringify({cash_session_id:'cash-a',parent_order_id:'alias-parent-a',
  parent_order_version:version,children:[{sale:{id:'child-a',metadata:{restaurant:{parentOrderId:'alias-parent-b'}}}}]});
rejected(`select public.pos_execute_financial_operation_v1('fixture-license','B','valid','admin','alias-split-nested','fixture-hash','sale.split','${splitChildMetadataAlias}')`,
  'RESTAURANT_ORDER_CONTEXT_MISMATCH');
assert.equal(sql("select count(*) from public.pos_sales where local_order_id in ('alias-parent-a','alias-parent-b')"),'0');
assert.equal(sql("select count(*) from public.pos_financial_operations where legacy_idempotency_key in ('alias-split-top','alias-split-nested')"),'0');
results.push({case:'SQL-02 contradictory sale/settlement/metadata/split aliases',
  result:'REJECTED_BEFORE_EFFECTS_METADATA_LEGACY_BYPASS_DENIED_EXACT_COMPLETED_RECEIPT_ALLOWED'});

// SQL-03: a historical sale tied to this parent blocks a new key, and the
// failed reservation rolls back with the statement.
seed('historical-sale');
sql(`insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,cash_session_id,idempotency_key)
  values('historical-sale-row','historical-sale',50,'${license}','historical-sale','00000000-0000-0000-0000-00000000000a',
    'admin:a','cash-a','historical-sale-old-key')`);
const historicalBefore = sql("select count(*) from public.pos_sales where local_order_id='historical-sale'");
const historicalAttemptKey = 'historical-sale-new-historical-key';
rejected(call('cashier','historical-sale','admin','B','new-historical-key'),'RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED');
assert.equal(sql("select count(*) from public.pos_sales where local_order_id='historical-sale'"),historicalBefore);
assert.equal(sql(`select count(*) from public.pos_cash_movements where id='cash-${historicalAttemptKey}'`),'0');
assert.equal(sql(`select count(*) from public.pos_financial_operations where legacy_idempotency_key='${historicalAttemptKey}'`),'0');
results.push({case:'SQL-03 historical sale guard',result:'BLOCKED_NEW_KEY_NO_EFFECTS'});

// SQL-04: a completed K/H receipt returns the original body and never repeats
// the controlled sale, payment, or cash leaves.
seed('kh-replay');
const replayCall = call('cashier','kh-replay','admin','B','key');
const firstReceipt = sql(replayCall);
const replayReceipt = sql(replayCall);
assert.equal(replayReceipt,firstReceipt);
rejected(replayCall.replace('"total":50','"total":49'),'IDEMPOTENCY_CONFLICT');
assert.equal(sql("select count(*) from public.pos_sales where local_order_id='kh-replay'"),'1');
assert.equal(sql("select count(*) from public.pos_sale_payments where id='payment-kh-replay-key'"),'1');
assert.equal(sql("select count(*) from public.pos_cash_movements where id='cash-kh-replay-key'"),'1');
assert.equal(sql("select count(*) from public.pos_financial_operations where legacy_idempotency_key='kh-replay-key' and status='completed'"),'1');
results.push({case:'SQL-04 completed K/H replay',result:'SAME_RECEIPT_ONE_CONTROLLED_CHARGE'});

const edit = (actor,device='A',expected=version,extra={},id='owner') => `select public.pos_upsert_restaurant_order_unlimited('fixture-license','${device}','valid','${actor}',
  '${JSON.stringify({clientContractVersion:2,localOrderId:id,saleId:id,expectedParentVersion:expected,total:50,subtotal:50,...extra})}',
  '[{"localLineId":"line-owner","productId":"pizza","productName":"Pizza","quantity":1,"unitPrice":50,"lineTotal":50}]','edit-${actor}-${device}-${expected}')`;
rejected(edit('staff-b','A',version,{createdByStaffUserId:owner}),'RESTAURANT_TABLE_OWNER_REQUIRED');
rejected(edit('admin','B',version,{createdByDeviceId:'00000000-0000-0000-0000-00000000000b'}),'ADMIN_REMOTE_EDIT_BLOCKED');
rejected(edit('staff-a','A','2026-09-01T00:00:00Z'),'RESTAURANT_ORDER_VERSION_CONFLICT');
sql(edit('staff-a'));
assert.equal(sql("select created_by_staff_user_id from public.pos_restaurant_orders where id='owner'"),owner);
for(const [operation,actor,device] of [['cashier','staff-a','A'],['cashier','admin','B'],['cashier_inventory','admin','B'],['credit','admin','B'],['split','admin','B'],['cancel','admin','B']]) {
  const id=`authorized-${operation}-${actor}`; seed(id); sql(call(operation,id,actor,device));
  assert.equal(sql(`select count(*) from private.restaurant_table_interventions where order_id='${id}'`),'1');
  assert.equal(sql(`select created_by_staff_user_id from public.pos_restaurant_orders where id='${id}'`),owner);
  if(operation==='split') assert.equal(sql(`select parent_order_id from private.pr352_split_execution_observations where operation_key='${id}-attempt'`),id);
  if(operation==='split') {
    assert.equal(sql(`select count(*) from public.pos_sales where local_order_id='${id}'`),'1');
    assert.equal(sql(`select count(*) from public.pos_cash_movements where id='cash-${id}-attempt'`),'1');
  }
  if(operation==='cashier_inventory') assert.equal(sql(`select count(*) from public.pos_inventory_movements where sale_id='sale-${id}'`),'1');
  if(operation==='credit') assert.equal(sql(`select count(*) from public.pos_customer_ledger where id='credit-${id}-attempt'`),'1');
  if(operation==='cancel') sql(call(operation,id,actor,device));
  else rejected(call(operation,id,actor,device,'second'),'RESTAURANT_ORDER_NOT_ACTIVE|RESTAURANT_ORDER_ALREADY_PAID');
}
seed('split-camel-parent');
const camelSplit = JSON.stringify({cash_session_id:'cash-a',parentOrderId:'split-camel-parent',parentOrderVersion:version,
  children:[{sale:{id:'split-camel-child-a'}},{sale:{id:'split-camel-child-b'}}]});
sql(`select public.pos_execute_financial_operation_v1('fixture-license','B','valid','admin','split-camel-key','fixture-hash','sale.split','${camelSplit}')`);
assert.equal(sql("select parent_order_id from private.pr352_split_execution_observations where operation_key='split-camel-key'"),'split-camel-parent');
assert.equal(sql("select count(*) from public.pos_sales where local_order_id='split-camel-parent'"),'1');
assert.equal(sql("select payment_status from public.pos_restaurant_orders where local_order_id='split-camel-parent'"),'paid');
results.push({case:'SQL-05 camel-case split parent normalization',result:'CANONICAL_PARENT_LOCKED_AND_SINGLE_SPLIT_EFFECT'});
const openSession = name => openPsqlSession({ command:process.env.PSQL_BIN,args,applicationName:name,
  timeoutMs:PSQL_SESSION_TIMEOUT_MS });
const run = async (query,name) => {
  const session=openSession(name);
  try {
    await session.end(query+'\n');
    return await session.done;
  } finally {
    if(!session.closed) await closePsqlSession(session,{input:null});
  }
};
const quoteSql = value => "'"+String(value).replaceAll("'","''")+"'";
const activity = name => JSON.parse(sql(`select coalesce(json_agg(json_build_object(
  'pid',a.pid,'state',a.state,'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,
  'query_excerpt',left(a.query,500),'query_length',length(a.query),
  'locks',coalesce((select json_agg(json_build_object('locktype',l.locktype,'mode',l.mode,
    'granted',l.granted,'classid',l.classid,'objid',l.objid,'objsubid',l.objsubid))
    from pg_locks l where l.pid=a.pid),'[]'::json)
)),'[]'::json)::text from pg_stat_activity a where a.application_name=${quoteSql(name)}`));
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const waitForActivity = async (name,predicate,label,timeoutMs=OBSERVATION_TIMEOUT_MS) => {
  const deadline=Date.now()+timeoutMs; let snapshot=[];
  do {
    snapshot=activity(name);
    if(predicate(snapshot)) return snapshot;
    if(Date.now()>=deadline) break;
    await delay(POLL_INTERVAL_MS);
  } while(Date.now()<=deadline);
  assert.fail(`${label}: expected PostgreSQL session state was not observed within ${timeoutMs}ms; last pg_stat_activity/pg_locks snapshot=${JSON.stringify(snapshot)}`);
};
const hasParentSettlementLock = rows => rows.some(row => row.locks.some(lock=>lock.locktype==='advisory'&&lock.granted&&
  lock.mode==='ExclusiveLock'&&lock.objsubid===2));
const waitsForParentSettlementLock = rows => rows.some(row => row.wait_event_type==='Lock'&&row.locks.some(lock=>
  lock.locktype==='advisory'&&!lock.granted&&lock.mode==='ExclusiveLock'&&lock.objsubid===2));
const assertSuccessfulSession = (result,label) => {
  assert.ok(result,`${label}: no process result`);
  assert.equal(result.timedOut,false,`${label}: ${result.output}`);
  assert.equal(result.spawnError,null,`${label}: ${result.output}`);
  assert.equal(result.inputError,null,`${label}: ${result.output}`);
  assert.equal(result.code,0,`${label}: ${result.output}`);
};
const assertNoSessions = (...names) => {
  for(const name of names) assert.equal(sql(`select count(*) from pg_stat_activity where application_name=${quoteSql(name)}`),'0',
    `psql session ${name} remained connected after its scenario`);
};
const runAgainstHeldParent = async (query,name,parentId,expectedCode) => {
  const holderName=`${name}-parent-holder`;
  const holder=openSession(holderName); let contender=null; let holderResult=null;
  const lockQuery=`begin; select private.lock_restaurant_order_settlement_v1('${license}','${parentId}');\n`;
  let contenderResult=null; let blockedOnLock=false; let contenderCompletedBeforeRelease=false;
  let holderSnapshot=[]; let contenderSnapshot=[];
  try {
    await holder.write(lockQuery);
    holderSnapshot=await waitForActivity(holderName,
      rows=>rows.some(row=>row.state==='idle in transaction')&&hasParentSettlementLock(rows),
      `${name}: blocker must hold the Restaurant-parent advisory lock in an open transaction`);
    contender=openSession(name);
    const contenderSubmittedAt=performance.now();
    await contender.end(query+'\n');
    let completed=false;
    let completedAt=null;
    const outcomePromise=contender.done.then(result=>{contenderResult=result;completed=true;completedAt=performance.now();return result;});
    const deadline=Date.now()+OBSERVATION_TIMEOUT_MS;
    do {
      contenderSnapshot=activity(name);
      blockedOnLock=waitsForParentSettlementLock(contenderSnapshot);
      if(completed||blockedOnLock) break;
      if(Date.now()>=deadline) break;
      await delay(POLL_INTERVAL_MS);
    } while(Date.now()<=deadline);
    contenderCompletedBeforeRelease=completed;
    const stillHeld=activity(holderName).some(row=>row.state==='idle in transaction'&&hasParentSettlementLock([row]));
    assert.equal(stillHeld,true,`${name}: blocker lock disappeared before contender outcome; snapshot=${JSON.stringify(holderSnapshot)}`);
    assert.equal(contender.stdinEnded,true,`${name}: contender SQL stdin was not closed after submission`);
    assert.equal(blockedOnLock,false,`${name}: contradictory identity waited on a parent lock instead of rejecting; snapshot=${JSON.stringify(contenderSnapshot)}`);
    assert.equal(contenderCompletedBeforeRelease,true,
      `${name}: SQL contender did not finish while the alias-parent lock was held; it may not have reached PostgreSQL; snapshot=${JSON.stringify(contenderSnapshot)} output=${contender.output}`);
    await outcomePromise;
    assert.equal(contenderResult.inputError,null,contenderResult.output);
    assert.notEqual(contenderResult.code,0,contenderResult.output);
    assert.equal(contenderResult.timedOut,false,contenderResult.output);
    assert.equal(contenderResult.spawnError,null,contenderResult.output);
    assert.match(contenderResult.output,new RegExp(expectedCode));
    const state=sqlState(contenderResult.output);
    assert.equal(state,'P0001',contenderResult.output);
    holderResult=await closePsqlSession(holder,{input:'ROLLBACK;\n'});
    assertSuccessfulSession(holderResult,`${name} parent-holder rollback`);
    const result={case:name,query:query.trim(),blockerQuery:lockQuery.trim(),
      contenderSqlSubmitted:contender.stdinFinished,contenderCompletedBeforeBlockerRelease,
      contenderCompletionObservedAfterMs:Math.round(completedAt-contenderSubmittedAt),
      blockerAdvisoryLockObserved:true,contenderWaitObserved:blockedOnLock,
      blockerLockSnapshot:holderSnapshot,contenderActivitySnapshot:contenderSnapshot,
      result:'PASS',expectation:'REJECTED_WITH_PARENT_LOCK_HELD_WITHOUT_WAIT',
      releaseOrder:'contender_error_observed_then_blocker_rollback',sqlstate:state,
      contenderExitCode:contenderResult.code,parentLockHolderExitCode:holderResult.code,
      financialEffects:'none_expected',sessionsRemaining:0};
    assertNoSessions(holderName,name);
    return result;
  } finally {
    if(!holder.closed) await closePsqlSession(holder,{input:'ROLLBACK;\n'});
    if(contender&&!contender.closed) await closePsqlSession(contender,{input:null});
  }
};
// SQL-08: contradictory aliases must fail before waiting on the alias parent.
const aliasRaceRequest = JSON.stringify({cash_session_id:'cash-a',
  sale:{id:'alias-parent-a',total:50,metadata:{restaurant:{parentOrderId:'alias-parent-b'}}},
  items:[],payments:[],restaurant_settlement:{parent_order_id:'alias-parent-a',parent_order_version:version}});
const aliasRaceQuery = `select public.pos_execute_financial_operation_v1('fixture-license','B','valid','admin',
  'alias-parent-concurrent','fixture-hash','sale.cashier','${aliasRaceRequest}')`;
const aliasRaceResult = await runAgainstHeldParent(aliasRaceQuery,'pr352-alias-parent-concurrent','alias-parent-b',
  'RESTAURANT_ORDER_CONTEXT_MISMATCH');
const aliasRaceEffects={financialOperations:Number(sql("select count(*) from public.pos_financial_operations where legacy_idempotency_key='alias-parent-concurrent'")),
  sales:Number(sql("select count(*) from public.pos_sales where local_order_id in ('alias-parent-a','alias-parent-b')"))};
assert.equal(aliasRaceEffects.financialOperations,0);
assert.equal(aliasRaceEffects.sales,0);
results.push({...aliasRaceResult,case:'SQL-08 contradictory alias against held alias-parent lock',finalFinancialEffects:aliasRaceEffects});
persistSqlEvidence();

// R2B sees a nested split parent for authority but must not acquire a second
// Restaurant-parent advisory lock after the cashier/ledger path has begun.
seed('r2b-nested-parent');
const r2bNestedSale = JSON.stringify({id:'r2b-split-child',total:50,
  metadata:{source:'split_bill_child',splitGroupId:'r2b-nested-test',splitParentId:'r2b-nested-parent'}});
const r2bNestedQuery = `select private.r2b_authorize_sale_financial_request_v1('sale.cashier','fixture-license','B','valid','admin',
  '${r2bNestedSale}','[]','[]','cash-a',null,'r2b-nested-concurrent')`;
const r2bNestedResult = await runAgainstHeldParent(r2bNestedQuery,'pr352-r2b-nested-parent-concurrent',
  'r2b-nested-parent','RESTAURANT_SETTLEMENT_CONTRACT_REQUIRED');
const r2bNestedEffects={financialOperations:Number(sql("select count(*) from public.pos_financial_operations where legacy_idempotency_key='r2b-nested-concurrent'")),
  sales:Number(sql("select count(*) from public.pos_sales where local_order_id='r2b-nested-parent'"))};
assert.equal(r2bNestedEffects.financialOperations,0);
assert.equal(r2bNestedEffects.sales,0);
results.push({...r2bNestedResult,case:'SQL-08 nested R2B parent against held parent lock',finalFinancialEffects:r2bNestedEffects});
persistSqlEvidence();
for(const [index,[first,second]] of [['cashier','cashier'],['cashier','cancel'],['cancel','cashier'],['split','cashier'],['cancel','split'],['cancel','cancel'],['cancel','edit']].entries()) {
  const id=`race-admin-${index}`; seed(id); const name=`admin-supervision-race-${index}`;
  const winner=openSession(name); let loser=null; let win=null; let lose=null;
  const holderQuery=`begin; select private.lock_restaurant_order_settlement_v1('${license}','${id}');\n`;
  const contenderQuery=`begin; ${call(second,id,'staff-a','A','second')}; commit;\n`;
  try {
    await winner.write(holderQuery);
    const winnerLock=await waitForActivity(name,
      rows=>rows.some(row=>row.state==='idle in transaction')&&hasParentSettlementLock(rows),
      `${name}: winner must hold the Restaurant-parent advisory lock`);
    loser=openSession(`${name}-loser`);
    const loserSubmittedAt=performance.now(); let contenderWaitObservedAfterMs=null;
    const loserInput=loser.end(contenderQuery).then(()=>null,error=>error);
    let loserSettled=false;
    const loserDone=loser.done.then(result=>{lose=result;loserSettled=true;return result;});
    let loserSnapshot=[]; let contending=false;
    const deadline=Date.now()+OBSERVATION_TIMEOUT_MS;
    do {
      loserSnapshot=activity(`${name}-loser`);
      contending=waitsForParentSettlementLock(loserSnapshot);
      if(contending) contenderWaitObservedAfterMs=Math.round(performance.now()-loserSubmittedAt);
      if(contending||loserSettled||loser.closed||Date.now()>=deadline) break;
      await delay(POLL_INTERVAL_MS);
    } while(Date.now()<=deadline);
    assert.equal(contending,true,
      `${name}: loser did not reach PostgreSQL lock wait before winner release; pg_stat_activity=${JSON.stringify(loserSnapshot)} output=${loser.output}`);
    const winnerStillHolding=activity(name).some(row=>row.state==='idle in transaction'&&hasParentSettlementLock([row]));
    assert.equal(winnerStillHolding,true,`${name}: winner lock was not held when loser wait was observed`);
    const winnerReleaseQuery=`${call(first,id,'admin','B','first')}; commit;\n`;
    await winner.end(winnerReleaseQuery);
    const inputError=await loserInput;
    assert.equal(inputError,null,`${name} contender stdin submission failed: ${inputError?.message}; ${lose?.output || ''}`);
    assert.equal(loser.stdinFinished,true,`${name}: contender stdin did not finish after PostgreSQL released the lock`);
    [win,lose]=await Promise.all([winner.done,loserDone]);
    assertSuccessfulSession(win,`${name} winner`);
    assert.ok(lose,`${name}: loser did not produce a process result`);
    assert.equal(lose.timedOut,false,lose.output);
    assert.equal(lose.spawnError,null,lose.output);
    assert.notEqual(lose.code,0,lose.output);
    const state=sqlState(lose.output);
    assert.equal(state,'P0001',lose.output);
    const finalSales=Number(sql(`select count(*) from public.pos_sales where local_order_id='${id}'`));
    assert.equal(finalSales,first==='cancel'?0:1);
    const interventions=sql(`select count(*) from private.restaurant_table_interventions where order_id='${id}'`);
    assert.equal(interventions,'1');
    const finalCashMovements=Number(sql(`select count(*) from public.pos_cash_movements where id like 'cash-${id}%'`));
    assert.equal(finalCashMovements,first==='cashier'||first==='split'?1:0);
    results.push({case:name,first,second,result:'PASS',semantics:'SERIALIZED_ONE_EFFECT',
      blockerQuery:holderQuery.trim(),contenderQuery:contenderQuery.trim(),winnerReleaseQuery:winnerReleaseQuery.trim(),
      contenderSqlSubmitted:loser.stdinFinished,blockerAdvisoryLockObserved:true,contenderWaitObserved:contending,
      contenderWaitObservedAfterMs,
      releaseOrder:'winner_operation_and_commit_after_loser_lock_wait_observed',
      sqlstate:state,winnerExitCode:win.code,loserExitCode:lose.code,
      finalFinancialEffects:{sales:finalSales,cashMovements:finalCashMovements,interventions:Number(interventions)},
      winnerLockSnapshot:winnerLock,contenderLockSnapshot:loserSnapshot,sessionsRemaining:0});
    assertNoSessions(name,`${name}-loser`);
    persistSqlEvidence();
  } finally {
    if(!winner.closed) await closePsqlSession(winner,{input:'ROLLBACK;\n'});
    if(loser&&!loser.closed) await closePsqlSession(loser,{input:null});
  }
}
assert.equal(sql('select count(*) from private.restaurant_settlement_permits'),'0');

// SQL-09/10: during pause, an unrelated financial admission is accepted but
// holds the shared global cutover lock. The exclusive cutover waits for it;
// no Restaurant-parent advisory lock is acquired. Rollback releases the lock.
const cashEffectsBeforeCutover = sql('select count(*) from public.pos_cash_movements');
sql('select private.set_restaurant_transition_policy_v1(true)');
const reentrantQuery=`begin;
  select private.enter_restaurant_financial_transition_write_v1('fixture-license','B','valid','admin','{"operation_type":"cash.movement","cash_session_id":"cash-a","amount":3}');
  select private.enter_restaurant_financial_transition_write_v1('fixture-license','B','valid','admin','{"operation_type":"cash.movement","cash_session_id":"cash-a","amount":3}');
  select count(*) from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted and objsubid=1;
  rollback;`;
const reentrant=await run(reentrantQuery,'pr352-cutover-lock-reentry');
assertSuccessfulSession(reentrant,'reentrant transition admission');
assert.ok(reentrant.output.split(/\r?\n/).includes('1'),reentrant.output);
const cutoverName='pr352-other-rubro-cutover';
const unrelatedName='pr352-other-rubro-admission';
const cutover=openSession(cutoverName); let unrelated=null; let cutoverResult=null; let unrelatedResult=null;
const cutoverQuery="begin; select pg_advisory_xact_lock(hashtextextended('restaurant_contract_cutover_v1',0));\n";
const unrelatedQuery=`begin; select private.enter_restaurant_financial_transition_write_v1(
  'fixture-license','B','valid','admin','{"operation_type":"cash.movement","cash_session_id":"cash-a","amount":3}');\n`;
let cutoverLockSnapshot=[]; let unrelatedWaitSnapshot=[]; let unrelatedSharedSnapshot=[];
let unrelatedSubmittedAt=null; let unrelatedWaitObservedAfterMs=null; let unrelatedAdmissionResumedAfterMs=null;
try {
  await cutover.write(cutoverQuery);
  cutoverLockSnapshot=await waitForActivity(cutoverName,
    rows=>rows.some(row=>row.state==='idle in transaction'&&row.locks.some(lock=>lock.locktype==='advisory'&&lock.granted&&lock.mode==='ExclusiveLock'&&lock.objsubid===1)),
    'exclusive transition-cutover advisory lock');
  unrelated=openSession(unrelatedName);
  unrelatedSubmittedAt=performance.now();
  await unrelated.write(unrelatedQuery);
  unrelatedWaitSnapshot=await waitForActivity(unrelatedName,
    rows=>rows.some(row=>row.wait_event_type==='Lock'&&row.locks.some(lock=>lock.locktype==='advisory'&&!lock.granted&&lock.mode==='ShareLock'&&lock.objsubid===1)),
    'unrelated financial admission must queue on the shared cutover lock');
  unrelatedWaitObservedAfterMs=Math.round(performance.now()-unrelatedSubmittedAt);
  const cutoverLock=cutoverLockSnapshot.flatMap(row=>row.locks).find(lock=>lock.locktype==='advisory'&&lock.granted&&lock.mode==='ExclusiveLock'&&lock.objsubid===1);
  const sharedWait=unrelatedWaitSnapshot.flatMap(row=>row.locks).find(lock=>lock.locktype==='advisory'&&!lock.granted&&lock.mode==='ShareLock'&&lock.objsubid===1);
  assert.equal(sharedWait.classid,cutoverLock.classid,'the observed waiter must target the exclusive cutover lock');
  assert.equal(sharedWait.objid,cutoverLock.objid,'the observed waiter must target the exclusive cutover lock');
  await cutover.end('commit;\n');
  cutoverResult=await cutover.done;
  assertSuccessfulSession(cutoverResult,'cutover lock release');
  unrelatedSharedSnapshot=await waitForActivity(unrelatedName,
    rows=>rows.some(row=>row.state==='idle in transaction'&&row.locks.some(lock=>lock.locktype==='advisory'&&lock.granted&&lock.mode==='ShareLock'&&lock.objsubid===1)),
    'unrelated admission must acquire the shared transition lock after cutover');
  unrelatedAdmissionResumedAfterMs=Math.round(performance.now()-unrelatedSubmittedAt);
  const sharedLock=unrelatedSharedSnapshot.flatMap(row=>row.locks).find(lock=>lock.locktype==='advisory'&&lock.granted&&lock.mode==='ShareLock'&&lock.objsubid===1);
  assert.equal(sharedLock.classid,cutoverLock.classid);
  assert.equal(sharedLock.objid,cutoverLock.objid);
  const unrelatedParentLockCount=unrelatedSharedSnapshot.flatMap(row=>row.locks)
    .filter(lock=>lock.locktype==='advisory'&&lock.granted&&lock.objsubid===2).length;
  assert.equal(unrelatedParentLockCount,0);
  const cashEffectsAfterCutover=sql('select count(*) from public.pos_cash_movements');
  assert.equal(cashEffectsAfterCutover,cashEffectsBeforeCutover);
  await unrelated.end('rollback;\n');
  unrelatedResult=await unrelated.done;
  assertSuccessfulSession(unrelatedResult,'unrelated admission rollback');
  assertNoSessions(cutoverName,unrelatedName);
} finally {
  if(!cutover.closed) await closePsqlSession(cutover,{input:'ROLLBACK;\n'});
  if(unrelated&&!unrelated.closed) await closePsqlSession(unrelated,{input:'ROLLBACK;\n'});
}
assert.equal(sql("select pg_try_advisory_xact_lock(hashtextextended('restaurant_contract_cutover_v1',0))::text"),'true');
const pausedRestaurantAttempt = rejected("select private.enter_restaurant_financial_transition_write_v1('fixture-license','B','valid','admin','{\"sale\":{\"id\":\"owner\"}}')",
  'RESTAURANT_CONTRACT_MAINTENANCE');
assert.equal(sqlState(pausedRestaurantAttempt.stderr),'P0001',pausedRestaurantAttempt.stderr);
sql('select private.set_restaurant_transition_policy_v1(false)');
results.push({case:'SQL-09/10 paused other-rubro admission and cutover',
  result:'PASS',semantics:'ADMITTED_NO_PARENT_LOCK_GLOBAL_CUTOVER_WAIT_OBSERVED_ROLLBACK_RELEASED',
  cutoverQuery:cutoverQuery.trim(),unrelatedAdmissionQuery:unrelatedQuery.trim(),
  unrelatedSqlSubmitted:unrelatedResult.stdinEnded,exclusiveCutoverLockObserved:cutoverLockSnapshot,
  unrelatedShareLockWaitObserved:unrelatedWaitSnapshot,releaseOrder:'commit_cutover_then_unrelated_admission_rollback',
  unrelatedWaitObservedAfterMs,unrelatedAdmissionResumedAfterMs,
  cutoverExitCode:cutoverResult.code,unrelatedExitCode:unrelatedResult.code,
  finalFinancialEffects:{cashMovementsBefore:cashEffectsBeforeCutover,cashMovementsAfter:cashEffectsAfterCutover,
    unrelatedParentAdvisoryLocks:unrelatedParentLockCount},sessionsRemaining:0,
  reentrantSharedLocks:1,pausedRestaurantSqlstate:sqlState(pausedRestaurantAttempt.stderr),
  limitation:'shared transition lock also delays unrelated rubros while cutover holds exclusive lock'});
persistSqlEvidence();

persistSqlEvidence();
console.log(JSON.stringify({sql01:'PG_REAL_FUNCTIONS_PASS',sql02:'PG_CONTROLLED_LEAVES_PASS',
  sql03:'PG_CONTROLLED_LEAVES_PASS',sql04:'PG_CONTROLLED_LEAVES_PASS',sql05:'PG_CONTROLLED_LEAVES_PASS',
  sql06:'PG_CONTROLLED_LEAVES_PASS',sql07:'PG_REAL_FUNCTIONS_PASS_WITH_SYNTHETIC_AUTH',
  sql08:'PG_REAL_MULTI_SESSION_BOUNDED_RACES',sql09:'PG_REAL_FUNCTIONS_PASS',
  sql10:'PG_REAL_FUNCTIONS_PASS_GLOBAL_LOCK_WAIT_OBSERVED',results}));
