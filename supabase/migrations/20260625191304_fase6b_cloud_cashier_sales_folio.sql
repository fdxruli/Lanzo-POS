-- FASE 6B — Venta efectiva cloud con caja y folio PRO
-- Alcance: ventas cloud pagadas/no fiadas, folio cloud, caja cloud para efectivo,
-- sin inventario cloud y sin credito/ledger cloud.

alter table public.pos_sales
  add column if not exists cloud_folio text,
  add column if not exists folio_sequence bigint,
  add column if not exists cash_effect_status text,
  add column if not exists inventory_effect_status text not null default 'not_applied',
  add column if not exists credit_effect_status text not null default 'not_applied',
  add column if not exists committed_at timestamptz;

alter table public.pos_cash_sessions
  add column if not exists sales_total numeric not null default 0,
  add column if not exists non_cash_sales_total numeric not null default 0,
  add column if not exists sales_count integer not null default 0;

alter table public.pos_cash_movements
  add column if not exists sale_id text null;

create table if not exists public.pos_folio_sequences (
  license_id uuid not null references public.licenses(id) on delete cascade,
  sequence_name text not null,
  current_value bigint not null default 0,
  prefix text not null default 'V',
  padding integer not null default 6,
  updated_at timestamptz not null default now(),
  primary key (license_id, sequence_name),
  constraint pos_folio_sequences_current_value_check check (current_value >= 0),
  constraint pos_folio_sequences_padding_check check (padding between 1 and 12),
  constraint pos_folio_sequences_prefix_check check (length(btrim(prefix)) > 0)
);

alter table public.pos_folio_sequences enable row level security;

create index if not exists idx_pos_cash_movements_license_sale_id
  on public.pos_cash_movements (license_id, sale_id)
  where sale_id is not null;

create index if not exists idx_pos_cash_movements_license_source_created
  on public.pos_cash_movements (license_id, source, created_at desc);

create unique index if not exists ux_pos_sales_license_cloud_folio
  on public.pos_sales (license_id, cloud_folio)
  where cloud_folio is not null and deleted_at is null;

create index if not exists idx_pos_sales_license_source_effects_sold
  on public.pos_sales (license_id, source_mode, effects_status, sold_at desc);

-- Ampliar checks de estados/eventos sin romper valores previos.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pos_sales'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%effects_status%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.pos_sales drop constraint %I', v_name);
  end if;

  alter table public.pos_sales
    add constraint pos_sales_effects_status_check
    check (effects_status = any (array[
      'local_applied'::text,
      'cloud_pending'::text,
      'cloud_applied'::text,
      'cash_applied'::text,
      'payment_recorded'::text,
      'failed'::text
    ]));
end $$;

do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pos_cash_movements'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%type = ANY%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.pos_cash_movements drop constraint %I', v_name);
  end if;

  alter table public.pos_cash_movements
    add constraint pos_cash_movements_type_check
    check (type = any (array[
      'entrada'::text,
      'salida'::text,
      'ajuste_entrada'::text,
      'ajuste_salida'::text,
      'fondo_inicial_ajuste'::text,
      'venta'::text,
      'venta_efectivo'::text,
      'abono_cliente'::text,
      'cancelacion'::text
    ]));
end $$;

do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.pos_sync_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%operation = ANY%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.pos_sync_events drop constraint %I', v_name);
  end if;

  alter table public.pos_sync_events
    add constraint pos_sync_events_operation_check
    check (operation = any (array[
      'create'::text,
      'update'::text,
      'delete'::text,
      'restore'::text,
      'upsert'::text,
      'upsert_shadow'::text,
      'cloud_commit'::text,
      'toggle_status'::text,
      'sync_checkpoint'::text,
      'open'::text,
      'close'::text,
      'movement'::text,
      'adjust'::text,
      'unknown'::text
    ]));
end $$;

create or replace function private.assert_cloud_sales_cashier_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);
  perform private.assert_cloud_sales_sync_base_enabled(p_context);
  perform private.assert_cloud_cash_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_cashier')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_CASHIER_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.normalize_pos_sale_payment_method(p_method text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_method text := lower(btrim(coalesce(p_method, '')));
