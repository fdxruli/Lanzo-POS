-- FASE 0 — Motor base de sincronización PRO
-- Migración no destructiva: tablas base, helpers privados, RPC pull y feature flag.

create schema if not exists private;

-- 1) Secuencia global ordenable para cambios POS.
create sequence if not exists public.pos_change_seq as bigint;

-- 2) Eventos oficiales de sincronización por licencia.
create table if not exists public.pos_sync_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  change_seq bigint not null default nextval('public.pos_change_seq'),
  server_version integer not null default 1,
  actor_device_id uuid null references public.license_devices(id),
  actor_staff_user_id uuid null references public.license_staff_users(id),
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pos_sync_events_operation_check check (operation in ('create', 'update', 'delete', 'restore', 'upsert', 'sync_checkpoint', 'unknown')),
  constraint pos_sync_events_server_version_check check (server_version > 0)
);

create index if not exists idx_pos_sync_events_license_seq
  on public.pos_sync_events (license_id, change_seq);

create index if not exists idx_pos_sync_events_license_entity
  on public.pos_sync_events (license_id, entity_type, entity_id);

create index if not exists idx_pos_sync_events_created_at
  on public.pos_sync_events (created_at);

create unique index if not exists ux_pos_sync_events_license_change_seq
  on public.pos_sync_events (license_id, change_seq);

-- 3) Idempotencia para RPCs futuras.
create table if not exists public.pos_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  idempotency_key text not null,
  operation_type text not null,
  entity_type text null,
  entity_id text null,
  request_hash text null,
  response_payload jsonb null,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  constraint pos_idempotency_keys_status_check check (status in ('processing', 'completed', 'failed'))
);

create unique index if not exists ux_pos_idempotency_license_key
  on public.pos_idempotency_keys (license_id, idempotency_key);

create index if not exists idx_pos_idempotency_expires_at
  on public.pos_idempotency_keys (expires_at)
  where expires_at is not null;

create index if not exists idx_pos_idempotency_license_entity
  on public.pos_idempotency_keys (license_id, entity_type, entity_id);

-- 4) Conflictos POS para resolución posterior.
create table if not exists public.pos_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  conflict_type text not null,
  local_payload jsonb null,
  server_payload jsonb null,
  resolution_status text not null default 'pending',
  resolved_payload jsonb null,
  actor_device_id uuid null references public.license_devices(id),
  actor_staff_user_id uuid null references public.license_staff_users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint pos_sync_conflicts_resolution_status_check check (resolution_status in ('pending', 'resolved', 'ignored'))
);

create index if not exists idx_pos_sync_conflicts_license_status
  on public.pos_sync_conflicts (license_id, resolution_status);

create index if not exists idx_pos_sync_conflicts_license_entity
  on public.pos_sync_conflicts (license_id, entity_type, entity_id);

create index if not exists idx_pos_sync_conflicts_created_at
  on public.pos_sync_conflicts (created_at);

-- 5) RLS defensivo: el frontend no escribe/lee tablas directas; usa RPC.
alter table public.pos_sync_events enable row level security;
alter table public.pos_idempotency_keys enable row level security;
alter table public.pos_sync_conflicts enable row level security;

revoke all on public.pos_sync_events from anon, authenticated;
revoke all on public.pos_idempotency_keys from anon, authenticated;
revoke all on public.pos_sync_conflicts from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_events' and policyname = 'pos_sync_events_no_direct_client_select'
  ) then
    create policy "pos_sync_events_no_direct_client_select"
      on public.pos_sync_events for select to anon, authenticated using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_events' and policyname = 'pos_sync_events_no_direct_client_insert'
  ) then
    create policy "pos_sync_events_no_direct_client_insert"
      on public.pos_sync_events for insert to anon, authenticated with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_events' and policyname = 'pos_sync_events_no_direct_client_update'
  ) then
    create policy "pos_sync_events_no_direct_client_update"
      on public.pos_sync_events for update to anon, authenticated using (false) with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_events' and policyname = 'pos_sync_events_no_direct_client_delete'
  ) then
    create policy "pos_sync_events_no_direct_client_delete"
      on public.pos_sync_events for delete to anon, authenticated using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_idempotency_keys' and policyname = 'pos_idempotency_no_direct_client_select'
  ) then
    create policy "pos_idempotency_no_direct_client_select"
      on public.pos_idempotency_keys for select to anon, authenticated using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_idempotency_keys' and policyname = 'pos_idempotency_no_direct_client_insert'
  ) then
    create policy "pos_idempotency_no_direct_client_insert"
      on public.pos_idempotency_keys for insert to anon, authenticated with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_idempotency_keys' and policyname = 'pos_idempotency_no_direct_client_update'
  ) then
    create policy "pos_idempotency_no_direct_client_update"
      on public.pos_idempotency_keys for update to anon, authenticated using (false) with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_idempotency_keys' and policyname = 'pos_idempotency_no_direct_client_delete'
  ) then
    create policy "pos_idempotency_no_direct_client_delete"
      on public.pos_idempotency_keys for delete to anon, authenticated using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_conflicts' and policyname = 'pos_sync_conflicts_no_direct_client_select'
  ) then
    create policy "pos_sync_conflicts_no_direct_client_select"
      on public.pos_sync_conflicts for select to anon, authenticated using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_conflicts' and policyname = 'pos_sync_conflicts_no_direct_client_insert'
  ) then
    create policy "pos_sync_conflicts_no_direct_client_insert"
      on public.pos_sync_conflicts for insert to anon, authenticated with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_conflicts' and policyname = 'pos_sync_conflicts_no_direct_client_update'
  ) then
    create policy "pos_sync_conflicts_no_direct_client_update"
      on public.pos_sync_conflicts for update to anon, authenticated using (false) with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pos_sync_conflicts' and policyname = 'pos_sync_conflicts_no_direct_client_delete'
  ) then
    create policy "pos_sync_conflicts_no_direct_client_delete"
      on public.pos_sync_conflicts for delete to anon, authenticated using (false);
  end if;
