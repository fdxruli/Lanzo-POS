-- =========================================================
-- Reglas staff robustas:
-- 1) Un staff solo puede tener un dispositivo staff activo.
-- 2) Desactivar staff revoca sesiones, desactiva sus dispositivos y emite eventos.
-- =========================================================

-- Limpieza inicial: cualquier dispositivo staff activo ligado a un usuario staff inactivo se desactiva.
with disabled_devices as (
  update public.license_devices d
  set is_active = false,
      last_check_at = now(),
      last_used_at = now()
  from public.license_staff_users s
  where d.staff_user_id = s.id
    and d.license_id = s.license_id
    and d.device_role = 'staff'
    and d.is_active = true
    and s.is_active = false
  returning
    d.id as device_id,
    d.license_id,
    d.device_fingerprint,
    d.device_name,
    d.staff_user_id,
    s.username,
    s.display_name
)
insert into public.license_events (license_key, event_type, metadata)
select
  l.license_key,
  'DEVICE_BANNED',
  jsonb_build_object(
    'source', 'staff_inactive_cleanup',
    'reason', 'STAFF_USER_DISABLED',
    'staff_user_id', dd.staff_user_id,
    'username', dd.username,
    'display_name', dd.display_name,
    'device_id', dd.device_id,
    'device_name', dd.device_name,
    'target_fingerprint', dd.device_fingerprint
  )
from disabled_devices dd
join public.licenses l on l.id = dd.license_id;

-- Índice único parcial: un staff activo no puede quedar ligado a más de un dispositivo staff activo.
create unique index if not exists uq_license_devices_one_active_device_per_staff
  on public.license_devices (staff_user_id)
  where is_active = true
    and device_role = 'staff'
    and staff_user_id is not null;

-- Login staff: bloquear si el staff ya está activo en otro dispositivo.
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
  v_existing_staff_device record;
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

  -- Regla estricta: un staff solo puede estar activo en un dispositivo staff.
  select d.id, d.device_name, d.last_used_at, d.activated_at
  into v_existing_staff_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.staff_user_id = v_staff_user.id
    and d.device_role = 'staff'
    and d.is_active = true
    and d.device_fingerprint <> p_device_fingerprint
  order by d.last_used_at desc nulls last, d.activated_at desc nulls last
  limit 1;

  if v_existing_staff_device.id is not null then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_ALREADY_IN_USE',
      'message', 'Este usuario staff ya esta activo en otro dispositivo.',
      'active_device_name', v_existing_staff_device.device_name,
      'active_device_last_used_at', v_existing_staff_device.last_used_at,
      'active_device_activated_at', v_existing_staff_device.activated_at
    );
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

  -- Al iniciar sesión en un equipo, revocar sesiones previas de ese mismo dispositivo.
  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now())
  where device_id = v_device.id
    and revoked_at is null;

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
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_ALREADY_IN_USE',
      'message', 'Este usuario staff ya esta activo en otro dispositivo.'
    );
end;
$function$;

-- Desactivar staff: revocar sesiones, desactivar dispositivos staff ligados y emitir eventos por dispositivo.
create or replace function public.admin_update_staff_user(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text,
  p_staff_user_id uuid,
  p_display_name text default null,
  p_permissions jsonb default null,
  p_is_active boolean default null,
  p_new_password text default null,
  p_role_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_license_key text;
  v_admin_device_id uuid;
  v_existing record;
  v_new_display_name text;
  v_new_role_name text;
  v_new_permissions jsonb;
  v_staff_user record;
  v_disabled_device record;
  v_disabled_devices_count integer := 0;
  v_revoked_sessions_count integer := 0;
begin
  select l.id, l.license_key into v_license_id, v_license_key
  from public.licenses l
  where l.license_key = p_license_key
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at >= now());

  if v_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'Licencia no encontrada o inactiva.');
  end if;

  select d.id into v_admin_device_id
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = p_admin_device_fingerprint
    and d.is_active = true
    and d.device_role = 'admin'
    and (d.security_token = p_admin_security_token or d.previous_security_token = p_admin_security_token)
  limit 1;

  if v_admin_device_id is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_DEVICE_REQUIRED', 'message', 'Solo el dispositivo administrador puede modificar usuarios staff.');
  end if;

  select * into v_existing
  from public.license_staff_users
  where id = p_staff_user_id
    and license_id = v_license_id
  for update;

  if v_existing.id is null then
    return jsonb_build_object('success', false, 'code', 'STAFF_USER_NOT_FOUND', 'message', 'Usuario staff no encontrado.');
  end if;

  if p_new_password is not null and length(p_new_password) < 6 then
    return jsonb_build_object('success', false, 'code', 'PASSWORD_TOO_SHORT', 'message', 'La nueva contraseña debe tener al menos 6 caracteres.');
  end if;

  v_new_display_name := coalesce(nullif(trim(p_display_name), ''), v_existing.display_name);
  v_new_role_name := coalesce(nullif(trim(p_role_name), ''), v_existing.role_name);

  if v_new_role_name not in ('staff', 'cashier', 'waiter', 'supervisor', 'custom') then
    return jsonb_build_object('success', false, 'code', 'ROLE_INVALID', 'message', 'Rol interno no permitido.');
  end if;

  v_new_permissions := case
    when p_permissions is null then v_existing.permissions
    else private.normalize_staff_permissions(p_permissions)
  end;

  update public.license_staff_users
  set display_name = v_new_display_name,
      role_name = v_new_role_name,
      permissions = v_new_permissions,
      is_active = coalesce(p_is_active, is_active),
      password_hash = case when p_new_password is null then password_hash else extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)) end
  where id = v_existing.id
  returning id, username, display_name, role_name, permissions, is_active, updated_at into v_staff_user;

  if p_is_active = false then
    update public.license_staff_sessions
    set revoked_at = coalesce(revoked_at, now())
    where staff_user_id = v_existing.id
      and revoked_at is null;
    get diagnostics v_revoked_sessions_count = row_count;

    for v_disabled_device in
      update public.license_devices d
      set is_active = false,
          last_check_at = now(),
          last_used_at = now()
      where d.license_id = v_license_id
        and d.staff_user_id = v_existing.id
        and d.device_role = 'staff'
        and d.is_active = true
      returning d.id, d.device_fingerprint, d.device_name
    loop
      v_disabled_devices_count := v_disabled_devices_count + 1;

      insert into public.license_events (license_key, event_type, metadata)
      values (
        v_license_key,
        'DEVICE_BANNED',
        jsonb_build_object(
          'source', 'admin_update_staff_user',
          'reason', 'STAFF_USER_DISABLED',
          'staff_user_id', v_existing.id,
          'username', v_staff_user.username,
          'display_name', v_staff_user.display_name,
          'device_id', v_disabled_device.id,
          'device_name', v_disabled_device.device_name,
          'target_fingerprint', v_disabled_device.device_fingerprint
        )
      );
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Usuario staff actualizado correctamente.',
    'revoked_sessions_count', v_revoked_sessions_count,
    'disabled_devices_count', v_disabled_devices_count,
    'staff_user', jsonb_build_object(
      'id', v_staff_user.id,
      'username', v_staff_user.username,
      'display_name', v_staff_user.display_name,
      'role_name', v_staff_user.role_name,
      'permissions', v_staff_user.permissions,
      'is_active', v_staff_user.is_active,
      'updated_at', v_staff_user.updated_at
    )
  );
end;
$function$;;
