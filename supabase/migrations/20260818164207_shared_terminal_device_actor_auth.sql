-- SHARED.TERMINAL.2 — shared device + actor authentication cutover
-- Conservative compatibility: existing device_role values map to non-shared modes.
-- No existing device is promoted to shared automatically.

alter table public.license_devices
  add column if not exists device_mode text;

update public.license_devices
set device_mode = case device_role
  when 'admin' then 'admin_only'
  when 'staff' then 'staff_only'
  else null
end
where device_mode is null;

do $$
begin
  if exists (
    select 1
    from public.license_devices
    where device_mode is null
  ) then
    raise exception 'DEVICE_MODE_BACKFILL_INCOMPLETE';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.license_devices'::regclass
      and conname = 'license_devices_device_mode_check'
  ) then
    alter table public.license_devices
      add constraint license_devices_device_mode_check
      check (device_mode in ('shared', 'admin_only', 'staff_only')) not valid;
  end if;
end;
$$;

alter table public.license_devices
  validate constraint license_devices_device_mode_check;

-- Legacy writers are allowed to omit device_mode, but the compatibility
-- boundary can only map to a conservative non-shared capability.
create or replace function private.ensure_license_device_mode()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.device_mode is null then
    new.device_mode := case new.device_role
      when 'admin' then 'admin_only'
      when 'staff' then 'staff_only'
      else null
    end;
  end if;

  if new.device_mode not in ('shared', 'admin_only', 'staff_only') then
    raise exception 'DEVICE_MODE_INVALID' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger if exists license_devices_ensure_device_mode on public.license_devices;
create trigger license_devices_ensure_device_mode
before insert or update of device_mode, device_role
on public.license_devices
for each row
execute function private.ensure_license_device_mode();

alter table public.license_devices
  alter column device_mode set not null;

create index if not exists idx_license_devices_mode_by_license
  on public.license_devices (license_id, device_mode)
  where is_active is true;

-- Canonical actor type resolver for downstream permission/cash helpers.
-- For shared devices there is deliberately no device_role fallback.
create or replace function private.resolve_pos_actor_type(p_context jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := nullif(p_context->>'actor_type', '');
  v_device_mode text := nullif(p_context->>'device_mode', '');
  v_legacy_role text := nullif(p_context->>'device_role', '');
begin
  if v_actor_type in ('admin', 'staff') then
    return v_actor_type;
  end if;

  if v_device_mode = 'shared' then
    raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
  end if;

  -- Compatibility for contexts produced before SHARED.TERMINAL.2 only.
  if v_legacy_role in ('admin', 'staff') then
    return v_legacy_role;
  end if;

  raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
end;
$function$;

-- Admin authority now means: valid device capability + device token + real
-- Admin session. It no longer depends on legacy device_role/staff_user_id.
create or replace function private.require_active_admin_session(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_session record;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_device_security_token, '')), '') is null
     or nullif(btrim(coalesce(p_admin_session_token, '')), '') is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_REQUIRED');
  end if;

  select l.id as license_id, l.status, l.expires_at, l.license_key
  into v_license
  from public.licenses l
  where l.license_key = p_license_key
  limit 1;

  if v_license.license_id is null
     or v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  select
    d.id as device_id,
    d.device_mode,
    d.device_role as legacy_device_role
  into v_device
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared')
    and (d.security_token = p_device_security_token or d.previous_security_token = p_device_security_token)
  limit 1;

  if v_device.device_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_DEVICE_REQUIRED');
  end if;

  select candidate.id as session_id,
         candidate.admin_user_id,
         candidate.expires_at,
         u.username,
         u.display_name
  into v_session
  from (
    select s.id, s.admin_user_id, s.session_token_hash, s.expires_at, s.created_at
    from public.license_admin_sessions s
    where s.license_id = v_license.license_id
      and s.device_id = v_device.device_id
      and s.revoked_at is null
    order by s.created_at desc
    limit 3
  ) candidate
  join public.license_admin_users u on u.id = candidate.admin_user_id
  where u.license_id = v_license.license_id
    and u.is_owner is true
    and u.is_active is true
    and extensions.crypt(p_admin_session_token, candidate.session_token_hash) = candidate.session_token_hash
  limit 1;

  if v_session.session_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_INVALID');
  end if;

  if v_session.expires_at <= now() then
    update public.license_admin_sessions
    set revoked_at = coalesce(revoked_at, now())
    where id = v_session.session_id;
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_EXPIRED');
  end if;

  update public.license_admin_sessions
  set last_used_at = now()
  where id = v_session.session_id
    and last_used_at < now() - interval '30 seconds';

  return jsonb_build_object(
    'success', true,
    'valid', true,
    'license_id', v_license.license_id,
    'device_id', v_device.device_id,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.legacy_device_role,
    'admin_session_id', v_session.session_id,
    'admin_user_id', v_session.admin_user_id,
    'admin_user', jsonb_build_object(
      'id', v_session.admin_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'is_owner', true
    ),
    'expires_at', v_session.expires_at
  );
