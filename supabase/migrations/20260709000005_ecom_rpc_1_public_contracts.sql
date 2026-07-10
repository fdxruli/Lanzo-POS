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
  join public.licenses l on l.id = p.license_id
  where p.slug = v_slug
    and p.deleted_at is null
    and p.status = 'published'
    and l.status::text = 'active'
    and (l.expires_at is null or l.expires_at > now())
    and private.ecommerce_license_feature_bool(p.license_id, 'ecommerce_portal_enabled', false) = true
  limit 1;

  if not found then
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
  select jsonb_strip_nulls(jsonb_build_object(
    'slug', (p_portal).slug,
    'name', (p_portal).name,
    'headline', (p_portal).headline,
    'description', (p_portal).description,
    'templateCode', (p_portal).template_code,
    'customizationLevel', (p_portal).customization_level,
    'theme', coalesce((p_portal).theme, '{}'::jsonb),
    'logoUrl', (p_portal).logo_url,
    'coverImageUrl', (p_portal).cover_image_url,
    'whatsappPhone', (p_portal).whatsapp_phone,
    'address', (p_portal).address,
    'businessType', coalesce(to_jsonb((p_portal).business_type), '[]'::jsonb),
    'orderingEnabled', (p_portal).ordering_enabled,
    'pickupEnabled', (p_portal).pickup_enabled,
    'deliveryEnabled', (p_portal).delivery_enabled,
    'scheduledOrdersEnabled', (p_portal).scheduled_orders_enabled,
    'minOrderTotal', (p_portal).min_order_total,
    'maxOrderItems', (p_portal).max_order_items,
    'maxItemQuantity', (p_portal).max_item_quantity,
    'stockMode', case
      when private.ecommerce_license_feature_bool((p_portal).license_id, 'ecommerce_stock_visibility', false)
        then (p_portal).stock_mode
      else 'hidden'
    end,
    'settings', '{}'::jsonb
  ));
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
        'opensAt', h.opens_at::text,
        'closesAt', h.closes_at::text
      ) order by h.weekday, h.sort_order, h.opens_at)
      from public.ecommerce_portal_hours h
      where h.portal_id = p_portal_id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'date', e.exception_date::text,
        'isOpen', e.is_open,
        'opensAt', e.opens_at::text,
        'closesAt', e.closes_at::text,
        'reason', e.reason
      )) order by e.exception_date)
      from public.ecommerce_portal_hour_exceptions e
      where e.portal_id = p_portal_id
    ), '[]'::jsonb)
  );
$$;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_stock jsonb;
  v_status text;
begin
  if coalesce(p_allow_stock_visibility, false) is not true
    or p_product.stock_mode = 'hidden' then
    v_stock := jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null);
  else
    v_status := case
      when p_product.is_available is not true then 'unavailable'
      when p_product.stock_snapshot is not null and p_product.stock_snapshot <= 0 then 'out_of_stock'
      else 'available'
    end;

    if p_product.stock_mode = 'status' then
      v_stock := jsonb_build_object('mode', 'status', 'status', v_status, 'quantity', null);
    elsif p_product.stock_mode = 'exact' and p_product.track_stock = true then
      v_stock := jsonb_build_object('mode', 'exact', 'status', v_status, 'quantity', p_product.stock_snapshot);
    else
      v_stock := jsonb_build_object('mode', p_product.stock_mode, 'status', v_status, 'quantity', null);
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', p_product.id::text,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', p_product.is_available,
    'displayOrder', p_product.display_order,
    'stock', v_stock,
    'options', coalesce(p_product.options, '{}'::jsonb)
  ));
end;
$$;

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
  v_message text;
  v_item jsonb;
  v_delivery_label text;
