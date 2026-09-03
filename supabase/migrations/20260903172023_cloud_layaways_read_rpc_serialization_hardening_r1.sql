-- CLOUD LAYAWAYS READ RPC SERIALIZATION HARDENING R1
--
-- The original read RPCs delegated to full-row JSON conversion, which exposed
-- every column of the composite row.  This migration keeps the
-- RPC signatures and tenant/authentication boundary unchanged while making
-- the returned projection explicit.
--
-- Forward-only and non-destructive.  The cloud_layaways capability is not
-- granted or changed here.

begin;

-- The server already validates variant selection during reservation and
-- recomputes unit cost from reservations/products during completion.  Keeping
-- free-form attributes and unit cost out of this canonical comparison lets a
-- redacted read snapshot be replayed without echoing client-controlled JSON
-- or margin data back to the device.
create or replace function private.canonical_layaway_item_v1(p_item jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'LAYAWAY_ITEM_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', private.layaway_request_text_v1(p_item, array['id']),
    'product_id', private.layaway_request_text_v1(p_item, array['product_id','productId','parentId']),
    'product_name', private.layaway_request_text_v1(p_item, array['product_name','productName','name']),
    'product_sku', private.layaway_request_text_v1(p_item, array['product_sku','productSku','sku']),
    'barcode', private.layaway_request_text_v1(p_item, array['barcode','barCode']),
    'category_id', private.layaway_request_text_v1(p_item, array['category_id','categoryId']),
    'category_name', private.layaway_request_text_v1(p_item, array['category_name','categoryName','rubro','category']),
    'rubro', private.layaway_request_text_v1(p_item, array['rubro','category','categoryName']),
    'batch_id', private.layaway_request_text_v1(p_item, array['batch_id','batchId']),
    'batch_sku', private.layaway_request_text_v1(p_item, array['batch_sku','batchSku']),
    'batch_expiry_date', private.layaway_request_text_v1(p_item, array['batch_expiry_date','batchExpiryDate','expiryDate']),
    'variant_id', private.layaway_request_text_v1(p_item, array['variant_id','variantId']),
    'size', private.layaway_request_text_v1(p_item, array['size','talla']),
    'color', private.layaway_request_text_v1(p_item, array['color','colorName']),
    'quantity', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['quantity','qty'])),
    'unit_price', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['unit_price','unitPrice','price'])),
    'line_total', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['line_total','lineTotal','total','exactTotal'])),
    'discount_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['discount_amount','discountAmount'])), '0'),
    'tax_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['tax_amount','taxAmount'])), '0')
  ));
end;
$function$;

create or replace function private.pos_layaway_public_items_to_jsonb_v1(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'id', nullif(btrim(coalesce(item->>'id', '')), ''),
            'product_id', nullif(btrim(coalesce(item->>'product_id', item->>'productId', item->>'parentId', '')), ''),
            'product_name', nullif(btrim(coalesce(item->>'product_name', item->>'productName', item->>'name', '')), ''),
            'product_sku', nullif(btrim(coalesce(item->>'product_sku', item->>'productSku', item->>'sku', '')), ''),
            'barcode', nullif(btrim(coalesce(item->>'barcode', item->>'barCode', '')), ''),
            'category_id', nullif(btrim(coalesce(item->>'category_id', item->>'categoryId', '')), ''),
            'category_name', nullif(btrim(coalesce(item->>'category_name', item->>'categoryName', item->>'rubro', item->>'category', '')), ''),
            'rubro', nullif(btrim(coalesce(item->>'rubro', item->>'category', item->>'categoryName', '')), ''),
            'batch_id', nullif(btrim(coalesce(item->>'batch_id', item->>'batchId', '')), ''),
            'batch_sku', nullif(btrim(coalesce(item->>'batch_sku', item->>'batchSku', '')), ''),
            'batch_expiry_date', nullif(btrim(coalesce(item->>'batch_expiry_date', item->>'batchExpiryDate', item->>'expiryDate', '')), ''),
            'variant_id', nullif(btrim(coalesce(item->>'variant_id', item->>'variantId', '')), ''),
            'size', nullif(btrim(coalesce(item->>'size', item->>'talla', '')), ''),
            'color', nullif(btrim(coalesce(item->>'color', item->>'colorName', '')), ''),
            'quantity', nullif(btrim(coalesce(item->>'quantity', item->>'qty', '')), ''),
            'unit_price', nullif(btrim(coalesce(item->>'unit_price', item->>'unitPrice', item->>'price', '')), ''),
            'line_subtotal', nullif(btrim(coalesce(item->>'line_subtotal', item->>'lineSubtotal', '')), ''),
            'line_total', nullif(btrim(coalesce(item->>'line_total', item->>'lineTotal', item->>'total', item->>'exactTotal', '')), ''),
            'discount_amount', nullif(btrim(coalesce(
              item->>'discount_amount',
              item->>'discountAmount',
              (item->'discount')->>'amount',
              ''
            )), ''),
            'tax_amount', nullif(btrim(coalesce(item->>'tax_amount', item->>'taxAmount', '')), '')
          )
        )
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array' then coalesce(p_items, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

