begin;

-- A late legacy upsert/Kitchen response may hold only the row lock. Preserve
-- the new POS terminal invariant at the row, without changing those RPCs or
-- the established Kitchen cancellation semantics.
create or replace function private.protect_restaurant_pos_cancellation_v1()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.status = 'cancelled' and old.metadata->>'cancelledFromPos' = 'true'
    and (new.status is distinct from 'cancelled'
      or new.fulfillment_status is distinct from 'cancelled'
      or new.cancelled_at is distinct from old.cancelled_at
      or new.payment_status is distinct from old.payment_status
      or new.metadata->>'cancelledFromPos' is distinct from 'true') then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
revoke all on function private.protect_restaurant_pos_cancellation_v1() from public, anon, authenticated, service_role;
create or replace trigger pos_restaurant_orders_pos_cancellation_terminal_v1
before update on public.pos_restaurant_orders for each row
execute function private.protect_restaurant_pos_cancellation_v1();

-- POS origin cancellation uses the same parent barrier as normal and split
-- settlement. Kitchen status RPCs and the financial dispatcher are unchanged.
create or replace function public.pos_cancel_restaurant_order_from_pos_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_local_order_id text default null,
  p_expected_parent_version text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout = '45s' set lock_timeout = '20s'
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_id uuid;
  v_order public.pos_restaurant_orders;
  v_version timestamptz;
  v_hash text;
  v_idem public.pos_idempotency_keys;
  v_response jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'refunds');
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_staff_id := nullif(v_context->>'staff_user_id', '')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);
  if v_device_id is null then raise exception 'DEVICE_AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_local_order_id), '') is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_expected_parent_version), '') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'RESTAURANT_CANCEL_REASON_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001'; end if;
  begin
    v_version := p_expected_parent_version::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end;

  -- Takes pg_advisory_xact_lock(license, restaurant_split:localOrderId),
  -- then SELECT FOR UPDATE, before the idempotency ledger or any effect.
  v_order := private.lock_restaurant_order_settlement_v1(v_license_id, p_local_order_id);
  if v_order.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.created_by_device_id is distinct from v_device_id then
    raise exception 'RESTAURANT_ORDER_REMOTE_CANCEL_BLOCKED' using errcode = 'P0001';
  end if;
  v_hash := md5(jsonb_build_object('operation', 'restaurant_order.cancel_from_pos',
    'localOrderId', p_local_order_id, 'expectedVersion', v_version,
    'reason', btrim(p_reason), 'deviceId', v_device_id, 'staffId', v_staff_id)::text);

  select * into v_idem from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_idem.operation_type is distinct from 'restaurant_order.cancel_from_pos'
       or v_idem.entity_id is distinct from p_local_order_id or v_idem.request_hash is distinct from v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    raise exception 'IDEMPOTENCY_PROCESSING' using errcode = 'P0001';
  end if;

  if lower(coalesce(v_order.payment_status, 'unpaid')) = 'paid'
      or v_order.paid_at is not null or v_order.paid_sale_id is not null then
    raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_order.deleted_at is not null or v_order.archived_at is not null or v_order.checkout_closed_at is not null then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' and v_order.fulfillment_status = 'cancelled' and v_order.cancelled_at is not null then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if coalesce(v_order.payment_status, 'unpaid') <> 'unpaid'
      or v_order.cancelled_at is not null
      or v_order.status not in ('pending','preparing','ready','delivered')
      or v_order.fulfillment_status not in ('pending','preparing','ready','delivered') then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_order.updated_at is distinct from v_version then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if not private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key,
      'restaurant_order.cancel_from_pos', 'restaurant_order', p_local_order_id, v_hash) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  update public.pos_restaurant_orders set status = 'cancelled', fulfillment_status = 'cancelled',
    cancelled_at = now(), updated_at = now(), server_version = server_version + 1,
    updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_id,
    last_idempotency_key = p_idempotency_key,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelledFromPos', true, 'cancelReason', btrim(p_reason), 'cancelContractVersion', 1)
    where license_id = v_license_id and id = v_order.id returning * into v_order;
  update public.pos_restaurant_order_items set status = 'cancelled', cancelled_at = now(),
    updated_at = now(), server_version = server_version + 1,
    updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_id
    where license_id = v_license_id and restaurant_order_id = v_order.id
      and deleted_at is null and status not in ('cancelled','delivered');
  perform private.record_pos_sync_event(v_license_id, 'restaurant_order', v_order.id, 'cancel',
    v_device_id, v_staff_id, p_idempotency_key,
    jsonb_build_object('source', 'pos_cancel_restaurant_order_from_pos_v1',
      'localOrderId', p_local_order_id, 'status', 'cancelled'), v_order.server_version);
  v_response := jsonb_build_object('success', true, 'localOrderId', p_local_order_id,
    'status', 'cancelled', 'serverVersion', v_order.server_version,
    'updatedAt', v_order.updated_at, 'cancelledAt', v_order.cancelled_at);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;
revoke all on function public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text) to anon, authenticated;

commit;
