-- FASE 1 — Clientes/directorio cloud para Lanzo POS
-- No destructiva: crea pos_customers y RPCs seguras para directorio cloud.

create table if not exists public.pos_customers (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  name text not null,
  phone text null,
  phone_key text null,
  address text null,
  debt numeric not null default 0,
  debt_cents integer not null default 0,
  credit_limit numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1,
  created_by_device_id uuid null references public.license_devices(id),
  updated_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  updated_by_staff_user_id uuid null references public.license_staff_users(id),
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_customers_name_not_blank check (length(btrim(name)) > 0),
  constraint pos_customers_debt_non_negative check (debt >= 0),
  constraint pos_customers_debt_cents_non_negative check (debt_cents >= 0),
  constraint pos_customers_credit_limit_non_negative check (credit_limit >= 0),
  constraint pos_customers_server_version_positive check (server_version >= 1)
);

create index if not exists idx_pos_customers_license_updated_at
  on public.pos_customers (license_id, updated_at);

create index if not exists idx_pos_customers_license_server_version
  on public.pos_customers (license_id, server_version);

create index if not exists idx_pos_customers_license_deleted_at
  on public.pos_customers (license_id, deleted_at);

create index if not exists idx_pos_customers_license_name
  on public.pos_customers (license_id, name);

create index if not exists idx_pos_customers_license_phone_key
  on public.pos_customers (license_id, phone_key);

create unique index if not exists ux_pos_customers_license_phone_key_active
  on public.pos_customers (license_id, phone_key)
  where phone_key is not null and deleted_at is null;

alter table public.pos_customers enable row level security;
revoke all on table public.pos_customers from anon, authenticated;

comment on table public.pos_customers is 'FASE 1 POS Sync: directorio cloud de clientes por licencia. Escritura/lectura mediante RPCs security definer.';
comment on column public.pos_customers.debt is 'Campo conservado como lectura/cache para migración inicial. Abonos/caja cloud quedan fuera de Fase 1.';
comment on column public.pos_customers.debt_cents is 'Campo conservado como lectura/cache para migración inicial. Abonos/caja cloud quedan fuera de Fase 1.';

create or replace function private.normalize_pos_customer_phone_key(p_phone text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$$;

create or replace function private.pos_customer_to_jsonb(p_customer public.pos_customers)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select case when p_customer.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', p_customer.id,
    'license_id', p_customer.license_id,
    'name', p_customer.name,
    'phone', p_customer.phone,
    'phone_key', p_customer.phone_key,
    'address', p_customer.address,
    'debt', p_customer.debt,
    'debt_cents', p_customer.debt_cents,
    'credit_limit', p_customer.credit_limit,
    'created_at', p_customer.created_at,
    'updated_at', p_customer.updated_at,
    'deleted_at', p_customer.deleted_at,
    'server_version', p_customer.server_version,
    'metadata', coalesce(p_customer.metadata, '{}'::jsonb)
  )) end;
$$;

