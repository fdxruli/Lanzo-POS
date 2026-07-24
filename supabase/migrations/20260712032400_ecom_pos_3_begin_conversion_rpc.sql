create or replace function public.ecommerce_begin_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text,
  p_attempt_id text,
  p_sale_id text,
  p_conversion_key text
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
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_expected_key text;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_begin_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  if v_draft_id = '' or v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para reservar la conversion.'
    );
  end if;

  v_expected_key := 'ecommerce:' || p_order_id::text;
  if v_conversion_key <> v_expected_key or v_sale_id <> v_draft_id then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_KEY_INVALID',
      'La clave o el identificador de venta no corresponde al pedido.'
    );
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.converted_sale_id is not null
     or v_order.pos_conversion_status = 'completed'
     or v_order.status = 'converted_to_sale' then
    if v_order.converted_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key
       and v_order.status = 'converted_to_sale' then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'idempotent', true,
        'alreadyCompleted', true,
        'contractVersion', 2,
        'orderId', v_order.id,
        'conversionStatus', 'completed',
        'convertedSaleId', v_order.converted_sale_id,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'El pedido ya fue convertido con una venta diferente.',
      jsonb_build_object('convertedSaleId', v_order.converted_sale_id)
    );
  end if;

  if v_order.pos_conversion_status = 'reserved' then
    if v_order.pos_conversion_actor_ref = v_auth->>'device_id'
       and v_order.pos_conversion_attempt_id = v_attempt_id
       and v_order.pos_conversion_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'idempotent', true,
        'contractVersion', 2,
        'orderId', v_order.id,
        'conversionStatus', 'reserved',
        'conversionAttemptId', v_order.pos_conversion_attempt_id,
        'reservedSaleId', v_order.pos_conversion_sale_id,
        'conversionStartedAt', v_order.pos_conversion_started_at,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_IN_PROGRESS',
      'Este pedido ya esta reservado para conversion por otro intento.'
    );
  end if;

  if v_order.status <> 'accepted' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status <> 'prepared'
     or v_order.pos_draft_id <> v_draft_id then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_DRAFT_NOT_PREPARED',
      'El pedido ya no conserva el borrador preparado esperado.'
    );
  end if;

  if v_order.pos_claim_expires_at is null
     or v_order.pos_claim_expires_at <= now() then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED');
  end if;

  if v_order.pos_claim_token is distinct from p_claim_token
     or v_order.pos_claim_actor_ref <> v_auth->>'device_id' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CLAIM_LOST',
      'La reserva del pedido ya no pertenece a este dispositivo.'
    );
  end if;

  update public.ecommerce_orders
  set pos_conversion_status = 'reserved',
      pos_conversion_attempt_id = v_attempt_id,
      pos_conversion_sale_id = v_sale_id,
      pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = v_auth->>'device_id',
      pos_conversion_started_at = now(),
      updated_at = now()
  where id = v_order.id;

  insert into public.ecommerce_order_events(
    order_id,
    portal_id,
    license_id,
    event_type,
    actor_type,
    actor_ref,
    message,
    payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'pos_conversion_reserved',
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Pedido reservado para conversion en Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', v_auth->>'device_role'
    )
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'conversionStatus', 'reserved',
    'conversionAttemptId', v_attempt_id,
    'reservedSaleId', v_sale_id,
    'conversionStartedAt', now(),
    'conversionKey', v_conversion_key
  );
exception
  when unique_violation then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'La clave de conversion ya fue utilizada por otro pedido.'
    );
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_RESERVATION_FAILED',
      'No se pudo reservar el pedido para conversion.'
    );
end;
$function$;;
