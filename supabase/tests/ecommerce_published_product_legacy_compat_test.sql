-- ECOMMERCE PUBLISHED PRODUCT LEGACY COMPATIBILITY R1
--
-- Real RPC replay with isolated fixtures.  Every fixture and every writer side
-- effect is rolled back at the end of the test.

begin;

do $test$
declare
  v_free_license uuid := '29410000-0000-4000-8000-000000000001';
  v_pro_license uuid := '29410000-0000-4000-8000-000000000002';
  v_free_device uuid := '29410000-0000-4000-9000-000000000001';
  v_pro_device uuid := '29410000-0000-4000-9000-000000000002';
  v_free_portal uuid := '29410000-0000-4000-9000-000000000011';
  v_pro_portal uuid := '29410000-0000-4000-9000-000000000012';
  v_free_session text;
  v_pro_session text;
  v_result jsonb;
  v_free_product uuid;
  v_pro_legacy_product uuid;
  v_pro_simple_product uuid;
  v_pro_configurable uuid;
  v_active_variants integer;
  v_active_groups integer;
  v_active_options integer;
  v_active_wholesale integer;
begin
  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values
  (
    v_free_license, 'ECOM-PR294-COMPAT-FREE', 'free', 'active', now() + interval '1 day',
    '{"ecommerce_portal_enabled":true,"ecommerce_max_published_products":1,"ecommerce_stock_visibility":false,"ecommerce_cloud_catalog_source":false}'::jsonb
  ),
  (
    v_pro_license, 'ECOM-PR294-COMPAT-PRO', 'pro', 'active', now() + interval '1 day',
    '{"ecommerce_portal_enabled":true,"ecommerce_max_published_products":-1,"ecommerce_stock_visibility":true,"ecommerce_cloud_catalog_source":true}'::jsonb
  );

  insert into public.business_profiles(license_id, business_name, business_type)
  values
    (v_free_license, 'PR294 Free compatibility', array['abarrotes']::public.business_category[]),
    (v_pro_license, 'PR294 Pro compatibility', array['abarrotes']::public.business_category[]);

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values
    (v_free_device, v_free_license, 'pr294-compat-free-device', 'pr294-compat-free-token', true, 'admin'),
    (v_pro_device, v_pro_license, 'pr294-compat-pro-device', 'pr294-compat-pro-token', true, 'admin');

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled,
    business_hours_enabled, whatsapp_phone, address_street, address_neighborhood,
    address_municipality, address_state, address_postal_code
  ) values
    (v_free_portal, v_free_license, 'pr294-compat-free', 'published', 'PR294 Free', true, true,
      true, '5555555555', 'Calle 1', 'Centro', 'Merida', 'Yucatan', '97000'),
    (v_pro_portal, v_pro_license, 'pr294-compat-pro', 'published', 'PR294 Pro', true, true,
      true, '5555555556', 'Calle 2', 'Centro', 'Merida', 'Yucatan', '97000');

  insert into public.pos_products(
    id, license_id, name, name_key, price, stock, committed_stock, track_stock,
    server_version, is_active, product_type, sale_type, bulk_data,
    batch_management, expiration_mode, recipe, modifiers, metadata
  ) values
    ('pr294-compat-free-simple', v_free_license, 'Free simple', 'pr294-compat-free-simple', 10, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('pr294-compat-free-overflow', v_free_license, 'Free overflow', 'pr294-compat-free-overflow', 11, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('pr294-compat-free-modifiers', v_free_license, 'Free modifiers', 'pr294-compat-free-modifiers', 12, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, '[{"id":"extra","name":"Extra","options":[]}]', '{}'),
    ('pr294-compat-pro-legacy', v_pro_license, 'Pro legacy simple', 'pr294-compat-pro-legacy', 20, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('pr294-compat-pro-simple', v_pro_license, 'Pro simple', 'pr294-compat-pro-simple', 30, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('pr294-compat-pro-config', v_pro_license, 'Pro configurable', 'pr294-compat-pro-config', 40, 8, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}'),
    ('pr294-compat-pro-variant', v_pro_license, 'Pro variant', 'pr294-compat-pro-variant', 45, 4, 0, true, 1, true, 'sellable', 'unit', '{"purchase":{"unit":"pza"}}', '{"enabled":false}', 'NONE', null, null, '{}');

  v_result := public.admin_enroll_owner_on_device(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token',
    'pr294_compat_free', 'Fixture-Pass-294', 'PR294 Free Owner'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or nullif(v_result->>'admin_session_token','') is null then
    raise exception 'LEGACY_COMPAT_FREE_OWNER_ENROLL_FAILED: %', v_result;
  end if;
  v_free_session := v_result->>'admin_session_token';

  v_result := public.admin_enroll_owner_on_device(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token',
    'pr294_compat_pro', 'Fixture-Pass-294', 'PR294 Pro Owner'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or nullif(v_result->>'admin_session_token','') is null then
    raise exception 'LEGACY_COMPAT_PRO_OWNER_ENROLL_FAILED: %', v_result;
  end if;
  v_pro_session := v_result->>'admin_session_token';

  -- L1: the four-argument overload cannot carry the post-cutover actor
  -- session.  It must remain closed rather than silently opening access.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token',
    jsonb_build_object(
      'sourceType','local_snapshot','localProductRef','pr294-compat-free-simple',
      'publicName','Free L1','price',10,'isPublished',true
    )
  );
  if v_result->>'code' <> 'ACTOR_SESSION_REQUIRED' then
    raise exception 'LEGACY_4ARG_AUTH_CONTRACT_FAILED: %', v_result;
  end if;

  -- L2: a real authenticated legacy payload without configuration must create
  -- a simple product without invoking the configuration helper.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object(
      'sourceType','local_snapshot','localProductRef','pr294-compat-free-simple',
      'publicName','Free legacy simple','price',10,'manualAvailable',true,
      'isPublished',true,'stockMode','exact'
    )
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'LEGACY_5ARG_NO_CONFIGURATION_FAILED: %', v_result;
  end if;
  v_free_product := (v_result#>>'{product,id}')::uuid;
  if v_result#>>'{product,stockMode}' <> 'hidden'
     or v_result#>>'{product,configurationType}' <> 'simple'
     or (select is_published from public.ecommerce_published_products where id=v_free_product) is not true then
    raise exception 'FREE_STOCK_OR_SIMPLE_CONTRACT_FAILED: %', v_result;
  end if;

  -- Free simple publish lifecycle: edit, unpublish, and republish while the
  -- plan continues to hide Pro stock capabilities.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object('id',v_free_product::text,'publicName','Free edited','price',11,'isPublished',false)
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select is_published from public.ecommerce_published_products where id=v_free_product) is not false then
    raise exception 'FREE_UNPUBLISH_FAILED: %', v_result;
  end if;
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object('id',v_free_product::text,'publicName','Free republished','price',12,'isPublished',true,'stockMode','exact')
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select is_published from public.ecommerce_published_products where id=v_free_product) is not true
     or v_result#>>'{product,stockMode}' <> 'hidden' then
    raise exception 'FREE_REPUBLISH_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object('sourceType','local_snapshot','localProductRef','pr294-compat-free-overflow',
      'publicName','Free overflow','price',13,'isPublished',true)
  );
  if v_result->>'code' <> 'ECOMMERCE_PRODUCT_LIMIT_REACHED' then
    raise exception 'FREE_PRODUCT_LIMIT_CONTRACT_FAILED: %', v_result;
  end if;

  -- Phase 1 eligibility is still enforced through legacy -> v3.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object('sourceType','local_snapshot','localProductRef','pr294-compat-free-modifiers',
      'publicName','Free incompatible','price',14,'isPublished',true)
  );
  if v_result->>'code' not in ('ECOMMERCE_PRODUCT_REQUIRES_REVIEW','ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE') then
    raise exception 'LEGACY_ELIGIBILITY_BYPASS: %', v_result;
  end if;

  -- Pro legacy/simple without configuration retains allowed stock behavior.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object('sourceType','local_snapshot','localProductRef','pr294-compat-pro-legacy',
      'publicName','Pro legacy simple','price',20,'isPublished',true,'stockMode','exact')
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{product,stockMode}' <> 'exact' then
    raise exception 'PRO_LEGACY_SIMPLE_FAILED: %', v_result;
  end if;
  v_pro_legacy_product := (v_result#>>'{product,id}')::uuid;

  -- M1 modern simple configuration plus wholesale and Pro stock.
  v_result := public.ecommerce_admin_upsert_published_product_v3(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object(
      'sourceType','local_snapshot','localProductRef','pr294-compat-pro-simple',
      'publicName','Pro modern simple','price',30,'isPublished',true,'stockMode','exact',
      'configuration',jsonb_build_object('type','simple','version',1,'hasRecipe',false,
        'variants','[]'::jsonb,'optionGroups','[]'::jsonb,'availabilitySource','direct',
        'availabilityReasonCode',null,'limitingSource',jsonb_build_object('productId',null,'name',null)),
      'configurationSourceRevision','version:1','wholesaleEnabled',true,
      'wholesaleTiers',jsonb_build_array(jsonb_build_object(
        'sourceTierRef','six','minQuantity',6,'unitPrice',25,'displayOrder',0,'sourceAvailable',true))
    )
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{product,stockMode}' <> 'exact'
     or (select wholesale_enabled from public.ecommerce_published_products where id=(v_result#>>'{product,id}')::uuid) is not true
     or (select count(*) from public.ecommerce_published_wholesale_tiers where published_product_id=(v_result#>>'{product,id}')::uuid and deleted_at is null) <> 1 then
    raise exception 'MODERN_V3_WHOLESALE_STOCK_FAILED: %', v_result;
  end if;
  v_pro_simple_product := (v_result#>>'{product,id}')::uuid;
  select count(*) into v_active_wholesale
  from public.ecommerce_published_wholesale_tiers
  where published_product_id=v_pro_simple_product and deleted_at is null;

  -- A legacy metadata update must not erase wholesale state when configuration
  -- is absent.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object('id',v_pro_simple_product::text,'publicName','Pro simple edited','price',31,'isPublished',true)
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.ecommerce_published_wholesale_tiers where published_product_id=v_pro_simple_product and deleted_at is null) <> v_active_wholesale
     or (select wholesale_enabled from public.ecommerce_published_products where id=v_pro_simple_product) is not true then
    raise exception 'LEGACY_WHOLESALE_PRESERVATION_FAILED: %', v_result;
  end if;

  -- M2 modern configurable configuration, then legacy metadata-only update.
  v_result := public.ecommerce_admin_upsert_published_product_v3(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object(
      'sourceType','local_snapshot','localProductRef','pr294-compat-pro-config',
      'publicName','Pro configurable','price',40,'isPublished',true,'stockMode','exact',
      'configuration',jsonb_build_object('type','variant_parent','version',1,'hasRecipe',false,
        'variants',jsonb_build_array(jsonb_build_object(
          'sourceVariantRef','pr294-compat-v1','localProductRef','pr294-compat-pro-variant',
          'publicName','Variant 1','optionValues',jsonb_build_object('size','M'),
          'priceMode','base','priceValue',0,'stockMode','exact','stockSnapshot',4,
          'sourceAvailable',true,'manualAvailable',true,'displayOrder',0)),
        'optionGroups','[]'::jsonb,'availabilitySource','variant_aggregate',
        'availabilityReasonCode',null,'limitingSource',jsonb_build_object('productId',null,'name',null)),
      'configurationSourceRevision','version:1'
    )
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'MODERN_CONFIGURABLE_FAILED: %', v_result;
  end if;
  v_pro_configurable := (v_result#>>'{product,id}')::uuid;
  select count(*) into v_active_variants
  from public.ecommerce_published_product_variants
  where published_product_id=v_pro_configurable and deleted_at is null;

  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object('id',v_pro_configurable::text,'publicName','Pro configurable edited','price',41,'isPublished',true)
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pro_configurable and deleted_at is null) <> v_active_variants
     or (select configuration_type from public.ecommerce_published_products where id=v_pro_configurable) <> 'variant_parent' then
    raise exception 'LEGACY_CONFIGURABLE_PRESERVATION_FAILED: %', v_result;
  end if;

  -- Explicitly model a persisted simple_override and ensure a metadata-only
  -- legacy call does not invoke the cleanup path for its existing children.
  update public.ecommerce_published_products
  set public_configuration_mode='simple_override',
      business_capability_status='simple_override'
  where id=v_pro_configurable;
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object('id',v_pro_configurable::text,'publicName','Pro override metadata','price',42,'isPublished',true)
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.ecommerce_published_product_variants where published_product_id=v_pro_configurable and deleted_at is null) <> v_active_variants
     or (select public_configuration_mode from public.ecommerce_published_products where id=v_pro_configurable) <> 'simple_override' then
    raise exception 'SIMPLE_OVERRIDE_PRESERVATION_FAILED: %', v_result;
  end if;

  -- Cross-tenant product ids remain inaccessible through the legacy boundary.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-FREE', 'pr294-compat-free-device', 'pr294-compat-free-token', v_free_session,
    jsonb_build_object('id',v_pro_configurable::text,'publicName','Cross tenant','price',99,'isPublished',false)
  );
  if v_result->>'code' <> 'ECOMMERCE_PRODUCT_NOT_FOUND' then
    raise exception 'TENANT_ISOLATION_FAILED: %', v_result;
  end if;

  -- Configuration is explicit: NULL is invalid and must never reach the
  -- checked helper as though it were a missing legacy field.
  v_result := public.ecommerce_admin_upsert_published_product(
    'ECOM-PR294-COMPAT-PRO', 'pr294-compat-pro-device', 'pr294-compat-pro-token', v_pro_session,
    jsonb_build_object('sourceType','local_snapshot','localProductRef','pr294-compat-pro-legacy',
      'publicName','Invalid null config','price',20,'configuration',null)
  );
  if v_result->>'code' <> 'ECOMMERCE_CONFIGURATION_INVALID' then
    raise exception 'EXPLICIT_NULL_CONFIGURATION_CONTRACT_FAILED: %', v_result;
  end if;

  select count(*) into v_active_groups
  from public.ecommerce_published_option_groups
  where published_product_id=v_pro_configurable and deleted_at is null;
  select count(*) into v_active_options
  from public.ecommerce_published_options
  where published_product_id=v_pro_configurable and deleted_at is null;
  raise notice 'ECOM legacy compatibility replay passed: Free/Pro, legacy 4/5 args, modern configuration, stock, limit, eligibility, wholesale, simple_override, tenant isolation; variants=%, groups=%, options=%',
    v_active_variants, v_active_groups, v_active_options;
end;
$test$;

rollback;
