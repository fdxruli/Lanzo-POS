\set ON_ERROR_STOP on
DO $test$ DECLARE a jsonb; b jsonb; before_cash numeric; BEGIN
SELECT customer_payments_total INTO before_cash FROM public.pos_cash_sessions WHERE id='lab-cash-a';
a:=public.pos_record_customer_payment('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','lab-customer-2',5,'cash','lab-cash-a','Synthetic customer payment','[]','lab-customer-payment-key');
b:=public.pos_record_customer_payment('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','lab-customer-2',5,'cash','lab-cash-a','Synthetic customer payment','[]','lab-customer-payment-key');
IF (a->>'success')::boolean IS DISTINCT FROM true OR a IS DISTINCT FROM b THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_RECEIPT_MISMATCH'; END IF;
IF (SELECT debt FROM public.pos_customers WHERE id='lab-customer-2')<>15 OR (SELECT count(*) FROM public.pos_customer_ledger WHERE customer_id='lab-customer-2')<>2 OR (SELECT customer_payments_total FROM public.pos_cash_sessions WHERE id='lab-cash-a')<>before_cash+5 OR (SELECT count(*) FROM public.pos_cash_movements WHERE reference_id IN (SELECT id FROM public.pos_customer_ledger WHERE customer_id='lab-customer-2' AND type='PAYMENT') AND source='customer_payment')<>1 THEN RAISE EXCEPTION 'CUSTOMER_PAYMENT_EFFECTS_MISMATCH'; END IF;
END $test$;
SELECT 'PASS_CUSTOMER_PAYMENT_AND_REPLAY' result;
