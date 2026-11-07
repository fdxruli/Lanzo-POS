-- Disposable PostgreSQL schema for the canonical onboarding migration tests.
-- This fixture intentionally excludes all Production data.
create schema extensions;
create schema private;
create extension pgcrypto with schema extensions;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create table public.plans (
  id uuid primary key,
  code text not null,
  name text not null,
  max_devices integer not null,
  features jsonb not null default '{}'::jsonb
);
create table public.licenses (
  id uuid primary key default extensions.gen_random_uuid(),
  license_key text not null unique,
  plan_id uuid references public.plans(id),
  status text not null default 'active',
  expires_at timestamptz,
  is_lifetime boolean not null default false,
  max_devices integer,
  product_name text not null default 'Fixture',
  features jsonb not null default '{}'::jsonb
);
create table public.license_admin_users (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null,
  is_owner boolean not null default true,
  is_active boolean not null default true,
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
create unique index public.license_admin_users_license_username_uidx
  on public.license_admin_users (license_id, lower(username));
create unique index public.license_admin_users_one_active_owner_uidx
  on public.license_admin_users (license_id)
  where is_owner is true and is_active is true;

create table public.license_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_fingerprint text not null,
  device_name text,
  device_info jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  security_token text,
  previous_security_token text,
  realtime_topic text,
  last_check_at timestamptz,
  last_used_at timestamptz,
  device_role text not null default 'admin',
  device_mode text not null default 'admin_only',
  staff_user_id uuid,
  constraint license_devices_device_mode_check
    check (device_mode in ('admin_only', 'shared', 'staff_only')),
  unique (license_id, device_fingerprint)
);
create table public.license_admin_sessions (
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
create table public.license_staff_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references public.license_devices(id) on delete cascade,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create table public.business_profiles (
  license_id uuid primary key references public.licenses(id) on delete cascade,
  business_name text,
  business_type text[]
);
create table public.license_events (
  id uuid primary key default extensions.gen_random_uuid(),
  license_key text not null,
  event_type text not null,
  triggered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create table public.pos_rpc_rate_limits (
  license_key text not null,
  device_fingerprint text not null,
  staff_session_hash text,
  rpc_name text not null,
  scope text not null default 'legacy',
  window_start timestamptz not null,
  window_seconds integer not null,
  request_count integer not null,
  blocked_until timestamptz,
  last_limited_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_rpc_rate_limits_fixture_uidx on public.pos_rpc_rate_limits (
  license_key, device_fingerprint, rpc_name, window_start, window_seconds,
  (coalesce(staff_session_hash, ''::text))
);

create function private.license_entitlement_state_v1(p_license_id uuid)
returns table(
  license_id uuid,
  plan_code text,
  plan_name text,
  expires_at timestamptz,
  grace_period_ends timestamptz,
  lifecycle_state text,
  is_entitled boolean,
  is_in_grace boolean,
  effective_features jsonb
)
language sql stable security definer set search_path to '' as $$
  select l.id, p.code, p.name, l.expires_at, null::timestamptz,
         case when l.status = 'active' and (l.expires_at is null or l.expires_at >= now())
              then 'active' else 'administratively_blocked' end,
         l.status = 'active' and (l.expires_at is null or l.expires_at >= now()),
         false,
         case when l.status = 'active' and (l.expires_at is null or l.expires_at >= now())
              then coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
              else '{}'::jsonb end
    from public.licenses l left join public.plans p on p.id = l.plan_id
   where l.id = p_license_id;
$$;
