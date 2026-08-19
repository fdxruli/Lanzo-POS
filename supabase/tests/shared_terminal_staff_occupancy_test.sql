-- SHARED.TERMINAL.2-R1 — transactional Staff occupancy integration.
-- Safe to run against a validation database or production: all fixture writes
-- are rolled back at the end of the transaction.
begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_id uuid := extensions.gen_random_uuid();
  v_staff_x uuid := extensions.gen_random_uuid();
  v_staff_y uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_license_key text := 'ST2R1-' || v_suffix;
  v_fp_a text := 'st2r1-a-' || v_suffix;
  v_fp_b text := 'st2r1-b-' || v_suffix;
  v_result jsonb;
  v_token_a text;
  v_token_b text;
  v_token_y text;
  v_mode text;
  v_role text;
  v_staff_meta uuid;
begin
  insert into public.licenses (
    id, license_key, license_type, max_devices, status, product_name, features
  ) values (
    v_license_id, v_license_key, 'pro', 10, 'active', 'SHARED.TERMINAL.2-R1 TEST',
    jsonb_build_object('staff_roles', true)
  );

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values
  (
    v_staff_x, v_license_id, 'staffx-' || left(v_suffix, 8), 'Staff X',
    extensions.crypt('st2r1-pass', extensions.gen_salt('bf', 4)),
    'staff', jsonb_build_object('pos_access', true), true
  ),
  (
    v_staff_y, v_license_id, 'staffy-' || left(v_suffix, 8), 'Staff Y',
    extensions.crypt('st2r1-pass', extensions.gen_salt('bf', 4)),
    'staff', jsonb_build_object('pos_access', true), true
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode, staff_user_id
  ) values (
    v_device_a, v_license_id, v_fp_a, 'Device A', '{}'::jsonb,
    true, 'fixture-device-token-a', 'staff', 'staff_only', v_staff_x
  );

  -- TEST A — legacy dedicated staff_only reservation remains exclusive.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_b, 'Device B', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if v_result->>'code' is distinct from 'STAFF_ALREADY_IN_USE' then
    raise exception 'TEST_A_EXPECTED_STAFF_ALREADY_IN_USE:%', v_result;
  end if;

  -- Give Staff X a real session on A while it is still dedicated.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_a, 'Device A', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_B_SETUP_LOGIN_A_FAILED:%', v_result;
  end if;
  v_token_a := v_result->>'staff_session_token';

  -- Simulate the already-authenticated Admin device-mode transition. The
  -- production Admin RPC separately proves Admin authority; this test isolates
  -- occupancy semantics and intentionally preserves legacy metadata.
  update public.license_devices
  set device_mode = 'shared'
  where id = v_device_a;

  v_result := public.staff_logout_session_unlimited(v_license_key, v_fp_a, v_token_a);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_B_LOGOUT_A_FAILED:%', v_result;
  end if;

  select device_mode, device_role, staff_user_id
  into v_mode, v_role, v_staff_meta
  from public.license_devices
  where id = v_device_a;

  if v_mode <> 'shared' or v_role <> 'staff' or v_staff_meta <> v_staff_x then
    raise exception 'TEST_B_LEGACY_METADATA_NOT_PRESERVED:%/%/%', v_mode, v_role, v_staff_meta;
  end if;

  -- TEST B — staff_only -> shared + logout releases the legacy reservation.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_b, 'Device B', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_B_EXPECTED_LOGIN_B_PASS:%', v_result;
  end if;
  v_token_b := v_result->>'staff_session_token';

  v_result := public.staff_logout_session_unlimited(v_license_key, v_fp_b, v_token_b);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_C_LOGOUT_B_FAILED:%', v_result;
  end if;
  update public.license_devices
  set is_active = false
  where device_fingerprint = v_fp_b and license_id = v_license_id;

  -- TEST C — shared legacy metadata without an active Staff session is not exclusive.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_b, 'Device B', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_C_EXPECTED_LOGIN_B_PASS:%', v_result;
  end if;
  v_token_b := v_result->>'staff_session_token';
  perform public.staff_logout_session_unlimited(v_license_key, v_fp_b, v_token_b);
  update public.license_devices
  set is_active = false
  where device_fingerprint = v_fp_b and license_id = v_license_id;

  -- TEST D — a real active Staff session on shared A remains exclusive.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_a, 'Device A', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'TEST_D_SETUP_LOGIN_A_FAILED:%', v_result;
  end if;
  v_token_a := v_result->>'staff_session_token';

  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_b, 'Device B', '{}'::jsonb,
    'staffx-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if v_result->>'code' is distinct from 'STAFF_ALREADY_IN_USE' then
    raise exception 'TEST_D_EXPECTED_ACTIVE_SESSION_BLOCK:%', v_result;
  end if;

  perform public.staff_logout_session_unlimited(v_license_key, v_fp_a, v_token_a);

  -- TEST E — Staff Y can use the same shared A without inheriting Staff X.
  v_result := public.staff_login_on_device_unlimited(
    v_license_key, v_fp_a, 'Device A', '{}'::jsonb,
    'staffy-' || left(v_suffix, 8), 'st2r1-pass'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result->'staff_user'->>'id')::uuid <> v_staff_y then
    raise exception 'TEST_E_EXPECTED_STAFF_Y_PASS:%', v_result;
  end if;
  v_token_y := v_result->>'staff_session_token';

  select staff_user_id into v_staff_meta
  from public.license_devices where id = v_device_a;
  if v_staff_meta <> v_staff_x then
    raise exception 'TEST_E_SHARED_LEGACY_METADATA_WAS_REASSIGNED:%', v_staff_meta;
  end if;

  perform public.staff_logout_session_unlimited(v_license_key, v_fp_a, v_token_y);
end;
$test$;

rollback;
