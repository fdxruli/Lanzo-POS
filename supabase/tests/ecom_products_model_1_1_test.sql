-- ECOM.PRODUCTS.MODEL.1.1 corrective regression matrix.
-- Execute as one transaction; all fixtures and effects are rolled back.
begin;

do $test$
declare
  v_license_free uuid := '23000000-0000-4000-8000-000000000001';
  v_license_pro uuid := '23000000-0000-4000-8000-000000000002';
  v_portal_free uuid := '23000000-0000-4000-8000-000000000003';
  v_portal_pro uuid := '23000000-0000-4000-8000-000000000004';
  v_device_free uuid := '23000000-0000-4000-8000-000000000005';
  v_device_pro uuid := '23000000-0000-4000-8000-000000000006';
  v_staff_allowed uuid := '23000000-0000-4000-8000-000000000007';
  v_staff_denied uuid := '23000000-0000-4000-8000-000000000008';
  v_staff_allowed_device uuid := '23000000-0000-4000-8000-000000000009';
  v_staff_denied_device uuid := '23000000-0000-4000-8000-00000000000a';
  v_pub_reversible uuid := '23000000-0000-4000-8000-000000000010';
  v_pub_cloud uuid := '23000000-0000-4000-8000-000000000011';
  v_manual_id uuid;
  v_result jsonb;
  v_config jsonb;
  v_cloud_projection jsonb;
  v_before_orders bigint;
  v_before_sales bigint;
  v_before_cash bigint;
  v_before_inventory bigint;
  v_before_variants integer;
  v_before_groups integer;
  v_before_options integer;
  v_revision bigint;
  v_test_count integer := 0;
