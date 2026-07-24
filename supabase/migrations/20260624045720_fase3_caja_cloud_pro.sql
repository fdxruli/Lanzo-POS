-- FASE 3 — Caja cloud PRO
-- Online-first, caja por actor/staff, auditoría e idempotencia.

begin;

-- -----------------------------------------------------------------------------
-- Feature flag: cloud_cash_sync solo para PRO.
-- -----------------------------------------------------------------------------
update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_cash_sync', code = 'pro_monthly')
where code in ('pro_monthly', 'free_trial', 'basic_monthly');

-- -----------------------------------------------------------------------------
-- Tablas cloud de caja.
-- -----------------------------------------------------------------------------
create table if not exists public.pos_cash_sessions (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_id uuid not null references public.license_devices(id),
  staff_user_id uuid null references public.license_staff_users(id),
  device_role text not null default 'admin',
  scope text not null default 'actor',
  actor_key text not null,
  status text not null default 'open',

  opened_at timestamptz not null default now(),
  closed_at timestamptz null,

  opening_amount numeric not null default 0,
  opening_counted_amount numeric null,
  opening_suggested_amount numeric null,
  opening_difference numeric null,
  opening_policy text null,
  opening_origin text null,
  is_auto_opening boolean not null default false,

  closing_counted_amount numeric null,
  next_shift_fund numeric null,
  cash_sales_total numeric not null default 0,
  customer_payments_total numeric not null default 0,
  cash_entries_total numeric not null default 0,
  cash_exits_total numeric not null default 0,
  expected_cash_total numeric not null default 0,
  cash_difference numeric null,

  responsible_name text not null,
  opened_by_device_id uuid null references public.license_devices(id),
  opened_by_staff_user_id uuid null references public.license_staff_users(id),
  closed_by_device_id uuid null references public.license_devices(id),
  closed_by_staff_user_id uuid null references public.license_staff_users(id),

  audit_comments text null,
  close_detail jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_version integer not null default 1,
  last_idempotency_key text null,
  deleted_at timestamptz null,

  constraint pos_cash_sessions_status_chk check (status in ('open', 'closed', 'cancelled')),
  constraint pos_cash_sessions_device_role_chk check (device_role in ('admin', 'staff')),
  constraint pos_cash_sessions_scope_chk check (scope in ('actor', 'device', 'staff')),
  constraint pos_cash_sessions_server_version_chk check (server_version >= 1),
  constraint pos_cash_sessions_amounts_chk check (
    opening_amount >= 0
    and coalesce(opening_counted_amount, 0) >= 0
    and coalesce(opening_suggested_amount, 0) >= 0
    and coalesce(closing_counted_amount, 0) >= 0
    and coalesce(next_shift_fund, 0) >= 0
    and cash_sales_total >= 0
    and customer_payments_total >= 0
    and cash_entries_total >= 0
    and cash_exits_total >= 0
    and expected_cash_total >= 0
  ),
  constraint pos_cash_sessions_actor_key_not_empty_chk check (length(btrim(actor_key)) > 0),
  constraint pos_cash_sessions_responsible_not_empty_chk check (length(btrim(responsible_name)) > 0)
);

create unique index if not exists ux_pos_cash_sessions_open_actor
  on public.pos_cash_sessions (license_id, actor_key)
  where status = 'open' and deleted_at is null;

create index if not exists idx_pos_cash_sessions_license_opened
  on public.pos_cash_sessions (license_id, opened_at desc);
create index if not exists idx_pos_cash_sessions_license_staff_opened
  on public.pos_cash_sessions (license_id, staff_user_id, opened_at desc);
create index if not exists idx_pos_cash_sessions_license_device_opened
  on public.pos_cash_sessions (license_id, device_id, opened_at desc);
create index if not exists idx_pos_cash_sessions_license_actor_opened
  on public.pos_cash_sessions (license_id, actor_key, opened_at desc);
create index if not exists idx_pos_cash_sessions_license_status_opened
  on public.pos_cash_sessions (license_id, status, opened_at desc);

