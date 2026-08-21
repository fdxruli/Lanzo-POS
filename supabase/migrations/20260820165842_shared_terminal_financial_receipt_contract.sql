-- SHARED.TERMINAL.5A
--
-- Financial mutations deliberately use a dedicated receipt table.  The older
-- public.pos_idempotency_keys table is shared by non-financial RPCs and has
-- nullable request hashes, so changing its semantics would make unrelated
-- operations fail closed without a versioned request contract.
begin;

-- A cash-session ID is globally generated today, but the business contract is
-- tenant scoped.  Make that relationship explicit before using it as an FK.
alter table public.pos_cash_sessions
  add constraint pos_cash_sessions_license_id_id_uk unique (license_id, id);

create table if not exists public.pos_financial_operations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  idempotency_key text not null,
  legacy_idempotency_key text not null,
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
  constraint pos_financial_operations_license_legacy_key_uk unique (license_id, legacy_idempotency_key),
  constraint pos_financial_operations_session_fk
    foreign key (license_id, verified_cash_session_id)
    references public.pos_cash_sessions(license_id, id),
  constraint pos_financial_operations_station_fk
    foreign key (license_id, verified_cash_station_id)
    references public.pos_cash_stations(license_id, id)
);

create index if not exists idx_pos_financial_operations_receipt
  on public.pos_financial_operations (license_id, idempotency_key, request_hash);

alter table public.pos_financial_operations enable row level security;
revoke all on table public.pos_financial_operations from public, anon, authenticated;

