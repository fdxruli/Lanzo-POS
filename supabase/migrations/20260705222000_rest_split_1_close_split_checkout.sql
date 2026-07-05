-- FASE REST.SPLIT.1
-- Cierre cloud seguro para cobro separado / split bill.
-- Mantiene la firma existente de public.pos_close_restaurant_order_after_checkout(...).
-- Cambio compatible: cuando p_payment_summary.source = 'split_bill', la comanda cloud
-- se marca como pagada y entregada/cerrada para que no quede activa tras el split local.

create or replace function public.pos_close_restaurant_order_after_checkout(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null::text,
  p_staff_session_token text default null::text,
  p_local_order_id text default null::text,
  p_paid_sale_id text default null::text,
  p_paid_sale_folio text default null::text,
  p_paid_total numeric default null::numeric,
  p_payment_summary jsonb default '{}'::jsonb,
  p_idempotency_key text default null::text
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
  v_is_split_bill boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
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
  v_is_split_bill := coalesce(v_payment_summary->>'source', '') = 'split_bill';
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

  v_next_status := case
    when v_is_split_bill then 'delivered'
    when v_order.status in ('ready', 'delivered') then 'delivered'
    else v_order.status
  end;

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
        'phase', case when v_is_split_bill then 'REST.SPLIT.1' else 'REST.7' end,
        'closedBy', 'pos_close_restaurant_order_after_checkout',
        'paymentSummary', v_payment_summary,
        'paidSaleId', v_paid_sale_id,
        'paidSaleFolio', v_paid_sale_folio,
        'paidTotal', p_paid_total,
        'statusBefore', v_order.status,
        'statusAfter', v_next_status,
        'splitBillClose', v_is_split_bill
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'phase', case when v_is_split_bill then 'REST.SPLIT.1' else 'REST.7' end,
        'checkoutCloseBy', 'pos_close_restaurant_order_after_checkout',
        'paymentStatus', 'paid'
      )
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
      'paid_sale_folio', v_saved.paid_sale_folio,
      'split_bill_close', v_is_split_bill
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
$function$;