-- Layaway data is a business snapshot.  Server provenance, auth/session
-- material, idempotency material, free-form metadata, costs, and refund
-- implementation identifiers are intentionally not part of this projection.
-- The existing write-response serializer is left unchanged; this read-only
-- serializer is used only by the two audited RPCs.
create or replace function private.pos_layaway_read_to_jsonb_v1(p_layaway public.pos_layaways)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', $1.id,
    'customer_id', $1.customer_id,
    'customer_name', $1.customer_name,
    'customer_phone', $1.customer_phone,
    'total_amount', $1.total_amount,
    'paid_amount', $1.paid_amount,
    'balance_due', $1.balance_due,
    'currency', $1.currency,
    'deadline', $1.deadline,
    'status', $1.status,
    'items', private.pos_layaway_public_items_to_jsonb_v1($1.items),
    'conversion_sale_id', $1.conversion_sale_id,
    'retained_money', $1.retained_money,
    'retained_amount', $1.retained_amount,
    'created_at', $1.created_at,
    'updated_at', $1.updated_at,
    'completed_at', $1.completed_at,
    'cancelled_at', $1.cancelled_at,
    'server_version', $1.server_version
  )) end
$function$;

create or replace function private.pos_layaway_payment_read_to_jsonb_v1(p_payment public.pos_layaway_payments)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', $1.id,
    'layaway_id', $1.layaway_id,
    'payment_method', $1.payment_method,
    'amount', $1.amount,
    'status', $1.status,
    'cash_movement_id', $1.cash_movement_id,
    'payment_type', case lower(coalesce(
      nullif(btrim($1.metadata->>'payment_type'), ''),
      nullif(btrim($1.metadata->>'paymentType'), ''),
      ''
    ))
      when 'initial_deposit' then 'initial_deposit'
      else 'installment'
    end,
    'created_at', $1.created_at,
    'refunded_at', $1.refunded_at,
    'server_version', $1.server_version
  )) end
$function$;

create or replace function private.pos_layaway_reservation_read_to_jsonb_v1(
  p_reservation public.pos_layaway_inventory_reservations
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', $1.id,
    'layaway_id', $1.layaway_id,
    'item_index', $1.item_index,
    'product_id', $1.product_id,
    'batch_id', $1.batch_id,
    'quantity', $1.quantity,
    'status', $1.status,
    'created_at', $1.created_at,
    'released_at', $1.released_at,
    'consumed_at', $1.consumed_at,
    'server_version', $1.server_version
  )) end
$function$;

-- The generic cash and inventory serializers are also used by other cloud
-- contracts, so read RPCs use dedicated projections rather than changing
-- those wider contracts.
create or replace function private.pos_layaway_public_cash_movement_to_jsonb_v1(
  p_movement public.pos_cash_movements
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', $1.id,
    'type', $1.type,
    'amount', $1.amount,
    'concept', $1.concept,
    'source', $1.source,
    'reference_type', $1.reference_type,
    'reference_id', $1.reference_id,
    'payment_id', nullif(btrim(coalesce($1.metadata->>'payment_id', $1.metadata->>'paymentId', '')), ''),
    'created_at', $1.created_at,
    'server_version', $1.server_version
  )) end
