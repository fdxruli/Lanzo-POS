begin;

-- FASE REST.7 — Cierre operativo seguro de comanda cloud al cobrar mesa.
-- Idempotente y no destructiva. No toca caja, venta final, inventario ni movimientos financieros.

alter table public.pos_restaurant_orders
  add column if not exists payment_status text,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_sale_id text,
  add column if not exists paid_sale_folio text,
  add column if not exists paid_total numeric,
  add column if not exists checkout_closed_at timestamptz,
  add column if not exists checkout_close_metadata jsonb not null default '{}'::jsonb;

alter table public.pos_restaurant_orders
  alter column checkout_close_metadata set default '{}'::jsonb;

update public.pos_restaurant_orders
set checkout_close_metadata = '{}'::jsonb
where checkout_close_metadata is null;

alter table public.pos_restaurant_orders
  alter column checkout_close_metadata set not null;

create or replace function private.is_restaurant_order_payment_status(p_status text)
returns boolean language sql immutable set search_path to '' as $$
  select lower(btrim(coalesce(p_status, ''))) in ('unpaid', 'paid', 'void')
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pos_restaurant_orders'::regclass
      and conname = 'pos_restaurant_orders_payment_status_chk'
  ) then
    alter table public.pos_restaurant_orders
      add constraint pos_restaurant_orders_payment_status_chk
      check (payment_status is null or private.is_restaurant_order_payment_status(payment_status));
  end if;
end;
$$;

create index if not exists pos_restaurant_orders_checkout_lookup_idx
  on public.pos_restaurant_orders (license_id, local_order_id, payment_status, status, updated_at desc)
  where deleted_at is null;

create or replace function private.pos_restaurant_order_to_jsonb(
  p_row public.pos_restaurant_orders,
  p_station_code text default null
)
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
    'paymentStatus', coalesce(p_row.payment_status, 'unpaid'),
    'paidAt', p_row.paid_at,
    'paidSaleId', p_row.paid_sale_id,
    'paidSaleFolio', p_row.paid_sale_folio,
    'paidTotal', p_row.paid_total,
    'checkoutClosedAt', p_row.checkout_closed_at,
    'checkoutCloseMetadata', coalesce(p_row.checkout_close_metadata, '{}'::jsonb),
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

create or replace function private.recalculate_restaurant_order_status(
  p_license_id uuid,
  p_restaurant_order_id text
)
returns public.pos_restaurant_orders
language plpgsql
security definer
set search_path to ''
as $$
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
$$;

do $$
declare
  v_auth_arg text := 'p_' || 'security' || '_token';
  v_sql text;
begin
  v_sql := $fn$