create table if not exists public.pos_cash_movements (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  cash_session_id text not null references public.pos_cash_sessions(id) on delete cascade,
  device_id uuid not null references public.license_devices(id),
  staff_user_id uuid null references public.license_staff_users(id),
  actor_key text not null,

  type text not null,
  amount numeric not null,
  concept text not null,

  source text not null default 'manual',
  reference_type text null,
  reference_id text null,

  created_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  actor_name text not null,

  created_at timestamptz not null default now(),
  server_version integer not null default 1,
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz null,

  constraint pos_cash_movements_type_chk check (type in (
    'entrada', 'salida', 'ajuste_entrada', 'ajuste_salida', 'fondo_inicial_ajuste',
    'venta_efectivo', 'abono_cliente', 'cancelacion'
  )),
  constraint pos_cash_movements_amount_chk check (amount > 0),
  constraint pos_cash_movements_concept_chk check (length(btrim(concept)) > 0),
  constraint pos_cash_movements_actor_key_chk check (length(btrim(actor_key)) > 0),
  constraint pos_cash_movements_actor_name_chk check (length(btrim(actor_name)) > 0),
  constraint pos_cash_movements_server_version_chk check (server_version >= 1)
);

create index if not exists idx_pos_cash_movements_license_session_created
  on public.pos_cash_movements (license_id, cash_session_id, created_at desc);
create index if not exists idx_pos_cash_movements_license_staff_created
  on public.pos_cash_movements (license_id, staff_user_id, created_at desc);
create index if not exists idx_pos_cash_movements_license_device_created
  on public.pos_cash_movements (license_id, device_id, created_at desc);
create index if not exists idx_pos_cash_movements_license_actor_created
  on public.pos_cash_movements (license_id, actor_key, created_at desc);
create index if not exists idx_pos_cash_movements_license_type_created
  on public.pos_cash_movements (license_id, type, created_at desc);
create index if not exists idx_pos_cash_movements_reference
  on public.pos_cash_movements (license_id, reference_type, reference_id)
  where reference_type is not null and reference_id is not null;
create unique index if not exists ux_pos_cash_movements_idempotency
  on public.pos_cash_movements (license_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.pos_cash_audit_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  cash_session_id text null references public.pos_cash_sessions(id) on delete cascade,
  event_type text not null,
  actor_device_id uuid null references public.license_devices(id),
  actor_staff_user_id uuid null references public.license_staff_users(id),
  actor_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_cash_audit_license_session_created
  on public.pos_cash_audit_events (license_id, cash_session_id, created_at desc);
create index if not exists idx_pos_cash_audit_license_event_created
  on public.pos_cash_audit_events (license_id, event_type, created_at desc);

alter table public.pos_cash_sessions enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_cash_audit_events enable row level security;

-- Políticas cerradas: cliente solo puede usar RPC security definer.
do $$
begin
  drop policy if exists pos_cash_sessions_no_direct_client_select on public.pos_cash_sessions;
  drop policy if exists pos_cash_sessions_no_direct_client_insert on public.pos_cash_sessions;
  drop policy if exists pos_cash_sessions_no_direct_client_update on public.pos_cash_sessions;
  drop policy if exists pos_cash_sessions_no_direct_client_delete on public.pos_cash_sessions;
  drop policy if exists pos_cash_movements_no_direct_client_select on public.pos_cash_movements;
  drop policy if exists pos_cash_movements_no_direct_client_insert on public.pos_cash_movements;
  drop policy if exists pos_cash_movements_no_direct_client_update on public.pos_cash_movements;
  drop policy if exists pos_cash_movements_no_direct_client_delete on public.pos_cash_movements;
  drop policy if exists pos_cash_audit_events_no_direct_client_select on public.pos_cash_audit_events;
  drop policy if exists pos_cash_audit_events_no_direct_client_insert on public.pos_cash_audit_events;
  drop policy if exists pos_cash_audit_events_no_direct_client_update on public.pos_cash_audit_events;
  drop policy if exists pos_cash_audit_events_no_direct_client_delete on public.pos_cash_audit_events;
end $$;

create policy pos_cash_sessions_no_direct_client_select on public.pos_cash_sessions for select to anon, authenticated using (false);
create policy pos_cash_sessions_no_direct_client_insert on public.pos_cash_sessions for insert to anon, authenticated with check (false);
create policy pos_cash_sessions_no_direct_client_update on public.pos_cash_sessions for update to anon, authenticated using (false) with check (false);
create policy pos_cash_sessions_no_direct_client_delete on public.pos_cash_sessions for delete to anon, authenticated using (false);

create policy pos_cash_movements_no_direct_client_select on public.pos_cash_movements for select to anon, authenticated using (false);
create policy pos_cash_movements_no_direct_client_insert on public.pos_cash_movements for insert to anon, authenticated with check (false);
create policy pos_cash_movements_no_direct_client_update on public.pos_cash_movements for update to anon, authenticated using (false) with check (false);
create policy pos_cash_movements_no_direct_client_delete on public.pos_cash_movements for delete to anon, authenticated using (false);

create policy pos_cash_audit_events_no_direct_client_select on public.pos_cash_audit_events for select to anon, authenticated using (false);
create policy pos_cash_audit_events_no_direct_client_insert on public.pos_cash_audit_events for insert to anon, authenticated with check (false);
create policy pos_cash_audit_events_no_direct_client_update on public.pos_cash_audit_events for update to anon, authenticated using (false) with check (false);
create policy pos_cash_audit_events_no_direct_client_delete on public.pos_cash_audit_events for delete to anon, authenticated using (false);

-- -----------------------------------------------------------------------------
-- Helpers privados.
-- -----------------------------------------------------------------------------
create or replace function private.assert_cloud_cash_sync_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_cash_sync')::boolean, false) is not true then
    raise exception 'CLOUD_CASH_SYNC_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.assert_cash_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return;
  end if;

  if coalesce((p_context->'staff_permissions'->>'cash_register')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'caja')::boolean, false) is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:cash_register' using errcode = 'P0001';
