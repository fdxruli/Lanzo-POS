-- Real authorization-chain guard matrix for 3D.14.
-- All identity/session/license rows are synthetic and rolled back.
begin;

insert into public.plans (id, code, name, features) values
  ('00000000-0000-0000-0000-0000000000f0', 'qa', 'Synthetic QA', '{"restaurant":true,"pos":true}'::jsonb);

insert into public.licenses (id, license_key, status, is_lifetime, license_type, product_name, plan_id, features) values
  ('00000000-0000-0000-0000-000000000001', 'fixture-license-a', 'active', true, 'qa', 'Synthetic A', '00000000-0000-0000-0000-0000000000f0', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'fixture-license-b', 'active', true, 'qa', 'Synthetic B', '00000000-0000-0000-0000-0000000000f0', '{}'::jsonb);

insert into public.license_devices (id, license_id, device_fingerprint, security_token, is_active, device_mode, device_role) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'fixture-admin-device', 'fixture-admin-device-token', true, 'admin_only', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'fixture-staff-device', 'fixture-staff-device-token', true, 'staff_only', 'staff'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000002', 'fixture-tenant-b-device', 'fixture-tenant-b-token', true, 'staff_only', 'staff');

insert into public.license_admin_users (id, license_id, username, display_name, is_owner, is_active) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 'qa-admin', 'Synthetic Admin', true, true);

insert into public.license_admin_sessions (id, license_id, admin_user_id, device_id, session_token_hash, expires_at) values
  ('00000000-0000-0000-0000-0000000000ba',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-00000000000a',
   extensions.crypt('fixture-admin-session', extensions.gen_salt('bf')),
   now() + interval '1 day');

insert into public.license_staff_users (id, license_id, username, display_name, role_name, permissions, is_active) values
  ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-000000000001', 'qa-pos', 'Synthetic Staff POS', 'staff', '{"pos":true,"cash_register":true}'::jsonb, true),
  ('00000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-000000000001', 'qa-pos-other', 'Synthetic Staff Other', 'staff', '{"pos":true,"cash_register":true}'::jsonb, true),
  ('00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000001', 'qa-no-pos', 'Synthetic Staff No POS', 'staff', '{"pos":false}'::jsonb, true),
  ('00000000-0000-0000-0000-0000000000ae', '00000000-0000-0000-0000-000000000001', 'qa-expired', 'Synthetic Staff Expired', 'staff', '{"pos":true}'::jsonb, true),
  ('00000000-0000-0000-0000-0000000000af', '00000000-0000-0000-0000-000000000001', 'qa-revoked', 'Synthetic Staff Revoked', 'staff', '{"pos":true}'::jsonb, true),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000002', 'qa-tenant-b', 'Synthetic Tenant B', 'staff', '{"pos":true}'::jsonb, true);

insert into public.license_staff_sessions (
  id, license_id, staff_user_id, device_id, session_token_hash, expires_at, last_seen_at, revoked_at
) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-00000000000b', extensions.crypt('fixture-staff-pos', extensions.gen_salt('bf')), now() + interval '1 day', now() - interval '1 hour', null),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-00000000000b', extensions.crypt('fixture-staff-other', extensions.gen_salt('bf')), now() + interval '1 day', now() - interval '1 hour', null),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-00000000000b', extensions.crypt('fixture-staff-no-pos', extensions.gen_salt('bf')), now() + interval '1 day', now(), null),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ae', '00000000-0000-0000-0000-00000000000b', extensions.crypt('fixture-staff-expired', extensions.gen_salt('bf')), now() - interval '1 second', now(), null),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000af', '00000000-0000-0000-0000-00000000000b', extensions.crypt('fixture-staff-revoked', extensions.gen_salt('bf')), now() + interval '1 day', now(), now()),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000c', extensions.crypt('fixture-tenant-b-staff', extensions.gen_salt('bf')), now() + interval '1 day', now(), null);

insert into public.pos_cash_stations (id, license_id, station_key, status, binding_mode) values
  ('fixture-station-a', '00000000-0000-0000-0000-000000000001', 'fixture-a', 'active', 'device'),
  ('fixture-station-b', '00000000-0000-0000-0000-000000000001', 'fixture-b', 'active', 'device');

insert into public.pos_cash_station_bindings (id, license_id, cash_station_id, device_id, binding_mode, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'fixture-station-a', '00000000-0000-0000-0000-00000000000a', 'device', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'fixture-station-b', '00000000-0000-0000-0000-00000000000b', 'device', 'active');

insert into public.pos_cash_sessions (id, license_id, device_id, actor_key, status, cash_station_id) values
  ('fixture-session-a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin:00000000-0000-0000-0000-0000000000aa', 'open', 'fixture-station-a'),
  ('fixture-session-b', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'staff:00000000-0000-0000-0000-0000000000ab', 'open', 'fixture-station-b');