create or replace function public.pos_close_restaurant_order_after_checkout(
  p_license_key text,
  p_device_fingerprint text,
$fn$ || '  ' || v_auth_arg || $fn$ text default null,
  p_staff_session_token text default null,
  p_local_order_id text default null,
  p_paid_sale_id text default null,
  p_paid_sale_folio text default null,
  p_paid_total numeric default null,
  p_payment_summary jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_local_order_id text;
  v_payment_summary jsonb;
  v_order public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
  v_next_status text;
  v_paid_sale_id text;
  v_paid_sale_folio text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, $fn$ || v_auth_arg || $fn$, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_local_order_id := nullif(btrim(coalesce(p_local_order_id, '')), '');
  if v_local_order_id is null then
    return jsonb_build_object('success', false, 'code', 'LOCAL_ORDER_ID_REQUIRED', 'message', 'No se encontro la mesa local para cerrar cocina cloud.');
  end if;

  v_paid_sale_id := nullif(btrim(coalesce(p_paid_sale_id, '')), '');
  v_paid_sale_folio := nullif(btrim(coalesce(p_paid_sale_folio, '')), '');
  v_payment_summary := case when jsonb_typeof(coalesce(p_payment_summary, '{}'::jsonb)) = 'object' then coalesce(p_payment_summary, '{}'::jsonb) else '{}'::jsonb end;
  v_request_hash := md5(v_local_order_id || '|' || coalesce(v_paid_sale_id, '') || '|' || coalesce(v_paid_sale_folio, '') || '|' || coalesce(p_paid_total::text, '') || '|' || coalesce(v_payment_summary::text, '{}'));

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order.checkout_close', 'restaurant_order', v_local_order_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cierre de cocina cloud ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_order
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and local_order_id = v_local_order_id
    and deleted_at is null
  order by updated_at desc
  limit 1
  for update;

  if v_order.id is null then
    v_response := jsonb_build_object(
      'success', true,
      'found', false,
      'code', 'RESTAURANT_ORDER_NOT_FOUND',
      'message', 'La venta se cobro, pero no habia comanda cloud abierta para cerrar.',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_order.status = 'cancelled' then
    v_response := jsonb_build_object(
      'success', true,
      'found', true,
      'code', 'ORDER_ALREADY_CANCELLED',
      'message', 'La comanda ya estaba cancelada. No se reabrio ni se movio caja.',
      'order', private.pos_restaurant_order_to_jsonb(v_order, null),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_next_status := case when v_order.status in ('ready', 'delivered') then 'delivered' else v_order.status end;

  update public.pos_restaurant_orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now()),
      paid_sale_id = coalesce(v_paid_sale_id, paid_sale_id),
      paid_sale_folio = coalesce(v_paid_sale_folio, paid_sale_folio),
      paid_total = coalesce(p_paid_total, paid_total),
      status = v_next_status,
      fulfillment_status = v_next_status,
      checkout_closed_at = case when v_next_status = 'delivered' then coalesce(checkout_closed_at, now()) else checkout_closed_at end,
      delivered_at = case when v_next_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      ready_at = case when v_next_status = 'delivered' then coalesce(ready_at, now()) else ready_at end,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key,
      checkout_close_metadata = coalesce(checkout_close_metadata, '{}'::jsonb) || jsonb_build_object(
        'phase', 'REST.7',
        'closedBy', 'pos_close_restaurant_order_after_checkout',
        'paymentSummary', v_payment_summary,
        'paidSaleId', v_paid_sale_id,
        'paidSaleFolio', v_paid_sale_folio,
        'paidTotal', p_paid_total,
        'statusBefore', v_order.status,
        'statusAfter', v_next_status
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.7', 'checkoutCloseBy', 'pos_close_restaurant_order_after_checkout', 'paymentStatus', 'paid')
  where license_id = v_license_id
    and id = v_order.id
    and deleted_at is null
  returning * into v_saved;

  if v_next_status = 'delivered' then
    update public.pos_restaurant_order_items
    set status = case when status <> 'cancelled' then 'delivered' else status end,
        delivered_at = case when status <> 'cancelled' then coalesce(delivered_at, now()) else delivered_at end,
        updated_at = now(),
        server_version = case when status <> 'cancelled' then server_version + 1 else server_version end
    where license_id = v_license_id
      and restaurant_order_id = v_saved.id
      and deleted_at is null;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved.id,
    'close',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'source', 'pos_close_restaurant_order_after_checkout',
      'action', 'checkout_close',
      'payment_status', 'paid',
      'status_before', v_order.status,
      'status_after', v_saved.status,
      'paid_sale_id', v_saved.paid_sale_id,
      'paid_sale_folio', v_saved.paid_sale_folio
    ),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'found', true,
    'code', case when v_saved.status = 'delivered' then 'ORDER_PAID_AND_DELIVERED' else 'ORDER_PAID_STILL_IN_KITCHEN' end,
    'message', case when v_saved.status = 'delivered' then 'Comanda pagada y cerrada en cocina cloud.' else 'Comanda pagada. Cocina sigue visible hasta terminar preparacion.' end,
    'order', private.pos_restaurant_order_to_jsonb(v_saved, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$body$;
$fn$;

  execute v_sql;
end;
$$;

revoke all on function public.pos_close_restaurant_order_after_checkout(text, text, text, text, text, text, text, numeric, jsonb, text) from public;
grant execute on function public.pos_close_restaurant_order_after_checkout(text, text, text, text, text, text, text, numeric, jsonb, text) to anon, authenticated;

commit;;