end;
$$;

create or replace function private.cash_audit_allowed(p_context jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce($1->>'device_role', 'staff') <> 'staff'
    or coalesce(($1->'staff_permissions'->>'reports')::boolean, false)
    or coalesce(($1->'staff_permissions'->>'cash_audit')::boolean, false)
    or coalesce(($1->'staff_permissions'->>'caja_auditoria')::boolean, false)
$$;

create or replace function private.resolve_cash_actor_key(p_context jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_device_role text := coalesce(p_context->>'device_role', 'staff');
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
begin
  if v_device_role = 'staff' then
    if v_staff_user_id is null then
      raise exception 'STAFF_USER_REQUIRED_FOR_CASH' using errcode = 'P0001';
    end if;
    return 'staff:' || v_staff_user_id::text;
  end if;

  if v_device_id is null then
    raise exception 'DEVICE_REQUIRED_FOR_CASH' using errcode = 'P0001';
  end if;

  return 'admin_device:' || v_device_id::text;
end;
$$;

create or replace function private.resolve_cash_actor_name(p_context jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_device_role text := coalesce(p_context->>'device_role', 'staff');
  v_name text;
begin
  if v_device_role = 'staff' then
    v_name := nullif(btrim(coalesce(
      p_context->'staff_user'->>'display_name',
      p_context->'staff_user'->>'username',
      'Staff'
    )), '');
    return coalesce(v_name, 'Staff');
  end if;

  return 'Administrador';
end;
$$;

create or replace function private.pos_cash_session_to_jsonb(p_session public.pos_cash_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_session.id,
    'license_id', p_session.license_id,
    'device_id', p_session.device_id,
    'staff_user_id', p_session.staff_user_id,
    'device_role', p_session.device_role,
    'scope', p_session.scope,
    'actor_key', p_session.actor_key,
    'status', p_session.status,
    'opened_at', p_session.opened_at,
    'closed_at', p_session.closed_at,
    'opening_amount', p_session.opening_amount,
    'opening_counted_amount', p_session.opening_counted_amount,
    'opening_suggested_amount', p_session.opening_suggested_amount,
    'opening_difference', p_session.opening_difference,
    'opening_policy', p_session.opening_policy,
    'opening_origin', p_session.opening_origin,
    'is_auto_opening', p_session.is_auto_opening,
    'closing_counted_amount', p_session.closing_counted_amount,
    'next_shift_fund', p_session.next_shift_fund,
    'cash_sales_total', p_session.cash_sales_total,
    'customer_payments_total', p_session.customer_payments_total,
    'cash_entries_total', p_session.cash_entries_total,
    'cash_exits_total', p_session.cash_exits_total,
    'expected_cash_total', p_session.expected_cash_total,
    'cash_difference', p_session.cash_difference,
    'responsible_name', p_session.responsible_name,
    'opened_by_device_id', p_session.opened_by_device_id,
    'opened_by_staff_user_id', p_session.opened_by_staff_user_id,
    'closed_by_device_id', p_session.closed_by_device_id,
    'closed_by_staff_user_id', p_session.closed_by_staff_user_id,
    'audit_comments', p_session.audit_comments,
    'close_detail', p_session.close_detail,
    'metadata', p_session.metadata,
    'created_at', p_session.created_at,
    'updated_at', p_session.updated_at,
    'server_version', p_session.server_version,
    'deleted_at', p_session.deleted_at
  ))
$$;

create or replace function private.pos_cash_movement_to_jsonb(p_movement public.pos_cash_movements)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_movement.id,
    'license_id', p_movement.license_id,
    'cash_session_id', p_movement.cash_session_id,
    'device_id', p_movement.device_id,
    'staff_user_id', p_movement.staff_user_id,
    'actor_key', p_movement.actor_key,
    'type', p_movement.type,
    'amount', p_movement.amount,
    'concept', p_movement.concept,
    'source', p_movement.source,
    'reference_type', p_movement.reference_type,
    'reference_id', p_movement.reference_id,
    'created_by_device_id', p_movement.created_by_device_id,
    'created_by_staff_user_id', p_movement.created_by_staff_user_id,
    'actor_name', p_movement.actor_name,
    'created_at', p_movement.created_at,
    'server_version', p_movement.server_version,
    'metadata', p_movement.metadata,
    'deleted_at', p_movement.deleted_at
  ))