-- Portable V1 JSON bytes: UTF-8, C/bytewise sorted object keys, compact JSON,
-- recursive arrays in input order.  jsonb scalar rendering supplies RFC JSON
-- escaping; normalized numeric values are already strings in the projection.
create or replace function private.financial_canonical_json_v1(p_value jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_key text; v_value jsonb; v_parts text[] := array[]::text[];
begin
  case jsonb_typeof(p_value)
    when 'object' then
      for v_key, v_value in select key, value from jsonb_each(p_value) order by key collate "C" loop
        v_parts := array_append(v_parts, to_jsonb(v_key)::text || ':' || private.financial_canonical_json_v1(v_value));
      end loop;
      return '{' || array_to_string(v_parts, ',') || '}';
    when 'array' then
      return '[' || coalesce((select string_agg(private.financial_canonical_json_v1(value), ',' order by ordinality) from jsonb_array_elements(p_value) with ordinality), '') || ']';
    else return p_value::text;
  end case;
end;
$$;

-- V1 hashes a whitelisted, operation-specific canonical JSON document.  It is
-- intentionally not an arbitrary jsonb::text MD5: callers submit a SHA-256 of
-- this exact canonical document, and the server recomputes it before reserve.
create or replace function private.financial_operation_hash(
  p_operation_type text,
  p_canonical_request jsonb,
  p_verified_actor_key text,
  p_verified_cash_session_id text,
  p_verified_cash_station_id text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_operation_type is null or btrim(p_operation_type) = ''
     or nullif(btrim(p_verified_actor_key), '') is null
     or jsonb_typeof(p_canonical_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  -- jsonb has deterministic object-key ordering.  The value was built from the
  -- V1 allowlist below, therefore this textual serialization is the defined
  -- canonical representation, not a serialization of arbitrary client JSON.
  return 'sha256:' || encode(
    extensions.digest(
      convert_to(private.financial_canonical_json_v1(jsonb_build_object(
        'request_contract_version', 1,
        'operation_type', p_operation_type,
        'request', p_canonical_request,
        'verified_origin', jsonb_build_object(
          'actor_key', p_verified_actor_key,
          'cash_session_id', p_verified_cash_session_id,
          'cash_station_id', p_verified_cash_station_id
        )
      )), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

create or replace function private.assert_financial_request_hash_v1(p_request_hash text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(p_request_hash), '') is null then
    raise exception 'FINANCIAL_REQUEST_HASH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_request_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'FINANCIAL_REQUEST_HASH_INVALID' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.financial_operation_internal_key_v1(
  p_operation_type text,
  p_operation_id uuid
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(p_operation_type), '') is null or p_operation_id is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  return 'financial-v1:' || p_operation_type || ':' || p_operation_id::text;
end;
$$;

create or replace function private.lock_financial_operation_v1(
  p_license_id uuid,
  p_external_idempotency_key text
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if nullif(btrim(p_external_idempotency_key), '') is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  -- Lock ordering is: tenant/K advisory lock, then financial-operation row,
  -- then the existing financial RPC's own locks.  Receipt only takes the first
  -- lock and reads, so it cannot form a reverse lock cycle.
  perform pg_advisory_xact_lock(hashtextextended(p_license_id::text || ':' || p_external_idempotency_key, 9152026));
end;
$$;

create or replace function private.resolve_financial_cash_station_v1(p_license_id uuid, p_device_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_station_id text;
begin
  select b.cash_station_id into v_station_id from public.pos_cash_station_bindings b
  join public.pos_cash_stations s on s.license_id=b.license_id and s.id=b.cash_station_id
  where b.license_id=p_license_id and b.device_id=p_device_id and b.status='active' and s.status='active';
  if v_station_id is null then raise exception 'CASH_STATION_UNRESOLVED' using errcode='P0001'; end if;
  return v_station_id;
end;
$$;

create or replace function private.assert_financial_operation_origin_v1(
  p_operation public.pos_financial_operations,
  p_current_actor_key text,
  p_current_device_id uuid,
  p_requested_cash_session_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_station_id text;
begin
  -- Actor is strict V1 replay authority.  Device is immutable provenance for
  -- sessionless work, but an operation with a cash session must be recovered
  -- from a device currently bound to that exact station.
  if p_operation.verified_actor_key is distinct from p_current_actor_key then
    raise exception 'FINANCIAL_OPERATION_ORIGIN_MISMATCH' using errcode = 'P0001';
  end if;
  if p_requested_cash_session_id is not null
     and p_operation.verified_cash_session_id is distinct from p_requested_cash_session_id then
    raise exception 'FINANCIAL_OPERATION_ORIGIN_MISMATCH' using errcode = 'P0001';
  end if;
  if p_operation.verified_cash_session_id is null then return; end if;
  if p_operation.verified_cash_station_id is null or p_current_device_id is null then
    raise exception 'FINANCIAL_OPERATION_ORIGIN_MISMATCH' using errcode = 'P0001';
  end if;
  select b.cash_station_id into v_current_station_id
  from public.pos_cash_station_bindings b
  where b.license_id = p_operation.license_id
    and b.device_id = p_current_device_id
    and b.status = 'active'
  limit 1;
  if v_current_station_id is distinct from p_operation.verified_cash_station_id then
    raise exception 'FINANCIAL_OPERATION_ORIGIN_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.financial_decimal_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v_numeric numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  v_numeric := trim_scale((p_value #>> '{}')::numeric);
  return v_numeric::text;
exception when invalid_text_representation then
  raise exception 'FINANCIAL_NUMERIC_INVALID' using errcode = 'P0001';
end;
$$;

create or replace function private.financial_integer_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  return ((p_value #>> '{}')::bigint)::text;
exception when invalid_text_representation then
  raise exception 'FINANCIAL_INTEGER_INVALID' using errcode = 'P0001';
end;
$$;

-- Alias handling is deliberately shallow and explicit.  This lets compatible
-- client spellings converge without admitting UI/metadata fields into H.
create or replace function private.financial_first_value_v1(p_object jsonb, p_keys text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare v_key text;
begin
  if jsonb_typeof(p_object) <> 'object' then return null; end if;
  foreach v_key in array p_keys loop
    if p_object ? v_key then return p_object -> v_key; end if;
  end loop;
  return null;
end;
$$;

create or replace function private.financial_text_v1(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(btrim(p_value #>> '{}'), '') $$;

create or replace function private.financial_timestamp_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  return to_char(((p_value #>> '{}')::timestamptz at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
exception when invalid_datetime_format then
  raise exception 'FINANCIAL_TIMESTAMP_INVALID' using errcode = 'P0001';
end;
$$;

-- This frozen V1 mapping mirrors the sale RPC contract without coupling H to
-- a future replacement of private.normalize_pos_sale_payment_method.
create or replace function private.financial_payment_method_v1(p_operation_type text, p_raw_method text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v_method text := lower(btrim(coalesce(p_raw_method, '')));
begin
  if p_operation_type = 'sale.credit'
     and v_method in ('mixed_credit','partial_credit','credito_parcial','crédito_parcial') then
    return 'mixed_credit';
  end if;
  if v_method in ('cash','efectivo') then return 'cash'; end if;
  if v_method in ('card','tarjeta','tarjeta_credito','tarjeta_debito','debit','credit_card','debit_card') then return 'card'; end if;
  if v_method in ('transfer','transferencia','spei','bank_transfer') then return 'transfer'; end if;
  if v_method in ('mixed','mixto') then return 'mixed'; end if;
  if v_method in ('fiado','credit','credito','crédito','debt','customer_credit','cuenta_cliente') then return 'credit'; end if;
  return nullif(v_method, '');
end;
$$;

-- Current inventory resolver semantics read only the allocation batch identity
-- and requested quantity.  The enclosing item binds product, quantity,
-- unit_cost, stock_source and direct batch_id; arbitrary metadata remains
-- provenance except its two batches_used aliases lifted here.
create or replace function private.canonical_financial_batch_allocations_v1(p_item jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'batch_id', private.financial_text_v1(private.financial_first_value_v1(value, array['batch_id','batchId','id'])),
    'quantity', private.financial_decimal_v1(private.financial_first_value_v1(value, array['quantity','qty','usedQuantity','used_quantity']))
  )) order by ordinality), '[]'::jsonb)
  from jsonb_array_elements(coalesce(
    private.financial_first_value_v1(p_item, array['batches_used','batchesUsed']),
    private.financial_first_value_v1(p_item->'metadata', array['batches_used','batchesUsed']),
    '[]'::jsonb
  )) with ordinality
$$;

-- REST.INV.5.1 tracks modifier inventory iff ingredient identity and a valid
-- resolved quantity exist; explicit tracksInventory is deliberately ignored.
create or replace function private.canonical_financial_selected_modifiers_v1(p_item jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_modifiers jsonb;
begin
  v_modifiers := coalesce(private.financial_first_value_v1(p_item, array['selected_modifiers','selectedModifiers']), private.financial_first_value_v1(p_item->'metadata', array['selected_modifiers','selectedModifiers']), '[]'::jsonb);
  if jsonb_typeof(v_modifiers) <> 'array' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'ingredient_id', private.financial_text_v1(private.financial_first_value_v1(value, array['ingredientId','ingredient_id'])),
    'ingredient_quantity', private.financial_decimal_v1(private.financial_first_value_v1(value, array['ingredientQuantity','ingredient_quantity','quantity']))
  )) order by ordinality) from jsonb_array_elements(v_modifiers) with ordinality), '[]'::jsonb);
end;
$$;

create or replace function private.canonical_financial_sale_item_v1(p_item jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', private.financial_text_v1(private.financial_first_value_v1(p_item, array['id'])),
    'product_id', private.financial_text_v1(private.financial_first_value_v1(p_item, array['product_id','productId','parentId'])),
    'product_name', private.financial_text_v1(private.financial_first_value_v1(p_item, array['product_name','productName','name'])),
    'product_sku', private.financial_text_v1(private.financial_first_value_v1(p_item, array['product_sku','productSku','sku'])),
    'barcode', private.financial_text_v1(private.financial_first_value_v1(p_item, array['barcode','barCode'])),
    'category_id', private.financial_text_v1(private.financial_first_value_v1(p_item, array['category_id','categoryId'])),
    'category_name', private.financial_text_v1(private.financial_first_value_v1(p_item, array['category_name','categoryName','rubro','category'])),
    'batch_id', private.financial_text_v1(private.financial_first_value_v1(p_item, array['batch_id','batchId'])),
    'batch_sku', private.financial_text_v1(private.financial_first_value_v1(p_item, array['batch_sku','batchSku'])),
    'batch_expiry_date', private.financial_text_v1(private.financial_first_value_v1(p_item, array['batch_expiry_date','batchExpiryDate','expiryDate'])),
    'stock_source', private.financial_text_v1(private.financial_first_value_v1(p_item, array['stock_source','stockSource'])),
    'batch_allocations', private.canonical_financial_batch_allocations_v1(p_item),
    'selected_modifiers', private.canonical_financial_selected_modifiers_v1(p_item),
    'quantity', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['quantity','qty'])),
    'unit_price', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['unit_price','unitPrice','price'])),
    'unit_cost', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['unit_cost','unitCost','cost'])),
    'line_total', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['line_total','lineTotal','total','exactTotal'])),
    'discount_amount', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['discount_amount','discountAmount'])),
    'tax_amount', private.financial_decimal_v1(private.financial_first_value_v1(p_item, array['tax_amount','taxAmount']))
  ))
