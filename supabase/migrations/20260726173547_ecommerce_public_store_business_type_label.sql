-- Keep the public storefront rubro aligned with the normalized business profile
-- snapshot that is already reconciled for ecommerce capability checks.
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
    'businessType', case
      when cardinality(coalesce(p_portal.business_types_snapshot, '{}'::text[])) > 0
        then to_jsonb(p_portal.business_types_snapshot)
      else coalesce(to_jsonb(p_portal.business_type), '[]'::jsonb)
    end,
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

alter function private.ecommerce_portal_public_jsonb(public.ecommerce_portals)
  owner to postgres;

revoke all on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals)
  from public, anon, authenticated;

grant execute on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals)
  to service_role;
