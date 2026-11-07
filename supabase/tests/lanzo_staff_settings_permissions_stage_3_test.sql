-- Etapa 3 contract tests. Run only against a database with this migration
-- applied; every assertion is read-only and the transaction is rolled back.
begin;

do $test$
declare
  v_permissions jsonb;
  v_context jsonb;
  v_legacy_raw jsonb := '{"settings":true}'::jsonb;
  v_profile_definition text;
  v_station_signature text := 'private.assert_preparation_station_manage_permission(jsonb)';
  v_profile_signature text := 'public.save_business_profile_secure(text,text,text,text,jsonb)';
begin
  v_permissions := private.default_staff_permissions();
  if v_permissions->>'settings_data' <> 'false'
     or v_permissions->>'settings_controls' <> 'false'
     or v_permissions->>'settings_maintenance' <> 'false'
     or v_permissions->>'settings_backup' <> 'false' then
    raise exception 'DEFAULT_GRANULAR_SETTINGS_PERMISSIONS_CHANGED';
  end if;

  v_permissions := private.normalize_staff_permissions('{"settings":true}'::jsonb);
  if v_permissions->>'settings_data' <> 'true'
     or v_permissions->>'settings_controls' <> 'true'
     or v_permissions->>'settings_maintenance' <> 'false'
     or v_permissions->>'settings_backup' <> 'false' then
    raise exception 'LEGACY_SETTINGS_MAPPING_FAILED';
  end if;

  -- The normalized view adds granular keys, but legacy detection must use the
  -- raw verified permissions stored on the actor context.
  if v_legacy_raw ?| array[
    'settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup'
  ] then
    raise exception 'LEGACY_TEST_FIXTURE_HAS_GRANULAR_KEYS';
  end if;
  if (v_permissions ?| array[
    'settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup'
  ]) is not true then
    raise exception 'NORMALIZED_SETTINGS_DEFAULTS_NOT_PRESENT';
  end if;
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', v_legacy_raw,
    'staff_permissions', v_legacy_raw
  );
  perform private.assert_preparation_station_manage_permission(v_context);

  -- Granular Controls independently authorizes preparation stations.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"settings_controls":true}'::jsonb
  );
  perform private.assert_preparation_station_manage_permission(v_context);

  -- An explicit granular denial blocks inheritance from legacy Settings.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"settings":true,"settings_controls":false}'::jsonb
  );
  begin
    perform private.assert_preparation_station_manage_permission(v_context);
    raise exception 'EXPECTED_EXPLICIT_CONTROLS_DENIAL';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POS_PERMISSION_DENIED:preparation_stations' then
        raise exception 'WRONG_EXPLICIT_CONTROLS_DENIAL: %', sqlerrm;
      end if;
  end;

  -- A partial granular grant also disables legacy inheritance for missing
  -- sections, matching normalize_staff_permissions' fail-closed contract.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"settings":true,"settings_data":true}'::jsonb
  );
  begin
    perform private.assert_preparation_station_manage_permission(v_context);
    raise exception 'EXPECTED_MISSING_CONTROLS_DENIAL';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POS_PERMISSION_DENIED:preparation_stations' then
        raise exception 'WRONG_MISSING_CONTROLS_DENIAL: %', sqlerrm;
      end if;
  end;

  -- Products authority remains independent of Settings permissions.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"products":true}'::jsonb
  );
  perform private.assert_preparation_station_manage_permission(v_context);

  -- No relevant permission is denied with the established RPC error.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{}'::jsonb
  );
  begin
    perform private.assert_preparation_station_manage_permission(v_context);
    raise exception 'EXPECTED_PREPARATION_STATION_DENIAL';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POS_PERMISSION_DENIED:preparation_stations' then
        raise exception 'WRONG_PREPARATION_STATION_DENIAL: %', sqlerrm;
      end if;
  end;

  -- Authority comes from the authenticated actor, never the device's role.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'device_role', 'admin',
    'actor_permissions', '{"settings_controls":false}'::jsonb
  );
  begin
    perform private.assert_preparation_station_manage_permission(v_context);
    raise exception 'EXPECTED_DEVICE_ROLE_NOT_TO_GRANT_ACCESS';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POS_PERMISSION_DENIED:preparation_stations' then
        raise exception 'WRONG_DEVICE_ROLE_DENIAL: %', sqlerrm;
      end if;
  end;
  v_context := jsonb_build_object(
    'actor_type', 'admin',
    'device_role', 'staff',
    'actor_permissions', '{}'::jsonb
  );
  perform private.assert_preparation_station_manage_permission(v_context);

  if has_function_privilege('anon', v_station_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_station_signature, 'EXECUTE')
     or has_function_privilege('service_role', v_station_signature, 'EXECUTE')
     or has_function_privilege('public', v_station_signature, 'EXECUTE') then
    raise exception 'PREPARATION_STATION_GATE_ACL_CHANGED';
  end if;

  v_permissions := private.normalize_staff_permissions('{"sync":true}'::jsonb);
  if v_permissions->>'settings_data' <> 'false'
     or v_permissions->>'settings_controls' <> 'false'
     or v_permissions->>'settings_maintenance' <> 'true'
     or v_permissions->>'settings_backup' <> 'true' then
    raise exception 'LEGACY_SYNC_MAPPING_FAILED';
  end if;

  v_permissions := private.normalize_staff_permissions('{"inventory":true}'::jsonb);
  if v_permissions->>'settings_maintenance' <> 'true'
     or v_permissions->>'settings_backup' <> 'false' then
    raise exception 'LEGACY_INVENTORY_MAPPING_FAILED';
  end if;

  v_permissions := private.normalize_staff_permissions(
    '{"settings":true,"sync":true,"inventory":true,"settings_data":true,"settings_controls":false,"settings_maintenance":false,"settings_backup":false}'::jsonb
  );
  if v_permissions->>'settings_data' <> 'true'
     or v_permissions->>'settings_controls' <> 'false'
     or v_permissions->>'settings_maintenance' <> 'false'
     or v_permissions->>'settings_backup' <> 'false' then
    raise exception 'EXPLICIT_SECTION_DENIAL_WAS_OVERRIDDEN';
  end if;

  v_permissions := private.normalize_staff_permissions(
    '{"settings":true,"settings_data":true}'::jsonb
  );
  if v_permissions->>'settings_controls' <> 'false' then
    raise exception 'PARTIAL_GRANULAR_SETTINGS_GRANTED_MISSING_SECTION';
  end if;

  v_permissions := private.normalize_staff_permissions(
    '{"settings":true,"settings_controls":"true"}'::jsonb
  );
  if v_permissions->>'settings_controls' <> 'false' then
    raise exception 'MALFORMED_GRANULAR_PERMISSION_DID_NOT_FAIL_CLOSED';
  end if;

  v_permissions := private.normalize_staff_permissions('{"license":true,"devices":true}'::jsonb);
  if v_permissions->>'license' <> 'true' or v_permissions->>'devices' <> 'true' then
    raise exception 'LICENSE_OR_DEVICE_PERMISSION_CHANGED';
  end if;

  v_permissions := private.normalize_staff_permissions(
    '{"settings_data":true,"settings_controls":false}'::jsonb
  );
  v_context := jsonb_build_object('actor_type', 'staff', 'actor_permissions', v_permissions);
  if private.has_pos_permission(v_context, 'settings_data') is not true
     or private.has_pos_permission(v_context, 'settings_controls') is true then
    raise exception 'STAFF_PROFILE_PERMISSION_MATRIX_FAILED';
  end if;

  v_context := jsonb_build_object('actor_type', 'admin', 'actor_permissions', '{}'::jsonb);
  if private.has_pos_permission(v_context, 'settings_data') is not true
     or private.has_pos_permission(v_context, 'settings_controls') is not true
     or private.has_pos_permission(v_context, 'settings_backup') is not true then
    raise exception 'ADMIN_SETTINGS_PERMISSION_MATRIX_FAILED';
  end if;

  select pg_get_functiondef(v_profile_signature::regprocedure) into v_profile_definition;
  if position('private.validate_pos_sync_context' in v_profile_definition) = 0
     or position('enforce_pos_rpc_rate_limit_v2' in v_profile_definition) = 0
     or position('save_business_profile_secure_unlimited' in v_profile_definition) = 0
     or position('has_pos_permission(v_context, ''settings_data'')' in v_profile_definition) = 0
     or position('has_pos_permission(v_context, ''settings'')' in v_profile_definition) > 0 then
    raise exception 'BUSINESS_PROFILE_RPC_AUTHORITY_CONTRACT_FAILED';
  end if;

  if not has_function_privilege('anon', v_profile_signature, 'EXECUTE')
     or not has_function_privilege('authenticated', v_profile_signature, 'EXECUTE')
     or not has_function_privilege('service_role', v_profile_signature, 'EXECUTE')
     or has_function_privilege('public', v_profile_signature, 'EXECUTE') then
    raise exception 'BUSINESS_PROFILE_RPC_ACL_CHANGED';
  end if;
end;
$test$;

rollback;
