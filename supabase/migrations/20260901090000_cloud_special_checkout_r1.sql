-- R1 — checkout cloud para split de mesas y entrega de apartados
--
-- Las ventas normales, los folios V/FG existentes y ecommerce no se modifican.
-- Esta migración añade dos operaciones financieras nuevas:
--   * sale.split: crea todos los tickets y cierra la comanda en una sola
--     transacción, con un folio global independiente por ticket.
--   * sale.layaway_complete: reconoce una entrega sin volver a mover Caja,
--     Inventario o deuda; exige que los abonos cloud cubran el total.
--
-- FREE/local sigue utilizando las rutas Dexie existentes.

alter table public.pos_sales
  add column if not exists layaway_id text;

create unique index if not exists ux_pos_sales_license_layaway_id
  on public.pos_sales (license_id, layaway_id)
  where layaway_id is not null and deleted_at is null;

comment on column public.pos_sales.layaway_id is
  'Stable cloud link to the local layaway completed by this sale; no cash/inventory/credit effect is created at delivery.';

create or replace function private.canonical_financial_request_v1(
  p_operation_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_request jsonb := coalesce(p_request, '{}'::jsonb);
begin
  if jsonb_typeof(v_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'cash.open' then
      return jsonb_build_object('opening', jsonb_build_object(
        'opening_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_amount','montoInicial'])),'0'),
        'opening_counted_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_counted_amount','montoContado','montoContadoInicial'])),
        'opening_suggested_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_suggested_amount','montoSugerido'])),
        'opening_policy', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_policy','politicaApertura'])),
        'opening_origin', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_origin','origen'])),
        'is_auto_opening', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['is_auto_opening','esAutoApertura'])),
        'responsible_name', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['responsible_name','responsable']))
      ));
    when 'cash.movement' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'type', v_request->>'type',
        'amount', private.financial_decimal_v1(v_request->'amount'),
        'concept', v_request->>'concept',
        'source', v_request->>'source',
        'reference_type', v_request->>'reference_type',
        'reference_id', v_request->>'reference_id'
      );
    when 'cash.adjust_initial_fund' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'new_opening_amount', private.financial_decimal_v1(v_request->'new_opening_amount'),
        'reason', v_request->>'reason',
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'cash.close' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'closing_counted_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['closing_counted_amount','countedAmount','montoFisicoTotal'])),
        'next_shift_fund', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['next_shift_fund','nextShiftFund','montoFondoSiguienteTurno'])),
        'comments', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['audit_comments','comments','comentarios'])),
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'cash.admin_close' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'closing_mode', v_request->>'closing_mode',
        'counted_amount', private.financial_decimal_v1(v_request->'counted_amount'),
        'next_shift_fund', private.financial_decimal_v1(v_request->'next_shift_fund'),
        'reason_code', v_request->>'reason_code',
        'comments', v_request->>'comments',
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'sale.cashier', 'sale.cashier_inventory', 'sale.credit' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_SALE_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'sale', private.canonical_financial_sale_v1(p_operation_type, v_request->'sale'),
        'items', (
          select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'items') with ordinality
        ),
        'payments', (
          select coalesce(jsonb_agg(private.canonical_financial_payment_v1(p_operation_type, value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'payments') with ordinality
        ),
        'cash_session_id', private.financial_text_v1(v_request->'cash_session_id'),
        'customer_id', private.financial_text_v1(v_request->'customer_id')
      );
    when 'sale.split' then
      if jsonb_typeof(v_request->'children') <> 'array'
         or jsonb_array_length(coalesce(v_request->'children', '[]'::jsonb)) < 2 then
        raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'parent_order_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_id','parentOrderId'])),
        'parent_order_version', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_version','parentOrderVersion'])),
        'split_group_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['split_group_id','splitGroupId'])),
        'cash_session_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['cash_session_id','cashSessionId'])),
        'children', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'label', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(value, array['label'])),
              'sale', private.canonical_financial_sale_v1(
                case
                  when lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', '')) in ('credit','fiado','mixed_credit','partial_credit')
                    then 'sale.credit'
                  when coalesce((value->'sale'->'metadata'->>'cloudInventoryEffects')::boolean, false)
                    then 'sale.cashier_inventory'
                  else 'sale.cashier'
                end,
                value->'sale'
              ),
              'items', (
                select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(item_value) order by item_ordinality), '[]'::jsonb)
                from jsonb_array_elements(coalesce(value->'items', '[]'::jsonb)) with ordinality as item_rows(item_value, item_ordinality)
              ),
              'payments', (
                select coalesce(jsonb_agg(
                  private.canonical_financial_payment_v1(
                    case
                      when lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', '')) in ('credit','fiado','mixed_credit','partial_credit')
                        then 'sale.credit'
                      when coalesce((value->'sale'->'metadata'->>'cloudInventoryEffects')::boolean, false)
                        then 'sale.cashier_inventory'
                      else 'sale.cashier'
                    end,
                    payment_value
                  ) order by payment_ordinality
                ), '[]'::jsonb)
                from jsonb_array_elements(coalesce(value->'payments', '[]'::jsonb)) with ordinality as payment_rows(payment_value, payment_ordinality)
              ),
              'customer_id', private.financial_text_v1(
                coalesce(
                  nullif(btrim(value->>'customer_id'), ''),
                  nullif(btrim(value->'sale'->>'customer_id'), ''),
                  nullif(btrim(value->'sale'->>'customerId'), '')
                )
              )
            ) order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(v_request->'children') with ordinality
        )
      );
    when 'sale.layaway_complete' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'layaway_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['layaway_id','layawayId'])),
        'sale', private.canonical_financial_sale_v1('sale.layaway_complete', v_request->'sale'),
        'items', (
          select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'items') with ordinality
        ),
        'payments', (
          select coalesce(jsonb_agg(private.canonical_financial_payment_v1('sale.layaway_complete', value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'payments') with ordinality
        )
      );
    when 'sale.cancel' then
      return jsonb_build_object('sale_id', v_request->>'sale_id', 'reason', v_request->>'reason');
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$function$;

create or replace function private.execute_split_sale_financial_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_split jsonb,
  p_internal_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_parent_order_id text;
  v_split_group_id text;
  v_cash_session_id text;
  v_child_count integer;
  v_child_index integer := 0;
  v_child jsonb;
  v_child_sale jsonb;
  v_child_response jsonb;
  v_child_sale_id text;
  v_child_label text;
  v_child_key text;
  v_payment_method text;
  v_is_credit boolean;
  v_inventory boolean;
  v_sales jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_tickets jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_payment_summary jsonb;
  v_close_response jsonb;
  v_order public.pos_restaurant_orders;
  v_labels text[] := array[]::text[];
  v_sale_ids text[] := array[]::text[];
  v_latest_change_seq bigint;
begin
  if jsonb_typeof(coalesce(p_split, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_parent_order_id := nullif(btrim(coalesce(p_split->>'parent_order_id', p_split->>'parentOrderId', '')), '');
  v_split_group_id := nullif(btrim(coalesce(p_split->>'split_group_id', p_split->>'splitGroupId', '')), '');
  v_cash_session_id := nullif(btrim(coalesce(p_split->>'cash_session_id', p_split->>'cashSessionId', '')), '');
  if v_parent_order_id is null then
    raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
  end if;
  if v_split_group_id is null then
    raise exception 'SPLIT_GROUP_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_cash_session_id is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_cash_session_station(
    v_license_id,
    v_device_id,
    v_cash_session_id
  );

  -- Per-license + parent advisory lock prevents two devices from settling the
  -- same table concurrently, even before the restaurant row is updated.
  perform pg_advisory_xact_lock(
    hashtext(v_license_id::text),
    hashtext('restaurant_split:' || v_parent_order_id)
  );

  select *
    into v_order
    from public.pos_restaurant_orders o
   where o.license_id = v_license_id
     and o.local_order_id = v_parent_order_id
     and o.deleted_at is null
   order by o.updated_at desc nulls last, o.id
   limit 1
   for update;

  if v_order.id is null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_order.payment_status, '')) = 'paid' then
    raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_split->'children', '[]'::jsonb)) <> 'array' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_child_count := jsonb_array_length(p_split->'children');
  if v_child_count < 2 or v_child_count > 8 then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;

  for v_child in
    select value
      from jsonb_array_elements(p_split->'children')
  loop
    v_child_index := v_child_index + 1;
    v_child_key := p_internal_idempotency_key || ':child:' || v_child_index::text;
    if jsonb_typeof(v_child) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;

    v_child_label := nullif(btrim(coalesce(v_child->>'label', '')), '');
    v_child_sale := coalesce(v_child->'sale', '{}'::jsonb);
    if v_child_label is null or jsonb_typeof(v_child_sale) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;
    if v_child_label = any(v_labels) then
      raise exception 'FINANCIAL_SPLIT_LABEL_DUPLICATE' using errcode = 'P0001';
    end if;
    v_labels := array_append(v_labels, v_child_label);

    v_child_sale_id := nullif(btrim(coalesce(v_child_sale->>'id', v_child_sale->>'cloud_sale_id', v_child_sale->>'cloudSaleId', '')), '');
    if v_child_sale_id is null then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_child_sale_id = any(v_sale_ids) then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_DUPLICATE' using errcode = 'P0001';
    end if;
    v_sale_ids := array_append(v_sale_ids, v_child_sale_id);

    v_payment_method := lower(coalesce(
      nullif(btrim(coalesce(v_child_sale->>'payment_method', v_child_sale->>'paymentMethod', '')), ''),
      'cash'
    ));
    v_is_credit := v_payment_method in ('credit', 'fiado', 'mixed_credit', 'partial_credit');
    v_inventory := coalesce((v_child_sale->'metadata'->>'cloudInventoryEffects')::boolean, false);

    if v_is_credit then
      perform private.assert_cloud_sales_credit_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_credit_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        coalesce(
          nullif(btrim(v_child->>'customer_id'), ''),
          nullif(btrim(v_child_sale->>'customer_id'), ''),
          nullif(btrim(v_child_sale->>'customerId'), '')
        ),
        v_child_key
      );
    elsif v_inventory then
      perform private.assert_cloud_sales_inventory_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_inventory_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    else
      perform private.assert_cloud_sales_cashier_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    end if;

    if coalesce((v_child_response->>'success')::boolean, false) is not true then
      raise exception 'SALE_SPLIT_CHILD_NOT_CONFIRMED:%', coalesce(v_child_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;

    if v_child_response->'sale' is null
       or v_child_response->'sale'->>'id' is null then
      raise exception 'SALE_SPLIT_CHILD_RESPONSE_INVALID' using errcode = 'P0001';
    end if;

    v_sales := v_sales || jsonb_build_array(v_child_response->'sale');
    v_items := v_items || coalesce(v_child_response->'items', '[]'::jsonb);
    v_payments := v_payments || coalesce(v_child_response->'payments', '[]'::jsonb);
    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'sale', v_child_response->'sale',
      'items', coalesce(v_child_response->'items', '[]'::jsonb),
      'payments', coalesce(v_child_response->'payments', '[]'::jsonb),
      'cash_session', v_child_response->'cash_session',
      'cash_movement', v_child_response->'cash_movement',
      'customer', v_child_response->'customer',
      'ledger_charge', v_child_response->'ledger_charge',
      'ledger_payment', v_child_response->'ledger_payment',
      'inventory_movements', coalesce(v_child_response->'inventory_movements', '[]'::jsonb),
      'event', v_child_response->'event'
    ));

    v_total := v_total + coalesce((v_child_response->'sale'->>'total')::numeric, 0);
    v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'saleId', v_child_response->'sale'->>'id',
      'folio', coalesce(v_child_response->'sale'->>'pos_folio', v_child_response->'sale'->>'folio'),
      'paymentMethod', v_child_response->'sale'->>'payment_method',
      'amountPaid', v_child_response->'sale'->>'amount_paid',
      'saldoPendiente', v_child_response->'sale'->>'balance_due',
      'customerId', v_child_response->'sale'->>'customer_id',
      'total', v_child_response->'sale'->>'total'
    ));
  end loop;

  if v_child_index <> v_child_count then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;
  if abs(round(v_total, 2) - round(coalesce(v_order.total, 0), 2)) > 0.005 then
    raise exception 'RESTAURANT_SPLIT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  v_payment_summary := jsonb_build_object(
    'source', 'split_bill',
    'splitGroupId', v_split_group_id,
    'parentOrderId', v_parent_order_id,
    'childSaleIds', coalesce((select jsonb_agg(value->>'id') from jsonb_array_elements(v_sales)), '[]'::jsonb),
    'tickets', v_tickets,
    'total', round(v_total, 2),
    'sourceMode', 'cloud_committed'
  );

  v_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_parent_order_id,
    v_split_group_id,
    'SPLIT-' || v_split_group_id,
    round(v_total, 2),
    v_payment_summary,
    p_internal_idempotency_key || ':restaurant-close'
  );

  if coalesce((v_close_response->>'success')::boolean, false) is not true then
    raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
  end if;

  select coalesce(max(change_seq), 0)
    into v_latest_change_seq
    from public.pos_sync_events
   where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_split',
    'parent_order_id', v_parent_order_id,
    'split_group_id', v_split_group_id,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'children', v_children,
    'restaurant_order_close', v_close_response,
    'total', round(v_total, 2),
    'change_seq', coalesce((v_close_response->>'changeSeq')::bigint, 0),
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_internal_idempotency_key
  );
