-- P0 security contract: Cloud layaway cancellation requires server-verified
-- POS + refunds authority on execution and receipt recovery.
-- Fixtures and every financial effect are rolled back at the end of the test.

begin;

create function pg_temp.assert_layaway_v1_error(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_request_hash text,
  p_operation_type text,
  p_request jsonb,
  p_expected_error text
) returns void
language plpgsql
as $test$
declare
  v_error text;
begin
  begin
    perform public.pos_execute_financial_operation_v1(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_idempotency_key, p_request_hash, p_operation_type, p_request
    );
    raise exception 'P0_UNEXPECTED_V1_SUCCESS:%', p_operation_type using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error is distinct from p_expected_error then
      raise exception 'P0_V1_WRONG_ERROR expected=% actual=%', p_expected_error, v_error;
    end if;
  end;
end;
$test$;

create function pg_temp.assert_layaway_v2_error(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_request_hash text,
  p_operation_type text,
  p_request jsonb,
  p_sync_contract jsonb,
  p_expected_error text
) returns void
language plpgsql
as $test$
declare
  v_error text;
begin
  begin
    perform public.pos_execute_financial_operation_v2(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_idempotency_key, p_request_hash, p_operation_type, p_request, p_sync_contract
    );
    raise exception 'P0_UNEXPECTED_V2_SUCCESS:%', p_operation_type using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error is distinct from p_expected_error then
      raise exception 'P0_V2_WRONG_ERROR expected=% actual=%', p_expected_error, v_error;
    end if;
  end;
end;
$test$;

create function pg_temp.assert_layaway_v1_receipt_error(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_request_hash text,
  p_expected_error text
) returns void
language plpgsql
as $test$
declare
  v_error text;
begin
  begin
    perform public.pos_get_financial_operation_receipt(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_idempotency_key, p_request_hash
    );
    raise exception 'P0_UNEXPECTED_V1_RECEIPT_SUCCESS' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error is distinct from p_expected_error then
      raise exception 'P0_V1_RECEIPT_WRONG_ERROR expected=% actual=%', p_expected_error, v_error;
    end if;
  end;
end;
$test$;

create function pg_temp.assert_layaway_v2_receipt_error(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_request_hash text,
  p_sync_contract jsonb,
  p_expected_error text
) returns void
language plpgsql
as $test$
declare
  v_error text;
begin
  begin
    perform public.pos_get_financial_operation_receipt_v2(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_idempotency_key, p_request_hash, p_sync_contract
    );
    raise exception 'P0_UNEXPECTED_V2_RECEIPT_SUCCESS' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error is distinct from p_expected_error then
      raise exception 'P0_V2_RECEIPT_WRONG_ERROR expected=% actual=%', p_expected_error, v_error;
    end if;
  end;
end;
$test$;

create function pg_temp.layaway_financial_snapshot(p_license_a uuid, p_license_b uuid)
returns jsonb
language sql
as $test$
  select jsonb_build_object(
    'layaways', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'license_id', license_id, 'status', status,
        'paid_amount', paid_amount, 'retained_money', retained_money,
        'retained_amount', retained_amount, 'server_version', server_version
      ) order by license_id, id)
      from public.pos_layaways where license_id in (p_license_a, p_license_b)
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'license_id', license_id, 'layaway_id', layaway_id,
        'status', status, 'released_at', released_at, 'consumed_at', consumed_at
      ) order by license_id, id)
      from public.pos_layaway_inventory_reservations
      where license_id in (p_license_a, p_license_b)
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'license_id', license_id, 'layaway_id', layaway_id, 'status', status
      ) order by license_id, id)
      from public.pos_layaway_payments where license_id in (p_license_a, p_license_b)
    ), '[]'::jsonb),
    'cash_movements', (
      select count(*) from public.pos_cash_movements
      where license_id in (p_license_a, p_license_b)
    ),
    'inventory_movements', (
      select count(*) from public.pos_inventory_movements
      where license_id in (p_license_a, p_license_b)
    ),
    'sync_events', (
      select count(*) from public.pos_sync_events
      where license_id in (p_license_a, p_license_b)
    ),
    'financial_operations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'license_id', license_id, 'idempotency_key', idempotency_key,
        'operation_type', operation_type, 'status', status
      ) order by license_id, idempotency_key)
      from public.pos_financial_operations where license_id in (p_license_a, p_license_b)
    ), '[]'::jsonb)
  );
