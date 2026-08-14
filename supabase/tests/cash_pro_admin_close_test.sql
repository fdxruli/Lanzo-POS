-- CASH PRO FASE 2 regression matrix. Fixtures are synthetic and rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_other_admin_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_other_license_device uuid := extensions.gen_random_uuid();
  v_admin_user uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_admin_session_id uuid := extensions.gen_random_uuid();
  v_admin_key text := 'TEST-CASH-ADMIN-' || v_suffix;
  v_other_key text := 'TEST-CASH-OTHER-' || v_suffix;
  v_fingerprint text := 'cash-admin-' || v_suffix;
  v_device_token text := 'cash-device-' || v_suffix;
  v_admin_token text := 'cash-admin-session-' || v_suffix;
  v_staff_token text := 'cash-staff-session-' || v_suffix;
  v_result jsonb;
  v_event_payload jsonb;
  v_count integer;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, max_devices, product_name, features, plan_id)
  values
    (v_license_id, v_admin_key, 'pro', 'active', now() + interval '1 day', 6, 'Cash admin fixture', '{}'::jsonb, (select id from public.plans where code='pro_monthly' limit 1)),
    (v_other_license_id, v_other_key, 'pro', 'active', now() + interval '1 day', 2, 'Other cash fixture', '{}'::jsonb, (select id from public.plans where code='pro_monthly' limit 1));
  insert into public.license_admin_users(id, license_id, username, display_name, password_hash, is_owner, is_active)
  values (v_admin_user, v_license_id, 'owner_' || substr(v_suffix,1,6), 'Cash owner', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), true, true);
  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values (v_staff_user, v_license_id, 'staff_' || substr(v_suffix,1,6), 'Cash staff', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), '{"cash_register":true,"cash_audit":true}'::jsonb);
  insert into public.license_devices(id, license_id, device_fingerprint, device_name, security_token, is_active, device_role, staff_user_id)
  values
    (v_admin_device, v_license_id, v_fingerprint, 'Chrome admin', v_device_token, true, 'admin', null),
    (v_other_admin_device, v_license_id, 'cash-other-admin-' || v_suffix, 'Edge admin', 'other-admin-device-' || v_suffix, true, 'admin', null),
    (v_staff_device, v_license_id, 'cash-staff-' || v_suffix, 'Chrome staff', 'staff-device-' || v_suffix, true, 'staff', v_staff_user),
    (v_other_license_device, v_other_license_id, 'cash-other-license-' || v_suffix, 'Other tenant', 'other-license-device-' || v_suffix, true, 'admin', null);
  insert into public.license_admin_sessions(id, license_id, admin_user_id, device_id, session_token_hash, expires_at)
  values (v_admin_session_id, v_license_id, v_admin_user, v_admin_device, extensions.crypt(v_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');
  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values (v_license_id, v_staff_user, v_staff_device, extensions.crypt(v_staff_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');

  -- Admin may close another admin and a staff session in its own tenant, never another tenant.
  insert into public.pos_cash_sessions(id, license_id, device_id, staff_user_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values
    ('cash-admin-audited-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:' || v_other_admin_device, 'open', 1196, 1196, 'Other admin', 1),
    ('cash-staff-unverified-' || v_suffix, v_license_id, v_staff_device, v_staff_user, 'staff', 'staff:' || v_staff_user, 'open', 1196, 1196, 'Staff cash', 1),
    ('cash-recalc-drift-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:' || v_admin_device, 'open', 1196, 1196, 'Recalculation drift cash', 1),
    ('cash-recalc-unverified-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:' || v_admin_device, 'open', 1196, 1196, 'Unverified recalculation drift cash', 1),
    ('cash-stale-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:' || v_admin_device, 'open', 10, 10, 'Stale cash', 1),
    ('cash-zero-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:zero-' || v_suffix, 'open', 0, 0, 'Zero counted cash', 1),
    ('cash-next-fund-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:next-fund-' || v_suffix, 'open', 1196, 1196, 'Next shift fund cash', 1),
    ('cash-other-tenant-' || v_suffix, v_other_license_id, v_other_license_device, null, 'admin', 'admin_device:other-' || v_suffix, 'open', 5, 5, 'Other tenant', 1);

  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Conteo documentado', 1, 'cash-admin-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean,false) is not true or v_result#>>'{cash_session,cash_difference}' <> '-16' then raise exception 'ADMIN_AUDITED_DIFFERENCE_FAILED: %', v_result; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-admin-audited-' || v_suffix and closing_mode='admin_audited' and reconciliation_status='verified_with_difference' and closed_by_admin_user_id=v_admin_user) then raise exception 'ADMIN_AUDITED_METADATA_FAILED'; end if;
  if not exists(select 1 from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED' and actor_admin_user_id=v_admin_user and actor_device_id=v_admin_device) then raise exception 'ADMIN_AUDITED_EVENT_FAILED'; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Conteo documentado', 1, 'cash-admin-idem-' || v_suffix);
  select count(*) into v_count from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED';
  if coalesce((v_result->>'success')::boolean,false) is not true or v_count <> 1 then raise exception 'ADMIN_CLOSE_IDEMPOTENCY_FAILED'; end if;

  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-staff-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'No existe conteo fisico confiable.', 1, 'cash-unverified-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'ADMIN_UNVERIFIED_FAILED: %', v_result; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-staff-unverified-' || v_suffix and closing_counted_amount is null and cash_difference is null and expected_cash_total=1196 and next_shift_fund=0 and reconciliation_status='unverified') then raise exception 'ADMIN_UNVERIFIED_NULL_SEMANTICS_FAILED'; end if;
  if exists(select 1 from public.pos_cash_movements where cash_session_id='cash-staff-unverified-' || v_suffix) then raise exception 'ADMIN_UNVERIFIED_CREATED_MOVEMENT'; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-staff-unverified-' || v_suffix and close_detail->>'expected_cash_total'='1196' and close_detail->>'closing_counted_amount' is null and close_detail->>'cash_difference' is null) then raise exception 'ADMIN_UNVERIFIED_CLOSE_DETAIL_NULL_FAILED'; end if;

  -- Zero is a valid audited physical count, never the representation of an unavailable count.
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-zero-' || v_suffix, 'admin_audited', 0, 0, 'operational_error', 'Conteo fisico de cero.', 1, 'cash-zero-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,closing_counted_amount}' <> '0'
     or v_result#>>'{cash_session,cash_difference}' <> '0' then
    raise exception 'ADMIN_AUDITED_ZERO_SEMANTICS_FAILED: %', v_result;
  end if;

  -- The retained next-shift fund is closure metadata and cannot change expected cash or difference.
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-next-fund-' || v_suffix, 'admin_audited', 1180, 200, 'operational_error', 'Fondo para el siguiente turno.', 1, 'cash-next-fund-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,expected_cash_total}' <> '1196'
     or v_result#>>'{cash_session,closing_counted_amount}' <> '1180'
     or v_result#>>'{cash_session,cash_difference}' <> '-16'
     or v_result#>>'{cash_session,next_shift_fund}' <> '200' then
    raise exception 'ADMIN_CLOSE_NEXT_SHIFT_FUND_SEMANTICS_FAILED: %', v_result;
  end if;

  -- Phase 4's CHECK must reject invalid snapshots even if a write bypasses the RPC.
  begin
    update public.pos_cash_sessions set closing_counted_amount = null where id = 'cash-admin-audited-' || v_suffix;
    raise exception 'ADMIN_AUDITED_NULL_COUNTED_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set cash_difference = 0 where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_DIFFERENCE_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set closure_reason_code = null where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_REASON_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set audit_comments = '' where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_COMMENT_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;

  -- A stale aggregate can change during canonical recalculation without an earlier version bump.
  insert into public.pos_cash_movements(
    id, license_id, cash_session_id, device_id, actor_key, type, amount, concept,
    source, created_by_device_id, actor_name, idempotency_key, metadata
  ) values (
    'mov-recalc-drift-' || v_suffix, v_license_id, 'cash-recalc-drift-' || v_suffix,
    v_admin_device, 'admin_device:' || v_admin_device, 'entrada', 4, 'Entrada pendiente de proyectar',
    'manual', v_admin_device, 'Cash owner', 'cash-recalc-drift-movement-' || v_suffix, '{}'::jsonb
  );
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Snapshot previo', 1, 'cash-recalc-drift-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED'
     or v_result#>>'{cash_session,status}' <> 'open'
     or v_result#>>'{cash_session,expected_cash_total}' <> '1200'
     or v_result#>>'{cash_session,server_version}' <> '2' then
    raise exception 'ADMIN_CLOSE_RECALC_GUARD_FAILED: %', v_result;
  end if;
  if exists(select 1 from public.pos_cash_sessions where id='cash-recalc-drift-' || v_suffix and (closed_at is not null or closing_mode is not null or cash_difference is not null))
     or exists(select 1 from public.pos_cash_audit_events where cash_session_id='cash-recalc-drift-' || v_suffix and event_type in ('ADMIN_CLOSED_AUDITED', 'ADMIN_CLOSED_UNVERIFIED'))
     or exists(select 1 from public.pos_sync_events where entity_type='cash_session' and entity_id='cash-recalc-drift-' || v_suffix and operation='close') then
    raise exception 'ADMIN_CLOSE_RECALC_GUARD_CLOSED_OR_AUDITED';
  end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Replay conflict', 1, 'cash-recalc-drift-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED' then raise exception 'ADMIN_CLOSE_RECALC_CONFLICT_IDEMPOTENCY_FAILED: %', v_result; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Confirmed refreshed snapshot', 2, 'cash-recalc-drift-key-b-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result#>>'{cash_session,cash_difference}' <> '-20' then raise exception 'ADMIN_CLOSE_RECALC_SECOND_ATTEMPT_FAILED: %', v_result; end if;

  insert into public.pos_cash_movements(
    id, license_id, cash_session_id, device_id, actor_key, type, amount, concept,
    source, created_by_device_id, actor_name, idempotency_key, metadata
  ) values (
    'mov-recalc-unverified-' || v_suffix, v_license_id, 'cash-recalc-unverified-' || v_suffix,
    v_admin_device, 'admin_device:' || v_admin_device, 'entrada', 4, 'Entrada pendiente de proyectar sin conteo',
    'manual', v_admin_device, 'Cash owner', 'cash-recalc-unverified-movement-' || v_suffix, '{}'::jsonb
  );
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Sin conteo; snapshot previo', 1, 'cash-recalc-unverified-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED'
     or v_result#>>'{cash_session,status}' <> 'open'
     or v_result#>>'{cash_session,expected_cash_total}' <> '1200' then
    raise exception 'ADMIN_UNVERIFIED_RECALC_GUARD_FAILED: %', v_result;
  end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Sin conteo; snapshot actualizado', 2, 'cash-recalc-unverified-key-b-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,closing_counted_amount}' is not null
     or v_result#>>'{cash_session,cash_difference}' is not null
     or v_result#>>'{cash_session,reconciliation_status}' <> 'unverified' then
    raise exception 'ADMIN_UNVERIFIED_RECALC_SECOND_ATTEMPT_FAILED: %', v_result;
  end if;

  v_result := public.pos_register_cash_movement_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'entrada', 1, 'Cambio concurrente sintetico', 'cash-stale-movement-' || v_suffix, '{}'::jsonb);
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result#>>'{cash_session,server_version}' <> '2' then raise exception 'CONCURRENCY_MUTATION_FAILED: %', v_result; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', 11, 0, 'operational_error', 'Stale version', 1, 'cash-stale-idem-' || v_suffix);
  if v_result->>'code' <> 'VERSION_CONFLICT' then raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_FAILED: %', v_result; end if;

  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-other-tenant-' || v_suffix, 'admin_audited', 5, 0, 'operational_error', 'Wrong tenant', 1, 'cash-other-tenant-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_CROSS_TENANT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, 'cash-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_token, 'cash-stale-' || v_suffix, 'admin_audited', 10, 0, 'operational_error', 'Staff attempt', 2, 'cash-staff-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_STAFF_ACCEPTED';
  exception when others then
    if sqlerrm not in ('ADMIN_DEVICE_REQUIRED', 'ADMIN_SESSION_INVALID') then raise; end if;
  end;

  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', 0, 0, 'historical_test', 'Must fail', 2, 'cash-invalid-unverified-' || v_suffix);
    raise exception 'ADMIN_UNVERIFIED_COUNTED_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, 1, 'historical_test', 'Must fail', 2, 'cash-invalid-fund-' || v_suffix);
    raise exception 'ADMIN_UNVERIFIED_FUND_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_UNVERIFIED_NEXT_FUND_FORBIDDEN' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', null, 0, 'operational_error', 'Must fail', 2, 'cash-invalid-counted-' || v_suffix);
    raise exception 'ADMIN_AUDITED_NULL_COUNTED_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED' then raise; end if; end;

  -- The public rate-limited wrapper preserves the same privileged contract.
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values ('cash-wrapper-' || v_suffix, v_license_id, v_other_admin_device, 'admin', 'admin_device:wrapper-' || v_suffix, 'open', 7, 7, 'Wrapper cash', 1);
  v_result := public.pos_admin_close_cash_session(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-wrapper-' || v_suffix, 'admin_audited', 7, 0, 'operational_error', 'Wrapper close', 1, 'cash-wrapper-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'ADMIN_CLOSE_WRAPPER_FAILED: %', v_result; end if;

  -- Closed, deleted and unknown sessions never become administratively closable.
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-wrapper-' || v_suffix, 'admin_audited', 7, 0, 'operational_error', 'Second close', 2, 'cash-wrapper-second-' || v_suffix);
    raise exception 'ADMIN_CLOSE_CLOSED_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_OPEN' then raise; end if; end;
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version, deleted_at)
  values ('cash-deleted-' || v_suffix, v_license_id, v_other_admin_device, 'admin', 'admin_device:deleted-' || v_suffix, 'open', 1, 1, 'Deleted cash', 1, now());
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-deleted-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Deleted fixture', 1, 'cash-deleted-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_DELETED_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-missing-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Unknown fixture', 1, 'cash-missing-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_MISSING_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', 5, 6, 'operational_error', 'Fund must fail', 2, 'cash-excess-fund-' || v_suffix);
    raise exception 'ADMIN_CLOSE_EXCESS_FUND_ACCEPTED';
  exception when others then if sqlerrm <> 'NEXT_SHIFT_FUND_EXCEEDS_COUNTED' then raise; end if; end;

  -- Normal owner closure remains available and retains its historical semantics.
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values ('cash-normal-' || v_suffix, v_license_id, v_admin_device, 'admin', 'admin_device:' || v_admin_device, 'open', 7, 7, 'Normal owner cash', 1);
  v_result := public.pos_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-normal-' || v_suffix, '{"closing_counted_amount":7,"next_shift_fund":0,"audit_comments":"Normal close regression"}'::jsonb, 1, 'cash-normal-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,cash_difference}' <> '0' then
    raise exception 'NORMAL_CLOSE_REGRESSION_FAILED: %', v_result;
  end if;

  -- The detail RPC is tenant scoped and exposes the single-session audit read model.
  v_result := public.pos_admin_get_cash_session_detail_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce(jsonb_array_length(v_result->'audit_events'), 0) <> 1
     or v_result#>>'{cash_session,closing_mode}' <> 'admin_audited'
     or v_result#>>'{audit_events,0,device_name}' <> 'Chrome admin'
     or v_result#>>'{audit_events,0,admin_display_name}' <> 'Cash owner' then
    raise exception 'ADMIN_DETAIL_READ_MODEL_FAILED: %', v_result;
  end if;
  v_result := public.pos_admin_list_cash_sessions_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, null, null, null, null, 100, 0);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or not exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') row_payload where row_payload->>'id'='cash-admin-audited-' || v_suffix and row_payload->>'device_name'='Edge admin' and row_payload->>'closed_by_device_name'='Chrome admin') then
    raise exception 'ADMIN_LIST_READ_MODEL_FAILED: %', v_result;
  end if;
  select payload into v_event_payload from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED';
  if v_event_payload::text like '%' || v_admin_token || '%' or v_event_payload::text like '%' || v_device_token || '%' then
    raise exception 'ADMIN_AUDIT_EVENT_EXPOSED_SECRET';
  end if;

  -- A privileged close requires a live, unrevoked, unexpired admin session.
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, null, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'No session', 2, 'cash-no-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_NO_SESSION_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_SESSION_REQUIRED' then raise; end if; end;
  update public.license_admin_sessions set revoked_at = now() where id = v_admin_session_id;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Revoked session', 2, 'cash-revoked-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_REVOKED_SESSION_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_SESSION_INVALID' then raise; end if; end;
  update public.license_admin_sessions set revoked_at = null, expires_at = now() - interval '1 minute' where id = v_admin_session_id;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Expired session', 2, 'cash-expired-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_EXPIRED_SESSION_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_SESSION_EXPIRED' then raise; end if; end;
end;
$test$;

rollback;
