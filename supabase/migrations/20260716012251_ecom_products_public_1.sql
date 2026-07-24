-- FASE ECOM.PRODUCTS.PUBLIC.1
-- Seleccion publica de variantes, extras y configuraciones.
-- Migracion compensatoria: no modifica las migraciones MODEL.1.

create or replace function private.ecommerce_product_publicly_available(
  p_product public.ecommerce_published_products
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_product.id is null
     or p_product.deleted_at is not null
     or p_product.is_published is not true
     or p_product.manual_available is not true then
    return false;
  end if;

  if p_product.requires_configuration is not true then
    return p_product.is_available is true;
  end if;

  if p_product.availability_source = 'unverified' then
    return false;
  end if;

  if p_product.has_variants is true then
    return exists (
      select 1
      from public.ecommerce_published_product_variants v
      where v.published_product_id = p_product.id
        and v.portal_id = p_product.portal_id
        and v.license_id = p_product.license_id
        and v.deleted_at is null
        and v.manual_available is true
        and v.source_available is true
        and v.is_available is true
    );
  end if;

  if p_product.availability_source = 'not_tracked' then
    return true;
  end if;

  if p_product.source_available is not true then
    return false;
  end if;

  if p_product.stock_mode in ('status', 'exact', 'reserve_on_confirm')
     and p_product.stock_snapshot is not null
     and p_product.stock_snapshot <= 0 then
    return false;
  end if;

  return true;
end;
$function$;

revoke execute on function private.ecommerce_product_publicly_available(public.ecommerce_published_products)
  from public, anon, authenticated;
grant execute on function private.ecommerce_product_publicly_available(public.ecommerce_published_products)
  to service_role;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_product.id,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', private.ecommerce_product_publicly_available(p_product),
    'displayOrder', p_product.display_order,
    'configuration', jsonb_build_object(
      'type', p_product.configuration_type,
      'version', p_product.configuration_version,
      'hasVariants', p_product.has_variants,
      'hasOptionGroups', p_product.has_option_groups,
      'requiresConfiguration', p_product.requires_configuration
    ),
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
      when p_product.requires_configuration is true
           and p_product.has_variants is true then jsonb_build_object(
        'mode', 'hidden',
        'status', case
          when private.ecommerce_product_publicly_available(p_product) then 'available'
          else 'out_of_stock'
        end,
        'quantity', null
      )
      when p_product.source_state not in ('in_stock', 'out_of_stock')
        or p_product.stock_snapshot is null then jsonb_build_object(
        'mode', 'hidden',
        'status', case
          when private.ecommerce_product_publicly_available(p_product) then 'available'
          else 'out_of_stock'
        end,
        'quantity', null
      )
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status',
        'status', case
          when private.ecommerce_product_publicly_available(p_product)
               and p_product.stock_snapshot > 0 then 'available'
          else 'out_of_stock'
        end,
        'quantity', null
      )
      when p_product.stock_mode in ('exact', 'reserve_on_confirm') then jsonb_build_object(
        'mode', 'exact',
        'status', case
          when private.ecommerce_product_publicly_available(p_product)
               and p_product.stock_snapshot > 0 then 'available'
          else 'out_of_stock'
        end,
        'quantity', greatest(floor(p_product.stock_snapshot), 0)
      )
      else jsonb_build_object(
        'mode', 'hidden',
        'status', case
          when private.ecommerce_product_publicly_available(p_product) then 'available'
          else 'out_of_stock'
        end,
        'quantity', null
      )
    end,
    'options', p_product.options
  );
$function$;

revoke execute on function private.ecommerce_product_public_jsonb(
  public.ecommerce_published_products,
  boolean
) from public, anon, authenticated;
grant execute on function private.ecommerce_product_public_jsonb(
  public.ecommerce_published_products,
  boolean
) to service_role;

create or replace function private.ecommerce_enforce_product_configuration_rate_limit(
  p_portal_id uuid,
  p_license_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_portal_id is null or p_license_id is null or p_product_id is null then
    raise exception 'ECOMMERCE_RATE_LIMIT_CONTEXT_REQUIRED';
  end if;

  return public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-license:' || p_license_id::text,
    p_device_fingerprint := 'public-store-product:' || p_portal_id::text || ':' || p_product_id::text,
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_get_product_configuration',
    p_scope := 'ECOMMERCE_PRODUCT_CONFIGURATION',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 900,
    p_code := 'ECOMMERCE_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'source', 'ecommerce_public_store',
      'portal_id', p_portal_id,
      'license_id', p_license_id,
      'phase', 'ECOM.PRODUCTS.PUBLIC.1'
    )
  );