$$;

create or replace function private.recalculate_pos_cash_session_totals(
  p_license_id uuid,
  p_cash_session_id text,
  p_bump_version boolean default true
)
returns public.pos_cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entries numeric := 0;
  v_exits numeric := 0;
  v_session public.pos_cash_sessions;
begin
  select
    coalesce(sum(case when m.type in ('entrada', 'ajuste_entrada') and m.deleted_at is null then m.amount else 0 end), 0),
    coalesce(sum(case when m.type in ('salida', 'ajuste_salida') and m.deleted_at is null then m.amount else 0 end), 0)
  into v_entries, v_exits
  from public.pos_cash_movements m
  where m.license_id = p_license_id
    and m.cash_session_id = p_cash_session_id;

  update public.pos_cash_sessions s
  set cash_entries_total = v_entries,
      cash_exits_total = v_exits,
      expected_cash_total = greatest(
        coalesce(s.opening_amount, 0)
        + coalesce(s.cash_sales_total, 0)
        + coalesce(s.customer_payments_total, 0)
        + v_entries
        - v_exits,
        0
      ),
      updated_at = now(),
      server_version = case when coalesce(p_bump_version, true) then s.server_version + 1 else s.server_version end
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
  returning * into v_session;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_session;
end;
$$;

create or replace function private.record_pos_cash_event(
  p_license_id uuid,
  p_cash_session_id text,
  p_event_type text,
  p_actor_device_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_name text,
  p_payload jsonb default '{}'::jsonb
)
returns public.pos_cash_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pos_cash_audit_events;
begin
  insert into public.pos_cash_audit_events (
    license_id, cash_session_id, event_type, actor_device_id,
    actor_staff_user_id, actor_name, payload
  ) values (
    p_license_id, p_cash_session_id, p_event_type, p_actor_device_id,
    p_actor_staff_user_id, coalesce(nullif(btrim(p_actor_name), ''), 'Sistema'), coalesce(p_payload, '{}'::jsonb)
  ) returning * into v_event;

  return v_event;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs públicas de caja.
-- -----------------------------------------------------------------------------
create or replace function public.pos_get_current_cash_session(
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
  v_actor_key text;
  v_session public.pos_cash_sessions;
  v_movements jsonb := '[]'::jsonb;
  v_admin_open_sessions jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.actor_key = v_actor_key
    and s.status = 'open'
    and s.deleted_at is null
  order by s.opened_at desc
  limit 1;

  if v_session.id is not null then
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);

    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
    into v_movements
    from public.pos_cash_movements m
    where m.license_id = v_license_id
      and m.cash_session_id = v_session.id
      and m.deleted_at is null
    limit 100;
  end if;

  if coalesce(v_context->>'device_role', 'staff') <> 'staff' then
    select coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.opened_at desc), '[]'::jsonb)
    into v_admin_open_sessions
    from public.pos_cash_sessions s
    where s.license_id = v_license_id
      and s.status = 'open'
      and s.deleted_at is null;
  end if;

  return jsonb_build_object(
    'success', true,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
    'movements', v_movements,
    'admin_open_sessions', v_admin_open_sessions,
    'actor_key', v_actor_key,
    'actor_name', private.resolve_cash_actor_name(v_context),
    'sync_context', jsonb_build_object(
      'device_role', v_context->>'device_role',
      'staff_user_id', v_context->>'staff_user_id',
      'cloud_cash_sync', true
    )
  );
