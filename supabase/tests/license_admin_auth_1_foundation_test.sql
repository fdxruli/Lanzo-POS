-- FOUNDATION regression matrix. Every fixture is synthetic and rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_full_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_full_device_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'TEST-ADMIN-AUTH-' || v_suffix;
  v_full_license_key text := 'TEST-ADMIN-AUTH-FULL-' || v_suffix;
  v_username text := 'owner_' || substr(v_suffix, 1, 6);
  v_password text := 'Pw' || substr(md5(v_suffix), 1, 18) || '9';
  v_session text;
  v_result jsonb;
  v_count integer;
  v_hash text;
  v_staff_id uuid;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, max_devices, product_name, features)
  values
    (v_license_id, v_license_key, 'pro', 'active', now() + interval '1 day', 2, 'Foundation fixture', '{"staff_roles":true}'::jsonb),
    (v_full_license_id, v_full_license_key, 'pro', 'active', now() + interval '1 day', 1, 'Full fixture', '{}'::jsonb);

  insert into public.license_devices(id, license_id, device_fingerprint, device_name, security_token, is_active, device_role)
  values
    (v_device_id, v_license_id, 'auth-owner-' || v_suffix, 'Foundation owner', 'device-' || v_suffix, true, 'admin'),
    (v_full_device_id, v_full_license_id, 'auth-full-' || v_suffix, 'Full owner', 'full-device-' || v_suffix, true, 'admin');

  -- Enrollment is allowed only from the trusted pre-existing admin device.
  v_result := public.admin_enroll_owner_on_device(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_username, v_password, 'Foundation owner');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_ENROLL_FAILED: %', v_result; end if;
  v_session := v_result->>'admin_session_token';
  if nullif(v_session, '') is null then raise exception 'FOUNDATION_SESSION_MISSING'; end if;

  if (select password_hash from public.license_admin_users where license_id = v_license_id) = v_password then raise exception 'FOUNDATION_PASSWORD_STORED_PLAIN'; end if;
  select session_token_hash into v_hash from public.license_admin_sessions where license_id = v_license_id order by created_at desc limit 1;
  if v_hash = v_session or v_hash is null then raise exception 'FOUNDATION_TOKEN_STORED_PLAIN'; end if;

  v_result := public.admin_enroll_owner_on_device(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, 'second_' || substr(v_suffix, 1, 5), v_password, 'Second owner');
  if v_result->>'code' <> 'ADMIN_OWNER_ALREADY_ENROLLED' then raise exception 'FOUNDATION_SECOND_OWNER_FAILED: %', v_result; end if;

  v_result := public.verify_admin_session(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_session);
  if coalesce((v_result->>'valid')::boolean, false) is not true then raise exception 'FOUNDATION_VERIFY_FAILED: %', v_result; end if;

  -- Administrative staff overloads require the owner session created above.
  v_result := public.admin_list_staff_users(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_session);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_STAFF_LIST_FAILED: %', v_result; end if;
  v_result := public.admin_create_staff_user(
    v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix,
    'staff_' || substr(v_suffix, 1, 6), 'Pw' || substr(md5(v_suffix || 'staff'), 1, 18) || '9',
    'Foundation staff', '{"settings":true,"ecommerce":true}'::jsonb, 'cashier', v_session
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_STAFF_CREATE_FAILED: %', v_result; end if;
  select id into v_staff_id from public.license_staff_users
   where license_id = v_license_id and username = 'staff_' || substr(v_suffix, 1, 6);
  v_result := public.admin_update_staff_user(
    v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_staff_id,
    'Updated foundation staff', '{"settings":true,"ecommerce":true}'::jsonb,
    true, null, 'cashier', v_session
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_STAFF_UPDATE_FAILED: %', v_result; end if;

  v_result := public.admin_login_on_device(v_license_key, v_username, 'Wrong' || substr(v_suffix, 1, 12) || '9', 'bad-' || v_suffix, 'Bad', '{}'::jsonb);
  if v_result->>'code' <> 'INVALID_ADMIN_CREDENTIALS' or exists(select 1 from public.license_devices where license_id = v_license_id and device_fingerprint = 'bad-' || v_suffix) then raise exception 'FOUNDATION_BAD_PASSWORD_FAILED'; end if;

  v_result := public.admin_login_on_device(v_license_key, v_username, v_password, 'second-admin-' || v_suffix, 'Second', '{}'::jsonb);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_SECOND_LOGIN_FAILED: %', v_result; end if;
  select count(*) into v_count from public.license_devices where license_id = v_license_id and is_active;
  if v_count <> 2 then raise exception 'FOUNDATION_DEVICE_SLOT_FAILED: %', v_count; end if;

  v_result := public.admin_login_on_device(v_license_key, v_username, v_password, 'third-admin-' || v_suffix, 'Third', '{}'::jsonb);
  if v_result->>'code' <> 'DEVICE_LIMIT_REACHED' then raise exception 'FOUNDATION_DEVICE_LIMIT_FAILED: %', v_result; end if;

  v_result := public.admin_login_on_device(v_license_key, v_username, v_password, 'second-admin-' || v_suffix, 'Second again', '{}'::jsonb);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'FOUNDATION_REUSE_FAILED: %', v_result; end if;

  select id into v_staff_id from public.license_devices
   where license_id = v_license_id and device_fingerprint = 'second-admin-' || v_suffix;
  v_result := public.admin_release_device(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_session, v_staff_id);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or exists(select 1 from public.license_devices where id = v_staff_id and is_active) then
    raise exception 'FOUNDATION_RELEASE_FAILED: %', v_result;
  end if;
  if not exists(select 1 from public.license_admin_users where license_id = v_license_id and is_owner and is_active) then
    raise exception 'FOUNDATION_OWNER_LOST_AFTER_RELEASE';
  end if;

  v_result := public.admin_get_license_devices(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, 'not-a-session');
  if coalesce((v_result->>'success')::boolean, true) is true then raise exception 'FOUNDATION_ADMIN_SESSION_REQUIRED_FAILED'; end if;

  v_result := public.admin_logout_session(v_license_key, 'auth-owner-' || v_suffix, 'device-' || v_suffix, v_session);
  if coalesce((v_result->>'success')::boolean, false) is not true or not exists(select 1 from public.license_devices where id = v_device_id and is_active) then raise exception 'FOUNDATION_LOGOUT_FAILED: %', v_result; end if;

  -- Rotating fingerprints cannot evade the stable username partition.
  for v_count in 1..11 loop
    v_result := public.admin_login_on_device(v_full_license_key, 'limit_' || substr(v_suffix, 1, 6), 'Wrong' || substr(v_suffix, 1, 12) || '9', 'rotating-' || v_count || '-' || v_suffix, 'Rate', '{}'::jsonb);
  end loop;
  if v_result->>'code' <> 'ADMIN_LOGIN_RATE_LIMITED' or coalesce((v_result->>'retry_after_seconds')::integer, 0) <= 0 then raise exception 'FOUNDATION_ROTATING_FINGERPRINT_FAILED: %', v_result; end if;
  v_result := public.admin_login_on_device(v_full_license_key, 'limit_' || substr(v_suffix, 1, 6), v_password, 'rotating-final-' || v_suffix, 'Rate', '{}'::jsonb);
  if v_result->>'code' <> 'ADMIN_LOGIN_RATE_LIMITED' then raise exception 'FOUNDATION_RATE_LIMIT_VALID_PASSWORD_BYPASS'; end if;
  if exists(select 1 from public.pos_rpc_rate_limits where license_key = v_full_license_key and (coalesce(metadata::text, '') like '%' || v_password || '%' or coalesce(metadata::text, '') like '%' || v_username || '%')) then raise exception 'FOUNDATION_RATE_LIMIT_SECRET_METADATA'; end if;

  if has_table_privilege('anon', 'public.license_admin_users', 'select') or has_table_privilege('authenticated', 'public.license_admin_sessions', 'select') then raise exception 'FOUNDATION_DIRECT_TABLE_GRANT'; end if;
  if has_function_privilege('anon', 'private.require_active_admin_session(text,text,text,text)', 'execute') then raise exception 'FOUNDATION_PRIVATE_HELPER_GRANT'; end if;
end;
$test$;

rollback;
