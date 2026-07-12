-- ECOM.POS.3 — Confirmación de conversión
-- Alineado con la migración aplicada en producción: 20260712032444.

create or replace function public.ecommerce_complete_pos_conversion(
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
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_complete_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  if v_draft_id = '' or v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para confirmar la conversion.'
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
        'contractVersion', 2,
        'orderId', v_order.id,
        'orderStatus', v_order.status,
        'conversionStatus', 'completed',
        'convertedSaleId', v_order.converted_sale_id,
        'convertedAt', v_order.converted_at,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'El pedido ya fue convertido con una venta diferente.',
      jsonb_build_object('convertedSaleId', v_order.converted_sale_id)
    );
  end if;

  if v_order.status <> 'accepted' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status <> 'prepared'
     or v_order.pos_draft_id <> v_draft_id then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_NOT_PREPARED');
  end if;

  if v_order.pos_conversion_status <> 'reserved'
     or v_order.pos_conversion_actor_ref <> v_auth->>'device_id'
     or v_order.pos_conversion_attempt_id <> v_attempt_id
     or v_order.pos_conversion_sale_id <> v_sale_id
     or v_order.pos_conversion_key <> v_conversion_key
     or v_order.pos_claim_token is distinct from p_claim_token then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_RESERVATION_LOST',
      'La reserva remota de conversion ya no coincide con este intento.'
    );
  end if;

  update public.ecommerce_orders
  set status = 'converted_to_sale',
      converted_sale_id = v_sale_id,
      converted_at = now(),
      pos_conversion_status = 'completed',
      pos_visibility_status = 'archived',
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
    'order_converted_to_pos_sale',
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Pedido convertido en venta de Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', v_auth->>'device_role',
      'actorLabel', v_auth->>'actor_label'
    )
  );

  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    'converted_to_sale',
    'order_converted_to_pos_sale'
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'orderStatus', 'converted_to_sale',
    'conversionStatus', 'completed',
    'convertedSaleId', v_sale_id,
    'convertedAt', now(),
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
      'ECOMMERCE_POS_CONVERSION_FAILED',
      'La venta fue registrada, pero no se pudo confirmar el pedido online.'
    );
end;
$function$;