insert into public.pos_restaurant_orders (id, license_id, local_order_id) values
  ('parent-admin', '00000000-0000-0000-0000-000000000001', 'sale-admin'),
  ('parent-staff', '00000000-0000-0000-0000-000000000001', 'sale-staff'),
  ('parent-shared-id-a', '00000000-0000-0000-0000-000000000001', 'sale-shared-id'),
  ('parent-shared-id-b', '00000000-0000-0000-0000-000000000002', 'sale-shared-id');

insert into public.pos_financial_operations (
  id, license_id, legacy_idempotency_key, operation_type, status, canonical_request,
  verified_actor_key, verified_device_id, verified_cash_session_id
) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'kh-admin', 'sale.cashier', 'processing', '{"sale":{"id":"sale-admin"}}',
   'admin:00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-00000000000a', 'fixture-session-a'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'kh-staff', 'sale.cashier', 'processing', '{"sale":{"id":"sale-staff"}}',
   'staff:00000000-0000-0000-0000-0000000000ab',
   '00000000-0000-0000-0000-00000000000b', 'fixture-session-b');

insert into public.pos_sales (
  id, license_id, local_sale_id, device_id, actor_key, cash_session_id, idempotency_key
) values (
  'sale-shared-id', '00000000-0000-0000-0000-000000000001',
  'sale-shared-id', '00000000-0000-0000-0000-00000000000b',
  'staff:00000000-0000-0000-0000-0000000000ab', 'fixture-session-b',
  'sales.cloud_commit:sale-shared-id:00000000-0000-0000-0000-00000000000b'
);

insert into public.pos_idempotency_keys (
  id, license_id, idempotency_key, operation_type, entity_type, entity_id,
  request_hash, response_payload, status, expires_at
) values (
  '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-000000000001',
  'sales.cloud_commit:sale-shared-id:00000000-0000-0000-0000-00000000000b',
  'sales.cloud_commit', 'sale', 'sale-shared-id', 'synthetic-request-hash',
  '{"success":true,"sale":{"id":"sale-shared-id"}}', 'completed', now() - interval '8 days'
);

create function pg_temp.assert_financial_counts_unchanged_v1(
  p_sales bigint,
  p_receipts bigint,
  p_financial_operations bigint,
  p_cash_movements bigint,
  p_payments bigint,
  p_inventory_movements bigint,
  p_credit_ledger_entries bigint
) returns void
language plpgsql
as $test$
begin
  if (select count(*) from public.pos_sales) <> p_sales
     or (select count(*) from public.pos_idempotency_keys) <> p_receipts
     or (select count(*) from public.pos_financial_operations) <> p_financial_operations
     or (select count(*) from public.pos_cash_movements) <> p_cash_movements
     or (select count(*) from public.pos_sale_payments) <> p_payments
     or (select count(*) from public.pos_inventory_movements) <> p_inventory_movements
     or (select count(*) from public.pos_customer_ledger_entries) <> p_credit_ledger_entries then
    raise exception 'C11_REJECTION_CHANGED_FINANCIAL_ROWS';
  end if;
end
$test$;

do $test$
declare
  v_admin jsonb;
  v_staff jsonb;
  v_staff_other jsonb;
  v_no_pos jsonb;
  v_tenant_b jsonb;
  v_before_sales bigint;
  v_before_receipts bigint;
  v_before_financial_ops bigint;
  v_before_cash_movements bigint;
  v_before_payments bigint;
  v_before_inventory bigint;
  v_before_credit bigint;
  v_error text;
