-- ECOM.ORDERS.2 / 5
-- Preserve fulfillment control after the canonical POS conversion changes the base order status.

create or replace function private.ecommerce_order_public_status_v1(
  p_order_status text,
  p_fulfillment_status text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select case
    when p_fulfillment_status in (
      'accepted', 'preparing', 'ready', 'out_for_delivery',
      'completed', 'cancelled', 'attention'
    ) then p_fulfillment_status
    when p_order_status in ('new', 'seen') then 'received'
    when p_order_status in ('accepted', 'converted_to_sale') then 'accepted'
    when p_order_status = 'preparing' then 'preparing'
    when p_order_status = 'ready' then 'ready'
    when p_order_status = 'completed' then 'completed'
    when p_order_status = 'cancelled' then 'cancelled'
    when p_order_status = 'rejected' then 'rejected'
    else 'received'
  end;
$function$;

create or replace function public.ecommerce_admin_update_order_fulfillment(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_transition text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_public_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_existing_event private.ecommerce_order_fulfillment_events%rowtype;
  v_transition text;
  v_event_key text;
  v_message text;
  v_previous_status text;
  v_next_version bigint;
  v_actor_ref text;
  v_event_message text;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_update_order_fulfillment'
  );
  if coalesce((v_auth ->> 'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := nullif(v_auth ->> 'license_id', '')::uuid;
  v_transition := lower(left(btrim(coalesce(p_transition, '')), 40));
  v_event_key := left(btrim(coalesce(p_idempotency_key, '')), 160);
  v_message := nullif(btrim(coalesce(p_public_message, '')), '');

  if p_order_id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_transition not in ('preparing','ready','out_for_delivery','completed','cancelled') then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
      'La transición solicitada no está permitida.'
    );
  end if;
  if v_event_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_IDEMPOTENCY_REQUIRED',
      'No se pudo preparar una transición idempotente.'
    );
  end if;

  if v_message is not null then
    v_message := regexp_replace(v_message, '[[:cntrl:]]+', ' ', 'g');
    v_message := btrim(v_message);
    if char_length(v_message) > 280 or v_message ~ '[<>]' then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_PUBLIC_MESSAGE_INVALID',
        'El mensaje público debe ser texto plano de hasta 280 caracteres.'
      );
    end if;
  end if;

  select o.* into v_order
  from public.ecommerce_orders o
  join public.ecommerce_portals p
    on p.id = o.portal_id
   and p.license_id = o.license_id
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending','visible')
  for update of o;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  select e.* into v_existing_event
  from private.ecommerce_order_fulfillment_events e
  where e.order_id = v_order.id
    and e.event_key = v_event_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.to_status <> v_transition then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
        'La llave idempotente ya fue utilizada para otra transición.'
      );
    end if;
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'idempotent', true,
      'order', jsonb_build_object(
        'id', v_order.id,
        'code', v_order.public_order_code,
        'status', v_order.status,
        'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
      )
    );
  end if;

  if v_order.status not in ('accepted', 'converted_to_sale')
     or v_order.fulfillment_status is null then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
      'El pedido debe estar aceptado antes de avanzar su estado operativo.'
    );
  end if;

  if p_expected_version is null or p_expected_version <> v_order.fulfillment_version then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_STALE',
      'El pedido cambió en otro dispositivo. Actualiza el detalle e intenta nuevamente.',
      jsonb_build_object('currentVersion', v_order.fulfillment_version)
    );
  end if;

  if private.ecommerce_fulfillment_transition_allowed_v1(
    v_order.fulfillment_status,
    v_transition,
    v_order.fulfillment_method
  ) is not true then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
      'La transición no corresponde al estado o modalidad actual del pedido.'
    );
  end if;

  v_previous_status := v_order.fulfillment_status;
  v_next_version := v_order.fulfillment_version + 1;
  v_actor_ref := coalesce(
    nullif(v_auth ->> 'staff_user_id',''),
    nullif(v_auth ->> 'device_id','')
  );
  v_event_message := case v_transition
    when 'preparing' then 'Pedido en preparación'
    when 'ready' then 'Pedido listo'
    when 'out_for_delivery' then 'Pedido en camino'
    when 'completed' then 'Pedido completado'
    when 'cancelled' then 'Pedido cancelado'
    else 'Estado operativo actualizado'
  end;

  update public.ecommerce_orders
  set fulfillment_status = v_transition,
      fulfillment_version = v_next_version,
      fulfillment_updated_at = now(),
      public_status_message = v_message,
      cancelled_at = case
        when v_transition = 'cancelled' then coalesce(cancelled_at, now())
        else cancelled_at
      end,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into private.ecommerce_order_fulfillment_events (
    order_id, portal_id, license_id, version, from_status, to_status,
    event_key, public_message, actor_type, actor_staff_id
  ) values (
    v_order.id, v_order.portal_id, v_order.license_id, v_next_version,
    v_previous_status, v_transition, v_event_key, v_message,
    v_auth ->> 'actor_type', v_actor_ref
  );

  insert into public.ecommerce_order_events (
    order_id, portal_id, license_id, event_type, actor_type,
    actor_ref, message, payload
  ) values (
    v_order.id, v_order.portal_id, v_order.license_id,
    'order_fulfillment_' || v_transition,
    v_auth ->> 'actor_type', v_actor_ref, v_event_message,
    jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', v_previous_status,
      'toStatus', v_transition,
      'version', v_next_version,
      'actorLabel', v_auth ->> 'actor_label',
      'publicMessage', v_message
    ))
  );

  perform private.broadcast_ecommerce_order_change_v1(
    v_order.license_id,
    v_order.id,
    v_order.status,
    'order_fulfillment_' || v_transition
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'code', v_order.public_order_code,
      'status', v_order.status,
      'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
    )
  );
exception
  when unique_violation then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_STALE',
      'El pedido cambió en otro dispositivo. Actualiza el detalle e intenta nuevamente.'
    );
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_ACTION_FAILED',
      'No se pudo actualizar el estado operativo del pedido.'
    );
end;
$function$;

revoke all on function private.ecommerce_order_public_status_v1(text, text)
  from public, anon, authenticated;
revoke all on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) from public;
grant execute on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) to anon, authenticated;

alter function private.ecommerce_order_public_status_v1(text, text) owner to postgres;
alter function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) owner to postgres;

comment on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) is 'Versioned fulfillment transition that remains independent from the canonical POS conversion state.';;
