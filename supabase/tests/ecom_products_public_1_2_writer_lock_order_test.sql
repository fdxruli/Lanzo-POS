-- ECOM.PRODUCTS.PUBLIC.1.2 writer lock-order regression.
-- Synthetic data only; all changes are rolled back.

begin;

do $definitions$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'select p.* into v_portal') = 0
     or strpos(v_definition, 'order by pp.id for share of pp') = 0
     or strpos(v_definition, 'select p.* into v_portal')
        > strpos(v_definition, 'order by pp.id for share of pp') then
    raise exception 'CHECKOUT_PORTAL_PRODUCT_LOCK_ORDER_FAILED';
  end if;
  if strpos(v_definition, 'if v_existing_order.id is not null then') = 0
     or strpos(v_definition, 'if v_existing_order.id is not null then')
        > strpos(v_definition, 'order by pp.id for share of pp') then
    raise exception 'IDEMPOTENT_REPLAY_MOVED_AFTER_LOCKS';
  end if;

  select pg_get_functiondef(
    'private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'ecommerce_lock_configuration_writer') = 0
     or strpos(v_definition, 'ecommerce_lock_configuration_writer')
        > strpos(v_definition, 'insert into public.ecommerce_published_product_variants') then
    raise exception 'CANONICAL_WRITER_LOCK_ORDER_FAILED';
  end if;

  select pg_get_functiondef(
    'private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'ecommerce_lock_configuration_writer') = 0
     or strpos(v_definition, 'ecommerce_lock_configuration_writer')
        > strpos(v_definition, 'ecommerce_apply_product_configuration') then
    raise exception 'CHECKED_WRITER_LOCK_ORDER_FAILED';
  end if;

  select pg_get_functiondef(
    'public.ecommerce_admin_upsert_published_product(text,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'limit 1 for update') = 0 then
    raise exception 'LEGACY_UPSERT_PORTAL_LOCK_MISSING';
  end if;

  select pg_get_functiondef(
    'public.ecommerce_admin_upsert_published_product(text,text,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'limit 1 for update') = 0 then
    raise exception 'STAFF_UPSERT_PORTAL_LOCK_MISSING';
  end if;

  select pg_get_functiondef(
    'public.ecommerce_admin_set_product_published(text,text,text,uuid,boolean)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'ecommerce_lock_configuration_writer') = 0 then
    raise exception 'LEGACY_SET_STATUS_LOCK_MISSING';
  end if;

  select pg_get_functiondef(
    'public.ecommerce_admin_set_product_published(text,text,text,text,uuid,boolean)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, 'ecommerce_lock_configuration_writer') = 0 then
    raise exception 'STAFF_SET_STATUS_LOCK_MISSING';
  end if;
end;
$definitions$;

do $privileges$
begin
  if has_table_privilege(
       'service_role',
       'public.ecommerce_published_products',
       'INSERT'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_products',
       'UPDATE'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_products',
       'DELETE'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_product_variants',
       'INSERT'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_option_groups',
       'UPDATE'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_options',
       'DELETE'
     ) then
    raise exception 'DIRECT_PRODUCT_CONFIGURATION_DML_STILL_GRANTED';
  end if;

  if has_function_privilege(
       'anon',
       'private.ecommerce_lock_configuration_writer(uuid,uuid)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'private.ecommerce_lock_configuration_writer(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'WRITER_LOCK_HELPER_EXECUTE_LEAK';
  end if;
end;
$privileges$;

do $functional$
declare
  v_license uuid := '29000000-0000-4000-8000-000000000001';
  v_portal uuid := '29000000-0000-4000-8000-000000000002';
  v_product uuid := '29000000-0000-4000-8000-000000000003';
  v_result jsonb;
begin
  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values (
    v_license,
    'ECOM-PUBLIC-1-2-WRITER-ROLLBACK',
    'free',
    'active',
    clock_timestamp() + interval '1 day',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', 10
    )
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name,
    ordering_enabled, pickup_enabled, business_hours_enabled
  ) values (
    v_portal,
    v_license,
    'ecom-public-1-2-writer-rollback',
    'published',
    'Writer rollback',
    true,
    true,
    false
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, local_product_ref, public_name, price,
    is_published, manual_available, source_available,
    configuration_type, availability_source, stock_mode, source_state
  ) values (
    v_product,
    v_portal,
    v_license,
    'cfg-product',
    'Configurable',
    100,
    true,
    true,
    true,
    'configurable',
    'variant_aggregate',
    'hidden',
    'in_stock'
  );

  if private.ecommerce_lock_configuration_writer(v_license, v_product) <> v_portal then
    raise exception 'WRITER_LOCK_HELPER_FAILED';
  end if;

  v_result := private.ecommerce_apply_product_configuration(
    v_license,
    v_product,
    '{
      "type":"configurable",
      "version":1,
      "hasRecipe":false,
      "availabilitySource":"variant_aggregate",
      "variants":[{
        "sourceVariantRef":"variant-red-m",
        "localProductRef":"variant-red-m",
        "publicName":"Rojo / M",
        "optionValues":{"color":"Rojo","talla":"M"},
        "priceMode":"delta",
        "priceValue":10,
        "stockMode":"exact",
        "stockSnapshot":20,
        "sourceAvailable":true,
        "manualAvailable":true,
        "displayOrder":0
      }],
      "optionGroups":[{
        "sourceGroupRef":"extras",
        "publicName":"Extras",
        "selectionType":"multiple",
        "required":true,
        "minSelect":1,
        "maxSelect":2,
        "displayOrder":0,
        "options":[{
          "sourceOptionRef":"extra-cheese",
          "publicName":"Queso",
          "priceDelta":5,
          "tracksInventory":false,
          "manualAvailable":true,
          "sourceAvailable":true,
          "displayOrder":0
        }]
      }]
    }'::jsonb,
    'writer-lock-order-test'
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true
     or (select count(*) from public.ecommerce_published_product_variants
         where published_product_id = v_product and deleted_at is null) <> 1
     or (select count(*) from public.ecommerce_published_option_groups
         where published_product_id = v_product and deleted_at is null) <> 1
     or (select count(*) from public.ecommerce_published_options
         where published_product_id = v_product and deleted_at is null) <> 1 then
    raise exception 'CANONICAL_WRITER_FUNCTIONAL_FAILED: %', v_result;
  end if;
end;
$functional$;

rollback;