begin
  v_delivery_label := case p_fulfillment_method
    when 'delivery' then 'entrega a domicilio'
    else 'recoger'
  end;

  v_message := 'Hola, quiero realizar este pedido:' || chr(10) || chr(10)
    || 'Pedido: ' || coalesce(p_order_code, '') || chr(10)
    || 'Negocio: ' || coalesce(p_portal_name, '') || chr(10) || chr(10)
    || 'Productos:' || chr(10);

  for v_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_message := v_message
      || '- ' || coalesce(v_item->>'quantity', '0')
      || ' x ' || coalesce(v_item->>'name', 'Producto')
      || ' = $' || to_char(coalesce((v_item->>'lineTotal')::numeric, 0), 'FM999999990.00')
      || chr(10);
  end loop;

  v_message := v_message || chr(10)
    || 'Total estimado: $' || to_char(coalesce(p_total, 0), 'FM999999990.00') || chr(10)
    || 'Nombre: ' || coalesce(p_customer->>'name', '') || chr(10)
    || 'Telefono: ' || coalesce(p_customer->>'phone', '') || chr(10)
    || 'Entrega: ' || v_delivery_label;

  if nullif(btrim(coalesce(p_customer->>'address', '')), '') is not null then
    v_message := v_message || chr(10) || 'Direccion: ' || left(btrim(p_customer->>'address'), 240);
  end if;

  if nullif(btrim(coalesce(p_customer->>'notes', '')), '') is not null then
    v_message := v_message || chr(10) || 'Notas: ' || left(btrim(p_customer->>'notes'), 500);
  end if;

  return v_message;
