-- ECOM.ORDERS.2 / 3
-- Server-side fulfillment state machine and administrative RPC.

create or replace function private.ecommerce_fulfillment_public_json_v1(p_order public.ecommerce_orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', private.ecommerce_order_public_status_v1(p_order.status, p_order.fulfillment_status),
    'internalStatus', p_order.fulfillment_status,
    'version', greatest(p_order.fulfillment_version, 0),
    'updatedAt', p_order.fulfillment_updated_at,
    'publicMessage', p_order.public_status_message,
    'paymentRegistered', (
      p_order.payment_status = 'paid'
      or p_order.converted_sale_id is not null
      or p_order.pos_conversion_status = 'completed'
    )
  ));
$function$;

create or replace function private.ecommerce_fulfillment_transition_allowed_v1(
  p_current_status text,
  p_next_status text,
  p_fulfillment_method text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $function$
  select case
    when p_current_status = 'accepted' and p_next_status = 'preparing' then true
    when p_current_status = 'preparing' and p_next_status = 'ready' then true
    when p_current_status = 'ready' and p_next_status = 'completed' and p_fulfillment_method = 'pickup' then true
    when p_current_status = 'ready' and p_next_status = 'out_for_delivery' and p_fulfillment_method = 'delivery' then true
    when p_current_status = 'out_for_delivery' and p_next_status = 'completed' and p_fulfillment_method = 'delivery' then true
    when p_current_status in ('accepted','preparing','ready','out_for_delivery') and p_next_status = 'cancelled' then true
    else false
  end;
$function$;

create or replace function private.ecommerce_record_initial_fulfillment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'accepted'
     and old.status is distinct from 'accepted'
     and new.fulfillment_status = 'accepted'
     and new.fulfillment_version = 1 then
    insert into private.ecommerce_order_fulfillment_events (
      order_id, portal_id, license_id, version, from_status, to_status,
      event_key, public_message, actor_type, actor_staff_id, created_at
    ) values (
      new.id, new.portal_id, new.license_id, 1, null, 'accepted',
      'base-order-accepted-v1', null, 'system', null,
      coalesce(new.accepted_at, new.fulfillment_updated_at, now())
    ) on conflict (order_id, version) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists ecommerce_orders_record_initial_fulfillment on public.ecommerce_orders;
create trigger ecommerce_orders_record_initial_fulfillment
after update of status on public.ecommerce_orders
for each row execute function private.ecommerce_record_initial_fulfillment_v1();

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
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION','La transición solicitada no está permitida.');
  end if;
  if v_event_key = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_IDEMPOTENCY_REQUIRED','No se pudo preparar una transición idempotente.');
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
  join public.ecommerce_portals p on p.id = o.portal_id and p.license_id = o.license_id
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending','visible')
  for update of o;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  select e.* into v_existing_event
  from private.ecommerce_order_fulfillment_events e
  where e.order_id = v_order.id and e.event_key = v_event_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.to_status <> v_transition then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
        'La llave idempotente ya fue utilizada para otra transición.'
      );
    end if;
    return jsonb_build_object(
      'success', true, 'changed', false, 'idempotent', true,
      'order', jsonb_build_object(
        'id', v_order.id,
        'code', v_order.public_order_code,
        'status', v_order.status,
        'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
      )
    );
  end if;

  if v_order.status <> 'accepted' or v_order.fulfillment_status is null then
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
    v_order.fulfillment_status, v_transition, v_order.fulfillment_method
  ) is not true then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
      'La transición no corresponde al estado o modalidad actual del pedido.'
    );
  end if;

  v_previous_status := v_order.fulfillment_status;
  v_next_version := v_order.fulfillment_version + 1;
  v_actor_ref := coalesce(nullif(v_auth ->> 'staff_user_id',''), nullif(v_auth ->> 'device_id',''));
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
      cancelled_at = case when v_transition = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
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
    v_order.license_id, v_order.id, v_order.status,
    'order_fulfillment_' || v_transition
  );

  return jsonb_build_object(
    'success', true, 'changed', true, 'idempotent', false,
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

create or replace function public.ecommerce_admin_get_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_snapshot jsonb;
  v_order public.ecommerce_orders%rowtype;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_get_order'
  );
  if coalesce((v_auth ->> 'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth ->> 'license_id')::uuid;
  v_snapshot := private.ecommerce_order_pos_snapshot_v1(p_order_id, v_license_id, v_auth);
  if v_snapshot is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending','visible')
  limit 1;

  return jsonb_build_object(
    'success', true,
    'order', v_snapshot || jsonb_build_object(
      'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
    )
  );
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

revoke all on function private.ecommerce_fulfillment_public_json_v1(public.ecommerce_orders) from public, anon, authenticated;
revoke all on function private.ecommerce_fulfillment_transition_allowed_v1(text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_record_initial_fulfillment_v1() from public, anon, authenticated;
revoke all on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) from public;

comment on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) is 'Versioned and idempotent server-side fulfillment state transition for an authorized ecommerce actor.';
