-- Read-only Production pg_get_functiondef snapshots captured 2026-10-30 (PostgreSQL 17.6).
-- Test fixture only; no rows, credentials or QA SQL are included.
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION private.recalculate_restaurant_order_status(p_license_id uuid, p_restaurant_order_id text)
 RETURNS pos_restaurant_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_total integer := 0;
  v_active integer := 0;
  v_preparing integer := 0;
  v_done integer := 0;
  v_next_status text;
  v_is_paid boolean := false;
begin
  select * into v_order
  from public.pos_restaurant_orders
  where license_id = p_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_order.id is null then
    return v_order;
  end if;

  if v_order.status in ('delivered', 'cancelled') then
    return v_order;
  end if;

  v_is_paid := lower(coalesce(v_order.payment_status, 'unpaid')) = 'paid';

  select
    count(*)::integer,
    count(*) filter (where status <> 'cancelled')::integer,
    count(*) filter (where status = 'preparing')::integer,
    count(*) filter (where status in ('ready', 'delivered'))::integer
  into v_total, v_active, v_preparing, v_done
  from public.pos_restaurant_order_items
  where license_id = p_license_id
    and restaurant_order_id = p_restaurant_order_id
    and deleted_at is null;

  if coalesce(v_total, 0) = 0 then
    return v_order;
  end if;

  if coalesce(v_active, 0) = 0 then
    v_next_status := 'cancelled';
  elsif v_done = v_active then
    v_next_status := case when v_is_paid then 'delivered' else 'ready' end;
  elsif v_preparing > 0 or v_done > 0 then
    v_next_status := 'preparing';
  else
    v_next_status := 'pending';
  end if;

  if v_order.status = v_next_status
     and v_order.fulfillment_status = v_next_status
     and (v_next_status <> 'delivered' or v_order.checkout_closed_at is not null) then
    return v_order;
  end if;

  update public.pos_restaurant_orders
  set status = v_next_status,
      fulfillment_status = v_next_status,
      updated_at = now(),
      sent_to_kitchen_at = case when v_next_status in ('pending', 'preparing', 'ready', 'delivered') then coalesce(sent_to_kitchen_at, now()) else sent_to_kitchen_at end,
      ready_at = case when v_next_status in ('ready', 'delivered') then coalesce(ready_at, now()) else ready_at end,
      delivered_at = case when v_next_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      checkout_closed_at = case when v_next_status = 'delivered' and v_is_paid then coalesce(checkout_closed_at, now()) else checkout_closed_at end,
      cancelled_at = case when v_next_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.7', 'statusRecalculatedBy', 'private.recalculate_restaurant_order_status')
  where license_id = p_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  returning * into v_saved;

  return coalesce(v_saved, v_order);
