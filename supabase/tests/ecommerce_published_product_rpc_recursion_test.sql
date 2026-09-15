-- ECOMMERCE PUBLISHED PRODUCT RPC RECURSION regression contract.
-- Read-only function/privilege assertions; no fixture or business data writes.
begin;

do $test$
declare
  v_legacy text;
  v_legacy_staff text;
  v_v2 text;
  v_v3 text;
  v_core text;
  v_core_oid oid := 'private.ecommerce_admin_upsert_published_product_core(text,text,text,text,jsonb)'::regprocedure;
begin
  select pg_get_functiondef('public.ecommerce_admin_upsert_published_product(text,text,text,jsonb)'::regprocedure)
    into v_legacy;
  select pg_get_functiondef('public.ecommerce_admin_upsert_published_product(text,text,text,text,jsonb)'::regprocedure)
    into v_legacy_staff;
  select pg_get_functiondef('public.ecommerce_admin_upsert_published_product_v2(text,text,text,text,jsonb)'::regprocedure)
    into v_v2;
  select pg_get_functiondef('public.ecommerce_admin_upsert_published_product_v3(text,text,text,text,jsonb)'::regprocedure)
    into v_v3;
  select pg_get_functiondef(v_core_oid)
    into v_core;

  if position('public.ecommerce_admin_upsert_published_product_v3(' in lower(v_legacy)) = 0
     or position('public.ecommerce_admin_upsert_published_product_v3(' in lower(v_legacy_staff)) = 0 then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: legacy writer no longer aliases v3';
  end if;
  if position('public.ecommerce_admin_upsert_published_product_v2(' in lower(v_v3)) = 0
     or position('public.ecommerce_admin_upsert_published_product(' in lower(v_v3)) > 0 then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: v3 call graph is invalid';
  end if;
  if position('private.ecommerce_admin_upsert_published_product_core(' in lower(v_v2)) = 0
     or position('public.ecommerce_admin_upsert_published_product(' in lower(v_v2)) > 0 then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: v2 call graph is invalid';
  end if;
  if position('public.ecommerce_admin_upsert_published_product(' in lower(v_core)) > 0
     or position('public.ecommerce_admin_upsert_published_product_v2(' in lower(v_core)) > 0
     or position('public.ecommerce_admin_upsert_published_product_v3(' in lower(v_core)) > 0 then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: private core calls a public writer';
  end if;

  if has_function_privilege('anon', v_core_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_core_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_core_oid, 'EXECUTE') then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: private core is client-callable';
  end if;
  if (select prosecdef from pg_proc where oid = v_core_oid) then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: core should not need SECURITY DEFINER';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.ecommerce_admin_upsert_published_product_v2(text,text,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'ECOMMERCE_RPC_RECURSION_TEST: v2 service-role grant is missing';
  end if;
end;
$test$;

rollback;
