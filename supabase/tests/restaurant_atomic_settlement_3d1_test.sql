-- Read-only contract assertions for 3D.1. No QA data or financial rows are written.
begin;

do $test$
declare
  v_legacy jsonb;
  v_modern jsonb;
  v_request jsonb;
  v_lock_definition text;
  v_dispatcher_definition text;
  v_split_definition text;
  v_trigger_exists boolean;
begin
  if to_regprocedure('private.lock_restaurant_order_settlement_v1(uuid,text)') is null
     or to_regprocedure('private.canonical_restaurant_settlement_v1(jsonb)') is null then
    raise exception 'RESTAURANT_SETTLEMENT_HELPER_MISSING';
  end if;

  v_request := jsonb_build_object(
    'sale', jsonb_build_object('id', 'order-contract-test', 'total', '10.00'),
    'items', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'cash_session_id', 'cash-session-contract-test'
  );
  v_legacy := private.canonical_financial_request_v1('sale.cashier', v_request);
  if v_legacy ? 'restaurant_settlement' then
    raise exception 'LEGACY_SALE_CANONICAL_CHANGED';
  end if;

  v_request := v_request || jsonb_build_object('restaurant_settlement', jsonb_build_object(
    'parent_order_id', 'order-contract-test',
    'parent_order_version', '2026-01-02T03:04:05.123456789-06:00',
    'contract_version', 1
  ));
  v_modern := private.canonical_financial_request_v1('sale.cashier', v_request);
  if v_modern #>> '{restaurant_settlement,parent_order_version}' <> '2026-01-02T09:04:05.123456Z'
     or v_modern #>> '{restaurant_settlement,parent_order_id}' <> 'order-contract-test'
     or v_modern #>> '{restaurant_settlement,contract_version}' <> '1' then
    raise exception 'RESTAURANT_SETTLEMENT_CANONICAL_INVALID';
  end if;

  v_lock_definition := pg_get_functiondef('private.lock_restaurant_order_settlement_v1(uuid,text)'::regprocedure);
  v_dispatcher_definition := pg_get_functiondef('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'::regprocedure);
  v_split_definition := pg_get_functiondef('private.execute_split_sale_financial_v1(text,text,text,text,jsonb,text)'::regprocedure);
  if position('restaurant_split:' in v_lock_definition) = 0
     or position('for update' in lower(v_lock_definition)) = 0
     or position('private.lock_restaurant_order_settlement_v1' in v_dispatcher_definition) = 0
     or position('private.lock_restaurant_order_settlement_v1' in v_split_definition) = 0
     or position('pos_close_restaurant_order_after_checkout_unlimited' in v_dispatcher_definition) = 0 then
    raise exception 'RESTAURANT_SETTLEMENT_SHARED_LOCK_OR_CLOSE_MISSING';
  end if;

  select exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.pos_restaurant_orders'::regclass
       and t.tgname = 'pos_restaurant_orders_paid_sale_id_immutable_v1'
       and not t.tgisinternal
  ) into v_trigger_exists;
  if not v_trigger_exists then
    raise exception 'RESTAURANT_PAID_SALE_ID_GUARD_MISSING';
  end if;
end;
$test$;

rollback;
