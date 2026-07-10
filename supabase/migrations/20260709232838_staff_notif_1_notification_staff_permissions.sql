-- FASE STAFF.NOTIF.1 — Permisos staff para Centro de Notificaciones y Soporte
-- FASE NOTIF.DB.DRIFT.1 — Endurecimiento de revokes privados en instalación limpia.
-- No borra datos. No abre tablas a cliente. Mantiene contratos públicos existentes.

create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pos', true,
    'orders', true,
    'products', false,
    'customers', false,
    'reports', false,
    'settings', false,
    'devices', false,
    'license', false,
    'inventory', false,
    'cash_register', true,
    'discounts', false,
    'refunds', false,
    'ecommerce', false,
    'sync', false,
    'notifications', false,
    'support_center', false
  );
$$;

revoke all on function private.default_staff_permissions() from public;
revoke all on function private.default_staff_permissions() from anon;
revoke all on function private.default_staff_permissions() from authenticated;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync', 'notifications', 'support_center'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return v_result;
  end if;

  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function private.normalize_staff_permissions(jsonb) from public;
revoke all on function private.normalize_staff_permissions(jsonb) from anon;
revoke all on function private.normalize_staff_permissions(jsonb) from authenticated;

update public.license_staff_users
set permissions = private.normalize_staff_permissions(permissions)
where not (permissions ? 'notifications')
   or not (permissions ? 'support_center');

create or replace function private.staff_has_permission(
  p_staff_session_token text,
  p_license_id uuid,
  p_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_permission boolean := false;
begin
  if p_staff_session_token is null or btrim(p_staff_session_token) = '' then
    return true;
  end if;

  if p_license_id is null or p_permission is null or btrim(p_permission) = '' then
    return false;
  end if;

  select coalesce((s.permissions ->> p_permission)::boolean, false)
  into v_has_permission
  from public.license_staff_sessions ss
  join public.license_staff_users s on s.id = ss.staff_user_id
  where ss.license_id = p_license_id
    and ss.revoked_at is null
    and ss.expires_at >= now()
    and s.license_id = p_license_id
    and s.is_active is true
    and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
  limit 1;

  return coalesce(v_has_permission, false);
end;
$$;

revoke all on function private.staff_has_permission(text, uuid, text) from public;
revoke all on function private.staff_has_permission(text, uuid, text) from anon;
revoke all on function private.staff_has_permission(text, uuid, text) from authenticated;

create or replace function private.get_pos_notification_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_rpc_name text default 'pos_notifications'::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_features jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(p_rpc_name, ''), 'pos_notifications'),
    p_scope := 'POS_NOTIFICATIONS',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 120,
    p_code := 'POS_NOTIFICATIONS_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    raise exception 'POS_NOTIFICATIONS_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  v_features := coalesce(v_context->'features', '{}'::jsonb);

  if coalesce((v_features->>'notification_center')::boolean, false) is not true
     or coalesce((v_features->>'cloud_notifications')::boolean, false) is not true then
    raise exception 'NOTIFICATION_CENTER_DISABLED' using errcode = 'P0001';
  end if;

  if coalesce(v_context->>'device_role', 'staff') = 'staff'
     and coalesce((v_context->'staff_permissions'->>'notifications')::boolean, false) is not true then
    raise exception 'STAFF_NOTIFICATIONS_DISABLED' using errcode = 'P0001';
  end if;

  return v_context;
end;
$$;

revoke all on function private.get_pos_notification_context(text, text, text, text, text) from public;
revoke all on function private.get_pos_notification_context(text, text, text, text, text) from anon;
revoke all on function private.get_pos_notification_context(text, text, text, text, text) from authenticated;

create or replace function private.get_support_ticket_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_rpc_name text default 'support_tickets'::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb;
  v_staff_user_id uuid := null;
  v_staff_permissions jsonb := '{}'::jsonb;
  v_staff_payload jsonb := null;
  v_grace_days integer := 7;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    p_rpc_name,
    'support',
    90,
    60,
    120,
    'SUPPORT_RPC_RATE_LIMITED',
    jsonb_build_object('phase', 'STAFF.NOTIF.1')
  );

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
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status <> 'active' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() - (v_grace_days || ' days')::interval then
    return jsonb_build_object('success', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia expiro.');
  end if;

  select
    d.id,
    d.license_id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    coalesce(d.device_role, 'staff') as device_role,
    d.staff_user_id
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;

  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;

  if v_device.security_token is null or p_security_token is null or p_security_token = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;

  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if (v_features->>'support_center') is distinct from 'true'
     or (v_features->>'support_tickets') is distinct from 'true'
     or coalesce(v_features->>'support_channel', 'email') <> 'in_app' then
    return jsonb_build_object('success', false, 'code', 'SUPPORT_CENTER_DISABLED', 'message', 'Este plan no incluye soporte interno.');
  end if;

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then
      return jsonb_build_object('success', false, 'code', 'STAFF_LOGIN_REQUIRED', 'message', 'Este dispositivo requiere login staff.');
    end if;

    if p_staff_session_token is null or p_staff_session_token = '' then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Falta sesion staff.');
    end if;

    select
      ss.id as session_id,
      ss.expires_at,
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
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesion staff invalida.');
    end if;

    if v_session.expires_at < now() then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_EXPIRED', 'message', 'Sesion staff expirada.');
    end if;

    if v_session.staff_is_active is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_USER_INACTIVE', 'message', 'Usuario staff inactivo.');
    end if;

    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);

    v_staff_user_id := v_session.staff_user_id;
    v_staff_permissions := coalesce(v_session.permissions, '{}'::jsonb);

    if coalesce((v_staff_permissions->>'support_center')::boolean, false) is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_SUPPORT_DISABLED', 'message', 'Tu usuario staff no tiene acceso a soporte Lanzo.');
    end if;

    v_staff_payload := jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', v_staff_permissions
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_fingerprint', v_device.device_fingerprint,
    'device_role', v_device.device_role,
    'staff_user_id', v_staff_user_id,
    'staff_permissions', v_staff_permissions,
    'staff_user', v_staff_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_features, '{}'::jsonb)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(nullif(sqlerrm, ''), 'SUPPORT_CONTEXT_ERROR'),
      'message', 'No se pudo validar el contexto seguro de soporte.'
    );
