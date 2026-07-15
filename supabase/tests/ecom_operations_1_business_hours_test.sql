-- ECOM.OPERATIONS.1 remote-safe smoke matrix.
-- All synthetic rows and orders are enclosed in one transaction and rolled back.
begin;

do $test$
declare
  v_license_id uuid := '10000000-0000-4000-8000-000000000001';
  v_portal_id uuid := '10000000-0000-4000-8000-000000000002';
  v_product_id uuid := '10000000-0000-4000-8000-000000000003';
  v_staff_ok uuid := '10000000-0000-4000-8000-000000000005';
  v_staff_denied uuid := '10000000-0000-4000-8000-000000000006';
  v_staff_ok_device uuid := '10000000-0000-4000-8000-000000000007';
  v_staff_denied_device uuid := '10000000-0000-4000-8000-000000000008';
  v_result jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_local_date date := (clock_timestamp() at time zone 'America/Mexico_City')::date;
  v_local_weekday integer := extract(dow from (clock_timestamp() at time zone 'America/Mexico_City'))::integer;
  v_inventory_movements bigint;
  v_sales bigint;
  v_cash_movements bigint;
begin
  select count(*) into v_inventory_movements from public.pos_inventory_movements;
  select count(*) into v_sales from public.pos_sales;
  select count(*) into v_cash_movements from public.pos_cash_movements;

  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (
    v_license_id,
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK',
    'free',
    'active',
    clock_timestamp() + interval '1 day',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_order_inbox', true,
      'ecommerce_business_hours', true,
      'ecommerce_max_published_products', 10,
      'ecommerce_max_open_orders_per_day', 100
    )
  );

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    '10000000-0000-4000-8000-000000000004', v_license_id,
    'ecom-operations-1-device', 'ecom-operations-1-token', true, 'admin'
  );

  insert into public.license_staff_users(
    id, license_id, username, display_name, password_hash, permissions
  ) values
    (v_staff_ok, v_license_id, 'ecom_operations_staff_ok', 'Operations staff allowed',
     extensions.crypt('fixture', extensions.gen_salt('bf')), '{"settings":true,"ecommerce":true}'::jsonb),
    (v_staff_denied, v_license_id, 'ecom_operations_staff_denied', 'Operations staff denied',
     extensions.crypt('fixture', extensions.gen_salt('bf')), '{"settings":true,"ecommerce":false}'::jsonb);

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role, staff_user_id
  ) values
    (v_staff_ok_device, v_license_id, 'ecom-operations-staff-ok', 'ecom-operations-staff-ok-token', true, 'staff', v_staff_ok),
    (v_staff_denied_device, v_license_id, 'ecom-operations-staff-denied', 'ecom-operations-staff-denied-token', true, 'staff', v_staff_denied);

  insert into public.license_staff_sessions(
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values
    (v_license_id, v_staff_ok, v_staff_ok_device,
     extensions.crypt('ecom-operations-session-ok', extensions.gen_salt('bf')), clock_timestamp() + interval '1 hour'),
    (v_license_id, v_staff_denied, v_staff_denied_device,
     extensions.crypt('ecom-operations-session-denied', extensions.gen_salt('bf')), clock_timestamp() + interval '1 hour');

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled,
    business_hours_enabled, timezone
  ) values (
    v_portal_id, v_license_id, 'ecom-operations-1-synthetic', 'published',
    'Synthetic rollback portal', true, true, false, 'America/Mexico_City'
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, public_name, price, is_published, is_available,
    manual_available, source_available
  ) values (
    v_product_id, v_portal_id, v_license_id, 'Synthetic item', 10, true, true, true, true
  );

  select p.* into v_portal from public.ecommerce_portals p where p.id = v_portal_id;
  v_result := private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp());
  if v_result->>'code' <> 'OPEN' or coalesce((v_result->>'acceptingOrders')::boolean, false) is not true then
    raise exception 'TEST_COMPATIBILITY_DISABLED_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-idempotent'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_COMPATIBILITY_ORDER_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_set_order_pause(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, true, 'Synthetic indefinite', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_PAUSE_RPC_INDEFINITE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-idempotent'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'idempotent')::boolean, false) is not true then
    raise exception 'TEST_IDEMPOTENT_RETRY_WHILE_PAUSED_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-paused-new'
  );
  if v_result#>>'{error,code}' <> 'ECOMMERCE_ORDERS_PAUSED' then
    raise exception 'TEST_PAUSE_BLOCK_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_set_order_pause(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, true, 'Synthetic temporary', clock_timestamp() + interval '1 hour'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_PAUSE_RPC_TEMPORARY_FAILED: %', v_result;
  end if;
  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-paused-temporary'
  );
  if v_result#>>'{error,code}' <> 'ECOMMERCE_ORDERS_PAUSED' then
    raise exception 'TEST_TEMPORARY_PAUSE_BLOCK_FAILED: %', v_result;
  end if;

  update public.ecommerce_portals
  set orders_paused_until = clock_timestamp() - interval '1 minute'
  where id = v_portal_id
  returning * into v_portal;
  v_result := private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp());
  if v_result->>'code' <> 'OPEN' or coalesce((v_result->>'manuallyPaused')::boolean, true) then
    raise exception 'TEST_EXPIRED_PAUSE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_set_order_pause(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, false, null, null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'paused')::boolean, true) is not false then
    raise exception 'TEST_PAUSE_RPC_RESUME_FAILED: %', v_result;
  end if;

  update public.ecommerce_portals
  set orders_paused = false, orders_paused_until = null, orders_pause_reason = null,
      business_hours_enabled = true
  where id = v_portal_id;

  insert into public.ecommerce_portal_hours(portal_id, weekday, is_open, opens_at, closes_at)
  select v_portal_id, day, false, null, null from generate_series(0, 6) day;

  update public.ecommerce_portal_hours
  set is_open = true, opens_at = '00:00', closes_at = '23:59:59'
  where portal_id = v_portal_id and weekday = v_local_weekday;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-weekly-open'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_WEEKLY_OPEN_ORDER_FAILED: %', v_result;
  end if;

  insert into public.ecommerce_portal_hour_exceptions(
    portal_id, exception_date, is_open, opens_at, closes_at, reason
  ) values (v_portal_id, v_local_date, false, null, null, 'Synthetic closed');

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-closed'
  );
  if v_result#>>'{error,code}' <> 'ECOMMERCE_STORE_CLOSED' then
    raise exception 'TEST_CLOSED_BLOCK_FAILED: %', v_result;
  end if;

  update public.ecommerce_portal_hours
  set is_open = false, opens_at = null, closes_at = null
  where portal_id = v_portal_id and weekday = v_local_weekday;
  update public.ecommerce_portal_hour_exceptions
  set is_open = true, opens_at = '00:00', closes_at = '23:59:59'
  where portal_id = v_portal_id and exception_date = v_local_date;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-exception-open'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_OPEN_EXCEPTION_FAILED: %', v_result;
  end if;

  delete from public.ecommerce_portal_hour_exceptions
  where portal_id = v_portal_id and exception_date = v_local_date;

  insert into public.ecommerce_portal_hour_exceptions(
    portal_id, exception_date, is_open, opens_at, closes_at, reason
  ) values (
    v_portal_id, date '2026-07-15', true, '08:30', '09:30', 'Fixed timezone boundary'
  );

  select p.* into v_portal from public.ecommerce_portals p where p.id = v_portal_id;
  v_result := private.ecommerce_evaluate_portal_availability(
    v_portal, timestamptz '2026-07-15 15:00:00+00'
  );
  if v_result->>'code' <> 'OPEN' or v_result->>'localNow' <> '2026-07-15T09:00:00' then
    raise exception 'TEST_FIXED_MEXICO_TIMEZONE_FAILED: %', v_result;
  end if;

  update public.ecommerce_portals set timezone = 'America/Tijuana' where id = v_portal_id
  returning * into v_portal;
  v_result := private.ecommerce_evaluate_portal_availability(
    v_portal, timestamptz '2026-07-15 15:00:00+00'
  );
  if v_result->>'code' <> 'OUTSIDE_BUSINESS_HOURS'
     or v_result->>'localNow' <> '2026-07-15T08:00:00'
     or nullif(v_result->>'nextOpenAt', '') is null then
    raise exception 'TEST_FIXED_TIJUANA_TIMEZONE_NEXT_OPEN_FAILED: %', v_result;
  end if;

  update public.ecommerce_portals set timezone = 'America/Mexico_City' where id = v_portal_id;
  delete from public.ecommerce_portal_hour_exceptions
  where portal_id = v_portal_id and exception_date = date '2026-07-15';
  delete from public.ecommerce_portal_hours
  where portal_id = v_portal_id and weekday = v_local_weekday;

  v_result := public.ecommerce_create_order(
    'ecom-operations-1-synthetic',
    jsonb_build_object('name', 'Cliente prueba', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    jsonb_build_array(jsonb_build_object('productId', v_product_id, 'quantity', 1)),
    'ecom-operations-1-missing'
  );
  if v_result#>>'{error,code}' <> 'ECOMMERCE_SCHEDULE_NOT_CONFIGURED' then
    raise exception 'TEST_MISSING_SCHEDULE_FAILED: %', v_result;
  end if;

  update public.ecommerce_portals set ordering_enabled = false where id = v_portal_id
  returning * into v_portal;
  v_result := private.ecommerce_evaluate_portal_availability(v_portal, clock_timestamp());
  if v_result->>'code' <> 'ORDERING_DISABLED' then
    raise exception 'TEST_ORDERING_DISABLED_PRIORITY_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_save_operating_schedule(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, 'Invalid/Timezone', false, '[]'::jsonb, '[]'::jsonb
  );
  if v_result->>'code' <> 'ECOMMERCE_TIMEZONE_INVALID' then
    raise exception 'TEST_INVALID_TIMEZONE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_save_operating_schedule(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, 'America/Mexico_City', true,
    '[{"weekday":1,"isOpen":true,"opensAt":"09:00","closesAt":"18:00"},{"weekday":1,"isOpen":false}]'::jsonb,
    '[]'::jsonb
  );
  if v_result->>'code' <> 'ECOMMERCE_SCHEDULE_DUPLICATE_DAY' then
    raise exception 'TEST_DUPLICATE_DAY_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_save_operating_schedule(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-1-device',
    'ecom-operations-1-token', null, 'America/Mexico_City', true,
    '[{"weekday":2,"isOpen":true,"opensAt":"18:00","closesAt":"09:00"}]'::jsonb,
    '[]'::jsonb
  );
  if v_result->>'code' <> 'ECOMMERCE_SCHEDULE_INVALID'
     or (select count(*) from public.ecommerce_portal_hours where portal_id = v_portal_id) <> 6 then
    raise exception 'TEST_INVALID_INTERVAL_ATOMIC_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_save_operating_schedule(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-staff-denied',
    'ecom-operations-staff-denied-token', 'ecom-operations-session-denied',
    'America/Mexico_City', false, '[]'::jsonb, '[]'::jsonb
  );
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED'
     or (select count(*) from public.ecommerce_portal_hours where portal_id = v_portal_id) <> 6 then
    raise exception 'TEST_STAFF_ECOMMERCE_FALSE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_save_operating_schedule(
    'ECOM-OPERATIONS-1-SYNTHETIC-ROLLBACK', 'ecom-operations-staff-ok',
    'ecom-operations-staff-ok-token', 'ecom-operations-session-ok',
    'America/Mexico_City', false, '[]'::jsonb, '[]'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.ecommerce_portal_hours where portal_id = v_portal_id) <> 0 then
    raise exception 'TEST_STAFF_ECOMMERCE_TRUE_FAILED: %', v_result;
  end if;

  if (select count(*) from public.ecommerce_orders where portal_id = v_portal_id) <> 3 then
    raise exception 'TEST_ORDER_COUNT_FAILED';
  end if;
  if (select count(*) from public.pos_inventory_movements) <> v_inventory_movements
     or (select count(*) from public.pos_sales) <> v_sales
     or (select count(*) from public.pos_cash_movements) <> v_cash_movements then
    raise exception 'TEST_POS_SIDE_EFFECTS_FAILED';
  end if;
end;
$test$;

rollback;