begin
  if v_method in ('cash', 'efectivo') then
    return 'cash';
  end if;
  if v_method in ('card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'debit', 'credit_card', 'debit_card') then
    return 'card';
  end if;
  if v_method in ('transfer', 'transferencia', 'spei', 'bank_transfer') then
    return 'transfer';
  end if;
  if v_method in ('mixed', 'mixto') then
    return 'mixed';
  end if;
  if v_method in ('fiado', 'credit', 'credito', 'crédito', 'debt', 'customer_credit', 'cuenta_cliente') then
    return 'credit';
  end if;
  return nullif(v_method, '');
end;
$$;

create or replace function private.next_pos_sale_folio(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence public.pos_folio_sequences;
  v_next bigint;
  v_folio text;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED_FOR_FOLIO' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_license_id::text), hashtext('pos_sale_folio'));

  insert into public.pos_folio_sequences (license_id, sequence_name, current_value, prefix, padding)
  values (p_license_id, 'sale', 0, 'V', 6)
  on conflict (license_id, sequence_name) do nothing;

  update public.pos_folio_sequences
  set current_value = current_value + 1,
      updated_at = now()
  where license_id = p_license_id
    and sequence_name = 'sale'
  returning * into v_sequence;

  v_next := v_sequence.current_value;
  v_folio := v_sequence.prefix || '-' || lpad(v_next::text, v_sequence.padding, '0');

  return jsonb_build_object(
    'folio', v_folio,
    'sequence', v_next,
    'prefix', v_sequence.prefix,
    'padding', v_sequence.padding
  );
end;
$$;

create or replace function private.pos_sale_to_jsonb(p_sale public.pos_sales)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_sale.id,
    'license_id', p_sale.license_id,
    'local_sale_id', p_sale.local_sale_id,
    'device_id', p_sale.device_id,
    'staff_user_id', p_sale.staff_user_id,
    'device_role', p_sale.device_role,
    'actor_key', p_sale.actor_key,
    'actor_name', p_sale.actor_name,
    'origin', p_sale.origin,
    'source_mode', p_sale.source_mode,
    'effects_status', p_sale.effects_status,
    'status', p_sale.status,
    'fulfillment_status', p_sale.fulfillment_status,
    'payment_method', p_sale.payment_method,
    'payment_status', p_sale.payment_status,
    'folio', p_sale.folio,
    'local_folio', p_sale.local_folio,
    'cloud_folio', p_sale.cloud_folio,
    'folio_sequence', p_sale.folio_sequence,
    'sale_number', p_sale.sale_number,
    'customer_id', p_sale.customer_id,
    'customer_name', p_sale.customer_name,
    'customer_phone', p_sale.customer_phone,
    'subtotal', p_sale.subtotal,
    'discount_total', p_sale.discount_total,
    'tax_total', p_sale.tax_total,
    'total', p_sale.total,
    'amount_paid', p_sale.amount_paid,
    'change_amount', p_sale.change_amount,
    'balance_due', p_sale.balance_due,
    'currency', p_sale.currency,
    'sold_at', p_sale.sold_at,
    'created_at', p_sale.created_at,
    'updated_at', p_sale.updated_at,
    'committed_at', p_sale.committed_at,
    'deleted_at', p_sale.deleted_at,
    'cancelled_at', p_sale.cancelled_at,
    'cancel_reason', p_sale.cancel_reason,
    'cash_session_id', p_sale.cash_session_id,
    'cash_movement_id', p_sale.cash_movement_id,
    'cash_effect_status', p_sale.cash_effect_status,
    'inventory_effect_status', p_sale.inventory_effect_status,
    'credit_effect_status', p_sale.credit_effect_status,
    'customer_ledger_id', p_sale.customer_ledger_id,
    'local_payload', p_sale.local_payload,
    'metadata', p_sale.metadata,
    'idempotency_key', p_sale.idempotency_key,
    'server_version', p_sale.server_version
  )
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
    'sales_total', p_session.sales_total,
    'sales_count', p_session.sales_count,
    'cash_sales_total', p_session.cash_sales_total,
    'non_cash_sales_total', p_session.non_cash_sales_total,
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
    'sale_id', p_movement.sale_id,
    'created_by_device_id', p_movement.created_by_device_id,
    'created_by_staff_user_id', p_movement.created_by_staff_user_id,
    'actor_name', p_movement.actor_name,
    'created_at', p_movement.created_at,
    'server_version', p_movement.server_version,
    'idempotency_key', p_movement.idempotency_key,
    'metadata', p_movement.metadata,
    'deleted_at', p_movement.deleted_at
  ))
