\set ON_ERROR_STOP on
DO $test$ DECLARE before_counts jsonb; after_counts jsonb; BEGIN
SELECT jsonb_build_array((SELECT count(*) FROM public.pos_sales),(SELECT count(*) FROM public.pos_sale_payments),(SELECT count(*) FROM public.pos_cash_movements),(SELECT count(*) FROM public.pos_inventory_movements),(SELECT count(*) FROM public.pos_customer_ledger),(SELECT count(*) FROM public.pos_idempotency_keys),(SELECT count(*) FROM public.pos_financial_operations)) INTO before_counts;
BEGIN
 PERFORM public.pos_create_cloud_sale_cashier('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','{"id":"lab-alias","local_sale_id":"lab-denial"}','[]','[]','lab-cash-a','lab-alias-direct');
 RAISE EXCEPTION 'INCONSISTENT_ID_BYPASS';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' THEN RAISE; END IF; END;
BEGIN
 PERFORM public.pos_create_cloud_sale_cashier_inventory_legacy_r2b('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','{"id":"lab-denial","local_sale_id":"lab-denial","total":20,"subtotal":20,"payment_method":"cash","amount_paid":20,"balance_due":0,"change_amount":0}','[{"id":"bypass-item","product_id":"lab-race-24-product","quantity":2,"unit_price":10,"line_subtotal":20,"line_total":20}]','[{"id":"bypass-payment","method":"cash","amount":20,"received_amount":20,"change_amount":0}]','lab-cash-a','lab-bypass-internal');
 RAISE EXCEPTION 'INTERNAL_INVENTORY_BYPASS';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' THEN RAISE; END IF; END;
SELECT jsonb_build_array((SELECT count(*) FROM public.pos_sales),(SELECT count(*) FROM public.pos_sale_payments),(SELECT count(*) FROM public.pos_cash_movements),(SELECT count(*) FROM public.pos_inventory_movements),(SELECT count(*) FROM public.pos_customer_ledger),(SELECT count(*) FROM public.pos_idempotency_keys),(SELECT count(*) FROM public.pos_financial_operations)) INTO after_counts;
IF before_counts IS DISTINCT FROM after_counts THEN RAISE EXCEPTION 'GUARD_DENIAL_CHANGED_EFFECTS'; END IF;
END $test$;
SELECT 'PASS_INCONSISTENT_IDS_AND_INTERNAL_INVENTORY_GUARD' result;
