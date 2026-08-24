-- PR225.CASH.CLOSE.R1 executable compatibility contract.
-- Run only in an authorized disposable local database after all migrations.
-- Every fixture and mutation is rolled back.
begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_id uuid := extensions.gen_random_uuid();
  v_admin_device_id uuid := extensions.gen_random_uuid();
  v_owner_device_id uuid := extensions.gen_random_uuid();
  v_admin_user_id uuid := extensions.gen_random_uuid();
  v_owner_staff_id uuid := extensions.gen_random_uuid();
  v_admin_session_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'R1-ADMIN-CLOSE-' || v_suffix;
  v_admin_fingerprint text := 'r1-admin-device-' || v_suffix;
  v_owner_fingerprint text := 'r1-owner-device-' || v_suffix;
  v_admin_device_token text := 'r1-admin-device-token-' || v_suffix;
  v_owner_device_token text := 'r1-owner-device-token-' || v_suffix;
  v_admin_session_token text := 'r1-admin-session-token-' || v_suffix;
  v_admin_actor_key text := 'admin:' || v_admin_user_id::text;
  v_owner_actor_key text := 'staff:' || v_owner_staff_id::text;
  v_station_id text := 'r1-station-' || v_suffix;
  v_cash_session_id text := 'r1-cash-session-' || v_suffix;
  v_totals_key text := 'r1-admin-close-totals-' || v_suffix;
  v_version_key text := 'r1-admin-close-version-' || v_suffix;
  v_success_key text := 'r1-admin-close-success-' || v_suffix;
  v_request jsonb;
  v_canonical jsonb;
  v_hash text;
  v_totals_hash text;
  v_version_hash text;
  v_result jsonb;
  v_replay jsonb;
  v_receipt jsonb;
  v_count integer;
