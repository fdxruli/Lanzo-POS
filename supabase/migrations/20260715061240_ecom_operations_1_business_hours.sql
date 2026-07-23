-- FASE ECOM.OPERATIONS.1
-- Horarios semanales, excepciones, pausa manual y enforcement server-side.
-- Esta migracion es compensatoria: no modifica objetos historicos y parchea la
-- definicion efectiva de ecommerce_create_order para conservar sus hotfixes.

alter table public.ecommerce_portals
  add column business_hours_enabled boolean not null default false,
  add column timezone text not null default 'America/Mexico_City',
  add column orders_paused boolean not null default false,
  add column orders_paused_until timestamptz,
  add column orders_pause_reason text,
  add column orders_pause_updated_at timestamptz;

alter table public.ecommerce_portals
  add constraint ecommerce_portals_timezone_not_blank
    check (length(btrim(timezone)) > 0),
  add constraint ecommerce_portals_pause_reason_length
    check (orders_pause_reason is null or length(orders_pause_reason) <= 300);

create or replace function private.ecommerce_evaluate_portal_availability(
  p_portal public.ecommerce_portals,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_at timestamptz := coalesce(p_at, clock_timestamp());
  v_timezone text := nullif(btrim(p_portal.timezone), '');
  v_timezone_valid boolean := false;
  v_local_now timestamp without time zone;
  v_local_date date;
  v_local_weekday integer;
  v_manually_paused boolean;
  v_schedule_source text := 'disabled';
  v_is_open boolean;
  v_opens time without time zone;
  v_closes time without time zone;
  v_open_at timestamptz;
  v_close_at timestamptz;
  v_within boolean := true;
  v_accepting boolean := false;
  v_code text := 'OPEN';
  v_next_open timestamptz;
  v_next_close timestamptz;
  v_next_change timestamptz;
  v_candidate_date date;
  v_day_open boolean;
  v_day_opens time without time zone;
  v_day_closes time without time zone;
  v_candidate_open timestamptz;
  v_offset integer;
begin
  select exists(
    select 1
    from pg_catalog.pg_timezone_names t
    where t.name = v_timezone
  ) into v_timezone_valid;

  if not v_timezone_valid then
    v_timezone := 'America/Mexico_City';
  end if;

  v_local_now := v_at at time zone v_timezone;
  v_local_date := v_local_now::date;
  v_local_weekday := extract(dow from v_local_now)::integer;
  v_manually_paused := p_portal.orders_paused is true
    and (p_portal.orders_paused_until is null or p_portal.orders_paused_until > v_at);

  if p_portal.business_hours_enabled is true then
    v_schedule_source := 'missing';
    select e.is_open, e.opens_at, e.closes_at
    into v_is_open, v_opens, v_closes
    from public.ecommerce_portal_hour_exceptions e
    where e.portal_id = p_portal.id
      and e.exception_date = v_local_date
    limit 1;

    if found then
      v_schedule_source := 'exception';
    else
      select h.is_open, h.opens_at, h.closes_at
      into v_is_open, v_opens, v_closes
      from public.ecommerce_portal_hours h
      where h.portal_id = p_portal.id
        and h.weekday = v_local_weekday
      limit 1;
      if found then v_schedule_source := 'weekly'; end if;
    end if;

    if v_schedule_source = 'missing'
       or (v_is_open is true and (v_opens is null or v_closes is null or v_opens >= v_closes))
       or not v_timezone_valid then
      v_within := false;
    elsif v_is_open is not true then
      v_within := false;
    else
      v_open_at := (v_local_date + v_opens) at time zone v_timezone;
      v_close_at := (v_local_date + v_closes) at time zone v_timezone;
      v_within := v_at >= v_open_at and v_at < v_close_at;
      if v_within then v_next_close := v_close_at; end if;
    end if;

    for v_offset in 0..14 loop
      v_candidate_date := v_local_date + v_offset;
      v_day_open := null;
      v_day_opens := null;
      v_day_closes := null;

      select e.is_open, e.opens_at, e.closes_at
      into v_day_open, v_day_opens, v_day_closes
      from public.ecommerce_portal_hour_exceptions e
      where e.portal_id = p_portal.id
        and e.exception_date = v_candidate_date
      limit 1;

      if not found then
        select h.is_open, h.opens_at, h.closes_at
        into v_day_open, v_day_opens, v_day_closes
        from public.ecommerce_portal_hours h
        where h.portal_id = p_portal.id
          and h.weekday = extract(dow from v_candidate_date)::integer
        limit 1;
      end if;

      if coalesce(v_day_open, false)
         and v_day_opens is not null
         and v_day_closes is not null
         and v_day_opens < v_day_closes then
        v_candidate_open := (v_candidate_date + v_day_opens) at time zone v_timezone;
        if v_candidate_open > v_at then
          v_next_open := v_candidate_open;
          exit;
        end if;
      end if;
    end loop;
  end if;

  if p_portal.id is null or p_portal.status <> 'published' or p_portal.deleted_at is not null then
    v_code := 'PORTAL_NOT_PUBLISHED';
  elsif p_portal.ordering_enabled is not true then
    v_code := 'ORDERING_DISABLED';
  elsif v_manually_paused then
    v_code := 'ORDERS_PAUSED';
  elsif p_portal.business_hours_enabled is not true then
    v_code := 'OPEN';
    v_accepting := true;
  elsif not v_timezone_valid
     or v_schedule_source = 'missing'
     or (v_is_open is true and (v_opens is null or v_closes is null or v_opens >= v_closes)) then
    v_code := 'SCHEDULE_NOT_CONFIGURED';
  elsif not v_within then
    v_code := 'OUTSIDE_BUSINESS_HOURS';
  else
    v_code := 'OPEN';
    v_accepting := true;
  end if;

  if v_code = 'ORDERS_PAUSED' then
    v_next_change := p_portal.orders_paused_until;
  elsif v_code = 'OPEN' then
    v_next_change := v_next_close;
  elsif v_code in ('OUTSIDE_BUSINESS_HOURS', 'SCHEDULE_NOT_CONFIGURED') then
    v_next_change := v_next_open;
  end if;

  return jsonb_build_object(
    'timezone', v_timezone,
    'serverNow', v_at,
    'localNow', to_char(v_local_now, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'localDate', v_local_date,
    'localWeekday', v_local_weekday,
    'businessHoursEnabled', p_portal.business_hours_enabled,
    'orderingEnabled', p_portal.ordering_enabled,
    'manuallyPaused', v_manually_paused,
    'pauseReason', case when v_manually_paused then p_portal.orders_pause_reason else null end,
    'pauseUntil', case when v_manually_paused then p_portal.orders_paused_until else null end,
    'scheduleSource', v_schedule_source,
    'opensAt', case when v_opens is null then null else to_char(v_opens, 'HH24:MI') end,
    'closesAt', case when v_closes is null then null else to_char(v_closes, 'HH24:MI') end,
    'isWithinBusinessHours', v_within,
    'acceptingOrders', v_accepting,
    'code', v_code,
    'nextOpenAt', v_next_open,
    'nextCloseAt', v_next_close,
    'nextChangeAt', v_next_change
  );
end;
$function$;

create or replace function private.ecommerce_public_availability_jsonb(
  p_portal public.ecommerce_portals,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'acceptingOrders', a.value->'acceptingOrders',
    'code', a.value->'code',
    'timezone', a.value->'timezone',
    'evaluatedAt', a.value->'serverNow',
    'localDate', a.value->'localDate',
    'opensAt', a.value->'opensAt',
    'closesAt', a.value->'closesAt',
    'nextOpenAt', a.value->'nextOpenAt',
    'nextCloseAt', a.value->'nextCloseAt',
    'nextChangeAt', a.value->'nextChangeAt',
    'pauseReason', a.value->'pauseReason',
    'pauseUntil', a.value->'pauseUntil',
    'scheduleSource', a.value->'scheduleSource'
  )
  from (select private.ecommerce_evaluate_portal_availability(p_portal, p_at) as value) a;
$function$;

create or replace function private.ecommerce_admin_portal_jsonb(
  p_portal public.ecommerce_portals
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_portal.id,
    'slug', p_portal.slug,
    'slugSource', p_portal.slug_source,
    'status', p_portal.status,
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
    'orderingEnabled', p_portal.ordering_enabled,
    'pickupEnabled', p_portal.pickup_enabled,
    'deliveryEnabled', p_portal.delivery_enabled,
    'minOrderTotal', p_portal.min_order_total,
    'stockMode', p_portal.stock_mode,
    'settings', p_portal.settings,
    'catalogRevision', p_portal.catalog_revision,
    'timezone', p_portal.timezone,
    'businessHoursEnabled', p_portal.business_hours_enabled,
    'ordersPaused', p_portal.orders_paused,
    'ordersPausedUntil', p_portal.orders_paused_until,
    'ordersPauseReason', p_portal.orders_pause_reason,
    'ordersPauseUpdatedAt', p_portal.orders_pause_updated_at,
    'createdAt', p_portal.created_at,
    'updatedAt', p_portal.updated_at
  );
$function$;

create or replace function private.ecommerce_portal_hours_jsonb(p_portal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday,
        'isOpen', h.is_open,
        'opensAt', case when h.opens_at is null then null else to_char(h.opens_at, 'HH24:MI') end,
        'closesAt', case when h.closes_at is null then null else to_char(h.closes_at, 'HH24:MI') end
      ) order by h.weekday, h.sort_order)
      from public.ecommerce_portal_hours h
      where h.portal_id = p_portal_id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.exception_date,
        'isOpen', e.is_open,
        'opensAt', case when e.opens_at is null then null else to_char(e.opens_at, 'HH24:MI') end,
        'closesAt', case when e.closes_at is null then null else to_char(e.closes_at, 'HH24:MI') end,
        'reason', e.reason
      ) order by e.exception_date)
      from public.ecommerce_portal_hour_exceptions e
      where e.portal_id = p_portal_id
        and e.exception_date >= coalesce((
          select (clock_timestamp() at time zone p.timezone)::date
          from public.ecommerce_portals p
          where p.id = p_portal_id
        ), current_date)
    ), '[]'::jsonb)
  );
