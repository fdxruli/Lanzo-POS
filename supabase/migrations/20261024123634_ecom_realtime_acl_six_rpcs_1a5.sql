-- Exact, separately approved PUBLIC EXECUTE revokes for the six ACL-gated RPCs.
-- Snapshot preflight binds this migration to the live bodies and grants observed
-- in Production on 2026-10-24. This file does not alter function bodies, explicit
-- API-role grants, RLS policies, business data, or the Realtime publication.
begin;

do $preflight$
declare
  v_signature text;
  v_expected_md5 text;
  v_function oid;
  v_role_count integer;
  v_effective_count integer;
  v_explicit_count integer;
begin
  select count(*) into v_role_count from pg_catalog.pg_roles;
  if v_role_count <> 31 then
    raise exception 'ECOM_ACL_ROLE_MATRIX_CHANGED: expected 31 roles, found %', v_role_count;
  end if;

  foreach v_signature in array array[
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'
  ] loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'ECOM_ACL_SIGNATURE_MISSING: %', v_signature;
    end if;

    v_expected_md5 := case v_signature
      when 'public.admin_list_staff_users(text,text,text,text)' then '717d41ff4d188c89b5f00a2f61166ca7'
      when 'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)' then '89e845b034030c0c6cf2689cfd4e7b78'
      when 'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)' then 'ca00191aa85af9641bb0650d058b2866'
      when 'public.pos_get_cash_station_state(text,text,text,text)' then '675ef683a0c2ce92a39deb29ab4b81c3'
      when 'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)' then '957a49d539846acd7fa92b254fca113a'
      when 'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)' then 'afb412158b7808449d4f7f4e774e4256'
      else null
    end;

    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_function
        and p.prosecdef is true
        and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) = v_expected_md5
    ) then
      raise exception 'ECOM_ACL_FUNCTION_BODY_OR_SECURITY_CHANGED: %', v_signature;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      where p.oid = v_function and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'ECOM_ACL_PUBLIC_GRANT_MISSING: %', v_signature;
    end if;

    select count(distinct grantee.rolname)
      into v_explicit_count
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
    where p.oid = v_function
      and a.privilege_type = 'EXECUTE'
      and a.grantee <> p.proowner
      and grantee.rolname in ('anon', 'authenticated', 'service_role');
    if v_explicit_count <> 3 then
      raise exception 'ECOM_ACL_EXPLICIT_API_GRANTS_CHANGED: %', v_signature;
    end if;

    select count(*) into v_effective_count
    from pg_catalog.pg_roles r
    where pg_catalog.has_function_privilege(r.rolname, v_function, 'EXECUTE');
    if v_effective_count <> 31 then
      raise exception 'ECOM_ACL_EFFECTIVE_ROLE_MATRIX_CHANGED: % has % roles', v_signature, v_effective_count;
    end if;
  end loop;
end;
$preflight$;

revoke execute on function public.admin_list_staff_users(text,text,text,text) from public;
revoke execute on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text) from public;
revoke execute on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text) from public;
revoke execute on function public.pos_get_cash_station_state(text,text,text,text) from public;
revoke execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public;
revoke execute on function public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text) from public;

do $postflight$
declare
  v_signature text;
  v_expected_md5 text;
  v_function oid;
  v_role_count integer;
begin
  foreach v_signature in array array[
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'
  ] loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    v_expected_md5 := case v_signature
      when 'public.admin_list_staff_users(text,text,text,text)' then '717d41ff4d188c89b5f00a2f61166ca7'
      when 'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)' then '89e845b034030c0c6cf2689cfd4e7b78'
      when 'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)' then 'ca00191aa85af9641bb0650d058b2866'
      when 'public.pos_get_cash_station_state(text,text,text,text)' then '675ef683a0c2ce92a39deb29ab4b81c3'
      when 'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)' then '957a49d539846acd7fa92b254fca113a'
      when 'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)' then 'afb412158b7808449d4f7f4e774e4256'
      else null
    end;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      where p.oid = v_function and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'ECOM_ACL_PUBLIC_EXECUTE_REMAINS: %', v_signature;
    end if;

    if not pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'ECOM_ACL_EXPLICIT_API_GRANT_LOST: %', v_signature;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_function
        and p.prosecdef is true
        and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) = v_expected_md5
    ) then
      raise exception 'ECOM_ACL_FUNCTION_BODY_CHANGED: %', v_signature;
    end if;

    select count(*) into v_role_count
    from pg_catalog.pg_roles r
    where pg_catalog.has_function_privilege(r.rolname, v_function, 'EXECUTE');
    if v_role_count <> 5 then
      raise exception 'ECOM_ACL_POSTFLIGHT_ROLE_MATRIX_CHANGED: % has % roles', v_signature, v_role_count;
    end if;
  end loop;
end;
$postflight$;

commit;