begin
  select count(*) into v_before_sales from public.pos_sales;
  select count(*) into v_before_receipts from public.pos_idempotency_keys;
  select count(*) into v_before_financial_ops from public.pos_financial_operations;
  select count(*) into v_before_cash_movements from public.pos_cash_movements;
  select count(*) into v_before_payments from public.pos_sale_payments;
  select count(*) into v_before_inventory from public.pos_inventory_movements;
  select count(*) into v_before_credit from public.pos_customer_ledger_entries;

  -- C11-A: real Admin session hash, device capability, and permission chain.
  v_admin := private.validate_pos_sync_context(
    'fixture-license-a', 'fixture-admin-device', 'fixture-admin-device-token', 'fixture-admin-session'
  );
  if v_admin->>'actor_type' <> 'admin'
     or v_admin->>'actor_key' <> 'admin:00000000-0000-0000-0000-0000000000aa' then
    raise exception 'C11_ADMIN_AUTH_CONTEXT_INVALID';
  end if;
  perform private.assert_pos_permission(v_admin, 'pos');
  perform private.assert_cash_sale_station_for_request_v1(
    'fixture-license-a', 'fixture-admin-device', 'fixture-admin-device-token',
    'fixture-admin-session', 'fixture-session-a'
  );
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-admin-device', 'fixture-admin-device-token',
    'fixture-admin-session',
    '{"id":"sale-admin","local_sale_id":"sale-admin"}',
    'fixture-session-a', 'kh-admin', 'sale.cashier'
  );

  -- C11-B: real Staff token hash, staff permissions, station, and K/H context.
  v_staff := private.validate_pos_sync_context(
    'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token', 'fixture-staff-pos'
  );
  if v_staff->>'actor_type' <> 'staff'
     or v_staff->>'actor_key' <> 'staff:00000000-0000-0000-0000-0000000000ab' then
    raise exception 'C11_STAFF_AUTH_CONTEXT_INVALID';
  end if;
  perform private.assert_pos_permission(v_staff, 'pos');
  perform private.assert_cash_sale_station_for_request_v1(
    'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token',
    'fixture-staff-pos', 'fixture-session-b'
  );
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token',
    'fixture-staff-pos',
    '{"id":"sale-staff","local_sale_id":"sale-staff"}',
    'fixture-session-b', 'kh-staff', 'sale.cashier'
  );

  -- C11-C: authenticated Staff without POS permission is denied.
  v_no_pos := private.validate_pos_sync_context(
    'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token', 'fixture-staff-no-pos'
  );
  begin
    perform private.assert_pos_permission(v_no_pos, 'pos');
    raise exception 'EXPECTED_POS_PERMISSION_DENIED';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'POS_PERMISSION_DENIED:%' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );

  -- C11-D: expired real Staff session is rejected by the real validator.
  begin
    perform private.validate_pos_sync_context(
      'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token', 'fixture-staff-expired'
    );
    raise exception 'EXPECTED_STAFF_SESSION_EXPIRED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STAFF_SESSION_EXPIRED' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );
  -- C11-E: invalid device and revoked Staff session fail in the real validator.
  begin
    perform private.validate_pos_sync_context(
      'fixture-license-a', 'unknown-device', 'fixture-admin-device-token', 'fixture-admin-session'
    );
    raise exception 'EXPECTED_DEVICE_NOT_ALLOWED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'DEVICE_NOT_ALLOWED' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );
  begin
    perform private.validate_pos_sync_context(
      'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token', 'fixture-staff-revoked'
    );
    raise exception 'EXPECTED_REVOKED_SESSION_INVALID';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'ACTOR_SESSION_INVALID' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );

  -- C11-F: Tenant B cannot use A's active parent/receipt under B's license.
  v_tenant_b := private.validate_pos_sync_context(
    'fixture-license-b', 'fixture-tenant-b-device', 'fixture-tenant-b-token', 'fixture-tenant-b-staff'
  );
  perform private.assert_pos_permission(v_tenant_b, 'pos');
  begin
    perform private.assert_restaurant_sale_dispatcher_context_v1(
      'fixture-license-b', 'fixture-tenant-b-device', 'fixture-tenant-b-token',
      'fixture-tenant-b-staff',
      '{"id":"sale-shared-id","local_sale_id":"sale-shared-id"}',
      'fixture-session-a',
      'sales.cloud_commit:sale-shared-id:00000000-0000-0000-0000-00000000000b',
      'sale.cashier'
    );
    raise exception 'EXPECTED_TENANT_SCOPED_DISPATCHER_REJECTION';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );

  -- C11-G: a valid actor cannot use a cash session bound to another station.
  begin
    perform private.assert_cash_sale_station_for_request_v1(
      'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token',
      'fixture-staff-pos', 'fixture-session-a'
    );
    raise exception 'EXPECTED_CASH_STATION_MISMATCH';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'CASH_SESSION_STATION_MISMATCH' then raise; end if;
  end;
  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );

  -- C11-H: a different, otherwise-authorized Staff actor cannot replay the
  -- same device/session receipt belonging to the original Staff actor.
  v_staff_other := private.validate_pos_sync_context(
    'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token', 'fixture-staff-other'
  );
  perform private.assert_pos_permission(v_staff_other, 'pos');
  begin
    perform private.assert_restaurant_sale_dispatcher_context_v1(
      'fixture-license-a', 'fixture-staff-device', 'fixture-staff-device-token',
      'fixture-staff-other',
      '{"id":"sale-shared-id","local_sale_id":"sale-shared-id"}',
      'fixture-session-b',
      'sales.cloud_commit:sale-shared-id:00000000-0000-0000-0000-00000000000b',
      'sale.cashier'
    );
    raise exception 'EXPECTED_ACTOR_SCOPED_REPLAY_REJECTION';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' then raise; end if;
  end;

  perform pg_temp.assert_financial_counts_unchanged_v1(
    v_before_sales, v_before_receipts, v_before_financial_ops, v_before_cash_movements,
    v_before_payments, v_before_inventory, v_before_credit
  );
end
$test$;

rollback;
select '3D14 real Auth/station guard matrix: PASS (financial leaf operations not invoked)' as result;
