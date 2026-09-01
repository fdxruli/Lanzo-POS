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

-- R1: split tickets may carry one controlled +/-$0.01 allocation cent.
CREATE OR REPLACE FUNCTION private.r2b_authorize_sale_financial_request_v1(p_operation_type text, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb, p_cash_session_id text, p_customer_id text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_idem jsonb;
  v_sale jsonb := coalesce(p_sale, '{}'::jsonb);
  v_item_payload jsonb;
  v_payment_payload jsonb;
  v_item record;
  v_payment record;
  v_product public.pos_products;
  v_selected_batch public.pos_product_batches;
  v_batch public.pos_product_batches;
  v_batch_payload jsonb;
  v_ecom_order public.ecommerce_orders;
  v_ecom_item record;
  v_ecom_order_id text;
  v_ecom_conversion_key text;
  v_seen_ecom_items text[] := array[]::text[];
  v_product_id text;
  v_batch_id text;
  v_batch_quantity numeric;
  v_quantity numeric;
  v_raw_unit_price numeric;
  v_raw_unit_cost numeric;
  v_raw_line_subtotal numeric;
  v_raw_line_total numeric;
  v_raw_discount_amount numeric;
  v_raw_tax_amount numeric;
  v_batch_count integer := 0;
  v_batches_used jsonb := '[]'::jsonb;
  v_batch_cost_total numeric := 0;
  v_batch_price_total numeric := 0;
  v_price_base_total numeric := 0;
  v_price_base_unit numeric := 0;
  v_price_reference_cost numeric := 0;
  v_selected_modifier_result jsonb;
  v_selected_modifiers jsonb := '[]'::jsonb;
  v_modifier_unit_total numeric := 0;
  v_is_variant boolean := false;
  v_inventory_mode boolean := false;
  v_server_unit_cost numeric;
  v_gross_line numeric;
  v_line_discount_result jsonb;
  v_line_discount numeric := 0;
  v_line_discount_total numeric := 0;
  v_gross_subtotal numeric := 0;
  v_sale_discount_result jsonb;
  v_sale_discount jsonb;
  v_sale_discount_amount numeric := 0;
  v_tax_total numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_incoming_sale_value numeric;
  v_raw_sale_discount jsonb;
  v_raw_item_discount jsonb;
  v_raw_batches jsonb;
  v_tier jsonb;
  v_tier_min numeric;
  v_tier_price numeric;
  v_best_tier_min numeric := null;
  v_best_tier_price numeric := null;
  v_canonical_items jsonb := '[]'::jsonb;
  v_canonical_payments jsonb := '[]'::jsonb;
  v_canonical_batches jsonb;
  v_canonical_item jsonb;
  v_canonical_payment jsonb;
  v_item_id text;
  v_method text;
  v_requested_method text;
  v_seen_method text;
  v_payment_amount numeric;
  v_received_amount numeric;
  v_payment_change numeric;
  v_payment_sum numeric := 0;
  v_change_sum numeric := 0;
  v_cash_sum numeric := 0;
  v_non_cash_sum numeric := 0;
  v_customer public.pos_customers;
  v_effective_customer_id text;
  v_has_discount_permission boolean;
  v_raw_sale_total_text text;
  v_is_split_child boolean := false;
  v_split_adjustment_expected numeric := 0;
  v_split_adjustment_sum numeric := 0;
  v_split_item_adjustment numeric := 0;
  v_split_adjustment_item_count integer := 0;
begin
  if p_operation_type not in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
    raise exception 'SALE_OPERATION_UNSUPPORTED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_sale) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_pos_permission(v_context, 'pos');
  if p_operation_type = 'sale.credit' then
    perform private.assert_pos_permission(v_context, 'customers');
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['id','cloud_sale_id','cloudSaleId']),
    'sale_' || replace(extensions.gen_random_uuid()::text, '-', '')
  );
  v_local_sale_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['local_sale_id','localSaleId']), v_sale_id
  );

  v_is_split_child := lower(coalesce(v_sale->'metadata'->>'source', '')) = 'split_bill_child'
    and nullif(btrim(coalesce(v_sale->'metadata'->>'splitGroupId', v_sale->'metadata'->>'split_group_id', '')), '') is not null
    and nullif(btrim(coalesce(v_sale->'metadata'->>'splitParentId', v_sale->'metadata'->>'split_parent_id', '')), '') is not null;
  if v_is_split_child then
    v_split_adjustment_expected := coalesce(private.pos_sale_jsonb_numeric(
      coalesce(v_sale->'metadata', '{}'::jsonb),
      array['splitRoundingAdjustment','split_rounding_adjustment','roundingAdjustment','rounding_adjustment'],
      0
    ), 0);
    if abs(v_split_adjustment_expected) > 0.01
       or abs(v_split_adjustment_expected - round(v_split_adjustment_expected, 2)) > 0.000001 then
      raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
    end if;
  end if;
  v_idempotency_key := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    case p_operation_type
      when 'sale.cashier_inventory' then 'sales.cloud_commit.inventory:' || v_local_sale_id || ':' || v_device_id::text
      when 'sale.credit' then 'sales.cloud_credit:' || v_local_sale_id || ':' || v_device_id::text
      else 'sales.cloud_commit:' || v_local_sale_id || ':' || v_device_id::text
    end
  );
  v_inventory_mode := p_operation_type = 'sale.cashier_inventory';
  if p_operation_type = 'sale.cashier'
     and coalesce((v_sale->'metadata'->>'cloudInventoryEffects')::boolean, false) then
    v_inventory_mode := true;
  end if;

  v_ecom_order_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['ecommerce_order_id','ecommerceOrderId']),
    v_sale->'metadata'->>'ecommerceOrderId', v_sale->'metadata'->>'ecommerce_order_id'
  );
  if lower(coalesce(private.pos_sale_jsonb_text(v_sale, array['sales_channel','salesChannel']), '' )) = 'ecommerce'
     or lower(coalesce(v_sale->'metadata'->>'origin', '')) = 'ecommerce'
     or v_ecom_order_id is not null then
    if nullif(btrim(v_ecom_order_id), '') is null then
      raise exception 'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED' using errcode = 'P0001';
    end if;
    v_ecom_order_id := btrim(v_ecom_order_id);
    select * into v_ecom_order
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and o.id::text = v_ecom_order_id
    for update;
    if v_ecom_order.id is null then
      raise exception 'ECOMMERCE_ORDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_ecom_conversion_key := coalesce(
      v_sale->'metadata'->>'ecommerceConversionKey',
      v_sale->'metadata'->>'idempotencyKey'
    );
    if v_ecom_order.pos_conversion_status <> 'reserved'
       or v_ecom_order.pos_conversion_sale_id is distinct from v_sale_id
       or v_ecom_order.pos_conversion_key is distinct from v_ecom_conversion_key
       or v_ecom_order.pos_draft_status <> 'prepared' then
      raise exception 'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED' using errcode = 'P0001';
    end if;
    if coalesce(v_ecom_order.discount_total, 0) > 0 then
      v_has_discount_permission := private.has_pos_permission(v_context, 'discounts');
      if not v_has_discount_permission then
        raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_has_discount_permission := private.has_pos_permission(v_context, 'discounts');

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'SALE_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_item_payload := v_item.payload;
    if jsonb_typeof(v_item_payload) <> 'object' then
      raise exception 'SALE_ITEM_PAYLOAD_INVALID' using errcode = 'P0001';
    end if;
    v_product_id := nullif(btrim(private.pos_sale_jsonb_text(v_item_payload, array['product_id','productId','parentId'])), '');
    if v_product_id is null then
      raise exception 'MANUAL_ITEM_PRICE_POLICY_REQUIRED' using errcode = 'P0001';
    end if;
    v_quantity := private.pos_sale_jsonb_numeric(v_item_payload, array['quantity','qty'], null);
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001';
    end if;

    if v_ecom_order.id is not null then
      select i.*,
             coalesce(nullif(i.source_product_id, ''), ep.product_id, ep.local_product_ref) as resolved_source_product_id
      into v_ecom_item
      from public.ecommerce_order_items i
      left join public.ecommerce_published_products ep on ep.id = i.published_product_id
      where i.order_id = v_ecom_order.id
        and (
          i.id::text = coalesce(v_item_payload->>'ecommerce_order_item_id', '')
          or i.id::text = coalesce(v_item_payload->'metadata'->>'ecommerceOrderItemId', '')
          or ('ecom-' || v_ecom_order.id::text || '-' || i.id::text) = coalesce(v_item_payload->>'id', '')
          or ('ecom-' || v_ecom_order.id::text || '-' || i.id::text) = coalesce(v_item_payload->'metadata'->>'lineId', '')
        )
      limit 1;
      if v_ecom_item.id is null or v_ecom_item.id::text = any(v_seen_ecom_items) then
        raise exception 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001';
      end if;
      v_seen_ecom_items := array_append(v_seen_ecom_items, v_ecom_item.id::text);
      if v_ecom_item.resolved_source_product_id is null
         or v_ecom_item.resolved_source_product_id <> v_product_id
         or abs(v_ecom_item.quantity - v_quantity) > 0.0005
         or abs(v_ecom_item.line_total - round(v_ecom_item.unit_price * v_ecom_item.quantity, 2)) > 0.005 then
        raise exception 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001';
      end if;
    end if;

    select * into v_product
    from public.pos_products p
    where p.license_id = v_license_id and p.id = v_product_id
    for update;
    if v_product.id is null then
      if v_item_payload->'metadata'->>'productIdSource' = 'line_identity' then
        raise exception 'MANUAL_ITEM_PRICE_POLICY_REQUIRED' using errcode = 'P0001';
      end if;
      raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_product_id using errcode = 'P0001';
    end if;
    if v_product.deleted_at is not null or v_product.is_active is not true then
      raise exception 'CLOUD_PRODUCT_NOT_AVAILABLE:%', v_product_id using errcode = 'P0001';
    end if;

    -- SALE_BATCH_ALLOCATION_NULL_COMPAT_R1: JSONB null means no explicit allocation.
    v_raw_batches := coalesce(
      nullif(v_item_payload->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'batchesUsed', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batchesUsed', 'null'::jsonb),
      '[]'::jsonb
    );
    if jsonb_typeof(v_raw_batches) <> 'array' then
      raise exception 'BATCH_ALLOCATION_INVALID' using errcode = 'P0001';
    end if;
    v_canonical_batches := '[]'::jsonb;
    v_batch_count := 0;
    v_batch_cost_total := 0;
    v_batch_price_total := 0;
    for v_batch_payload in select value from jsonb_array_elements(v_raw_batches) loop
      v_batch_id := nullif(btrim(private.pos_sale_jsonb_text(v_batch_payload, array['batch_id','batchId','id'])), '');
      v_batch_quantity := private.pos_sale_jsonb_numeric(v_batch_payload, array['quantity','qty','usedQuantity','used_quantity'], null);
      if v_batch_id is null or v_batch_quantity is null or v_batch_quantity <= 0 then
        raise exception 'BATCH_ALLOCATION_INVALID' using errcode = 'P0001';
      end if;
      select * into v_batch
      from public.pos_product_batches b
      where b.license_id = v_license_id
        and b.product_id = v_product_id
        and b.id = v_batch_id
        and b.deleted_at is null
        and b.is_active is true
        and b.status = 'active'
      for update;
      if v_batch.id is null then
        raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;
      v_batch_count := v_batch_count + 1;
      v_batch_cost_total := v_batch_cost_total + (v_batch.cost * v_batch_quantity);
      v_batch_price_total := v_batch_price_total + (v_batch.price * v_batch_quantity);
      v_canonical_batches := v_canonical_batches || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch.id, 'quantity', v_batch_quantity
      ));
    end loop;
    if v_batch_count > 0 and abs((select coalesce(sum((x->>'quantity')::numeric), 0) from jsonb_array_elements(v_canonical_batches) x) - v_quantity) > 0.0005 then
      raise exception 'CLOUD_BATCH_ALLOCATION_MISMATCH' using errcode = 'P0001';
    end if;

    v_batch_id := nullif(btrim(private.pos_sale_jsonb_text(v_item_payload, array['batch_id','batchId'])), '');
    v_selected_batch := null;
    if v_batch_id is not null then
      select * into v_selected_batch
      from public.pos_product_batches b
      where b.license_id = v_license_id
        and b.product_id = v_product_id
        and b.id = v_batch_id
        and b.deleted_at is null
        and b.is_active is true
        and b.status = 'active'
      for update;
      if v_selected_batch.id is null then
        raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;
    end if;

    select exists (
      select 1 from public.pos_product_batches b
      where b.license_id = v_license_id and b.product_id = v_product_id
        and b.deleted_at is null and b.is_active is true and b.status = 'active'
        and (coalesce(b.attributes, '{}'::jsonb) ? 'talla'
          or coalesce(b.attributes, '{}'::jsonb) ? 'color')
    ) into v_is_variant;

    v_selected_modifier_result := private.r2b_authoritative_modifiers_v1(v_product, v_item_payload);
    v_selected_modifiers := coalesce(v_selected_modifier_result->'modifiers', '[]'::jsonb);
    v_modifier_unit_total := coalesce((v_selected_modifier_result->>'unit_total')::numeric, 0);

    if v_ecom_order.id is not null then
      v_price_base_total := v_ecom_item.unit_price * v_quantity;
      v_gross_line := round(v_ecom_item.line_total, 2);
      v_price_base_unit := v_ecom_item.unit_price;
      v_server_unit_cost := case
        when v_selected_batch.id is not null then v_selected_batch.cost
        when v_batch_count > 0 then round(v_batch_cost_total / v_quantity, 4)
        else v_product.cost
      end;
    else
      v_price_reference_cost := case
        when v_selected_batch.id is not null then v_selected_batch.cost
        when v_batch_count > 0 then v_batch_cost_total / v_quantity
        else v_product.cost
      end;
      v_best_tier_min := null;
      v_best_tier_price := null;
      if jsonb_typeof(coalesce(v_product.wholesale_tiers, '[]'::jsonb)) = 'array' then
        for v_tier in select value from jsonb_array_elements(coalesce(v_product.wholesale_tiers, '[]'::jsonb)) loop
          begin
            v_tier_min := coalesce(nullif(btrim(coalesce(v_tier->>'min', v_tier->>'minQty', v_tier->>'min_qty', '')), '')::numeric, 0);
            v_tier_price := nullif(btrim(coalesce(v_tier->>'price', '')), '')::numeric;
          exception when others then
            raise exception 'WHOLESALE_TIER_INVALID' using errcode = 'P0001';
          end;
          if v_tier_price is not null and v_tier_min >= 0 and v_quantity >= v_tier_min
             and not (v_price_reference_cost > 0 and v_tier_price < v_price_reference_cost)
             and (v_best_tier_min is null or v_tier_min > v_best_tier_min) then
            v_best_tier_min := v_tier_min;
            v_best_tier_price := v_tier_price;
          end if;
        end loop;
      end if;

      if v_is_variant then
        if v_batch_count > 0 then
          v_price_base_total := v_batch_price_total;
        elsif v_selected_batch.id is not null then
          v_price_base_total := v_selected_batch.price * v_quantity;
        else
          raise exception 'BATCH_SELECTION_REQUIRED' using errcode = 'P0001';
        end if;
      else
        v_price_base_total := v_product.price * v_quantity;
      end if;
      if v_best_tier_price is not null then
        v_price_base_total := v_best_tier_price * v_quantity;
      end if;
      v_price_base_unit := round(v_price_base_total / v_quantity + v_modifier_unit_total, 4);
      v_gross_line := round(v_price_base_total + v_modifier_unit_total * v_quantity, 2);
      v_server_unit_cost := case
        when v_batch_count > 0 then round(v_batch_cost_total / v_quantity, 4)
        when v_selected_batch.id is not null then v_selected_batch.cost
        else v_product.cost
      end;
    end if;

    v_split_item_adjustment := 0;
    if v_is_split_child then
      v_split_item_adjustment := coalesce(private.pos_sale_jsonb_numeric(
        coalesce(v_item_payload->'metadata', '{}'::jsonb),
        array['splitRoundingAdjustment','split_rounding_adjustment','roundingAdjustment','rounding_adjustment'],
        0
      ), 0);
      if abs(v_split_item_adjustment) > 0.01
         or abs(v_split_item_adjustment - round(v_split_item_adjustment, 2)) > 0.000001 then
        raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
      end if;
      if abs(v_split_item_adjustment) > 0.005 then
        v_split_adjustment_item_count := v_split_adjustment_item_count + 1;
        if v_split_adjustment_item_count > 1 then
          raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
        end if;
      end if;
      v_split_adjustment_sum := v_split_adjustment_sum + v_split_item_adjustment;
      v_gross_line := round(v_gross_line + v_split_item_adjustment, 2);
      if v_gross_line < -0.005 then
        raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
      end if;
    end if;

    v_raw_unit_price := private.pos_sale_jsonb_numeric(v_item_payload, array['unit_price','unitPrice','price'], null);
    if v_raw_unit_price is null or abs(v_raw_unit_price - v_price_base_unit) > 0.005 then
      raise exception 'SALE_PRICE_MISMATCH:%', v_product_id using errcode = 'P0001';
    end if;
    v_raw_unit_cost := private.pos_sale_jsonb_numeric(v_item_payload, array['unit_cost','unitCost','cost'], null);
    -- Deliberately read but never use v_raw_unit_cost.  The authoritative cost
    -- is selected from the locked product/batch rows above.
    if v_raw_unit_cost is not null and v_raw_unit_cost < 0 then
      raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    v_raw_item_discount := coalesce(v_item_payload->'discount', v_item_payload->'discountAmount', v_item_payload->'discount_amount');
    if v_raw_item_discount is null or jsonb_typeof(v_raw_item_discount) = 'null' then
      v_raw_discount_amount := private.pos_sale_jsonb_numeric(v_item_payload, array['discount_amount','discountAmount'], null);
      if v_raw_discount_amount is not null and v_raw_discount_amount <> 0 then
        v_raw_item_discount := jsonb_build_object(
          'type', 'amount', 'value', v_raw_discount_amount,
          'reason', coalesce(v_item_payload->>'discountReason', v_item_payload->>'discount_reason')
        );
      end if;
    end if;
    v_line_discount_result := private.r2b_normalize_discount_v1(v_raw_item_discount, v_gross_line, 'line');
    v_line_discount := coalesce((v_line_discount_result->>'amount')::numeric, 0);
    if v_line_discount > 0 and not v_has_discount_permission then
      raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is not null and v_line_discount > 0 then
      raise exception 'ECOMMERCE_DISCOUNT_NOT_IN_ORDER' using errcode = 'P0001';
    end if;
    v_raw_line_subtotal := private.pos_sale_jsonb_numeric(v_item_payload, array['line_subtotal','lineSubtotal','subtotal','exactTotal'], null);
    v_raw_line_total := private.pos_sale_jsonb_numeric(v_item_payload, array['line_total','lineTotal','total'], null);
    if v_raw_line_subtotal is not null and abs(v_raw_line_subtotal - v_gross_line) > 0.005 then
      raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    if v_raw_line_total is not null and abs(v_raw_line_total - round(v_gross_line - v_line_discount, 2)) > 0.005 then
      raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    v_raw_tax_amount := private.pos_sale_jsonb_numeric(v_item_payload, array['tax_amount','taxAmount','tax'], 0);
    if v_raw_tax_amount < 0 then
      raise exception 'SALE_TAX_INVALID' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is null and v_raw_tax_amount > 0.005 then
      raise exception 'SALE_TAX_SOURCE_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is not null and v_raw_tax_amount > 0.005 then
      raise exception 'ECOMMERCE_TAX_LINE_UNRESOLVED' using errcode = 'P0001';
    end if;

    v_gross_subtotal := v_gross_subtotal + v_gross_line;
    v_line_discount_total := v_line_discount_total + v_line_discount;
    if v_inventory_mode and v_product.track_stock is true
       and (v_product.batch_management is not null or v_batch_count > 0 or v_selected_batch.id is not null) then
      v_server_unit_cost := null;
    end if;
    v_canonical_item := (
      v_item_payload
      - 'price' - 'unitPrice' - 'unit_price'
      - 'cost' - 'unitCost' - 'unit_cost'
      - 'discount' - 'discountAmount' - 'discount_amount'
      - 'tax' - 'taxAmount' - 'tax_amount'
      - 'lineSubtotal' - 'line_subtotal' - 'lineTotal' - 'line_total'
      - 'batchesUsed' - 'batches_used'
    ) || jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(v_item_payload->>'id', v_sale_id || ':item:' || v_item.ordinality::text),
      'product_id', v_product.id,
      'product_name', v_product.name,
      'product_sku', v_product.sku,
      'barcode', v_product.barcode,
      'category_id', v_product.category_id,
      'quantity', v_quantity,
      'unit_price', v_price_base_unit,
      'unit_cost', v_server_unit_cost,
      'discount', v_line_discount_result->'discount',
      'discount_amount', v_line_discount,
      'tax_amount', 0,
      'line_subtotal', v_gross_line,
      'line_total', round(v_gross_line - v_line_discount, 2),
      'selected_modifiers', v_selected_modifiers,
      'batch_id', v_batch_id,
      'batch_sku', case when v_selected_batch.id is not null then v_selected_batch.sku end,
      'batch_expiry_date', case when v_selected_batch.id is not null then v_selected_batch.expiry_date end,
      'batches_used', case when v_batch_count > 0 then v_canonical_batches end,
      'metadata', coalesce(v_item_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
        'r2bPriceAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_item' else 'pos_product_catalog' end,
        'r2bCostAuthority', case when v_server_unit_cost is null then 'inventory_effects' else 'pos_product_or_batch' end,
        'r2bClientUnitCostIgnored', true
      )
    ));
    v_canonical_items := v_canonical_items || jsonb_build_array(v_canonical_item);
  end loop;

  if v_is_split_child and abs(v_split_adjustment_sum - v_split_adjustment_expected) > 0.005 then
    raise exception 'SPLIT_ROUNDING_MISMATCH' using errcode = 'P0001';
  end if;

  if v_ecom_order.id is not null then
    v_sale_discount_amount := round(coalesce(v_ecom_order.discount_total, 0), 2);
    v_sale_discount := case when v_sale_discount_amount > 0 then jsonb_build_object(
      'type', 'amount', 'value', v_sale_discount_amount, 'amount', v_sale_discount_amount,
      'reason', 'ecommerce_order_snapshot', 'scope', 'sale'
    ) else null end;
    v_tax_total := round(coalesce(v_ecom_order.tax_total, 0), 2);
    v_delivery_fee := round(coalesce(v_ecom_order.delivery_fee, 0), 2);
    v_total := round(v_gross_subtotal - v_line_discount_total + v_delivery_fee + v_tax_total - v_sale_discount_amount, 2);
    if abs(v_gross_subtotal - v_ecom_order.subtotal) > 0.005
       or abs(v_total - v_ecom_order.total) > 0.005 then
      raise exception 'ECOMMERCE_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
  else
    v_raw_sale_discount := coalesce(
      v_sale->'saleDiscount', v_sale->'discount', v_sale->'metadata'->'discount'
    );
    if v_raw_sale_discount is null or jsonb_typeof(v_raw_sale_discount) = 'null' then
      v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['discount_total','discountTotal'], null);
      if v_incoming_sale_value is not null and v_incoming_sale_value <> 0 then
        v_raw_sale_discount := jsonb_build_object(
          'type', 'amount', 'value', v_incoming_sale_value,
          'reason', coalesce(v_sale->>'discountReason', v_sale->'metadata'->>'discountReason')
        );
      end if;
    end if;
    v_sale_discount_result := private.r2b_normalize_discount_v1(
      v_raw_sale_discount, round(v_gross_subtotal - v_line_discount_total, 2), 'sale'
    );
    v_sale_discount_amount := coalesce((v_sale_discount_result->>'amount')::numeric, 0);
    v_sale_discount := v_sale_discount_result->'discount';
    if v_sale_discount_amount > 0 and not v_has_discount_permission then
      raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
    end if;
    v_tax_total := 0;
    v_delivery_fee := 0;
    v_total := round(v_gross_subtotal - v_line_discount_total - v_sale_discount_amount, 2);
  end if;

  if v_total < 0 then
    raise exception 'SALE_TOTAL_INVALID' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['subtotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - round(v_gross_subtotal, 2)) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['discount_total','discountTotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - round(v_line_discount_total + v_sale_discount_amount, 2)) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['tax_total','taxTotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_tax_total) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_raw_sale_total_text := private.pos_sale_jsonb_text(v_sale, array['total']);
  if v_raw_sale_total_text is not null then
    begin
      if abs(v_raw_sale_total_text::numeric - v_total) > 0.005 then
        raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'SALE_TOTAL_INVALID' using errcode = 'P0001';
    end;
  end if;

  v_effective_customer_id := nullif(btrim(coalesce(p_customer_id, private.pos_sale_jsonb_text(v_sale, array['customer_id','customerId']))), '');
  if p_operation_type = 'sale.credit' then
    if v_effective_customer_id is null then
      raise exception 'CREDIT_SALE_CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;
    select * into v_customer
    from public.pos_customers c
    where c.license_id = v_license_id and c.id = v_effective_customer_id
    for update;
    if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_customer.deleted_at is not null then raise exception 'CUSTOMER_DELETED' using errcode = 'P0001'; end if;
  end if;

  for v_payment in
    select value as payload, ordinality
    from jsonb_array_elements(p_payments) with ordinality
  loop
    v_payment_payload := v_payment.payload;
    if jsonb_typeof(v_payment_payload) <> 'object' then
      raise exception 'SALE_PAYMENT_PAYLOAD_INVALID' using errcode = 'P0001';
    end if;
    v_method := private.normalize_pos_sale_payment_method(
      private.pos_sale_jsonb_text(v_payment_payload, array['method','payment_method','paymentMethod'], 'cash')
    );
    if v_method in ('mixed_credit', 'partial_credit') then v_method := 'credit'; end if;
    if p_operation_type = 'sale.credit' and v_method = 'credit' then
      v_canonical_payment := jsonb_build_object(
        'id', coalesce(v_payment_payload->>'id', v_sale_id || ':payment:' || v_payment.ordinality::text),
        'method', 'credit', 'amount', 0, 'received_amount', 0, 'change_amount', 0
      );
      v_canonical_payments := v_canonical_payments || jsonb_build_array(v_canonical_payment);
      continue;
    end if;
    if v_method not in ('cash', 'card', 'transfer') then
      raise exception 'SALE_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    v_payment_amount := private.pos_sale_jsonb_numeric(v_payment_payload, array['amount','total'], null);
    if v_payment_amount is null or v_payment_amount <= 0 then
      raise exception 'SALE_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_received_amount := coalesce(private.pos_sale_jsonb_numeric(v_payment_payload, array['received_amount','receivedAmount'], null), v_payment_amount);
    v_payment_change := coalesce(private.pos_sale_jsonb_numeric(v_payment_payload, array['change_amount','changeAmount'], null), 0);
    if v_received_amount < v_payment_amount - 0.005 or v_payment_change < -0.005 then
      raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    if v_method = 'cash' then
      if abs(v_payment_change - greatest(v_received_amount - v_payment_amount, 0)) > 0.005 then
        raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
      v_cash_sum := v_cash_sum + v_payment_amount;
    else
      if abs(v_payment_change) > 0.005 or abs(v_received_amount - v_payment_amount) > 0.005 then
        raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
      v_non_cash_sum := v_non_cash_sum + v_payment_amount;
    end if;
    v_payment_sum := v_payment_sum + v_payment_amount;
    v_change_sum := v_change_sum + v_payment_change;
    v_canonical_payment := (
      v_payment_payload - 'amount' - 'total' - 'receivedAmount' - 'received_amount' - 'changeAmount' - 'change_amount'
    ) || jsonb_build_object(
      'id', coalesce(v_payment_payload->>'id', v_sale_id || ':payment:' || v_payment.ordinality::text),
      'method', v_method, 'amount', round(v_payment_amount, 2),
      'received_amount', round(v_received_amount, 2), 'change_amount', round(v_payment_change, 2),
      'cash_session_id', coalesce(v_payment_payload->>'cash_session_id', v_payment_payload->>'cashSessionId', p_cash_session_id)
    );
    v_canonical_payments := v_canonical_payments || jsonb_build_array(v_canonical_payment);
    if v_seen_method is null then v_seen_method := v_method; elsif v_seen_method <> v_method then v_seen_method := 'mixed'; end if;
  end loop;

  if p_operation_type = 'sale.credit' then
    if v_payment_sum > v_total + 0.005 then
      raise exception 'INITIAL_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001';
    end if;
    if v_payment_sum <= 0 then
      v_requested_method := 'credit';
    else
      v_requested_method := 'mixed_credit';
    end if;
  else
    if v_payment_sum <= 0 or abs(v_payment_sum - v_total) > 0.005 then
      raise exception 'SALE_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_requested_method := coalesce(v_seen_method, 'cash');
  end if;

  v_method := private.normalize_pos_sale_payment_method(
    private.pos_sale_jsonb_text(v_sale, array['payment_method','paymentMethod'], v_requested_method)
  );
  if p_operation_type = 'sale.credit' then
    if v_method not in ('credit', 'mixed', 'mixed_credit', 'partial_credit') and v_method is not null then
      raise exception 'SALE_PAYMENT_METHOD_NOT_CREDIT' using errcode = 'P0001';
    end if;
    v_method := v_requested_method;
  else
    if v_method not in ('cash', 'card', 'transfer', 'mixed') then
      raise exception 'SALE_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if v_method <> 'mixed' and v_requested_method <> 'mixed' and v_method <> v_requested_method then
      raise exception 'SALE_PAYMENT_METHOD_MISMATCH' using errcode = 'P0001';
    end if;
    v_method := v_requested_method;
  end if;

  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['amount_paid','amountPaid','abono'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_payment_sum) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['change_amount','changeAmount'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_change_sum) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['balance_due','balanceDue','saldoPendiente'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - (v_total - v_payment_sum)) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;

  v_sale := (
    v_sale
    - 'subtotal' - 'discount' - 'discountTotal' - 'discount_total'
    - 'taxTotal' - 'tax_total' - 'total'
    - 'amountPaid' - 'amount_paid' - 'abono'
    - 'changeAmount' - 'change_amount' - 'balanceDue' - 'balance_due' - 'saldoPendiente'
    - 'paymentMethod' - 'payment_method'
  ) || jsonb_strip_nulls(jsonb_build_object(
    'id', v_sale_id,
    'local_sale_id', v_local_sale_id,
    'subtotal', round(v_gross_subtotal, 2),
    'discount_total', round(v_line_discount_total + v_sale_discount_amount, 2),
    'discount', v_sale_discount,
    'tax_total', v_tax_total,
    'delivery_fee', v_delivery_fee,
    'total', v_total,
    'amount_paid', round(v_payment_sum, 2),
    'change_amount', round(v_change_sum, 2),
    'balance_due', round(v_total - v_payment_sum, 2),
    'payment_method', v_method,
    'customer_id', v_effective_customer_id,
    'customer_name', case when v_customer.id is not null then v_customer.name end,
    'customer_phone', case when v_customer.id is not null then v_customer.phone end,
    'cash_session_id', p_cash_session_id,
    'metadata', coalesce(v_sale->'metadata', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'r2bFinancialAuthority', true,
      'r2bPriceAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_items' else 'pos_products_and_batches' end,
      'r2bDiscountAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_snapshot' else 'server_discount_semantics' end,
      'r2bTaxAuthority', case when v_ecom_order.id is not null then 'ecommerce_order' else 'none' end,
      'ecommerceAcceptedDeliveryFee', case when v_ecom_order.id is not null then v_delivery_fee end
     ))
  ));

  -- Hash the canonical request, exactly as the legacy effect engine does.  The
  -- comparison is deliberately after normalization so harmless client aliases
  -- and ignored unit_cost values do not turn a legitimate replay into a false
  -- conflict, while changed authoritative values still fail closed.
  v_request_hash := pg_catalog.md5(
    coalesce(v_sale::text, '') || coalesce(v_canonical_items::text, '') ||
    coalesce(v_canonical_payments::text, '') || coalesce(p_cash_session_id, '') ||
    case when p_operation_type = 'sale.credit' then coalesce(v_effective_customer_id, p_customer_id, '') else '' end
  );
  v_idem := private.r2b_assert_sale_idempotency_v1(v_license_id, v_idempotency_key, v_request_hash);
  if v_idem->>'status' = 'completed' then
    return jsonb_build_object('idempotent_response', v_idem->'response', 'idempotency_key', v_idempotency_key);
  elsif v_idem->>'status' = 'processing' then
    return jsonb_build_object('idempotency_processing', true, 'idempotency_key', v_idempotency_key);
  end if;

  return jsonb_build_object(
    'license_id', v_license_id,
    'idempotency_key', v_idempotency_key,
    'request_hash', v_request_hash,
    'sale', v_sale,
    'items', v_canonical_items,
    'payments', v_canonical_payments,
    'customer_id', v_effective_customer_id,
    'inventory_mode', v_inventory_mode
  );
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
  v_parent_order_version text;
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
  v_primary_sale_id text;
  v_primary_sale_folio text;
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
  v_parent_order_version := nullif(btrim(coalesce(p_split->>'parent_order_version', p_split->>'parentOrderVersion', '')), '');
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
  if v_parent_order_version is not null then
    begin
      if v_order.updated_at <> v_parent_order_version::timestamptz then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end if;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
    end;
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

  select value->>'id', coalesce(value->>'pos_folio', value->>'folio')
    into v_primary_sale_id, v_primary_sale_folio
    from jsonb_array_elements(v_sales)
   limit 1;

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
    coalesce(v_primary_sale_id, 'SPLIT-' || v_split_group_id),
    coalesce(v_primary_sale_folio, 'SPLIT-' || v_split_group_id),
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
  v_payment_method text;
  v_payment_amount numeric;
  v_received_amount numeric;
  v_change_amount numeric;
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
  v_pos_folio text;
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

  if jsonb_array_length(v_payments_payload) = 1 then
    v_payment := v_payments_payload->0;
    v_payment_method := lower(coalesce(private.pos_sale_jsonb_text(v_payment, array['method','payment_method','paymentMethod']), ''));
    v_payment_amount := private.pos_sale_jsonb_numeric(v_payment, array['amount','total'], null);
    v_received_amount := coalesce(private.pos_sale_jsonb_numeric(v_payment, array['received_amount','receivedAmount'], null), v_payment_amount);
    v_change_amount := coalesce(private.pos_sale_jsonb_numeric(v_payment, array['change_amount','changeAmount'], null), 0);
    if v_payment_method <> 'layaway_completed'
       or v_payment_amount is null
       or v_payment_amount <= 0
       or v_received_amount is null
       or v_received_amount < v_payment_amount - 0.005
       or v_change_amount < -0.005
       or abs(v_payment_amount - v_total) > 0.005
       or abs(v_received_amount - v_payment_amount) > 0.005
       or abs(v_change_amount) > 0.005 then
      raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
    end if;
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
  v_pos_folio := v_folio->>'pos_folio';
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
    payment_method, payment_status, folio, local_folio, cloud_folio, pos_folio, folio_sequence,
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
    v_cloud_folio, v_pos_folio, v_folio_sequence, v_folio_sequence,
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
