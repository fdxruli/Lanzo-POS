-- R4 diagnostic on the unchanged R3 candidate, ONLY in the existing synthetic
-- PostgreSQL 17 fixture. This does NOT implement or certify a pilot cutover.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='20s';
create temporary table r4_evidence(result jsonb);
do $test$
declare
  contract jsonb := '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1","financial_operation_result_v1"]}';
  request jsonb; h text; before_receipt jsonb; after_receipt jsonb; operation jsonb;
begin
  insert into public.pos_customers(id,license_id,name,credit_limit)
    values('r4-pending-customer','10000000-0000-0000-0000-000000000001','R4 Synthetic',100);
  insert into public.pos_products(id,license_id,name,name_key,price,cost,stock)
    values('r4-product','10000000-0000-0000-0000-000000000001','R4 Synthetic Product','r4-product',10,1,100);
  request:='{"cash_session_id":"cash-a","customer_id":"r4-pending-customer","sale":{"id":"r4-pending-sale","customer_id":"r4-pending-customer","subtotal":10,"total":10,"discount_total":0,"tax_total":0,"amount_paid":0,"change_amount":0,"balance_due":10,"payment_method":"credit"},"items":[{"product_id":"r4-product","quantity":1,"unit_price":10,"line_subtotal":10,"line_total":10}],"payments":[]}';
  h:=private.financial_operation_hash('sale.credit',private.canonical_financial_request_v1('sale.credit',request),
    'admin:30000000-0000-0000-0000-000000000001','cash-a','cash_station_device_20000000-0000-0000-0000-000000000001');
  before_receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r4-pending-key',h,contract);
  assert before_receipt#>>'{payload,status}'='NOT_FOUND';
  assert not exists(select 1 from public.pos_financial_operations where idempotency_key='r4-pending-key');

  -- A valid v1 request can still execute after this NOT_FOUND. The current
  -- receipt therefore is a lookup, not evidence that legacy admission closed.
  operation:=public.pos_execute_financial_operation_v1('fixture-a','device-a','synthetic-device','owner-session-a',
    'r4-pending-key',h,'sale.credit',request);
  assert operation->>'success'='true' and operation#>>'{sale,id}'='r4-pending-sale';
  after_receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r4-pending-key',h,contract);
  assert after_receipt#>>'{payload,status}'='COMPLETED' and after_receipt#>'{payload,result}'=operation;
  assert after_receipt#>>'{operation,idempotency_key}'='r4-pending-key' and after_receipt#>>'{operation,request_hash}'=h;
  assert (select count(*) from public.pos_sales where id='r4-pending-sale')=1;
  assert (select debt_cents from public.pos_customers where id='r4-pending-customer')=1000;

  assert public.pos_get_financial_operation_receipt_v2('fixture-a','device-b','synthetic-device','owner-session-b',
    'r4-pending-key',h,contract)#>>'{payload,status}'='NOT_FOUND';
  assert public.pos_get_financial_operation_receipt_v2('fixture-b','device-c','synthetic-device','other-owner',
    'r4-pending-key',h,contract)#>>'{payload,status}'='NOT_FOUND';
  begin
    perform public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','invalid-session','r4-pending-key',h,contract);
    raise exception 'R4_INVALID_SESSION_ACCEPTED';
  exception when others then if sqlerrm not like '%ACTOR_SESSION_INVALID%' then raise; end if; end;
  insert into r4_evidence values(jsonb_build_object('before',before_receipt#>>'{payload,status}',
    'after',after_receipt#>>'{payload,status}','v1_write',true,'same_key_hash',true,
    'sales',1,'debt_cents',1000,'device_tenant_session_boundaries',true,'pilot_gate_implemented',false));
end;
$test$;
select 'R4_BASELINE_NOT_FOUND_IS_NOT_CUTOVER_PROOF' as result,result as evidence from r4_evidence;
rollback;