end $$;

-- 6) Feature helper de sync cloud POS.
create or replace function private.cloud_pos_sync_enabled(p_plan_features jsonb, p_license_features jsonb)
returns boolean
language sql
stable
set search_path to ''
as $$
  select coalesce(
    ((coalesce(p_plan_features, '{}'::jsonb) || coalesce(p_license_features, '{}'::jsonb))->>'cloud_pos_sync') = 'true',
    false
  );
$$;

-- 7) Contexto seguro reusable para RPCs POS futuras.
create or replace function private.validate_pos_sync_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license record;
  v_device record;
  v_staff_user record;
  v_session record;
  v_features jsonb;
  v_staff_payload jsonb := null;
begin
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
    d.is_active,
    coalesce(d.device_role, 'staff') as device_role,
    d.staff_user_id,
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

  if v_device.security_token is null or p_security_token is null or p_security_token = '' then
    raise exception 'DEVICE_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  if p_security_token <> v_device.security_token then
    raise exception 'DEVICE_TOKEN_INVALID' using errcode = 'P0001';
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then
      raise exception 'STAFF_LOGIN_REQUIRED' using errcode = 'P0001';
    end if;

    if p_staff_session_token is null or p_staff_session_token = '' then
      raise exception 'STAFF_SESSION_REQUIRED' using errcode = 'P0001';
    end if;

    select
      ss.id as session_id,
      ss.expires_at,
      ss.revoked_at,
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
      and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    limit 1;

    if v_session.session_id is null then
      raise exception 'STAFF_SESSION_INVALID' using errcode = 'P0001';
    end if;

    if v_session.revoked_at is not null or v_session.expires_at < now() then
      raise exception 'STAFF_SESSION_EXPIRED' using errcode = 'P0001';
    end if;

    if v_session.staff_is_active is not true then
      raise exception 'STAFF_USER_INACTIVE' using errcode = 'P0001';
    end if;

    update public.license_staff_sessions
    set last_seen_at = now()
    where id = v_session.session_id;

    v_staff_payload := jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', coalesce(v_session.permissions, '{}'::jsonb)
    );
  else
    v_staff_payload := null;
  end if;

  return jsonb_build_object(
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_role', v_device.device_role,
    'staff_user_id', case when v_staff_payload is null then null else v_session.staff_user_id end,
    'staff_permissions', coalesce(v_session.permissions, '{}'::jsonb),
    'staff_user', v_staff_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_features, '{}'::jsonb),
    'realtime_topic', v_device.realtime_topic
  );
end;
$$;

create or replace function private.assert_pos_permission(
  p_context jsonb,
  p_permission text
)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return;
  end if;

  if coalesce((p_context->'staff_permissions'->>p_permission)::boolean, false) is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:%', p_permission using errcode = 'P0001';
end;
$$;

create or replace function private.next_pos_change_seq()
returns bigint
language sql
volatile
set search_path to ''
as $$
  select nextval('public.pos_change_seq');
$$;