end;
$function$;

revoke execute on function private.ecommerce_enforce_product_configuration_rate_limit(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.ecommerce_enforce_product_configuration_rate_limit(uuid, uuid, uuid)
  to service_role;

create or replace function public.ecommerce_get_product_configuration(
  p_slug text,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_product public.ecommerce_published_products%rowtype;
  v_allow_stock_visibility boolean;
  v_rate_limit jsonb;
  v_variants jsonb;
  v_groups jsonb;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  if p_product_id is null then
    return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;

  select pp.*
  into v_product
  from public.ecommerce_published_products pp
  where pp.id = p_product_id
    and pp.portal_id = v_portal.id
    and pp.license_id = v_portal.license_id
    and pp.deleted_at is null
    and pp.is_published is true
  limit 1;

  if v_product.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;

  v_rate_limit := private.ecommerce_enforce_product_configuration_rate_limit(
    v_portal.id,
    v_portal.license_id,
    v_product.id
  );
  if coalesce((v_rate_limit ->> 'allowed')::boolean, true) is not true then
    return private.ecommerce_public_error('ECOMMERCE_RATE_LIMITED');
  end if;

  v_allow_stock_visibility := private.ecommerce_license_feature_bool(
    v_portal.license_id,
    'ecommerce_stock_visibility',
    false
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'publicName', coalesce(nullif(btrim(v.public_name), ''), (
          select string_agg(e.value, ' / ' order by e.key)
          from jsonb_each_text(v.option_values) e
        )),
        'optionValues', v.option_values,
        'priceMode', v.price_mode,
        'priceValue', v.price_value,
        'imageUrl', v.image_url,
        'stock', case
          when v_allow_stock_visibility is not true then jsonb_build_object(
            'mode', 'hidden',
            'status', case when v.is_available then 'available' else 'out_of_stock' end,
            'quantity', null
          )
          when v.stock_mode = 'status' then jsonb_build_object(
            'mode', 'status',
            'status', case when v.is_available then 'available' else 'out_of_stock' end,
            'quantity', null
          )
          when v.stock_mode = 'exact' then jsonb_build_object(
            'mode', 'exact',
            'status', case when v.is_available then 'available' else 'out_of_stock' end,
            'quantity', case
              when v.stock_snapshot is null then null
              else greatest(floor(v.stock_snapshot), 0)
            end
          )
          else jsonb_build_object(
            'mode', 'hidden',
            'status', case when v.is_available then 'available' else 'out_of_stock' end,
            'quantity', null
          )
        end,
        'isAvailable', (
          v.manual_available is true
          and v.source_available is true
          and v.is_available is true
        ),
        'displayOrder', v.display_order
      )
      order by v.display_order, v.public_name, v.id
    ),
    '[]'::jsonb
  )
  into v_variants
  from public.ecommerce_published_product_variants v
  where v.published_product_id = v_product.id
    and v.portal_id = v_portal.id
    and v.license_id = v_portal.license_id
    and v.deleted_at is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'publicName', g.public_name,
        'selectionType', g.selection_type,
        'required', g.required,
        'minSelect', g.min_select,
        'maxSelect', g.max_select,
        'displayOrder', g.display_order,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'publicName', o.public_name,
              'priceDelta', o.price_delta,
              'isAvailable', (
                o.manual_available is true
                and o.source_available is true
                and o.is_available is true
              ),
              'displayOrder', o.display_order
            )
            order by o.display_order, o.public_name, o.id
          )
          from public.ecommerce_published_options o
          where o.group_id = g.id
            and o.published_product_id = v_product.id
            and o.portal_id = v_portal.id
            and o.license_id = v_portal.license_id
            and o.deleted_at is null
        ), '[]'::jsonb)
      )
      order by g.display_order, g.public_name, g.id
    ),
    '[]'::jsonb
  )
  into v_groups
  from public.ecommerce_published_option_groups g
  where g.published_product_id = v_product.id
    and g.portal_id = v_portal.id
    and g.license_id = v_portal.license_id
    and g.deleted_at is null;

  return jsonb_build_object(
    'success', true,
    'catalogRevision', v_portal.catalog_revision,
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.public_name,
      'description', v_product.public_description,
      'imageUrl', v_product.image_url,
      'currency', v_product.currency,
      'configurationType', v_product.configuration_type,
      'configurationVersion', v_product.configuration_version,
      'requiresConfiguration', v_product.requires_configuration,
      'hasVariants', v_product.has_variants,
      'hasOptionGroups', v_product.has_option_groups,
      'basePrice', v_product.price,
      'isAvailable', private.ecommerce_product_publicly_available(v_product),
      'availability', jsonb_build_object(
        'source', v_product.availability_source,
        'status', case
          when private.ecommerce_product_publicly_available(v_product) then 'available'
          else 'unavailable'
        end,
        'message', case
          when private.ecommerce_product_publicly_available(v_product)
            then 'Disponible'
          else 'No disponible'
        end
      )
    ),
    'variants', v_variants,
    'groups', v_groups
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
end;
$function$;

