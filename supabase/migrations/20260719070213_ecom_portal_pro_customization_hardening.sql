-- FASE ECOM.PORTAL.PRO.CUSTOMIZATION.1
-- Compensatory hardening; historical portal migrations remain immutable.

create or replace function private.ecommerce_portal_normalize_template(p_value text)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare v_value text := lower(btrim(coalesce(p_value, 'classic')));
begin
  if v_value = '' then return 'classic'; end if;
  if v_value not in ('classic', 'showcase', 'compact') then
    raise exception 'ECOMMERCE_TEMPLATE_INVALID';
  end if;
  return v_value;
end;
$$;

create or replace function private.ecommerce_portal_normalize_theme(p_value jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_key text;
  v_primary text := '#0284c7';
  v_secondary text := '#0369a1';
  v_corner text := 'rounded';
  v_font text := 'system';
begin
  if p_value is null then
    return jsonb_build_object('primaryColor', v_primary, 'secondaryColor', v_secondary, 'cornerStyle', v_corner, 'fontStyle', v_font);
  end if;
  if jsonb_typeof(p_value) <> 'object' or octet_length(p_value::text) > 512 then
    raise exception 'ECOMMERCE_THEME_INVALID';
  end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if v_key not in ('primaryColor', 'secondaryColor', 'cornerStyle', 'fontStyle') then
      raise exception 'ECOMMERCE_THEME_INVALID';
    end if;
  end loop;
  if p_value ? 'primaryColor' then
    v_primary := p_value->>'primaryColor';
    if v_primary !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'ECOMMERCE_THEME_COLOR_INVALID'; end if;
  end if;
  if p_value ? 'secondaryColor' then
    v_secondary := p_value->>'secondaryColor';
    if v_secondary !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'ECOMMERCE_THEME_COLOR_INVALID'; end if;
  end if;
  if p_value ? 'cornerStyle' then
    v_corner := p_value->>'cornerStyle';
    if v_corner not in ('rounded', 'soft', 'square') then raise exception 'ECOMMERCE_THEME_INVALID'; end if;
  end if;
  if p_value ? 'fontStyle' then
    v_font := p_value->>'fontStyle';
    if v_font not in ('system', 'rounded', 'editorial') then raise exception 'ECOMMERCE_THEME_INVALID'; end if;
  end if;
  return jsonb_build_object('primaryColor', lower(v_primary), 'secondaryColor', lower(v_secondary), 'cornerStyle', v_corner, 'fontStyle', v_font);
end;
$$;

create or replace function private.ecommerce_portal_normalize_image_url(p_value jsonb)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare v_url text;
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) <> 'string' then raise exception 'ECOMMERCE_IMAGE_URL_INVALID'; end if;
  v_url := btrim(p_value #>> '{}');
  if length(v_url) > 2048 or v_url ~ '[[:cntrl:]]' or v_url !~* '^https://[^[:space:]]+$' then
    raise exception 'ECOMMERCE_IMAGE_URL_INVALID';
  end if;
  return v_url;
end;
$$;

-- The public overload remains the sole authorized entrypoint. It delegates all
-- authorization/rate-limit decisions to the existing v2 helper before any write.
create or replace function public.ecommerce_admin_upsert_portal(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_auth jsonb; v_license_id uuid; v_features jsonb; v_existing public.ecommerce_portals%rowtype; v_saved public.ecommerce_portals%rowtype;
  v_name text; v_slug text; v_status text; v_whatsapp text; v_pickup boolean; v_delivery boolean; v_min_order numeric(12,2);
  v_custom_slug_allowed boolean; v_advanced_branding boolean; v_template text; v_theme jsonb; v_logo text; v_cover text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED'); end if;
  v_auth := private.ecommerce_admin_authorize_v2(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_upsert_portal');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid; v_features := coalesce(v_auth->'features', '{}'::jsonb);
  v_custom_slug_allowed := coalesce((v_features->>'ecommerce_custom_slug')::boolean, false);
  v_advanced_branding := coalesce(v_features->>'ecommerce_branding_customization', 'basic') = 'advanced';
  select p.* into v_existing from public.ecommerce_portals p where p.license_id = v_license_id and p.deleted_at is null limit 1 for update;
  v_name := btrim(coalesce(p_payload->>'name', '')); if v_name = '' then return private.ecommerce_admin_error('ECOMMERCE_NAME_REQUIRED'); end if;
  v_status := lower(btrim(coalesce(p_payload->>'status', coalesce(v_existing.status, 'draft')))); if v_status not in ('draft','published','paused') then return private.ecommerce_admin_error('ECOMMERCE_STATUS_INVALID'); end if;
  v_whatsapp := regexp_replace(coalesce(p_payload->>'whatsappPhone', ''), '[^0-9]', '', 'g'); if v_whatsapp <> '' and length(v_whatsapp) < 8 then return private.ecommerce_admin_error('ECOMMERCE_WHATSAPP_INVALID'); end if;
  v_pickup := coalesce((p_payload->>'pickupEnabled')::boolean, true); v_delivery := coalesce((p_payload->>'deliveryEnabled')::boolean, false); if not v_pickup and not v_delivery then return private.ecommerce_admin_error('ECOMMERCE_DELIVERY_METHOD_REQUIRED'); end if;
  v_min_order := coalesce(nullif(p_payload->>'minOrderTotal', '')::numeric, 0); if v_min_order < 0 then return private.ecommerce_admin_error('ECOMMERCE_MIN_ORDER_INVALID'); end if;
  v_slug := coalesce(v_existing.slug, private.ecommerce_admin_generate_slug(v_license_id, v_name));
  if v_custom_slug_allowed and nullif(btrim(p_payload->>'slug'), '') is not null then
    v_slug := btrim(p_payload->>'slug'); if length(v_slug) not between 3 and 64 or v_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' then return private.ecommerce_admin_error('ECOMMERCE_SLUG_INVALID'); end if;
  elsif not v_custom_slug_allowed and v_existing.id is not null and nullif(btrim(p_payload->>'slug'), '') is not null and btrim(p_payload->>'slug') <> v_existing.slug then return private.ecommerce_admin_error('ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO'); end if;
  if exists (select 1 from public.ecommerce_portals p where p.slug = v_slug and p.deleted_at is null and (v_existing.id is null or p.id <> v_existing.id)) then return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN'); end if;
  begin
    if v_advanced_branding then
      v_template := private.ecommerce_portal_normalize_template(case when p_payload ? 'templateCode' then p_payload->>'templateCode' else coalesce(v_existing.template_code, 'classic') end);
      v_theme := private.ecommerce_portal_normalize_theme(case when p_payload ? 'theme' then p_payload->'theme' else coalesce(v_existing.theme, '{}'::jsonb) end);
      v_cover := case when p_payload ? 'coverImageUrl' then private.ecommerce_portal_normalize_image_url(p_payload->'coverImageUrl') else v_existing.cover_image_url end;
    else
      v_template := 'classic'; v_theme := '{}'::jsonb; v_cover := null;
    end if;
    v_logo := case when p_payload ? 'logoUrl' then private.ecommerce_portal_normalize_image_url(p_payload->'logoUrl') else v_existing.logo_url end;
  exception when others then
    if sqlerrm like '%ECOMMERCE_TEMPLATE_INVALID%' then return private.ecommerce_admin_error('ECOMMERCE_TEMPLATE_INVALID'); end if;
    if sqlerrm like '%ECOMMERCE_THEME_COLOR_INVALID%' then return private.ecommerce_admin_error('ECOMMERCE_THEME_COLOR_INVALID'); end if;
    if sqlerrm like '%ECOMMERCE_THEME_INVALID%' then return private.ecommerce_admin_error('ECOMMERCE_THEME_INVALID'); end if;
    if sqlerrm like '%ECOMMERCE_IMAGE_URL_INVALID%' then return private.ecommerce_admin_error('ECOMMERCE_IMAGE_URL_INVALID'); end if;
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
  end;
  insert into public.ecommerce_portals (license_id,slug,slug_source,status,name,headline,description,template_code,customization_level,theme,logo_url,cover_image_url,whatsapp_phone,address,pickup_enabled,delivery_enabled,min_order_total,stock_mode,settings,metadata)
  values (v_license_id,v_slug,case when v_custom_slug_allowed and nullif(btrim(p_payload->>'slug'),'') is not null then 'custom' else 'system' end,v_status,v_name,nullif(btrim(p_payload->>'headline'),''),nullif(btrim(p_payload->>'description'),''),v_template,case when v_advanced_branding then 'advanced' else 'basic' end,v_theme,v_logo,v_cover,nullif(v_whatsapp,''),nullif(btrim(p_payload->>'address'),''),v_pickup,v_delivery,v_min_order,'hidden',coalesce(p_payload->'settings','{}'::jsonb),jsonb_build_object('source','admin_ui','phase','ECOM.PORTAL.PRO.CUSTOMIZATION.1'))
  on conflict (license_id) where deleted_at is null do update set slug=excluded.slug,status=excluded.status,name=excluded.name,headline=excluded.headline,description=excluded.description,template_code=excluded.template_code,customization_level=excluded.customization_level,theme=excluded.theme,logo_url=excluded.logo_url,cover_image_url=excluded.cover_image_url,whatsapp_phone=excluded.whatsapp_phone,address=excluded.address,pickup_enabled=excluded.pickup_enabled,delivery_enabled=excluded.delivery_enabled,min_order_total=excluded.min_order_total,stock_mode=case when coalesce((v_features->>'ecommerce_stock_visibility')::boolean,false) then ecommerce_portals.stock_mode else 'hidden' end,settings=coalesce(p_payload->'settings',ecommerce_portals.settings),metadata=coalesce(ecommerce_portals.metadata,'{}'::jsonb)||jsonb_build_object('last_admin_source','admin_ui','phase','ECOM.PORTAL.PRO.CUSTOMIZATION.1')
  returning * into v_saved;
  return jsonb_build_object('success',true,'message',case when v_existing.id is null then 'Portal online creado correctamente.' else 'Portal online actualizado correctamente.' end,'portal',private.ecommerce_admin_portal_jsonb(v_saved),'plan',jsonb_build_object('code',v_auth->>'plan_code','name',v_auth->>'plan_name','isPro',(v_auth->>'plan_code')='pro_monthly'),'features',jsonb_build_object('maxPublishedProducts',coalesce((v_features->>'ecommerce_max_published_products')::integer,0),'customSlug',v_custom_slug_allowed,'brandingCustomization',coalesce(v_features->>'ecommerce_branding_customization','basic'),'layoutCustomization',coalesce(v_features->>'ecommerce_layout_customization','template_only'),'stockVisibility',coalesce((v_features->>'ecommerce_stock_visibility')::boolean,false),'cloudCatalogSource',coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean,false)));
exception when unique_violation then return private.ecommerce_admin_error('ECOMMERCE_SLUG_TAKEN'); when others then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED'); end;
$$;

revoke all on function private.ecommerce_portal_normalize_template(text) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_normalize_theme(jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_portal_normalize_image_url(jsonb) from public, anon, authenticated;
grant execute on function private.ecommerce_portal_normalize_template(text) to service_role;
grant execute on function private.ecommerce_portal_normalize_theme(jsonb) to service_role;
grant execute on function private.ecommerce_portal_normalize_image_url(jsonb) to service_role;
revoke all on function public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb) to anon, authenticated, service_role;

;
