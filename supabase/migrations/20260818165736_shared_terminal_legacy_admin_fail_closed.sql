-- SHARED.TERMINAL.2 — close legacy device_role admin authority paths.
-- The canonical application already uses Admin-session overloads. Legacy
-- signatures are preserved but fail closed because they cannot prove an actor.

create or replace function private.admin_create_staff_user_impl(
  p_license_id uuid,
  p_creator_device_id uuid,
  p_username text,
  p_password text,
  p_display_name text,
  p_permissions jsonb,
  p_role_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_role_name text := coalesce(nullif(trim(p_role_name), ''), 'staff');
  v_permissions jsonb;
  v_staff_user record;
begin
  select
    l.id,
    l.status,
    l.expires_at,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;
  if v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;
  if coalesce((v_license.effective_features->>'staff_roles')::boolean, false) is false then
    return jsonb_build_object('success', false, 'code', 'FEATURE_NOT_AVAILABLE', 'message', 'La licencia no incluye usuarios staff.');
  end if;
  if v_username = '' or length(v_username) < 3 then
    return jsonb_build_object('success', false, 'code', 'USERNAME_INVALID', 'message', 'El usuario debe tener al menos 3 caracteres.');
  end if;
  if v_display_name is null then
    return jsonb_build_object('success', false, 'code', 'DISPLAY_NAME_REQUIRED', 'message', 'El nombre del staff es obligatorio.');
  end if;
  if p_password is null or length(p_password) < 6 then
    return jsonb_build_object('success', false, 'code', 'PASSWORD_TOO_SHORT', 'message', 'La contraseña debe tener al menos 6 caracteres.');
  end if;
  if v_role_name not in ('staff', 'cashier', 'waiter', 'supervisor', 'custom') then
    return jsonb_build_object('success', false, 'code', 'ROLE_INVALID', 'message', 'Rol interno no permitido.');
  end if;

  v_permissions := private.normalize_staff_permissions(p_permissions);

  insert into public.license_staff_users (
    license_id,
    username,
    display_name,
    password_hash,
    role_name,
    permissions,
    created_by_device_id
  ) values (
    v_license.id,
    v_username,
    v_display_name,
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
    v_role_name,
    v_permissions,
    p_creator_device_id
  )
  returning id, username, display_name, role_name, permissions, is_active, created_at
  into v_staff_user;

  return jsonb_build_object(
    'success', true,
    'message', 'Usuario staff creado correctamente.',
    'staff_user', jsonb_build_object(
      'id', v_staff_user.id,
      'username', v_staff_user.username,
      'display_name', v_staff_user.display_name,
      'role_name', v_staff_user.role_name,
      'permissions', v_staff_user.permissions,
      'is_active', v_staff_user.is_active,
      'created_at', v_staff_user.created_at
    )
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'code', 'USERNAME_ALREADY_EXISTS', 'message', 'Ya existe un usuario staff con ese nombre en esta licencia.');
end;
$function$;

create or replace function private.admin_list_staff_users_impl(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'username', s.username,
    'display_name', s.display_name,
    'role_name', s.role_name,
    'permissions', s.permissions,
    'is_active', s.is_active,
    'created_at', s.created_at,
    'updated_at', s.updated_at,
    'last_login_at', s.last_login_at
  ) order by s.created_at asc), '[]'::jsonb)
  into v_staff
  from public.license_staff_users s
  where s.license_id = p_license_id;

  return jsonb_build_object('success', true, 'data', v_staff);
end;
$function$;

