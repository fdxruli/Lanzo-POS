-- ECOM.PRODUCTS.PUBLIC.1.2
-- Non-concurrent regression matrix. Synthetic fixtures only.
-- Real two-session cases live in scripts/test-ecom-products-public-1-2-concurrency.ps1.

begin;

select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);

do $atomic$
declare
  v_license uuid := '25000000-0000-4000-8000-000000000001';
  v_portal uuid := '25000000-0000-4000-8000-000000000002';
  v_product uuid := '25000000-0000-4000-8000-000000000003';
  v_variant uuid := '25000000-0000-4000-8000-000000000004';
  v_group uuid := '25000000-0000-4000-8000-000000000005';
  v_option uuid := '25000000-0000-4000-8000-000000000006';
  v_simple uuid := '25000000-0000-4000-8000-000000000007';
  v_detail_a jsonb;
  v_detail_b jsonb;
  v_order_a jsonb;
  v_order_b jsonb;
  v_result jsonb;
  v_revision_a text;
  v_revision_b text;
  v_manual_revision text;
  v_catalog_a bigint;
  v_catalog_b bigint;
  v_order_id uuid;
  v_sales bigint;
  v_cash bigint;
  v_movements bigint;
begin
  select count(*) into v_sales from public.pos_sales;
  select count(*) into v_cash from public.pos_cash_movements;
  select count(*) into v_movements from public.pos_inventory_movements;

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values (
    v_license,
    'ECOM-PUBLIC-1-2-ROLLBACK',
    'free',
    'active',
    clock_timestamp() + interval '1 day',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_order_inbox', true,
      'ecommerce_whatsapp_checkout', true,
      'ecommerce_max_published_products', 10,
      'ecommerce_max_open_orders_per_day', 100,
      'ecommerce_stock_visibility', true
    )
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled,
    pickup_enabled, business_hours_enabled
  ) values (
    v_portal, v_license, 'ecom-public-1-2-rollback', 'published',
    'PUBLIC 1.2 rollback', true, true, false
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, local_product_ref, public_name, price,
    is_published, manual_available, source_available, configuration_type,
    has_variants, has_option_groups, requires_configuration,
    availability_source, stock_mode, source_state
  ) values
    (
      v_product, v_portal, v_license, 'cfg-product', 'Configurable', 100,
      true, true, true, 'configurable', true, true, true,
      'variant_aggregate', 'hidden', 'in_stock'
    ),
    (
      v_simple, v_portal, v_license, 'simple-product', 'Simple', 25,
      true, true, true, 'simple', false, false, false,
      'not_tracked', 'hidden', 'not_tracked'
    );

  insert into public.ecommerce_published_product_variants(
    id, published_product_id, portal_id, license_id, source_variant_ref,
    local_product_ref, public_name, option_values, price_mode, price_value,
    stock_mode, stock_snapshot, manual_available, source_available,
    is_available, display_order
  ) values (
    v_variant, v_product, v_portal, v_license, 'variant-red-m',
    'variant-red-m', 'Rojo / M', '{"color":"Rojo","talla":"M"}',
    'delta', 10, 'exact', 20, true, true, true, 0
  );

  insert into public.ecommerce_published_option_groups(
    id, published_product_id, portal_id, license_id, source_group_ref,
    public_name, selection_type, required, min_select, max_select, display_order
  ) values (
    v_group, v_product, v_portal, v_license, 'extras', 'Extras',
    'multiple', true, 1, 2, 0
  );

  insert into public.ecommerce_published_options(
    id, group_id, published_product_id, portal_id, license_id,
    source_option_ref, public_name, price_delta, manual_available,
    source_available, is_available, display_order
  ) values (
    v_option, v_group, v_product, v_portal, v_license,
    'extra-cheese', 'Queso extra', 5, true, true, true, 0
  );

  v_detail_a := public.ecommerce_get_product_configuration(
    'ecom-public-1-2-rollback', v_product
  );
  v_revision_a := v_detail_a #>> '{product,configurationRevision}';
  v_catalog_a := (v_detail_a ->> 'catalogRevision')::bigint;

  if v_revision_a !~ '^[0-9a-f]{64}$'
     or v_revision_a <> private.ecommerce_product_configuration_revision(v_product)
     or (v_detail_a #>> '{variants,0,priceValue}')::numeric <> 10
     or (v_detail_a #>> '{groups,0,options,0,priceDelta}')::numeric <> 5
     or v_catalog_a <> (
       select catalog_revision from public.ecommerce_portals where id = v_portal
     ) then
    raise exception 'DETAIL_A_NOT_COHERENT: %', v_detail_a;
  end if;

  perform 1
  from public.ecommerce_published_products
  where id = v_product
  for update;

  update public.ecommerce_published_product_variants
  set stock_snapshot = 19
  where id = v_variant;
  if private.ecommerce_product_configuration_revision(v_product) <> v_revision_a then
    raise exception 'VOLATILE_STOCK_CHANGED_REVISION';
  end if;
  update public.ecommerce_published_product_variants
  set stock_snapshot = 20
  where id = v_variant;

  v_order_a := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    jsonb_build_object(
      'name', 'Cliente QA',
      'phone', '9610000000',
      'fulfillmentMethod', 'pickup'
    ),
    jsonb_build_array(jsonb_build_object(
      'productId', v_product,
      'quantity', 1,
      'variantId', v_variant,
      'selections', jsonb_build_array(jsonb_build_object(
        'groupId', v_group,
        'optionIds', jsonb_build_array(v_option)
      )),
      'configurationVersion', 1,
      'configurationRevision', v_revision_a
    )),
    'public-1-2-a'
  );
  if coalesce((v_order_a ->> 'success')::boolean, false) is not true
     or (v_order_a #>> '{order,total}')::numeric <> 115 then
    raise exception 'ORDER_A_FAILED: %', v_order_a;
  end if;

  v_order_id := (v_order_a #>> '{order,id}')::uuid;
  if (
    select options ->> 'configurationRevision'
    from public.ecommerce_order_items
    where order_id = v_order_id
    limit 1
  ) <> v_revision_a
  or (
    select unit_price
    from public.ecommerce_order_items
    where order_id = v_order_id
    limit 1
  ) <> 115 then
    raise exception 'SNAPSHOT_A_FAILED';
  end if;

  -- Canonical writer order: parent first, then child.
  perform 1
  from public.ecommerce_published_products
  where id = v_product
  for update;
  update public.ecommerce_published_options
  set price_delta = 7
  where id = v_option;

  v_detail_b := public.ecommerce_get_product_configuration(
    'ecom-public-1-2-rollback', v_product
  );
  v_revision_b := v_detail_b #>> '{product,configurationRevision}';
  v_catalog_b := (v_detail_b ->> 'catalogRevision')::bigint;
  if v_revision_b = v_revision_a
     or (v_detail_b #>> '{groups,0,options,0,priceDelta}')::numeric <> 7
     or v_catalog_b <= v_catalog_a then
    raise exception 'DETAIL_B_NOT_COHERENT: %', v_detail_b;
  end if;

  -- Replay must remain before locks and mutable validation.
  v_result := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    '{}'::jsonb,
    '[]'::jsonb,
    'public-1-2-a'
  );
  if coalesce((v_result ->> 'idempotent')::boolean, false) is not true
     or (v_result #>> '{order,id}')::uuid <> v_order_id
     or (v_result #>> '{order,total}')::numeric <> 115 then
    raise exception 'REPLAY_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    jsonb_build_object(
      'name', 'Cliente QA',
      'phone', '9610000000',
      'fulfillmentMethod', 'pickup'
    ),
    jsonb_build_array(jsonb_build_object(
      'productId', v_product,
      'quantity', 1,
      'variantId', v_variant,
      'selections', jsonb_build_array(jsonb_build_object(
        'groupId', v_group,
        'optionIds', jsonb_build_array(v_option)
      )),
      'configurationVersion', 1,
      'configurationRevision', v_revision_a
    )),
    'public-1-2-stale'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_CONFIGURATION_CHANGED' then
    raise exception 'STALE_REVISION_ACCEPTED: %', v_result;
  end if;

  v_order_b := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    jsonb_build_object(
      'name', 'Cliente QA',
      'phone', '9610000000',
      'fulfillmentMethod', 'pickup'
    ),
    jsonb_build_array(jsonb_build_object(
      'productId', v_product,
      'quantity', 1,
      'variantId', v_variant,
      'selections', jsonb_build_array(jsonb_build_object(
        'groupId', v_group,
        'optionIds', jsonb_build_array(v_option)
      )),
      'configurationVersion', 1,
      'configurationRevision', v_revision_b
    )),
    'public-1-2-b'
  );
  if coalesce((v_order_b ->> 'success')::boolean, false) is not true
     or (v_order_b #>> '{order,total}')::numeric <> 117 then
    raise exception 'ORDER_B_FAILED: %', v_order_b;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    jsonb_build_object(
      'name', 'Cliente QA',
      'phone', '9610000000',
      'fulfillmentMethod', 'pickup'
    ),
    jsonb_build_array(jsonb_build_object(
      'productId', v_simple,
      'quantity', 2
    )),
    'public-1-2-simple'
  );
  if coalesce((v_result ->> 'success')::boolean, false) is not true
     or (v_result #>> '{order,total}')::numeric <> 50 then
    raise exception 'SIMPLE_LEGACY_FAILED: %', v_result;
  end if;

  perform 1
  from public.ecommerce_published_products
  where id = v_product
  for update;
  update public.ecommerce_published_products
  set manual_available = false
  where id = v_product;
  v_manual_revision := private.ecommerce_product_configuration_revision(v_product);
  v_result := public.ecommerce_create_order(
    'ecom-public-1-2-rollback',
    jsonb_build_object(
      'name', 'Cliente QA',
      'phone', '9610000000',
      'fulfillmentMethod', 'pickup'
    ),
    jsonb_build_array(jsonb_build_object(
      'productId', v_product,
      'quantity', 1,
      'variantId', v_variant,
      'selections', jsonb_build_array(jsonb_build_object(
        'groupId', v_group,
        'optionIds', jsonb_build_array(v_option)
      )),
      'configurationVersion', 1,
      'configurationRevision', v_manual_revision
    )),
    'public-1-2-manual'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_PRODUCT_UNAVAILABLE' then
    raise exception 'MANUAL_AVAILABILITY_FAILED: %', v_result;
  end if;

  if has_table_privilege(
       'service_role',
       'public.ecommerce_published_product_variants',
       'INSERT,UPDATE,DELETE'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_option_groups',
       'INSERT,UPDATE,DELETE'
     ) or has_table_privilege(
       'service_role',
       'public.ecommerce_published_options',
       'INSERT,UPDATE,DELETE'
     ) then
    raise exception 'DIRECT_CHILD_DML_STILL_GRANTED';
  end if;

  if has_function_privilege(
       'anon',
       'private.ecommerce_public_configuration_client_fingerprint(uuid,uuid)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'private.ecommerce_enforce_product_configuration_rate_limit(uuid,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'PRIVATE_HELPER_EXECUTE_LEAK';
  end if;

  if (select count(*) from public.pos_sales) <> v_sales
     or (select count(*) from public.pos_cash_movements) <> v_cash
     or (select count(*) from public.pos_inventory_movements) <> v_movements then
    raise exception 'OUT_OF_SCOPE_POS_SIDE_EFFECT';
  end if;
end;
$atomic$;

-- No verified infrastructure header: only the mandatory global bucket.
select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000002'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  '26000000-0000-4000-8000-000000000004'::uuid
);

do $global_without_identity$
declare
  v_result jsonb;
begin
  if private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  ) is not null then
    raise exception 'NO_HEADER_FINGERPRINT_NOT_NULL';
  end if;

  if exists (
    select 1
    from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-license:26000000-0000-4000-8000-000000000001'
      and scope = 'ECOMMERCE_PRODUCT_CONFIGURATION_CLIENT'
  ) then
    raise exception 'CLIENT_BUCKET_CREATED_WITHOUT_IDENTITY';
  end if;

  update public.pos_rpc_rate_limits
  set request_count = 1200,
      blocked_until = null
  where license_key = 'ecommerce-license:26000000-0000-4000-8000-000000000001'
    and device_fingerprint =
      'public-store-global:26000000-0000-4000-8000-000000000002:26000000-0000-4000-8000-000000000004'
    and scope = 'ECOMMERCE_PRODUCT_CONFIGURATION_GLOBAL';

  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000001'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  );
  if coalesce((v_result ->> 'allowed')::boolean, true) is not false
     or v_result ->> 'code' <> 'ECOMMERCE_RATE_LIMITED' then
    raise exception 'GLOBAL_LIMIT_WITHOUT_IDENTITY_FAILED: %', v_result;
  end if;

  if exists (
    select 1
    from public.pos_rpc_rate_limits
    where device_fingerprint ilike '%anonymous%'
  ) then
    raise exception 'ANONYMOUS_BUCKET_EXISTS';
  end if;
end;
$global_without_identity$;

-- An explicitly enabled test header creates isolated HMAC identities.
select set_config(
  'app.settings.ecommerce_public_trusted_ip_header',
  'cf-connecting-ip',
  true
);
create temporary table rate_identity_probe(
  label text,
  fingerprint text
) on commit drop;

select set_config('request.headers', '{"cf-connecting-ip":"10.20.30.40"}', true);
insert into rate_identity_probe
values (
  'a',
  private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  )
);
select set_config('request.headers', '{"cf-connecting-ip":"10.20.30.41"}', true);
insert into rate_identity_probe
values (
  'b',
  private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  )
);

do $identity$
begin
  if (
    select count(distinct fingerprint) <> 2
       or bool_or(fingerprint !~ '^public-store-client:[0-9a-f]{64}$')
       or bool_or(fingerprint like '%10.20.30.%')
    from rate_identity_probe
  ) then
    raise exception 'HMAC_IDENTITY_ISOLATION_FAILED';
  end if;
end;
$identity$;

-- Client A can be limited without blocking client B.
select set_config('request.headers', '{"cf-connecting-ip":"10.20.30.40"}', true);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000012'::uuid,
  '26000000-0000-4000-8000-000000000011'::uuid,
  '26000000-0000-4000-8000-000000000014'::uuid
);
update public.pos_rpc_rate_limits
set request_count = 60,
    blocked_until = null
where license_key = 'ecommerce-license:26000000-0000-4000-8000-000000000011'
  and scope = 'ECOMMERCE_PRODUCT_CONFIGURATION_CLIENT';

do $client_a$
declare
  v_result jsonb;
begin
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    '26000000-0000-4000-8000-000000000012'::uuid,
    '26000000-0000-4000-8000-000000000011'::uuid,
    '26000000-0000-4000-8000-000000000014'::uuid
  );
  if coalesce((v_result ->> 'allowed')::boolean, true) is not false then
    raise exception 'CLIENT_A_LIMIT_FAILED: %', v_result;
  end if;
end;
$client_a$;
select set_config('request.headers', '{"cf-connecting-ip":"10.20.30.41"}', true);

do $client_b$
declare
  v_result jsonb;
begin
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    '26000000-0000-4000-8000-000000000012'::uuid,
    '26000000-0000-4000-8000-000000000011'::uuid,
    '26000000-0000-4000-8000-000000000014'::uuid
  );
  if coalesce((v_result ->> 'allowed')::boolean, false) is not true then
    raise exception 'CLIENT_B_BLOCKED_BY_A: %', v_result;
  end if;
