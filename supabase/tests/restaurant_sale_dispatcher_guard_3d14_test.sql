-- Synthetic contract for the 3D.14 direct-sale guard.
-- The legacy idempotency function remains responsible for request-hash checks.
begin;

create function pg_temp.expect_dispatcher_required(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_sale jsonb,
  p_cash_session_id text,
  p_idempotency_key text,
  p_operation_type text
) returns void
language plpgsql
as $test$
begin
  begin
    perform private.assert_restaurant_sale_dispatcher_context_v1(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_sale, p_cash_session_id, p_idempotency_key, p_operation_type
    );
    raise exception 'EXPECTED_RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' then raise; end if;
  end;
end
$test$;

insert into public.pos_restaurant_orders (id, license_id, local_order_id) values
  ('parent-processing', '00000000-0000-0000-0000-000000000001', 'sale-processing'),
  ('parent-unreceipted', '00000000-0000-0000-0000-000000000001', 'sale-unreceipted'),
  ('parent-legacy-cash', '00000000-0000-0000-0000-000000000001', 'sale-legacy-cash'),
  ('parent-legacy-inventory', '00000000-0000-0000-0000-000000000001', 'sale-legacy-inventory'),
  ('parent-legacy-credit', '00000000-0000-0000-0000-000000000001', 'sale-legacy-credit'),
  ('parent-legacy-metadata-inventory', '00000000-0000-0000-0000-000000000001', 'sale-legacy-metadata-inventory'),
  ('parent-legacy-actor-mismatch', '00000000-0000-0000-0000-000000000001', 'sale-legacy-actor-mismatch'),
  ('parent-legacy-tenant-b', '00000000-0000-0000-0000-000000000002', 'sale-legacy-cash');

insert into public.pos_financial_operations (
  id, license_id, legacy_idempotency_key, operation_type, status, canonical_request,
  verified_actor_key, verified_device_id, verified_cash_session_id
) values (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'financial-key-processing',
  'sale.cashier',
  'processing',
  '{"sale":{"id":"sale-processing"}}',
  'admin:00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-00000000000a',
  'fixture-cash-session'
);

insert into public.pos_sales (
  id, license_id, local_sale_id, device_id, actor_key, cash_session_id, idempotency_key
) values
  ('sale-legacy-cash', '00000000-0000-0000-0000-000000000001',
   'sale-legacy-cash', '00000000-0000-0000-0000-00000000000a',
   'admin:00000000-0000-0000-0000-0000000000aa', 'fixture-cash-session',
   'sales.cloud_commit:sale-legacy-cash:00000000-0000-0000-0000-00000000000a'),
  ('sale-legacy-inventory', '00000000-0000-0000-0000-000000000001',
   'sale-legacy-inventory', '00000000-0000-0000-0000-00000000000a',
   'admin:00000000-0000-0000-0000-0000000000aa', 'fixture-cash-session',
   'sales.cloud_commit.inventory:sale-legacy-inventory:00000000-0000-0000-0000-00000000000a'),
  ('sale-legacy-credit', '00000000-0000-0000-0000-000000000001',
   'sale-legacy-credit', '00000000-0000-0000-0000-00000000000a',
   'admin:00000000-0000-0000-0000-0000000000aa', 'fixture-cash-session',
   'sales.cloud_credit:sale-legacy-credit:00000000-0000-0000-0000-00000000000a'),
  ('sale-legacy-metadata-inventory', '00000000-0000-0000-0000-000000000001',
   'sale-legacy-metadata-inventory', '00000000-0000-0000-0000-00000000000a',
   'admin:00000000-0000-0000-0000-0000000000aa', 'fixture-cash-session',
   'sales.cloud_commit.inventory:sale-legacy-metadata-inventory:00000000-0000-0000-0000-00000000000a'),
  ('sale-legacy-actor-mismatch', '00000000-0000-0000-0000-000000000001',
   'sale-legacy-actor-mismatch', '00000000-0000-0000-0000-00000000000a',
   'staff:00000000-0000-0000-0000-0000000000ab', 'fixture-cash-session',
   'sales.cloud_commit:sale-legacy-actor-mismatch:00000000-0000-0000-0000-00000000000a');

