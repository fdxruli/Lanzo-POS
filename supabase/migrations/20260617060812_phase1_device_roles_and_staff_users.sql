-- =========================================================
-- Fase 1: roles de dispositivo + usuarios staff por licencia
-- =========================================================

-- 1) Features de plan: staff_roles solo para Pro por ahora.
update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('staff_roles', true)
where code = 'pro_monthly';

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('staff_roles', false)
where code in ('free_trial', 'basic_monthly');

-- 2) Helpers privados para permisos y feature gating.
create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path = ''
as $function$
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
    'sync', false
  );
$function$;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync'
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
$function$;

create or replace function private.license_staff_roles_enabled(p_plan_features jsonb, p_license_features jsonb)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(((coalesce(p_plan_features, '{}'::jsonb) || coalesce(p_license_features, '{}'::jsonb))->>'staff_roles')::boolean, false);
$function$;

-- 3) Tabla de usuarios internos staff por licencia.
create table if not exists public.license_staff_users (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null,
  role_name text not null default 'staff',
  permissions jsonb not null default private.default_staff_permissions(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_by_device_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.license_staff_users enable row level security;

create unique index if not exists uq_license_staff_users_username_lower
  on public.license_staff_users (license_id, lower(username));

create index if not exists idx_license_staff_users_license_active
  on public.license_staff_users (license_id, is_active);

-- 4) Tabla de sesiones staff online.
create table if not exists public.license_staff_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  staff_user_id uuid not null references public.license_staff_users(id) on delete cascade,
  device_id uuid not null references public.license_devices(id) on delete cascade,
  session_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.license_staff_sessions enable row level security;

create index if not exists idx_license_staff_sessions_user_active
  on public.license_staff_sessions (staff_user_id, revoked_at, expires_at);

create index if not exists idx_license_staff_sessions_device_active
  on public.license_staff_sessions (device_id, revoked_at, expires_at);

-- 5) Nuevas columnas en license_devices.
alter table public.license_devices
  add column if not exists device_role text,
  add column if not exists staff_user_id uuid;

update public.license_devices
set device_role = coalesce(device_role, 'staff')
where device_role is null;

-- Marcar como admin el primer dispositivo activo de cada licencia.
with ranked_devices as (
  select
    id,
    row_number() over (
      partition by license_id
      order by activated_at asc nulls last, id asc
    ) as rn
  from public.license_devices
  where is_active = true
    and license_id is not null
)
update public.license_devices d
set device_role = case when r.rn = 1 then 'admin' else 'staff' end
from ranked_devices r
where r.id = d.id;

alter table public.license_devices
  alter column device_role set default 'staff',
  alter column device_role set not null;

-- Constraints idempotentes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'license_devices_device_role_check'
  ) then
    alter table public.license_devices
      add constraint license_devices_device_role_check
      check (device_role in ('admin', 'staff'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'license_devices_staff_user_id_fkey'
  ) then
    alter table public.license_devices
      add constraint license_devices_staff_user_id_fkey
      foreign key (staff_user_id)
      references public.license_staff_users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'license_staff_users_role_name_check'
  ) then
    alter table public.license_staff_users
      add constraint license_staff_users_role_name_check
      check (role_name in ('staff', 'cashier', 'waiter', 'supervisor', 'custom'));
  end if;
end $$;

create unique index if not exists uq_license_devices_one_active_admin
  on public.license_devices (license_id)
  where is_active = true and device_role = 'admin' and license_id is not null;

create index if not exists idx_license_devices_staff_user_id
  on public.license_devices (staff_user_id)
  where staff_user_id is not null;

-- 6) updated_at para staff users.
create or replace function private.touch_license_staff_user_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_touch_license_staff_user_updated_at on public.license_staff_users;
create trigger trg_touch_license_staff_user_updated_at
before update on public.license_staff_users
for each row execute function private.touch_license_staff_user_updated_at();