$function$;

create or replace function private.pos_layaway_public_inventory_movement_to_jsonb_v1(
  p_movement public.pos_inventory_movements
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case when $1.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', $1.id,
    'product_id', $1.product_id,
    'batch_id', $1.batch_id,
    'movement_type', $1.movement_type,
    'quantity', $1.quantity,
    'reason', $1.reason,
    'source', $1.source,
    'layaway_id', nullif(btrim(coalesce($1.metadata->>'layaway_id', $1.metadata->>'layawayId', '')), ''),
    'created_at', $1.created_at,
    'server_version', $1.server_version
  )) end
$function$;

create or replace function public.pos_get_layaway(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_layaway_id text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_layaway public.pos_layaways;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_inventory_movements jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  if nullif(btrim(coalesce(p_layaway_id, '')), '') is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id
     and l.id = p_layaway_id
     and l.deleted_at is null;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id
     and p.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.item_index), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id
     and r.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.reference_type = 'layaway'
     and m.reference_id = v_layaway.id
     and m.deleted_at is null;
  select coalesce(jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_inventory_movements
    from public.pos_inventory_movements m
   where m.license_id = v_license_id
     and m.metadata->>'layaway_id' = v_layaway.id;

  return jsonb_build_object(
    'success', true,
    'layaway', private.pos_layaway_read_to_jsonb_v1(v_layaway),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'inventory_movements', v_inventory_movements,
    'mode', 'cloud_layaway_read'
  );
end;
$function$;

create or replace function public.pos_pull_layaway_changes(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_since_change_seq bigint default 0,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_layaways jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_inventory_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;

  with changed_layaways as (
    select l.id
      from public.pos_layaways l
     where l.license_id = v_license_id
       and l.deleted_at is null
       and exists (
         select 1 from public.pos_sync_events e
          where e.license_id = v_license_id
            and e.change_seq > v_since
            and (
              (e.entity_type = 'layaway' and e.entity_id = l.id)
              or (e.entity_type = 'layaway_payment' and exists (
                select 1 from public.pos_layaway_payments lp
                 where lp.license_id = v_license_id
                   and lp.id = e.entity_id
                   and lp.layaway_id = l.id
              ))
              or (e.entity_type = 'layaway_inventory_reservation' and exists (
                select 1 from public.pos_layaway_inventory_reservations lr
                 where lr.license_id = v_license_id
                   and lr.id = e.entity_id
                   and lr.layaway_id = l.id
              ))
              or (e.entity_type in ('cash_movement', 'product', 'product_batch')
                  and e.metadata->>'layaway_id' = l.id)
            )
       )
     order by l.updated_at asc, l.id
     limit v_limit
  )
  select coalesce(jsonb_agg(private.pos_layaway_read_to_jsonb_v1(l) order by l.updated_at asc, l.id), '[]'::jsonb)
    into v_layaways
    from public.pos_layaways l
   where l.license_id = v_license_id
     and l.deleted_at is null
     and l.id in (select id from changed_layaways);

  select coalesce(jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id
     and p.layaway_id in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.created_at, r.id), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id
     and r.layaway_id in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.reference_type = 'layaway'
     and m.reference_id in (select value->>'id' from jsonb_array_elements(v_layaways))
     and m.deleted_at is null;
  select coalesce(jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_inventory_movements
    from public.pos_inventory_movements m
   where m.license_id = v_license_id
     and m.metadata->>'layaway_id' in (select value->>'id' from jsonb_array_elements(v_layaways));
  select coalesce(max(change_seq), 0)
    into v_latest_change_seq
    from public.pos_sync_events
   where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'layaways', v_layaways,
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'inventory_movements', v_inventory_movements,
    'since_change_seq', v_since,
    'latest_change_seq', v_latest_change_seq,
    'has_more', jsonb_array_length(v_layaways) >= v_limit,
    'mode', 'cloud_layaway_changes'
  );
end;
$function$;

grant execute on function public.pos_get_layaway(text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.pos_pull_layaway_changes(text, text, text, text, bigint, integer)
  to anon, authenticated;

commit;