insert into public.pos_idempotency_keys (
  id, license_id, idempotency_key, operation_type, entity_type, entity_id,
  request_hash, response_payload, status, expires_at
)
select
  ('00000000-0000-0000-0000-' || lpad((200 + row_number() over ())::text, 12, '0'))::uuid,
  s.license_id,
  s.idempotency_key,
  case
    when s.idempotency_key like 'sales.cloud_commit.inventory:%' then 'sales.cloud_commit.inventory'
    when s.idempotency_key like 'sales.cloud_credit:%' then 'sales.cloud_credit'
    else 'sales.cloud_commit'
  end,
  'sale',
  s.id,
  'fixture-hash-' || s.id,
  jsonb_build_object('success', true, 'sale', jsonb_build_object('id', s.id)),
  'completed',
  now() - interval '8 days'
from public.pos_sales s;

do $test$
declare
  v_result jsonb;
  v_key text := 'sales.cloud_commit:sale-legacy-cash:00000000-0000-0000-0000-00000000000a';
begin
  -- A non-restaurant sale keeps the legacy path.
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"ordinary-sale"}', 'fixture-cash-session', null, 'sale.cashier'
  );

  -- An unreceipted direct attempt against a restaurant parent is rejected.
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-unreceipted","local_sale_id":"sale-unreceipted"}',
    'fixture-cash-session', 'new-direct-key', 'sale.cashier'
  );

  -- A matching server-created processing operation remains authorized.
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-processing","local_sale_id":"sale-processing"}',
    'fixture-cash-session', 'financial-key-processing', 'sale.cashier'
  );

  -- Same actor/device/session and a completed, expired receipt reaches R2B.
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'fixture-cash-session', v_key, 'sale.cashier'
  );
  v_result := private.r2b_assert_sale_idempotency_v1(
    '00000000-0000-0000-0000-000000000001', v_key, 'fixture-hash-sale-legacy-cash'
  );
  if v_result->>'status' <> 'completed'
     or v_result #>> '{response,sale,id}' <> 'sale-legacy-cash' then
    raise exception 'LEGACY_RECEIPT_REPLAY_FAILED';
  end if;

  -- Changed canonical request hashes still fail closed in the existing R2B check.
  begin
    perform private.r2b_assert_sale_idempotency_v1(
      '00000000-0000-0000-0000-000000000001', v_key, 'different-canonical-hash'
    );
    raise exception 'EXPECTED_IDEMPOTENCY_CONFLICT';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- All three public legacy operation kinds preserve exact receipt replay.
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-inventory","local_sale_id":"sale-legacy-inventory"}',
    'fixture-cash-session',
    'sales.cloud_commit.inventory:sale-legacy-inventory:00000000-0000-0000-0000-00000000000a',
    'sale.cashier_inventory'
  );
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-credit","local_sale_id":"sale-legacy-credit"}',
    'fixture-cash-session',
    'sales.cloud_credit:sale-legacy-credit:00000000-0000-0000-0000-00000000000a',
    'sale.credit'
  );
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-metadata-inventory","local_sale_id":"sale-legacy-metadata-inventory","metadata":{"cloudInventoryEffects":true}}',
    'fixture-cash-session',
    'sales.cloud_commit.inventory:sale-legacy-metadata-inventory:00000000-0000-0000-0000-00000000000a',
    'sale.cashier'
  );

  -- Wrong device, cash session, actor, missing hash/receipt, or tenant cannot
  -- use the existing receipt as a bypass.
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-b', 'fixture-token-b', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'fixture-cash-session', v_key, 'sale.cashier'
  );
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'other-cash-session', v_key, 'sale.cashier'
  );
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-actor-mismatch","local_sale_id":"sale-legacy-actor-mismatch"}',
    'fixture-cash-session',
    'sales.cloud_commit:sale-legacy-actor-mismatch:00000000-0000-0000-0000-00000000000a',
    'sale.cashier'
  );
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-b', 'fixture-device-b', 'fixture-token-b', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'fixture-cash-session', v_key, 'sale.cashier'
  );

  update public.pos_idempotency_keys set request_hash = null where idempotency_key = v_key;
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'fixture-cash-session', v_key, 'sale.cashier'
  );

  update public.pos_idempotency_keys
  set request_hash = 'fixture-hash-sale-legacy-cash', response_payload = null
  where idempotency_key = v_key;
  perform pg_temp.expect_dispatcher_required(
    'fixture-license-a', 'fixture-device-a', 'fixture-token-a', null,
    '{"id":"sale-legacy-cash","local_sale_id":"sale-legacy-cash"}',
    'fixture-cash-session', v_key, 'sale.cashier'
  );
end
$test$;

rollback;
select '3D14 helper legacy-replay contract: PASS' as result;
