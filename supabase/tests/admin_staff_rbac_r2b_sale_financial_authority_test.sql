-- R2B server-authority regression matrix. All fixtures are synthetic and rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_admin_user uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_admin_session uuid := extensions.gen_random_uuid();
  v_product_id text := 'r2b-product-' || v_suffix;
  v_customer_id text := 'r2b-customer-' || v_suffix;
  v_admin_key text := 'R2B-ADMIN-' || v_suffix;
  v_admin_fingerprint text := 'r2b-admin-device-' || v_suffix;
  v_admin_security_token text := 'r2b-admin-token-' || v_suffix;
  v_admin_session_token text := 'r2b-admin-session-' || v_suffix;
  v_staff_fingerprint text := 'r2b-staff-device-' || v_suffix;
  v_staff_security_token text := 'r2b-staff-token-' || v_suffix;
  v_staff_session_token text := 'r2b-staff-session-' || v_suffix;
  v_staff_cash_session text := 'r2b-staff-cash-' || v_suffix;
  v_admin_cash_session text := 'r2b-admin-cash-' || v_suffix;
  v_staff_station text := 'r2b-staff-station-' || v_suffix;
  v_admin_station text := 'r2b-admin-station-' || v_suffix;
  v_result jsonb;
  v_saved_cost numeric;
