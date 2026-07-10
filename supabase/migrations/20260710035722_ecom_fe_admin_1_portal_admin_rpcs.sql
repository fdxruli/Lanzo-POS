-- ECOM.FE.ADMIN.1 - RPCs administrativas seguras para configurar el portal ecommerce desde el POS.
-- No abre tablas al cliente y no toca ventas, caja, inventario ni reportes POS.

create schema if not exists private;

create or replace function private.ecommerce_admin_error(
  p_code text,
  p_message text default null,
  p_details jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'success', false,
    'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ADMIN_ERROR'),
    'message', coalesce(p_message, case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ADMIN_ERROR')
      when 'LICENSE_NOT_ACTIVE' then 'La licencia no esta activa.'
      when 'ADMIN_DEVICE_REQUIRED' then 'Solo el dispositivo administrador puede configurar el portal online.'
      when 'ECOMMERCE_PORTAL_DISABLED' then 'El portal online no esta disponible para esta licencia.'
      when 'ECOMMERCE_PORTAL_NOT_FOUND' then 'Primero crea el portal online.'
      when 'ECOMMERCE_NAME_REQUIRED' then 'El nombre publico del negocio es obligatorio.'
      when 'ECOMMERCE_STATUS_INVALID' then 'El estado del portal no es valido.'
      when 'ECOMMERCE_SLUG_INVALID' then 'El enlace debe tener entre 3 y 64 caracteres y usar solo minusculas, numeros y guiones.'
      when 'ECOMMERCE_SLUG_TAKEN' then 'Ese enlace ya esta reservado. Elige otro.'
      when 'ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO' then 'En Plan Free el enlace se genera automaticamente.'
      when 'ECOMMERCE_WHATSAPP_INVALID' then 'Escribe un WhatsApp valido de al menos 8 digitos.'
      when 'ECOMMERCE_DELIVERY_METHOD_REQUIRED' then 'Activa al menos un metodo de entrega.'
      when 'ECOMMERCE_MIN_ORDER_INVALID' then 'El pedido minimo no puede ser negativo.'
      when 'ECOMMERCE_PRODUCT_NOT_FOUND' then 'El producto publicado no existe.'
      when 'ECOMMERCE_PRODUCT_NAME_REQUIRED' then 'El nombre publico del producto es obligatorio.'
      when 'ECOMMERCE_PRODUCT_PRICE_INVALID' then 'El precio publico debe ser igual o mayor que cero.'
      when 'ECOMMERCE_LOCAL_PRODUCT_REF_REQUIRED' then 'Selecciona un producto del catalogo local.'
      when 'ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO' then 'El catalogo cloud requiere Lanzo Nube.'
      when 'ECOMMERCE_PRODUCT_LIMIT_REACHED' then 'Plan Free permite publicar hasta 10 productos. Actualiza a Lanzo Nube para productos ilimitados.'
      when 'ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO' then 'La visibilidad de stock requiere Lanzo Nube.'
      when 'ECOMMERCE_RATE_LIMITED' then 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.'
      else 'No se pudo completar la configuracion del portal.'
    end),
    'details', p_details
  ));
$$;