end;
$client_b$;

-- The global threshold blocks even when an individual identity exists.
select set_config('request.headers', '{"cf-connecting-ip":"10.20.30.40"}', true);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000022'::uuid,
  '26000000-0000-4000-8000-000000000021'::uuid,
  '26000000-0000-4000-8000-000000000024'::uuid
);
update public.pos_rpc_rate_limits
set request_count = 1200,
    blocked_until = null
where license_key = 'ecommerce-license:26000000-0000-4000-8000-000000000021'
  and device_fingerprint =
    'public-store-global:26000000-0000-4000-8000-000000000022:26000000-0000-4000-8000-000000000024'
  and scope = 'ECOMMERCE_PRODUCT_CONFIGURATION_GLOBAL';

do $global_with_identity$
declare
  v_result jsonb;
begin
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    '26000000-0000-4000-8000-000000000022'::uuid,
    '26000000-0000-4000-8000-000000000021'::uuid,
    '26000000-0000-4000-8000-000000000024'::uuid
  );
  if coalesce((v_result ->> 'allowed')::boolean, true) is not false
     or v_result ->> 'code' <> 'ECOMMERCE_RATE_LIMITED' then
    raise exception 'GLOBAL_LIMIT_WITH_IDENTITY_FAILED: %', v_result;
  end if;