$function$;

create or replace function private.ecommerce_public_error(p_code text)
returns jsonb
language sql
stable
security definer
set search_path to ''
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
$function$;

create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
    'availability', private.ecommerce_public_availability_jsonb(v_portal, clock_timestamp()),
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
    ),
    'catalogRevision', v_portal.catalog_revision,
    'cachePolicy', jsonb_build_object('schemaVersion', 1, 'freshSeconds', 300, 'maxStaleSeconds', 86400)
  );
exception when others then
  return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$function$;

create or replace function public.ecommerce_admin_get_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_count integer := 0;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_get_portal'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);

  select p.* into v_portal
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1;

  if v_portal.id is not null then
    select count(*) into v_count
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal.id and pp.deleted_at is null and pp.is_published is true;
  end if;

  return jsonb_build_object(
    'success', true,
    'plan', jsonb_build_object('code', v_auth->>'plan_code', 'name', v_auth->>'plan_name', 'isPro', (v_auth->>'plan_code') = 'pro_monthly'),
    'features', jsonb_build_object(
      'portalEnabled', coalesce((v_features->>'ecommerce_portal_enabled')::boolean, false),
      'maxPublishedProducts', coalesce((v_features->>'ecommerce_max_published_products')::integer, 0),
      'customSlug', coalesce((v_features->>'ecommerce_custom_slug')::boolean, false),
      'brandingCustomization', coalesce(v_features->>'ecommerce_branding_customization', 'basic'),
      'layoutCustomization', coalesce(v_features->>'ecommerce_layout_customization', 'template_only'),
      'stockVisibility', coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false),
      'realtimeOrders', coalesce((v_features->>'ecommerce_realtime_orders')::boolean, false),
      'cloudCatalogSource', coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false),
      'businessHours', coalesce((v_features->>'ecommerce_business_hours')::boolean, true)
    ),
    'portal', case when v_portal.id is null then null else private.ecommerce_admin_portal_jsonb(v_portal) end,
    'timezone', case when v_portal.id is null then 'America/Mexico_City' else v_portal.timezone end,
    'businessHoursEnabled', coalesce(v_portal.business_hours_enabled, false),
    'ordersPaused', coalesce(v_portal.orders_paused, false),
    'ordersPausedUntil', v_portal.orders_paused_until,
    'ordersPauseReason', v_portal.orders_pause_reason,
    'hours', case when v_portal.id is null then jsonb_build_object('weekly', '[]'::jsonb, 'exceptions', '[]'::jsonb) else private.ecommerce_portal_hours_jsonb(v_portal.id) end,
    'availability', case when v_portal.id is null then null else private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp()) end,
    'publishedProductCount', v_count
  );
