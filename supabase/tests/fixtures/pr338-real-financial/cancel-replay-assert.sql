\set ON_ERROR_STOP on
DO $test$ DECLARE h text; saved jsonb; replay jsonb; BEGIN
h:=private.financial_operation_hash('sale.cancel',private.canonical_financial_request_v1('sale.cancel','{"sale_id":"lab-credit-3","reason":"Synthetic cancellation test"}'::jsonb),'admin:00000000-0000-0000-0000-0000000000aa',null,null);
SELECT response_payload INTO saved FROM public.pos_financial_operations WHERE idempotency_key='lab-cancel-credit-key-3' AND license_id='00000000-0000-0000-0000-000000000001';
replay:=public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','lab-cancel-credit-key-3',h,'sale.cancel','{"sale_id":"lab-credit-3","reason":"Synthetic cancellation test"}'::jsonb);
IF replay IS DISTINCT FROM saved OR (SELECT debt FROM public.pos_customers WHERE id='lab-customer-3')<>0 OR (SELECT stock FROM public.pos_products WHERE id='lab-credit-product-3')<>20 OR (SELECT count(*) FROM public.pos_customer_ledger WHERE customer_id='lab-customer-3')<>4 OR (SELECT count(*) FROM public.pos_sale_cancellations WHERE sale_id='lab-credit-3')<>1 THEN RAISE EXCEPTION 'CANCELLATION_REPLAY_CHANGED'; END IF;
END $test$;
SELECT 'PASS_CANCELLATION_RECEIPT_AND_REPLAY' result;