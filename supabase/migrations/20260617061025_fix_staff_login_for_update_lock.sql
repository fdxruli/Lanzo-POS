create or replace function public.staff_login_on_device(
  p_license_key text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_info jsonb,
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_staff_user record;
  v_device record;
  v_active_device_count integer;
  v_device_security_token text;
  v_session_token text;
  v_session_hash text;
  v_realtime_topic text;
  v_session_id uuid;
begin
  select
    l.id,
    l.status,
    l.expires_at,
    l.license_key,
    l.product_name,
    coalesce(l.max_devices, p.max_devices, 1) as max_devices,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  if coalesce((v_license.effective_features->>'staff_roles')::boolean, false) = false then
    return jsonb_build_object('success', false, 'code', 'FEATURE_NOT_AVAILABLE', 'message', 'La licencia no incluye usuarios staff.');
  end if;

  select s.* into v_staff_user
  from public.license_staff_users s
  where s.license_id = v_license.id
    and lower(s.username) = lower(trim(coalesce(p_username, '')))
    and s.is_active = true
  limit 1;

  if v_staff_user.id is null or extensions.crypt(coalesce(p_password, ''), v_staff_user.password_hash) <> v_staff_user.password_hash then
    return jsonb_build_object('success', false, 'code', 'INVALID_STAFF_CREDENTIALS', 'message', 'Usuario o contraseña incorrectos.');
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is not null and v_device.device_role = 'admin' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_DEVICE_USE_ADMIN_FLOW', 'message', 'Este equipo es administrador. Usa el acceso principal.');
  end if;

  select count(*) into v_active_device_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active = true
    and (v_device.id is null or d.id <> v_device.id);

  if (v_active_device_count + 1) > v_license.max_devices then
    return jsonb_build_object('success', false, 'code', 'DEVICE_LIMIT_REACHED', 'message', 'Limite de dispositivos alcanzado para esta licencia.');
  end if;

  v_device_security_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_hash := extensions.crypt(v_session_token, extensions.gen_salt('bf', 12));

  if v_device.id is null then
    v_realtime_topic := private.generate_license_realtime_topic();

    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      previous_security_token,
      realtime_topic,
      last_check_at,
      last_used_at,
      device_role,
      staff_user_id
    ) values (
      v_license.id,
      p_device_fingerprint,
      p_device_name,
      coalesce(p_device_info, '{}'::jsonb),
      true,
      v_device_security_token,
      null,
      v_realtime_topic,
      now(),
      now(),
      'staff',
      v_staff_user.id
    ) returning * into v_device;
  else
    update public.license_devices
    set device_name = p_device_name,
        device_info = coalesce(p_device_info, '{}'::jsonb),
        is_active = true,
        security_token = v_device_security_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_check_at = now(),
        last_used_at = now(),
        device_role = 'staff',
        staff_user_id = v_staff_user.id
    where id = v_device.id
    returning * into v_device;

    v_realtime_topic := v_device.realtime_topic;
  end if;

  insert into public.license_staff_sessions (
    license_id,
    staff_user_id,
    device_id,
    session_token_hash,
    metadata
  ) values (
    v_license.id,
    v_staff_user.id,
    v_device.id,
    v_session_hash,
    jsonb_build_object('device_name', p_device_name)
  ) returning id into v_session_id;

  update public.license_staff_users
  set last_login_at = now()
  where id = v_staff_user.id;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (
    v_license.id,
    p_device_fingerprint,
    'STAFF_LOGIN',
    jsonb_build_object('staff_user_id', v_staff_user.id, 'username', v_staff_user.username)
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Sesion staff iniciada correctamente.',
    'device_security_token', v_device_security_token,
    'staff_session_token', v_session_token,
    'staff_session_id', v_session_id,
    'device_role', 'staff',
    'staff_user', jsonb_build_object(
      'id', v_staff_user.id,
      'username', v_staff_user.username,
      'display_name', v_staff_user.display_name,
      'role_name', v_staff_user.role_name,
      'permissions', v_staff_user.permissions
    ),
    'details', jsonb_build_object(
      'valid', true,
      'license_key', v_license.license_key,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features,
      'device_name', v_device.device_name,
      'device_role', 'staff',
      'staff_user', jsonb_build_object(
        'id', v_staff_user.id,
        'username', v_staff_user.username,
        'display_name', v_staff_user.display_name,
        'role_name', v_staff_user.role_name,
        'permissions', v_staff_user.permissions
      ),
      'expires_at', v_license.expires_at,
      'realtime_topic', case
        when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_device.realtime_topic
        else null
      end
    )
  );
end;
$function$;;
