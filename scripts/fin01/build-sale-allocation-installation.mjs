import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

// Generates review artifacts only. This script never opens a remote connection.
const q=sql=>queryLoopbackPostgres(sql,'fin01_cert_compatibility');
const dir='docs/reports/customer-payment-sale-allocations-v1/installation';
await fs.mkdir(dir,{recursive:true});
const canonical=await fs.readFile('supabase/migrations/20261106025114_customer_payment_sale_allocations_v1.sql','utf8');
const sha=createHash('sha256').update(canonical).digest('hex');
const catalog=JSON.parse(await fs.readFile('docs/reports/customer-payment-sale-allocations-v1/compatibility/production-catalog.json','utf8'));
const names=[...canonical.matchAll(/create or replace function ((?:private|public)\.[a-z0-9_]+)\(/gi)].map(x=>x[1]);
assert.equal(names.length,4);
const originals=names.map(name=>catalog.find(x=>`${x.schema_name}.${x.proname}`===name));assert.ok(originals.every(Boolean));
const signature=row=>row.schema_name==='public'?`public.${row.signature}`:row.signature;
const lit=s=>`'${String(s).replaceAll("'","''")}'`;
const current=[];
for(const row of originals) {
 current.push(JSON.parse(await q(`select jsonb_build_object('signature',${lit(signature(row))},
  'sha256',encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid),E'\\r',''),'UTF8'),'sha256'),'hex'),
  'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p where oid=${lit(signature(row))}::regprocedure`)));
}
const before=originals.map(row=>({signature:signature(row),sha256:row.sha256,owner:row.owner,security_definer:row.security_definer,config:row.proconfig,
 anon:row.acl===null||row.acl.includes('anon=X'),authenticated:row.acl===null||row.acl.includes('authenticated=X'),service_role:row.acl===null||row.acl.includes('service_role=X')}));
const canonicalLiteral=`$canonical_20261106025114$${canonical}$canonical_20261106025114$`;
assert.equal(canonical.includes('$canonical_20261106025114$'),false);
const check=(expected,installed)=>`with expected(signature,sha256,owner_name,definer,config,anon_exec,authenticated_exec,service_exec) as (values
${expected.map(x=>`(${lit(x.signature)},${lit(x.sha256)},${lit(x.owner)},${x.security_definer},${lit(JSON.stringify(x.config))}::jsonb,${x.anon},${x.authenticated},${x.service_role})`).join(',\n')}
), checks as (
 select e.signature,p.oid is not null as present,
   encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid),E'\\r',''),'UTF8'),'sha256'),'hex')=e.sha256 as body_matches,
   pg_get_userbyid(p.proowner)=e.owner_name and p.prosecdef=e.definer and to_jsonb(p.proconfig)=e.config as attributes_match,
   has_function_privilege('anon',p.oid,'EXECUTE')=e.anon_exec
     and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.authenticated_exec
     and has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_exec as permissions_match
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), ledger as (select ${installed?`count(*)=1 and bool_and(name='customer_payment_sale_allocations_v1' and statements=array[${canonicalLiteral}])`:'count(*)=0'} as matches
 from supabase_migrations.schema_migrations where version='20261106025114')
select jsonb_build_object('all_ok',coalesce(bool_and(present and body_matches and attributes_match and permissions_match),false) and (select matches from ledger),
 'functions',jsonb_agg(to_jsonb(checks) order by signature),'ledger_matches',(select matches from ledger)) from checks`;
const pre=check(before,false),post=check(current,true);
await fs.writeFile(`${dir}/preflight.sql`,`-- READ ONLY. Expected original functions and version absent.\n${pre};\n`);
await fs.writeFile(`${dir}/postflight.sql`,`-- READ ONLY. Expected reviewed functions and exact canonical ledger entry.\n${post};\n`);
const body=canonical.replace(/^[\s\S]*?\bbegin;/i,'').replace(/\bcommit;\s*$/i,'');
const rollback=originals.map((r,i)=>`$restore_${i}$${r.definition};$restore_${i}$`).join(',\n');
const packet=`-- REVIEW ONLY: owner authorization required. DO NOT run as part of CI.\n-- Canonical version 20261106025114; SHA-256 ${sha}\n-- Exactly four existing functions and one canonical migration-ledger row.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='45s';\ndo $preflight$ begin\n if not ((${pre})->>'all_ok')::boolean then raise exception 'CUSTOMER_ALLOCATION_PREFLIGHT_FAILED';end if;\nend $preflight$;\n${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements,rollback) values (
 '20261106025114','customer_payment_sale_allocations_v1',array[${canonicalLiteral}],array[${rollback}]);\ndo $postflight$ begin\n if not ((${post})->>'all_ok')::boolean then raise exception 'CUSTOMER_ALLOCATION_POSTFLIGHT_FAILED';end if;\nend $postflight$;\ncommit;\n`;
await fs.writeFile(`${dir}/apply-exact-version.sql`,packet);
await fs.writeFile(`${dir}/restore-original-functions.sql.txt`,originals.map(r=>r.definition+';').join('\n'));
await fs.writeFile(`${dir}/manifest.json`,JSON.stringify({project:'odlrhijtfyavryeqivaa',version:'20261106025114',name:'customer_payment_sale_allocations_v1',canonical_sha256:sha,
 packet_sha256:createHash('sha256').update(packet).digest('hex'),functions:names,expected_before:before,expected_after:current,production_installed:false,manual_qa:'NOT_RUN'},null,2)+'\n');
console.log(JSON.stringify({canonical_sha256:sha,packet_sha256:createHash('sha256').update(packet).digest('hex'),functions:names}));