end;
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
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');

  if v_phone = '' or length(v_phone) < 8 then
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
  ), '');
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
  v_allow_stock_visibility boolean;
  v_total integer;
  v_items jsonb;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);

  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_plan_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_max_published_products', 0);
  v_allow_stock_visibility := private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false);

  with ranked as (
    select
      pp as product,
      row_number() over (order by pp.display_order, pp.public_name, pp.id) as rn
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal.id
      and pp.deleted_at is null
      and pp.is_published = true
  ), capped as (
    select *
    from ranked
    where v_plan_limit < 0 or rn <= v_plan_limit
  ), paged as (
    select *
    from capped
    order by (product).display_order, (product).public_name, (product).id
    limit v_limit offset v_offset
  )
  select
    (select count(*)::integer from capped),
    coalesce(jsonb_agg(private.ecommerce_product_public_jsonb(paged.product, v_allow_stock_visibility)
      order by (paged.product).display_order, (paged.product).public_name, (paged.product).id), '[]'::jsonb)
  into v_total, v_items
  from paged;

  return jsonb_build_object(
    'success', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'hasMore', coalesce(v_total, 0) > (v_offset + v_limit)
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
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
security definer
set search_path to ''
as $$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_order public.ecommerce_orders%rowtype;
  v_existing_order public.ecommerce_orders%rowtype;
  v_customer_input jsonb;
  v_items_input jsonb;
  v_customer_name text;
  v_customer_phone text;
  v_customer_phone_digits text;
  v_customer_address text;
  v_customer_notes text;
  v_fulfillment_method text;
  v_idempotency_key text;
  v_item_count integer;
  v_item_record record;
  v_product_id_text text;
  v_product_id uuid;
  v_quantity_text text;
  v_quantity numeric(12,3);
  v_product public.ecommerce_published_products%rowtype;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_line_item jsonb;
  v_item_options jsonb;
  v_item_notes text;
  v_whatsapp_message text;
  v_whatsapp_phone text;
  v_whatsapp_url text;
  v_rate_limit jsonb;
  v_rate_fingerprint text;
  v_plan_product_limit integer;
  v_daily_limit integer;
  v_daily_count integer;
  v_constraint_name text;
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

  v_idempotency_key := left(btrim(coalesce(p_idempotency_key, '')), 128);

  if v_idempotency_key = '' then
    return private.ecommerce_public_error('ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED');
  end if;

  v_customer_input := case
    when jsonb_typeof(coalesce(p_customer, '{}'::jsonb)) = 'object' then coalesce(p_customer, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_customer_name := left(btrim(coalesce(v_customer_input->>'name', '')), 120);
  v_customer_phone := left(btrim(coalesce(v_customer_input->>'phone', '')), 32);
  v_customer_phone_digits := regexp_replace(v_customer_phone, '\D', '', 'g');
  v_customer_address := nullif(left(btrim(coalesce(v_customer_input->>'address', '')), 240), '');
  v_customer_notes := nullif(left(btrim(coalesce(v_customer_input->>'notes', '')), 500), '');
  v_fulfillment_method := lower(btrim(coalesce(v_customer_input->>'fulfillmentMethod', 'pickup')));

  if length(v_customer_name) < 2 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_NAME_REQUIRED');
  end if;

  if length(v_customer_phone_digits) < 8 then
    return private.ecommerce_public_error('ECOMMERCE_CUSTOMER_PHONE_REQUIRED');
  end if;

  if v_fulfillment_method not in ('pickup', 'delivery') then
    return private.ecommerce_public_error('ECOMMERCE_PICKUP_NOT_AVAILABLE');
  end if;

  if v_fulfillment_method = 'delivery' and v_portal.delivery_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_DELIVERY_NOT_AVAILABLE');
  end if;

  if v_fulfillment_method = 'pickup' and v_portal.pickup_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_PICKUP_NOT_AVAILABLE');
  end if;

  v_rate_fingerprint := encode(extensions.digest(v_customer_phone_digits || ':' || v_idempotency_key, 'sha256'), 'hex');
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    'ecom:' || v_portal.id::text,
    v_rate_fingerprint,
    null,
    'ecommerce_create_order',
    'ECOM_PUBLIC_ORDER',
    8,
    600,
    900,
    'ECOMMERCE_RATE_LIMITED',
    jsonb_build_object('portal', v_portal.slug)
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_public_error('ECOMMERCE_RATE_LIMITED');
  end if;

  select o.*
  into v_existing_order
  from public.ecommerce_orders o
  where o.portal_id = v_portal.id
    and o.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    if regexp_replace(v_existing_order.customer_phone, '\D', '', 'g') <> v_customer_phone_digits then
      return private.ecommerce_public_error('ECOMMERCE_IDEMPOTENCY_CONFLICT');
    end if;

    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'order', jsonb_build_object(
        'id', v_existing_order.id::text,
        'code', v_existing_order.public_order_code,
        'status', v_existing_order.status,
        'total', v_existing_order.total,
        'currency', v_existing_order.currency,
        'fulfillmentMethod', v_existing_order.fulfillment_method,
        'createdAt', v_existing_order.created_at
      ),
      'whatsapp', jsonb_build_object(
        'phone', private.ecommerce_normalize_whatsapp_phone(v_existing_order.whatsapp_phone),
        'message', v_existing_order.whatsapp_message,
        'url', private.ecommerce_build_whatsapp_url(v_existing_order.whatsapp_phone, v_existing_order.whatsapp_message)
      )
    );
  end if;

  v_plan_product_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_max_published_products', 0);
  v_daily_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_daily_order_limit', 0);

  if v_daily_limit = 0 then
    v_daily_limit := case when v_plan_product_limit >= 0 then 50 else 500 end;
  end if;

  if v_daily_limit > 0 then
    select count(*)::integer
    into v_daily_count
    from public.ecommerce_orders o
    where o.portal_id = v_portal.id
      and o.created_at >= date_trunc('day', now());

    if v_daily_count >= v_daily_limit then
      return private.ecommerce_public_error('ECOMMERCE_DAILY_ORDER_LIMIT_REACHED');
    end if;
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  v_items_input := p_items;
  v_item_count := jsonb_array_length(v_items_input);

  if v_item_count <= 0 then
    return private.ecommerce_public_error('ECOMMERCE_EMPTY_CART');
  end if;

  if v_item_count > v_portal.max_order_items then
    return private.ecommerce_public_error('ECOMMERCE_TOO_MANY_ITEMS');
  end if;

  for v_item_record in
    select value, ordinality
    from jsonb_array_elements(v_items_input) with ordinality as items(value, ordinality)
  loop
    if jsonb_typeof(v_item_record.value) <> 'object' then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    v_product_id_text := nullif(btrim(coalesce(v_item_record.value->>'productId', '')), '');

    if v_product_id_text is null
      or v_product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    v_product_id := v_product_id_text::uuid;
    v_quantity_text := btrim(coalesce(v_item_record.value->>'quantity', ''));

    if v_quantity_text !~ '^[0-9]+(\.[0-9]{1,3})?$' then
      return private.ecommerce_public_error('ECOMMERCE_INVALID_QUANTITY');
    end if;

    v_quantity := v_quantity_text::numeric(12,3);

    if v_quantity <= 0 or v_quantity > v_portal.max_item_quantity then
      return private.ecommerce_public_error('ECOMMERCE_INVALID_QUANTITY');
    end if;

    select pp.*
    into v_product
    from public.ecommerce_published_products pp
    where pp.id = v_product_id
      and pp.portal_id = v_portal.id
      and pp.deleted_at is null
      and pp.is_published = true
    limit 1;

    if not found then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    if v_product.is_available is not true then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_AVAILABLE');
    end if;

    v_line_total := round(v_product.price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_item_options := case
      when jsonb_typeof(coalesce(v_item_record.value->'options', '{}'::jsonb)) = 'object'
        then coalesce(v_item_record.value->'options', '{}'::jsonb)
      else '{}'::jsonb
    end;
    v_item_notes := nullif(left(btrim(coalesce(v_item_record.value->>'notes', '')), 300), '');

    v_line_item := jsonb_strip_nulls(jsonb_build_object(
      'publishedProductId', v_product.id::text,
      'sourceProductId', v_product.product_id,
      'name', v_product.public_name,
      'unitPrice', v_product.price,
      'quantity', v_quantity,
      'lineTotal', v_line_total,
      'options', v_item_options,
      'notes', v_item_notes
    ));

    v_line_items := v_line_items || jsonb_build_array(v_line_item);
  end loop;

  v_total := round(v_subtotal, 2);

  if v_subtotal < v_portal.min_order_total then
    return private.ecommerce_public_error('ECOMMERCE_MIN_ORDER_NOT_REACHED');
  end if;

  begin
    insert into public.ecommerce_orders (
      portal_id,
      license_id,
      status,
      channel,
      fulfillment_method,
      customer_name,
      customer_phone,
      customer_address,
      customer_notes,
      subtotal,
      delivery_fee,
      discount_total,
      tax_total,
      total,
      currency,
      payment_method,
      payment_status,
      whatsapp_phone,
      whatsapp_status,
      system_notification_status,
      pos_visibility_status,
      stock_reservation_status,
      idempotency_key,
      metadata
    ) values (
      v_portal.id,
      v_portal.license_id,
      'new',
      'public_store',
      v_fulfillment_method,
      v_customer_name,
      v_customer_phone_digits,
      v_customer_address,
      v_customer_notes,
      v_subtotal,
      0,
      0,
      0,
      v_total,
      'MXN',
      'on_delivery',
      'pending',
      v_portal.whatsapp_phone,
      'pending_client_send',
      'pending',
      'pending',
      'not_applicable',
      v_idempotency_key,
      jsonb_build_object('source', 'public_store')
    )
    returning * into v_order;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;

      if v_constraint_name = 'ux_ecommerce_orders_portal_idempotency_key' then
        select o.*
        into v_existing_order
        from public.ecommerce_orders o
        where o.portal_id = v_portal.id
          and o.idempotency_key = v_idempotency_key
        limit 1;

        if found then
          if regexp_replace(v_existing_order.customer_phone, '\D', '', 'g') <> v_customer_phone_digits then
            return private.ecommerce_public_error('ECOMMERCE_IDEMPOTENCY_CONFLICT');
          end if;

          return jsonb_build_object(
            'success', true,
            'idempotent', true,
            'order', jsonb_build_object(
              'id', v_existing_order.id::text,
              'code', v_existing_order.public_order_code,
              'status', v_existing_order.status,
              'total', v_existing_order.total,
              'currency', v_existing_order.currency,
              'fulfillmentMethod', v_existing_order.fulfillment_method,
              'createdAt', v_existing_order.created_at
            ),
            'whatsapp', jsonb_build_object(
              'phone', private.ecommerce_normalize_whatsapp_phone(v_existing_order.whatsapp_phone),
              'message', v_existing_order.whatsapp_message,
              'url', private.ecommerce_build_whatsapp_url(v_existing_order.whatsapp_phone, v_existing_order.whatsapp_message)
            )
          );
        end if;
      end if;

      return private.ecommerce_public_error('ECOMMERCE_ORDER_CREATE_FAILED');
  end;

  for v_item_record in
    select value, ordinality
    from jsonb_array_elements(v_line_items) with ordinality as items(value, ordinality)
  loop
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
      (v_item_record.value->>'publishedProductId')::uuid,
      v_item_record.value->>'sourceProductId',
      v_item_record.value->>'name',
      (v_item_record.value->>'unitPrice')::numeric,
      (v_item_record.value->>'quantity')::numeric,
      (v_item_record.value->>'lineTotal')::numeric,
      coalesce(v_item_record.value->'options', '{}'::jsonb),
      jsonb_strip_nulls(jsonb_build_object('notes', v_item_record.value->>'notes'))
    );
  end loop;

  v_whatsapp_message := private.ecommerce_build_whatsapp_message(
    v_portal.name,
    v_order.public_order_code,
    jsonb_build_object(
      'name', v_customer_name,
      'phone', v_customer_phone_digits,
      'address', v_customer_address,
      'notes', v_customer_notes
    ),
    v_line_items,
    v_total,
    v_fulfillment_method
  );
  v_whatsapp_phone := private.ecommerce_normalize_whatsapp_phone(v_portal.whatsapp_phone);
  v_whatsapp_url := private.ecommerce_build_whatsapp_url(v_portal.whatsapp_phone, v_whatsapp_message);

  update public.ecommerce_orders
  set whatsapp_message = v_whatsapp_message,
      whatsapp_phone = v_whatsapp_phone
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
      'itemCount', v_item_count,
      'total', v_total,
      'fulfillmentMethod', v_fulfillment_method
    )
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'order', jsonb_build_object(
      'id', v_order.id::text,
      'code', v_order.public_order_code,
      'status', v_order.status,
      'total', v_order.total,
      'currency', v_order.currency,
      'fulfillmentMethod', v_order.fulfillment_method,
      'createdAt', v_order.created_at
    ),
    'whatsapp', jsonb_build_object(
      'phone', v_whatsapp_phone,
      'message', v_whatsapp_message,
      'url', v_whatsapp_url
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_ORDER_CREATE_FAILED');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: solo EXECUTE sobre RPCs publicas. Sin grants directos sobre tablas.
-- ---------------------------------------------------------------------------

revoke all on function private.ecommerce_public_error(text) from public, anon, authenticated;
revoke all on function private.ecommerce_normalize_slug(text) from public, anon, authenticated;
revoke all on function private.ecommerce_get_public_portal_by_slug(text) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_hours_jsonb(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_product_public_jsonb(public.ecommerce_published_products, boolean) from public, anon, authenticated;
revoke all on function private.ecommerce_build_whatsapp_message(text, text, jsonb, jsonb, numeric, text) from public, anon, authenticated;
revoke all on function private.ecommerce_normalize_whatsapp_phone(text) from public, anon, authenticated;
revoke all on function private.ecommerce_url_encode_text(text) from public, anon, authenticated;
revoke all on function private.ecommerce_build_whatsapp_url(text, text) from public, anon, authenticated;

grant execute on function private.ecommerce_public_error(text) to service_role;
grant execute on function private.ecommerce_normalize_slug(text) to service_role;
grant execute on function private.ecommerce_get_public_portal_by_slug(text) to service_role;
grant execute on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals) to service_role;
grant execute on function private.ecommerce_portal_hours_jsonb(uuid) to service_role;
grant execute on function private.ecommerce_product_public_jsonb(public.ecommerce_published_products, boolean) to service_role;
grant execute on function private.ecommerce_build_whatsapp_message(text, text, jsonb, jsonb, numeric, text) to service_role;
grant execute on function private.ecommerce_normalize_whatsapp_phone(text) to service_role;
grant execute on function private.ecommerce_url_encode_text(text) to service_role;
grant execute on function private.ecommerce_build_whatsapp_url(text, text) to service_role;

revoke all on function public.ecommerce_get_portal_by_slug(text) from public, anon, authenticated;
revoke all on function public.ecommerce_get_catalog(text, integer, integer) from public, anon, authenticated;
revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.ecommerce_get_portal_by_slug(text) to anon, authenticated;
grant execute on function public.ecommerce_get_catalog(text, integer, integer) to anon, authenticated;
grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text) to anon, authenticated;

comment on function public.ecommerce_get_portal_by_slug(text) is
  'ECOM.RPC.1: devuelve configuracion publica sanitizada del portal por slug. No expone ids internos ni tablas.';
comment on function public.ecommerce_get_catalog(text, integer, integer) is
  'ECOM.RPC.1: devuelve catalogo publico sanitizado y respeta limites FREE/PRO y visibilidad de stock.';
comment on function public.ecommerce_create_order(text, jsonb, jsonb, text) is
  'ECOM.RPC.1: crea solicitud de pedido online con precios recalculados en Supabase; no afecta caja, ventas ni inventario.';

notify pgrst, 'reload schema';
