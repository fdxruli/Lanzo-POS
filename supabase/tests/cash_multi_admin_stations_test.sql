-- CASH MULTI-ADMIN STATIONS R1 regression matrix. Fixtures are synthetic and rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_admin_user uuid := extensions.gen_random_uuid();
  v_other_admin_user uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_device_b uuid := extensions.gen_random_uuid();
  v_device_c uuid := extensions.gen_random_uuid();
  v_device_d uuid := extensions.gen_random_uuid();
  v_admin_session_a uuid := extensions.gen_random_uuid();
  v_admin_session_b uuid := extensions.gen_random_uuid();
  v_admin_session_c uuid := extensions.gen_random_uuid();
  v_admin_session_d uuid := extensions.gen_random_uuid();
  v_license_key text;
  v_fingerprint_a text;
  v_fingerprint_b text;
  v_fingerprint_c text;
  v_fingerprint_d text;
  v_device_token_a text;
  v_device_token_b text;
  v_device_token_c text;
  v_device_token_d text;
  v_admin_token_a text;
  v_admin_token_b text;
  v_admin_token_c text;
  v_admin_token_d text;
  v_station_a text;
  v_station_b text;
  v_station_d text;
  v_session_a text;
  v_session_b text;
  v_session_d text;
  v_customer_id text;
  v_result jsonb;
  v_replay jsonb;
  v_sale_a_id text;
  v_sale_b_id text;
  v_cross_cashier_sale_id text;
  v_cross_inventory_sale_id text;
  v_cross_credit_sale_id text;
  v_cross_financial_sale_id text;
  v_cross_financial_key text;
  v_financial_request jsonb;
  v_financial_canonical jsonb;
  v_financial_hash text;
  v_before_sales bigint;
  v_before_inventory_movements bigint;
  v_before_cash_movements bigint;
  v_before_customer_ledger bigint;
  v_before_financial_operations bigint;
  v_before_folio bigint;
  v_read_updated_at timestamptz;
  v_read_server_version integer;
