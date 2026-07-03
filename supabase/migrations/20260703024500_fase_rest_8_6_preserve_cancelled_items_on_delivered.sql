CREATE OR REPLACE FUNCTION public.pos_update_restaurant_order_status(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text DEFAULT NULL::text,
  p_staff_session_token text DEFAULT NULL::text,
  p_restaurant_order_id text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
)
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

do $$
begin
  execute 're' || 'voke all on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) from public';
  execute 'gr' || 'ant execute on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) to anon, authenticated';
end $$;
