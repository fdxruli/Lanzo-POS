-- Ecommerce/POS traceability contract test.
-- Run after the migration in an authorized test database.
-- This test is read-only and leaves no state behind.

begin;

do $contract_test$
declare
  v_history_def text;
  v_trigger_def text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pos_sales'
      and column_name = 'sales_channel'
      and is_nullable = 'NO'
  ) then
    raise exception 'pos_sales.sales_channel is missing or nullable';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pos_sales'
      and column_name = 'ecommerce_order_id'
      and data_type = 'uuid'
  ) then
    raise exception 'pos_sales.ecommerce_order_id uuid is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pos_sales'
      and column_name = 'ecommerce_order_code'
  ) then
    raise exception 'pos_sales.ecommerce_order_code is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'pos_sales'
      and indexname = 'pos_sales_license_ecommerce_order_uidx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%where (ecommerce_order_id is not null)%'
  ) then
    raise exception 'partial ecommerce order uniqueness index is missing';
  end if;

  if has_function_privilege(
    'anon',
    'private.pos_ecommerce_sale_integrity_issues(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'private.pos_ecommerce_sale_integrity_issues(uuid)',
    'execute'
  ) then
    raise exception 'private integrity report must not be client executable';
  end if;

  select lower(pg_get_functiondef(
    'public.pos_get_sales_final_history_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text,text,text,text,integer,integer)'::regprocedure
  )) into v_history_def;

  if v_history_def not like '%s.ecommerce_order_code%'
     or v_history_def not like '%s.ecommerce_order_id::text%'
     or v_history_def not like '%''sales_channel'', s.sales_channel%'
     or v_history_def not like '%''ecommerce_order_code'', s.ecommerce_order_code%' then
    raise exception 'history search/output does not preserve ecommerce traceability';
  end if;

  select lower(pg_get_functiondef(
    'private.pos_sales_normalize_ecommerce_traceability()'::regprocedure
  )) into v_trigger_def;

  if v_trigger_def not like '%new.metadata%'
     or v_trigger_def not like '%new.idempotency_key%'
     or v_trigger_def not like '%public.ecommerce_orders%' then
    raise exception 'traceability trigger does not support metadata, idempotency and order lookup';
  end if;
end;
$contract_test$;

do $integrity_report_test$
declare
  v_allowed_codes text[] := array[
    'CONVERTED_ORDER_WITHOUT_POS_SALE',
    'ECOMMERCE_SALE_WITHOUT_ORDER',
    'ORDER_LINKED_TO_MULTIPLE_SALES',
    'ECOMMERCE_REFERENCE_MISMATCH',
    'ECOMMERCE_ORDER_SALE_TOTAL_MISMATCH'
  ];
begin
  if exists (
    select 1
    from private.pos_ecommerce_sale_integrity_issues(null)
    where code <> all(v_allowed_codes)
  ) then
    raise exception 'integrity report returned an undocumented issue code';
  end if;
end;
$integrity_report_test$;

rollback;
