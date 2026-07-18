-- HOTFIX ECOM.CONFIGURATION.CONTENT_REVISION.COORDINATION regression test.
-- Exercises restaurant and apparel content-addressed configuration revisions.
-- All synthetic rows and side effects are rolled back.

begin;

do $test$
declare
  v_license_id uuid := '24800000-0000-4000-8000-000000000001';
  v_portal_id uuid := '24800000-0000-4000-8000-000000000002';
  v_published_id uuid := '24800000-0000-4000-8000-000000000003';
  v_product_id text := 'content-revision-product';
  v_restaurant_single jsonb := jsonb_build_object(
    'type', 'configurable',
    'version', 1,
    'hasRecipe', false,
    'variants', '[]'::jsonb,
    'optionGroups', jsonb_build_array(jsonb_build_object(
      'sourceGroupRef', 'extras',
      'publicName', 'Extras',
      'selectionType', 'single',
      'required', false,
      'minSelect', 0,
      'maxSelect', 1,
      'displayOrder', 0,
      'options', jsonb_build_array(jsonb_build_object(
        'sourceOptionRef', 'queso',
        'publicName', 'Queso extra',
        'priceDelta', 12,
        'sourceIngredientId', null,
        'ingredientQuantity', null,
        'ingredientUnit', null,
        'tracksInventory', false,
        'manualAvailable', true,
        'sourceAvailable', true,
        'displayOrder', 0,
        'metadata', '{}'::jsonb
      )),
      'metadata', '{}'::jsonb
    )),
    'availabilitySource', 'direct',
    'availabilityReasonCode', 'SOURCE_STOCK_AVAILABLE',
    'limitingSource', jsonb_build_object('productId', null, 'name', null)
  );
  v_restaurant_multiple jsonb;
  v_apparel jsonb;
  v_conflict boolean := false;
  v_result jsonb;
