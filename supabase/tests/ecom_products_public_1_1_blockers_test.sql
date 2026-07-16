-- ECOM.PRODUCTS.PUBLIC.1.1 blockers regression matrix.
-- Synthetic data only. The entire matrix is rolled back.

begin;

do $test$
declare
  v_license uuid := '21000000-0000-4000-8000-000000000001';
  v_portal uuid := '21000000-0000-4000-8000-000000000002';
  v_product uuid := '21000000-0000-4000-8000-000000000003';
  v_variant uuid := '21000000-0000-4000-8000-000000000004';
  v_group uuid := '21000000-0000-4000-8000-000000000005';
  v_option uuid := '21000000-0000-4000-8000-000000000006';
  v_simple uuid := '21000000-0000-4000-8000-000000000007';
  v_result jsonb;
  v_revision text;
  v_changed text;
  v_manual_off_revision text;
  v_client_a text;
  v_client_b text;
  v_sales bigint;
  v_cash bigint;
  v_movements bigint;
  v_order_id uuid;
begin
  select count(*) into v_sales from public.pos_sales;
  select count(*) into v_cash from public.pos_cash_movements;
  select count(*) into v_movements from public.pos_inventory_movements;

  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (
    v_license,
    'ECOM-PUBLIC-1-1-ROLLBACK',
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
    v_portal, v_license, 'ecom-public-1-1-rollback', 'published',
    'PUBLIC 1.1 rollback', true, true, false
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

  -- Stable canonical revision and relevant content changes.
  v_revision := private.ecommerce_product_configuration_revision(v_product);
  if v_revision !~ '^[0-9a-f]{64}$' then
    raise exception 'REVISION_FORMAT_FAILED';
  end if;
  if private.ecommerce_product_configuration_revision(v_product) <> v_revision then
    raise exception 'REVISION_STABILITY_FAILED';
  end if;

  update public.ecommerce_published_options set price_delta = 6 where id = v_option;
  v_changed := private.ecommerce_product_configuration_revision(v_product);
  if v_changed = v_revision then raise exception 'PRICE_DELTA_REVISION_FAILED'; end if;
  update public.ecommerce_published_options set price_delta = 5 where id = v_option;

  update public.ecommerce_published_product_variants set price_value = 11 where id = v_variant;
  if private.ecommerce_product_configuration_revision(v_product) = v_revision then
    raise exception 'VARIANT_PRICE_REVISION_FAILED';
  end if;
  update public.ecommerce_published_product_variants set price_value = 10 where id = v_variant;

  update public.ecommerce_published_option_groups set max_select = 3 where id = v_group;
  if private.ecommerce_product_configuration_revision(v_product) = v_revision then
    raise exception 'GROUP_REVISION_FAILED';
  end if;
  update public.ecommerce_published_option_groups set max_select = 2 where id = v_group;

  -- Volatile exact stock quantity does not change the configuration revision.
  update public.ecommerce_published_product_variants set stock_snapshot = 19 where id = v_variant;
  if private.ecommerce_product_configuration_revision(v_product) <> v_revision then
    raise exception 'VOLATILE_STOCK_CHANGED_REVISION';
  end if;
  update public.ecommerce_published_product_variants set stock_snapshot = 20 where id = v_variant;

  -- Parent manual availability is always authoritative.
  update public.ecommerce_published_products set manual_available = false where id = v_product;
  v_manual_off_revision := private.ecommerce_product_configuration_revision(v_product);
  if private.ecommerce_product_publicly_available((
    select p from public.ecommerce_published_products p where id = v_product
  )) then
    raise exception 'MANUAL_PARENT_AVAILABLE_FAILED';
  end if;

  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.10"}', true);
  v_result := public.ecommerce_get_product_configuration(
    'ecom-public-1-1-rollback', v_product
  );
  if coalesce((v_result #>> '{product,isAvailable}')::boolean, true) then
    raise exception 'DETAIL_MANUAL_AVAILABLE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
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
      'configurationRevision', v_manual_off_revision
    )),
    'public-1-1-manual-off'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_PRODUCT_UNAVAILABLE' then
    raise exception 'CHECKOUT_MANUAL_AVAILABLE_FAILED: %', v_result;
  end if;

  -- The technical requires_configuration gate may keep parent is_available false,
  -- but a manually enabled parent with a valid variant is publicly purchasable.
  update public.ecommerce_published_products set manual_available = true where id = v_product;
  v_revision := private.ecommerce_product_configuration_revision(v_product);
  if private.ecommerce_product_publicly_available((
    select p from public.ecommerce_published_products p where id = v_product
  )) is not true then
    raise exception 'TECHNICAL_PARENT_GATE_FAILED';
  end if;

  -- Missing and stale revisions are rejected.
  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object(
      'productId',v_product,'quantity',1,'variantId',v_variant,
      'selections',jsonb_build_array(jsonb_build_object(
        'groupId',v_group,'optionIds',jsonb_build_array(v_option)
      ))
    )),
    'public-1-1-missing-revision'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_CONFIGURATION_CHANGED' then
    raise exception 'MISSING_REVISION_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object(
      'productId',v_product,'quantity',1,'variantId',v_variant,
      'selections',jsonb_build_array(jsonb_build_object(
        'groupId',v_group,'optionIds',jsonb_build_array(v_option)
      )),
      'configurationVersion',1,
      'configurationRevision',v_manual_off_revision
    )),
    'public-1-1-stale-revision'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_CONFIGURATION_CHANGED' then
    raise exception 'STALE_REVISION_FAILED: %', v_result;
  end if;

  -- Current revision succeeds; client price is ignored; snapshot stores revision.
  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object(
      'productId',v_product,'quantity',1,'variantId',v_variant,
      'selections',jsonb_build_array(jsonb_build_object(
        'groupId',v_group,'optionIds',jsonb_build_array(v_option)
      )),
      'configurationVersion',1,
      'configurationRevision',v_revision,
      'price',9999
    )),
    'public-1-1-valid'
  );
  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    raise exception 'VALID_CHECKOUT_FAILED: %', v_result;
  end if;
  v_order_id := (v_result #>> '{order,id}')::uuid;
  if (
    select options ->> 'configurationRevision'
    from public.ecommerce_order_items
    where order_id = v_order_id
    limit 1
  ) <> v_revision then
    raise exception 'SNAPSHOT_REVISION_FAILED';
  end if;
  if (
    select unit_price
    from public.ecommerce_order_items
    where order_id = v_order_id
    limit 1
  ) <> 115 then
    raise exception 'SERVER_PRICE_FAILED';
  end if;

  -- Replay remains before mutable validation.
  update public.ecommerce_published_options set price_delta = 7 where id = v_option;
  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
    '{}'::jsonb,
    '[]'::jsonb,
    'public-1-1-valid'
  );
  if coalesce((v_result ->> 'success')::boolean, false) is not true
     or coalesce((v_result ->> 'idempotent')::boolean, false) is not true
     or (v_result #>> '{order,id}')::uuid <> v_order_id then
    raise exception 'IDEMPOTENT_REPLAY_ORDER_FAILED: %', v_result;
  end if;

  -- Simple legacy product still needs no content revision.
  v_result := public.ecommerce_create_order(
    'ecom-public-1-1-rollback',
    jsonb_build_object('name','Cliente QA','phone','9610000000','fulfillmentMethod','pickup'),
    jsonb_build_array(jsonb_build_object('productId',v_simple,'quantity',1)),
    'public-1-1-simple'
  );
  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    raise exception 'SIMPLE_LEGACY_FAILED: %', v_result;
  end if;

  -- Client identity and limit isolation.
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.10"}', true);
  v_client_a := private.ecommerce_public_configuration_client_fingerprint(v_portal, v_product);
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.11"}', true);
  v_client_b := private.ecommerce_public_configuration_client_fingerprint(v_portal, v_product);
  if v_client_a = v_client_b then raise exception 'FINGERPRINT_ISOLATION_FAILED'; end if;
  if v_client_a like '%203.0.113.10%' or v_client_b like '%203.0.113.11%' then
    raise exception 'PLAINTEXT_IP_FINGERPRINT_FAILED';
  end if;

  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.10"}', true);
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    v_portal, v_license, v_product
  );
  if coalesce((v_result ->> 'allowed')::boolean, false) is not true then
    raise exception 'CLIENT_A_INITIAL_FAILED';
  end if;
  update public.pos_rpc_rate_limits
  set request_count = 60
  where license_key = 'ecommerce-license:' || v_license::text
    and device_fingerprint = v_client_a
    and rpc_name = 'ecommerce_get_product_configuration'
    and scope = 'ECOMMERCE_PRODUCT_CONFIGURATION_CLIENT';
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    v_portal, v_license, v_product
  );
  if coalesce((v_result ->> 'allowed')::boolean, true) is not false then
    raise exception 'CLIENT_A_LIMIT_FAILED: %', v_result;
  end if;

  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.11"}', true);
  v_result := private.ecommerce_enforce_product_configuration_rate_limit(
    v_portal, v_license, v_product
  );
  if coalesce((v_result ->> 'allowed')::boolean, false) is not true then
    raise exception 'CLIENT_B_ISOLATION_FAILED: %', v_result;
  end if;

  if exists (
    select 1
    from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-license:' || v_license::text
      and (
        device_fingerprint like '%203.0.113.%'
        or metadata::text like '%203.0.113.%'
        or metadata::text like '%cf-connecting-ip%'
      )
  ) then
    raise exception 'RATE_LIMIT_PII_STORAGE_FAILED';
  end if;

  -- No POS, cash, inventory or reservation effects.
  if (select count(*) from public.pos_sales) <> v_sales
     or (select count(*) from public.pos_cash_movements) <> v_cash
     or (select count(*) from public.pos_inventory_movements) <> v_movements then
    raise exception 'OUT_OF_SCOPE_SIDE_EFFECT_FAILED';
  end if;
end;
$test$;

rollback;
