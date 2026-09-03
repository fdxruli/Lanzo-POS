-- CLOUD LAYAWAYS READ RPC SERIALIZATION HARDENING R1
-- Run only after the hardening migration in an isolated test database.
-- The feature flag below belongs to synthetic fixtures and is rolled back.
-- No production license or feature is changed by this test.

begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_features jsonb := jsonb_build_object(
    'cloud_layaways', true,
    'cloud_pos_sync', true,
    'cloud_sales_sync_base', true,
    'cloud_sales_cashier', true,
    'cloud_cash_sync', true,
    'cloud_products_sync', true,
    'cloud_sales_inventory', true
  );
  v_license_a uuid := extensions.gen_random_uuid();
  v_license_b uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_staff_a uuid := extensions.gen_random_uuid();
  v_session_a uuid := extensions.gen_random_uuid();
  v_station_a text := 'read-hardening-station-a-' || v_suffix;
  v_cash_session_a text := 'read-hardening-cash-a-' || v_suffix;
  v_layaway_a text := 'read-hardening-layaway-a-' || v_suffix;
  v_layaway_b text := 'read-hardening-layaway-b-' || v_suffix;
  v_payment_a text := 'read-hardening-payment-a-' || v_suffix;
  v_reservation_a text := 'read-hardening-reservation-a-' || v_suffix;
  v_cash_movement_a text := 'read-hardening-cash-movement-a-' || v_suffix;
  v_inventory_movement_a text := 'read-hardening-inventory-movement-a-' || v_suffix;
  v_license_key_a text := 'read-hardening-license-a-' || v_suffix;
  v_fingerprint_a text := 'read-hardening-device-a-' || v_suffix;
  v_device_token_a text := 'read-hardening-device-token-a-' || v_suffix;
  v_staff_token_a text := 'read-hardening-staff-token-a-' || v_suffix;
  v_actor_key_a text := 'secret-actor-a-' || v_suffix;
  v_get jsonb;
  v_pull jsonb;
