begin;

create or replace function private.ecommerce_order_item_enrich_variant_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_variant_id uuid;
  v_variant public.ecommerce_published_product_variants%rowtype;
begin
  if jsonb_typeof(new.options) <> 'object' then
    return new;
  end if;

  begin
    v_variant_id := nullif(btrim(coalesce(new.options #>> '{variant,id}', '')), '')::uuid;
  exception
    when invalid_text_representation then
      return new;
  end;

  if v_variant_id is null or new.published_product_id is null then
    return new;
  end if;

  select v.*
    into v_variant
  from public.ecommerce_published_product_variants v
  where v.id = v_variant_id
    and v.published_product_id = new.published_product_id
    and v.portal_id = new.portal_id
    and v.license_id = new.license_id
    and v.deleted_at is null
  limit 1;

  if v_variant.id is null then
    return new;
  end if;

  new.options := jsonb_set(
    new.options,
    '{variant,sourceVariantRef}',
    to_jsonb(v_variant.source_variant_ref),
    true
  );
  new.options := jsonb_set(
    new.options,
    '{variant,sku}',
    coalesce(to_jsonb(v_variant.sku), 'null'::jsonb),
    true
  );

  return new;
end;
$function$;

revoke all on function private.ecommerce_order_item_enrich_variant_identity_v1() from public;

drop trigger if exists ecommerce_order_items_enrich_variant_identity
  on public.ecommerce_order_items;
create trigger ecommerce_order_items_enrich_variant_identity
before insert or update of options, published_product_id
on public.ecommerce_order_items
for each row
execute function private.ecommerce_order_item_enrich_variant_identity_v1();

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
  v_configuration_revision text;
  v_catalog_revision bigint;
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
  for share;

  if v_product.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;

  select p.catalog_revision
    into v_catalog_revision
  from public.ecommerce_portals p
  where p.id = v_portal.id
    and p.license_id = v_portal.license_id
    and p.deleted_at is null;

  if v_catalog_revision is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  v_rate_limit := private.ecommerce_enforce_product_configuration_rate_limit(
    v_portal.id,
    v_portal.license_id,
    v_product.id
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, true) is not true then
    return private.ecommerce_public_error('ECOMMERCE_RATE_LIMITED');
  end if;

  v_allow_stock_visibility := private.ecommerce_license_feature_bool(
    v_portal.license_id,
    'ecommerce_stock_visibility',
    false
  );
  v_configuration_revision := private.ecommerce_product_configuration_revision(v_product.id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'sourceVariantRef', v.source_variant_ref,
        'sku', v.sku,
        'publicName', coalesce(
          nullif(btrim(v.public_name), ''),
          (
            select string_agg(e.value, ' / ' order by e.key)
            from jsonb_each_text(v.option_values) e
          )
        ),
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
        'options', coalesce(
          (
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
          ),
          '[]'::jsonb
        )
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
    'catalogRevision', v_catalog_revision,
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.public_name,
      'description', v_product.public_description,
      'imageUrl', v_product.image_url,
      'currency', v_product.currency,
      'configurationType', v_product.configuration_type,
      'configurationVersion', v_product.configuration_version,
      'configurationRevision', v_configuration_revision,
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
          when private.ecommerce_product_publicly_available(v_product) then 'Disponible'
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

commit;