-- 7) Actualizar activación de licencia: primer dispositivo admin; nuevos Pro con staff_roles requieren login staff.
create or replace function public.activate_license_on_device(
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
  v_license_record public.licenses%rowtype;
  v_device_record record;
  v_current_count int;
  v_security_token text;
  v_profile_required boolean;
  v_effective_features jsonb;
  v_staff_roles_enabled boolean;
  v_realtime_topic text;
  v_has_active_admin boolean;
  v_device_role text;
begin
  select * into v_license_record
  from public.licenses
  where license_key = license_key_param
  for update;

  if v_license_record.id is null then
    return json_build_object('success', false, 'error', 'Licencia no encontrada.', 'code', 'LICENSE_NOT_FOUND');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_effective_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = v_license_record.id;

  v_staff_roles_enabled := coalesce((v_effective_features->>'staff_roles')::boolean, false);

  if v_license_record.status <> 'active' then
    return json_build_object('success', false, 'error', 'La licencia no esta activa o ha sido suspendida.', 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  if v_license_record.expires_at is not null and v_license_record.expires_at < now() then
    return json_build_object('success', false, 'error', 'La licencia ha caducado.', 'code', 'LICENSE_EXPIRED');
  end if;

  if v_license_record.expires_at is null
     and coalesce(v_license_record.is_lifetime, false) = false
     and v_license_record.duration_months is not null then
    update public.licenses
    set expires_at = now() + (v_license_record.duration_months || ' months')::interval
    where id = v_license_record.id;

    v_license_record.expires_at := now() + (v_license_record.duration_months || ' months')::interval;
  end if;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license_record.id
      and nullif(trim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license_record.id
      and d.is_active = true
      and d.device_role = 'admin'
  ) into v_has_active_admin;

  select * into v_device_record
  from public.license_devices
  where license_id = v_license_record.id
    and device_fingerprint = device_fingerprint_param;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  if v_device_record.id is not null then
    v_device_role := coalesce(v_device_record.device_role, case when v_has_active_admin and v_device_record.device_role <> 'admin' then 'staff' else 'admin' end);

    update public.license_devices
    set device_name = device_name_param,
        device_info = coalesce(device_info_param, '{}'::jsonb),
        is_active = true,
        security_token = v_security_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_used_at = now(),
        last_check_at = now(),
        device_role = v_device_role,
        staff_user_id = case when v_device_role = 'admin' then null else staff_user_id end
    where id = v_device_record.id
    returning realtime_topic, device_role into v_realtime_topic, v_device_role;
  else
    if v_has_active_admin and v_staff_roles_enabled then
      return json_build_object(
        'success', false,
        'code', 'STAFF_LOGIN_REQUIRED',
        'staff_login_required', true,
        'message', 'Esta licencia ya tiene un dispositivo administrador. Para agregar este equipo, inicia sesion con un usuario staff autorizado.',
        'details', json_build_object(
          'license_key', license_key_param,
          'product_name', v_license_record.product_name,
          'profile_required', false,
          'features', coalesce(v_effective_features, '{}'::jsonb)
        )
      );
    end if;

    select count(*) into v_current_count
    from public.license_devices
    where license_id = v_license_record.id
      and is_active = true;

    if (v_current_count + 1) > v_license_record.max_devices then
      return json_build_object('success', false, 'error', 'Limite de dispositivos alcanzado para esta licencia.', 'code', 'DEVICE_LIMIT_REACHED');
    end if;

    v_realtime_topic := private.generate_license_realtime_topic();
    v_device_role := case when v_has_active_admin then 'staff' else 'admin' end;

    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      realtime_topic,
      last_check_at,
      device_role
    ) values (
      v_license_record.id,
      device_fingerprint_param,
      device_name_param,
      coalesce(device_info_param, '{}'::jsonb),
      true,
      v_security_token,
      v_realtime_topic,
      now(),
      v_device_role
    );
  end if;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (v_license_record.id, device_fingerprint_param, 'ACTIVATE', coalesce(device_info_param, '{}'::jsonb));

  return json_build_object(
    'success', true,
    'message', 'Licencia activada correctamente',
    'device_security_token', v_security_token,
    'profile_required', v_profile_required,
    'device_role', v_device_role,
    'details', json_build_object(
      'license_key', license_key_param,
      'product_name', v_license_record.product_name,
      'expires_at', v_license_record.expires_at,
      'max_devices', v_license_record.max_devices,
      'features', coalesce(v_effective_features, '{}'::jsonb),
      'profile_required', v_profile_required,
      'security_token', v_security_token,
      'token', v_security_token,
      'device_role', v_device_role,
      'staff_user', null,
      'realtime_topic', case
        when coalesce((v_effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
        else null
      end
    )
  );
exception when unique_violation then
  return json_build_object(
    'success', false,
    'error', 'Error: este dispositivo ya esta registrado o ya existe un administrador activo.',
    'code', 'UNIQUE_VIOLATION'
  );
end;
$function$;

-- 8) Verificación de licencia con device_role y staff_user.
create or replace function public.verify_device_license_unified(
    p_license_key text,
    p_device_fingerprint text,
    p_security_token text default null::text
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
begin
    select
      l.id,
      l.status,
      l.product_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features,
      l.expires_at,
      l.license_key,
      coalesce(l.max_devices, p.max_devices, 1) as max_devices,
      p.code as plan_code,
      p.name as plan_name
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
                'valid', false,
                'status', 'expired',
                'reason', 'LICENSE_EXPIRED',
                'expires_at', v_license.expires_at,
                'max_devices', v_license.max_devices,
                'plan_code', v_license.plan_code,
                'plan_name', v_license.plan_name
            );
        end if;
    end if;

    select id, device_name, security_token, previous_security_token, is_active, realtime_topic, device_role, staff_user_id
    into v_device
    from public.license_devices
    where license_id = v_license.id
      and device_fingerprint = p_device_fingerprint
    limit 1;

    if v_device.id is null or v_device.is_active = false then
        return jsonb_build_object('valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED');
    end if;

    if v_device.device_role = 'staff' and v_staff_roles_enabled then
        select id, username, display_name, role_name, permissions, is_active
        into v_staff_user
        from public.license_staff_users
        where id = v_device.staff_user_id
          and license_id = v_license.id;

        if v_device.staff_user_id is null or v_staff_user.id is null or v_staff_user.is_active = false then
            return jsonb_build_object(
              'valid', false,
              'status', 'staff_login_required',
              'reason', 'STAFF_LOGIN_REQUIRED',
              'staff_login_required', true,
              'device_role', 'staff'
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

    if v_device.security_token is not null then
        if p_security_token is null or p_security_token = '' then
            return jsonb_build_object('valid', false, 'status', 'token_required', 'reason', 'DEVICE_TOKEN_REQUIRED');
        elsif p_security_token = v_device.security_token then
            null;
        elsif p_security_token = v_device.previous_security_token then
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
                'device_role', coalesce(v_device.device_role, 'staff'),
                'staff_user', v_staff_user_payload,
                'expires_at', v_license.expires_at,
                'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
                'new_security_token', v_device.security_token,
                'realtime_topic', case
                  when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
                  else null
                end
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

    select id, version into v_latest_term_id, v_latest_term_version
    from public.legal_terms
    where type = 'terms_of_use' and is_active = true
    order by published_at desc
    limit 1;

    if v_latest_term_id is not null then
        select exists (
            select 1
            from public.legal_acceptances
            where license_id = v_license.id
              and term_id = v_latest_term_id
        ) into v_terms_accepted;
    end if;

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
        'device_role', coalesce(v_device.device_role, 'staff'),
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

-- 9) RPC: admin crea usuario staff.
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
declare
  v_license record;
  v_admin_device record;
  v_username text;
  v_display_name text;
  v_role_name text;
  v_permissions jsonb;
  v_staff_user record;
begin
  v_username := lower(trim(coalesce(p_username, '')));
  v_display_name := nullif(trim(coalesce(p_display_name, '')), '');
  v_role_name := coalesce(nullif(trim(p_role_name), ''), 'staff');

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

  select
    l.id,
    l.status,
    l.expires_at,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  if coalesce((v_license.effective_features->>'staff_roles')::boolean, false) = false then
    return jsonb_build_object('success', false, 'code', 'FEATURE_NOT_AVAILABLE', 'message', 'La licencia no incluye usuarios staff.');
  end if;

  select d.* into v_admin_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_admin_device_fingerprint
    and d.is_active = true
    and d.device_role = 'admin'
    and (d.security_token = p_admin_security_token or d.previous_security_token = p_admin_security_token)
  limit 1;

  if v_admin_device.id is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_DEVICE_REQUIRED', 'message', 'Solo el dispositivo administrador puede crear usuarios staff.');
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
    v_admin_device.id
  )
  returning id, username, display_name, role_name, permissions, is_active, created_at into v_staff_user;

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
exception when unique_violation then
  return jsonb_build_object('success', false, 'code', 'USERNAME_ALREADY_EXISTS', 'message', 'Ya existe un usuario staff con ese nombre en esta licencia.');
end;
$function$;

-- 10) RPC: admin lista usuarios staff.
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
declare
  v_license_id uuid;
  v_admin_device_id uuid;
  v_staff jsonb;
