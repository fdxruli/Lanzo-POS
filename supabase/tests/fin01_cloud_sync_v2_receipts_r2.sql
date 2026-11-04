-- R2 complementary test, ONLY in a fresh synthetic PostgreSQL fixture.
-- Load the existing FIN-01 fixture/seed and the real candidate receipt functions.
-- Does not install F/V/Q or certify the financial dispatcher/full V migration.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '20s';

insert into public.pos_customers(id,license_id,name,debt,debt_cents,credit_limit)
values ('r2-customer','10000000-0000-0000-0000-000000000001','R2 Synthetic',10,1000,100);
insert into public.pos_customer_ledger(id,license_id,customer_id,type,amount,balance_after,debt_cents_after,actor_name)
values ('r2-initial','10000000-0000-0000-0000-000000000001','r2-customer','INITIAL_BALANCE',10,10,1000,'Synthetic');

-- Preload completed operation evidence. Its original sale execution is outside
-- this receipt test; the later payment below executes the real financial core.
insert into public.pos_financial_operations(license_id,idempotency_key,legacy_idempotency_key,request_hash,
  operation_type,verified_actor_key,verified_device_id,verified_cash_session_id,verified_cash_station_id,
  canonical_request,status,response_payload,completed_at)
select c.license_id,'r2-receipt','r2-original-internal','sha256:'||repeat('a',64),'sale.credit',
  'admin:30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  'cash-a','cash_station_device_20000000-0000-0000-0000-000000000001','{}','completed',
  jsonb_build_object('success',true,'customer',private.pos_customer_to_jsonb(c),'sale',jsonb_build_object('id','r2-sale')),now()
from public.pos_customers c where c.id='r2-customer';
create temporary table r2_original as select response_payload from public.pos_financial_operations where idempotency_key='r2-receipt';

select public.pos_record_customer_payment_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',
  'r2-customer',5,'efectivo','cash-a','R2 later payment','[]','r2-payment-key');

create temporary table r2_effects as select jsonb_build_object(
  'sales',(select count(*) from public.pos_sales),
  'payments',(select count(*) from public.pos_sale_payments),
  'ledger',(select count(*) from public.pos_customer_ledger),
  'cash',(select count(*) from public.pos_cash_movements),
  'inventory',(select count(*) from public.pos_inventory_movements),
  'operations',(select count(*) from public.pos_financial_operations),
  'idempotency',(select count(*) from public.pos_idempotency_keys)) as counts;

do $test$
declare
  contract jsonb := '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1","financial_operation_result_v1"]}';
  receipt jsonb;
  original jsonb := (select response_payload from r2_original);
  counts jsonb;
begin
  assert (select debt_cents from public.pos_customers where id='r2-customer')=500, 'later real payment must leave $5';
  for attempt in 1..3 loop
    receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r2-receipt','sha256:'||repeat('a',64),contract);
    assert receipt#>>'{payload,status}'='COMPLETED', 'receipt must remain completed';
    assert receipt#>'{payload,result}'=original, 'immutable result must remain unchanged';
    assert receipt#>>'{payload,result,customer,debt_cents}'='1000', 'original amount must remain $10';
    assert receipt->>'customer_projection_scope'='OPERATION_RESULT', 'must distinguish operation evidence';
    assert receipt->'customer_projections'='[]'::jsonb, 'receipt must not claim a live debt projection';
    assert receipt#>>'{operation,idempotency_key}'='r2-receipt', 'same original key';
    assert receipt#>>'{operation,request_hash}'='sha256:'||repeat('a',64), 'same original hash';
  end loop;
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r2-receipt','sha256:'||repeat('b',64),contract);
  assert receipt#>>'{payload,status}'='CONFLICT', 'changed hash must conflict';
  assert receipt#>'{payload,result}' is null, 'conflict must not return the result';
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-b','synthetic-device','owner-session-b','r2-receipt','sha256:'||repeat('a',64),contract);
  assert receipt#>>'{payload,status}'='NOT_FOUND', 'different origin must not receive the result';
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-b','device-c','synthetic-device','other-owner','r2-receipt','sha256:'||repeat('a',64),contract);
  assert receipt#>>'{payload,status}'='NOT_FOUND', 'other tenant must not receive the result';
  begin
    perform public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','invalid-session','r2-receipt','sha256:'||repeat('a',64),contract);
    raise exception 'R2_SESSION_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%ACTOR_SESSION_INVALID%' then raise; end if;
  end;
  begin
    perform public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r2-receipt','sha256:'||repeat('a',64),
      '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]}');
    raise exception 'R2_OLD_CAPABILITY_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if;
  end;

  -- Exact retry of the real later payment must also leave its effects unchanged.
  perform public.pos_record_customer_payment_unlimited('fixture-a','device-a','synthetic-device','owner-session-a',
    'r2-customer',5,'efectivo','cash-a','R2 later payment','[]','r2-payment-key');
  select jsonb_build_object('sales',(select count(*) from public.pos_sales),'payments',(select count(*) from public.pos_sale_payments),
    'ledger',(select count(*) from public.pos_customer_ledger),'cash',(select count(*) from public.pos_cash_movements),
    'inventory',(select count(*) from public.pos_inventory_movements),'operations',(select count(*) from public.pos_financial_operations),
    'idempotency',(select count(*) from public.pos_idempotency_keys)) into counts;
  assert counts=(select e.counts from r2_effects e), 'receipt queries and payment retry must not duplicate effects';
  assert (select response_payload from public.pos_financial_operations where idempotency_key='r2-receipt')=original, 'stored result must not be overwritten';
  assert (select debt_cents from public.pos_customers where id='r2-customer')=500, 'current debt must stay $5';
end;
$test$;
select 'R2_RECEIPT_REAL_SQL_PASS' as result, counts from r2_effects;
rollback;
