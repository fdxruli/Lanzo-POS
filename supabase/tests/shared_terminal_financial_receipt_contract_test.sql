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
  v_device_b uuid := extensions.gen_random_uuid();
  v_actor_x text := 'staff-user:' || extensions.gen_random_uuid()::text;
  v_station_a text := 'r6-station-a-' || v_suffix;
  v_station_b text := 'r6-station-b-' || v_suffix;
  v_session_b text := 'r6-session-b-' || v_suffix;
  v_open_operation public.pos_financial_operations;
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
  values
    (v_device_a, v_license_a, 'f5ar1-' || v_suffix, 'F5A R1 device', '{}'::jsonb, true, 'fixture-token', 'staff', 'shared'),
    (v_device_b, v_license_a, 'f5ar1-b-' || v_suffix, 'F5A R1 device B', '{}'::jsonb, true, 'fixture-token-b', 'staff', 'shared');
  insert into public.pos_cash_stations (id, license_id, station_key, status, binding_mode)
  values (v_station_a, v_license_a, 'r6-a-' || v_suffix, 'active', 'explicit'),
         (v_station_b, v_license_a, 'r6-b-' || v_suffix, 'active', 'explicit');
  insert into public.pos_cash_station_bindings (license_id, cash_station_id, device_id, binding_mode, status)
  values (v_license_a, v_station_a, v_device_a, 'explicit', 'active'),
         (v_license_a, v_station_b, v_device_b, 'explicit', 'active');
  if private.resolve_financial_cash_station_v1(v_license_a, v_device_a) <> v_station_a then
    raise exception 'FINANCIAL_R6_CASH_OPEN_STATION_RESOLUTION';
  end if;
  if private.financial_operation_hash('cash.open', private.canonical_financial_request_v1('cash.open', jsonb_build_object('opening_amount',100)), v_actor_x, null, v_station_a)
       = private.financial_operation_hash('cash.open', private.canonical_financial_request_v1('cash.open', jsonb_build_object('opening_amount',100)), v_actor_x, null, v_station_b) then
    raise exception 'FINANCIAL_R6_CASH_OPEN_STATION_HASH';
  end if;
  update public.pos_cash_station_bindings set status='retired' where license_id=v_license_a and device_id=v_device_a;
  begin perform private.resolve_financial_cash_station_v1(v_license_a, v_device_a); raise exception 'FINANCIAL_R6_CASH_OPEN_UNBOUND_ACCEPTED';
  exception when sqlstate 'P0001' then if position('CASH_STATION_UNRESOLVED' in sqlerrm)=0 then raise; end if; end;
  update public.pos_cash_station_bindings set status='active' where license_id=v_license_a and device_id=v_device_a;

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

  -- A cash.open reserves the active device station before dispatch.  A returned
  -- session from another station must abort completion, leaving no completed
  -- receipt; sessionless station-bound origin must also reject device B.
  insert into public.pos_cash_sessions (id, license_id, device_id, actor_key, responsible_name, cash_station_id)
  values (v_session_b, v_license_a, v_device_b, v_actor_x, 'R6 fixture', v_station_b);
  v_open_operation := private.reserve_financial_operation_v1(
    v_license_a, 'r6-open-' || v_suffix,
    private.financial_operation_hash('cash.open', private.canonical_financial_request_v1('cash.open', jsonb_build_object('opening_amount',100)), v_actor_x, null, v_station_a),
    'cash.open', private.canonical_financial_request_v1('cash.open', jsonb_build_object('opening_amount',100)),
    v_actor_x, v_device_a, null, v_station_a);
  begin
    perform private.complete_financial_operation_v1(v_license_a, v_open_operation.idempotency_key,
      jsonb_build_object('success',true,'cash_session_id',v_session_b));
    raise exception 'FINANCIAL_R6_CASH_OPEN_STATION_MISMATCH_COMPLETED';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_OPERATION_ORIGIN_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;
  if (select status from public.pos_financial_operations where id=v_open_operation.id) = 'completed' then
    raise exception 'FINANCIAL_R6_CASH_OPEN_STATION_MISMATCH_PERSISTED';
  end if;
  begin
    perform private.assert_financial_operation_origin_v1(v_open_operation, v_actor_x, v_device_b, null);
    raise exception 'FINANCIAL_R6_SESSIONLESS_STATION_AUTHORITY';
  exception when sqlstate 'P0001' then
    if position('FINANCIAL_OPERATION_ORIGIN_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;

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
  -- R6: the three sale mutations reject absent/blank session evidence before
  -- reservation or legacy dispatch.  The local auth seam above keeps this a
  -- rolled-back contract test rather than a real sale.
  select count(*) into v_before from public.pos_financial_operations;
  foreach v_receipt in array array[
    'sale.cashier'::jsonb, 'sale.cashier_inventory'::jsonb, 'sale.credit'::jsonb
  ] loop
    begin
      perform public.pos_execute_financial_operation_v1('fixture','fixture','fixture',null,
        'r6-missing-session-' || v_suffix || '-' || v_receipt #>> '{}', null, v_receipt #>> '{}',
        jsonb_build_object('sale',jsonb_build_object('total',1),'items','[]'::jsonb,'payments','[]'::jsonb,'cash_session_id','   '));
      raise exception 'FINANCIAL_R6_%_MISSING_SESSION_ACCEPTED', upper(replace(v_receipt #>> '{}','.','_'));
    exception when sqlstate 'P0001' then
      if position('FINANCIAL_CASH_SESSION_ID_REQUIRED' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
  select count(*) into v_after from public.pos_financial_operations;
  if v_before <> v_after then raise exception 'FINANCIAL_R6_SALE_MISSING_SESSION_RESERVED'; end if;
  -- FINANCIAL_R6_SALE_CASHIER_MISSING_SESSION
  -- FINANCIAL_R6_SALE_CASHIER_INVENTORY_MISSING_SESSION
  -- FINANCIAL_R6_SALE_CREDIT_MISSING_SESSION
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
  if public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, v_hash)
       is distinct from jsonb_build_object('status','NOT_FOUND')
     or public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, v_operation.idempotency_key, 'sha256:' || repeat('0',64))
       is distinct from jsonb_build_object('status','NOT_FOUND')
     or public.pos_get_financial_operation_receipt('fixture', 'fixture', 'fixture', null, 'missing-' || v_suffix, v_hash)
       is distinct from jsonb_build_object('status','NOT_FOUND') then
    raise exception 'FINANCIAL_R6_RECEIPT_CROSS_ACTOR_NON_DISCLOSURE';
  end if;
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

-- SHARED.TERMINAL.5A-R6: portable hash vectors and alias/null regressions.
-- Expected SHA-256 constants were frozen with Node's standards-based crypto
-- over the explicit UTF-8 canonical strings below, not by this SQL function.
do $r6$
declare
  v_a jsonb := '{"operation_type":"sale.cancel","request":{"reason":"test","sale_id":"sale-1"},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":null,"cash_station_id":null}}';
  v_b jsonb := '{"operation_type":"cash.movement","request":{"amount":"10","cash_session_id":"session-a","concept":"float","reference_id":null,"reference_type":null,"source":null,"type":"entrada"},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":"session-a","cash_station_id":"station-a"}}';
  v_c jsonb := '{"operation_type":"sale.cashier","request":{"cash_session_id":"session-a","customer_id":null,"items":[{"batch_allocations":[],"product_id":"product-a","quantity":"2","selected_modifiers":[]}],"payments":[{"amount":"20","method":"cash"}],"sale":{"id":"sale-a","sold_at":"2026-01-02T03:04:05.000000Z","total":"20"}},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":"session-a","cash_station_id":"station-a"}}';
  v_d jsonb := '{"operation_type":"cash.open","request":{"opening":{"opening_amount":"100","opening_origin":"manual"}},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":null,"cash_station_id":"station-a"}}';
  v_e jsonb := '{"operation_type":"cash.open","request":{"opening":{"opening_amount":"100","opening_origin":"manual"}},"request_contract_version":1,"verified_origin":{"actor_key":"actor-b","cash_session_id":null,"cash_station_id":"station-b"}}';
  v_sale_a jsonb;
  v_sale_b jsonb;
begin
  -- FINANCIAL_R6_FIXED_HASH_VECTOR_A
  if private.financial_canonical_json_v1(v_a) <> '{"operation_type":"sale.cancel","request":{"reason":"test","sale_id":"sale-1"},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":null,"cash_station_id":null}}'
     or private.financial_operation_hash('sale.cancel', v_a->'request', 'actor-a', null, null) <> 'sha256:b9a2aae4a9cbac969509bf776db9ac49d6169e4318151657d2d6842eb56d953b' then raise exception 'FINANCIAL_R6_FIXED_HASH_VECTOR_A'; end if;
  -- FINANCIAL_R6_FIXED_HASH_VECTOR_B
  if private.financial_canonical_json_v1(v_b) <> '{"operation_type":"cash.movement","request":{"amount":"10","cash_session_id":"session-a","concept":"float","reference_id":null,"reference_type":null,"source":null,"type":"entrada"},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":"session-a","cash_station_id":"station-a"}}'
     or private.financial_operation_hash('cash.movement', v_b->'request', 'actor-a', 'session-a', 'station-a') <> 'sha256:57142afa91156723a4695a48ecf277848c835da2d30c990f8625e0fc6b41b875' then raise exception 'FINANCIAL_R6_FIXED_HASH_VECTOR_B'; end if;
  -- FINANCIAL_R6_FIXED_HASH_VECTOR_C
  if private.financial_canonical_json_v1(v_c) <> '{"operation_type":"sale.cashier","request":{"cash_session_id":"session-a","customer_id":null,"items":[{"batch_allocations":[],"product_id":"product-a","quantity":"2","selected_modifiers":[]}],"payments":[{"amount":"20","method":"cash"}],"sale":{"id":"sale-a","sold_at":"2026-01-02T03:04:05.000000Z","total":"20"}},"request_contract_version":1,"verified_origin":{"actor_key":"actor-a","cash_session_id":"session-a","cash_station_id":"station-a"}}'
     or private.financial_operation_hash('sale.cashier', v_c->'request', 'actor-a', 'session-a', 'station-a') <> 'sha256:9aaf9ed23a8f01db515cee3e5469043af8240766d0c72d88663633812b8f5f88' then raise exception 'FINANCIAL_R6_FIXED_HASH_VECTOR_C'; end if;
  -- FINANCIAL_R6_FIXED_HASH_VECTOR_D
  if private.financial_operation_hash('cash.open', v_d->'request', 'actor-a', null, 'station-a') <> 'sha256:1105cf39098eb4b6a855bb7bf29fe5269008cdfc2817b04a15aa7af2c01d1002' then raise exception 'FINANCIAL_R6_FIXED_HASH_VECTOR_D'; end if;
  -- FINANCIAL_R6_FIXED_HASH_VECTOR_E (origin evidence changes H)
  if private.financial_operation_hash('cash.open', v_e->'request', 'actor-b', null, 'station-b') <> 'sha256:f6b5a9675db1aba16d44140e9e345f4ac1e52e5f4197b16dc5ebe120660ba6a1' then raise exception 'FINANCIAL_R6_FIXED_HASH_VECTOR_E'; end if;
  if private.financial_canonical_json_v1('{"z":1,"a":{"y":true,"b":null}}'::jsonb) <> '{"a":{"b":null,"y":true},"z":1}' then raise exception 'FINANCIAL_R6_OBJECT_KEY_ORDER'; end if;

  if private.canonical_financial_request_v1('cash.open', '{"opening_amount":null,"montoInicial":100}'::jsonb)
       = private.canonical_financial_request_v1('cash.open', '{"opening_amount":null,"montoInicial":500}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_CASH_OPEN'; end if;
  if private.canonical_financial_sale_v1('sale.cashier', '{"id":null,"cloudSaleId":"A"}'::jsonb)
       = private.canonical_financial_sale_v1('sale.cashier', '{"id":null,"cloudSaleId":"B"}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_SALE_ID'; end if;
  if private.canonical_financial_sale_v1('sale.cashier', '{"customer_id":"   ","customerId":"A"}'::jsonb)
       = private.canonical_financial_sale_v1('sale.cashier', '{"customer_id":"   ","customerId":"B"}'::jsonb) then raise exception 'FINANCIAL_R6_BLANK_FALLBACK_CUSTOMER'; end if;
  if private.canonical_financial_sale_item_v1('{"product_id":null,"productId":"A"}'::jsonb)
       = private.canonical_financial_sale_item_v1('{"product_id":null,"productId":"B"}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_PRODUCT'; end if;
  if private.canonical_financial_batch_allocations_v1('{"batches_used":[{"batch_id":null,"batchId":"A","quantity":1}]}'::jsonb)
       = private.canonical_financial_batch_allocations_v1('{"batches_used":[{"batch_id":null,"batchId":"B","quantity":1}]}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_BATCH'; end if;
  if private.canonical_financial_payment_v1('sale.cashier', '{"method":null,"paymentMethod":"cash"}'::jsonb)
       = private.canonical_financial_payment_v1('sale.cashier', '{"method":null,"paymentMethod":"card"}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_PAYMENT'; end if;
  if private.canonical_financial_sale_v1('sale.cashier', '{"sold_at":null,"timestamp":"2026-01-02T03:04:05Z"}'::jsonb)
       = private.canonical_financial_sale_v1('sale.cashier', '{"sold_at":null,"timestamp":"2026-01-02T03:04:06Z"}'::jsonb) then raise exception 'FINANCIAL_R6_NULL_FALLBACK_TIMESTAMP'; end if;
  if private.canonical_financial_sale_v1('sale.cashier', '{"soldAt":"2026-01-01T21:04:05-06:00"}'::jsonb)
       is distinct from private.canonical_financial_sale_v1('sale.cashier', '{"sold_at":"2026-01-02T03:04:05Z"}'::jsonb) then raise exception 'FINANCIAL_R6_ZONED_TIMESTAMP_EQUIVALENCE'; end if;
  begin perform private.financial_timestamp_v1('"2026-01-02T03:04:05"'::jsonb); raise exception 'FINANCIAL_R6_OFFSETLESS_TIMESTAMP_ACCEPTED';
  exception when sqlstate 'P0001' then if position('FINANCIAL_TIMESTAMP_INVALID' in sqlerrm) = 0 then raise; end if; end;
end;
$r6$;

rollback;
