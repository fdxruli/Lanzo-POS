-- STAFF.INACTIVE.LOGIN.CONTRACT.R1 — synthetic fixtures only; all writes roll back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_admin_id uuid := extensions.gen_random_uuid();
  v_active_staff_id uuid := extensions.gen_random_uuid();
  v_inactive_staff_id uuid := extensions.gen_random_uuid();
  v_shared_device_id uuid := extensions.gen_random_uuid();
  v_staff_only_device_id uuid := extensions.gen_random_uuid();
  v_admin_only_device_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'TEST-STAFF-INACTIVE-' || v_suffix;
  v_admin_password text := 'AdminTest-' || v_suffix || '9';
  v_staff_password text := 'StaffTest-' || v_suffix || '9';
  v_result jsonb;
  v_session_count integer;
  v_device_count integer;
  v_attempt integer;
  v_rate_username text := 'rate_' || v_suffix;
begin
  insert into public.licenses (
    id, license_key, license_type, status, expires_at, max_devices, product_name, features
  ) values (
    v_license_id, v_license_key, 'pro', 'active', now() + interval '1 day', 8,
    'Inactive staff login contract fixture', '{"staff_roles":true}'::jsonb
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_admin_id, v_license_id, 'admin_' || v_suffix, 'Fixture Admin',
    extensions.crypt(v_admin_password, extensions.gen_salt('bf', 4)), true, true
  );

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values
    (
      v_active_staff_id, v_license_id, 'active_' || v_suffix, 'Active Fixture Staff',
      extensions.crypt(v_staff_password, extensions.gen_salt('bf', 4)), 'staff',
      '{"pos_access":true}'::jsonb, true
    ),
    (
      v_inactive_staff_id, v_license_id, 'inactive_' || v_suffix, 'Inactive Fixture Staff',
      extensions.crypt(v_staff_password, extensions.gen_salt('bf', 4)), 'staff',
      '{"pos_access":true}'::jsonb, false
    );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, security_token,
    is_active, device_role, device_mode, staff_user_id
  ) values
    (
      v_shared_device_id, v_license_id, 'shared-' || v_suffix, 'Shared fixture',
      'shared-token-' || v_suffix, true, 'admin', 'shared', null
    ),
    (
      v_staff_only_device_id, v_license_id, 'staff-only-' || v_suffix, 'Staff-only fixture',
      'staff-token-' || v_suffix, true, 'staff', 'staff_only', null
    ),
    (
      v_admin_only_device_id, v_license_id, 'admin-only-' || v_suffix, 'Admin-only fixture',
      'admin-token-' || v_suffix, true, 'admin', 'admin_only', null
    );

  -- Admin on shared: correct credentials create a legitimate session.
  v_result := public.admin_login_on_device(
    v_license_key, 'admin_' || v_suffix, v_admin_password,
    'shared-' || v_suffix, 'Shared fixture', '{}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or nullif(v_result->>'admin_session_token', '') is null then
    raise exception 'ADMIN_SHARED_LOGIN_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Admin on staff_only: the same valid account is rejected by device policy.
  v_result := public.admin_login_on_device(
    v_license_key, 'admin_' || v_suffix, v_admin_password,
    'staff-only-' || v_suffix, 'Staff-only fixture', '{}'::jsonb
  );
  if v_result->>'code' is distinct from 'DEVICE_MODE_ADMIN_NOT_ALLOWED'
     or exists (
       select 1 from public.license_admin_sessions
       where device_id = v_staff_only_device_id and revoked_at is null
     ) then
    raise exception 'ADMIN_STAFF_ONLY_POLICY_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Staff active: correct credentials create a session.
  v_result := public.staff_login_on_device(
    v_license_key, 'active-staff-' || v_suffix, 'Active fixture',
    '{}'::jsonb, 'active_' || v_suffix, v_staff_password
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or nullif(v_result->>'staff_session_token', '') is null then
    raise exception 'STAFF_ACTIVE_LOGIN_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Staff on admin_only remains blocked by device policy.
  v_result := public.staff_login_on_device(
    v_license_key, 'admin-only-' || v_suffix, 'Admin-only fixture',
    '{}'::jsonb, 'active_' || v_suffix, v_staff_password
  );
  if v_result->>'code' is distinct from 'DEVICE_MODE_STAFF_NOT_ALLOWED'
     or exists (
       select 1 from public.license_staff_sessions
       where device_id = v_admin_only_device_id and revoked_at is null
     ) then
    raise exception 'STAFF_ADMIN_ONLY_POLICY_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Inactive with correct password: clear code, no session, no device activation.
  select count(*) into v_device_count
  from public.license_devices where license_id = v_license_id;
  v_result := public.staff_login_on_device(
    v_license_key, 'inactive-correct-' || v_suffix, 'Inactive fixture',
    '{}'::jsonb, 'inactive_' || v_suffix, v_staff_password
  );
  select count(*) into v_session_count
  from public.license_staff_sessions where staff_user_id = v_inactive_staff_id;
  if v_result->>'code' is distinct from 'STAFF_ACCOUNT_INACTIVE'
     or nullif(v_result->>'staff_session_token', '') is not null
     or v_session_count <> 0
     or (select is_active from public.license_staff_users where id = v_inactive_staff_id) is not false
     or (select count(*) from public.license_devices where license_id = v_license_id) <> v_device_count then
    raise exception 'STAFF_INACTIVE_CORRECT_PASSWORD_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Inactive with wrong password and nonexistent user stay indistinguishable.
  v_result := public.staff_login_on_device(
    v_license_key, 'inactive-wrong-' || v_suffix, 'Inactive fixture',
    '{}'::jsonb, 'inactive_' || v_suffix, 'wrong-' || v_suffix
  );
  if v_result->>'code' is distinct from 'INVALID_STAFF_CREDENTIALS'
     or v_result->>'message' is distinct from 'Usuario o contraseña incorrectos.' then
    raise exception 'STAFF_INACTIVE_WRONG_PASSWORD_DISCLOSURE:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.staff_login_on_device(
    v_license_key, 'missing-user-' || v_suffix, 'Missing fixture',
    '{}'::jsonb, 'missing_' || v_suffix, v_staff_password
  );
  if v_result->>'code' is distinct from 'INVALID_STAFF_CREDENTIALS'
     or v_result->>'message' is distinct from 'Usuario o contraseña incorrectos.' then
    raise exception 'STAFF_MISSING_USER_DISCLOSURE:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Rate limit remains on the public login wrapper.
  for v_attempt in 1..11 loop
    v_result := public.staff_login_on_device(
      v_license_key, 'rate-limit-' || v_suffix, 'Rate fixture',
      '{}'::jsonb, v_rate_username, 'wrong-' || v_suffix
    );
    if v_attempt <= 10
       and v_result->>'code' is distinct from 'INVALID_STAFF_CREDENTIALS' then
      raise exception 'STAFF_RATE_LIMIT_EARLY:%:%', v_attempt, coalesce(v_result->>'code', 'NO_CODE');
    end if;
  end loop;
  if v_result->>'code' is distinct from 'STAFF_LOGIN_RATE_LIMITED' then
    raise exception 'STAFF_RATE_LIMIT_NOT_ENFORCED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  if (select count(*) from public.license_staff_sessions where staff_user_id = v_inactive_staff_id) <> 0 then
    raise exception 'STAFF_INACTIVE_SESSION_CREATED';
  end if;
end;
$test$;

rollback;
