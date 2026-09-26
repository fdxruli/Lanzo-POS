-- Resolve only the public entry state. Operational RPCs keep their published-only gate.
create or replace function private.ecommerce_resolve_public_portal_status(p_slug text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_slug text;
  v_status text;
  v_license_id uuid;
begin
  v_slug := private.ecommerce_normalize_slug(p_slug);
  if v_slug is null then
    return 'not_found';
  end if;

  select p.status, p.license_id
    into v_status, v_license_id
    from public.ecommerce_portals p
   where p.slug = v_slug
     and p.deleted_at is null
   limit 1;

  if v_status is null or v_status not in ('published', 'paused')
     or private.ecommerce_license_feature_bool(v_license_id, 'ecommerce_portal_enabled', false) is not true then
    return 'not_found';
  end if;
  return v_status;
end;
$function$;

alter function private.ecommerce_resolve_public_portal_status(text) owner to postgres;
revoke all on function private.ecommerce_resolve_public_portal_status(text) from public, anon, authenticated;

create or replace function private.ecommerce_site_public_payload(
  p_slug text,
  p_legacy boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_version public.ecommerce_site_versions%rowtype;
  v_document jsonb;
  v_error text;
  v_version_id uuid := null;
  v_version_number bigint := null;
  v_mode text := 'default';
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    if private.ecommerce_resolve_public_portal_status(p_slug) = 'paused' then
      return jsonb_build_object('success', false, 'error', jsonb_build_object('code', 'ECOMMERCE_PORTAL_PAUSED'));
    end if;
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  select v.*
    into v_version
    from public.ecommerce_site_documents d
    join public.ecommerce_site_versions v
      on v.id = d.published_version_id
     and v.portal_id = d.portal_id
   where d.portal_id = v_portal.id;

  if v_version.id is not null then
    v_document := case
      when v_version.schema_version = 2 then v_version.document
      else private.ecommerce_site_migrate_document_v1_to_v2(
        v_version.document,
        v_portal.template_code,
        v_portal.theme,
        v_portal.logo_url,
        v_portal.cover_image_url
      )
    end;
    v_error := private.ecommerce_site_document_error(v_document);
    if v_error is null then
      v_version_id := v_version.id;
      v_version_number := v_version.version_number;
      v_mode := coalesce(
        nullif(v_version.document_mode, ''),
        private.ecommerce_site_document_mode_v2(v_document)
      );
    else
      v_document := null;
    end if;
  end if;

  if v_document is null then
    v_document := private.ecommerce_site_default_document_v2(
      v_portal.template_code,
      v_portal.theme,
      v_portal.logo_url,
      v_portal.cover_image_url
    );
    v_version_id := null;
    v_version_number := null;
    v_mode := 'default';
  end if;

  if p_legacy then
    v_document := private.ecommerce_site_project_document_v2_to_v1(v_document);
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
    'site', jsonb_build_object(
      'schemaVersion', case when p_legacy then 1 else 2 end,
      'versionId', v_version_id,
      'versionNumber', v_version_number,
      'documentMode', v_mode,
      'document', v_document
    ),
    'cachePolicy', jsonb_build_object(
      'schemaVersion', 3,
      'freshSeconds', 300,
      'maxStaleSeconds', 86400
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PUBLIC_REQUEST_FAILED');
end;
$function$;

alter function private.ecommerce_site_public_payload(text, boolean) owner to postgres;
revoke all on function private.ecommerce_site_public_payload(text, boolean) from public, anon, authenticated;