begin
  if to_regprocedure('private.assert_financial_legacy_result_terminal_v1(text,jsonb)') is null
     or to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)') is null
     or to_regprocedure('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)') is null then
    raise exception 'ADMIN_CLOSE_FINANCIAL_TERMINAL_SCHEMA_MISSING';
  end if;

  -- The compatibility exception is deliberately exact. Missing success,
  -- another operation, or another failure code must still fail closed.
  perform private.assert_financial_legacy_result_terminal_v1(
    'cash.admin_close', jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT')
  );
  perform private.assert_financial_legacy_result_terminal_v1(
    'cash.admin_close', jsonb_build_object('success', false, 'code', 'CASH_TOTALS_CHANGED')
  );
  begin
    perform private.assert_financial_legacy_result_terminal_v1(
      'cash.admin_close', jsonb_build_object('success', false, 'code', 'CASH_SESSION_NOT_OPEN')
    );
    raise exception 'ADMIN_CLOSE_ARBITRARY_SUCCESS_FALSE_ACCEPTED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_LEGACY_OPERATION_REJECTED:CASH_SESSION_NOT_OPEN' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform private.assert_financial_legacy_result_terminal_v1(
      'cash.close', jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT')
    );
    raise exception 'OWNER_CLOSE_VERSION_CONFLICT_ALLOWLISTED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_LEGACY_OPERATION_REJECTED:VERSION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform private.assert_financial_legacy_result_terminal_v1(
      'cash.admin_close', jsonb_build_object('code', 'VERSION_CONFLICT')
    );
    raise exception 'ADMIN_CLOSE_MISSING_SUCCESS_ALLOWLISTED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_LEGACY_OPERATION_REJECTED:VERSION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;

  insert into public.licenses (
    id, license_key, license_type, status, expires_at, max_devices,
    product_name, features, plan_id
  ) values (
    v_license_id, v_license_key, 'pro', 'active', now() + interval '1 day', 4,
    'Admin close financial terminal fixture',
    '{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true}'::jsonb,
    (select id from public.plans where code = 'pro_monthly' limit 1)
  );
  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_admin_user_id, v_license_id, 'r1_admin_' || substr(v_suffix, 1, 8),
    'R1 Admin closer', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), true, true
  );
  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, permissions, is_active
  ) values (
    v_owner_staff_id, v_license_id, 'r1_owner_' || substr(v_suffix, 1, 8),
    'R1 historical owner', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)),
    '{"cash_register":true}'::jsonb, true
  );
  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, security_token,
    is_active, device_role, device_mode, staff_user_id
  ) values
    (
      v_admin_device_id, v_license_id, v_admin_fingerprint, 'R1 Admin device',
      v_admin_device_token, true, 'admin', 'admin_only', null
    ),
    (
      v_owner_device_id, v_license_id, v_owner_fingerprint, 'R1 owner device',
      v_owner_device_token, true, 'staff', 'staff_only', v_owner_staff_id
    );
  insert into public.license_admin_sessions (
    id, license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_admin_session_id, v_license_id, v_admin_user_id, v_admin_device_id,
    extensions.crypt(v_admin_session_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );
  insert into public.pos_cash_stations (
    id, license_id, station_key, status, binding_mode
  ) values (
    v_station_id, v_license_id, 'r1-station-key-' || v_suffix, 'active', 'explicit'
  );
  insert into public.pos_cash_station_bindings (
    license_id, cash_station_id, device_id, binding_mode, status
  ) values (
    v_license_id, v_station_id, v_admin_device_id, 'explicit', 'active'
  );
  insert into public.pos_cash_sessions (
    id, license_id, device_id, staff_user_id, device_role, scope,
    actor_key, status, cash_station_id, opened_by_actor_key,
    opening_amount, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_staff_user_id, server_version, metadata
  ) values (
    v_cash_session_id, v_license_id, v_owner_device_id, v_owner_staff_id, 'staff', 'actor',
    v_owner_actor_key, 'open', v_station_id, v_owner_actor_key,
    100, 100, 'R1 historical owner',
    v_owner_device_id, v_owner_staff_id, 1, '{"financial_test_disposable":true}'::jsonb
  );
  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, created_by_device_id,
    created_by_staff_user_id, actor_name, idempotency_key, metadata
  ) values (
    'r1-movement-' || v_suffix, v_license_id, v_cash_session_id,
    v_owner_device_id, v_owner_staff_id, v_owner_actor_key,
    'entrada', 25, 'R1 pending projection', 'manual', v_owner_device_id,
    v_owner_staff_id, 'R1 historical owner', 'r1-movement-key-' || v_suffix, '{}'::jsonb
  );

  -- First K/H: recalculation discovers the unprojected movement. The session
  -- stays open at refreshed version 2 and the response becomes a durable,
  -- receipt-visible terminal result rather than rolling back the refresh.
  v_request := jsonb_build_object(
    'cash_session_id', v_cash_session_id,
    'closing_mode', 'admin_audited',
    'counted_amount', 125,
    'next_shift_fund', 0,
    'reason_code', 'operational_error',
    'comments', 'R1 initial totals snapshot',
    'expected_version', 1
  );
  v_canonical := private.canonical_financial_request_v1('cash.admin_close', v_request);
  v_hash := private.financial_operation_hash(
    'cash.admin_close', v_canonical, v_admin_actor_key, v_cash_session_id, v_station_id
  );
  v_totals_hash := v_hash;
  v_result := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_totals_key, v_hash, 'cash.admin_close', v_request
  );
  if v_result->'success' is distinct from 'false'::jsonb
     or v_result->>'code' <> 'CASH_TOTALS_CHANGED'
     or v_result#>>'{cash_session,status}' <> 'open'
     or v_result#>>'{cash_session,expected_cash_total}' <> '125'
     or v_result#>>'{cash_session,server_version}' <> '2'
     or v_result->>'idempotency_key' <> v_totals_key then
    raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_NOT_DURABLE: %', v_result;
  end if;
  if not exists (
    select 1 from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_cash_session_id
      and s.status = 'open' and s.server_version = 2
      and s.expected_cash_total = 125 and s.cash_entries_total = 25
      and s.actor_key = v_owner_actor_key and s.opened_by_actor_key = v_owner_actor_key
      and s.closed_at is null and s.closing_mode is null and s.closed_by_actor_key is null
  ) then raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_SESSION_STATE_INVALID'; end if;
  if exists (
    select 1 from public.pos_cash_audit_events a
    where a.license_id = v_license_id and a.cash_session_id = v_cash_session_id
      and a.event_type in ('ADMIN_CLOSED_AUDITED', 'ADMIN_CLOSED_UNVERIFIED')
  ) or exists (
    select 1 from public.pos_sync_events e
    where e.license_id = v_license_id and e.entity_type = 'cash_session'
      and e.entity_id = v_cash_session_id and e.operation = 'close'
  ) then raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_EMITTED_CLOSE_EFFECT'; end if;
  if not exists (
    select 1 from public.pos_financial_operations o
    where o.license_id = v_license_id and o.idempotency_key = v_totals_key
      and o.request_hash = v_hash and o.operation_type = 'cash.admin_close'
      and o.status = 'completed' and o.response_payload = v_result
      and o.verified_actor_key = v_admin_actor_key
      and o.verified_cash_session_id = v_cash_session_id
      and o.verified_cash_station_id = v_station_id
  ) then raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_FINANCIAL_RECEIPT_MISSING'; end if;
  v_receipt := public.pos_get_financial_operation_receipt(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_totals_key, v_hash
  );
  if v_receipt->>'status' <> 'COMPLETED' or v_receipt->'result' is distinct from v_result then
    raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_RECEIPT_MISMATCH: %', v_receipt;
  end if;
  v_replay := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_totals_key, v_hash, 'cash.admin_close', v_request
  );
  if v_replay is distinct from v_result then
    raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_REPLAY_MISMATCH: first=% replay=%', v_result, v_replay;
  end if;
  select count(*) into v_count from public.pos_financial_operations
  where license_id = v_license_id and idempotency_key = v_totals_key;
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_DUPLICATE_FINANCIAL_OPERATION:%', v_count; end if;
  select count(*) into v_count from public.pos_idempotency_keys
  where license_id = v_license_id and operation_type = 'cash.admin_close'
    and entity_id = v_cash_session_id;
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_TOTALS_CHANGED_DUPLICATE_LEGACY_OPERATION:%', v_count; end if;

  -- Second K/H deliberately retains version 1 after the refreshed state was
  -- committed. VERSION_CONFLICT is likewise completed and exactly replayable.
  v_request := jsonb_build_object(
    'cash_session_id', v_cash_session_id,
    'closing_mode', 'admin_audited',
    'counted_amount', 125,
    'next_shift_fund', 0,
    'reason_code', 'operational_error',
    'comments', 'R1 stale version review',
    'expected_version', 1
  );
  v_canonical := private.canonical_financial_request_v1('cash.admin_close', v_request);
  v_hash := private.financial_operation_hash(
    'cash.admin_close', v_canonical, v_admin_actor_key, v_cash_session_id, v_station_id
  );
  v_version_hash := v_hash;
  v_result := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_version_key, v_hash, 'cash.admin_close', v_request
  );
  if v_result->'success' is distinct from 'false'::jsonb
     or v_result->>'code' <> 'VERSION_CONFLICT'
     or v_result#>>'{cash_session,status}' <> 'open'
     or v_result#>>'{cash_session,server_version}' <> '2'
     or v_result->>'idempotency_key' <> v_version_key then
    raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_NOT_DURABLE: %', v_result;
  end if;
  v_receipt := public.pos_get_financial_operation_receipt(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_version_key, v_hash
  );
  if v_receipt->>'status' <> 'COMPLETED' or v_receipt->'result' is distinct from v_result then
    raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_RECEIPT_MISMATCH: %', v_receipt;
  end if;
  v_replay := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_version_key, v_hash, 'cash.admin_close', v_request
  );
  if v_replay is distinct from v_result then
    raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_REPLAY_MISMATCH: first=% replay=%', v_result, v_replay;
  end if;
  if not exists (
    select 1 from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_cash_session_id
      and s.status = 'open' and s.server_version = 2
      and s.actor_key = v_owner_actor_key and s.closed_at is null
  ) or exists (
    select 1 from public.pos_cash_audit_events a
    where a.license_id = v_license_id and a.cash_session_id = v_cash_session_id
      and a.event_type in ('ADMIN_CLOSED_AUDITED', 'ADMIN_CLOSED_UNVERIFIED')
  ) or exists (
    select 1 from public.pos_sync_events e
    where e.license_id = v_license_id and e.entity_type = 'cash_session'
      and e.entity_id = v_cash_session_id and e.operation = 'close'
  ) then raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_CHANGED_SESSION'; end if;
  select count(*) into v_count from public.pos_financial_operations
  where license_id = v_license_id and idempotency_key in (v_totals_key, v_version_key);
  if v_count <> 2 then raise exception 'ADMIN_CLOSE_REFRESH_RESULT_DUPLICATE_FINANCIAL_OPERATION:%', v_count; end if;
  select count(*) into v_count from public.pos_idempotency_keys
  where license_id = v_license_id and operation_type = 'cash.admin_close'
    and entity_id = v_cash_session_id;
  if v_count <> 2 then raise exception 'ADMIN_CLOSE_REFRESH_RESULT_DUPLICATE_LEGACY_OPERATION:%', v_count; end if;

  -- A new K/H built from refreshed version 2 performs the one real close.
  v_request := jsonb_build_object(
    'cash_session_id', v_cash_session_id,
    'closing_mode', 'admin_audited',
    'counted_amount', 125,
    'next_shift_fund', 0,
    'reason_code', 'operational_error',
    'comments', 'R1 confirmed refreshed snapshot',
    'expected_version', 2
  );
  v_canonical := private.canonical_financial_request_v1('cash.admin_close', v_request);
  v_hash := private.financial_operation_hash(
    'cash.admin_close', v_canonical, v_admin_actor_key, v_cash_session_id, v_station_id
  );
  if v_hash in (v_totals_hash, v_version_hash)
     or v_success_key in (v_totals_key, v_version_key) then
    raise exception 'ADMIN_CLOSE_REFRESHED_K_H_NOT_NEW';
  end if;
  v_result := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_success_key, v_hash, 'cash.admin_close', v_request
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,status}' <> 'closed'
     or v_result#>>'{cash_session,server_version}' <> '3'
     or v_result#>>'{cash_session,actor_key}' <> v_owner_actor_key
     or v_result#>>'{cash_session,closed_by_actor_key}' <> v_admin_actor_key
     or v_result->>'idempotency_key' <> v_success_key then
    raise exception 'ADMIN_CLOSE_REFRESHED_SUCCESS_FAILED: %', v_result;
  end if;
  if not exists (
    select 1 from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_cash_session_id
      and s.status = 'closed' and s.server_version = 3
      and s.expected_cash_total = 125 and s.closing_counted_amount = 125
      and s.cash_difference = 0
      and s.actor_key = v_owner_actor_key and s.opened_by_actor_key = v_owner_actor_key
      and s.closed_by_admin_user_id = v_admin_user_id
      and s.closed_by_device_id = v_admin_device_id
      and s.closed_by_actor_key = v_admin_actor_key
  ) then raise exception 'ADMIN_CLOSE_REFRESHED_SUCCESS_PROVENANCE_INVALID'; end if;
  select count(*) into v_count from public.pos_cash_audit_events a
  where a.license_id = v_license_id and a.cash_session_id = v_cash_session_id
    and a.event_type = 'ADMIN_CLOSED_AUDITED';
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_REFRESHED_SUCCESS_AUDIT_COUNT:%', v_count; end if;
  select count(*) into v_count from public.pos_sync_events e
  where e.license_id = v_license_id and e.entity_type = 'cash_session'
    and e.entity_id = v_cash_session_id and e.operation = 'close';
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_REFRESHED_SUCCESS_SYNC_COUNT:%', v_count; end if;
  v_replay := public.pos_execute_financial_operation_v1(
    v_license_key, v_admin_fingerprint, v_admin_device_token, v_admin_session_token,
    v_success_key, v_hash, 'cash.admin_close', v_request
  );
  if v_replay is distinct from v_result then
    raise exception 'ADMIN_CLOSE_REFRESHED_SUCCESS_REPLAY_MISMATCH: first=% replay=%', v_result, v_replay;
  end if;
  select count(*) into v_count from public.pos_cash_audit_events a
  where a.license_id = v_license_id and a.cash_session_id = v_cash_session_id
    and a.event_type = 'ADMIN_CLOSED_AUDITED';
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_REFRESHED_REPLAY_DUPLICATED_AUDIT:%', v_count; end if;
  select count(*) into v_count from public.pos_sync_events e
  where e.license_id = v_license_id and e.entity_type = 'cash_session'
    and e.entity_id = v_cash_session_id and e.operation = 'close';
  if v_count <> 1 then raise exception 'ADMIN_CLOSE_REFRESHED_REPLAY_DUPLICATED_SYNC:%', v_count; end if;
  select count(*) into v_count from public.pos_financial_operations o
  where o.license_id = v_license_id
    and o.idempotency_key in (v_totals_key, v_version_key, v_success_key)
    and o.status = 'completed';
  if v_count <> 3 then raise exception 'ADMIN_CLOSE_FINANCIAL_TERMINAL_OPERATION_COUNT:%', v_count; end if;
end;
$test$;

rollback;
