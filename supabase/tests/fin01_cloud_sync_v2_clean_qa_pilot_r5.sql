-- ONLY the reused PostgreSQL 17 synthetic fixture, after canonical V in full.
-- R3 baseline additionally needs the real private.cash_audit_allowed(jsonb)
-- from migrations/20260624045720_fase3_caja_cloud_pro.sql.
-- Synthetic activations below are transaction-local and rolled back. No real
-- tenant or device is created/activated by the migration or this delivery.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='30s';
create temporary table r5_results(section text,evidence jsonb);

do $security$
declare f record; role_name text;
begin
  for f in select p.oid,p.proname,p.proowner,p.proconfig,p.proacl,p.prosecdef,n.nspname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('pos_fin01_register_new_tenant_v2',
      'pos_fin01_set_clean_qa_protocol_v2','pos_fin01_enter_pilot_v2','pos_fin01_leave_pilot_v2','pos_fin01_guard_qa_write_v2')
  loop
    assert pg_get_userbyid(f.proowner)='postgres' and f.proconfig @> array['search_path=""'];
    foreach role_name in array array['anon','authenticated','service_role'] loop
      assert not has_function_privilege(role_name,f.oid,'execute');
    end loop;
    assert not exists(select 1 from aclexplode(f.proacl) where grantee=0 and privilege_type='EXECUTE');
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname='pos_fin01_sync_contract_v1' or p.proname in (
      'pos_upsert_customer_v2','pos_delete_customer_v2','pos_migrate_local_customers_v2',
      'pos_pull_customers_snapshot_v2','pos_pull_customer_changes_v2','pos_get_customer_credit_summary_v2',
      'pos_pull_customer_credit_snapshot_v2','pos_pull_customer_credit_changes_v2','pos_record_customer_payment_v2',
      'pos_execute_financial_operation_v2','pos_get_financial_operation_receipt_v2'))
    and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.proconfig @> array['search_path=""']
    and has_function_privilege('anon',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) where grantee=0 and privilege_type='EXECUTE'))=12;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(role_name,'private.pos_fin01_qa_pilots_v2','select,insert,update,delete');
    assert not has_table_privilege(role_name,'private.pos_fin01_admissions_v2','select,insert,update,delete');
  end loop;
  assert (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('pos_fin01_qa_pilots_v2','pos_fin01_admissions_v2')
      and c.relrowsecurity and pg_get_userbyid(c.relowner)='postgres')=2;
  insert into r5_results values('security_metadata','{"private_tables_rls_closed":true,"private_gate_functions_closed":true,"public_rpc_security_preserved":12}');
end;
$security$;

do $baseline$
declare request jsonb; h text; response jsonb;
begin
  assert current_setting('server_version_num')::integer between 170000 and 179999;
  assert not exists(select 1 from private.pos_fin01_qa_pilots_v2 where protocol=2);
  response:=public.pos_fin01_sync_contract_v1('fixture-a','device-a','synthetic-device','owner-session-a',2,array[]::text[]);
  assert response->>'server_status'='UPDATE_REQUIRED' and response->>'reason'='QA_PILOT_NOT_ENABLED';
  begin
    perform private.pos_fin01_set_clean_qa_protocol_v2('10000000-0000-0000-0000-000000000001',2,1,'R5 existing QA must be rejected');
    raise exception 'R5_EXISTING_TENANT_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED' then raise; end if; end;
  insert into public.pos_customers(id,license_id,name,credit_limit)
    values('r5-v1-customer','10000000-0000-0000-0000-000000000001','R5 Existing V1',100);
  insert into public.pos_products(id,license_id,name,name_key,price,cost,stock)
    values('r5-v1-product','10000000-0000-0000-0000-000000000001','R5 V1 Product','r5-v1-product',10,1,100);
  request:='{"cash_session_id":"cash-a","customer_id":"r5-v1-customer","sale":{"id":"r5-v1-sale","customer_id":"r5-v1-customer","subtotal":10,"total":10,"amount_paid":0,"change_amount":0,"balance_due":10,"payment_method":"credit"},"items":[{"product_id":"r5-v1-product","quantity":1,"unit_price":10,"line_subtotal":10,"line_total":10}],"payments":[]}';
  h:=private.financial_operation_hash('sale.credit',private.canonical_financial_request_v1('sale.credit',request),
    'admin:30000000-0000-0000-0000-000000000001','cash-a','cash_station_device_20000000-0000-0000-0000-000000000001');
  set local role anon;
  response:=public.pos_execute_financial_operation_v1('fixture-a','device-a','synthetic-device','owner-session-a','r5-v1-key',h,'sale.credit',request);
  reset role;
  assert response->>'success'='true';
  assert (select debt_cents from public.pos_customers where id='r5-v1-customer')=1000;
  insert into public.licenses(id,license_key,license_type,features) values
    ('90000000-0000-0000-0000-000000000002','r5-dirty-qa','pro','{"cloud_pos_sync":true}');
  insert into public.license_devices(id,license_id,device_fingerprint,security_token,device_mode,device_role,is_active) values
    ('91000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','r5-dirty-device','synthetic','shared','admin',true);
  begin
    perform private.pos_fin01_set_clean_qa_protocol_v2('90000000-0000-0000-0000-000000000002',2,1,'R5 used QA must remain v1');
    raise exception 'R5_USED_QA_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_SYNC_QA_TENANT_NOT_EMPTY' then raise; end if; end;
  assert exists(select 1 from public.license_devices where id='91000000-0000-0000-0000-000000000003');
  insert into r5_results values('default_v1',jsonb_build_object('authorized_v1_sale',true,'automatic_v2_activation',false));
