-- LICENSE.DOWNGRADE.SESSION.CONSISTENCY.R1
-- Production-safe transactional regression matrix. All fixtures roll back.
begin;

do $test$
declare
  v_pro_plan uuid;
  v_license uuid := extensions.gen_random_uuid();
  v_license_key text := 'DOWNGRADE-SESSION-R1-' || extensions.gen_random_uuid()::text;
  v_other_license uuid := extensions.gen_random_uuid();
  v_other_key text := 'DOWNGRADE-SESSION-R1-OTHER-' || extensions.gen_random_uuid()::text;
  v_capacity_license uuid := extensions.gen_random_uuid();
  v_capacity_key text := 'DOWNGRADE-SESSION-R1-CAP-' || extensions.gen_random_uuid()::text;
  v_owner uuid := extensions.gen_random_uuid();
  v_other_owner uuid := extensions.gen_random_uuid();
  v_capacity_owner uuid := extensions.gen_random_uuid();
  v_staff uuid := extensions.gen_random_uuid();
  v_survivor uuid := extensions.gen_random_uuid();
  v_removed_admin uuid := extensions.gen_random_uuid();
  v_shared uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_other_device uuid := extensions.gen_random_uuid();
  v_password text := 'OwnerPass123';
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_survivor_session jsonb;
  v_removed_session jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_other_device_before jsonb;
  v_other_device_after jsonb;
  v_other_session_before jsonb;
  v_other_session_after jsonb;
  v_cash_before jsonb;
  v_cash_after jsonb;
  v_event_count integer;
  v_count integer;
  v_cash_survivor text := 'cash_down_survivor_' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_cash_removed text := 'cash_down_removed_' || replace(extensions.gen_random_uuid()::text, '-', '');
