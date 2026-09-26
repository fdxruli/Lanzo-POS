-- Dedicated capability. Unknown/legacy plans and absent license overrides fail closed.
update public.plans
   set features = jsonb_set(coalesce(features, '{}'::jsonb),
     '{ecommerce_paused_contact_whatsapp}',
     case when code = 'pro_monthly' then 'true'::jsonb else 'false'::jsonb end,
     true)
 where code in ('free_trial', 'pro_monthly');
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
  v_paused_phone text;
  v_paused_digits text;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    if private.ecommerce_resolve_public_portal_status(p_slug) = 'paused' then
      select p.whatsapp_phone into v_paused_phone
        from public.ecommerce_portals p
       where p.slug = private.ecommerce_normalize_slug(p_slug)
         and p.status = 'paused'
         and p.deleted_at is null
         and private.ecommerce_license_feature_bool(
           p.license_id, 'ecommerce_paused_contact_whatsapp', false
         ) is true
       limit 1;
      if v_paused_phone is not null
         and btrim(v_paused_phone) ~ '^[+0-9().[:space:]-]+$' then
        v_paused_digits := regexp_replace(v_paused_phone, '[^0-9]', '', 'g');
      end if;
      if v_paused_digits ~ '^[0-9]{8,15}$' then
        return jsonb_build_object(
          'success', false,
          'error', jsonb_build_object('code', 'ECOMMERCE_PORTAL_PAUSED'),
          'pausedContact', jsonb_build_object('whatsappPhone', v_paused_digits)
        );
      end if;
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
