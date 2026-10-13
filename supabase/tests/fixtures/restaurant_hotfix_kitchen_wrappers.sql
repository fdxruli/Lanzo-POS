-- Read-only pg_get_functiondef snapshot, odlrhijtfyavryeqivaa, 2026-10-10.
-- ISOLATED TEST FIXTURE ONLY. Rate limiting and authentication are controlled
-- by the harness; all published wrapper and item mutation bodies are unchanged.

CREATE OR REPLACE FUNCTION public.pos_update_restaurant_order_status(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_restaurant_order_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_update_restaurant_order_status',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_update_restaurant_order_status_unlimited($1, $2, $3, $4, $5, $6, $7)::jsonb;
      END;
      $function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.pos_update_restaurant_order_item_status(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_restaurant_order_id text DEFAULT NULL::text, p_restaurant_order_item_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_update_restaurant_order_item_status',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_update_restaurant_order_item_status_unlimited($1, $2, $3, $4, $5, $6, $7, $8)::jsonb;
      END;
      $function$
;
