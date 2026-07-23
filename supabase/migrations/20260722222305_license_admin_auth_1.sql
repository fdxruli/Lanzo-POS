-- LICENSE.ADMIN.AUTH.1 - Identidad propietaria y sesiones administrativas.
-- La licencia identifica la suscripcion; nunca se usa como credencial admin.

create table if not exists public.license_admin_users (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null,
  is_owner boolean not null default true,
  is_active boolean not null default true,
  credentials_created_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint license_admin_users_username_format check (
    username = lower(btrim(username)) and char_length(username) between 3 and 64
  ),
  constraint license_admin_users_display_name_length check (
    char_length(btrim(display_name)) between 1 and 120
  )
);

create unique index if not exists license_admin_users_license_username_uidx
  on public.license_admin_users (license_id, lower(username));

create unique index if not exists license_admin_users_one_active_owner_uidx
  on public.license_admin_users (license_id)
  where is_owner is true and is_active is true;

create index if not exists license_admin_users_license_id_idx
  on public.license_admin_users (license_id);

create table if not exists public.license_admin_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  admin_user_id uuid not null references public.license_admin_users(id) on delete cascade,
  device_id uuid not null references public.license_devices(id) on delete cascade,
  session_token_hash text not null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists license_admin_sessions_license_device_active_idx
  on public.license_admin_sessions (license_id, device_id, created_at desc)
  where revoked_at is null;

create index if not exists license_admin_sessions_admin_user_id_idx
  on public.license_admin_sessions (admin_user_id);

create index if not exists license_admin_sessions_device_id_idx
  on public.license_admin_sessions (device_id);

alter table public.license_admin_users enable row level security;
alter table public.license_admin_sessions enable row level security;
revoke all on table public.license_admin_users from public, anon, authenticated;
revoke all on table public.license_admin_sessions from public, anon, authenticated;

comment on table public.license_admin_users is
  'LICENSE.ADMIN.AUTH.1: identidad administrativa separada de licencia, staff y dispositivo.';
comment on table public.license_admin_sessions is
  'LICENSE.ADMIN.AUTH.1: sesiones admin por dispositivo; solo almacena tokens con bcrypt.';

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
as $$
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

  select d.id as device_id, d.device_role
  into v_device
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_role = 'admin'
    and d.staff_user_id is null
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
$$;

