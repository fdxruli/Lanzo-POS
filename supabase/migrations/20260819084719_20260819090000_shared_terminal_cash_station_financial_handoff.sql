-- SHARED.TERMINAL.4
-- CashStation is a financial location/binding. It is not an actor, role, or
-- permission. CashSession.actor_key remains the historical owner.
begin;

-- -----------------------------------------------------------------------------
-- CashStation identity and device bindings.
-- -----------------------------------------------------------------------------
create table if not exists public.pos_cash_stations (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  station_key text not null,
  status text not null default 'active',
  binding_mode text not null default 'device_default',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_cash_stations_status_chk check (status in ('active', 'blocked', 'retired')),
  constraint pos_cash_stations_binding_mode_chk check (binding_mode in ('device_default', 'explicit')),
  constraint pos_cash_stations_license_id_id_uk unique (license_id, id),
  constraint pos_cash_stations_license_station_key_uk unique (license_id, station_key)
);

create table if not exists public.pos_cash_station_bindings (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  cash_station_id text not null,
  device_id uuid not null references public.license_devices(id),
  binding_mode text not null default 'device_default',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_cash_station_bindings_station_fk
    foreign key (license_id, cash_station_id)
    references public.pos_cash_stations(license_id, id),
  constraint pos_cash_station_bindings_device_license_uk unique (license_id, device_id, cash_station_id),
  constraint pos_cash_station_bindings_mode_chk check (binding_mode in ('device_default', 'explicit')),
  constraint pos_cash_station_bindings_status_chk check (status in ('active', 'retired'))
);

create unique index if not exists ux_pos_cash_station_bindings_active_device
  on public.pos_cash_station_bindings (license_id, device_id)
  where status = 'active';

create unique index if not exists ux_pos_cash_station_bindings_active_station_device
  on public.pos_cash_station_bindings (license_id, cash_station_id, device_id)
  where status = 'active';

create index if not exists idx_pos_cash_station_bindings_license_station
  on public.pos_cash_station_bindings (license_id, cash_station_id, status);

alter table public.pos_cash_sessions
  add column if not exists cash_station_id text null,
  add column if not exists opened_by_actor_key text null,
  add column if not exists closed_by_actor_key text null;

alter table public.pos_cash_movements
  add column if not exists cash_station_id text null,
  add column if not exists performed_by_actor_key text null;

alter table public.pos_cash_sessions
  drop constraint if exists pos_cash_sessions_station_fk;
alter table public.pos_cash_sessions
  add constraint pos_cash_sessions_station_fk
  foreign key (license_id, cash_station_id)
  references public.pos_cash_stations(license_id, id);

alter table public.pos_cash_movements
  drop constraint if exists pos_cash_movements_station_fk;
alter table public.pos_cash_movements
  add constraint pos_cash_movements_station_fk
  foreign key (license_id, cash_station_id)
  references public.pos_cash_stations(license_id, id);

-- -----------------------------------------------------------------------------
-- Conservative deterministic adoption. The only historical relation used is
-- the immutable license/device pair already present in the cash rows. No actor
-- ownership is rewritten, and rows without that evidence remain unresolved.
-- -----------------------------------------------------------------------------
insert into public.pos_cash_stations (id, license_id, station_key, binding_mode, metadata)
select
  'cash_station_device_' || device_id::text,
  license_id,
  'device_default:' || device_id::text,
  'device_default',
  jsonb_build_object('identity_source', 'deterministic-device-bound', 'bound_device_id', device_id)
from (
  select distinct license_id, device_id
  from public.pos_cash_sessions
  where device_id is not null
) historical_devices
on conflict (license_id, station_key) do nothing;

insert into public.pos_cash_station_bindings (
  license_id, cash_station_id, device_id, binding_mode, status, metadata
)
select
  s.license_id,
  s.id,
  historical_devices.device_id,
  'device_default',
  'active',
  jsonb_build_object('identity_source', 'deterministic-device-bound')
from (
  select distinct license_id, device_id
  from public.pos_cash_sessions
  where device_id is not null
) historical_devices
join public.pos_cash_stations s
  on s.license_id = historical_devices.license_id
 and s.station_key = 'device_default:' || historical_devices.device_id::text
on conflict do nothing;

update public.pos_cash_sessions s
set cash_station_id = station.id,
    opened_by_actor_key = coalesce(s.opened_by_actor_key, s.actor_key),
    metadata = coalesce(s.metadata, '{}'::jsonb)
      || jsonb_build_object('cash_station_identity', 'deterministic-device-bound')