end;
$$;

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
  v_device_role text;
  v_actor_key text;
  v_actor_name text;
  v_responsible_name text;
  v_session public.pos_cash_sessions;
  v_existing public.pos_cash_sessions;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_opening_amount numeric;
  v_counted_amount numeric;
  v_suggested_amount numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_opening_amount := greatest(coalesce(nullif(p_opening->>'opening_amount', '')::numeric, nullif(p_opening->>'montoInicial', '')::numeric, 0), 0);
  v_counted_amount := greatest(coalesce(nullif(p_opening->>'opening_counted_amount', '')::numeric, nullif(p_opening->>'montoContado', '')::numeric, v_opening_amount), 0);
  v_suggested_amount := greatest(coalesce(nullif(p_opening->>'opening_suggested_amount', '')::numeric, nullif(p_opening->>'montoSugerido', '')::numeric, 0), 0);

  if v_device_role = 'staff' then
    v_responsible_name := v_actor_name;
  else
    v_responsible_name := coalesce(nullif(btrim(p_opening->>'responsible_name'), ''), nullif(btrim(p_opening->>'responsable'), ''), v_actor_name, 'Administrador');
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.open', 'cash_session', null, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La apertura ya esta en proceso.', 'idempotency_key', p_idempotency_key);
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
    v_response := jsonb_build_object(
      'success', false,
      'code', 'CASH_SESSION_ALREADY_OPEN',
      'message', 'Ya existe una caja abierta para este usuario/dispositivo.',
      'cash_session', private.pos_cash_session_to_jsonb(v_existing),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  insert into public.pos_cash_sessions (
    id, license_id, device_id, staff_user_id, device_role, scope, actor_key, status,
    opening_amount, opening_counted_amount, opening_suggested_amount, opening_difference,
    opening_policy, opening_origin, is_auto_opening,
    expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    'cash_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_device_id, v_staff_user_id, v_device_role, 'actor', v_actor_key, 'open',
    v_opening_amount, v_counted_amount, v_suggested_amount, v_counted_amount - v_suggested_amount,
    nullif(btrim(coalesce(p_opening->>'opening_policy', p_opening->>'politicaApertura', 'manual')), ''),
    nullif(btrim(coalesce(p_opening->>'opening_origin', p_opening->>'origen', 'manual')), ''),
    coalesce((p_opening->>'is_auto_opening')::boolean, (p_opening->>'esAutoApertura')::boolean, false),
    v_opening_amount, v_responsible_name,
    v_device_id, v_staff_user_id, p_idempotency_key,
    coalesce(p_opening->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase3_caja_cloud')
  ) returning * into v_session;

  perform private.record_pos_cash_event(v_license_id, v_session.id, 'OPENED', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('actor_key', v_actor_key));
  v_event := private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'open', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_actor_key), v_session.server_version);

  v_response := jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  select * into v_existing
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.actor_key = v_actor_key and s.status = 'open' and s.deleted_at is null
  order by s.opened_at desc limit 1;
  v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_ALREADY_OPEN', 'message', 'Ya existe una caja abierta para este usuario/dispositivo.', 'cash_session', case when v_existing.id is null then null else private.pos_cash_session_to_jsonb(v_existing) end, 'idempotency_key', p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  end if;
  return v_response;
end;
$$;

