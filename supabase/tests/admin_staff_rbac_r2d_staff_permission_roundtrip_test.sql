-- ADMIN.STAFF.RBAC.R2D regression matrix.
-- All fixtures are synthetic and the complete test is rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_staff_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'TEST-R2D-STAFF-' || v_suffix;
  v_result jsonb;
  v_permissions jsonb;
  v_expected_products boolean;
  v_expected_inventory boolean;
  v_cases jsonb[] := array[
    '{"products":true,"inventory":false,"reports":true,"settings":true}'::jsonb,
    '{"products":false,"inventory":true,"reports":true,"settings":true}'::jsonb,
    '{"products":true,"inventory":true,"reports":true,"settings":true}'::jsonb,
    '{"products":false,"inventory":false,"reports":true,"settings":true}'::jsonb
  ];
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, max_devices, product_name, features)
  values (v_license_id, v_license_key, 'pro', 'active', now() + interval '1 day', 1, 'R2D round-trip fixture', '{}'::jsonb);

  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, role_name, permissions)
  values (
    v_staff_id,
    v_license_id,
    'r2d_roundtrip_' || v_suffix,
    'R2D round-trip fixture',
    'fixture-hash',
    'custom',
    private.default_staff_permissions()
  );

  foreach v_permissions in array v_cases loop
    v_expected_products := (v_permissions->>'products')::boolean;
    v_expected_inventory := (v_permissions->>'inventory')::boolean;
    v_result := private.admin_update_staff_user_impl(
      v_license_id,
      v_license_key,
      v_staff_id,
      'R2D round-trip fixture',
      v_permissions,
      true,
      null,
      'custom'
    );

    if coalesce((v_result->>'success')::boolean, false) is not true then
      raise exception 'R2D_STAFF_UPDATE_FAILED: %', v_result;
    end if;
    if (v_result->'staff_user'->'permissions'->>'products')::boolean <> v_expected_products
       or (v_result->'staff_user'->'permissions'->>'inventory')::boolean <> v_expected_inventory
       or (v_result->'staff_user'->'permissions'->>'reports')::boolean is distinct from true
       or (v_result->'staff_user'->'permissions'->>'settings')::boolean is distinct from true then
      raise exception 'R2D_STAFF_PERMISSION_ROUND_TRIP_FAILED: %', v_result;
    end if;
  end loop;

  -- Strict normalization ignores malformed values instead of truthifying them.
  v_result := private.admin_update_staff_user_impl(
    v_license_id,
    v_license_key,
    v_staff_id,
    'R2D round-trip fixture',
    '{"products":"true","inventory":1,"reports":true,"settings":true}'::jsonb,
    true,
    null,
    'custom'
  );
  if (v_result->'staff_user'->'permissions'->>'products')::boolean is distinct from false
     or (v_result->'staff_user'->'permissions'->>'inventory')::boolean is distinct from false
     or (v_result->'staff_user'->'permissions'->>'reports')::boolean is distinct from true
     or (v_result->'staff_user'->'permissions'->>'settings')::boolean is distinct from true then
    raise exception 'R2D_STAFF_MALFORMED_PERMISSION_FAILED: %', v_result;
  end if;
end;
$test$;

rollback;
