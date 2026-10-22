// Generates a rollback-only consumer rehearsal; private inputs stay in .tmp.
import { readFileSync,writeFileSync } from 'node:fs';
const folder=process.argv.find(a=>a.startsWith('--folder='))?.slice(9)??'.tmp/ecom-native-1a3';
const completeCash=process.argv.includes('--complete-cash');
const f=JSON.parse(readFileSync(`${folder}/private-fixtures.json`));
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const proposal=readFileSync('supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-proposal.sql','utf8');
const sql=`begin;
set local statement_timeout='25s';set local lock_timeout='2s';
create temp table acl_targets(signature text primary key);
insert into acl_targets values
 ('public.admin_list_staff_users(text,text,text,text)'),
 ('public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)'),
 ('public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)'),
 ('public.pos_get_cash_station_state(text,text,text,text)'),
 ('public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'),
 ('public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)');
create temp table acl_before as select r.rolname,t.signature,has_function_privilege(r.oid,t.signature::regprocedure,'EXECUTE') allowed from pg_roles r cross join acl_targets t;
create temp table acl_bodies as select signature,md5(pg_get_functiondef(signature::regprocedure)) body from acl_targets;
create temp table acl_results(id text,ok boolean,detail jsonb);
grant lanzo_ecom_bridge_receiver to postgres;
grant insert,select on acl_results to lanzo_ecom_bridge_receiver,anon,authenticated,service_role;
grant select on acl_targets to lanzo_ecom_bridge_receiver;
${proposal}
do $$ declare t record;args text;begin
 for t in select signature from acl_targets loop
  select string_agg('NULL::'||format_type(a,null),',') into args from pg_proc p cross join lateral unnest(p.proargtypes) a where p.oid=t.signature::regprocedure;
  begin
   set local role lanzo_ecom_bridge_receiver;
   execute 'select '||split_part(t.signature,'(',1)||'('||args||')';
   reset role;
   insert into acl_results values('RECEIVER-'||t.signature,false,'{}');
  exception when insufficient_privilege then
   reset role;insert into acl_results values('RECEIVER-'||t.signature,true,jsonb_build_object('sqlstate',SQLSTATE));
  end;
 end loop;
end $$;
create temp table consumer_context(value jsonb);
insert into consumer_context values(${q(JSON.stringify({capture:f.captures[1],tenant:f.tenants[1]}))}::jsonb);
grant select on consumer_context to anon,authenticated,service_role;
-- Only this run's synthetic tenant, rolled back. No commercial rows altered.
update public.licenses set features=features||'{"cloud_pos_sync":true,"cloud_cash_sync":true}'::jsonb
where id=${q(f.tenants[1].id)} and license_key=${q(f.tenants[1].key)};
${['anon','authenticated','service_role'].map(role=>`
${completeCash?`insert into public.pos_cash_sessions(id,license_id,device_id,actor_key,responsible_name,device_role,opening_amount,expected_cash_total,server_version)
 values('qa-acl-cash-${role}-${f.run}',${q(f.tenants[1].id)},${q(f.tenants[1].device2)},'admin_device:qa-acl-${role}-${f.run}','QA ACL synthetic','admin',0,0,1);`:''}
set local role ${role};
do $$ declare c jsonb;t jsonb;r jsonb;created uuid;begin
 select value->'capture',value->'tenant' into c,t from consumer_context;
 r:=public.admin_list_staff_users(c->>'license_key',c->>'device_fingerprint',c->>'security_token',c->>'actor_session_token');
 insert into acl_results values('${role}-STAFF-LIST',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code'));
 r:=public.admin_create_staff_user(c->>'license_key',c->>'device_fingerprint',c->>'security_token','qaacl-${role}-'||substr(t->>'id',1,8),gen_random_uuid()::text,'QA ACL','{"ecommerce":true}'::jsonb,'staff',c->>'actor_session_token');
 created:=(r->'staff_user'->>'id')::uuid;
 insert into acl_results values('${role}-STAFF-CREATE',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code'));
 r:=public.admin_update_staff_user(c->>'license_key',c->>'device_fingerprint',c->>'security_token',created,'QA ACL updated','{"ecommerce":true}'::jsonb,true,null,'staff',c->>'actor_session_token');
 insert into acl_results values('${role}-STAFF-UPDATE',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code'));
 begin
 r:=public.pos_get_cash_station_state(c->>'license_key',c->>'device_fingerprint',c->>'security_token',c->>'actor_session_token');
 insert into acl_results values('${role}-CASH-STATE',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code','status',r->>'financial_status'));
 exception when others then insert into acl_results values('${role}-CASH-STATE',false,jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM));end;
 ${completeCash?`begin
 r:=public.pos_admin_adopt_legacy_cash_session(c->>'license_key',c->>'device_fingerprint',c->>'security_token',c->>'actor_session_token','qa-acl-cash-${role}-${f.run}',1,'qa-acl-adopt-${role}-${f.run}');
 insert into acl_results values('${role}-CASH-ADOPT',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code'));
 r:=public.pos_admin_close_cash_session(c->>'license_key',c->>'device_fingerprint',c->>'security_token',c->>'actor_session_token','qa-acl-cash-${role}-${f.run}','admin_audited',0,0,'historical_test','QA rollback-only',2,'qa-acl-close-${role}-${f.run}');
 insert into acl_results values('${role}-CASH-CLOSE',r->'success'='true'::jsonb,jsonb_build_object('code',r->>'code','status',r->'cash_session'->>'status'));
 exception when others then insert into acl_results values('${role}-CASH-OPERATIONS',false,jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM));end;`:''}
end $$;
reset role;`).join('\n')}
select jsonb_build_object('checks',(select jsonb_agg(to_jsonb(r)) from acl_results r),
 'matrix',(select jsonb_agg(jsonb_build_object('role',b.rolname,'signature',b.signature,'before',b.allowed,'after',has_function_privilege(b.rolname,b.signature::regprocedure,'EXECUTE'))) from acl_before b),
 'unchanged_bodies',(select bool_and(body=md5(pg_get_functiondef(signature::regprocedure))) from acl_bodies),
 'memberships',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'inherit',inherit_option,'set',set_option)) from pg_auth_members));
rollback;`;
writeFileSync(`${folder}/acl-rehearsal.sql`,sql);console.log('Generated private rollback-only ACL rehearsal.');
