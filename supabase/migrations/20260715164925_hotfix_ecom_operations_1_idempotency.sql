-- HOTFIX ECOM.OPERATIONS.1.IDEMPOTENCY
-- Compensatory migration based on the remote effective definition captured on 2026-07-15.
-- Sole semantic change: an existing-order return occurs immediately after
-- portal resolution and idempotency-key validation, before new-order processing.

CREATE OR REPLACE FUNCTION public.ecommerce_create_order(p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_customer_name text;
  v_customer_phone text;
  v_customer_address text;
  v_customer_notes text;
  v_fulfillment_method text;
  v_idempotency_key text;
  v_rate_limit jsonb;
  v_existing_order public.ecommerce_orders%rowtype;
  v_order public.ecommerce_orders%rowtype;
  v_item jsonb;
  v_product public.ecommerce_published_products%rowtype;
  v_product_id uuid;
  v_seen_product_ids uuid[] := array[]::uuid[];
  v_quantity numeric(12,3);
  v_items_count integer;
  v_subtotal numeric(12,2) := 0;
  v_line_total numeric(12,2);
  v_public_items jsonb := '[]'::jsonb;
  v_whatsapp_message text;
  v_whatsapp_url text;
  v_daily_limit integer;
  v_today_count integer;
  v_availability jsonb;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);

  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;
  v_idempotency_key := left(btrim(coalesce(p_idempotency_key, '')), 160);
  if v_idempotency_key = '' then
    return private.ecommerce_public_error('ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select *
  into v_existing_order
  from public.ecommerce_orders eo
  where eo.portal_id = v_portal.id
    and eo.idempotency_key = v_idempotency_key
  limit 1;

  if v_existing_order.id is not null then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'order', private.ecommerce_order_public_jsonb(v_existing_order),
      'whatsapp', jsonb_build_object(
        'phone', v_existing_order.whatsapp_phone,
        'message', v_existing_order.whatsapp_message,
        'url', private.ecommerce_build_whatsapp_url(v_existing_order.whatsapp_phone, v_existing_order.whatsapp_message)
      )
    );
  end if;


  v_customer_name := left(btrim(coalesce(p_customer ->> 'name', '')), 120);
  v_customer_phone := left(btrim(coalesce(p_customer ->> 'phone', '')), 40);
  v_customer_address := left(btrim(coalesce(p_customer ->> 'address', '')), 500);
  v_customer_notes := left(btrim(coalesce(p_customer ->> 'notes', '')), 1000);
  v_fulfillment_method := lower(btrim(coalesce(p_customer ->> 'fulfillmentMethod', '')));

  if length(v_customer_name) < 2 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_NAME_REQUIRED');
  end if;

  if length(regexp_replace(v_customer_phone, '[^0-9]', '', 'g')) < 8 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_PHONE_REQUIRED');
  end if;

  if v_fulfillment_method not in ('pickup', 'delivery') then
    return private.ecommerce_public_error('ECOMMERCE_INVALID_FULFILLMENT_METHOD');
  end if;

  if v_fulfillment_method = 'delivery' and v_portal.delivery_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_DELIVERY_NOT_AVAILABLE');
  end if;

  if v_fulfillment_method = 'pickup' and v_portal.pickup_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_PICKUP_NOT_AVAILABLE');
  end if;

  if v_fulfillment_method = 'delivery' then
    if length(v_customer_address) < 5 then
      return private.ecommerce_public_error('ECOMMERCE_DELIVERY_ADDRESS_REQUIRED');
    end if;
  else
    v_customer_address := null;
  end if;

  v_rate_limit := private.ecommerce_enforce_create_order_rate_limit(
    v_portal.id,
    v_portal.license_id
  );

  if coalesce((v_rate_limit ->> 'allowed')::boolean, true) is not true then
    return private.ecommerce_public_error('ECOMMERCE_RATE_LIMITED');
  end if;



  v_availability := private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp());
  if v_availability->>'code' = 'ORDERING_DISABLED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  elsif v_availability->>'code' = 'ORDERS_PAUSED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERS_PAUSED');
  elsif v_availability->>'code' = 'OUTSIDE_BUSINESS_HOURS' then
    return private.ecommerce_public_error('ECOMMERCE_STORE_CLOSED');
  elsif v_availability->>'code' = 'SCHEDULE_NOT_CONFIGURED' then
    return private.ecommerce_public_error('ECOMMERCE_SCHEDULE_NOT_CONFIGURED');
  elsif coalesce((v_availability->>'acceptingOrders')::boolean, false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array' then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  v_items_count := jsonb_array_length(p_items);

  if coalesce(v_items_count, 0) <= 0 then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  if v_items_count > v_portal.max_order_items then
    return private.ecommerce_public_error('ECOMMERCE_TOO_MANY_ITEMS');
  end if;

  v_daily_limit := private.ecommerce_license_feature_int(
    v_portal.license_id,
    'ecommerce_max_open_orders_per_day',
    0
  );

  if v_daily_limit > 0 then
    select count(*)
    into v_today_count
    from public.ecommerce_orders eo
    where eo.portal_id = v_portal.id
      and eo.created_at >= date_trunc('day', now())
      and eo.status in ('new', 'seen', 'accepted', 'preparing', 'ready');

    if v_today_count >= v_daily_limit then
      return private.ecommerce_public_error('ECOMMERCE_DAILY_ORDER_LIMIT_REACHED');
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item ->> 'productId')::uuid;
    exception
      when invalid_text_representation or null_value_not_allowed then
        return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end;

    if v_product_id is null then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    if v_product_id = any(v_seen_product_ids) then
      return private.ecommerce_public_error('ECOMMERCE_DUPLICATE_PRODUCT');
    end if;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

    select pp.*
    into v_product
    from public.ecommerce_published_products pp
    where pp.id = v_product_id
      and pp.portal_id = v_portal.id
      and pp.deleted_at is null
      and pp.is_published is true
    limit 1;

    if v_product.id is null then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    if v_product.is_available is not true then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_AVAILABLE');
    end if;

    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception
      when others then
        return private.ecommerce_public_error('ECOMMERCE_INVALID_QUANTITY');
    end;

    if v_quantity is null
      or v_quantity::text in ('NaN', 'Infinity', '-Infinity')
      or v_quantity <= 0
      or v_quantity <> trunc(v_quantity)
      or v_quantity > v_portal.max_item_quantity then
      return private.ecommerce_public_error('ECOMMERCE_INVALID_QUANTITY');
    end if;

    if v_product.stock_mode = 'status'
      and v_product.stock_snapshot is not null
      and v_product.stock_snapshot <= 0 then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_AVAILABLE');
    end if;

    if v_product.stock_mode = 'exact'
      and coalesce(v_product.stock_snapshot, 0) <= 0 then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_AVAILABLE');
    end if;

    if v_product.stock_mode = 'exact'
      and v_quantity > floor(coalesce(v_product.stock_snapshot, 0)) then
      return private.ecommerce_public_error('ECOMMERCE_STOCK_LIMIT_EXCEEDED');
    end if;

    v_line_total := round((v_product.price * v_quantity)::numeric, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_public_items := v_public_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.public_name,
      'quantity', v_quantity,
      'unitPrice', v_product.price,
      'lineTotal', v_line_total
    ));
  end loop;

  if v_subtotal < v_portal.min_order_total then
    return private.ecommerce_public_error('ECOMMERCE_MIN_ORDER_NOT_REACHED');
  end if;

  select p.* into v_portal
  from public.ecommerce_portals p
  where p.id = v_portal.id
  for update;

  v_availability := private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp());
  if v_availability->>'code' = 'ORDERING_DISABLED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  elsif v_availability->>'code' = 'ORDERS_PAUSED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERS_PAUSED');
  elsif v_availability->>'code' = 'OUTSIDE_BUSINESS_HOURS' then
    return private.ecommerce_public_error('ECOMMERCE_STORE_CLOSED');
  elsif v_availability->>'code' = 'SCHEDULE_NOT_CONFIGURED' then
    return private.ecommerce_public_error('ECOMMERCE_SCHEDULE_NOT_CONFIGURED');
  elsif coalesce((v_availability->>'acceptingOrders')::boolean, false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;


  begin
    insert into public.ecommerce_orders (
      portal_id,
      license_id,
      fulfillment_method,
      customer_name,
      customer_phone,
      customer_address,
      customer_notes,
      subtotal,
      total,
      currency,
      whatsapp_phone,
      idempotency_key,
      metadata
    ) values (
      v_portal.id,
      v_portal.license_id,
      v_fulfillment_method,
      v_customer_name,
      v_customer_phone,
      v_customer_address,
      nullif(v_customer_notes, ''),
      v_subtotal,
      v_subtotal,
      'MXN',
      v_portal.whatsapp_phone,
      v_idempotency_key,
      jsonb_build_object('source', 'public_store')
    )
    returning * into v_order;
  exception
    when unique_violation then
      select *
      into v_existing_order
      from public.ecommerce_orders eo
      where eo.portal_id = v_portal.id
        and eo.idempotency_key = v_idempotency_key
      limit 1;

      if v_existing_order.id is not null then
        return jsonb_build_object(
          'success', true,
          'idempotent', true,
          'order', private.ecommerce_order_public_jsonb(v_existing_order),
          'whatsapp', jsonb_build_object(
            'phone', v_existing_order.whatsapp_phone,
            'message', v_existing_order.whatsapp_message,
            'url', private.ecommerce_build_whatsapp_url(v_existing_order.whatsapp_phone, v_existing_order.whatsapp_message)
          )
        );
      end if;

      return private.ecommerce_public_error('ECOMMERCE_ORDER_CREATE_FAILED');
  end;

  for v_item in select * from jsonb_array_elements(v_public_items) loop
    insert into public.ecommerce_order_items (
      order_id,
      portal_id,
      license_id,
      published_product_id,
      source_product_id,
      product_name,
      unit_price,
      quantity,
      line_total,
      options,
      metadata
    ) values (
      v_order.id,
      v_order.portal_id,
      v_order.license_id,
      (v_item ->> 'productId')::uuid,
      null,
      v_item ->> 'name',
      (v_item ->> 'unitPrice')::numeric,
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'lineTotal')::numeric,
      '{}'::jsonb,
      '{}'::jsonb
    );
  end loop;

  v_whatsapp_message := private.ecommerce_build_whatsapp_message(
    v_portal.name,
    v_order.public_order_code,
    jsonb_build_object(
      'name', v_customer_name,
      'phone', v_customer_phone,
      'address', v_customer_address,
      'notes', v_customer_notes
    ),
    v_public_items,
    v_order.total,
    v_order.fulfillment_method
  );

  update public.ecommerce_orders
  set whatsapp_message = v_whatsapp_message,
      whatsapp_phone = v_portal.whatsapp_phone
  where id = v_order.id
  returning * into v_order;

  insert into public.ecommerce_order_events (
    order_id,
    portal_id,
    license_id,
    event_type,
    actor_type,
    message,
    payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'order_created',
    'public_customer',
    'Pedido creado desde portal publico',
    jsonb_build_object(
      'orderCode', v_order.public_order_code,
      'fulfillmentMethod', v_order.fulfillment_method,
      'total', v_order.total
    )
  );

  v_whatsapp_url := private.ecommerce_build_whatsapp_url(
    v_order.whatsapp_phone,
    v_order.whatsapp_message
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'order', private.ecommerce_order_public_jsonb(v_order),
    'whatsapp', jsonb_build_object(
      'phone', v_order.whatsapp_phone,
      'message', v_order.whatsapp_message,
      'url', v_whatsapp_url
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_ORDER_CREATE_FAILED');
end;
$function$
;
