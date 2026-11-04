-- R3: run only in the reused isolated PostgreSQL 17 synthetic R2 fixture,
-- supplemented with the current real dependencies, AFTER applying V in full.
-- No mocked financial/auth functions. Supabase Realtime transport stays a no-op.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
create temporary table r3_results(section text, evidence jsonb);

do $security$
declare r record; source text; copied text; endpoint_count integer;
begin
  assert current_setting('server_version_num')::integer between 170000 and 179999;
  select count(*) into endpoint_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname='pos_fin01_sync_contract_v1' or p.proname in (
    'pos_upsert_customer_v2','pos_delete_customer_v2','pos_migrate_local_customers_v2',
    'pos_pull_customers_snapshot_v2','pos_pull_customer_changes_v2','pos_get_customer_credit_summary_v2',
    'pos_pull_customer_credit_snapshot_v2','pos_pull_customer_credit_changes_v2',
    'pos_record_customer_payment_v2','pos_execute_financial_operation_v2','pos_get_financial_operation_receipt_v2'));
  assert endpoint_count=12, 'discovery and all eleven RPCs created';
  for r in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname='pos_fin01_sync_contract_v1' or p.proname like 'pos_%_v2')
  loop
    assert r.proowner='postgres'::regrole and r.prosecdef;
    assert r.proconfig @> array['search_path=""'];
    assert has_function_privilege('anon',r.oid,'execute') and has_function_privilege('authenticated',r.oid,'execute');
    assert not exists(select 1 from aclexplode(r.proacl) where grantee=0 and privilege_type='EXECUTE');
  end loop;
  for r in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'pos_fin01_%_v2' or p.proname='pos_execute_financial_operation_core_v2')
  loop
    assert r.proowner='postgres'::regrole and r.proconfig @> array['search_path=""'];
    assert not has_function_privilege('anon',r.oid,'execute');
    assert not has_function_privilege('authenticated',r.oid,'execute');
    assert not has_function_privilege('service_role',r.oid,'execute');
  end loop;
  source:=pg_get_functiondef('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'::regprocedure);
  copied:=pg_get_functiondef('private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)'::regprocedure);
  source:=replace(replace(replace(source,
    'CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1(',
    'CREATE OR REPLACE FUNCTION private.pos_execute_financial_operation_core_v2('),
    'public.pos_create_cloud_sale_credit(','private.pos_fin01_create_credit_rate_limited_v2('),
    'public.pos_cancel_cloud_sale(','private.pos_fin01_cancel_sale_rate_limited_v2(');
  assert copied=source, 'only the three reviewed substitutions changed the copied dispatcher';
  assert copied like '%enter_restaurant_financial_transition_write_v1%';
  assert copied like '%RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED%';
  assert copied like '%RESTAURANT_ORDER_CONTEXT_MISMATCH%';
  assert (select proconfig @> array['statement_timeout=45s','lock_timeout=20s'] from pg_proc
    where oid='private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)'::regprocedure);
end;
$security$;

-- Exercise the actual public EXECUTE grant under the API role.
set local role anon;
select public.pos_fin01_sync_contract_v1('fixture-a','device-a','synthetic-device','owner-session-a',2,array[]::text[])->>'server_status' as anon_discovery;
reset role;

do $finance$
declare
  contract jsonb := '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1","financial_operation_result_v1"]}';
  request jsonb; changed jsonb; h text; changed_h text; result jsonb; receipt jsonb; original jsonb;
  counts jsonb; after_counts jsonb; endpoints integer:=0;