begin
  select id into v_pro_plan
  from public.plans
  where code = 'pro_monthly' and is_active
  limit 1;

  if v_pro_plan is null then
    raise exception 'DOWNGRADE_SESSION_R1_PRO_PLAN_MISSING';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values
    (v_license, v_license_key, v_pro_plan, 'subscription', 'active',
     now() + interval '1 day', false, 1, 5, '{}'::jsonb, 'Downgrade session R1'),
    (v_other_license, v_other_key, v_pro_plan, 'subscription', 'active',
     now() + interval '30 days', false, 1, 5, '{}'::jsonb, 'Tenant isolation R1'),
    (v_capacity_license, v_capacity_key, v_pro_plan, 'subscription', 'active',
     now() + interval '30 days', false, 1, 5, '{}'::jsonb, 'Capacity R1');

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license, v_pro_plan, 'pro_monthly', 'Lanzo Nube',
    'pro_paid', 'active', now() - interval '40 days', now() - interval '8 days', 15,
    '{"fixture":"downgrade-session-r1"}'::jsonb
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values
    (v_survivor, v_license, 'down-survivor-' || v_suffix, 'Survivor Admin', '{}'::jsonb, true,
     now() - interval '30 days', now() - interval '3 days',
     'survivor-current-' || v_suffix, 'survivor-previous-' || v_suffix, 'admin', 'admin_only'),
    (v_removed_admin, v_license, 'down-removed-' || v_suffix, 'Removed Admin', '{}'::jsonb, true,
     now() - interval '10 days', now(),
     'removed-current-' || v_suffix, 'removed-previous-' || v_suffix, 'admin', 'admin_only'),
    (v_shared, v_license, 'down-shared-' || v_suffix, 'Shared Device', '{}'::jsonb, true,
     now() - interval '20 days', now() - interval '1 day',
     'shared-current-' || v_suffix, 'shared-previous-' || v_suffix, 'admin', 'shared'),
    (v_staff_device, v_license, 'down-staff-' || v_suffix, 'Staff Device', '{}'::jsonb, true,
     now() - interval '5 days', now(),
     'staff-current-' || v_suffix, 'staff-previous-' || v_suffix, 'staff', 'staff_only'),
    (v_other_device, v_other_license, 'down-other-' || v_suffix, 'Other Tenant', '{}'::jsonb, true,
     now() - interval '5 days', now(),
     'other-current-' || v_suffix, 'other-previous-' || v_suffix, 'admin', 'admin_only');

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (v_owner, v_license, 'owner_' || substr(v_suffix,1,10), 'Owner R1',
     extensions.crypt(v_password, extensions.gen_salt('bf', 12)), true, true),
    (v_other_owner, v_other_license, 'other_' || substr(v_suffix,1,10), 'Other Owner R1',
     extensions.crypt(v_password, extensions.gen_salt('bf', 12)), true, true),
    (v_capacity_owner, v_capacity_license, 'cap_' || substr(v_suffix,1,10), 'Capacity Owner R1',
     extensions.crypt(v_password, extensions.gen_salt('bf', 12)), true, true);

  v_survivor_session := private.create_admin_session(v_license, v_owner, v_survivor, 'Survivor Admin');
  v_removed_session := private.create_admin_session(v_license, v_owner, v_removed_admin, 'Removed Admin');
  perform private.create_admin_session(v_license, v_owner, v_shared, 'Shared Device');
  perform private.create_admin_session(v_other_license, v_other_owner, v_other_device, 'Other Tenant');

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, metadata
  ) values (
    v_staff, v_license, 'staff_' || substr(v_suffix,1,10), 'Staff R1',
    extensions.crypt('StaffPass123', extensions.gen_salt('bf', 12)), 'staff', '{}'::jsonb
  );

  update public.license_devices
     set staff_user_id = v_staff
   where id = v_staff_device;

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, metadata
  ) values (
    v_license, v_staff, v_staff_device,
    extensions.crypt('staff-session-' || v_suffix, extensions.gen_salt('bf', 12)),
    '{"fixture":true}'::jsonb
  );

  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key, status,
    opened_by_actor_key, opening_amount, cash_sales_total, expected_cash_total,
    responsible_name, opened_by_device_id, metadata
  ) values
    (v_cash_survivor, v_license, v_survivor, v_owner, 'admin', 'actor',
     'admin:' || v_owner::text, 'open', 'admin:' || v_owner::text,
     100, 25, 125, 'Owner R1', v_survivor, '{"fixture":"downgrade-session-r1"}'::jsonb),
    (v_cash_removed, v_license, v_removed_admin, v_owner, 'admin', 'actor',
     'admin:' || v_owner::text, 'open', 'admin:' || v_owner::text,
     200, 50, 250, 'Owner R1', v_removed_admin, '{"fixture":"downgrade-session-r1"}'::jsonb);

  select jsonb_agg(to_jsonb(c) order by c.id)
    into v_cash_before
    from public.pos_cash_sessions c
   where c.id in (v_cash_survivor, v_cash_removed);

  select to_jsonb(d) into v_other_device_before
  from public.license_devices d where d.id = v_other_device;

  select to_jsonb(s) into v_other_session_before
  from public.license_admin_sessions s
  where s.license_id = v_other_license and s.device_id = v_other_device and s.revoked_at is null
  order by s.created_at desc limit 1;

  update public.licenses
     set expires_at = now() - interval '8 days'
   where id = v_license;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
     or coalesce((v_result->>'changed')::boolean, false) is not true then
    raise exception 'Case A: downgrade failed: %', v_result;
  end if;

  if (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id=v_survivor and is_active)
     or not exists (
       select 1 from public.license_devices
       where id=v_removed_admin and not is_active
         and device_info #>> '{license_block,reason}'='PLAN_DOWNGRADE_DEVICE_LIMIT'
     )
     or not exists (
       select 1 from public.license_devices
       where id=v_shared and not is_active
         and device_info #>> '{license_block,reason}'='PLAN_DOWNGRADE_DEVICE_LIMIT'
     )
     or not exists (
       select 1 from public.license_devices
       where id=v_staff_device and not is_active
         and device_info #>> '{license_block,reason}'='PLAN_DOWNGRADE_STAFF_NOT_INCLUDED'
     ) then
    raise exception 'Case A/B/C: deterministic device survivor/ranking failed';
  end if;

  if exists (
       select 1
       from public.license_admin_sessions s
       where s.license_id=v_license
         and s.device_id in (v_removed_admin,v_shared,v_staff_device)
         and s.revoked_at is null
     )
     or not exists (
       select 1
       from public.license_admin_sessions s
       where s.license_id=v_license and s.device_id=v_survivor and s.revoked_at is null
     ) then
    raise exception 'Case A/D: Admin session reconciliation failed';
  end if;

  if exists (
       select 1 from public.license_staff_sessions
       where license_id=v_license and revoked_at is null
     ) then
    raise exception 'Case C: Staff session survived Free downgrade';
  end if;

  if exists (
       select 1 from public.license_devices
       where id in (v_removed_admin,v_shared,v_staff_device)
         and (security_token is not null or previous_security_token is not null)
     ) then
    raise exception 'Case E: removed device credentials survived downgrade';
  end if;

  v_result := public.verify_admin_session(
    v_license_key,
    'down-removed-' || v_suffix,
    'removed-current-' || v_suffix,
    v_removed_session->>'session_token'
  );
  if coalesce((v_result->>'valid')::boolean, false) is true
     or coalesce((v_result->>'success')::boolean, false) is true then
    raise exception 'Case E: removed token/session still validates: %', v_result;
  end if;

  select count(*) into v_event_count
  from public.license_events
  where license_key=v_license_key
    and event_type='LICENSE_UPDATE'
    and metadata->>'source'='enforce_license_plan_limits_after_change'
    and metadata->>'reason'='PLAN_LIMITS_ENFORCED'
    and metadata->>'plan'='free_trial'
    and metadata->>'max_devices'='1'
    and coalesce((metadata->>'admin_sessions_revoked')::integer,0) >= 2
    and coalesce((metadata->>'staff_sessions_revoked')::integer,0) >= 1
    and coalesce((metadata->>'over_limit_devices_blocked')::integer,0) = 2
    and metadata->'active_device_ids_after' @> jsonb_build_array(v_survivor);
  if v_event_count <> 1 then
    raise exception 'Case audit: PLAN_LIMITS_ENFORCED session/device evidence missing';
  end if;

  select jsonb_agg(to_jsonb(c) order by c.id)
    into v_cash_after
    from public.pos_cash_sessions c
   where c.id in (v_cash_survivor, v_cash_removed);
  if v_cash_after is distinct from v_cash_before then
    raise exception 'Case finance: downgrade modified open cash sessions';
  end if;

  v_retry := private.materialize_expired_license_to_free_v1(v_license);
  if v_retry->>'code' <> 'ALREADY_FREE'
     or coalesce((v_retry->>'changed')::boolean, true) is not false
     or (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1
     or (select count(*) from public.license_events
         where license_key=v_license_key
           and event_type='LICENSE_UPDATE'
           and metadata->>'source'='enforce_license_plan_limits_after_change') <> 1 then
    raise exception 'Case F/G: retry was not idempotent: %', v_retry;
  end if;

  select to_jsonb(d) into v_other_device_after
  from public.license_devices d where d.id = v_other_device;
  select to_jsonb(s) into v_other_session_after
  from public.license_admin_sessions s
  where s.license_id = v_other_license and s.device_id = v_other_device and s.revoked_at is null
  order by s.created_at desc limit 1;
  if v_other_device_after is distinct from v_other_device_before
     or v_other_session_after is distinct from v_other_session_before then
    raise exception 'Case tenant isolation: unrelated tenant changed';
  end if;

  -- Phase 1 compatibility: owner on a removed Admin device gets explicit takeover,
  -- then that device becomes the sole survivor and old actor sessions are revoked.
  v_result := public.admin_login_on_device(
    v_license_key,
    'owner_' || substr(v_suffix,1,10),
    v_password,
    'down-removed-' || v_suffix,
    'Removed Admin',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED' then
    raise exception 'Case Phase 1 regression: takeover was not offered: %', v_result;
  end if;

  v_result := public.admin_takeover_free_device(
    v_license_key,
    'owner_' || substr(v_suffix,1,10),
    v_password,
    'down-removed-' || v_suffix,
    'Removed Admin',
    '{"fixture":"phase2-regression"}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean,false) is not true
     or v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id=v_removed_admin and is_active)
     or exists (select 1 from public.license_devices where id<>v_removed_admin and license_id=v_license and is_active)
     or (select count(*) from public.license_admin_sessions where license_id=v_license and revoked_at is null) <> 1
     or not exists (
       select 1 from public.license_admin_sessions
       where license_id=v_license and device_id=v_removed_admin and revoked_at is null
     ) then
    raise exception 'Case Phase 1 regression: takeover final state invalid: %', v_result;
  end if;

  select jsonb_agg(to_jsonb(c) order by c.id)
    into v_cash_after
    from public.pos_cash_sessions c
   where c.id in (v_cash_survivor, v_cash_removed);
  if v_cash_after is distinct from v_cash_before then
    raise exception 'Case finance: takeover modified open cash sessions';
  end if;

  -- Full PRO 5/5 must still reject a sixth device; never route to Free takeover.
  for v_count in 1..5 loop
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, is_active,
      security_token, device_role, device_mode
    ) values (
      v_capacity_license,
      'cap-' || v_count || '-' || v_suffix,
      'Capacity ' || v_count,
      true,
      'cap-token-' || v_count || '-' || v_suffix,
      'admin',
      'admin_only'
    );
  end loop;

  v_result := public.admin_login_on_device(
    v_capacity_key,
    'cap_' || substr(v_suffix,1,10),
    v_password,
    'cap-sixth-' || v_suffix,
    'Sixth Capacity',
    '{}'::jsonb
  );
  if v_result->>'code' <> 'DEVICE_LIMIT_REACHED' then
    raise exception 'Case Phase 1 capacity regression: PRO 5/5 returned %', v_result;
  end if;

  select to_jsonb(d) into v_other_device_after
  from public.license_devices d where d.id = v_other_device;
  select to_jsonb(s) into v_other_session_after
  from public.license_admin_sessions s
  where s.license_id = v_other_license and s.device_id = v_other_device and s.revoked_at is null
  order by s.created_at desc limit 1;
  if v_other_device_after is distinct from v_other_device_before
     or v_other_session_after is distinct from v_other_session_before then
    raise exception 'Case tenant isolation after takeover: unrelated tenant changed';
  end if;
end;
$test$;

do $acl$
begin
  if has_function_privilege('public', 'public.enforce_license_plan_limits_after_change()', 'EXECUTE')
     or has_function_privilege('anon', 'public.enforce_license_plan_limits_after_change()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_license_plan_limits_after_change()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.enforce_license_plan_limits_after_change()', 'EXECUTE') then
    raise exception 'Phase 2 trigger function ACL mismatch';
  end if;
end;
$acl$;

rollback;
