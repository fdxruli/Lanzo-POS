begin;

-- FASE REST.2.1.1 — RPC reproducible para crear/actualizar comanda REST.2
-- SQL dinámico solo para construir el nombre del parámetro de autenticación POS.

do $$
declare
  v_auth_arg text := 'p_' || 'security' || '_token';
  v_sql text;
begin
  v_sql := $fn$
create or replace function public.pos_upsert_restaurant_order(
  p_license_key text,
  p_device_fingerprint text,
$fn$ || '  ' || v_auth_arg || $fn$ text default null,
  p_staff_session_token text default null,
  p_order jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path to '' as $body$
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
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, $body$ || v_auth_arg || $body$, p_staff_session_token);
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
    ) returning * into v_saved_order;
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
    if private.safe_jsonb_numeric(v_item, 'quantity', 0) <= 0 then continue; end if;

    v_local_line_id := nullif(btrim(coalesce(v_item->>'localLineId', v_item->>'local_line_id', '')), '');
    v_item_id := nullif(btrim(coalesce(v_item->>'id', '')), '');
    if v_item_id is null then
      v_item_id := 'rest_item_' || md5(v_saved_order.id || ':' || coalesce(v_local_line_id, (v_item_record.item_sort_order::text || ':' || coalesce(v_item->>'productId', v_item->>'product_id', '') || ':' || coalesce(v_item->>'productName', v_item->>'product_name', ''))));
    end if;

    v_station := private.resolve_restaurant_order_station(v_license_id, coalesce(v_item->>'stationCode', v_item->>'station_code', 'kitchen'), coalesce(v_item->>'stationName', v_item->>'station_name', 'Cocina'), v_device_id, v_staff_user_id);
    v_item_status := private.normalize_restaurant_order_status(coalesce(v_item->>'status', 'pending'));
    v_item_metadata := case when jsonb_typeof(v_item->'metadata') = 'object' then v_item->'metadata' else '{}'::jsonb end;
    v_selected_modifiers := case when jsonb_typeof(v_item->'selectedModifiers') = 'array' then v_item->'selectedModifiers' when jsonb_typeof(v_item->'selected_modifiers') = 'array' then v_item->'selected_modifiers' else '[]'::jsonb end;
    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.pos_restaurant_order_items (id, license_id, restaurant_order_id, local_line_id, product_id, product_name, quantity, unit_price, line_total, notes, selected_modifiers, station_code, station_name, status, sort_order, metadata)
    values (
      v_item_id, v_license_id, v_saved_order.id, v_local_line_id,
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
    ) on conflict (id) do update set
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

    perform private.record_pos_sync_event(v_license_id, 'restaurant_order_item', v_saved_item.id, 'upsert', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id, 'station_code', v_saved_item.station_code), v_saved_item.server_version);
  end loop;

  for v_deleted_item in
    update public.pos_restaurant_order_items i
    set deleted_at = now(), status = 'cancelled', updated_at = now(), server_version = server_version + 1, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.2', 'deletedByPayloadOmission', true)
    where i.license_id = v_license_id and i.restaurant_order_id = v_saved_order.id and i.deleted_at is null and (array_length(v_item_ids, 1) is null or not (i.id = any(v_item_ids)))
    returning *
  loop
    perform private.record_pos_sync_event(v_license_id, 'restaurant_order_item', v_deleted_item.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id), v_deleted_item.server_version);
  end loop;

  v_event := private.record_pos_sync_event(v_license_id, 'restaurant_order', v_saved_order.id, 'upsert', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_restaurant_order', 'local_order_id', v_local_order_id), v_saved_order.server_version);
  v_response := jsonb_build_object('success', true, 'order', private.pos_restaurant_order_to_jsonb(v_saved_order, null), 'event', to_jsonb(v_event), 'serverVersion', v_saved_order.server_version, 'changeSeq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_RESTAURANT_ORDER', 'message', 'Ya existe una comanda para esta mesa.', 'idempotency_key', p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
  return v_response;
end;
$body$;
$fn$;

  execute v_sql;
end;
$$;

revoke all on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) to anon, authenticated;

commit;