$$;

create or replace function public.pos_create_cloud_sale_cashier(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_cash_session_id text default null,
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
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;
  v_sale public.pos_sales;
  v_cash_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_items_response jsonb := '[]'::jsonb;
  v_payments_response jsonb := '[]'::jsonb;
  v_folio jsonb;
  v_cloud_folio text;
  v_folio_sequence bigint;
  v_total numeric;
  v_subtotal numeric;
  v_discount_total numeric;
  v_tax_total numeric;
  v_amount_paid numeric;
  v_change_amount numeric;
  v_balance_due numeric;
  v_payment_sum numeric := 0;
  v_cash_component numeric := 0;
  v_non_cash_component numeric := 0;
  v_cash_received numeric := 0;
  v_cash_change numeric := 0;
  v_payment_method text;
  v_payment_summary jsonb := '{}'::jsonb;
  v_payment_count integer := 0;
  v_item_count integer := 0;
  v_has_cash boolean := false;
  v_has_non_cash boolean := false;
  v_effects_status text;
  v_payment_status text;
  v_item record;
  v_payment record;
  v_item_id text;
  v_payment_id text;
  v_method_raw text;
  v_method text;
  v_payment_amount numeric;
  v_received_amount numeric;
  v_payment_change numeric;
  v_line_total numeric;
  v_qty numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_latest_change_seq bigint;
  v_sold_at timestamptz;
  v_created_at timestamptz;
  v_cash_session_candidate text;
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_cashier_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(p_sale, array['id','cloud_sale_id','cloudSaleId']),
    'sale_' || replace(gen_random_uuid()::text, '-', '')
  );
  v_local_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['local_sale_id','localSaleId']), v_sale_id);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.cloud_commit:' || v_local_sale_id || ':' || v_device_id::text);

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'sales.cloud_commit',
    'sale',
    v_sale_id,
    md5(coalesce(p_sale::text, '') || coalesce(p_items::text, '') || coalesce(p_payments::text, '') || coalesce(p_cash_session_id, ''))
  );

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  update public.pos_idempotency_keys
  set entity_id = v_sale_id
  where license_id = v_license_id and idempotency_key = v_idempotency_key;

  select count(*) into v_item_count from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if v_item_count <= 0 then
    raise exception 'SALE_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  v_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['total'], 0), 0);
  v_subtotal := greatest(private.pos_sale_jsonb_numeric(p_sale, array['subtotal'], v_total), 0);
  v_discount_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['discount_total','discountTotal'], 0), 0);
  v_tax_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['tax_total','taxTotal'], 0), 0);
  v_amount_paid := greatest(private.pos_sale_jsonb_numeric(p_sale, array['amount_paid','amountPaid','abono'], v_total), 0);
  v_change_amount := greatest(private.pos_sale_jsonb_numeric(p_sale, array['change_amount','changeAmount'], 0), 0);
  v_balance_due := greatest(private.pos_sale_jsonb_numeric(p_sale, array['balance_due','balanceDue','saldoPendiente'], 0), 0);

  if v_balance_due > 0.005 then
    raise exception 'SALE_CREDIT_NOT_IMPLEMENTED_IN_6B' using errcode = 'P0001';
  end if;

  v_payment_method := private.normalize_pos_sale_payment_method(private.pos_sale_jsonb_text(p_sale, array['payment_method','paymentMethod'], 'cash'));
  if v_payment_method = 'credit' then
    raise exception 'SALE_CREDIT_NOT_IMPLEMENTED_IN_6B' using errcode = 'P0001';
  end if;

  select count(*) into v_payment_count from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb));

  if v_payment_count = 0 then
    if v_payment_method = 'mixed' then
      raise exception 'SALE_MIXED_PAYMENT_DETAIL_REQUIRED' using errcode = 'P0001';
    end if;
    p_payments := jsonb_build_array(jsonb_build_object(
      'id', v_sale_id || ':payment:1',
      'method', coalesce(v_payment_method, 'cash'),
      'amount', v_total,
      'received_amount', case when v_payment_method = 'cash' then greatest(v_amount_paid + v_change_amount, v_total) else v_total end,
      'change_amount', case when v_payment_method = 'cash' then v_change_amount else 0 end,
      'metadata', jsonb_build_object('source', 'synthetic_from_sale_payload')
    ));
    v_payment_count := 1;
  end if;

  for v_payment in select value as payload, ordinality from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality loop
    v_method_raw := private.pos_sale_jsonb_text(v_payment.payload, array['method','payment_method','paymentMethod'], v_payment_method);
    v_method := private.normalize_pos_sale_payment_method(v_method_raw);

    if v_method is null or v_method not in ('cash','card','transfer','mixed') then
      raise exception 'SALE_PAYMENT_METHOD_NOT_ALLOWED:%', coalesce(v_method_raw, '') using errcode = 'P0001';
    end if;
    if v_method = 'mixed' then
      raise exception 'SALE_MIXED_PAYMENT_DETAIL_REQUIRED' using errcode = 'P0001';
    end if;

    v_payment_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['amount','total'], 0), 0);
    v_received_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['received_amount','receivedAmount'], v_payment_amount), 0);
    v_payment_change := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['change_amount','changeAmount'], 0), 0);

    if v_method = 'cash' then
      if v_payment_amount = 0 and v_received_amount > v_payment_change then
        v_payment_amount := greatest(v_received_amount - v_payment_change, 0);
      end if;
      v_cash_component := v_cash_component + v_payment_amount;
      v_cash_received := v_cash_received + v_received_amount;
      v_cash_change := v_cash_change + v_payment_change;
      v_has_cash := true;
    else
      v_non_cash_component := v_non_cash_component + v_payment_amount;
      v_has_non_cash := true;
    end if;

    v_payment_sum := v_payment_sum + v_payment_amount;
  end loop;

  if abs(v_payment_sum - v_total) > 0.05 then
    raise exception 'SALE_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  if v_has_cash then
    perform private.assert_cash_permission(v_context);
  end if;

  if v_has_cash then
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.actor_key = v_actor_key
        and s.status = 'open'
        and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;

    if v_cash_session_candidate is null then
      raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001';
    end if;
  else
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.actor_key = v_actor_key
        and s.status = 'open'
        and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;
  end if;

  if v_cash_session_candidate is not null then
    select * into v_cash_session
    from public.pos_cash_sessions s
    where s.license_id = v_license_id
      and s.id = v_cash_session_candidate
      and s.deleted_at is null
    for update;

    if v_cash_session.id is null then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_cash_session.status <> 'open' then
      raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
    end if;
    if v_cash_session.actor_key <> v_actor_key then
      raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  v_folio := private.next_pos_sale_folio(v_license_id);
  v_cloud_folio := v_folio->>'folio';
  v_folio_sequence := (v_folio->>'sequence')::bigint;
  v_sold_at := coalesce(nullif(private.pos_sale_jsonb_text(p_sale, array['sold_at','soldAt','timestamp']), '')::timestamptz, now());
  v_created_at := coalesce(nullif(private.pos_sale_jsonb_text(p_sale, array['created_at','createdAt','timestamp']), '')::timestamptz, now());
  v_effects_status := case when v_cash_component > 0 then 'cash_applied' else 'payment_recorded' end;
  v_payment_status := 'paid';

  insert into public.pos_sales (
    id, license_id, local_sale_id, device_id, staff_user_id, device_role, actor_key, actor_name,
    origin, source_mode, effects_status, status, fulfillment_status,
    payment_method, payment_status, folio, local_folio, cloud_folio, folio_sequence,
    sale_number, customer_id, customer_name, customer_phone,
    subtotal, discount_total, tax_total, total, amount_paid, change_amount, balance_due, currency,
    sold_at, created_at, updated_at, committed_at,
    cash_session_id, cash_movement_id, customer_ledger_id,
    cash_effect_status, inventory_effect_status, credit_effect_status,
    local_payload, metadata, idempotency_key, server_version
  ) values (
    v_sale_id, v_license_id, v_local_sale_id, v_device_id, v_staff_user_id, v_device_role, v_actor_key, v_actor_name,
    'cloud', 'cloud_committed', v_effects_status, 'closed', private.pos_sale_jsonb_text(p_sale, array['fulfillment_status','fulfillmentStatus']),
    case when v_has_cash and v_has_non_cash then 'mixed' when v_has_cash then 'cash' when v_has_non_cash then coalesce(v_payment_method, 'non_cash') else coalesce(v_payment_method, 'unknown') end,
    v_payment_status, v_cloud_folio, private.pos_sale_jsonb_text(p_sale, array['local_folio','localFolio','folio']), v_cloud_folio, v_folio_sequence,
    v_folio_sequence, private.pos_sale_jsonb_text(p_sale, array['customer_id','customerId']), private.pos_sale_jsonb_text(p_sale, array['customer_name','customerName']), private.pos_sale_jsonb_text(p_sale, array['customer_phone','customerPhone']),
    v_subtotal, v_discount_total, v_tax_total, v_total, v_payment_sum, v_cash_change, 0, coalesce(private.pos_sale_jsonb_text(p_sale, array['currency']), 'MXN'),
    v_sold_at, v_created_at, now(), now(),
    case when v_cash_session.id is null then null else v_cash_session.id end, null, null,
    case when v_cash_component > 0 then 'applied' else 'not_required' end, 'not_applied', 'not_applied',
    coalesce(p_sale, '{}'::jsonb),
    coalesce(p_sale->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'fase6b_cloud_cashier_sales',
      'cloud_committed', true,
      'no_cloud_inventory_effects', true,
      'no_cloud_credit_effects', true,
      'payment_summary', jsonb_build_object(
        'cash_component', v_cash_component,
        'non_cash_component', v_non_cash_component,
        'payment_sum', v_payment_sum,
        'cash_received', v_cash_received,
        'cash_change', v_cash_change
      )
    ),
    v_idempotency_key, 1
  )
  returning * into v_sale;

  if v_cash_component > 0 then
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id, sale_id,
      created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_cash_session.id, v_cash_session.device_id, v_cash_session.staff_user_id, v_cash_session.actor_key,
      'venta', v_cash_component, 'Venta ' || v_cloud_folio, 'sale', 'sale', v_sale.id, v_sale.id,
      v_device_id, v_staff_user_id, v_actor_name, v_idempotency_key || ':cash',
      jsonb_build_object('phase', 'fase6b_cloud_cashier_sales', 'sale_id', v_sale.id, 'folio', v_cloud_folio, 'cash_component', v_cash_component)
    ) returning * into v_cash_movement;

    update public.pos_sales
    set cash_movement_id = v_cash_movement.id,
        updated_at = now(),
        server_version = server_version + 1
    where license_id = v_license_id and id = v_sale.id
    returning * into v_sale;
  end if;

  if v_cash_session.id is not null then
    update public.pos_cash_sessions
    set sales_total = coalesce(sales_total, 0) + v_total,
        sales_count = coalesce(sales_count, 0) + 1,
        cash_sales_total = coalesce(cash_sales_total, 0) + v_cash_component,
        non_cash_sales_total = coalesce(non_cash_sales_total, 0) + v_non_cash_component,
        expected_cash_total = coalesce(expected_cash_total, 0) + v_cash_component,
        updated_at = now(),
        server_version = server_version + 1,
        last_idempotency_key = v_idempotency_key
    where license_id = v_license_id and id = v_cash_session.id
    returning * into v_cash_session;
  end if;

  for v_item in select value as payload, ordinality from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality loop
    v_item_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id']), v_sale.id || ':item:' || v_item.ordinality::text);
    v_qty := private.pos_sale_jsonb_numeric(v_item.payload, array['quantity','qty'], 0);
    v_unit_price := private.pos_sale_jsonb_numeric(v_item.payload, array['unit_price','unitPrice','price'], 0);
    v_unit_cost := private.pos_sale_jsonb_numeric(v_item.payload, array['unit_cost','unitCost','cost'], null);
    v_line_total := private.pos_sale_jsonb_numeric(v_item.payload, array['line_total','lineTotal','total','exactTotal'], v_qty * v_unit_price);

    if v_qty <= 0 then
      raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001';
    end if;
    if v_unit_price < 0 or v_line_total < 0 or (v_unit_cost is not null and v_unit_cost < 0) then
      raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    insert into public.pos_sale_items (
      id, license_id, sale_id, product_id, product_name, product_sku, barcode,
      category_id, category_name, quantity, unit_price, unit_cost, discount_amount,
      tax_amount, line_total, batch_id, batch_sku, batch_expiry_date, rubro, metadata, server_version
    ) values (
      v_item_id, v_license_id, v_sale.id,
      private.pos_sale_jsonb_text(v_item.payload, array['product_id','productId','parentId']),
      coalesce(private.pos_sale_jsonb_text(v_item.payload, array['product_name','productName','name']), 'Producto'),
      private.pos_sale_jsonb_text(v_item.payload, array['product_sku','productSku','sku']),
      private.pos_sale_jsonb_text(v_item.payload, array['barcode','barCode']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_id','categoryId']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_name','categoryName']),
      v_qty, v_unit_price, v_unit_cost,
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['discount_amount','discountAmount'], 0), 0),
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['tax_amount','taxAmount'], 0), 0),
      v_line_total,
      private.pos_sale_jsonb_text(v_item.payload, array['batch_id','batchId']),
      private.pos_sale_jsonb_text(v_item.payload, array['batch_sku','batchSku']),
      nullif(private.pos_sale_jsonb_text(v_item.payload, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.pos_sale_jsonb_text(v_item.payload, array['rubro','category','categoryName']),
      coalesce(v_item.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6b_cloud_cashier_sales', 'snapshotOnly', true, 'inventoryEffectStatus', 'not_applied'),
      v_sale.server_version
    );

    perform private.record_pos_sync_event(v_license_id, 'sale_item', v_item_id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'source_mode', 'cloud_committed'), v_sale.server_version::integer);
  end loop;

  for v_payment in select value as payload, ordinality from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality loop
    v_payment_id := coalesce(private.pos_sale_jsonb_text(v_payment.payload, array['id']), v_sale.id || ':payment:' || v_payment.ordinality::text);
    v_method := private.normalize_pos_sale_payment_method(private.pos_sale_jsonb_text(v_payment.payload, array['method','payment_method','paymentMethod'], v_payment_method));
    v_payment_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['amount','total'], 0), 0);
    v_received_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['received_amount','receivedAmount'], v_payment_amount), 0);
    v_payment_change := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['change_amount','changeAmount'], 0), 0);

    insert into public.pos_sale_payments (
      id, license_id, sale_id, method, amount, received_amount, change_amount,
      reference, cash_session_id, cash_movement_id, customer_ledger_id, metadata, server_version
    ) values (
      v_payment_id, v_license_id, v_sale.id, v_method, v_payment_amount, v_received_amount, v_payment_change,
      private.pos_sale_jsonb_text(v_payment.payload, array['reference','ref']),
      case when v_method = 'cash' and v_cash_session.id is not null then v_cash_session.id else null end,
      case when v_method = 'cash' and v_cash_movement.id is not null then v_cash_movement.id else null end,
      null,
      coalesce(v_payment.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6b_cloud_cashier_sales', 'creditEffectStatus', 'not_applied'),
      v_sale.server_version
    );

    perform private.record_pos_sync_event(v_license_id, 'sale_payment', v_payment_id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'source_mode', 'cloud_committed', 'method', v_method), v_sale.server_version::integer);
  end loop;

  if v_cash_movement.id is not null then
    perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.cash_movement_created', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'cash_session_id', v_cash_session.id, 'cash_movement_id', v_cash_movement.id, 'cash_component', v_cash_component, 'idempotency_key', v_idempotency_key));
    perform private.record_pos_sync_event(v_license_id, 'cash_movement', v_cash_movement.id, 'movement', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'cash_session_id', v_cash_session.id, 'source', 'sale'), v_cash_movement.server_version);
  end if;

  if v_cash_session.id is not null then
    perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.cash_session_totals_updated', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'cash_session_id', v_cash_session.id, 'sales_total_delta', v_total, 'cash_delta', v_cash_component, 'non_cash_delta', v_non_cash_component, 'idempotency_key', v_idempotency_key));
    perform private.record_pos_sync_event(v_license_id, 'cash_session', v_cash_session.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_cloud_committed'), v_cash_session.server_version);
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'sale',
    v_sale.id,
    'cloud_commit',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'source_mode', 'cloud_committed', 'effects_status', v_sale.effects_status, 'cash_session_id', v_sale.cash_session_id, 'cash_movement_id', v_sale.cash_movement_id),
    v_sale.server_version::integer
  );

  perform private.record_pos_sync_event(v_license_id, 'report', 'overview', 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'sale_cloud_committed', 'sale_id', v_sale.id), 1);

  perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.cloud_committed', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'cash_session_id', v_sale.cash_session_id, 'cash_movement_id', v_sale.cash_movement_id, 'actor', jsonb_build_object('actor_key', v_actor_key, 'actor_name', v_actor_name, 'device_id', v_device_id, 'staff_user_id', v_staff_user_id), 'payment_summary', jsonb_build_object('cash_component', v_cash_component, 'non_cash_component', v_non_cash_component, 'payment_sum', v_payment_sum), 'idempotency_key', v_idempotency_key));

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
  into v_items_response
  from public.pos_sale_items i
  where i.license_id = v_license_id and i.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
  into v_payments_response
  from public.pos_sale_payments p
  where p.license_id = v_license_id and p.sale_id = v_sale.id;

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_items_response,
    'payments', v_payments_response,
    'cash_session', case when v_cash_session.id is null then null else private.pos_cash_session_to_jsonb(v_cash_session) end,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key,
    'mode', 'cloud_cashier'
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  raise exception 'SALE_DUPLICATE_OR_FOLIO_CONFLICT' using errcode = 'P0001';
end;
$$;

