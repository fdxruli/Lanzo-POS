-- ECOM.PHASE3.RESERVATION.ADMIN.SUMMARY.R1
-- Administrative inbox projection only. It exposes reservation timing/status,
-- never committed stock, batches, source product IDs, or audit internals.

create or replace function public.ecommerce_admin_list_orders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_filter text;
  v_limit integer;
  v_offset integer;
  v_orders jsonb;
  v_counts jsonb;
  v_has_more boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, 'ecommerce_admin_list_orders'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  v_filter := lower(btrim(coalesce(p_status, 'all')));
  if v_filter not in ('all','pending','new','seen','accepted','rejected','closed') then v_filter := 'all'; end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_orders as (
    select o.id, o.public_order_code, o.status, o.customer_name, o.fulfillment_method,
      coalesce((select sum(i.quantity) from public.ecommerce_order_items i where i.order_id = o.id), 0) as item_count,
      o.total, o.currency, o.created_at, o.seen_at, o.accepted_at, o.rejected_at,
      o.stock_reservation_status, o.stock_reservation_phase,
      o.stock_reservation_expires_at, o.fulfillment_hold_expires_at,
      o.fulfillment_status, o.payment_status, o.pos_conversion_status, o.pos_visibility_status,
      private.ecommerce_order_fulfillment_terminal_v1(o.fulfillment_status) as is_closed
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and (o.pos_visibility_status in ('pending','visible') or o.status = 'converted_to_sale')
  ), filtered_orders as (
    select * from visible_orders
     where v_filter = 'all'
        or (v_filter = 'pending' and status in ('new','seen'))
        or (v_filter = 'accepted' and status in ('accepted','converted_to_sale'))
        or (v_filter = 'closed' and is_closed)
        or status = v_filter
  ), page_rows as (
    select * from filtered_orders order by created_at desc, id desc limit v_limit + 1 offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'code', public_order_code, 'status', status, 'customerName', customer_name,
    'fulfillmentMethod', fulfillment_method, 'itemCount', item_count, 'total', total, 'currency', currency,
    'createdAt', created_at, 'seenAt', seen_at, 'acceptedAt', accepted_at, 'rejectedAt', rejected_at,
    'stockReservationStatus', stock_reservation_status, 'stockReservationPhase', stock_reservation_phase,
    'checkoutReservationExpiresAt', case when coalesce(stock_reservation_phase, 'checkout') = 'checkout' then stock_reservation_expires_at else null end,
    'fulfillmentHoldExpiresAt', fulfillment_hold_expires_at, 'fulfillmentStatus', fulfillment_status,
    'paymentStatus', payment_status, 'posConversionStatus', pos_conversion_status, 'posVisibilityStatus', pos_visibility_status
  )) order by created_at desc, id desc) filter (where row_number <= v_limit), '[]'::jsonb), count(*) > v_limit
    into v_orders, v_has_more
    from (select page_rows.*, row_number() over (order by created_at desc, id desc) as row_number from page_rows) numbered;

  select jsonb_build_object(
    'new', count(*) filter (where status = 'new'),
    'seen', count(*) filter (where status = 'seen'),
    'pending', count(*) filter (where status in ('new','seen')),
    'accepted', count(*) filter (where status in ('accepted','converted_to_sale')),
    'rejected', count(*) filter (where status = 'rejected'),
    'closed', count(*) filter (where private.ecommerce_order_fulfillment_terminal_v1(fulfillment_status)),
    'total', count(*)
  ) into v_counts
  from public.ecommerce_orders o
  where o.license_id = v_license_id
    and (o.pos_visibility_status in ('pending','visible') or o.status = 'converted_to_sale');

  return jsonb_build_object(
    'success', true, 'orders', coalesce(v_orders, '[]'::jsonb),
    'counts', coalesce(v_counts, jsonb_build_object('new',0,'seen',0,'pending',0,'accepted',0,'rejected',0,'closed',0,'total',0)),
    'pagination', jsonb_build_object('limit',v_limit,'offset',v_offset,'hasMore',coalesce(v_has_more,false)),
    'filter', v_filter
  );
exception when others then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

alter function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) owner to postgres;
revoke all on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) to authenticated;