end;
$function$;
CREATE OR REPLACE FUNCTION public.pos_archive_restaurant_order_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_restaurant_order_id text DEFAULT NULL::text, p_reason text DEFAULT 'manual_archive'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_restaurant_order_id text;
  v_reason text;
  v_metadata jsonb;
  v_existing public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_idempotency_key text;
  v_request_hash text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_restaurant_order_id := nullif(btrim(coalesce(p_restaurant_order_id, '')), '');
  if v_restaurant_order_id is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ID_REQUIRED', 'message', 'No se encontro la comanda para archivar.');
  end if;

  v_reason := coalesce(nullif(btrim(p_reason), ''), 'manual_archive');
  v_metadata := case when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb) else '{}'::jsonb end;
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'restaurant:archive:' || v_restaurant_order_id || ':' || md5(v_reason || '|' || coalesce(v_metadata::text, '{}')));
  v_request_hash := md5(v_restaurant_order_id || '|' || v_reason || '|' || coalesce(v_metadata::text, '{}'));

  select * into v_existing
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and id = v_restaurant_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing.id is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_NOT_FOUND', 'message', 'No se encontro la comanda.');
  end if;

  if v_existing.status not in ('delivered', 'cancelled') then
    return jsonb_build_object(
      'success', false,
      'code', 'RESTAURANT_ORDER_ARCHIVE_NOT_TERMINAL',
      'message', 'Solo se pueden archivar comandas entregadas o canceladas.',
      'order', private.pos_restaurant_order_to_jsonb(v_existing, null)
    );
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, v_idempotency_key, 'restaurant_order.archive', 'restaurant_order', v_restaurant_order_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El archivo de la comanda ya se esta procesando.', 'idempotency_key', v_idempotency_key);
  end if;

  if v_existing.archived_at is not null then
    v_response := jsonb_build_object(
      'success', true,
      'alreadyArchived', true,
      'message', 'La comanda ya estaba archivada.',
      'order', private.pos_restaurant_order_to_jsonb(v_existing, null),
      'idempotency_key', v_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_restaurant_orders
  set archived_at = now(),
      archive_reason = v_reason,
      archive_metadata = coalesce(archive_metadata, '{}'::jsonb) || v_metadata || jsonb_build_object(
        'phase', 'REST.8',
        'archivedBy', 'pos_archive_restaurant_order',
        'statusBeforeArchive', v_existing.status
      ),
      archived_by_device_id = v_device_id,
      archived_by_staff_user_id = v_staff_user_id,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.8', 'archivedBy', 'pos_archive_restaurant_order')
  where license_id = v_license_id
    and id = v_restaurant_order_id
    and deleted_at is null
  returning * into v_saved;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved.id,
    'archive',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object(
      'source', 'pos_archive_restaurant_order',
      'action', 'archive',
      'reason', v_reason,
      'status', v_saved.status,
      'archived_at', v_saved.archived_at
    ),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'message', 'Comanda archivada.',
    'order', private.pos_restaurant_order_to_jsonb(v_saved, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', v_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
end;
$function$;
CREATE OR REPLACE FUNCTION public.pos_cancel_restaurant_order_from_pos_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_expected_parent_version text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '45s'
 SET lock_timeout TO '20s'
AS $function$
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
CREATE OR REPLACE FUNCTION public.pos_update_restaurant_order_item_status_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_restaurant_order_id text DEFAULT NULL::text, p_restaurant_order_item_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_status text;
  v_existing_order public.pos_restaurant_orders;
  v_saved_order public.pos_restaurant_orders;
  v_existing_item public.pos_restaurant_order_items;
  v_saved_item public.pos_restaurant_order_items;
  v_item_event public.pos_sync_events;
  v_order_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);

  if nullif(btrim(coalesce(p_restaurant_order_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ID_REQUIRED', 'message', 'No se encontro la comanda.');
  end if;

  if nullif(btrim(coalesce(p_restaurant_order_item_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEM_ID_REQUIRED', 'message', 'No se encontro el item de la comanda.');
  end if;

  if private.is_restaurant_order_status(p_status) is not true then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEM_STATUS_INVALID', 'message', 'Estado de item no valido.');
  end if;

  v_status := private.normalize_restaurant_order_status(p_status);

  select * into v_existing_order
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing_order.id is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_NOT_FOUND', 'message', 'No se encontro la comanda.');
  end if;

  if v_existing_order.status in ('delivered', 'cancelled') then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_TERMINAL_STATUS', 'message', 'La comanda ya esta cerrada.');
  end if;

  select * into v_existing_item
  from public.pos_restaurant_order_items
  where license_id = v_license_id
    and restaurant_order_id = p_restaurant_order_id
    and id = p_restaurant_order_item_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing_item.id is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEM_NOT_FOUND', 'message', 'No se encontro el item de la comanda.');
  end if;

  if v_status = 'cancelled' and v_existing_item.status not in ('pending', 'preparing') then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEM_CANCEL_NOT_ALLOWED', 'message', 'Solo se pueden cancelar items pendientes o en preparacion desde cocina.');
  end if;

  v_request_hash := md5(coalesce(p_restaurant_order_id, '') || '|' || coalesce(p_restaurant_order_item_id, '') || '|' || v_status);
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order_item.status_update', 'restaurant_order_item', p_restaurant_order_item_id, v_request_hash);

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cambio de item ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  update public.pos_restaurant_order_items
  set status = v_status,
      started_at = case when v_status in ('preparing', 'ready', 'delivered') then coalesce(started_at, now()) else started_at end,
      ready_at = case when v_status in ('ready', 'delivered') then coalesce(ready_at, now()) else ready_at end,
      delivered_at = case when v_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      cancelled_at = case when v_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      updated_at = now(),
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.4.1', 'statusUpdatedBy', 'pos_update_restaurant_order_item_status')
  where license_id = v_license_id
    and restaurant_order_id = p_restaurant_order_id
    and id = p_restaurant_order_item_id
    and deleted_at is null
  returning * into v_saved_item;

  v_item_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order_item',
    v_saved_item.id,
    'status_update',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'source', 'pos_update_restaurant_order_item_status',
      'restaurant_order_id', p_restaurant_order_id,
      'station_code', v_saved_item.station_code,
      'status', v_status
    ),
    v_saved_item.server_version
  );

  v_saved_order := private.recalculate_restaurant_order_status(v_license_id, p_restaurant_order_id);

  if v_saved_order.id is not null and (
    v_saved_order.server_version <> v_existing_order.server_version
    or v_saved_order.status <> v_existing_order.status
    or v_saved_order.fulfillment_status <> v_existing_order.fulfillment_status
  ) then
    v_order_event := private.record_pos_sync_event(
      v_license_id,
      'restaurant_order',
      v_saved_order.id,
      'status_recalculate',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object(
        'source', 'pos_update_restaurant_order_item_status',
        'item_id', v_saved_item.id,
        'status', v_saved_order.status
      ),
      v_saved_order.server_version
    );
  end if;

  v_response := jsonb_build_object(
    'success', true,
    'item', private.pos_restaurant_order_item_to_jsonb(v_saved_item),
    'order', private.pos_restaurant_order_to_jsonb(coalesce(v_saved_order, v_existing_order), null),
    'event', to_jsonb(v_item_event),
    'orderEvent', case when v_order_event.id is null then null else to_jsonb(v_order_event) end,
    'serverVersion', v_saved_item.server_version,
    'changeSeq', v_item_event.change_seq,
    'orderServerVersion', coalesce(v_saved_order.server_version, v_existing_order.server_version),
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;
CREATE OR REPLACE FUNCTION public.pos_update_restaurant_order_status_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_restaurant_order_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_status text;
  v_existing public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);

  if nullif(btrim(coalesce(p_restaurant_order_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ID_REQUIRED', 'message', 'No se encontro la comanda.');
  end if;

  if private.is_restaurant_order_status(p_status) is not true then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_STATUS_INVALID', 'message', 'Estado de comanda no valido.');
  end if;

  v_status := private.normalize_restaurant_order_status(p_status);

  select * into v_existing
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing.id is null then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_NOT_FOUND', 'message', 'No se encontro la comanda.');
  end if;

  if v_existing.status in ('delivered', 'cancelled') and v_existing.status <> v_status then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_TERMINAL_STATUS', 'message', 'La comanda ya esta cerrada.');
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order.status_update', 'restaurant_order', p_restaurant_order_id, v_status);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cambio de estado ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  update public.pos_restaurant_orders
  set status = v_status,
      fulfillment_status = v_status,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      updated_at = now(),
      sent_to_kitchen_at = case when v_status in ('pending', 'preparing', 'ready', 'delivered') then coalesce(sent_to_kitchen_at, now()) else sent_to_kitchen_at end,
      ready_at = case when v_status in ('ready', 'delivered') then coalesce(ready_at, now()) else ready_at end,
      delivered_at = case when v_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      cancelled_at = case when v_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.8.6', 'statusUpdatedBy', 'pos_update_restaurant_order_status')
  where license_id = v_license_id
    and id = p_restaurant_order_id
  returning * into v_saved;

  if v_status = 'delivered' then
    update public.pos_restaurant_order_items
    set status = 'delivered',
        delivered_at = coalesce(delivered_at, now()),
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        updated_at = now(),
        server_version = server_version + 1
    where license_id = v_license_id
      and restaurant_order_id = p_restaurant_order_id
      and deleted_at is null
      and status <> 'cancelled';
  elsif v_status = 'cancelled' then
    update public.pos_restaurant_order_items
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        updated_at = now(),
        server_version = server_version + 1
    where license_id = v_license_id
      and restaurant_order_id = p_restaurant_order_id
      and deleted_at is null
      and status <> 'cancelled';
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved.id,
    'status_update',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_update_restaurant_order_status', 'status', v_status),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', private.pos_restaurant_order_to_jsonb(v_saved, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;
CREATE OR REPLACE FUNCTION public.pos_upsert_restaurant_order_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_order jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_local_order_id text;
  v_sale_id text;
  v_order_id text;
  v_status text;
  v_fulfillment_status text;
  v_metadata jsonb;
  v_existing_order public.pos_restaurant_orders;
  v_saved_order public.pos_restaurant_orders;
  v_item_record record;
  v_item jsonb;
  v_item_id text;
  v_local_line_id text;
  v_station jsonb;
  v_item_ids text[] := array[]::text[];
  v_item_metadata jsonb;
  v_selected_modifiers jsonb;
  v_item_status text;
  v_saved_item public.pos_restaurant_order_items;
  v_deleted_item public.pos_restaurant_order_items;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);
  perform private.ensure_default_preparation_station(v_license_id, v_device_id, v_staff_user_id);

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEMS_INVALID', 'message', 'Los items de la comanda no son validos.');
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_EMPTY', 'message', 'La comanda no tiene productos.');
  end if;

  v_local_order_id := nullif(btrim(coalesce(p_order->>'localOrderId', p_order->>'local_order_id', '')), '');
  v_sale_id := nullif(btrim(coalesce(p_order->>'saleId', p_order->>'sale_id', v_local_order_id, '')), '');

  if v_local_order_id is null then
    return jsonb_build_object('success', false, 'code', 'LOCAL_ORDER_ID_REQUIRED', 'message', 'No se encontro la orden local.');
  end if;

  select * into v_existing_order
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and local_order_id = v_local_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing_order.id is null then
    v_order_id := nullif(btrim(coalesce(p_order->>'id', '')), '');
    if v_order_id is not null then
      select * into v_existing_order
      from public.pos_restaurant_orders
      where license_id = v_license_id
        and id = v_order_id
        and deleted_at is null
      limit 1
      for update;
    end if;
  end if;

  v_order_id := coalesce(v_existing_order.id, nullif(btrim(coalesce(p_order->>'id', '')), ''), 'rest_order_' || replace(gen_random_uuid()::text, '-', ''));

  v_request_hash := md5(coalesce(p_order::text, '') || '|' || coalesce(p_items::text, ''));
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order.upsert', 'restaurant_order', v_order_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La comanda ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  v_status := private.normalize_restaurant_order_status(coalesce(p_order->>'status', p_order->>'fulfillmentStatus', p_order->>'fulfillment_status', v_existing_order.status, 'pending'));
  v_fulfillment_status := private.normalize_restaurant_order_status(coalesce(p_order->>'fulfillmentStatus', p_order->>'fulfillment_status', v_status));
  v_metadata := case when jsonb_typeof(p_order->'metadata') = 'object' then p_order->'metadata' else '{}'::jsonb end;

  if v_existing_order.id is null then
    insert into public.pos_restaurant_orders (
      id, license_id, local_order_id, sale_id, table_label, customer_id, customer_name,
      status, fulfillment_status, source, notes, subtotal, total, currency,
      created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id,
      sent_to_kitchen_at, last_idempotency_key, metadata
    ) values (
      v_order_id,
      v_license_id,
      v_local_order_id,
      v_sale_id,
      nullif(btrim(coalesce(p_order->>'tableLabel', p_order->>'table_label', '')), ''),
      nullif(btrim(coalesce(p_order->>'customerId', p_order->>'customer_id', '')), ''),
      nullif(btrim(coalesce(p_order->>'customerName', p_order->>'customer_name', '')), ''),
      v_status,
      v_fulfillment_status,
      nullif(btrim(coalesce(p_order->>'source', '')), ''),
      nullif(coalesce(p_order->>'notes', ''), ''),
      private.safe_jsonb_numeric(p_order, 'subtotal', 0),
      private.safe_jsonb_numeric(p_order, 'total', 0),
      coalesce(nullif(btrim(p_order->>'currency'), ''), 'MXN'),
      v_device_id,
      v_device_id,
      v_staff_user_id,
      v_staff_user_id,
      now(),
      p_idempotency_key,
      v_metadata || jsonb_build_object('phase', 'REST.2')
    )
    returning * into v_saved_order;
  else
    update public.pos_restaurant_orders
    set sale_id = coalesce(v_sale_id, sale_id),
        table_label = nullif(btrim(coalesce(p_order->>'tableLabel', p_order->>'table_label', table_label, '')), ''),
        customer_id = nullif(btrim(coalesce(p_order->>'customerId', p_order->>'customer_id', customer_id, '')), ''),
        customer_name = nullif(btrim(coalesce(p_order->>'customerName', p_order->>'customer_name', customer_name, '')), ''),
        status = v_status,
        fulfillment_status = v_fulfillment_status,
        source = coalesce(nullif(btrim(p_order->>'source'), ''), source, 'pos'),
        notes = coalesce(p_order->>'notes', notes),
        subtotal = private.safe_jsonb_numeric(p_order, 'subtotal', subtotal),
        total = private.safe_jsonb_numeric(p_order, 'total', total),
        currency = coalesce(nullif(btrim(p_order->>'currency'), ''), currency, 'MXN'),
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        updated_at = now(),
        sent_to_kitchen_at = coalesce(sent_to_kitchen_at, now()),
        server_version = server_version + 1,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || v_metadata || jsonb_build_object('phase', 'REST.2')
    where license_id = v_license_id
      and id = v_existing_order.id
      and deleted_at is null
    returning * into v_saved_order;
  end if;

  for v_item_record in
    select value as payload, ordinality::integer as item_sort_order
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    v_item := v_item_record.payload;

    if private.safe_jsonb_numeric(v_item, 'quantity', 0) <= 0 then
      continue;
    end if;

    v_local_line_id := nullif(btrim(coalesce(v_item->>'localLineId', v_item->>'local_line_id', '')), '');
    v_item_id := nullif(btrim(coalesce(v_item->>'id', '')), '');

    if v_item_id is null then
      v_item_id := 'rest_item_' || md5(v_saved_order.id || ':' || coalesce(v_local_line_id, (v_item_record.item_sort_order::text || ':' || coalesce(v_item->>'productId', v_item->>'product_id', '') || ':' || coalesce(v_item->>'productName', v_item->>'product_name', ''))));
    end if;

    v_station := private.resolve_restaurant_order_station(
      v_license_id,
      coalesce(v_item->>'stationCode', v_item->>'station_code', 'kitchen'),
      coalesce(v_item->>'stationName', v_item->>'station_name', 'Cocina'),
      v_device_id,
      v_staff_user_id
    );
    v_item_status := private.normalize_restaurant_order_status(coalesce(v_item->>'status', 'pending'));
    v_item_metadata := case when jsonb_typeof(v_item->'metadata') = 'object' then v_item->'metadata' else '{}'::jsonb end;
    v_selected_modifiers := case when jsonb_typeof(v_item->'selectedModifiers') = 'array' then v_item->'selectedModifiers'
                                 when jsonb_typeof(v_item->'selected_modifiers') = 'array' then v_item->'selected_modifiers'
                                 else '[]'::jsonb end;

    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.pos_restaurant_order_items (
      id, license_id, restaurant_order_id, local_line_id, product_id, product_name,
      quantity, unit_price, line_total, notes, selected_modifiers,
      station_code, station_name, status, sort_order, metadata
    ) values (
      v_item_id,
      v_license_id,
      v_saved_order.id,
      v_local_line_id,
      nullif(btrim(coalesce(v_item->>'productId', v_item->>'product_id', '')), ''),
      coalesce(nullif(btrim(coalesce(v_item->>'productName', v_item->>'product_name', '')), ''), 'Producto'),
      private.safe_jsonb_numeric(v_item, 'quantity', 1),
      private.safe_jsonb_numeric(v_item, 'unitPrice', private.safe_jsonb_numeric(v_item, 'unit_price', 0)),
      private.safe_jsonb_numeric(v_item, 'lineTotal', private.safe_jsonb_numeric(v_item, 'line_total', 0)),
      nullif(coalesce(v_item->>'notes', ''), ''),
      v_selected_modifiers,
      coalesce(v_station->>'code', 'kitchen'),
      coalesce(v_station->>'name', 'Cocina'),
      v_item_status,
      coalesce(nullif(v_item->>'sortOrder', '')::integer, nullif(v_item->>'sort_order', '')::integer, v_item_record.item_sort_order - 1),
      v_item_metadata || jsonb_build_object('phase', 'REST.2')
    )
    on conflict (id) do update set
      local_line_id = excluded.local_line_id,
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      line_total = excluded.line_total,
      notes = excluded.notes,
      selected_modifiers = excluded.selected_modifiers,
      station_code = excluded.station_code,
      station_name = excluded.station_name,
      status = excluded.status,
      sort_order = excluded.sort_order,
      updated_at = now(),
      deleted_at = null,
      server_version = public.pos_restaurant_order_items.server_version + 1,
      metadata = coalesce(public.pos_restaurant_order_items.metadata, '{}'::jsonb) || excluded.metadata
    returning * into v_saved_item;

    perform private.record_pos_sync_event(
      v_license_id,
      'restaurant_order_item',
      v_saved_item.id,
      'upsert',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id, 'station_code', v_saved_item.station_code),
      v_saved_item.server_version
    );
  end loop;

  for v_deleted_item in
    update public.pos_restaurant_order_items i
    set deleted_at = now(),
        status = 'cancelled',
        updated_at = now(),
        server_version = server_version + 1,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.2', 'deletedByPayloadOmission', true)
    where i.license_id = v_license_id
      and i.restaurant_order_id = v_saved_order.id
      and i.deleted_at is null
      and (array_length(v_item_ids, 1) is null or not (i.id = any(v_item_ids)))
    returning *
  loop
    perform private.record_pos_sync_event(
      v_license_id,
      'restaurant_order_item',
      v_deleted_item.id,
      'delete',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id),
      v_deleted_item.server_version
    );
  end loop;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved_order.id,
    'upsert',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_upsert_restaurant_order', 'local_order_id', v_local_order_id),
    v_saved_order.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', private.pos_restaurant_order_to_jsonb(v_saved_order, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved_order.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_RESTAURANT_ORDER', 'message', 'Ya existe una comanda para esta mesa.', 'idempotency_key', p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  end if;
  return v_response;
end;
$function$;
set check_function_bodies = on;
revoke all on function private.recalculate_restaurant_order_status(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_archive_restaurant_order_unlimited(text,text,text,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_update_restaurant_order_item_status_unlimited(text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_upsert_restaurant_order_unlimited(text,text,text,text,jsonb,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_archive_restaurant_order_unlimited(text,text,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.pos_update_restaurant_order_item_status_unlimited(text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text) to service_role;
grant execute on function public.pos_upsert_restaurant_order_unlimited(text,text,text,text,jsonb,jsonb,text) to service_role;