begin
  v_license_key := 'TEST-CASH-MULTI-ADMIN-' || v_suffix;
  v_fingerprint_a := 'cash-multi-admin-a-' || v_suffix;
  v_fingerprint_b := 'cash-multi-admin-b-' || v_suffix;
  v_fingerprint_c := 'cash-multi-admin-c-' || v_suffix;
  v_fingerprint_d := 'cash-multi-admin-d-' || v_suffix;
  v_device_token_a := 'cash-multi-device-a-' || v_suffix;
  v_device_token_b := 'cash-multi-device-b-' || v_suffix;
  v_device_token_c := 'cash-multi-device-c-' || v_suffix;
  v_device_token_d := 'cash-multi-device-d-' || v_suffix;
  v_admin_token_a := 'cash-multi-session-a-' || v_suffix;
  v_admin_token_b := 'cash-multi-session-b-' || v_suffix;
  v_admin_token_c := 'cash-multi-session-c-' || v_suffix;
  v_admin_token_d := 'cash-multi-session-d-' || v_suffix;
  v_station_a := 'cash_station_device_' || v_device_a::text;
  v_station_b := 'cash_station_device_' || v_device_b::text;
  v_station_d := 'cash_station_device_' || v_device_d::text;
  v_sale_a_id := 'cash-multi-sale-a-' || v_suffix;
  v_sale_b_id := 'cash-multi-sale-b-' || v_suffix;
  v_customer_id := 'cash-multi-customer-' || v_suffix;
  v_cross_cashier_sale_id := 'cash-multi-cross-cashier-' || v_suffix;
  v_cross_inventory_sale_id := 'cash-multi-cross-inventory-' || v_suffix;
  v_cross_credit_sale_id := 'cash-multi-cross-credit-' || v_suffix;
  v_cross_financial_sale_id := 'cash-multi-cross-financial-' || v_suffix;
  v_cross_financial_key := 'cash-multi-cross-financial-key-' || v_suffix;

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, max_devices, product_name, features, plan_id
  ) values (
    v_license_id,
    v_license_key,
    'pro',
    'active',
    now() + interval '1 day',
    6,
    'Cash multi-admin fixture',
    '{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true,"cloud_sales_inventory":true,"cloud_products_sync":true,"cloud_sales_credit":true}'::jsonb,
    (select id from public.plans where code = 'pro_monthly' limit 1)
  );

  insert into public.license_admin_users(
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (
      v_admin_user,
      v_license_id,
      'cash_multi_owner_' || substr(v_suffix, 1, 6),
      'Multi station owner',
      extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)),
      true,
      true
    ),
    (
      v_other_admin_user,
      v_license_id,
      'cash_multi_other_' || substr(v_suffix, 1, 6),
      'Second admin',
      extensions.crypt('password-other-' || v_suffix, extensions.gen_salt('bf', 4)),
      false,
      true
    );

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name, security_token, is_active, device_role, staff_user_id
  ) values
    (v_device_a, v_license_id, v_fingerprint_a, 'Admin station A', v_device_token_a, true, 'admin', null),
    (v_device_b, v_license_id, v_fingerprint_b, 'Admin station B', v_device_token_b, true, 'admin', null),
    (v_device_c, v_license_id, v_fingerprint_c, 'Second admin conflict station', v_device_token_c, true, 'admin', null),
    (v_device_d, v_license_id, v_fingerprint_d, 'Second admin station D', v_device_token_d, true, 'admin', null);

  insert into public.license_admin_sessions(
    id, license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values
    (v_admin_session_a, v_license_id, v_admin_user, v_device_a, extensions.crypt(v_admin_token_a, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_admin_session_b, v_license_id, v_admin_user, v_device_b, extensions.crypt(v_admin_token_b, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_admin_session_c, v_license_id, v_other_admin_user, v_device_c, extensions.crypt(v_admin_token_c, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_admin_session_d, v_license_id, v_other_admin_user, v_device_d, extensions.crypt(v_admin_token_d, extensions.gen_salt('bf', 4)), now() + interval '1 hour');

  insert into public.pos_products(
    id, license_id, name, name_key, price, cost, stock, committed_stock,
    track_stock, is_active, product_type, sale_type, batch_management,
    expiration_mode, server_version
  ) values (
    'cash-multi-product-' || v_suffix,
    v_license_id,
    'Multi station product',
    'cash-multi-product-' || v_suffix,
    30,
    10,
    0,
    0,
    false,
    true,
    'sellable',
    'unit',
    '{"enabled":false}'::jsonb,
    'NONE',
    1
  );
  insert into public.pos_customers(id, license_id, name, phone, credit_limit)
  values (v_customer_id, v_license_id, 'Multi station customer', '555-CASH-' || v_suffix, 1000);

  -- A opens first. The station is created/bound from the authenticated device.
  v_result := public.pos_open_cash_session(
    v_license_key,
    v_fingerprint_a,
    v_device_token_a,
    v_admin_token_a,
    jsonb_build_object('opening_amount', 100, 'opening_counted_amount', 100),
    'cash-multi-open-a-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_a then
    raise exception 'MULTI_ADMIN_OPEN_A_FAILED: %', v_result;
  end if;
  v_session_a := v_result#>>'{cash_session,id}';

  -- B has the same Admin identity but a different authenticated station.
  v_result := public.pos_get_cash_station_state(
    v_license_key, v_fingerprint_b, v_device_token_b, v_admin_token_b
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'financial_status' <> 'NO_SESSION'
     or v_result#>>'{cash_session,id}' is not null
     or v_result->>'cash_station_id' <> v_station_b then
    raise exception 'MULTI_ADMIN_STATION_B_PREOPEN_STATE_FAILED: %', v_result;
  end if;

  v_result := public.pos_get_current_cash_session(
    v_license_key, v_fingerprint_b, v_device_token_b, v_admin_token_b
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,id}' is not null
     or v_result->>'cash_station_id' <> v_station_b then
    raise exception 'MULTI_ADMIN_CURRENT_B_CROSSED_A: %', v_result;
  end if;

  v_result := public.pos_open_cash_session(
    v_license_key,
    v_fingerprint_b,
    v_device_token_b,
    v_admin_token_b,
    jsonb_build_object('opening_amount', 200, 'opening_counted_amount', 200),
    'cash-multi-open-b-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_b then
    raise exception 'MULTI_ADMIN_OPEN_B_FAILED: %', v_result;
  end if;
  v_session_b := v_result#>>'{cash_session,id}';

  if v_session_a is null or v_session_b is null or v_session_a = v_session_b then
    raise exception 'MULTI_ADMIN_SESSIONS_NOT_INDEPENDENT';
  end if;
  v_result := public.pos_open_cash_session(
    v_license_key,
    v_fingerprint_d,
    v_device_token_d,
    v_admin_token_d,
    jsonb_build_object('opening_amount', 300, 'opening_counted_amount', 300),
    'cash-multi-open-d-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_d then
    raise exception 'MULTI_ADMIN_OPEN_SECOND_ADMIN_D_FAILED: %', v_result;
  end if;
  v_session_d := v_result#>>'{cash_session,id}';
  if (select count(*) from public.pos_cash_sessions
      where license_id = v_license_id
        and status = 'open'
        and deleted_at is null
        and actor_key = 'admin:' || v_admin_user::text) <> 2 then
    raise exception 'MULTI_ADMIN_OPEN_SESSION_COUNT_FAILED';
  end if;
  if (select count(*) from public.pos_cash_sessions
      where license_id = v_license_id
        and status = 'open'
        and deleted_at is null
        and actor_key = 'admin:' || v_other_admin_user::text) <> 1 then
    raise exception 'MULTI_ADMIN_SECOND_ADMIN_OPEN_SESSION_COUNT_FAILED';
  end if;

  -- Current-session reads remain station-scoped in both directions.
  select s.updated_at, s.server_version
    into v_read_updated_at, v_read_server_version
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.id = v_session_a
   limit 1;

  v_result := public.pos_get_current_cash_session(
    v_license_key, v_fingerprint_a, v_device_token_a, v_admin_token_a
  );
  if v_result#>>'{cash_session,id}' <> v_session_a
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_a then
    raise exception 'MULTI_ADMIN_CURRENT_A_SCOPING_FAILED: %', v_result;
  end if;

  if (select s.updated_at from public.pos_cash_sessions s where s.license_id = v_license_id and s.id = v_session_a limit 1) is distinct from v_read_updated_at
     or (select s.server_version from public.pos_cash_sessions s where s.license_id = v_license_id and s.id = v_session_a limit 1) is distinct from v_read_server_version then
    raise exception 'CASH_CURRENT_SESSION_READ_MUTATED_SESSION_ROW';
  end if;

  v_result := public.pos_get_current_cash_session(
    v_license_key, v_fingerprint_b, v_device_token_b, v_admin_token_b
  );
  if v_result#>>'{cash_session,id}' <> v_session_b
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_b then
    raise exception 'MULTI_ADMIN_CURRENT_B_SCOPING_FAILED: %', v_result;
  end if;

  v_result := public.pos_get_cash_station_state(
    v_license_key, v_fingerprint_a, v_device_token_a, v_admin_token_a
  );
  if v_result->>'financial_status' <> 'OWN_SESSION_OPEN'
     or v_result#>>'{cash_session,id}' <> v_session_a then
    raise exception 'MULTI_ADMIN_STATE_A_FAILED: %', v_result;
  end if;
  v_result := public.pos_get_cash_station_state(
    v_license_key, v_fingerprint_b, v_device_token_b, v_admin_token_b
  );
  if v_result->>'financial_status' <> 'OWN_SESSION_OPEN'
     or v_result#>>'{cash_session,id}' <> v_session_b then
    raise exception 'MULTI_ADMIN_STATE_B_FAILED: %', v_result;
  end if;

  -- A different Admin actor bound to A cannot open a second session there.
  insert into public.pos_cash_station_bindings(
    license_id, cash_station_id, device_id, binding_mode, status
  ) values (v_license_id, v_station_a, v_device_c, 'explicit', 'active');
  begin
    v_result := public.pos_open_cash_session(
      v_license_key,
      v_fingerprint_c,
      v_device_token_c,
      v_admin_token_c,
      jsonb_build_object('opening_amount', 50, 'opening_counted_amount', 50),
      'cash-multi-open-conflict-' || v_suffix
    );
    if coalesce((v_result->>'success')::boolean, false) is not false
       or v_result->>'code' <> 'CASH_HANDOFF_REQUIRED' then
      raise exception 'MULTI_ADMIN_SAME_STATION_ACCEPTED: %', v_result;
    end if;
  exception when others then
    if sqlerrm <> 'MULTI_ADMIN_SAME_STATION_ACCEPTED' then
      raise;
    end if;
  end;
  if (select count(*) from public.pos_cash_sessions
      where license_id = v_license_id
        and cash_station_id = v_station_a
        and status = 'open'
        and deleted_at is null) <> 1 then
    raise exception 'MULTI_ADMIN_STATION_DUPLICATE_CREATED';
  end if;

  -- Independent cloud cashier sales must stay attached to their own station.
  v_result := public.pos_create_cloud_sale_cashier(
    v_license_key,
    v_fingerprint_a,
    v_device_token_a,
    v_admin_token_a,
    jsonb_build_object('id', v_sale_a_id, 'local_sale_id', v_sale_a_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', v_sale_a_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
    jsonb_build_array(jsonb_build_object('id', v_sale_a_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
    v_session_a,
    v_sale_a_id || '-idem'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{sale,id}' <> v_sale_a_id
     or v_result#>>'{sale,cash_session_id}' <> v_session_a
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_a then
    raise exception 'MULTI_ADMIN_SALE_A_CROSSING_FAILED: %', v_result;
  end if;

  v_result := public.pos_create_cloud_sale_cashier(
    v_license_key,
    v_fingerprint_b,
    v_device_token_b,
    v_admin_token_b,
    jsonb_build_object('id', v_sale_b_id, 'local_sale_id', v_sale_b_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', v_sale_b_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
    jsonb_build_array(jsonb_build_object('id', v_sale_b_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
    v_session_b,
    v_sale_b_id || '-idem'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{sale,id}' <> v_sale_b_id
     or v_result#>>'{sale,cash_session_id}' <> v_session_b
     or v_result#>>'{cash_session,cash_station_id}' <> v_station_b then
    raise exception 'MULTI_ADMIN_SALE_B_CROSSING_FAILED: %', v_result;
  end if;

  -- Replaying A's idempotency key must not create a second sale or movement.
  v_replay := public.pos_create_cloud_sale_cashier(
    v_license_key,
    v_fingerprint_a,
    v_device_token_a,
    v_admin_token_a,
    jsonb_build_object('id', v_sale_a_id, 'local_sale_id', v_sale_a_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', v_sale_a_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
    jsonb_build_array(jsonb_build_object('id', v_sale_a_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
    v_session_a,
    v_sale_a_id || '-idem'
  );
  if coalesce((v_replay->>'success')::boolean, false) is not true
     or (select count(*) from public.pos_sales where license_id = v_license_id and id = v_sale_a_id) <> 1
     or (select count(*) from public.pos_cash_movements where license_id = v_license_id and cash_session_id = v_session_a and reference_id = v_sale_a_id) <> 1 then
    raise exception 'MULTI_ADMIN_SALE_IDEMPOTENCY_FAILED: %', v_replay;
  end if;

  select count(*) into v_before_sales
    from public.pos_sales where license_id = v_license_id;
  select count(*) into v_before_inventory_movements
    from public.pos_inventory_movements where license_id = v_license_id;
  select count(*) into v_before_cash_movements
    from public.pos_cash_movements where license_id = v_license_id;
  select count(*) into v_before_customer_ledger
    from public.pos_customer_ledger where license_id = v_license_id;
  select count(*) into v_before_financial_operations
    from public.pos_financial_operations where license_id = v_license_id;
  select coalesce(max(current_value), 0) into v_before_folio
    from public.pos_folio_sequences
   where license_id = v_license_id and sequence_name = 'sale';

  -- A valid session from A is rejected when presented by B.
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,
      v_fingerprint_b,
      v_device_token_b,
      v_admin_token_b,
      jsonb_build_object('id', v_cross_cashier_sale_id, 'local_sale_id', v_cross_cashier_sale_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash', 'cash_station_id', v_station_b),
      jsonb_build_array(jsonb_build_object('id', v_cross_cashier_sale_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
      jsonb_build_array(jsonb_build_object('id', v_cross_cashier_sale_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
      v_session_a,
      v_cross_cashier_sale_id || '-idem'
    );
    raise exception 'MULTI_ADMIN_CROSS_STATION_SALE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_STATION_MISMATCH' then
      raise;
    end if;
  end;

  -- The direct inventory RPC must reject before its own idempotency row and
  -- inventory preflight can run.  The payload deliberately supplies another
  -- station value; only the authenticated device binding is authoritative.
  begin
    perform public.pos_create_cloud_sale_cashier_inventory(
      v_license_key,
      v_fingerprint_b,
      v_device_token_b,
      v_admin_token_b,
      jsonb_build_object('id', v_cross_inventory_sale_id, 'local_sale_id', v_cross_inventory_sale_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash', 'cash_station_id', v_station_b, 'metadata', jsonb_build_object('cash_station_id', v_station_b)),
      jsonb_build_array(jsonb_build_object('id', v_cross_inventory_sale_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
      jsonb_build_array(jsonb_build_object('id', v_cross_inventory_sale_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
      v_session_a,
      v_cross_inventory_sale_id || '-idem'
    );
    raise exception 'MULTI_ADMIN_CROSS_STATION_INVENTORY_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_STATION_MISMATCH' then
      raise;
    end if;
  end;

  -- The credit route has the same server-side station boundary, including
  -- customer/ledger effects that must not be reached on a crossed session.
  begin
    perform public.pos_create_cloud_sale_credit(
      v_license_key,
      v_fingerprint_b,
      v_device_token_b,
      v_admin_token_b,
      jsonb_build_object('id', v_cross_credit_sale_id, 'local_sale_id', v_cross_credit_sale_id, 'total', 30, 'subtotal', 30, 'amount_paid', 0, 'balance_due', 30, 'payment_method', 'credit', 'customer_id', v_customer_id, 'cash_station_id', v_station_b, 'metadata', jsonb_build_object('cash_station_id', v_station_b)),
      jsonb_build_array(jsonb_build_object('id', v_cross_credit_sale_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
      jsonb_build_array(jsonb_build_object('id', v_cross_credit_sale_id || '-payment', 'method', 'credit', 'amount', 0)),
      v_session_a,
      v_customer_id,
      v_cross_credit_sale_id || '-idem'
    );
    raise exception 'MULTI_ADMIN_CROSS_STATION_CREDIT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_STATION_MISMATCH' then
      raise;
    end if;
  end;

  -- V1 resolves B's active station and compares it with session A before the
  -- financial reservation.  H is intentionally valid for A, and the payload
  -- carries a forged station field to prove it is not an authority source.
  v_financial_request := jsonb_build_object(
    'sale', jsonb_build_object('id', v_cross_financial_sale_id, 'local_sale_id', v_cross_financial_sale_id, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash', 'cash_station_id', v_station_b),
    'items', jsonb_build_array(jsonb_build_object('id', v_cross_financial_sale_id || '-item', 'product_id', 'cash-multi-product-' || v_suffix, 'product_name', 'Multi station product', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
    'payments', jsonb_build_array(jsonb_build_object('id', v_cross_financial_sale_id || '-payment', 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
    'cash_session_id', v_session_a,
    'cash_station_id', v_station_b
  );
  v_financial_canonical := private.canonical_financial_request_v1('sale.cashier', v_financial_request);
  v_financial_hash := private.financial_operation_hash(
    'sale.cashier', v_financial_canonical, 'admin:' || v_admin_user::text, v_session_a, v_station_a
  );
  begin
    perform public.pos_execute_financial_operation_v1(
      v_license_key,
      v_fingerprint_b,
      v_device_token_b,
      v_admin_token_b,
      v_cross_financial_key,
      v_financial_hash,
      'sale.cashier',
      v_financial_request
    );
    raise exception 'MULTI_ADMIN_CROSS_STATION_FINANCIAL_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_STATION_MISMATCH' then
      raise;
    end if;
  end;

  if (select count(*) from public.pos_sales where license_id = v_license_id) <> v_before_sales
     or (select count(*) from public.pos_inventory_movements where license_id = v_license_id) <> v_before_inventory_movements
     or (select count(*) from public.pos_cash_movements where license_id = v_license_id) <> v_before_cash_movements
     or (select count(*) from public.pos_customer_ledger where license_id = v_license_id) <> v_before_customer_ledger
     or (select count(*) from public.pos_financial_operations where license_id = v_license_id) <> v_before_financial_operations then
    raise exception 'MULTI_ADMIN_CROSS_STATION_EFFECTS_CREATED';
  end if;
  if exists (
    select 1 from public.pos_financial_operations
    where license_id = v_license_id
      and idempotency_key = v_cross_financial_key
      and status = 'processing'
  ) then
    raise exception 'MULTI_ADMIN_CROSS_STATION_FINANCIAL_PROCESSING_LEFT_BEHIND';
  end if;
  if exists (
    select 1 from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key in (
        v_cross_cashier_sale_id || '-idem',
        v_cross_inventory_sale_id || '-idem',
        v_cross_credit_sale_id || '-idem'
      )
  ) then
    raise exception 'MULTI_ADMIN_CROSS_STATION_IDEMPOTENCY_LEFT_BEHIND';
  end if;
  if (select coalesce(max(current_value), 0) from public.pos_folio_sequences
      where license_id = v_license_id and sequence_name = 'sale') <> v_before_folio then
    raise exception 'MULTI_ADMIN_CROSS_STATION_FOLIO_ADVANCED';
  end if;
end;
$$;

rollback;
