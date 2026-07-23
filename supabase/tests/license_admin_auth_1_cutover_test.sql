-- CUTOVER regression matrix. Run after the cutover inside one transaction.
-- The transaction wrappers are intentionally omitted from the temporary
-- cutover simulation so the migration and this matrix share one rollback.
do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_admin_license uuid := extensions.gen_random_uuid();
  v_enroll_license uuid := extensions.gen_random_uuid();
  v_staff_license uuid := extensions.gen_random_uuid();
  v_blocked_license uuid := extensions.gen_random_uuid();
  v_free_license uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_enroll_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_other_staff_device uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_other_staff_user uuid := extensions.gen_random_uuid();
  v_admin_key text := 'TEST-ADMIN-AUTH-CUTOVER-' || v_suffix;
  v_enroll_key text := 'TEST-ADMIN-AUTH-ENROLL-' || v_suffix;
  v_staff_key text := 'TEST-ADMIN-AUTH-STAFF-' || v_suffix;
  v_blocked_key text := 'TEST-ADMIN-AUTH-BLOCKED-' || v_suffix;
  v_free_key text := 'TEST-ADMIN-AUTH-FREE-' || v_suffix;
  v_admin_fingerprint text := 'cutover-admin-' || v_suffix;
  v_admin_device_token text := 'cutover-device-' || v_suffix;
  v_admin_password text := 'Pw' || substr(md5(v_suffix), 1, 18) || '9';
  v_admin_session text;
  v_new_admin_session text;
  v_staff_session text := 'staff-session-' || v_suffix;
  v_other_staff_session text := 'other-staff-session-' || v_suffix;
  v_result jsonb;
  v_definition text;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, max_devices, product_name, features)
  values
    (v_admin_license, v_admin_key, 'pro', 'active', now() + interval '1 day', 3, 'Cutover admin', '{"staff_roles":true,"ecommerce_portal_enabled":true}'::jsonb),
    (v_enroll_license, v_enroll_key, 'pro', 'active', now() + interval '1 day', 2, 'Cutover enroll', '{"staff_roles":false}'::jsonb),
    (v_staff_license, v_staff_key, 'pro', 'active', now() + interval '1 day', 3, 'Cutover staff', '{"staff_roles":true,"ecommerce_portal_enabled":true}'::jsonb),
    (v_blocked_license, v_blocked_key, 'pro', 'suspended', now() + interval '1 day', 1, 'Cutover blocked', '{}'::jsonb),
    (v_free_license, v_free_key, 'free', 'active', now() + interval '1 day', 1, 'Cutover free', '{}'::jsonb);
  update public.licenses
     set plan_id = (select id from public.plans where lower(code) = 'free_trial' limit 1)
   where id = v_free_license;
  update public.licenses
     set plan_id = (select id from public.plans where lower(code) = 'pro_monthly' limit 1)
   where id in (v_admin_license, v_staff_license, v_blocked_license);
  update public.licenses
     set plan_id = (select id from public.plans where lower(code) = 'basic_monthly' limit 1)
   where id = v_enroll_license;

  insert into public.license_devices(id, license_id, device_fingerprint, device_name, security_token, is_active, device_role)
  values
    (v_admin_device, v_admin_license, v_admin_fingerprint, 'Cutover admin', v_admin_device_token, true, 'admin'),
    (v_enroll_device, v_enroll_license, 'cutover-enroll-' || v_suffix, 'Trusted legacy admin', 'enroll-device-' || v_suffix, true, 'admin'),
    (v_staff_device, v_staff_license, 'cutover-staff-' || v_suffix, 'Staff device', 'staff-device-' || v_suffix, true, 'staff'),
    (v_other_staff_device, v_staff_license, 'cutover-other-staff-' || v_suffix, 'Other staff device', 'other-staff-device-' || v_suffix, true, 'staff');

  -- Pro/no owner only admits enrollment from the trusted legacy admin.
  v_result := public.activate_license_on_device_unlimited(v_enroll_key, 'cutover-enroll-' || v_suffix, 'Trusted legacy admin', '{}'::jsonb);
  if v_result->>'code' <> 'ADMIN_ENROLLMENT_REQUIRED' or coalesce((v_result#>>'{details,staff_access_available}')::boolean, true) then
    raise exception 'CUTOVER_ENROLLMENT_REQUIRED_FAILED: %', v_result;
  end if;
  v_result := public.activate_license_on_device_unlimited(v_enroll_key, 'unknown-' || v_suffix, 'Unknown', '{}'::jsonb);
  if v_result->>'code' <> 'ADMIN_ENROLLMENT_NOT_ALLOWED' then raise exception 'CUTOVER_UNKNOWN_CLAIM_FAILED: %', v_result; end if;
  v_result := public.activate_license_on_device_unlimited(v_enroll_key, 'cutover-staff-' || v_suffix, 'Staff', '{}'::jsonb);
  if v_result->>'code' = 'ADMIN_ENROLLMENT_REQUIRED' then raise exception 'CUTOVER_STAFF_PROMOTED'; end if;
  v_result := public.activate_license_on_device_unlimited(v_blocked_key, 'blocked-' || v_suffix, 'Blocked', '{}'::jsonb);
  if v_result->>'code' <> 'LICENSE_NOT_ACTIVE' then raise exception 'CUTOVER_BLOCKED_LICENSE_FAILED: %', v_result; end if;
  v_result := public.activate_license_on_device_unlimited(v_free_key, 'free-' || v_suffix, 'Free device', '{}'::jsonb);
  if v_result->>'code' in ('ADMIN_ENROLLMENT_REQUIRED', 'ADMIN_OR_STAFF_LOGIN_REQUIRED', 'ADMIN_ENROLLMENT_NOT_ALLOWED') then
    raise exception 'CUTOVER_FREE_DELEGATION_FAILED: %', v_result;
  end if;

  -- Owner enrollment enables the selector and exposes only supported staff access.
  v_result := public.admin_enroll_owner_on_device(v_admin_key, v_admin_fingerprint, v_admin_device_token, 'owner_' || substr(v_suffix, 1, 6), v_admin_password, 'Cutover owner');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'CUTOVER_OWNER_ENROLL_FAILED: %', v_result; end if;
  v_admin_session := v_result->>'admin_session_token';
  v_result := public.activate_license_on_device_unlimited(v_admin_key, 'new-admin-' || v_suffix, 'New admin', '{}'::jsonb);
  if v_result->>'code' <> 'ADMIN_OR_STAFF_LOGIN_REQUIRED'
     or coalesce((v_result#>>'{details,staff_access_available}')::boolean, false) is not true
     or nullif(v_result#>>'{details,plan_code}', '') is null then
    raise exception 'CUTOVER_ACCESS_CHOICE_FAILED: %', v_result;
  end if;
  v_result := public.activate_license_on_device(v_admin_key, 'wrapper-' || v_suffix, 'Wrapper', '{}'::jsonb);
  if v_result->>'code' <> 'ADMIN_OR_STAFF_LOGIN_REQUIRED' then raise exception 'CUTOVER_PUBLIC_WRAPPER_FAILED: %', v_result; end if;

  -- Four-argument ecommerce calls transport the admin actor session.
  v_result := private.ecommerce_admin_authorize_v2(v_admin_key, v_admin_fingerprint, v_admin_device_token, v_admin_session, 'cutover_admin');
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result->>'actor_type' <> 'admin_owner' then raise exception 'CUTOVER_ECOM_ADMIN_FAILED: %', v_result; end if;
  v_result := private.ecommerce_admin_authorize_v2(v_admin_key, v_admin_fingerprint, v_admin_device_token, null, 'cutover_admin');
  if v_result->>'code' <> 'ECOMMERCE_ADMIN_SESSION_REQUIRED' then raise exception 'CUTOVER_ECOM_ADMIN_MISSING_SESSION'; end if;
  v_result := private.ecommerce_admin_authorize_v2(v_admin_key, v_admin_fingerprint, v_admin_device_token, v_staff_session, 'cutover_admin');
  if v_result->>'code' <> 'ECOMMERCE_ADMIN_SESSION_REQUIRED' then raise exception 'CUTOVER_ECOM_CROSS_TOKEN_ACCEPTED'; end if;
  v_result := public.ecommerce_admin_get_portal(v_admin_key, v_admin_fingerprint, v_admin_device_token, v_admin_session);
  if v_result->>'code' = 'ECOMMERCE_ADMIN_SESSION_REQUIRED' then raise exception 'CUTOVER_ECOM_PUBLIC_ACTOR_NOT_FORWARDED: %', v_result; end if;
  v_result := public.ecommerce_admin_get_portal(v_admin_key, v_admin_fingerprint, v_admin_device_token);
  if v_result->>'code' <> 'ECOMMERCE_ADMIN_SESSION_REQUIRED' then raise exception 'CUTOVER_ECOM_LEGACY_OPEN: %', v_result; end if;

  update public.license_admin_sessions set revoked_at = now() where license_id = v_admin_license and revoked_at is null;
  v_result := private.ecommerce_admin_authorize_v2(v_admin_key, v_admin_fingerprint, v_admin_device_token, v_admin_session, 'cutover_admin');
  if v_result->>'code' <> 'ECOMMERCE_ADMIN_SESSION_REQUIRED' then raise exception 'CUTOVER_ECOM_REVOKED_ADMIN_ACCEPTED'; end if;
  v_result := public.admin_login_on_device(v_admin_key, 'owner_' || substr(v_suffix, 1, 6), v_admin_password, v_admin_fingerprint, 'Cutover admin', '{}'::jsonb);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'CUTOVER_ADMIN_RELOGIN_FAILED: %', v_result; end if;
  v_new_admin_session := v_result->>'admin_session_token';
  v_result := public.admin_release_device(v_admin_key, v_admin_fingerprint, v_result->>'device_security_token', v_new_admin_session, v_admin_device);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'CUTOVER_ADMIN_RELEASE_FAILED: %', v_result; end if;
  v_result := private.ecommerce_admin_authorize_v2(v_admin_key, v_admin_fingerprint, v_admin_device_token, v_new_admin_session, 'cutover_admin');
  if coalesce((v_result->>'success')::boolean, true) is true then raise exception 'CUTOVER_ECOM_RELEASED_DEVICE_ACCEPTED'; end if;

  -- Staff authorization remains role- and device-bound, including permissions.
  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values
    (v_staff_user, v_staff_license, 'staff_' || substr(v_suffix, 1, 6), 'Authorized staff', extensions.crypt(v_admin_password, extensions.gen_salt('bf', 12)), '{"settings":true,"ecommerce":true}'::jsonb),
    (v_other_staff_user, v_staff_license, 'other_' || substr(v_suffix, 1, 6), 'Other staff', extensions.crypt(v_admin_password, extensions.gen_salt('bf', 12)), '{"settings":true,"ecommerce":true}'::jsonb);
  update public.license_devices set staff_user_id = v_staff_user where id = v_staff_device;
  update public.license_devices set staff_user_id = v_other_staff_user where id = v_other_staff_device;
  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values
    (v_staff_license, v_staff_user, v_staff_device, extensions.crypt(v_staff_session, extensions.gen_salt('bf', 12)), now() + interval '1 hour'),
    (v_staff_license, v_other_staff_user, v_other_staff_device, extensions.crypt(v_other_staff_session, extensions.gen_salt('bf', 12)), now() + interval '1 hour');
  v_result := private.ecommerce_admin_authorize_v2(v_staff_key, 'cutover-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_session, 'cutover_staff');
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result->>'actor_type' <> 'staff' then raise exception 'CUTOVER_ECOM_STAFF_FAILED: %', v_result; end if;
  v_result := private.ecommerce_admin_authorize_v2(v_staff_key, 'cutover-staff-' || v_suffix, 'staff-device-' || v_suffix, v_other_staff_session, 'cutover_staff');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_SESSION_INVALID' then raise exception 'CUTOVER_ECOM_STAFF_CROSS_DEVICE_ACCEPTED'; end if;
  update public.license_staff_users set permissions = '{"settings":false,"ecommerce":true}'::jsonb where id = v_staff_user;
  v_result := private.ecommerce_admin_authorize_v2(v_staff_key, 'cutover-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_session, 'cutover_staff');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED' then raise exception 'CUTOVER_ECOM_STAFF_SETTINGS_BYPASS'; end if;
  update public.license_staff_users set permissions = '{"settings":true,"ecommerce":false}'::jsonb where id = v_staff_user;
  v_result := private.ecommerce_admin_authorize_v2(v_staff_key, 'cutover-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_session, 'cutover_staff');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED' then raise exception 'CUTOVER_ECOM_STAFF_ECOMMERCE_BYPASS'; end if;
  update public.license_staff_users set permissions = '{"settings":true,"ecommerce":true}'::jsonb where id = v_staff_user;
  update public.license_staff_sessions set revoked_at = now() where license_id = v_staff_license and staff_user_id = v_staff_user;
  v_result := private.ecommerce_admin_authorize_v2(v_staff_key, 'cutover-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_session, 'cutover_staff');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_SESSION_INVALID' then raise exception 'CUTOVER_ECOM_STAFF_REVOKED_ACCEPTED'; end if;

  select pg_get_functiondef('public.activate_license_on_device_unlimited(text,text,text,jsonb)'::regprocedure) into v_definition;
  if position('activate_license_on_device_legacy_free' in v_definition) = 0 then raise exception 'CUTOVER_FREE_DELEGATION_MISSING'; end if;
  if has_function_privilege('anon', 'public.admin_list_staff_users(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.get_license_devices_anon(text,text)', 'execute') then
    raise exception 'CUTOVER_LEGACY_GRANT_REMAINS';
  end if;
end;
$test$;
