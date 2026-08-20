-- SHARED.TERMINAL.5A
--
-- Financial mutations deliberately use a dedicated receipt table.  The older
-- public.pos_idempotency_keys table is shared by non-financial RPCs and has
-- nullable request hashes, so changing its semantics would make unrelated
-- operations fail closed without a versioned request contract.
begin;

create table if not exists public.pos_financial_operations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  request_contract_version integer not null default 1,
  operation_type text not null,
  verified_actor_key text not null,
  verified_device_id uuid null references public.license_devices(id),
  verified_cash_session_id text null,
  verified_cash_station_id text null,
  canonical_request jsonb not null,
  status text not null default 'processing',
  response_payload jsonb null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint pos_financial_operations_status_chk
    check (status in ('processing', 'completed')),
  constraint pos_financial_operations_hash_chk
    check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint pos_financial_operations_contract_chk
    check (request_contract_version = 1),
  constraint pos_financial_operations_completed_chk
    check ((status = 'completed') = (completed_at is not null)),
  constraint pos_financial_operations_license_key_uk unique (license_id, idempotency_key),
  constraint pos_financial_operations_session_fk
    foreign key (verified_cash_session_id)
    references public.pos_cash_sessions(id),
  constraint pos_financial_operations_station_fk
    foreign key (license_id, verified_cash_station_id)
    references public.pos_cash_stations(license_id, id)
);

create index if not exists idx_pos_financial_operations_receipt
  on public.pos_financial_operations (license_id, idempotency_key, request_hash);

alter table public.pos_financial_operations enable row level security;
revoke all on table public.pos_financial_operations from public, anon, authenticated;

-- V1 hashes a whitelisted, operation-specific canonical JSON document.  It is
-- intentionally not an arbitrary jsonb::text MD5: callers submit a SHA-256 of
-- this exact canonical document, and the server recomputes it before reserve.
create or replace function private.financial_operation_hash(
  p_operation_type text,
  p_canonical_request jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_operation_type is null or btrim(p_operation_type) = ''
     or jsonb_typeof(p_canonical_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  -- jsonb has deterministic object-key ordering.  The value was built from the
  -- V1 allowlist below, therefore this textual serialization is the defined
  -- canonical representation, not a serialization of arbitrary client JSON.
  return 'sha256:' || encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'request_contract_version', 1,
        'operation_type', p_operation_type,
        'request', p_canonical_request
      )::text, 'utf8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

-- V1 semantic allowlist.  Authentication material, trace/UI fields, timestamps
-- and arbitrary metadata are excluded.  Sale documents are carried as explicit
-- business documents because their line/payment fields change financial meaning.
create or replace function private.canonical_financial_request_v1(
  p_operation_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_request jsonb := coalesce(p_request, '{}'::jsonb);
begin
  if jsonb_typeof(v_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'cash.open' then
      return jsonb_build_object('opening', jsonb_build_object(
        'opening_amount', v_request->>'opening_amount',
        'opening_counted_amount', v_request->>'opening_counted_amount',
        'opening_suggested_amount', v_request->>'opening_suggested_amount',
        'opening_policy', v_request->>'opening_policy',
        'opening_origin', v_request->>'opening_origin',
        'is_auto_opening', v_request->>'is_auto_opening',
        'responsible_name', v_request->>'responsible_name'
      ));
    when 'cash.movement' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'type', v_request->>'type', 'amount', v_request->>'amount',
        'concept', v_request->>'concept', 'source', v_request->>'source',
        'reference_type', v_request->>'reference_type', 'reference_id', v_request->>'reference_id');
    when 'cash.adjust_initial_fund' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'new_opening_amount', v_request->>'new_opening_amount',
        'reason', v_request->>'reason', 'expected_version', v_request->>'expected_version');
    when 'cash.close' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'closing_counted_amount', v_request->>'closing_counted_amount',
        'next_shift_fund', v_request->>'next_shift_fund',
        'comments', v_request->>'comments', 'expected_version', v_request->>'expected_version');
    when 'cash.admin_close' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'closing_mode', v_request->>'closing_mode', 'counted_amount', v_request->>'counted_amount',
        'next_shift_fund', v_request->>'next_shift_fund', 'reason_code', v_request->>'reason_code',
        'comments', v_request->>'comments', 'expected_version', v_request->>'expected_version');
    when 'sale.cashier', 'sale.cashier_inventory', 'sale.credit' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_SALE_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object('sale', v_request->'sale' - 'metadata' - 'created_at' - 'createdAt' - 'timestamp',
        'items', (select coalesce(jsonb_agg(value - 'metadata' order by ordinality), '[]'::jsonb)
                    from jsonb_array_elements(v_request->'items') with ordinality),
        'payments', (select coalesce(jsonb_agg(value - 'metadata' order by ordinality), '[]'::jsonb)
                     from jsonb_array_elements(v_request->'payments') with ordinality),
        'cash_session_id', v_request->>'cash_session_id', 'customer_id', v_request->>'customer_id');
    when 'sale.cancel' then
      return jsonb_build_object('sale_id', v_request->>'sale_id', 'reason', v_request->>'reason');
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$$;

