-- ECOM.ORDERS.2 / 6
-- Keep paid/converted orders operationally visible until fulfillment reaches a terminal state.

create or replace function private.ecommerce_initialize_order_fulfillment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('accepted', 'converted_to_sale')
     and new.fulfillment_status is null then
    new.fulfillment_status := 'accepted';
    new.fulfillment_version := greatest(coalesce(new.fulfillment_version, 0), 1);
    new.fulfillment_updated_at := coalesce(new.accepted_at, new.updated_at, now());
  end if;
  return new;
end;
$function$;

create or replace function private.ecommerce_record_initial_fulfillment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('accepted', 'converted_to_sale')
     and old.status is distinct from new.status
     and new.fulfillment_status = 'accepted'
     and new.fulfillment_version = 1 then
    insert into private.ecommerce_order_fulfillment_events (
      order_id, portal_id, license_id, version, from_status, to_status,
      event_key, public_message, actor_type, actor_staff_id, created_at
    ) values (
      new.id, new.portal_id, new.license_id, 1, null, 'accepted',
      case when new.status = 'converted_to_sale'
        then 'base-order-converted-accepted-v1'
        else 'base-order-accepted-v1'
      end,
      null, 'system', null,
      coalesce(new.accepted_at, new.fulfillment_updated_at, now())
    ) on conflict (order_id, version) do nothing;
  end if;
  return new;
end;
$function$;

update public.ecommerce_orders
set fulfillment_status = 'accepted',
    fulfillment_version = 1,
    fulfillment_updated_at = coalesce(accepted_at, updated_at, created_at, now())
where status = 'converted_to_sale'
  and fulfillment_status is null;

insert into private.ecommerce_order_fulfillment_events (
  order_id, portal_id, license_id, version, from_status, to_status,
  event_key, public_message, actor_type, actor_staff_id, created_at
)
select o.id, o.portal_id, o.license_id, 1, null, 'accepted',
       'backfill-converted-accepted-v1', null, 'system', null,
       coalesce(o.accepted_at, o.updated_at, o.created_at, now())
from public.ecommerce_orders o
where o.status = 'converted_to_sale'
  and o.fulfillment_status = 'accepted'
  and o.fulfillment_version = 1
on conflict (order_id, version) do nothing;

