begin; set local lock_timeout='2s';set local statement_timeout='15s';create role qa_acl_ecom_1a1 nologin noinherit nobypassrls;grant qa_acl_ecom_1a1 to postgres;-- SEPARATE SHARED-ACL PROPOSAL. NOT AUTHORIZED FOR PERSISTENT APPLICATION.
-- Consumers anon/authenticated/service_role have explicit EXECUTE already.
-- Preserve these grants and internal function bodies; remove only PUBLIC.
-- Review other platform/custom-role consumers before any actual deployment.
do $gate$
declare signature text; f oid; r text;
begin
  foreach signature in array array[
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)']
  loop
    f := signature::regprocedure;
    foreach r in array array['anon','authenticated','service_role'] loop
      if not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
          join pg_roles grantee on grantee.oid=a.grantee
          where p.oid=f and grantee.rolname=r and a.privilege_type='EXECUTE') then
        raise exception 'ECOM_ACL_EXPLICIT_CONSUMER_GRANT_REQUIRED';
      end if;
    end loop;
  end loop;
end;
$gate$;
revoke execute on function public.admin_list_staff_users(text,text,text,text) from public;
revoke execute on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text) from public;
revoke execute on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text) from public;
revoke execute on function public.pos_get_cash_station_state(text,text,text,text) from public;
revoke execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public;
revoke execute on function public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text) from public;

create temp table qa_acl_denials(statement text,status text,sqlstate text);do $test$ declare q text; denied boolean; state text;begin foreach q in array array['select public.admin_list_staff_users(null::text,null::text,null::text,null::text)','select public.admin_create_staff_user(null::text,null::text,null::text,null::text,null::text,null::text,null::jsonb,null::text,null::text)','select public.admin_update_staff_user(null::text,null::text,null::text,null::uuid,null::text,null::jsonb,null::boolean,null::text,null::text,null::text)','select public.pos_get_cash_station_state(null::text,null::text,null::text,null::text)','select public.pos_admin_close_cash_session(null::text,null::text,null::text,null::text,null::text,null::text,null::numeric,null::numeric,null::text,null::text,null::integer,null::text)','select public.pos_admin_adopt_legacy_cash_session(null::text,null::text,null::text,null::text,null::text,null::integer,null::text)'] loop denied:=false;state:=null;begin execute 'set local role qa_acl_ecom_1a1';execute q;exception when insufficient_privilege then denied:=true;state:=SQLSTATE;end;execute 'reset role';insert into qa_acl_denials values(q,case when denied then 'PASS' else 'FAIL' end,state);end loop;end;$test$;select * from qa_acl_denials;rollback;