-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1 checkout closure matrix.
-- This is deliberately a real-RPC test: all fixtures live inside one transaction
-- and are discarded by ROLLBACK. It never changes business data.

begin;

select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);

do $checkout$
declare
  v_license uuid := '31000000-0000-4000-8000-000000000001';
  v_portal uuid := '31000000-0000-4000-8000-000000000002';
  v_device uuid := '31000000-0000-4000-8000-000000000003';
  v_standard uuid;
  v_configurable uuid;
  v_incompatible uuid;
  v_cross_license uuid := '31000000-0000-4000-8000-000000000004';
  v_cross_portal uuid := '31000000-0000-4000-8000-000000000005';
  v_cross_product uuid := '31000000-0000-4000-8000-000000000006';
  v_variant_plus uuid;
  v_variant_minus uuid;
  v_variant_absolute_high uuid;
  v_variant_absolute_low uuid;
  v_variant_clamp uuid;
  v_group uuid;
  v_option_plus uuid;
  v_option_minus uuid;
  v_result jsonb;
  v_order jsonb;
  v_replay jsonb;
  v_configuration jsonb;
  v_revision text;
  v_stale_revision text;
  v_order_id uuid;
  v_snapshot jsonb;
  v_sales bigint;
  v_cash bigint;
  v_inventory bigint;
  v_source_modifiers jsonb;