end;
$function$;

create or replace function private.execute_layaway_completion_financial_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_request jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_layaway_id text;
  v_sale_id text;
  v_local_sale_id text;
  v_sale_payload jsonb;
  v_items_payload jsonb;
  v_payments_payload jsonb;
  v_metadata jsonb;
  v_item jsonb;
  v_payment jsonb;
  v_sale public.pos_sales;
  v_existing public.pos_sales;
  v_item_count integer;
  v_item_index integer := 0;
  v_payment_count integer;
  v_item_total numeric := 0;
  v_line_total numeric;
  v_qty numeric;
  v_unit_price numeric;
  v_raw_line_total numeric;
  v_total numeric;
  v_paid_total numeric;
  v_subtotal numeric;
  v_discount_total numeric;
  v_tax_total numeric;
  v_folio jsonb;
  v_cloud_folio text;
  v_folio_sequence bigint;
  v_sold_at timestamptz;
  v_created_at timestamptz;
  v_item_id text;
  v_payment_id text;
  v_latest_change_seq bigint;
  v_event public.pos_sync_events;
  v_items_response jsonb := '[]'::jsonb;
  v_payments_response jsonb := '[]'::jsonb;
  v_existing_item_response jsonb := '[]'::jsonb;
  v_existing_payment_response jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_sales_cashier_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_layaway_id := nullif(btrim(coalesce(p_request->>'layaway_id', p_request->>'layawayId', '')), '');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_license_id::text),
    hashtext('layaway_completion:' || v_layaway_id)
  );

  v_sale_payload := coalesce(p_request->'sale', '{}'::jsonb);
  v_items_payload := coalesce(p_request->'items', '[]'::jsonb);
  v_payments_payload := coalesce(p_request->'payments', '[]'::jsonb);
  if jsonb_typeof(v_sale_payload) <> 'object'
     or jsonb_typeof(v_items_payload) <> 'array'
     or jsonb_typeof(v_payments_payload) <> 'array' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_payments_payload) > 1 then
    raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
  end if;

  v_sale_id := nullif(btrim(coalesce(v_sale_payload->>'id', v_sale_payload->>'cloud_sale_id', v_sale_payload->>'cloudSaleId', '')), '');
  v_local_sale_id := nullif(btrim(coalesce(v_sale_payload->>'local_sale_id', v_sale_payload->>'localSaleId', v_sale_id, '')), '');
  if v_sale_id is null or v_local_sale_id is null then
    raise exception 'LAYAWAY_SALE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select *
    into v_existing
    from public.pos_sales s
   where s.license_id = v_license_id
     and s.layaway_id = v_layaway_id
     and s.deleted_at is null
   limit 1
   for update;

  if v_existing.id is not null then
    if v_existing.id is distinct from v_sale_id then
      raise exception 'LAYAWAY_ALREADY_CONVERTED_CLOUD' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
      into v_existing_item_response
      from public.pos_sale_items i
     where i.license_id = v_license_id and i.sale_id = v_existing.id;
    select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
      into v_existing_payment_response
      from public.pos_sale_payments p
     where p.license_id = v_license_id and p.sale_id = v_existing.id;
    select coalesce(max(change_seq), 0)
      into v_latest_change_seq
      from public.pos_sync_events
     where license_id = v_license_id;

    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'mode', 'cloud_layaway_completion',
      'sale', private.pos_sale_to_jsonb(v_existing),
      'items', v_existing_item_response,
      'payments', v_existing_payment_response,
      'inventory_movements', '[]'::jsonb,
      'cash_session', null,
      'cash_movement', null,
      'event', null,
      'change_seq', v_latest_change_seq,
      'latest_change_seq', v_latest_change_seq,
      'idempotency_key', p_idempotency_key
    );
  end if;

  v_item_count := jsonb_array_length(v_items_payload);
  if v_item_count <= 0 then
    raise exception 'LAYAWAY_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  v_total := private.pos_sale_jsonb_numeric(v_sale_payload, array['total'], 0);
  v_subtotal := private.pos_sale_jsonb_numeric(v_sale_payload, array['subtotal'], v_total);
  v_discount_total := private.pos_sale_jsonb_numeric(v_sale_payload, array['discount_total','discountTotal'], 0);
  v_tax_total := private.pos_sale_jsonb_numeric(v_sale_payload, array['tax_total','taxTotal'], 0);

  if v_total < 0 or v_subtotal < 0 or v_discount_total < 0 or v_tax_total < 0 then
    raise exception 'LAYAWAY_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_discount_total > 0.005 or v_tax_total > 0.005 or abs(v_subtotal - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  for v_item in
    select value
      from jsonb_array_elements(v_items_payload)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'LAYAWAY_ITEM_INVALID' using errcode = 'P0001';
    end if;
    v_qty := private.pos_sale_jsonb_numeric(v_item, array['quantity','qty'], 0);
    v_unit_price := private.pos_sale_jsonb_numeric(v_item, array['unit_price','unitPrice','price'], 0);
    v_raw_line_total := private.pos_sale_jsonb_numeric(v_item, array['line_total','lineTotal','total','exactTotal'], null);
    if v_qty <= 0 or v_unit_price < 0 then
      raise exception 'LAYAWAY_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_line_total := round(v_qty * v_unit_price, 2);
    if v_raw_line_total is not null and abs(v_raw_line_total - v_line_total) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_item_total := v_item_total + v_line_total;
  end loop;

  if abs(round(v_item_total, 2) - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(sum(m.amount), 0)
    into v_paid_total
    from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.deleted_at is null
     and m.type = 'entrada'
     and m.reference_type = 'layaway'
     and m.reference_id = v_layaway_id
     and coalesce(m.metadata->>'source', '') = 'layaway_payment';

  if v_paid_total < v_total - 0.005 then
    raise exception 'LAYAWAY_NOT_FULLY_PAID' using errcode = 'P0001';
  end if;
  if v_paid_total > v_total + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  v_folio := private.next_pos_sale_folio(v_license_id);
  v_cloud_folio := v_folio->>'folio';
  v_folio_sequence := (v_folio->>'sequence')::bigint;

  begin
    v_sold_at := coalesce(
      nullif(private.pos_sale_jsonb_text(v_sale_payload, array['sold_at','soldAt','timestamp']), '')::timestamptz,
      now()
    );
    v_created_at := coalesce(
      nullif(private.pos_sale_jsonb_text(v_sale_payload, array['created_at','createdAt','timestamp']), '')::timestamptz,
      v_sold_at
    );
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_TIMESTAMP_INVALID' using errcode = 'P0001';
  end;

  v_metadata := coalesce(v_sale_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
    'layawayId', v_layaway_id,
    'layawayCompletion', true,
    'cloudCommitted', true,
    'sourceMode', 'cloud_committed',
    'noCloudCashEffects', true,
    'noCloudInventoryEffects', true,
    'noCloudCreditEffects', true,
    'paymentVerifiedFromCloudMovements', true,
    'paidAmountVerified', round(v_paid_total, 2)
  );
  v_sale_payload := v_sale_payload
    || jsonb_build_object(
      'id', v_sale_id,
      'local_sale_id', v_local_sale_id,
      'metadata', v_metadata
    );

  insert into public.pos_sales (
    id, license_id, local_sale_id, device_id, staff_user_id, device_role, actor_key, actor_name,
    origin, source_mode, effects_status, status, fulfillment_status,
    payment_method, payment_status, folio, local_folio, cloud_folio, folio_sequence,
    sale_number, customer_id, customer_name, customer_phone,
    subtotal, discount_total, tax_total, total, amount_paid, change_amount, balance_due, currency,
    sold_at, created_at, updated_at, committed_at,
    cash_session_id, cash_movement_id, customer_ledger_id,
    cash_effect_status, inventory_effect_status, credit_effect_status,
    local_payload, metadata, idempotency_key, server_version, layaway_id
  ) values (
    v_sale_id, v_license_id, v_local_sale_id, v_device_id, v_staff_user_id,
    coalesce(v_context->>'device_role', 'staff'),
    private.resolve_cash_actor_key(v_context),
    private.resolve_cash_actor_name(v_context),
    'cloud', 'cloud_committed', 'payment_recorded', 'closed', 'fulfilled',
    'layaway_completed', 'paid', v_cloud_folio,
    private.pos_sale_jsonb_text(v_sale_payload, array['local_folio','localFolio','folio']),
    v_cloud_folio, v_folio_sequence, v_folio_sequence,
    private.pos_sale_jsonb_text(v_sale_payload, array['customer_id','customerId']),
    private.pos_sale_jsonb_text(v_sale_payload, array['customer_name','customerName']),
    private.pos_sale_jsonb_text(v_sale_payload, array['customer_phone','customerPhone']),
    round(v_subtotal, 2), round(v_discount_total, 2), round(v_tax_total, 2),
    round(v_total, 2), round(v_total, 2), 0, 0,
    coalesce(private.pos_sale_jsonb_text(v_sale_payload, array['currency']), 'MXN'),
    v_sold_at, v_created_at, now(), now(),
    null, null, null,
    'not_required', 'not_applied', 'not_applied',
    v_sale_payload, v_metadata, p_idempotency_key, 1, v_layaway_id
  )
  returning * into v_sale;

  for v_item in
    select value
      from jsonb_array_elements(v_items_payload)
  loop
    v_item_index := v_item_index + 1;
    v_item_id := coalesce(
      private.pos_sale_jsonb_text(v_item, array['id']),
      v_sale.id || ':item:' || v_item_index::text
    );
    v_qty := private.pos_sale_jsonb_numeric(v_item, array['quantity','qty'], 0);
    v_unit_price := private.pos_sale_jsonb_numeric(v_item, array['unit_price','unitPrice','price'], 0);
    v_line_total := round(v_qty * v_unit_price, 2);

    insert into public.pos_sale_items (
      id, license_id, sale_id, product_id, product_name, product_sku, barcode,
      category_id, category_name, quantity, unit_price, unit_cost, discount_amount,
      tax_amount, line_total, batch_id, batch_sku, batch_expiry_date, rubro, metadata, server_version
    ) values (
      v_item_id, v_license_id, v_sale.id,
      private.pos_sale_jsonb_text(v_item, array['product_id','productId','parentId']),
      coalesce(private.pos_sale_jsonb_text(v_item, array['product_name','productName','name']), 'Producto'),
      private.pos_sale_jsonb_text(v_item, array['product_sku','productSku','sku']),
      private.pos_sale_jsonb_text(v_item, array['barcode','barCode']),
      private.pos_sale_jsonb_text(v_item, array['category_id','categoryId']),
      private.pos_sale_jsonb_text(v_item, array['category_name','categoryName','rubro','category']),
      v_qty,
      v_unit_price,
      private.pos_sale_jsonb_numeric(v_item, array['unit_cost','unitCost','cost'], null),
      greatest(private.pos_sale_jsonb_numeric(v_item, array['discount_amount','discountAmount'], 0), 0),
      greatest(private.pos_sale_jsonb_numeric(v_item, array['tax_amount','taxAmount'], 0), 0),
      v_line_total,
      private.pos_sale_jsonb_text(v_item, array['batch_id','batchId']),
      private.pos_sale_jsonb_text(v_item, array['batch_sku','batchSku']),
      nullif(private.pos_sale_jsonb_text(v_item, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.pos_sale_jsonb_text(v_item, array['rubro','category','categoryName']),
      coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object(
        'layawayCompletion', true,
        'inventoryEffectStatus', 'not_applied'
      ),
      1
    );
  end loop;

  if jsonb_array_length(v_payments_payload) = 0 then
    v_payments_payload := jsonb_build_array(jsonb_build_object(
      'id', v_sale.id || ':payment:completion',
      'method', 'layaway_completed',
      'amount', round(v_total, 2),
      'received_amount', round(v_total, 2),
      'change_amount', 0
    ));
  end if;

  for v_payment in
    select value
      from jsonb_array_elements(v_payments_payload)
  loop
    v_payment_id := coalesce(
      private.pos_sale_jsonb_text(v_payment, array['id']),
      v_sale.id || ':payment:completion'
    );

    insert into public.pos_sale_payments (
      id, license_id, sale_id, method, amount, received_amount, change_amount,
      reference, cash_session_id, cash_movement_id, customer_ledger_id, metadata, server_version
    ) values (
      v_payment_id, v_license_id, v_sale.id, 'layaway_completed',
      round(v_total, 2), round(v_total, 2), 0,
      private.pos_sale_jsonb_text(v_payment, array['reference','ref']),
      null, null, null,
      coalesce(v_payment->'metadata', '{}'::jsonb) || jsonb_build_object(
        'layawayId', v_layaway_id,
        'source', 'layaway_completion',
        'cashAlreadyRecorded', true
      ),
      1
    );
  end loop;

  v_event := private.record_pos_sync_event(
    v_license_id, 'sale', v_sale.id, 'cloud_commit', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_cloud_folio,
      'pos_folio', v_sale.pos_folio,
      'source_mode', 'cloud_committed',
      'layaway_id', v_layaway_id,
      'cash_effect_status', 'not_required',
      'inventory_effect_status', 'not_applied',
      'credit_effect_status', 'not_applied'
    ),
    v_sale.server_version::integer
  );

  perform private.record_pos_sync_event(
    v_license_id, 'report', 'overview', 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', 'layaway_cloud_completion', 'sale_id', v_sale.id),
    1
  );

  perform private.record_pos_sale_audit_event(
    v_license_id, v_sale.id, 'sale.layaway_completed', v_device_id, v_staff_user_id,
    private.resolve_cash_actor_name(v_context),
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_cloud_folio,
      'pos_folio', v_sale.pos_folio,
      'layaway_id', v_layaway_id,
      'paid_total', round(v_paid_total, 2),
      'total', round(v_total, 2),
      'cash_effect_status', 'not_required',
      'inventory_effect_status', 'not_applied',
      'credit_effect_status', 'not_applied',
      'idempotency_key', p_idempotency_key
    )
  );

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
    into v_items_response
    from public.pos_sale_items i
   where i.license_id = v_license_id and i.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
    into v_payments_response
    from public.pos_sale_payments p
   where p.license_id = v_license_id and p.sale_id = v_sale.id;
  select coalesce(max(change_seq), 0)
    into v_latest_change_seq
    from public.pos_sync_events
   where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway_completion',
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_items_response,
    'payments', v_payments_response,
    'inventory_movements', '[]'::jsonb,
    'cash_session', null,
    'cash_movement', null,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

create or replace function public.pos_execute_financial_operation_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_idempotency_key text default null,
  p_request_hash text default null,
  p_operation_type text default null,
  p_request jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
set statement_timeout to '45s'
set lock_timeout to '20s'
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_canonical jsonb;
  v_execution jsonb;
  v_cash_station_id text;
  v_cash_session_id text;
  v_session_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('sale.cashier','sale.cashier_inventory','sale.credit','sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;

    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id
      into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.id = v_cash_session_id
       and s.deleted_at is null
     for update;

    if not found then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_session_station_id is null then
      raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_session_station_id is distinct from v_cash_station_id then
      raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('sale.cashier','sale.cashier_inventory','sale.credit','sale.split')
     and nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')),'') is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_operation_type in ('cash.open','sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
  v_execution := private.financial_execution_request_v1(p_request);
  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );

  if v_operation.status = 'completed' then
    return v_operation.response_payload;
  end if;

  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type',
        (v_execution->>'amount')::numeric, v_execution->>'concept',
        v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source',
          'reference_type', v_execution->>'reference_type',
          'reference_id', v_execution->>'reference_id'
        ))
      );
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric,
        v_execution->>'reason', (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.close' then
      v_response := public.pos_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode',
        (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments',
        (v_execution->>'expected_version')::integer, v_internal_idempotency_key
      );
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key
      );
    when 'sale.split' then
      v_response := private.execute_split_sale_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'sale.layaway_complete' then
      v_response := private.execute_layaway_completion_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, p_idempotency_key
      );
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key
      );
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;

  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;
