-- ECOM.POS.3.1 structural SQL contract test.
-- Ejecutar despues de aplicar las migraciones en un entorno de prueba.
-- No modifica datos permanentes.

begin;

do $contract_test$
declare
  v_release_def text;
  v_cancel_def text;
  v_state_def text;
  v_begin_def text;
  v_complete_def text;
begin
  select lower(pg_get_functiondef(
    'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)'::regprocedure
  )) into v_release_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_cancel_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_cancel_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)'::regprocedure
  )) into v_state_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_begin_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_complete_def;

  if v_release_def not like '%for update%' then
    raise exception 'admin release must lock the ecommerce order with FOR UPDATE';
  end if;
  if v_release_def not like '%ecommerce_pos_conversion_already_completed%' then
    raise exception 'admin release must reject completed conversions';
  end if;
  if v_release_def not like '%ecommerce_pos_conversion_review_required%' then
    raise exception 'admin release must fail closed when sale verification is inconclusive';
  end if;
  if v_release_def not like '%pos_conversion_admin_released%' then
    raise exception 'admin release must create the dedicated audit event';
  end if;
  if v_release_def not like '%pos_conversion_actor_ref <> v_auth->>''device_id''%' then
    raise exception 'a normal device must not release a reservation owned by another device';
  end if;

  if v_release_def not like '%pos_conversion_status = ''idle''%'
     or v_release_def not like '%pos_conversion_attempt_id = null%'
     or v_release_def not like '%pos_conversion_sale_id = null%'
     or v_release_def not like '%pos_conversion_key = null%'
     or v_release_def not like '%pos_conversion_actor_ref = null%'
     or v_release_def not like '%pos_conversion_started_at = null%' then
    raise exception 'admin release does not clear every reservation field atomically';
  end if;

  if v_cancel_def not like '%private.ecommerce_pos_sale_lookup_v2%'
     or v_release_def not like '%private.ecommerce_pos_sale_lookup_v2%' then
    raise exception 'normal and administrative release must verify remote sale absence';
  end if;

  if v_state_def not like '%''contractversion'', 2%'
     or v_begin_def not like '%''contractversion'', 2%'
     or v_complete_def not like '%''contractversion'', 2%' then
    raise exception 'the ecommerce conversion contract must remain at version 2';
  end if;

  if to_regprocedure('public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)') is null
     or to_regprocedure('public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('public.ecommerce_cancel_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null then
    raise exception 'one or more required ecommerce conversion RPCs are missing';
  end if;

  if has_function_privilege(
       'anon',
       'private.ecommerce_pos_sale_lookup_v2(uuid,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'private.ecommerce_pos_sale_lookup_v2(uuid,text,text)',
       'execute'
     ) then
    raise exception 'private sale verification helper is executable by a client role';
  end if;

  if not has_function_privilege(
       'anon',
       'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'admin release compatibility grants were not preserved';
  end if;
end;
$contract_test$;

rollback;
