\set ON_ERROR_STOP on
SELECT private.financial_operation_hash('sale.cancel',private.canonical_financial_request_v1('sale.cancel','{"sale_id":"lab-credit-3","reason":"Synthetic cancellation test"}'::jsonb),'admin:00000000-0000-0000-0000-0000000000aa',null,null) AS hash \gset
SELECT public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','lab-cancel-credit-key-3',:'hash','sale.cancel','{"sale_id":"lab-credit-3","reason":"Synthetic cancellation test"}'::jsonb) AS response;