end;
$function$;

create or replace function public.ecommerce_admin_get_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return public.ecommerce_admin_get_portal(
    p_license_key, p_device_fingerprint, p_security_token, null::text
  );
end;
$function$;

create or replace function public.ecommerce_admin_save_operating_schedule(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_timezone text,
  p_business_hours_enabled boolean,
  p_weekly jsonb,
  p_exceptions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_item jsonb;
  v_weekday integer;
  v_is_open boolean;
  v_opens time without time zone;
  v_closes time without time zone;
  v_date date;
  v_reason text;
  v_seen_days integer[] := array[]::integer[];
  v_seen_dates date[] := array[]::date[];
  v_open_days integer := 0;
  v_weekly jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_save_operating_schedule'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  if nullif(btrim(coalesce(p_timezone, '')), '') is null
     or not exists(select 1 from pg_catalog.pg_timezone_names t where t.name = btrim(p_timezone)) then
    return private.ecommerce_admin_error('ECOMMERCE_TIMEZONE_INVALID', 'Selecciona una zona horaria valida.');
  end if;
  if jsonb_typeof(p_weekly) <> 'array' or jsonb_array_length(p_weekly) > 7 then
    return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_INVALID', 'Revisa el horario semanal.');
  end if;
  if jsonb_typeof(p_exceptions) <> 'array' or jsonb_array_length(p_exceptions) > 60 then
    return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'Revisa las excepciones del horario.');
  end if;

  for v_item in select value from jsonb_array_elements(p_weekly) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'weekday', '') !~ '^[0-6]$'
       or jsonb_typeof(v_item->'isOpen') <> 'boolean' then
      return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_INVALID', 'Revisa el horario semanal.');
    end if;
    v_weekday := (v_item->>'weekday')::integer;
    if v_weekday = any(v_seen_days) then
      return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_DUPLICATE_DAY', 'Cada dia debe aparecer una sola vez.');
    end if;
    v_seen_days := array_append(v_seen_days, v_weekday);
    v_is_open := (v_item->>'isOpen')::boolean;
    v_opens := null;
    v_closes := null;
    if v_is_open then
      if coalesce(v_item->>'opensAt', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_item->>'closesAt', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_INVALID', 'Usa horas validas en formato HH:MM.');
      end if;
      v_opens := (v_item->>'opensAt')::time;
      v_closes := (v_item->>'closesAt')::time;
      if v_opens >= v_closes then
        return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_INVALID', 'La apertura debe ser anterior al cierre.');
      end if;
      v_open_days := v_open_days + 1;
    end if;
    v_weekly := v_weekly || jsonb_build_array(jsonb_build_object(
      'weekday', v_weekday, 'isOpen', v_is_open,
      'opensAt', case when v_opens is null then null else to_char(v_opens, 'HH24:MI') end,
      'closesAt', case when v_closes is null then null else to_char(v_closes, 'HH24:MI') end
    ));
  end loop;

  if coalesce(p_business_hours_enabled, false) and v_open_days = 0 then
    return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_REQUIRED', 'Configura al menos un dia abierto antes de aplicar el horario.');
  end if;

  for v_item in select value from jsonb_array_elements(p_exceptions) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_item->'isOpen') <> 'boolean' then
      return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'Revisa las excepciones del horario.');
    end if;
    begin
      v_date := (v_item->>'date')::date;
    exception when others then
      return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'Revisa la fecha de la excepcion.');
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> v_item->>'date'
       or v_date < current_date - 366 then
      return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'La fecha de la excepcion no es valida.');
    end if;
    if v_date = any(v_seen_dates) then
      return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'Cada fecha de excepcion debe aparecer una sola vez.');
    end if;
    v_seen_dates := array_append(v_seen_dates, v_date);
    v_is_open := (v_item->>'isOpen')::boolean;
    v_reason := nullif(left(btrim(coalesce(v_item->>'reason', '')), 301), '');
    if length(coalesce(v_reason, '')) > 300 then
      return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'La razon no puede superar 300 caracteres.');
    end if;
    v_opens := null;
    v_closes := null;
    if v_is_open then
      if coalesce(v_item->>'opensAt', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_item->>'closesAt', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'Usa horas validas en formato HH:MM.');
      end if;
      v_opens := (v_item->>'opensAt')::time;
      v_closes := (v_item->>'closesAt')::time;
      if v_opens >= v_closes then
        return private.ecommerce_admin_error('ECOMMERCE_EXCEPTION_INVALID', 'La apertura debe ser anterior al cierre.');
      end if;
    end if;
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
      'date', v_date, 'isOpen', v_is_open,
      'opensAt', case when v_opens is null then null else to_char(v_opens, 'HH24:MI') end,
      'closesAt', case when v_closes is null then null else to_char(v_closes, 'HH24:MI') end,
      'reason', v_reason
    ));
  end loop;

  update public.ecommerce_portals p
  set timezone = btrim(p_timezone),
      business_hours_enabled = coalesce(p_business_hours_enabled, false),
      updated_at = clock_timestamp()
  where p.license_id = (v_auth->>'license_id')::uuid
    and p.deleted_at is null
  returning p.* into v_portal;
  if v_portal.id is null then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND', 'Primero crea el portal online.');
  end if;

  insert into public.ecommerce_portal_hours(portal_id, weekday, is_open, opens_at, closes_at, sort_order, metadata)
  select v_portal.id, (item->>'weekday')::smallint, (item->>'isOpen')::boolean,
         nullif(item->>'opensAt', '')::time, nullif(item->>'closesAt', '')::time,
         (item->>'weekday')::integer, '{}'::jsonb
  from jsonb_array_elements(v_weekly) as j(item)
  on conflict (portal_id, weekday) do update
  set is_open = excluded.is_open, opens_at = excluded.opens_at, closes_at = excluded.closes_at,
      sort_order = excluded.sort_order, updated_at = clock_timestamp();

  delete from public.ecommerce_portal_hours h
  where h.portal_id = v_portal.id
    and not exists(select 1 from jsonb_array_elements(v_weekly) as j(item) where (item->>'weekday')::integer = h.weekday);

  insert into public.ecommerce_portal_hour_exceptions(portal_id, exception_date, is_open, opens_at, closes_at, reason, metadata)
  select v_portal.id, (item->>'date')::date, (item->>'isOpen')::boolean,
         nullif(item->>'opensAt', '')::time, nullif(item->>'closesAt', '')::time,
         nullif(item->>'reason', ''), '{}'::jsonb
  from jsonb_array_elements(v_exceptions) as j(item)
  on conflict (portal_id, exception_date) do update
  set is_open = excluded.is_open, opens_at = excluded.opens_at, closes_at = excluded.closes_at,
      reason = excluded.reason, updated_at = clock_timestamp();

  delete from public.ecommerce_portal_hour_exceptions e
  where e.portal_id = v_portal.id
    and not exists(select 1 from jsonb_array_elements(v_exceptions) as j(item) where (item->>'date')::date = e.exception_date);

  select p.* into v_portal from public.ecommerce_portals p where p.id = v_portal.id;
  return jsonb_build_object(
    'success', true,
    'timezone', v_portal.timezone,
    'businessHoursEnabled', v_portal.business_hours_enabled,
    'hours', private.ecommerce_portal_hours_jsonb(v_portal.id),
    'availability', private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp())
  );