from public.pos_cash_stations station
where s.cash_station_id is null
  and s.device_id is not null
  and station.license_id = s.license_id
  and station.station_key = 'device_default:' || s.device_id::text;

update public.pos_cash_movements m
set cash_station_id = s.cash_station_id
from public.pos_cash_sessions s
where m.cash_station_id is null
  and m.license_id = s.license_id
  and m.cash_session_id = s.id
  and s.cash_station_id is not null;

update public.pos_cash_movements m
set performed_by_actor_key = coalesce(
  m.performed_by_actor_key,
  nullif(m.metadata->>'performed_by_actor_key', ''),
  m.actor_key
)
where m.performed_by_actor_key is null;

-- Refuse to create the exclusivity constraint over an already-conflicted
-- production state. The migration must be explicitly recovered/audited first.
do $$
declare
  v_conflict_count integer;
begin
  select count(*) into v_conflict_count
  from (
    select license_id, cash_station_id
    from public.pos_cash_sessions
    where status = 'open' and deleted_at is null and cash_station_id is not null
    group by license_id, cash_station_id
    having count(*) > 1
  ) conflicts;

  if v_conflict_count > 0 then
    raise exception 'SHARED_TERMINAL_4_BLOCKED_OPEN_STATION_CONFLICTS:%', v_conflict_count
      using errcode = 'P0001';
  end if;
end;
$$;

create unique index if not exists ux_pos_cash_sessions_open_station
  on public.pos_cash_sessions (license_id, cash_station_id)
  where status = 'open' and deleted_at is null and cash_station_id is not null;

create index if not exists idx_pos_cash_sessions_license_station_opened
  on public.pos_cash_sessions (license_id, cash_station_id, opened_at desc);