create or replace function private.ecommerce_admin_authorize(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rate_limit jsonb;
  v_license record;
  v_device_id uuid;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return private.ecommerce_admin_error('ADMIN_DEVICE_REQUIRED');
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_admin'),
    p_scope := 'ECOM_ADMIN',
    p_max_attempts := 180,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_RATE_LIMITED',
    p_metadata := jsonb_build_object('phase', 'ECOM.FE.ADMIN.1')
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_admin_error(
      'ECOMMERCE_RATE_LIMITED',
      null,
      jsonb_build_object('retryAfterSeconds', nullif(v_rate_limit->>'retry_after_seconds', '')::integer)
    );
  end if;

  select
    l.id as license_id,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at >= now())
  limit 1;

  if v_license.license_id is null then
    return private.ecommerce_admin_error('LICENSE_NOT_ACTIVE');
  end if;

  select d.id
  into v_device_id
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_role = 'admin'
    and (d.security_token = p_security_token or d.previous_security_token = p_security_token)
  limit 1;

  if v_device_id is null then
    return private.ecommerce_admin_error('ADMIN_DEVICE_REQUIRED');
  end if;

  if private.ecommerce_license_feature_bool(v_license.license_id, 'ecommerce_portal_enabled', false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_DISABLED');
  end if;

  return jsonb_build_object(
    'success', true,
    'license_id', v_license.license_id,
    'device_id', v_device_id,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_license.effective_features
  );
exception
  when others then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_AUTH_FAILED');
end;
$$;

create or replace function private.ecommerce_admin_generate_slug(
  p_license_id uuid,
  p_name text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_base text;
  v_suffix text;
  v_candidate text;
  v_attempt integer := 0;
begin
  v_base := private.ecommerce_normalize_slug(p_name);
  if v_base is null or length(v_base) < 3 then v_base := 'tienda'; end if;
  v_base := btrim(left(v_base, 54), '-');
  v_suffix := left(replace(p_license_id::text, '-', ''), 8);
  v_candidate := v_base || '-' || v_suffix;

  while exists (
    select 1
    from public.ecommerce_portals p
    where p.slug = v_candidate
      and p.deleted_at is null
      and p.license_id <> p_license_id
  ) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 99 then raise exception 'ECOMMERCE_SLUG_GENERATION_FAILED'; end if;
    v_candidate := left(v_base, 50) || '-' || v_suffix || '-' || v_attempt::text;
  end loop;

  return v_candidate;
end;
$$;

create or replace function private.ecommerce_admin_portal_jsonb(p_portal public.ecommerce_portals)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
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
    'createdAt', p_portal.created_at,
    'updatedAt', p_portal.updated_at
  );
$$;

create or replace function private.ecommerce_admin_product_jsonb(p_product public.ecommerce_published_products)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_product.id,
    'sourceType', p_product.source_type,
    'productId', p_product.product_id,
    'localProductRef', p_product.local_product_ref,
    'publicName', p_product.public_name,
    'publicDescription', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isPublished', p_product.is_published,
    'isAvailable', p_product.is_available,
    'displayOrder', p_product.display_order,
    'stockMode', p_product.stock_mode,
    'metadata', p_product.metadata,
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$$;

create or replace function public.ecommerce_admin_get_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_count integer := 0;
begin
  v_auth := private.ecommerce_admin_authorize(p_license_key, p_device_fingerprint, p_security_token, 'ecommerce_admin_get_portal');
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
      'cloudCatalogSource', coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false)
    ),
    'portal', case when v_portal.id is null then null else private.ecommerce_admin_portal_jsonb(v_portal) end,
    'publishedProductCount', v_count
  );
end;
$$;

create or replace function public.ecommerce_admin_upsert_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_existing public.ecommerce_portals%rowtype;
  v_saved public.ecommerce_portals%rowtype;
  v_name text;
  v_requested_slug text;
  v_slug text;
  v_status text;
  v_whatsapp text;
  v_pickup boolean;
  v_delivery boolean;
  v_min_order numeric(12,2);
  v_custom_slug_allowed boolean;
  v_advanced_branding boolean;
