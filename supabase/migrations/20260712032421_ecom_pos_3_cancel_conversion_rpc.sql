create or replace function public.ecommerce_cancel_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_attempt_id text,
  p_sale_id text,
  p_conversion_key text,
  p_reason text default null
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
  v_sale_check jsonb;
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_reason text := left(btrim(coalesce(p_reason, 'cancelled_before_sale')), 120);
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_cancel_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  if v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT');
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
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED',
      'La conversion ya fue completada y no puede cancelarse.'
    );
  end if;

  if v_order.pos_conversion_status = 'idle' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'idempotent', true,
      'contractVersion', 2,
      'orderId', v_order.id,
      'conversionStatus', 'idle'
    );
  end if;

  if v_order.pos_conversion_status <> 'reserved'
     or v_order.pos_conversion_actor_ref <> v_auth->>'device_id'
     or v_order.pos_conversion_attempt_id <> v_attempt_id
     or v_order.pos_conversion_sale_id <> v_sale_id
     or v_order.pos_conversion_key <> v_conversion_key
     or v_order.pos_claim_token is distinct from p_claim_token then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CLAIM_LOST',
      'La reserva de conversion pertenece a otro intento o dispositivo.'
    );
  end if;

  v_sale_check := private.ecommerce_pos_sale_lookup_v2(
    v_license_id,
    v_sale_id,
    v_conversion_key
  );
  if coalesce((v_sale_check->>'success')::boolean, false) is false then
    return v_sale_check;
  end if;
  if coalesce((v_sale_check->>'saleExists')::boolean, false) is true then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'Existe una venta asociada a la reserva. No se libero la conversion.',
      jsonb_build_object('saleId', v_sale_id, 'conversionKey', v_conversion_key)
    );
  end if;

  update public.ecommerce_orders
  set pos_conversion_status = 'idle',
      pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null,
      pos_conversion_key = null,
      pos_conversion_actor_ref = null,
      pos_conversion_started_at = null,
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
    'pos_conversion_cancelled',
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Reserva de conversion POS cancelada antes de crear la venta',
    jsonb_build_object(
      'reason', v_reason,
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'attemptId', v_attempt_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'conversionStatus', 'idle'
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CANCEL_FAILED',
      'No se pudo liberar la reserva remota de conversion.'
    );
end;
$function$;;