create or replace function private.record_pos_sync_event(
  p_license_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_actor_device_id uuid default null,
  p_actor_staff_user_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_server_version integer default 1
)
returns public.pos_sync_events
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_event public.pos_sync_events;
begin
  insert into public.pos_sync_events (
    license_id,
    entity_type,
    entity_id,
    operation,
    change_seq,
    server_version,
    actor_device_id,
    actor_staff_user_id,
    idempotency_key,
    metadata
  ) values (
    p_license_id,
    p_entity_type,
    p_entity_id,
    coalesce(p_operation, 'unknown'),
    private.next_pos_change_seq(),
    coalesce(p_server_version, 1),
    p_actor_device_id,
    p_actor_staff_user_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_event;

  perform private.broadcast_pos_event(
    p_license_id,
    jsonb_build_object(
      'entity_type', v_event.entity_type,
      'entity_id', v_event.entity_id,
      'operation', v_event.operation,
      'change_seq', v_event.change_seq,
      'server_version', v_event.server_version,
      'actor_device_id', v_event.actor_device_id,
      'actor_staff_user_id', v_event.actor_staff_user_id,
      'created_at', v_event.created_at
    )
  );

  return v_event;
end;
$$;

create or replace function private.can_access_pos_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where p_topic like 'pos:%'
      and d.realtime_topic is not null
      and p_topic = ('pos:' || split_part(d.realtime_topic, ':', 2))
      and d.is_active = true
      and d.security_token is not null
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at >= now())
      and private.cloud_pos_sync_enabled(p.features, l.features)
  );
$$;

create or replace function private.broadcast_pos_event(
  p_license_id uuid,
  p_event jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_device record;
  v_safe_payload jsonb;
begin
  v_safe_payload := jsonb_strip_nulls(jsonb_build_object(
    'entity_type', p_event->>'entity_type',
    'entity_id', p_event->>'entity_id',
    'operation', p_event->>'operation',
    'change_seq', (p_event->>'change_seq')::bigint,
    'server_version', coalesce((p_event->>'server_version')::integer, 1),
    'actor_device_id', p_event->>'actor_device_id',
    'actor_staff_user_id', p_event->>'actor_staff_user_id',
    'created_at', p_event->>'created_at'
  ));

  for v_device in
    select
      'pos:' || split_part(d.realtime_topic, ':', 2) as pos_topic
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where d.license_id = p_license_id
      and d.is_active = true
      and d.realtime_topic is not null
      and private.cloud_pos_sync_enabled(p.features, l.features)
  loop
    perform realtime.send(
      v_safe_payload,
      'pos_event',
      v_device.pos_topic,
      true
    );
  end loop;
end;
$$;

-- 8) Política RLS para recibir Broadcast POS privado.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'Lanzo private POS broadcast receive'
  ) then
    create policy "Lanzo private POS broadcast receive"
      on realtime.messages
      for select
      to anon, authenticated
      using (
        extension = 'broadcast'::text
        and private.can_access_pos_realtime_topic((select realtime.topic()))
      );
  end if;
end $$;

-- 9) RPC pública base para pull incremental.
create or replace function public.pos_pull_sync_events(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_since_change_seq bigint default 0,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer;
  v_events jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  if coalesce((v_context->'features'->>'cloud_pos_sync')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'CLOUD_POS_SYNC_DISABLED',
      'message', 'La sincronizacion cloud POS no esta habilitada para este plan.',
      'events', '[]'::jsonb,
      'latest_change_seq', coalesce(p_since_change_seq, 0),
      'server_latest_change_seq', coalesce(p_since_change_seq, 0),
      'has_more', false
    );
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);

  with pulled as (
    select
      e.id,
      e.entity_type,
      e.entity_id,
      e.operation,
      e.change_seq,
      e.server_version,
      e.actor_device_id,
      e.actor_staff_user_id,
      e.idempotency_key,
      e.metadata,
      e.created_at
    from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.change_seq > coalesce(p_since_change_seq, 0)
    order by e.change_seq asc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc), '[]'::jsonb),
    coalesce(max(pulled.change_seq), coalesce(p_since_change_seq, 0))
  into v_events, v_latest_returned
  from pulled;

  select coalesce(max(e.change_seq), coalesce(p_since_change_seq, 0))
  into v_server_latest
  from public.pos_sync_events e
  where e.license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'events', v_events,
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned,
    'sync_context', jsonb_build_object(
      'device_role', v_context->>'device_role',
      'plan_code', v_context->>'plan_code',
      'cloud_pos_sync', coalesce((v_context->'features'->>'cloud_pos_sync')::boolean, false)
    )
  );
end;
$$;

grant execute on function public.pos_pull_sync_events(text, text, text, text, bigint, integer) to anon, authenticated;

-- 10) Feature flag: solo PRO habilita cloud_pos_sync.
update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_pos_sync', true)
where code in ('pro_monthly', 'pro');

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_pos_sync', false)
where code not in ('pro_monthly', 'pro');;