end;
$global_with_identity$;

-- Product and portal global buckets remain distinct.
select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000032'::uuid,
  '26000000-0000-4000-8000-000000000031'::uuid,
  '26000000-0000-4000-8000-000000000034'::uuid
);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000032'::uuid,
  '26000000-0000-4000-8000-000000000031'::uuid,
  '26000000-0000-4000-8000-000000000035'::uuid
);
select private.ecommerce_enforce_product_configuration_rate_limit(
  '26000000-0000-4000-8000-000000000033'::uuid,
  '26000000-0000-4000-8000-000000000031'::uuid,
  '26000000-0000-4000-8000-000000000034'::uuid
);

do $privacy$
begin
  if not exists (
    select 1 from public.pos_rpc_rate_limits
    where device_fingerprint =
      'public-store-global:26000000-0000-4000-8000-000000000032:26000000-0000-4000-8000-000000000034'
  ) or not exists (
    select 1 from public.pos_rpc_rate_limits
    where device_fingerprint =
      'public-store-global:26000000-0000-4000-8000-000000000032:26000000-0000-4000-8000-000000000035'
  ) or not exists (
    select 1 from public.pos_rpc_rate_limits
    where device_fingerprint =
      'public-store-global:26000000-0000-4000-8000-000000000033:26000000-0000-4000-8000-000000000034'
  ) then
    raise exception 'GLOBAL_BUCKET_SCOPE_FAILED';
  end if;

  if exists (
    select 1
    from public.pos_rpc_rate_limits
    where device_fingerprint like '%10.20.30.%'
       or metadata::text like '%10.20.30.%'
       or metadata::text ilike '%cf-connecting-ip%'
       or metadata::text ilike '%x-real-ip%'
       or metadata::text ilike '%x-forwarded-for%'
  ) then
    raise exception 'RATE_LIMIT_PII_PERSISTED';
  end if;

  if has_table_privilege(
       'service_role',
       'private.ecommerce_public_rate_limit_secret',
       'SELECT'
     ) then
    raise exception 'RATE_LIMIT_SECRET_SELECT_LEAK';
  end if;
end;
$privacy$;

-- Missing and malformed headers fail to NULL.
select set_config(
  'app.settings.ecommerce_public_trusted_ip_header',
  'cf-connecting-ip',
  true
);

do $invalid_headers$
begin
  perform set_config('request.headers', '{}', true);
  if private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  ) is not null then
    raise exception 'EMPTY_HEADERS_NOT_NULL';
  end if;

  perform set_config(
    'request.headers',
    '{"cf-connecting-ip":"not-an-ip"}',
    true
  );
  if private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  ) is not null then
    raise exception 'INVALID_IP_NOT_NULL';
  end if;

  perform set_config('request.headers', 'not-json', true);
  if private.ecommerce_public_configuration_client_fingerprint(
    '26000000-0000-4000-8000-000000000002'::uuid,
    '26000000-0000-4000-8000-000000000004'::uuid
  ) is not null then
    raise exception 'INVALID_JSON_NOT_NULL';
  end if;
end;
$invalid_headers$;

rollback;