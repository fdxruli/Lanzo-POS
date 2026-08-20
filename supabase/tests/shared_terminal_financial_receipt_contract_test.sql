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
    perform private.reserve_financial_operation_v1(v_license_a, v_operation.idempotency_key, v_other_hash,
      'sale.cancel', jsonb_build_object('sale_id','other','reason','test'), v_actor_x, v_device_a, null);
    raise exception 'FINANCIAL_R1_EXPECTED_K_H_CONFLICT';
  exception when sqlstate 'P0001' then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
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