$test$;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_features jsonb := '{
    "cloud_pos_sync": true,
    "cloud_sales_sync_base": true,
    "cloud_cash_sync": true,
    "cloud_products_sync": true,
    "cloud_layaways": true,
    "cloud_sales_cashier": true
  }'::jsonb;

  v_v1_license_id uuid := extensions.gen_random_uuid();
  v_v1_license_key text := 'P0-LAYAWAY-V1-' || v_suffix;
  v_v1_device_id uuid := extensions.gen_random_uuid();
  v_v1_fingerprint text := 'p0-v1-device-' || v_suffix;
  v_v1_device_token text := 'p0-v1-device-token-' || v_suffix;

  v_v1_no_refunds_id uuid := extensions.gen_random_uuid();
  v_v1_no_refunds_token text := 'p0-v1-no-refunds-' || v_suffix;
  v_v1_authorized_id uuid := extensions.gen_random_uuid();
  v_v1_authorized_token text := 'p0-v1-authorized-' || v_suffix;
  v_v1_no_pos_id uuid := extensions.gen_random_uuid();
  v_v1_no_pos_token text := 'p0-v1-no-pos-' || v_suffix;
  v_v1_revoked_id uuid := extensions.gen_random_uuid();
  v_v1_revoked_token text := 'p0-v1-revoked-' || v_suffix;
  v_v1_admin_id uuid := extensions.gen_random_uuid();
  v_v1_admin_token text := 'p0-v1-admin-' || v_suffix;

  v_v2_license_id uuid := extensions.gen_random_uuid();
  v_v2_license_key text := 'P0-LAYAWAY-V2-' || v_suffix;
  v_v2_device_id uuid := extensions.gen_random_uuid();
  v_v2_fingerprint text := 'p0-v2-device-' || v_suffix;
  v_v2_device_token text := 'p0-v2-device-token-' || v_suffix;
  v_v2_no_refunds_id uuid := extensions.gen_random_uuid();
  v_v2_no_refunds_token text := 'p0-v2-no-refunds-' || v_suffix;
  v_v2_authorized_id uuid := extensions.gen_random_uuid();
  v_v2_authorized_token text := 'p0-v2-authorized-' || v_suffix;

  v_v1_paid_refund_id text := 'p0-v1-paid-refund-' || v_suffix;
  v_v1_paid_retain_id text := 'p0-v1-paid-retain-' || v_suffix;
  v_v1_unpaid_id text := 'p0-v1-unpaid-' || v_suffix;
  v_v1_authorized_cancel_id text := 'p0-v1-authorized-cancel-' || v_suffix;
  v_v1_admin_cancel_id text := 'p0-v1-admin-cancel-' || v_suffix;

  v_v2_paid_refund_id text := 'p0-v2-paid-refund-' || v_suffix;
  v_v2_paid_retain_id text := 'p0-v2-paid-retain-' || v_suffix;
  v_v2_unpaid_id text := 'p0-v2-unpaid-' || v_suffix;
  v_v2_authorized_cancel_id text := 'p0-v2-authorized-cancel-' || v_suffix;

  v_v1_station text;
  v_v2_station text;
  v_v2_contract_no_refunds jsonb;
  v_v2_contract_authorized jsonb;
  v_pilot_result jsonb;
  v_request jsonb;
  v_hash text;
  v_v1_authorized_request jsonb;
  v_v1_authorized_hash text;
  v_response jsonb;
  v_replay jsonb;
  v_receipt jsonb;
  v_before jsonb;
  v_after jsonb;
  v_context jsonb;
  v_definition text;
