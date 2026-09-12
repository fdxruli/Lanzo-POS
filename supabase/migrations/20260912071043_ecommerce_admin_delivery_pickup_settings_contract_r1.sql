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
    'plan', jsonb_build_object(
      'code', v_auth->>'plan_code',
      'name', v_auth->>'plan_name',
      'isPro', (v_auth->>'plan_code') = 'pro_monthly'
    ),
    'features', jsonb_build_object(
      'portalEnabled', coalesce((v_features->>'ecommerce_portal_enabled')::boolean, false),
      'maxPublishedProducts', coalesce((v_features->>'ecommerce_max_published_products')::integer, 0),
      'customSlug', coalesce((v_features->>'ecommerce_custom_slug')::boolean, false),
      'brandingCustomization', coalesce(v_features->>'ecommerce_branding_customization', 'basic'),
      'layoutCustomization', coalesce(v_features->>'ecommerce_layout_customization', 'template_only'),
      'stockVisibility', coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false),
      'realtimeOrders', coalesce((v_features->>'ecommerce_realtime_orders')::boolean, false),
      'cloudCatalogSource', coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false),
      'businessHours', coalesce((v_features->>'ecommerce_business_hours')::boolean, true),
      'deliveryPickupSettings', coalesce(
        v_features->>'ecommerce_delivery_pickup_settings',
        'basic'
      )
    ),
    'portal', case
      when v_portal.id is null then null
      else private.ecommerce_admin_portal_jsonb(v_portal)
    end,
    'timezone', case
      when v_portal.id is null then 'America/Mexico_City'
      else v_portal.timezone
    end,
    'businessHoursEnabled', coalesce(v_portal.business_hours_enabled, false),
    'ordersPaused', coalesce(v_portal.orders_paused, false),
    'ordersPausedUntil', v_portal.orders_paused_until,
    'ordersPauseReason', v_portal.orders_pause_reason,
    'hours', case
      when v_portal.id is null then jsonb_build_object('weekly', '[]'::jsonb, 'exceptions', '[]'::jsonb)
      else private.ecommerce_portal_hours_jsonb(v_portal.id)
    end,
    'availability', case
      when v_portal.id is null then null
      else private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp())
    end,
    'publishedProductCount', v_count
  );
end;
$function$;
