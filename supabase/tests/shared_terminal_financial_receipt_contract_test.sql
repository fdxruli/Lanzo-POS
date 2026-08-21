-- SHARED.TERMINAL.5A-R1 executable local SQL contract test.
-- Run after migrations in an authorized local database.  All fixtures and
-- temporary test writes are rolled back.  Concurrency is exercised separately
-- by scripts/test-shared-terminal-financial-receipt-concurrency.ps1 because it
-- requires two independent PostgreSQL connections.
begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_a uuid := extensions.gen_random_uuid();
  v_license_b uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_actor_x text := 'staff-user:' || extensions.gen_random_uuid()::text;
  v_canonical jsonb := jsonb_build_object('sale_id', 'sale-' || v_suffix, 'reason', 'test');
  v_hash text;
  v_other_hash text;
  v_operation public.pos_financial_operations;
  v_replay public.pos_financial_operations;
  v_receipt jsonb;
  v_before bigint;
  v_after bigint;
  v_sale_a jsonb;
  v_sale_b jsonb;
begin
  if to_regclass('public.pos_financial_operations') is null
     or to_regprocedure('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)') is null
     or to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)') is null then
    raise exception 'FINANCIAL_R1_SCHEMA_OR_RPC_MISSING';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.pos_financial_operations'::regclass
      and conname in ('pos_financial_operations_license_key_uk', 'pos_financial_operations_license_legacy_key_uk')
  ) then raise exception 'FINANCIAL_R1_KEY_CONSTRAINT_MISSING'; end if;
  if has_table_privilege('anon', 'public.pos_financial_operations', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.pos_financial_operations', 'select,insert,update,delete') then
    raise exception 'FINANCIAL_R1_DIRECT_TABLE_ACCESS';
  end if;

  insert into public.licenses (id, license_key, license_type, max_devices, status, product_name, features)
  values
    (v_license_a, 'F5AR1-A-' || v_suffix, 'pro', 2, 'active', 'F5A R1 test A', '{}'::jsonb),
    (v_license_b, 'F5AR1-B-' || v_suffix, 'pro', 2, 'active', 'F5A R1 test B', '{}'::jsonb);
  insert into public.license_devices (id, license_id, device_fingerprint, device_name, device_info, is_active, security_token, device_role, device_mode)
  values (v_device_a, v_license_a, 'f5ar1-' || v_suffix, 'F5A R1 device', '{}'::jsonb, true, 'fixture-token', 'staff', 'shared');

  -- Numeric normalization is semantic: 10, 10.0 and "10.00" normalize alike.
  if private.canonical_financial_request_v1('cash.movement', jsonb_build_object('cash_session_id','s','type','entrada','amount',10,'concept','x'))
       is distinct from private.canonical_financial_request_v1('cash.movement', jsonb_build_object('cash_session_id','s','type','entrada','amount','10.00','concept','x')) then
    raise exception 'FINANCIAL_R1_NUMERIC_NORMALIZATION';
  end if;

  -- Sale canonicalization only admits explicit business fields.  Aliases and
  -- numeric spellings converge; metadata/UI/timestamps do not; order does.
  v_sale_a := private.canonical_financial_request_v1('sale.cashier', jsonb_build_object(
    'sale', jsonb_build_object('cloudSaleId','sale-1','total','10.00','currency','mxn','metadata',jsonb_build_object('ui','a'),'createdAt','2026-01-02T03:04:05Z'),
    'items', jsonb_build_array(jsonb_build_object('productId','p1','qty','1.0','price',10,'total','10.00','metadata',jsonb_build_object('x',1))),
    'payments', jsonb_build_array(jsonb_build_object('paymentMethod','cash','amount','10.0','reference','r','timestamp','ignored'))
  ));
  v_sale_b := private.canonical_financial_request_v1('sale.cashier', jsonb_build_object(
    'sale', jsonb_build_object('id','sale-1','total',10,'currency','MXN','metadata',jsonb_build_object('ui','b'),'created_at','2026-01-02T03:04:05+00:00'),
    'items', jsonb_build_array(jsonb_build_object('product_id','p1','quantity',1,'unit_price','10.00','line_total',10,'ui_only','ignored')),
    'payments', jsonb_build_array(jsonb_build_object('method','cash','amount',10,'reference','r','ui_only','ignored'))
  ));
  if v_sale_a is distinct from v_sale_b then raise exception 'FINANCIAL_R2_SALE_ALIAS_OR_NUMERIC_NORMALIZATION'; end if;
  if private.canonical_financial_request_v1('sale.cashier', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('product_id','p','quantity',1)),'payments',jsonb_build_array(jsonb_build_object('method','cash','amount',1))))
       is distinct from private.canonical_financial_request_v1('sale.cashier', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('product_id','p','quantity',1)),'payments',jsonb_build_array(jsonb_build_object('method','efectivo','amount',1)))) then
    raise exception 'FINANCIAL_R3_PAYMENT_ALIAS_NORMALIZATION';
  end if;
  if private.canonical_financial_request_v1('sale.cashier_inventory', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('productId','p','qty',1,'batchesUsed',jsonb_build_array(jsonb_build_object('batchId','b1','usedQuantity','1.00')))),'payments','[]'::jsonb))
       is distinct from private.canonical_financial_request_v1('sale.cashier_inventory', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('product_id','p','quantity',1,'metadata',jsonb_build_object('batches_used',jsonb_build_array(jsonb_build_object('batch_id','b1','quantity',1))))),'payments','[]'::jsonb)) then
    raise exception 'FINANCIAL_R3_BATCH_ALLOCATION_ALIAS_NORMALIZATION';
  end if;
  if private.canonical_financial_request_v1('sale.cashier_inventory', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('product_id','p','quantity',1,'batches_used',jsonb_build_array(jsonb_build_object('batch_id','b1','quantity',1)))),'payments','[]'::jsonb))
       = private.canonical_financial_request_v1('sale.cashier_inventory', jsonb_build_object('sale',jsonb_build_object('total',1),'items',jsonb_build_array(jsonb_build_object('product_id','p','quantity',1,'batches_used',jsonb_build_array(jsonb_build_object('batch_id','b2','quantity',1)))),'payments','[]'::jsonb)) then
    raise exception 'FINANCIAL_R3_BATCH_ALLOCATION_NOT_HASHED';
  end if;
  if private.financial_execution_request_v1(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('batches_used',jsonb_build_array(jsonb_build_object('batch_id','b1','quantity',1,'provenance','preserved')))))) #> '{items,0,batches_used,0,provenance}' <> '"preserved"'::jsonb then
    raise exception 'FINANCIAL_R3_EXECUTION_BATCHES_USED_NOT_PRESERVED';
  end if;
  if private.canonical_financial_selected_modifiers_v1(jsonb_build_object('selectedModifiers',jsonb_build_array(jsonb_build_object('ingredientId','i1','ingredientQuantity','2.00','tracksInventory',false))))
       is distinct from private.canonical_financial_selected_modifiers_v1(jsonb_build_object('metadata',jsonb_build_object('selected_modifiers',jsonb_build_array(jsonb_build_object('ingredient_id','i1','ingredient_quantity',2))))) then
    raise exception 'FINANCIAL_R4_SELECTED_MODIFIER_ALIAS_NORMALIZATION';
  end if;
  if private.canonical_financial_selected_modifiers_v1(jsonb_build_object('selected_modifiers',jsonb_build_array(jsonb_build_object('ingredient_id','i1','quantity',1))))
       = private.canonical_financial_selected_modifiers_v1(jsonb_build_object('selected_modifiers',jsonb_build_array(jsonb_build_object('ingredient_id','i2','quantity',1)))) then
    raise exception 'FINANCIAL_R4_SELECTED_MODIFIER_NOT_HASHED';
  end if;
  if private.canonical_financial_request_v1('sale.cashier', jsonb_set(v_sale_a, '{items}', jsonb_build_array(jsonb_build_object('product_id','p2','quantity',1), jsonb_build_object('product_id','p1','quantity',1))))
       = private.canonical_financial_request_v1('sale.cashier', jsonb_set(v_sale_a, '{items}', jsonb_build_array(jsonb_build_object('product_id','p1','quantity',1), jsonb_build_object('product_id','p2','quantity',1)))) then
    raise exception 'FINANCIAL_R2_SALE_ITEM_ORDER_NOT_SEMANTIC';
  end if;

  v_hash := private.financial_operation_hash('sale.cancel', v_canonical, v_actor_x, null, null);
  v_operation := private.reserve_financial_operation_v1(v_license_a, 'external-k-' || v_suffix, v_hash,
    'sale.cancel', v_canonical, v_actor_x, v_device_a, null);
  v_operation := private.complete_financial_operation_v1(v_license_a, v_operation.idempotency_key,
    jsonb_build_object('success', true, 'idempotency_key', v_operation.idempotency_key, 'sale_id', 'sale-' || v_suffix));

  -- Stub only the auth-context seam inside this rolled-back local test so the
  -- public receipt contract is exercised without production credentials.
  perform set_config('financial_r1.license_id', v_license_a::text, true);
  perform set_config('financial_r1.device_id', v_device_a::text, true);
  perform set_config('financial_r1.actor_key', v_actor_x, true);
  create or replace function private.validate_pos_sync_context(text, text, text, text)
  returns jsonb language sql security definer set search_path = '' as $stub$
    select jsonb_build_object('license_id', current_setting('financial_r1.license_id'),
      'device_id', current_setting('financial_r1.device_id'), 'actor_key', current_setting('financial_r1.actor_key'))
  $stub$;
  create or replace function private.resolve_cash_actor_key(p_context jsonb)
  returns text language sql stable security definer set search_path = '' as $stub$
    select p_context->>'actor_key'
  $stub$;
  begin
    perform public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, null);
    raise exception 'FINANCIAL_R1_EXPECTED_PUBLIC_NULL_H_DENIAL';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_REQUEST_HASH_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
  select count(*) into v_before from public.pos_financial_operations;
  v_receipt := public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, v_hash);
  if v_receipt->>'status' <> 'COMPLETED' or v_receipt->'result' is distinct from v_operation.response_payload then
    raise exception 'FINANCIAL_R1_PUBLIC_RECEIPT_REPLAY';
  end if;
  if (public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, 'sha256:' || repeat('0', 64))->>'status') <> 'CONFLICT' then
    raise exception 'FINANCIAL_R1_PUBLIC_WRONG_H_CONFLICT';
  end if;
  perform set_config('financial_r1.actor_key', 'staff-user:other', true);
  begin
    perform public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, v_hash);
    raise exception 'FINANCIAL_R1_EXPECTED_PUBLIC_ACTOR_DENIAL';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_OPERATION_ORIGIN_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;
  perform set_config('financial_r1.actor_key', v_actor_x, true);
  perform set_config('financial_r1.license_id', v_license_b::text, true);
  if (public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, v_hash)->>'status') <> 'NOT_FOUND' then
    raise exception 'FINANCIAL_R1_PUBLIC_CROSS_TENANT_LEAK';
  end if;
  perform set_config('financial_r1.license_id', v_license_a::text, true);
  select count(*) into v_after from public.pos_financial_operations;
  if v_before <> v_after then raise exception 'FINANCIAL_R1_RECEIPT_SIDE_EFFECT'; end if;

  -- Strict row precedes legacy classification: an internal legacy key cannot
  -- poison same K/H replay and the original result is retained.
  insert into public.pos_idempotency_keys (license_id, idempotency_key, operation_type, status)
  values (v_license_a, v_operation.legacy_idempotency_key, 'legacy-test', 'completed');
  v_replay := private.reserve_financial_operation_v1(v_license_a, v_operation.idempotency_key, v_hash,
    'sale.cancel', v_canonical, v_actor_x, v_device_a, null);
  if v_replay.status <> 'completed' or v_replay.response_payload is distinct from v_operation.response_payload then
    raise exception 'FINANCIAL_R1_SAME_K_H_REPLAY';
  end if;

  v_other_hash := private.financial_operation_hash('sale.cancel', jsonb_build_object('sale_id','other','reason','test'), v_actor_x, null, null);
  begin
    -- Same K with changed current payload but stale H is invalid before replay
    -- lookup.  A recomputed valid H for the changed payload is then conflict.
    perform private.reserve_financial_operation_v1(v_license_a, v_operation.idempotency_key, v_hash,
      'sale.cancel', jsonb_build_object('sale_id','other','reason','test'), v_actor_x, v_device_a, null);
    raise exception 'FINANCIAL_R2_EXPECTED_STALE_HASH_DENIAL';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_REQUEST_HASH_INVALID' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform private.reserve_financial_operation_v1(v_license_a, v_operation.idempotency_key, v_other_hash,
      'sale.cancel', jsonb_build_object('sale_id','other','reason','test'), v_actor_x, v_device_a, null);
    raise exception 'FINANCIAL_R1_EXPECTED_K_H_CONFLICT';
  exception when sqlstate 'P0001' then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;

  if v_operation.legacy_idempotency_key is distinct from
     private.financial_operation_internal_key_v1(v_operation.operation_type, v_operation.id) then
    raise exception 'FINANCIAL_R3_INTERNAL_KEY_OPERATION_OWNERSHIP';
  end if;

  update public.pos_financial_operations set legacy_idempotency_key = 'tampered-' || v_suffix
  where id = v_operation.id;
  begin
    perform private.reserve_financial_operation_v1(v_license_a, v_operation.idempotency_key, v_hash,
      'sale.cancel', v_canonical, v_actor_x, v_device_a, null);
    raise exception 'FINANCIAL_R2_EXPECTED_INTERNAL_INTEGRITY';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_INTERNAL_IDEMPOTENCY_INTEGRITY' in sqlerrm) = 0 then raise; end if;
  end;
  if position(v_operation.legacy_idempotency_key in private.public_financial_response_v1('sale.cancel',
      jsonb_build_object('success',true,'idempotency_key',v_operation.legacy_idempotency_key), v_operation.idempotency_key, v_operation.legacy_idempotency_key)::text) > 0 then
    raise exception 'FINANCIAL_R2_INTERNAL_KEY_RESPONSE_LEAK';
  end if;
  v_receipt := private.public_financial_response_v1('cash.movement', jsonb_build_object(
    'success',true,'idempotency_key',v_operation.legacy_idempotency_key,
    'movement',jsonb_build_object('idempotency_key',v_operation.legacy_idempotency_key),
    'cash_session',jsonb_build_object('last_idempotency_key',v_operation.legacy_idempotency_key),
    'sale',jsonb_build_object('idempotency_key',v_operation.legacy_idempotency_key),
    'event',jsonb_build_object('idempotency_key',v_operation.legacy_idempotency_key),
    'items',jsonb_build_array(jsonb_build_object('idempotency_key',v_operation.legacy_idempotency_key)),
    'concept','financial-v1:looks-like-user-text'
  ), v_operation.idempotency_key, v_operation.legacy_idempotency_key);
  if position(v_operation.legacy_idempotency_key in v_receipt::text) > 0
     or v_receipt #>> '{movement,idempotency_key}' <> v_operation.idempotency_key
     or v_receipt #>> '{cash_session,last_idempotency_key}' <> v_operation.idempotency_key
     or v_receipt #>> '{items,0,idempotency_key}' <> v_operation.idempotency_key
     or v_receipt->>'concept' <> 'financial-v1:looks-like-user-text' then
    raise exception 'FINANCIAL_R4_NESTED_INTERNAL_KEY_SANITIZATION';
  end if;
  begin
    perform private.assert_financial_legacy_result_terminal_v1('sale.cancel', jsonb_build_object('success',false,'code','SALE_NOT_FOUND'));
    raise exception 'FINANCIAL_R3_SUCCESS_FALSE_COMPLETED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_LEGACY_OPERATION_REJECTED:SALE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform private.assert_financial_legacy_result_terminal_v1('cash.movement', jsonb_build_object('success',false,'code','CASH_SESSION_NOT_OPEN'));
    raise exception 'FINANCIAL_R3_SECOND_SUCCESS_FALSE_COMPLETED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_LEGACY_OPERATION_REJECTED:CASH_SESSION_NOT_OPEN' in sqlerrm) = 0 then raise; end if;
  end;
  perform private.assert_financial_legacy_result_terminal_v1('sale.cancel', jsonb_build_object('success',true));
  begin
    perform private.assert_financial_operation_origin_v1(v_operation, 'staff-user:other', v_device_a, null);
    raise exception 'FINANCIAL_R1_EXPECTED_ACTOR_DENIAL';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_OPERATION_ORIGIN_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;

  -- A pre-existing K in the external namespace is never upgraded to K/H.
  insert into public.pos_idempotency_keys (license_id, idempotency_key, operation_type, status)
  values (v_license_a, 'legacy-external-' || v_suffix, 'legacy-test', 'completed');
  begin
    perform private.reserve_financial_operation_v1(v_license_a, 'legacy-external-' || v_suffix, v_hash,
      'sale.cancel', v_canonical, v_actor_x, v_device_a, null);
    raise exception 'FINANCIAL_R1_EXPECTED_LEGACY_DENIAL';
  exception when sqlstate 'P0001' then
    if position('LEGACY_IDEMPOTENCY_UNVERIFIED' in sqlerrm) = 0 then raise; end if;
  end;

  -- Tenant-scoped collision: the same external K can independently reserve in B.
  perform private.reserve_financial_operation_v1(v_license_b, v_operation.idempotency_key, v_hash,
    'sale.cancel', v_canonical, v_actor_x, null, null);
  select count(*) into v_before from public.pos_financial_operations;
  begin
    perform private.assert_financial_request_hash_v1(null);
    raise exception 'FINANCIAL_R1_EXPECTED_NULL_H_DENIAL';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_REQUEST_HASH_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
  select count(*) into v_after from public.pos_financial_operations;
  if v_before <> v_after then raise exception 'FINANCIAL_R1_HASH_GUARD_SIDE_EFFECT'; end if;
end;
$test$;

rollback;
