import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
const compatibility = process.argv.includes('--compatibility');
const database = compatibility ? 'fin01_cert_compatibility' : 'fin01_cert_allocations';
const q = sql => queryLoopbackPostgres(sql, database);
assert.equal(await q('select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (\'public\',\'private\')'), '0', 'Requires a new empty disposable database');
await mkdir('work/fixture', {recursive:true});
const read = path => readFile(path,'utf8');
for(const name of ['isolated-schema.sql','extra-functions.sql','isolated-cancel-payment.sql']) {
  const sql=execFileSync('unzip',['-p','docs/reports/fin01-r22/raw-evidence.zip',name],{encoding:'utf8',maxBuffer:8*1024*1024});
  await writeFile(`work/fixture/${name}`,sql);
  await q(sql);
}
await q(await read('supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql'));
const financial=await read('supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql');
await q(financial.slice(financial.indexOf('create table if not exists public.pos_financial_operations'),financial.indexOf('-- Portable V1 JSON bytes')));
const v2=await read('supabase/migrations/20261023033028_fin01_cloud_sync_protocol_v2_r1.sql');
// Actual canonical V2 admission, write guards, rate limiting, projections and
// envelope, without the unrelated top-level production hash/install prerequisites.
const prefix=v2.slice(v2.indexOf('-- R5 is deliberately'),v2.indexOf('create or replace function public.pos_fin01_sync_contract_v1('));
await q(prefix);
const fn = (source,name) => {
  const start=source.toLowerCase().indexOf(`create or replace function ${name}(`);
  assert.ok(start>=0,name);
  const body=source.slice(start);
  const marker=body.match(/as\s+(\$[a-z_]*\$)/i)[1];
  return body.slice(0,body.indexOf(marker+';',body.indexOf(marker)+marker.length)+(marker+';').length);
};
for(const name of ['public.pos_record_customer_payment_v2','public.pos_get_customer_credit_summary_v2']) await q(fn(v2,name));
const sales=await read('supabase/migrations/20260625112333_fase6a_ventas_cloud_base.sql');
await q(fn(sales,'public.pos_pull_sales_changes'));
let seed=await read('scripts/fin01/seed.sql');
seed=seed.replace('insert into public.license_devices',`select private.pos_fin01_set_clean_qa_protocol_v2('10000000-0000-0000-0000-000000000001',2,1,'Synthetic loopback allocation fixture');\ninsert into public.license_devices`);
seed=seed.replace('select private.resolve_cash_station_for_device', `select private.pos_fin01_enter_pilot_v2('{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]}','fixture-a','device-a','synthetic-device','owner-session-a');\nselect private.resolve_cash_station_for_device`);
seed=seed.replace('commit;', "select private.pos_fin01_leave_pilot_v2('10000000-0000-0000-0000-000000000001');commit;");
await q(seed);
// Recovered read-only catalog capture closes the original legacy-summary gap.
const sharedSummary=JSON.parse(await read('docs/reports/customer-payment-sale-allocations-v1/compatibility/production-catalog.json'))
  .find(row=>row.proname==='pos_get_customer_credit_summary_unlimited');
await q(sharedSummary.definition+';');
await q('revoke all on function public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text) from public;grant execute on function public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text) to service_role;');
// Restore the captured core ACLs and canonical V2 ACLs, since the supplementary
// capture creates functions after the base fixture's blanket REVOKE.
const acl=await read('supabase/tests/fixtures/pr338-real-financial/06-function-acl.sql');
for(const name of ['pos_record_customer_payment_unlimited','pos_cancel_cloud_sale_unlimited']) {
  const line=acl.split('\n').find(line=>line.includes(`"${name}"`));
  assert.ok(line,`Captured ACL ${name}`);await q(line);
}
await q(`revoke all on function public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb) from public;
  grant execute on function public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb) to anon,authenticated;
  revoke all on function public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb) from public;
  grant execute on function public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb) to anon,authenticated;`);
const metadata = () => q(`select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object(
  'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'security_definer',p.prosecdef,
  'sha256',encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid), E'\\r',''),'UTF8'),'sha256'),'hex')))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in
  (('private','pos_sale_to_jsonb'),('public','pos_record_customer_payment_unlimited'),
   ('public','pos_cancel_cloud_sale_unlimited'),('public','pos_get_customer_credit_summary_unlimited'),('public','pos_get_customer_credit_summary_v2'))`);
const before=JSON.parse(await metadata());
await writeFile('work/fixture/baseline-function-metadata.json',JSON.stringify(before,null,2));
if (!compatibility) await q(await read('supabase/migrations/20261106025114_customer_payment_sale_allocations_v1.sql'));
const after=JSON.parse(await metadata());
for(const [signature,old] of Object.entries(before)) {
  for(const field of ['owner','acl','security_definer']) assert.deepEqual(after[signature][field],old[field],`${signature} ${field}`);
}
await writeFile('work/fixture/candidate-function-metadata.json',JSON.stringify(after,null,2));
console.log(await q('show server_version'));
console.log('SALE_ALLOCATION_FIXTURE_READY');
