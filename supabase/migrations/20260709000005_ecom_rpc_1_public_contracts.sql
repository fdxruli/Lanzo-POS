-- ECOM.RPC.1 - RPCs publicas seguras para portal, catalogo y creacion de pedidos.
-- No abre tablas al cliente. No crea UI. No afecta caja, ventas, inventario ni reportes POS.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Helpers privados de contrato publico
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_public_error(p_code text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'success', false,
    'error', jsonb_build_object(
      'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR'),
      'message', case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR')
        when 'ECOMMERCE_PORTAL_NOT_FOUND' then 'La tienda no esta disponible.'
        when 'ECOMMERCE_ORDERING_DISABLED' then 'Este negocio no esta recibiendo pedidos en este momento.'
        when 'ECOMMERCE_CUSTOMER_NAME_REQUIRED' then 'Escribe tu nombre para continuar.'
        when 'ECOMMERCE_CUSTOMER_PHONE_REQUIRED' then 'Escribe un telefono valido para continuar.'
        when 'ECOMMERCE_DELIVERY_NOT_AVAILABLE' then 'Este negocio no tiene entrega a domicilio disponible.'
        when 'ECOMMERCE_PICKUP_NOT_AVAILABLE' then 'Este negocio no tiene recoleccion disponible.'
        when 'ECOMMERCE_EMPTY_CART' then 'Agrega al menos un producto para continuar.'
        when 'ECOMMERCE_TOO_MANY_ITEMS' then 'El pedido tiene demasiados productos.'
        when 'ECOMMERCE_PRODUCT_NOT_FOUND' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_PRODUCT_NOT_AVAILABLE' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_INVALID_QUANTITY' then 'Revisa la cantidad de productos.'
        when 'ECOMMERCE_MIN_ORDER_NOT_REACHED' then 'El pedido no alcanza el minimo requerido.'
        when 'ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_IDEMPOTENCY_CONFLICT' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_RATE_LIMITED' then 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
        when 'ECOMMERCE_DAILY_ORDER_LIMIT_REACHED' then 'Este negocio no puede recibir mas pedidos por ahora.'
        when 'ECOMMERCE_ORDER_CREATE_FAILED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        else 'No se pudo completar la solicitud.'
      end
    )
  );
$$;

create or replace function private.ecommerce_normalize_slug(p_slug text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_slug text;
begin
  v_slug := lower(btrim(coalesce(p_slug, '')));
  v_slug := regexp_replace(v_slug, '[[:space:]_]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  v_slug := left(v_slug, 80);
  v_slug := btrim(v_slug, '-');

  if v_slug = '' then
    return null;
  end if;

  return v_slug;
end;
$$;

create or replace function private.ecommerce_get_public_portal_by_slug(p_slug text)
returns public.ecommerce_portals
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_slug text;
  v_portal public.ecommerce_portals%rowtype;
begin
  v_slug := private.ecommerce_normalize_slug(p_slug);

  if v_slug is null then
    return null;
  end if;

  select p.*
  into v_portal
  from public.ecommerce_portals p
  where p.slug = v_slug
    and p.deleted_at is null
    and p.status = 'published'
  limit 1;

  if v_portal.id is null then
    return null;
  end if;

  if private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_portal_enabled', false) is not true then
    return null;
  end if;

  return v_portal;
end;
$$;

create or replace function private.ecommerce_portal_public_jsonb(p_portal public.ecommerce_portals)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'slug', p_portal.slug,
    'name', p_portal.name,
    'headline', p_portal.headline,
    'description', p_portal.description,
    'templateCode', p_portal.template_code,
    'customizationLevel', p_portal.customization_level,
    'theme', p_portal.theme,
    'logoUrl', p_portal.logo_url,
    'coverImageUrl', p_portal.cover_image_url,
    'whatsappPhone', p_portal.whatsapp_phone,
    'address', p_portal.address,
    'businessType', coalesce(to_jsonb(p_portal.business_type), '[]'::jsonb),
    'orderingEnabled', p_portal.ordering_enabled,
    'pickupEnabled', p_portal.pickup_enabled,
    'deliveryEnabled', p_portal.delivery_enabled,
    'scheduledOrdersEnabled', p_portal.scheduled_orders_enabled,
    'minOrderTotal', p_portal.min_order_total,
    'maxOrderItems', p_portal.max_order_items,
    'maxItemQuantity', p_portal.max_item_quantity,
    'stockMode', p_portal.stock_mode,
    'settings', p_portal.settings
  );
$$;

create or replace function private.ecommerce_portal_hours_jsonb(p_portal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday,
        'isOpen', h.is_open,
        'opensAt', h.opens_at,
        'closesAt', h.closes_at
      ) order by h.weekday, h.sort_order)
      from public.ecommerce_portal_hours h
      where h.portal_id = p_portal_id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.exception_date,
        'isOpen', e.is_open,
        'opensAt', e.opens_at,
        'closesAt', e.closes_at,
        'reason', e.reason
      ) order by e.exception_date)
      from public.ecommerce_portal_hour_exceptions e
      where e.portal_id = p_portal_id
        and e.exception_date >= current_date
    ), '[]'::jsonb)
  );
