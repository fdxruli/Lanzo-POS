-- FASE 2 — CLOUD LAYAWAYS SERVER CONTRACT R1
--
-- Forward-only server contract for layaway create/payment/cancel/delivery.
-- The feature is deliberately not granted to any plan by this migration.
-- FREE/local Dexie layaways and the already merged #260 cash-session contract
-- remain the fallback while `cloud_layaways` is absent/false.
--
-- No direct client DML is granted on these tables. Money, stock reservations,
-- cash movements, delivery folios, and the financial-operation receipt are
-- committed by one SECURITY DEFINER boundary.

begin;

create table if not exists public.pos_layaways (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  customer_id text null,
  customer_name text null,
  customer_phone text null,
  total_amount numeric not null,
  paid_amount numeric not null default 0,
  balance_due numeric not null default 0,
  currency text not null default 'MXN',
  deadline timestamptz not null,
  status text not null default 'active',
  items jsonb not null default '[]'::jsonb,
  cash_station_id text null,
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  actor_key text not null,
  actor_name text not null,
  conversion_sale_id text null,
  refund_id text null,
  refund_cash_movement_id text null,
  retained_money boolean not null default false,
  retained_amount numeric not null default 0,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  deleted_at timestamptz null,
  server_version bigint not null default 1,
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_layaways_license_id_id_uk unique (license_id, id),
  constraint pos_layaways_total_amount_chk check (total_amount > 0),
  constraint pos_layaways_paid_amount_chk check (paid_amount >= 0),
  constraint pos_layaways_balance_due_chk check (balance_due >= 0),
  constraint pos_layaways_paid_not_over_total_chk check (paid_amount <= total_amount + 0.005),
  constraint pos_layaways_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint pos_layaways_status_chk check (status in ('active', 'ready', 'cancelled', 'completed')),
  constraint pos_layaways_retained_amount_chk check (retained_amount >= 0),
  constraint pos_layaways_actor_key_chk check (length(btrim(actor_key)) > 0),
  constraint pos_layaways_actor_name_chk check (length(btrim(actor_name)) > 0),
  constraint pos_layaways_server_version_chk check (server_version >= 1)
);

create table if not exists public.pos_layaway_payments (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  layaway_id text not null,
  payment_method text not null default 'cash',
  amount numeric not null,
  status text not null default 'confirmed',
  cash_session_id text null,
  cash_station_id text null,
  cash_movement_id text null,
  reference text null,
  request_hash text null,
  idempotency_key text null,
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  actor_key text not null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  refunded_at timestamptz null,
  server_version bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_layaway_payments_layaway_fk
    foreign key (license_id, layaway_id)
    references public.pos_layaways(license_id, id)
    on delete cascade,
  constraint pos_layaway_payments_method_chk check (payment_method in ('cash')),
  constraint pos_layaway_payments_amount_chk check (amount > 0),
  constraint pos_layaway_payments_status_chk check (status in ('confirmed', 'refunded')),
  constraint pos_layaway_payments_actor_key_chk check (length(btrim(actor_key)) > 0),
  constraint pos_layaway_payments_actor_name_chk check (length(btrim(actor_name)) > 0),
  constraint pos_layaway_payments_server_version_chk check (server_version >= 1)
);

create table if not exists public.pos_layaway_inventory_reservations (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  layaway_id text not null,
  item_index integer not null,
  product_id text not null,
  batch_id text null,
  quantity numeric not null,
  unit_cost numeric not null default 0,
  stock_before numeric not null default 0,
  stock_after numeric not null default 0,
  committed_before numeric not null default 0,
  committed_after numeric not null default 0,
  status text not null default 'reserved',
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  actor_key text not null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz null,
  consumed_at timestamptz null,
  server_version bigint not null default 1,
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_layaway_reservations_layaway_fk
    foreign key (license_id, layaway_id)
    references public.pos_layaways(license_id, id)
    on delete cascade,
  constraint pos_layaway_reservations_item_index_chk check (item_index > 0),
  constraint pos_layaway_reservations_quantity_chk check (quantity > 0),
  constraint pos_layaway_reservations_unit_cost_chk check (unit_cost >= 0),
  constraint pos_layaway_reservations_stock_chk check (stock_before >= 0 and stock_after >= 0),
  constraint pos_layaway_reservations_committed_chk check (committed_before >= 0 and committed_after >= 0),
  constraint pos_layaway_reservations_status_chk check (status in ('reserved', 'released', 'consumed')),
  constraint pos_layaway_reservations_actor_key_chk check (length(btrim(actor_key)) > 0),
  constraint pos_layaway_reservations_actor_name_chk check (length(btrim(actor_name)) > 0),
  constraint pos_layaway_reservations_server_version_chk check (server_version >= 1)
);

create unique index if not exists ux_pos_layaway_payments_license_idempotency
  on public.pos_layaway_payments (license_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists ux_pos_layaway_payments_license_cash_movement
  on public.pos_layaway_payments (license_id, cash_movement_id)
  where cash_movement_id is not null;
create unique index if not exists ux_pos_layaway_reservations_active_item_source
  on public.pos_layaway_inventory_reservations (license_id, layaway_id, item_index)
  where status = 'reserved';

create index if not exists idx_pos_layaways_license_status_deadline
  on public.pos_layaways (license_id, status, deadline);
create index if not exists idx_pos_layaways_license_customer_updated
  on public.pos_layaways (license_id, customer_id, updated_at desc);
create index if not exists idx_pos_layaways_license_server_version
  on public.pos_layaways (license_id, server_version);
create index if not exists idx_pos_layaway_payments_license_layaway_created
  on public.pos_layaway_payments (license_id, layaway_id, created_at);
create index if not exists idx_pos_layaway_reservations_license_layaway_status
  on public.pos_layaway_inventory_reservations (license_id, layaway_id, status);
create index if not exists idx_pos_layaway_reservations_license_product_status
  on public.pos_layaway_inventory_reservations (license_id, product_id, status);

alter table public.pos_layaways enable row level security;
alter table public.pos_layaway_payments enable row level security;
alter table public.pos_layaway_inventory_reservations enable row level security;

revoke all on public.pos_layaways from anon, authenticated;
revoke all on public.pos_layaway_payments from anon, authenticated;
revoke all on public.pos_layaway_inventory_reservations from anon, authenticated;

create policy pos_layaways_no_direct_client_select
  on public.pos_layaways for select to anon, authenticated using (false);
create policy pos_layaway_payments_no_direct_client_select
  on public.pos_layaway_payments for select to anon, authenticated using (false);
create policy pos_layaway_reservations_no_direct_client_select
  on public.pos_layaway_inventory_reservations for select to anon, authenticated using (false);

comment on table public.pos_layaways is
  'Cloud layaway server aggregate. No direct client DML; all money/state changes use pos_execute_financial_operation_v1.';
comment on table public.pos_layaway_payments is
  'Confirmed cash deposits for cloud layaways, atomically linked to pos_cash_movements.';
comment on table public.pos_layaway_inventory_reservations is
  'Committed-stock reservations held by a cloud layaway and released/consumed exactly once.';

create or replace function private.assert_cloud_layaways_enabled(p_context jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);
  perform private.assert_cloud_sales_sync_base_enabled(p_context);
  perform private.assert_cloud_cash_sync_enabled(p_context);
  perform private.assert_cloud_products_sync_enabled(p_context);

  -- Deliberately no plan/license backfill exists in this migration.  The
  -- dedicated capability is therefore false everywhere until an explicit
  -- rollout grants `cloud_layaways` to a license/plan.
  if coalesce((p_context->'features'->>'cloud_layaways')::boolean, false) is not true then
    raise exception 'CLOUD_LAYAWAYS_DISABLED' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function private.layaway_request_text_v1(
  p_payload jsonb,
  p_keys text[],
  p_default text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_key text;
  v_value text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return p_default;
  end if;
  foreach v_key in array p_keys loop
    v_value := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    if v_value is not null then
      return v_value;
    end if;
  end loop;
  return p_default;
end;
$function$;

create or replace function private.layaway_request_numeric_v1(
  p_payload jsonb,
  p_keys text[],
  p_default numeric default null
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_key text;
  v_value text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return p_default;
  end if;
  foreach v_key in array p_keys loop
    v_value := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    if v_value is not null then
      if v_value !~ '^[+-]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)$' then
        raise exception 'LAYAWAY_NUMERIC_INVALID:%', v_key using errcode = 'P0001';
      end if;
      return v_value::numeric;
    end if;
  end loop;
  return p_default;
end;
$function$;

create or replace function private.layaway_request_bool_v1(
  p_payload jsonb,
  p_keys text[],
  p_default boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := lower(nullif(btrim(coalesce(p_payload->>v_key, '')), ''));
    if v_value is not null then
      return v_value in ('true', '1', 'yes', 'si', 'sí');
    end if;
  end loop;
  return p_default;
end;
$function$;

create or replace function private.layaway_request_cash_session_id_v1(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    private.layaway_request_text_v1($1, array['cash_session_id','cashSessionId','cajaId']),
    private.layaway_request_text_v1(
      case
        when jsonb_typeof($1->'initial_payment') = 'object' then $1->'initial_payment'
        when jsonb_typeof($1->'initialPayment') = 'object' then $1->'initialPayment'
        else '{}'::jsonb
      end,
      array['cash_session_id','cashSessionId','cajaId']
    ),
    private.layaway_request_text_v1(
      case when jsonb_typeof($1->'payment') = 'object' then $1->'payment' else '{}'::jsonb end,
      array['cash_session_id','cashSessionId','cajaId']
    ),
    private.layaway_request_text_v1(
      case when jsonb_typeof($1->'refund') = 'object' then $1->'refund' else '{}'::jsonb end,
      array['cash_session_id','cashSessionId','cajaId']
    )
  )
$function$;

create or replace function private.layaway_request_id_v1(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $function$
  select private.layaway_request_text_v1($1, array['layaway_id','layawayId','id'])
$function$;

create or replace function private.layaway_payment_payload_v1(p_request jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1->'payment') = 'object' then $1->'payment'
    when jsonb_typeof($1->'initial_payment') = 'object' then $1->'initial_payment'
    when jsonb_typeof($1->'initialPayment') = 'object' then $1->'initialPayment'
    else '{}'::jsonb
  end
$function$;

create or replace function private.layaway_record_v1(p_request jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1->'layaway') = 'object' then $1->'layaway'
    when jsonb_typeof($1->'layawayData') = 'object' then $1->'layawayData'
    else '{}'::jsonb
  end
$function$;

create or replace function private.layaway_deadline_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_raw text;
begin
  v_raw := private.financial_text_v1(p_value);
  if v_raw is null then return null; end if;
  if v_raw ~ '^\\d{4}-\\d{2}-\\d{2}$' then
    return private.financial_timestamp_v1(to_jsonb(v_raw || 'T00:00:00.000000Z'));
  end if;
  return private.financial_timestamp_v1(to_jsonb(v_raw));
end;
$function$;

create or replace function private.canonical_layaway_item_v1(p_item jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'LAYAWAY_ITEM_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', private.layaway_request_text_v1(p_item, array['id']),
    'product_id', private.layaway_request_text_v1(p_item, array['product_id','productId','parentId']),
    'product_name', private.layaway_request_text_v1(p_item, array['product_name','productName','name']),
    'product_sku', private.layaway_request_text_v1(p_item, array['product_sku','productSku','sku']),
    'barcode', private.layaway_request_text_v1(p_item, array['barcode','barCode']),
    'category_id', private.layaway_request_text_v1(p_item, array['category_id','categoryId']),
    'category_name', private.layaway_request_text_v1(p_item, array['category_name','categoryName','rubro','category']),
    'rubro', private.layaway_request_text_v1(p_item, array['rubro','category','categoryName']),
    'batch_id', private.layaway_request_text_v1(p_item, array['batch_id','batchId']),
    'batch_sku', private.layaway_request_text_v1(p_item, array['batch_sku','batchSku']),
    'batch_expiry_date', private.layaway_request_text_v1(p_item, array['batch_expiry_date','batchExpiryDate','expiryDate']),
    'variant_id', private.layaway_request_text_v1(p_item, array['variant_id','variantId']),
    'size', private.layaway_request_text_v1(p_item, array['size','talla']),
    'color', private.layaway_request_text_v1(p_item, array['color','colorName']),
    'attributes', case when jsonb_typeof(p_item->'attributes') = 'object' then p_item->'attributes' else null end,
    'variant_attributes', case
      when jsonb_typeof(p_item->'variant_attributes') = 'object' then p_item->'variant_attributes'
      when jsonb_typeof(p_item->'variantAttributes') = 'object' then p_item->'variantAttributes'
      else null
    end,
    'quantity', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['quantity','qty'])),
    'unit_price', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['unit_price','unitPrice','price'])),
    'unit_cost', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['unit_cost','unitCost','cost'])),
    'line_total', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['line_total','lineTotal','total','exactTotal'])),
    'discount_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['discount_amount','discountAmount'])), '0'),
    'tax_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['tax_amount','taxAmount'])), '0')
  ));