create or replace function public.pos_register_cash_movement(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null,
  p_type text default null,
  p_amount numeric default 0,
  p_concept text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
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
  v_actor_key text;
  v_actor_name text;
  v_session public.pos_cash_sessions;
  v_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
  v_concept text := nullif(btrim(coalesce(p_concept, '')), '');
  v_amount numeric := coalesce(p_amount, 0);
  v_is_exit boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  if p_cash_session_id is null or btrim(p_cash_session_id) = '' then
    raise exception 'CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_type not in ('entrada', 'salida', 'ajuste_entrada', 'ajuste_salida', 'fondo_inicial_ajuste') then
    raise exception 'CASH_MOVEMENT_TYPE_INVALID' using errcode = 'P0001';
  end if;
  if v_amount <= 0 then
    raise exception 'CASH_MOVEMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_concept is null then
    raise exception 'CASH_MOVEMENT_CONCEPT_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.movement', 'cash_movement', null, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El movimiento ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null
  for update;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;

  if coalesce(v_context->>'device_role', 'staff') = 'staff' and v_session.actor_key <> v_actor_key then
    raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
  end if;

  if coalesce(v_context->>'device_role', 'staff') <> 'staff' and v_session.actor_key <> v_actor_key and not private.cash_audit_allowed(v_context) then
    raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
  end if;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
  v_is_exit := v_type in ('salida', 'ajuste_salida');
  if v_is_exit and (v_session.expected_cash_total - v_amount) < 0 then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INSUFFICIENT_CASH',
      'message', 'La salida dejaria la caja en negativo.',
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, reference_type, reference_id,
    created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id, v_session.device_id, v_session.staff_user_id, v_session.actor_key,
    v_type, v_amount, v_concept, coalesce(nullif(btrim(p_metadata->>'source'), ''), 'manual'), nullif(btrim(p_metadata->>'reference_type'), ''), nullif(btrim(p_metadata->>'reference_id'), ''),
    v_device_id, v_staff_user_id, v_actor_name, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_movement;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);

  perform private.record_pos_cash_event(v_license_id, v_session.id, 'MOVEMENT_CREATED', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('movement_id', v_movement.id, 'type', v_type));
  v_event := private.record_pos_sync_event(v_license_id, 'cash_movement', v_movement.id, 'movement', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key, 'movement_type', v_type), v_movement.server_version);
  perform private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'reason', 'movement'), v_session.server_version);

  v_response := jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'movement', private.pos_cash_movement_to_jsonb(v_movement),
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_adjust_initial_cash_fund(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null,
  p_new_opening_amount numeric default 0,
  p_reason text default null,
  p_expected_version integer default null,
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
  v_actor_key text;
  v_actor_name text;
  v_session public.pos_cash_sessions;
  v_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous numeric;
  v_delta numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  if coalesce(p_new_opening_amount, 0) < 0 then raise exception 'OPENING_AMOUNT_INVALID' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'CASH_ADJUST_REASON_REQUIRED' using errcode = 'P0001'; end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.adjust_initial_fund', 'cash_session', p_cash_session_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El ajuste ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_session from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null for update;

  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if coalesce(v_context->>'device_role', 'staff') = 'staff' and v_session.actor_key <> v_actor_key then raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La caja fue modificada en otro dispositivo.', 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_previous := coalesce(v_session.opening_amount, 0);
  v_delta := coalesce(p_new_opening_amount, 0) - v_previous;

  update public.pos_cash_sessions
  set opening_amount = p_new_opening_amount,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_initial_fund_adjust_reason', v_reason)
  where license_id = v_license_id and id = p_cash_session_id
  returning * into v_session;

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id, v_session.device_id, v_session.staff_user_id, v_session.actor_key,
    'fondo_inicial_ajuste', abs(v_delta), 'Ajuste fondo inicial: ' || v_previous::text || ' -> ' || p_new_opening_amount::text || '. Motivo: ' || v_reason, 'manual', v_device_id, v_staff_user_id, v_actor_name, p_idempotency_key,
    jsonb_build_object('previous_amount', v_previous, 'new_amount', p_new_opening_amount, 'delta', v_delta, 'reason', v_reason)
  ) returning * into v_movement;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
  perform private.record_pos_cash_event(v_license_id, v_session.id, 'INITIAL_FUND_ADJUSTED', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('movement_id', v_movement.id, 'previous_amount', v_previous, 'new_amount', p_new_opening_amount));
  v_event := private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'adjust', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'movement_id', v_movement.id), v_session.server_version);

  v_response := jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'movement', private.pos_cash_movement_to_jsonb(v_movement), 'event', to_jsonb(v_event), 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_close_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null,
  p_closing jsonb default '{}'::jsonb,
  p_expected_version integer default null,
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
  v_actor_key text;
  v_actor_name text;
  v_session public.pos_cash_sessions;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_counted numeric;
  v_next_fund numeric;
  v_comments text;
  v_difference numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_counted := greatest(coalesce(nullif(p_closing->>'closing_counted_amount', '')::numeric, nullif(p_closing->>'countedAmount', '')::numeric, nullif(p_closing->>'montoFisicoTotal', '')::numeric, 0), 0);
  v_next_fund := greatest(coalesce(nullif(p_closing->>'next_shift_fund', '')::numeric, nullif(p_closing->>'nextShiftFund', '')::numeric, nullif(p_closing->>'montoFondoSiguienteTurno', '')::numeric, 0), 0);
  v_comments := nullif(btrim(coalesce(p_closing->>'audit_comments', p_closing->>'comments', p_closing->>'comentarios', '')), '');

  if v_next_fund > v_counted then raise exception 'NEXT_SHIFT_FUND_EXCEEDS_COUNTED' using errcode = 'P0001'; end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.close', 'cash_session', p_cash_session_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cierre ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_session from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null for update;

  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if coalesce(v_context->>'device_role', 'staff') = 'staff' and v_session.actor_key <> v_actor_key then raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001'; end if;
  if p_expected_version is not null and p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La caja fue modificada en otro dispositivo.', 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
  v_difference := v_counted - v_session.expected_cash_total;

  update public.pos_cash_sessions
  set status = 'closed',
      closed_at = now(),
      closing_counted_amount = v_counted,
      next_shift_fund = v_next_fund,
      cash_difference = v_difference,
      closed_by_device_id = v_device_id,
      closed_by_staff_user_id = v_staff_user_id,
      audit_comments = v_comments,
      close_detail = coalesce(p_closing, '{}'::jsonb) || jsonb_build_object('expected_cash_total', v_session.expected_cash_total, 'cash_difference', v_difference),
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = v_session.id
  returning * into v_session;

  perform private.record_pos_cash_event(v_license_id, v_session.id, 'CLOSED', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('expected_cash_total', v_session.expected_cash_total, 'cash_difference', v_difference));
  v_event := private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'close', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key), v_session.server_version);

  v_response := jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'event', to_jsonb(v_event), 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_pull_cash_snapshot(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_scope text default 'mine',
  p_limit integer default 100,
  p_offset integer default 0,
  p_include_closed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_scope text := lower(coalesce(nullif(btrim(p_scope), ''), 'mine'));
  v_sessions jsonb;
  v_movements jsonb;
  v_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if coalesce(v_context->>'device_role', 'staff') = 'staff' then
    v_scope := 'mine';
  elsif v_scope not in ('mine', 'open', 'all', 'staff') then
    v_scope := 'mine';
  end if;

  with selected_sessions as (
    select s.*
    from public.pos_cash_sessions s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and (p_include_closed is true or s.status = 'open')
      and (
        (v_scope = 'mine' and s.actor_key = v_actor_key)
        or (v_scope = 'open' and s.status = 'open')
        or (v_scope = 'all')
        or (v_scope = 'staff' and s.staff_user_id is not null)
      )
    order by s.opened_at desc
    limit v_limit offset v_offset
  ), selected_ids as (
    select id from selected_sessions
  )
  select
    coalesce((select jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.opened_at desc) from selected_sessions s), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc)
      from public.pos_cash_movements m
      where m.license_id = v_license_id
        and m.cash_session_id in (select id from selected_ids)
        and m.deleted_at is null), '[]'::jsonb)
  into v_sessions, v_movements;

  select coalesce(max(change_seq), 0) into v_latest
  from public.pos_sync_events
  where license_id = v_license_id
    and entity_type in ('cash_session', 'cash_movement');

  return jsonb_build_object('success', true, 'cash_sessions', v_sessions, 'movements', v_movements, 'latest_change_seq', v_latest, 'scope', v_scope);
