-- ADMIN.STAFF.SECTION.ISOLATION.R1 — transactional profile actor authorization.
-- Safe for a validation database: every fixture and rate-limit row is rolled back.
begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_other_device_id uuid := extensions.gen_random_uuid();
  v_cross_device_id uuid := extensions.gen_random_uuid();
  v_admin_id uuid := extensions.gen_random_uuid();
  v_staff_id uuid := extensions.gen_random_uuid();
  v_inactive_staff_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'PROFILE-R1-' || v_suffix;
  v_other_license_key text := 'PROFILE-X-' || v_suffix;
  v_fingerprint text := 'profile-device-' || v_suffix;
  v_other_fingerprint text := 'profile-other-device-' || v_suffix;
  v_device_token text := 'profile-device-token-' || v_suffix;
  v_other_device_token text := 'profile-other-device-token-' || v_suffix;
  v_admin_token text := 'profile-admin-token-' || v_suffix;
  v_staff_token text := 'profile-staff-token-' || v_suffix;
  v_expired_token text := 'profile-expired-token-' || v_suffix;
  v_revoked_token text := 'profile-revoked-token-' || v_suffix;
  v_inactive_token text := 'profile-inactive-token-' || v_suffix;
  v_cross_device_token text := 'profile-cross-device-token-' || v_suffix;
  v_cross_license_token text := 'profile-cross-license-token-' || v_suffix;
  v_result jsonb;
  v_profile_name text;
  v_definition text;