create or replace function private.reserve_financial_operation_v1(
  p_license_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_operation_type text,
  p_canonical_request jsonb,
  p_verified_actor_key text,
  p_verified_device_id uuid,
  p_cash_session_id text default null
)
returns public.pos_financial_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pos_financial_operations;
  v_result public.pos_financial_operations;
  v_expected_hash text;
  v_session public.pos_cash_sessions;
begin
  if nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_request_hash), '') is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_AND_HASH_REQUIRED' using errcode = 'P0001';
  end if;
  v_expected_hash := private.financial_operation_hash(p_operation_type, p_canonical_request);
  if p_request_hash <> v_expected_hash then
    raise exception 'FINANCIAL_REQUEST_HASH_INVALID' using errcode = 'P0001';
  end if;

  -- A K-only generic row cannot prove a strict K+H financial replay.  Refuse
  -- this new endpoint rather than binding an old response to new semantics.
  if exists (
    select 1 from public.pos_idempotency_keys k
    where k.license_id = p_license_id and k.idempotency_key = p_idempotency_key
  ) then
    raise exception 'LEGACY_IDEMPOTENCY_UNVERIFIED' using errcode = 'P0001';
  end if;

  if p_cash_session_id is not null then
    select * into v_session from public.pos_cash_sessions s
    where s.license_id = p_license_id and s.id = p_cash_session_id and s.deleted_at is null;
    if v_session.id is null then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  insert into public.pos_financial_operations (
    license_id, idempotency_key, request_hash, operation_type,
    verified_actor_key, verified_device_id, verified_cash_session_id, verified_cash_station_id,
    canonical_request
  ) values (
    p_license_id, p_idempotency_key, p_request_hash, p_operation_type,
    p_verified_actor_key, p_verified_device_id, p_cash_session_id, v_session.cash_station_id,
    p_canonical_request
  ) on conflict (license_id, idempotency_key) do nothing
  returning * into v_result;

  if v_result.id is not null then return v_result; end if;

  select * into v_existing from public.pos_financial_operations o
  where o.license_id = p_license_id and o.idempotency_key = p_idempotency_key
  for update;
  if v_existing.request_hash <> p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  return v_existing;
end;
$$;

create or replace function private.complete_financial_operation_v1(
  p_license_id uuid,
  p_idempotency_key text,
  p_response jsonb
)
returns public.pos_financial_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.pos_financial_operations;
  v_session_id text;
  v_session public.pos_cash_sessions;
