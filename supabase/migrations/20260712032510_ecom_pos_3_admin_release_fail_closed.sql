-- ECOM.POS.3.1.1 — Liberación administrativa fail-closed
-- Alineado con la migración aplicada en producción: 20260712032510.

-- Una reserva activa puede corresponder a una venta confirmada solo en Dexie
-- cuyo shadow remoto aun no existe; public.pos_sales nunca autoriza liberarla.
create or replace function public.ecommerce_admin_release_pos_draft(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_reason text
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
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'abandoned'), 80);
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_release_pos_draft'
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
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.converted_sale_id is not null
     or v_order.pos_conversion_status = 'completed'
     or v_order.status = 'converted_to_sale' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED',
      'Una conversion completada no puede liberarse como borrador.',
      jsonb_build_object(
        'convertedSaleId', v_order.converted_sale_id,
        'conversionStatus', v_order.pos_conversion_status,
        'orderStatus', v_order.status
      )
    );
  end if;

  if v_order.pos_draft_status = 'released'
     and coalesce(v_order.pos_conversion_status, 'idle') = 'idle' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'idempotent', true,
      'contractVersion', 2,
      'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth)
    );
  end if;

  if v_order.status <> 'accepted'
     or v_order.pos_draft_status not in ('claimed', 'prepared') then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if coalesce(v_order.pos_conversion_status, 'idle') = 'reserved' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'El pedido tiene una conversion reservada. No puede liberarse desde la bandeja porque podria existir una venta local aun no sincronizada.'
    );
  end if;

  if coalesce(v_order.pos_conversion_status, 'idle') <> 'idle' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      'El estado de conversion requiere revision antes de liberar el borrador.'
    );
  end if;

  if v_auth->>'actor_type' <> 'admin' and (
    v_order.pos_claim_actor_ref <> v_auth->>'device_id'
    or v_order.pos_claim_token is distinct from p_claim_token
  ) then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID');
  end if;

  update public.ecommerce_orders
  set pos_draft_status = 'released',
      pos_draft_id = null,
      pos_claim_token = null,
      pos_claim_request_key = null,
      pos_claimed_at = null,
      pos_claim_expires_at = null,
      pos_claim_actor_type = null,
      pos_claim_actor_ref = null,
      pos_draft_prepared_at = null,
      pos_conversion_status = 'idle',
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
    'order_pos_draft_released',
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Borrador de Punto de Venta liberado',
    jsonb_build_object(
      'reasonCode', v_reason,
      'deviceRole', v_auth->>'device_role',
      'actorLabel', v_auth->>'actor_label',
      'conversionReleased', false
    )
  );

  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    v_order.status,
    'order_pos_draft_released'
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'conversionReleased', false,
    'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth)
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_DRAFT_PREPARE_FAILED',
      'No se pudo liberar el borrador.'
    );
end;
$function$;