begin
  insert into public.licenses(
    id, license_key, license_type, max_devices, status, product_name, features
  ) values
    (v_license_a, v_license_key_a, 'pro', 2, 'active', 'Read serialization fixture A', v_features),
    (v_license_b, 'read-hardening-license-b-' || v_suffix, 'pro', 2, 'active', 'Read serialization fixture B', v_features);

  insert into public.license_staff_users(
    id, license_id, username, display_name, password_hash, permissions, is_active
  ) values (
    v_staff_a,
    v_license_a,
    'read_hardening_staff_' || v_suffix,
    'Read hardening staff',
    extensions.crypt('fixture-password-' || v_suffix, extensions.gen_salt('bf', 4)),
    '{"pos":true}'::jsonb,
    true
  );

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode, staff_user_id
  ) values (
    v_device_a,
    v_license_a,
    v_fingerprint_a,
    'Read hardening device',
    '{}'::jsonb,
    true,
    v_device_token_a,
    'staff',
    'staff_only',
    v_staff_a
  );

  insert into public.license_staff_sessions(
    id, license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_session_a,
    v_license_a,
    v_staff_a,
    v_device_a,
    extensions.crypt(v_staff_token_a, extensions.gen_salt('bf', 4)),
    now() + interval '1 hour'
  );

  insert into public.pos_cash_stations(
    id, license_id, station_key, status, binding_mode
  ) values (
    v_station_a,
    v_license_a,
    'read-hardening-station-key-' || v_suffix,
    'active',
    'explicit'
  );

  insert into public.pos_cash_station_bindings(
    license_id, cash_station_id, device_id, binding_mode, status
  ) values (
    v_license_a,
    v_station_a,
    v_device_a,
    'explicit',
    'active'
  );

  insert into public.pos_cash_sessions(
    id, license_id, device_id, staff_user_id, device_role, scope,
    actor_key, status, responsible_name, cash_station_id
  ) values (
    v_cash_session_a,
    v_license_a,
    v_device_a,
    v_staff_a,
    'staff',
    'actor',
    v_actor_key_a,
    'open',
    'Read hardening staff',
    v_station_a
  );

  insert into public.pos_layaways(
    id, license_id, customer_id, customer_name, customer_phone,
    total_amount, paid_amount, balance_due, currency, deadline, status, items,
    cash_station_id, actor_key, actor_name, conversion_sale_id, refund_id,
    refund_cash_movement_id, retained_money, retained_amount, notes,
    server_version, last_idempotency_key, metadata
  ) values (
    v_layaway_a,
    v_license_a,
    'customer-a',
    'Public Customer A',
    '+52-555-0100',
    10,
    10,
    0,
    'MXN',
    now() + interval '7 days',
    'ready',
    jsonb_build_array(jsonb_build_object(
      'id', 'line-a',
      'product_id', 'product-a',
      'product_name', 'Public Product A',
      'product_sku', 'SKU-A',
      'barcode', 'BAR-A',
      'batch_id', 'batch-a',
      'batch_sku', 'BATCH-SKU-A',
      'quantity', 1,
      'unit_price', 10,
      'line_subtotal', 10,
      'line_total', 10,
      'unit_cost', 999,
      'token', 'item-token-a-' || v_suffix,
      'metadata', jsonb_build_object('secret', 'item-metadata-secret-' || v_suffix),
      'attributes', jsonb_build_object('secret', 'item-attributes-secret-' || v_suffix)
    )),
    v_station_a,
    v_actor_key_a,
    'Internal Actor A',
    'sale-a',
    'refund-a',
    'refund-movement-a',
    false,
    0,
    'Internal note A',
    7,
    'layaway-idempotency-a-' || v_suffix,
    jsonb_build_object('secret', 'layaway-metadata-secret-' || v_suffix)
  );

  insert into public.pos_layaways(
    id, license_id, customer_id, customer_name, total_amount, paid_amount,
    balance_due, currency, deadline, status, items, actor_key, actor_name
  ) values (
    v_layaway_b,
    v_license_b,
    'customer-b',
    'Private Customer B',
    20,
    0,
    20,
    'MXN',
    now() + interval '7 days',
    'active',
    '[]'::jsonb,
    'tenant-b-actor',
    'Tenant B actor'
  );

  insert into public.pos_layaway_payments(
    id, license_id, layaway_id, payment_method, amount, status,
    cash_session_id, cash_station_id, cash_movement_id, reference,
    request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
    actor_key, actor_name, metadata
  ) values (
    v_payment_a,
    v_license_a,
    v_layaway_a,
    'cash',
    10,
    'confirmed',
    v_cash_session_a,
    v_station_a,
    v_cash_movement_a,
    'payment-reference-secret-' || v_suffix,
    'payment-request-hash-secret-' || v_suffix,
    'payment-idempotency-secret-' || v_suffix,
    v_device_a,
    v_staff_a,
    v_actor_key_a,
    'Internal Actor A',
    jsonb_build_object(
      'payment_type', 'initial_deposit',
      'secret', 'payment-metadata-secret-' || v_suffix
    )
  );

  insert into public.pos_layaway_inventory_reservations(
    id, license_id, layaway_id, item_index, product_id, batch_id, quantity,
    unit_cost, stock_before, stock_after, committed_before, committed_after,
    status, created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
    idempotency_key, metadata
  ) values (
    v_reservation_a,
    v_license_a,
    v_layaway_a,
    1,
    'product-a',
    'batch-a',
    1,
    999,
    100,
    99,
    4,
    5,
    'reserved',
    v_device_a,
    v_staff_a,
    v_actor_key_a,
    'Internal Actor A',
    'reservation-idempotency-secret-' || v_suffix,
    jsonb_build_object('secret', 'reservation-metadata-secret-' || v_suffix)
  );

  insert into public.pos_cash_movements(
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, reference_type, reference_id,
    created_by_device_id, created_by_staff_user_id, actor_name, created_at,
    server_version, idempotency_key, metadata, deleted_at, sale_id,
    customer_ledger_id, cash_station_id, performed_by_actor_key
  ) values (
    v_cash_movement_a,
    v_license_a,
    v_cash_session_a,
    v_device_a,
    v_staff_a,
    v_actor_key_a,
    'entrada',
    10,
    'Layaway read fixture',
    'layaway_payment',
    'layaway',
    v_layaway_a,
    v_device_a,
    v_staff_a,
    'Internal Actor A',
    now(),
    3,
    'cash-idempotency-secret-' || v_suffix,
    jsonb_build_object(
      'layaway_id', v_layaway_a,
      'payment_id', v_payment_a,
      'secret', 'cash-metadata-secret-' || v_suffix
    ),
    null,
    null,
    null,
    v_station_a,
    'performed-by-secret-' || v_suffix
  );

  insert into public.pos_inventory_movements(
    id, license_id, product_id, batch_id, sale_id, sale_item_id,
    movement_type, quantity, previous_stock, new_stock, previous_batch_stock,
    new_batch_stock, unit_cost, total_cost, reason, source, actor_device_id,
    actor_staff_user_id, actor_key, actor_name, idempotency_key, metadata,
    created_at, server_version
  ) values (
    v_inventory_movement_a,
    v_license_a,
    'product-a',
    'batch-a',
    'sale-internal-a',
    'sale-item-internal-a',
    'sale_out',
    1,
    100,
    99,
    20,
    19,
    999,
    999,
    'Layaway inventory fixture',
    'sale',
    v_device_a,
    v_staff_a,
    v_actor_key_a,
    'Internal Actor A',
    'inventory-idempotency-secret-' || v_suffix,
    jsonb_build_object(
      'layaway_id', v_layaway_a,
      'secret', 'inventory-metadata-secret-' || v_suffix
    ),
    now(),
    4
  );

  insert into public.pos_sync_events(
    license_id, entity_type, entity_id, operation, server_version,
    actor_device_id, actor_staff_user_id, idempotency_key, metadata
  ) values (
    v_license_a, 'layaway', v_layaway_a, 'create', 7,
    v_device_a, v_staff_a, 'event-idempotency-secret-' || v_suffix,
    jsonb_build_object('secret', 'event-metadata-secret-' || v_suffix)
  );
  insert into public.pos_sync_events(
    license_id, entity_type, entity_id, operation, server_version, metadata
  ) values (
    v_license_b, 'layaway', v_layaway_b, 'create', 1,
    jsonb_build_object('secret', 'tenant-b-event-secret-' || v_suffix)
  );

  v_get := public.pos_get_layaway(
    v_license_key_a,
    v_fingerprint_a,
    v_device_token_a,
    v_staff_token_a,
    v_layaway_a
  );

  if coalesce((v_get->>'success')::boolean, false) is not true
     or v_get->'layaway'->>'customer_name' <> 'Public Customer A'
     or v_get->'layaway'->>'total_amount' <> '10'
     or v_get->'layaway'->'items'->0->>'product_id' <> 'product-a'
     or v_get->'layaway'->'items'->0->>'unit_price' <> '10'
     or v_get->'payments'->0->>'payment_type' <> 'initial_deposit'
     or v_get->'payments'->0->>'amount' <> '10'
     or v_get->'inventory_reservations'->0->>'product_id' <> 'product-a'
     or v_get->'cash_movements'->0->>'payment_id' <> v_payment_a
     or v_get->'inventory_movements'->0->>'layaway_id' <> v_layaway_a then
    raise exception 'PUBLIC_ALLOWLIST_FIELD_MISSING';
  end if;

  if (v_get->'layaway') ?| array[
       'license_id', 'cash_station_id', 'actor_key', 'last_idempotency_key',
       'metadata', 'refund_id', 'refund_cash_movement_id'
     ]
     or (v_get->'layaway'->'items'->0) ?| array[
       'unit_cost', 'token', 'metadata', 'attributes', 'variant_attributes'
     ]
     or (v_get->'payments'->0) ?| array[
       'license_id', 'cash_session_id', 'cash_station_id', 'request_hash',
       'idempotency_key', 'created_by_device_id', 'created_by_staff_user_id',
       'actor_key', 'actor_name', 'metadata', 'reference'
     ]
     or (v_get->'inventory_reservations'->0) ?| array[
       'license_id', 'unit_cost', 'stock_before', 'stock_after',
       'committed_before', 'committed_after', 'idempotency_key',
       'created_by_device_id', 'created_by_staff_user_id', 'actor_key',
       'actor_name', 'metadata'
     ]
     or (v_get->'cash_movements'->0) ?| array[
       'license_id', 'cash_session_id', 'device_id', 'staff_user_id',
       'actor_key', 'created_by_device_id', 'created_by_staff_user_id',
       'actor_name', 'idempotency_key', 'metadata', 'cash_station_id',
       'performed_by_actor_key', 'deleted_at'
     ]
     or (v_get->'inventory_movements'->0) ?| array[
       'license_id', 'sale_id', 'sale_item_id', 'unit_cost', 'total_cost',
       'previous_stock', 'new_stock', 'previous_batch_stock', 'new_batch_stock',
       'actor_device_id', 'actor_staff_user_id', 'actor_key', 'actor_name',
       'idempotency_key', 'metadata'
     ] then
    raise exception 'INTERNAL_FIELD_EXPOSED';
  end if;

  if v_get::text like any (array[
       '%item-token-a-%',
       '%layaway-metadata-secret-%',
       '%payment-request-hash-secret-%',
       '%payment-idempotency-secret-%',
       '%reservation-metadata-secret-%',
       '%cash-metadata-secret-%',
       '%inventory-metadata-secret-%',
       '%performed-by-secret-%'
     ]) then
    raise exception 'SENSITIVE_VALUE_EXPOSED';
  end if;

  v_pull := public.pos_pull_layaway_changes(
    v_license_key_a,
    v_fingerprint_a,
    v_device_token_a,
    v_staff_token_a,
    0,
    500
  );

  if jsonb_array_length(v_pull->'layaways') <> 1
     or v_pull->'layaways'->0->>'id' <> v_layaway_a
     or v_pull::text like '%read-hardening-layaway-b-%'
     or v_pull::text like any (array[
       '%payment-request-hash-secret-%',
       '%reservation-metadata-secret-%',
       '%cash-metadata-secret-%',
       '%inventory-metadata-secret-%'
     ]) then
    raise exception 'PULL_TENANT_OR_SERIALIZATION_FAILURE';
  end if;

  begin
    perform public.pos_get_layaway(
      v_license_key_a,
      v_fingerprint_a,
      v_device_token_a,
      v_staff_token_a,
      v_layaway_b
    );
    raise exception 'TENANT_ISOLATION_FAILURE';
  exception when sqlstate 'P0001' then
    if position('LAYAWAY_NOT_FOUND' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    perform public.pos_get_layaway(
      v_license_key_a,
      v_fingerprint_a,
      'invalid-device-token',
      v_staff_token_a,
      v_layaway_a
    );
    raise exception 'DEVICE_TOKEN_REJECTION_FAILURE';
  exception when sqlstate 'P0001' then
    if position('DEVICE_TOKEN_INVALID' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    perform public.pos_get_layaway(
      v_license_key_a,
      v_fingerprint_a,
      v_device_token_a,
      'invalid-staff-token',
      v_layaway_a
    );
    raise exception 'STAFF_TOKEN_REJECTION_FAILURE';
  exception when sqlstate 'P0001' then
    if position('ACTOR_SESSION_INVALID' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$test$;

rollback;