create index if not exists idx_pos_cash_movements_license_station_created
  on public.pos_cash_movements (license_id, cash_station_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Locked helper: resolve station binding without making a device an owner.
-- A previously unseen device cannot silently open while another session exists;
-- that is the device-replacement/physical-drawer fail-closed path.
-- -----------------------------------------------------------------------------
create or replace function private.resolve_cash_station_for_device(
  p_license_id uuid,
  p_device_id uuid,
  p_create_default boolean default false
)
returns public.pos_cash_stations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.pos_cash_stations;
  v_active_bindings integer;
  v_open_sessions integer;
  v_station_id text := 'cash_station_device_' || p_device_id::text;
  v_station_key text := 'device_default:' || p_device_id::text;
begin
  if p_license_id is null or p_device_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;

  select count(*) into v_active_bindings
  from public.pos_cash_station_bindings b
  where b.license_id = p_license_id
    and b.device_id = p_device_id
    and b.status = 'active';

  if v_active_bindings > 1 then
    raise exception 'CASH_STATION_BINDING_AMBIGUOUS' using errcode = 'P0001';
  end if;

  select s.* into v_station
  from public.pos_cash_station_bindings b
  join public.pos_cash_stations s
    on s.license_id = b.license_id and s.id = b.cash_station_id
  where b.license_id = p_license_id
    and b.device_id = p_device_id
    and b.status = 'active'
  limit 1;

  if v_station.id is not null then
    if v_station.status <> 'active' then
      raise exception 'CASH_STATION_BLOCKED' using errcode = 'P0001';
    end if;
    return v_station;
  end if;

  if not p_create_default then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;

  select count(*) into v_open_sessions
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.status = 'open'
    and s.deleted_at is null;

  if v_open_sessions > 0 then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;

  insert into public.pos_cash_stations (id, license_id, station_key, binding_mode, metadata)
  values (
    v_station_id,
    p_license_id,
    v_station_key,
    'device_default',
    jsonb_build_object('identity_source', 'deterministic-device-bound', 'bound_device_id', p_device_id)
  )
  on conflict (license_id, station_key) do nothing;

  insert into public.pos_cash_station_bindings (
    license_id, cash_station_id, device_id, binding_mode, status, metadata
  ) values (
    p_license_id,
    v_station_id,
    p_device_id,
    'device_default',
    'active',
    jsonb_build_object('identity_source', 'deterministic-device-bound')
  ) on conflict do nothing;

  select * into v_station
  from public.pos_cash_stations s
  where s.license_id = p_license_id and s.station_key = v_station_key
  limit 1;

  if v_station.id is null or v_station.status <> 'active' then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  return v_station;
end;
$$;

create or replace function private.assert_cash_session_station(
  p_license_id uuid,
  p_device_id uuid,
  p_cash_session_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.pos_cash_stations;
  v_session public.pos_cash_sessions;
begin
  v_station := private.resolve_cash_station_for_device(p_license_id, p_device_id, false);
  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null or v_session.cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if v_session.cash_station_id <> v_station.id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;
  return v_station.id;
end;
$$;

-- Every movement, including sale/cancellation/refund routes that insert
-- directly, inherits the session station and can never jump sessions.
create or replace function private.pos_cash_movement_station_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.pos_cash_sessions;
begin
  if tg_op = 'UPDATE' then
    if new.cash_session_id <> old.cash_session_id
       or coalesce(new.cash_station_id, '') <> coalesce(old.cash_station_id, '')
       or new.license_id <> old.license_id then
      raise exception 'CASH_SESSION_STATION_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = new.license_id
    and s.id = new.cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null or v_session.cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if new.cash_station_id is not null and new.cash_station_id <> v_session.cash_station_id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;
  new.cash_station_id := v_session.cash_station_id;
  new.actor_key := coalesce(new.actor_key, v_session.actor_key);
  new.performed_by_actor_key := coalesce(
    new.performed_by_actor_key,
    nullif(new.metadata->>'performed_by_actor_key', '')
  );
  return new;
end;
$$;

drop trigger if exists pos_cash_movements_station_guard on public.pos_cash_movements;
create trigger pos_cash_movements_station_guard
before insert or update on public.pos_cash_movements
for each row execute function private.pos_cash_movement_station_guard();

-- -----------------------------------------------------------------------------
-- Canonical financial preflight used by the client gate. Authentication is
-- still validated independently; this response only describes cash access.
-- -----------------------------------------------------------------------------
create or replace function public.pos_get_cash_station_state(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_station public.pos_cash_stations;
  v_own_session public.pos_cash_sessions;
  v_station_open public.pos_cash_sessions;
  v_other_station_session public.pos_cash_sessions;
  v_status text;
  v_code text;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_station := private.resolve_cash_station_for_device(v_license_id, v_device_id, true);

  select * into v_own_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.cash_station_id = v_station.id
    and s.actor_key = v_actor_key
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1;

  select * into v_station_open
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.cash_station_id = v_station.id
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1;

  select * into v_other_station_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.actor_key = v_actor_key
    and s.status = 'open'
    and s.deleted_at is null
    and s.cash_station_id is distinct from v_station.id
  order by s.opened_at desc
  limit 1;

  if v_station_open.id is not null and v_station_open.actor_key <> v_actor_key then
    v_status := 'HANDOFF_REQUIRED';
    v_code := 'CASH_HANDOFF_REQUIRED';
  elsif v_own_session.id is not null then
    v_status := 'OWN_SESSION_OPEN';
    v_code := null;
  elsif v_other_station_session.id is not null then
    v_status := 'BLOCKED';
    v_code := 'CASH_SESSION_ALREADY_OPEN';
  else
    v_status := 'NO_SESSION';
    v_code := null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'financial_status', v_status,
    'financial_code', v_code,
    'cash_station', to_jsonb(v_station),
    'cash_session', case when v_own_session.id is null then null else private.pos_cash_session_to_jsonb(v_own_session) end,
    'station_open_cash_session', case when v_station_open.id is null then null else private.pos_cash_session_to_jsonb(v_station_open) end,
    'actor_key', v_actor_key,
    'cash_station_id', v_station.id,
    'sync_context', jsonb_strip_nulls(jsonb_build_object(
      'device_role', v_context->>'device_role',
      'staff_user_id', v_context->>'staff_user_id',
      'admin_user_id', v_context->>'admin_user_id',
      'cash_station_id', v_station.id
    ))
  ));
end;
$$;

grant execute on function public.pos_get_cash_station_state(text, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Opening is rewritten narrowly so the station row is locked before insert.
-- The partial unique index remains the final race-safe invariant.
-- -----------------------------------------------------------------------------
create or replace function public.pos_open_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_opening jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_role text;
  v_actor_key text;
  v_actor_name text;
  v_station public.pos_cash_stations;
  v_station_open public.pos_cash_sessions;
  v_existing public.pos_cash_sessions;
  v_session public.pos_cash_sessions;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted boolean;
  v_opening numeric;
  v_counted numeric;
  v_suggested numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_station := private.resolve_cash_station_for_device(v_license_id, v_device_id, true);

  v_opening := greatest(coalesce(nullif(p_opening->>'opening_amount', '')::numeric, nullif(p_opening->>'montoInicial', '')::numeric, 0), 0);
  v_counted := greatest(coalesce(nullif(p_opening->>'opening_counted_amount', '')::numeric, nullif(p_opening->>'montoContado', '')::numeric, v_opening), 0);
  v_suggested := greatest(coalesce(nullif(p_opening->>'opening_suggested_amount', '')::numeric, nullif(p_opening->>'montoSugerido', '')::numeric, 0), 0);

  v_inserted := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.open', 'cash_session', null, null);
  if not v_inserted then
    select * into v_idem from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'idempotency_key', p_idempotency_key);
  end if;

  -- Serialize opens for this physical/logical station.
  select * into v_station
  from public.pos_cash_stations s
  where s.license_id = v_license_id and s.id = v_station.id
  for update;

  select * into v_station_open
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.cash_station_id = v_station.id
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if v_station_open.id is not null then
    if v_station_open.actor_key = v_actor_key then
      v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_ALREADY_OPEN', 'cash_session', private.pos_cash_session_to_jsonb(v_station_open), 'idempotency_key', p_idempotency_key);
    else
      v_response := jsonb_build_object('success', false, 'code', 'CASH_HANDOFF_REQUIRED', 'message', 'La estación tiene una sesión abierta de otro actor; requiere cierre y reconciliación.', 'cash_session', private.pos_cash_session_to_jsonb(v_station_open), 'cash_station_id', v_station.id, 'idempotency_key', p_idempotency_key);
    end if;
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  select * into v_existing
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.actor_key = v_actor_key
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1;

  if v_existing.id is not null then
    v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_ALREADY_OPEN', 'message', 'El actor ya tiene una sesión de caja abierta en otra estación.', 'cash_session', private.pos_cash_session_to_jsonb(v_existing), 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  insert into public.pos_cash_sessions (
    id, license_id, device_id, staff_user_id, admin_user_id, device_role, scope, actor_key, status,
    cash_station_id, opened_by_actor_key,
    opening_amount, opening_counted_amount, opening_suggested_amount, opening_difference,
    opening_policy, opening_origin, is_auto_opening, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    'cash_' || replace(gen_random_uuid()::text, '-', ''),
    v_license_id, v_device_id, v_staff_user_id, v_admin_user_id, v_role, 'actor', v_actor_key, 'open',
    v_station.id, v_actor_key,
    v_opening, v_counted, v_suggested, v_counted - v_suggested,
    nullif(btrim(coalesce(p_opening->>'opening_policy', p_opening->>'politicaApertura', 'manual')), ''),
    nullif(btrim(coalesce(p_opening->>'opening_origin', p_opening->>'origen', 'manual')), ''),
    coalesce((p_opening->>'is_auto_opening')::boolean, (p_opening->>'esAutoApertura')::boolean, false),
    v_opening,
    case when v_role = 'staff' then v_actor_name else coalesce(nullif(btrim(p_opening->>'responsible_name'), ''), nullif(btrim(p_opening->>'responsable'), ''), v_actor_name, 'Administrador') end,
    v_device_id, v_staff_user_id, p_idempotency_key,
    coalesce(p_opening->'metadata', '{}'::jsonb)
      || jsonb_build_object('phase', 'shared_terminal_4_cash_station', 'cash_station_id', v_station.id, 'origin_actor_key', v_actor_key)
  ) returning * into v_session;

  perform private.record_pos_cash_event(v_license_id, v_session.id, 'OPENED', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('actor_key', v_actor_key, 'cash_station_id', v_station.id));
  v_event := private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'open', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'cash_station_id', v_station.id, 'actor_key', v_actor_key), v_session.server_version);
  v_response := jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'cash_station', to_jsonb(v_station), 'event', to_jsonb(v_event), 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  select * into v_station_open
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.cash_station_id = v_station.id
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1;
  if v_station_open.id is not null and v_station_open.actor_key <> v_actor_key then
    v_response := jsonb_build_object('success', false, 'code', 'CASH_HANDOFF_REQUIRED', 'message', 'La estación tiene una sesión abierta de otro actor; requiere cierre y reconciliación.', 'cash_session', private.pos_cash_session_to_jsonb(v_station_open), 'cash_station_id', v_station.id, 'idempotency_key', p_idempotency_key);
  else
    select * into v_existing from public.pos_cash_sessions s where s.license_id = v_license_id and s.actor_key = v_actor_key and s.status = 'open' and s.deleted_at is null order by s.opened_at desc limit 1;
    v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_ALREADY_OPEN', 'cash_session', case when v_existing.id is null then null else private.pos_cash_session_to_jsonb(v_existing) end, 'idempotency_key', p_idempotency_key);
  end if;
  if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
  return v_response;