begin
  select * into v_operation from public.pos_financial_operations o
  where o.license_id = p_license_id and o.idempotency_key = p_idempotency_key
  for update;
  if v_operation.id is null then raise exception 'FINANCIAL_OPERATION_NOT_RESERVED' using errcode = 'P0001'; end if;
  if v_operation.status = 'completed' then return v_operation; end if;

  v_session_id := coalesce(p_response #>> '{cash_session,id}', p_response #>> '{cash_session_id}');
  if v_session_id is not null then
    select * into v_session from public.pos_cash_sessions s
    where s.license_id = p_license_id and s.id = v_session_id;
  end if;
  update public.pos_financial_operations
  set status = 'completed', response_payload = p_response, completed_at = now(),
      verified_cash_session_id = coalesce(verified_cash_session_id, v_session.id),
      verified_cash_station_id = coalesce(verified_cash_station_id, v_session.cash_station_id)
  where id = v_operation.id
  returning * into v_operation;
  return v_operation;
end;
$$;

-- The V1 executor is the only newly wired runtime entrypoint.  It validates
-- K/H before dispatching to the existing audited financial RPCs; both the
-- business mutation and receipt completion are part of this one transaction.
-- CUSTOMER_PAYMENT_SERVER_CONTRACT_UNVERIFIED: repository-wide history search
-- found references but no versioned CREATE FUNCTION for pos_record_customer_payment.
-- It is intentionally excluded; do not add a guessed dispatch branch here.
create or replace function public.pos_execute_financial_operation_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_idempotency_key text default null,
  p_request_hash text default null,
  p_operation_type text default null,
  p_request jsonb default '{}'::jsonb
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
  v_canonical jsonb;
  v_operation public.pos_financial_operations;
  v_response jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
  v_operation := private.reserve_financial_operation_v1(v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id, v_canonical->>'cash_session_id');

  if v_operation.status = 'completed' then return v_operation.response_payload; end if;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_canonical->'opening', p_idempotency_key);
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        p_request->>'cash_session_id', p_request->>'type', (p_request->>'amount')::numeric, p_request->>'concept', p_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object('source', p_request->>'source', 'reference_type', p_request->>'reference_type', 'reference_id', p_request->>'reference_id')));
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        p_request->>'cash_session_id', (p_request->>'new_opening_amount')::numeric, p_request->>'reason', (p_request->>'expected_version')::integer, p_idempotency_key);
    when 'cash.close' then
      v_response := public.pos_close_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        p_request->>'cash_session_id', jsonb_strip_nulls(jsonb_build_object('closing_counted_amount', p_request->>'closing_counted_amount', 'next_shift_fund', p_request->>'next_shift_fund', 'comments', p_request->>'comments')),
        (p_request->>'expected_version')::integer, p_idempotency_key);
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        p_request->>'cash_session_id', p_request->>'closing_mode', (p_request->>'counted_amount')::numeric, (p_request->>'next_shift_fund')::numeric,
        p_request->>'reason_code', p_request->>'comments', (p_request->>'expected_version')::integer, p_idempotency_key);
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_canonical->'sale', v_canonical->'items', v_canonical->'payments', v_canonical->>'cash_session_id', p_idempotency_key);
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_canonical->'sale', v_canonical->'items', v_canonical->'payments', v_canonical->>'cash_session_id', p_idempotency_key);
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_canonical->'sale', v_canonical->'items', v_canonical->'payments', v_canonical->>'cash_session_id', v_canonical->>'customer_id', p_idempotency_key);
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        p_request->>'sale_id', p_request->>'reason', p_idempotency_key);
    else raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- This receipt endpoint is read-only.  It authenticates with the existing
-- device/license/session contract and never creates, updates, or dispatches.
create or replace function public.pos_get_financial_operation_receipt(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_operation public.pos_financial_operations;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  select * into v_operation from public.pos_financial_operations o
  where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then return jsonb_build_object('status', 'NOT_FOUND'); end if;
  if v_operation.request_hash <> p_request_hash then
    return jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  if v_operation.status = 'processing' then
    return jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
  end if;
  return jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', v_operation.response_payload);
end;
$$;

revoke all on function private.financial_operation_hash(text, jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_request_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.reserve_financial_operation_v1(uuid, text, text, text, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function private.complete_financial_operation_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.pos_get_financial_operation_receipt(text, text, text, text, text, text) from public;
grant execute on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.pos_get_financial_operation_receipt(text, text, text, text, text, text) to anon, authenticated;
comment on table public.pos_financial_operations is
  'SHARED.TERMINAL.5A canonical K+H financial receipt; legacy pos_idempotency_keys rows are intentionally not replay proof.';
notify pgrst, 'reload schema';
commit;
