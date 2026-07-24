-- FASE 6A - Ventas cloud base PRO: read model / shadow audit de ventas locales.

-- 1) Feature flag: solo PRO.
update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_sales_sync_base', code = 'pro_monthly')
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

-- 2) Tablas base de ventas cloud shadow.
create table if not exists public.pos_sales (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  local_sale_id text,
  device_id uuid references public.license_devices(id) on delete set null,
  staff_user_id uuid references public.license_staff_users(id) on delete set null,
  device_role text,
  actor_key text,
  actor_name text,

  origin text not null default 'local_device',
  source_mode text not null default 'shadow',
  effects_status text not null default 'local_applied',

  status text not null default 'closed',
  fulfillment_status text,
  payment_method text,
  payment_status text,

  folio text,
  local_folio text,
  sale_number bigint,

  customer_id text,
  customer_name text,
  customer_phone text,

  subtotal numeric not null default 0,
  discount_total numeric not null default 0,
  tax_total numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  change_amount numeric not null default 0,
  balance_due numeric not null default 0,
  currency text not null default 'MXN',

  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  cash_session_id text,
  cash_movement_id text,
  customer_ledger_id text,

  local_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  server_version bigint not null default 1,

  constraint pos_sales_origin_chk check (origin in ('local_device','cloud')),
  constraint pos_sales_source_mode_chk check (source_mode in ('shadow','cloud_draft','cloud_committed')),
  constraint pos_sales_effects_status_chk check (effects_status in ('local_applied','cloud_pending','cloud_applied','failed')),
  constraint pos_sales_status_chk check (status in ('open','closed','cancelled','voided','draft')),
  constraint pos_sales_subtotal_nonnegative_chk check (subtotal >= 0),
  constraint pos_sales_discount_nonnegative_chk check (discount_total >= 0),
  constraint pos_sales_tax_nonnegative_chk check (tax_total >= 0),
  constraint pos_sales_total_nonnegative_chk check (total >= 0),
  constraint pos_sales_amount_paid_nonnegative_chk check (amount_paid >= 0),
  constraint pos_sales_change_nonnegative_chk check (change_amount >= 0),
  constraint pos_sales_balance_due_nonnegative_chk check (balance_due >= 0),
  constraint pos_sales_shadow_no_cloud_effects_chk check (
    source_mode <> 'shadow'
    or (origin = 'local_device' and effects_status = 'local_applied')
  )
);

create table if not exists public.pos_sale_items (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sale_id text not null references public.pos_sales(id) on delete cascade,
  product_id text,
  product_name text not null,
  product_sku text,
  barcode text,
  category_id text,
  category_name text,
  quantity numeric not null,
  unit_price numeric not null,
  unit_cost numeric,
  discount_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  line_total numeric not null,
  batch_id text,
  batch_sku text,
  batch_expiry_date date,
  rubro text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  server_version bigint not null default 1,

  constraint pos_sale_items_quantity_positive_chk check (quantity > 0),
  constraint pos_sale_items_unit_price_nonnegative_chk check (unit_price >= 0),
  constraint pos_sale_items_unit_cost_nonnegative_chk check (unit_cost is null or unit_cost >= 0),
  constraint pos_sale_items_discount_nonnegative_chk check (discount_amount >= 0),
  constraint pos_sale_items_tax_nonnegative_chk check (tax_amount >= 0),
  constraint pos_sale_items_line_total_nonnegative_chk check (line_total >= 0)
);

create table if not exists public.pos_sale_payments (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sale_id text not null references public.pos_sales(id) on delete cascade,
  method text not null,
  amount numeric not null,
  received_amount numeric,
  change_amount numeric,
  reference text,
  cash_session_id text,
  cash_movement_id text,
  customer_ledger_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  server_version bigint not null default 1,

  constraint pos_sale_payments_amount_nonnegative_chk check (amount >= 0),
  constraint pos_sale_payments_received_nonnegative_chk check (received_amount is null or received_amount >= 0),
  constraint pos_sale_payments_change_nonnegative_chk check (change_amount is null or change_amount >= 0)
);