begin
  v_auth := private.ecommerce_admin_authorize(p_license_key, p_device_fingerprint, p_security_token, 'ecommerce_admin_upsert_portal');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);
  v_custom_slug_allowed := coalesce((v_features->>'ecommerce_custom_slug')::boolean, false);
  v_advanced_branding := coalesce(v_features->>'ecommerce_branding_customization', 'basic') = 'advanced';

  select p.* into v_existing
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1 for update;

  v_name := btrim(coalesce(p_payload->>'name', ''));
  if v_name = '' then return private.ecommerce_admin_error('ECOMMERCE_NAME_REQUIRED'); end if;

  v_status := lower(btrim(coalesce(p_payload->>'status', coalesce(v_existing.status, 'draft'))));
  if v_status not in ('draft', 'published', 'paused') then return private.ecommerce_admin_error('ECOMMERCE_STATUS_INVALID'); end if;

  v_whatsapp := regexp_replace(coalesce(p_payload->>'whatsappPhone', ''), '[^0-9]', '', 'g');
  if v_whatsapp <> '' and length(v_whatsapp) < 8 then return private.ecommerce_admin_error('ECOMMERCE_WHATSAPP_INVALID'); end if;

  v_pickup := coalesce((p_payload->>'pickupEnabled')::boolean, true);
  v_delivery := coalesce((p_payload->>'deliveryEnabled')::boolean, false);
  if v_pickup is false and v_delivery is false then return private.ecommerce_admin_error('ECOMMERCE_DELIVERY_METHOD_REQUIRED'); end if;

  v_min_order := coalesce(nullif(p_payload->>'minOrderTotal', '')::numeric, 0);
  if v_min_order < 0 then return private.ecommerce_admin_error('ECOMMERCE_MIN_ORDER_INVALID'); end if;

  v_requested_slug := btrim(coalesce(p_payload->>'slug', ''));
  if v_custom_slug_allowed then
    if v_requested_slug = '' then
      v_slug := coalesce(v_existing.slug, private.ecommerce_admin_generate_slug(v_license_id, v_name));
    elsif length(v_requested_slug) between 3 and 64 and v_requested_slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' then
      v_slug := v_requested_slug;
    else
      return private.ecommerce_admin_error('ECOMMERCE_SLUG_INVALID');
    end if;
  else
    if v_existing.id is not null and v_requested_slug <> '' and v_requested_slug <> v_existing.slug then
      return private.ecommerce_admin_error('ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO');
    end if;
    v_slug := coalesce(v_existing.slug, private.ecommerce_admin_generate_slug(v_license_id, v_name));
  end if;

  if exists (
    select 1 from public.ecommerce_portals p
    where p.slug = v_slug and p.deleted_at is null and (v_existing.id is null or p.id <> v_existing.id)
  ) then return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN'); end if;

  if v_existing.id is null then
    insert into public.ecommerce_portals (
      license_id, slug, slug_source, status, name, headline, description,
      template_code, customization_level, theme, logo_url, cover_image_url,
      whatsapp_phone, address, pickup_enabled, delivery_enabled,
      min_order_total, stock_mode, settings, metadata
    ) values (
      v_license_id,
      v_slug,
      case when v_custom_slug_allowed and v_requested_slug <> '' then 'custom' else 'system' end,
      v_status,
      v_name,
      nullif(btrim(p_payload->>'headline'), ''),
      nullif(btrim(p_payload->>'description'), ''),
      case when v_advanced_branding then coalesce(nullif(btrim(p_payload->>'templateCode'), ''), 'classic') else 'classic' end,
      case when v_advanced_branding then 'advanced' else 'basic' end,
      case when v_advanced_branding then coalesce(p_payload->'theme', '{}'::jsonb) else '{}'::jsonb end,
      nullif(btrim(p_payload->>'logoUrl'), ''),
      case when v_advanced_branding then nullif(btrim(p_payload->>'coverImageUrl'), '') else null end,
      nullif(v_whatsapp, ''),
      nullif(btrim(p_payload->>'address'), ''),
      v_pickup,
      v_delivery,
      v_min_order,
      'hidden',
      coalesce(p_payload->'settings', '{}'::jsonb),
      jsonb_build_object('source', 'admin_ui', 'phase', 'ECOM.FE.ADMIN.1')
    ) returning * into v_saved;
  else
    update public.ecommerce_portals p
    set slug = v_slug,
        slug_source = case when v_custom_slug_allowed and v_requested_slug <> '' then 'custom' else p.slug_source end,
        status = v_status,
        name = v_name,
        headline = nullif(btrim(p_payload->>'headline'), ''),
        description = nullif(btrim(p_payload->>'description'), ''),
        template_code = case when v_advanced_branding then coalesce(nullif(btrim(p_payload->>'templateCode'), ''), p.template_code) else 'classic' end,
        customization_level = case when v_advanced_branding then 'advanced' else 'basic' end,
        theme = case when v_advanced_branding then coalesce(p_payload->'theme', p.theme) else '{}'::jsonb end,
        logo_url = coalesce(nullif(btrim(p_payload->>'logoUrl'), ''), p.logo_url),
        cover_image_url = case when v_advanced_branding then coalesce(nullif(btrim(p_payload->>'coverImageUrl'), ''), p.cover_image_url) else null end,
        whatsapp_phone = nullif(v_whatsapp, ''),
        address = nullif(btrim(p_payload->>'address'), ''),
        pickup_enabled = v_pickup,
        delivery_enabled = v_delivery,
        min_order_total = v_min_order,
        stock_mode = case when coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false) then p.stock_mode else 'hidden' end,
        settings = coalesce(p_payload->'settings', p.settings),
        metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('last_admin_source', 'admin_ui', 'phase', 'ECOM.FE.ADMIN.1')
    where p.id = v_existing.id
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', case when v_existing.id is null then 'Portal online creado correctamente.' else 'Portal online actualizado correctamente.' end,
    'portal', private.ecommerce_admin_portal_jsonb(v_saved),
    'plan', jsonb_build_object('code', v_auth->>'plan_code', 'name', v_auth->>'plan_name', 'isPro', (v_auth->>'plan_code') = 'pro_monthly'),
    'features', jsonb_build_object(
      'maxPublishedProducts', coalesce((v_features->>'ecommerce_max_published_products')::integer, 0),
      'customSlug', v_custom_slug_allowed,
      'stockVisibility', coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false),
      'cloudCatalogSource', coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false)
    )
  );
