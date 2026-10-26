-- Synthetic schema for the real Auth/permission/station C11 fixture.
-- Production Auth, actor, station, permission, and 3D.14 guard functions are
-- loaded from checked-in migration definitions by the runner.
-- Requires a fresh, disposable PostgreSQL 17 database.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$roles$;

create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create table public.plans (
  id uuid primary key,
  code text,
  name text,
  features jsonb not null default '{}'::jsonb
);

create table public.licenses (
  id uuid primary key,
  license_key text not null unique,
  status text not null,
  is_lifetime boolean not null default true,
  expires_at timestamptz,
  license_type text,
  product_name text,
  plan_id uuid,
  features jsonb not null default '{}'::jsonb
);

create table public.license_devices (
  id uuid primary key,
  license_id uuid not null,
  device_fingerprint text not null,
  security_token text,
  previous_security_token text,
  is_active boolean not null,
  device_mode text not null,
  device_role text,
  staff_user_id uuid,
  realtime_topic text
);

create table public.license_admin_users (
  id uuid primary key,
  license_id uuid not null,
  username text not null,
  display_name text not null,
  is_owner boolean not null,
  is_active boolean not null
);

create table public.license_admin_sessions (
  id uuid primary key,
  license_id uuid not null,
  admin_user_id uuid not null,
  device_id uuid not null,
  session_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.license_staff_users (
  id uuid primary key,
  license_id uuid not null,
  username text not null,
  display_name text not null,
  role_name text not null,
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null
);

create table public.license_staff_sessions (
  id uuid primary key,
  license_id uuid not null,
  staff_user_id uuid not null,
  device_id uuid not null,
  session_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table public.pos_cash_stations (
  id text primary key,
  license_id uuid not null,
  station_key text not null,
  status text not null default 'active',
  binding_mode text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id, station_key)
);

create table public.pos_cash_station_bindings (
  id uuid primary key,
  license_id uuid not null,
  cash_station_id text not null,
  device_id uuid not null,
  binding_mode text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (license_id, device_id)
);

create table public.pos_cash_sessions (
  id text not null,
  license_id uuid not null,
  device_id uuid,
  staff_user_id uuid,
  actor_key text,
  status text not null,
  cash_station_id text,
  deleted_at timestamptz,
  primary key (license_id, id)
);

create table public.pos_restaurant_orders (
  id text primary key,
  license_id uuid not null,
  local_order_id text not null
);

create table public.pos_financial_operations (
  id uuid primary key,
  license_id uuid not null,
  legacy_idempotency_key text not null,
  operation_type text not null,
  status text not null,
  canonical_request jsonb not null,
  verified_actor_key text not null,
  verified_device_id uuid not null,
  verified_cash_session_id text
);

create table public.pos_idempotency_keys (
  id uuid primary key,
  license_id uuid not null,
  idempotency_key text not null,
  operation_type text not null,
  entity_type text,
  entity_id text,
  request_hash text,
  response_payload jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (license_id, idempotency_key)
);

create table public.pos_sales (
  id text not null,
  license_id uuid not null,
  local_sale_id text not null,
  device_id uuid not null,
  actor_key text not null,
  cash_session_id text,
  idempotency_key text not null,
  primary key (license_id, id)
);

create table public.pos_cash_movements (id uuid primary key);
create table public.pos_sale_payments (id uuid primary key);
create table public.pos_inventory_movements (id uuid primary key);
create table public.pos_customer_ledger_entries (id uuid primary key);
