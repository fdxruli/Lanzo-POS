-- ECOMMERCE_PRICE_CONFIRMATION_V1
-- Synthetic transaction only. Requires the canonical migration to be installed
-- in an isolated database; the final ROLLBACK removes every fixture and order.
begin;

select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);

do $price_confirmation$
declare
  v_license uuid := '41000000-0000-4000-8000-000000000001';
  v_portal uuid := '41000000-0000-4000-8000-000000000002';
  v_product uuid := '41000000-0000-4000-8000-000000000003';
  v_customer jsonb := '{"name":"Cliente QA","phone":"9610000000","fulfillmentMethod":"pickup"}'::jsonb;
  v_accepted_100 jsonb := '{"pricingMode":"standard","baseUnitPrice":"100.00","appliedUnitPrice":"100.00","variantAdjustment":"0.00","optionsAdjustment":"0.00","lineTotal":"100.00"}'::jsonb;
  v_accepted_120 jsonb := '{"pricingMode":"standard","baseUnitPrice":"120.00","appliedUnitPrice":"120.00","variantAdjustment":"0.00","optionsAdjustment":"0.00","lineTotal":"120.00"}'::jsonb;
  v_accepted_80 jsonb := '{"pricingMode":"standard","baseUnitPrice":"80.00","appliedUnitPrice":"80.00","variantAdjustment":"0.00","optionsAdjustment":"0.00","lineTotal":"80.00"}'::jsonb;
  v_items jsonb;
  v_result jsonb;
  v_first_order uuid;
  v_replay_guard_count integer;
  v_orders_before bigint;
  v_items_before bigint;
  v_events_before bigint;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (
    v_license, 'ECOM-PRICE-CONFIRMATION-V1-ROLLBACK', 'free', 'active',
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
    pickup_enabled, business_hours_enabled, timezone
  ) values (
    v_portal, v_license, 'ecom-price-confirmation-v1-rollback',
    'published', 'Price confirmation fixture', true, true, false,
    'America/Mexico_City'
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, local_product_ref, public_name, price,
    is_published, is_available, manual_available, source_available,
    configuration_type, has_variants, has_option_groups,
    requires_configuration, availability_source, stock_mode, source_state
  ) values (
    v_product, v_portal, v_license, 'price-fixture', 'Producto QA', 100,
    true, true, true, true, 'simple', false, false,
    false, 'not_tracked', 'hidden', 'not_tracked'
  );

  select count(*) into v_orders_before from public.ecommerce_orders where portal_id = v_portal;
  select count(*) into v_items_before from public.ecommerce_order_items where portal_id = v_portal;
  select count(*) into v_events_before from public.ecommerce_order_events where portal_id = v_portal;

  -- The patch must protect both the initial replay lookup and the unique_violation race path.
  select (length(p.prosrc) - length(replace(p.prosrc, 'v_existing_acceptance_hash:=nullif', '')))
         / length('v_existing_acceptance_hash:=nullif')
    into v_replay_guard_count
  from pg_proc p
  where p.oid = 'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure;
  if v_replay_guard_count <> 2 then
    raise exception 'P1_BOTH_IDEMPOTENCY_PATHS_NOT_GUARDED: %', v_replay_guard_count;
  end if;

  -- P1-01: current $100 matches explicit acceptance.
  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_100
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-accept-100'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result #>> '{order,total}')::numeric <> 100 then
    raise exception 'P1_01_ACCEPTED_PRICE_FAILED: %', v_result;
  end if;
  v_first_order := (v_result #>> '{order,id}')::uuid;

  -- A replay with identical request content returns the original order.
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-accept-100'
  );
  if coalesce((v_result->>'idempotent')::boolean, false) is not true
     or (v_result #>> '{order,id}')::uuid <> v_first_order then
    raise exception 'P1_IDEMPOTENT_REPLAY_FAILED: %', v_result;
  end if;

  -- Reusing the key with a changed accepted amount is a conflict, never a replay.
  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_120
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-accept-100'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_IDEMPOTENCY_CONFLICT' then
    raise exception 'P1_CHANGED_ACCEPTANCE_REPLAYED: %', v_result;
  end if;

  -- P1-02: raising the published price rejects old acceptance with no side effects.
  update public.ecommerce_published_products set price = 120 where id = v_product;
  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_100
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-stale-100'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED' then
    raise exception 'P1_02_INCREASE_NOT_REJECTED: %', v_result;
  end if;
  if (select count(*) from public.ecommerce_orders where portal_id = v_portal) <> v_orders_before + 1
     or (select count(*) from public.ecommerce_order_items where portal_id = v_portal) <> v_items_before + 1
     or (select count(*) from public.ecommerce_order_events where portal_id = v_portal) <> v_events_before + 1 then
    raise exception 'P1_02_REJECTION_LEFT_SIDE_EFFECTS';
  end if;

  -- P1-04: a separate acceptance of $120 creates one order at exactly $120.
  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_120
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-accept-120'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result #>> '{order,total}')::numeric <> 120 then
    raise exception 'P1_04_NEW_PRICE_ACCEPTANCE_FAILED: %', v_result;
  end if;

  -- P1-03: lowering the price also requires new acceptance.
  update public.ecommerce_published_products set price = 80 where id = v_product;
  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_120
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-stale-120'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED' then
    raise exception 'P1_03_DECREASE_NOT_REJECTED: %', v_result;
  end if;

  v_items := jsonb_build_array(jsonb_build_object(
    'productId', v_product, 'quantity', 1, 'acceptedPricing', v_accepted_80
  ));
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer, v_items, 'price-accept-80'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result #>> '{order,total}')::numeric <> 80 then
    raise exception 'P1_03_NEW_LOWER_PRICE_ACCEPTANCE_FAILED: %', v_result;
  end if;

  -- Legacy clients are rejected safely before any order side effect.
  v_result := public.ecommerce_create_order(
    'ecom-price-confirmation-v1-rollback', v_customer,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'price-legacy-without-acceptance'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_CATALOG_REVISION_CHANGED' then
    raise exception 'P1_LEGACY_REQUEST_NOT_REJECTED: %', v_result;
  end if;

  if (select count(*) from public.ecommerce_orders where portal_id = v_portal) <> v_orders_before + 3
     or (select count(*) from public.ecommerce_order_items where portal_id = v_portal) <> v_items_before + 3
     or (select count(*) from public.ecommerce_order_events where portal_id = v_portal) <> v_events_before + 3
     or (select count(*) from public.ecommerce_orders where id = v_first_order and total = 100) <> 1 then
    raise exception 'P1_FINAL_ORDER_COUNTS_OR_TOTALS_FAILED';
  end if;

  if coalesce((select metadata->>'priceAcceptanceHash' from public.ecommerce_orders where id = v_first_order), '')
     !~ '^[0-9a-f]{64}$' then
    raise exception 'P1_ACCEPTANCE_FINGERPRINT_NOT_STORED';
  end if;
end;
$price_confirmation$;

rollback;