begin
  select count(*) into v_sales from public.pos_sales;
  select count(*) into v_cash from public.pos_cash_movements;
  select count(*) into v_inventory from public.pos_inventory_movements;

  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (
    v_license, 'ECOM-WS-CHECKOUT-ROLLBACK', 'pro', 'active',
    clock_timestamp() + interval '1 day',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_order_inbox', true,
      'ecommerce_cloud_catalog_source', true,
      'ecommerce_max_published_products', -1,
      'ecommerce_max_open_orders_per_day', 100,
      'ecommerce_stock_visibility', true
    )
  );

  insert into public.business_profiles(license_id, business_name, business_type)
  values (v_license, 'ECOM wholesale checkout rollback', array['abarrotes']::public.business_category[]);

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    v_device, v_license, 'ecom-ws-checkout-device', 'ecom-ws-checkout-token', true, 'admin'
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled, business_hours_enabled
  ) values (
    v_portal, v_license, 'ecom-ws-checkout-rollback', 'published',
    'ECOM wholesale checkout rollback', true, true, false
  );

  insert into public.pos_products(
    id, license_id, name, name_key, price, cost, stock, committed_stock, track_stock, server_version,
    is_active, product_type, sale_type, bulk_data, batch_management, expiration_mode,
    recipe, modifiers, metadata
  ) values
    ('ecom-ws-close-standard', v_license, 'Base mayoreo', 'ecom-ws-close-standard', 100, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-config', v_license, 'Configurable mayoreo', 'ecom-ws-close-config', 100, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-plus', v_license, 'Variante plus', 'ecom-ws-close-plus', 120, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-minus', v_license, 'Variante minus', 'ecom-ws-close-minus', 85, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-absolute-high', v_license, 'Variante absoluta alta', 'ecom-ws-close-absolute-high', 120, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-absolute-low', v_license, 'Variante absoluta baja', 'ecom-ws-close-absolute-low', 90, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-clamp', v_license, 'Variante clamp', 'ecom-ws-close-clamp', 85, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('ecom-ws-close-incompatible', v_license, 'Configuracion heredada', 'ecom-ws-close-incompatible', 50, 0, 100, 0, false, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null,
      '[{"id":"legacy-extras","name":"Extras heredados","options":[{"id":"legacy-option","name":"Salsa","price":5}]}]', '{}');

  -- The v3 writer is used for the public parent and normalized tiers.
  v_result := public.ecommerce_admin_upsert_published_product_v3(
    'ECOM-WS-CHECKOUT-ROLLBACK', 'ecom-ws-checkout-device', 'ecom-ws-checkout-token', null,
    '{
      "sourceType":"local_snapshot", "localProductRef":"ecom-ws-close-standard",
      "publicName":"Base mayoreo", "price":100, "manualAvailable":true,
      "isAvailable":true, "isPublished":true, "stockMode":"hidden",
      "syncConfig":{"name":"manual","description":"manual","category":"manual","price":"manual","image":"manual"},
      "metadata":{"fixture":"checkout"},
      "configuration":{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"not_tracked","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}},
      "configurationSourceRevision":"version:1",
      "wholesaleEnabled":true,
      "wholesaleTiers":[
        {"sourceTierRef":"six","minQuantity":6,"unitPrice":80,"displayOrder":0,"sourceAvailable":true},
        {"sourceTierRef":"twelve","minQuantity":12,"unitPrice":70,"displayOrder":1,"sourceAvailable":true},
        {"sourceTierRef":"twenty","minQuantity":20,"unitPrice":20,"displayOrder":2,"sourceAvailable":true}
      ]
    }'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'V3_STANDARD_UPSERT_FAILED: %', v_result;
  end if;
  v_standard := (v_result #>> '{product,id}')::uuid;

  v_result := public.ecommerce_admin_upsert_published_product_v3(
    'ECOM-WS-CHECKOUT-ROLLBACK', 'ecom-ws-checkout-device', 'ecom-ws-checkout-token', null,
    '{
      "sourceType":"local_snapshot", "localProductRef":"ecom-ws-close-config",
      "publicName":"Configurable mayoreo", "price":100, "manualAvailable":true,
      "isAvailable":true, "isPublished":true, "stockMode":"hidden",
      "syncConfig":{"name":"manual","description":"manual","category":"manual","price":"manual","image":"manual"},
      "metadata":{"fixture":"checkout"},
      "configuration":{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"not_tracked","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}},
      "configurationSourceRevision":"version:1",
      "wholesaleEnabled":true,
      "wholesaleTiers":[
        {"sourceTierRef":"six","minQuantity":6,"unitPrice":80,"displayOrder":0,"sourceAvailable":true},
        {"sourceTierRef":"twelve","minQuantity":12,"unitPrice":70,"displayOrder":1,"sourceAvailable":true},
        {"sourceTierRef":"twenty","minQuantity":20,"unitPrice":20,"displayOrder":2,"sourceAvailable":true}
      ]
    }'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'V3_CONFIG_UPSERT_FAILED: %', v_result;
  end if;
  v_configurable := (v_result #>> '{product,id}')::uuid;

  -- Configure signed delta/absolute variants and option adjustments through the
  -- canonical configuration writer, then calculate prices through public checkout.
  update public.pos_products set server_version=2
  where license_id=v_license and id='ecom-ws-close-config';

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-WS-CHECKOUT-ROLLBACK', 'ecom-ws-checkout-device', 'ecom-ws-checkout-token', null,
    v_configurable,
    '{
      "type":"variant_parent", "version":1, "hasRecipe":false,
      "variants":[
        {"sourceVariantRef":"delta-plus","sourceProductId":"ecom-ws-close-plus","localProductRef":"ecom-ws-close-plus","publicName":"Delta +20","optionValues":{"variant":"delta-plus"},"priceMode":"delta","priceValue":20,"trackStock":false,"stockMode":"hidden","stockSnapshot":null,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"metadata":{}},
        {"sourceVariantRef":"delta-minus","sourceProductId":"ecom-ws-close-minus","localProductRef":"ecom-ws-close-minus","publicName":"Delta -15","optionValues":{"variant":"delta-minus"},"priceMode":"delta","priceValue":-15,"trackStock":false,"stockMode":"hidden","stockSnapshot":null,"sourceAvailable":true,"manualAvailable":true,"displayOrder":1,"metadata":{}},
        {"sourceVariantRef":"absolute-high","sourceProductId":"ecom-ws-close-absolute-high","localProductRef":"ecom-ws-close-absolute-high","publicName":"Absoluta 120","optionValues":{"variant":"absolute-high"},"priceMode":"absolute","priceValue":120,"trackStock":false,"stockMode":"hidden","stockSnapshot":null,"sourceAvailable":true,"manualAvailable":true,"displayOrder":2,"metadata":{}},
        {"sourceVariantRef":"absolute-low","sourceProductId":"ecom-ws-close-absolute-low","localProductRef":"ecom-ws-close-absolute-low","publicName":"Absoluta 90","optionValues":{"variant":"absolute-low"},"priceMode":"absolute","priceValue":90,"trackStock":false,"stockMode":"hidden","stockSnapshot":null,"sourceAvailable":true,"manualAvailable":true,"displayOrder":3,"metadata":{}},
        {"sourceVariantRef":"clamp","sourceProductId":"ecom-ws-close-clamp","localProductRef":"ecom-ws-close-clamp","publicName":"Clamp -15","optionValues":{"variant":"clamp"},"priceMode":"delta","priceValue":-15,"trackStock":false,"stockMode":"hidden","stockSnapshot":null,"sourceAvailable":true,"manualAvailable":true,"displayOrder":4,"metadata":{}}
      ],
      "optionGroups":[{
        "sourceGroupRef":"add-ons", "publicName":"Complementos", "selectionType":"multiple",
        "required":false, "minSelect":0, "maxSelect":2, "displayOrder":0,
        "options":[
          {"sourceOptionRef":"plus-five","publicName":"Extra +5","priceDelta":5,"sourceIngredientId":null,"ingredientQuantity":null,"ingredientUnit":null,"tracksInventory":false,"manualAvailable":true,"sourceAvailable":true,"displayOrder":0,"metadata":{}},
          {"sourceOptionRef":"minus-ten","publicName":"Descuento -10","priceDelta":-10,"sourceIngredientId":null,"ingredientQuantity":null,"ingredientUnit":null,"tracksInventory":false,"manualAvailable":true,"sourceAvailable":true,"displayOrder":1,"metadata":{}}
        ], "metadata":{}
      }],
      "availabilitySource":"variant_aggregate", "availabilityReasonCode":null,
      "limitingSource":{"productId":null,"name":null}
    }'::jsonb,
    'version:2'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'CONFIGURATION_SYNC_FAILED: %', v_result;
  end if;

  select id into v_variant_plus from public.ecommerce_published_product_variants
  where published_product_id=v_configurable and source_variant_ref='delta-plus' and deleted_at is null;
  select id into v_variant_minus from public.ecommerce_published_product_variants
  where published_product_id=v_configurable and source_variant_ref='delta-minus' and deleted_at is null;
  select id into v_variant_absolute_high from public.ecommerce_published_product_variants
  where published_product_id=v_configurable and source_variant_ref='absolute-high' and deleted_at is null;
  select id into v_variant_absolute_low from public.ecommerce_published_product_variants
  where published_product_id=v_configurable and source_variant_ref='absolute-low' and deleted_at is null;
  select id into v_variant_clamp from public.ecommerce_published_product_variants
  where published_product_id=v_configurable and source_variant_ref='clamp' and deleted_at is null;
  select id into v_group from public.ecommerce_published_option_groups
  where published_product_id=v_configurable and source_group_ref='add-ons' and deleted_at is null;
  select id into v_option_plus from public.ecommerce_published_options
  where published_product_id=v_configurable and source_option_ref='plus-five' and deleted_at is null;
  select id into v_option_minus from public.ecommerce_published_options
  where published_product_id=v_configurable and source_option_ref='minus-ten' and deleted_at is null;
  if v_variant_plus is null or v_variant_minus is null or v_variant_absolute_high is null
     or v_variant_absolute_low is null or v_variant_clamp is null or v_group is null
     or v_option_plus is null or v_option_minus is null then
    raise exception 'CONFIGURATION_CHILDREN_MISSING';
  end if;

  -- A-C: standard, exact tier, and greatest applicable tier.
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_standard,'quantity',1)),
    'checkout-standard'
  );
  if coalesce((v_result->>'success')::boolean,false) is not true
     or (v_result #>> '{order,total}')::numeric <> 100 then
    raise exception 'A_STANDARD_PRICE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_standard,'quantity',6)),
    'checkout-tier-six'
  );
  if coalesce((v_result->>'success')::boolean,false) is not true
     or (v_result #>> '{order,total}')::numeric <> 480 then
    raise exception 'B_EXACT_WHOLESALE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_standard,'quantity',13)),
    'checkout-tier-twelve'
  );
  if coalesce((v_result->>'success')::boolean,false) is not true
     or (v_result #>> '{order,total}')::numeric <> 910 then
    raise exception 'C_GREATEST_WHOLESALE_FAILED: %', v_result;
  end if;

  v_configuration := public.ecommerce_get_product_configuration('ecom-ws-checkout-rollback', v_configurable);
  v_revision := v_configuration #>> '{product,configurationRevision}';
  if v_revision !~ '^[0-9a-f]{64}$' then raise exception 'CONFIGURATION_REVISION_MISSING'; end if;

  -- D-H: wholesale base plus signed variant and option adjustments.
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_configurable,'quantity',6,'variantId',v_variant_plus,'selections','[]'::jsonb,'configurationVersion',1,'configurationRevision',v_revision)),
    'checkout-delta-plus'
  );
  if (v_result #>> '{order,total}')::numeric <> 600 then raise exception 'D_DELTA_PLUS_FAILED: %', v_result; end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_configurable,'quantity',6,'variantId',v_variant_minus,'selections','[]'::jsonb,'configurationVersion',1,'configurationRevision',v_revision)),
    'checkout-delta-minus'
  );
  if (v_result #>> '{order,total}')::numeric <> 390 then raise exception 'E_DELTA_MINUS_FAILED: %', v_result; end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_configurable,'quantity',6,'variantId',v_variant_absolute_high,'selections','[]'::jsonb,'configurationVersion',1,'configurationRevision',v_revision)),
    'checkout-absolute-high'
  );
  if (v_result #>> '{order,total}')::numeric <> 600 then raise exception 'F_ABSOLUTE_HIGH_FAILED: %', v_result; end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_configurable,'quantity',6,'variantId',v_variant_absolute_low,'selections','[]'::jsonb,'configurationVersion',1,'configurationRevision',v_revision)),
    'checkout-absolute-low'
  );
  if (v_result #>> '{order,total}')::numeric <> 420 then raise exception 'F_ABSOLUTE_LOW_FAILED: %', v_result; end if;

  v_order := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'productId',v_configurable,'quantity',6,'variantId',v_variant_plus,
      'selections',jsonb_build_array(jsonb_build_object('groupId',v_group,'optionIds',jsonb_build_array(v_option_plus))),
      'configurationVersion',1,'configurationRevision',v_revision,
      'price',1,'unitPrice',1,'basePrice',1,'variantPrice',1,'optionPrice',1,'total',1,'subtotal',1
    )),
    'checkout-authoritative-snapshot'
  );
  if coalesce((v_order->>'success')::boolean,false) is not true
     or (v_order #>> '{order,total}')::numeric <> 630 then
    raise exception 'G_I_AUTHORITATIVE_PRICE_FAILED: %', v_order;
  end if;
  v_order_id := (v_order #>> '{order,id}')::uuid;
  if (
    select options #>> '{pricing,pricingMode}' from public.ecommerce_order_items where order_id=v_order_id
  ) <> 'wholesale'
  or (
    select (options #>> '{pricing,wholesaleBaseUnitPrice}')::numeric from public.ecommerce_order_items where order_id=v_order_id
  ) <> 80
  or (
    select (options #>> '{pricing,variantAdjustment}')::numeric from public.ecommerce_order_items where order_id=v_order_id
  ) <> 20
  or (
    select (options #>> '{pricing,optionsAdjustment}')::numeric from public.ecommerce_order_items where order_id=v_order_id
  ) <> 5
  or (
    select unit_price from public.ecommerce_order_items where order_id=v_order_id
  ) <> 105
  or (
    select line_total from public.ecommerce_order_items where order_id=v_order_id
  ) <> 630 then
    raise exception 'N_SNAPSHOT_NOT_AUTHORITATIVE';
  end if;

  v_replay := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback', '{}'::jsonb, '[]'::jsonb, 'checkout-authoritative-snapshot'
  );
  if coalesce((v_replay->>'idempotent')::boolean,false) is not true
     or (v_replay #>> '{order,id}')::uuid <> v_order_id
     or (v_replay #>> '{order,total}')::numeric <> 630 then
    raise exception 'M_IDEMPOTENCY_FAILED: %', v_replay;
  end if;

  v_snapshot := private.ecommerce_order_pos_snapshot_v1(
    v_order_id, v_license, jsonb_build_object('actor_type','admin','device_id','ecom-ws-checkout-device')
  );
  if (v_snapshot #>> '{items,0,unitPrice}')::numeric <> 105
     or (v_snapshot #>> '{items,0,lineTotal}')::numeric <> 630 then
    raise exception 'O_POS_SNAPSHOT_PRICE_DIVERGED: %', v_snapshot;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'productId',v_configurable,'quantity',20,'variantId',v_variant_clamp,
      'selections',jsonb_build_array(jsonb_build_object('groupId',v_group,'optionIds',jsonb_build_array(v_option_minus))),
      'configurationVersion',1,'configurationRevision',v_revision
    )),
    'checkout-clamp'
  );
  if (v_result #>> '{order,total}')::numeric <> 0 then raise exception 'H_FINAL_PRICE_CLAMP_FAILED: %', v_result; end if;

  -- J: an unavailable tier is ignored; the standard price remains authoritative.
  update public.ecommerce_published_wholesale_tiers
  set manual_available=false
  where published_product_id=v_standard and source_tier_ref='six';
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_standard,'quantity',6)),
    'checkout-unavailable-tier'
  );
  if (v_result #>> '{order,total}')::numeric <> 600 then raise exception 'J_UNAVAILABLE_TIER_APPLIED: %', v_result; end if;
  update public.ecommerce_published_wholesale_tiers
  set manual_available=true
  where published_product_id=v_standard and source_tier_ref='six';

  -- K: a source restaurant modifier in a grocery profile remains stored, but the
  -- v3 publication is fail-closed and no old public group survives.
  v_result := public.ecommerce_admin_upsert_published_product_v3(
    'ECOM-WS-CHECKOUT-ROLLBACK', 'ecom-ws-checkout-device', 'ecom-ws-checkout-token', null,
    '{
      "sourceType":"local_snapshot", "localProductRef":"ecom-ws-close-incompatible",
      "publicName":"Configuracion heredada", "price":50, "manualAvailable":true,
      "isAvailable":true, "isPublished":true, "stockMode":"hidden",
      "syncConfig":{"name":"manual","description":"manual","category":"manual","price":"manual","image":"manual"},
      "metadata":{"fixture":"checkout"},
      "configuration":{"type":"configurable","version":1,"hasRecipe":false,"variants":[],"optionGroups":[{"sourceGroupRef":"legacy","publicName":"Extras","selectionType":"multiple","required":false,"minSelect":0,"maxSelect":1,"displayOrder":0,"options":[{"sourceOptionRef":"legacy-option","publicName":"Salsa","priceDelta":5,"manualAvailable":true,"sourceAvailable":true,"displayOrder":0,"metadata":{}}],"metadata":{}}],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}},
      "configurationSourceRevision":"version:1", "wholesaleEnabled":false, "wholesaleTiers":[]
    }'::jsonb
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'V3_INCOMPATIBLE_UPSERT_FAILED: %', v_result; end if;
  v_incompatible := (v_result #>> '{product,id}')::uuid;
  select modifiers into v_source_modifiers from public.pos_products where id='ecom-ws-close-incompatible' and license_id=v_license;
  if (select business_capability_status from public.ecommerce_published_products where id=v_incompatible) <> 'requires_review'
     or exists (select 1 from public.ecommerce_published_option_groups where published_product_id=v_incompatible and deleted_at is null)
     or jsonb_array_length(v_source_modifiers) <> 1 then
    raise exception 'K_INCOMPATIBLE_PUBLICATION_NOT_FAIL_CLOSED';
  end if;
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_incompatible,'quantity',1)),
    'checkout-incompatible'
  );
  if coalesce((v_result->>'success')::boolean,false) is true
     or v_result #>> '{error,code}' not in ('ECOMMERCE_PRODUCT_NOT_FOUND','ECOMMERCE_CONFIGURATION_CHANGED') then
    raise exception 'K_INCOMPATIBLE_CHECKOUT_ACCEPTED: %', v_result;
  end if;

  -- L: a previous configuration revision cannot be replayed after a material child change.
  v_stale_revision := v_revision;
  perform 1 from public.ecommerce_published_products where id=v_configurable for update;
  update public.ecommerce_published_options set price_delta=6 where id=v_option_plus;
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_configurable,'quantity',6,'variantId',v_variant_plus,'selections','[]'::jsonb,'configurationVersion',1,'configurationRevision',v_stale_revision)),
    'checkout-stale'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_CONFIGURATION_CHANGED' then raise exception 'L_STALE_CONFIGURATION_ACCEPTED: %', v_result; end if;

  -- Cross-license data cannot be ordered through this portal.
  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (v_cross_license, 'ECOM-WS-CROSS-ROLLBACK', 'free', 'active', clock_timestamp()+interval '1 day', '{"ecommerce_portal_enabled":true,"ecommerce_order_inbox":true,"ecommerce_max_published_products":10}'::jsonb);
  insert into public.business_profiles(license_id, business_name, business_type)
  values (v_cross_license, 'Cross rollback', array['abarrotes']::public.business_category[]);
  insert into public.ecommerce_portals(id, license_id, slug, status, name, ordering_enabled, pickup_enabled, business_hours_enabled)
  values (v_cross_portal, v_cross_license, 'ecom-ws-cross-rollback', 'published', 'Cross rollback', true, true, false);
  insert into public.ecommerce_published_products(
    id, portal_id, license_id, local_product_ref, public_name, price, is_published,
    manual_available, source_available, is_available, configuration_type, stock_mode, source_state
  ) values (v_cross_product, v_cross_portal, v_cross_license, 'ecom-ws-cross-product', 'Cross product', 10, true, true, true, true, 'simple', 'hidden', 'not_tracked');
  v_result := public.ecommerce_create_order(
    'ecom-ws-checkout-rollback',
    '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb,
    jsonb_build_array(jsonb_build_object('productId',v_cross_product,'quantity',1)),
    'checkout-cross-license'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_PRODUCT_NOT_FOUND' then raise exception 'CROSS_LICENSE_PRODUCT_ACCEPTED: %', v_result; end if;

  if (select count(*) from public.pos_sales) <> v_sales
     or (select count(*) from public.pos_cash_movements) <> v_cash
     or (select count(*) from public.pos_inventory_movements) <> v_inventory then
    raise exception 'CHECKOUT_CREATED_POS_FINANCIAL_SIDE_EFFECTS';
  end if;
end;
$checkout$;

select jsonb_build_object(
  'status', 'ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1 CHECKOUT SQL PASS',
  'standardAndWholesale', true,
  'signedVariantPricing', true,
  'optionsAndClamp', true,
  'clientPriceIgnored', true,
  'snapshotAndPosPrice', true,
  'incompatibleFailClosed', true,
  'staleRevisionBlocked', true,
  'crossLicenseBlocked', true,
  'posFinancialEffects', 0,
  'rolledBack', true
) as result;

rollback;
