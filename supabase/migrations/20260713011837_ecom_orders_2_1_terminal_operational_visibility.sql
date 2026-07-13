-- ECOM.ORDERS.2.1 — Operational visibility and explicit historical detail.

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
  where o.id = p_order_id and o.license_id = p_license_id
  limit 1;
  if v_order.id is null then return null; end if;

  v_can_pos := p_auth->>'actor_type' = 'admin'
    or coalesce((p_auth->'staff_permissions'->>'pos')::boolean, false) is true;
  v_is_owner := v_can_pos and v_order.pos_claim_token is not null
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
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id and o.license_id = v_license_id
  limit 1;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  v_snapshot := private.ecommerce_order_pos_snapshot_v1(p_order_id, v_license_id, v_auth);
  if v_snapshot is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  return jsonb_build_object(
    'success', true,
    'order', v_snapshot || jsonb_build_object(
      'fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order)
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
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_list_orders'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_filter := lower(btrim(coalesce(p_status, 'all')));
  if v_filter not in ('all','pending','new','seen','accepted','rejected') then v_filter := 'all'; end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_orders as (
    select o.id, o.public_order_code, o.status, o.customer_name, o.fulfillment_method,
      coalesce((select sum(i.quantity) from public.ecommerce_order_items i where i.order_id = o.id), 0) as item_count,
      o.total, o.currency, o.created_at, o.seen_at, o.accepted_at, o.rejected_at
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and private.ecommerce_order_fulfillment_terminal_v1(o.fulfillment_status) is false
      and (o.pos_visibility_status in ('pending','visible') or o.status = 'converted_to_sale')
  ), filtered_orders as (
    select * from visible_orders
    where v_filter = 'all'
       or (v_filter = 'pending' and status in ('new','seen'))
       or (v_filter = 'accepted' and status in ('accepted','converted_to_sale'))
       or status = v_filter
  ), page_rows as (
    select * from filtered_orders
    order by created_at desc, id desc
    limit v_limit + 1 offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'code', public_order_code, 'status', status,
      'customerName', customer_name, 'fulfillmentMethod', fulfillment_method,
      'itemCount', item_count, 'total', total, 'currency', currency,
      'createdAt', created_at, 'seenAt', seen_at,
      'acceptedAt', accepted_at, 'rejectedAt', rejected_at
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
    'pending', count(*) filter (where status in ('new','seen')),
    'accepted', count(*) filter (where status in ('accepted','converted_to_sale')),
    'rejected', count(*) filter (where status = 'rejected'),
    'total', count(*)
  ) into v_counts
  from public.ecommerce_orders o
  where o.license_id = v_license_id
    and private.ecommerce_order_fulfillment_terminal_v1(o.fulfillment_status) is false
    and (o.pos_visibility_status in ('pending','visible') or o.status = 'converted_to_sale');

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'counts', coalesce(v_counts, jsonb_build_object('new',0,'seen',0,'pending',0,'accepted',0,'rejected',0,'total',0)),
    'pagination', jsonb_build_object('limit',v_limit,'offset',v_offset,'hasMore',coalesce(v_has_more,false)),
    'filter', v_filter
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

alter function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) owner to postgres;
alter function public.ecommerce_admin_get_order(text, text, text, uuid, text) owner to postgres;
alter function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) owner to postgres;