create or replace function private.assert_cloud_pos_sync_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce((p_context->'features'->>'cloud_pos_sync')::boolean, false) is not true then
    raise exception 'CLOUD_POS_SYNC_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.insert_pos_idempotency_processing(
  p_license_id uuid,
  p_idempotency_key text,
  p_operation_type text,
  p_entity_type text,
  p_entity_id text,
  p_request_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_inserted boolean := false;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pos_idempotency_keys (
    license_id,
    idempotency_key,
    operation_type,
    entity_type,
    entity_id,
    request_hash,
    status,
    expires_at
  ) values (
    p_license_id,
    p_idempotency_key,
    p_operation_type,
    p_entity_type,
    p_entity_id,
    p_request_hash,
    'processing',
    now() + interval '7 days'
  )
  on conflict (license_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function private.complete_pos_idempotency(
  p_license_id uuid,
  p_idempotency_key text,
  p_response_payload jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.pos_idempotency_keys
  set status = 'completed',
      response_payload = p_response_payload,
      expires_at = now() + interval '7 days'
  where license_id = p_license_id
    and idempotency_key = p_idempotency_key;
end;
$$;

create or replace function public.pos_upsert_customer(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_customer jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_customer_id text;
  v_name text;
  v_phone text;
  v_phone_key text;
  v_address text;
  v_credit_limit numeric;
  v_debt numeric;
  v_debt_cents integer;
  v_existing public.pos_customers;
  v_saved public.pos_customers;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_customer_id := nullif(btrim(coalesce(p_customer->>'id', '')), '');
  if v_customer_id is null then
    raise exception 'CUSTOMER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_customer->>'name', '')), '');
  if v_name is null then
    raise exception 'CUSTOMER_NAME_REQUIRED' using errcode = 'P0001';
  end if;

  v_phone := nullif(btrim(coalesce(p_customer->>'phone', '')), '');
  v_phone_key := coalesce(
    nullif(btrim(coalesce(p_customer->>'phone_key', p_customer->>'phoneKey', '')), ''),
    private.normalize_pos_customer_phone_key(v_phone)
  );
  v_phone_key := private.normalize_pos_customer_phone_key(v_phone_key);

  v_address := nullif(btrim(coalesce(p_customer->>'address', '')), '');
  v_credit_limit := greatest(coalesce(nullif(p_customer->>'credit_limit', '')::numeric, nullif(p_customer->>'creditLimit', '')::numeric, 0), 0);
  v_debt := greatest(coalesce(nullif(p_customer->>'debt', '')::numeric, 0), 0);
  v_debt_cents := greatest(coalesce(nullif(p_customer->>'debt_cents', '')::integer, nullif(p_customer->>'debtCents', '')::integer, round(v_debt * 100)::integer, 0), 0);

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    p_idempotency_key,
    'upsert_customer',
    'customer',
    v_customer_id,
    null
  );

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La operacion ya esta en proceso.',
      'idempotency_key', p_idempotency_key
    );
  end if;

  select * into v_existing
  from public.pos_customers
  where license_id = v_license_id
    and id = v_customer_id
  for update;

  v_is_create := v_existing.id is null;

  if not v_is_create then
    if v_existing.deleted_at is not null then
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CUSTOMER_DELETED',
        'message', 'El cliente ya fue eliminado. Restauracion no disponible en Fase 1.',
        'customer', private.pos_customer_to_jsonb(v_existing),
        'server_version', v_existing.server_version,
        'idempotency_key', p_idempotency_key
      );
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (
        license_id, entity_type, entity_id, conflict_type,
        local_payload, server_payload, actor_device_id, actor_staff_user_id
      ) values (
        v_license_id, 'customer', v_customer_id, 'VERSION_CONFLICT',
        p_customer,
        private.pos_customer_to_jsonb(v_existing),
        v_device_id,
        v_staff_user_id
      );

      v_response := jsonb_build_object(
        'success', false,
        'code', 'VERSION_CONFLICT',
        'message', 'El cliente fue modificado en otro dispositivo.',
        'customer', private.pos_customer_to_jsonb(v_existing),
        'server_version', v_existing.server_version,
        'idempotency_key', p_idempotency_key
      );
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if exists (
    select 1
    from public.pos_customers c
    where c.license_id = v_license_id
      and c.phone_key = v_phone_key
      and c.deleted_at is null
      and c.id <> v_customer_id
      and v_phone_key is not null
  ) then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_PHONE',
      'message', 'El telefono ya esta registrado para otro cliente.',
      'field', 'phone',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_customers (
      id, license_id, name, phone, phone_key, address,
      debt, debt_cents, credit_limit,
      created_at, updated_at, server_version,
      created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id,
      last_idempotency_key, metadata
    ) values (
      v_customer_id, v_license_id, v_name, v_phone, v_phone_key, v_address,
      v_debt, v_debt_cents, v_credit_limit,
      coalesce(nullif(p_customer->>'created_at', '')::timestamptz, nullif(p_customer->>'createdAt', '')::timestamptz, now()),
      now(), 1,
      v_device_id, v_device_id,
      v_staff_user_id, v_staff_user_id,
      p_idempotency_key,
      coalesce(p_customer->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase1_customers_directory')
    ) returning * into v_saved;
  else
    update public.pos_customers
    set name = v_name,
        phone = v_phone,
        phone_key = v_phone_key,
        address = v_address,
        credit_limit = v_credit_limit,
        -- Fase 1: la deuda no se muta en updates cloud de directorio; caja/abonos vendra despues.
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'fase1_customers_directory')
    where license_id = v_license_id
      and id = v_customer_id
    returning * into v_saved;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'customer',
    v_saved.id,
    case when v_is_create then 'create' else 'update' end,
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_upsert_customer'),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'customer', private.pos_customer_to_jsonb(v_saved),
    'event', to_jsonb(v_event),
    'server_version', v_saved.server_version,
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_PHONE',
      'message', 'El telefono ya esta registrado para otro cliente.',
      'field', 'phone',
      'idempotency_key', p_idempotency_key
    );
    if v_license_id is not null and p_idempotency_key is not null then
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    end if;
    return v_response;
end;
$$;