begin
  -- Catalog contract: public v1/v2 endpoints remain callable, while the
  -- private cancellation implementation is not an alternate client route.
  if to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)') is null
     or to_regprocedure('public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb)') is null
     or to_regprocedure('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)') is null
     or to_regprocedure('public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)') is null
     or to_regprocedure('private.execute_layaway_cancel_financial_v1(jsonb,jsonb,text,text,text)') is null then
    raise exception 'P0_LAYAWAY_RPC_SIGNATURE_MISSING';
  end if;

  if not has_function_privilege('anon', 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.pos_get_financial_operation_receipt(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_get_financial_operation_receipt(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_get_financial_operation_receipt(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.execute_layaway_cancel_financial_v1(jsonb,jsonb,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.execute_layaway_cancel_financial_v1(jsonb,jsonb,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'private.execute_layaway_cancel_financial_v1(jsonb,jsonb,text,text,text)', 'execute') then
    raise exception 'P0_LAYAWAY_RPC_ACL_CHANGED';
  end if;

  select pg_get_functiondef('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('if p_operation_type = ''layaway.cancel'' then' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''pos'')' in v_definition)
        > position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        > position('private.reserve_financial_operation_v1(' in v_definition) then
    raise exception 'P0_V1_CANCEL_GUARD_NOT_BEFORE_IDEMPOTENCY';
  end if;

  select pg_get_functiondef('private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('if p_operation_type = ''layaway.cancel'' then' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''pos'')' in v_definition)
        > position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        > position('private.reserve_financial_operation_v1(' in v_definition) then
    raise exception 'P0_V2_CANCEL_GUARD_NOT_BEFORE_IDEMPOTENCY';
  end if;

  select pg_get_functiondef('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)'::regprocedure)
    into v_definition;
  if position('if v_operation.operation_type = ''layaway.cancel'' then' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        < position('private.assert_financial_operation_origin_v1(' in v_definition)
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        > position('if v_operation.request_hash is distinct from p_request_hash' in v_definition) then
    raise exception 'P0_V1_RECEIPT_GUARD_ORDER_FAILED';
  end if;

  select pg_get_functiondef('public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('if v_operation.operation_type = ''layaway.cancel'' then' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        < position('private.assert_financial_operation_origin_v1(' in v_definition)
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition)
        > position('if v_operation.request_hash is distinct from p_request_hash' in v_definition) then
    raise exception 'P0_V2_RECEIPT_GUARD_ORDER_FAILED';
  end if;

  -- The definitions stay SECURITY DEFINER, pinned to an empty search_path,
  -- with their deployed public execution grants unchanged.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_execute_financial_operation_v1'
      and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=45s','lock_timeout=20s']
      and pg_get_userbyid(p.proowner) = 'postgres'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_execute_financial_operation_v2'
      and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=45s','lock_timeout=20s']
      and pg_get_userbyid(p.proowner) = 'postgres'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'pos_execute_financial_operation_core_v2'
      and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=45s','lock_timeout=20s']
      and pg_get_userbyid(p.proowner) = 'postgres'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_get_financial_operation_receipt'
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and pg_get_userbyid(p.proowner) = 'postgres'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_get_financial_operation_receipt_v2'
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'P0_DISPATCHER_SECURITY_METADATA_CHANGED';
  end if;

  -- License A uses protocol v1. License B is activated as a clean v2 pilot
  -- before any device, session, layaway, or financial operation is created.
  insert into public.licenses (id, license_key, license_type, features)
  values
    (v_v1_license_id, v_v1_license_key, 'pro', v_features),
    (v_v2_license_id, v_v2_license_key, 'pro', v_features);

  v_pilot_result := private.pos_fin01_set_clean_qa_protocol_v2(
    v_v2_license_id, 2, 1, 'P0 isolated layaway cancellation authorization test'
  );
  if v_pilot_result is distinct from '{"protocol":2,"generation":2}'::jsonb then
    raise exception 'P0_V2_PILOT_SETUP_FAILED:%', v_pilot_result;
  end if;

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode
  ) values
    (v_v1_device_id, v_v1_license_id, v_v1_fingerprint, 'P0 v1 device', '{}'::jsonb,
     true, v_v1_device_token, 'admin', 'shared'),
    (v_v2_device_id, v_v2_license_id, v_v2_fingerprint, 'P0 v2 device', '{}'::jsonb,
     true, v_v2_device_token, 'admin', 'shared');

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values
    (v_v1_no_refunds_id, v_v1_license_id, 'p0-nr-' || left(v_suffix, 8), 'P0 No Refunds V1',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":true,"refunds":false}'::jsonb, true),
    (v_v1_authorized_id, v_v1_license_id, 'p0-ok-' || left(v_suffix, 8), 'P0 Authorized V1',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":true,"refunds":true}'::jsonb, true),
    (v_v1_no_pos_id, v_v1_license_id, 'p0-nopos-' || left(v_suffix, 8), 'P0 No POS V1',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":false,"refunds":true}'::jsonb, true),
    (v_v1_revoked_id, v_v1_license_id, 'p0-revoked-' || left(v_suffix, 8), 'P0 Revoked V1',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":true,"refunds":true}'::jsonb, true),
    (v_v2_no_refunds_id, v_v2_license_id, 'p0-nr2-' || left(v_suffix, 8), 'P0 No Refunds V2',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":true,"refunds":false}'::jsonb, true),
    (v_v2_authorized_id, v_v2_license_id, 'p0-ok2-' || left(v_suffix, 8), 'P0 Authorized V2',
     extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), 'staff',
     '{"pos":true,"refunds":true}'::jsonb, true);

  insert into public.license_staff_sessions (
    id, license_id, staff_user_id, device_id, session_token_hash, expires_at, revoked_at
  ) values
    (extensions.gen_random_uuid(), v_v1_license_id, v_v1_no_refunds_id, v_v1_device_id,
     extensions.crypt(v_v1_no_refunds_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null),
    (extensions.gen_random_uuid(), v_v1_license_id, v_v1_authorized_id, v_v1_device_id,
     extensions.crypt(v_v1_authorized_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null),
    (extensions.gen_random_uuid(), v_v1_license_id, v_v1_no_pos_id, v_v1_device_id,
     extensions.crypt(v_v1_no_pos_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null),
    (extensions.gen_random_uuid(), v_v1_license_id, v_v1_revoked_id, v_v1_device_id,
     extensions.crypt(v_v1_revoked_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', now()),
    (extensions.gen_random_uuid(), v_v2_license_id, v_v2_no_refunds_id, v_v2_device_id,
     extensions.crypt(v_v2_no_refunds_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null),
    (extensions.gen_random_uuid(), v_v2_license_id, v_v2_authorized_id, v_v2_device_id,
     extensions.crypt(v_v2_authorized_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null);

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_v1_admin_id, v_v1_license_id, 'p0-admin-' || left(v_suffix, 8), 'P0 Administrator',
    extensions.crypt('p0-test-password', extensions.gen_salt('bf', 4)), true, true
  );
  insert into public.license_admin_sessions (
    license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_v1_license_id, v_v1_admin_id, v_v1_device_id,
    extensions.crypt(v_v1_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );

  perform private.resolve_cash_station_for_device(v_v1_license_id, v_v1_device_id, true);
  perform private.resolve_cash_station_for_device(v_v2_license_id, v_v2_device_id, true);
  v_v1_station := private.resolve_financial_cash_station_v1(v_v1_license_id, v_v1_device_id);
  v_v2_station := private.resolve_financial_cash_station_v1(v_v2_license_id, v_v2_device_id);

  v_v2_contract_no_refunds := public.pos_fin01_sync_contract_v1(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token, 2, array[]::text[]
  );
  v_v2_contract_authorized := public.pos_fin01_sync_contract_v1(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token, 2, array[]::text[]
  );
  if v_v2_contract_no_refunds->>'server_status' is distinct from 'SUPPORTED'
     or v_v2_contract_authorized->>'server_status' is distinct from 'SUPPORTED' then
    raise exception 'P0_V2_CONTRACT_SETUP_FAILED';
  end if;
  -- The negotiation RPC also returns server-only metadata; execution accepts
  -- only the client contract fields checked by private.pos_fin01_validate_sync_contract_v2.
  v_v2_contract_no_refunds := jsonb_build_object(
    'contract_version', v_v2_contract_no_refunds->'contract_version',
    'capabilities', v_v2_contract_no_refunds->'capabilities'
  );
  v_v2_contract_authorized := jsonb_build_object(
    'contract_version', v_v2_contract_authorized->'contract_version',
    'capabilities', v_v2_contract_authorized->'capabilities'
  );

  insert into public.pos_layaways (
    id, license_id, total_amount, paid_amount, balance_due, deadline, status, actor_key, actor_name
  ) values
    (v_v1_paid_refund_id, v_v1_license_id, 100, 40, 60, now() + interval '10 days', 'active',
     'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    (v_v1_paid_retain_id, v_v1_license_id, 100, 40, 60, now() + interval '10 days', 'active',
     'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    (v_v1_unpaid_id, v_v1_license_id, 100, 0, 100, now() + interval '10 days', 'active',
     'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    (v_v1_authorized_cancel_id, v_v1_license_id, 100, 40, 60, now() + interval '10 days', 'active',
     'staff:' || v_v1_authorized_id::text, 'P0 Authorized V1'),
    (v_v1_admin_cancel_id, v_v1_license_id, 100, 0, 100, now() + interval '10 days', 'ready',
     'admin:' || v_v1_admin_id::text, 'P0 Administrator'),
    (v_v2_paid_refund_id, v_v2_license_id, 100, 40, 60, now() + interval '10 days', 'active',
     'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    (v_v2_paid_retain_id, v_v2_license_id, 100, 40, 60, now() + interval '10 days', 'active',
     'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    (v_v2_unpaid_id, v_v2_license_id, 100, 0, 100, now() + interval '10 days', 'active',
     'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    (v_v2_authorized_cancel_id, v_v2_license_id, 100, 25, 75, now() + interval '10 days', 'active',
     'staff:' || v_v2_authorized_id::text, 'P0 Authorized V2');

  insert into public.pos_layaway_inventory_reservations (
    id, license_id, layaway_id, item_index, product_id, quantity, status, actor_key, actor_name
  ) values
    ('p0-v1-res-' || v_suffix, v_v1_license_id, v_v1_paid_refund_id, 1,
     'p0-product-' || v_suffix, 1, 'reserved', 'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    ('p0-v1-res-retain-' || v_suffix, v_v1_license_id, v_v1_paid_retain_id, 1,
     'p0-product-retain-' || v_suffix, 1, 'reserved', 'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    ('p0-v1-res-unpaid-' || v_suffix, v_v1_license_id, v_v1_unpaid_id, 1,
     'p0-product-unpaid-' || v_suffix, 1, 'reserved', 'staff:' || v_v1_no_refunds_id::text, 'P0 No Refunds V1'),
    ('p0-v1-res-authorized-' || v_suffix, v_v1_license_id, v_v1_authorized_cancel_id, 1,
     'p0-product-authorized-' || v_suffix, 1, 'reserved', 'staff:' || v_v1_authorized_id::text, 'P0 Authorized V1'),
    ('p0-v1-res-admin-' || v_suffix, v_v1_license_id, v_v1_admin_cancel_id, 1,
     'p0-product-admin-' || v_suffix, 1, 'reserved', 'admin:' || v_v1_admin_id::text, 'P0 Administrator'),
    ('p0-v2-res-' || v_suffix, v_v2_license_id, v_v2_paid_refund_id, 1,
     'p0-v2-product-' || v_suffix, 1, 'reserved', 'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    ('p0-v2-res-retain-' || v_suffix, v_v2_license_id, v_v2_paid_retain_id, 1,
     'p0-v2-product-retain-' || v_suffix, 1, 'reserved', 'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    ('p0-v2-res-unpaid-' || v_suffix, v_v2_license_id, v_v2_unpaid_id, 1,
     'p0-v2-product-unpaid-' || v_suffix, 1, 'reserved', 'staff:' || v_v2_no_refunds_id::text, 'P0 No Refunds V2'),
    ('p0-v2-res-authorized-' || v_suffix, v_v2_license_id, v_v2_authorized_cancel_id, 1,
     'p0-v2-product-authorized-' || v_suffix, 1, 'reserved', 'staff:' || v_v2_authorized_id::text, 'P0 Authorized V2');

  -- P0-01, P0-02, P0-03: refunds=false is denied for refund, retention, and
  -- zero-payment cancellations through both client-exposed RPC generations.
  v_before := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);

  v_request := jsonb_build_object(
    'layaway_id', v_v1_paid_refund_id, 'reason', 'P0 unauthorized refund',
    'retain_money', false, 'cash_session_id', null,
    'actor_permissions', '{"pos":true,"refunds":true}'::jsonb,
    'staff_permissions', '{"pos":true,"refunds":true}'::jsonb
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_no_refunds_id::text, null, v_v1_station
  );
  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_refunds_token,
    'p0-v1-refund-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    'POS_PERMISSION_DENIED:refunds'
  );

  v_request := jsonb_build_object(
    'layaway_id', v_v1_paid_retain_id, 'reason', 'P0 unauthorized retention',
    'retain_money', true, 'cash_session_id', null,
    'actor_permissions', '{"pos":true,"refunds":true}'::jsonb
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_no_refunds_id::text, null, v_v1_station
  );
  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_refunds_token,
    'p0-v1-retain-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    'POS_PERMISSION_DENIED:refunds'
  );

  v_request := jsonb_build_object(
    'layaway_id', v_v1_unpaid_id, 'reason', 'P0 unpaid cancellation',
    'retain_money', false, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_no_refunds_id::text, null, v_v1_station
  );
  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_refunds_token,
    'p0-v1-unpaid-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    'POS_PERMISSION_DENIED:refunds'
  );

  v_request := jsonb_build_object(
    'layaway_id', v_v2_paid_refund_id, 'reason', 'P0 unauthorized v2 refund',
    'retain_money', false, 'cash_session_id', null,
    'actor_permissions', '{"pos":true,"refunds":true}'::jsonb,
    'staff_permissions', '{"pos":true,"refunds":true}'::jsonb
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v2_no_refunds_id::text, null, v_v2_station
  );
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v2-refund-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_no_refunds, 'POS_PERMISSION_DENIED:refunds'
  );

  v_request := jsonb_build_object(
    'layaway_id', v_v2_paid_retain_id, 'reason', 'P0 unauthorized v2 retention',
    'retain_money', true, 'cash_session_id', null,
    'actor_permissions', '{"pos":true,"refunds":true}'::jsonb
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v2_no_refunds_id::text, null, v_v2_station
  );
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v2-retain-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_no_refunds, 'POS_PERMISSION_DENIED:refunds'
  );

  v_request := jsonb_build_object(
    'layaway_id', v_v2_unpaid_id, 'reason', 'P0 unpaid v2 cancellation',
    'retain_money', false, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v2_no_refunds_id::text, null, v_v2_station
  );
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v2-unpaid-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_no_refunds, 'POS_PERMISSION_DENIED:refunds'
  );

  -- The context's permission comes from the session-backed Staff row, not the
  -- JSON request. Invalid/revoked sessions and Staff without POS still fail.
  v_context := private.validate_pos_sync_context(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_refunds_token
  );
  if v_context->>'actor_type' is distinct from 'staff'
     or v_context->'actor_permissions'->>'refunds' is distinct from 'false' then
    raise exception 'P0_CONTEXT_PERMISSION_NOT_SERVER_VERIFIED';
  end if;

  v_request := jsonb_build_object(
    'layaway_id', v_v1_unpaid_id, 'retain_money', false,
    'actor_permissions', '{"pos":true,"refunds":true}'::jsonb
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_no_refunds_id::text, null, v_v1_station
  );
  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_revoked_token,
    'p0-v1-revoked-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    'ACTOR_SESSION_INVALID'
  );

  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_no_pos_id::text, null, v_v1_station
  );
  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_pos_token,
    'p0-v1-no-pos-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    'POS_PERMISSION_DENIED:pos'
  );

  -- A valid refunds actor in tenant B cannot cancel tenant A's active layaway.
  v_request := jsonb_build_object(
    'layaway_id', v_v1_paid_refund_id, 'reason', 'P0 cross-tenant attempt',
    'retain_money', true, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v2_authorized_id::text, null, v_v2_station
  );
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-cross-tenant-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_authorized, 'LAYAWAY_NOT_FOUND'
  );

  v_after := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  if v_before is distinct from v_after then
    raise exception 'P0_UNAUTHORIZED_OR_CROSS_TENANT_ATTEMPT_CHANGED_FINANCIAL_STATE';
  end if;
  if exists (
    select 1 from public.pos_layaway_inventory_reservations
    where license_id = v_v1_license_id and status <> 'reserved'
  ) or exists (
    select 1 from public.pos_layaway_inventory_reservations
    where license_id = v_v2_license_id and status <> 'reserved'
  ) then
    raise exception 'P0_UNAUTHORIZED_CANCEL_RELEASED_RESERVATION';
  end if;

  -- P0-04/P0-05: authorized Staff with pos+refunds and a valid Administrator
  -- can still perform a real retained-funds cancellation.
  v_request := jsonb_build_object(
    'layaway_id', v_v1_authorized_cancel_id, 'reason', 'P0 authorized Staff',
    'retain_money', true, 'refund_id', null, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v1_authorized_id::text, null, v_v1_station
  );
  v_v1_authorized_request := v_request;
  v_v1_authorized_hash := v_hash;
  v_response := public.pos_execute_financial_operation_v1(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_authorized_token,
    'p0-v1-authorized-' || v_suffix, v_hash, 'layaway.cancel', v_request
  );
  if coalesce((v_response->>'success')::boolean, false) is not true
     or (select status from public.pos_layaways
         where license_id = v_v1_license_id and id = v_v1_authorized_cancel_id) is distinct from 'cancelled'
     or (select retained_money from public.pos_layaways
         where license_id = v_v1_license_id and id = v_v1_authorized_cancel_id) is not true
     or (select retained_amount from public.pos_layaways
         where license_id = v_v1_license_id and id = v_v1_authorized_cancel_id) is distinct from 40
     or (select status from public.pos_layaway_inventory_reservations
         where license_id = v_v1_license_id and layaway_id = v_v1_authorized_cancel_id) is distinct from 'released' then
    raise exception 'P0_AUTHORIZED_STAFF_CANCEL_BEHAVIOR_CHANGED';
  end if;

  v_before := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  v_replay := public.pos_execute_financial_operation_v1(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_authorized_token,
    'p0-v1-authorized-' || v_suffix, v_hash, 'layaway.cancel', v_request
  );
  v_receipt := public.pos_get_financial_operation_receipt(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_authorized_token,
    'p0-v1-authorized-' || v_suffix, v_hash
  );
  if v_replay->>'success' is distinct from 'true'
     or v_receipt->>'status' is distinct from 'COMPLETED' then
    raise exception 'P0_AUTHORIZED_V1_IDEMPOTENT_RECOVERY_FAILED';
  end if;
  v_after := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  if v_before is distinct from v_after then
    raise exception 'P0_AUTHORIZED_V1_REPLAY_CREATED_SECOND_EFFECT';
  end if;

  v_request := jsonb_build_object(
    'layaway_id', v_v1_admin_cancel_id, 'reason', 'P0 Administrator',
    'retain_money', true, 'refund_id', null, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'admin:' || v_v1_admin_id::text, null, v_v1_station
  );
  v_response := public.pos_execute_financial_operation_v1(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_admin_token,
    'p0-v1-admin-' || v_suffix, v_hash, 'layaway.cancel', v_request
  );
  if coalesce((v_response->>'success')::boolean, false) is not true
     or (select status from public.pos_layaways
         where license_id = v_v1_license_id and id = v_v1_admin_cancel_id) is distinct from 'cancelled'
     or (select status from public.pos_layaway_inventory_reservations
         where license_id = v_v1_license_id and layaway_id = v_v1_admin_cancel_id) is distinct from 'released' then
    raise exception 'P0_ADMIN_CANCEL_BEHAVIOR_CHANGED';
  end if;

  -- P0-09: refunds remains operation-specific; unrelated financial work still
  -- reaches its own precondition with a Staff who has pos but no refunds.
  v_request := '{}'::jsonb;
  v_hash := 'sha256:' || repeat('b', 64);
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v2-payment-no-regression-' || v_suffix, v_hash, 'layaway.payment', v_request,
    v_v2_contract_no_refunds, 'FINANCIAL_CASH_SESSION_ID_REQUIRED'
  );
  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v2-sale-no-regression-' || v_suffix, v_hash, 'sale.cashier', v_request,
    v_v2_contract_no_refunds, 'FINANCIAL_CASH_SESSION_ID_REQUIRED'
  );

  -- A completed cancellation can be replayed only while the actor remains
  -- authorized. Once refunds is revoked, neither execution nor either receipt
  -- API returns that receipt; the previously confirmed operation stays intact.
  v_request := jsonb_build_object(
    'layaway_id', v_v2_authorized_cancel_id, 'reason', 'P0 authorized v2',
    'retain_money', true, 'refund_id', null, 'cash_session_id', null
  );
  v_hash := private.financial_operation_hash(
    'layaway.cancel', private.canonical_layaway_request_v1('layaway.cancel', v_request),
    'staff:' || v_v2_authorized_id::text, null, v_v2_station
  );
  v_response := public.pos_execute_financial_operation_v2(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-authorized-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_authorized
  );
  if v_response#>>'{payload,success}' is distinct from 'true'
     or (select status from public.pos_layaways
         where license_id = v_v2_license_id and id = v_v2_authorized_cancel_id) is distinct from 'cancelled'
     or (select retained_money from public.pos_layaways
         where license_id = v_v2_license_id and id = v_v2_authorized_cancel_id) is not true
     or (select retained_amount from public.pos_layaways
         where license_id = v_v2_license_id and id = v_v2_authorized_cancel_id) is distinct from 25
     or (select status from public.pos_layaway_inventory_reservations
         where license_id = v_v2_license_id and layaway_id = v_v2_authorized_cancel_id) is distinct from 'released' then
    raise exception 'P0_AUTHORIZED_V2_CANCEL_BEHAVIOR_CHANGED';
  end if;

  v_before := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  v_replay := public.pos_execute_financial_operation_v2(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-authorized-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_authorized
  );
  v_receipt := public.pos_get_financial_operation_receipt_v2(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-authorized-' || v_suffix, v_hash, v_v2_contract_authorized
  );
  if v_replay#>>'{payload,success}' is distinct from 'true'
     or v_receipt#>>'{payload,status}' is distinct from 'COMPLETED' then
    raise exception 'P0_AUTHORIZED_V2_IDEMPOTENT_RECOVERY_FAILED';
  end if;
  v_after := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  if v_before is distinct from v_after then
    raise exception 'P0_AUTHORIZED_V2_REPLAY_CREATED_SECOND_EFFECT';
  end if;

  update public.license_staff_users
     set permissions = '{"pos":true,"refunds":false}'::jsonb
   where license_id = v_v2_license_id and id = v_v2_authorized_id;

  perform pg_temp.assert_layaway_v2_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-authorized-' || v_suffix, v_hash, 'layaway.cancel', v_request,
    v_v2_contract_authorized, 'POS_PERMISSION_DENIED:refunds'
  );
  perform pg_temp.assert_layaway_v2_receipt_error(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_authorized_token,
    'p0-v2-authorized-' || v_suffix, v_hash, v_v2_contract_authorized,
    'POS_PERMISSION_DENIED:refunds'
  );

  update public.license_staff_users
     set permissions = '{"pos":true,"refunds":false}'::jsonb
   where license_id = v_v1_license_id and id = v_v1_authorized_id;

  perform pg_temp.assert_layaway_v1_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_authorized_token,
    'p0-v1-authorized-' || v_suffix, v_v1_authorized_hash,
    'layaway.cancel', v_v1_authorized_request,
    'POS_PERMISSION_DENIED:refunds'
  );
  perform pg_temp.assert_layaway_v1_receipt_error(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_authorized_token,
    'p0-v1-authorized-' || v_suffix, v_v1_authorized_hash,
    'POS_PERMISSION_DENIED:refunds'
  );

  -- Receipt lookups remain tenant/actor scoped: another license sees NOT_FOUND
  -- and never receives cancellation result data.
  v_receipt := public.pos_get_financial_operation_receipt(
    v_v1_license_key, v_v1_fingerprint, v_v1_device_token, v_v1_no_refunds_token,
    'p0-v2-authorized-' || v_suffix, 'sha256:' || repeat('c', 64)
  );
  if v_receipt->>'status' is distinct from 'NOT_FOUND' then
    raise exception 'P0_CROSS_TENANT_V1_RECEIPT_DISCLOSED';
  end if;
  v_receipt := public.pos_get_financial_operation_receipt_v2(
    v_v2_license_key, v_v2_fingerprint, v_v2_device_token, v_v2_no_refunds_token,
    'p0-v1-authorized-' || v_suffix, 'sha256:' || repeat('d', 64),
    v_v2_contract_no_refunds
  );
  if v_receipt#>>'{payload,status}' is distinct from 'NOT_FOUND'
     or v_receipt#>'{payload,result}' is not null then
    raise exception 'P0_CROSS_TENANT_V2_RECEIPT_DISCLOSED';
  end if;

  v_after := pg_temp.layaway_financial_snapshot(v_v1_license_id, v_v2_license_id);
  if (select status from public.pos_layaways
       where license_id = v_v1_license_id and id = v_v1_authorized_cancel_id) is distinct from 'cancelled'
     or (select status from public.pos_layaways
       where license_id = v_v2_license_id and id = v_v2_authorized_cancel_id) is distinct from 'cancelled'
     or (select count(*) from public.pos_financial_operations
       where license_id = v_v1_license_id and idempotency_key = 'p0-v1-authorized-' || v_suffix) <> 1
     or (select count(*) from public.pos_financial_operations
       where license_id = v_v2_license_id and idempotency_key = 'p0-v2-authorized-' || v_suffix) <> 1 then
    raise exception 'P0_CONFIRMED_CANCEL_WAS_NOT_PRESERVED';
  end if;
end;
$test$;

rollback;
