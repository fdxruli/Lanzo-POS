-- FASE REST.8 — Historial operativo y limpieza segura de comandas restaurante cloud
-- Idempotente y no destructiva.

alter table public.pos_restaurant_orders
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text,
  add column if not exists archive_metadata jsonb not null default '{}'::jsonb,
  add column if not exists archived_by_device_id uuid,
  add column if not exists archived_by_staff_user_id uuid;

alter table public.pos_restaurant_orders
  alter column archive_metadata set default '{}'::jsonb;

update public.pos_restaurant_orders
set archive_metadata = '{}'::jsonb
where archive_metadata is null;

alter table public.pos_restaurant_orders
  alter column archive_metadata set not null;

create index if not exists pos_restaurant_orders_active_lookup_idx
  on public.pos_restaurant_orders (license_id, status, payment_status, updated_at desc)
  where deleted_at is null and archived_at is null;

create index if not exists pos_restaurant_orders_history_lookup_idx
  on public.pos_restaurant_orders (license_id, archived_at desc, updated_at desc)
  where deleted_at is null;

create index if not exists pos_restaurant_orders_terminal_lookup_idx
  on public.pos_restaurant_orders (license_id, status, checkout_closed_at desc, updated_at desc)
  where deleted_at is null and status in ('delivered', 'cancelled');

create or replace function private.pos_restaurant_order_to_jsonb(
  p_row public.pos_restaurant_orders,
  p_station_code text default null
)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_row.id,
    'localOrderId', p_row.local_order_id,
    'saleId', p_row.sale_id,
    'tableLabel', p_row.table_label,
    'customerId', p_row.customer_id,
    'customerName', p_row.customer_name,
    'status', p_row.status,
    'fulfillmentStatus', p_row.fulfillment_status,
    'paymentStatus', coalesce(p_row.payment_status, 'unpaid'),
    'paidAt', p_row.paid_at,
    'paidSaleId', p_row.paid_sale_id,
    'paidSaleFolio', p_row.paid_sale_folio,
    'paidTotal', p_row.paid_total,
    'checkoutClosedAt', p_row.checkout_closed_at,
    'checkoutCloseMetadata', coalesce(p_row.checkout_close_metadata, '{}'::jsonb),
    'archivedAt', p_row.archived_at,
    'archiveReason', p_row.archive_reason,
    'archiveMetadata', coalesce(p_row.archive_metadata, '{}'::jsonb),
    'archivedByDeviceId', p_row.archived_by_device_id,
    'archivedByStaffUserId', p_row.archived_by_staff_user_id,
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
$function$;

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
as $function$
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
      and (p_include_completed is true or o.archived_at is null)
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
    'offset', v_offset,
    'includeArchived', p_include_completed
  );
end;
$function$;

create or replace function public.pos_get_restaurant_orders_history(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_status text;
  v_limit integer;
  v_orders jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_status := lower(nullif(btrim(coalesce(p_status, '')), ''));
  if v_status is not null then
    v_status := private.normalize_restaurant_order_status(v_status);
    if v_status not in ('delivered', 'cancelled') then
      return jsonb_build_object(
        'success', false,
        'code', 'RESTAURANT_ORDER_HISTORY_STATUS_INVALID',
        'message', 'El historial solo permite filtrar entregadas, canceladas o todas.'
      );
    end if;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 300);

  select coalesce(jsonb_agg(private.pos_restaurant_order_to_jsonb(o, null) order by coalesce(o.archived_at, o.checkout_closed_at, o.delivered_at, o.cancelled_at, o.updated_at) desc, o.updated_at desc), '[]'::jsonb)
  into v_orders
  from (
    select o.*
    from public.pos_restaurant_orders o
    where o.license_id = v_license_id
      and o.deleted_at is null
      and (o.status in ('delivered', 'cancelled') or o.archived_at is not null)
      and (v_status is null or o.status = v_status)
      and (p_from is null or coalesce(o.archived_at, o.checkout_closed_at, o.delivered_at, o.cancelled_at, o.updated_at, o.created_at) >= p_from)
      and (p_to is null or coalesce(o.archived_at, o.checkout_closed_at, o.delivered_at, o.cancelled_at, o.updated_at, o.created_at) < p_to)
    order by coalesce(o.archived_at, o.checkout_closed_at, o.delivered_at, o.cancelled_at, o.updated_at) desc, o.updated_at desc
    limit v_limit
  ) o;

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'limit', v_limit,
    'from', p_from,
    'to', p_to,
    'status', v_status
  );
end;
$function$;

create or replace function public.pos_archive_restaurant_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_restaurant_order_id text default null,
  p_reason text default 'manual_archive',
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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

grant execute on function public.pos_get_restaurant_orders_history(text, text, text, text, timestamptz, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.pos_archive_restaurant_order(text, text, text, text, text, text, jsonb, text) to anon, authenticated;;