create table if not exists public.pos_sale_audit_events (
  id bigserial primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sale_id text,
  event_type text not null,
  actor_device_id uuid,
  actor_staff_user_id uuid,
  actor_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Índices / idempotencia.
create unique index if not exists pos_sales_license_local_sale_uidx
  on public.pos_sales (license_id, local_sale_id)
  where local_sale_id is not null;

create unique index if not exists pos_sales_license_idempotency_uidx
  on public.pos_sales (license_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists pos_sales_license_sold_at_idx on public.pos_sales (license_id, sold_at desc);
create index if not exists pos_sales_license_status_sold_at_idx on public.pos_sales (license_id, status, sold_at desc);
create index if not exists pos_sales_license_customer_sold_at_idx on public.pos_sales (license_id, customer_id, sold_at desc);
create index if not exists pos_sales_license_staff_sold_at_idx on public.pos_sales (license_id, staff_user_id, sold_at desc);
create index if not exists pos_sales_license_device_sold_at_idx on public.pos_sales (license_id, device_id, sold_at desc);
create index if not exists pos_sales_license_source_mode_sold_at_idx on public.pos_sales (license_id, source_mode, sold_at desc);
create index if not exists pos_sales_license_server_version_idx on public.pos_sales (license_id, server_version);

create index if not exists pos_sale_items_license_sale_idx on public.pos_sale_items (license_id, sale_id);
create index if not exists pos_sale_items_license_product_idx on public.pos_sale_items (license_id, product_id);
create index if not exists pos_sale_items_license_category_idx on public.pos_sale_items (license_id, category_id);
create index if not exists pos_sale_items_license_batch_idx on public.pos_sale_items (license_id, batch_id);

create index if not exists pos_sale_payments_license_sale_idx on public.pos_sale_payments (license_id, sale_id);
create index if not exists pos_sale_payments_license_method_idx on public.pos_sale_payments (license_id, method);
create index if not exists pos_sale_audit_events_license_sale_created_idx on public.pos_sale_audit_events (license_id, sale_id, created_at desc);

alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_sale_payments enable row level security;
alter table public.pos_sale_audit_events enable row level security;

revoke all on public.pos_sales from anon, authenticated;
revoke all on public.pos_sale_items from anon, authenticated;
revoke all on public.pos_sale_payments from anon, authenticated;
revoke all on public.pos_sale_audit_events from anon, authenticated;
revoke all on sequence public.pos_sale_audit_events_id_seq from anon, authenticated;

comment on table public.pos_sales is 'FASE 6A POS Sync: read model/auditoria shadow de ventas locales PRO. No aplica caja, inventario ni credito cloud.';
comment on table public.pos_sale_items is 'FASE 6A POS Sync: items snapshot de ventas locales. No descuenta stock cloud.';
comment on table public.pos_sale_payments is 'FASE 6A POS Sync: pagos snapshot de ventas locales. No crea movimientos de caja ni ledger cloud.';
comment on table public.pos_sale_audit_events is 'FASE 6A POS Sync: bitacora de auditoria para ventas shadow.';

-- 3) Helpers privados.
create or replace function private.pos_sale_jsonb_text(p_payload jsonb, p_keys text[], p_default text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    if v_value is not null then
      return v_value;
    end if;
  end loop;

  return p_default;
end;
$$;

create or replace function private.pos_sale_jsonb_numeric(p_payload jsonb, p_keys text[], p_default numeric default 0)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    if v_value is not null then
      if v_value !~ '^-?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then
        raise exception 'SALE_NUMERIC_FIELD_INVALID:%', v_key using errcode = 'P0001';
      end if;
      return v_value::numeric;
    end if;
  end loop;

  return coalesce(p_default, 0);
end;
$$;

create or replace function private.assert_cloud_sales_sync_base_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_sync_base')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_SYNC_BASE_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.normalize_pos_sale_status(p_status text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, 'closed')));
begin
  if v_status in ('completed', 'complete', 'paid') then
    return 'closed';
  end if;

  if v_status in ('cancelled', 'canceled') then
    return 'cancelled';
  end if;

  if v_status in ('open', 'closed', 'cancelled', 'voided', 'draft') then
    return v_status;
  end if;

  return 'closed';
end;
$$;

create or replace function private.validate_pos_sale_shadow_payload(p_sale jsonb, p_items jsonb default '[]'::jsonb, p_payments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_sale_id text;
  v_status text;
  v_total numeric;
  v_item_count integer;
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

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(p_sale, array['id']),
    private.pos_sale_jsonb_text(p_sale, array['local_sale_id', 'localSaleId'])
  );
  if v_sale_id is null then
    raise exception 'SALE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_status := private.normalize_pos_sale_status(private.pos_sale_jsonb_text(p_sale, array['status'], 'closed'));
  v_total := private.pos_sale_jsonb_numeric(p_sale, array['total'], 0);
  if v_total < 0 then
    raise exception 'SALE_TOTAL_NEGATIVE' using errcode = 'P0001';
  end if;

  select count(*) into v_item_count from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if v_status = 'closed' and v_item_count <= 0 then
    raise exception 'SALE_ITEMS_REQUIRED_FOR_CLOSED_SALE' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'status', v_status,
    'total', v_total,
    'item_count', v_item_count
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
    'deleted_at', p_sale.deleted_at,
    'cancelled_at', p_sale.cancelled_at,
    'cancel_reason', p_sale.cancel_reason,
    'cash_session_id', p_sale.cash_session_id,
    'cash_movement_id', p_sale.cash_movement_id,
    'customer_ledger_id', p_sale.customer_ledger_id,
    'local_payload', p_sale.local_payload,
    'metadata', p_sale.metadata,
    'idempotency_key', p_sale.idempotency_key,
    'server_version', p_sale.server_version
  )
$$;

create or replace function private.pos_sale_item_to_jsonb(p_item public.pos_sale_items)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id,
    'license_id', p_item.license_id,
    'sale_id', p_item.sale_id,
    'product_id', p_item.product_id,
    'product_name', p_item.product_name,
    'product_sku', p_item.product_sku,
    'barcode', p_item.barcode,
    'category_id', p_item.category_id,
    'category_name', p_item.category_name,
    'quantity', p_item.quantity,
    'unit_price', p_item.unit_price,
    'unit_cost', p_item.unit_cost,
    'discount_amount', p_item.discount_amount,
    'tax_amount', p_item.tax_amount,
    'line_total', p_item.line_total,
    'batch_id', p_item.batch_id,
    'batch_sku', p_item.batch_sku,
    'batch_expiry_date', p_item.batch_expiry_date,
    'rubro', p_item.rubro,
    'metadata', p_item.metadata,
    'created_at', p_item.created_at,
    'server_version', p_item.server_version
  )