$$;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_product.id,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', p_product.is_available,
    'displayOrder', p_product.display_order,
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
      when p_product.stock_mode = 'hidden' then jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status',
        'status', case when coalesce(p_product.stock_snapshot, 1) > 0 then 'available' else 'out_of_stock' end,
        'quantity', null
      )
      when p_product.stock_mode = 'exact' then jsonb_build_object(
        'mode', 'exact',
        'status', case when coalesce(p_product.stock_snapshot, 0) > 0 then 'available' else 'out_of_stock' end,
        'quantity', greatest(coalesce(p_product.stock_snapshot, 0), 0)
      )
      else jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
    end,
    'options', p_product.options
  );
$$;

create or replace function private.ecommerce_normalize_whatsapp_phone(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_phone text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  if v_phone = '' then
    return null;
  end if;

  if left(v_phone, 2) = '52' then
    return v_phone;
  end if;

  if length(v_phone) = 10 then
    return '52' || v_phone;
  end if;

  return v_phone;
end;
$$;

create or replace function private.ecommerce_url_encode_text(p_text text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  with bytes as (
    select get_byte(convert_to(coalesce(p_text, ''), 'UTF8'), s.i) as b, s.i
    from generate_series(0, greatest(length(convert_to(coalesce(p_text, ''), 'UTF8')) - 1, -1)) as s(i)
  )
  select coalesce(string_agg(
    case
      when b between 48 and 57 or b between 65 and 90 or b between 97 and 122
        or b in (45, 46, 95, 126)
        then chr(b)
      else '%' || upper(lpad(to_hex(b), 2, '0'))
    end,
    '' order by i
  ), '')
  from bytes;
$$;

create or replace function private.ecommerce_build_whatsapp_url(
  p_phone text,
  p_message text
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_phone text;
begin
  v_phone := private.ecommerce_normalize_whatsapp_phone(p_phone);

  if v_phone is null then
    return null;
  end if;

  return 'https://wa.me/' || v_phone || '?text=' || private.ecommerce_url_encode_text(p_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC publica: portal por slug
-- ---------------------------------------------------------------------------

create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_portal public.ecommerce_portals%rowtype;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);

  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success', true,
    'portal', private.ecommerce_portal_public_jsonb(v_portal),
    'hours', private.ecommerce_portal_hours_jsonb(v_portal.id),
    'features', jsonb_build_object(
      'whatsappCheckout', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_whatsapp_checkout', false),
      'orderInbox', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false),
      'customSlug', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_custom_slug', false),
      'brandingCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_branding_customization'), 'basic'),
      'layoutCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_layout_customization'), 'template_only'),
      'businessHours', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_business_hours', true),
      'deliveryPickupSettings', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_delivery_pickup_settings'), 'basic'),
      'stockVisibility', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false),
      'realtimeOrders', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_realtime_orders', false)
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC publica: catalogo
-- ---------------------------------------------------------------------------

