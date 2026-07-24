begin;

create table if not exists public.pos_restaurant_orders (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  local_order_id text null,
  sale_id text null,
  table_label text null,
  customer_id text null,
  customer_name text null,
  status text not null default 'pending',
  fulfillment_status text not null default 'pending',
  source text not null default 'pos',
  notes text null,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  currency text not null default 'MXN',
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  updated_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  updated_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_to_kitchen_at timestamptz null,
  ready_at timestamptz null,
  delivered_at timestamptz null,
  cancelled_at timestamptz null,
  deleted_at timestamptz null,
  server_version integer not null default 1,
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_restaurant_orders_status_check check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_orders_fulfillment_status_check check (fulfillment_status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_orders_local_or_sale_required check (
    length(btrim(coalesce(local_order_id, ''))) > 0 or length(btrim(coalesce(sale_id, ''))) > 0
  )
);

create table if not exists public.pos_restaurant_order_items (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  restaurant_order_id text not null references public.pos_restaurant_orders(id) on delete cascade,
  local_line_id text null,
  product_id text null,
  product_name text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  notes text null,
  selected_modifiers jsonb not null default '[]'::jsonb,
  station_code text not null default 'kitchen',
  station_name text not null default 'Cocina',
  status text not null default 'pending',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_restaurant_order_items_status_check check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_order_items_product_name_not_blank check (length(btrim(product_name)) > 0),
  constraint pos_restaurant_order_items_station_code_not_blank check (length(btrim(station_code)) > 0)
);

alter table public.pos_restaurant_orders enable row level security;
alter table public.pos_restaurant_order_items enable row level security;

revoke all on table public.pos_restaurant_orders from anon, authenticated;
revoke all on table public.pos_restaurant_order_items from anon, authenticated;

create index if not exists pos_restaurant_orders_license_status_idx
  on public.pos_restaurant_orders (license_id, status)
  where deleted_at is null;

create index if not exists pos_restaurant_orders_license_fulfillment_idx
  on public.pos_restaurant_orders (license_id, fulfillment_status)
  where deleted_at is null;

create index if not exists pos_restaurant_orders_license_updated_idx
  on public.pos_restaurant_orders (license_id, updated_at desc);

create unique index if not exists pos_restaurant_orders_license_local_order_uidx
  on public.pos_restaurant_orders (license_id, local_order_id)
  where deleted_at is null and local_order_id is not null;

create unique index if not exists pos_restaurant_orders_license_sale_uidx
  on public.pos_restaurant_orders (license_id, sale_id)
  where deleted_at is null and sale_id is not null;

create index if not exists pos_restaurant_order_items_license_order_idx
  on public.pos_restaurant_order_items (license_id, restaurant_order_id)
  where deleted_at is null;

create index if not exists pos_restaurant_order_items_license_station_status_idx
  on public.pos_restaurant_order_items (license_id, station_code, status)
  where deleted_at is null;

create or replace function private.is_restaurant_order_status(p_status text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')
$$;

create or replace function private.normalize_restaurant_order_status(p_status text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')
      then lower(btrim(coalesce(p_status, '')))
    when lower(btrim(coalesce(p_status, ''))) in ('open', 'sent', 'sent_to_kitchen')
      then 'pending'
    else 'pending'
  end
$$;

create or replace function private.safe_jsonb_numeric(p_payload jsonb, p_key text, p_default numeric default 0)
returns numeric
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_value text;
begin
  v_value := nullif(btrim(coalesce(p_payload->>p_key, '')), '');
  if v_value is null then
    return coalesce(p_default, 0);
  end if;

  return v_value::numeric;
exception when others then
  return coalesce(p_default, 0);
end;
$$;

create or replace function private.assert_restaurant_orders_food_service(p_license_id uuid)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = p_license_id
  ) and not exists (
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
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return;
  end if;

  if coalesce((p_context->'staff_permissions'->>'pos')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'orders')::boolean, false) is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:restaurant_orders' using errcode = 'P0001';
end;
$$;

create or replace function private.assert_restaurant_order_read_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return;
  end if;

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
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_code text;
  v_station public.pos_preparation_stations;
begin
  perform private.ensure_default_preparation_station(p_license_id, p_device_id, p_staff_user_id);

  v_code := lower(btrim(coalesce(p_station_code, '')));
  if v_code is null or v_code = '' then
    v_code := 'kitchen';
  end if;

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
returns jsonb
language sql
stable
set search_path to ''
as $$
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

create or replace function private.pos_restaurant_order_to_jsonb(
  p_row public.pos_restaurant_orders,
  p_station_code text default null
)
returns jsonb
language sql
stable
set search_path to ''
as $$
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

create or replace function public.pos_upsert_restaurant_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_order jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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
$$;

create or replace function public.pos_get_restaurant_orders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_status text default null,
  p_station_code text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_include_completed boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_status text;
  v_station_code text;
  v_limit integer;
  v_offset integer;
  v_orders jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_status := nullif(btrim(coalesce(p_status, '')), '');
  if v_status is not null then
    v_status := private.normalize_restaurant_order_status(v_status);
  end if;

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

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

create or replace function public.pos_update_restaurant_order_status(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_restaurant_order_id text default null,
  p_status text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.2', 'statusUpdatedBy', 'pos_update_restaurant_order_status')
  where license_id = v_license_id
    and id = p_restaurant_order_id
  returning * into v_saved;

  update public.pos_restaurant_order_items
  set status = case
        when v_status in ('delivered', 'cancelled') then v_status
        else status
      end,
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
$$;

revoke all on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) from public;
revoke all on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamptz, timestamptz, boolean, integer, integer) from public;
revoke all on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) from public;

grant execute on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamptz, timestamptz, boolean, integer, integer) to anon, authenticated;
grant execute on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) to anon, authenticated;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'restaurant_orders_cloud', case when code = 'pro_monthly' then true else false end
)
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

commit;;