revoke execute on function public.ecommerce_get_product_configuration(text, uuid)
  from public, anon, authenticated;
grant execute on function public.ecommerce_get_product_configuration(text, uuid)
  to anon, authenticated, service_role;

create or replace function private.ecommerce_public_error(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'success', false,
    'error', jsonb_build_object(
      'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR'),
      'message', case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR')
        when 'ECOMMERCE_PORTAL_NOT_FOUND' then 'La tienda no esta disponible.'
        when 'ECOMMERCE_CATALOG_REVISION_CHANGED' then 'El catalogo cambio mientras se cargaba.'
        when 'ECOMMERCE_ORDERING_DISABLED' then 'Este negocio no esta recibiendo pedidos en este momento.'
        when 'ECOMMERCE_ORDERS_PAUSED' then 'Este negocio pauso temporalmente la recepcion de pedidos.'
        when 'ECOMMERCE_STORE_CLOSED' then 'Este negocio esta cerrado en este momento.'
        when 'ECOMMERCE_SCHEDULE_NOT_CONFIGURED' then 'Este negocio no puede recibir pedidos por ahora.'
        when 'ECOMMERCE_CUSTOMER_NAME_REQUIRED' then 'Escribe tu nombre para continuar.'
        when 'ECOMMERCE_CUSTOMER_PHONE_REQUIRED' then 'Escribe un telefono valido para continuar.'
        when 'ECOMMERCE_INVALID_FULFILLMENT_METHOD' then 'Selecciona una modalidad valida para recibir tu pedido.'
        when 'ECOMMERCE_DELIVERY_ADDRESS_REQUIRED' then 'Escribe la direccion de entrega para continuar.'
        when 'ECOMMERCE_DELIVERY_NOT_AVAILABLE' then 'Este negocio no tiene entrega a domicilio disponible.'
        when 'ECOMMERCE_PICKUP_NOT_AVAILABLE' then 'Este negocio no tiene recoleccion disponible.'
        when 'ECOMMERCE_EMPTY_CART' then 'Agrega al menos un producto para continuar.'
        when 'ECOMMERCE_TOO_MANY_ITEMS' then 'El pedido tiene demasiados productos.'
        when 'ECOMMERCE_DUPLICATE_PRODUCT' then 'El carrito contiene productos repetidos. Actualizalo e intenta nuevamente.'
        when 'ECOMMERCE_PRODUCT_NOT_FOUND' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_PRODUCT_NOT_AVAILABLE' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_INVALID_QUANTITY' then 'Revisa la cantidad de productos.'
        when 'ECOMMERCE_STOCK_LIMIT_EXCEEDED' then 'La cantidad solicitada supera la disponibilidad actual.'
        when 'ECOMMERCE_INSUFFICIENT_STOCK' then 'La cantidad solicitada supera la disponibilidad actual.'
        when 'ECOMMERCE_MIN_ORDER_NOT_REACHED' then 'El pedido no alcanza el minimo requerido.'
        when 'ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_IDEMPOTENCY_CONFLICT' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_RATE_LIMITED' then 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
        when 'ECOMMERCE_DAILY_ORDER_LIMIT_REACHED' then 'Este negocio no puede recibir mas pedidos por ahora.'
        when 'ECOMMERCE_CONFIGURATION_REQUIRED' then 'Selecciona las opciones requeridas para continuar.'
        when 'ECOMMERCE_VARIANT_REQUIRED' then 'Selecciona una variante para continuar.'
        when 'ECOMMERCE_VARIANT_NOT_FOUND' then 'La variante seleccionada ya no esta disponible.'
        when 'ECOMMERCE_VARIANT_UNAVAILABLE' then 'La variante seleccionada ya no esta disponible.'
        when 'ECOMMERCE_OPTION_GROUP_REQUIRED' then 'Selecciona una opcion requerida.'
        when 'ECOMMERCE_OPTION_SELECTION_TOO_FEW' then 'Faltan opciones requeridas.'
        when 'ECOMMERCE_OPTION_SELECTION_TOO_MANY' then 'Seleccionaste demasiadas opciones.'
        when 'ECOMMERCE_OPTION_NOT_FOUND' then 'Una opcion seleccionada ya no esta disponible.'
        when 'ECOMMERCE_OPTION_UNAVAILABLE' then 'Una opcion seleccionada ya no esta disponible.'
        when 'ECOMMERCE_CONFIGURATION_CHANGED' then 'La configuracion del producto cambio. Vuelve a seleccionarla.'
        when 'ECOMMERCE_CONFIGURATION_INVALID' then 'Revisa la configuracion del producto.'
        when 'ECOMMERCE_ORDER_CREATE_FAILED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        else 'No se pudo completar la solicitud.'
      end
    )
  );