end;
$$;

create or replace function public.pos_pull_cash_changes(
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
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_events jsonb;
  v_sessions jsonb;
  v_movements jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  with pulled as (
    select e.*
    from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.entity_type in ('cash_session', 'cash_movement')
      and e.change_seq > coalesce(p_since_change_seq, 0)
      and (
        coalesce(v_context->>'device_role', 'staff') <> 'staff'
        or coalesce(e.metadata->>'actor_key', '') = v_actor_key
        or exists (
          select 1 from public.pos_cash_sessions s
          where s.license_id = v_license_id
            and s.actor_key = v_actor_key
            and s.id = e.metadata->>'cash_session_id'
        )
      )
    order by e.change_seq asc
    limit v_limit
  ), affected_session_ids as (
    select distinct coalesce(e.metadata->>'cash_session_id', case when e.entity_type = 'cash_session' then e.entity_id else null end) as id
    from pulled e
    where coalesce(e.metadata->>'cash_session_id', case when e.entity_type = 'cash_session' then e.entity_id else null end) is not null
  ), affected_movement_ids as (
    select distinct e.entity_id as id from pulled e where e.entity_type = 'cash_movement'
  )
  select
    coalesce(jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc), '[]'::jsonb),
    coalesce(max(pulled.change_seq), coalesce(p_since_change_seq, 0)),
    coalesce((select jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.updated_at desc)
      from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.id in (select id from affected_session_ids)), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc)
      from public.pos_cash_movements m
      where m.license_id = v_license_id and (m.id in (select id from affected_movement_ids) or m.cash_session_id in (select id from affected_session_ids))), '[]'::jsonb)
  into v_events, v_latest_returned, v_sessions, v_movements
  from pulled;

  select coalesce(max(e.change_seq), coalesce(p_since_change_seq, 0)) into v_server_latest
  from public.pos_sync_events e
  where e.license_id = v_license_id and e.entity_type in ('cash_session', 'cash_movement');

  return jsonb_build_object('success', true, 'events', v_events, 'cash_sessions', v_sessions, 'movements', v_movements, 'latest_change_seq', v_latest_returned, 'server_latest_change_seq', v_server_latest, 'has_more', v_server_latest > v_latest_returned);