exception when others then
  return private.ecommerce_admin_error('ECOMMERCE_SCHEDULE_INVALID', 'No se pudo guardar el horario.');
end;
$function$;

create or replace function public.ecommerce_admin_set_order_pause(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_paused boolean,
  p_reason text default null,
  p_resume_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_set_order_pause'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  if length(coalesce(v_reason, '')) > 300 then
    return private.ecommerce_admin_error('ECOMMERCE_PAUSE_REASON_INVALID', 'La razon no puede superar 300 caracteres.');
  end if;
  if coalesce(p_paused, false) and p_resume_at is not null and p_resume_at <= clock_timestamp() then
    return private.ecommerce_admin_error('ECOMMERCE_PAUSE_UNTIL_INVALID', 'La reanudacion debe programarse para una fecha futura.');
  end if;

  update public.ecommerce_portals p
  set orders_paused = coalesce(p_paused, false),
      orders_paused_until = case when coalesce(p_paused, false) then p_resume_at else null end,
      orders_pause_reason = case when coalesce(p_paused, false) then v_reason else null end,
      orders_pause_updated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where p.license_id = (v_auth->>'license_id')::uuid
    and p.deleted_at is null
  returning p.* into v_portal;

  if v_portal.id is null then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND', 'Primero crea el portal online.');
  end if;

  return jsonb_build_object(
    'success', true,
    'portal', private.ecommerce_admin_portal_jsonb(v_portal),
    'availability', private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp()),
    'paused', v_portal.orders_paused and (v_portal.orders_paused_until is null or v_portal.orders_paused_until > clock_timestamp()),
    'pauseUntil', v_portal.orders_paused_until,
    'pauseReason', v_portal.orders_pause_reason
  );