end;
$$;

-- -----------------------------------------------------------------------------
-- Existing financial RPCs keep their idempotency/audit contracts. These narrow
-- replacements remove the old admin-foreign movement/normal-close allowance and
-- require the exact actor + bound station. Admin audited close remains the only
-- cross-actor resolution path.
-- -----------------------------------------------------------------------------
do $$
declare
  v_oid oid;
  v_definition text;
  v_signature text;
begin
  foreach v_signature in array array[
    'public.pos_register_cash_movement_unlimited(text,text,text,text,text,text,numeric,text,text,jsonb)',
    'public.pos_adjust_initial_cash_fund_unlimited(text,text,text,text,text,numeric,text,integer,text)',
    'public.pos_close_cash_session_unlimited(text,text,text,text,text,jsonb,integer,text)'
  ] loop
    v_oid := v_signature::regprocedure;
    v_definition := pg_get_functiondef(v_oid);
    if position('assert_cash_session_station' in v_definition) > 0 then
      continue;
    end if;
    if position('v_session.actor_key' in v_definition) = 0
       or position('CASH_SESSION_FORBIDDEN' in v_definition) = 0 then
      raise exception 'SHARED_TERMINAL_4_FUNCTION_SHAPE_UNEXPECTED:%', v_signature using errcode = 'P0001';
    end if;

    v_definition := replace(v_definition,
      $old$if coalesce(v_context->>'device_role', 'staff') = 'staff' and v_session.actor_key <> v_actor_key then$old$,
      $new$if v_session.actor_key <> v_actor_key then$new$
    );
    v_definition := replace(v_definition, $old$CASH_SESSION_FORBIDDEN$old$, $new$CASH_HANDOFF_REQUIRED$new$);
    v_definition := replace(v_definition,
      $old$if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;$old$,
      $new$if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;
  perform private.assert_cash_session_station(v_license_id, v_device_id, v_session.id);$new$
    );
    v_definition := replace(v_definition,
      $old$if v_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;$old$,
      $new$if v_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  perform private.assert_cash_session_station(v_license_id, v_device_id, v_session.id);$new$
    );
    if position('assert_cash_session_station' in v_definition) = 0 then
      raise exception 'SHARED_TERMINAL_4_SESSION_STATION_GUARD_MISSING:%', v_signature using errcode = 'P0001';
    end if;
    if v_signature like '%pos_close_cash_session_unlimited%' then
      v_definition := replace(v_definition, 'closed_by_staff_user_id = v_staff_user_id,', 'closed_by_staff_user_id = v_staff_user_id,' || chr(10) || '      closed_by_actor_key = v_actor_key,');
    end if;
    execute v_definition;
  end loop;
