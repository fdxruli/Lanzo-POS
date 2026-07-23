create or replace function private.ecommerce_pos_sale_lookup_v2(
  p_license_id uuid,
  p_sale_id text,
  p_conversion_key text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sale_exists boolean := false;
begin
  if p_license_id is null
     or nullif(btrim(coalesce(p_sale_id, '')), '') is null
     or nullif(btrim(coalesce(p_conversion_key, '')), '') is null then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'Faltan identificadores para comprobar la venta asociada.'
    );
  end if;

  if to_regclass('public.pos_sales') is null then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'No esta disponible el registro remoto de ventas para verificar la reserva.'
    );
  end if;

  execute $lookup$
    select exists (
      select 1
      from public.pos_sales s
      where to_jsonb(s)->>'license_id' = $1::text
        and lower(coalesce(to_jsonb(s)->>'status', 'closed')) not in ('cancelled', 'deleted')
        and (
          to_jsonb(s)->>'id' = $2
          or to_jsonb(s)->>'local_sale_id' = $2
          or to_jsonb(s)->>'idempotency_key' = $3
          or to_jsonb(s)->'metadata'->>'idempotencyKey' = $3
          or to_jsonb(s)->'metadata'->>'ecommerceConversionKey' = $3
        )
    )
  $lookup$
  into v_sale_exists
  using p_license_id, p_sale_id, p_conversion_key;

  return jsonb_build_object(
    'success', true,
    'saleExists', v_sale_exists,
    'saleId', p_sale_id,
    'conversionKey', p_conversion_key
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'No se pudo comprobar si existe una venta asociada a la reserva.'
    );
end;
$function$;

create or replace function public.ecommerce_get_pos_conversion_state(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_is_claim_owner boolean := false;
  v_claim_valid boolean := false;
  v_is_conversion_owner boolean := false;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_get_pos_conversion_state'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  limit 1;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  v_is_claim_owner := v_order.pos_draft_status = 'prepared'
    and v_order.pos_claim_token is not null
    and v_order.pos_claim_token is not distinct from p_claim_token
    and v_order.pos_claim_actor_ref = nullif(v_auth->>'device_id', '');

  v_claim_valid := v_is_claim_owner
    and v_order.pos_claim_expires_at is not null
    and v_order.pos_claim_expires_at > now();

  v_is_conversion_owner := v_order.pos_conversion_status = 'reserved'
    and v_order.pos_conversion_actor_ref = nullif(v_auth->>'device_id', '');

  return jsonb_build_object(
    'success', true,
    'contractVersion', 2,
    'orderId', v_order.id,
    'orderStatus', v_order.status,
    'draftStatus', v_order.pos_draft_status,
    'draftId', v_order.pos_draft_id,
    'claimOwned', v_is_claim_owner,
    'claimValid', v_claim_valid,
    'claimExpiresAt', v_order.pos_claim_expires_at,
    'conversionStatus', v_order.pos_conversion_status,
    'conversionOwned', v_is_conversion_owner,
    'conversionAttemptId', case when v_is_conversion_owner then v_order.pos_conversion_attempt_id else null end,
    'reservedSaleId', v_order.pos_conversion_sale_id,
    'conversionStartedAt', v_order.pos_conversion_started_at,
    'convertedSaleId', v_order.converted_sale_id,
    'convertedAt', v_order.converted_at,
    'conversionKey', v_order.pos_conversion_key
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_STATE_FAILED',
      'No se pudo verificar el estado remoto de conversion del pedido.'
    );
end;
$function$;;