end;
$function$;

-- Canonical backend context: device authority and actor authority are resolved
-- independently. The historical p_staff_session_token remains the external
-- actor-token parameter for RPC compatibility.
create or replace function private.validate_pos_sync_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_features jsonb;
  v_actor_token text := nullif(btrim(coalesce(p_staff_session_token, '')), '');
  v_admin_auth jsonb := null;
  v_admin_valid boolean := false;
  v_staff_session record;
  v_staff_valid boolean := false;
  v_actor_type text;
  v_actor_id uuid;
  v_actor_session_id uuid;
  v_actor_permissions jsonb := '{}'::jsonb;
  v_staff_payload jsonb := null;
  v_admin_payload jsonb := null;
begin
  select l.id, l.license_key, l.status, l.expires_at,
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
    d.device_mode,
    d.device_role as legacy_device_role,
    d.staff_user_id as legacy_staff_user_id,
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
  if v_device.security_token is null or nullif(p_security_token, '') is null then
    raise exception 'DEVICE_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    raise exception 'DEVICE_TOKEN_INVALID' using errcode = 'P0001';
  end if;

  if v_actor_token is null then
    raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb)
                || coalesce(v_license.license_features, '{}'::jsonb);

  if v_device.device_mode in ('admin_only', 'shared') then
    v_admin_auth := private.require_active_admin_session(
      p_license_key,
      p_device_fingerprint,
      p_security_token,
      v_actor_token
    );
    v_admin_valid := coalesce((v_admin_auth->>'success')::boolean, false);
  end if;

  if v_device.device_mode in ('staff_only', 'shared') then
    select
      ss.id as session_id,
      ss.expires_at,
      s.id as staff_user_id,
      s.username,
      s.display_name,
      s.role_name,
      s.permissions,
      s.is_active as staff_is_active
    into v_staff_session
    from public.license_staff_sessions ss
    join public.license_staff_users s on s.id = ss.staff_user_id
    where ss.license_id = v_license.id
      and ss.device_id = v_device.id
      and s.license_id = v_license.id
      and ss.revoked_at is null
      and extensions.crypt(v_actor_token, ss.session_token_hash) = ss.session_token_hash
    order by ss.created_at desc
    limit 1;

    if v_staff_session.session_id is not null then
      if v_staff_session.expires_at <= now() then
        update public.license_staff_sessions
        set revoked_at = coalesce(revoked_at, now())
        where id = v_staff_session.session_id;
        raise exception 'STAFF_SESSION_EXPIRED' using errcode = 'P0001';
      end if;
      if v_staff_session.staff_is_active is not true then
        raise exception 'STAFF_USER_INACTIVE' using errcode = 'P0001';
      end if;
      v_staff_valid := true;
    end if;
  end if;

  if v_admin_valid and v_staff_valid then
    raise exception 'ACTOR_SESSION_AMBIGUOUS' using errcode = 'P0001';
  end if;

  if not v_admin_valid and not v_staff_valid then
    raise exception 'ACTOR_SESSION_INVALID' using errcode = 'P0001';
  end if;

  if v_admin_valid then
    v_actor_type := 'admin';
    v_actor_id := (v_admin_auth->>'admin_user_id')::uuid;
    v_actor_session_id := (v_admin_auth->>'admin_session_id')::uuid;
    v_actor_permissions := jsonb_build_object('*', true);
    v_admin_payload := v_admin_auth->'admin_user';
  else
    v_actor_type := 'staff';
    v_actor_id := v_staff_session.staff_user_id;
    v_actor_session_id := v_staff_session.session_id;
    v_actor_permissions := coalesce(v_staff_session.permissions, '{}'::jsonb);
    v_staff_payload := jsonb_build_object(
      'id', v_staff_session.staff_user_id,
      'username', v_staff_session.username,
      'display_name', v_staff_session.display_name,
      'role_name', v_staff_session.role_name,
      'permissions', v_actor_permissions
    );
    perform private.touch_license_staff_session_seen(v_staff_session.session_id, '30 seconds'::interval);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.legacy_device_role,
    'actor_type', v_actor_type,
    'actor_id', v_actor_id,
    'actor_key', v_actor_type || ':' || v_actor_id::text,
    'actor_session_id', v_actor_session_id,
    'actor_permissions', v_actor_permissions,
    'device_role', v_actor_type,
    'staff_user_id', case when v_actor_type = 'staff' then v_actor_id else null end,
    'staff_permissions', case when v_actor_type = 'staff' then v_actor_permissions else '{}'::jsonb end,
    'staff_user', v_staff_payload,
    'admin_user_id', case when v_actor_type = 'admin' then v_actor_id else null end,
    'admin_session_id', case when v_actor_type = 'admin' then v_actor_session_id else null end,
    'admin_user', v_admin_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_features, '{}'::jsonb),
    'realtime_topic', v_device.realtime_topic
  ));
