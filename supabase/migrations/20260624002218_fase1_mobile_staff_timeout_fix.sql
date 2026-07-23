-- Fase 1 clientes: reducir timeouts en PWA/movil staff.
-- 1) Evitar que varias RPCs esperen locks al actualizar last_seen_at.
-- 2) Agregar indice especifico para validacion de sesiones staff en sync POS.

create index if not exists idx_license_staff_sessions_pos_sync_lookup
  on public.license_staff_sessions (license_id, device_id, staff_user_id)
  where revoked_at is null;

create or replace function private.touch_license_staff_session_seen(
  p_session_id uuid,
  p_min_interval interval default '30 seconds'::interval
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_session_id is null then
    return;
  end if;

  update public.license_staff_sessions ss
  set last_seen_at = now()
  where ss.id in (
    select locked_session.id
    from public.license_staff_sessions locked_session
    where locked_session.id = p_session_id
      and (
        locked_session.last_seen_at is null
        or locked_session.last_seen_at < now() - coalesce(p_min_interval, '30 seconds'::interval)
      )
    for update skip locked
  );
end;
$function$;

create or replace function private.validate_pos_sync_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb;
  v_staff_payload jsonb := null;
  v_staff_user_id uuid := null;
  v_staff_permissions jsonb := '{}'::jsonb;
begin
  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    raise exception 'LICENSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_license.status <> 'active' then
    raise exception 'LICENSE_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() then
    raise exception 'LICENSE_EXPIRED' using errcode = 'P0001';
  end if;

  select
    d.id,
    d.license_id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    coalesce(d.device_role, 'staff') as device_role,
    d.staff_user_id,
    d.realtime_topic
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    raise exception 'DEVICE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if v_device.is_active is not true then
    raise exception 'DEVICE_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  if v_device.security_token is null or p_security_token is null or p_security_token = '' then
    raise exception 'DEVICE_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    raise exception 'DEVICE_TOKEN_INVALID' using errcode = 'P0001';
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then
      raise exception 'STAFF_LOGIN_REQUIRED' using errcode = 'P0001';
    end if;

    if p_staff_session_token is null or p_staff_session_token = '' then
      raise exception 'STAFF_SESSION_REQUIRED' using errcode = 'P0001';
    end if;

    select
      ss.id as session_id,
      ss.expires_at,
      ss.revoked_at,
      s.id as staff_user_id,
      s.username,
      s.display_name,
      s.role_name,
      s.permissions,
      s.is_active as staff_is_active
    into v_session
    from public.license_staff_sessions ss
    join public.license_staff_users s on s.id = ss.staff_user_id
    where ss.license_id = v_license.id
      and ss.device_id = v_device.id
      and ss.staff_user_id = v_device.staff_user_id
      and ss.revoked_at is null
      and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    limit 1;

    if not found then
      raise exception 'STAFF_SESSION_INVALID' using errcode = 'P0001';
    end if;

    if v_session.expires_at < now() then
      raise exception 'STAFF_SESSION_EXPIRED' using errcode = 'P0001';
    end if;

    if v_session.staff_is_active is not true then
      raise exception 'STAFF_USER_INACTIVE' using errcode = 'P0001';
    end if;

    -- No bloquear RPCs concurrentes del movil staff solo para refrescar last_seen_at.
    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);

    v_staff_user_id := v_session.staff_user_id;
    v_staff_permissions := coalesce(v_session.permissions, '{}'::jsonb);
    v_staff_payload := jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', v_staff_permissions
    );
  end if;

  return jsonb_build_object(
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_role', v_device.device_role,
    'staff_user_id', v_staff_user_id,
    'staff_permissions', v_staff_permissions,
    'staff_user', v_staff_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_features, '{}'::jsonb),
    'realtime_topic', v_device.realtime_topic
  );
end;
$function$;

create or replace function public.verify_staff_session(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session record;
begin
  select
    ss.id as session_id,
    ss.expires_at,
    ss.revoked_at,
    s.id as staff_user_id,
    s.username,
    s.display_name,
    s.role_name,
    s.permissions,
    s.is_active as staff_is_active,
    d.id as device_id,
    d.is_active as device_is_active,
    l.id as license_id,
    l.status as license_status,
    l.expires_at as license_expires_at
  into v_session
  from public.license_staff_sessions ss
  join public.license_staff_users s on s.id = ss.staff_user_id
  join public.license_devices d on d.id = ss.device_id
  join public.licenses l on l.id = ss.license_id
  where l.license_key = p_license_key
    and d.device_fingerprint = p_device_fingerprint
    and ss.revoked_at is null
    and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  end if;

  if v_session.expires_at < now() then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_EXPIRED', 'message', 'Sesion staff expirada.');
  end if;

  if v_session.staff_is_active = false then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'STAFF_USER_INACTIVE', 'message', 'Usuario staff desactivado.');
  end if;

  if v_session.device_is_active = false then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo no permitido.');
  end if;

  if v_session.license_status <> 'active' or (v_session.license_expires_at is not null and v_session.license_expires_at < now()) then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'Licencia no activa.');
  end if;

  -- No bloquear verificaciones concurrentes solo por last_seen_at.
  perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);

  return jsonb_build_object(
    'success', true,
    'valid', true,
    'staff_user', jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', v_session.permissions
    ),
    'expires_at', v_session.expires_at
  );
end;
$function$;;