begin
  result:=public.pos_fin01_sync_contract_v1('fixture-a','device-a','synthetic-device','owner-session-a',2,array[]::text[]);
  assert result->>'server_status'='SUPPORTED' and jsonb_array_length(result->'endpoints')=11;
  assert result->'capabilities' @> '["financial_operation_result_v1"]';
  result:=public.pos_upsert_customer_v2('fixture-a','device-a','synthetic-device','owner-session-a',
    '{"id":"r3-customer","name":"R3 Synthetic","credit_limit":100}',null,'r3-customer-upsert',contract);
  assert result#>>'{payload,success}'='true'; endpoints:=endpoints+1;
  result:=public.pos_migrate_local_customers_v2('fixture-a','device-a','synthetic-device','owner-session-a',
    '[{"id":"r3-delete","name":"R3 Synthetic Directory","credit_limit":0}]','r3-directory-batch',contract);
  assert result#>>'{payload,processed}'='1' and coalesce((result#>>'{payload,failed}')::integer,0)=0; endpoints:=endpoints+1;
  result:=public.pos_delete_customer_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-delete',1,'r3-delete-key',contract);
  assert result#>>'{payload,success}'='true'; endpoints:=endpoints+1;
  result:=public.pos_pull_customers_snapshot_v2('fixture-a','device-a','synthetic-device','owner-session-a',100,0,false,contract);
  assert result->>'contract_version'='2' and result->'payload' is not null; endpoints:=endpoints+1;
  result:=public.pos_pull_customer_changes_v2('fixture-a','device-a','synthetic-device','owner-session-a',0,100,contract);
  assert result->>'contract_version'='2' and result->'payload' is not null; endpoints:=endpoints+1;
  result:=public.pos_get_customer_credit_summary_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-customer',contract);
  assert result->>'contract_version'='2' and result->'payload' is not null; endpoints:=endpoints+1;
  result:=public.pos_pull_customer_credit_snapshot_v2('fixture-a','device-a','synthetic-device','owner-session-a',100,0,'r3-customer',false,contract);
  assert result->>'contract_version'='2' and result->'payload' is not null; endpoints:=endpoints+1;
  result:=public.pos_pull_customer_credit_changes_v2('fixture-a','device-a','synthetic-device','owner-session-a',0,100,contract);
  assert result->>'contract_version'='2' and result->'payload' is not null; endpoints:=endpoints+1;

  insert into public.pos_products(id,license_id,name,name_key,price,cost,stock)
    values('r3-product','10000000-0000-0000-0000-000000000001','R3 Synthetic Product','r3-product',10,1,100);
  request:='{"cash_session_id":"cash-a","customer_id":"r3-customer","sale":{"id":"r3-sale","customer_id":"r3-customer","subtotal":10,"total":10,"discount_total":0,"tax_total":0,"amount_paid":0,"change_amount":0,"balance_due":10,"payment_method":"credit"},"items":[{"product_id":"r3-product","quantity":1,"unit_price":10,"line_subtotal":10,"line_total":10}],"payments":[]}';
  h:=private.financial_operation_hash('sale.credit',private.canonical_financial_request_v1('sale.credit',request),
    'admin:30000000-0000-0000-0000-000000000001','cash-a','cash_station_device_20000000-0000-0000-0000-000000000001');
  set local role anon;
  result:=public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,'sale.credit',request,contract);
  reset role;
  assert result#>>'{payload,success}'='true' and result#>>'{payload,sale,id}'='r3-sale'; endpoints:=endpoints+1;
  original:=result->'payload';
  assert original#>>'{customer,debt_cents}'='1000';
  assert (select debt_cents from public.pos_customers where id='r3-customer')=1000;
  result:=public.pos_record_customer_payment_v2('fixture-a','device-a','synthetic-device','owner-session-a',
    'r3-customer',5,'efectivo','cash-a','R3 Synthetic later payment','[]','r3-payment-key',contract);
  assert result#>>'{payload,success}'='true'; endpoints:=endpoints+1;
  assert (select debt_cents from public.pos_customers where id='r3-customer')=500;
  select jsonb_build_object('sales',(select count(*) from public.pos_sales),'payments',(select count(*) from public.pos_sale_payments),
    'ledger',(select count(*) from public.pos_customer_ledger),'cash',(select count(*) from public.pos_cash_movements),
    'inventory',(select count(*) from public.pos_inventory_movements),'operations',(select count(*) from public.pos_financial_operations),
    'idempotency',(select count(*) from public.pos_idempotency_keys)) into counts;
  assert counts->>'sales'='1' and counts->>'ledger'='2' and counts->>'cash'='1' and counts->>'operations'='1';
  for attempt in 1..3 loop
    receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,contract);
    assert receipt#>>'{payload,status}'='COMPLETED' and receipt#>'{payload,result}'=original;
    assert receipt->>'customer_projection_scope'='OPERATION_RESULT' and receipt->'customer_projections'='[]'::jsonb;
    assert receipt#>>'{operation,idempotency_key}'='r3-sale-key' and receipt#>>'{operation,request_hash}'=h;
    result:=public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,'sale.credit',request,contract);
    assert result->'payload'=original;
    perform public.pos_record_customer_payment_v2('fixture-a','device-a','synthetic-device','owner-session-a',
      'r3-customer',5,'efectivo','cash-a','R3 Synthetic later payment','[]','r3-payment-key',contract);
  end loop;
  endpoints:=endpoints+1;
  assert endpoints=11, 'all eleven actual v2 RPCs exercised';
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key','sha256:'||repeat('b',64),contract);
  assert receipt#>>'{payload,status}'='CONFLICT' and receipt#>'{payload,result}' is null;
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-b','synthetic-device','owner-session-b','r3-sale-key',h,contract);
  assert receipt#>>'{payload,status}'='NOT_FOUND' and receipt#>'{payload,result}' is null;
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','staff-session','r3-sale-key',h,contract);
  assert receipt#>>'{payload,status}'='NOT_FOUND' and receipt#>'{payload,result}' is null;
  receipt:=public.pos_get_financial_operation_receipt_v2('fixture-b','device-c','synthetic-device','other-owner','r3-sale-key',h,contract);
  assert receipt#>>'{payload,status}'='NOT_FOUND' and receipt#>'{payload,result}' is null;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a',null,h,'sale.credit',request,contract);
    raise exception 'R3_EMPTY_KEY_ACCEPTED';
  exception when others then if sqlerrm<>'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' then raise; end if; end;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key','sha256:'||repeat('b',64),'sale.credit',request,contract);
    raise exception 'R3_WRONG_HASH_ACCEPTED';
  exception when others then if sqlerrm<>'FINANCIAL_REQUEST_HASH_INVALID' then raise; end if; end;
  changed:=jsonb_set(request,'{sale,notes}','"changed"');
  -- Notes are not part of the financial allowlist: change a canonical field.
  changed:=jsonb_set(changed,'{sale,total}','11');
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,'sale.credit',changed,contract);
    raise exception 'R3_STALE_HASH_ACCEPTED';
  exception when others then if sqlerrm<>'FINANCIAL_REQUEST_HASH_INVALID' then raise; end if; end;
  changed_h:=private.financial_operation_hash('sale.credit',private.canonical_financial_request_v1('sale.credit',changed),
    'admin:30000000-0000-0000-0000-000000000001','cash-a','cash_station_device_20000000-0000-0000-0000-000000000001');
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',changed_h,'sale.credit',changed,contract);
    raise exception 'R3_CHANGED_REQUEST_ACCEPTED';
  exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-b','synthetic-device','owner-session-b','r3-sale-key',h,'sale.credit',request,contract);
    raise exception 'R3_OTHER_STATION_ACCEPTED';
  exception when others then if sqlerrm<>'CASH_SESSION_STATION_MISMATCH' then raise; end if; end;
  begin
    perform public.pos_get_financial_operation_receipt_v2('fixture-a','device-a','synthetic-device','invalid-session','r3-sale-key',h,contract);
    raise exception 'R3_INVALID_SESSION_ACCEPTED';
  exception when others then if sqlerrm not like '%ACTOR_SESSION_INVALID%' then raise; end if; end;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,'sale.credit',request,
      '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]}');
    raise exception 'R3_OLD_CAPABILITY_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  update public.license_staff_users set permissions='{}' where id='50000000-0000-0000-0000-000000000001';
  begin
    perform public.pos_upsert_customer_v2('fixture-a','device-a','synthetic-device','staff-session','{"id":"unauthorized","name":"Denied"}',null,'r3-denied',contract);
    raise exception 'R3_PERMISSION_BYPASSED';
  exception when others then if sqlerrm<>'POS_PERMISSION_DENIED:customers' then raise; end if; end;
  -- The unmodified v1 dispatcher can still replay the same authoritative receipt.
  result:=public.pos_execute_financial_operation_v1('fixture-a','device-a','synthetic-device','owner-session-a','r3-sale-key',h,'sale.credit',request);
  assert result=original;
  select jsonb_build_object('sales',(select count(*) from public.pos_sales),'payments',(select count(*) from public.pos_sale_payments),
    'ledger',(select count(*) from public.pos_customer_ledger),'cash',(select count(*) from public.pos_cash_movements),
    'inventory',(select count(*) from public.pos_inventory_movements),'operations',(select count(*) from public.pos_financial_operations),
    'idempotency',(select count(*) from public.pos_idempotency_keys)) into after_counts;
  assert after_counts=counts, 'all retries/rejections must leave every effect count unchanged';
  assert (select response_payload from public.pos_financial_operations where idempotency_key='r3-sale-key')=original;
  assert (select debt_cents from public.pos_customers where id='r3-customer')=500;
  insert into r3_results values('finance',jsonb_build_object('all_11_rpc',true,'original_debt_cents',1000,
    'current_debt_cents',500,'counts_after_payment',counts,'counts_after_retries',after_counts));