end;
$function$;

create or replace function private.assert_pos_permission(p_context jsonb, p_permission text)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_permissions jsonb := coalesce(p_context->'actor_permissions', p_context->'staff_permissions', '{}'::jsonb);
begin
  if v_actor_type = 'admin' then
    return;
  end if;

  if v_actor_type = 'staff'
     and coalesce((v_permissions->>p_permission)::boolean, false) is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:%', p_permission using errcode = 'P0001';
end;
$function$;

create or replace function private.has_pos_permission(p_context jsonb, p_permission text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_permissions jsonb := coalesce(p_context->'actor_permissions', p_context->'staff_permissions', '{}'::jsonb);
begin
  if v_actor_type = 'admin' then
    return true;
  end if;
  return v_actor_type = 'staff'
    and coalesce((v_permissions->>p_permission)::boolean, false) is true;
end;
$function$;

create or replace function private.assert_cash_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_permissions jsonb := coalesce(p_context->'actor_permissions', p_context->'staff_permissions', '{}'::jsonb);
begin
  if v_actor_type = 'admin' then
    return;
  end if;

  if v_actor_type = 'staff'
     and (
       coalesce((v_permissions->>'cash_register')::boolean, false) is true
       or coalesce((v_permissions->>'caja')::boolean, false) is true
     ) then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:cash_register' using errcode = 'P0001';
end;
$function$;

create or replace function private.reports_is_admin(p_context jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
begin
  return private.resolve_pos_actor_type(p_context) = 'admin';
end;
$function$;

create or replace function private.resolve_cash_actor_key(p_context jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_actor_id uuid := nullif(p_context->>'actor_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_admin_user_id uuid := nullif(p_context->>'admin_user_id', '')::uuid;
begin
  if v_actor_type = 'staff' then
    v_actor_id := coalesce(v_actor_id, v_staff_user_id);
    if v_actor_id is null then
      raise exception 'STAFF_USER_REQUIRED_FOR_CASH' using errcode = 'P0001';
    end if;
    return 'staff:' || v_actor_id::text;
  end if;

  v_actor_id := coalesce(v_actor_id, v_admin_user_id);
  if v_actor_id is null then
    raise exception 'ADMIN_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
  return 'admin:' || v_actor_id::text;
end;
$function$;

create or replace function private.resolve_cash_actor_name(p_context jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_name text;
begin
  if v_actor_type = 'staff' then
    v_name := nullif(btrim(coalesce(
      p_context->'staff_user'->>'display_name',
      p_context->'staff_user'->>'username',
      'Staff'
    )), '');
    return coalesce(v_name, 'Staff');
  end if;

  v_name := nullif(btrim(coalesce(
    p_context->'admin_user'->>'display_name',
    p_context->'admin_user'->>'username',
    'Administrador'
  )), '');
  return coalesce(v_name, 'Administrador');
end;
$function$;

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
    p_license_key, 'admin-device:' || coalesce(nullif(btrim(p_device_fingerprint), ''), '__missing_device__'), null,
    'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
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
  if lower(coalesce(v_license.plan_code, '')) = 'free_trial' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_PLAN_REQUIRED');
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
      v_license.id, p_device_fingerprint, left(p_device_name, 120), coalesce(p_device_info, '{}'::jsonb), true,
      v_device_token, null, v_realtime_topic, now(), now(), 'admin', v_device_mode, null
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
    select 1 from public.business_profiles bp
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

create or replace function public.staff_login_on_device_unlimited(
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
  v_staff_user public.license_staff_users%rowtype;
  v_device public.license_devices%rowtype;
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

  if v_license.status <> 'active'
     or (v_license.expires_at is not null and v_license.expires_at < now()) then
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
  limit 1
  for update;

  if v_staff_user.id is null
     or extensions.crypt(coalesce(p_password, ''), v_staff_user.password_hash) <> v_staff_user.password_hash then
    return jsonb_build_object('success', false, 'code', 'INVALID_STAFF_CREDENTIALS', 'message', 'Usuario o contraseña incorrectos.');
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  for update;

  if v_device.id is not null and v_device.device_mode = 'admin_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_MODE_STAFF_NOT_ALLOWED',
      'message', 'Este dispositivo esta configurado solo para Admin.'
    );
  end if;

  select d.id, d.device_name, d.last_used_at, d.activated_at
  into v_existing_staff_device
  from public.license_staff_sessions ss
  join public.license_devices d on d.id = ss.device_id
  where ss.license_id = v_license.id
    and ss.staff_user_id = v_staff_user.id
    and ss.revoked_at is null
    and ss.expires_at > now()
    and d.is_active is true
    and d.device_fingerprint <> p_device_fingerprint
  order by ss.created_at desc
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

  if exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license.id
      and d.staff_user_id = v_staff_user.id
      and d.device_role = 'staff'
      and d.is_active is true
      and d.device_fingerprint <> p_device_fingerprint
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_ALREADY_IN_USE',
      'message', 'Este usuario staff ya esta activo en otro dispositivo.'
    );
  end if;

  select count(*) into v_active_device_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true
    and (v_device.id is null or d.id <> v_device.id);

  if v_active_device_count + 1 > v_license.max_devices then
    return jsonb_build_object('success', false, 'code', 'DEVICE_LIMIT_REACHED', 'message', 'Limite de dispositivos alcanzado para esta licencia.');
  end if;

  v_device_security_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_hash := extensions.crypt(v_session_token, extensions.gen_salt('bf', 12));

  if v_device.id is null then
    v_realtime_topic := private.generate_license_realtime_topic();
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, device_info, is_active,
      security_token, previous_security_token, realtime_topic, last_check_at,
      last_used_at, device_role, device_mode, staff_user_id
    ) values (
      v_license.id, p_device_fingerprint, p_device_name, coalesce(p_device_info, '{}'::jsonb), true,
      v_device_security_token, null, v_realtime_topic, now(), now(),
      'staff', 'staff_only', v_staff_user.id
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
        device_role = case when device_mode = 'staff_only' then 'staff' else device_role end,
        staff_user_id = case when device_mode = 'staff_only' then v_staff_user.id else staff_user_id end
    where id = v_device.id
    returning * into v_device;

    v_realtime_topic := v_device.realtime_topic;
  end if;

  update public.license_admin_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'STAFF_LOGIN_HANDOFF')
  where device_id = v_device.id
    and revoked_at is null;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'SESSION_ROTATED')
  where device_id = v_device.id
    and revoked_at is null;

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, metadata
  ) values (
    v_license.id,
    v_staff_user.id,
    v_device.id,
    v_session_hash,
    jsonb_build_object('device_name', p_device_name, 'device_mode', v_device.device_mode)
  ) returning id into v_session_id;

  update public.license_staff_users
  set last_login_at = now()
  where id = v_staff_user.id;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (
    v_license.id,
    p_device_fingerprint,
    'STAFF_LOGIN',
    jsonb_build_object(
      'staff_user_id', v_staff_user.id,
      'username', v_staff_user.username,
      'device_mode', v_device.device_mode
    )
  );

  return jsonb_build_object(
    'success', true,
    'message', 'Sesion staff iniciada correctamente.',
    'device_security_token', v_device_security_token,
    'staff_session_token', v_session_token,
    'staff_session_id', v_session_id,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
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
      'device_mode', v_device.device_mode,
      'legacy_device_role', v_device.device_role,
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
        when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false)
          then v_device.realtime_topic
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

create or replace function public.admin_set_device_mode(
  p_license_key text,
  p_requester_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text,
  p_target_device_id uuid,
  p_device_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_target public.license_devices%rowtype;
  v_previous_mode text;
  v_features jsonb;
  v_revoked_admin integer := 0;
  v_revoked_staff integer := 0;
  v_requester_session_revoked boolean := false;
begin
  if p_device_mode not in ('shared', 'admin_only', 'staff_only') then
    return jsonb_build_object('success', false, 'code', 'DEVICE_MODE_INVALID');
  end if;

  v_auth := private.require_active_admin_session(
    p_license_key,
    p_requester_fingerprint,
    p_device_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = (v_auth->>'license_id')::uuid;

  if p_device_mode in ('shared', 'staff_only')
     and coalesce((v_features->>'staff_roles')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', 'FEATURE_NOT_AVAILABLE',
      'message', 'El plan actual no incluye usuarios Staff.'
    );
  end if;

  select * into v_target
  from public.license_devices
  where id = p_target_device_id
    and license_id = (v_auth->>'license_id')::uuid
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_FOUND');
  end if;

  v_previous_mode := v_target.device_mode;

  if v_previous_mode = p_device_mode then
    return jsonb_build_object(
      'success', true,
      'device_id', v_target.id,
      'device_mode', v_target.device_mode,
      'changed', false,
      'requester_session_revoked', false
    );
  end if;

  update public.license_devices
  set device_mode = p_device_mode,
      last_check_at = now()
  where id = v_target.id;

  if p_device_mode = 'admin_only' then
    update public.license_staff_sessions
    set revoked_at = coalesce(revoked_at, now()),
        metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_MODE_ADMIN_ONLY')
    where device_id = v_target.id
      and revoked_at is null;
    get diagnostics v_revoked_staff = row_count;
  elsif p_device_mode = 'staff_only' then
    update public.license_admin_sessions
    set revoked_at = coalesce(revoked_at, now()),
        metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_MODE_STAFF_ONLY')
    where device_id = v_target.id
      and revoked_at is null;
    get diagnostics v_revoked_admin = row_count;

    v_requester_session_revoked :=
      v_target.id = (v_auth->>'device_id')::uuid
      and v_revoked_admin > 0;
  end if;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'DEVICE_MODE_CHANGED',
    jsonb_build_object(
      'requester_admin_user_id', v_auth->>'admin_user_id',
      'requester_device_id', v_auth->>'device_id',
      'target_device_id', v_target.id,
      'previous_mode', v_previous_mode,
      'device_mode', p_device_mode,
      'legacy_device_role', v_target.device_role,
      'revoked_admin_sessions', v_revoked_admin,
      'revoked_staff_sessions', v_revoked_staff,
      'changed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'device_id', v_target.id,
    'previous_mode', v_previous_mode,
    'device_mode', p_device_mode,
    'legacy_device_role', v_target.device_role,
    'changed', true,
    'revoked_admin_sessions', v_revoked_admin,
    'revoked_staff_sessions', v_revoked_staff,
    'requester_session_revoked', v_requester_session_revoked
  );
end;
$function$;

revoke all on function public.admin_set_device_mode(text, text, text, text, uuid, text) from public;
grant execute on function public.admin_set_device_mode(text, text, text, text, uuid, text)
  to anon, authenticated, service_role;

create or replace function public.admin_get_license_devices(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_devices jsonb;
begin
  v_auth := private.require_active_admin_session(
    p_license_key,
    p_device_fingerprint,
    p_device_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id,
    'device_name', d.device_name,
    'last_used_at', d.last_used_at,
    'activated_at', d.activated_at,
    'is_active', d.is_active,
    'is_current_device', d.id = (v_auth->>'device_id')::uuid,
    'device_mode', d.device_mode,
    'device_role', d.device_role,
    'staff_user_id', d.staff_user_id,
    'staff_username', s.username,
    'staff_display_name', s.display_name,
    'active_admin_sessions', (
      select count(*)
      from public.license_admin_sessions aas
      where aas.device_id = d.id
        and aas.revoked_at is null
        and aas.expires_at > now()
    ),
    'active_staff_sessions', (
      select count(*)
      from public.license_staff_sessions ss
      where ss.device_id = d.id
        and ss.revoked_at is null
        and ss.expires_at > now()
    )
  ) order by
    (d.id = (v_auth->>'device_id')::uuid) desc,
    d.is_active desc,
    d.last_used_at desc nulls last), '[]'::jsonb)
  into v_devices
  from public.license_devices d
  left join public.license_staff_users s
    on s.id = d.staff_user_id
   and s.license_id = d.license_id
  where d.license_id = (v_auth->>'license_id')::uuid;

  return jsonb_build_object('success', true, 'data', v_devices);
end;
$function$;

create or replace function public.verify_device_license_unified_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_license record;
    v_device record;
    v_staff_user record;
    v_new_token text;
    v_grace_days integer := 7;
    v_is_in_grace boolean := false;
    v_latest_term_id uuid;
    v_latest_term_version text;
    v_terms_accepted boolean := true;
    v_realtime_topic text;
    v_staff_roles_enabled boolean;
    v_staff_user_payload jsonb;
    v_block jsonb;
    v_block_reason text;
    v_block_message text;
begin
    select
      l.id, l.status, l.product_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features,
      l.expires_at, l.license_key,
      coalesce(l.max_devices, p.max_devices, 1) as max_devices,
      p.code as plan_code, p.name as plan_name
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.license_key = p_license_key;

    if v_license.id is null then
        return jsonb_build_object('valid', false, 'status', 'not_found', 'reason', 'LICENSE_NOT_FOUND');
    end if;

    v_staff_roles_enabled := coalesce((v_license.effective_features->>'staff_roles')::boolean, false);

    if v_license.status != 'active' then
        return jsonb_build_object('valid', false, 'status', 'suspended', 'reason', 'LICENSE_SUSPENDED');
    end if;

    if v_license.expires_at is not null and v_license.expires_at < now() then
        if v_license.expires_at > (now() - (v_grace_days || ' days')::interval) then
            v_is_in_grace := true;
        else
            return jsonb_build_object(
                'valid', false, 'status', 'expired', 'reason', 'LICENSE_EXPIRED',
                'expires_at', v_license.expires_at, 'max_devices', v_license.max_devices,
                'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name
            );
        end if;
    end if;

    select id, device_name, security_token, previous_security_token, is_active,
           realtime_topic, device_role, device_mode, staff_user_id, device_info
    into v_device
    from public.license_devices
    where license_id = v_license.id
      and device_fingerprint = p_device_fingerprint
    limit 1;

    if v_device.id is null then
        return jsonb_build_object(
          'valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED',
          'message', 'Este dispositivo no esta autorizado para esta licencia.',
          'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name
        );
    end if;

    v_block := coalesce(v_device.device_info->'license_block', '{}'::jsonb);
    v_block_reason := nullif(v_block->>'reason', '');
    v_block_message := nullif(v_block->>'message', '');

    if v_device.is_active = false then
        return jsonb_build_object(
          'valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED',
          'block_reason', coalesce(v_block_reason, 'DEVICE_NOT_ALLOWED'),
          'message', coalesce(v_block_message, 'Este dispositivo fue desactivado o ya no esta permitido en esta licencia.'),
          'license_key', v_license.license_key,
          'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name,
          'product_name', v_license.product_name, 'max_devices', v_license.max_devices,
          'device_mode', v_device.device_mode, 'device_role', v_device.device_role
        );
    end if;

    if v_device.device_mode = 'staff_only' and not v_staff_roles_enabled then
        update public.license_devices d
        set is_active = false,
            security_token = null,
            previous_security_token = null,
            last_check_at = now(),
            device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
              'license_block', jsonb_build_object(
                'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
                'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia o pide al administrador actualizar el plan.',
                'plan_code', v_license.plan_code,
                'plan_name', v_license.plan_name,
                'blocked_at', now()
              )
            )
        where d.id = v_device.id;

        update public.license_staff_sessions s
        set revoked_at = coalesce(s.revoked_at, now()),
            metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
              'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
              'revoked_at', now(),
              'plan_code', v_license.plan_code,
              'plan_name', v_license.plan_name
            )
        where s.license_id = v_license.id
          and s.device_id = v_device.id
          and s.revoked_at is null;

        return jsonb_build_object(
          'valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED',
          'block_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
          'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia para continuar en este equipo.',
          'license_key', v_license.license_key,
          'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name,
          'product_name', v_license.product_name, 'max_devices', v_license.max_devices,
          'device_mode', v_device.device_mode, 'device_role', v_device.device_role
        );
    end if;

    if v_device.device_mode = 'staff_only' and v_staff_roles_enabled then
        select id, username, display_name, role_name, permissions, is_active
        into v_staff_user
        from public.license_staff_users
        where id = v_device.staff_user_id
          and license_id = v_license.id;

        if v_device.staff_user_id is null
           or v_staff_user.id is null
           or v_staff_user.is_active = false then
            return jsonb_build_object(
              'valid', false, 'status', 'staff_login_required',
              'reason', 'STAFF_LOGIN_REQUIRED', 'staff_login_required', true,
              'device_mode', v_device.device_mode, 'device_role', 'staff'
            );
        end if;

        v_staff_user_payload := jsonb_build_object(
          'id', v_staff_user.id,
          'username', v_staff_user.username,
          'display_name', v_staff_user.display_name,
          'role_name', v_staff_user.role_name,
          'permissions', v_staff_user.permissions
        );
    else
        v_staff_user_payload := null;
    end if;

    if v_device.realtime_topic is null then
        update public.license_devices
        set realtime_topic = private.generate_license_realtime_topic()
        where id = v_device.id
        returning realtime_topic into v_realtime_topic;
    else
        v_realtime_topic := v_device.realtime_topic;
    end if;

    select id, version into v_latest_term_id, v_latest_term_version
    from public.legal_terms
    where type = 'terms_of_use' and is_active = true
    order by published_at desc
    limit 1;

    if v_latest_term_id is not null then
        select exists (
            select 1 from public.legal_acceptances
            where license_id = v_license.id
              and term_id = v_latest_term_id
        ) into v_terms_accepted;
    end if;

    if v_device.security_token is not null then
        if p_security_token is null or p_security_token = '' then
            return jsonb_build_object('valid', false, 'status', 'token_required', 'reason', 'DEVICE_TOKEN_REQUIRED');
        elsif p_security_token = v_device.security_token
              or (v_device.previous_security_token is not null and p_security_token = v_device.previous_security_token) then
            update public.license_devices
            set last_used_at = now(), last_check_at = now()
            where id = v_device.id;

            return jsonb_build_object(
                'valid', true,
                'status', case when v_is_in_grace then 'grace_period' else 'active' end,
                'license_status', v_license.status,
                'license_key', v_license.license_key,
                'product_name', v_license.product_name,
                'max_devices', v_license.max_devices,
                'plan_code', v_license.plan_code,
                'plan_name', v_license.plan_name,
                'features', coalesce(v_license.effective_features, '{}'::jsonb),
                'device_name', v_device.device_name,
                'device_mode', v_device.device_mode,
                'legacy_device_role', v_device.device_role,
                'device_role', v_device.device_role,
                'actor_auth_required', v_device.device_mode = 'shared',
                'staff_user', v_staff_user_payload,
                'expires_at', v_license.expires_at,
                'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
                'new_security_token', v_device.security_token,
                'realtime_topic', case
                  when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
                  else null
                end,
                'legal_status', jsonb_build_object(
                    'has_updated_terms', not v_terms_accepted,
                    'latest_version', v_latest_term_version,
                    'term_id', v_latest_term_id
                )
            );
        else
            return jsonb_build_object('valid', false, 'status', 'cloned', 'reason', 'CLONING_DETECTED');
        end if;
    end if;

    v_new_token := extensions.gen_random_uuid()::text;
    update public.license_devices
    set previous_security_token = security_token,
        security_token = v_new_token,
        last_used_at = now(),
        last_check_at = now()
    where id = v_device.id;

    return jsonb_build_object(
        'valid', true,
        'status', case when v_is_in_grace then 'grace_period' else 'active' end,
        'license_status', v_license.status,
        'license_key', v_license.license_key,
        'product_name', v_license.product_name,
        'max_devices', v_license.max_devices,
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'features', coalesce(v_license.effective_features, '{}'::jsonb),
        'device_name', v_device.device_name,
        'device_mode', v_device.device_mode,
        'legacy_device_role', v_device.device_role,
        'device_role', v_device.device_role,
        'actor_auth_required', v_device.device_mode = 'shared',
        'staff_user', v_staff_user_payload,
        'expires_at', v_license.expires_at,
        'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
        'new_security_token', v_new_token,
        'realtime_topic', case
          when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
          else null
        end,
        'legal_status', jsonb_build_object(
            'has_updated_terms', not v_terms_accepted,
            'latest_version', v_latest_term_version,
            'term_id', v_latest_term_id
        )
    );
