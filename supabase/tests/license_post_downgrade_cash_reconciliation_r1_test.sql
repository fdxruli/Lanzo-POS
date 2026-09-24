-- Phase 3 post-downgrade cash reconciliation. Synthetic fixtures only; always rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_owner uuid := extensions.gen_random_uuid();
  v_non_owner uuid := extensions.gen_random_uuid();
  v_other_owner uuid := extensions.gen_random_uuid();
  v_staff uuid := extensions.gen_random_uuid();
  v_owner_device uuid := extensions.gen_random_uuid();
  v_non_owner_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_original_device uuid := extensions.gen_random_uuid();
  v_historical_staff_device uuid := extensions.gen_random_uuid();
  v_other_device uuid := extensions.gen_random_uuid();
  v_owner_session uuid := extensions.gen_random_uuid();
  v_non_owner_session uuid := extensions.gen_random_uuid();
  v_other_owner_session uuid := extensions.gen_random_uuid();
  v_staff_session uuid := extensions.gen_random_uuid();
  v_license_key text := 'TEST-POST-DOWNGRADE-' || v_suffix;
  v_other_key text := 'TEST-POST-DOWNGRADE-OTHER-' || v_suffix;
  v_owner_fingerprint text := 'owner-' || v_suffix;
  v_non_owner_fingerprint text := 'non-owner-' || v_suffix;
  v_staff_fingerprint text := 'staff-' || v_suffix;
  v_other_fingerprint text := 'other-' || v_suffix;
  v_owner_security text := 'owner-security-' || v_suffix;
  v_non_owner_security text := 'non-owner-security-' || v_suffix;
  v_staff_security text := 'staff-security-' || v_suffix;
  v_other_security text := 'other-security-' || v_suffix;
  v_owner_token text := 'owner-session-' || v_suffix;
  v_non_owner_token text := 'non-owner-session-' || v_suffix;
  v_staff_token text := 'staff-session-' || v_suffix;
  v_other_token text := 'other-session-' || v_suffix;
  v_pro_started timestamptz := clock_timestamp() - interval '2 days';
  v_historical_opened timestamptz := clock_timestamp() - interval '1 day';
  v_result jsonb;
  v_downgraded_at timestamptz;
  v_before integer;
  v_after integer;
  v_version integer;
  v_function text;
