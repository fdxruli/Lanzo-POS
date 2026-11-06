import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
const database='fin01_cert_compatibility';
const q=sql=>queryLoopbackPostgres(sql,database);
const dir='docs/reports/customer-payment-sale-allocations-v1/compatibility';
const rows=JSON.parse(await fs.readFile(`${dir}/production-catalog.json`,'utf8'));
const tables=JSON.parse(await fs.readFile(`${dir}/production-tables.json`,'utf8'));
const lit=s=>`'${String(s).replaceAll("'","''")}'`;
const quoted=s=>`"${String(s).replaceAll('"','""')}"`;
if(!process.argv.includes('--base-already-prepared')) {
  execFileSync(process.execPath,['scripts/fin01/prepare-sale-allocation-fixture.mjs','--isolated-fixture','--compatibility'],{stdio:'inherit'});
}
// The V2 financial dispatcher declares the real restaurant row type and reads
// its global admission state even for sale.cancel. Reproduce those dependencies
// without enabling a different product flow or replacing financial functions.
const dispatcherTables=JSON.parse(await fs.readFile(`${dir}/production-dispatcher-tables.json`,'utf8'));
for(const table of dispatcherTables) {
  const exists=await q(`select to_regclass(${lit(table.schema_name+'.'+table.relname)}) is not null`);
  if(exists!=='t') {
    await q(`create table ${quoted(table.schema_name)}.${quoted(table.relname)} (${table.columns.map(c=>`${quoted(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.not_null?' not null':''}`).join(',')})`);

  }
}

const signature=row=>`${row.schema_name==='public'?'public.':''}${row.signature}`;
for(const row of rows) await q(`set check_function_bodies=off;${row.definition};`);
for(const row of rows) {
  const sig=signature(row);
  await q(`revoke all on function ${sig} from public,anon,authenticated,service_role;grant execute on function ${sig} to ${quoted(row.owner)};`);
  if(row.acl===null) await q(`grant execute on function ${sig} to public;`);
  else for(const grant of row.acl.slice(1,-1).split(',')) {
    const match=grant.match(/^([^=]*)=([^/]*)\//);assert.ok(match,grant);
    if(match[2].includes('X')) await q(`grant execute on function ${sig} to ${match[1]?quoted(match[1]):'public'}${match[2].includes('*')?' with grant option':''};`);
  }
}
for(const table of dispatcherTables) {
  for(const c of table.constraints.filter(c=>c.type!=='f')) {
    const exists=await q(`select exists(select 1 from pg_constraint where conrelid=${lit(table.schema_name+'.'+table.relname)}::regclass and conname=${lit(c.name)})`);
    if(exists!=='t') await q(`alter table ${quoted(table.schema_name)}.${quoted(table.relname)} add constraint ${quoted(c.name)} ${c.definition}`);
  }
}
await q('insert into private.restaurant_cloud_contract_state(singleton,writes_paused) select true,false where not exists(select 1 from private.restaurant_cloud_contract_state where singleton)');
const schemaResults=[];
for(const table of tables) {
  const local=JSON.parse(await q(`select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum)
    from pg_attribute a where a.attrelid=${lit(`public.${table.relname}`)}::regclass and a.attnum>0 and not a.attisdropped`));
  assert.deepEqual(local,table.columns.map(({name,type,not_null})=>({name,type,not_null})),`${table.relname} row type drift`);
  for(const constraint of table.constraints.filter(c=>c.type==='c')) {
    await q(`alter table public.${quoted(table.relname)} drop constraint if exists ${quoted(constraint.name)};
      alter table public.${quoted(table.relname)} add constraint ${quoted(constraint.name)} ${constraint.definition};`);
  }
  for(const trigger of table.triggers) {
    await q(`drop trigger if exists ${quoted(trigger.name)} on public.${quoted(table.relname)};${trigger.definition};`);
  }
  schemaResults.push({table:table.relname,row_type:'MATCH',checks:'ACTUAL_PRODUCTION',triggers:table.triggers.map(t=>t.name)});
}
const installed=[];
for(const row of rows) {
  const state=JSON.parse(await q(`select jsonb_build_object('sha256',encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid),E'\\r',''),'UTF8'),'sha256'),'hex'),
    'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'config',proconfig,
    'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
    from pg_proc p where p.oid=${lit(signature(row))}::regprocedure`));
  assert.equal(state.sha256,row.sha256,`${row.signature}: definition drift`);
  assert.equal(state.owner,row.owner);assert.equal(state.security_definer,row.security_definer);assert.deepEqual(state.config,row.proconfig);
  for(const role of ['anon','authenticated','service_role']) assert.equal(state[role],row.acl===null||row.acl.includes(`${role}=X`)||row.acl.includes(',=X'),`${row.signature}: ${role} privileges`);
  installed.push({signature:signature(row),...state});
}
await fs.mkdir('work/sql-compatibility',{recursive:true});
await fs.writeFile('work/sql-compatibility/installed-production-parity.json',JSON.stringify({installed,schemaResults},null,2));
if(!process.argv.includes('--baseline-only')) await q(await fs.readFile('supabase/migrations/20261106025114_customer_payment_sale_allocations_v1.sql','utf8'));
console.log(JSON.stringify({database,production_functions:installed.length,financial_tables:schemaResults.length,candidate_applied:!process.argv.includes('--baseline-only')}));
