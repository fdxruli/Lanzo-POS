-- Disposable LOCAL test database only. Existing auth function bodies are loaded
-- from canonical migrations by the runner; this fixture supplies their tables.
create schema extensions;
create schema private;
create extension pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.plans(id uuid primary key, code text, name text, max_devices integer, features jsonb default '{}');
create table public.licenses(id uuid primary key, license_key text unique, plan_id uuid references public.plans(id),
  status text default 'active', expires_at timestamptz, max_devices integer, product_name text, features jsonb default '{}');
create table public.license_devices(id uuid primary key default extensions.gen_random_uuid(), license_id uuid references public.licenses(id),
  device_fingerprint text, device_name text, device_info jsonb default '{}', is_active boolean default true,
  security_token text, previous_security_token text, realtime_topic text, last_check_at timestamptz, last_used_at timestamptz,
  device_role text default 'admin', device_mode text default 'admin_only', staff_user_id uuid);
create table public.business_profiles(license_id uuid references public.licenses(id), business_name text, business_type text[]);
create table public.license_staff_sessions(id uuid primary key default extensions.gen_random_uuid(), device_id uuid,
  revoked_at timestamptz, metadata jsonb default '{}');
create table public.license_events(license_key text, event_type text, triggered_at timestamptz default now(), metadata jsonb);
create table public.pos_rpc_rate_limits(license_key text, device_fingerprint text, staff_session_hash text, rpc_name text,
  scope text, window_start timestamptz, window_seconds integer, request_count integer, blocked_until timestamptz,
  last_limited_at timestamptz, metadata jsonb, created_at timestamptz, updated_at timestamptz);
create unique index rate_fixture_uidx on public.pos_rpc_rate_limits
  (license_key, device_fingerprint, rpc_name, window_start, window_seconds, (coalesce(staff_session_hash,'')));
-- Entitlement is an explicit fixture boundary, not the feature under test.
-- FREE and PRO both require active/unexpired entitlement, as in Production.
create function private.license_entitlement_state_v1(p_id uuid)
returns table(lifecycle_state text, is_entitled boolean, is_in_grace boolean, grace_period_ends timestamptz)
language sql as $$
  select case when status='active' then 'active' else 'administratively_blocked' end,
    status='active' and (expires_at is null or expires_at>now()), false, null::timestamptz
  from public.licenses where id=p_id;
$$;

-- V2 read-only support discovery boundaries; no real billing integration in fixture.
alter table public.licenses add column organization_name text, add column owner_email text;
create table public.subscriptions(license_id uuid,provider text,provider_subscription_id text,customer_email text,status text);