begin
  insert into public.licenses(
    id, license_key, license_type, status, expires_at, max_devices,
    product_name, features, plan_id
  ) values (
    v_license_id, v_admin_key, 'pro', 'active', now() + interval '1 day', 4,
    'R2B authority fixture',
    '{"cloud_pos_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true,"cloud_sales_credit":true,"cloud_sales_inventory":true,"cloud_products_sync":true,"cloud_cash_sync":true}'::jsonb,
    (select id from public.plans where code = 'pro_monthly' limit 1)
  );

  insert into public.license_admin_users(
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_admin_user, v_license_id, 'r2b_admin_' || v_suffix, 'R2B admin',
    extensions.crypt('r2b-password-' || v_suffix, extensions.gen_salt('bf', 4)), true, true
  );
  insert into public.license_staff_users(
    id, license_id, username, display_name, password_hash, permissions
  ) values (
    v_staff_user, v_license_id, 'r2b_staff_' || v_suffix, 'R2B staff',
    extensions.crypt('r2b-password-' || v_suffix, extensions.gen_salt('bf', 4)),
    '{"pos":true,"cash_register":true,"customers":false,"discounts":false}'::jsonb
  );
  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name, security_token,
    is_active, device_role, staff_user_id
  ) values
    (v_admin_device, v_license_id, v_admin_fingerprint, 'R2B admin device', v_admin_security_token, true, 'admin', null),
    (v_staff_device, v_license_id, v_staff_fingerprint, 'R2B staff device', v_staff_security_token, true, 'staff', v_staff_user);
  insert into public.license_admin_sessions(
    id, license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_admin_session, v_license_id, v_admin_user, v_admin_device,
    extensions.crypt(v_admin_session_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );
  insert into public.license_staff_sessions(
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_license_id, v_staff_user, v_staff_device,
    extensions.crypt(v_staff_session_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );

  insert into public.pos_products(
    id, license_id, name, name_key, price, cost, stock, committed_stock,
    track_stock, is_active, product_type, sale_type, batch_management,
    expiration_mode, server_version
  ) values (
    v_product_id, v_license_id, 'R2B product', v_product_id, 25, 8, 0, 0,
    false, true, 'sellable', 'unit', '{"enabled":false}'::jsonb, 'NONE', 1
  );
  insert into public.pos_customers(id, license_id, name, phone, credit_limit)
  values (v_customer_id, v_license_id, 'R2B customer', '555-R2B-' || v_suffix, 1000);
  insert into public.pos_cash_stations(id, license_id, station_key, status, binding_mode)
  values
    (v_staff_station, v_license_id, 'r2b-staff-station-key-' || v_suffix, 'active', 'explicit'),
    (v_admin_station, v_license_id, 'r2b-admin-station-key-' || v_suffix, 'active', 'explicit');
  insert into public.pos_cash_station_bindings(license_id, cash_station_id, device_id, binding_mode, status)
  values
    (v_license_id, v_staff_station, v_staff_device, 'explicit', 'active'),
    (v_license_id, v_admin_station, v_admin_device, 'explicit', 'active');
  insert into public.pos_cash_sessions(
    id, license_id, device_id, staff_user_id, device_role, scope, actor_key,
    status, cash_station_id, opened_by_actor_key, opening_amount,
    expected_cash_total, responsible_name, opened_by_device_id,
    opened_by_staff_user_id, server_version
  ) values
    (v_staff_cash_session, v_license_id, v_staff_device, v_staff_user, 'staff', 'actor', 'staff:' || v_staff_user, 'open', v_staff_station, 'staff:' || v_staff_user, 0, 0, 'R2B staff', v_staff_device, v_staff_user, 1),
    (v_admin_cash_session, v_license_id, v_admin_device, null, 'admin', 'actor', 'admin:' || v_admin_user, 'open', v_admin_station, 'admin:' || v_admin_user, 0, 0, 'R2B admin', v_admin_device, null, 1);

  -- A staff actor without discounts may use the canonical catalog price. The
  -- client cost is intentionally false and must not reach the stored sale item.
  v_result := public.pos_create_cloud_sale_cashier(
    v_admin_key, v_staff_fingerprint, v_staff_security_token, v_staff_session_token,
    jsonb_build_object('id', 'r2b-staff-ok-' || v_suffix, 'local_sale_id', 'r2b-staff-ok-' || v_suffix, 'total', 25, 'subtotal', 25, 'amount_paid', 25, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', 'r2b-staff-ok-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'unit_cost', 999, 'line_subtotal', 25, 'line_total', 25)),
    jsonb_build_array(jsonb_build_object('id', 'r2b-staff-ok-payment-' || v_suffix, 'method', 'cash', 'amount', 25, 'received_amount', 25, 'change_amount', 0)),
    v_staff_cash_session, 'r2b-staff-ok-idem-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'R2B_STAFF_CANONICAL_PRICE_FAILED: %', v_result;
  end if;
  select unit_cost into v_saved_cost
  from public.pos_sale_items
  where license_id = v_license_id and sale_id = 'r2b-staff-ok-' || v_suffix;
  if v_saved_cost <> 8 then raise exception 'R2B_CLIENT_COST_AUTHORITY_BYPASS: %', v_saved_cost; end if;

  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_staff_fingerprint, v_staff_security_token, v_staff_session_token,
      jsonb_build_object('id', 'r2b-staff-price-' || v_suffix, 'total', 24, 'subtotal', 24, 'amount_paid', 24, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'r2b-staff-price-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 24, 'line_subtotal', 24, 'line_total', 24)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 24, 'received_amount', 24, 'change_amount', 0)),
      v_staff_cash_session, 'r2b-staff-price-idem-' || v_suffix
    );
    raise exception 'R2B_STAFF_LOWER_PRICE_ACCEPTED';
  exception when others then if sqlerrm <> 'SALE_PRICE_MISMATCH:' || v_product_id then raise; end if; end;

  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_staff_fingerprint, v_staff_security_token, v_staff_session_token,
      jsonb_build_object('id', 'r2b-staff-line-total-' || v_suffix, 'total', 25, 'subtotal', 25, 'amount_paid', 25, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'r2b-staff-line-total-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'line_subtotal', 25, 'line_total', 24)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25, 'received_amount', 25, 'change_amount', 0)),
      v_staff_cash_session, 'r2b-staff-line-total-idem-' || v_suffix
    );
    raise exception 'R2B_STAFF_LINE_TOTAL_TAMPER_ACCEPTED';
  exception when others then if sqlerrm <> 'SALE_ARITHMETIC_MISMATCH' then raise; end if; end;

  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_staff_fingerprint, v_staff_security_token, v_staff_session_token,
      jsonb_build_object('id', 'r2b-staff-discount-' || v_suffix, 'total', 23, 'subtotal', 25, 'discount_total', 2, 'saleDiscount', jsonb_build_object('type', 'amount', 'value', 2, 'reason', 'R2B test discount'), 'amount_paid', 23, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'r2b-staff-discount-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'line_subtotal', 25, 'line_total', 25)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 23, 'received_amount', 23, 'change_amount', 0)),
      v_staff_cash_session, 'r2b-staff-discount-idem-' || v_suffix
    );
    raise exception 'R2B_STAFF_DISCOUNT_ACCEPTED';
  exception when others then if sqlerrm <> 'DISCOUNT_PERMISSION_REQUIRED' then raise; end if; end;

  update public.license_staff_users
  set permissions = '{"pos":true,"cash_register":true,"customers":false,"discounts":true}'::jsonb
  where id = v_staff_user;
  v_result := public.pos_create_cloud_sale_cashier(
    v_admin_key, v_staff_fingerprint, v_staff_security_token, v_staff_session_token,
    jsonb_build_object('id', 'r2b-staff-discount-valid-' || v_suffix, 'local_sale_id', 'r2b-staff-discount-valid-' || v_suffix, 'total', 23, 'subtotal', 25, 'discount_total', 2, 'saleDiscount', jsonb_build_object('type', 'amount', 'value', 2, 'reason', 'R2B valid discount'), 'amount_paid', 23, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', 'r2b-staff-discount-valid-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'unit_cost', 123, 'line_subtotal', 25, 'line_total', 25)),
    jsonb_build_array(jsonb_build_object('id', 'r2b-staff-discount-valid-payment-' || v_suffix, 'method', 'cash', 'amount', 23, 'received_amount', 23, 'change_amount', 0)),
    v_staff_cash_session, 'r2b-staff-discount-valid-idem-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'R2B_STAFF_VALID_DISCOUNT_FAILED: %', v_result;
  end if;

  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_admin_fingerprint, v_admin_security_token, v_admin_session_token,
      jsonb_build_object('id', 'r2b-admin-price-' || v_suffix, 'total', 24, 'subtotal', 24, 'amount_paid', 24, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'r2b-admin-price-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 24, 'line_subtotal', 24, 'line_total', 24)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 24, 'received_amount', 24, 'change_amount', 0)),
      v_admin_cash_session, 'r2b-admin-price-idem-' || v_suffix
    );
    raise exception 'R2B_ADMIN_LOWER_PRICE_ACCEPTED';
  exception when others then if sqlerrm <> 'SALE_PRICE_MISMATCH:' || v_product_id then raise; end if; end;

  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_admin_fingerprint, v_admin_security_token, v_admin_session_token,
      jsonb_build_object('id', 'r2b-manual-' || v_suffix, 'total', 7, 'subtotal', 7, 'amount_paid', 7, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'manual-line-' || v_suffix, 'quantity', 1, 'unit_price', 7, 'line_subtotal', 7, 'line_total', 7)),
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 7, 'received_amount', 7, 'change_amount', 0)),
      v_admin_cash_session, 'r2b-manual-idem-' || v_suffix
    );
    raise exception 'R2B_MANUAL_ITEM_ACCEPTED';
  exception when others then if sqlerrm <> 'MANUAL_ITEM_PRICE_POLICY_REQUIRED' then raise; end if; end;

  -- The inventory and credit public wrappers must enforce the same canonical
  -- financial authority before delegating to their legacy effect engines.
  v_result := public.pos_create_cloud_sale_cashier_inventory(
    v_admin_key, v_admin_fingerprint, v_admin_security_token, v_admin_session_token,
    jsonb_build_object('id', 'r2b-inventory-' || v_suffix, 'local_sale_id', 'r2b-inventory-' || v_suffix, 'total', 25, 'subtotal', 25, 'amount_paid', 25, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', 'r2b-inventory-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'unit_cost', 777, 'line_subtotal', 25, 'line_total', 25)),
    jsonb_build_array(jsonb_build_object('id', 'r2b-inventory-payment-' || v_suffix, 'method', 'cash', 'amount', 25, 'received_amount', 25, 'change_amount', 0)),
    v_admin_cash_session, 'r2b-inventory-idem-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'R2B_INVENTORY_AUTHORITY_FAILED: %', v_result;
  end if;

  v_result := public.pos_create_cloud_sale_credit(
    v_admin_key, v_admin_fingerprint, v_admin_security_token, v_admin_session_token,
    jsonb_build_object('id', 'r2b-credit-' || v_suffix, 'local_sale_id', 'r2b-credit-' || v_suffix, 'customer_id', v_customer_id, 'total', 25, 'subtotal', 25, 'amount_paid', 0, 'balance_due', 25, 'payment_method', 'credit'),
    jsonb_build_array(jsonb_build_object('id', 'r2b-credit-item-' || v_suffix, 'product_id', v_product_id, 'quantity', 1, 'unit_price', 25, 'unit_cost', 444, 'line_subtotal', 25, 'line_total', 25)),
    '[]'::jsonb,
    v_admin_cash_session, v_customer_id, 'r2b-credit-idem-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'R2B_CREDIT_AUTHORITY_FAILED: %', v_result;
  end if;
end;
$test$;

rollback;