create or replace function public.pos_delete_customer(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_customer_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_customers;
  v_saved public.pos_customers;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_customer_id, '')), '') is null then
    raise exception 'CUSTOMER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    p_idempotency_key,
    'delete_customer',
    'customer',
    p_customer_id,
    null
  );

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La operacion ya esta en proceso.',
      'idempotency_key', p_idempotency_key
    );
  end if;

  select * into v_existing
  from public.pos_customers
  where license_id = v_license_id
    and id = p_customer_id
  for update;

  if v_existing.id is null then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'CUSTOMER_NOT_FOUND',
      'message', 'El cliente no existe.',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_existing.deleted_at is not null then
    v_response := jsonb_build_object(
      'success', true,
      'code', 'CUSTOMER_ALREADY_DELETED',
      'customer', private.pos_customer_to_jsonb(v_existing),
      'server_version', v_existing.server_version,
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_existing.debt_cents > 0 then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'CUSTOMER_HAS_DEBT',
      'message', 'No se puede eliminar un cliente con deuda pendiente.',
      'customer', private.pos_customer_to_jsonb(v_existing),
      'server_version', v_existing.server_version,
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (
      license_id, entity_type, entity_id, conflict_type,
      local_payload, server_payload, actor_device_id, actor_staff_user_id
    ) values (
      v_license_id, 'customer', p_customer_id, 'VERSION_CONFLICT',
      jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version),
      private.pos_customer_to_jsonb(v_existing),
      v_device_id,
      v_staff_user_id
    );

    v_response := jsonb_build_object(
      'success', false,
      'code', 'VERSION_CONFLICT',
      'message', 'El cliente fue modificado en otro dispositivo.',
      'customer', private.pos_customer_to_jsonb(v_existing),
      'server_version', v_existing.server_version,
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_customers
  set deleted_at = now(),
      phone_key = null,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_by_phase', 'fase1_customers_directory')
  where license_id = v_license_id
    and id = p_customer_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'customer',
    v_saved.id,
    'delete',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_delete_customer'),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'customer', private.pos_customer_to_jsonb(v_saved),
    'event', to_jsonb(v_event),
    'server_version', v_saved.server_version,
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_pull_customers_snapshot(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_offset integer default 0,
  p_include_deleted boolean default false
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
  v_offset integer;
  v_customers jsonb;
  v_total integer;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select count(*)::integer into v_total
  from public.pos_customers c
  where c.license_id = v_license_id
    and (p_include_deleted is true or c.deleted_at is null);

  with page as (
    select c.*
    from public.pos_customers c
    where c.license_id = v_license_id
      and (p_include_deleted is true or c.deleted_at is null)
    order by c.updated_at asc, c.id asc
    offset v_offset
    limit v_limit
  )
  select coalesce(jsonb_agg(private.pos_customer_to_jsonb(page.*) order by page.updated_at asc, page.id asc), '[]'::jsonb)
  into v_customers
  from page;

  return jsonb_build_object(
    'success', true,
    'customers', v_customers,
    'limit', v_limit,
    'offset', v_offset,
    'total', v_total,
    'has_more', (v_offset + v_limit) < v_total
  );
end;
$$;

create or replace function public.pos_pull_customer_changes(
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
  v_customers jsonb;
  v_deleted_ids jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

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
      and e.entity_type = 'customer'
      and e.change_seq > coalesce(p_since_change_seq, 0)
    order by e.change_seq asc
    limit v_limit
  ), ids as (
    select distinct entity_id from pulled
  )
  select
    coalesce((select jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc) from pulled), '[]'::jsonb),
    coalesce((select max(pulled.change_seq) from pulled), coalesce(p_since_change_seq, 0)),
    coalesce((
      select jsonb_agg(private.pos_customer_to_jsonb(c) order by c.updated_at asc, c.id asc)
      from public.pos_customers c
      join ids on ids.entity_id = c.id
      where c.license_id = v_license_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(c.id)
      from public.pos_customers c
      join ids on ids.entity_id = c.id
      where c.license_id = v_license_id
        and c.deleted_at is not null
    ), '[]'::jsonb)
  into v_events, v_latest_returned, v_customers, v_deleted_ids;

  select coalesce(max(e.change_seq), coalesce(p_since_change_seq, 0))
  into v_server_latest
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type = 'customer';

  return jsonb_build_object(
    'success', true,
    'events', v_events,
    'customers', v_customers,
    'deleted_ids', v_deleted_ids,
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned
  );
end;
$$;

-- RPC batch controlada para migración inicial. Mantiene reglas del upsert por cada cliente.
create or replace function public.pos_migrate_local_customers(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_customers jsonb default '[]'::jsonb,
  p_batch_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_count integer := 0;
  v_key text;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

  if jsonb_typeof(p_customers) <> 'array' then
    raise exception 'CUSTOMERS_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_customers)
  loop
    v_count := v_count + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':customer:', coalesce(v_item->>'id', v_count::text));
    v_result := public.pos_upsert_customer(
      p_license_key,
      p_device_fingerprint,
      p_security_token,
      p_staff_session_token,
      v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)),
      null,
      v_key
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', v_count,
    'results', v_results
  );
end;
$$;

grant execute on function public.pos_upsert_customer(text, text, text, text, jsonb, integer, text) to anon, authenticated;
grant execute on function public.pos_delete_customer(text, text, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.pos_pull_customers_snapshot(text, text, text, text, integer, integer, boolean) to anon, authenticated;
grant execute on function public.pos_pull_customer_changes(text, text, text, text, bigint, integer) to anon, authenticated;
grant execute on function public.pos_migrate_local_customers(text, text, text, text, jsonb, text) to anon, authenticated;;
