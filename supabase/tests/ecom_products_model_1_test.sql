-- ECOM.PRODUCTS.MODEL.1 regression matrix.
-- All synthetic rows and any incidental side effects are rolled back.
begin;

do $test$
declare
  v_license_a uuid := '21000000-0000-4000-8000-000000000001';
  v_license_b uuid := '21000000-0000-4000-8000-000000000002';
  v_portal_a uuid := '21000000-0000-4000-8000-000000000003';
  v_portal_b uuid := '21000000-0000-4000-8000-000000000004';
  v_admin_device uuid := '21000000-0000-4000-8000-000000000005';
  v_staff_ok uuid := '21000000-0000-4000-8000-000000000006';
  v_staff_denied uuid := '21000000-0000-4000-8000-000000000007';
  v_staff_ok_device uuid := '21000000-0000-4000-8000-000000000008';
  v_staff_denied_device uuid := '21000000-0000-4000-8000-000000000009';
  v_pub_simple uuid := '21000000-0000-4000-8000-000000000010';
  v_pub_recipe uuid := '21000000-0000-4000-8000-000000000011';
  v_pub_variants uuid := '21000000-0000-4000-8000-000000000012';
  v_pub_other uuid := '21000000-0000-4000-8000-000000000013';
  v_result jsonb;
  v_catalog jsonb;
  v_before_orders bigint;
  v_before_sales bigint;
  v_before_inventory bigint;
  v_before_cash bigint;
  v_variant_count integer;
  v_group_count integer;
  v_option_count integer;