$$;

create or replace function private.canonical_financial_payment_v1(p_operation_type text, p_payment jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', private.financial_text_v1(private.financial_first_value_v1(p_payment, array['id'])),
    'method', private.financial_payment_method_v1(p_operation_type, private.financial_text_v1(private.financial_first_value_v1(p_payment, array['method','payment_method','paymentMethod']))),
    'amount', private.financial_decimal_v1(private.financial_first_value_v1(p_payment, array['amount','total'])),
    'received_amount', private.financial_decimal_v1(private.financial_first_value_v1(p_payment, array['received_amount','receivedAmount'])),
    'change_amount', private.financial_decimal_v1(private.financial_first_value_v1(p_payment, array['change_amount','changeAmount'])),
    'reference', private.financial_text_v1(private.financial_first_value_v1(p_payment, array['reference','ref']))
  ))
$$;

create or replace function private.canonical_financial_sale_v1(p_operation_type text, p_sale jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['id','cloud_sale_id','cloudSaleId'])),
    'local_sale_id', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['local_sale_id','localSaleId'])),
    'subtotal', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['subtotal'])),
    'discount_total', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['discount_total','discountTotal'])),
    'tax_total', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['tax_total','taxTotal'])),
    'total', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['total'])),
    'amount_paid', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['amount_paid','amountPaid','abono'])),
    'change_amount', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['change_amount','changeAmount'])),
    'balance_due', private.financial_decimal_v1(private.financial_first_value_v1(p_sale, array['balance_due','balanceDue','saldoPendiente'])),
    'payment_method', private.financial_payment_method_v1(p_operation_type, private.financial_text_v1(private.financial_first_value_v1(p_sale, array['payment_method','paymentMethod']))),
    'fulfillment_status', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['fulfillment_status','fulfillmentStatus'])),
    'local_folio', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['local_folio','localFolio','folio'])),
    'customer_id', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['customer_id','customerId'])),
    'customer_name', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['customer_name','customerName'])),
    'customer_phone', private.financial_text_v1(private.financial_first_value_v1(p_sale, array['customer_phone','customerPhone'])),
    'currency', upper(private.financial_text_v1(private.financial_first_value_v1(p_sale, array['currency']))),
    'sold_at', private.financial_timestamp_v1(private.financial_first_value_v1(p_sale, array['sold_at','soldAt','timestamp'])),
    'created_at', private.financial_timestamp_v1(private.financial_first_value_v1(p_sale, array['created_at','createdAt','timestamp']))
  ))