begin
  v_restaurant_multiple := jsonb_set(
    jsonb_set(v_restaurant_single, '{optionGroups,0,selectionType}', '"multiple"'::jsonb),
    '{optionGroups,0,maxSelect}',
    '2'::jsonb
  );
  v_restaurant_multiple := jsonb_set(
    v_restaurant_multiple,
    '{optionGroups,0,options}',
    (v_restaurant_multiple #> '{optionGroups,0,options}') || jsonb_build_array(jsonb_build_object(
      'sourceOptionRef', 'tocino',
      'publicName', 'Tocino',
      'priceDelta', 15,
      'sourceIngredientId', null,
      'ingredientQuantity', null,
      'ingredientUnit', null,
      'tracksInventory', false,
      'manualAvailable', true,
      'sourceAvailable', true,
      'displayOrder', 1,
      'metadata', '{}'::jsonb
    ))
  );

  v_apparel := jsonb_build_object(
    'type', 'variant_parent',
    'version', 1,
    'hasRecipe', false,
    'variants', jsonb_build_array(jsonb_build_object(
      'sourceVariantRef', 'sku:camisa-negra-m',
      'sourceProductId', null,
      'localProductRef', v_product_id,
      'sku', 'CAMISA-NEGRA-M',
      'publicName', 'Negro / M',
      'optionValues', jsonb_build_object('color', 'Negro', 'talla', 'M'),
      'priceMode', 'base',
      'priceValue', 0,
      'imageUrl', null,
      'imageRef', null,
      'trackStock', true,
      'stockMode', 'exact',
      'stockSnapshot', 3,
      'sourceAvailable', true,
      'manualAvailable', true,
      'displayOrder', 0,
      'sourceRevision', 'version:5',
      'metadata', '{}'::jsonb
    )),
    'optionGroups', '[]'::jsonb,
    'availabilitySource', 'variant_aggregate',
    'availabilityReasonCode', 'CONFIGURATION_REQUIRED',
    'limitingSource', jsonb_build_object('productId', null, 'name', null)
  );

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values (
    v_license_id,
    'ECOM-CONTENT-REVISION-ROLLBACK',
    'pro',
    'active',
    now() + interval '1 hour',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_cloud_catalog_source', true,
      'ecommerce_max_published_products', -1
    )
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name
  ) values (
    v_portal_id,
    v_license_id,
    'content-revision-rollback',
    'published',
    'Content revision rollback'
  );

  insert into public.pos_products(
    id, license_id, name, name_key, price, stock, committed_stock,
    track_stock, is_active, product_type, sale_type, batch_management,
    expiration_mode, server_version, metadata
  ) values (
    v_product_id,
    v_license_id,
    'Producto configurable',
    'producto-configurable',
    100,
    5,
    0,
    true,
    true,
    'sellable',
    'unit',
    '{"enabled":true}'::jsonb,
    'NONE',
    5,
    '{}'::jsonb
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, local_product_ref, public_name, price,
    is_published, manual_available, source_available, is_available,
    source_state, source_revision, source_revision_kind,
    source_revision_order, source_payload_hash
  ) values (
    v_published_id,
    v_portal_id,
    v_license_id,
    v_product_id,
    'Producto configurable',
    100,
    true,
    true,
    true,
    true,
    'in_stock',
    'version:5',
    'version',
    5,
    'catalog-payload-v5'
  );

  -- Seed the canonical restaurant configuration.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_restaurant_single,
    'version:5',
    false
  );

  -- An identical content-addressed retry is accepted even when the base
  -- catalog item is idempotent.
  v_result := private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_restaurant_single,
    'configuration:restaurant-single',
    false
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'IDENTICAL_CONTENT_REVISION_RETRY_FAILED';
  end if;

  -- Different restaurant content without a newly accepted base projection
  -- remains blocked.
  begin
    perform private.ecommerce_apply_product_configuration_checked(
      v_license_id,
      v_published_id,
      v_restaurant_multiple,
      'configuration:restaurant-multiple',
      false
    );
  exception when others then
    if sqlerrm = 'ECOMMERCE_CATALOG_SOURCE_CONFLICT' then
      v_conflict := true;
    else
      raise;
    end if;
  end;
  if not v_conflict then
    raise exception 'HIDDEN_RESTAURANT_CHANGE_NOT_BLOCKED';
  end if;

  -- Once the base catalog projection has advanced in the same transaction,
  -- the derived restaurant configuration may advance too.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_restaurant_multiple,
    'configuration:restaurant-multiple',
    true
  );

  if not exists (
    select 1
    from public.ecommerce_published_option_groups g
    where g.published_product_id = v_published_id
      and g.source_group_ref = 'extras'
      and g.selection_type = 'multiple'
      and g.max_select = 2
      and g.deleted_at is null
  ) then
    raise exception 'RESTAURANT_MULTIPLE_CONFIGURATION_NOT_APPLIED';
  end if;

  -- The exact restaurant retry remains idempotent.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_restaurant_multiple,
    'configuration:restaurant-multiple-retry',
    false
  );

  -- Apparel configuration changes are also accepted only after the base
  -- catalog projection advances.
  v_conflict := false;
  begin
    perform private.ecommerce_apply_product_configuration_checked(
      v_license_id,
      v_published_id,
      v_apparel,
      'configuration:apparel-variant',
      false
    );
  exception when others then
    if sqlerrm = 'ECOMMERCE_CATALOG_SOURCE_CONFLICT' then
      v_conflict := true;
    else
      raise;
    end if;
  end;
  if not v_conflict then
    raise exception 'HIDDEN_APPAREL_CHANGE_NOT_BLOCKED';
  end if;

  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_apparel,
    'configuration:apparel-variant',
    true
  );

  if not exists (
    select 1
    from public.ecommerce_published_product_variants v
    where v.published_product_id = v_published_id
      and v.source_variant_ref = 'sku:camisa-negra-m'
      and v.sku = 'CAMISA-NEGRA-M'
      and v.stock_snapshot = 3
      and v.deleted_at is null
  ) then
    raise exception 'APPAREL_VARIANT_CONFIGURATION_NOT_APPLIED';
  end if;

  -- Exact apparel retry is accepted without another base update.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,
    v_published_id,
    v_apparel,
    'configuration:apparel-variant-retry',
    false
  );

  -- Content revisions never replace the canonical source revision or the
  -- catalog/inventory revision fields.
  if (
    select metadata->>'ecommerce_configuration_source_revision' <> 'version:5'
      or source_revision <> 'version:5'
      or source_revision_kind <> 'version'
      or source_revision_order <> 5
      or source_payload_hash <> 'catalog-payload-v5'
    from public.ecommerce_published_products
    where id = v_published_id
  ) then
    raise exception 'CONTENT_REVISION_NOT_ISOLATED_FROM_CANONICAL_REVISION';
  end if;

  raise notice 'ECOM.CONFIGURATION.CONTENT_REVISION.COORDINATION passed: 10/10.';
end;
$test$;

rollback;

select
  (select count(*) from public.licenses where license_key = 'ECOM-CONTENT-REVISION-ROLLBACK') as synthetic_licenses,
  (select count(*) from public.ecommerce_portals where id = '24800000-0000-4000-8000-000000000002') as synthetic_portals,
  (select count(*) from public.pos_products where id = 'content-revision-product') as synthetic_products,
  (select count(*) from public.ecommerce_published_products where id = '24800000-0000-4000-8000-000000000003') as synthetic_published_products;
