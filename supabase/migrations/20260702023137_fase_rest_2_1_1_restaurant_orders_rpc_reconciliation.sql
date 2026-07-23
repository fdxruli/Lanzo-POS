begin;

create or replace function private.is_restaurant_order_status(p_status text)
returns boolean language sql immutable set search_path to '' as $$
  select lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')
$$;

create or replace function private.normalize_restaurant_order_status(p_status text)
returns text language sql immutable set search_path to '' as $$
  select case
    when lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled') then lower(btrim(coalesce(p_status, '')))
    when lower(btrim(coalesce(p_status, ''))) in ('open', 'sent', 'sent_to_kitchen') then 'pending'
    else 'pending'
  end
$$;

create or replace function private.safe_jsonb_numeric(p_payload jsonb, p_key text, p_default numeric default 0)
returns numeric language plpgsql immutable set search_path to '' as $$
declare v_value text;
begin
  v_value := nullif(btrim(coalesce(p_payload->>p_key, '')), '');
  if v_value is null then return coalesce(p_default, 0); end if;
  return v_value::numeric;
exception when others then
  return coalesce(p_default, 0);
end;
$$;

create or replace function private.assert_restaurant_orders_food_service(p_license_id uuid)
returns void language plpgsql stable set search_path to '' as $$
begin
  if exists (select 1 from public.business_profiles bp where bp.license_id = p_license_id)
     and not exists (
       select 1
       from public.business_profiles bp
       cross join unnest(bp.business_type) as business_type_item
       where bp.license_id = p_license_id
         and business_type_item = 'food_service'
     ) then
    raise exception 'RESTAURANT_ORDERS_FOOD_SERVICE_REQUIRED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.assert_restaurant_order_write_permission(p_context jsonb)
returns void language plpgsql stable set search_path to '' as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then return; end if;
  if coalesce((p_context->'staff_permissions'->>'pos')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'orders')::boolean, false) is true then
    return;
  end if;
  raise exception 'POS_PERMISSION_DENIED:restaurant_orders' using errcode = 'P0001';
end;
$$;

create or replace function private.assert_restaurant_order_read_permission(p_context jsonb)
returns void language plpgsql stable set search_path to '' as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then return; end if;
  if coalesce((p_context->'staff_permissions'->>'orders')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'pos')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'kitchen')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'kds')::boolean, false) is true then
    return;
  end if;
  raise exception 'POS_PERMISSION_DENIED:restaurant_orders_read' using errcode = 'P0001';
end;
$$;

create or replace function private.resolve_restaurant_order_station(
  p_license_id uuid,
  p_station_code text,
  p_station_name text,
  p_device_id uuid default null,
  p_staff_user_id uuid default null
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_code text;
  v_station public.pos_preparation_stations;
begin
  perform private.ensure_default_preparation_station(p_license_id, p_device_id, p_staff_user_id);
  v_code := lower(btrim(coalesce(p_station_code, '')));
  if v_code is null or v_code = '' then v_code := 'kitchen'; end if;

  select * into v_station
  from public.pos_preparation_stations
  where license_id = p_license_id
    and code = v_code
    and is_active is true
    and deleted_at is null
  limit 1;

  if v_station.id is null then
    select * into v_station
    from public.pos_preparation_stations
    where license_id = p_license_id
      and code = 'kitchen'
      and is_active is true
      and deleted_at is null
    limit 1;
  end if;

  return jsonb_build_object(
    'code', coalesce(v_station.code, 'kitchen'),
    'name', coalesce(nullif(btrim(p_station_name), ''), v_station.name, 'Cocina')
  );
end;
$$;

create or replace function private.pos_restaurant_order_item_to_jsonb(p_row public.pos_restaurant_order_items)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'id', p_row.id,
    'localLineId', p_row.local_line_id,
    'productId', p_row.product_id,
    'productName', p_row.product_name,
    'quantity', p_row.quantity,
    'unitPrice', p_row.unit_price,
    'lineTotal', p_row.line_total,
    'notes', p_row.notes,
    'selectedModifiers', coalesce(p_row.selected_modifiers, '[]'::jsonb),
    'stationCode', p_row.station_code,
    'stationName', p_row.station_name,
    'status', p_row.status,
    'sortOrder', p_row.sort_order,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'serverVersion', p_row.server_version,
    'metadata', coalesce(p_row.metadata, '{}'::jsonb)
  )
$$;

create or replace function private.pos_restaurant_order_to_jsonb(p_row public.pos_restaurant_orders, p_station_code text default null)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'id', p_row.id,
    'localOrderId', p_row.local_order_id,
    'saleId', p_row.sale_id,
    'tableLabel', p_row.table_label,
    'customerId', p_row.customer_id,
    'customerName', p_row.customer_name,
    'status', p_row.status,
    'fulfillmentStatus', p_row.fulfillment_status,
    'source', p_row.source,
    'notes', p_row.notes,
    'subtotal', p_row.subtotal,
    'total', p_row.total,
    'currency', p_row.currency,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'sentToKitchenAt', p_row.sent_to_kitchen_at,
    'readyAt', p_row.ready_at,
    'deliveredAt', p_row.delivered_at,
    'cancelledAt', p_row.cancelled_at,
    'serverVersion', p_row.server_version,
    'metadata', coalesce(p_row.metadata, '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.pos_restaurant_order_item_to_jsonb(i) order by i.sort_order asc, i.created_at asc)
      from public.pos_restaurant_order_items i
      where i.license_id = p_row.license_id
        and i.restaurant_order_id = p_row.id
        and i.deleted_at is null
        and (nullif(btrim(coalesce(p_station_code, '')), '') is null or i.station_code = lower(btrim(p_station_code)))
    ), '[]'::jsonb)
  )
$$;

commit;;