$$;

create or replace function private.pos_sale_payment_to_jsonb(p_payment public.pos_sale_payments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_payment.id,
    'license_id', p_payment.license_id,
    'sale_id', p_payment.sale_id,
    'method', p_payment.method,
    'amount', p_payment.amount,
    'received_amount', p_payment.received_amount,
    'change_amount', p_payment.change_amount,
    'reference', p_payment.reference,
    'cash_session_id', p_payment.cash_session_id,
    'cash_movement_id', p_payment.cash_movement_id,
    'customer_ledger_id', p_payment.customer_ledger_id,
    'metadata', p_payment.metadata,
    'created_at', p_payment.created_at,
    'server_version', p_payment.server_version
  )
$$;

create or replace function private.record_pos_sale_audit_event(
  p_license_id uuid,
  p_sale_id text,
  p_event_type text,
  p_actor_device_id uuid default null,
  p_actor_staff_user_id uuid default null,
  p_actor_name text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.pos_sale_audit_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.pos_sale_audit_events;
begin
  insert into public.pos_sale_audit_events (
    license_id,
    sale_id,
    event_type,
    actor_device_id,
    actor_staff_user_id,
    actor_name,
    payload
  ) values (
    p_license_id,
    p_sale_id,
    p_event_type,
    p_actor_device_id,
    p_actor_staff_user_id,
    p_actor_name,
    coalesce(p_payload, '{}'::jsonb)
  ) returning * into v_event;

  return v_event;
end;
$$;

-- 4) RPCs públicas.
create or replace function public.pos_upsert_sale_shadow(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
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
  v_validation jsonb;
  v_sale_id text;
  v_local_sale_id text;
  v_status text;
  v_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;
  v_saved public.pos_sales;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_item record;
  v_payment record;
  v_item_id text;
  v_payment_id text;
  v_qty numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_payment_amount numeric;
  v_items_response jsonb;
  v_payments_response jsonb;
  v_latest_change_seq bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_name := coalesce(v_context->'staff_user'->>'display_name', case when v_device_role = 'admin' then 'Admin' else 'Staff' end);
  v_actor_key := case
    when v_staff_user_id is not null then 'staff:' || v_staff_user_id::text
    else 'admin_device:' || v_device_id::text
  end;

  v_validation := private.validate_pos_sale_shadow_payload(p_sale, p_items, p_payments);
  v_sale_id := v_validation->>'sale_id';
  v_local_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['local_sale_id','localSaleId']), v_sale_id);
  v_status := v_validation->>'status';
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.shadow_upsert:' || v_local_sale_id || ':' || v_device_id::text);

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'upsert_sale_shadow',
    'sale',
    v_sale_id,
    md5(coalesce(p_sale::text, '') || coalesce(p_items::text, '') || coalesce(p_payments::text, ''))
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
      'message', 'La venta shadow ya esta en proceso.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  insert into public.pos_sales (
    id,
    license_id,
    local_sale_id,
    device_id,
    staff_user_id,
    device_role,
    actor_key,
    actor_name,
    origin,
    source_mode,
    effects_status,
    status,
    fulfillment_status,
    payment_method,
    payment_status,
    folio,
    local_folio,
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    subtotal,
    discount_total,
    tax_total,
    total,
    amount_paid,
    change_amount,
    balance_due,
    currency,
    sold_at,
    created_at,
    updated_at,
    cancelled_at,
    cancel_reason,
    cash_session_id,
    cash_movement_id,
    customer_ledger_id,
    local_payload,
    metadata,
    idempotency_key,
    server_version
  ) values (
    v_sale_id,
    v_license_id,
    v_local_sale_id,
    v_device_id,
    v_staff_user_id,
    v_device_role,
    v_actor_key,
    v_actor_name,
    'local_device',
    'shadow',
    'local_applied',
    v_status,
    private.pos_sale_jsonb_text(p_sale, array['fulfillment_status','fulfillmentStatus']),
    private.pos_sale_jsonb_text(p_sale, array['payment_method','paymentMethod']),
    coalesce(private.pos_sale_jsonb_text(p_sale, array['payment_status','paymentStatus']), case when private.pos_sale_jsonb_numeric(p_sale, array['balance_due','saldoPendiente'], 0) > 0 then 'partial' else 'paid' end),
    private.pos_sale_jsonb_text(p_sale, array['folio']),
    coalesce(private.pos_sale_jsonb_text(p_sale, array['local_folio','localFolio']), private.pos_sale_jsonb_text(p_sale, array['folio'])),
    nullif(private.pos_sale_jsonb_text(p_sale, array['sale_number','saleNumber']), '')::bigint,
    private.pos_sale_jsonb_text(p_sale, array['customer_id','customerId']),
    private.pos_sale_jsonb_text(p_sale, array['customer_name','customerName']),
    private.pos_sale_jsonb_text(p_sale, array['customer_phone','customerPhone']),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['subtotal'], private.pos_sale_jsonb_numeric(p_sale, array['total'], 0)), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['discount_total','discountTotal'], 0), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['tax_total','taxTotal'], 0), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['total'], 0), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['amount_paid','amountPaid','abono'], 0), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['change_amount','changeAmount'], 0), 0),
    greatest(private.pos_sale_jsonb_numeric(p_sale, array['balance_due','balanceDue','saldoPendiente'], 0), 0),
    coalesce(private.pos_sale_jsonb_text(p_sale, array['currency']), 'MXN'),
    coalesce(
      nullif(private.pos_sale_jsonb_text(p_sale, array['sold_at','soldAt','timestamp']), '')::timestamptz,
      now()
    ),
    coalesce(
      nullif(private.pos_sale_jsonb_text(p_sale, array['created_at','createdAt','timestamp']), '')::timestamptz,
      now()
    ),
    now(),
    nullif(private.pos_sale_jsonb_text(p_sale, array['cancelled_at','cancelledAt']), '')::timestamptz,
    private.pos_sale_jsonb_text(p_sale, array['cancel_reason','cancelReason']),
    private.pos_sale_jsonb_text(p_sale, array['cash_session_id','cashSessionId']),
    private.pos_sale_jsonb_text(p_sale, array['cash_movement_id','cashMovementId']),
    private.pos_sale_jsonb_text(p_sale, array['customer_ledger_id','customerLedgerId']),
    coalesce(p_sale, '{}'::jsonb),
    coalesce(p_sale->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'fase6a_sales_cloud_base',
      'shadow_only', true,
      'no_cloud_cash_effects', true,
      'no_cloud_inventory_effects', true,
      'no_cloud_credit_effects', true
    ),
    v_idempotency_key,
    1
  )
  on conflict (id) do update
  set local_sale_id = excluded.local_sale_id,
      device_id = excluded.device_id,
      staff_user_id = excluded.staff_user_id,
      device_role = excluded.device_role,
      actor_key = excluded.actor_key,
      actor_name = excluded.actor_name,
      origin = 'local_device',
      source_mode = 'shadow',
      effects_status = 'local_applied',
      status = excluded.status,
      fulfillment_status = excluded.fulfillment_status,
      payment_method = excluded.payment_method,
      payment_status = excluded.payment_status,
      folio = excluded.folio,
      local_folio = excluded.local_folio,
      sale_number = excluded.sale_number,
      customer_id = excluded.customer_id,
      customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      subtotal = excluded.subtotal,
      discount_total = excluded.discount_total,
      tax_total = excluded.tax_total,
      total = excluded.total,
      amount_paid = excluded.amount_paid,
      change_amount = excluded.change_amount,
      balance_due = excluded.balance_due,
      currency = excluded.currency,
      sold_at = excluded.sold_at,
      updated_at = now(),
      cancelled_at = excluded.cancelled_at,
      cancel_reason = excluded.cancel_reason,
      cash_session_id = excluded.cash_session_id,
      cash_movement_id = excluded.cash_movement_id,
      customer_ledger_id = excluded.customer_ledger_id,
      local_payload = excluded.local_payload,
      metadata = coalesce(public.pos_sales.metadata, '{}'::jsonb) || excluded.metadata,
      idempotency_key = excluded.idempotency_key,
      server_version = public.pos_sales.server_version + 1
  where public.pos_sales.license_id = excluded.license_id
  returning * into v_saved;

  if v_saved.id is null then
    raise exception 'SALE_ID_CONFLICT_OTHER_LICENSE' using errcode = 'P0001';
  end if;

  delete from public.pos_sale_items where license_id = v_license_id and sale_id = v_sale_id;
  delete from public.pos_sale_payments where license_id = v_license_id and sale_id = v_sale_id;

  for v_item in select value as payload, ordinality from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality loop
    v_item_id := coalesce(
      private.pos_sale_jsonb_text(v_item.payload, array['id']),
      v_sale_id || ':item:' || v_item.ordinality::text
    );
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
      id,
      license_id,
      sale_id,
      product_id,
      product_name,
      product_sku,
      barcode,
      category_id,
      category_name,
      quantity,
      unit_price,
      unit_cost,
      discount_amount,
      tax_amount,
      line_total,
      batch_id,
      batch_sku,
      batch_expiry_date,
      rubro,
      metadata,
      server_version
    ) values (
      v_item_id,
      v_license_id,
      v_sale_id,
      private.pos_sale_jsonb_text(v_item.payload, array['product_id','productId','parentId','id']),
      coalesce(private.pos_sale_jsonb_text(v_item.payload, array['product_name','productName','name']), 'Producto'),
      private.pos_sale_jsonb_text(v_item.payload, array['product_sku','productSku','sku']),
      private.pos_sale_jsonb_text(v_item.payload, array['barcode','barCode']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_id','categoryId']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_name','categoryName']),
      v_qty,
      v_unit_price,
      v_unit_cost,
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['discount_amount','discountAmount'], 0), 0),
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['tax_amount','taxAmount'], 0), 0),
      v_line_total,
      private.pos_sale_jsonb_text(v_item.payload, array['batch_id','batchId']),
      private.pos_sale_jsonb_text(v_item.payload, array['batch_sku','batchSku']),
      nullif(private.pos_sale_jsonb_text(v_item.payload, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.pos_sale_jsonb_text(v_item.payload, array['rubro','category','categoryName']),
      coalesce(v_item.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6a_sales_cloud_base'),
      v_saved.server_version
    );

    perform private.record_pos_sync_event(
      v_license_id,
      'sale_item',
      v_item_id,
      'upsert_shadow',
      v_device_id,
      v_staff_user_id,
      v_idempotency_key,
      jsonb_build_object('sale_id', v_sale_id, 'source_mode', 'shadow', 'server_version', v_saved.server_version),
      v_saved.server_version::integer
    );
  end loop;

  for v_payment in select value as payload, ordinality from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality loop
    v_payment_id := coalesce(
      private.pos_sale_jsonb_text(v_payment.payload, array['id']),
      v_sale_id || ':payment:' || v_payment.ordinality::text
    );
    v_payment_amount := private.pos_sale_jsonb_numeric(v_payment.payload, array['amount','total'], 0);

    if v_payment_amount < 0 then
      raise exception 'SALE_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    insert into public.pos_sale_payments (
      id,
      license_id,
      sale_id,
      method,
      amount,
      received_amount,
      change_amount,
      reference,
      cash_session_id,
      cash_movement_id,
      customer_ledger_id,
      metadata,
      server_version
    ) values (
      v_payment_id,
      v_license_id,
      v_sale_id,
      coalesce(private.pos_sale_jsonb_text(v_payment.payload, array['method','payment_method','paymentMethod']), 'unknown'),
      v_payment_amount,
      private.pos_sale_jsonb_numeric(v_payment.payload, array['received_amount','receivedAmount'], null),
      private.pos_sale_jsonb_numeric(v_payment.payload, array['change_amount','changeAmount'], null),
      private.pos_sale_jsonb_text(v_payment.payload, array['reference','ref']),
      private.pos_sale_jsonb_text(v_payment.payload, array['cash_session_id','cashSessionId']),
      private.pos_sale_jsonb_text(v_payment.payload, array['cash_movement_id','cashMovementId']),
      private.pos_sale_jsonb_text(v_payment.payload, array['customer_ledger_id','customerLedgerId']),
      coalesce(v_payment.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6a_sales_cloud_base'),
      v_saved.server_version
    );

    perform private.record_pos_sync_event(
      v_license_id,
      'sale_payment',
      v_payment_id,
      'upsert_shadow',
      v_device_id,
      v_staff_user_id,
      v_idempotency_key,
      jsonb_build_object('sale_id', v_sale_id, 'source_mode', 'shadow', 'server_version', v_saved.server_version),
      v_saved.server_version::integer
    );
  end loop;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'sale',
    v_saved.id,
    'upsert_shadow',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object(
      'sale_id', v_saved.id,
      'status', v_saved.status,
      'source_mode', v_saved.source_mode,
      'sold_at', v_saved.sold_at,
      'server_version', v_saved.server_version,
      'staff_user_id', v_staff_user_id,
      'device_id', v_device_id
    ),
    v_saved.server_version::integer
  );

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_saved.id,
    'sale.shadow_upserted',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object('idempotency_key', v_idempotency_key, 'server_version', v_saved.server_version)
  );

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
  into v_items_response
  from public.pos_sale_items i
  where i.license_id = v_license_id and i.sale_id = v_saved.id;

  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
  into v_payments_response
  from public.pos_sale_payments p
  where p.license_id = v_license_id and p.sale_id = v_saved.id;

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_saved),
    'items', v_items_response,
    'payments', v_payments_response,
    'event', to_jsonb(v_event),
    'server_version', v_saved.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_get_sale(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null
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
  v_sale public.pos_sales;
  v_items jsonb;
  v_payments jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if p_sale_id is null or btrim(p_sale_id) = '' then
    raise exception 'SALE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = p_sale_id
  limit 1;

  if v_sale.id is null then
    return jsonb_build_object('success', false, 'code', 'SALE_NOT_FOUND', 'message', 'Venta no encontrada.');
  end if;

  if coalesce(v_context->>'device_role', 'staff') = 'staff'
     and not private.has_pos_permission(v_context, 'reports')
     and coalesce(v_sale.staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(v_staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(v_sale.device_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_device_id then
    raise exception 'POS_PERMISSION_DENIED:sales_audit' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
  into v_items
  from public.pos_sale_items i
  where i.license_id = v_license_id and i.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
  into v_payments
  from public.pos_sale_payments p
  where p.license_id = v_license_id and p.sale_id = v_sale.id;

  return jsonb_build_object('success', true, 'sale', private.pos_sale_to_jsonb(v_sale), 'items', v_items, 'payments', v_payments);
end;
$$;

create or replace function public.pos_pull_sales_snapshot(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_offset integer default 0,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_include_deleted boolean default false
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
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sales jsonb;
  v_items jsonb;
  v_payments jsonb;
  v_total_count integer;
  v_latest_change_seq bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  with visible_sales as (
    select s.*
    from public.pos_sales s
    where s.license_id = v_license_id
      and (p_include_deleted or s.deleted_at is null)
      and (p_date_from is null or s.sold_at >= p_date_from)
      and (p_date_to is null or s.sold_at < p_date_to)
      and (
        coalesce(v_context->>'device_role', 'staff') <> 'staff'
        or private.has_pos_permission(v_context, 'reports')
        or s.staff_user_id = v_staff_user_id
        or s.device_id = v_device_id
      )
  ), page_sales as (
    select *
    from visible_sales
    order by sold_at desc, id desc
    limit v_limit offset v_offset
  )
  select
    coalesce((select jsonb_agg(private.pos_sale_to_jsonb(s) order by s.sold_at desc, s.id desc) from page_sales s), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc)
      from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id in (select id from page_sales)), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc)
      from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id in (select id from page_sales)), '[]'::jsonb),
    (select count(*) from visible_sales)
  into v_sales, v_items, v_payments, v_total_count;

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id
    and entity_type in ('sale','sale_item','sale_payment');

  return jsonb_build_object(
    'success', true,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'total_count', v_total_count,
    'limit', v_limit,
    'offset', v_offset,
    'latest_change_seq', v_latest_change_seq,
    'has_more', v_total_count > (v_offset + v_limit)
  );
end;
$$;

create or replace function public.pos_pull_sales_changes(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
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
  v_device_id uuid;
  v_staff_user_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_events jsonb;
  v_sales jsonb;
  v_items jsonb;
  v_payments jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  with visible_events as (
    select e.*,
      coalesce(e.metadata->>'sale_id', case when e.entity_type = 'sale' then e.entity_id else null end) as sale_id
    from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.entity_type in ('sale','sale_item','sale_payment')
      and exists (
        select 1
        from public.pos_sales s
        where s.license_id = v_license_id
          and s.id = coalesce(e.metadata->>'sale_id', case when e.entity_type = 'sale' then e.entity_id else null end)
          and (
            coalesce(v_context->>'device_role', 'staff') <> 'staff'
            or private.has_pos_permission(v_context, 'reports')
            or s.staff_user_id = v_staff_user_id
            or s.device_id = v_device_id
          )
      )
  ), pulled as (
    select *
    from visible_events
    where change_seq > v_since
    order by change_seq asc
    limit v_limit
  ), affected_sale_ids as (
    select distinct sale_id as id from pulled where sale_id is not null
  )
  select
    coalesce((select jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc) from pulled), '[]'::jsonb),
    coalesce((select max(change_seq) from pulled), v_since),
    coalesce((select jsonb_agg(private.pos_sale_to_jsonb(s) order by s.updated_at asc, s.id asc)
      from public.pos_sales s join affected_sale_ids a on a.id = s.id where s.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc)
      from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id in (select id from affected_sale_ids)), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc)
      from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id in (select id from affected_sale_ids)), '[]'::jsonb)
  into v_events, v_latest_returned, v_sales, v_items, v_payments;

  with visible_events as (
    select e.change_seq,
      coalesce(e.metadata->>'sale_id', case when e.entity_type = 'sale' then e.entity_id else null end) as sale_id
    from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.entity_type in ('sale','sale_item','sale_payment')
      and exists (
        select 1
        from public.pos_sales s
        where s.license_id = v_license_id
          and s.id = coalesce(e.metadata->>'sale_id', case when e.entity_type = 'sale' then e.entity_id else null end)
          and (
            coalesce(v_context->>'device_role', 'staff') <> 'staff'
            or private.has_pos_permission(v_context, 'reports')
            or s.staff_user_id = v_staff_user_id
            or s.device_id = v_device_id
          )
      )
  )
  select coalesce(max(change_seq), v_since)
  into v_server_latest
  from visible_events;

  return jsonb_build_object(
    'success', true,
    'events', v_events,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned
  );
end;
$$;

create or replace function public.pos_export_sales_shadow(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_snapshot jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'reports');

  v_snapshot := public.pos_pull_sales_snapshot(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_limit,
    p_offset,
    p_date_from,
    p_date_to,
    false
  );

  return jsonb_build_object(
    'success', true,
    'export_type', 'sales_shadow',
    'phase', 'fase6a_sales_cloud_base',
    'data', v_snapshot
  );
end;
$$;

grant execute on function public.pos_upsert_sale_shadow(text,text,text,text,jsonb,jsonb,jsonb,text) to anon, authenticated;
grant execute on function public.pos_get_sale(text,text,text,text,text) to anon, authenticated;
grant execute on function public.pos_pull_sales_snapshot(text,text,text,text,integer,integer,timestamptz,timestamptz,boolean) to anon, authenticated;
grant execute on function public.pos_pull_sales_changes(text,text,text,text,bigint,integer) to anon, authenticated;
grant execute on function public.pos_export_sales_shadow(text,text,text,text,timestamptz,timestamptz,integer,integer) to anon, authenticated;;
