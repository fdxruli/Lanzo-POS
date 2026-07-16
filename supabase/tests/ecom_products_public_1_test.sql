-- FASE ECOM.PRODUCTS.PUBLIC.1
-- Transactional matrix. All fixtures and orders are rolled back.
BEGIN;

DO $test$
DECLARE
  v_license uuid := '23000000-0000-4000-8000-000000000001';
  v_other_license uuid := '23000000-0000-4000-8000-000000000002';
  v_portal uuid := '23000000-0000-4000-8000-000000000003';
  v_other_portal uuid := '23000000-0000-4000-8000-000000000004';
  v_simple uuid := '23000000-0000-4000-8000-000000000005';
  v_parent uuid := '23000000-0000-4000-8000-000000000006';
  v_other_parent uuid := '23000000-0000-4000-8000-000000000007';
  v_variant_delta uuid := '23000000-0000-4000-8000-000000000008';
  v_variant_absolute uuid := '23000000-0000-4000-8000-000000000009';
  v_other_variant uuid := '23000000-0000-4000-8000-000000000010';
  v_group_extras uuid := '23000000-0000-4000-8000-000000000011';
  v_group_term uuid := '23000000-0000-4000-8000-000000000012';
  v_other_group uuid := '23000000-0000-4000-8000-000000000013';
  v_cheese uuid := '23000000-0000-4000-8000-000000000014';
  v_bacon uuid := '23000000-0000-4000-8000-000000000015';
  v_medium uuid := '23000000-0000-4000-8000-000000000016';
  v_other_option uuid := '23000000-0000-4000-8000-000000000017';
  v_result jsonb;
  v_order_id uuid;
  v_snapshot jsonb;
  v_sales_before bigint;
  v_inventory_before bigint;
  v_cash_before bigint;
