-- Disposable PR #352 dispatcher fixture overlay.
-- Load after restaurant_origin_cancel_3d13_setup.sql and before either candidate
-- migration. It provides the columns queried by the 3D.14 guards without
-- changing any migration to fit the older 3D.13 fixture schema.

drop table public.pos_sales;
create table public.pos_sales (
  id text not null,
  local_order_id text,
  total numeric,
  license_id uuid not null,
  local_sale_id text not null,
  device_id uuid not null,
  actor_key text not null,
  cash_session_id text,
  idempotency_key text not null,
  primary key (license_id, id),
  unique (license_id, idempotency_key)
);

alter table public.pos_financial_operations
  add column license_id uuid not null,
  add column operation_type text not null,
  add column canonical_request jsonb not null,
  add column verified_actor_key text not null,
  add column verified_device_id uuid not null,
  add column verified_cash_session_id text,
  add column request_hash text;

create unique index pr352_financial_operations_key
  on public.pos_financial_operations (license_id, legacy_idempotency_key);

create unique index pr352_cash_movement_id on public.pos_cash_movements (id);
create unique index pr352_sale_payment_id on public.pos_sale_payments (id);
create unique index pr352_customer_ledger_id on public.pos_customer_ledger (id);

create table public.pos_inventory_movements (
  id text primary key,
  sale_id text not null,
  product_id text,
  quantity numeric not null default 0
);

create table private.pr352_split_execution_observations (
  operation_key text primary key,
  parent_order_id text not null
);

-- The 3D.13 base fixture's financial canonicalizer is an identity stub. Keep a
-- narrow adapter for the split parent aliases needed by this dispatcher test;
-- it is deliberately not presented as the production K/H canonicalizer.
create or replace function private.canonical_financial_request_v1(p_operation_type text,p_request jsonb)
returns jsonb language plpgsql immutable as $fixture$
begin
  if p_operation_type='sale.split' then
    return p_request || jsonb_strip_nulls(jsonb_build_object(
      'parent_order_id',coalesce(nullif(btrim(p_request->>'parent_order_id'),''),nullif(btrim(p_request->>'parentOrderId'),'')),
      'parent_order_version',coalesce(nullif(btrim(p_request->>'parent_order_version'),''),nullif(btrim(p_request->>'parentOrderVersion'),''))
    ));
  end if;
  return p_request;
end
$fixture$;