end;
$$;

create or replace function public.pos_admin_list_cash_sessions(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_staff_user_id uuid default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sessions jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);

  if not private.cash_audit_allowed(v_context) then
    raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;

  select coalesce(jsonb_agg(row_payload order by opened_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select
      s.opened_at,
      private.pos_cash_session_to_jsonb(s)
      || jsonb_build_object(
        'staff_display_name', lsu.display_name,
        'staff_username', lsu.username,
        'movement_count', coalesce(m.movement_count, 0)
      ) as row_payload
    from public.pos_cash_sessions s
    left join public.license_staff_users lsu on lsu.id = s.staff_user_id
    left join lateral (
      select count(*)::integer as movement_count
      from public.pos_cash_movements m
      where m.license_id = s.license_id and m.cash_session_id = s.id and m.deleted_at is null
    ) m on true
    where s.license_id = v_license_id
      and s.deleted_at is null
      and (p_status is null or s.status = p_status)
      and (p_staff_user_id is null or s.staff_user_id = p_staff_user_id)
      and (p_date_from is null or s.opened_at >= p_date_from)
      and (p_date_to is null or s.opened_at < p_date_to)
    order by s.opened_at desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object('success', true, 'cash_sessions', v_sessions);
end;
$$;

create or replace function public.pos_admin_get_cash_session_detail(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_session public.pos_cash_sessions;
  v_movements jsonb;
  v_audit jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);

  if not private.cash_audit_allowed(v_context) then
    raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;

  select * into v_session from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null;

  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
  into v_movements
  from public.pos_cash_movements m
  where m.license_id = v_license_id and m.cash_session_id = p_cash_session_id and m.deleted_at is null;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_audit
  from public.pos_cash_audit_events a
  where a.license_id = v_license_id and a.cash_session_id = p_cash_session_id;

  return jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'movements', v_movements, 'audit_events', v_audit);
end;
$$;

-- Ajuste menor al pull general: exponer flag cash en sync_context.
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
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer;
  v_events jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);

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
    select e.id, e.entity_type, e.entity_id, e.operation, e.change_seq, e.server_version,
           e.actor_device_id, e.actor_staff_user_id, e.idempotency_key, e.metadata, e.created_at
    from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.change_seq > coalesce(p_since_change_seq, 0)
    order by e.change_seq asc
    limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc), '[]'::jsonb),
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
      'cloud_pos_sync', coalesce((v_context->'features'->>'cloud_pos_sync')::boolean, false),
      'cloud_cash_sync', coalesce((v_context->'features'->>'cloud_cash_sync')::boolean, false)
    )
  );
end;
$$;

grant execute on function public.pos_get_current_cash_session(text, text, text, text) to anon, authenticated;
grant execute on function public.pos_open_cash_session(text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.pos_register_cash_movement(text, text, text, text, text, text, numeric, text, text, jsonb) to anon, authenticated;
grant execute on function public.pos_adjust_initial_cash_fund(text, text, text, text, text, numeric, text, integer, text) to anon, authenticated;
grant execute on function public.pos_close_cash_session(text, text, text, text, text, jsonb, integer, text) to anon, authenticated;
grant execute on function public.pos_pull_cash_snapshot(text, text, text, text, text, integer, integer, boolean) to anon, authenticated;
grant execute on function public.pos_pull_cash_changes(text, text, text, text, bigint, integer) to anon, authenticated;
grant execute on function public.pos_admin_list_cash_sessions(text, text, text, text, text, uuid, timestamptz, timestamptz, integer, integer) to anon, authenticated;
grant execute on function public.pos_admin_get_cash_session_detail(text, text, text, text, text) to anon, authenticated;

commit;;
