-- LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1
-- Transactional regression matrix. Fixture writes roll back.
begin;

do $test$
declare
  v_pro_plan uuid;
  v_free_plan uuid;
  v_license uuid := extensions.gen_random_uuid();
  v_license_key text := 'TAKEOVER-R1-' || extensions.gen_random_uuid()::text;
  v_owner uuid := extensions.gen_random_uuid();
  v_non_owner uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_device_b uuid := extensions.gen_random_uuid();
  v_staff uuid := extensions.gen_random_uuid();
  v_password text := 'OwnerPass123';
  v_non_owner_password text := 'OtherPass123';
  v_session_a jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_cash_before jsonb;
  v_cash_after jsonb;
  v_cash_id text := 'cash_takeover_' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_count integer;
  v_pro_license uuid := extensions.gen_random_uuid();
  v_pro_key text := 'TAKEOVER-R1-PRO-' || extensions.gen_random_uuid()::text;
  v_pro_owner uuid := extensions.gen_random_uuid();
  v_free_license uuid := extensions.gen_random_uuid();
  v_free_key text := 'TAKEOVER-R1-FREE-' || extensions.gen_random_uuid()::text;
  v_free_owner uuid := extensions.gen_random_uuid();
  v_free_device uuid := extensions.gen_random_uuid();
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
begin
  select id into v_pro_plan from public.plans where code = 'pro_monthly' and is_active limit 1;
  select id into v_free_plan from public.plans where code = 'free_trial' and is_active limit 1;
  if v_pro_plan is null or v_free_plan is null then
    raise exception 'TAKEOVER_R1_PLANS_MISSING';
  end if;

  -- Case A: real paid lifecycle downgrade with two Admin devices.
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values (
    v_license, v_license_key, v_pro_plan, 'subscription', 'active',
    now() + interval '1 day', false, 1, 5, '{}'::jsonb, 'Takeover R1'
  );

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license, v_pro_plan, 'pro_monthly', 'Lanzo Nube',
    'pro_paid', 'active', now() - interval '40 days', now() - interval '8 days', 15,
    '{"fixture":"takeover-r1"}'::jsonb
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values
    (
      v_device_a, v_license, 'takeover-a-' || v_suffix, 'Survivor A', '{}'::jsonb, true,
      now() - interval '30 days', now() - interval '1 day',
      'old-token-a-' || v_suffix, null, 'admin', 'admin_only'
    ),
    (
      v_device_b, v_license, 'takeover-b-' || v_suffix, 'Recovery B', '{}'::jsonb, true,
      now() - interval '10 days', now(),
      'old-token-b-' || v_suffix, null, 'admin', 'admin_only'
    );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (
      v_owner, v_license, 'owner_' || substr(v_suffix, 1, 10), 'Owner Fixture',
      extensions.crypt(v_password, extensions.gen_salt('bf', 12)), true, true
    ),
    (
      v_non_owner, v_license, 'other_' || substr(v_suffix, 1, 10), 'Other Admin',
      extensions.crypt(v_non_owner_password, extensions.gen_salt('bf', 12)), false, true
    );

  v_session_a := private.create_admin_session(v_license, v_owner, v_device_a, 'Survivor A');
  perform private.create_admin_session(v_license, v_owner, v_device_b, 'Recovery B');

  update public.licenses
     set expires_at = now() - interval '8 days'
   where id = v_license;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'Case A: material downgrade failed: %', v_result;
  end if;

  if (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_a and is_active)
     or not exists (
       select 1
       from public.license_devices
       where id = v_device_b
         and not is_active
         and device_info #>> '{license_block,reason}' = 'PLAN_DOWNGRADE_DEVICE_LIMIT'
     ) then
    raise exception 'Case A: canonical downgrade evidence/device state missing';
  end if;

  -- Case B: wrong password cannot reveal or execute takeover.
  v_result := public.admin_login_on_device(
    v_license_key,
    'owner_' || substr(v_suffix, 1, 10),
    'wrong-password',
    'takeover-b-' || v_suffix,
    'Recovery B',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'INVALID_ADMIN_CREDENTIALS'
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_a and is_active) then
    raise exception 'Case B: invalid credentials altered/offered recovery: %', v_result;
  end if;

  -- Case C: valid non-owner credentials do not authorize owner recovery.
  v_result := public.admin_login_on_device(
    v_license_key,
    'other_' || substr(v_suffix, 1, 10),
    v_non_owner_password,
    'takeover-b-' || v_suffix,
    'Recovery B',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'INVALID_ADMIN_CREDENTIALS' then
    raise exception 'Case C: non-owner received recovery authority: %', v_result;
  end if;

  -- Case A continued: owner login detects recovery but does not mutate devices.
  v_result := public.admin_login_on_device(
    v_license_key,
    'owner_' || substr(v_suffix, 1, 10),
    v_password,
    'takeover-b-' || v_suffix,
    'Recovery B',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED'
     or coalesce((v_result #>> '{details,takeover_available}')::boolean, false) is not true
     or not exists (select 1 from public.license_devices where id = v_device_a and is_active)
     or exists (select 1 from public.license_devices where id = v_device_b and is_active) then
    raise exception 'Case A: explicit confirmation boundary failed: %', v_result;
  end if;

  -- Case H: stale Staff session proves takeover revokes displaced actor sessions.
  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, metadata
  ) values (
    v_staff,
    v_license,
    'staff_' || substr(v_suffix, 1, 10),
    'Staff Fixture',
    extensions.crypt('StaffPass123', extensions.gen_salt('bf', 12)),
    'staff',
    '{}'::jsonb
  );

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, metadata
  ) values (
    v_license,
    v_staff,
    v_device_a,
    extensions.crypt('stale-staff-token', extensions.gen_salt('bf', 12)),
    '{"fixture":true}'::jsonb
  );

  -- Case J: snapshot an open cash session immediately before takeover.
  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key, status,
    cash_station_id, opened_by_actor_key, opening_amount, cash_sales_total,
    expected_cash_total, responsible_name, opened_by_device_id, metadata
  ) values (
    v_cash_id,
    v_license,
    v_device_a,
    v_owner,
    'admin',
    'actor',
    'admin:' || v_owner::text,
    'open',
    'station-takeover-r1',
    'admin:' || v_owner::text,
    100,
    75,
    175,
    'Owner Fixture',
    v_device_a,
    '{"fixture":"takeover-r1"}'::jsonb
  );

  select to_jsonb(c) into v_cash_before
  from public.pos_cash_sessions c
  where c.id = v_cash_id;

  v_result := public.admin_takeover_free_device(
    v_license_key,
    'owner_' || substr(v_suffix, 1, 10),
    v_password,
    'takeover-b-' || v_suffix,
    'Recovery B',
    '{"fixture":"takeover-r1"}'::jsonb
  );

  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or coalesce((v_result->>'idempotent_retry')::boolean, true) is not false then
    raise exception 'Case A: takeover failed: %', v_result;
  end if;

  if (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or exists (select 1 from public.license_devices where id = v_device_a and is_active)
     or not exists (select 1 from public.license_devices where id = v_device_b and is_active) then
    raise exception 'Case A/F: takeover did not leave exactly one winning device';
  end if;

  if exists (
       select 1
       from public.license_admin_sessions
       where license_id = v_license
         and device_id <> v_device_b
         and revoked_at is null
     )
     or (select count(*) from public.license_admin_sessions
         where license_id = v_license and device_id = v_device_b and revoked_at is null) <> 1
     or exists (
       select 1
       from public.license_staff_sessions
       where license_id = v_license and revoked_at is null
     ) then
    raise exception 'Case H: displaced Admin/Staff sessions remain active';
  end if;

  -- Case I: displaced token + Admin session cannot continue.
  v_result := public.verify_admin_session(
    v_license_key,
    'takeover-a-' || v_suffix,
    'old-token-a-' || v_suffix,
    v_session_a->>'session_token'
  );
  if coalesce((v_result->>'valid')::boolean, false) is true
     or coalesce((v_result->>'success')::boolean, false) is true then
    raise exception 'Case I: displaced device retained authority: %', v_result;
  end if;

  select count(*) into v_count
  from public.license_events
  where license_key = v_license_key
    and event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'
    and metadata->>'new_device_id' = v_device_b::text
    and metadata->>'previous_device_id' = v_device_a::text
    and metadata->>'downgrade_reason' = 'PLAN_LIMITS_ENFORCED'
    and metadata->>'result' = 'success';
  if v_count <> 1 then
    raise exception 'Case A: durable takeover audit missing or duplicated';
  end if;

  select to_jsonb(c) into v_cash_after
  from public.pos_cash_sessions c
  where c.id = v_cash_id;
  if v_cash_after is distinct from v_cash_before then
    raise exception 'Case J: open cash session changed during takeover';
  end if;

  -- Case G: same winner retry remains one active device / one live Admin session / one audit.
  v_retry := public.admin_takeover_free_device(
    v_license_key,
    'owner_' || substr(v_suffix, 1, 10),
    v_password,
    'takeover-b-' || v_suffix,
    'Recovery B',
    '{"fixture":"takeover-r1-retry"}'::jsonb
  );
  if coalesce((v_retry->>'success')::boolean, false) is not true
     or coalesce((v_retry->>'idempotent_retry')::boolean, false) is not true
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or (select count(*) from public.license_admin_sessions where license_id = v_license and revoked_at is null) <> 1
     or (select count(*) from public.license_events
         where license_key = v_license_key and event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER') <> 1 then
    raise exception 'Case G: winner retry was not idempotent: %', v_retry;
  end if;

  -- Case F: serialized concurrent contender cannot consume an already-used downgrade event.
  v_result := public.admin_takeover_free_device(
    v_license_key,
    'owner_' || substr(v_suffix, 1, 10),
    v_password,
    'takeover-c-' || v_suffix,
    'Contender C',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED'
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_b and is_active) then
    raise exception 'Case F: serialized contender displaced the winner: %', v_result;
  end if;

  -- Case D: full PRO stays DEVICE_LIMIT_REACHED, never Free takeover.
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values (
    v_pro_license, v_pro_key, v_pro_plan, 'subscription', 'active',
    now() + interval '30 days', false, 1, 5, '{}'::jsonb, 'Pro capacity fixture'
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_pro_owner,
    v_pro_license,
    'proowner_' || substr(v_suffix, 1, 8),
    'Pro Owner',
    extensions.crypt(v_password, extensions.gen_salt('bf', 12)),
    true,
    true
  );

  for v_count in 1..5 loop
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, is_active,
      security_token, device_role, device_mode
    ) values (
      v_pro_license,
      'pro-' || v_count || '-' || v_suffix,
      'Pro Device ' || v_count,
      true,
      'pro-token-' || v_count || '-' || v_suffix,
      'admin',
      'admin_only'
    );
  end loop;

  v_result := public.admin_login_on_device(
    v_pro_key,
    'proowner_' || substr(v_suffix, 1, 8),
    v_password,
    'pro-sixth-' || v_suffix,
    'Sixth Pro',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'DEVICE_LIMIT_REACHED' then
    raise exception 'Case D: PRO limit was bypassed/offered Free recovery: %', v_result;
  end if;

  -- Case E: ordinary Free with no downgrade evidence cannot expel the active device.
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values (
    v_free_license, v_free_key, v_free_plan, 'free', 'active',
    null, true, null, 1, '{}'::jsonb, 'Free no evidence'
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_free_owner,
    v_free_license,
    'freeowner_' || substr(v_suffix, 1, 8),
    'Free Owner',
    extensions.crypt(v_password, extensions.gen_salt('bf', 12)),
    true,
    true
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active,
    security_token, device_role, device_mode
  ) values (
    v_free_device,
    v_free_license,
    'free-a-' || v_suffix,
    'Free Device',
    true,
    'free-token-' || v_suffix,
    'admin',
    'admin_only'
  );

  v_result := public.admin_login_on_device(
    v_free_key,
    'freeowner_' || substr(v_suffix, 1, 8),
    v_password,
    'free-b-' || v_suffix,
    'Free Other',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'DEVICE_LIMIT_REACHED' then
    raise exception 'Case E: ordinary Free received recovery offer: %', v_result;
  end if;

  v_result := public.admin_takeover_free_device(
    v_free_key,
    'freeowner_' || substr(v_suffix, 1, 8),
    v_password,
    'free-b-' || v_suffix,
    'Free Other',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED'
     or not exists (select 1 from public.license_devices where id = v_free_device and is_active) then
    raise exception 'Case E: ordinary Free takeover was allowed: %', v_result;
  end if;
end;
$test$;

do $acl$
begin
  if has_function_privilege('public', 'private.resolve_free_device_takeover_evidence_v1(text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.resolve_free_device_takeover_evidence_v1(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.resolve_free_device_takeover_evidence_v1(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.resolve_free_device_takeover_evidence_v1(text)', 'EXECUTE') then
    raise exception 'Private takeover evidence helper ACL mismatch';
  end if;

  if has_function_privilege('public', 'public.admin_takeover_free_device(text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.admin_takeover_free_device(text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_takeover_free_device(text,text,text,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_takeover_free_device(text,text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'Public takeover RPC ACL mismatch';
  end if;
end;
$acl$;

rollback;