BEGIN
  SELECT count(*) INTO v_sales_before FROM public.pos_sales;
  SELECT count(*) INTO v_inventory_before FROM public.pos_inventory_movements;
  SELECT count(*) INTO v_cash_before FROM public.pos_cash_movements;

  INSERT INTO public.licenses(id, license_key, license_type, status, expires_at, features)
  VALUES
  (v_license, 'ECOM-PUBLIC-1-ROLLBACK', 'free', 'active', clock_timestamp() + interval '1 day',
    jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', 10, 'ecommerce_max_open_orders_per_day', 100,
      'ecommerce_stock_visibility', false)),
  (v_other_license, 'ECOM-PUBLIC-1-OTHER-ROLLBACK', 'pro', 'active', clock_timestamp() + interval '1 day',
    jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', 1000, 'ecommerce_max_open_orders_per_day', 100,
      'ecommerce_stock_visibility', true));

  INSERT INTO public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled,
    delivery_enabled, min_order_total, max_order_items, max_item_quantity,
    stock_mode, business_hours_enabled, timezone
  ) VALUES
  (v_portal, v_license, 'ecom-public-1-test', 'published', 'Configurable test', true, true,
    true, 0, 30, 99, 'hidden', false, 'America/Mexico_City'),
  (v_other_portal, v_other_license, 'ecom-public-1-other', 'published', 'Other store', true,
    true, false, 0, 30, 99, 'exact', false, 'America/Mexico_City');

  INSERT INTO public.ecommerce_published_products(
    id, portal_id, license_id, public_name, price, currency, is_published,
    is_available, manual_available, source_available, source_state, track_stock,
    stock_mode, stock_snapshot, configuration_type, configuration_version,
    has_recipe, has_variants, has_option_groups, requires_configuration,
    availability_source
  ) VALUES
  (v_simple, v_portal, v_license, 'Simple legacy', 50, 'MXN', true, true, true, true,
    'not_tracked', false, 'hidden', null, 'simple', 1, false, false, false, false,
    'not_tracked'),
  (v_parent, v_portal, v_license, 'Hamburguesa configurable', 100, 'MXN', true,
    false, true, true, 'in_stock', true, 'hidden', null, 'variant_parent', 3,
    false, true, true, true, 'variant_aggregate'),
  (v_other_parent, v_other_portal, v_other_license, 'Producto ajeno', 200, 'MXN', true,
    false, true, true, 'in_stock', true, 'exact', null, 'variant_parent', 1,
    false, true, true, true, 'variant_aggregate');

  INSERT INTO public.ecommerce_published_product_variants(
    id, published_product_id, portal_id, license_id, source_variant_ref,
    local_product_ref, public_name, option_values, price_mode, price_value,
    track_stock, stock_mode, stock_snapshot, source_available, manual_available,
    is_available, display_order
  ) VALUES
  (v_variant_delta, v_parent, v_portal, v_license, 'variant-delta', 'local-delta',
    'Doble', '{"tamano":"Doble"}'::jsonb, 'delta', 20, true, 'exact', 2,
    true, true, true, 1),
  (v_variant_absolute, v_parent, v_portal, v_license, 'variant-absolute', 'local-absolute',
    'Triple', '{"tamano":"Triple"}'::jsonb, 'absolute', 180, true, 'exact', 4,
    true, true, true, 2),
  (v_other_variant, v_other_parent, v_other_portal, v_other_license, 'variant-other',
    'local-other', 'Ajena', '{"tamano":"Ajena"}'::jsonb, 'base', 0, true,
    'exact', 9, true, true, true, 1);

  INSERT INTO public.ecommerce_published_option_groups(
    id, published_product_id, portal_id, license_id, source_group_ref,
    public_name, selection_type, required, min_select, max_select, display_order
  ) VALUES
  (v_group_extras, v_parent, v_portal, v_license, 'group-extras', 'Extras',
    'multiple', true, 1, 2, 1),
  (v_group_term, v_parent, v_portal, v_license, 'group-term', 'Término',
    'single', false, 0, 1, 2),
  (v_other_group, v_other_parent, v_other_portal, v_other_license, 'group-other',
    'Ajeno', 'single', false, 0, 1, 1);

  INSERT INTO public.ecommerce_published_options(
    id, group_id, published_product_id, portal_id, license_id, source_option_ref,
    public_name, price_delta, tracks_inventory, manual_available, source_available,
    is_available, display_order
  ) VALUES
  (v_cheese, v_group_extras, v_parent, v_portal, v_license, 'option-cheese', 'Queso',
    15, false, true, true, true, 1),
  (v_bacon, v_group_extras, v_parent, v_portal, v_license, 'option-bacon', 'Tocino',
    25, false, true, true, true, 2),
  (v_medium, v_group_term, v_parent, v_portal, v_license, 'option-medium', 'Medio',
    0, false, true, true, true, 1),
  (v_other_option, v_other_group, v_other_parent, v_other_portal, v_other_license,
    'option-other', 'Ajena', 99, false, true, true, true, 1);

  -- 1-5: public detail and privacy.
  v_result := public.ecommerce_get_product_configuration('ecom-public-1-test', v_simple);
  IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'simple detail failed: %', v_result;
  END IF;
  v_result := public.ecommerce_get_product_configuration('ecom-public-1-test', v_parent);
  IF jsonb_array_length(v_result -> 'variants') <> 2
     OR jsonb_array_length(v_result -> 'groups') <> 2 THEN
    RAISE EXCEPTION 'configurable detail counts failed: %', v_result;
  END IF;
  IF v_result::text ~ '(source_product_id|source_ingredient_id|ingredient_quantity|local_product_ref|license_id)' THEN
    RAISE EXCEPTION 'private field leaked: %', v_result;
  END IF;
  IF v_result #>> '{variants,0,stock,mode}' <> 'hidden'
     OR v_result #>> '{variants,0,stock,quantity}' IS NOT NULL THEN
    RAISE EXCEPTION 'FREE exact stock leaked: %', v_result;
  END IF;

  -- 6-18: required groups, min/max, cross-tenant and inactive children.
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1)), 'missing-config');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_VARIANT_REQUIRED' THEN
    RAISE EXCEPTION 'variant required failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections','[]'::jsonb)), 'missing-group');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_OPTION_GROUP_REQUIRED' THEN
    RAISE EXCEPTION 'required group failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese,v_bacon,v_medium))
      ))), 'too-many');
  IF v_result #>> '{error,code}' NOT IN ('ECOMMERCE_OPTION_SELECTION_TOO_MANY','ECOMMERCE_OPTION_NOT_FOUND') THEN
    RAISE EXCEPTION 'max select failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_term,'optionIds',jsonb_build_array(v_medium,v_medium)),
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese))
      ))), 'single-two');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_OPTION_SELECTION_TOO_MANY' THEN
    RAISE EXCEPTION 'single max failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_other_variant,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese))
      ))), 'other-variant');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_VARIANT_NOT_FOUND' THEN
    RAISE EXCEPTION 'cross tenant variant failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_other_option))
      ))), 'other-option');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_OPTION_NOT_FOUND' THEN
    RAISE EXCEPTION 'cross tenant option failed: %', v_result;
  END IF;

  UPDATE public.ecommerce_published_product_variants SET is_available = false WHERE id = v_variant_delta;
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese))
      ))), 'inactive-variant');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_VARIANT_UNAVAILABLE' THEN
    RAISE EXCEPTION 'inactive variant failed: %', v_result;
  END IF;
  UPDATE public.ecommerce_published_product_variants SET is_available = true WHERE id = v_variant_delta;

  UPDATE public.ecommerce_published_options SET is_available = false WHERE id = v_cheese;
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_delta,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese))
      ))), 'inactive-option');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_OPTION_UNAVAILABLE' THEN
    RAISE EXCEPTION 'inactive option failed: %', v_result;
  END IF;
  UPDATE public.ecommerce_published_options SET is_available = true WHERE id = v_cheese;

  -- 19-27: simple compatibility, server pricing and immutable snapshot.
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_simple,'quantity',2,
      'basePrice',1,'unitPrice',1,'total',2,'subtotal',2)), 'simple-valid');
  IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE
     OR (v_result #>> '{order,total}')::numeric <> 100 THEN
    RAISE EXCEPTION 'simple server price failed: %', v_result;
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup','notes','Sin cebolla'),
    jsonb_build_array(
      jsonb_build_object('productId',v_parent,'quantity',1,'variantId',v_variant_delta,
        'configurationVersion',3,'basePrice',1,'variantPrice',1,'optionPrice',1,'total',1,
        'selections',jsonb_build_array(
          jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese)),
          jsonb_build_object('groupId',v_group_term,'optionIds',jsonb_build_array(v_medium))
        )),
      jsonb_build_object('productId',v_parent,'quantity',1,'variantId',v_variant_delta,
        'selections',jsonb_build_array(
          jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_bacon))
        ))
    ), 'configured-valid');
  IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE
     OR (v_result #>> '{order,total}')::numeric <> 280 THEN
    RAISE EXCEPTION 'configured server price failed: %', v_result;
  END IF;
  v_order_id := (v_result #>> '{order,id}')::uuid;
  IF (SELECT count(*) FROM public.ecommerce_order_items WHERE order_id = v_order_id) <> 2 THEN
    RAISE EXCEPTION 'different configurations not stored independently';
  END IF;
  SELECT options INTO v_snapshot
  FROM public.ecommerce_order_items WHERE order_id = v_order_id ORDER BY unit_price LIMIT 1;
  IF v_snapshot #>> '{variant,name}' <> 'Doble'
     OR v_snapshot #>> '{groups,0,options,0,name}' <> 'Queso'
     OR (v_snapshot #>> '{pricing,finalUnitPrice}')::numeric <> 135 THEN
    RAISE EXCEPTION 'configuration snapshot failed: %', v_snapshot;
  END IF;
  IF v_snapshot::text ~ '(source_ingredient_id|ingredient_quantity|local_product_ref|source_product_id)' THEN
    RAISE EXCEPTION 'snapshot private data leaked: %', v_snapshot;
  END IF;
  IF position('Variante: Doble' IN coalesce(v_result #>> '{whatsapp,message}', '')) = 0
     OR position('Extras: Queso' IN coalesce(v_result #>> '{whatsapp,message}', '')) = 0
     OR position('Indicaciones: Sin cebolla' IN coalesce(v_result #>> '{whatsapp,message}', '')) = 0 THEN
    RAISE EXCEPTION 'WhatsApp configuration failed: %', v_result #>> '{whatsapp,message}';
  END IF;

  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_parent,'quantity',1,
      'variantId',v_variant_absolute,'selections',jsonb_build_array(
        jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese))
      ))), 'absolute-valid');
  IF (v_result #>> '{order,total}')::numeric <> 195 THEN
    RAISE EXCEPTION 'absolute variant pricing failed: %', v_result;
  END IF;

  -- 28-33: aggregated stock and not_tracked.
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(
      jsonb_build_object('productId',v_parent,'quantity',1,'variantId',v_variant_delta,
        'selections',jsonb_build_array(jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_cheese)))),
      jsonb_build_object('productId',v_parent,'quantity',2,'variantId',v_variant_delta,
        'selections',jsonb_build_array(jsonb_build_object('groupId',v_group_extras,'optionIds',jsonb_build_array(v_bacon))))
    ), 'aggregate-stock');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_INSUFFICIENT_STOCK' THEN
    RAISE EXCEPTION 'same variant aggregate stock failed: %', v_result;
  END IF;

  -- 34-39: replay precedes mutable validation and preserves the original order.
  UPDATE public.ecommerce_published_product_variants SET is_available = false WHERE id = v_variant_delta;
  UPDATE public.ecommerce_published_options SET is_available = false WHERE id = v_cheese;
  UPDATE public.ecommerce_published_products SET price = 999 WHERE id = v_parent;
  UPDATE public.ecommerce_portals SET ordering_enabled = false WHERE id = v_portal;
  v_result := public.ecommerce_create_order('ecom-public-1-test', '{}'::jsonb, '[]'::jsonb,
    'configured-valid');
  IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_result ->> 'idempotent')::boolean, false) IS NOT TRUE
     OR (v_result #>> '{order,id}')::uuid <> v_order_id
     OR (v_result #>> '{order,total}')::numeric <> 280 THEN
    RAISE EXCEPTION 'idempotent replay order failed: %', v_result;
  END IF;

  UPDATE public.ecommerce_portals SET ordering_enabled = true WHERE id = v_portal;
  UPDATE public.ecommerce_published_products SET price = 100 WHERE id = v_parent;
  UPDATE public.ecommerce_published_product_variants SET is_available = true WHERE id = v_variant_delta;
  UPDATE public.ecommerce_published_options SET is_available = true WHERE id = v_cheese;

  -- 40-45: delivery/pickup/minimum and plan visibility.
  v_result := public.ecommerce_create_order('ecom-public-1-test',
    jsonb_build_object('name','Cliente','phone','9610000000','fulfillmentMethod','delivery','address','x'),
    jsonb_build_array(jsonb_build_object('productId',v_simple,'quantity',1)), 'bad-delivery');
  IF v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_ADDRESS_REQUIRED' THEN
    RAISE EXCEPTION 'delivery validation failed: %', v_result;
  END IF;
  v_result := public.ecommerce_get_product_configuration('ecom-public-1-other', v_other_parent);
  IF v_result #>> '{variants,0,stock,mode}' <> 'exact'
     OR (v_result #>> '{variants,0,stock,quantity}')::integer <> 9 THEN
    RAISE EXCEPTION 'PRO stock visibility failed: %', v_result;
  END IF;

  -- 46-50: no POS side effects. Rollback removes every synthetic fixture.
  IF (SELECT count(*) FROM public.pos_sales) <> v_sales_before THEN
    RAISE EXCEPTION 'unexpected POS sale';
  END IF;
  IF (SELECT count(*) FROM public.pos_inventory_movements) <> v_inventory_before THEN
    RAISE EXCEPTION 'unexpected inventory movement';
  END IF;
  IF (SELECT count(*) FROM public.pos_cash_movements) <> v_cash_before THEN
    RAISE EXCEPTION 'unexpected cash movement';
  END IF;
END;
$test$;

ROLLBACK;
