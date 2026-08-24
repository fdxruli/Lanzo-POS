-- ADMIN.STAFF.SECTION.ISOLATION.R1
-- Actor-authorize business-profile writes and require a real Admin actor before
-- free-trial setup. This migration changes contracts only; it mutates no tenant
-- business data.

do $migration$
begin
  if to_regprocedure('private.validate_pos_sync_context(text,text,text,text)') is null
     or to_regprocedure('private.has_pos_permission(jsonb,text)') is null
     or to_regprocedure('public.save_business_profile_secure_unlimited(text,text,text,jsonb)') is null then
    raise exception 'PROFILE_ACTOR_AUTH_PREREQUISITE_MISSING';
  end if;

  if to_regprocedure('public.save_business_profile_secure(text,text,text,jsonb)') is null then
    raise exception 'PROFILE_LEGACY_RPC_MISSING';
  end if;
  if to_regprocedure('public.save_business_profile_secure_legacy(text,text,text,jsonb)') is not null then
    raise exception 'PROFILE_LEGACY_RPC_NAME_COLLISION';
  end if;

  alter function public.save_business_profile_secure(text,text,text,jsonb)
    rename to save_business_profile_secure_legacy;
end;
$migration$;

revoke all on function public.save_business_profile_secure_legacy(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_business_profile_secure_unlimited(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_business_profile_secure_unlimited(text,text,text,jsonb)
  to service_role;

create function public.save_business_profile_secure(
  license_key_param text,
  device_fingerprint_param text,
  security_token_param text,
  actor_session_token_param text,
  profile_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_context jsonb;
  v_result jsonb;
  v_code text;
begin
  -- Preserve the SEC.2 PROFILE bucket exactly. The throttle stays device scoped;
  -- actor tokens are never used as a rate-limit key or written to metadata.
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    license_key_param,
    device_fingerprint_param,
    null,
    'save_business_profile_secure',
    'PROFILE',
    30,
    600,
    600,
    'AUTH_RATE_LIMITED',
    '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  if nullif(btrim(coalesce(actor_session_token_param, '')), '') is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ACTOR_SESSION_REQUIRED',
      'error', 'ACTOR_SESSION_REQUIRED'
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      license_key_param,
      device_fingerprint_param,
      security_token_param,
      actor_session_token_param
    );
  exception
    when sqlstate 'P0001' then
      v_code := case sqlerrm
        when 'LICENSE_NOT_FOUND' then 'LICENSE_NOT_FOUND'
        when 'LICENSE_NOT_ACTIVE' then 'LICENSE_NOT_ACTIVE'
        when 'LICENSE_EXPIRED' then 'LICENSE_EXPIRED'
        when 'DEVICE_NOT_ALLOWED' then 'DEVICE_NOT_ALLOWED'
        when 'DEVICE_NOT_ACTIVE' then 'DEVICE_NOT_ACTIVE'
        when 'DEVICE_TOKEN_REQUIRED' then 'DEVICE_TOKEN_REQUIRED'
        when 'DEVICE_TOKEN_INVALID' then 'DEVICE_TOKEN_INVALID'
        when 'ACTOR_SESSION_REQUIRED' then 'ACTOR_SESSION_REQUIRED'
        when 'STAFF_SESSION_EXPIRED' then 'STAFF_SESSION_EXPIRED'
        when 'STAFF_USER_INACTIVE' then 'STAFF_USER_INACTIVE'
        when 'ACTOR_SESSION_AMBIGUOUS' then 'ACTOR_SESSION_AMBIGUOUS'
        else 'ACTOR_SESSION_INVALID'
      end;
      return jsonb_build_object('success', false, 'code', v_code, 'error', v_code);
  end;

  if private.has_pos_permission(v_context, 'settings') is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'SETTINGS_PERMISSION_DENIED',
      'error', 'SETTINGS_PERMISSION_DENIED'
    );
  end if;

  -- Keep the hardened SEC.2 internal writer as the only profile persistence
  -- implementation. Its device validation remains defense in depth.
  v_result := public.save_business_profile_secure_unlimited(
    license_key_param,
    device_fingerprint_param,
    security_token_param,
    profile_data
  );

  if coalesce((v_result->>'success')::boolean, false) is false
     and not (v_result ? 'code') then
    v_result := v_result || jsonb_build_object(
      'code', coalesce(v_result->>'error', 'BUSINESS_PROFILE_SAVE_FAILED')
    );
  end if;
  return v_result;
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'BUSINESS_PROFILE_SAVE_FAILED',
      'error', 'BUSINESS_PROFILE_SAVE_FAILED'
    );
