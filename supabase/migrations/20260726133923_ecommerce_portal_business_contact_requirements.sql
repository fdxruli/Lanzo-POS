-- ECOM.PORTAL.BUSINESS.CONTACT.1
-- First-class public contact data and publication requirements.

alter table public.ecommerce_portals
  add column if not exists contact_email text,
  add column if not exists address_street text,
  add column if not exists address_neighborhood text,
  add column if not exists address_municipality text,
  add column if not exists address_state text,
  add column if not exists address_postal_code text;

alter table public.ecommerce_portals
  add constraint ecommerce_portals_contact_email_valid
    check (
      contact_email is null
      or (
        length(contact_email) <= 254
        and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ) not valid,
  add constraint ecommerce_portals_published_whatsapp_required
    check (
      status <> 'published'
      or length(regexp_replace(coalesce(whatsapp_phone, ''), '[^0-9]', '', 'g')) >= 8
    ) not valid,
  add constraint ecommerce_portals_address_postal_code_valid
    check (
      address_postal_code is null
      or address_postal_code ~ '^[0-9]{5}$'
    ) not valid,
  add constraint ecommerce_portals_published_structured_address_required
    check (
      status <> 'published'
      or (
        length(btrim(coalesce(address_street, ''))) > 0
        and length(btrim(coalesce(address_neighborhood, ''))) > 0
        and length(btrim(coalesce(address_municipality, ''))) >= 2
        and btrim(address_municipality) !~* '^(s/?n|sin n[uú]mero)$'
        and length(btrim(coalesce(address_state, ''))) > 0
        and btrim(address_state) !~* '^(s/?n|sin n[uú]mero)$'
        and coalesce(address_postal_code, '') ~ '^[0-9]{5}$'
      )
    ) not valid;

comment on column public.ecommerce_portals.contact_email is
  'Optional public contact email displayed in the ecommerce storefront.';
comment on column public.ecommerce_portals.address_street is
  'Public street or avenue. S/N is accepted when the road has no official name or number.';
comment on column public.ecommerce_portals.address_neighborhood is
  'Public neighborhood, colony, or ejido. S/N is accepted when no official name exists.';
comment on column public.ecommerce_portals.address_municipality is
  'Public municipality or borough used for customer pickup.';
comment on column public.ecommerce_portals.address_state is
  'Public Mexican state used for customer pickup.';
comment on column public.ecommerce_portals.address_postal_code is
  'Five-digit Mexican postal code used for customer pickup.';

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
    'contactEmail', p_portal.contact_email,
    'address', p_portal.address,
    'addressStreet', p_portal.address_street,
    'addressNeighborhood', p_portal.address_neighborhood,
    'addressMunicipality', p_portal.address_municipality,
    'addressState', p_portal.address_state,
    'addressPostalCode', p_portal.address_postal_code,
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

create or replace function private.ecommerce_portal_public_jsonb(
  p_portal public.ecommerce_portals
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
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
    'contactEmail', p_portal.contact_email,
    'address', p_portal.address,
    'addressStreet', p_portal.address_street,
    'addressNeighborhood', p_portal.address_neighborhood,
    'addressMunicipality', p_portal.address_municipality,
    'addressState', p_portal.address_state,
    'addressPostalCode', p_portal.address_postal_code,
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
$function$;

create or replace function public.ecommerce_admin_upsert_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
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
  v_existing public.ecommerce_portals%rowtype;
  v_saved public.ecommerce_portals%rowtype;
  v_name text;
  v_slug text;
  v_requested_slug text;
  v_status text;
  v_whatsapp text;
  v_email text;
  v_address text;
  v_address_street text;
  v_address_neighborhood text;
  v_address_municipality text;
  v_address_state text;
  v_address_postal_code text;
  v_pickup boolean;
  v_delivery boolean;
  v_min_order numeric(12,2);
  v_custom_slug_allowed boolean;
  v_advanced_branding boolean;
  v_template text;
  v_theme jsonb;
  v_logo text;
  v_cover text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
  end if;

  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_upsert_portal'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);
  v_custom_slug_allowed := coalesce((v_features->>'ecommerce_custom_slug')::boolean, false);
  v_advanced_branding := coalesce(v_features->>'ecommerce_branding_customization', 'basic') = 'advanced';

  select p.*
  into v_existing
  from public.ecommerce_portals p
  where p.license_id = v_license_id
    and p.deleted_at is null
  limit 1
  for update;

  v_name := btrim(coalesce(p_payload->>'name', ''));
  if v_name = '' then
    return private.ecommerce_admin_error('ECOMMERCE_NAME_REQUIRED');
  end if;
  if v_existing.id is not null and v_name <> v_existing.name then
    return private.ecommerce_admin_error('ECOMMERCE_NAME_LOCKED');
  end if;

  v_status := lower(btrim(coalesce(p_payload->>'status', coalesce(v_existing.status, 'draft'))));
  if v_status not in ('draft', 'published', 'paused') then
    return private.ecommerce_admin_error('ECOMMERCE_STATUS_INVALID');
  end if;

  v_whatsapp := regexp_replace(coalesce(p_payload->>'whatsappPhone', ''), '[^0-9]', '', 'g');
  if v_whatsapp <> '' and length(v_whatsapp) < 8 then
    return private.ecommerce_admin_error('ECOMMERCE_WHATSAPP_INVALID');
  end if;

  v_email := lower(nullif(btrim(p_payload->>'contactEmail'), ''));
  if v_email is not null and (
    length(v_email) > 254
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CONTACT_EMAIL_INVALID');
  end if;

  v_address_street := nullif(btrim(p_payload->>'addressStreet'), '');
  v_address_neighborhood := nullif(btrim(p_payload->>'addressNeighborhood'), '');
  v_address_municipality := nullif(btrim(p_payload->>'addressMunicipality'), '');
  v_address_state := nullif(btrim(p_payload->>'addressState'), '');
  v_address_postal_code := nullif(btrim(p_payload->>'addressPostalCode'), '');
  if v_address_postal_code is not null and v_address_postal_code !~ '^[0-9]{5}$' then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_POSTAL_CODE_INVALID');
  end if;
  v_address := nullif(concat_ws(
    ', ',
    v_address_street,
    v_address_neighborhood,
    v_address_municipality,
    v_address_state,
    case
      when v_address_postal_code is not null then 'C.P. ' || v_address_postal_code
      else null
    end
  ), '');
  if v_status = 'published' and length(v_whatsapp) < 8 then
    return private.ecommerce_admin_error('ECOMMERCE_WHATSAPP_REQUIRED_TO_PUBLISH');
  end if;
  if v_status = 'published' and v_address_street is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_STREET_REQUIRED_TO_PUBLISH');
  end if;
  if v_status = 'published' and v_address_neighborhood is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_NEIGHBORHOOD_REQUIRED_TO_PUBLISH');
  end if;
  if v_status = 'published' and (
    length(coalesce(v_address_municipality, '')) < 2
    or v_address_municipality ~* '^(s/?n|sin n[uú]mero)$'
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_MUNICIPALITY_REQUIRED_TO_PUBLISH');
  end if;
  if v_status = 'published' and (
    v_address_state is null
    or v_address_state ~* '^(s/?n|sin n[uú]mero)$'
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_STATE_REQUIRED_TO_PUBLISH');
  end if;
  if v_status = 'published' and coalesce(v_address_postal_code, '') !~ '^[0-9]{5}$' then
    return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_POSTAL_CODE_REQUIRED_TO_PUBLISH');
  end if;

  v_pickup := coalesce((p_payload->>'pickupEnabled')::boolean, true);
  v_delivery := coalesce((p_payload->>'deliveryEnabled')::boolean, false);
  if not v_pickup and not v_delivery then
    return private.ecommerce_admin_error('ECOMMERCE_DELIVERY_METHOD_REQUIRED');
  end if;

  v_min_order := coalesce(nullif(p_payload->>'minOrderTotal', '')::numeric, 0);
  if v_min_order < 0 then
    return private.ecommerce_admin_error('ECOMMERCE_MIN_ORDER_INVALID');
  end if;

  v_requested_slug := nullif(btrim(p_payload->>'slug'), '');
  v_slug := coalesce(v_existing.slug, private.ecommerce_admin_generate_slug(v_license_id, v_name));
  if v_custom_slug_allowed and v_requested_slug is not null then
    v_slug := v_requested_slug;
    if length(v_slug) not between 3 and 64
      or v_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' then
      return private.ecommerce_admin_error('ECOMMERCE_SLUG_INVALID');
    end if;
  elsif not v_custom_slug_allowed
    and v_existing.id is not null
    and v_requested_slug is not null
    and v_requested_slug <> v_existing.slug then
    return private.ecommerce_admin_error('ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO');
  end if;

  if exists (
    select 1
    from public.ecommerce_portals p
    where p.slug = v_slug
      and p.deleted_at is null
      and (v_existing.id is null or p.id <> v_existing.id)
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN');
  end if;

  begin
    if v_advanced_branding then
      v_template := private.ecommerce_portal_normalize_template(
        case
          when p_payload ? 'templateCode' then p_payload->>'templateCode'
          else coalesce(v_existing.template_code, 'classic')
        end
      );
      v_theme := private.ecommerce_portal_normalize_theme(
        case
          when p_payload ? 'theme' then p_payload->'theme'
          else coalesce(v_existing.theme, '{}'::jsonb)
        end
      );
      v_cover := case
        when p_payload ? 'coverImageUrl'
          then private.ecommerce_portal_normalize_image_url(p_payload->'coverImageUrl')
        else v_existing.cover_image_url
      end;
    else
      v_template := 'classic';
      v_theme := '{}'::jsonb;
      v_cover := null;
    end if;
    v_logo := case
      when p_payload ? 'logoUrl'
        then private.ecommerce_portal_normalize_image_url(p_payload->'logoUrl')
      else v_existing.logo_url
    end;
  exception
    when others then
      if sqlerrm like '%ECOMMERCE_TEMPLATE_INVALID%' then
        return private.ecommerce_admin_error('ECOMMERCE_TEMPLATE_INVALID');
      end if;
      if sqlerrm like '%ECOMMERCE_THEME_COLOR_INVALID%' then
        return private.ecommerce_admin_error('ECOMMERCE_THEME_COLOR_INVALID');
      end if;
      if sqlerrm like '%ECOMMERCE_THEME_INVALID%' then
        return private.ecommerce_admin_error('ECOMMERCE_THEME_INVALID');
      end if;
      if sqlerrm like '%ECOMMERCE_IMAGE_URL_INVALID%' then
        return private.ecommerce_admin_error('ECOMMERCE_IMAGE_URL_INVALID');
      end if;
      return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
  end;

  insert into public.ecommerce_portals (
    license_id,
    slug,
    slug_source,
    status,
    name,
    headline,
    description,
    template_code,
    customization_level,
    theme,
    logo_url,
    cover_image_url,
    whatsapp_phone,
    contact_email,
    address,
    address_street,
    address_neighborhood,
    address_municipality,
    address_state,
    address_postal_code,
    pickup_enabled,
    delivery_enabled,
    min_order_total,
    stock_mode,
    settings,
    metadata
  )
  values (
    v_license_id,
    v_slug,
    case when v_custom_slug_allowed and v_requested_slug is not null then 'custom' else 'system' end,
    v_status,
    v_name,
    nullif(btrim(p_payload->>'headline'), ''),
    nullif(btrim(p_payload->>'description'), ''),
    v_template,
    case when v_advanced_branding then 'advanced' else 'basic' end,
    v_theme,
    v_logo,
    v_cover,
    nullif(v_whatsapp, ''),
    v_email,
    v_address,
    v_address_street,
    v_address_neighborhood,
    v_address_municipality,
    v_address_state,
    v_address_postal_code,
    v_pickup,
    v_delivery,
    v_min_order,
    'hidden',
    coalesce(p_payload->'settings', '{}'::jsonb),
    jsonb_build_object('source', 'admin_ui', 'phase', 'ECOM.PORTAL.BUSINESS.CONTACT.1')
  )
  on conflict (license_id) where deleted_at is null do update set
    slug = excluded.slug,
    slug_source = case
      when v_custom_slug_allowed
        and v_requested_slug is not null
        and v_requested_slug <> ecommerce_portals.slug then 'custom'
      else ecommerce_portals.slug_source
    end,
    status = excluded.status,
    name = ecommerce_portals.name,
    headline = excluded.headline,
    description = excluded.description,
    template_code = excluded.template_code,
    customization_level = excluded.customization_level,
    theme = excluded.theme,
    logo_url = excluded.logo_url,
    cover_image_url = excluded.cover_image_url,
    whatsapp_phone = excluded.whatsapp_phone,
    contact_email = excluded.contact_email,
    address = excluded.address,
    address_street = excluded.address_street,
    address_neighborhood = excluded.address_neighborhood,
    address_municipality = excluded.address_municipality,
    address_state = excluded.address_state,
    address_postal_code = excluded.address_postal_code,
    pickup_enabled = excluded.pickup_enabled,
    delivery_enabled = excluded.delivery_enabled,
    min_order_total = excluded.min_order_total,
    stock_mode = case
      when coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false)
        then ecommerce_portals.stock_mode
      else 'hidden'
    end,
    settings = coalesce(p_payload->'settings', ecommerce_portals.settings),
    metadata = coalesce(ecommerce_portals.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'last_admin_source',
        'admin_ui',
        'phase',
        'ECOM.PORTAL.BUSINESS.CONTACT.1'
      )
  returning * into v_saved;

  return jsonb_build_object(
    'success', true,
    'message', case
      when v_existing.id is null then 'Portal online creado correctamente.'
      else 'Portal online actualizado correctamente.'
    end,
    'portal', private.ecommerce_admin_portal_jsonb(v_saved),
    'plan', jsonb_build_object(
      'code', v_auth->>'plan_code',
      'name', v_auth->>'plan_name',
      'isPro', (v_auth->>'plan_code') = 'pro_monthly'
    ),
    'features', jsonb_build_object(
      'maxPublishedProducts', coalesce((v_features->>'ecommerce_max_published_products')::integer, 0),
      'customSlug', v_custom_slug_allowed,
      'brandingCustomization', coalesce(v_features->>'ecommerce_branding_customization', 'basic'),
      'layoutCustomization', coalesce(v_features->>'ecommerce_layout_customization', 'template_only'),
      'stockVisibility', coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false),
      'cloudCatalogSource', coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false)
    )
  );
exception
  when unique_violation then
    return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN');
  when check_violation then
    if sqlerrm like '%ecommerce_portals_published_whatsapp_required%' then
      return private.ecommerce_admin_error('ECOMMERCE_WHATSAPP_REQUIRED_TO_PUBLISH');
    end if;
    if sqlerrm like '%ecommerce_portals_published_structured_address_required%' then
      return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_REQUIRED_TO_PUBLISH');
    end if;
    if sqlerrm like '%ecommerce_portals_address_postal_code_valid%' then
      return private.ecommerce_admin_error('ECOMMERCE_ADDRESS_POSTAL_CODE_INVALID');
    end if;
    if sqlerrm like '%ecommerce_portals_contact_email_valid%' then
      return private.ecommerce_admin_error('ECOMMERCE_CONTACT_EMAIL_INVALID');
    end if;
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
  when others then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
end;
$function$;

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
as $function$
begin
  return public.ecommerce_admin_upsert_portal(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    null::text,
    p_payload
  );
end;
$function$;

revoke all on function private.ecommerce_admin_portal_jsonb(public.ecommerce_portals)
  from public, anon, authenticated;
revoke all on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals)
  from public, anon, authenticated;
revoke all on function public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ecommerce_admin_upsert_portal(text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function private.ecommerce_admin_portal_jsonb(public.ecommerce_portals)
  to service_role;
grant execute on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals)
  to service_role;
grant execute on function public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
  to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_upsert_portal(text, text, text, jsonb)
  to anon, authenticated, service_role;