$function$;

revoke execute on function private.ecommerce_public_error(text)
  from public, anon, authenticated;
grant execute on function private.ecommerce_public_error(text)
  to service_role;

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
set search_path = ''
as $function$
declare
  v_lines text := '';
  v_item jsonb;
  v_group jsonb;
  v_option_names text;
  v_snapshot jsonb;
begin
  for v_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_lines := v_lines
      || coalesce(v_item ->> 'name', 'Producto')
      || ' x ' || coalesce(v_item ->> 'quantity', '0') || E'\n';

    v_snapshot := coalesce(v_item -> 'configurationSnapshot', '{}'::jsonb);
    if nullif(v_snapshot #>> '{variant,name}', '') is not null then
      v_lines := v_lines || 'Variante: '
        || left(v_snapshot #>> '{variant,name}', 240) || E'\n';
    end if;

    for v_group in
      select value from jsonb_array_elements(coalesce(v_snapshot -> 'groups', '[]'::jsonb))
    loop
      select string_agg(left(value ->> 'name', 160), ', ' order by ordinality)
      into v_option_names
      from jsonb_array_elements(coalesce(v_group -> 'options', '[]'::jsonb))
        with ordinality;
      if nullif(v_option_names, '') is not null then
        v_lines := v_lines
          || left(coalesce(v_group ->> 'name', 'Opciones'), 160)
          || ': ' || v_option_names || E'\n';
      end if;
    end loop;

    v_lines := v_lines
      || 'Precio unitario: $' || coalesce(v_item ->> 'unitPrice', '0') || E'\n'
      || 'Subtotal: $' || coalesce(v_item ->> 'lineTotal', '0') || E'\n\n';
  end loop;

  return left(
    'Hola, quiero realizar este pedido:' || E'\n\n'
    || 'Pedido: ' || coalesce(p_order_code, '') || E'\n'
    || 'Negocio: ' || coalesce(p_portal_name, '') || E'\n\n'
    || 'Productos:' || E'\n'
    || v_lines
    || 'Total estimado: $' || coalesce(p_total::text, '0') || E'\n'
    || 'Nombre: ' || coalesce(p_customer ->> 'name', '') || E'\n'
    || 'Telefono: ' || coalesce(p_customer ->> 'phone', '') || E'\n'
    || 'Entrega: ' || coalesce(p_fulfillment_method, '') || E'\n'
    || case
      when nullif(btrim(coalesce(p_customer ->> 'notes', '')), '') is not null
        then 'Indicaciones: ' || left(p_customer ->> 'notes', 1000)
      else 'Indicaciones: Ninguna'
    end,
    8000
  );
end;
$function$;

revoke execute on function private.ecommerce_build_whatsapp_message(
  text, text, jsonb, jsonb, numeric, text
) from public, anon, authenticated;
grant execute on function private.ecommerce_build_whatsapp_message(
  text, text, jsonb, jsonb, numeric, text
) to service_role;

create or replace function public.ecommerce_create_order(
  p_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_variant public.ecommerce_published_product_variants%rowtype;
  v_group public.ecommerce_published_option_groups%rowtype;
  v_option public.ecommerce_published_options%rowtype;
  v_group_row record;
  v_product_id uuid;
  v_variant_id uuid;
  v_group_id uuid;
  v_option_id uuid;
  v_quantity numeric(12,3);
  v_items_count integer;
  v_subtotal numeric(12,2) := 0;
  v_line_total numeric(12,2);
  v_base_unit_price numeric(12,2);
  v_variant_adjustment numeric(12,2);
  v_options_adjustment numeric(12,2);
  v_final_unit_price numeric(12,2);
  v_public_items jsonb := '[]'::jsonb;
  v_validated_item jsonb;
  v_snapshot jsonb;
  v_snapshot_variant jsonb;
  v_snapshot_groups jsonb;
  v_snapshot_group jsonb;
  v_snapshot_options jsonb;
  v_selections jsonb;
  v_selection jsonb;
  v_option_ids jsonb;
  v_selected_group_ids uuid[];
  v_selected_option_ids uuid[];
  v_selection_count integer;
  v_product_demand numeric(12,3);
  v_variant_demand numeric(12,3);
  v_product_demands jsonb := '{}'::jsonb;
  v_variant_demands jsonb := '{}'::jsonb;
  v_whatsapp_message text;
  v_whatsapp_url text;
  v_daily_limit integer;
  v_today_count integer;
  v_availability jsonb;
  v_item_key text;
  v_selection_key text;
  v_expected_configuration_version integer;
begin
  -- CRITICAL: preserve idempotent replay before all mutable validation.
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
        'url', private.ecommerce_build_whatsapp_url(
          v_existing_order.whatsapp_phone,
          v_existing_order.whatsapp_message
        )
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

  v_availability := private.ecommerce_evaluate_portal_availability(
    v_portal,
    clock_timestamp()
  );
  if v_availability ->> 'code' = 'ORDERING_DISABLED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  elsif v_availability ->> 'code' = 'ORDERS_PAUSED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERS_PAUSED');
  elsif v_availability ->> 'code' = 'OUTSIDE_BUSINESS_HOURS' then
    return private.ecommerce_public_error('ECOMMERCE_STORE_CLOSED');
  elsif v_availability ->> 'code' = 'SCHEDULE_NOT_CONFIGURED' then
    return private.ecommerce_public_error('ECOMMERCE_SCHEDULE_NOT_CONFIGURED');
  elsif coalesce((v_availability ->> 'acceptingOrders')::boolean, false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if private.ecommerce_license_feature_bool(
    v_portal.license_id,
    'ecommerce_order_inbox',
    false
  ) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or octet_length(p_items::text) > 65536 then
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    for v_item_key in select jsonb_object_keys(v_item)
    loop
      if v_item_key not in (
        'productId', 'quantity', 'variantId', 'selections', 'configurationVersion',
        'price', 'unitPrice', 'basePrice', 'variantPrice', 'optionPrice',
        'total', 'subtotal'
      ) then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end if;
    end loop;

    begin
      v_product_id := (v_item ->> 'productId')::uuid;
    exception
      when invalid_text_representation or null_value_not_allowed then
        return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end;

    if v_product_id is null then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    select pp.*
    into v_product
    from public.ecommerce_published_products pp
    where pp.id = v_product_id
      and pp.portal_id = v_portal.id
      and pp.license_id = v_portal.license_id
      and pp.deleted_at is null
      and pp.is_published is true
    limit 1;

    if v_product.id is null then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end if;

    if v_item ? 'configurationVersion' then
      begin
        v_expected_configuration_version := (v_item ->> 'configurationVersion')::integer;
      exception when others then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_CHANGED');
      end;
      if v_expected_configuration_version <> v_product.configuration_version then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_CHANGED');
      end if;
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

    v_variant_id := null;
    if nullif(btrim(coalesce(v_item ->> 'variantId', '')), '') is not null then
      begin
        v_variant_id := (v_item ->> 'variantId')::uuid;
      exception when invalid_text_representation then
        return private.ecommerce_public_error('ECOMMERCE_VARIANT_NOT_FOUND');
      end;
    end if;

    v_selections := coalesce(v_item -> 'selections', '[]'::jsonb);
    if jsonb_typeof(v_selections) <> 'array'
       or jsonb_array_length(v_selections) > 20 then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    if v_product.configuration_type = 'simple'
       and (
         v_variant_id is not null
         or jsonb_array_length(v_selections) > 0
       ) then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    if v_product.has_variants is true or v_product.configuration_type = 'variant_parent' then
      if v_variant_id is null then
        return private.ecommerce_public_error('ECOMMERCE_VARIANT_REQUIRED');
      end if;

      select v.*
      into v_variant
      from public.ecommerce_published_product_variants v
      where v.id = v_variant_id
        and v.published_product_id = v_product.id
        and v.portal_id = v_portal.id
        and v.license_id = v_portal.license_id
        and v.deleted_at is null
      limit 1;

      if v_variant.id is null then
        return private.ecommerce_public_error('ECOMMERCE_VARIANT_NOT_FOUND');
      end if;

      if v_variant.manual_available is not true
         or v_variant.source_available is not true
         or v_variant.is_available is not true then
        return private.ecommerce_public_error('ECOMMERCE_VARIANT_UNAVAILABLE');
      end if;
    elsif v_variant_id is not null then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    if v_product.requires_configuration is true
       and v_variant_id is null
       and jsonb_array_length(v_selections) = 0 then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_REQUIRED');
    end if;

    if v_product.requires_configuration is not true then
      if v_product.is_available is not true then
        return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_AVAILABLE');
      end if;
    elsif private.ecommerce_product_publicly_available(v_product) is not true then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
    end if;

    if v_product.manual_available is not true then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
    end if;

    if v_product.availability_source = 'unverified' then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
    end if;

    if v_product.availability_source <> 'not_tracked'
       and v_product.has_variants is not true
       and v_product.source_available is not true then
      return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
    end if;

    v_base_unit_price := round(v_product.price::numeric, 2);
    v_variant_adjustment := 0;

    if v_variant_id is not null then
      if v_variant.price_mode = 'absolute' then
        v_variant_adjustment := round(v_variant.price_value - v_base_unit_price, 2);
        v_base_unit_price := round(v_variant.price_value, 2);
      elsif v_variant.price_mode = 'delta' then
        v_variant_adjustment := round(v_variant.price_value, 2);
        v_base_unit_price := round(v_base_unit_price + v_variant.price_value, 2);
      end if;
    end if;

    v_options_adjustment := 0;
    v_snapshot_groups := '[]'::jsonb;
    v_selected_group_ids := array[]::uuid[];

    for v_selection in select value from jsonb_array_elements(v_selections)
    loop
      if jsonb_typeof(v_selection) <> 'object' then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end if;

      for v_selection_key in select jsonb_object_keys(v_selection)
      loop
        if v_selection_key not in ('groupId', 'optionIds') then
          return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
        end if;
      end loop;

      begin
        v_group_id := (v_selection ->> 'groupId')::uuid;
      exception when invalid_text_representation or null_value_not_allowed then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end;

      if v_group_id = any(v_selected_group_ids) then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end if;
      v_selected_group_ids := array_append(v_selected_group_ids, v_group_id);

      select g.*
      into v_group
      from public.ecommerce_published_option_groups g
      where g.id = v_group_id
        and g.published_product_id = v_product.id
        and g.portal_id = v_portal.id
        and g.license_id = v_portal.license_id
        and g.deleted_at is null
      limit 1;

      if v_group.id is null then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end if;

      v_option_ids := coalesce(v_selection -> 'optionIds', '[]'::jsonb);
      if jsonb_typeof(v_option_ids) <> 'array'
         or jsonb_array_length(v_option_ids) > 50 then
        return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
      end if;

      v_selection_count := jsonb_array_length(v_option_ids);
      if v_group.selection_type = 'single' and v_selection_count > 1 then
        return private.ecommerce_public_error('ECOMMERCE_OPTION_SELECTION_TOO_MANY');
      end if;
      if v_selection_count < v_group.min_select then
        return private.ecommerce_public_error(
          case when v_group.required then 'ECOMMERCE_OPTION_GROUP_REQUIRED'
               else 'ECOMMERCE_OPTION_SELECTION_TOO_FEW' end
        );
      end if;
      if v_selection_count > v_group.max_select then
        return private.ecommerce_public_error('ECOMMERCE_OPTION_SELECTION_TOO_MANY');
      end if;

      v_selected_option_ids := array[]::uuid[];
      v_snapshot_options := '[]'::jsonb;

      for v_selection_key in
        select case
          when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
          else null
        end
        from jsonb_array_elements(v_option_ids)
      loop
        if v_selection_key is null
           or v_selection_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          return private.ecommerce_public_error('ECOMMERCE_OPTION_NOT_FOUND');
        end if;
        v_option_id := v_selection_key::uuid;
        if v_option_id = any(v_selected_option_ids) then
          return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
        end if;
        v_selected_option_ids := array_append(v_selected_option_ids, v_option_id);

        select o.*
        into v_option
        from public.ecommerce_published_options o
        where o.id = v_option_id
          and o.group_id = v_group.id
          and o.published_product_id = v_product.id
          and o.portal_id = v_portal.id
          and o.license_id = v_portal.license_id
          and o.deleted_at is null
        limit 1;

        if v_option.id is null then
          return private.ecommerce_public_error('ECOMMERCE_OPTION_NOT_FOUND');
        end if;

        if v_option.manual_available is not true
           or v_option.source_available is not true
           or v_option.is_available is not true then
          return private.ecommerce_public_error('ECOMMERCE_OPTION_UNAVAILABLE');
        end if;

        v_options_adjustment := round(v_options_adjustment + v_option.price_delta, 2);
        v_snapshot_options := v_snapshot_options || jsonb_build_array(jsonb_build_object(
          'id', v_option.id,
          'name', v_option.public_name,
          'priceDelta', round(v_option.price_delta, 2)
        ));
      end loop;

      v_snapshot_group := jsonb_build_object(
        'id', v_group.id,
        'name', v_group.public_name,
        'selectionType', v_group.selection_type,
        'options', v_snapshot_options
      );
      v_snapshot_groups := v_snapshot_groups || jsonb_build_array(v_snapshot_group);
    end loop;

    for v_group_row in
      select g.id, g.required, g.min_select, g.max_select
      from public.ecommerce_published_option_groups g
      where g.published_product_id = v_product.id
        and g.portal_id = v_portal.id
        and g.license_id = v_portal.license_id
        and g.deleted_at is null
    loop
      if v_group_row.id <> all(v_selected_group_ids)
         and (v_group_row.required is true or v_group_row.min_select > 0) then
        return private.ecommerce_public_error('ECOMMERCE_OPTION_GROUP_REQUIRED');
      end if;
    end loop;

    if v_product.has_option_groups is not true
       and jsonb_array_length(v_selections) > 0 then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    v_final_unit_price := round(v_base_unit_price + v_options_adjustment, 2);
    if v_final_unit_price < 0 then
      return private.ecommerce_public_error('ECOMMERCE_CONFIGURATION_INVALID');
    end if;

    v_product_demand := coalesce(
      (v_product_demands ->> v_product.id::text)::numeric,
      0
    ) + v_quantity;
    v_product_demands := jsonb_set(
      v_product_demands,
      array[v_product.id::text],
      to_jsonb(v_product_demand),
      true
    );

    if v_variant_id is not null then
      v_variant_demand := coalesce(
        (v_variant_demands ->> v_variant_id::text)::numeric,
        0
      ) + v_quantity;
      v_variant_demands := jsonb_set(
        v_variant_demands,
        array[v_variant_id::text],
        to_jsonb(v_variant_demand),
        true
      );

      if v_variant.stock_mode = 'status'
         and v_variant.stock_snapshot is not null
         and v_variant.stock_snapshot <= 0 then
        return private.ecommerce_public_error('ECOMMERCE_VARIANT_UNAVAILABLE');
      end if;

      if v_variant.stock_mode = 'exact' then
        if v_variant.stock_snapshot is null then
          return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
        end if;
        if v_variant_demand > floor(v_variant.stock_snapshot) then
          return private.ecommerce_public_error('ECOMMERCE_INSUFFICIENT_STOCK');
        end if;
      end if;
    elsif v_product.availability_source <> 'not_tracked' then
      if v_product.stock_mode = 'status'
         and v_product.stock_snapshot is not null
         and v_product.stock_snapshot <= 0 then
        return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
      end if;

      if v_product.stock_mode in ('exact', 'reserve_on_confirm') then
        if v_product.stock_snapshot is null then
          return private.ecommerce_public_error('ECOMMERCE_PRODUCT_UNAVAILABLE');
        end if;
        if v_product_demand > floor(v_product.stock_snapshot) then
          return private.ecommerce_public_error('ECOMMERCE_INSUFFICIENT_STOCK');
        end if;
      end if;
    end if;

    v_snapshot_variant := null;
    if v_variant_id is not null then
      v_snapshot_variant := jsonb_build_object(
        'id', v_variant.id,
        'name', coalesce(nullif(btrim(v_variant.public_name), ''), (
          select string_agg(e.value, ' / ' order by e.key)
          from jsonb_each_text(v_variant.option_values) e
        )),
        'optionValues', v_variant.option_values,
        'priceMode', v_variant.price_mode,
        'priceValue', round(v_variant.price_value, 2)
      );
    end if;

    v_snapshot := jsonb_build_object(
      'version', 1,
      'configurationVersion', v_product.configuration_version,
      'configurationType', v_product.configuration_type,
      'variant', v_snapshot_variant,
      'groups', v_snapshot_groups,
      'pricing', jsonb_build_object(
        'baseUnitPrice', round(v_product.price, 2),
        'variantAdjustment', v_variant_adjustment,
        'optionsAdjustment', v_options_adjustment,
        'finalUnitPrice', v_final_unit_price
      )
    );

    v_line_total := round(v_final_unit_price * v_quantity, 2);
    v_subtotal := round(v_subtotal + v_line_total, 2);

    v_validated_item := jsonb_build_object(
      'productId', v_product.id,
      'name', v_product.public_name,
      'quantity', v_quantity,
      'unitPrice', v_final_unit_price,
      'lineTotal', v_line_total,
      'configurationSnapshot', v_snapshot
    );
    v_public_items := v_public_items || jsonb_build_array(v_validated_item);
  end loop;

  if v_subtotal < v_portal.min_order_total then
    return private.ecommerce_public_error('ECOMMERCE_MIN_ORDER_NOT_REACHED');
  end if;

  select p.*
  into v_portal
  from public.ecommerce_portals p
  where p.id = v_portal.id
  for update;

  v_availability := private.ecommerce_evaluate_portal_availability(
    v_portal,
    clock_timestamp()
  );
  if v_availability ->> 'code' = 'ORDERING_DISABLED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  elsif v_availability ->> 'code' = 'ORDERS_PAUSED' then
    return private.ecommerce_public_error('ECOMMERCE_ORDERS_PAUSED');
  elsif v_availability ->> 'code' = 'OUTSIDE_BUSINESS_HOURS' then
    return private.ecommerce_public_error('ECOMMERCE_STORE_CLOSED');
  elsif v_availability ->> 'code' = 'SCHEDULE_NOT_CONFIGURED' then
    return private.ecommerce_public_error('ECOMMERCE_SCHEDULE_NOT_CONFIGURED');
  elsif coalesce((v_availability ->> 'acceptingOrders')::boolean, false) is not true then
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
      jsonb_build_object('source', 'public_store', 'configurationSnapshotVersion', 1)
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
            'url', private.ecommerce_build_whatsapp_url(
              v_existing_order.whatsapp_phone,
              v_existing_order.whatsapp_message
            )
          )
        );
      end if;

      return private.ecommerce_public_error('ECOMMERCE_ORDER_CREATE_FAILED');
  end;

  for v_item in select value from jsonb_array_elements(v_public_items)
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
      (v_item ->> 'productId')::uuid,
      null,
      v_item ->> 'name',
      (v_item ->> 'unitPrice')::numeric,
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'lineTotal')::numeric,
      v_item -> 'configurationSnapshot',
      jsonb_build_object('configurationSnapshotVersion', 1)
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
      'total', v_order.total,
      'configured', exists (
        select 1
        from jsonb_array_elements(v_public_items) i
        where coalesce(i #>> '{configurationSnapshot,configurationType}', 'simple') <> 'simple'
           or jsonb_array_length(coalesce(i #> '{configurationSnapshot,groups}', '[]'::jsonb)) > 0
      )
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
$function$;

revoke execute on function public.ecommerce_create_order(text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text)
  to anon, authenticated, service_role;

comment on function public.ecommerce_get_product_configuration(text, uuid) is
  'ECOM.PRODUCTS.PUBLIC.1 safe public configuration detail. Exposes no source, license, cost, ingredient or staff identifiers.';
comment on function public.ecommerce_create_order(text, jsonb, jsonb, text) is
  'ECOM.PRODUCTS.PUBLIC.1 authoritative configurable checkout. Idempotent replay precedes mutable validation; no inventory, sale, cash or POS reservation is created.';;