begin
  select l.id into v_license_id
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
    return jsonb_build_object('success', false, 'code', 'ADMIN_DEVICE_REQUIRED', 'message', 'Solo el dispositivo administrador puede listar usuarios staff.');
  end if;

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
  where s.license_id = v_license_id;

  return jsonb_build_object('success', true, 'data', v_staff);
end;
$function$;

-- 11) RPC: admin actualiza usuario staff.
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
  v_admin_device_id uuid;
  v_existing record;
  v_new_display_name text;
  v_new_role_name text;
  v_new_permissions jsonb;
  v_staff_user record;
begin
  select l.id into v_license_id
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
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Usuario staff actualizado correctamente.',
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

-- 12) RPC: login online de staff y vinculación de dispositivo staff.
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
  for update;

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
$function$;

-- 13) RPC: verificar sesion staff online.
create or replace function public.verify_staff_session(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
    and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
  limit 1;

  if v_session.session_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  end if;

  if v_session.revoked_at is not null or v_session.expires_at < now() then
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

  update public.license_staff_sessions
  set last_seen_at = now()
  where id = v_session.session_id;

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
$function$;

-- 14) RPC: cerrar sesion staff.
create or replace function public.staff_logout_session(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid;
begin
  select ss.id into v_session_id
  from public.license_staff_sessions ss
  join public.license_devices d on d.id = ss.device_id
  join public.licenses l on l.id = ss.license_id
  where l.license_key = p_license_key
    and d.device_fingerprint = p_device_fingerprint
    and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    and ss.revoked_at is null
  limit 1;

  if v_session_id is null then
    return jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no encontrada.');
  end if;

  update public.license_staff_sessions
  set revoked_at = now()
  where id = v_session_id;

  return jsonb_build_object('success', true, 'message', 'Sesion staff cerrada.');
end;
$function$;;
