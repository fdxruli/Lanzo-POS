-- SECURITY.TENANT.ACTOR.HARDENING.R1 runtime contract.
-- Catalog-only assertions; no business rows, licenses, devices, or sessions
-- are created or changed by this test.

begin;

do $security$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)'::regprocedure,
    'public.admin_list_staff_users(text,text,text,text)'::regprocedure,
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)'::regprocedure,
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'::regprocedure,
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'::regprocedure,
    'public.pos_get_cash_station_state(text,text,text,text)'::regprocedure
  ]
  loop
    if has_function_privilege('public', v_signature, 'EXECUTE')
       or not has_function_privilege('anon', v_signature, 'EXECUTE')
       or not has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'SENSITIVE_RPC_PRIVILEGE_REGRESSION: %', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text)'::regprocedure,
    'public.admin_list_staff_users(text,text,text)'::regprocedure,
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text)'::regprocedure,
    'public.ecommerce_admin_get_portal(text,text,text)'::regprocedure,
    'public.ecommerce_admin_list_published_products(text,text,text)'::regprocedure,
    'public.ecommerce_admin_set_product_published(text,text,text,uuid,boolean)'::regprocedure,
    'public.ecommerce_admin_upsert_portal(text,text,text,jsonb)'::regprocedure,
    'public.ecommerce_admin_upsert_published_product(text,text,text,jsonb)'::regprocedure
  ]
  loop
    if has_function_privilege('public', v_signature, 'EXECUTE')
       or has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'ACTORLESS_OVERLOAD_NOT_RETAINED_AND_FENCED: %', v_signature;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config
        where config like 'search_path=%'
      )
  ) then
    raise exception 'SECURITY_DEFINER_SEARCH_PATH_REGRESSION';
  end if;

  foreach v_signature in array array[
    'private.broadcast_license_event()'::regprocedure,
    'private.broadcast_pos_event(uuid,jsonb)'::regprocedure,
    'private.broadcast_ecommerce_order_change_v1(uuid,uuid,text,text)'::regprocedure,
    'private.broadcast_notification_event(uuid,text,text,uuid,uuid,jsonb)'::regprocedure
  ]
  loop
    v_definition := lower(pg_get_functiondef(v_signature));
    if position('''kind'', ''invalidate''' in v_definition) = 0
       or position('''metadata''' in v_definition) > 0
       or position('''order_id''' in v_definition) > 0
       or position('''entity_id''' in v_definition) > 0
       or position('''actor_device_id''' in v_definition) > 0
       or position('''actor_staff_user_id''' in v_definition) > 0
       or position('''notification_id''' in v_definition) > 0
       or position('''ticket_id''' in v_definition) > 0 then
      raise exception 'REALTIME_INVALIDATION_PAYLOAD_REGRESSION: %', v_signature;
    end if;
  end loop;
end;
$security$;

rollback;