begin
  -- Contract/ACL checks: there is one public Data API name and only the
  -- five-argument actor-aware signature is executable by client roles.
  if to_regprocedure('public.save_business_profile_secure(text,text,text,jsonb)') is not null
     or to_regprocedure('public.save_business_profile_secure_legacy(text,text,text,jsonb)') is null
     or to_regprocedure('public.save_business_profile_secure(text,text,text,text,jsonb)') is null then
    raise exception 'PROFILE_R1_SIGNATURE_CONTRACT_FAILED';
  end if;
  if has_function_privilege('public', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.activate_license_on_device_unlimited(text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_login_on_device(text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_enroll_owner_on_device(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'private.validate_pos_sync_context(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.has_pos_permission(jsonb,text)', 'execute') then
    raise exception 'PROFILE_R1_ACL_CONTRACT_FAILED';
  end if;

  select pg_get_functiondef('public.save_business_profile_secure(text,text,text,text,jsonb)'::regprocedure)
  into v_definition;
  if position('SECURITY DEFINER' in v_definition) = 0
     or position('SET search_path TO ''''' in v_definition) = 0
     or position('private.validate_pos_sync_context' in v_definition) = 0
     or position('private.has_pos_permission' in v_definition) = 0
     or position('save_business_profile_secure_unlimited' in v_definition) = 0
     or position('''PROFILE''' in v_definition) = 0
     or position('30, 600, 600' in regexp_replace(v_definition, E'\\s+', ' ', 'g')) = 0 then
    raise exception 'PROFILE_R1_DEFINITION_CONTRACT_FAILED';
  end if;

  insert into public.licenses (
    id, license_key, license_type, max_devices, status, product_name, features
  ) values
  (
    v_license_id, v_license_key, 'pro', 10, 'active', 'PROFILE R1 TEST',
    jsonb_build_object('staff_roles', true)
  ),
  (
    v_other_license_id, v_other_license_key, 'pro', 10, 'active', 'PROFILE R1 CROSS TEST',
    jsonb_build_object('staff_roles', true)
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode
  ) values
  (
    v_device_id, v_license_id, v_fingerprint, 'Profile device', '{}'::jsonb,
    true, v_device_token, 'admin', 'shared'
  ),
  (
    v_other_device_id, v_other_license_id, v_other_fingerprint, 'Other profile device', '{}'::jsonb,
    true, v_other_device_token, 'admin', 'shared'
  ),
  (
    v_cross_device_id, v_license_id, 'profile-cross-device-' || v_suffix, 'Cross profile device', '{}'::jsonb,
    true, 'profile-cross-device-security-' || v_suffix, 'admin', 'shared'
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_admin_id, v_license_id, 'owner-' || left(v_suffix, 8), 'Owner',
    extensions.crypt('profile-pass-1', extensions.gen_salt('bf', 4)), true, true
  );
  insert into public.license_admin_sessions (
    license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_license_id, v_admin_id, v_device_id,
    extensions.crypt(v_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values
  (
    v_staff_id, v_license_id, 'staff-' || left(v_suffix, 8), 'Staff settings',
    extensions.crypt('profile-pass-2', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('settings', true), true
  ),
  (
    v_inactive_staff_id, v_license_id, 'inactive-' || left(v_suffix, 8), 'Inactive Staff',
    extensions.crypt('profile-pass-3', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('settings', true), false
  );

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at, revoked_at
  ) values
  (
    v_license_id, v_staff_id, v_device_id,
    extensions.crypt(v_staff_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  ),
  (
    v_license_id, v_staff_id, v_device_id,
    extensions.crypt(v_expired_token, extensions.gen_salt('bf', 4)), now() - interval '1 minute', null
  ),
  (
    v_license_id, v_staff_id, v_device_id,
    extensions.crypt(v_revoked_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', now()
  ),
  (
    v_license_id, v_inactive_staff_id, v_device_id,
    extensions.crypt(v_inactive_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  );

  -- Admin is allowed.
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_admin_token,
    jsonb_build_object('name', 'Admin profile', 'business_type', jsonb_build_array('abarrotes'))
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'PROFILE_R1_ADMIN_EXPECTED_ALLOW:%', v_result;
  end if;

  -- Staff with settings=true is allowed.
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_staff_token,
    jsonb_build_object('name', 'Staff profile', 'business_type', jsonb_build_array('hardware'))
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'PROFILE_R1_STAFF_SETTINGS_EXPECTED_ALLOW:%', v_result;
  end if;

  -- Staff with settings=false is denied and cannot mutate the row.
  update public.license_staff_users
  set permissions = jsonb_build_object('settings', false)
  where id = v_staff_id;
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_staff_token,
    jsonb_build_object('name', 'Denied profile', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'SETTINGS_PERMISSION_DENIED' then
    raise exception 'PROFILE_R1_STAFF_SETTINGS_EXPECTED_DENY:%', v_result;
  end if;
  select business_name into v_profile_name
  from public.business_profiles where license_id = v_license_id;
  if v_profile_name is distinct from 'Staff profile' then
    raise exception 'PROFILE_R1_DENIED_WRITE_MUTATED_ROW:%', v_profile_name;
  end if;

  -- Device credentials alone are never sufficient.
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, null,
    jsonb_build_object('name', 'Missing actor', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'ACTOR_SESSION_REQUIRED' then
    raise exception 'PROFILE_R1_MISSING_ACTOR_NOT_REJECTED:%', v_result;
  end if;

  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, 'random-actor-token',
    jsonb_build_object('name', 'Random actor', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'ACTOR_SESSION_INVALID' then
    raise exception 'PROFILE_R1_RANDOM_ACTOR_NOT_REJECTED:%', v_result;
  end if;

  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_expired_token,
    jsonb_build_object('name', 'Expired actor', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'STAFF_SESSION_EXPIRED' then
    raise exception 'PROFILE_R1_EXPIRED_ACTOR_NOT_REJECTED:%', v_result;
  end if;

  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_revoked_token,
    jsonb_build_object('name', 'Revoked actor', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'ACTOR_SESSION_INVALID' then
    raise exception 'PROFILE_R1_REVOKED_ACTOR_NOT_REJECTED:%', v_result;
  end if;

  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_inactive_token,
    jsonb_build_object('name', 'Inactive actor', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'STAFF_USER_INACTIVE' then
    raise exception 'PROFILE_R1_INACTIVE_STAFF_NOT_REJECTED:%', v_result;
  end if;

  -- A valid session cannot cross either its device or license binding.
  insert into public.license_staff_users (
    license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values (
    v_other_license_id, 'cross-' || left(v_suffix, 8), 'Cross Staff',
    extensions.crypt('profile-pass-4', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('settings', true), true
  ) returning id into v_inactive_staff_id;
  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_other_license_id, v_inactive_staff_id, v_other_device_id,
    extensions.crypt(v_cross_license_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_cross_license_token,
    jsonb_build_object('name', 'Cross license', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'ACTOR_SESSION_INVALID' then
    raise exception 'PROFILE_R1_CROSS_LICENSE_NOT_REJECTED:%', v_result;
  end if;

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_license_id, v_staff_id, v_cross_device_id,
    extensions.crypt(v_cross_device_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_cross_device_token,
    jsonb_build_object('name', 'Cross device', 'business_type', jsonb_build_array('abarrotes'))
  );
  if v_result->>'code' is distinct from 'ACTOR_SESSION_INVALID' then
    raise exception 'PROFILE_R1_CROSS_DEVICE_NOT_REJECTED:%', v_result;
  end if;
end;
$test$;

do $free_trial_test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_plan_id uuid;
  v_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'PROFILE-FREE-' || v_suffix;
  v_fingerprint text := 'profile-free-device-' || v_suffix;
  v_device_token text := 'profile-free-device-token-' || v_suffix;
  v_result jsonb;
  v_admin_token text;
begin
  select id into v_plan_id from public.plans where code = 'free_trial' limit 1;
  if v_plan_id is null then
    raise exception 'PROFILE_R1_FREE_PLAN_MISSING';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, max_devices, status, product_name, features
  ) values (
    v_license_id, v_license_key, v_plan_id, 'trial', 1, 'active', 'PROFILE FREE R1 TEST', '{}'::jsonb
  );
  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode
  ) values (
    v_device_id, v_license_id, v_fingerprint, 'Free profile device', '{}'::jsonb,
    true, v_device_token, 'admin', 'admin_only'
  );

  v_result := public.admin_enroll_owner_on_device(
    v_license_key, v_fingerprint, v_device_token,
    'free-owner-' || left(v_suffix, 8), 'FreeOwner123', 'Free Owner'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'PROFILE_R1_FREE_ENROLLMENT_FAILED:%', v_result;
  end if;
  v_admin_token := v_result->>'admin_session_token';

  -- The free-trial device still cannot write by itself; the newly established
  -- Admin session is what unlocks Setup.
  v_result := public.save_business_profile_secure(
    v_license_key, v_fingerprint, v_device_token, v_admin_token,
    jsonb_build_object('name', 'Free Admin profile', 'business_type', jsonb_build_array('abarrotes'))
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'PROFILE_R1_FREE_ADMIN_PROFILE_FAILED:%', v_result;
  end if;

  v_result := public.activate_license_on_device_unlimited(
    v_license_key, v_fingerprint, 'Free profile device', '{}'::jsonb
  )::jsonb;
  if v_result->>'code' is distinct from 'ADMIN_OR_STAFF_LOGIN_REQUIRED'
     or coalesce((v_result->>'access_choice_required')::boolean, false) is not true then
    raise exception 'PROFILE_R1_FREE_RESTART_DID_NOT_REQUIRE_ACTOR:%', v_result;
  end if;

  v_result := public.admin_login_on_device(
    v_license_key, 'free-owner-' || left(v_suffix, 8), 'FreeOwner123',
    v_fingerprint, 'Free profile device', '{}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'admin_session_token' is null then
    raise exception 'PROFILE_R1_FREE_ADMIN_LOGIN_FAILED:%', v_result;
  end if;
end;
$free_trial_test$;

rollback;