begin
  select count(*) into v_before_orders from public.ecommerce_orders;
  select count(*) into v_before_sales from public.pos_sales;
  select count(*) into v_before_inventory from public.pos_inventory_movements;
  select count(*) into v_before_cash from public.pos_cash_movements;

  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values
    (v_license_a, 'ECOM-MODEL-1-A-ROLLBACK', 'free', 'active', now() + interval '1 day',
      jsonb_build_object(
        'ecommerce_portal_enabled', true,
        'ecommerce_max_published_products', 10,
        'ecommerce_stock_visibility', false,
        'ecommerce_cloud_catalog_source', true
      )),
    (v_license_b, 'ECOM-MODEL-1-B-ROLLBACK', 'pro', 'active', now() + interval '1 day',
      jsonb_build_object(
        'ecommerce_portal_enabled', true,
        'ecommerce_max_published_products', -1,
        'ecommerce_stock_visibility', true,
        'ecommerce_cloud_catalog_source', true
      ));

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    v_admin_device, v_license_a, 'model-1-admin', 'model-1-admin-token', true, 'admin'
  );

  insert into public.license_staff_users(
    id, license_id, username, display_name, password_hash, permissions
  ) values
    (v_staff_ok, v_license_a, 'model_1_staff_ok', 'Model 1 staff allowed',
      extensions.crypt('fixture', extensions.gen_salt('bf')),
      '{"settings":true,"ecommerce":true}'::jsonb),
    (v_staff_denied, v_license_a, 'model_1_staff_denied', 'Model 1 staff denied',
      extensions.crypt('fixture', extensions.gen_salt('bf')),
      '{"settings":true,"ecommerce":false}'::jsonb);

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role, staff_user_id
  ) values
    (v_staff_ok_device, v_license_a, 'model-1-staff-ok', 'model-1-staff-ok-token', true, 'staff', v_staff_ok),
    (v_staff_denied_device, v_license_a, 'model-1-staff-denied', 'model-1-staff-denied-token', true, 'staff', v_staff_denied);

  insert into public.license_staff_sessions(
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values
    (v_license_a, v_staff_ok, v_staff_ok_device,
      extensions.crypt('model-1-session-ok', extensions.gen_salt('bf')), now() + interval '1 hour'),
    (v_license_a, v_staff_denied, v_staff_denied_device,
      extensions.crypt('model-1-session-denied', extensions.gen_salt('bf')), now() + interval '1 hour');

  insert into public.ecommerce_portals(id, license_id, slug, status, name, ordering_enabled, pickup_enabled)
  values
    (v_portal_a, v_license_a, 'model-1-free-rollback', 'published', 'Model 1 Free', true, true),
    (v_portal_b, v_license_b, 'model-1-pro-rollback', 'published', 'Model 1 Pro', true, true);

  insert into public.pos_products(
    id, license_id, name, name_key, price, stock, committed_stock,
    track_stock, is_active, product_type, sale_type, bulk_data,
    batch_management, expiration_mode, recipe, metadata
  ) values
    ('m1-pan', v_license_a, 'Pan', 'pan', 1, 20, 0, true, true, 'ingredient', 'unit',
      '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-carne', v_license_a, 'Carne', 'carne', 1, 1.5, 0, true, true, 'ingredient', 'bulk',
      '{"purchase":{"unit":"kg"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-queso', v_license_a, 'Queso', 'queso', 1, 12, 0, true, true, 'ingredient', 'unit',
      '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-agua', v_license_a, 'Agua', 'agua', 1, 2, 0, true, true, 'ingredient', 'bulk',
      '{"purchase":{"unit":"lt"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-untracked', v_license_a, 'Servilleta no controlada', 'servilleta-no-controlada', 0, 0, 0,
      false, true, 'ingredient', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-inactive', v_license_a, 'Ingrediente inactivo', 'ingrediente-inactivo', 0, 5, 0,
      true, false, 'ingredient', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-batch', v_license_a, 'Ingrediente por lote', 'ingrediente-por-lote', 0, 999, 0,
      true, true, 'ingredient', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":true}', 'STRICT', null, '{}'),
    ('m1-hamburguesa', v_license_a, 'Hamburguesa especial', 'hamburguesa-especial', 80, 0, 0,
      false, true, 'sellable', 'unit', null, '{"enabled":false}', 'NONE',
      '[{"ingredientId":"m1-pan","quantity":1,"unit":"pza"},{"ingredientId":"m1-carne","quantity":150,"unit":"g"},{"ingredientId":"m1-queso","quantity":1,"unit":"pza"}]', '{}'),
    ('m1-urban-negro-25', v_license_a, 'Urban Negro 25', 'urban-negro-25', 900, 4, 0,
      true, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-urban-blanco-25', v_license_a, 'Urban Blanco 25', 'urban-blanco-25', 900, 3, 0,
      true, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}'),
    ('m1-cross-license', v_license_b, 'Cross license SKU', 'cross-license-sku', 100, 1, 0,
      true, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '{}');

  insert into public.pos_product_batches(
    id, license_id, product_id, stock, committed_stock, track_stock,
    is_active, status, expiry_date, cost, price
  ) values
    ('m1-batch-expired', v_license_a, 'm1-batch', 50, 0, true, true, 'active', current_date - 1, 0, 0),
    ('m1-batch-blocked', v_license_a, 'm1-batch', 40, 0, true, false, 'inactive', current_date + 5, 0, 0),
    ('m1-batch-valid', v_license_a, 'm1-batch', 12, 2, true, true, 'active', current_date + 5, 0, 0),
    ('m1-batch-today', v_license_a, 'm1-batch', 2, 0, true, true, 'active', current_date, 0, 0);

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, product_id, local_product_ref, public_name, price,
    is_published, is_available, manual_available, source_available, source_state,
    track_stock, stock_mode, stock_snapshot
  ) values
    (v_pub_simple, v_portal_a, v_license_a, 'm1-pan', 'm1-pan', 'Pan publicado', 5,
      true, true, true, true, 'in_stock', true, 'hidden', 20),
    (v_pub_recipe, v_portal_a, v_license_a, 'm1-hamburguesa', 'm1-hamburguesa', 'Hamburguesa publicada', 80,
      true, true, true, true, 'in_stock', true, 'hidden', 10),
    (v_pub_variants, v_portal_a, v_license_a, null, 'm1-urban-family', 'Tenis Urban', 900,
      true, true, true, true, 'in_stock', true, 'hidden', 7),
    (v_pub_other, v_portal_b, v_license_b, 'm1-cross-license', 'm1-cross-license', 'Otro producto', 100,
      true, true, true, true, 'in_stock', true, 'exact', 1);

  if (select configuration_type from public.ecommerce_published_products where id=v_pub_simple) <> 'simple'
     or (select configuration_version from public.ecommerce_published_products where id=v_pub_simple) <> 1
     or (select stock_snapshot from public.ecommerce_published_products where id=v_pub_simple) <> 20 then
    raise exception 'TEST_01_02_SIMPLE_COMPATIBILITY_FAILED';
  end if;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-pan","quantity":1,"unit":"pza"},{"ingredientId":"m1-carne","quantity":150,"unit":"g"},{"ingredientId":"m1-queso","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'status' <> 'in_stock'
     or (v_result->>'availableStock')::integer <> 10
     or v_result->>'limitingIngredientId' <> 'm1-carne' then
    raise exception 'TEST_03_RECIPE_MINIMUM_FAILED: %', v_result;
  end if;

  update public.pos_products set stock=0 where id='m1-pan' and license_id=v_license_a;
  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-pan","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'status' <> 'out_of_stock' or (v_result->>'availableStock')::integer <> 0 then
    raise exception 'TEST_04_ZERO_FAILED: %', v_result;
  end if;
  update public.pos_products set stock=20 where id='m1-pan' and license_id=v_license_a;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-missing","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'status' <> 'unverified' or v_result->>'reasonCode' <> 'RECIPE_INGREDIENT_MISSING' then
    raise exception 'TEST_05_MISSING_FAILED: %', v_result;
  end if;
  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-inactive","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'status' <> 'unverified' or v_result->>'reasonCode' <> 'RECIPE_INGREDIENT_INACTIVE' then
    raise exception 'TEST_06_INACTIVE_FAILED: %', v_result;
  end if;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-carne","quantity":150,"unit":"g"}]', current_date);
  if (v_result->>'availableStock')::integer <> 10 then raise exception 'TEST_07_KG_G_FAILED: %', v_result; end if;
  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-agua","quantity":250,"unit":"ml"}]', current_date);
  if (v_result->>'availableStock')::integer <> 8 then raise exception 'TEST_08_LT_ML_FAILED: %', v_result; end if;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-carne","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'reasonCode' <> 'RECIPE_UNIT_INCOMPATIBLE' then
    raise exception 'TEST_09_INCOMPATIBLE_FAILED: %', v_result;
  end if;

  update public.pos_products set committed_stock=0.3 where id='m1-carne' and license_id=v_license_a;
  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-carne","quantity":150,"unit":"g"}]', current_date);
  if (v_result->>'availableStock')::integer <> 8 then raise exception 'TEST_10_COMMITTED_FAILED: %', v_result; end if;
  update public.pos_products set committed_stock=0 where id='m1-carne' and license_id=v_license_a;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-batch","quantity":2,"unit":"pza"}]', current_date);
  if (v_result->>'availableStock')::integer <> 6 then
    raise exception 'TEST_11_13_BATCH_POLICY_FAILED: %', v_result;
  end if;

  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-untracked","quantity":1,"unit":"pza"},{"ingredientId":"m1-pan","quantity":2,"unit":"pza"}]', current_date);
  if (v_result->>'availableStock')::integer <> 10 then raise exception 'TEST_14_UNTRACKED_LIMIT_FAILED: %', v_result; end if;
  v_result := private.ecommerce_recipe_capacity(v_license_a,
    '[{"ingredientId":"m1-untracked","quantity":1,"unit":"pza"}]', current_date);
  if v_result->>'status' <> 'not_tracked' or v_result->'availableStock' <> 'null'::jsonb then
    raise exception 'TEST_15_ALL_UNTRACKED_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_variants,
    jsonb_build_object(
      'type','variant_parent','version',1,'hasRecipe',false,
      'availabilitySource','variant_aggregate','availabilityReasonCode','VARIANT_AGGREGATE_READY',
      'variants',jsonb_build_array(
        jsonb_build_object('sourceVariantRef','urban-negro-25','sourceProductId','m1-urban-negro-25','sku','URBAN-NEGRO-25','publicName','Negro / 25','optionValues',jsonb_build_object('color','Negro','talla','25'),'stockSnapshot',4),
        jsonb_build_object('sourceVariantRef','urban-blanco-25','sourceProductId','m1-urban-blanco-25','sku','URBAN-BLANCO-25','publicName','Blanco / 25','optionValues',jsonb_build_object('color','Blanco','talla','25'),'stockSnapshot',3)
      ),
      'optionGroups',jsonb_build_array(
        jsonb_build_object('sourceGroupRef','extras','publicName','Extras','selectionType','multiple','required',false,'minSelect',0,'maxSelect',3,'options',jsonb_build_array(
          jsonb_build_object('sourceOptionRef','queso-extra','publicName','Queso extra','priceDelta',15,'tracksInventory',true,'sourceIngredientId','m1-queso','ingredientQuantity',1,'ingredientUnit','pza')
        ))
      )
    ),'version:1');
  if coalesce((v_result->>'success')::boolean,false) is not true then
    raise exception 'TEST_16_18_CONFIGURATION_VALID_FAILED: %', v_result;
  end if;
  select count(*) into v_variant_count from public.ecommerce_published_product_variants where published_product_id=v_pub_variants and deleted_at is null;
  select count(*) into v_group_count from public.ecommerce_published_option_groups where published_product_id=v_pub_variants and deleted_at is null;
  select count(*) into v_option_count from public.ecommerce_published_options where published_product_id=v_pub_variants and deleted_at is null;
  if v_variant_count<>2 or v_group_count<>1 or v_option_count<>1
     or (select is_available from public.ecommerce_published_products where id=v_pub_variants) is true
     or (select availability_reason_code from public.ecommerce_published_products where id=v_pub_variants) <> 'CONFIGURATION_REQUIRED' then
    raise exception 'TEST_16_18_24_CONFIGURATION_COUNTS_OR_GUARD_FAILED';
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_variants,
    jsonb_build_object('type','variant_parent','version',1,'hasRecipe',false,
      'variants',jsonb_build_array(jsonb_build_object('sourceVariantRef','cross','sourceProductId','m1-cross-license','sku','CROSS','publicName','Cross','optionValues',jsonb_build_object('color','X'))),
      'optionGroups','[]'::jsonb), 'version:2');
  if v_result->>'code' <> 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pub_variants and deleted_at is null) <> 2 then
    raise exception 'TEST_17_CROSS_LICENSE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_recipe,
    jsonb_build_object('type','configurable','version',1,'hasRecipe',true,'variants','[]'::jsonb,
      'optionGroups',jsonb_build_array(jsonb_build_object('sourceGroupRef','bad-single','publicName','Bad','selectionType','single','required',false,'minSelect',0,'maxSelect',2,'options','[]'::jsonb))), 'bad-single');
  if coalesce(v_result->>'success','false')::boolean is true then raise exception 'TEST_19_SINGLE_MAX_FAILED'; end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_recipe,
    jsonb_build_object('type','configurable','version',1,'hasRecipe',true,'variants','[]'::jsonb,
      'optionGroups',jsonb_build_array(jsonb_build_object('sourceGroupRef','bad-option','publicName','Bad option','selectionType','multiple','required',false,'minSelect',0,'maxSelect',2,
        'options',jsonb_build_array(jsonb_build_object('sourceOptionRef','zero','publicName','Zero','priceDelta',0,'tracksInventory',true,'sourceIngredientId','m1-queso','ingredientQuantity',0,'ingredientUnit','pza'))))), 'bad-option');
  if coalesce(v_result->>'success','false')::boolean is true then raise exception 'TEST_20_OPTION_ZERO_FAILED'; end if;

  if exists(select 1 from public.ecommerce_published_product_variants where published_product_id=v_pub_recipe and deleted_at is null) then
    raise exception 'TEST_21_PRECONDITION_FAILED';
  end if;
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_recipe,
    jsonb_build_object('type','configurable','version',1,'hasRecipe',true,
      'variants',jsonb_build_array(jsonb_build_object('sourceVariantRef','temp','sourceProductId','m1-urban-negro-25','sku','TEMP','publicName','Temp','optionValues',jsonb_build_object('x','1'))),
      'optionGroups',jsonb_build_array(jsonb_build_object('sourceGroupRef','invalid','publicName','Invalid','selectionType','single','required',true,'minSelect',0,'maxSelect',1,'options','[]'::jsonb))), 'atomic-fail');
  if coalesce(v_result->>'success','false')::boolean is true
     or exists(select 1 from public.ecommerce_published_product_variants where published_product_id=v_pub_recipe and deleted_at is null) then
    raise exception 'TEST_21_ATOMIC_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_variants,
    jsonb_build_object('type','variant_parent','version',1,'hasRecipe',false,
      'variants',jsonb_build_array(jsonb_build_object('sourceVariantRef','urban-negro-25','sourceProductId','m1-urban-negro-25','sku','URBAN-NEGRO-25','publicName','Negro / 25','optionValues',jsonb_build_object('color','Negro','talla','25'))),
      'optionGroups','[]'::jsonb), 'version:3');
  if coalesce((v_result->>'success')::boolean,false) is not true
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pub_variants and deleted_at is null) <> 1
     or exists(select 1 from public.ecommerce_published_product_variants where published_product_id<>v_pub_variants and deleted_at is not null) then
    raise exception 'TEST_22_OMITTED_CHILD_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null,v_pub_simple,
    jsonb_build_object('type','simple','version',1,'hasRecipe',false,'availabilitySource','direct','variants','[]'::jsonb,'optionGroups','[]'::jsonb), 'simple:1');
  if coalesce((v_result->>'success')::boolean,false) is not true
     or exists(select 1 from public.ecommerce_published_product_variants where published_product_id=v_pub_simple and deleted_at is null)
     or exists(select 1 from public.ecommerce_published_option_groups where published_product_id=v_pub_simple and deleted_at is null)
     or (select configuration_type from public.ecommerce_published_products where id=v_pub_simple) <> 'simple' then
    raise exception 'TEST_23_SIMPLE_CHILDREN_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-staff-ok','model-1-staff-ok-token','model-1-session-ok',v_pub_recipe,
    jsonb_build_object('type','recipe','version',1,'hasRecipe',true,'availabilitySource','recipe','availabilityReasonCode','RECIPE_CAPACITY_CALCULATED','limitingSource',jsonb_build_object('productId','m1-carne','name','Carne'),'variants','[]'::jsonb,'optionGroups','[]'::jsonb), 'recipe:1');
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'TEST_25_STAFF_ALLOWED_FAILED: %', v_result; end if;

  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-staff-denied','model-1-staff-denied-token','model-1-session-denied',v_pub_recipe,
    jsonb_build_object('type','recipe','version',1,'hasRecipe',true,'variants','[]'::jsonb,'optionGroups','[]'::jsonb), 'recipe:2');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED' then raise exception 'TEST_26_STAFF_DENIED_FAILED: %', v_result; end if;

  v_result := public.ecommerce_admin_list_published_products(
    'ECOM-MODEL-1-A-ROLLBACK','model-1-admin','model-1-admin-token',null);
  if coalesce((v_result->>'success')::boolean,false) is not true
     or not exists (
       select 1
       from jsonb_array_elements(v_result->'products') p
       where p->>'id' = v_pub_variants::text
         and p ? 'configurationType'
         and p ? 'variantCount'
     ) then
    raise exception 'TEST_ADMIN_CONTRACT_FAILED: %', v_result;
  end if;

  v_catalog := public.ecommerce_get_catalog('model-1-free-rollback',100,0);
  if coalesce((v_catalog->>'success')::boolean,false) is not true
     or (v_catalog::text like '%m1-carne%')
     or (v_catalog::text like '%sourceProductId%')
     or not (v_catalog::text like '%"configuration"%')
     or not (v_catalog::text like '%"mode": "hidden"%' or v_catalog::text like '%"mode":"hidden"%') then
    raise exception 'TEST_27_28_PUBLIC_FREE_FAILED: %', v_catalog;
  end if;
  v_catalog := public.ecommerce_get_catalog('model-1-pro-rollback',100,0);
  if coalesce((v_catalog->>'success')::boolean,false) is not true
     or not (v_catalog::text like '%"mode": "exact"%' or v_catalog::text like '%"mode":"exact"%') then
    raise exception 'TEST_29_PUBLIC_PRO_FAILED: %', v_catalog;
  end if;

  if (select count(*) from public.ecommerce_orders) <> v_before_orders
     or (select count(*) from public.pos_sales) <> v_before_sales
     or (select count(*) from public.pos_inventory_movements) <> v_before_inventory
     or (select count(*) from public.pos_cash_movements) <> v_before_cash then
    raise exception 'TEST_30_OPERATIONAL_SIDE_EFFECT_FAILED';
  end if;

  raise notice 'ECOM.PRODUCTS.MODEL.1 SQL matrix passed: 30/30.';
end;
$test$;

rollback;

select
  (select count(*) from public.licenses where license_key like 'ECOM-MODEL-1-%-ROLLBACK') as synthetic_licenses,
  (select count(*) from public.ecommerce_portals where id in ('21000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000004')) as synthetic_portals,
  (select count(*) from public.pos_products where id like 'm1-%') as synthetic_products,
  (select count(*) from public.ecommerce_published_products where id in (
    '21000000-0000-4000-8000-000000000010','21000000-0000-4000-8000-000000000011',
    '21000000-0000-4000-8000-000000000012','21000000-0000-4000-8000-000000000013'
  )) as synthetic_published_products,
  (select count(*) from public.ecommerce_published_product_variants where metadata->>'fixture'='ECOM.PRODUCTS.MODEL.1') as synthetic_variants,
  (select count(*) from public.ecommerce_published_option_groups where metadata->>'fixture'='ECOM.PRODUCTS.MODEL.1') as synthetic_groups,
  (select count(*) from public.ecommerce_published_options where metadata->>'fixture'='ECOM.PRODUCTS.MODEL.1') as synthetic_options,
  (select count(*) from public.ecommerce_orders where metadata->>'fixture'='ECOM.PRODUCTS.MODEL.1') as synthetic_orders;