end;
$$;

-- Cloud cashier and credit already require an exact actor. Add the station
-- assertion without changing their payment/card policy or idempotency keys.
do $$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position('assert_cash_session_station' in v_definition) > 0 then
      continue;
    end if;
    if position('v_cash_session.actor_key <> v_actor_key' in v_definition) = 0
       or position('CASH_SESSION_FORBIDDEN' in v_definition) = 0 then
      raise exception 'SHARED_TERMINAL_4_CLOUD_SALE_FUNCTION_SHAPE_UNEXPECTED:%', v_signature using errcode = 'P0001';
    end if;
    v_definition := replace(v_definition, $old$CASH_SESSION_FORBIDDEN$old$, $new$CASH_HANDOFF_REQUIRED$new$);
    v_definition := replace(v_definition,
      $old$if v_cash_session.actor_key <> v_actor_key then
      raise exception 'CASH_HANDOFF_REQUIRED' using errcode = 'P0001';
    end if;$old$,
      $new$perform private.assert_cash_session_station(v_license_id, v_device_id, v_cash_session.id);
    if v_cash_session.actor_key <> v_actor_key then
      raise exception 'CASH_HANDOFF_REQUIRED' using errcode = 'P0001';
    end if;$new$
    );
    v_definition := replace(v_definition,
      $old$if v_cash_session.actor_key <> v_actor_key then raise exception 'CASH_HANDOFF_REQUIRED' using errcode = 'P0001'; end if;$old$,
      $new$perform private.assert_cash_session_station(v_license_id, v_device_id, v_cash_session.id);
  if v_cash_session.actor_key <> v_actor_key then raise exception 'CASH_HANDOFF_REQUIRED' using errcode = 'P0001'; end if;$new$
    );
    if position('assert_cash_session_station' in v_definition) = 0 then
      raise exception 'SHARED_TERMINAL_4_CLOUD_SALE_STATION_GUARD_MISSING:%', v_signature using errcode = 'P0001';
    end if;
    execute v_definition;
  end loop;