create or replace function private.ecommerce_order_pos_snapshot_v1(
  p_order_id uuid,
  p_license_id uuid,
  p_auth jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_items jsonb;
  v_events jsonb;
  v_whatsapp_url text;
  v_is_owner boolean := false;
  v_can_pos boolean := false;
begin
  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = p_license_id
    and (
      o.pos_visibility_status in ('pending', 'visible')
      or (
        o.pos_visibility_status = 'archived'
        and o.status = 'converted_to_sale'
        and coalesce(o.fulfillment_status, 'accepted') not in ('completed', 'cancelled')
      )
    )
  limit 1;

  if v_order.id is null then return null; end if;

  v_can_pos := p_auth->>'actor_type' = 'admin'
    or coalesce((p_auth->'staff_permissions'->>'pos')::boolean, false) is true;
  v_is_owner := v_can_pos
    and v_order.pos_claim_token is not null
    and v_order.pos_claim_actor_ref = nullif(p_auth->>'device_id', '');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'sourceProductId', coalesce(i.source_product_id, pp.product_id, pp.local_product_ref),
    'publishedProductId', i.published_product_id,
    'productName', i.product_name,
    'unitPrice', i.unit_price,
    'quantity', i.quantity,
    'lineTotal', i.line_total,
    'options', case when jsonb_typeof(i.options) = 'object' then i.options else '{}'::jsonb end
  ) order by i.created_at, i.id), '[]'::jsonb)
  into v_items
  from public.ecommerce_order_items i
  left join public.ecommerce_published_products pp
    on pp.id = i.published_product_id
   and pp.portal_id = i.portal_id
   and pp.license_id = i.license_id
  where i.order_id = v_order.id
    and i.portal_id = v_order.portal_id
    and i.license_id = p_license_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventType', e.event_type,
    'actorType', e.actor_type,
    'actorLabel', case e.actor_type
      when 'admin' then 'Administrador'
      when 'staff' then coalesce(nullif(left(btrim(e.payload->>'actorLabel'), 80), ''), 'Personal')
      when 'public_customer' then 'Cliente'
      when 'automation' then 'Automatizacion'
      else 'Sistema'
    end,
    'message', case e.event_type
      when 'order_created' then 'Pedido creado desde la tienda online.'
      when 'order_seen' then 'Pedido marcado como visto.'
      when 'order_accepted' then 'Pedido aceptado.'
      when 'order_rejected' then 'Pedido rechazado.'
      when 'order_pos_draft_claimed' then 'Pedido reservado para preparacion en POS.'
      when 'order_pos_draft_prepared' then 'Pedido preparado en Punto de Venta.'
      when 'order_pos_draft_released' then 'Borrador de Punto de Venta liberado.'
      else nullif(left(btrim(coalesce(e.message, '')), 200), '')
    end,
    'payload', private.ecommerce_order_event_public_payload_v1(e.event_type, e.payload),
    'createdAt', e.created_at
  ) order by e.created_at, e.id), '[]'::jsonb)
  into v_events
  from public.ecommerce_order_events e
  where e.order_id = v_order.id and e.license_id = p_license_id;

  v_whatsapp_url := private.ecommerce_build_whatsapp_url(
    v_order.customer_phone,
    'Hola, te contactamos sobre tu pedido ' || coalesce(v_order.public_order_code, 'online') || '.'
  );
  if v_whatsapp_url is not null and left(v_whatsapp_url, 14) <> 'https://wa.me/' then
    v_whatsapp_url := null;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'code', v_order.public_order_code,
    'licenseIdentity', v_order.license_id,
    'status', v_order.status,
    'channel', v_order.channel,
    'fulfillmentMethod', v_order.fulfillment_method,
    'customer', jsonb_build_object(
      'name', v_order.customer_name,
      'phone', v_order.customer_phone,
      'address', v_order.customer_address,
      'notes', v_order.customer_notes
    ),
    'totals', jsonb_build_object(
      'subtotal', v_order.subtotal,
      'deliveryFee', v_order.delivery_fee,
      'discountTotal', v_order.discount_total,
      'taxTotal', v_order.tax_total,
      'total', v_order.total,
      'currency', v_order.currency
    ),
    'payment', jsonb_build_object('method', v_order.payment_method, 'status', v_order.payment_status),
    'timestamps', jsonb_build_object(
      'createdAt', v_order.created_at,
      'updatedAt', v_order.updated_at,
      'seenAt', v_order.seen_at,
      'acceptedAt', v_order.accepted_at,
      'rejectedAt', v_order.rejected_at
    ),
    'items', coalesce(v_items, '[]'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'contact', jsonb_build_object('whatsappUrl', v_whatsapp_url),
    'posDraft', jsonb_strip_nulls(jsonb_build_object(
      'status', v_order.pos_draft_status,
      'draftId', v_order.pos_draft_id,
      'claimedAt', v_order.pos_claimed_at,
      'expiresAt', v_order.pos_claim_expires_at,
      'preparedAt', v_order.pos_draft_prepared_at,
      'isClaimedByCurrentActor', v_is_owner,
      'claimToken', case when v_is_owner then v_order.pos_claim_token else null end
    ))
  );
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
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_list_orders'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_filter := lower(btrim(coalesce(p_status, 'all')));
  if v_filter not in ('all', 'pending', 'new', 'seen', 'accepted', 'rejected') then
    v_filter := 'all';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_orders as (
    select o.id, o.public_order_code, o.status, o.customer_name,
      o.fulfillment_method,
      coalesce((select sum(i.quantity) from public.ecommerce_order_items i where i.order_id = o.id), 0) as item_count,
      o.total, o.currency, o.created_at, o.seen_at, o.accepted_at, o.rejected_at
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and (
        o.pos_visibility_status in ('pending', 'visible')
        or (
          o.pos_visibility_status = 'archived'
          and o.status = 'converted_to_sale'
          and coalesce(o.fulfillment_status, 'accepted') not in ('completed', 'cancelled')
        )
      )
  ), filtered_orders as (
    select * from visible_orders
    where v_filter = 'all'
       or (v_filter = 'pending' and status in ('new', 'seen'))
       or (v_filter = 'accepted' and status in ('accepted', 'converted_to_sale'))
       or status = v_filter
  ), page_rows as (
    select * from filtered_orders
    order by created_at desc, id desc
    limit v_limit + 1 offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
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
      'rejectedAt', rejected_at
    ) order by created_at desc, id desc) filter (where row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_orders, v_has_more
  from (
    select page_rows.*, row_number() over (order by created_at desc, id desc) as row_number
    from page_rows
  ) numbered;

  select jsonb_build_object(
    'new', count(*) filter (where status = 'new'),
    'seen', count(*) filter (where status = 'seen'),
    'pending', count(*) filter (where status in ('new', 'seen')),
    'accepted', count(*) filter (where status in ('accepted', 'converted_to_sale')),
    'rejected', count(*) filter (where status = 'rejected'),
    'total', count(*)
  )
  into v_counts
  from public.ecommerce_orders o
  where o.license_id = v_license_id
    and (
      o.pos_visibility_status in ('pending', 'visible')
      or (
        o.pos_visibility_status = 'archived'
        and o.status = 'converted_to_sale'
        and coalesce(o.fulfillment_status, 'accepted') not in ('completed', 'cancelled')
      )
    );

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'counts', coalesce(v_counts, jsonb_build_object('new',0,'seen',0,'pending',0,'accepted',0,'rejected',0,'total',0)),
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'hasMore', coalesce(v_has_more, false)),
    'filter', v_filter
  );
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
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
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION','La transición solicitada no está permitida.');
  end if;
  if v_event_key = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_IDEMPOTENCY_REQUIRED','No se pudo preparar una transición idempotente.');
  end if;
  if v_message is not null then
    v_message := regexp_replace(v_message, '[[:cntrl:]]+', ' ', 'g');
    v_message := btrim(v_message);
    if char_length(v_message) > 280 or v_message ~ '[<>]' then
      return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_PUBLIC_MESSAGE_INVALID','El mensaje público debe ser texto plano de hasta 280 caracteres.');
    end if;
  end if;

  select o.* into v_order
  from public.ecommerce_orders o
  join public.ecommerce_portals p on p.id = o.portal_id and p.license_id = o.license_id
  where o.id = p_order_id
    and o.license_id = v_license_id
    and (
      o.pos_visibility_status in ('pending', 'visible')
      or (
        o.pos_visibility_status = 'archived'
        and o.status = 'converted_to_sale'
        and coalesce(o.fulfillment_status, 'accepted') not in ('completed', 'cancelled')
      )
    )
  for update of o;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  select e.* into v_existing_event
  from private.ecommerce_order_fulfillment_events e
  where e.order_id = v_order.id and e.event_key = v_event_key
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.to_status <> v_transition then
      return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION','La llave idempotente ya fue utilizada para otra transición.');
    end if;
    return jsonb_build_object(
      'success', true, 'changed', false, 'idempotent', true,
      'order', jsonb_build_object(
        'id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status,
        'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
      )
    );
  end if;

  if v_order.status not in ('accepted', 'converted_to_sale') or v_order.fulfillment_status is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION','El pedido debe estar aceptado antes de avanzar su estado operativo.');
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
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION','La transición no corresponde al estado o modalidad actual del pedido.');
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
    order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload
  ) values (
    v_order.id, v_order.portal_id, v_order.license_id,
    'order_fulfillment_' || v_transition,
    v_auth ->> 'actor_type', v_actor_ref, v_event_message,
    jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', v_previous_status, 'toStatus', v_transition,
      'version', v_next_version, 'actorLabel', v_auth ->> 'actor_label',
      'publicMessage', v_message
    ))
  );

  perform private.broadcast_ecommerce_order_change_v1(
    v_order.license_id, v_order.id, v_order.status, 'order_fulfillment_' || v_transition
  );

  return jsonb_build_object(
    'success', true, 'changed', true, 'idempotent', false,
    'order', jsonb_build_object(
      'id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status,
      'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
    )
  );
exception
  when unique_violation then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_STATUS_STALE','El pedido cambió en otro dispositivo. Actualiza el detalle e intenta nuevamente.');
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED','No se pudo actualizar el estado operativo del pedido.');
end;
$function$;

revoke all on function private.ecommerce_initialize_order_fulfillment_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_record_initial_fulfillment_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) from public;
grant execute on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) to anon, authenticated;
revoke all on function public.ecommerce_admin_update_order_fulfillment(text, text, text, text, uuid, text, bigint, text, text) from public;
grant execute on function public.ecommerce_admin_update_order_fulfillment(text, text, text, text, uuid, text, bigint, text, text) to anon, authenticated;

alter function private.ecommerce_initialize_order_fulfillment_v1() owner to postgres;
alter function private.ecommerce_record_initial_fulfillment_v1() owner to postgres;
alter function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) owner to postgres;
alter function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) owner to postgres;
alter function public.ecommerce_admin_update_order_fulfillment(text, text, text, text, uuid, text, bigint, text, text) owner to postgres;

comment on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) is
  'Lists active ecommerce orders plus converted orders whose independent fulfillment lifecycle is not terminal.';;