end;
$baseline$;

do $pilot$
declare
  qa uuid:='90000000-0000-0000-0000-000000000001';
  admin_id uuid:='92000000-0000-0000-0000-000000000001';
  device_id uuid:='91000000-0000-0000-0000-000000000001';
  contract jsonb:='{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1","financial_operation_result_v1"]}';
  response jsonb; request jsonb; opening jsonb:='{"opening_amount":0,"opening_origin":"manual"}';
  actor_key text:='admin:92000000-0000-0000-0000-000000000001';
  station text; cash_id text; h text; open_h text; original jsonb; counts jsonb; after_counts jsonb;
begin
  -- This new identity has never been committed or available to an old client.
  insert into public.licenses(id,license_key,license_type,features)
    values(qa,'r5-clean-qa','pro','{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_customer_credit_sync":true,"cloud_sales_credit":true,"cloud_sales_cashier":true,"cloud_sales_sync_base":true,"cloud_products_sync":true}');
  assert (select protocol from private.pos_fin01_qa_pilots_v2 where license_id=qa)=1;
  assert not exists(select 1 from public.license_devices where license_id=qa);
  assert not exists(select 1 from public.pos_financial_operations where license_id=qa);
  assert not exists(select 1 from public.pos_customer_ledger where license_id=qa);
  assert not exists(select 1 from public.pos_idempotency_keys where license_id=qa);
  set local role anon;
  begin
    perform private.pos_fin01_set_clean_qa_protocol_v2(qa,2,1,'untrusted activation claim');
    raise exception 'R5_CLIENT_SELF_ACTIVATED';
  exception when insufficient_privilege then null; end;
  begin
    insert into private.pos_fin01_admissions_v2 values(pg_current_xact_id(),qa,1);
    raise exception 'R5_CLIENT_FORGED_ADMISSION';
  exception when insufficient_privilege then null; end;
  reset role;
  response:=private.pos_fin01_set_clean_qa_protocol_v2(qa,2,1,'R5 synthetic owner-approved clean pilot');
  assert response='{"protocol":2,"generation":2}'::jsonb;
  insert into r5_results values('clean_provenance',jsonb_build_object('creation_xid',pg_current_xact_id()::text,
    'new_license',qa,'prior_devices',0,'prior_financial_operations',0,'prior_keys',0,'historical_debt',0));

  -- Devices and authentication are created AFTER explicit clean activation.
  insert into public.license_devices(id,license_id,device_fingerprint,security_token,device_mode,device_role,is_active) values
    (device_id,qa,'r5-device-a','r5-synthetic-device','shared','admin',true),
    ('91000000-0000-0000-0000-000000000002',qa,'r5-device-b','r5-synthetic-device','shared','admin',true);
  insert into public.license_admin_users(id,license_id,username,display_name,password_hash,is_owner)
    values(admin_id,qa,'r5-owner','R5 Synthetic Owner',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),true);
  insert into public.license_admin_sessions(license_id,admin_user_id,device_id,session_token_hash) values
    (qa,admin_id,device_id,extensions.crypt('r5-session-a',extensions.gen_salt('bf',4))),
    (qa,admin_id,'91000000-0000-0000-0000-000000000002',extensions.crypt('r5-session-b',extensions.gen_salt('bf',4)));
  perform private.resolve_cash_station_for_device(qa,device_id,true);
  station:=private.resolve_financial_cash_station_v1(qa,device_id);
  response:=public.pos_fin01_sync_contract_v1('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',2,array[]::text[]);
  assert response->>'server_status'='SUPPORTED' and jsonb_array_length(response->'endpoints')=11;
  open_h:=private.financial_operation_hash('cash.open',private.canonical_financial_request_v1('cash.open',opening),actor_key,null,station);
  set local role anon;
  response:=public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-open-key',open_h,'cash.open',opening,contract);
  reset role;
  assert response#>>'{payload,success}'='true';
  cash_id:=response#>>'{payload,cash_session,id}';
  assert cash_id is not null;
  assert not exists(select 1 from private.pos_fin01_admissions_v2), 'successful call leaked admission';
  response:=public.pos_upsert_customer_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
    '{"id":"r5-qa-customer","name":"R5 QA Customer","credit_limit":100}',null,'r5-upsert-key',contract);
  assert response#>>'{payload,success}'='true';
  response:=public.pos_migrate_local_customers_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
    '[{"id":"r5-qa-delete","name":"R5 directory only","credit_limit":0}]','r5-qa-batch',contract);
  assert response#>>'{payload,processed}'='1';
  response:=public.pos_delete_customer_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
    'r5-qa-delete',1,'r5-qa-delete-key',contract);
  assert response#>>'{payload,success}'='true';
  response:=public.pos_pull_customer_changes_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',0,100,contract);
  assert response->>'contract_version'='2';
  response:=public.pos_get_customer_credit_summary_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-qa-customer',contract);
  assert response->>'contract_version'='2';
  response:=public.pos_pull_customer_credit_snapshot_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',100,0,'r5-qa-customer',false,contract);
  assert response->>'contract_version'='2';
  response:=public.pos_pull_customer_credit_changes_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',0,100,contract);
  assert response->>'contract_version'='2';
  response:=public.pos_pull_customers_snapshot_v2('r5-clean-qa','r5-device-b','r5-synthetic-device','r5-session-b',100,0,false,contract);
  assert exists(select 1 from jsonb_array_elements(response#>'{payload,customers}') c where c->>'id'='r5-qa-customer');

  -- Public aliases and user-set configuration do not confer v2 admission.
  perform set_config('lanzo.cloud_protocol','2',true);
  perform set_config('lanzo.fin01_v2_admitted','true',true);
  begin
    perform public.pos_upsert_customer_unlimited('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
      '{"id":"r5-denied-customer","name":"Denied"}',null,'r5-legacy-customer');
    raise exception 'R5_LEGACY_CUSTOMER_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  begin
    set local role anon;
    perform public.pos_register_cash_movement('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
      cash_id,'entrada',1,'R5 denied legacy','r5-legacy-cash','{}');
    raise exception 'R5_LEGACY_SHARED_CASH_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  reset role;
  assert not exists(select 1 from public.pos_idempotency_keys where license_id=qa and idempotency_key in ('r5-legacy-customer','r5-legacy-cash'));

  insert into public.pos_products(id,license_id,name,name_key,price,cost,stock)
    values('r5-qa-product',qa,'R5 QA Product','r5-qa-product',10,1,100);
  request:=jsonb_build_object('cash_session_id',cash_id,'customer_id','r5-qa-customer','sale',
    '{"id":"r5-qa-sale","customer_id":"r5-qa-customer","subtotal":10,"total":10,"amount_paid":0,"change_amount":0,"balance_due":10,"payment_method":"credit"}'::jsonb,
    'items','[{"product_id":"r5-qa-product","quantity":1,"unit_price":10,"line_subtotal":10,"line_total":10}]'::jsonb,'payments','[]'::jsonb);
  h:=private.financial_operation_hash('sale.credit',private.canonical_financial_request_v1('sale.credit',request),actor_key,cash_id,station);
  begin
    perform public.pos_execute_financial_operation_v1('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-legacy-sale',h,'sale.credit',request);
    raise exception 'R5_LEGACY_DISPATCH_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  assert not exists(select 1 from public.pos_financial_operations where license_id=qa and idempotency_key='r5-legacy-sale');
  response:=public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key',h,'sale.credit',request,contract);
  assert response#>>'{payload,success}'='true'; original:=response->'payload';
  assert original#>>'{customer,debt_cents}'='1000';
  response:=public.pos_record_customer_payment_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
    'r5-qa-customer',5,'efectivo',cash_id,'R5 later payment','[]','r5-payment-key',contract);
  assert response#>>'{payload,success}'='true';
  select jsonb_build_object('sales',(select count(*) from public.pos_sales where license_id=qa),
    'ledger',(select count(*) from public.pos_customer_ledger where license_id=qa),
    'cash',(select count(*) from public.pos_cash_movements where license_id=qa),
    'operations',(select count(*) from public.pos_financial_operations where license_id=qa),
    'keys',(select count(*) from public.pos_idempotency_keys where license_id=qa)) into counts;
  for attempt in 1..3 loop
    response:=public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key',h,contract);
    assert response#>>'{payload,status}'='COMPLETED' and response#>'{payload,result}'=original;
    response:=public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key',h,'sale.credit',request,contract);
    assert response->'payload'=original;
    perform public.pos_record_customer_payment_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
      'r5-qa-customer',5,'efectivo',cash_id,'R5 later payment','[]','r5-payment-key',contract);
  end loop;
  select jsonb_build_object('sales',(select count(*) from public.pos_sales where license_id=qa),
    'ledger',(select count(*) from public.pos_customer_ledger where license_id=qa),
    'cash',(select count(*) from public.pos_cash_movements where license_id=qa),
    'operations',(select count(*) from public.pos_financial_operations where license_id=qa),
    'keys',(select count(*) from public.pos_idempotency_keys where license_id=qa)) into after_counts;
  assert counts=after_counts;
  assert counts->>'sales'='1' and counts->>'ledger'='2' and counts->>'cash'='1' and counts->>'operations'='2';
  assert (select debt_cents from public.pos_customers where id='r5-qa-customer')=500;
  assert not exists(select 1 from private.pos_fin01_admissions_v2), 'replay leaked admission';
  insert into r5_results values('pilot',jsonb_build_object('two_device_customer_sync',true,'real_shared_cash_open',true,
    'legacy_writes_rejected',true,'user_settings_cannot_bypass',true,'counts',counts,'retries_unchanged',true));

  response:=public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-b','r5-synthetic-device','r5-session-b','r5-sale-key',h,contract);
  assert response#>>'{payload,status}'='NOT_FOUND';
  response:=public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key','sha256:'||repeat('c',64),contract);
  assert response#>>'{payload,status}'='CONFLICT' and response#>'{payload,result}' is null;
  begin
    perform public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key','sha256:'||repeat('c',64),'sale.credit',request,contract);
    raise exception 'R5_BAD_HASH_ACCEPTED';
  exception when others then if sqlerrm<>'FINANCIAL_REQUEST_HASH_INVALID' then raise; end if; end;
  response:=public.pos_record_customer_payment_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',
    'r5-v1-customer',1,'efectivo',cash_id,'R5 foreign customer denied','[]','r5-cross-tenant-payment',contract);
  -- The existing payment contract returns a persisted business denial, rather
  -- than throwing. It may store that denial's key, but no financial effects.
  assert response#>>'{payload,success}'='false' and response#>>'{payload,code}'='CUSTOMER_NOT_FOUND';
  assert (select debt_cents from public.pos_customers where id='r5-v1-customer')=1000;
  assert (select count(*) from public.pos_customer_ledger where license_id=qa)=(counts->>'ledger')::bigint;
  assert (select count(*) from public.pos_cash_movements where license_id=qa)=(counts->>'cash')::bigint;
  assert (select count(*) from public.pos_financial_operations where license_id=qa)=(counts->>'operations')::bigint;
  insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions)
    values('94000000-0000-0000-0000-000000000001',qa,'r5-staff','R5 restricted staff',extensions.crypt('synthetic',extensions.gen_salt('bf',4)),'{}');
  insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash)
    values(qa,'94000000-0000-0000-0000-000000000001',device_id,extensions.crypt('r5-staff-session',extensions.gen_salt('bf',4)));
  begin
    perform public.pos_upsert_customer_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-staff-session',
      '{"id":"r5-unauthorized","name":"Denied"}',null,'r5-permission-denied',contract);
    raise exception 'R5_PERMISSION_BYPASSED';
  exception when others then if sqlerrm<>'POS_PERMISSION_DENIED:customers' then raise; end if; end;
  begin
    perform public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','invalid-session','r5-sale-key',h,contract);
    raise exception 'R5_INVALID_SESSION_ACCEPTED';
  exception when others then if sqlerrm not like '%ACTOR_SESSION_INVALID%' then raise; end if; end;
  begin
    perform public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-a','invalid-device-token','r5-session-a','r5-sale-key',h,contract);
    raise exception 'R5_INVALID_DEVICE_TOKEN_ACCEPTED';
  exception when others then if sqlerrm<>'DEVICE_TOKEN_INVALID' then raise; end if; end;
  begin
    perform public.pos_upsert_customer_v2('fixture-a','device-a','synthetic-device','owner-session-a',
      '{"id":"r5-qa-customer","name":"Cross tenant denied"}',null,'r5-cross-tenant',contract);
    raise exception 'R5_NONPILOT_V2_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  -- An error AFTER entry must roll back its admission too.
  begin
    perform public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-error-key',h,'sale.credit',request,
      '{"contract_version":2,"capabilities":["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]}');
    raise exception 'R5_OLD_CAPABILITY_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  assert not exists(select 1 from private.pos_fin01_admissions_v2), 'exception leaked admission';
  begin
    update public.pos_customers set debt=0,debt_cents=0 where id='r5-qa-customer';
    raise exception 'R5_DIRECT_WRITE_ACCEPTED_AFTER_V2_ERROR';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;

  -- A public v1 cash write in another tenant still succeeds WHILE QA is v2.
  set local role anon;
  response:=public.pos_register_cash_movement('fixture-a','device-a','synthetic-device','owner-session-a',
    'cash-a','entrada',1,'R5 coexistence','r5-v1-during-pilot','{}');
  reset role;
  assert response->>'success'='true';
  assert (select protocol from private.pos_fin01_qa_pilots_v2 where license_id=qa)=2;
  insert into r5_results values('coexistence',jsonb_build_object('other_tenant_public_v1_write_while_pilot_v2',true));

  begin
    perform private.pos_fin01_set_clean_qa_protocol_v2(qa,1,1,'R5 stale operator denied');
    raise exception 'R5_STALE_ACTIVATION_VERSION_ACCEPTED';
  exception when others then if sqlerrm<>'CLOUD_SYNC_QA_GENERATION_CONFLICT' then raise; end if; end;
  assert (select protocol from private.pos_fin01_qa_pilots_v2 where license_id=qa)=2;
  response:=private.pos_fin01_set_clean_qa_protocol_v2(qa,1,2,'R5 synthetic owner-approved stop');
  assert response='{"protocol":1,"generation":3}'::jsonb;
  assert (select approval_reference from private.pos_fin01_qa_pilots_v2 where license_id=qa)='R5 synthetic owner-approved clean pilot';
  response:=public.pos_fin01_sync_contract_v1('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a',2,array[]::text[]);
  assert response->>'mode'='RECOVERY_ONLY' and response->'endpoints'='["pos_get_financial_operation_receipt_v2"]'::jsonb;
  response:=public.pos_get_financial_operation_receipt_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key',h,contract);
  assert response#>'{payload,result}'=original;
  begin
    perform public.pos_execute_financial_operation_v2('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-after-stop',h,'sale.credit',request,contract);
    raise exception 'R5_V2_WRITE_ACCEPTED_AFTER_STOP';
  exception when others then if sqlerrm<>'CLOUD_CLIENT_UPDATE_REQUIRED' then raise; end if; end;
  begin
    perform private.pos_fin01_set_clean_qa_protocol_v2(qa,2,3,'R5 unsafe reactivation denied');
    raise exception 'R5_USED_TENANT_REACTIVATED';
  exception when others then if sqlerrm<>'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED' then raise; end if; end;
  response:=public.pos_execute_financial_operation_v1('r5-clean-qa','r5-device-a','r5-synthetic-device','r5-session-a','r5-sale-key',h,'sale.credit',request);
  assert response=original;
  assert (select debt_cents from public.pos_customers where id='r5-qa-customer')=500;
  insert into r5_results values('stop',jsonb_build_object('receipts_retained',true,'v2_receipt_recovery',true,
    'v1_replay_retained',true,'new_v2_writes_blocked',true,'used_tenant_reactivation_denied',true));
end;
$pilot$;
select 'R5_CLEAN_QA_PILOT_PASS' as result,jsonb_object_agg(section,evidence) from r5_results;
rollback;