grant execute on function public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text) to anon, authenticated;

create or replace function public.pos_get_reports_overview(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_scope text default 'license'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_staff_filter uuid;
  v_customers jsonb;
  v_cash jsonb;
  v_products jsonb;
  v_cloud_sales jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_cloud_products_sync_enabled(v_context);

  if not private.reports_scope_allowed(v_context, p_scope) then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  select jsonb_build_object(
    'customers_total', count(*)::integer,
    'customers_with_debt', count(*) filter (where debt_cents > 0)::integer,
    'customers_without_debt', count(*) filter (where debt_cents <= 0)::integer,
    'customers_over_limit', count(*) filter (where credit_limit > 0 and debt > credit_limit)::integer,
    'debt_total', private.safe_numeric(sum(debt)),
    'payments_period', coalesce((
      select sum(abs(l.amount))
      from public.pos_customer_ledger l
      where l.license_id = v_license_id
        and l.deleted_at is null
        and l.type = 'PAYMENT'
        and l.created_at >= v_from and l.created_at < v_to
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    ), 0)
  )
  into v_customers
  from public.pos_customers c
  where c.license_id = v_license_id
    and c.deleted_at is null;

  select jsonb_build_object(
    'cash_sessions_open', coalesce((
      select count(*)::integer from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'open'
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0),
    'cash_sessions_closed', coalesce((
      select count(*)::integer from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'closed'
        and s.opened_at >= v_from and s.opened_at < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0),
    'cash_entries', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type in ('entrada', 'ajuste_entrada')
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'cash_exits', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type in ('salida', 'ajuste_salida')
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'customer_payments_in_cash', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type = 'abono_cliente'
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'cash_difference', coalesce((
      select sum(abs(coalesce(s.cash_difference, 0))) from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'closed'
        and s.opened_at >= v_from and s.opened_at < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0)
  ) into v_cash;

  with batch_summary as (
    select
      p.id as product_id,
      count(b.id) filter (where b.deleted_at is null and b.is_active is true) as active_batches,
      coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_stock,
      coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_value
    from public.pos_products p
    left join public.pos_product_batches b on b.license_id = p.license_id and b.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
    group by p.id
  ), product_inventory as (
    select
      p.*,
      case when bs.active_batches > 0 then bs.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end as available_stock,
      case when bs.active_batches > 0 then bs.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end as inventory_value
    from public.pos_products p
    join batch_summary bs on bs.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
  )
  select jsonb_build_object(
    'products_active', count(*) filter (where is_active is true)::integer,
    'products_inactive', count(*) filter (where is_active is not true)::integer,
    'products_without_stock', count(*) filter (where is_active is true and track_stock is true and available_stock <= 0)::integer,
    'products_low_stock', count(*) filter (where is_active is true and track_stock is true and available_stock > 0 and min_stock is not null and available_stock <= min_stock)::integer,
    'inventory_value_approx', coalesce(sum(inventory_value), 0)
  ) into v_products
  from product_inventory;

  select jsonb_build_object(
    'cloud_sales_total', coalesce(sum(s.total), 0),
    'cloud_sales_count', count(*)::integer,
    'cloud_cash_sales_total', coalesce(sum(coalesce((s.metadata->'payment_summary'->>'cash_component')::numeric, 0)), 0),
    'cloud_non_cash_sales_total', coalesce(sum(coalesce((s.metadata->'payment_summary'->>'non_cash_component')::numeric, 0)), 0)
  ) into v_cloud_sales
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.deleted_at is null
    and s.source_mode = 'cloud_committed'
    and s.status = 'closed'
    and s.sold_at >= v_from and s.sold_at < v_to
    and (v_staff_filter is null or s.staff_user_id = v_staff_filter);

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', coalesce(p_scope, 'license'),
    'overview', v_customers || v_cash || v_products || v_cloud_sales,
    'source', private.reports_source_metadata('cloud') || jsonb_build_object('experimental', jsonb_build_array('Ventas cloud caja 6B')),
    'data_sources', private.reports_source_metadata('cloud') || jsonb_build_object('experimental', jsonb_build_array('Ventas cloud caja 6B')),
    'warnings', (private.reports_source_metadata('cloud')->'warnings') || jsonb_build_array('Ventas cloud caja 6B es experimental: no incluye utilidad final, inventario cloud ni credito cloud.')
  );
end;
$$;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'cloud_sales_cashier', case when code = 'pro_monthly' then true else false end
)
where code in ('pro_monthly', 'free_trial', 'basic_monthly');

comment on table public.pos_folio_sequences is 'FASE 6B POS Sync: secuencias transaccionales de folios cloud por licencia.';
comment on column public.pos_sales.cloud_folio is 'FASE 6B: folio cloud asignado transaccionalmente.';
comment on column public.pos_sales.folio_sequence is 'FASE 6B: consecutivo numerico del folio cloud por licencia.';
comment on column public.pos_sales.inventory_effect_status is 'FASE 6B: not_applied; inventario cloud se implementa en 6C.';
comment on column public.pos_sales.credit_effect_status is 'FASE 6B: not_applied; venta fiada/ledger cloud se implementa en 6D.';
comment on column public.pos_cash_movements.sale_id is 'FASE 6B: venta cloud origen del movimiento de caja cuando aplica efectivo.';;
