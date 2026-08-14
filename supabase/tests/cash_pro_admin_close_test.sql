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
    ('cash-stale-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:stale-' || v_suffix, 'open', 10, 10, 'Stale cash', 2),
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

  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', 10, 0, 'operational_error', 'Stale version', 1, 'cash-stale-idem-' || v_suffix);
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
end;
$test$;

rollback;