exception
  when unique_violation then return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN');
  when others then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
end;
$$;

create or replace function public.ecommerce_admin_list_published_products(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal_id uuid;
  v_products jsonb;
  v_count integer;
begin
  v_auth := private.ecommerce_admin_authorize(p_license_key, p_device_fingerprint, p_security_token, 'ecommerce_admin_list_published_products');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);

  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1;

  if v_portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;

  select
    coalesce(jsonb_agg(private.ecommerce_admin_product_jsonb(pp) order by pp.display_order, pp.public_name), '[]'::jsonb),
    count(*) filter (where pp.is_published is true)
  into v_products, v_count
  from public.ecommerce_published_products pp
  where pp.portal_id = v_portal_id and pp.deleted_at is null;

  return jsonb_build_object(
    'success', true,
    'products', v_products,
    'publishedCount', coalesce(v_count, 0),
    'maxPublishedProducts', coalesce((v_features->>'ecommerce_max_published_products')::integer, 0)
  );
end;
$$;

create or replace function public.ecommerce_admin_upsert_published_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal_id uuid;
  v_existing public.ecommerce_published_products%rowtype;
  v_saved public.ecommerce_published_products%rowtype;
  v_id uuid;
  v_source_type text;
  v_local_ref text;
  v_cloud_ref text;
  v_name text;
  v_price numeric(12,2);
  v_is_published boolean;
  v_stock_mode text;
begin
  v_auth := private.ecommerce_admin_authorize(p_license_key, p_device_fingerprint, p_security_token, 'ecommerce_admin_upsert_published_product');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);

  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1;
  if v_portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;

  if nullif(btrim(coalesce(p_payload->>'id', '')), '') is not null then
    v_id := (p_payload->>'id')::uuid;
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.id = v_id and pp.portal_id = v_portal_id and pp.deleted_at is null
    limit 1 for update;
    if v_existing.id is null then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND'); end if;
  end if;

  v_source_type := lower(btrim(coalesce(p_payload->>'sourceType', coalesce(v_existing.source_type, 'local_snapshot'))));
  if v_source_type not in ('local_snapshot', 'cloud_product') then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SOURCE_INVALID', 'La fuente del producto no es valida.');
  end if;
  if v_source_type = 'cloud_product' and coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO');
  end if;

  v_local_ref := nullif(btrim(coalesce(p_payload->>'localProductRef', coalesce(v_existing.local_product_ref, ''))), '');
  v_cloud_ref := nullif(btrim(coalesce(p_payload->>'productId', coalesce(v_existing.product_id, ''))), '');
  if v_source_type = 'local_snapshot' and v_local_ref is null then return private.ecommerce_admin_error('ECOMMERCE_LOCAL_PRODUCT_REF_REQUIRED'); end if;
  if v_source_type = 'cloud_product' and v_cloud_ref is null then
    return private.ecommerce_admin_error('ECOMMERCE_CLOUD_PRODUCT_REF_REQUIRED', 'Selecciona un producto del catalogo cloud.');
  end if;

  if v_existing.id is null then
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal_id
      and pp.deleted_at is null
      and ((v_source_type = 'local_snapshot' and pp.source_type = 'local_snapshot' and pp.local_product_ref = v_local_ref)
        or (v_source_type = 'cloud_product' and pp.source_type = 'cloud_product' and pp.product_id = v_cloud_ref))
    limit 1 for update;
  end if;

  v_name := btrim(coalesce(p_payload->>'publicName', coalesce(v_existing.public_name, '')));
  if v_name = '' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NAME_REQUIRED'); end if;

  v_price := coalesce(nullif(p_payload->>'price', '')::numeric, v_existing.price, 0);
  if v_price < 0 then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PRICE_INVALID'); end if;

  v_is_published := coalesce((p_payload->>'isPublished')::boolean, coalesce(v_existing.is_published, true));
  v_stock_mode := lower(btrim(coalesce(p_payload->>'stockMode', coalesce(v_existing.stock_mode, 'hidden'))));
  if coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false) is false then
    v_stock_mode := 'hidden';
  elsif v_stock_mode not in ('hidden', 'status', 'exact') then
    v_stock_mode := 'hidden';
  end if;

  if v_existing.id is null then
    insert into public.ecommerce_published_products (
      portal_id, license_id, source_type, product_id, local_product_ref,
      public_name, public_description, category_name, price, currency,
      image_url, is_published, is_available, display_order,
      track_stock, stock_mode, metadata
    ) values (
      v_portal_id, v_license_id, v_source_type, v_cloud_ref, v_local_ref,
      v_name, nullif(btrim(p_payload->>'publicDescription'), ''),
      nullif(btrim(p_payload->>'categoryName'), ''), v_price, 'MXN',
      nullif(btrim(p_payload->>'imageUrl'), ''), v_is_published,
      coalesce((p_payload->>'isAvailable')::boolean, true),
      greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, 0), 0),
      v_stock_mode <> 'hidden', v_stock_mode,
      coalesce(p_payload->'metadata', '{}'::jsonb) || jsonb_build_object('source', 'admin_ui', 'phase', 'ECOM.FE.ADMIN.1')
    ) returning * into v_saved;
  else
    update public.ecommerce_published_products pp
    set source_type = v_source_type,
        product_id = v_cloud_ref,
        local_product_ref = v_local_ref,
        public_name = v_name,
        public_description = nullif(btrim(p_payload->>'publicDescription'), ''),
        category_name = nullif(btrim(p_payload->>'categoryName'), ''),
        price = v_price,
        image_url = coalesce(nullif(btrim(p_payload->>'imageUrl'), ''), pp.image_url),
        is_published = v_is_published,
        is_available = coalesce((p_payload->>'isAvailable')::boolean, pp.is_available),
        display_order = greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, pp.display_order), 0),
        track_stock = v_stock_mode <> 'hidden',
        stock_mode = v_stock_mode,
        metadata = coalesce(pp.metadata, '{}'::jsonb) || coalesce(p_payload->'metadata', '{}'::jsonb) || jsonb_build_object('last_admin_source', 'admin_ui')
    where pp.id = v_existing.id
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', case when v_existing.id is null then 'Producto publicado correctamente.' else 'Producto actualizado correctamente.' end,
    'product', private.ecommerce_admin_product_jsonb(v_saved)
  );