end;
$function$;

revoke all on function public.save_business_profile_secure(text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_business_profile_secure(text,text,text,text,jsonb)
  to anon, authenticated, service_role;

comment on function public.save_business_profile_secure(text,text,text,text,jsonb) is
  'R1 actor-aware profile writer. Requires canonical Admin or Staff settings authority and preserves the SEC.2 device-scoped PROFILE throttle.';
comment on function public.save_business_profile_secure_legacy(text,text,text,jsonb) is
  'R1 retired four-argument profile endpoint. No client role has EXECUTE.';

-- Free trials follow the same Admin actor boundary as paid plans. Removing the
-- legacy-free delegation makes an enrolled owner choose/login and a trusted
-- device without an owner enter enrollment.
create or replace function public.activate_license_on_device_unlimited(
  license_key_param text,
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_has_owner boolean;
  v_staff_access_available boolean;
begin
  select l.id, l.status, l.expires_at, l.product_name, p.code as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = license_key_param
  for update of l;

  if v_license.id is null then
    return json_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;
  if v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return json_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  v_staff_access_available := coalesce((v_license.features->>'staff_roles')::boolean, false);
  select exists (
    select 1
    from public.license_admin_users u
    where u.license_id = v_license.id
      and u.is_owner
      and u.is_active
  ) into v_has_owner;

  if v_has_owner then
    return json_build_object(
      'success', false,
      'code', 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
      'access_choice_required', true,
      'details', json_build_object(
        'license_key', license_key_param,
        'device_role', 'admin',
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'features', v_license.features,
        'staff_access_available', v_staff_access_available
      )
    );
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = device_fingerprint_param
  limit 1;

  if v_device.id is not null
     and v_device.is_active
     and v_device.device_role = 'admin' then
    return json_build_object(
      'success', false,
      'code', 'ADMIN_ENROLLMENT_REQUIRED',
      'admin_enrollment_required', true,
      'details', json_build_object(
        'license_key', license_key_param,
        'device_role', 'admin',
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'features', v_license.features,
        'staff_access_available', v_staff_access_available
      )
    );
  end if;

  if v_device.id is not null and v_device.device_role = 'staff' then
    return json_build_object(
      'success', false,
      'code', 'STAFF_LOGIN_REQUIRED',
      'staff_login_required', true,
      'details', json_build_object(
        'license_key', license_key_param,
        'device_role', 'staff',
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'features', v_license.features,
        'staff_access_available', v_staff_access_available
      )
    );
  end if;

  return json_build_object('success', false, 'code', 'ADMIN_ENROLLMENT_NOT_ALLOWED');
end;
$function$;

revoke all on function public.activate_license_on_device_unlimited(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_license_on_device_unlimited(text,text,text,jsonb)
  to service_role;

-- Owner authentication is valid for every active plan, including free_trial.
-- The rest of the shared-terminal login implementation is intentionally kept
-- identical to its latest hardened definition.
create or replace function public.admin_login_on_device(
  p_license_key text,
  p_username text,
  p_password text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_info jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_license record;
  v_admin public.license_admin_users%rowtype;
  v_device public.license_devices%rowtype;
  v_active_count integer;
  v_device_token text;
  v_session jsonb;
  v_profile_required boolean;
  v_realtime_topic text;
  v_device_mode text;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_username, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_LOGIN_INVALID_REQUEST');
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-user:' || encode(extensions.digest(lower(btrim(coalesce(p_username, ''))), 'sha256'), 'hex'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, 'admin-license-global', null, 'admin_login_on_device',
    'ADMIN_AUTH', 50, 900, 1800, 'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-device:' || coalesce(nullif(btrim(p_device_fingerprint), ''), '__missing_device__'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  select l.id, l.status, l.expires_at, l.license_key, l.product_name,
         coalesce(l.max_devices, p.max_devices, 1) as max_devices,
         p.code as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_ADMIN_CREDENTIALS');
  end if;
  if v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  select u.* into v_admin
  from public.license_admin_users u
  where u.license_id = v_license.id
    and u.username = lower(btrim(coalesce(p_username, '')))
    and u.is_owner is true
    and u.is_active is true
  limit 1;

  if v_admin.id is null
     or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ADMIN_CREDENTIALS',
      'message', 'Usuario o contrasena incorrectos.'
    );
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  for update;

  if v_device.id is not null and v_device.device_mode = 'staff_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_MODE_ADMIN_NOT_ALLOWED',
      'message', 'Este dispositivo esta configurado solo para Staff.'
    );
  end if;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true
    and (v_device.id is null or d.id <> v_device.id);

  if v_active_count + 1 > v_license.max_devices then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_LIMIT_REACHED',
      'message', 'Limite de dispositivos alcanzado para esta licencia.'
    );
  end if;

  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');

  if v_device.id is null then
    v_device_mode := 'admin_only';
    v_realtime_topic := private.generate_license_realtime_topic();
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, device_info, is_active,
      security_token, previous_security_token, realtime_topic, last_check_at,
      last_used_at, device_role, device_mode, staff_user_id
    ) values (
      v_license.id, p_device_fingerprint, left(p_device_name, 120),
      coalesce(p_device_info, '{}'::jsonb), true, v_device_token, null,
      v_realtime_topic, now(), now(), 'admin', v_device_mode, null
    ) returning * into v_device;
  else
    v_device_mode := v_device.device_mode;
    update public.license_devices
    set device_name = left(p_device_name, 120),
        device_info = coalesce(p_device_info, '{}'::jsonb),
        is_active = true,
        security_token = v_device_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_check_at = now(),
        last_used_at = now(),
        device_role = case when device_mode = 'admin_only' then 'admin' else device_role end,
        staff_user_id = case when device_mode = 'admin_only' then null else staff_user_id end
    where id = v_device.id
    returning * into v_device;
  end if;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'ADMIN_LOGIN_HANDOFF')
  where device_id = v_device.id
    and revoked_at is null;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update public.license_admin_users
  set updated_at = now()
  where id = v_admin.id;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license.id
      and nullif(btrim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'ADMIN_LOGIN',
    jsonb_build_object(
      'admin_user_id', v_admin.id,
      'device_id', v_device.id,
      'device_mode', v_device.device_mode,
      'logged_in_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'device_security_token', v_device_token,
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'admin_user', jsonb_build_object(
      'id', v_admin.id,
      'username', v_admin.username,
      'display_name', v_admin.display_name,
      'is_owner', true
    ),
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
    'device_role', 'admin',
    'details', jsonb_build_object(
      'valid', true,
      'license_key', v_license.license_key,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features,
      'profile_required', v_profile_required,
      'device_name', v_device.device_name,
      'device_mode', v_device.device_mode,
      'legacy_device_role', v_device.device_role,
      'device_role', 'admin',
      'staff_user', null,
      'expires_at', v_license.expires_at,
      'realtime_topic', case
        when coalesce((v_license.effective_features->>'realtime_license_sync')::boolean, false)
          then v_device.realtime_topic
        else null
      end
    )
  );
end;
$function$;

revoke all on function public.admin_login_on_device(text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_login_on_device(text,text,text,text,text,jsonb)
  to anon, authenticated, service_role;

create or replace function public.admin_enroll_owner_on_device(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_username text,
  p_password text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_license record;
  v_device public.license_devices%rowtype;
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_admin public.license_admin_users%rowtype;
  v_session jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, null, 'admin_enroll_owner_on_device',
    'ADMIN_AUTH', 5, 900, 1800, 'ADMIN_ENROLLMENT_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  if char_length(v_username) < 3 or char_length(v_username) > 64
     or v_username !~ '^[a-z0-9._-]+$' then
    return jsonb_build_object(
      'success', false,
      'code', 'ADMIN_USERNAME_INVALID',
      'message', 'Usa un usuario de 3 a 64 caracteres.'
    );
  end if;
  if v_display_name is null or char_length(v_display_name) > 120 then
    return jsonb_build_object(
      'success', false,
      'code', 'ADMIN_DISPLAY_NAME_INVALID',
      'message', 'Ingresa el nombre del propietario.'
    );
  end if;
  if p_password is null or char_length(p_password) < 8
     or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    return jsonb_build_object(
      'success', false,
      'code', 'ADMIN_PASSWORD_WEAK',
      'message', 'La contrasena debe tener al menos 8 caracteres, una letra y un numero.'
    );
  end if;

  select l.id, l.status, l.expires_at, l.license_key, p.code as plan_code
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;
  if v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;
  if exists (
    select 1
    from public.license_admin_users u
    where u.license_id = v_license.id
      and u.is_owner
  ) then
    return jsonb_build_object('success', false, 'code', 'ADMIN_OWNER_ALREADY_ENROLLED');
  end if;

  select d.* into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared')
    and (d.security_token = p_device_security_token
         or d.previous_security_token = p_device_security_token)
  for update;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ENROLLMENT_NOT_ALLOWED');
  end if;

  insert into public.license_admin_users (
    license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_license.id,
    v_username,
    v_display_name,
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
    true,
    true
  ) returning * into v_admin;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'ADMIN_ENROLLMENT_HANDOFF')
  where device_id = v_device.id
    and revoked_at is null;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'ADMIN_OWNER_ENROLLED',
    jsonb_build_object(
      'admin_user_id', v_admin.id,
      'device_id', v_device.id,
      'device_mode', v_device.device_mode,
      'enrolled_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'code', 'ADMIN_OWNER_ENROLLED',
    'admin_user', jsonb_build_object(
      'id', v_admin.id,
      'username', v_admin.username,
      'display_name', v_admin.display_name,
      'is_owner', true
    ),
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
    'device_role', 'admin'
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'code', 'ADMIN_OWNER_ALREADY_ENROLLED');
end;
$function$;

revoke all on function public.admin_enroll_owner_on_device(text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_enroll_owner_on_device(text,text,text,text,text,text)
  to anon, authenticated, service_role;

do $verification$
declare
  v_profile_config text[];
  v_profile_definition text;
  v_activation_definition text;
  v_admin_login_definition text;
  v_admin_enroll_definition text;
begin
  if to_regprocedure('public.save_business_profile_secure(text,text,text,jsonb)') is not null
     or to_regprocedure('public.save_business_profile_secure_legacy(text,text,text,jsonb)') is null
     or to_regprocedure('public.save_business_profile_secure(text,text,text,text,jsonb)') is null then
    raise exception 'PROFILE_RPC_SIGNATURE_CUTOVER_FAILED';
  end if;

  if has_function_privilege('anon', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('authenticated', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('service_role', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('public', 'public.save_business_profile_secure(text,text,text,text,jsonb)', 'EXECUTE') is true
     or has_function_privilege('anon', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'EXECUTE') is true
     or has_function_privilege('authenticated', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'EXECUTE') is true
     or has_function_privilege('anon', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'EXECUTE') is true
     or has_function_privilege('authenticated', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'EXECUTE') is true then
    raise exception 'PROFILE_RPC_ACL_CUTOVER_FAILED';
  end if;

  if has_function_privilege('service_role', 'public.save_business_profile_secure_legacy(text,text,text,jsonb)', 'EXECUTE') is true
     or has_function_privilege('service_role', 'public.save_business_profile_secure_unlimited(text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('service_role', 'public.activate_license_on_device_unlimited(text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('service_role', 'public.admin_login_on_device(text,text,text,text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('service_role', 'public.admin_enroll_owner_on_device(text,text,text,text,text,text)', 'EXECUTE') is not true then
    raise exception 'PROFILE_R1_SERVICE_ROLE_ACL_PRESERVATION_FAILED';
  end if;

  select p.proconfig, pg_get_functiondef(p.oid)
  into v_profile_config, v_profile_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.save_business_profile_secure(text,text,text,text,jsonb)'::regprocedure;

  if not ('search_path=""' = any(coalesce(v_profile_config, array[]::text[])))
     or position('private.validate_pos_sync_context' in v_profile_definition) = 0
     or position('private.has_pos_permission' in v_profile_definition) = 0
     or position('save_business_profile_secure_unlimited' in v_profile_definition) = 0
     or position('''PROFILE''' in v_profile_definition) = 0
     or position('30, 600, 600' in regexp_replace(v_profile_definition, E'\\s+', ' ', 'g')) = 0 then
    raise exception 'PROFILE_RPC_DEFINITION_VERIFICATION_FAILED';
  end if;

  select pg_get_functiondef('public.activate_license_on_device_unlimited(text,text,text,jsonb)'::regprocedure),
         pg_get_functiondef('public.admin_login_on_device(text,text,text,text,text,jsonb)'::regprocedure),
         pg_get_functiondef('public.admin_enroll_owner_on_device(text,text,text,text,text,text)'::regprocedure)
  into v_activation_definition, v_admin_login_definition, v_admin_enroll_definition;

  if position('activate_license_on_device_legacy_free' in v_activation_definition) > 0
     or position('ADMIN_PLAN_REQUIRED' in v_admin_login_definition) > 0
     or position('ADMIN_PLAN_REQUIRED' in v_admin_enroll_definition) > 0 then
    raise exception 'FREE_TRIAL_ADMIN_ACTOR_CUTOVER_FAILED';
  end if;
end;
$verification$;

notify pgrst, 'reload schema';