create or replace function public.ecommerce_get_catalog(
  p_slug text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_limit integer;
  v_offset integer;
  v_plan_limit integer;
  v_effective_limit integer;
  v_allow_stock_visibility boolean;
  v_items jsonb;
  v_count integer;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);

  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_plan_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_max_published_products', 0);
  v_effective_limit := v_limit;

  if v_plan_limit >= 0 then
    v_effective_limit := least(v_effective_limit, greatest(v_plan_limit - v_offset, 0));
  end if;

  v_allow_stock_visibility := private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false);

  select count(*)
  into v_count
  from public.ecommerce_published_products pp
  where pp.portal_id = v_portal.id
    and pp.deleted_at is null
    and pp.is_published is true;

  select coalesce(jsonb_agg(private.ecommerce_product_public_jsonb(x, v_allow_stock_visibility) order by x.display_order, x.public_name), '[]'::jsonb)
  into v_items
  from (
    select pp.*
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal.id
      and pp.deleted_at is null
      and pp.is_published is true
    order by pp.display_order, pp.public_name
    limit v_effective_limit
    offset v_offset
  ) x;

  return jsonb_build_object(
    'success', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'hasMore', case
        when v_plan_limit >= 0 then (v_offset + v_effective_limit) < least(v_count, v_plan_limit)
        else (v_offset + v_effective_limit) < v_count
      end
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers de pedido
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_build_whatsapp_message(
  p_portal_name text,
  p_order_code text,
  p_customer jsonb,
  p_items jsonb,
  p_total numeric,
  p_fulfillment_method text
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_lines text := '';
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_lines := v_lines || '- ' || coalesce(v_item ->> 'quantity', '0') || ' x '
      || coalesce(v_item ->> 'name', 'Producto') || ' = $'
      || coalesce(v_item ->> 'lineTotal', '0') || E'\n';
  end loop;

  return 'Hola, quiero realizar este pedido:' || E'\n\n'
    || 'Pedido: ' || coalesce(p_order_code, '') || E'\n'
    || 'Negocio: ' || coalesce(p_portal_name, '') || E'\n\n'
    || 'Productos:' || E'\n'
    || v_lines || E'\n'
    || 'Total estimado: $' || coalesce(p_total::text, '0') || E'\n'
    || 'Nombre: ' || coalesce(p_customer ->> 'name', '') || E'\n'
    || 'Telefono: ' || coalesce(p_customer ->> 'phone', '') || E'\n'
    || 'Entrega: ' || coalesce(p_fulfillment_method, '') || E'\n'
    || 'Notas: ' || coalesce(p_customer ->> 'notes', '');
end;
$$;

create or replace function private.ecommerce_order_public_jsonb(p_order public.ecommerce_orders)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'code', p_order.public_order_code,
    'status', p_order.status,
    'total', p_order.total,
    'currency', p_order.currency,
    'fulfillmentMethod', p_order.fulfillment_method,
    'createdAt', p_order.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC publica: crear pedido
-- ---------------------------------------------------------------------------

create or replace function public.ecommerce_create_order(
  p_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
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
  v_quantity numeric(12,3);
  v_items_count integer;
  v_subtotal numeric(12,2) := 0;
  v_line_total numeric(12,2);
  v_public_items jsonb := '[]'::jsonb;
  v_whatsapp_message text;
  v_whatsapp_url text;
  v_daily_limit integer;
  v_today_count integer;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);

  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  if v_portal.ordering_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  v_idempotency_key := left(btrim(coalesce(p_idempotency_key, '')), 160);
  if v_idempotency_key = '' then
    return private.ecommerce_public_error('ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED');
  end if;

  v_customer_name := left(btrim(coalesce(p_customer ->> 'name', '')), 120);
  v_customer_phone := left(btrim(coalesce(p_customer ->> 'phone', '')), 40);
  v_customer_address := left(btrim(coalesce(p_customer ->> 'address', '')), 500);
  v_customer_notes := left(btrim(coalesce(p_customer ->> 'notes', '')), 1000);
  v_fulfillment_method := lower(btrim(coalesce(p_customer ->> 'fulfillmentMethod', 'pickup')));

  if length(v_customer_name) < 2 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_NAME_REQUIRED');
  end if;

  if length(regexp_replace(v_customer_phone, '[^0-9]', '', 'g')) < 8 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_PHONE_REQUIRED');
  end if;

  if v_fulfillment_method not in ('pickup', 'delivery') then
    v_fulfillment_method := 'pickup';
  end if;

  if v_fulfillment_method = 'delivery' and v_portal.delivery_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_DELIVERY_NOT_AVAILABLE');
  end if;

  if v_fulfillment_method = 'pickup' and v_portal.pickup_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_PICKUP_NOT_AVAILABLE');
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    'ECOMMERCE_CREATE_ORDER',
    v_portal.license_id::text,
    null,
    20,
    600,
    900
  );

  if coalesce((v_rate_limit ->> 'allowed')::boolean, true) is not true then
    return private.ecommerce_public_error('ECOMMERCE_RATE_LIMITED');
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

  if jsonb_typeof(p_items) <> 'array' then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  v_items_count := jsonb_array_length(p_items);

  if v_items_count <= 0 then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  if v_items_count > v_portal.max_order_items then
    return private.ecommerce_public_error('ECOMMERCE_TOO_MANY_ITEMS');
  end if;

  v_daily_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_max_open_orders_per_day', 0);
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
      select pp.*
      into v_product
      from public.ecommerce_published_products pp
      where pp.id = (v_item ->> 'productId')::uuid
        and pp.portal_id = v_portal.id
        and pp.deleted_at is null
        and pp.is_published is true
      limit 1;
    exception
      when invalid_text_representation then
        return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end;

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

    if v_quantity <= 0 or v_quantity > v_portal.max_item_quantity then
      return private.ecommerce_public_error('ECOMMERCE_INVALID_QUANTITY');
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
      nullif(v_customer_address, ''),
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

  v_whatsapp_url := private.ecommerce_build_whatsapp_url(v_order.whatsapp_phone, v_order.whatsapp_message);

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
$$;

-- ---------------------------------------------------------------------------
-- Grants estrictos
-- ---------------------------------------------------------------------------

revoke all on function private.ecommerce_public_error(text) from public, anon, authenticated;
revoke all on function private.ecommerce_normalize_slug(text) from public, anon, authenticated;
revoke all on function private.ecommerce_get_public_portal_by_slug(text) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_hours_jsonb(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_product_public_jsonb(public.ecommerce_published_products, boolean) from public, anon, authenticated;
revoke all on function private.ecommerce_normalize_whatsapp_phone(text) from public, anon, authenticated;
revoke all on function private.ecommerce_url_encode_text(text) from public, anon, authenticated;
revoke all on function private.ecommerce_build_whatsapp_url(text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_build_whatsapp_message(text, text, jsonb, jsonb, numeric, text) from public, anon, authenticated;
revoke all on function private.ecommerce_order_public_jsonb(public.ecommerce_orders) from public, anon, authenticated;

revoke all on function public.ecommerce_get_portal_by_slug(text) from public;
revoke all on function public.ecommerce_get_catalog(text, integer, integer) from public;
revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text) from public;

grant execute on function public.ecommerce_get_portal_by_slug(text) to anon, authenticated;
grant execute on function public.ecommerce_get_catalog(text, integer, integer) to anon, authenticated;
grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text) to anon, authenticated;