end;
$function$;

create or replace function private.canonical_layaway_payment_v1(p_payment jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_payment) <> 'object' then
    raise exception 'LAYAWAY_PAYMENT_INVALID' using errcode = 'P0001';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', private.layaway_request_text_v1(p_payment, array['id','payment_id','paymentId']),
    'method', case lower(coalesce(private.layaway_request_text_v1(p_payment, array['method','payment_method','paymentMethod']), 'cash'))
      when 'efectivo' then 'cash' else lower(coalesce(private.layaway_request_text_v1(p_payment, array['method','payment_method','paymentMethod']), 'cash')) end,
    'amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['amount','total'])),
    'payment_type', private.layaway_request_text_v1(p_payment, array['payment_type','paymentType','type']),
    'reference', private.layaway_request_text_v1(p_payment, array['reference','ref']),
    'customer_id', private.layaway_request_text_v1(p_payment, array['customer_id','customerId']),
    'cash_session_id', private.layaway_request_text_v1(p_payment, array['cash_session_id','cashSessionId','cajaId'])
  ));
end;
$function$;

create or replace function private.canonical_layaway_request_v1(
  p_operation_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_layaway jsonb;
  v_payment jsonb;
  v_items jsonb;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'layaway.create' then
      v_layaway := private.layaway_record_v1(p_request);
      if jsonb_typeof(v_layaway) <> 'object' then
        raise exception 'LAYAWAY_PAYLOAD_INVALID' using errcode = 'P0001';
      end if;
      v_items := case when jsonb_typeof(v_layaway->'items') = 'array' then v_layaway->'items' else '[]'::jsonb end;
      if jsonb_typeof(v_items) <> 'array' then
        raise exception 'LAYAWAY_ITEMS_INVALID' using errcode = 'P0001';
      end if;
      v_payment := private.layaway_payment_payload_v1(p_request);
      return jsonb_strip_nulls(jsonb_build_object(
        'layaway', jsonb_strip_nulls(jsonb_build_object(
          'id', private.layaway_request_text_v1(v_layaway, array['id','layaway_id','layawayId']),
          'customer_id', private.layaway_request_text_v1(v_layaway, array['customer_id','customerId']),
          'customer_name', private.layaway_request_text_v1(v_layaway, array['customer_name','customerName']),
          'customer_phone', private.layaway_request_text_v1(v_layaway, array['customer_phone','customerPhone']),
          'total_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_layaway, array['total_amount','totalAmount','total'])),
          'currency', upper(coalesce(private.layaway_request_text_v1(v_layaway, array['currency']), 'MXN')),
          'deadline', private.layaway_deadline_v1(private.financial_first_nonblank_scalar_v1(v_layaway, array['deadline','due_date','dueDate'])),
          'items', (select coalesce(jsonb_agg(private.canonical_layaway_item_v1(value) order by ordinality), '[]'::jsonb)
                    from jsonb_array_elements(v_items) with ordinality)
        )),
        'initial_payment', case when jsonb_typeof(v_payment) = 'object' and v_payment <> '{}'::jsonb
          then private.canonical_layaway_payment_v1(
            v_payment || jsonb_build_object('cash_session_id', private.layaway_request_cash_session_id_v1(p_request))
          ) else null end,
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    when 'layaway.payment' then
      return jsonb_strip_nulls(jsonb_build_object(
        'layaway_id', private.layaway_request_id_v1(p_request),
        'payment', private.canonical_layaway_payment_v1(
          private.layaway_payment_payload_v1(p_request)
          || jsonb_build_object('cash_session_id', private.layaway_request_cash_session_id_v1(p_request))
        ),
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    when 'layaway.cancel' then
      return jsonb_strip_nulls(jsonb_build_object(
        'layaway_id', private.layaway_request_id_v1(p_request),
        'reason', private.layaway_request_text_v1(p_request, array['reason','motivo'], 'Cancelación de apartado'),
        'retain_money', private.layaway_request_bool_v1(p_request, array['retain_money','retainMoney','retained_money']),
        'refund_id', private.layaway_request_text_v1(p_request, array['refund_id','refundId']),
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$function$;

create or replace function private.layaway_execution_request_v1(p_request jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_payment jsonb;
  v_layaway jsonb;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_payment := private.layaway_payment_payload_v1(p_request);
  v_layaway := private.layaway_record_v1(p_request);
  return jsonb_strip_nulls(
    p_request
    || jsonb_build_object(
      'layaway_id', private.layaway_request_id_v1(p_request),
      'cash_session_id', private.layaway_request_cash_session_id_v1(p_request),
      'layaway', v_layaway,
      'payment', v_payment
    )
  );
end;
$function$;

create or replace function private.pos_layaway_to_jsonb(p_layaway public.pos_layaways)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(to_jsonb($1)) end
$function$;

create or replace function private.pos_layaway_payment_to_jsonb(p_payment public.pos_layaway_payments)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(to_jsonb($1)) end
$function$;

create or replace function private.pos_layaway_reservation_to_jsonb(p_reservation public.pos_layaway_inventory_reservations)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(to_jsonb($1)) end
$function$;

create or replace function private.layaway_cash_session_v1(
  p_license_id uuid,
  p_device_id uuid,
  p_actor_key text,
  p_cash_session_id text,
  p_cash_station_id text
)
returns public.pos_cash_sessions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.pos_cash_sessions;
begin
  if nullif(btrim(coalesce(p_cash_session_id, '')), '') is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_session
    from public.pos_cash_sessions s
   where s.license_id = p_license_id
     and s.id = p_cash_session_id
     and s.deleted_at is null
   for update;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_session.cash_station_id is null or p_cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if v_session.cash_station_id is distinct from p_cash_station_id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;
  if v_session.actor_key is distinct from p_actor_key then
    raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
  end if;

  return v_session;
end;
$function$;

revoke all on function private.assert_cloud_layaways_enabled(jsonb) from public, anon, authenticated;
revoke all on function private.layaway_request_cash_session_id_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_layaway_request_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.layaway_execution_request_v1(jsonb) from public, anon, authenticated;
revoke all on function private.layaway_cash_session_v1(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.layaway_record_v1(jsonb) from public, anon, authenticated;
revoke all on function private.layaway_deadline_v1(jsonb) from public, anon, authenticated;

create or replace function private.normalize_layaway_items_v1(
  p_items jsonb,
  p_total numeric
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_total numeric;
  v_declared_line_total numeric;
  v_discount_input jsonb;
  v_discount_result jsonb;
  v_discount_amount numeric;
  v_tax_amount numeric;
  v_item_total numeric := 0;
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'LAYAWAY_ITEMS_INVALID' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_count := v_count + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'LAYAWAY_ITEM_INVALID' using errcode = 'P0001';
    end if;

    v_quantity := private.layaway_request_numeric_v1(v_item, array['quantity','qty']);
    v_unit_price := private.layaway_request_numeric_v1(v_item, array['unit_price','unitPrice','price']);
    v_declared_line_total := private.layaway_request_numeric_v1(
      v_item, array['line_total','lineTotal','total','exactTotal']
    );

    if v_quantity is null or v_quantity <= 0 or v_unit_price is null or v_unit_price < 0 then
      raise exception 'LAYAWAY_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_line_subtotal := round(v_quantity * v_unit_price, 2);

    v_discount_input := coalesce(
      nullif(v_item->'discount', 'null'::jsonb),
      nullif(v_item->'discountAmount', 'null'::jsonb),
      nullif(v_item->'discount_amount', 'null'::jsonb)
    );
    if v_discount_input is null then
      v_discount_amount := private.layaway_request_numeric_v1(
        v_item, array['discount_amount','discountAmount'], null
      );
      if v_discount_amount is not null and v_discount_amount <> 0 then
        v_discount_input := jsonb_build_object(
          'type', 'amount',
          'value', v_discount_amount,
          'reason', coalesce(v_item->>'discountReason', v_item->>'discount_reason')
        );
      end if;
    end if;
    v_discount_result := private.r2b_normalize_discount_v1(v_discount_input, v_line_subtotal, 'line');
    v_discount_amount := coalesce((v_discount_result->>'amount')::numeric, 0);
    v_line_total := round(v_line_subtotal - v_discount_amount, 2);

    v_tax_amount := greatest(coalesce(private.layaway_request_numeric_v1(
      v_item, array['tax_amount','taxAmount'], 0
    ), 0), 0);
    if v_tax_amount > 0.005 then
      raise exception 'LAYAWAY_TAX_SOURCE_UNRESOLVED' using errcode = 'P0001';
    end if;

    if v_declared_line_total is not null and abs(v_declared_line_total - v_line_total) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_item_total := v_item_total + v_line_total;
    v_normalized := v_normalized || jsonb_build_array(
      v_item || jsonb_build_object(
        'quantity', v_quantity,
        'unit_price', v_unit_price,
        'line_subtotal', v_line_subtotal,
        'line_total', v_line_total,
        'discount', v_discount_result->'discount',
        'discount_amount', v_discount_amount,
        'tax_amount', 0
      )
    );
  end loop;

  if v_count = 0 then
    raise exception 'LAYAWAY_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'LAYAWAY_TOTAL_INVALID' using errcode = 'P0001';
  end if;
  if abs(round(v_item_total, 2) - p_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  return jsonb_build_object('items', v_normalized, 'total', round(v_item_total, 2));
end;
$function$;

create or replace function private.layaway_authoritative_base_price_v1(
  p_product public.pos_products,
  p_batch public.pos_product_batches,
  p_quantity numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_base_price numeric;
  v_reference_cost numeric;
  v_tier jsonb;
  v_tier_min numeric;
  v_tier_price numeric;
  v_best_tier_min numeric := null;
  v_best_tier_price numeric := null;
  v_batch_attributes jsonb := coalesce(p_batch.attributes, '{}'::jsonb);
  v_is_commercial_variant boolean := false;
begin
  if p_product.id is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'LAYAWAY_PRICE_SOURCE_INVALID' using errcode = 'P0001';
  end if;

  -- The persisted product schema predates a dedicated has_variants column.
  -- A non-empty authoritative batch attribute object is the same variant
  -- signal used by the existing cloud-sale authority.  Never trust a
  -- client-provided isVariant flag to select a price.
  v_is_commercial_variant := p_batch.id is not null
    and jsonb_typeof(v_batch_attributes) = 'object'
    and v_batch_attributes <> '{}'::jsonb;
  v_base_price := case
    when v_is_commercial_variant then p_batch.price
    else p_product.price
  end;
  v_reference_cost := case
    when p_batch.id is not null then p_batch.cost
    else p_product.cost
  end;

  if jsonb_typeof(coalesce(p_product.wholesale_tiers, '[]'::jsonb)) = 'array' then
    for v_tier in select value from jsonb_array_elements(coalesce(p_product.wholesale_tiers, '[]'::jsonb)) loop
      begin
        v_tier_min := coalesce(nullif(btrim(coalesce(
          v_tier->>'min', v_tier->>'minQty', v_tier->>'min_qty', ''
        )), '')::numeric, 0);
        v_tier_price := nullif(btrim(coalesce(v_tier->>'price', '')), '')::numeric;
      exception when others then
        raise exception 'LAYAWAY_WHOLESALE_TIER_INVALID' using errcode = 'P0001';
      end;
      if v_tier_min >= 0 and v_tier_price is not null and v_tier_price >= 0
         and p_quantity >= v_tier_min
         and not (coalesce(v_reference_cost, 0) > 0 and v_tier_price < v_reference_cost)
         and (v_best_tier_min is null or v_tier_min > v_best_tier_min) then
        v_best_tier_min := v_tier_min;
        v_best_tier_price := v_tier_price;
      end if;
    end loop;
  end if;

  if v_best_tier_price is not null then
    v_base_price := v_best_tier_price;
  end if;
  if v_base_price is null or v_base_price < 0 then
    raise exception 'LAYAWAY_PRICE_SOURCE_INVALID' using errcode = 'P0001';
  end if;
  return round(v_base_price, 4);
end;
$function$;

create or replace function private.layaway_authoritative_item_v1(
  p_product public.pos_products,
  p_batch public.pos_product_batches,
  p_item jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_quantity numeric;
  v_base_price numeric;
  v_modifier_result jsonb;
  v_unit_price numeric;
  v_unit_cost numeric;
begin
  v_quantity := private.layaway_request_numeric_v1(p_item, array['quantity','qty']);
  v_base_price := private.layaway_authoritative_base_price_v1(p_product, p_batch, v_quantity);
  v_modifier_result := private.r2b_authoritative_modifiers_v1(p_product, p_item);
  v_unit_price := round(v_base_price + coalesce((v_modifier_result->>'unit_total')::numeric, 0), 4);
  v_unit_cost := greatest(coalesce(case when p_batch.id is not null then p_batch.cost else p_product.cost end, 0), 0);

  return jsonb_build_object(
    'unit_price', v_unit_price,
    'unit_cost', v_unit_cost,
    'selected_modifiers', coalesce(v_modifier_result->'modifiers', '[]'::jsonb)
  );
end;
$function$;

revoke all on function private.layaway_authoritative_base_price_v1(public.pos_products, public.pos_product_batches, numeric) from public, anon, authenticated;
revoke all on function private.layaway_authoritative_item_v1(public.pos_products, public.pos_product_batches, jsonb) from public, anon, authenticated;

create or replace function private.reserve_layaway_stock_v1(
  p_license_id uuid,
  p_layaway_id text,
  p_items jsonb,
  p_actor_device_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_key text,
  p_actor_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item record;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_reservation public.pos_layaway_inventory_reservations;
  v_product_id text;
  v_batch_id text;
  v_quantity numeric;
  v_item_index integer;
  v_product_committed numeric;
  v_previous_committed numeric;
  v_new_committed numeric;
  v_reservation_id text;
  v_operation_key text;
  v_variant_attributes jsonb;
  v_item_attributes jsonb;
  v_requested_size text;
  v_requested_color text;
  v_requested_batch_sku text;
  v_authoritative_item jsonb;
  v_requested_unit_price numeric;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'LAYAWAY_ITEMS_INVALID' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality::integer as item_index
      from jsonb_array_elements(p_items) with ordinality
     order by private.layaway_request_text_v1(value, array['product_id','productId','parentId']),
              private.layaway_request_text_v1(value, array['batch_id','batchId']),
              ordinality
  loop
    v_item_index := v_item.item_index;
    v_product := null;
    v_batch := null;
    v_product_id := private.layaway_request_text_v1(
      v_item.payload, array['product_id','productId','parentId']
    );
    if v_product_id is null then
      raise exception 'LAYAWAY_PRODUCT_REQUIRED' using errcode = 'P0001';
    end if;
    v_quantity := private.layaway_request_numeric_v1(v_item.payload, array['quantity','qty']);
    v_batch_id := private.layaway_request_text_v1(v_item.payload, array['batch_id','batchId']);

    select * into v_product
      from public.pos_products p
     where p.license_id = p_license_id
       and p.id = v_product_id
       and p.deleted_at is null
       and p.is_active is true
     for update;
    if v_product.id is null then
      raise exception 'LAYAWAY_PRODUCT_NOT_SYNCED:%', v_product_id using errcode = 'P0001';
    end if;

    if private.product_uses_batches(v_product) is true then
      if v_batch_id is null then
        raise exception 'LAYAWAY_BATCH_REQUIRED:%', v_product_id using errcode = 'P0001';
      end if;

      select * into v_batch
        from public.pos_product_batches b
       where b.license_id = p_license_id
         and b.id = v_batch_id
         and b.product_id = v_product_id
         and b.deleted_at is null
         and b.is_active is true
         and b.status = 'active'
       for update;
      if v_batch.id is null then
        raise exception 'LAYAWAY_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;
      if v_batch.track_stock is not true then
        raise exception 'LAYAWAY_BATCH_STOCK_UNSAFE:%', v_batch_id using errcode = 'P0001';
      end if;
      v_variant_attributes := case
        when jsonb_typeof(v_item.payload->'variant_attributes') = 'object' then v_item.payload->'variant_attributes'
        when jsonb_typeof(v_item.payload->'variantAttributes') = 'object' then v_item.payload->'variantAttributes'
        else '{}'::jsonb
      end;
      v_item_attributes := case
        when jsonb_typeof(v_item.payload->'attributes') = 'object' then v_item.payload->'attributes'
        else '{}'::jsonb
      end;
      if v_variant_attributes <> '{}'::jsonb
         and (
           jsonb_typeof(coalesce(v_batch.attributes, '{}'::jsonb)) <> 'object'
           or not (coalesce(v_batch.attributes, '{}'::jsonb) @> v_variant_attributes)
           and not (coalesce(v_batch.attributes->'optionValues', '{}'::jsonb) @> v_variant_attributes)
           and not (coalesce(v_batch.metadata->'optionValues', '{}'::jsonb) @> v_variant_attributes)
         ) then
        raise exception 'LAYAWAY_VARIANT_MISMATCH:%', v_batch_id using errcode = 'P0001';
      end if;
      if v_item_attributes <> '{}'::jsonb
         and (
           jsonb_typeof(coalesce(v_batch.attributes, '{}'::jsonb)) <> 'object'
           or (
             not (coalesce(v_batch.attributes, '{}'::jsonb) @> v_item_attributes)
             and not (coalesce(v_batch.attributes->'optionValues', '{}'::jsonb) @> v_item_attributes)
             and not (coalesce(v_batch.metadata->'optionValues', '{}'::jsonb) @> v_item_attributes)
           )
         ) then
        raise exception 'LAYAWAY_VARIANT_MISMATCH:%', v_batch_id using errcode = 'P0001';
      end if;
      v_requested_size := private.layaway_request_text_v1(v_item.payload, array['size','talla']);
      if v_requested_size is not null
         and lower(v_requested_size) <> lower(coalesce(v_batch.attributes->>'size', v_batch.attributes->>'talla', v_batch.metadata->>'size', v_batch.metadata->>'talla', '')) then
        raise exception 'LAYAWAY_VARIANT_MISMATCH:%', v_batch_id using errcode = 'P0001';
      end if;
      v_requested_color := private.layaway_request_text_v1(v_item.payload, array['color','colorName']);
      if v_requested_color is not null
         and lower(v_requested_color) <> lower(coalesce(v_batch.attributes->>'color', v_batch.attributes->>'colorName', v_batch.metadata->>'color', v_batch.metadata->>'colorName', '')) then
        raise exception 'LAYAWAY_VARIANT_MISMATCH:%', v_batch_id using errcode = 'P0001';
      end if;
      v_requested_batch_sku := private.layaway_request_text_v1(v_item.payload, array['batch_sku','batchSku']);
      if v_requested_batch_sku is not null
         and lower(v_requested_batch_sku) <> lower(coalesce(v_batch.sku, '')) then
        raise exception 'LAYAWAY_BATCH_MISMATCH:%', v_batch_id using errcode = 'P0001';
      end if;
      if greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0) < v_quantity then
        raise exception 'INSUFFICIENT_CLOUD_STOCK:%', v_product_id using errcode = 'P0001';
      end if;
    else
      if v_batch_id is not null then
        raise exception 'LAYAWAY_BATCH_NOT_ALLOWED:%', v_product_id using errcode = 'P0001';
      end if;
    end if;

    v_authoritative_item := private.layaway_authoritative_item_v1(v_product, v_batch, v_item.payload);
    v_requested_unit_price := private.layaway_request_numeric_v1(
      v_item.payload, array['unit_price','unitPrice','price']
    );
    if v_requested_unit_price is null
       or abs(v_requested_unit_price - (v_authoritative_item->>'unit_price')::numeric) > 0.005 then
      raise exception 'LAYAWAY_PRICE_MISMATCH:%', v_product_id using errcode = 'P0001';
    end if;

    -- Non-stock products remain a complete snapshot but do not create a
    -- reservation. The decision is server-side; client track_stock is not
    -- authoritative.
    if v_product.track_stock is not true then
      continue;
    end if;

    if v_batch.id is not null then
      v_previous_committed := coalesce(v_batch.committed_stock, 0);
      v_new_committed := v_previous_committed + v_quantity;
      v_operation_key := coalesce(p_idempotency_key, p_layaway_id) || ':reservation:' || v_item_index::text;

      update public.pos_product_batches
         set committed_stock = v_new_committed,
             updated_at = now(),
             server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key,
             metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('lastLayawayReservationId', p_layaway_id, 'lastLayawayReservationAt', now())
       where license_id = p_license_id and id = v_batch.id
       returning * into v_batch;

      select coalesce(sum(coalesce(b.committed_stock, 0)), 0)
        into v_product_committed
        from public.pos_product_batches b
       where b.license_id = p_license_id
         and b.product_id = v_product_id
         and b.deleted_at is null;
      update public.pos_products
         set committed_stock = v_product_committed,
             updated_at = now(),
             server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key,
             metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('lastLayawayReservationId', p_layaway_id, 'lastLayawayReservationAt', now())
       where license_id = p_license_id and id = v_product_id
       returning * into v_product;

      v_reservation_id := p_layaway_id || ':reservation:' || v_item_index::text;
      insert into public.pos_layaway_inventory_reservations (
        id, license_id, layaway_id, item_index, product_id, batch_id, quantity, unit_cost,
        stock_before, stock_after, committed_before, committed_after, status,
        created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
        idempotency_key, metadata
      ) values (
        v_reservation_id, p_license_id, p_layaway_id, v_item_index, v_product_id, v_batch_id, v_quantity,
        greatest(coalesce(v_batch.cost, v_product.cost), 0),
        coalesce(v_batch.stock, 0), coalesce(v_batch.stock, 0),
        v_previous_committed, v_new_committed, 'reserved',
        p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
        v_operation_key,
        jsonb_strip_nulls(jsonb_build_object(
          'phase', 'cloud_layaways_server_contract_r1',
          'stock_source', 'batch',
          'variant_attributes', v_item.payload->'variant_attributes',
          'attributes', v_item.payload->'attributes'
        ))
      ) returning * into v_reservation;

      perform private.record_pos_sync_event(
        p_license_id, 'product_batch', v_batch.id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_reserved', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_batch.server_version
      );
      perform private.record_pos_sync_event(
        p_license_id, 'product', v_product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_reserved', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_product.server_version
      );
    else
      if greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0) < v_quantity then
        raise exception 'INSUFFICIENT_CLOUD_STOCK:%', v_product_id using errcode = 'P0001';
      end if;

      v_previous_committed := coalesce(v_product.committed_stock, 0);
      v_new_committed := v_previous_committed + v_quantity;
      v_operation_key := coalesce(p_idempotency_key, p_layaway_id) || ':reservation:' || v_item_index::text;
      update public.pos_products
         set committed_stock = v_new_committed,
             updated_at = now(),
             server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key,
             metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('lastLayawayReservationId', p_layaway_id, 'lastLayawayReservationAt', now())
       where license_id = p_license_id and id = v_product_id
       returning * into v_product;

      v_reservation_id := p_layaway_id || ':reservation:' || v_item_index::text;
      insert into public.pos_layaway_inventory_reservations (
        id, license_id, layaway_id, item_index, product_id, batch_id, quantity, unit_cost,
        stock_before, stock_after, committed_before, committed_after, status,
        created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
        idempotency_key, metadata
      ) values (
        v_reservation_id, p_license_id, p_layaway_id, v_item_index, v_product_id, null, v_quantity,
        greatest(coalesce(v_product.cost, 0), 0),
        coalesce(v_product.stock, 0), coalesce(v_product.stock, 0),
        v_previous_committed, v_new_committed, 'reserved',
        p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
        v_operation_key,
        jsonb_strip_nulls(jsonb_build_object(
          'phase', 'cloud_layaways_server_contract_r1',
          'stock_source', 'product',
          'variant_attributes', v_item.payload->'variant_attributes',
          'attributes', v_item.payload->'attributes'
        ))
      ) returning * into v_reservation;

      perform private.record_pos_sync_event(
        p_license_id, 'product', v_product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_reserved', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_product.server_version
      );
    end if;
  end loop;

  return (
    select coalesce(jsonb_agg(private.pos_layaway_reservation_to_jsonb(r) order by r.item_index), '[]'::jsonb)
      from public.pos_layaway_inventory_reservations r
     where r.license_id = p_license_id and r.layaway_id = p_layaway_id
  );
end;
$function$;

create or replace function private.release_layaway_stock_v1(
  p_license_id uuid,
  p_layaway_id text,
  p_actor_device_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_key text,
  p_actor_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.pos_layaway_inventory_reservations;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_product_committed numeric;
  v_operation_key text;
begin
  for v_reservation in
    select *
      from public.pos_layaway_inventory_reservations r
     where r.license_id = p_license_id
       and r.layaway_id = p_layaway_id
       and r.status = 'reserved'
     order by r.product_id, coalesce(r.batch_id, ''), r.item_index
     for update
  loop
    v_operation_key := coalesce(p_idempotency_key, p_layaway_id) || ':release:' || v_reservation.item_index::text;
    v_product := null;
    v_batch := null;
    if v_reservation.batch_id is not null then
      select * into v_product
        from public.pos_products p
       where p.license_id = p_license_id and p.id = v_reservation.product_id and p.deleted_at is null
       for update;
      if v_product.id is null then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      select * into v_batch
        from public.pos_product_batches b
       where b.license_id = p_license_id and b.id = v_reservation.batch_id and b.deleted_at is null
       for update;
      if v_batch.id is null then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', v_reservation.batch_id using errcode = 'P0001';
      end if;
      update public.pos_product_batches
         set committed_stock = greatest(coalesce(committed_stock, 0) - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.batch_id
       returning * into v_batch;
      select coalesce(sum(coalesce(b.committed_stock, 0)), 0)
        into v_product_committed
        from public.pos_product_batches b
       where b.license_id = p_license_id and b.product_id = v_reservation.product_id and b.deleted_at is null;
      update public.pos_products
         set committed_stock = v_product_committed,
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.product_id
       returning * into v_product;
      perform private.record_pos_sync_event(
        p_license_id, 'product_batch', v_reservation.batch_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_released', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_batch.server_version
      );
      perform private.record_pos_sync_event(
        p_license_id, 'product', v_reservation.product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_released', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_product.server_version
      );
    else
      update public.pos_products
         set committed_stock = greatest(coalesce(committed_stock, 0) - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.product_id
       returning * into v_product;
      if v_product.id is null then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      perform private.record_pos_sync_event(
        p_license_id, 'product', v_reservation.product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_released', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id),
        v_product.server_version
      );
    end if;

    update public.pos_layaway_inventory_reservations
       set status = 'released', released_at = now(), server_version = server_version + 1,
           idempotency_key = v_operation_key,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('releasedByActorKey', p_actor_key)
     where license_id = p_license_id and id = v_reservation.id;
  end loop;

  return (
    select coalesce(jsonb_agg(private.pos_layaway_reservation_to_jsonb(r) order by r.item_index), '[]'::jsonb)
      from public.pos_layaway_inventory_reservations r
     where r.license_id = p_license_id and r.layaway_id = p_layaway_id
  );
end;
$function$;

create or replace function private.consume_layaway_stock_v1(
  p_license_id uuid,
  p_layaway_id text,
  p_sale_id text,
  p_actor_device_id uuid,
  p_actor_staff_user_id uuid,
  p_actor_key text,
  p_actor_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.pos_layaway_inventory_reservations;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_movement public.pos_inventory_movements;
  v_product_committed numeric;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_operation_key text;
  v_sale_item_id text;
  v_movements jsonb := '[]'::jsonb;
begin
  for v_reservation in
    select *
      from public.pos_layaway_inventory_reservations r
     where r.license_id = p_license_id
       and r.layaway_id = p_layaway_id
       and r.status = 'reserved'
     order by r.product_id, coalesce(r.batch_id, ''), r.item_index
     for update
  loop
    v_operation_key := coalesce(p_idempotency_key, p_sale_id) || ':inventory:' || v_reservation.item_index::text;
    v_sale_item_id := p_sale_id || ':item:' || v_reservation.item_index::text;
    v_product := null;
    v_batch := null;
    if v_reservation.batch_id is not null then
      select * into v_product
        from public.pos_products p
       where p.license_id = p_license_id and p.id = v_reservation.product_id and p.deleted_at is null
       for update;
      select * into v_batch
        from public.pos_product_batches b
       where b.license_id = p_license_id and b.id = v_reservation.batch_id and b.deleted_at is null
       for update;
      if v_batch.id is null or v_product.id is null then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      if coalesce(v_batch.stock, 0) < v_reservation.quantity then
        raise exception 'LAYAWAY_RESERVED_STOCK_UNAVAILABLE:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      v_previous_stock := coalesce(v_product.stock, 0);
      v_previous_batch_stock := coalesce(v_batch.stock, 0);
      update public.pos_product_batches
         set stock = stock - v_reservation.quantity,
             committed_stock = greatest(coalesce(committed_stock, 0) - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.batch_id
       returning * into v_batch;
      v_new_batch_stock := v_batch.stock;
      select coalesce(sum(coalesce(b.stock, 0)) filter (where b.deleted_at is null and b.is_active is true), 0),
             coalesce(sum(coalesce(b.committed_stock, 0)), 0)
        into v_new_stock, v_product_committed
        from public.pos_product_batches b
       where b.license_id = p_license_id and b.product_id = v_reservation.product_id;
      update public.pos_products
         set stock = v_new_stock,
             committed_stock = v_product_committed,
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.product_id
       returning * into v_product;
      v_movement := private.record_pos_inventory_movement(
        p_license_id, v_reservation.product_id, v_reservation.batch_id, p_sale_id, v_sale_item_id,
        'sale_out', v_reservation.quantity, v_previous_stock, v_new_stock,
        v_previous_batch_stock, v_new_batch_stock, v_reservation.unit_cost,
        'Entrega de apartado cloud', 'sale', p_actor_device_id, p_actor_staff_user_id,
        p_actor_key, p_actor_name, v_operation_key,
        jsonb_build_object('phase', 'cloud_layaways_server_contract_r1', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id)
      );
      update public.pos_sale_items
         set inventory_effect_status = 'applied', inventory_movement_id = v_movement.id,
             stock_source = 'batch', stock_before = v_previous_stock, stock_after = v_new_stock,
             batch_stock_before = v_previous_batch_stock, batch_stock_after = v_new_batch_stock
       where license_id = p_license_id and sale_id = p_sale_id and id = v_sale_item_id;
      perform private.record_pos_sync_event(
        p_license_id, 'product_batch', v_reservation.batch_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_consumed', 'layaway_id', p_layaway_id, 'sale_id', p_sale_id, 'movement_id', v_movement.id),
        v_batch.server_version
      );
      perform private.record_pos_sync_event(
        p_license_id, 'product', v_reservation.product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_consumed', 'layaway_id', p_layaway_id, 'sale_id', p_sale_id, 'movement_id', v_movement.id),
        v_product.server_version
      );
    else
      select * into v_product
        from public.pos_products p
       where p.license_id = p_license_id and p.id = v_reservation.product_id and p.deleted_at is null
       for update;
      if v_product.id is null then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      if coalesce(v_product.stock, 0) < v_reservation.quantity then
        raise exception 'LAYAWAY_RESERVED_STOCK_UNAVAILABLE:%', v_reservation.product_id using errcode = 'P0001';
      end if;
      v_previous_stock := coalesce(v_product.stock, 0);
      v_new_stock := v_previous_stock - v_reservation.quantity;
      update public.pos_products
         set stock = v_new_stock,
             committed_stock = greatest(coalesce(committed_stock, 0) - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             updated_by_device_id = p_actor_device_id,
             updated_by_staff_user_id = p_actor_staff_user_id,
             last_idempotency_key = v_operation_key
       where license_id = p_license_id and id = v_reservation.product_id
       returning * into v_product;
      v_new_stock := v_product.stock;
      v_movement := private.record_pos_inventory_movement(
        p_license_id, v_reservation.product_id, null, p_sale_id, v_sale_item_id,
        'sale_out', v_reservation.quantity, v_previous_stock, v_new_stock,
        null, null, v_reservation.unit_cost, 'Entrega de apartado cloud', 'sale',
        p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
        v_operation_key,
        jsonb_build_object('phase', 'cloud_layaways_server_contract_r1', 'layaway_id', p_layaway_id, 'reservation_id', v_reservation.id)
      );
      update public.pos_sale_items
         set inventory_effect_status = 'applied', inventory_movement_id = v_movement.id,
             stock_source = 'product', stock_before = v_previous_stock, stock_after = v_new_stock
       where license_id = p_license_id and sale_id = p_sale_id and id = v_sale_item_id;
      perform private.record_pos_sync_event(
        p_license_id, 'product', v_reservation.product_id, 'update', p_actor_device_id,
        p_actor_staff_user_id, v_operation_key,
        jsonb_build_object('reason', 'layaway_stock_consumed', 'layaway_id', p_layaway_id, 'sale_id', p_sale_id, 'movement_id', v_movement.id),
        v_product.server_version
      );
    end if;

    update public.pos_layaway_inventory_reservations
       set status = 'consumed', consumed_at = now(), server_version = server_version + 1,
           idempotency_key = v_operation_key,
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('consumedByActorKey', p_actor_key, 'sale_id', p_sale_id, 'movement_id', v_movement.id)
     where license_id = p_license_id and id = v_reservation.id;
    v_movements := v_movements || jsonb_build_array(private.pos_inventory_movement_to_jsonb(v_movement));
  end loop;

  return v_movements;
end;
$function$;

revoke all on function private.normalize_layaway_items_v1(jsonb, numeric) from public, anon, authenticated;
revoke all on function private.reserve_layaway_stock_v1(uuid, text, jsonb, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.release_layaway_stock_v1(uuid, text, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.consume_layaway_stock_v1(uuid, text, text, uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function private.execute_layaway_create_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_payload jsonb;
  v_initial_payment jsonb;
  v_items jsonb;
  v_normalized jsonb;
  v_layaway_id text;
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_currency text;
  v_deadline timestamptz;
  v_total numeric;
  v_payment_amount numeric := 0;
  v_payment_id text;
  v_payment_method text;
  v_cash_session_id text;
  v_layaway public.pos_layaways;
  v_session public.pos_cash_sessions;
  v_payment public.pos_layaway_payments;
  v_cash_movement public.pos_cash_movements;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_event public.pos_sync_events;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');

  v_layaway_payload := private.layaway_record_v1(p_request);
  if jsonb_typeof(v_layaway_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  v_layaway_id := private.layaway_request_text_v1(v_layaway_payload, array['id','layaway_id','layawayId']);
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_total := private.layaway_request_numeric_v1(v_layaway_payload, array['total_amount','totalAmount','total']);
  v_normalized := private.normalize_layaway_items_v1(
    coalesce(v_layaway_payload->'items', '[]'::jsonb), v_total
  );
  select coalesce(
    jsonb_agg(
      value || jsonb_build_object(
        'id', coalesce(nullif(btrim(value->>'id'), ''), v_layaway_id || ':item:' || ordinality::text)
      ) order by ordinality
    ),
    '[]'::jsonb
  )
    into v_items
    from jsonb_array_elements(v_normalized->'items') with ordinality;
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item
     where private.layaway_request_numeric_v1(item.value, array['discount_amount','discountAmount'], 0) > 0
  ) then
    perform private.assert_pos_permission(p_context, 'discounts');
  end if;
  v_currency := upper(coalesce(private.layaway_request_text_v1(v_layaway_payload, array['currency']), 'MXN'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'LAYAWAY_CURRENCY_INVALID' using errcode = 'P0001';
  end if;

  begin
    if private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) ~ '^\d{4}-\d{2}-\d{2}$' then
      v_deadline := (private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) || 'T00:00:00+00')::timestamptz;
    else
      v_deadline := private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate'])::timestamptz;
    end if;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_DEADLINE_INVALID' using errcode = 'P0001';
  end;
  if v_deadline is null then
    raise exception 'LAYAWAY_DEADLINE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is not null then
    raise exception 'LAYAWAY_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_initial_payment := private.layaway_payment_payload_v1(p_request);
  v_payment_amount := coalesce(private.layaway_request_numeric_v1(v_initial_payment, array['amount','total'], 0), 0);
  if v_payment_amount < 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_amount > v_total + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001';
  end if;
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_initial_payment, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount > 0 and v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
  if v_payment_amount > 0 then
    v_session := private.layaway_cash_session_v1(
      v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
    );
  end if;

  v_customer_id := private.layaway_request_text_v1(v_layaway_payload, array['customer_id','customerId']);
  v_customer_name := private.layaway_request_text_v1(v_layaway_payload, array['customer_name','customerName']);
  v_customer_phone := private.layaway_request_text_v1(v_layaway_payload, array['customer_phone','customerPhone']);

  insert into public.pos_layaways (
    id, license_id, customer_id, customer_name, customer_phone, total_amount,
    paid_amount, balance_due, currency, deadline, status, items, cash_station_id,
    created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
    created_at, updated_at, server_version, last_idempotency_key, metadata
  ) values (
    v_layaway_id, v_license_id, v_customer_id, v_customer_name, v_customer_phone, round(v_total, 2),
    0, round(v_total, 2), v_currency, v_deadline, 'active', v_items, p_cash_station_id,
    v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
    now(), now(), 1, p_idempotency_key,
    coalesce(v_layaway_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source_mode', 'cloud_committed',
      'cash_station_id', p_cash_station_id
    )
  ) returning * into v_layaway;

  v_reservations := private.reserve_layaway_stock_v1(
    v_license_id, v_layaway_id, v_items, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );

  if v_payment_amount > 0 then
    v_payment_id := coalesce(
      private.layaway_request_text_v1(v_initial_payment, array['id','payment_id','paymentId']),
      v_layaway_id || ':payment:initial'
    );
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name,
      cash_station_id, performed_by_actor_key, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
      v_session.device_id, v_session.staff_user_id, v_session.actor_key,
      'entrada', round(v_payment_amount, 2), 'Abono inicial Apartado ' || v_layaway_id,
      'layaway_payment', 'layaway', v_layaway_id,
      v_device_id, v_staff_user_id, v_actor_name,
      v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
      jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'source', 'layaway_payment',
        'layaway_id', v_layaway_id,
        'payment_id', v_payment_id,
        'payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'),
        'idempotency_key', p_idempotency_key
      )
    ) returning * into v_cash_movement;

    insert into public.pos_layaway_payments (
      id, license_id, layaway_id, payment_method, amount, status,
      cash_session_id, cash_station_id, cash_movement_id, reference,
      request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
      actor_key, actor_name, metadata
    ) values (
      v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
      v_session.id, v_session.cash_station_id, v_cash_movement.id,
      private.layaway_request_text_v1(v_initial_payment, array['reference','ref']),
      p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
      v_actor_key, v_actor_name,
      jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'))
    ) returning * into v_payment;

    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
    update public.pos_layaways
       set paid_amount = round(v_payment_amount, 2),
           balance_due = greatest(round(total_amount - v_payment_amount, 2), 0),
           status = case when v_payment_amount >= total_amount - 0.005 then 'ready' else 'active' end,
           updated_at = now(), server_version = server_version + 1,
           last_idempotency_key = p_idempotency_key
     where license_id = v_license_id and id = v_layaway_id
     returning * into v_layaway;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('status', v_layaway.status, 'total_amount', v_layaway.total_amount,
      'paid_amount', v_layaway.paid_amount, 'cash_station_id', p_cash_station_id,
      'payment_id', case when v_payment.id is null then null else v_payment.id end),
    v_layaway.server_version::integer
  );
  if v_payment.id is not null then
    perform private.record_pos_sync_event(
      v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_payment.cash_movement_id),
      v_payment.server_version::integer
    );
    perform private.record_pos_sync_event(
      v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
      v_cash_movement.server_version
    );
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_to_jsonb(v_layaway),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
    'folio', null,
    'sale', null,
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

revoke all on function private.execute_layaway_create_financial_v1(jsonb, jsonb, text, text, text) from public, anon, authenticated;

create or replace function private.execute_layaway_payment_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_id text := private.layaway_request_id_v1(p_request);
  v_payment_payload jsonb := coalesce(p_request->'payment', '{}'::jsonb);
  v_payment_id text;
  v_payment_amount numeric;
  v_payment_method text;
  v_cash_session_id text := private.layaway_request_cash_session_id_v1(p_request);
  v_layaway public.pos_layaways;
  v_existing_payment public.pos_layaway_payments;
  v_payment public.pos_layaway_payments;
  v_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_payment_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYMENT_INVALID' using errcode = 'P0001';
  end if;

  v_payment_id := private.layaway_request_text_v1(v_payment_payload, array['id','payment_id','paymentId']);
  if v_payment_id is null then
    raise exception 'LAYAWAY_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_payment_amount := private.layaway_request_numeric_v1(v_payment_payload, array['amount','total']);
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_payment_payload, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount is null or v_payment_amount <= 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;

  select * into v_existing_payment
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id and p.id = v_payment_id
   for update;
  if v_existing_payment.id is not null then
    if abs(v_existing_payment.amount - v_payment_amount) > 0.005
       or v_existing_payment.payment_method <> v_payment_method then
      raise exception 'LAYAWAY_PAYMENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'LAYAWAY_PAYMENT_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  if v_payment_amount > v_layaway.balance_due + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_BALANCE' using errcode = 'P0001';
  end if;
  v_session := private.layaway_cash_session_v1(
    v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
  );

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, reference_type, reference_id,
    created_by_device_id, created_by_staff_user_id, actor_name,
    cash_station_id, performed_by_actor_key, idempotency_key, metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
    v_session.device_id, v_session.staff_user_id, v_session.actor_key,
    'entrada', round(v_payment_amount, 2), 'Abono Apartado ' || v_layaway_id,
    'layaway_payment', 'layaway', v_layaway_id,
    v_device_id, v_staff_user_id, v_actor_name,
    v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
    jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source', 'layaway_payment',
      'layaway_id', v_layaway_id,
      'payment_id', v_payment_id,
      'payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'),
      'idempotency_key', p_idempotency_key
    )
  ) returning * into v_cash_movement;

  insert into public.pos_layaway_payments (
    id, license_id, layaway_id, payment_method, amount, status,
    cash_session_id, cash_station_id, cash_movement_id, reference,
    request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
    actor_key, actor_name, metadata
  ) values (
    v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
    v_session.id, v_session.cash_station_id, v_cash_movement.id,
    private.layaway_request_text_v1(v_payment_payload, array['reference','ref']),
    p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name,
    jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'))
  ) returning * into v_payment;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
  update public.pos_layaways
     set paid_amount = round(paid_amount + v_payment_amount, 2),
         balance_due = greatest(round(total_amount - (paid_amount + v_payment_amount), 2), 0),
         status = case when paid_amount + v_payment_amount >= total_amount - 0.005 then 'ready' else status end,
         updated_at = now(), server_version = server_version + 1,
         last_idempotency_key = p_idempotency_key
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', 'layaway_payment_confirmed', 'payment_id', v_payment.id,
      'cash_movement_id', v_cash_movement.id, 'paid_amount', v_layaway.paid_amount,
      'balance_due', v_layaway.balance_due),
    v_layaway.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_cash_movement.id),
    v_payment.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
    v_cash_movement.server_version
  );

  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_to_jsonb(r) order by r.item_index), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id and r.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_to_jsonb(v_layaway),
    'payment', private.pos_layaway_payment_to_jsonb(v_payment),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'cash_movement', private.pos_cash_movement_to_jsonb(v_cash_movement),
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'folio', null,
    'sale', null,
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

revoke all on function private.execute_layaway_payment_financial_v1(jsonb, jsonb, text, text, text) from public, anon, authenticated;

create or replace function private.execute_layaway_cancel_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_id text := private.layaway_request_id_v1(p_request);
  v_cash_session_id text := private.layaway_request_cash_session_id_v1(p_request);
  v_retain_money boolean := private.layaway_request_bool_v1(p_request, array['retain_money','retainMoney','retained_money']);
  v_refund_id text;
  v_layaway public.pos_layaways;
  v_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_reservations jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
  v_reason text := private.layaway_request_text_v1(p_request, array['reason','motivo'], 'Cancelación de apartado');
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;

  if not v_retain_money and v_layaway.paid_amount > 0 then
    v_session := private.layaway_cash_session_v1(
      v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
    );
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
    if coalesce(v_session.expected_cash_total, 0) + 0.005 < v_layaway.paid_amount then
      raise exception 'CASH_INSUFFICIENT_FOR_LAYAWAY_REFUND' using errcode = 'P0001';
    end if;
    v_refund_id := coalesce(
      private.layaway_request_text_v1(p_request, array['refund_id','refundId']),
      v_layaway_id || ':refund'
    );
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name,
      cash_station_id, performed_by_actor_key, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
      v_session.device_id, v_session.staff_user_id, v_session.actor_key,
      'salida', round(v_layaway.paid_amount, 2), 'Reembolso Apartado ' || v_layaway_id,
      'layaway_refund', 'layaway', v_layaway_id,
      v_device_id, v_staff_user_id, v_actor_name,
      v_session.cash_station_id, v_actor_key, p_idempotency_key || ':refund_cash',
      jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'source', 'layaway_refund',
        'layaway_id', v_layaway_id,
        'refund_id', v_refund_id,
        'refund_amount', round(v_layaway.paid_amount, 2),
        'idempotency_key', p_idempotency_key
      )
    ) returning * into v_cash_movement;
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
    update public.pos_layaway_payments
       set status = 'refunded', refunded_at = now(), server_version = server_version + 1,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('refund_id', v_refund_id)
     where license_id = v_license_id and layaway_id = v_layaway_id and status = 'confirmed';
  else
    v_refund_id := private.layaway_request_text_v1(p_request, array['refund_id','refundId']);
  end if;

  v_reservations := private.release_layaway_stock_v1(
    v_license_id, v_layaway_id, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );
  update public.pos_layaways
     set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         server_version = server_version + 1, last_idempotency_key = p_idempotency_key,
         retained_money = v_retain_money,
         retained_amount = case when v_retain_money then paid_amount else 0 end,
         refund_id = case when v_retain_money then null else v_refund_id end,
         refund_cash_movement_id = case when v_cash_movement.id is null then null else v_cash_movement.id end,
         notes = v_reason || case when v_retain_money then ' - Fondos retenidos' else ' - Fondos reembolsados' end,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'cancel_reason', v_reason,
           'refund_id', v_refund_id,
           'refund_amount', case when v_retain_money then 0 else paid_amount end,
           'retained_money', v_retain_money
         )
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'cancel', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', v_reason, 'retain_money', v_retain_money,
      'refund_id', v_refund_id, 'cash_movement_id', case when v_cash_movement.id is null then null else v_cash_movement.id end),
    v_layaway.server_version::integer
  );
  if v_cash_movement.id is not null then
    perform private.record_pos_sync_event(
      v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'refund_id', v_refund_id),
      v_cash_movement.server_version
    );
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_to_jsonb(v_layaway),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
    'folio', null,
    'sale', null,
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

revoke all on function private.execute_layaway_cancel_financial_v1(jsonb, jsonb, text, text, text) from public, anon, authenticated;

create or replace function private.execute_layaway_completion_financial_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_request jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_layaway_id text;
  v_sale_id text;
  v_local_sale_id text;
  v_sale_payload jsonb;
  v_request_items jsonb;
  v_request_payments jsonb;
  v_server_items jsonb;
  v_request_normalized jsonb;
  v_layaway public.pos_layaways;
  v_existing public.pos_sales;
  v_sale public.pos_sales;
  v_sale_payment public.pos_sale_payments;
  v_item jsonb;
  v_payment jsonb;
  v_item_id text;
  v_payment_id text;
  v_item_index integer := 0;
  v_item_count integer;
  v_total numeric;
  v_paid_total numeric;
  v_requested_total numeric;
  v_unit_price numeric;
  v_quantity numeric;
  v_line_total numeric;
  v_line_subtotal numeric;
  v_unit_cost numeric;
  v_discount numeric;
  v_tax numeric;
  v_subtotal numeric;
  v_discount_total numeric;
  v_folio jsonb;
  v_cloud_folio text;
  v_pos_folio text;
  v_folio_sequence bigint;
  v_sold_at timestamptz;
  v_created_at timestamptz;
  v_event public.pos_sync_events;
  v_inventory_movements jsonb := '[]'::jsonb;
  v_sale_items jsonb := '[]'::jsonb;
  v_sale_payments jsonb := '[]'::jsonb;
  v_layaway_payments jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_layaway_id := private.layaway_request_text_v1(p_request, array['layaway_id','layawayId']);
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_license_id::text), hashtext('layaway_completion:' || v_layaway_id));

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_sale_payload := coalesce(p_request->'sale', '{}'::jsonb);
  if jsonb_typeof(v_sale_payload) <> 'object' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_sale_id := private.layaway_request_text_v1(v_sale_payload, array['id','cloud_sale_id','cloudSaleId']);
  v_local_sale_id := coalesce(
    private.layaway_request_text_v1(v_sale_payload, array['local_sale_id','localSaleId']), v_sale_id
  );
  if v_sale_id is null or v_local_sale_id is null then
    raise exception 'LAYAWAY_SALE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
    from public.pos_sales s
   where s.license_id = v_license_id
     and s.layaway_id = v_layaway_id
     and s.deleted_at is null
   limit 1
   for update;
  if v_existing.id is not null then
    if v_existing.id is distinct from v_sale_id then
      raise exception 'LAYAWAY_ALREADY_CONVERTED_CLOUD' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
      into v_sale_items
      from public.pos_sale_items i
     where i.license_id = v_license_id and i.sale_id = v_existing.id;
    select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
      into v_sale_payments
      from public.pos_sale_payments p
     where p.license_id = v_license_id and p.sale_id = v_existing.id;
    select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
      into v_layaway_payments
      from public.pos_layaway_payments p
     where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
      into v_cash_movements
      from public.pos_cash_movements m
     where m.license_id = v_license_id
       and m.reference_type = 'layaway'
       and m.reference_id = v_layaway_id;
    select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
      into v_inventory_movements
      from public.pos_inventory_movements m
     where m.license_id = v_license_id and m.sale_id = v_existing.id;
    select coalesce(max(change_seq), 0) into v_latest_change_seq
      from public.pos_sync_events where license_id = v_license_id;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'mode', 'cloud_layaway_completion',
      'layaway', private.pos_layaway_to_jsonb(v_layaway),
      'sale', private.pos_sale_to_jsonb(v_existing),
      'items', v_sale_items,
      'payments', v_sale_payments,
      'layaway_payments', v_layaway_payments,
      'cash_movements', v_cash_movements,
      'cash_movement', null,
      'inventory_movements', v_inventory_movements,
      'folio', v_existing.pos_folio,
      'cash_session', null,
      'event', null,
      'change_seq', v_latest_change_seq,
      'latest_change_seq', v_latest_change_seq,
      'idempotency_key', p_idempotency_key
    );
  end if;

  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_COMPLETED_WITHOUT_SALE' using errcode = 'P0001';
  end if;
  v_total := round(v_layaway.total_amount, 2);
  select coalesce(sum(p.amount), 0)
    into v_paid_total
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id and p.status = 'confirmed';
  if abs(v_paid_total - v_total) > 0.005 or abs(v_layaway.paid_amount - v_total) > 0.005 then
    raise exception 'LAYAWAY_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  v_request_items := coalesce(p_request->'items', '[]'::jsonb);
  v_request_payments := coalesce(p_request->'payments', '[]'::jsonb);
  if jsonb_typeof(v_request_items) <> 'array' or jsonb_typeof(v_request_payments) <> 'array' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_request_payments) <> 1 then
    raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
  end if;
  v_requested_total := private.layaway_request_numeric_v1(v_sale_payload, array['total']);
  if v_requested_total is not null and abs(v_requested_total - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_request_items) <> jsonb_array_length(v_layaway.items) then
    raise exception 'LAYAWAY_ITEMS_MISMATCH' using errcode = 'P0001';
  end if;
  v_request_normalized := private.normalize_layaway_items_v1(v_request_items, v_total);
  if (
    select coalesce(jsonb_agg(private.canonical_layaway_item_v1(value) order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_request_normalized->'items') with ordinality
  ) is distinct from (
    select coalesce(jsonb_agg(private.canonical_layaway_item_v1(value) order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_layaway.items) with ordinality
  ) then
    raise exception 'LAYAWAY_ITEMS_MISMATCH' using errcode = 'P0001';
  end if;
  for v_payment in select value from jsonb_array_elements(v_request_payments) loop
    if lower(coalesce(private.layaway_request_text_v1(v_payment, array['method','payment_method','paymentMethod']), '')) <> 'layaway_completed'
       or abs(coalesce(private.layaway_request_numeric_v1(v_payment, array['amount','total']), 0) - v_total) > 0.005 then
      raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
    end if;
  end loop;

  v_server_items := v_layaway.items;
  v_item_count := jsonb_array_length(v_server_items);
  if v_item_count <= 0 then
    raise exception 'LAYAWAY_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  -- Recompute the financial breakdown from the server snapshot.  The client
  -- may replay the same layaway, but it never gets to choose the sale totals
  -- recorded at delivery.
  v_subtotal := 0;
  v_discount_total := 0;
  for v_item in select value from jsonb_array_elements(v_server_items) loop
    v_quantity := private.layaway_request_numeric_v1(v_item, array['quantity','qty']);
    v_unit_price := private.layaway_request_numeric_v1(v_item, array['unit_price','unitPrice','price']);
    if v_quantity is null or v_quantity <= 0 or v_unit_price is null or v_unit_price < 0 then
      raise exception 'LAYAWAY_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_line_subtotal := round(v_quantity * v_unit_price, 2);
    v_discount := greatest(coalesce(private.layaway_request_numeric_v1(
      v_item, array['discount_amount','discountAmount'], 0
    ), 0), 0);
    v_tax := greatest(coalesce(private.layaway_request_numeric_v1(
      v_item, array['tax_amount','taxAmount'], 0
    ), 0), 0);
    if v_discount > v_line_subtotal + 0.005 then
      raise exception 'DISCOUNT_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    if v_tax > 0.005 then
      raise exception 'LAYAWAY_TAX_SOURCE_UNRESOLVED' using errcode = 'P0001';
    end if;
    v_line_total := round(v_line_subtotal - v_discount, 2);
    if private.layaway_request_numeric_v1(v_item, array['line_subtotal','lineSubtotal'], null) is not null
       and abs(private.layaway_request_numeric_v1(v_item, array['line_subtotal','lineSubtotal'], null) - v_line_subtotal) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    if private.layaway_request_numeric_v1(v_item, array['line_total','lineTotal','total','exactTotal'], null) is not null
       and abs(private.layaway_request_numeric_v1(v_item, array['line_total','lineTotal','total','exactTotal'], null) - v_line_total) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount_total := v_discount_total + v_discount;
  end loop;
  if abs(round(v_subtotal - v_discount_total, 2) - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  begin
    v_sold_at := coalesce(
      nullif(private.layaway_request_text_v1(v_sale_payload, array['sold_at','soldAt','timestamp']), '')::timestamptz,
      now()
    );
    v_created_at := coalesce(
      nullif(private.layaway_request_text_v1(v_sale_payload, array['created_at','createdAt','timestamp']), '')::timestamptz,
      v_sold_at
    );
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_TIMESTAMP_INVALID' using errcode = 'P0001';
  end;

  v_folio := private.next_pos_sale_folio(v_license_id);
  v_cloud_folio := v_folio->>'folio';
  v_pos_folio := v_folio->>'pos_folio';
  v_folio_sequence := (v_folio->>'sequence')::bigint;

  insert into public.pos_sales (
    id, license_id, local_sale_id, device_id, staff_user_id, device_role, actor_key, actor_name,
    origin, source_mode, effects_status, status, fulfillment_status,
    payment_method, payment_status, folio, local_folio, cloud_folio, pos_folio, folio_sequence,
    sale_number, customer_id, customer_name, customer_phone,
    subtotal, discount_total, tax_total, total, amount_paid, change_amount, balance_due, currency,
    sold_at, created_at, updated_at, committed_at,
    cash_session_id, cash_movement_id, customer_ledger_id,
    cash_effect_status, inventory_effect_status, credit_effect_status,
    local_payload, metadata, idempotency_key, server_version, layaway_id
  ) values (
    v_sale_id, v_license_id, v_local_sale_id, v_device_id, v_staff_user_id,
    coalesce(v_context->>'device_role', 'staff'), v_actor_key, v_actor_name,
    'cloud', 'cloud_committed', 'payment_recorded', 'closed', 'fulfilled',
    'layaway_completed', 'paid', v_cloud_folio,
    private.layaway_request_text_v1(v_sale_payload, array['local_folio','localFolio','folio']),
    v_cloud_folio, v_pos_folio, v_folio_sequence, v_folio_sequence,
    v_layaway.customer_id, v_layaway.customer_name, v_layaway.customer_phone,
    round(v_subtotal, 2), round(v_discount_total, 2), 0, v_total, v_total, 0, 0, v_layaway.currency,
    v_sold_at, v_created_at, now(), now(), null, null, null,
    'not_required', 'not_applied', 'not_applied',
    v_sale_payload,
    coalesce(v_sale_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'layaway_id', v_layaway_id,
      'source_mode', 'cloud_committed',
      'no_cloud_cash_effects', true,
      'payment_verified_from_layaway_payments', true
    ),
    p_idempotency_key, 1, v_layaway_id
  ) returning * into v_sale;

  for v_item in select value from jsonb_array_elements(v_server_items) loop
    v_item_index := v_item_index + 1;
    v_item_id := v_sale.id || ':item:' || v_item_index::text;
    v_quantity := private.layaway_request_numeric_v1(v_item, array['quantity','qty']);
    v_unit_price := private.layaway_request_numeric_v1(v_item, array['unit_price','unitPrice','price']);
    v_line_subtotal := round(v_quantity * v_unit_price, 2);
    v_discount := greatest(coalesce(private.layaway_request_numeric_v1(v_item, array['discount_amount','discountAmount'], 0), 0), 0);
    v_tax := greatest(coalesce(private.layaway_request_numeric_v1(v_item, array['tax_amount','taxAmount'], 0), 0), 0);
    v_line_total := round(v_line_subtotal - v_discount, 2);
    v_unit_cost := coalesce(
      (select r.unit_cost from public.pos_layaway_inventory_reservations r
        where r.license_id = v_license_id and r.layaway_id = v_layaway_id and r.item_index = v_item_index
        limit 1),
      null
    );
    if v_unit_cost is null then
      select greatest(coalesce(
        case when private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is not null
          then b.cost else p.cost end,
        0
      ), 0)
        into v_unit_cost
        from public.pos_products p
        left join public.pos_product_batches b
          on b.license_id = p.license_id
         and b.product_id = p.id
         and b.id = private.layaway_request_text_v1(v_item, array['batch_id','batchId'])
         and b.deleted_at is null
       where p.license_id = v_license_id
         and p.id = private.layaway_request_text_v1(v_item, array['product_id','productId','parentId'])
         and p.deleted_at is null;
      if not found then
        raise exception 'LAYAWAY_PRODUCT_NOT_SYNCED:%', private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']) using errcode = 'P0001';
      end if;
      if private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is not null
         and not exists (
           select 1
             from public.pos_product_batches b
            where b.license_id = v_license_id
              and b.product_id = private.layaway_request_text_v1(v_item, array['product_id','productId','parentId'])
              and b.id = private.layaway_request_text_v1(v_item, array['batch_id','batchId'])
              and b.deleted_at is null
         ) then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', private.layaway_request_text_v1(v_item, array['batch_id','batchId']) using errcode = 'P0001';
      end if;
    end if;
    if v_unit_cost is null then
      raise exception 'LAYAWAY_PRODUCT_NOT_SYNCED:%', private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']) using errcode = 'P0001';
    end if;
    insert into public.pos_sale_items (
      id, license_id, sale_id, product_id, product_name, product_sku, barcode,
      category_id, category_name, quantity, unit_price, unit_cost, discount_amount,
      tax_amount, line_total, batch_id, batch_sku, batch_expiry_date, rubro,
      inventory_effect_status, stock_source, metadata, server_version
    ) values (
      v_item_id, v_license_id, v_sale.id,
      private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']),
      coalesce(private.layaway_request_text_v1(v_item, array['product_name','productName','name']), 'Producto'),
      private.layaway_request_text_v1(v_item, array['product_sku','productSku','sku']),
      private.layaway_request_text_v1(v_item, array['barcode','barCode']),
      private.layaway_request_text_v1(v_item, array['category_id','categoryId']),
      private.layaway_request_text_v1(v_item, array['category_name','categoryName','rubro','category']),
      v_quantity, v_unit_price, greatest(v_unit_cost, 0), v_discount, v_tax, v_line_total,
      private.layaway_request_text_v1(v_item, array['batch_id','batchId']),
      private.layaway_request_text_v1(v_item, array['batch_sku','batchSku']),
      nullif(private.layaway_request_text_v1(v_item, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.layaway_request_text_v1(v_item, array['rubro','category','categoryName']),
      'not_applied', case when private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is null then 'product' else 'batch' end,
      coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'layaway_id', v_layaway_id,
        'snapshot_only', true
      ),
      1
    );
  end loop;

  v_payment_id := v_sale.id || ':payment:completion';
  insert into public.pos_sale_payments (
    id, license_id, sale_id, method, amount, received_amount, change_amount,
    reference, cash_session_id, cash_movement_id, customer_ledger_id, metadata, server_version
  ) values (
    v_payment_id, v_license_id, v_sale.id, 'layaway_completed', v_total, v_total, 0,
    null, null, null, null,
    jsonb_build_object('phase', 'cloud_layaways_server_contract_r1', 'layaway_id', v_layaway_id,
      'cashAlreadyRecorded', true, 'noAdditionalCashMovement', true), 1
  ) returning * into v_sale_payment;

  v_inventory_movements := private.consume_layaway_stock_v1(
    v_license_id, v_layaway_id, v_sale.id, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );
  update public.pos_sales
     set inventory_effect_status = case when jsonb_array_length(v_inventory_movements) > 0 then 'applied' else 'not_required' end,
         effects_status = case when jsonb_array_length(v_inventory_movements) > 0 then 'inventory_applied' else 'payment_recorded' end,
         updated_at = now(), server_version = server_version + 1
   where license_id = v_license_id and id = v_sale.id
   returning * into v_sale;
  update public.pos_layaways
     set status = 'completed', conversion_sale_id = v_sale.id, completed_at = now(),
         updated_at = now(), server_version = server_version + 1,
         last_idempotency_key = p_idempotency_key,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'completedSaleId', v_sale.id, 'completedByActorKey', v_actor_key,
           'folio', v_pos_folio, 'inventory_effect_status', v_sale.inventory_effect_status
         )
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'sale', v_sale.id, 'cloud_commit', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('sale_id', v_sale.id, 'layaway_id', v_layaway_id,
      'folio', v_pos_folio, 'cash_effect_status', 'not_required',
      'inventory_effect_status', v_sale.inventory_effect_status),
    v_sale.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('status', 'completed', 'sale_id', v_sale.id, 'folio', v_pos_folio),
    v_layaway.server_version::integer
  );
  perform private.record_pos_sale_audit_event(
    v_license_id, v_sale.id, 'sale.layaway_completed', v_device_id, v_staff_user_id,
    v_actor_name,
    jsonb_build_object('sale_id', v_sale.id, 'layaway_id', v_layaway_id,
      'folio', v_pos_folio, 'paid_total', v_paid_total,
      'cash_effect_status', 'not_required', 'inventory_effect_status', v_sale.inventory_effect_status,
      'idempotency_key', p_idempotency_key)
  );

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
    into v_sale_items from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_sale_payments from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_layaway_payments from public.pos_layaway_payments p where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway_completion',
    'layaway', private.pos_layaway_to_jsonb(v_layaway),
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_sale_items,
    'payments', v_sale_payments,
    'layaway_payments', v_layaway_payments,
    'cash_movements', v_cash_movements,
    'cash_movement', null,
    'cash_session', null,
    'inventory_movements', v_inventory_movements,
    'folio', v_pos_folio,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

revoke all on function private.execute_layaway_completion_financial_v1(text, text, text, text, jsonb, text) from public, anon, authenticated;

create or replace function public.pos_get_layaway(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_layaway_id text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_layaway public.pos_layaways;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_inventory_movements jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  if nullif(btrim(coalesce(p_layaway_id, '')), '') is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = p_layaway_id and l.deleted_at is null;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_to_jsonb(r) order by r.item_index), '[]'::jsonb)
    into v_reservations from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id and r.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_inventory_movements from public.pos_inventory_movements m
   where m.license_id = v_license_id and m.metadata->>'layaway_id' = v_layaway.id;

  return jsonb_build_object(
    'success', true,
    'layaway', private.pos_layaway_to_jsonb(v_layaway),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'inventory_movements', v_inventory_movements,
    'mode', 'cloud_layaway_read'
  );
end;
$function$;

revoke all on function public.pos_get_layaway(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pos_get_layaway(text, text, text, text, text) to anon, authenticated;

create or replace function public.pos_pull_layaway_changes(
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
stable
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_layaways jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_inventory_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;

  with changed_layaways as (
    select l.id
      from public.pos_layaways l
     where l.license_id = v_license_id
       and l.deleted_at is null
       and exists (
         select 1 from public.pos_sync_events e
          where e.license_id = v_license_id
            and e.change_seq > v_since
            and (
              (e.entity_type = 'layaway' and e.entity_id = l.id)
              or (e.entity_type = 'layaway_payment' and exists (
                select 1 from public.pos_layaway_payments lp
                 where lp.license_id = v_license_id and lp.id = e.entity_id and lp.layaway_id = l.id
              ))
              or (e.entity_type = 'layaway_inventory_reservation' and exists (
                select 1 from public.pos_layaway_inventory_reservations lr
                 where lr.license_id = v_license_id and lr.id = e.entity_id and lr.layaway_id = l.id
              ))
              or (e.entity_type in ('cash_movement','product','product_batch') and e.metadata->>'layaway_id' = l.id)
            )
       )
     order by l.updated_at asc, l.id
     limit v_limit
  )
  select coalesce(jsonb_agg(private.pos_layaway_to_jsonb(l) order by l.updated_at asc, l.id), '[]'::jsonb)
    into v_layaways
    from public.pos_layaways l
   where l.license_id = v_license_id
     and l.id in (select id from changed_layaways);

  select coalesce(jsonb_agg(private.pos_layaway_payment_to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments from public.pos_layaway_payments p
   where p.license_id = v_license_id
     and p.layaway_id in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(jsonb_agg(private.pos_layaway_reservation_to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
    into v_reservations from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id
     and r.layaway_id in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.reference_type = 'layaway'
     and m.reference_id in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_inventory_movements from public.pos_inventory_movements m
   where m.license_id = v_license_id
     and m.metadata->>'layaway_id' in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'layaways', v_layaways,
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'inventory_movements', v_inventory_movements,
    'since_change_seq', v_since,
    'latest_change_seq', v_latest_change_seq,
    'has_more', jsonb_array_length(v_layaways) >= v_limit,
    'mode', 'cloud_layaway_changes'
  );
end;
$function$;

revoke all on function public.pos_pull_layaway_changes(text, text, text, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.pos_pull_layaway_changes(text, text, text, text, bigint, integer) to anon, authenticated;

revoke all on public.pos_layaways from public, anon, authenticated;
revoke all on public.pos_layaway_payments from public, anon, authenticated;
revoke all on public.pos_layaway_inventory_reservations from public, anon, authenticated;

-- V1 dispatcher extension. Existing cash/sale branches retain their public
-- contract; layaway operations enter the same durable receipt boundary after
-- capability, station, session, and actor validation.
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
set search_path to ''
set statement_timeout = '45s'
set lock_timeout = '20s'
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_canonical jsonb;
  v_execution jsonb;
  v_cash_station_id text;
  v_cash_session_id text;
  v_session_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
  v_requires_cash boolean := false;
  v_layaway_id text;
  v_payment_payload jsonb;
  v_rate_limit jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key, p_device_fingerprint, p_staff_session_token,
      'pos_execute_financial_operation_v1.layaway', 'POS_WRITE',
      120, 600, 300, 'RPC_RATE_LIMITED',
      jsonb_build_object('operation_type', p_operation_type)
    );
    if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
      return public.build_pos_rpc_rate_limited_response(v_rate_limit);
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    perform private.assert_cloud_layaways_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'pos');
  end if;

  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
     for update;
    if not found then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_session_station_id is null then
      raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_session_station_id is distinct from v_cash_station_id then
      raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
    if p_operation_type = 'layaway.payment' then
      v_requires_cash := true;
    elsif p_operation_type = 'layaway.create' then
      v_payment_payload := private.layaway_payment_payload_v1(p_request);
      v_requires_cash := coalesce(private.layaway_request_numeric_v1(v_payment_payload, array['amount', 'total'], 0), 0) > 0;
    else
      v_layaway_id := private.layaway_request_id_v1(p_request);
      v_requires_cash := not private.layaway_request_bool_v1(p_request, array['retain_money', 'retainMoney', 'retained_money'])
        and exists (
          select 1 from public.pos_layaways l
           where l.license_id = v_license_id and l.id = v_layaway_id and l.paid_amount > 0
        );
    end if;

    if v_requires_cash and v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_cash_session_id is not null then
      select s.cash_station_id into v_session_station_id
        from public.pos_cash_sessions s
       where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
       for update;
      if not found then
        raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
      end if;
      if v_session_station_id is null then
        raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
      end if;
      if v_session_station_id is distinct from v_cash_station_id then
        raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
      end if;
      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
        raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
      end if;
      if (select actor_key from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) is distinct from v_actor_key then
        raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation_type in ('cash.open', 'sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_canonical := private.canonical_layaway_request_v1(p_operation_type, p_request);
    v_execution := private.layaway_execution_request_v1(p_request);
  else
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);
  end if;

  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );
  if v_operation.status = 'completed' then
    return v_operation.response_payload;
  end if;
  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric,
        v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source', 'reference_type', v_execution->>'reference_type',
          'reference_id', v_execution->>'reference_id'
        ))
      );
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric,
        v_execution->>'reason', (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.close' then
      v_response := public.pos_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode',
        (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments',
        (v_execution->>'expected_version')::integer, v_internal_idempotency_key
      );
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key
      );
    when 'sale.split' then
      v_response := private.execute_split_sale_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'sale.layaway_complete' then
      v_response := private.execute_layaway_completion_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, p_idempotency_key
      );
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key
      );
    when 'layaway.create' then
      v_response := private.execute_layaway_create_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.payment' then
      v_response := private.execute_layaway_payment_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.cancel' then
      v_response := private.execute_layaway_cancel_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;

  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

revoke all on function private.layaway_request_text_v1(jsonb, text[], text) from public, anon, authenticated;
revoke all on function private.layaway_request_numeric_v1(jsonb, text[], numeric) from public, anon, authenticated;
revoke all on function private.layaway_request_bool_v1(jsonb, text[], boolean) from public, anon, authenticated;
revoke all on function private.layaway_request_cash_session_id_v1(jsonb) from public, anon, authenticated;
revoke all on function private.layaway_request_id_v1(jsonb) from public, anon, authenticated;
revoke all on function private.layaway_payment_payload_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_layaway_item_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_layaway_payment_v1(jsonb) from public, anon, authenticated;
revoke all on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_execute_financial_operation_v1(text, text, text, text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