begin
  select count(*) into v_before_orders from public.ecommerce_orders;
  select count(*) into v_before_sales from public.pos_sales;
  select count(*) into v_before_cash from public.pos_cash_movements;
  select count(*) into v_before_inventory from public.pos_inventory_movements;

  insert into public.licenses(id,license_key,license_type,status,expires_at,features)
  values
    (v_license_free,'ECOM-MODEL-1-1-FREE-ROLLBACK','free','active',now()+interval '1 day',
      '{"ecommerce_portal_enabled":true,"ecommerce_max_published_products":10,"ecommerce_stock_visibility":false,"ecommerce_cloud_catalog_source":false}'::jsonb),
    (v_license_pro,'ECOM-MODEL-1-1-PRO-ROLLBACK','pro','active',now()+interval '1 day',
      '{"ecommerce_portal_enabled":true,"ecommerce_max_published_products":-1,"ecommerce_stock_visibility":true,"ecommerce_cloud_catalog_source":true}'::jsonb);

  insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_role)
  values
    (v_device_free,v_license_free,'model-1-1-free-device','model-1-1-free-token',true,'admin'),
    (v_device_pro,v_license_pro,'model-1-1-pro-device','model-1-1-pro-token',true,'admin');

  insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions)
  values
    (v_staff_allowed,v_license_free,'m11_staff_allowed','Allowed',extensions.crypt('fixture',extensions.gen_salt('bf')),'{"settings":true,"ecommerce":true}'::jsonb),
    (v_staff_denied,v_license_free,'m11_staff_denied','Denied',extensions.crypt('fixture',extensions.gen_salt('bf')),'{"settings":true,"ecommerce":false}'::jsonb);

  insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_role,staff_user_id)
  values
    (v_staff_allowed_device,v_license_free,'model-1-1-staff-allowed','model-1-1-staff-allowed-token',true,'staff',v_staff_allowed),
    (v_staff_denied_device,v_license_free,'model-1-1-staff-denied','model-1-1-staff-denied-token',true,'staff',v_staff_denied);

  insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash,expires_at)
  values
    (v_license_free,v_staff_allowed,v_staff_allowed_device,extensions.crypt('model-1-1-session-allowed',extensions.gen_salt('bf')),now()+interval '1 hour'),
    (v_license_free,v_staff_denied,v_staff_denied_device,extensions.crypt('model-1-1-session-denied',extensions.gen_salt('bf')),now()+interval '1 hour');

  insert into public.ecommerce_portals(id,license_id,slug,status,name,ordering_enabled,pickup_enabled)
  values
    (v_portal_free,v_license_free,'model-1-1-free-rollback','published','Model 1.1 Free',true,true),
    (v_portal_pro,v_license_pro,'model-1-1-pro-rollback','published','Model 1.1 Pro',true,true);

  insert into public.pos_products(
    id,license_id,name,name_key,price,stock,committed_stock,track_stock,is_active,
    product_type,sale_type,bulk_data,batch_management,expiration_mode,recipe,modifiers,metadata
  ) values
    ('m11-simple',v_license_free,'Simple','m11-simple',10,8,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-recipe',v_license_free,'Receta','m11-recipe',30,0,0,false,true,'sellable','unit',null,'{"enabled":false}','NONE','[{"ingredientId":"m11-ingredient","quantity":1,"unit":"pza"}]',null,'{}'),
    ('m11-ingredient',v_license_free,'Ingrediente','m11-ingredient',1,15,0,true,true,'ingredient','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-variant-a',v_license_free,'Variante A','m11-variant-a',20,4,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-variant-b',v_license_free,'Variante B','m11-variant-b',22,2,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-option-ing',v_license_free,'Ingrediente opcion','m11-option-ing',1,10,0,true,true,'ingredient','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-cloud',v_license_pro,'Cloud','m11-cloud',50,5,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-cloud-variant',v_license_pro,'Cloud Variant','m11-cloud-variant',60,3,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}'),
    ('m11-cross',v_license_pro,'Cross','m11-cross',10,1,0,true,true,'sellable','unit','{"purchase":{"unit":"pza"}}','{"enabled":false}','NONE',null,null,'{}');

  insert into public.ecommerce_published_products(
    id,portal_id,license_id,product_id,local_product_ref,public_name,price,
    is_published,is_available,manual_available,source_available,source_state,
    track_stock,stock_mode,stock_snapshot
  ) values
    (v_pub_reversible,v_portal_free,v_license_free,'m11-simple','m11-simple','Reversible',10,true,true,true,true,'in_stock',true,'hidden',8),
    (v_pub_cloud,v_portal_pro,v_license_pro,'m11-cloud','m11-cloud','Cloud publicado',50,true,true,true,true,'in_stock',true,'exact',5);

  -- 1. A: true / true / false => true.
  if not (select is_available from public.ecommerce_published_products where id=v_pub_reversible) then
    raise exception 'TEST_01_AVAILABILITY_A_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 2-3. B/G: configuration blocks checkout without changing source availability.
  v_config := '{"type":"variant_parent","version":1,"hasRecipe":false,"variants":[{"sourceVariantRef":"variant-a","sourceProductId":"m11-variant-a","localProductRef":"m11-variant-a","sku":"M11-A","publicName":"A","optionValues":{"color":"Negro"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"hidden","stockSnapshot":4,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"sourceRevision":"version:1","metadata":{}}],"optionGroups":[],"availabilitySource":"variant_aggregate","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}'::jsonb;
  v_result := private.ecommerce_apply_product_configuration(v_license_free,v_pub_reversible,v_config,'version:1');
  if coalesce((v_result->>'success')::boolean,false) is false
     or (select source_available from public.ecommerce_published_products where id=v_pub_reversible) is not true
     or (select requires_configuration from public.ecommerce_published_products where id=v_pub_reversible) is not true
     or (select is_available from public.ecommerce_published_products where id=v_pub_reversible) is not false then
    raise exception 'TEST_02_03_AVAILABILITY_B_G_FAILED';
  end if;
  v_test_count := v_test_count + 2;

  -- 4-5. C/H: removing required configuration restores a valid product.
  v_result := private.ecommerce_apply_product_configuration(v_license_free,v_pub_reversible,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:2');
  if (select source_available from public.ecommerce_published_products where id=v_pub_reversible) is not true
     or (select requires_configuration from public.ecommerce_published_products where id=v_pub_reversible) is not false
     or (select is_available from public.ecommerce_published_products where id=v_pub_reversible) is not true then
    raise exception 'TEST_04_05_AVAILABILITY_C_H_FAILED';
  end if;
  v_test_count := v_test_count + 2;

  -- 6. D.
  update public.ecommerce_published_products set manual_available=false,source_available=true,requires_configuration=false where id=v_pub_reversible;
  if (select is_available from public.ecommerce_published_products where id=v_pub_reversible) is not false then
    raise exception 'TEST_06_AVAILABILITY_D_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 7. E.
  update public.ecommerce_published_products set manual_available=true,source_available=false,requires_configuration=false where id=v_pub_reversible;
  if (select is_available from public.ecommerce_published_products where id=v_pub_reversible) is not false then
    raise exception 'TEST_07_AVAILABILITY_E_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 8. F.
  update public.ecommerce_published_products set manual_available=false,source_available=false,requires_configuration=true where id=v_pub_reversible;
  if (select is_available from public.ecommerce_published_products where id=v_pub_reversible) is not false
     or (select source_available from public.ecommerce_published_products where id=v_pub_reversible) is not false then
    raise exception 'TEST_08_AVAILABILITY_F_FAILED';
  end if;
  update public.ecommerce_published_products set manual_available=true,source_available=true,requires_configuration=false where id=v_pub_reversible;
  v_test_count := v_test_count + 1;

  -- 9. Manual Free publication is atomic, persists recipe and keeps hidden stock.
  v_result := public.ecommerce_admin_upsert_published_product_v2(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-free-device','model-1-1-free-token',null,
    '{"sourceType":"local_snapshot","localProductRef":"m11-recipe","publicName":"Receta publica","price":30,"manualAvailable":true,"isAvailable":true,"isPublished":true,"stockMode":"exact","syncConfig":{"name":"manual","description":"manual","category":"manual","price":"manual","image":"manual"},"metadata":{"source":"test"},"configuration":{"type":"recipe","version":1,"hasRecipe":true,"variants":[],"optionGroups":[],"availabilitySource":"recipe","availabilityReasonCode":"RECIPE_CAPACITY_CALCULATED","limitingSource":{"productId":"m11-ingredient","name":"Ingrediente"}},"configurationSourceRevision":"version:10"}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean,false) is false then
    raise exception 'TEST_09_MANUAL_V2_FAILED: %',v_result;
  end if;
  v_manual_id := (v_result#>>'{product,id}')::uuid;
  if (select configuration_type from public.ecommerce_published_products where id=v_manual_id) <> 'recipe'
     or (select has_recipe from public.ecommerce_published_products where id=v_manual_id) is not true
     or (select requires_configuration from public.ecommerce_published_products where id=v_manual_id) is not false
     or (select stock_mode from public.ecommerce_published_products where id=v_manual_id) <> 'hidden' then
    raise exception 'TEST_09_MANUAL_V2_CONTRACT_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 10. Full real transport payload: group, two options, ingredient and price delta.
  v_config := '{"type":"configurable","version":1,"hasRecipe":true,"variants":[],"optionGroups":[{"sourceGroupRef":"extras","publicName":"Extras","selectionType":"multiple","required":true,"minSelect":1,"maxSelect":2,"displayOrder":0,"options":[{"sourceOptionRef":"cheese","publicName":"Queso","priceDelta":15,"sourceIngredientId":"m11-option-ing","ingredientQuantity":1,"ingredientUnit":"pza","tracksInventory":true,"manualAvailable":true,"sourceAvailable":true,"displayOrder":0,"metadata":{}},{"sourceOptionRef":"onion","publicName":"Sin cebolla","priceDelta":0,"sourceIngredientId":null,"ingredientQuantity":null,"ingredientUnit":null,"tracksInventory":false,"manualAvailable":true,"sourceAvailable":true,"displayOrder":1,"metadata":{}}],"metadata":{}}],"availabilitySource":"recipe","availabilityReasonCode":"RECIPE_CAPACITY_CALCULATED","limitingSource":{"productId":"m11-ingredient","name":"Ingrediente"}}'::jsonb;
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-free-device','model-1-1-free-token',null,v_manual_id,v_config,'version:11');
  if coalesce((v_result->>'success')::boolean,false) is false
     or (select count(*) from public.ecommerce_published_option_groups where published_product_id=v_manual_id and deleted_at is null)<>1
     or (select count(*) from public.ecommerce_published_options where published_product_id=v_manual_id and deleted_at is null)<>2
     or (select source_available from public.ecommerce_published_products where id=v_manual_id) is not true
     or (select requires_configuration from public.ecommerce_published_products where id=v_manual_id) is not true
     or (select is_available from public.ecommerce_published_products where id=v_manual_id) is not false then
    raise exception 'TEST_10_REAL_PAYLOAD_FAILED: %',v_result;
  end if;
  v_test_count := v_test_count + 1;

  -- 11. Repeat is idempotent and creates no duplicates.
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-free-device','model-1-1-free-token',null,v_manual_id,v_config,'version:11');
  if (select count(*) from public.ecommerce_published_option_groups where published_product_id=v_manual_id and deleted_at is null)<>1
     or (select count(*) from public.ecommerce_published_options where published_product_id=v_manual_id and deleted_at is null)<>2 then
    raise exception 'TEST_11_IDEMPOTENCY_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 12. Optional-only groups persist but do not require selection.
  v_result := private.ecommerce_apply_product_configuration(v_license_free,v_manual_id,
    '{"type":"configurable","version":1,"hasRecipe":true,"variants":[],"optionGroups":[{"sourceGroupRef":"optional","publicName":"Opcionales","selectionType":"multiple","required":false,"minSelect":0,"maxSelect":2,"displayOrder":0,"options":[{"sourceOptionRef":"onion","publicName":"Sin cebolla","priceDelta":0,"sourceIngredientId":null,"ingredientQuantity":null,"ingredientUnit":null,"tracksInventory":false,"manualAvailable":true,"sourceAvailable":true,"displayOrder":0,"metadata":{}}],"metadata":{}}],"availabilitySource":"recipe","availabilityReasonCode":"RECIPE_CAPACITY_CALCULATED","limitingSource":{"productId":"m11-ingredient","name":"Ingrediente"}}','version:12');
  if (select requires_configuration from public.ecommerce_published_products where id=v_manual_id) is not false
     or (select is_available from public.ecommerce_published_products where id=v_manual_id) is not true
     or (select count(*) from public.ecommerce_published_option_groups where published_product_id=v_manual_id and deleted_at is null)<>1
     or (select count(*) from public.ecommerce_published_options where published_product_id=v_manual_id and deleted_at is null)<>1 then
    raise exception 'TEST_12_OPTIONAL_GROUP_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 13. Variant omission soft-deletes only the omitted child.
  v_config := '{"type":"variant_parent","version":1,"hasRecipe":false,"variants":[{"sourceVariantRef":"a","sourceProductId":"m11-variant-a","localProductRef":"m11-variant-a","sku":"M11-A","publicName":"A","optionValues":{"color":"Negro"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"hidden","stockSnapshot":4,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"sourceRevision":"version:1","metadata":{}},{"sourceVariantRef":"b","sourceProductId":"m11-variant-b","localProductRef":"m11-variant-b","sku":"M11-B","publicName":"B","optionValues":{"color":"Blanco"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"hidden","stockSnapshot":2,"sourceAvailable":true,"manualAvailable":true,"displayOrder":1,"sourceRevision":"version:1","metadata":{}}],"optionGroups":[],"availabilitySource":"variant_aggregate","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}'::jsonb;
  perform private.ecommerce_apply_product_configuration(v_license_free,v_manual_id,v_config,'version:13');
  perform private.ecommerce_apply_product_configuration(v_license_free,v_manual_id,
    '{"type":"variant_parent","version":1,"hasRecipe":false,"variants":[{"sourceVariantRef":"a","sourceProductId":"m11-variant-a","localProductRef":"m11-variant-a","sku":"M11-A","publicName":"A","optionValues":{"color":"Negro"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"hidden","stockSnapshot":4,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"sourceRevision":"version:2","metadata":{}}],"optionGroups":[],"availabilitySource":"variant_aggregate","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:14');
  if (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_manual_id and deleted_at is null)<>1
     or not exists (select 1 from public.ecommerce_published_product_variants where published_product_id=v_manual_id and source_variant_ref='b' and deleted_at is not null) then
    raise exception 'TEST_13_VARIANT_SOFT_DELETE_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 14. Removing a group removes its options and leaves no active orphan.
  perform private.ecommerce_apply_product_configuration(v_license_free,v_manual_id,v_config,'version:15');
  perform private.ecommerce_apply_product_configuration(v_license_free,v_manual_id,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:16');
  if exists (select 1 from public.ecommerce_published_option_groups where published_product_id=v_manual_id and deleted_at is null)
     or exists (select 1 from public.ecommerce_published_options where published_product_id=v_manual_id and deleted_at is null) then
    raise exception 'TEST_14_GROUP_SOFT_DELETE_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  -- 15. Cross-license reference rolls back and preserves the previous product state.
  select count(*) into v_before_variants from public.ecommerce_published_product_variants where published_product_id=v_manual_id and deleted_at is null;
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-free-device','model-1-1-free-token',null,v_manual_id,
    '{"type":"variant_parent","version":1,"hasRecipe":false,"variants":[{"sourceVariantRef":"cross","sourceProductId":"m11-cross","localProductRef":"m11-cross","sku":"CROSS","publicName":"Cross","optionValues":{"color":"X"},"priceMode":"base","priceValue":0,"imageUrl":null,"imageRef":null,"trackStock":true,"stockMode":"hidden","stockSnapshot":1,"sourceAvailable":true,"manualAvailable":true,"displayOrder":0,"sourceRevision":"version:1","metadata":{}}],"optionGroups":[],"availabilitySource":"variant_aggregate","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:17');
  if v_result->>'code' <> 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'
     or (select configuration_type from public.ecommerce_published_products where id=v_manual_id) <> 'simple'
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_manual_id and deleted_at is null)<>v_before_variants then
    raise exception 'TEST_15_CROSS_LICENSE_ROLLBACK_FAILED: %',v_result;
  end if;
  v_test_count := v_test_count + 1;

  -- 16-17. Staff permission contract.
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-staff-allowed','model-1-1-staff-allowed-token','model-1-1-session-allowed',v_manual_id,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:18');
  if coalesce((v_result->>'success')::boolean,false) is false then raise exception 'TEST_16_STAFF_ALLOWED_FAILED: %',v_result; end if;
  v_result := public.ecommerce_admin_sync_product_configuration(
    'ECOM-MODEL-1-1-FREE-ROLLBACK','model-1-1-staff-denied','model-1-1-staff-denied-token','model-1-1-session-denied',v_manual_id,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[],"availabilitySource":"direct","availabilityReasonCode":null,"limitingSource":{"productId":null,"name":null}}','version:19');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED' then raise exception 'TEST_17_STAFF_DENIED_FAILED: %',v_result; end if;
  v_test_count := v_test_count + 2;

  -- 18-19. Automatic PRO sync uses the same writer and remains idempotent.
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_pro;
  v_cloud_projection := jsonb_build_array(jsonb_build_object(
    'publishedProductId',v_pub_cloud::text,
    'localProductRef','m11-cloud',
    'sourceRevision','version:2',
    'sourceState','in_stock',
    'sourceAvailable',true,
    'stockSnapshot',5,
    'fields',jsonb_build_object('name','Cloud actualizado','description',null,'category','General','price',50,'image',null),
    'configuration',jsonb_build_object(
      'type','variant_parent','version',1,'hasRecipe',false,
      'variants',jsonb_build_array(jsonb_build_object(
        'sourceVariantRef','cloud-variant','sourceProductId','m11-cloud-variant','localProductRef','m11-cloud-variant',
        'sku','M11-CLOUD-V','publicName','Cloud V','optionValues',jsonb_build_object('size','V'),
        'priceMode','base','priceValue',0,'imageUrl',null,'imageRef',null,'trackStock',true,
        'stockMode','exact','stockSnapshot',3,'sourceAvailable',true,'manualAvailable',true,
        'displayOrder',0,'sourceRevision','version:2','metadata',jsonb_build_object()
      )),
      'optionGroups',jsonb_build_array(),
      'availabilitySource','variant_aggregate','availabilityReasonCode',null,
      'limitingSource',jsonb_build_object('productId',null,'name',null)
    ),
    'configurationSourceRevision','version:2'
  ));
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    'ECOM-MODEL-1-1-PRO-ROLLBACK','model-1-1-pro-device','model-1-1-pro-token',null,
    v_cloud_projection,'model-1-1-cloud-sync',v_revision);
  if coalesce((v_result->>'success')::boolean,false) is false
     or (select configuration_type from public.ecommerce_published_products where id=v_pub_cloud) <> 'variant_parent'
     or (select requires_configuration from public.ecommerce_published_products where id=v_pub_cloud) is not true
     or (select source_available from public.ecommerce_published_products where id=v_pub_cloud) is not true
     or (select is_available from public.ecommerce_published_products where id=v_pub_cloud) is not false
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pub_cloud and deleted_at is null)<>1 then
    raise exception 'TEST_18_CLOUD_V2_FAILED: %',v_result;
  end if;
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    'ECOM-MODEL-1-1-PRO-ROLLBACK','model-1-1-pro-device','model-1-1-pro-token',null,
    v_cloud_projection,'model-1-1-cloud-sync',v_revision);
  if coalesce((v_result->>'success')::boolean,false) is false
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pub_cloud and deleted_at is null)<>1 then
    raise exception 'TEST_19_CLOUD_IDEMPOTENCY_FAILED: %',v_result;
  end if;
  v_test_count := v_test_count + 2;

  -- 20. No operational side effects.
  if (select count(*) from public.ecommerce_orders)<>v_before_orders
     or (select count(*) from public.pos_sales)<>v_before_sales
     or (select count(*) from public.pos_cash_movements)<>v_before_cash
     or (select count(*) from public.pos_inventory_movements)<>v_before_inventory then
    raise exception 'TEST_20_OPERATIONAL_SIDE_EFFECT_FAILED';
  end if;
  v_test_count := v_test_count + 1;

  raise notice 'ECOM.PRODUCTS.MODEL.1.1 matrix passed: %/20',v_test_count;
end;
$test$;

rollback;

select
  (select count(*) from public.licenses where license_key like 'ECOM-MODEL-1-1-%-ROLLBACK') as synthetic_licenses,
  (select count(*) from public.ecommerce_portals where id in ('23000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000004')) as synthetic_portals,
  (select count(*) from public.pos_products where id like 'm11-%') as synthetic_products,
  (select count(*) from public.ecommerce_published_products where license_id in ('23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002')) as synthetic_published,
  (select count(*) from public.ecommerce_published_product_variants where license_id in ('23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002')) as synthetic_variants,
  (select count(*) from public.ecommerce_published_option_groups where license_id in ('23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002')) as synthetic_groups,
  (select count(*) from public.ecommerce_published_options where license_id in ('23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002')) as synthetic_options,
  (select count(*) from private.ecommerce_catalog_sync_requests where license_id in ('23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002')) as synthetic_sync_requests;