end;
$function$;

-- Parchea la definicion efectiva verificada de ecommerce_create_order.
do $migration$
declare
  v_definition text;
  v_patched text;
  v_early_checks text := $checks$
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

$checks$;
  v_final_checks text := $checks$
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

$checks$;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ecommerce_create_order'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text';

  if v_definition is null then raise exception 'ECOM_OPERATIONS_1_CREATE_ORDER_NOT_FOUND'; end if;
  v_patched := v_definition;
  v_patched := replace(v_patched, '  v_today_count integer;', '  v_today_count integer;' || chr(10) || '  v_availability jsonb;');
  v_patched := replace(v_patched, $remove$
  if v_portal.ordering_enabled is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

  if private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false) is not true then
    return private.ecommerce_public_error('ECOMMERCE_ORDERING_DISABLED');
  end if;

$remove$, '');
  v_patched := replace(v_patched, '  if p_items is null', v_early_checks || '  if p_items is null');
  v_patched := replace(v_patched, $anchor$
  begin
    insert into public.ecommerce_orders (
$anchor$, v_final_checks || $anchor$
  begin
    insert into public.ecommerce_orders (
$anchor$);

  if v_patched = v_definition
     or position('v_availability jsonb' in v_patched) = 0
     or position('for update' in lower(v_patched)) = 0
     or position('ECOMMERCE_ORDERS_PAUSED' in v_patched) = 0 then
    raise exception 'ECOM_OPERATIONS_1_CREATE_ORDER_PATCH_FAILED';
  end if;
  execute v_patched;
end;
$migration$;

revoke all on function private.ecommerce_evaluate_portal_availability(public.ecommerce_portals, timestamptz) from public, anon, authenticated;
revoke all on function private.ecommerce_public_availability_jsonb(public.ecommerce_portals, timestamptz) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_portal_jsonb(public.ecommerce_portals) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_hours_jsonb(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_public_error(text) from public, anon, authenticated;

revoke all on function public.ecommerce_get_portal_by_slug(text) from public, anon, authenticated;
grant execute on function public.ecommerce_get_portal_by_slug(text) to anon, authenticated;

revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_get_portal(text, text, text) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_get_portal(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_portal(text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_admin_get_portal(text, text, text, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_save_operating_schedule(text, text, text, text, text, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_save_operating_schedule(text, text, text, text, text, boolean, jsonb, jsonb) to anon, authenticated;

revoke all on function public.ecommerce_admin_set_order_pause(text, text, text, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_set_order_pause(text, text, text, text, boolean, text, timestamptz) to anon, authenticated;

comment on function private.ecommerce_evaluate_portal_availability(public.ecommerce_portals, timestamptz)
is 'ECOM.OPERATIONS.1 canonical server-side portal availability evaluator.';

;