begin
  insert into public.licenses(
    id, license_key, license_type, status, expires_at, max_devices, product_name, features, plan_id
  )
  select
    v_license_id, v_license_key, 'pro', 'active', now() + interval '1 day', 6,
    'Phase 3 bridge fixture', p.features, p.id
  from public.plans p
  where p.code = 'pro_monthly';

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, max_devices, product_name, features, plan_id
  )
  select
    v_other_license_id, v_other_key, 'free', 'active', null, 1,
    'Free-only fixture', p.features, p.id
  from public.plans p
  where p.code = 'free_trial';

  insert into public.license_admin_users(id, license_id, username, display_name, password_hash, is_owner, is_active)
  values
    (v_owner, v_license_id, 'owner_' || v_suffix, 'Bridge Owner', extensions.crypt('pw-' || v_suffix, extensions.gen_salt('bf', 4)), true, true),
    (v_non_owner, v_license_id, 'admin_' || v_suffix, 'Bridge Admin', extensions.crypt('pw-' || v_suffix, extensions.gen_salt('bf', 4)), false, true),
    (v_other_owner, v_other_license_id, 'other_' || v_suffix, 'Other Owner', extensions.crypt('pw-' || v_suffix, extensions.gen_salt('bf', 4)), true, true);

  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values (
    v_staff, v_license_id, 'staff_' || v_suffix, 'Historical Staff',
    extensions.crypt('pw-' || v_suffix, extensions.gen_salt('bf', 4)),
    '{"cash_register":true,"cash_audit":true}'::jsonb
  );

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name, security_token, is_active, device_role, staff_user_id
  )
  values
    (v_owner_device, v_license_id, v_owner_fingerprint, 'Owner current device', v_owner_security, true, 'admin', null),
    (v_non_owner_device, v_license_id, v_non_owner_fingerprint, 'Non-owner device', v_non_owner_security, true, 'admin', null),
    (v_staff_device, v_license_id, v_staff_fingerprint, 'Staff requester device', v_staff_security, true, 'staff', v_staff),
    (v_original_device, v_license_id, 'old-admin-' || v_suffix, 'Retired admin device', 'old-admin-token-' || v_suffix, true, 'admin', null),
    (v_historical_staff_device, v_license_id, 'old-staff-' || v_suffix, 'Retired staff device', 'old-staff-token-' || v_suffix, true, 'staff', v_staff),
    (v_other_device, v_other_license_id, v_other_fingerprint, 'Other tenant device', v_other_security, true, 'admin', null);

  insert into public.license_admin_sessions(id, license_id, admin_user_id, device_id, session_token_hash, expires_at)
  values
    (v_owner_session, v_license_id, v_owner, v_owner_device, extensions.crypt(v_owner_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_non_owner_session, v_license_id, v_non_owner, v_non_owner_device, extensions.crypt(v_non_owner_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_other_owner_session, v_other_license_id, v_other_owner, v_other_device, extensions.crypt(v_other_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');

  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values (v_license_id, v_staff, v_staff_device, extensions.crypt(v_staff_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');

  -- Canonical plan at opening time was PRO. The current downgrade event will be emitted by the license UPDATE below.
  insert into public.license_events(license_key, event_type, triggered_at, metadata)
  values (
    v_license_key,
    'PLAN_CHANGED',
    v_pro_started,
    jsonb_build_object(
      'source', 'licenses_update_trigger',
      'from_plan', 'free_trial',
      'to_plan', 'pro_monthly'
    )
  );

  insert into public.pos_cash_sessions(
    id, license_id, device_id, staff_user_id, device_role, actor_key, status,
    opened_at, opening_amount, expected_cash_total, responsible_name, server_version
  )
  values
    ('cash-owner-history-' || v_suffix, v_license_id, v_original_device, null, 'admin', 'admin:' || v_owner::text, 'open',
      v_historical_opened, 100, 100, 'Historical owner', 1),
    ('cash-staff-history-' || v_suffix, v_license_id, v_historical_staff_device, v_staff, 'staff', 'staff:' || v_staff::text, 'open',
      v_historical_opened + interval '1 hour', 50, 50, 'Historical Staff', 1),
    ('cash-upgrade-history-' || v_suffix, v_license_id, v_original_device, null, 'admin', 'admin:' || v_owner::text, 'open',
      v_historical_opened + interval '2 hours', 25, 25, 'Upgrade pending cash', 1),
    ('cash-closed-history-' || v_suffix, v_license_id, v_original_device, null, 'admin', 'admin:' || v_owner::text, 'closed',
      v_historical_opened + interval '3 hours', 10, 10, 'Closed history', 1);

  update public.pos_cash_sessions
  set closed_at = v_historical_opened + interval '4 hours'
  where id = 'cash-closed-history-' || v_suffix;

  select count(*) into v_before
  from public.pos_cash_sessions
  where license_id = v_license_id and status = 'open' and deleted_at is null;

  -- Materialize the downgrade. This must not close financial sessions.
  update public.licenses l
  set plan_id = p.id,
      features = p.features,
      max_devices = 1,
      product_name = 'Lanzo POS Free',
      expires_at = null,
      updated_at = now()
  from public.plans p
  where l.id = v_license_id
    and p.code = 'free_trial';

  select max(e.triggered_at) into v_downgraded_at
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'PLAN_CHANGED'
    and e.metadata->>'source' = 'licenses_update_trigger'
    and e.metadata->>'from_plan' = 'pro_monthly'
    and e.metadata->>'to_plan' = 'free_trial';

  if v_downgraded_at is null then
    raise exception 'POST_DOWNGRADE_FIXTURE_BOUNDARY_MISSING';
  end if;

  select count(*) into v_after
  from public.pos_cash_sessions
  where license_id = v_license_id and status = 'open' and deleted_at is null;
  if v_after <> v_before then
    raise exception 'POST_DOWNGRADE_AUTO_CLOSED_CASH: before %, after %', v_before, v_after;
  end if;

  update public.license_devices
  set is_active = false
  where id in (v_original_device, v_historical_staff_device);

  update public.license_staff_users
  set is_active = false
  where id = v_staff;

  insert into public.pos_cash_sessions(
    id, license_id, device_id, device_role, actor_key, status,
    opened_at, opening_amount, expected_cash_total, responsible_name, server_version
  )
  values (
    'cash-after-downgrade-' || v_suffix, v_license_id, v_owner_device, 'admin', 'admin:' || v_owner::text, 'open',
    v_downgraded_at + interval '1 minute', 5, 5, 'Not historical', 1
  );

  insert into public.pos_cash_sessions(
    id, license_id, device_id, device_role, actor_key, status,
    opened_at, opening_amount, expected_cash_total, responsible_name, server_version
  )
  values (
    'cash-free-only-' || v_suffix, v_other_license_id, v_other_device, 'admin', 'admin:' || v_other_owner::text, 'open',
    clock_timestamp() - interval '1 hour', 3, 3, 'Free only', 1
  );

  -- Eligibility: exactly the three still-open historical PRO sessions are listed.
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 3
     or not exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') x where x->>'id' = 'cash-owner-history-' || v_suffix)
     or not exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') x where x->>'id' = 'cash-staff-history-' || v_suffix)
     or not exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') x where x->>'id' = 'cash-upgrade-history-' || v_suffix)
     or exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') x where x->>'id' = 'cash-after-downgrade-' || v_suffix)
     or exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') x where x->>'id' = 'cash-closed-history-' || v_suffix) then
    raise exception 'POST_DOWNGRADE_ELIGIBILITY_FAILED: %', v_result;
  end if;

  -- Free with no prior cloud entitlement has no bridge surface.
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_other_key, v_other_fingerprint, v_other_security, v_other_token
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'POST_DOWNGRADE_FREE_ONLY_VISIBLE: %', v_result;
  end if;

  -- Cross-tenant IDs do not reveal data.
  begin
    perform public.pos_get_post_downgrade_cash_session_detail(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
      'cash-free-only-' || v_suffix
    );
    raise exception 'POST_DOWNGRADE_CROSS_TENANT_DETAIL_ACCEPTED';
  exception when others then
    if sqlerrm <> 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE' then raise; end if;
  end;

  -- Admin but not owner cannot use the exceptional bridge.
  begin
    perform public.pos_list_post_downgrade_cash_sessions(
      v_license_key, v_non_owner_fingerprint, v_non_owner_security, v_non_owner_token
    );
    raise exception 'POST_DOWNGRADE_NON_OWNER_ACCEPTED';
  exception when others then
    if sqlerrm <> 'POST_DOWNGRADE_CASH_OWNER_REQUIRED' then raise; end if;
  end;

  -- Staff cannot use it, even with a cash permission.
  begin
    perform public.pos_list_post_downgrade_cash_sessions(
      v_license_key, v_staff_fingerprint, v_staff_security, v_staff_token
    );
    raise exception 'POST_DOWNGRADE_STAFF_ACCEPTED';
  exception when others then
    if sqlerrm not in ('POST_DOWNGRADE_CASH_OWNER_REQUIRED','ACTOR_SESSION_INVALID','STAFF_USER_DISABLED') then raise; end if;
  end;

  -- Revoked owner session cannot operate.
  update public.license_admin_sessions set revoked_at = now() where id = v_owner_session;
  begin
    perform public.pos_list_post_downgrade_cash_sessions(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token
    );
    raise exception 'POST_DOWNGRADE_REVOKED_OWNER_SESSION_ACCEPTED';
  exception when others then
    if sqlerrm not in ('ADMIN_SESSION_INVALID','ACTOR_SESSION_INVALID') then raise; end if;
  end;
  update public.license_admin_sessions set revoked_at = null where id = v_owner_session;

  -- Inactive requester device cannot operate; original inactive device does not affect eligibility.
  update public.license_devices set is_active = false where id = v_owner_device;
  begin
    perform public.pos_list_post_downgrade_cash_sessions(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token
    );
    raise exception 'POST_DOWNGRADE_INACTIVE_REQUESTER_ACCEPTED';
  exception when others then
    if sqlerrm not in ('POS_DEVICE_NOT_FOUND_OR_INACTIVE','ADMIN_DEVICE_NOT_FOUND_OR_INACTIVE','DEVICE_NOT_FOUND_OR_INACTIVE') then raise; end if;
  end;
  update public.license_devices set is_active = true where id = v_owner_device;

  -- Normal cloud cash remains blocked while current plan is Free.
  begin
    perform public.pos_open_cash_session_unlimited(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
      '{"opening_amount":1}'::jsonb, 'free-open-blocked-' || v_suffix
    );
    raise exception 'POST_DOWNGRADE_FREE_CLOUD_OPEN_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CLOUD_CASH_SYNC_DISABLED' then raise; end if;
  end;
  begin
    perform public.pos_register_cash_movement_unlimited(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
      'cash-owner-history-' || v_suffix, 'entrada', 1, 'Must remain blocked',
      'free-movement-blocked-' || v_suffix, '{}'::jsonb
    );
    raise exception 'POST_DOWNGRADE_FREE_CLOUD_MOVEMENT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CLOUD_CASH_SYNC_DISABLED' then raise; end if;
  end;

  -- Detail exposes the canonical financial snapshot without cross-tenant technical IDs.
  v_result := public.pos_get_post_downgrade_cash_session_detail(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
    'cash-owner-history-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,id}' <> 'cash-owner-history-' || v_suffix
     or (v_result#>>'{cash_session,expected_cash_total}')::numeric <> 100
     or v_result#>'{cash_session,license_id}' is not null
     or v_result#>'{cash_session,device_id}' is not null then
    raise exception 'POST_DOWNGRADE_DETAIL_FAILED: %', v_result;
  end if;

  select count(*) into v_before
  from public.pos_cash_movements
  where license_id = v_license_id and cash_session_id = 'cash-owner-history-' || v_suffix;

  -- Explicit owner close from a different active device. The original device stays inactive.
  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
    'cash-owner-history-' || v_suffix, 'admin_audited', 100, 0,
    'abandoned_session', 'Synthetic owner reconciliation.', 1,
    'post-downgrade-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,status}' <> 'closed'
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'POST_DOWNGRADE_CLOSE_FAILED: %', v_result;
  end if;

  select count(*) into v_after
  from public.pos_cash_movements
  where license_id = v_license_id and cash_session_id = 'cash-owner-history-' || v_suffix;
  if v_after <> v_before then
    raise exception 'POST_DOWNGRADE_CLOSE_CREATED_MOVEMENT';
  end if;
  if exists(select 1 from public.license_devices where id = v_original_device and is_active is true) then
    raise exception 'POST_DOWNGRADE_REACTIVATED_ORIGINAL_DEVICE';
  end if;
  if not exists(
    select 1 from public.pos_cash_audit_events
    where license_id = v_license_id
      and cash_session_id = 'cash-owner-history-' || v_suffix
      and actor_admin_user_id = v_owner
      and payload->>'reconciliation_source' = 'POST_DOWNGRADE_CASH_RECONCILIATION'
  ) then
    raise exception 'POST_DOWNGRADE_AUDIT_METADATA_MISSING';
  end if;

  -- Same request key replays one financial result and does not duplicate audit.
  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
    'cash-owner-history-' || v_suffix, 'admin_audited', 100, 0,
    'abandoned_session', 'Synthetic owner reconciliation.', 1,
    'post-downgrade-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.pos_cash_audit_events
         where license_id=v_license_id
           and cash_session_id='cash-owner-history-' || v_suffix
           and payload->>'reconciliation_source'='POST_DOWNGRADE_CASH_RECONCILIATION') <> 1 then
    raise exception 'POST_DOWNGRADE_IDEMPOTENT_REPLAY_FAILED: %', v_result;
  end if;

  -- Reusing the same key with different financial data is rejected.
  begin
    perform public.pos_close_post_downgrade_cash_session(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
      'cash-owner-history-' || v_suffix, 'admin_audited', 99, 0,
      'abandoned_session', 'Synthetic owner reconciliation.', 1,
      'post-downgrade-close-' || v_suffix
    );
    raise exception 'POST_DOWNGRADE_IDEMPOTENCY_CONFLICT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- Different second request sees the single closed transition deterministically.
  begin
    perform public.pos_close_post_downgrade_cash_session(
      v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
      'cash-owner-history-' || v_suffix, 'admin_audited', 100, 0,
      'abandoned_session', 'Second close.', 2,
      'post-downgrade-second-close-' || v_suffix
    );
    raise exception 'POST_DOWNGRADE_DOUBLE_CLOSE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'POST_DOWNGRADE_CASH_ALREADY_CLOSED' then raise; end if;
  end;

  -- Owner can close a historical Staff cash session while Staff and original device are inactive.
  if not exists(
    select 1 from public.pos_cash_sessions
    where id='cash-staff-history-' || v_suffix
      and staff_user_id=v_staff
      and responsible_name='Historical Staff'
      and status='open'
  ) then
    raise exception 'POST_DOWNGRADE_STAFF_HISTORY_CHANGED_BEFORE_CLOSE';
  end if;
  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
    'cash-staff-history-' || v_suffix, 'admin_audited', 50, 0,
    'abandoned_session', 'Synthetic Staff reconciliation by owner.', 1,
    'post-downgrade-staff-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or not exists(
       select 1 from public.pos_cash_sessions
       where id='cash-staff-history-' || v_suffix
         and staff_user_id=v_staff
         and responsible_name='Historical Staff'
         and closed_by_admin_user_id=v_owner
         and status='closed'
     ) then
    raise exception 'POST_DOWNGRADE_STAFF_HISTORY_CLOSE_FAILED: %', v_result;
  end if;

  -- One historical session remains pending before upgrade.
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 1 then
    raise exception 'POST_DOWNGRADE_PENDING_BEFORE_UPGRADE_FAILED: %', v_result;
  end if;

  -- Upgrade disables the bridge and restores only the normal PRO Cloud Cash surface.
  update public.licenses l
  set plan_id = p.id,
      features = p.features,
      max_devices = 5,
      product_name = 'Lanzo POS Pro',
      expires_at = now() + interval '30 days',
      updated_at = now()
  from public.plans p
  where l.id = v_license_id
    and p.code = 'pro_monthly';

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'POST_DOWNGRADE_BRIDGE_VISIBLE_AFTER_UPGRADE: %', v_result;
  end if;

  select server_version into v_version
  from public.pos_cash_sessions
  where id = 'cash-upgrade-history-' || v_suffix;

  v_result := public.pos_admin_close_cash_session_unlimited(
    v_license_key, v_owner_fingerprint, v_owner_security, v_owner_token,
    'cash-upgrade-history-' || v_suffix, 'admin_audited', 25, 0,
    'abandoned_session', 'Normal PRO close after upgrade.', v_version,
    'normal-pro-close-after-upgrade-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,status}' <> 'closed' then
    raise exception 'POST_DOWNGRADE_NORMAL_PRO_CLOSE_REGRESSION: %', v_result;
  end if;

  -- Structural concurrency boundary: shared financial core row-locks one cash session;
  -- the bridge also holds the license row while evaluating the current plan cycle.
  select pg_get_functiondef('private.execute_admin_cash_close_v2(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,text,integer,text,text,text)'::regprocedure)
  into v_function;
  if position('for update' in lower(v_function)) = 0 then
    raise exception 'POST_DOWNGRADE_CASH_ROW_LOCK_MISSING';
  end if;

  select pg_get_functiondef('public.pos_close_post_downgrade_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'::regprocedure)
  into v_function;
  if position('for share' in lower(v_function)) = 0 then
    raise exception 'POST_DOWNGRADE_LICENSE_LOCK_MISSING';
  end if;
end;
$test$;

rollback;
