-- FASE 6D — columnas, feature flag y helpers seguros

alter table public.pos_sales
  add column if not exists credit_ledger_charge_id text null,
  add column if not exists credit_ledger_payment_id text null,
  add column if not exists credit_customer_debt_before numeric null,
  add column if not exists credit_customer_debt_after numeric null;

alter table public.pos_customer_ledger
  add column if not exists sale_folio text null,
  add column if not exists actor_key text null;

alter table public.pos_cash_movements
  add column if not exists customer_ledger_id text null;

create index if not exists idx_pos_sales_license_credit_status_sold
  on public.pos_sales (license_id, credit_effect_status, sold_at desc)
  where deleted_at is null;

create index if not exists idx_pos_sales_license_credit_charge
  on public.pos_sales (license_id, credit_ledger_charge_id)
  where credit_ledger_charge_id is not null;

create index if not exists idx_pos_customer_ledger_license_sale
  on public.pos_customer_ledger (license_id, sale_id)
  where sale_id is not null;

create index if not exists idx_pos_cash_movements_license_customer_ledger
  on public.pos_cash_movements (license_id, customer_ledger_id)
  where customer_ledger_id is not null;

alter table public.pos_sales drop constraint if exists pos_sales_effects_status_check;
alter table public.pos_sales
  add constraint pos_sales_effects_status_check check (
    effects_status = any (array[
      'local_applied'::text,
      'cloud_pending'::text,
      'cloud_applied'::text,
      'cash_applied'::text,
      'payment_recorded'::text,
      'inventory_applied'::text,
      'cash_inventory_applied'::text,
      'credit_applied'::text,
      'cash_credit_applied'::text,
      'cash_inventory_credit_applied'::text,
      'failed'::text
    ])
  );

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_sales_credit', code = 'pro_monthly')
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

create or replace function private.assert_cloud_sales_credit_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $function$
begin
  perform private.assert_cloud_sales_cashier_enabled(p_context);
  perform private.assert_cloud_customer_credit_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_credit')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_CREDIT_DISABLED' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function private.pos_sale_to_jsonb(p_sale public.pos_sales)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select case when p_sale.id is null then null else jsonb_strip_nulls(to_jsonb(p_sale)) end
$function$;

create or replace function private.pos_customer_ledger_to_jsonb(p_ledger public.pos_customer_ledger)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select case when p_ledger.id is null then null else jsonb_strip_nulls(to_jsonb(p_ledger)) end
$function$;

create or replace function private.pos_cash_movement_to_jsonb(p_movement public.pos_cash_movements)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select case when p_movement.id is null then null else jsonb_strip_nulls(to_jsonb(p_movement)) end
$function$;;
