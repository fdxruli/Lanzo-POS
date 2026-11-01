-- SEPARATE SHARED-ACL PROPOSAL. NOT AUTHORIZED FOR PERSISTENT APPLICATION.
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