end;
$finance$;

do $restaurant$
declare contract jsonb := '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1","financial_operation_result_v1"]}';
  sale jsonb; request jsonb; result jsonb; original jsonb; h text;
begin
  insert into public.pos_restaurant_orders(id,license_id,local_order_id,total,subtotal,payment_status)
    values('r3-order-row','10000000-0000-0000-0000-000000000001','r3-restaurant',10,10,'unpaid');
  sale:='{"id":"r3-restaurant","local_sale_id":"r3-restaurant","subtotal":10,"total":10,"discount_total":0,"tax_total":0,"amount_paid":10,"change_amount":0,"balance_due":0,"payment_method":"cash"}';
  request:=jsonb_build_object('cash_session_id','cash-a','sale',sale,'items',
    '[{"product_id":"r3-product","quantity":1,"unit_price":10,"line_subtotal":10,"line_total":10}]'::jsonb,
    'payments','[{"method":"cash","amount":10,"received_amount":10,"change_amount":0}]'::jsonb);
  begin
    perform public.pos_create_cloud_sale_cashier('fixture-a','device-a','synthetic-device','owner-session-a',sale,request->'items',request->'payments','cash-a','r3-unreserved');
    raise exception 'R3_RESTAURANT_DIRECT_CASHIER_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' then raise; end if; end;
  begin
    perform public.pos_create_cloud_sale_cashier_inventory('fixture-a','device-a','synthetic-device','owner-session-a',sale,request->'items',request->'payments','cash-a','r3-unreserved-inventory');
    raise exception 'R3_RESTAURANT_DIRECT_INVENTORY_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' then raise; end if; end;
  update private.restaurant_cloud_contract_state set writes_paused=true;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-paused','sha256:'||repeat('a',64),'sale.cashier',request,contract);
    raise exception 'R3_RESTAURANT_PAUSED_DISPATCH_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_CONTRACT_MAINTENANCE' then raise; end if; end;
  begin
    perform private.execute_split_sale_financial_v1('fixture-a','device-a','synthetic-device','owner-session-a','{"parent_order_id":"r3-restaurant"}','r3-paused-split');
    raise exception 'R3_RESTAURANT_PAUSED_SPLIT_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_CONTRACT_MAINTENANCE' then raise; end if; end;
  begin
    perform public.pos_close_restaurant_order_after_checkout_unlimited('fixture-a','device-a','synthetic-device','owner-session-a','r3-restaurant','r3-none','r3-none',10,'{}','r3-paused-close');
    raise exception 'R3_RESTAURANT_PAUSED_CLOSE_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_CONTRACT_MAINTENANCE' then raise; end if; end;
  update private.restaurant_cloud_contract_state set writes_paused=false;
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-alias','sha256:'||repeat('a',64),'sale.cashier',jsonb_set(request,'{sale,id}','"r3-other"'),contract);
    raise exception 'R3_RESTAURANT_ALIAS_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_ORDER_CONTEXT_MISMATCH' then raise; end if; end;
  h:=private.financial_operation_hash('sale.cashier',private.canonical_financial_request_v1('sale.cashier',request),
    'admin:30000000-0000-0000-0000-000000000001','cash-a','cash_station_device_20000000-0000-0000-0000-000000000001');
  result:=public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-restaurant-key',h,'sale.cashier',request,contract);
  assert result#>>'{payload,success}'='true' and result#>>'{payload,restaurant_settlement,payment_status}'='paid';
  original:=result->'payload';
  assert (select payment_status from public.pos_restaurant_orders where id='r3-order-row')='paid';
  result:=public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-restaurant-key',h,'sale.cashier',request,contract);
  assert result->'payload'=original, 'completed retry remains valid after order closes';
  -- Simulate the known legacy sale-committed / close-pending boundary.
  update public.pos_restaurant_orders set payment_status='unpaid',checkout_closed_at=null,archived_at=null where id='r3-order-row';
  begin
    perform public.pos_execute_financial_operation_v2('fixture-a','device-a','synthetic-device','owner-session-a','r3-second-charge',h,'sale.cashier',request,contract);
    raise exception 'R3_RESTAURANT_SECOND_CHARGE_ACCEPTED';
  exception when others then if sqlerrm<>'RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED' then raise; end if; end;
  assert (select count(*) from public.pos_sales where id='r3-restaurant')=1;
  assert not exists(select 1 from public.pos_financial_operations where idempotency_key='r3-second-charge');
  assert (select debt_cents from public.pos_customers where id='r3-customer')=500;
  insert into r3_results values('restaurant',jsonb_build_object('cashier_and_inventory_direct_rejected',true,
    'dispatcher_split_close_pause_rejected',true,'alias_mismatch_rejected',true,'checkout_and_replay',true,
    'second_charge_rejected',true));
end;
$restaurant$;

select 'R3_FULL_V_DISPATCHER_PASS' as result,jsonb_object_agg(section,evidence) from r3_results;
rollback;