end;
$$;

revoke all on function private.get_support_ticket_context(text, text, text, text, text) from public;
revoke all on function private.get_support_ticket_context(text, text, text, text, text) from anon;
revoke all on function private.get_support_ticket_context(text, text, text, text, text) from authenticated;

create or replace function public.refresh_operational_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb;
  v_generation jsonb;
  v_sync_generation jsonb;
  v_cash_generation jsonb;
  v_staff_generation jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    'refresh_operational_notifications',
    'notifications',
    60,
    60,
    120,
    'OPERATIONAL_NOTIFICATIONS_RATE_LIMITED',
    jsonb_build_object('phase', 'STAFF.NOTIF.1')
  );

  if p_license_key is null or btrim(p_license_key) = '' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED', 'message', 'Falta licencia.');
  end if;

  if p_device_fingerprint is null or btrim(p_device_fingerprint) = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED', 'message', 'Falta identificador del dispositivo.');
  end if;

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
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if coalesce(v_license.status, '') not in ('active', 'expired', 'grace', 'blocked') then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  select
    d.id,
    d.license_id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    coalesce(d.device_role, 'staff') as device_role,
    d.staff_user_id
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;

  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;

  if v_device.security_token is null or p_security_token is null or p_security_token = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;

  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true' then
    return jsonb_build_object(
      'success', false,
      'code', 'CLOUD_NOTIFICATIONS_DISABLED',
      'message', 'Este plan no incluye notificaciones cloud.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then
      return jsonb_build_object('success', false, 'code', 'STAFF_LOGIN_REQUIRED', 'message', 'Este dispositivo requiere login staff.');
    end if;

    if p_staff_session_token is null or p_staff_session_token = '' then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Falta sesion staff.');
    end if;

    select
      ss.id as session_id,
      ss.expires_at,
      s.id as staff_user_id,
      s.is_active as staff_is_active,
      s.permissions
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
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesion staff invalida.');
    end if;

    if v_session.expires_at < now() then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_EXPIRED', 'message', 'Sesion staff expirada.');
    end if;

    if v_session.staff_is_active is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_USER_INACTIVE', 'message', 'Usuario staff inactivo.');
    end if;

    if coalesce((v_session.permissions->>'notifications')::boolean, false) is not true then
      return jsonb_build_object(
        'success', false,
        'code', 'STAFF_NOTIFICATIONS_DISABLED',
        'message', 'Tu usuario staff no tiene acceso al Centro de Notificaciones.',
        'generated', 0,
        'events', '[]'::jsonb
      );
    end if;

    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);
  end if;

  v_generation := private.generate_license_operational_notifications(v_license.id);
  if v_generation->>'success' = 'false' then return v_generation; end if;
  v_generated := v_generated + coalesce((v_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_generation->'events', '[]'::jsonb);

  v_sync_generation := private.generate_sync_operational_notifications(v_license.id);
  if v_sync_generation->>'success' = 'false' then return v_sync_generation; end if;
  v_generated := v_generated + coalesce((v_sync_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_sync_generation->'events', '[]'::jsonb);

  v_cash_generation := private.generate_cash_operational_notifications(v_license.id);
  if v_cash_generation->>'success' = 'false' then return v_cash_generation; end if;
  v_generated := v_generated + coalesce((v_cash_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_cash_generation->'events', '[]'::jsonb);

  v_staff_generation := private.generate_staff_operational_notifications(v_license.id);
  if v_staff_generation->>'success' = 'false' then return v_staff_generation; end if;
  v_generated := v_generated + coalesce((v_staff_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_staff_generation->'events', '[]'::jsonb);

  return jsonb_build_object(
    'success', true,
    'generated', v_generated,
    'events', v_events
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        else 'REFRESH_OPERATIONAL_NOTIFICATIONS_ERROR'
      end,
      'message', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        else 'No se pudieron refrescar las notificaciones operativas.'
      end,
      'generated', 0,
      'events', '[]'::jsonb
    );
end;
$$;

revoke all on function public.refresh_operational_notifications(text, text, text, text) from public;
grant execute on function public.refresh_operational_notifications(text, text, text, text) to anon, authenticated;