$$;

-- V1 semantic allowlist.  Credentials, trace/UI fields and arbitrary metadata
-- are excluded; supplied sale business timestamps are bound.  Effect table:
-- sale totals/payment/customer/state/timestamps -> H; item product/batch/qty/
-- cost/source and explicit batch allocations -> H; cash session -> H.  Other
-- metadata is provenance only and remains on the untouched execution payload.
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
        'opening_amount', coalesce(private.financial_decimal_v1(private.financial_first_value_v1(v_request,array['opening_amount','montoInicial'])),'0'),
        'opening_counted_amount', private.financial_decimal_v1(private.financial_first_value_v1(v_request,array['opening_counted_amount','montoContado','montoContadoInicial'])),
        'opening_suggested_amount', private.financial_decimal_v1(private.financial_first_value_v1(v_request,array['opening_suggested_amount','montoSugerido'])),
        'opening_policy', private.financial_text_v1(private.financial_first_value_v1(v_request,array['opening_policy','politicaApertura'])),
        'opening_origin', private.financial_text_v1(private.financial_first_value_v1(v_request,array['opening_origin','origen'])),
        'is_auto_opening', private.financial_text_v1(private.financial_first_value_v1(v_request,array['is_auto_opening','esAutoApertura'])),
        'responsible_name', private.financial_text_v1(private.financial_first_value_v1(v_request,array['responsible_name','responsable']))
      ));
    when 'cash.movement' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'type', v_request->>'type', 'amount', private.financial_decimal_v1(v_request->'amount'),
        'concept', v_request->>'concept', 'source', v_request->>'source',
        'reference_type', v_request->>'reference_type', 'reference_id', v_request->>'reference_id');
    when 'cash.adjust_initial_fund' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'new_opening_amount', private.financial_decimal_v1(v_request->'new_opening_amount'),
        'reason', v_request->>'reason', 'expected_version', private.financial_integer_v1(v_request->'expected_version'));
    when 'cash.close' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'closing_counted_amount', private.financial_decimal_v1(private.financial_first_value_v1(v_request,array['closing_counted_amount','countedAmount','montoFisicoTotal'])),
        'next_shift_fund', private.financial_decimal_v1(private.financial_first_value_v1(v_request,array['next_shift_fund','nextShiftFund','montoFondoSiguienteTurno'])),
        'comments', private.financial_text_v1(private.financial_first_value_v1(v_request,array['audit_comments','comments','comentarios'])), 'expected_version', private.financial_integer_v1(v_request->'expected_version'));
    when 'cash.admin_close' then
      return jsonb_build_object('cash_session_id', v_request->>'cash_session_id',
        'closing_mode', v_request->>'closing_mode', 'counted_amount', private.financial_decimal_v1(v_request->'counted_amount'),
        'next_shift_fund', private.financial_decimal_v1(v_request->'next_shift_fund'), 'reason_code', v_request->>'reason_code',
        'comments', v_request->>'comments', 'expected_version', private.financial_integer_v1(v_request->'expected_version'));
    when 'sale.cashier', 'sale.cashier_inventory', 'sale.credit' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_SALE_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object('sale', private.canonical_financial_sale_v1(p_operation_type, v_request->'sale'),
        'items', (select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(value) order by ordinality), '[]'::jsonb)
                    from jsonb_array_elements(v_request->'items') with ordinality),
        'payments', (select coalesce(jsonb_agg(private.canonical_financial_payment_v1(p_operation_type, value) order by ordinality), '[]'::jsonb)
                     from jsonb_array_elements(v_request->'payments') with ordinality),
        'cash_session_id', private.financial_text_v1(v_request->'cash_session_id'),
        'customer_id', private.financial_text_v1(v_request->'customer_id'));
    when 'sale.cancel' then
      return jsonb_build_object('sale_id', v_request->>'sale_id', 'reason', v_request->>'reason');
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$$;