exception
  when others then
    if sqlerrm like '%ECOMMERCE_PRODUCT_LIMIT_REACHED%' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_LIMIT_REACHED'); end if;
    if sqlerrm like '%ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO%' then return private.ecommerce_admin_error('ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO'); end if;
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SAVE_FAILED');
end;
$$;

create or replace function public.ecommerce_admin_set_product_published(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_product_id uuid,
  p_is_published boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_saved public.ecommerce_published_products%rowtype;
begin
  v_auth := private.ecommerce_admin_authorize(p_license_key, p_device_fingerprint, p_security_token, 'ecommerce_admin_set_product_published');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  update public.ecommerce_published_products pp
  set is_published = coalesce(p_is_published, false)
  where pp.id = p_product_id and pp.license_id = v_license_id and pp.deleted_at is null
  returning * into v_saved;

  if v_saved.id is null then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND'); end if;

  return jsonb_build_object(
    'success', true,
    'message', case when v_saved.is_published then 'Producto publicado.' else 'Producto retirado del portal.' end,
    'product', private.ecommerce_admin_product_jsonb(v_saved)
  );
exception
  when others then
    if sqlerrm like '%ECOMMERCE_PRODUCT_LIMIT_REACHED%' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_LIMIT_REACHED'); end if;
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_STATUS_FAILED');
end;
$$;

revoke all on function private.ecommerce_admin_error(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_authorize(text, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_generate_slug(uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_portal_jsonb(public.ecommerce_portals) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_product_jsonb(public.ecommerce_published_products) from public, anon, authenticated;

grant execute on function private.ecommerce_admin_error(text, text, jsonb) to service_role;
grant execute on function private.ecommerce_admin_authorize(text, text, text, text) to service_role;
grant execute on function private.ecommerce_admin_generate_slug(uuid, text) to service_role;
grant execute on function private.ecommerce_admin_portal_jsonb(public.ecommerce_portals) to service_role;
grant execute on function private.ecommerce_admin_product_jsonb(public.ecommerce_published_products) to service_role;

revoke all on function public.ecommerce_admin_get_portal(text, text, text) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_upsert_portal(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_list_published_products(text, text, text) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_upsert_published_product(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_set_product_published(text, text, text, uuid, boolean) from public, anon, authenticated;

grant execute on function public.ecommerce_admin_get_portal(text, text, text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_upsert_portal(text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_list_published_products(text, text, text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_upsert_published_product(text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_set_product_published(text, text, text, uuid, boolean) to anon, authenticated, service_role;
