-- ECOM.RPC.1.2 - Adaptador privado para el rate limiter de pedidos ecommerce.
-- Alcance: helper privado y correccion puntual de public.ecommerce_create_order.
-- No modifica frontend ni modulos POS.

do $precheck$
begin
  if to_regprocedure(
    'public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)'
  ) is null then
    raise exception 'ECOM_RPC_1_2_RATE_LIMITER_SIGNATURE_NOT_FOUND';
  end if;

  if to_regprocedure(
    'public.ecommerce_create_order(text,jsonb,jsonb,text)'
  ) is null then
    raise exception 'ECOM_RPC_1_2_CREATE_ORDER_SIGNATURE_NOT_FOUND';
  end if;
end;
$precheck$;

create or replace function private.ecommerce_enforce_create_order_rate_limit(
  p_portal_id uuid,
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_portal_id is null or p_license_id is null then
    raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';
  end if;

  return public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-license:' || p_license_id::text,
    p_device_fingerprint := 'public-store-portal:' || p_portal_id::text,
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_create_order',
    p_scope := 'ECOMMERCE_CREATE_ORDER',
    p_max_attempts := 20,
    p_window_seconds := 600,
    p_block_seconds := 900,
    p_code := 'ECOMMERCE_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'source', 'ecommerce_public_store',
      'portal_id', p_portal_id,
      'license_id', p_license_id,
      'phase', 'ECOM.RPC.1.2'
    )
  );
end;
$function$;

revoke all on function private.ecommerce_enforce_create_order_rate_limit(uuid, uuid)
from public, anon, authenticated;

do $patch$
declare
  v_function_oid oid;
  v_definition text;
  v_old_call text := $old$
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    'ECOMMERCE_CREATE_ORDER',
    v_portal.license_id::text,
    null,
    20,
    600,
    900
  );$old$;
  v_new_call text := $new$
  v_rate_limit := private.ecommerce_enforce_create_order_rate_limit(
    v_portal.id,
    v_portal.license_id
  );$new$;
begin
  select p.oid
  into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_create_order'
    and pg_get_function_identity_arguments(p.oid)
      = 'p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text';

  if v_function_oid is null then
    raise exception 'ECOM_RPC_1_2_CREATE_ORDER_SIGNATURE_NOT_FOUND';
  end if;

  v_definition := pg_get_functiondef(v_function_oid);

  if strpos(v_definition, v_new_call) > 0 then
    null;
  elsif strpos(v_definition, v_old_call) > 0 then
    v_definition := replace(v_definition, v_old_call, v_new_call);
    execute v_definition;
  else
    raise exception 'ECOM_RPC_1_2_EXPECTED_RATE_LIMIT_CALL_NOT_FOUND';
  end if;
end;
$patch$;

revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text)
from public;

grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text)
to anon, authenticated;