end;
$function$;

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
    return jsonb_build_object('success', false, 'code', 'ADMIN_USERNAME_INVALID', 'message', 'Usa un usuario de 3 a 64 caracteres.');
  end if;
  if v_display_name is null or char_length(v_display_name) > 120 then
    return jsonb_build_object('success', false, 'code', 'ADMIN_DISPLAY_NAME_INVALID', 'message', 'Ingresa el nombre del propietario.');
  end if;
  if p_password is null or char_length(p_password) < 8
     or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_PASSWORD_WEAK', 'message', 'La contrasena debe tener al menos 8 caracteres, una letra y un numero.');
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
  if lower(coalesce(v_license.plan_code, '')) = 'free_trial' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_PLAN_REQUIRED');
  end if;
  if exists (
    select 1 from public.license_admin_users u
    where u.license_id = v_license.id and u.is_owner
  ) then
    return jsonb_build_object('success', false, 'code', 'ADMIN_OWNER_ALREADY_ENROLLED');
  end if;

  select d.* into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared')
    and (d.security_token = p_device_security_token or d.previous_security_token = p_device_security_token)
  for update;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ENROLLMENT_NOT_ALLOWED');
  end if;

  insert into public.license_admin_users (
    license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_license.id, v_username, v_display_name,
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)), true, true
  ) returning * into v_admin;

  v_session := private.create_admin_session(v_license.id, v_admin.id, v_device.id, v_device.device_name);

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'ADMIN_ENROLLMENT_HANDOFF')
  where device_id = v_device.id
    and revoked_at is null;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key, 'ADMIN_OWNER_ENROLLED',
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

