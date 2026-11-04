-- Narrow 3D.14 dispatcher-helper contract fixture only.
-- Authentication is a strict synthetic adapter; this does not certify C11.
-- Requires a fresh, disposable PostgreSQL 17 database.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$roles$;

create schema private;

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

-- Accept only explicitly named synthetic credentials; this is a helper test,
-- not a replacement for the production Auth implementation.
create function private.validate_pos_sync_context(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text
) returns jsonb
language plpgsql
set search_path = ''
as $fixture$
begin
  if p_license_key = 'fixture-license-a'
     and p_device_fingerprint = 'fixture-device-a'
     and p_security_token = 'fixture-token-a'
     and p_staff_session_token is null then
    return jsonb_build_object(
      'license_id', '00000000-0000-0000-0000-000000000001',
      'device_id', '00000000-0000-0000-0000-00000000000a',
      'actor_type', 'admin',
      'actor_id', '00000000-0000-0000-0000-0000000000aa',
      'admin_user_id', '00000000-0000-0000-0000-0000000000aa'
    );
  elsif p_license_key = 'fixture-license-a'
     and p_device_fingerprint = 'fixture-device-b'
     and p_security_token = 'fixture-token-b'
     and p_staff_session_token is null then
    return jsonb_build_object(
      'license_id', '00000000-0000-0000-0000-000000000001',
      'device_id', '00000000-0000-0000-0000-00000000000b',
      'actor_type', 'admin',
      'actor_id', '00000000-0000-0000-0000-0000000000aa',
      'admin_user_id', '00000000-0000-0000-0000-0000000000aa'
    );
  elsif p_license_key = 'fixture-license-b'
     and p_device_fingerprint = 'fixture-device-b'
     and p_security_token = 'fixture-token-b'
     and p_staff_session_token is null then
    return jsonb_build_object(
      'license_id', '00000000-0000-0000-0000-000000000002',
      'device_id', '00000000-0000-0000-0000-00000000000b',
      'actor_type', 'admin',
      'actor_id', '00000000-0000-0000-0000-0000000000bb',
      'admin_user_id', '00000000-0000-0000-0000-0000000000bb'
    );
  elsif p_license_key = 'fixture-license-a'
     and p_device_fingerprint = 'fixture-device-a'
     and p_security_token = 'fixture-token-a'
     and p_staff_session_token = 'fixture-staff-token' then
    return jsonb_build_object(
      'license_id', '00000000-0000-0000-0000-000000000001',
      'device_id', '00000000-0000-0000-0000-00000000000a',
      'actor_type', 'staff',
      'actor_id', '00000000-0000-0000-0000-0000000000ab',
      'staff_user_id', '00000000-0000-0000-0000-0000000000ab'
    );
  end if;
  raise exception 'FIXTURE_AUTH_REJECTED' using errcode = 'P0001';
end
$fixture$;

create function private.resolve_cash_actor_key(p_context jsonb) returns text
language plpgsql
stable
set search_path = ''
as $fixture$
declare
  v_actor_type text := p_context->>'actor_type';
  v_actor_id uuid := nullif(p_context->>'actor_id', '')::uuid;
begin
  if v_actor_type = 'staff' then
    v_actor_id := coalesce(v_actor_id, nullif(p_context->>'staff_user_id', '')::uuid);
    if v_actor_id is null then raise exception 'STAFF_USER_REQUIRED_FOR_CASH'; end if;
    return 'staff:' || v_actor_id::text;
  end if;
  v_actor_id := coalesce(v_actor_id, nullif(p_context->>'admin_user_id', '')::uuid);
  if v_actor_id is null then raise exception 'ADMIN_SESSION_REQUIRED'; end if;
  return 'admin:' || v_actor_id::text;
end
$fixture$;
