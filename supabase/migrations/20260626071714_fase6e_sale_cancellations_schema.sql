-- FASE 6E: Cancelaciones/devoluciones cloud PRO - esquema base

-- 1) Feature flag cloud_sales_cancellations por plan/licencia.
update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'cloud_sales_cancellations', case when code = 'pro_monthly' then true else false end
)
where code in ('pro_monthly', 'free_trial', 'basic_monthly');

update public.licenses l
set features = coalesce(l.features, '{}'::jsonb) || jsonb_build_object(
  'cloud_sales_cancellations', case
    when coalesce(p.code, l.license_type::text) = 'pro_monthly' then true
    else false
  end
)
from public.plans p
where l.plan_id = p.id
  and coalesce(p.code, l.license_type::text) in ('pro_monthly', 'free_trial', 'basic_monthly');

update public.licenses l
set features = coalesce(l.features, '{}'::jsonb) || jsonb_build_object(
  'cloud_sales_cancellations', case when l.license_type::text = 'pro_monthly' then true else false end
)
where l.plan_id is null
  and l.license_type::text in ('pro_monthly', 'free_trial', 'basic_monthly');

-- 2) Columnas de cancelación/reversa en ventas e items.
alter table public.pos_sales
  add column if not exists cancelled_by_device_id uuid null,
  add column if not exists cancelled_by_staff_user_id uuid null,
  add column if not exists cancellation_id text null,
  add column if not exists cancellation_status text null,
  add column if not exists reversal_status text null,
  add column if not exists cash_reversal_status text null default 'not_required',
  add column if not exists inventory_reversal_status text null default 'not_required',
  add column if not exists credit_reversal_status text null default 'not_required';

alter table public.pos_sale_items
  add column if not exists inventory_reversal_status text null default 'not_required';

alter table public.pos_sale_payments
  add column if not exists reversal_status text null default 'not_required';

-- FKs opcionales para auditoría de actor.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_sales_cancelled_by_device_id_fkey') then
    alter table public.pos_sales
      add constraint pos_sales_cancelled_by_device_id_fkey
      foreign key (cancelled_by_device_id) references public.license_devices(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pos_sales_cancelled_by_staff_user_id_fkey') then
    alter table public.pos_sales
      add constraint pos_sales_cancelled_by_staff_user_id_fkey
      foreign key (cancelled_by_staff_user_id) references public.license_staff_users(id) on delete set null;
  end if;
end $$;

-- 3) Tabla de auditoría de cancelaciones.
create table if not exists public.pos_sale_cancellations (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sale_id text not null references public.pos_sales(id) on delete cascade,
  sale_folio text null,
  reason text not null,
  status text not null default 'completed',
  cash_reversal_status text not null default 'not_required',
  inventory_reversal_status text not null default 'not_required',
  credit_reversal_status text not null default 'not_required',
  original_total numeric not null default 0,
  cash_reversal_amount numeric not null default 0,
  inventory_reversal_quantity numeric not null default 0,
  credit_reversal_amount numeric not null default 0,
  actor_device_id uuid null references public.license_devices(id) on delete set null,
  actor_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  actor_key text null,
  actor_name text null,
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  server_version bigint not null default 1
);

alter table public.pos_sale_cancellations enable row level security;

create index if not exists idx_pos_sale_cancellations_license_sale
  on public.pos_sale_cancellations (license_id, sale_id);

create index if not exists idx_pos_sale_cancellations_license_created
  on public.pos_sale_cancellations (license_id, created_at desc);

create index if not exists idx_pos_sale_cancellations_license_staff_created
  on public.pos_sale_cancellations (license_id, actor_staff_user_id, created_at desc);

create unique index if not exists ux_pos_sale_cancellations_license_idem
  on public.pos_sale_cancellations (license_id, idempotency_key)
  where idempotency_key is not null;

-- 4) Ajustar checks para movimientos compensatorios sin borrar historial.
alter table public.pos_cash_movements drop constraint if exists pos_cash_movements_type_check;
alter table public.pos_cash_movements add constraint pos_cash_movements_type_check
  check (type = any (array[
    'entrada'::text,
    'salida'::text,
    'ajuste_entrada'::text,
    'ajuste_salida'::text,
    'fondo_inicial_ajuste'::text,
    'venta'::text,
    'venta_efectivo'::text,
    'abono_cliente'::text,
    'cancelacion'::text,
    'cancelacion_venta'::text,
    'cancelacion_abono_inicial'::text
  ]));

alter table public.pos_inventory_movements drop constraint if exists pos_inventory_movements_source_check;
alter table public.pos_inventory_movements add constraint pos_inventory_movements_source_check
  check (source = any (array[
    'sale'::text,
    'sale_cancellation'::text,
    'adjustment'::text,
    'migration'::text,
    'manual'::text
  ]));

alter table public.pos_customer_ledger drop constraint if exists pos_customer_ledger_type_chk;
alter table public.pos_customer_ledger add constraint pos_customer_ledger_type_chk
  check (type = any (array[
    'INITIAL_BALANCE'::text,
    'CHARGE'::text,
    'PAYMENT'::text,
    'ADJUSTMENT'::text,
    'CANCEL_CHARGE'::text,
    'CANCEL_PAYMENT'::text,
    'MIGRATION'::text
  ]));

alter table public.pos_sync_events drop constraint if exists pos_sync_events_operation_check;
alter table public.pos_sync_events add constraint pos_sync_events_operation_check
  check (operation = any (array[
    'create'::text,
    'update'::text,
    'delete'::text,
    'restore'::text,
    'upsert'::text,
    'upsert_shadow'::text,
    'cloud_commit'::text,
    'cancel'::text,
    'toggle_status'::text,
    'sync_checkpoint'::text,
    'open'::text,
    'close'::text,
    'movement'::text,
    'adjust'::text,
    'unknown'::text
  ]));

-- 5) Índices de consulta para reversas.
create index if not exists idx_pos_sales_license_cancellation_id
  on public.pos_sales (license_id, cancellation_id)
  where cancellation_id is not null;

create index if not exists idx_pos_sale_items_license_sale_inventory_reversal
  on public.pos_sale_items (license_id, sale_id, inventory_reversal_status);

-- 6) Helper privado de feature flag.
create or replace function private.assert_cloud_sales_cancellations_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  perform private.assert_cloud_sales_cashier_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_cancellations')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_CANCELLATIONS_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;;