revoke all on function private.require_active_admin_session(text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.create_admin_session(
  p_license_id uuid,
  p_admin_user_id uuid,
  p_device_id uuid,
  p_device_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_id uuid;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  update public.license_admin_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'SESSION_ROTATED')
  where license_id = p_license_id
    and device_id = p_device_id
    and revoked_at is null;

  insert into public.license_admin_sessions (
    license_id, admin_user_id, device_id, session_token_hash, expires_at, metadata
  ) values (
    p_license_id,
    p_admin_user_id,
    p_device_id,
    extensions.crypt(v_token, extensions.gen_salt('bf', 12)),
    v_expires_at,
    jsonb_build_object('device_name', left(coalesce(p_device_name, ''), 120))
  ) returning id into v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'session_token', v_token,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function private.create_admin_session(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

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
as $$
declare
  v_rate jsonb;
  v_license record;
  v_device record;
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
  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;
  if lower(coalesce(v_license.plan_code, '')) = 'free_trial' then
    return jsonb_build_object('success', false, 'code', 'ADMIN_PLAN_REQUIRED');
  end if;
  if exists (select 1 from public.license_admin_users u where u.license_id = v_license.id and u.is_owner) then
    return jsonb_build_object('success', false, 'code', 'ADMIN_OWNER_ALREADY_ENROLLED');
  end if;

  select d.* into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_role = 'admin'
    and d.staff_user_id is null
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
  set revoked_at = coalesce(revoked_at, now())
  where device_id = v_device.id and revoked_at is null;

  insert into public.license_events (license_key, event_type, metadata)
  values (p_license_key, 'ADMIN_OWNER_ENROLLED', jsonb_build_object(
    'admin_user_id', v_admin.id, 'device_id', v_device.id, 'enrolled_at', now()
  ));

  return jsonb_build_object(
    'success', true,
    'code', 'ADMIN_OWNER_ENROLLED',
    'admin_user', jsonb_build_object('id', v_admin.id, 'username', v_admin.username, 'display_name', v_admin.display_name, 'is_owner', true),
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'device_role', 'admin'
  );
exception when unique_violation then
  return jsonb_build_object('success', false, 'code', 'ADMIN_OWNER_ALREADY_ENROLLED');
end;
$$;

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
as $$
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
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_username, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_LOGIN_INVALID_REQUEST');
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    coalesce(nullif(btrim(p_device_fingerprint), ''), '__missing_device__') || ':admin:' || encode(extensions.digest(lower(btrim(coalesce(p_username, ''))), 'sha256'), 'hex'),
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

  if v_license.id is null then return jsonb_build_object('success', false, 'code', 'INVALID_ADMIN_CREDENTIALS'); end if;
  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
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

  if v_admin.id is null or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    return jsonb_build_object('success', false, 'code', 'INVALID_ADMIN_CREDENTIALS', 'message', 'Usuario o contrasena incorrectos.');
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id and d.device_fingerprint = p_device_fingerprint
  for update;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true
    and (v_device.id is null or d.id <> v_device.id);

  if v_active_count + 1 > v_license.max_devices then
    return jsonb_build_object('success', false, 'code', 'DEVICE_LIMIT_REACHED', 'message', 'Limite de dispositivos alcanzado para esta licencia.');
  end if;

  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');
  if v_device.id is null then
    v_realtime_topic := private.generate_license_realtime_topic();
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, device_info, is_active,
      security_token, previous_security_token, realtime_topic, last_check_at,
      last_used_at, device_role, staff_user_id
    ) values (
      v_license.id, p_device_fingerprint, left(p_device_name, 120), coalesce(p_device_info, '{}'::jsonb), true,
      v_device_token, null, v_realtime_topic, now(), now(), 'admin', null
    ) returning * into v_device;
  else
    update public.license_devices
    set device_name = left(p_device_name, 120), device_info = coalesce(p_device_info, '{}'::jsonb),
        is_active = true, security_token = v_device_token, previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_check_at = now(), last_used_at = now(), device_role = 'admin', staff_user_id = null
    where id = v_device.id returning * into v_device;
  end if;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now())
  where device_id = v_device.id and revoked_at is null;

  v_session := private.create_admin_session(v_license.id, v_admin.id, v_device.id, v_device.device_name);
  update public.license_admin_users set updated_at = now() where id = v_admin.id;

  select not exists (
    select 1 from public.business_profiles bp
    where bp.license_id = v_license.id
      and nullif(btrim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  insert into public.license_events (license_key, event_type, metadata)
  values (p_license_key, 'ADMIN_LOGIN', jsonb_build_object('admin_user_id', v_admin.id, 'device_id', v_device.id, 'logged_in_at', now()));

  return jsonb_build_object(
    'success', true,
    'device_security_token', v_device_token,
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'admin_user', jsonb_build_object('id', v_admin.id, 'username', v_admin.username, 'display_name', v_admin.display_name, 'is_owner', true),
    'device_role', 'admin',
    'details', jsonb_build_object(
      'valid', true, 'license_key', v_license.license_key, 'product_name', v_license.product_name,
      'max_devices', v_license.max_devices, 'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name,
      'features', v_license.effective_features, 'profile_required', v_profile_required,
      'device_name', v_device.device_name, 'device_role', 'admin', 'staff_user', null,
      'expires_at', v_license.expires_at,
      'realtime_topic', case when coalesce((v_license.effective_features->>'realtime_license_sync')::boolean, false) then v_device.realtime_topic else null end
    )
  );
end;
$$;

create or replace function public.verify_admin_session(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate jsonb;
  v_auth jsonb;
  v_details jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, null, 'verify_admin_session',
    'ADMIN_AUTH', 90, 600, 300, 'AUTH_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate) || jsonb_build_object('valid', false);
  end if;

  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  select jsonb_build_object(
    'license_key', l.license_key, 'product_name', l.product_name,
    'expires_at', l.expires_at, 'max_devices', coalesce(l.max_devices, p.max_devices, 1),
    'plan_code', p.code, 'plan_name', p.name,
    'features', coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb),
    'device_role', 'admin', 'staff_user', null
  ) into v_details
  from public.licenses l left join public.plans p on p.id = l.plan_id
  where l.id = (v_auth->>'license_id')::uuid;

  return v_auth || jsonb_build_object('details', v_details);
end;
$$;

create or replace function public.admin_logout_session(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  update public.license_admin_sessions
  set revoked_at = coalesce(revoked_at, now()), metadata = metadata || jsonb_build_object('revoked_reason', 'ADMIN_LOGOUT')
  where id = (v_auth->>'admin_session_id')::uuid;
  return jsonb_build_object('success', true);
end;
$$;

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
as $$
declare v_auth jsonb; v_devices jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id, 'device_name', d.device_name, 'last_used_at', d.last_used_at,
    'activated_at', d.activated_at, 'is_active', d.is_active,
    'is_current_device', d.id = (v_auth->>'device_id')::uuid,
    'device_role', d.device_role, 'staff_user_id', d.staff_user_id,
    'staff_username', s.username, 'staff_display_name', s.display_name,
    'admin_display_name', case when d.device_role = 'admin' then v_auth #>> '{admin_user,display_name}' else null end,
    'active_admin_sessions', (select count(*) from public.license_admin_sessions aas where aas.device_id = d.id and aas.revoked_at is null and aas.expires_at > now())
  ) order by (d.id = (v_auth->>'device_id')::uuid) desc, d.is_active desc, d.last_used_at desc nulls last), '[]'::jsonb)
  into v_devices
  from public.license_devices d
  left join public.license_staff_users s on s.id = d.staff_user_id and s.license_id = d.license_id
  where d.license_id = (v_auth->>'license_id')::uuid;
  return jsonb_build_object('success', true, 'data', v_devices);
