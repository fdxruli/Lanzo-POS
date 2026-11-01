-- Run after foundation.sql + bridge.sql + generated fixtures.sql and
-- test-context.sql, inside ONE BEGIN ... ROLLBACK. Never remove rollback.
create temp table native_qa_results(id text primary key,pass boolean);
create function pg_temp.native_check(p_id text,p_pass boolean) returns void language plpgsql as $$
begin
 insert into native_qa_results values(p_id,p_pass);
 if p_pass is not true then raise exception 'NATIVE_QA_FAILED:%',p_id;end if;
end $$;
do $$
declare c record; p jsonb; r jsonb; grant_id uuid; lease uuid; signature text; server_only boolean:=true;
begin
 select * into strict c from pg_temp.ecom_native_context;
 foreach signature in array array[
  'public.lanzo_ecom_bridge_qa_prepare(jsonb)',
  'public.lanzo_ecom_bridge_qa_finish(jsonb)',
  'public.lanzo_ecom_bridge_qa_abort(jsonb)',
  'public.lanzo_ecom_bridge_qa_revoke(uuid)',
  'public.lanzo_ecom_bridge_qa_publish(uuid,uuid)',
  'public.lanzo_ecom_bridge_qa_collect()'] loop
  server_only:=server_only and has_function_privilege('service_role',signature,'EXECUTE')
   and not has_function_privilege('anon',signature,'EXECUTE')
   and not has_function_privilege('authenticated',signature,'EXECUTE')
   and not has_function_privilege('lanzo_ecom_bridge_receiver',signature,'EXECUTE');
 end loop;
 perform pg_temp.native_check('SERVER-RPCS-EXACT-ACL',server_only);
 p:=c.p;
 r:=public.lanzo_ecom_bridge_qa_prepare(p);grant_id:=(r->>'id')::uuid;lease:=(r->>'lease_id')::uuid;
 perform pg_temp.native_check('AUTH-01',r->>'code'='RESERVED');
 r:=public.lanzo_ecom_bridge_qa_prepare(p);
 perform pg_temp.native_check('CONCURRENT-LEASE',r->>'code'='BUSY');
 r:=public.lanzo_ecom_bridge_qa_prepare(p||'{"actor_session_token":"invalid"}');
 perform pg_temp.native_check('AUTH-02',r->>'code'='DENIED');
 r:=public.lanzo_ecom_bridge_qa_prepare(p||jsonb_build_object('actor_session_token',c.denied_token));
 perform pg_temp.native_check('AUTH-03',r->>'code'='DENIED');
 r:=public.lanzo_ecom_bridge_qa_prepare(p||jsonb_build_object('license_key',c.other_license_key));
 perform pg_temp.native_check('AUTH-06',r->>'code'='DENIED');
 update public.license_devices set is_active=false where id=c.device_a;
 r:=public.lanzo_ecom_bridge_qa_prepare(p);
 perform pg_temp.native_check('AUTH-04',r->>'code'='DENIED');
 update public.license_devices set is_active=true where id=c.device_a;
 update public.license_admin_sessions set revoked_at=clock_timestamp() where id=c.session_a;
 r:=public.lanzo_ecom_bridge_qa_prepare(p);
 perform pg_temp.native_check('AUTH-05',r->>'code'='DENIED');
 update public.license_admin_sessions set revoked_at=null where id=c.session_a;
 perform public.lanzo_ecom_bridge_qa_revoke(grant_id);
 r:=public.lanzo_ecom_bridge_qa_publish(grant_id,gen_random_uuid());
 perform pg_temp.native_check('AUTH-12-SQL',r->>'code'='EXCLUDED');
 perform pg_temp.native_check('ABORT-REVOKED-LEASE',public.lanzo_ecom_bridge_qa_abort(jsonb_build_object('id',grant_id,'lease_id',lease)));
 r:=public.lanzo_ecom_bridge_qa_prepare(p);
 perform pg_temp.native_check('AUTH-13',r->>'code'='DENIED');
end $$;
select jsonb_agg(to_jsonb(r) order by id) results from native_qa_results r;
