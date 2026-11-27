create or replace function public.admin_recover_staff_only_device(
  p_license_key text,
  p_username text,
  p_password text,
  p_device_fingerprint text,
  p_device_security_token text
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
  v_revoked_staff integer := 0;
  v_previous_device_role text;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_username, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_device_security_token, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_RECOVERY_INVALID_REQUEST');
  end if;

  -- Share the existing Admin login buckets so this endpoint cannot bypass
  -- the owner or device limits by switching RPCs.
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-user:' || encode(extensions.digest(lower(btrim(p_username)), 'sha256'), 'hex'),
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
    'admin-device:' || btrim(p_device_fingerprint),
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
  if v_license.status is distinct from 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;
  if lower(coalesce(v_license.plan_code, '')) = 'free_trial' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_PLAN_REQUIRED');
  end if;

  select u.* into v_admin
  from public.license_admin_users u
  where u.license_id = v_license.id
    and u.username = lower(btrim(coalesce(p_username, '')))
    and u.is_owner is true
    and u.is_active is true
  limit 1
  for update;

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

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED');
  end if;
  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE');
  end if;
  if v_device.device_mode is not distinct from 'admin_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_MODE_ALREADY_ADMIN_ONLY',
      'message', 'El dispositivo ya está en Solo Admin. Inicia sesión como propietario.'
    );
  end if;
  if v_device.device_mode is distinct from 'staff_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_MODE_RECOVERY_NOT_AVAILABLE',
      'message', 'La recuperación sólo está disponible cuando el dispositivo está en Solo Staff.'
    );
  end if;
  if v_device.security_token is null
     or (p_device_security_token <> v_device.security_token
         and (v_device.previous_security_token is null
              or p_device_security_token <> v_device.previous_security_token)) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID');
  end if;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true
    and d.id <> v_device.id;

  if v_active_count + 1 > v_license.max_devices then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_LIMIT_REACHED',
      'message', 'Limite de dispositivos alcanzado para esta licencia.'
    );
  end if;

  -- All authorization checks precede the first business-state write. Any
  -- subsequent error aborts this SQL statement and rolls the transition back.
  v_previous_device_role := v_device.device_role;
  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.license_devices
  set device_mode = 'admin_only',
      device_role = 'admin',
      staff_user_id = null,
      security_token = v_device_token,
      previous_security_token = null,
      last_check_at = now(),
      last_used_at = now()
  where id = v_device.id
  returning * into v_device;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('revoked_reason', 'OWNER_DEVICE_RECOVERY')
  where device_id = v_device.id
    and revoked_at is null;
  get diagnostics v_revoked_staff = row_count;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update public.license_admin_users
  set updated_at = now()
  where id = v_admin.id;

  select not exists (
    select 1 from public.business_profiles bp
    where bp.license_id = v_license.id
      and nullif(btrim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'DEVICE_MODE_CHANGED',
    jsonb_build_object(
      'requester_admin_user_id', v_admin.id,
      'requester_device_id', v_device.id,
      'target_device_id', v_device.id,
      'previous_mode', 'staff_only',
      'previous_device_role', v_previous_device_role,
      'device_mode', 'admin_only',
      'legacy_device_role', v_device.device_role,
      'revoked_staff_sessions', v_revoked_staff,
      'change_source', 'OWNER_DEVICE_RECOVERY',
      'changed_at', now()
    )
  );

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'ADMIN_LOGIN',
    jsonb_build_object(
      'admin_user_id', v_admin.id,
      'device_id', v_device.id,
      'device_mode', v_device.device_mode,
      'login_source', 'OWNER_DEVICE_RECOVERY',
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

revoke all on function public.admin_recover_staff_only_device(text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_recover_staff_only_device(text, text, text, text, text)
  to anon, authenticated, service_role;
comment on function public.admin_recover_staff_only_device(text, text, text, text, text)
  is 'Atomically authenticates the owner, changes this licensed staff_only device to admin_only, revokes its Staff sessions, rotates its device token, and issues an Admin session.';

notify pgrst, 'reload schema';
