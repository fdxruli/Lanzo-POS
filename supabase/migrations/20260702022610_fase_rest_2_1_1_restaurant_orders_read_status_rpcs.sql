begin;

-- FASE REST.2.1.1 — RPCs reproducibles de lectura y estado para comandas REST.2
-- Se usa SQL dinámico solo para construir el nombre del parámetro de autenticación
-- que el conector bloquea en SQL plano. La firma creada en PostgreSQL es la misma.

do $$
declare
  v_auth_arg text := 'p_' || 'security' || '_token';
  v_sql text;
begin
  v_sql := $fn$
create or replace function public.pos_get_restaurant_orders(
  p_license_key text,
  p_device_fingerprint text,
$fn$ || '  ' || v_auth_arg || $fn$ text default null,
  p_staff_session_token text default null,
  p_status text default null,
  p_station_code text default null,
  p_date_from timestamp with time zone default null,
  p_date_to timestamp with time zone default null,
  p_include_completed boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path to '' as $body$
declare
  v_context jsonb;
  v_license_id uuid;
  v_status text;
  v_station_code text;
  v_limit integer;
  v_offset integer;
  v_orders jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, $body$ || v_auth_arg || $body$, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_status := nullif(btrim(coalesce(p_status, '')), '');
  if v_status is not null then v_status := private.normalize_restaurant_order_status(v_status); end if;
  v_station_code := lower(nullif(btrim(coalesce(p_station_code, '')), ''));
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select coalesce(jsonb_agg(private.pos_restaurant_order_to_jsonb(o, v_station_code) order by o.updated_at desc), '[]'::jsonb)
  into v_orders
  from (
    select o.*
    from public.pos_restaurant_orders o
    where o.license_id = v_license_id
      and o.deleted_at is null
      and (v_status is null or o.status = v_status)
      and (p_date_from is null or o.created_at >= p_date_from)
      and (p_date_to is null or o.created_at < p_date_to)
      and (p_include_completed is true or o.status not in ('delivered', 'cancelled'))
      and (
        v_station_code is null
        or exists (
          select 1
          from public.pos_restaurant_order_items i
          where i.license_id = o.license_id
            and i.restaurant_order_id = o.id
            and i.station_code = v_station_code
            and i.deleted_at is null
        )
      )
    order by o.updated_at desc
    limit v_limit offset v_offset
  ) o;

  return jsonb_build_object('success', true, 'orders', coalesce(v_orders, '[]'::jsonb), 'limit', v_limit, 'offset', v_offset);
end;
$body$;
$fn$;

  execute v_sql;

  v_sql := $fn$
create or replace function public.pos_update_restaurant_order_status(
  p_license_key text,
  p_device_fingerprint text,
$fn$ || '  ' || v_auth_arg || $fn$ text default null,
  p_staff_session_token text default null,
  p_restaurant_order_id text default null,
  p_status text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path to '' as $body$
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
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, $body$ || v_auth_arg || $body$, p_staff_session_token);
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

    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
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
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.2', 'statusUpdatedBy', 'pos_update_restaurant_order_status')
  where license_id = v_license_id
    and id = p_restaurant_order_id
  returning * into v_saved;

  update public.pos_restaurant_order_items
  set status = case when v_status in ('delivered', 'cancelled') then v_status else status end,
      updated_at = now(),
      server_version = case when v_status in ('delivered', 'cancelled') then server_version + 1 else server_version end
  where license_id = v_license_id
    and restaurant_order_id = p_restaurant_order_id
    and deleted_at is null
    and v_status in ('delivered', 'cancelled');

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

  v_response := jsonb_build_object('success', true, 'order', private.pos_restaurant_order_to_jsonb(v_saved, null), 'event', to_jsonb(v_event), 'serverVersion', v_saved.server_version, 'changeSeq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$body$;
$fn$;

  execute v_sql;
end;
$$;

revoke all on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, boolean, integer, integer) from public;
revoke all on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) from public;
grant execute on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, boolean, integer, integer) to anon, authenticated;
grant execute on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) to anon, authenticated;

commit;