create or replace function private.admin_update_staff_user_impl(
  p_license_id uuid,
  p_license_key text,
  p_staff_user_id uuid,
  p_display_name text,
  p_permissions jsonb,
  p_is_active boolean,
  p_new_password text,
  p_role_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing record;
  v_new_display_name text;
  v_new_role_name text;
  v_new_permissions jsonb;
  v_staff_user record;
  v_disabled_device record;
  v_disabled_devices_count integer := 0;
  v_revoked_sessions_count integer := 0;
begin
  select * into v_existing
  from public.license_staff_users
  where id = p_staff_user_id
    and license_id = p_license_id
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
      password_hash = case
        when p_new_password is null then password_hash
        else extensions.crypt(p_new_password, extensions.gen_salt('bf', 12))
      end
  where id = v_existing.id
  returning id, username, display_name, role_name, permissions, is_active, updated_at
  into v_staff_user;

  if p_is_active = false then
    update public.license_staff_sessions
    set revoked_at = coalesce(revoked_at, now())
    where staff_user_id = v_existing.id
      and revoked_at is null;
    get diagnostics v_revoked_sessions_count = row_count;

    -- A disabled Staff user must not disable a shared physical terminal.
    -- Only dedicated staff_only devices bound to that legacy staff link are disabled.
    for v_disabled_device in
      update public.license_devices d
      set is_active = false,
          last_check_at = now(),
          last_used_at = now()
      where d.license_id = p_license_id
        and d.staff_user_id = v_existing.id
        and d.device_mode = 'staff_only'
        and d.is_active = true
      returning d.id, d.device_fingerprint, d.device_name
    loop
      v_disabled_devices_count := v_disabled_devices_count + 1;
      insert into public.license_events (license_key, event_type, metadata)
      values (
        p_license_key,
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
$function$;

revoke all on function private.admin_create_staff_user_impl(uuid, uuid, text, text, text, jsonb, text) from public;
revoke all on function private.admin_list_staff_users_impl(uuid) from public;
revoke all on function private.admin_update_staff_user_impl(uuid, text, uuid, text, jsonb, boolean, text, text) from public;

-- Legacy signatures cannot prove the actor. Preserve their ABI but fail closed.
create or replace function public.admin_create_staff_user(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text,
  p_username text,
  p_password text,
  p_display_name text,
  p_permissions jsonb default null,
  p_role_name text default 'staff'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return jsonb_build_object(
    'success', false,
    'code', 'ADMIN_SESSION_REQUIRED',
    'message', 'Esta operación requiere una sesión Admin autenticada.'
  );
end;
$function$;

create or replace function public.admin_list_staff_users(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return jsonb_build_object(
    'success', false,
    'code', 'ADMIN_SESSION_REQUIRED',
    'message', 'Esta operación requiere una sesión Admin autenticada.'
  );
end;
$function$;

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
begin
  return jsonb_build_object(
    'success', false,
    'code', 'ADMIN_SESSION_REQUIRED',
    'message', 'Esta operación requiere una sesión Admin autenticada.'
  );
end;
$function$;

-- Canonical overloads prove a real Admin session and then call private
-- implementations directly; they no longer delegate to device-role wrappers.
create or replace function public.admin_create_staff_user(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text,
  p_username text,
  p_password text,
  p_display_name text,
  p_permissions jsonb,
  p_role_name text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(
    p_license_key,
    p_admin_device_fingerprint,
    p_admin_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  return private.admin_create_staff_user_impl(
    (v_auth->>'license_id')::uuid,
    (v_auth->>'device_id')::uuid,
    p_username,
    p_password,
    p_display_name,
    p_permissions,
    p_role_name
  );
end;
$function$;

create or replace function public.admin_list_staff_users(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(
    p_license_key,
    p_admin_device_fingerprint,
    p_admin_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  return private.admin_list_staff_users_impl((v_auth->>'license_id')::uuid);
end;
$function$;

create or replace function public.admin_update_staff_user(
  p_license_key text,
  p_admin_device_fingerprint text,
  p_admin_security_token text,
  p_staff_user_id uuid,
  p_display_name text,
  p_permissions jsonb,
  p_is_active boolean,
  p_new_password text,
  p_role_name text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(
    p_license_key,
    p_admin_device_fingerprint,
    p_admin_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  return private.admin_update_staff_user_impl(
    (v_auth->>'license_id')::uuid,
    p_license_key,
    p_staff_user_id,
    p_display_name,
    p_permissions,
    p_is_active,
    p_new_password,
    p_role_name
  );
end;
$function$;

-- This legacy release endpoint has no actor credential in its signature.
-- Keep the function addressable, but never mutate state through it.
create or replace function public.release_device_anon_unlimited(
  device_id_param uuid,
  license_key_param text,
  requester_fingerprint_param text
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return json_build_object(
    'success', false,
    'code', 'ADMIN_SESSION_REQUIRED',
    'message', 'Usa el flujo administrador autenticado para liberar dispositivos.'
  );
end;
$function$;

-- Migration-time assertions: no legacy mutation/admin wrapper may keep
-- device_role='admin' as authorization, while canonical overloads must prove
-- an Admin session.
do $$
declare
  v_source text;
begin
  select p.prosrc into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'release_device_anon_unlimited'
    and pg_get_function_identity_arguments(p.oid) = 'device_id_param uuid, license_key_param text, requester_fingerprint_param text';

  if position('ADMIN_SESSION_REQUIRED' in coalesce(v_source, '')) = 0 then
    raise exception 'LEGACY_RELEASE_NOT_FAIL_CLOSED';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_create_staff_user', 'admin_list_staff_users', 'admin_update_staff_user')
      and p.prosrc ilike '%device_role%admin%'
  ) then
    raise exception 'LEGACY_ADMIN_DEVICE_ROLE_AUTHORITY_REMAINS';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_create_staff_user'
      and pg_get_function_identity_arguments(p.oid) like '%p_admin_session_token text'
      and p.prosrc ilike '%require_active_admin_session%'
  ) then
    raise exception 'ADMIN_STAFF_CANONICAL_SESSION_GUARD_MISSING';
  end if;
end;
$$;