create or replace function public.admin_release_device(
  p_license_key text,
  p_requester_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text,
  p_target_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_auth jsonb;
  v_target public.license_devices%rowtype;
  v_released_current boolean;
  v_was_last_admin boolean;
  v_admin_revoked integer;
  v_staff_revoked integer;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_requester_fingerprint, null,
    'admin_release_device', 'DEVICE_ADMIN', 10, 600, 600,
    'AUTH_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_auth := private.require_active_admin_session(
    p_license_key,
    p_requester_fingerprint,
    p_device_security_token,
    p_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  select * into v_target
  from public.license_devices
  where id = p_target_device_id
    and license_id = (v_auth->>'license_id')::uuid
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_FOUND');
  end if;

  v_released_current := v_target.id = (v_auth->>'device_id')::uuid;

  select v_target.device_mode in ('admin_only', 'shared') and count(*) = 1
  into v_was_last_admin
  from public.license_devices d
  where d.license_id = v_target.license_id
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared');

  update public.license_admin_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_RELEASED')
  where device_id = v_target.id
    and revoked_at is null;
  get diagnostics v_admin_revoked = row_count;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_RELEASED')
  where device_id = v_target.id
    and revoked_at is null;
  get diagnostics v_staff_revoked = row_count;

  update public.license_devices
  set is_active = false,
      security_token = null,
      previous_security_token = null,
      last_used_at = now(),
      last_check_at = now()
  where id = v_target.id;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key, 'DEVICE_RELEASED',
    jsonb_build_object(
      'source', 'admin_release_device',
      'requester_admin_user_id', v_auth->>'admin_user_id',
      'requester_device_id', v_auth->>'device_id',
      'device_id', v_target.id,
      'device_mode', v_target.device_mode,
      'legacy_device_role', v_target.device_role,
      'released_current_device', v_released_current,
      'was_last_active_admin', v_was_last_admin,
      'admin_sessions_revoked', v_admin_revoked,
      'staff_sessions_revoked', v_staff_revoked,
      'released_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'released_current_device', v_released_current,
    'was_last_active_admin', v_was_last_admin,
    'revoked_sessions_count', v_admin_revoked + v_staff_revoked
  );
end;
$function$;

do $$
begin
  if exists (
    select 1 from public.license_devices
    where device_mode = 'shared'
  ) then
    raise exception 'DEVICE_MODE_UNEXPECTED_AUTOMATIC_SHARED';
  end if;

  if exists (
    select 1 from public.license_devices
    where (device_role = 'admin' and device_mode <> 'admin_only')
       or (device_role = 'staff' and device_mode <> 'staff_only')
  ) then
    raise exception 'DEVICE_MODE_BACKFILL_MISMATCH';
  end if;
end;
$$;