end;
$$;

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
as $$
declare
  v_rate jsonb; v_auth jsonb; v_target public.license_devices%rowtype;
  v_released_current boolean; v_was_last_admin boolean; v_admin_revoked integer; v_staff_revoked integer;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(p_license_key, p_requester_fingerprint, null,
    'admin_release_device', 'DEVICE_ADMIN', 10, 600, 600, 'AUTH_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then return public.build_pos_rpc_rate_limited_response(v_rate); end if;
  v_auth := private.require_active_admin_session(p_license_key, p_requester_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  select * into v_target from public.license_devices
  where id = p_target_device_id and license_id = (v_auth->>'license_id')::uuid for update;
  if v_target.id is null then return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_FOUND'); end if;

  v_released_current := v_target.id = (v_auth->>'device_id')::uuid;
  select v_target.device_role = 'admin' and count(*) = 1 into v_was_last_admin
  from public.license_devices d
  where d.license_id = v_target.license_id and d.is_active is true and d.device_role = 'admin';

  update public.license_admin_sessions set revoked_at = coalesce(revoked_at, now()),
    metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_RELEASED')
  where device_id = v_target.id and revoked_at is null;
  get diagnostics v_admin_revoked = row_count;
  update public.license_staff_sessions set revoked_at = coalesce(revoked_at, now()),
    metadata = metadata || jsonb_build_object('revoked_reason', 'DEVICE_RELEASED')
  where device_id = v_target.id and revoked_at is null;
  get diagnostics v_staff_revoked = row_count;
  update public.license_devices set is_active = false, security_token = null, previous_security_token = null,
    last_used_at = now(), last_check_at = now() where id = v_target.id;

  insert into public.license_events (license_key, event_type, metadata)
  values (p_license_key, 'DEVICE_RELEASED', jsonb_build_object(
    'source', 'admin_release_device', 'requester_admin_user_id', v_auth->>'admin_user_id',
    'requester_device_id', v_auth->>'device_id', 'device_id', v_target.id,
    'device_role', v_target.device_role, 'released_current_device', v_released_current,
    'was_last_active_admin', v_was_last_admin, 'admin_sessions_revoked', v_admin_revoked,
    'staff_sessions_revoked', v_staff_revoked, 'released_at', now()
  ));
  return jsonb_build_object('success', true, 'released_current_device', v_released_current,
    'was_last_active_admin', v_was_last_admin, 'revoked_sessions_count', v_admin_revoked + v_staff_revoked);
end;
$$;

-- La activacion con solo clave queda limitada a FREE o a descubrir el siguiente paso.
do $$
begin
  if to_regprocedure('public.activate_license_on_device_legacy_free(text,text,text,jsonb)') is null
     and to_regprocedure('public.activate_license_on_device_unlimited(text,text,text,jsonb)') is not null then
    alter function public.activate_license_on_device_unlimited(text,text,text,jsonb)
      rename to activate_license_on_device_legacy_free;
  end if;
end;
$$;

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
as $$
declare v_license record; v_device record; v_has_owner boolean;
begin
  select l.id, l.status, l.expires_at, l.product_name, p.code as plan_code,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as features
  into v_license
  from public.licenses l left join public.plans p on p.id = l.plan_id
  where l.license_key = license_key_param for update of l;
  if v_license.id is null then return json_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.'); end if;
  if v_license.status <> 'active' then return json_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE'); end if;
  if v_license.expires_at is not null and v_license.expires_at < now() then return json_build_object('success', false, 'code', 'LICENSE_EXPIRED'); end if;

  if lower(coalesce(v_license.plan_code, '')) = 'free_trial' then
    -- FREE conserva el flujo historico. La copia se renombra antes de esta migracion en remoto.
    return public.activate_license_on_device_legacy_free(license_key_param, device_fingerprint_param, device_name_param, device_info_param);
  end if;

  select exists(select 1 from public.license_admin_users u where u.license_id = v_license.id and u.is_owner and u.is_active)
  into v_has_owner;
  if v_has_owner then
    return json_build_object('success', false, 'code', 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
      'message', 'Elige acceso Administrador o Personal.',
      'details', json_build_object('license_key', license_key_param, 'product_name', v_license.product_name, 'features', v_license.features));
  end if;

  select * into v_device from public.license_devices d
  where d.license_id = v_license.id and d.device_fingerprint = device_fingerprint_param limit 1;
  if v_device.id is not null and v_device.is_active is true and v_device.device_role = 'admin' then
    return json_build_object('success', false, 'code', 'ADMIN_ENROLLMENT_REQUIRED', 'admin_enrollment_required', true,
      'message', 'Crea las credenciales del propietario para continuar.',
      'details', json_build_object('license_key', license_key_param, 'product_name', v_license.product_name, 'features', v_license.features, 'device_role', 'admin'));
  end if;
  if v_device.id is not null and v_device.device_role = 'staff' then
    return json_build_object('success', false, 'code', 'STAFF_LOGIN_REQUIRED', 'staff_login_required', true,
      'message', 'Este dispositivo requiere inicio de sesion staff.',
      'details', json_build_object('license_key', license_key_param, 'product_name', v_license.product_name, 'features', v_license.features, 'device_role', 'staff'));
  end if;
  return json_build_object('success', false, 'code', 'ADMIN_ENROLLMENT_NOT_ALLOWED',
    'message', 'Esta licencia debe completar el registro desde su dispositivo administrador actual.');
end;
$$;

-- Overloads protegidos para las operaciones criticas de usuarios staff.
create or replace function public.admin_list_staff_users(
  p_license_key text, p_admin_device_fingerprint text, p_admin_security_token text, p_admin_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key,p_admin_device_fingerprint,p_admin_security_token,p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean,false) is false then return v_auth; end if;
  return public.admin_list_staff_users(p_license_key,p_admin_device_fingerprint,p_admin_security_token);
end; $$;

create or replace function public.admin_create_staff_user(
  p_license_key text, p_admin_device_fingerprint text, p_admin_security_token text,
  p_username text, p_password text, p_display_name text, p_permissions jsonb,
  p_role_name text, p_admin_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key,p_admin_device_fingerprint,p_admin_security_token,p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean,false) is false then return v_auth; end if;
  return public.admin_create_staff_user(p_license_key,p_admin_device_fingerprint,p_admin_security_token,p_username,p_password,p_display_name,p_permissions,p_role_name);
end; $$;

create or replace function public.admin_update_staff_user(
  p_license_key text, p_admin_device_fingerprint text, p_admin_security_token text,
  p_staff_user_id uuid, p_display_name text, p_permissions jsonb, p_is_active boolean,
  p_new_password text, p_role_name text, p_admin_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key,p_admin_device_fingerprint,p_admin_security_token,p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean,false) is false then return v_auth; end if;
  return public.admin_update_staff_user(p_license_key,p_admin_device_fingerprint,p_admin_security_token,p_staff_user_id,p_display_name,p_permissions,p_is_active,p_new_password,p_role_name);
end; $$;

-- Endurecer el helper compartido por las RPC ecommerce: el cuarto argumento
-- conserva su nombre historico, pero transporta la sesion del actor actual.
create or replace function private.ecommerce_admin_authorize_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limit jsonb; v_license record; v_device record;
  v_admin_auth jsonb; v_staff_verification jsonb; v_permissions jsonb;
begin
  if nullif(btrim(coalesce(p_license_key,'')),'') is null
     or nullif(btrim(coalesce(p_device_fingerprint,'')),'') is null
     or nullif(btrim(coalesce(p_security_token,'')),'') is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
  end if;
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,p_device_fingerprint,null,coalesce(nullif(btrim(p_rpc_name),''),'ecommerce_admin'),
    'ECOM_ADMIN',180,600,300,'ECOMMERCE_RATE_LIMITED',jsonb_build_object('actor_partition','device')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean,false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_RATE_LIMITED');
  end if;
  select l.id as license_id,p.code as plan_code,p.name as plan_name,
         coalesce(p.features,'{}'::jsonb)||coalesce(l.features,'{}'::jsonb) as effective_features
  into v_license from public.licenses l left join public.plans p on p.id=l.plan_id
  where l.license_key=p_license_key and l.status='active'
    and (l.expires_at is null or l.expires_at>=now()) limit 1;
  if v_license.license_id is null then return private.ecommerce_admin_error('LICENSE_NOT_ACTIVE'); end if;
  if private.ecommerce_license_feature_bool(v_license.license_id,'ecommerce_portal_enabled',false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_DISABLED');
  end if;
  select d.id as device_id,d.device_role,d.staff_user_id into v_device
  from public.license_devices d where d.license_id=v_license.license_id
    and d.device_fingerprint=p_device_fingerprint and d.is_active is true
    and (d.security_token=p_security_token or d.previous_security_token=p_security_token) limit 1;
  if v_device.device_id is null then return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED'); end if;

  if v_device.device_role='admin' then
    if exists(select 1 from public.license_admin_users u where u.license_id=v_license.license_id and u.is_owner and u.is_active) then
      v_admin_auth:=private.require_active_admin_session(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
      if coalesce((v_admin_auth->>'success')::boolean,false) is false then
        return private.ecommerce_admin_error('ECOMMERCE_ADMIN_SESSION_REQUIRED','Inicia sesion como administrador para continuar.');
      end if;
    end if;
    return jsonb_build_object('success',true,'license_id',v_license.license_id,'device_id',v_device.device_id,
      'device_role','admin','actor_type','admin_owner','admin_user_id',v_admin_auth->>'admin_user_id',
      'staff_user_id',null,'plan_code',v_license.plan_code,'plan_name',v_license.plan_name,'features',v_license.effective_features);
  end if;
  if v_device.device_role<>'staff' or nullif(btrim(coalesce(p_staff_session_token,'')),'') is null then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_REQUIRED');
  end if;
  v_staff_verification:=public.verify_staff_session_unlimited(p_license_key,p_device_fingerprint,p_staff_session_token);
  if coalesce((v_staff_verification->>'valid')::boolean,false) is false
     or v_device.staff_user_id is null
     or coalesce(v_staff_verification#>>'{staff_user,id}','')<>v_device.staff_user_id::text then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_INVALID');
  end if;
  select s.permissions into v_permissions from public.license_staff_users s
  where s.id=v_device.staff_user_id and s.license_id=v_license.license_id and s.is_active limit 1;
  if v_permissions is null then return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_INVALID'); end if;
  if coalesce((v_permissions->>'settings')::boolean,false) is not true
     or coalesce((v_permissions->>'ecommerce')::boolean,false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_PERMISSION_DENIED');
  end if;
  return jsonb_build_object('success',true,'license_id',v_license.license_id,'device_id',v_device.device_id,
    'device_role','staff','actor_type','staff','staff_user_id',v_device.staff_user_id,
    'plan_code',v_license.plan_code,'plan_name',v_license.plan_name,'features',v_license.effective_features);
exception when others then return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
end;
$$;

create or replace function private.ecommerce_admin_authorize(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_rpc_name text
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ecommerce_admin_authorize_v2($1,$2,$3,null,$4);
$$;

revoke all on function private.ecommerce_admin_authorize_v2(text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_admin_authorize(text,text,text,text) from public,anon,authenticated,service_role;

revoke all on function public.admin_enroll_owner_on_device(text,text,text,text,text,text) from public;
revoke all on function public.admin_login_on_device(text,text,text,text,text,jsonb) from public;
revoke all on function public.verify_admin_session(text,text,text,text) from public;
revoke all on function public.admin_logout_session(text,text,text,text) from public;
revoke all on function public.admin_get_license_devices(text,text,text,text) from public;
revoke all on function public.admin_release_device(text,text,text,text,uuid) from public;
revoke all on function public.admin_list_staff_users(text,text,text) from public, anon, authenticated;
revoke all on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text) from public, anon, authenticated;
revoke all on function public.get_license_devices_anon(text,text) from public, anon, authenticated;
revoke all on function public.get_license_devices_anon_unlimited(text,text) from public, anon, authenticated;
revoke all on function public.release_device_anon(uuid,text,text) from public, anon, authenticated;
revoke all on function public.release_device_anon_unlimited(uuid,text,text) from public, anon, authenticated;
revoke all on function public.activate_license_on_device_legacy_free(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.activate_license_on_device_unlimited(text,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.admin_enroll_owner_on_device(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.admin_login_on_device(text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.verify_admin_session(text,text,text,text) to anon, authenticated;
grant execute on function public.admin_logout_session(text,text,text,text) to anon, authenticated;
grant execute on function public.admin_get_license_devices(text,text,text,text) to anon, authenticated;
grant execute on function public.admin_release_device(text,text,text,text,uuid) to anon, authenticated;
grant execute on function public.admin_list_staff_users(text,text,text,text) to anon, authenticated;
grant execute on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text) to anon, authenticated;
grant execute on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
