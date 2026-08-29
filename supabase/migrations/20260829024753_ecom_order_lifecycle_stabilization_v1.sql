-- ECOM.ORDER.LIFECYCLE.STABILIZATION.1
-- Prospective payment gate and bounded closed-history visibility.
-- This migration deliberately does not mutate historical orders.

create or replace function private.ecommerce_order_payment_registered_v1(
  p_order public.ecommerce_orders
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    p_order.payment_status = 'paid'
    or p_order.converted_sale_id is not null
    or p_order.pos_conversion_status = 'completed',
    false
  );
$function$;

create or replace function private.ecommerce_fulfillment_public_json_v1(
  p_order public.ecommerce_orders
)
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
    'paymentRegistered', private.ecommerce_order_payment_registered_v1(p_order)
  ));
$function$;

create or replace function private.ecommerce_orders_error_v1(
  p_code text,
  p_message text default null,
  p_details jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'success', false,
    'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ORDER_ACTION_FAILED'),
    'message', coalesce(p_message, case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ORDER_ACTION_FAILED')
      when 'ECOMMERCE_ORDERS_ACCESS_DENIED' then 'No tienes permiso para administrar pedidos online.'
      when 'ECOMMERCE_ORDER_INBOX_DISABLED' then 'La bandeja de pedidos online no esta disponible para esta licencia.'
      when 'ECOMMERCE_STAFF_SESSION_REQUIRED' then 'Inicia sesion como personal para administrar pedidos online.'
      when 'ECOMMERCE_STAFF_SESSION_INVALID' then 'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
      when 'ECOMMERCE_STAFF_PERMISSION_DENIED' then 'Tu usuario no tiene permiso para administrar pedidos online.'
      when 'ECOMMERCE_ORDERS_RATE_LIMITED' then 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.'
      when 'ECOMMERCE_ORDER_NOT_FOUND' then 'El pedido no existe o no esta disponible.'
      when 'ECOMMERCE_ORDER_INVALID_TRANSITION' then 'El pedido ya no permite esta accion.'
      when 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then 'Este pedido ya fue completado o cancelado y no permite operaciones en Punto de Venta.'
      when 'ECOMMERCE_ORDER_PAYMENT_REQUIRED' then 'Registra el pago antes de completar el pedido.'
      when 'ECOMMERCE_ORDER_POS_DRAFT_PREPARED' then 'El pedido tiene un borrador preparado en Punto de Venta. Resuelvelo antes de finalizar el estado operativo.'
      when 'ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS' then 'El pedido tiene una conversion de Punto de Venta en progreso y no puede finalizarse operativamente.'
      when 'ECOMMERCE_REJECTION_REASON_REQUIRED' then 'Escribe un motivo de rechazo de al menos 3 caracteres.'
      when 'ECOMMERCE_REJECTION_REASON_TOO_LONG' then 'El motivo de rechazo no puede superar 300 caracteres.'
      when 'ECOMMERCE_POS_DRAFT_IN_PROGRESS' then 'Este pedido ya esta siendo preparado en otro dispositivo.'
      when 'ECOMMERCE_POS_DRAFT_ALREADY_PREPARED' then 'Este pedido ya tiene un borrador preparado en Punto de Venta.'
      when 'ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED' then 'La reserva para preparar este pedido vencio. Intenta nuevamente.'
      when 'ECOMMERCE_POS_DRAFT_TOKEN_INVALID' then 'No se pudo validar la reserva de este borrador.'
      when 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' then 'Necesitas permisos de ecommerce y Punto de Venta para preparar este pedido.'
      when 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED' then 'No se pudo preparar el pedido en Punto de Venta.'
      else 'No se pudo completar la accion sobre el pedido.'
    end),
    'details', p_details
  ));
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
  v_release_claim boolean := false;
  v_is_converted boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_update_order_fulfillment'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := nullif(v_auth->>'license_id', '')::uuid;
  v_transition := lower(left(btrim(coalesce(p_transition, '')), 40));
  v_event_key := left(btrim(coalesce(p_idempotency_key, '')), 160);
  v_message := nullif(btrim(coalesce(p_public_message, '')), '');

  if p_order_id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;
  if v_transition not in ('preparing','ready','out_for_delivery','completed','cancelled') then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
      'La transicion solicitada no esta permitida.'
    );
  end if;
  if v_event_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_IDEMPOTENCY_REQUIRED',
      'No se pudo preparar una transicion idempotente.'
    );
  end if;
  if v_message is not null then
    v_message := regexp_replace(v_message, '[[:cntrl:]]+', ' ', 'g');
    v_message := btrim(v_message);
    if char_length(v_message) > 280 or v_message ~ '[<>]' then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_PUBLIC_MESSAGE_INVALID',
        'El mensaje publico debe ser texto plano de hasta 280 caracteres.'
      );
    end if;
  end if;

  select o.*
  into v_order
  from public.ecommerce_orders o
  join public.ecommerce_portals p
    on p.id = o.portal_id
   and p.license_id = o.license_id
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update of o;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  select e.*
  into v_existing_event
  from private.ecommerce_order_fulfillment_events e
  where e.order_id = v_order.id
    and e.event_key = v_event_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.to_status <> v_transition then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION',
        'La llave idempotente ya fue utilizada para otra transicion.'
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

  if private.ecommerce_order_fulfillment_terminal_v1(v_order.fulfillment_status) then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');
  end if;

  if p_expected_version is null
     or p_expected_version <> v_order.fulfillment_version then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDER_STATUS_STALE',
      'El pedido cambio en otro dispositivo. Actualiza el detalle e intenta nuevamente.',
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
      'La transicion no corresponde al estado o modalidad actual del pedido.'
    );
  end if;

  v_is_converted := (
    v_order.status = 'converted_to_sale'
    or v_order.converted_sale_id is not null
    or v_order.pos_conversion_status = 'completed'
  );

  if v_transition in ('completed', 'cancelled') and not v_is_converted then
    if v_order.pos_conversion_status <> 'idle' then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS',
        null,
        jsonb_build_object('conversionStatus', v_order.pos_conversion_status)
      );
    end if;

    if v_order.pos_draft_status = 'prepared' then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_POS_DRAFT_PREPARED',
        null,
        jsonb_build_object('draftStatus', v_order.pos_draft_status)
      );
    end if;

    if v_order.pos_draft_status = 'claimed' then
      v_release_claim := true;
    elsif v_order.pos_draft_status not in ('none', 'released') then
      return private.ecommerce_orders_error_v1(
        'ECOMMERCE_ORDER_INVALID_TRANSITION',
        'El estado del borrador POS requiere revision antes de finalizar el fulfillment.'
      );
    end if;
  end if;

  -- This check is deliberately before any POS-claim release or order update.
  if v_transition = 'completed'
     and private.ecommerce_order_payment_registered_v1(v_order) is not true then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_PAYMENT_REQUIRED');
  end if;

  v_previous_status := v_order.fulfillment_status;
  v_next_version := v_order.fulfillment_version + 1;
  v_actor_ref := coalesce(
    nullif(v_auth->>'staff_user_id',''),
    nullif(v_auth->>'device_id','')
  );
  v_event_message := case
    when v_transition = 'preparing' then 'Pedido en preparacion'
    when v_transition = 'ready' then 'Pedido listo'
    when v_transition = 'out_for_delivery' then 'Pedido en camino'
    when v_transition = 'completed' then 'Pedido completado'
    when v_transition = 'cancelled' and v_is_converted then 'Entrega del pedido cancelada'
    when v_transition = 'cancelled' then 'Pedido cancelado'
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
      pos_visibility_status = case
        when v_transition in ('completed', 'cancelled') then 'archived'
        else pos_visibility_status
      end,
      pos_draft_status = case
        when v_release_claim then 'released'
        else pos_draft_status
      end,
      pos_draft_id = case when v_release_claim then null else pos_draft_id end,
      pos_claim_token = case when v_release_claim then null else pos_claim_token end,
      pos_claim_request_key = case when v_release_claim then null else pos_claim_request_key end,
      pos_claimed_at = case when v_release_claim then null else pos_claimed_at end,
      pos_claim_expires_at = case when v_release_claim then null else pos_claim_expires_at end,
      pos_claim_actor_type = case when v_release_claim then null else pos_claim_actor_type end,
      pos_claim_actor_ref = case when v_release_claim then null else pos_claim_actor_ref end,
      pos_draft_prepared_at = case when v_release_claim then null else pos_draft_prepared_at end,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into private.ecommerce_order_fulfillment_events (
    order_id, portal_id, license_id, version, from_status, to_status,
    event_key, public_message, actor_type, actor_staff_id
  ) values (
    v_order.id, v_order.portal_id, v_order.license_id, v_next_version,
    v_previous_status, v_transition, v_event_key, v_message,
    v_auth->>'actor_type', v_actor_ref
  );

  insert into public.ecommerce_order_events (
    order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'order_fulfillment_' || v_transition,
    v_auth->>'actor_type',
    v_actor_ref,
    v_event_message,
    jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', v_previous_status,
      'toStatus', v_transition,
      'version', v_next_version,
      'actorLabel', v_auth->>'actor_label',
      'publicMessage', v_message,
      'claimReleased', case when v_release_claim then true else null end,
      'financialStateUnchanged', case when v_is_converted then true else null end
    ))
  );

  if v_release_claim then
    insert into public.ecommerce_order_events (
      order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload
    ) values (
      v_order.id,
      v_order.portal_id,
      v_order.license_id,
      'order_pos_draft_released',
      v_auth->>'actor_type',
      v_actor_ref,
      'Reserva de preparacion POS liberada al finalizar el fulfillment',
      jsonb_build_object(
        'reasonCode', 'fulfillment_terminal',
        'actorLabel', v_auth->>'actor_label'
      )
    );
  end if;

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
      'El pedido cambio en otro dispositivo. Actualiza el detalle e intenta nuevamente.'
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
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_get_order'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  limit 1;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  v_snapshot := private.ecommerce_order_pos_snapshot_v1(p_order_id, v_license_id, v_auth);
  if v_snapshot is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  return jsonb_build_object(
    'success', true,
    'order', v_snapshot || jsonb_build_object(
      'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order),
      'posConversion', jsonb_strip_nulls(jsonb_build_object(
        'status', v_order.pos_conversion_status,
        'convertedSaleId', v_order.converted_sale_id,
        'convertedAt', v_order.converted_at
      ))
    )
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_list_orders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_filter text;
  v_limit integer;
  v_offset integer;
  v_orders jsonb;
  v_counts jsonb;
  v_has_more boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_list_orders'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_filter := lower(btrim(coalesce(p_status, 'all')));
  if v_filter not in ('all','active','closed','pending','new','seen','accepted','rejected','completed','cancelled') then
    v_filter := 'all';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with scoped_orders as (
    select
      o.id,
      o.public_order_code,
      o.status,
      o.customer_name,
      o.fulfillment_method,
      coalesce((
        select sum(i.quantity)
        from public.ecommerce_order_items i
        where i.order_id = o.id
      ), 0) as item_count,
      o.total,
      o.currency,
      o.created_at,
      o.seen_at,
      o.accepted_at,
      o.rejected_at,
      o.fulfillment_status,
      o.payment_status,
      private.ecommerce_order_payment_registered_v1(o) as payment_registered,
      o.pos_conversion_status,
      o.pos_visibility_status,
      coalesce(
        o.fulfillment_status in ('completed', 'cancelled')
        or o.status in ('rejected', 'completed', 'cancelled'),
        false
      ) as is_closed,
      (o.pos_visibility_status in ('pending', 'visible') or o.status = 'converted_to_sale') as has_operational_visibility
    from public.ecommerce_orders o
    where o.license_id = v_license_id
  ), available_orders as (
    select *
    from scoped_orders
    where is_closed
       or (is_closed is false and has_operational_visibility)
  ), filtered_orders as (
    select *
    from available_orders
    where v_filter = 'all'
       or (v_filter = 'active' and is_closed is false and has_operational_visibility)
       or (v_filter = 'closed' and is_closed)
       or (v_filter = 'pending' and is_closed is false and has_operational_visibility and status in ('new', 'seen'))
       or (v_filter = 'new' and is_closed is false and has_operational_visibility and status = 'new')
       or (v_filter = 'seen' and is_closed is false and has_operational_visibility and status = 'seen')
       or (v_filter = 'accepted' and is_closed is false and has_operational_visibility and status in ('accepted', 'converted_to_sale'))
       or (v_filter = 'rejected' and status = 'rejected')
       or (v_filter = 'completed' and (status = 'completed' or fulfillment_status = 'completed'))
       or (v_filter = 'cancelled' and (status = 'cancelled' or fulfillment_status = 'cancelled'))
  ), page_rows as (
    select *
    from filtered_orders
    order by created_at desc, id desc
    limit v_limit + 1
    offset v_offset
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'code', public_order_code,
      'status', status,
      'customerName', customer_name,
      'fulfillmentMethod', fulfillment_method,
      'itemCount', item_count,
      'total', total,
      'currency', currency,
      'createdAt', created_at,
      'seenAt', seen_at,
      'acceptedAt', accepted_at,
      'rejectedAt', rejected_at,
      'fulfillmentStatus', fulfillment_status,
      'paymentStatus', payment_status,
      'paymentRegistered', payment_registered,
      'posConversionStatus', pos_conversion_status,
      'posVisibilityStatus', pos_visibility_status
    ) order by created_at desc, id desc) filter (where row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_orders, v_has_more
  from (
    select page_rows.*, row_number() over (order by created_at desc, id desc) as row_number
    from page_rows
  ) numbered;

  with scoped_orders as (
    select
      o.status,
      o.fulfillment_status,
      o.pos_visibility_status,
      coalesce(
        o.fulfillment_status in ('completed', 'cancelled')
        or o.status in ('rejected', 'completed', 'cancelled'),
        false
      ) as is_closed,
      (o.pos_visibility_status in ('pending', 'visible') or o.status = 'converted_to_sale') as has_operational_visibility
    from public.ecommerce_orders o
    where o.license_id = v_license_id
  ), available_orders as (
    select *
    from scoped_orders
    where is_closed
       or (is_closed is false and has_operational_visibility)
  )
  select jsonb_build_object(
    'new', count(*) filter (where is_closed is false and has_operational_visibility and status = 'new'),
    'seen', count(*) filter (where is_closed is false and has_operational_visibility and status = 'seen'),
    'pending', count(*) filter (where is_closed is false and has_operational_visibility and status in ('new', 'seen')),
    'accepted', count(*) filter (where is_closed is false and has_operational_visibility and status in ('accepted', 'converted_to_sale')),
    'rejected', count(*) filter (where status = 'rejected'),
    'closed', count(*) filter (where is_closed),
    'total', count(*)
  )
  into v_counts
  from available_orders;

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'counts', coalesce(v_counts, jsonb_build_object('new',0,'seen',0,'pending',0,'accepted',0,'rejected',0,'closed',0,'total',0)),
    'pagination', jsonb_build_object('limit',v_limit,'offset',v_offset,'hasMore',coalesce(v_has_more,false)),
    'filter', v_filter
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

revoke all on function private.ecommerce_order_payment_registered_v1(public.ecommerce_orders)
from public, anon, authenticated;
revoke all on function private.ecommerce_fulfillment_public_json_v1(public.ecommerce_orders)
from public, anon, authenticated;
revoke all on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) from public;
grant execute on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) to anon, authenticated;

alter function private.ecommerce_order_payment_registered_v1(public.ecommerce_orders) owner to postgres;
alter function private.ecommerce_fulfillment_public_json_v1(public.ecommerce_orders) owner to postgres;
alter function private.ecommerce_orders_error_v1(text, text, jsonb) owner to postgres;
alter function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) owner to postgres;
alter function public.ecommerce_admin_get_order(text, text, text, uuid, text) owner to postgres;
alter function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) owner to postgres;

comment on function private.ecommerce_order_payment_registered_v1(public.ecommerce_orders)
is 'ECOM.ORDER.LIFECYCLE.STABILIZATION.1: authoritative payment/POS registration evidence.';
comment on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) is 'Versioned fulfillment transition requiring registered payment before completion.';
comment on function public.ecommerce_admin_list_orders(
  text, text, text, text, text, integer, integer
) is 'Bounded ecommerce order list with explicit active/closed scopes and terminal history.';