end;
$$;

-- Keep the existing audited close path and extend only its explicit performed
-- actor provenance when the current function exposes the stable admin field.
do $$
declare
  v_oid oid;
  v_definition text;
begin
  v_oid := 'public.pos_admin_close_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_oid);
  if position('closed_by_admin_user_id' in v_definition) > 0
     and position('closed_by_actor_key' in v_definition) = 0 then
    v_definition := replace(v_definition, 'closed_by_admin_user_id = v_admin_user_id,', 'closed_by_admin_user_id = v_admin_user_id,' || chr(10) || '      closed_by_actor_key = v_actor_key,');
    execute v_definition;
  end if;
exception when undefined_function then
  -- The pre-existing audited close contract is verified separately by the
  -- migration report; do not invent a second close implementation here.
  null;
end;
$$;

-- New columns are returned by the existing to_jsonb-based session mapper. Make
-- the movement mapper equally explicit so pull/sync preserves station and
-- performed-by provenance.
create or replace function private.pos_cash_movement_to_jsonb(p_movement public.pos_cash_movements)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(to_jsonb(p_movement));
$$;

alter table public.pos_cash_stations enable row level security;
alter table public.pos_cash_station_bindings enable row level security;

do $$
begin
  drop policy if exists pos_cash_stations_no_direct_client_select on public.pos_cash_stations;
  drop policy if exists pos_cash_stations_no_direct_client_insert on public.pos_cash_stations;
  drop policy if exists pos_cash_stations_no_direct_client_update on public.pos_cash_stations;
  drop policy if exists pos_cash_stations_no_direct_client_delete on public.pos_cash_stations;
  drop policy if exists pos_cash_station_bindings_no_direct_client_select on public.pos_cash_station_bindings;
  drop policy if exists pos_cash_station_bindings_no_direct_client_insert on public.pos_cash_station_bindings;
  drop policy if exists pos_cash_station_bindings_no_direct_client_update on public.pos_cash_station_bindings;
  drop policy if exists pos_cash_station_bindings_no_direct_client_delete on public.pos_cash_station_bindings;
end;
$$;

create policy pos_cash_stations_no_direct_client_select on public.pos_cash_stations for select to anon, authenticated using (false);
create policy pos_cash_stations_no_direct_client_insert on public.pos_cash_stations for insert to anon, authenticated with check (false);
create policy pos_cash_stations_no_direct_client_update on public.pos_cash_stations for update to anon, authenticated using (false) with check (false);
create policy pos_cash_stations_no_direct_client_delete on public.pos_cash_stations for delete to anon, authenticated using (false);
create policy pos_cash_station_bindings_no_direct_client_select on public.pos_cash_station_bindings for select to anon, authenticated using (false);
create policy pos_cash_station_bindings_no_direct_client_insert on public.pos_cash_station_bindings for insert to anon, authenticated with check (false);
create policy pos_cash_station_bindings_no_direct_client_update on public.pos_cash_station_bindings for update to anon, authenticated using (false) with check (false);
create policy pos_cash_station_bindings_no_direct_client_delete on public.pos_cash_station_bindings for delete to anon, authenticated using (false);

comment on table public.pos_cash_stations is 'SHARED.TERMINAL.4 financial station identity; never an actor or permission owner.';
comment on column public.pos_cash_sessions.cash_station_id is 'Physical/logical cash station. Actor ownership remains actor_key.';
comment on column public.pos_cash_sessions.opened_by_actor_key is 'Immutable opening provenance; never changed on logout or handoff.';
comment on column public.pos_cash_sessions.closed_by_actor_key is 'Actor who performed the closure; does not replace the session owner.';
comment on column public.pos_cash_movements.performed_by_actor_key is 'Actor that performed the movement, distinct from the session owner actor_key.';

commit;