-- Hash projection is evidence only.  Existing RPCs receive this untouched,
-- validated execution document so allocation/persisted provenance fields are
-- not rewritten by the intentionally narrow V1 hash representation.
create or replace function private.financial_execution_request_v1(p_request jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  return p_request;
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
  p_cash_session_id text default null,
  p_verified_cash_station_id text default null
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
  v_internal_idempotency_key text;
  v_operation_id uuid := extensions.gen_random_uuid();
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  perform private.assert_financial_request_hash_v1(p_request_hash);
  -- Reconstruct the origin-bound H from this invocation before considering an
  -- existing receipt.  A stale H may never turn a changed request into replay.
  if p_cash_session_id is not null then
    select * into v_session from public.pos_cash_sessions s
    where s.license_id = p_license_id and s.id = p_cash_session_id and s.deleted_at is null;
    if v_session.id is null then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  v_expected_hash := private.financial_operation_hash(
    p_operation_type, p_canonical_request, p_verified_actor_key,
    p_cash_session_id, coalesce(v_session.cash_station_id, p_verified_cash_station_id)
  );
  if p_request_hash is distinct from v_expected_hash then
    raise exception 'FINANCIAL_REQUEST_HASH_INVALID' using errcode = 'P0001';
  end if;
  perform private.lock_financial_operation_v1(p_license_id, p_idempotency_key);

  -- Financial K/H state is authoritative and takes precedence over a generic
  -- idempotency row.  The latter is consulted only when no financial row exists.
  select * into v_existing from public.pos_financial_operations o
  where o.license_id = p_license_id and o.idempotency_key = p_idempotency_key
  for update;
  if v_existing.id is not null then
    if v_existing.legacy_idempotency_key is distinct from
       private.financial_operation_internal_key_v1(v_existing.operation_type, v_existing.id) then
      raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_INTEGRITY' using errcode = 'P0001';
    end if;
    if v_existing.request_hash is distinct from p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    perform private.assert_financial_operation_origin_v1(
      v_existing, p_verified_actor_key, p_verified_device_id, p_cash_session_id
    );
    return v_existing;
  end if;

  -- A generic K in the external namespace predates strict V1 and cannot be
  -- adopted.  V1 itself writes only a server-owned internal namespace below.
  if exists (
    select 1 from public.pos_idempotency_keys k
  where k.license_id = p_license_id and k.idempotency_key = p_idempotency_key
  ) then raise exception 'LEGACY_IDEMPOTENCY_UNVERIFIED' using errcode = 'P0001'; end if;
  v_internal_idempotency_key := private.financial_operation_internal_key_v1(p_operation_type, v_operation_id);
  -- Never adopt a preexisting generic row in this server-generated namespace.
  -- With no strict owner above, this is a collision, not a replay.
  if exists (
    select 1 from public.pos_idempotency_keys k
    where k.license_id = p_license_id and k.idempotency_key = v_internal_idempotency_key
  ) then raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_COLLISION' using errcode = 'P0001'; end if;

  insert into public.pos_financial_operations (
    id, license_id, idempotency_key, legacy_idempotency_key, request_hash, operation_type,
    verified_actor_key, verified_device_id, verified_cash_session_id, verified_cash_station_id,
    canonical_request
  ) values (
    v_operation_id, p_license_id, p_idempotency_key, v_internal_idempotency_key, p_request_hash, p_operation_type,
    p_verified_actor_key, p_verified_device_id, p_cash_session_id, coalesce(v_session.cash_station_id, p_verified_cash_station_id),
    p_canonical_request
  ) on conflict (license_id, idempotency_key) do nothing
  returning * into v_result;

  if v_result.id is null then
    raise exception 'FINANCIAL_OPERATION_RESERVATION_FAILED' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function private.assert_financial_legacy_result_terminal_v1(
  p_operation_type text,
  p_response jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare v_code text;
begin
  if jsonb_typeof(p_response) <> 'object' then
    raise exception 'FINANCIAL_LEGACY_RESPONSE_INVALID' using errcode = 'P0001';
  end if;
  v_code := nullif(btrim(p_response->>'code'), '');
  if v_code = 'IDEMPOTENCY_PROCESSING' then
    raise exception 'FINANCIAL_LEGACY_RESPONSE_NONTERMINAL' using errcode = 'P0001';
  end if;
  if (p_response->>'success')::boolean is not true then
    raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%', coalesce(v_code, 'SUCCESS_FALSE') using errcode = 'P0001';
  end if;
end;
$$;

-- Structural JSON traversal replaces only exact machine idempotency fields.
-- User concept/reason/comment strings are never substring-rewritten.
create or replace function private.sanitize_financial_response_idempotency_v1(
  p_value jsonb, p_external_idempotency_key text, p_internal_idempotency_key text
)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_key text; v_value jsonb; v_result jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_value) = 'array' then
    return coalesce((select jsonb_agg(private.sanitize_financial_response_idempotency_v1(value, p_external_idempotency_key, p_internal_idempotency_key) order by ordinality) from jsonb_array_elements(p_value) with ordinality), '[]'::jsonb);
  end if;
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;
  for v_key, v_value in select key, value from jsonb_each(p_value) loop
    if lower(v_key) in ('idempotency_key','last_idempotency_key')
       and v_value = to_jsonb(p_internal_idempotency_key) then
      v_result := v_result || jsonb_build_object(v_key, p_external_idempotency_key);
    else
      v_result := v_result || jsonb_build_object(v_key, private.sanitize_financial_response_idempotency_v1(v_value, p_external_idempotency_key, p_internal_idempotency_key));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function private.assert_financial_response_no_internal_key_v1(p_value jsonb, p_internal_idempotency_key text)
returns void language plpgsql immutable set search_path = '' as $$
declare v_key text; v_value jsonb;
begin
  if jsonb_typeof(p_value) = 'array' then
    for v_value in select value from jsonb_array_elements(p_value) loop perform private.assert_financial_response_no_internal_key_v1(v_value, p_internal_idempotency_key); end loop;
  elsif jsonb_typeof(p_value) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      if lower(v_key) like '%idempotency_key' and v_value = to_jsonb(p_internal_idempotency_key) then
        raise exception 'FINANCIAL_INTERNAL_KEY_LEAK' using errcode = 'P0001';
      end if;
      perform private.assert_financial_response_no_internal_key_v1(v_value, p_internal_idempotency_key);
    end loop;
  end if;
end;
$$;

create or replace function private.public_financial_response_v1(
  p_operation_type text,
  p_response jsonb,
  p_external_idempotency_key text,
  p_internal_idempotency_key text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare v_response jsonb;
begin
  perform private.assert_financial_legacy_result_terminal_v1(p_operation_type, p_response);
  v_response := private.sanitize_financial_response_idempotency_v1(p_response, p_external_idempotency_key, p_internal_idempotency_key);
  perform private.assert_financial_response_no_internal_key_v1(v_response, p_internal_idempotency_key);
  return jsonb_set(v_response, '{idempotency_key}', to_jsonb(p_external_idempotency_key), true);
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
  v_execution jsonb;
  v_cash_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  if p_operation_type in ('sale.cashier','sale.cashier_inventory','sale.credit')
     and nullif(btrim(p_request->>'cash_session_id'),'') is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation_type = 'cash.open' then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;
  v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
  v_execution := private.financial_execution_request_v1(p_request);
  v_operation := private.reserve_financial_operation_v1(v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id, v_canonical->>'cash_session_id', v_cash_station_id);

  if v_operation.status = 'completed' then return v_operation.response_payload; end if;
  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_execution, v_internal_idempotency_key);
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric, v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object('source', v_execution->>'source', 'reference_type', v_execution->>'reference_type', 'reference_id', v_execution->>'reference_id')));
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric, v_execution->>'reason', (v_execution->>'expected_version')::integer, v_internal_idempotency_key);
    when 'cash.close' then
      v_response := public.pos_close_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer, v_internal_idempotency_key);
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode', (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments', (v_execution->>'expected_version')::integer, v_internal_idempotency_key);
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments', v_execution->>'cash_session_id', v_internal_idempotency_key);
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments', v_execution->>'cash_session_id', v_internal_idempotency_key);
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments', v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key);
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key);
    else raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
  -- Reject nonterminal/malformed inner output, then scrub internal K before it
  -- can become a durable receipt or a public response.
  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
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
  v_device_id uuid;
  v_actor_key text;
  v_operation public.pos_financial_operations;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  perform private.assert_financial_request_hash_v1(p_request_hash);
  -- Wait for an in-flight executor with this tenant/K to commit or roll back,
  -- then read a fresh statement snapshot.  A committed unresolved row is the
  -- only legitimate PROCESSING response; transient in-flight work is never
  -- misreported as a permanent NOT_FOUND.
  perform private.lock_financial_operation_v1(v_license_id, p_idempotency_key);
  select * into v_operation from public.pos_financial_operations o
  where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then return jsonb_build_object('status', 'NOT_FOUND'); end if;
  begin
    perform private.assert_financial_operation_origin_v1(v_operation, v_actor_key, v_device_id, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('status', 'NOT_FOUND');
  end;
  if v_operation.request_hash is distinct from p_request_hash then
    return jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  if v_operation.status = 'processing' then
    return jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
  end if;
  return jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', v_operation.response_payload);
end;
$$;

revoke all on function private.financial_operation_hash(text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function private.financial_canonical_json_v1(jsonb) from public, anon, authenticated;
revoke all on function private.resolve_financial_cash_station_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function private.assert_financial_request_hash_v1(text) from public, anon, authenticated;
revoke all on function private.financial_operation_internal_key_v1(text, uuid) from public, anon, authenticated;
revoke all on function private.lock_financial_operation_v1(uuid, text) from public, anon, authenticated;
revoke all on function private.assert_financial_operation_origin_v1(public.pos_financial_operations, text, uuid, text) from public, anon, authenticated;
revoke all on function private.financial_decimal_v1(jsonb) from public, anon, authenticated;
revoke all on function private.financial_integer_v1(jsonb) from public, anon, authenticated;
revoke all on function private.financial_first_value_v1(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.financial_text_v1(jsonb) from public, anon, authenticated;
revoke all on function private.financial_timestamp_v1(jsonb) from public, anon, authenticated;
revoke all on function private.financial_payment_method_v1(text, text) from public, anon, authenticated;
revoke all on function private.canonical_financial_batch_allocations_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_selected_modifiers_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_sale_item_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_payment_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_sale_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_request_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.financial_execution_request_v1(jsonb) from public, anon, authenticated;
revoke all on function private.reserve_financial_operation_v1(uuid, text, text, text, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function private.assert_financial_legacy_result_terminal_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.sanitize_financial_response_idempotency_v1(jsonb, text, text) from public, anon, authenticated;
revoke all on function private.assert_financial_response_no_internal_key_v1(jsonb, text) from public, anon, authenticated;
revoke all on function private.public_financial_response_v1(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function private.complete_financial_operation_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.pos_get_financial_operation_receipt(text, text, text, text, text, text) from public;
grant execute on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.pos_get_financial_operation_receipt(text, text, text, text, text, text) to anon, authenticated;
comment on table public.pos_financial_operations is
  'SHARED.TERMINAL.5A canonical K+H financial receipt; legacy pos_idempotency_keys rows are intentionally not replay proof.';
notify pgrst, 'reload schema';
commit;
