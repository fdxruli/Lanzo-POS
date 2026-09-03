-- CLOUD LAYAWAYS FINANCIAL RESPONSE SERIALIZATION HARDENING R2

--

-- Financial write responses now use explicit public projections for the four

-- layaway operations.  Existing persisted responses are projected again on

-- replay, including through the receipt endpoint.

-- The Supabase CLI was unavailable in the authoring environment; this

-- forward-only file is intentionally not applied here.



begin;


-- JSON objects below are public financial projections.  Each key is listed
-- deliberately so a row or an older persisted response cannot widen the
-- response contract.

create or replace function private.financial_layaway_item_allowlist_v2(p_item jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce($1->'id', $1->'item_id'),
      'product_id', coalesce($1->'product_id', $1->'productId', $1->'parentId'),
      'product_name', coalesce($1->'product_name', $1->'productName', $1->'name'),
      'product_sku', coalesce($1->'product_sku', $1->'productSku', $1->'sku'),
      'barcode', coalesce($1->'barcode', $1->'barCode'),
      'category_id', coalesce($1->'category_id', $1->'categoryId'),
      'category_name', coalesce($1->'category_name', $1->'categoryName', $1->'rubro', $1->'category'),
      'rubro', coalesce($1->'rubro', $1->'category', $1->'categoryName'),
      'batch_id', coalesce($1->'batch_id', $1->'batchId'),
      'batch_sku', coalesce($1->'batch_sku', $1->'batchSku'),
      'batch_expiry_date', coalesce($1->'batch_expiry_date', $1->'batchExpiryDate', $1->'expiryDate'),
      'variant_id', coalesce($1->'variant_id', $1->'variantId'),
      'size', coalesce($1->'size', $1->'talla'),
      'color', coalesce($1->'color', $1->'colorName'),
      'quantity', coalesce($1->'quantity', $1->'qty'),
      'unit_price', coalesce($1->'unit_price', $1->'unitPrice', $1->'price'),
      'line_subtotal', coalesce($1->'line_subtotal', $1->'lineSubtotal'),
      'line_total', coalesce($1->'line_total', $1->'lineTotal', $1->'total', $1->'exactTotal'),
      'discount_amount', coalesce($1->'discount_amount', $1->'discountAmount', ($1->'discount')->'amount'),
      'tax_amount', coalesce($1->'tax_amount', $1->'taxAmount')
    )) else null
  end;
$function$;

create or replace function private.financial_layaway_items_allowlist_v2(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_layaway_item_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_layaway_allowlist_v2(p_layaway jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'customer_id', $1->'customer_id',
      'customer_name', $1->'customer_name',
      'customer_phone', $1->'customer_phone',
      'total_amount', $1->'total_amount',
      'paid_amount', $1->'paid_amount',
      'balance_due', $1->'balance_due',
      'currency', $1->'currency',
      'deadline', $1->'deadline',
      'status', $1->'status',
      'items', private.financial_layaway_items_allowlist_v2($1->'items'),
      'conversion_sale_id', $1->'conversion_sale_id',
      'retained_money', $1->'retained_money',
      'retained_amount', $1->'retained_amount',
      'created_at', $1->'created_at',
      'updated_at', $1->'updated_at',
      'completed_at', $1->'completed_at',
      'cancelled_at', $1->'cancelled_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_layaway_payment_allowlist_v2(p_payment jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'layaway_id', $1->'layaway_id',
      'payment_method', coalesce($1->'payment_method', $1->'paymentMethod', $1->'method'),
      'amount', $1->'amount',
      'status', $1->'status',
      'cash_movement_id', coalesce($1->'cash_movement_id', $1->'cashMovementId'),
      'payment_type',
        case lower(coalesce(
          nullif(btrim($1->>'payment_type'), ''),
          nullif(btrim($1->>'paymentType'), ''),
          nullif(btrim(($1->'metadata')->>'payment_type'), ''),
          nullif(btrim(($1->'metadata')->>'paymentType'), ''),
          ''
        ))
          when 'initial_deposit' then 'initial_deposit'
          when 'initial-deposit' then 'initial_deposit'
          when 'deposit' then 'initial_deposit'
          else 'installment'
        end,
      'created_at', $1->'created_at',
      'refunded_at', $1->'refunded_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_layaway_payments_allowlist_v2(p_payments jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_layaway_payment_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_layaway_reservation_allowlist_v2(p_reservation jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'layaway_id', $1->'layaway_id',
      'item_index', $1->'item_index',
      'product_id', $1->'product_id',
      'batch_id', $1->'batch_id',
      'quantity', $1->'quantity',
      'status', $1->'status',
      'created_at', $1->'created_at',
      'released_at', $1->'released_at',
      'consumed_at', $1->'consumed_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_layaway_reservations_allowlist_v2(p_reservations jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_layaway_reservation_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_cash_movement_allowlist_v2(p_movement jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'type', $1->'type',
      'amount', $1->'amount',
      'concept', $1->'concept',
      'source', $1->'source',
      'reference_type', $1->'reference_type',
      'reference_id', $1->'reference_id',
      'payment_id', nullif(btrim(coalesce(
        $1->>'payment_id',
        ($1->'metadata')->>'payment_id',
        ($1->'metadata')->>'paymentId',
        ''
      )), ''),
      'created_at', $1->'created_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_cash_movements_allowlist_v2(p_movements jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_cash_movement_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_inventory_movement_allowlist_v2(p_movement jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'product_id', $1->'product_id',
      'batch_id', $1->'batch_id',
      'movement_type', $1->'movement_type',
      'quantity', $1->'quantity',
      'reason', $1->'reason',
      'source', $1->'source',
      'layaway_id', nullif(btrim(coalesce(
        $1->>'layaway_id',
        ($1->'metadata')->>'layaway_id',
        ($1->'metadata')->>'layawayId',
        ''
      )), ''),
      'created_at', $1->'created_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_inventory_movements_allowlist_v2(p_movements jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_inventory_movement_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_sale_allowlist_v2(p_sale jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'local_sale_id', $1->'local_sale_id',
      'layaway_id', $1->'layaway_id',
      'origin', $1->'origin',
      'source_mode', $1->'source_mode',
      'effects_status', $1->'effects_status',
      'status', $1->'status',
      'fulfillment_status', $1->'fulfillment_status',
      'payment_method', $1->'payment_method',
      'payment_status', $1->'payment_status',
      'folio', $1->'folio',
      'local_folio', $1->'local_folio',
      'cloud_folio', $1->'cloud_folio',
      'pos_folio', $1->'pos_folio',
      'sale_number', $1->'sale_number',
      'sales_channel', $1->'sales_channel',
      'customer_id', $1->'customer_id',
      'customer_name', $1->'customer_name',
      'customer_phone', $1->'customer_phone',
      'subtotal', $1->'subtotal',
      'discount_total', $1->'discount_total',
      'tax_total', $1->'tax_total',
      'total', $1->'total',
      'amount_paid', $1->'amount_paid',
      'change_amount', $1->'change_amount',
      'balance_due', $1->'balance_due',
      'currency', $1->'currency',
      'sold_at', $1->'sold_at',
      'created_at', $1->'created_at',
      'updated_at', $1->'updated_at',
      'committed_at', $1->'committed_at',
      'cancelled_at', $1->'cancelled_at',
      'cancel_reason', $1->'cancel_reason',
      'cash_effect_status', $1->'cash_effect_status',
      'inventory_effect_status', $1->'inventory_effect_status',
      'credit_effect_status', $1->'credit_effect_status',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_sale_item_allowlist_v2(p_item jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'sale_id', $1->'sale_id',
      'product_id', $1->'product_id',
      'product_name', $1->'product_name',
      'product_sku', $1->'product_sku',
      'barcode', $1->'barcode',
      'category_id', $1->'category_id',
      'category_name', $1->'category_name',
      'quantity', $1->'quantity',
      'unit_price', $1->'unit_price',
      'discount_amount', $1->'discount_amount',
      'tax_amount', $1->'tax_amount',
      'line_total', $1->'line_total',
      'batch_id', $1->'batch_id',
      'batch_sku', $1->'batch_sku',
      'batch_expiry_date', $1->'batch_expiry_date',
      'rubro', $1->'rubro',
      'inventory_effect_status', $1->'inventory_effect_status',
      'inventory_movement_id', $1->'inventory_movement_id',
      'created_at', $1->'created_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_sale_items_allowlist_v2(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_sale_item_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_sale_payment_allowlist_v2(p_payment jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'id', $1->'id',
      'sale_id', $1->'sale_id',
      'method', $1->'method',
      'amount', $1->'amount',
      'received_amount', $1->'received_amount',
      'change_amount', $1->'change_amount',
      'reference', $1->'reference',
      'cash_movement_id', coalesce($1->'cash_movement_id', $1->'cashMovementId'),
      'created_at', $1->'created_at',
      'server_version', $1->'server_version'
    )) else null
  end;
$function$;

create or replace function private.financial_sale_payments_allowlist_v2(p_payments jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    (
      select jsonb_agg(
        private.financial_sale_payment_allowlist_v2(item)
        order by item_ordinality
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce($1, '[]'::jsonb)) = 'array'
            then coalesce($1, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as source(item, item_ordinality)
      where jsonb_typeof(item) = 'object'
    ),
    '[]'::jsonb
  );
$function$;

create or replace function private.financial_event_allowlist_v2(p_event jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when jsonb_typeof($1) = 'object' then jsonb_strip_nulls(jsonb_build_object(
      'entity_type', $1->'entity_type',
      'entity_id', $1->'entity_id',
      'operation', $1->'operation',
      'change_seq', $1->'change_seq',
      'server_version', $1->'server_version',
      'created_at', $1->'created_at'
    )) else null
  end;
$function$;

create or replace function private.financial_layaway_response_allowlist_v2(
  p_operation_type text,
  p_response jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_operation_type in ('layaway.create', 'layaway.cancel') then
    return jsonb_build_object(
      'success', p_response->'success',
      'mode', p_response->'mode',
      'layaway', private.financial_layaway_allowlist_v2(p_response->'layaway'),
      'payments', private.financial_layaway_payments_allowlist_v2(p_response->'payments'),
      'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(p_response->'inventory_reservations'),
      'cash_movements', private.financial_cash_movements_allowlist_v2(p_response->'cash_movements'),
      'cash_movement', private.financial_cash_movement_allowlist_v2(p_response->'cash_movement'),
      'cash_session', null::jsonb,
      'folio', p_response->'folio',
      'sale', null::jsonb,
      'event', private.financial_event_allowlist_v2(p_response->'event'),
      'change_seq', p_response->'change_seq',
      'latest_change_seq', p_response->'latest_change_seq'
    );
  elsif p_operation_type = 'layaway.payment' then
    return jsonb_build_object(
      'success', p_response->'success',
      'mode', p_response->'mode',
      'layaway', private.financial_layaway_allowlist_v2(p_response->'layaway'),
      'payment', private.financial_layaway_payment_allowlist_v2(p_response->'payment'),
      'payments', private.financial_layaway_payments_allowlist_v2(p_response->'payments'),
      'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(p_response->'inventory_reservations'),
      'cash_movements', private.financial_cash_movements_allowlist_v2(p_response->'cash_movements'),
      'cash_movement', private.financial_cash_movement_allowlist_v2(p_response->'cash_movement'),
      'cash_session', null::jsonb,
      'folio', p_response->'folio',
      'sale', null::jsonb,
      'event', private.financial_event_allowlist_v2(p_response->'event'),
      'change_seq', p_response->'change_seq',
      'latest_change_seq', p_response->'latest_change_seq'
    );
  elsif p_operation_type = 'sale.layaway_complete' then
    return jsonb_build_object(
      'success', p_response->'success',
      'duplicate', p_response->'duplicate',
      'mode', p_response->'mode',
      'layaway', private.financial_layaway_allowlist_v2(p_response->'layaway'),
      'sale', private.financial_sale_allowlist_v2(p_response->'sale'),
      'items', private.financial_sale_items_allowlist_v2(p_response->'items'),
      'payments', private.financial_sale_payments_allowlist_v2(p_response->'payments'),
      'layaway_payments', private.financial_layaway_payments_allowlist_v2(p_response->'layaway_payments'),
      'cash_movements', private.financial_cash_movements_allowlist_v2(p_response->'cash_movements'),
      'cash_movement', null::jsonb,
      'cash_session', null::jsonb,
      'inventory_movements', private.financial_inventory_movements_allowlist_v2(p_response->'inventory_movements'),
      'folio', p_response->'folio',
      'event', private.financial_event_allowlist_v2(p_response->'event'),
      'server_version', p_response->'server_version',
      'change_seq', p_response->'change_seq',
      'latest_change_seq', p_response->'latest_change_seq'
    );
  else
    raise exception 'FINANCIAL_RESPONSE_ALLOWLIST_UNSUPPORTED' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function private.pos_layaway_financial_to_jsonb_v2(
  p_layaway public.pos_layaways
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_layaway_allowlist_v2(jsonb_build_object(
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
      'items', $1.items,
      'conversion_sale_id', $1.conversion_sale_id,
      'retained_money', $1.retained_money,
      'retained_amount', $1.retained_amount,
      'created_at', $1.created_at,
      'updated_at', $1.updated_at,
      'completed_at', $1.completed_at,
      'cancelled_at', $1.cancelled_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_payment_financial_to_jsonb_v2(
  p_payment public.pos_layaway_payments
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_layaway_payment_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'layaway_id', $1.layaway_id,
      'payment_method', $1.payment_method,
      'amount', $1.amount,
      'status', $1.status,
      'cash_movement_id', $1.cash_movement_id,
      'payment_type',
        case lower(coalesce(
          nullif(btrim(($1.metadata)->>'payment_type'), ''),
          nullif(btrim(($1.metadata)->>'paymentType'), ''),
          ''
        ))
          when 'initial_deposit' then 'initial_deposit'
          when 'initial-deposit' then 'initial_deposit'
          when 'deposit' then 'initial_deposit'
          else 'installment'
        end,
      'created_at', $1.created_at,
      'refunded_at', $1.refunded_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_reservation_financial_to_jsonb_v2(
  p_reservation public.pos_layaway_inventory_reservations
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_layaway_reservation_allowlist_v2(jsonb_build_object(
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
    ))
  end;
$function$;

create or replace function private.pos_layaway_cash_movement_financial_to_jsonb_v2(
  p_movement public.pos_cash_movements
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_cash_movement_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'type', $1.type,
      'amount', $1.amount,
      'concept', $1.concept,
      'source', $1.source,
      'reference_type', $1.reference_type,
      'reference_id', $1.reference_id,
      'payment_id', nullif(btrim(coalesce(
        ($1.metadata)->>'payment_id',
        ($1.metadata)->>'paymentId',
        ''
      )), ''),
      'created_at', $1.created_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_inventory_movement_financial_to_jsonb_v2(
  p_movement public.pos_inventory_movements
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_inventory_movement_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'product_id', $1.product_id,
      'batch_id', $1.batch_id,
      'movement_type', $1.movement_type,
      'quantity', $1.quantity,
      'reason', $1.reason,
      'source', $1.source,
      'layaway_id', nullif(btrim(coalesce(
        ($1.metadata)->>'layaway_id',
        ($1.metadata)->>'layawayId',
        ''
      )), ''),
      'created_at', $1.created_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_sale_financial_to_jsonb_v2(
  p_sale public.pos_sales
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_sale_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'local_sale_id', $1.local_sale_id,
      'layaway_id', $1.layaway_id,
      'origin', $1.origin,
      'source_mode', $1.source_mode,
      'effects_status', $1.effects_status,
      'status', $1.status,
      'fulfillment_status', $1.fulfillment_status,
      'payment_method', $1.payment_method,
      'payment_status', $1.payment_status,
      'folio', $1.folio,
      'local_folio', $1.local_folio,
      'cloud_folio', $1.cloud_folio,
      'pos_folio', coalesce(
        $1.pos_folio,
        case
          when lower(coalesce($1.source_mode, '')) = 'cloud_committed'
            and lower(coalesce($1.sales_channel, 'local')) <> 'ecommerce'
            and $1.folio_sequence is not null
          then private.format_pos_operational_folio_v1($1.license_id, $1.folio_sequence)
          else null
        end
      ),
      'sale_number', $1.sale_number,
      'sales_channel', $1.sales_channel,
      'customer_id', $1.customer_id,
      'customer_name', $1.customer_name,
      'customer_phone', $1.customer_phone,
      'subtotal', $1.subtotal,
      'discount_total', $1.discount_total,
      'tax_total', $1.tax_total,
      'total', $1.total,
      'amount_paid', $1.amount_paid,
      'change_amount', $1.change_amount,
      'balance_due', $1.balance_due,
      'currency', $1.currency,
      'sold_at', $1.sold_at,
      'created_at', $1.created_at,
      'updated_at', $1.updated_at,
      'committed_at', $1.committed_at,
      'cancelled_at', $1.cancelled_at,
      'cancel_reason', $1.cancel_reason,
      'cash_effect_status', $1.cash_effect_status,
      'inventory_effect_status', $1.inventory_effect_status,
      'credit_effect_status', $1.credit_effect_status,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_sale_item_financial_to_jsonb_v2(
  p_item public.pos_sale_items
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_sale_item_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'sale_id', $1.sale_id,
      'product_id', $1.product_id,
      'product_name', $1.product_name,
      'product_sku', $1.product_sku,
      'barcode', $1.barcode,
      'category_id', $1.category_id,
      'category_name', $1.category_name,
      'quantity', $1.quantity,
      'unit_price', $1.unit_price,
      'discount_amount', $1.discount_amount,
      'tax_amount', $1.tax_amount,
      'line_total', $1.line_total,
      'batch_id', $1.batch_id,
      'batch_sku', $1.batch_sku,
      'batch_expiry_date', $1.batch_expiry_date,
      'rubro', $1.rubro,
      'inventory_effect_status', $1.inventory_effect_status,
      'inventory_movement_id', $1.inventory_movement_id,
      'created_at', $1.created_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_sale_payment_financial_to_jsonb_v2(
  p_payment public.pos_sale_payments
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_sale_payment_allowlist_v2(jsonb_build_object(
      'id', $1.id,
      'sale_id', $1.sale_id,
      'method', $1.method,
      'amount', $1.amount,
      'received_amount', $1.received_amount,
      'change_amount', $1.change_amount,
      'reference', $1.reference,
      'cash_movement_id', $1.cash_movement_id,
      'created_at', $1.created_at,
      'server_version', $1.server_version
    ))
  end;
$function$;

create or replace function private.pos_layaway_event_financial_to_jsonb_v2(
  p_event public.pos_sync_events
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when $1.id is null then null
    else private.financial_event_allowlist_v2(jsonb_build_object(
      'entity_type', $1.entity_type,
      'entity_id', $1.entity_id,
      'operation', $1.operation,
      'change_seq', $1.change_seq,
      'server_version', $1.server_version,
      'created_at', $1.created_at
    ))
  end;
$function$;



create or replace function private.public_financial_response_v1(
  p_operation_type text,
  p_response jsonb,
  p_external_idempotency_key text,
  p_internal_idempotency_key text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare v_response jsonb;
begin
  perform private.assert_financial_legacy_result_terminal_v1(p_operation_type, p_response);

  if p_operation_type in (
    'layaway.create',
    'layaway.payment',
    'layaway.cancel',
    'sale.layaway_complete'
  ) then
    v_response := private.financial_layaway_response_allowlist_v2(p_operation_type, p_response);
  else
    v_response := private.sanitize_financial_response_idempotency_v1(
      p_response,
      p_external_idempotency_key,
      p_internal_idempotency_key
    );
  end if;

  perform private.assert_financial_response_no_internal_key_v1(
    v_response,
    p_internal_idempotency_key
  );

  return v_response || jsonb_build_object(
    'idempotency_key',
    p_external_idempotency_key
  );
end;
$function$;



create or replace function private.execute_layaway_create_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_payload jsonb;
  v_initial_payment jsonb;
  v_items jsonb;
  v_normalized jsonb;
  v_layaway_id text;
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_currency text;
  v_deadline timestamptz;
  v_total numeric;
  v_payment_amount numeric := 0;
  v_payment_id text;
  v_payment_method text;
  v_cash_session_id text;
  v_layaway public.pos_layaways;
  v_session public.pos_cash_sessions;
  v_payment public.pos_layaway_payments;
  v_cash_movement public.pos_cash_movements;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_event public.pos_sync_events;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');

  v_layaway_payload := private.layaway_record_v1(p_request);
  if jsonb_typeof(v_layaway_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  v_layaway_id := private.layaway_request_text_v1(v_layaway_payload, array['id','layaway_id','layawayId']);
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_total := private.layaway_request_numeric_v1(v_layaway_payload, array['total_amount','totalAmount','total']);
  v_normalized := private.normalize_layaway_items_v1(
    coalesce(v_layaway_payload->'items', '[]'::jsonb), v_total
  );
  select coalesce(
    jsonb_agg(
      value || jsonb_build_object(
        'id', coalesce(nullif(btrim(value->>'id'), ''), v_layaway_id || ':item:' || ordinality::text)
      ) order by ordinality
    ),
    '[]'::jsonb
  )
    into v_items
    from jsonb_array_elements(v_normalized->'items') with ordinality;
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item
     where private.layaway_request_numeric_v1(item.value, array['discount_amount','discountAmount'], 0) > 0
  ) then
    perform private.assert_pos_permission(p_context, 'discounts');
  end if;
  v_currency := upper(coalesce(private.layaway_request_text_v1(v_layaway_payload, array['currency']), 'MXN'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'LAYAWAY_CURRENCY_INVALID' using errcode = 'P0001';
  end if;

  begin
    if private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) ~ '^\d{4}-\d{2}-\d{2}$' then
      v_deadline := (private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) || 'T00:00:00+00')::timestamptz;
    else
      v_deadline := private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate'])::timestamptz;
    end if;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_DEADLINE_INVALID' using errcode = 'P0001';
  end;
  if v_deadline is null then
    raise exception 'LAYAWAY_DEADLINE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is not null then
    raise exception 'LAYAWAY_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_initial_payment := private.layaway_payment_payload_v1(p_request);
  v_payment_amount := coalesce(private.layaway_request_numeric_v1(v_initial_payment, array['amount','total'], 0), 0);
  if v_payment_amount < 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_amount > v_total + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001';
  end if;
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_initial_payment, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount > 0 and v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
  if v_payment_amount > 0 then
    v_session := private.layaway_cash_session_v1(
      v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
    );
  end if;

  v_customer_id := private.layaway_request_text_v1(v_layaway_payload, array['customer_id','customerId']);
  v_customer_name := private.layaway_request_text_v1(v_layaway_payload, array['customer_name','customerName']);
  v_customer_phone := private.layaway_request_text_v1(v_layaway_payload, array['customer_phone','customerPhone']);

  insert into public.pos_layaways (
    id, license_id, customer_id, customer_name, customer_phone, total_amount,
    paid_amount, balance_due, currency, deadline, status, items, cash_station_id,
    created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
    created_at, updated_at, server_version, last_idempotency_key, metadata
  ) values (
    v_layaway_id, v_license_id, v_customer_id, v_customer_name, v_customer_phone, round(v_total, 2),
    0, round(v_total, 2), v_currency, v_deadline, 'active', v_items, p_cash_station_id,
    v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
    now(), now(), 1, p_idempotency_key,
    coalesce(v_layaway_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source_mode', 'cloud_committed',
      'cash_station_id', p_cash_station_id
    )
  ) returning * into v_layaway;

  v_reservations := private.reserve_layaway_stock_v1(
    v_license_id, v_layaway_id, v_items, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );

  if v_payment_amount > 0 then
    v_payment_id := coalesce(
      private.layaway_request_text_v1(v_initial_payment, array['id','payment_id','paymentId']),
      v_layaway_id || ':payment:initial'
    );
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name,
      cash_station_id, performed_by_actor_key, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
      v_session.device_id, v_session.staff_user_id, v_session.actor_key,
      'entrada', round(v_payment_amount, 2), 'Abono inicial Apartado ' || v_layaway_id,
      'layaway_payment', 'layaway', v_layaway_id,
      v_device_id, v_staff_user_id, v_actor_name,
      v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
      jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'source', 'layaway_payment',
        'layaway_id', v_layaway_id,
        'payment_id', v_payment_id,
        'payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'),
        'idempotency_key', p_idempotency_key
      )
    ) returning * into v_cash_movement;

    insert into public.pos_layaway_payments (
      id, license_id, layaway_id, payment_method, amount, status,
      cash_session_id, cash_station_id, cash_movement_id, reference,
      request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
      actor_key, actor_name, metadata
    ) values (
      v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
      v_session.id, v_session.cash_station_id, v_cash_movement.id,
      private.layaway_request_text_v1(v_initial_payment, array['reference','ref']),
      p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
      v_actor_key, v_actor_name,
      jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'))
    ) returning * into v_payment;

    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
    update public.pos_layaways
       set paid_amount = round(v_payment_amount, 2),
           balance_due = greatest(round(total_amount - v_payment_amount, 2), 0),
           status = case when v_payment_amount >= total_amount - 0.005 then 'ready' else 'active' end,
           updated_at = now(), server_version = server_version + 1,
           last_idempotency_key = p_idempotency_key
     where license_id = v_license_id and id = v_layaway_id
     returning * into v_layaway;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('status', v_layaway.status, 'total_amount', v_layaway.total_amount,
      'paid_amount', v_layaway.paid_amount, 'cash_station_id', p_cash_station_id,
      'payment_id', case when v_payment.id is null then null else v_payment.id end),
    v_layaway.server_version::integer
  );
  if v_payment.id is not null then
    perform private.record_pos_sync_event(
      v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_payment.cash_movement_id),
      v_payment.server_version::integer
    );
    perform private.record_pos_sync_event(
      v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
      v_cash_movement.server_version
    );
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'payments', v_payments,
    'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(v_reservations),
    'cash_movements', v_cash_movements,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_layaway_cash_movement_financial_to_jsonb_v2(v_cash_movement) end,
    'cash_session', null,
    'folio', null,
    'sale', null,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

create or replace function private.execute_layaway_payment_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_id text := private.layaway_request_id_v1(p_request);
  v_payment_payload jsonb := coalesce(p_request->'payment', '{}'::jsonb);
  v_payment_id text;
  v_payment_amount numeric;
  v_payment_method text;
  v_cash_session_id text := private.layaway_request_cash_session_id_v1(p_request);
  v_layaway public.pos_layaways;
  v_existing_payment public.pos_layaway_payments;
  v_payment public.pos_layaway_payments;
  v_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_payment_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYMENT_INVALID' using errcode = 'P0001';
  end if;

  v_payment_id := private.layaway_request_text_v1(v_payment_payload, array['id','payment_id','paymentId']);
  if v_payment_id is null then
    raise exception 'LAYAWAY_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_payment_amount := private.layaway_request_numeric_v1(v_payment_payload, array['amount','total']);
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_payment_payload, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount is null or v_payment_amount <= 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;

  select * into v_existing_payment
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id and p.id = v_payment_id
   for update;
  if v_existing_payment.id is not null then
    if abs(v_existing_payment.amount - v_payment_amount) > 0.005
       or v_existing_payment.payment_method <> v_payment_method then
      raise exception 'LAYAWAY_PAYMENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'LAYAWAY_PAYMENT_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  if v_payment_amount > v_layaway.balance_due + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_BALANCE' using errcode = 'P0001';
  end if;
  v_session := private.layaway_cash_session_v1(
    v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
  );

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, reference_type, reference_id,
    created_by_device_id, created_by_staff_user_id, actor_name,
    cash_station_id, performed_by_actor_key, idempotency_key, metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
    v_session.device_id, v_session.staff_user_id, v_session.actor_key,
    'entrada', round(v_payment_amount, 2), 'Abono Apartado ' || v_layaway_id,
    'layaway_payment', 'layaway', v_layaway_id,
    v_device_id, v_staff_user_id, v_actor_name,
    v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
    jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source', 'layaway_payment',
      'layaway_id', v_layaway_id,
      'payment_id', v_payment_id,
      'payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'),
      'idempotency_key', p_idempotency_key
    )
  ) returning * into v_cash_movement;

  insert into public.pos_layaway_payments (
    id, license_id, layaway_id, payment_method, amount, status,
    cash_session_id, cash_station_id, cash_movement_id, reference,
    request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
    actor_key, actor_name, metadata
  ) values (
    v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
    v_session.id, v_session.cash_station_id, v_cash_movement.id,
    private.layaway_request_text_v1(v_payment_payload, array['reference','ref']),
    p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name,
    jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'))
  ) returning * into v_payment;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
  update public.pos_layaways
     set paid_amount = round(paid_amount + v_payment_amount, 2),
         balance_due = greatest(round(total_amount - (paid_amount + v_payment_amount), 2), 0),
         status = case when paid_amount + v_payment_amount >= total_amount - 0.005 then 'ready' else status end,
         updated_at = now(), server_version = server_version + 1,
         last_idempotency_key = p_idempotency_key
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', 'layaway_payment_confirmed', 'payment_id', v_payment.id,
      'cash_movement_id', v_cash_movement.id, 'paid_amount', v_layaway.paid_amount,
      'balance_due', v_layaway.balance_due),
    v_layaway.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_cash_movement.id),
    v_payment.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
    v_cash_movement.server_version
  );

  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_financial_to_jsonb_v2(r) order by r.item_index), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id and r.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'payment', private.pos_layaway_payment_financial_to_jsonb_v2(v_payment),
    'payments', v_payments,
    'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(v_reservations),
    'cash_movements', v_cash_movements,
    'cash_movement', private.pos_layaway_cash_movement_financial_to_jsonb_v2(v_cash_movement),
    'cash_session', null,
    'folio', null,
    'sale', null,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$;

create or replace function private.execute_layaway_cancel_financial_v1(
  p_context jsonb,
  p_request jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_cash_station_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_id text := private.layaway_request_id_v1(p_request);
  v_cash_session_id text := private.layaway_request_cash_session_id_v1(p_request);
  v_retain_money boolean := private.layaway_request_bool_v1(p_request, array['retain_money','retainMoney','retained_money']);
  v_refund_id text;
  v_layaway public.pos_layaways;
  v_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_reservations jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
  v_reason text := private.layaway_request_text_v1(p_request, array['reason','motivo'], 'Cancelación de apartado');
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;

  if not v_retain_money and v_layaway.paid_amount > 0 then
    v_session := private.layaway_cash_session_v1(
      v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
    );
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
    if coalesce(v_session.expected_cash_total, 0) + 0.005 < v_layaway.paid_amount then
      raise exception 'CASH_INSUFFICIENT_FOR_LAYAWAY_REFUND' using errcode = 'P0001';
    end if;
    v_refund_id := coalesce(
      private.layaway_request_text_v1(p_request, array['refund_id','refundId']),
      v_layaway_id || ':refund'
    );
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name,
      cash_station_id, performed_by_actor_key, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
      v_session.device_id, v_session.staff_user_id, v_session.actor_key,
      'salida', round(v_layaway.paid_amount, 2), 'Reembolso Apartado ' || v_layaway_id,
      'layaway_refund', 'layaway', v_layaway_id,
      v_device_id, v_staff_user_id, v_actor_name,
      v_session.cash_station_id, v_actor_key, p_idempotency_key || ':refund_cash',
      jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'source', 'layaway_refund',
        'layaway_id', v_layaway_id,
        'refund_id', v_refund_id,
        'refund_amount', round(v_layaway.paid_amount, 2),
        'idempotency_key', p_idempotency_key
      )
    ) returning * into v_cash_movement;
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
    update public.pos_layaway_payments
       set status = 'refunded', refunded_at = now(), server_version = server_version + 1,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('refund_id', v_refund_id)
     where license_id = v_license_id and layaway_id = v_layaway_id and status = 'confirmed';
  else
    v_refund_id := private.layaway_request_text_v1(p_request, array['refund_id','refundId']);
  end if;

  v_reservations := private.release_layaway_stock_v1(
    v_license_id, v_layaway_id, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );
  update public.pos_layaways
     set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         server_version = server_version + 1, last_idempotency_key = p_idempotency_key,
         retained_money = v_retain_money,
         retained_amount = case when v_retain_money then paid_amount else 0 end,
         refund_id = case when v_retain_money then null else v_refund_id end,
         refund_cash_movement_id = case when v_cash_movement.id is null then null else v_cash_movement.id end,
         notes = v_reason || case when v_retain_money then ' - Fondos retenidos' else ' - Fondos reembolsados' end,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'cancel_reason', v_reason,
           'refund_id', v_refund_id,
           'refund_amount', case when v_retain_money then 0 else paid_amount end,
           'retained_money', v_retain_money
         )
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'cancel', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', v_reason, 'retain_money', v_retain_money,
      'refund_id', v_refund_id, 'cash_movement_id', case when v_cash_movement.id is null then null else v_cash_movement.id end),
    v_layaway.server_version::integer
  );
  if v_cash_movement.id is not null then
    perform private.record_pos_sync_event(
      v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'refund_id', v_refund_id),
      v_cash_movement.server_version
    );
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'payments', v_payments,
    'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(v_reservations),
    'cash_movements', v_cash_movements,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_layaway_cash_movement_financial_to_jsonb_v2(v_cash_movement) end,
    'cash_session', null,
    'folio', null,
    'sale', null,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
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
  v_actor_key text;
  v_actor_name text;
  v_layaway_id text;
  v_sale_id text;
  v_local_sale_id text;
  v_sale_payload jsonb;
  v_request_items jsonb;
  v_request_payments jsonb;
  v_server_items jsonb;
  v_request_normalized jsonb;
  v_layaway public.pos_layaways;
  v_existing public.pos_sales;
  v_sale public.pos_sales;
  v_sale_payment public.pos_sale_payments;
  v_item jsonb;
  v_payment jsonb;
  v_item_id text;
  v_payment_id text;
  v_item_index integer := 0;
  v_item_count integer;
  v_total numeric;
  v_paid_total numeric;
  v_requested_total numeric;
  v_unit_price numeric;
  v_quantity numeric;
  v_line_total numeric;
  v_line_subtotal numeric;
  v_unit_cost numeric;
  v_discount numeric;
  v_tax numeric;
  v_subtotal numeric;
  v_discount_total numeric;
  v_folio jsonb;
  v_cloud_folio text;
  v_pos_folio text;
  v_folio_sequence bigint;
  v_sold_at timestamptz;
  v_created_at timestamptz;
  v_event public.pos_sync_events;
  v_inventory_movements jsonb := '[]'::jsonb;
  v_sale_items jsonb := '[]'::jsonb;
  v_sale_payments jsonb := '[]'::jsonb;
  v_layaway_payments jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_layaway_id := private.layaway_request_text_v1(p_request, array['layaway_id','layawayId']);
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_license_id::text), hashtext('layaway_completion:' || v_layaway_id));

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_sale_payload := coalesce(p_request->'sale', '{}'::jsonb);
  if jsonb_typeof(v_sale_payload) <> 'object' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_sale_id := private.layaway_request_text_v1(v_sale_payload, array['id','cloud_sale_id','cloudSaleId']);
  v_local_sale_id := coalesce(
    private.layaway_request_text_v1(v_sale_payload, array['local_sale_id','localSaleId']), v_sale_id
  );
  if v_sale_id is null or v_local_sale_id is null then
    raise exception 'LAYAWAY_SALE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
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
    select coalesce(jsonb_agg(private.pos_layaway_sale_item_financial_to_jsonb_v2(i) order by i.created_at, i.id), '[]'::jsonb)
      into v_sale_items
      from public.pos_sale_items i
     where i.license_id = v_license_id and i.sale_id = v_existing.id;
    select coalesce(jsonb_agg(private.pos_layaway_sale_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
      into v_sale_payments
      from public.pos_sale_payments p
     where p.license_id = v_license_id and p.sale_id = v_existing.id;
    select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
      into v_layaway_payments
      from public.pos_layaway_payments p
     where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
    select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
      into v_cash_movements
      from public.pos_cash_movements m
     where m.license_id = v_license_id
       and m.reference_type = 'layaway'
       and m.reference_id = v_layaway_id;
    select coalesce(jsonb_agg(private.pos_layaway_inventory_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
      into v_inventory_movements
      from public.pos_inventory_movements m
     where m.license_id = v_license_id and m.sale_id = v_existing.id;
    select coalesce(max(change_seq), 0) into v_latest_change_seq
      from public.pos_sync_events where license_id = v_license_id;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'mode', 'cloud_layaway_completion',
      'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
      'sale', private.pos_layaway_sale_financial_to_jsonb_v2(v_existing),
      'items', v_sale_items,
      'payments', v_sale_payments,
      'layaway_payments', v_layaway_payments,
      'cash_movements', v_cash_movements,
      'cash_movement', null,
      'inventory_movements', private.financial_inventory_movements_allowlist_v2(v_inventory_movements),
      'folio', v_existing.pos_folio,
      'cash_session', null,
      'event', null,
      'change_seq', v_latest_change_seq,
      'latest_change_seq', v_latest_change_seq,
      'idempotency_key', p_idempotency_key
    );
  end if;

  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_COMPLETED_WITHOUT_SALE' using errcode = 'P0001';
  end if;
  v_total := round(v_layaway.total_amount, 2);
  select coalesce(sum(p.amount), 0)
    into v_paid_total
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id and p.status = 'confirmed';
  if abs(v_paid_total - v_total) > 0.005 or abs(v_layaway.paid_amount - v_total) > 0.005 then
    raise exception 'LAYAWAY_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  v_request_items := coalesce(p_request->'items', '[]'::jsonb);
  v_request_payments := coalesce(p_request->'payments', '[]'::jsonb);
  if jsonb_typeof(v_request_items) <> 'array' or jsonb_typeof(v_request_payments) <> 'array' then
    raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_request_payments) <> 1 then
    raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
  end if;
  v_requested_total := private.layaway_request_numeric_v1(v_sale_payload, array['total']);
  if v_requested_total is not null and abs(v_requested_total - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_request_items) <> jsonb_array_length(v_layaway.items) then
    raise exception 'LAYAWAY_ITEMS_MISMATCH' using errcode = 'P0001';
  end if;
  v_request_normalized := private.normalize_layaway_items_v1(v_request_items, v_total);
  if (
    select coalesce(jsonb_agg(private.canonical_layaway_item_v1(value) order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_request_normalized->'items') with ordinality
  ) is distinct from (
    select coalesce(jsonb_agg(private.canonical_layaway_item_v1(value) order by ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_layaway.items) with ordinality
  ) then
    raise exception 'LAYAWAY_ITEMS_MISMATCH' using errcode = 'P0001';
  end if;
  for v_payment in select value from jsonb_array_elements(v_request_payments) loop
    if lower(coalesce(private.layaway_request_text_v1(v_payment, array['method','payment_method','paymentMethod']), '')) <> 'layaway_completed'
       or abs(coalesce(private.layaway_request_numeric_v1(v_payment, array['amount','total']), 0) - v_total) > 0.005 then
      raise exception 'FINANCIAL_LAYAWAY_PAYMENTS_INVALID' using errcode = 'P0001';
    end if;
  end loop;

  v_server_items := v_layaway.items;
  v_item_count := jsonb_array_length(v_server_items);
  if v_item_count <= 0 then
    raise exception 'LAYAWAY_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  -- Recompute the financial breakdown from the server snapshot.  The client
  -- may replay the same layaway, but it never gets to choose the sale totals
  -- recorded at delivery.
  v_subtotal := 0;
  v_discount_total := 0;
  for v_item in select value from jsonb_array_elements(v_server_items) loop
    v_quantity := private.layaway_request_numeric_v1(v_item, array['quantity','qty']);
    v_unit_price := private.layaway_request_numeric_v1(v_item, array['unit_price','unitPrice','price']);
    if v_quantity is null or v_quantity <= 0 or v_unit_price is null or v_unit_price < 0 then
      raise exception 'LAYAWAY_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_line_subtotal := round(v_quantity * v_unit_price, 2);
    v_discount := greatest(coalesce(private.layaway_request_numeric_v1(
      v_item, array['discount_amount','discountAmount'], 0
    ), 0), 0);
    v_tax := greatest(coalesce(private.layaway_request_numeric_v1(
      v_item, array['tax_amount','taxAmount'], 0
    ), 0), 0);
    if v_discount > v_line_subtotal + 0.005 then
      raise exception 'DISCOUNT_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    if v_tax > 0.005 then
      raise exception 'LAYAWAY_TAX_SOURCE_UNRESOLVED' using errcode = 'P0001';
    end if;
    v_line_total := round(v_line_subtotal - v_discount, 2);
    if private.layaway_request_numeric_v1(v_item, array['line_subtotal','lineSubtotal'], null) is not null
       and abs(private.layaway_request_numeric_v1(v_item, array['line_subtotal','lineSubtotal'], null) - v_line_subtotal) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    if private.layaway_request_numeric_v1(v_item, array['line_total','lineTotal','total','exactTotal'], null) is not null
       and abs(private.layaway_request_numeric_v1(v_item, array['line_total','lineTotal','total','exactTotal'], null) - v_line_total) > 0.005 then
      raise exception 'LAYAWAY_ITEM_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount_total := v_discount_total + v_discount;
  end loop;
  if abs(round(v_subtotal - v_discount_total, 2) - v_total) > 0.005 then
    raise exception 'LAYAWAY_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  begin
    v_sold_at := coalesce(
      nullif(private.layaway_request_text_v1(v_sale_payload, array['sold_at','soldAt','timestamp']), '')::timestamptz,
      now()
    );
    v_created_at := coalesce(
      nullif(private.layaway_request_text_v1(v_sale_payload, array['created_at','createdAt','timestamp']), '')::timestamptz,
      v_sold_at
    );
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_TIMESTAMP_INVALID' using errcode = 'P0001';
  end;

  v_folio := private.next_pos_sale_folio(v_license_id);
  v_cloud_folio := v_folio->>'folio';
  v_pos_folio := v_folio->>'pos_folio';
  v_folio_sequence := (v_folio->>'sequence')::bigint;

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
    coalesce(v_context->>'device_role', 'staff'), v_actor_key, v_actor_name,
    'cloud', 'cloud_committed', 'payment_recorded', 'closed', 'fulfilled',
    'layaway_completed', 'paid', v_cloud_folio,
    private.layaway_request_text_v1(v_sale_payload, array['local_folio','localFolio','folio']),
    v_cloud_folio, v_pos_folio, v_folio_sequence, v_folio_sequence,
    v_layaway.customer_id, v_layaway.customer_name, v_layaway.customer_phone,
    round(v_subtotal, 2), round(v_discount_total, 2), 0, v_total, v_total, 0, 0, v_layaway.currency,
    v_sold_at, v_created_at, now(), now(), null, null, null,
    'not_required', 'not_applied', 'not_applied',
    v_sale_payload,
    coalesce(v_sale_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'layaway_id', v_layaway_id,
      'source_mode', 'cloud_committed',
      'no_cloud_cash_effects', true,
      'payment_verified_from_layaway_payments', true
    ),
    p_idempotency_key, 1, v_layaway_id
  ) returning * into v_sale;

  for v_item in select value from jsonb_array_elements(v_server_items) loop
    v_item_index := v_item_index + 1;
    v_item_id := v_sale.id || ':item:' || v_item_index::text;
    v_quantity := private.layaway_request_numeric_v1(v_item, array['quantity','qty']);
    v_unit_price := private.layaway_request_numeric_v1(v_item, array['unit_price','unitPrice','price']);
    v_line_subtotal := round(v_quantity * v_unit_price, 2);
    v_discount := greatest(coalesce(private.layaway_request_numeric_v1(v_item, array['discount_amount','discountAmount'], 0), 0), 0);
    v_tax := greatest(coalesce(private.layaway_request_numeric_v1(v_item, array['tax_amount','taxAmount'], 0), 0), 0);
    v_line_total := round(v_line_subtotal - v_discount, 2);
    v_unit_cost := coalesce(
      (select r.unit_cost from public.pos_layaway_inventory_reservations r
        where r.license_id = v_license_id and r.layaway_id = v_layaway_id and r.item_index = v_item_index
        limit 1),
      null
    );
    if v_unit_cost is null then
      select greatest(coalesce(
        case when private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is not null
          then b.cost else p.cost end,
        0
      ), 0)
        into v_unit_cost
        from public.pos_products p
        left join public.pos_product_batches b
          on b.license_id = p.license_id
         and b.product_id = p.id
         and b.id = private.layaway_request_text_v1(v_item, array['batch_id','batchId'])
         and b.deleted_at is null
       where p.license_id = v_license_id
         and p.id = private.layaway_request_text_v1(v_item, array['product_id','productId','parentId'])
         and p.deleted_at is null;
      if not found then
        raise exception 'LAYAWAY_PRODUCT_NOT_SYNCED:%', private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']) using errcode = 'P0001';
      end if;
      if private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is not null
         and not exists (
           select 1
             from public.pos_product_batches b
            where b.license_id = v_license_id
              and b.product_id = private.layaway_request_text_v1(v_item, array['product_id','productId','parentId'])
              and b.id = private.layaway_request_text_v1(v_item, array['batch_id','batchId'])
              and b.deleted_at is null
         ) then
        raise exception 'LAYAWAY_RESERVATION_SOURCE_MISSING:%', private.layaway_request_text_v1(v_item, array['batch_id','batchId']) using errcode = 'P0001';
      end if;
    end if;
    if v_unit_cost is null then
      raise exception 'LAYAWAY_PRODUCT_NOT_SYNCED:%', private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']) using errcode = 'P0001';
    end if;
    insert into public.pos_sale_items (
      id, license_id, sale_id, product_id, product_name, product_sku, barcode,
      category_id, category_name, quantity, unit_price, unit_cost, discount_amount,
      tax_amount, line_total, batch_id, batch_sku, batch_expiry_date, rubro,
      inventory_effect_status, stock_source, metadata, server_version
    ) values (
      v_item_id, v_license_id, v_sale.id,
      private.layaway_request_text_v1(v_item, array['product_id','productId','parentId']),
      coalesce(private.layaway_request_text_v1(v_item, array['product_name','productName','name']), 'Producto'),
      private.layaway_request_text_v1(v_item, array['product_sku','productSku','sku']),
      private.layaway_request_text_v1(v_item, array['barcode','barCode']),
      private.layaway_request_text_v1(v_item, array['category_id','categoryId']),
      private.layaway_request_text_v1(v_item, array['category_name','categoryName','rubro','category']),
      v_quantity, v_unit_price, greatest(v_unit_cost, 0), v_discount, v_tax, v_line_total,
      private.layaway_request_text_v1(v_item, array['batch_id','batchId']),
      private.layaway_request_text_v1(v_item, array['batch_sku','batchSku']),
      nullif(private.layaway_request_text_v1(v_item, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.layaway_request_text_v1(v_item, array['rubro','category','categoryName']),
      'not_applied', case when private.layaway_request_text_v1(v_item, array['batch_id','batchId']) is null then 'product' else 'batch' end,
      coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'layaway_id', v_layaway_id,
        'snapshot_only', true
      ),
      1
    );
  end loop;

  v_payment_id := v_sale.id || ':payment:completion';
  insert into public.pos_sale_payments (
    id, license_id, sale_id, method, amount, received_amount, change_amount,
    reference, cash_session_id, cash_movement_id, customer_ledger_id, metadata, server_version
  ) values (
    v_payment_id, v_license_id, v_sale.id, 'layaway_completed', v_total, v_total, 0,
    null, null, null, null,
    jsonb_build_object('phase', 'cloud_layaways_server_contract_r1', 'layaway_id', v_layaway_id,
      'cashAlreadyRecorded', true, 'noAdditionalCashMovement', true), 1
  ) returning * into v_sale_payment;

  v_inventory_movements := private.consume_layaway_stock_v1(
    v_license_id, v_layaway_id, v_sale.id, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );
  update public.pos_sales
     set inventory_effect_status = case when jsonb_array_length(v_inventory_movements) > 0 then 'applied' else 'not_required' end,
         effects_status = case when jsonb_array_length(v_inventory_movements) > 0 then 'inventory_applied' else 'payment_recorded' end,
         updated_at = now(), server_version = server_version + 1
   where license_id = v_license_id and id = v_sale.id
   returning * into v_sale;
  update public.pos_layaways
     set status = 'completed', conversion_sale_id = v_sale.id, completed_at = now(),
         updated_at = now(), server_version = server_version + 1,
         last_idempotency_key = p_idempotency_key,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'completedSaleId', v_sale.id, 'completedByActorKey', v_actor_key,
           'folio', v_pos_folio, 'inventory_effect_status', v_sale.inventory_effect_status
         )
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'sale', v_sale.id, 'cloud_commit', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('sale_id', v_sale.id, 'layaway_id', v_layaway_id,
      'folio', v_pos_folio, 'cash_effect_status', 'not_required',
      'inventory_effect_status', v_sale.inventory_effect_status),
    v_sale.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('status', 'completed', 'sale_id', v_sale.id, 'folio', v_pos_folio),
    v_layaway.server_version::integer
  );
  perform private.record_pos_sale_audit_event(
    v_license_id, v_sale.id, 'sale.layaway_completed', v_device_id, v_staff_user_id,
    v_actor_name,
    jsonb_build_object('sale_id', v_sale.id, 'layaway_id', v_layaway_id,
      'folio', v_pos_folio, 'paid_total', v_paid_total,
      'cash_effect_status', 'not_required', 'inventory_effect_status', v_sale.inventory_effect_status,
      'idempotency_key', p_idempotency_key)
  );

  select coalesce(jsonb_agg(private.pos_layaway_sale_item_financial_to_jsonb_v2(i) order by i.created_at, i.id), '[]'::jsonb)
    into v_sale_items from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_layaway_sale_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_sale_payments from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_layaway_payments from public.pos_layaway_payments p where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway_completion',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'sale', private.pos_layaway_sale_financial_to_jsonb_v2(v_sale),
    'items', v_sale_items,
    'payments', v_sale_payments,
    'layaway_payments', v_layaway_payments,
    'cash_movements', v_cash_movements,
    'cash_movement', null,
    'cash_session', null,
    'inventory_movements', private.financial_inventory_movements_allowlist_v2(v_inventory_movements),
    'folio', v_pos_folio,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
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
set statement_timeout = '45s'
set lock_timeout = '20s'
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
  v_requires_cash boolean := false;
  v_layaway_id text;
  v_payment_payload jsonb;
  v_rate_limit jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key, p_device_fingerprint, p_staff_session_token,
      'pos_execute_financial_operation_v1.layaway', 'POS_WRITE',
      120, 600, 300, 'RPC_RATE_LIMITED',
      jsonb_build_object('operation_type', p_operation_type)
    );
    if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
      return public.build_pos_rpc_rate_limited_response(v_rate_limit);
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    perform private.assert_cloud_layaways_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'pos');
  end if;

  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
    if p_operation_type = 'layaway.payment' then
      v_requires_cash := true;
    elsif p_operation_type = 'layaway.create' then
      v_payment_payload := private.layaway_payment_payload_v1(p_request);
      v_requires_cash := coalesce(private.layaway_request_numeric_v1(v_payment_payload, array['amount', 'total'], 0), 0) > 0;
    else
      v_layaway_id := private.layaway_request_id_v1(p_request);
      v_requires_cash := not private.layaway_request_bool_v1(p_request, array['retain_money', 'retainMoney', 'retained_money'])
        and exists (
          select 1 from public.pos_layaways l
           where l.license_id = v_license_id and l.id = v_layaway_id and l.paid_amount > 0
        );
    end if;

    if v_requires_cash and v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_cash_session_id is not null then
      select s.cash_station_id into v_session_station_id
        from public.pos_cash_sessions s
       where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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
      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
        raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
      end if;
      if (select actor_key from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) is distinct from v_actor_key then
        raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation_type in ('cash.open', 'sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_canonical := private.canonical_layaway_request_v1(p_operation_type, p_request);
    v_execution := private.layaway_execution_request_v1(p_request);
  else
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);
  end if;

  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );
  if v_operation.status = 'completed' then
    return private.public_financial_response_v1(
      p_operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    );
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
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric,
        v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source', 'reference_type', v_execution->>'reference_type',
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
    when 'layaway.create' then
      v_response := private.execute_layaway_create_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.payment' then
      v_response := private.execute_layaway_payment_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.cancel' then
      v_response := private.execute_layaway_cancel_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
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

create or replace function public.pos_get_financial_operation_receipt(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_operation public.pos_financial_operations;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  perform private.assert_financial_request_hash_v1(p_request_hash);
  -- Wait for an in-flight executor with this tenant/K to commit or roll back,
  -- then read a fresh statement snapshot.  A committed unresolved row is the
  -- only legitimate PROCESSING response; transient in-flight work is never
  -- misreported as a permanent NOT_FOUND.
  perform private.lock_financial_operation_v1(v_license_id, p_idempotency_key);
  select * into v_operation from public.pos_financial_operations o
  where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then return jsonb_build_object('status', 'NOT_FOUND'); end if;
  begin
    perform private.assert_financial_operation_origin_v1(v_operation, v_actor_key, v_device_id, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('status', 'NOT_FOUND');
  end;
  if v_operation.request_hash is distinct from p_request_hash then
    return jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  if v_operation.status = 'processing' then
    return jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
  end if;
  return jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', private.public_financial_response_v1(
      v_operation.operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    ));
end;
$$;


revoke all on function private.financial_layaway_item_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_items_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_payment_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_payments_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_reservation_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_reservations_allowlist_v2(jsonb) from public;
revoke all on function private.financial_cash_movement_allowlist_v2(jsonb) from public;
revoke all on function private.financial_cash_movements_allowlist_v2(jsonb) from public;
revoke all on function private.financial_inventory_movement_allowlist_v2(jsonb) from public;
revoke all on function private.financial_inventory_movements_allowlist_v2(jsonb) from public;
revoke all on function private.financial_sale_allowlist_v2(jsonb) from public;
revoke all on function private.financial_sale_item_allowlist_v2(jsonb) from public;
revoke all on function private.financial_sale_items_allowlist_v2(jsonb) from public;
revoke all on function private.financial_sale_payment_allowlist_v2(jsonb) from public;
revoke all on function private.financial_sale_payments_allowlist_v2(jsonb) from public;
revoke all on function private.financial_event_allowlist_v2(jsonb) from public;
revoke all on function private.financial_layaway_response_allowlist_v2(text, jsonb) from public;
revoke all on function private.pos_layaway_financial_to_jsonb_v2(public.pos_layaways) from public;
revoke all on function private.pos_layaway_payment_financial_to_jsonb_v2(public.pos_layaway_payments) from public;
revoke all on function private.pos_layaway_reservation_financial_to_jsonb_v2(public.pos_layaway_inventory_reservations) from public;
revoke all on function private.pos_layaway_cash_movement_financial_to_jsonb_v2(public.pos_cash_movements) from public;
revoke all on function private.pos_layaway_inventory_movement_financial_to_jsonb_v2(public.pos_inventory_movements) from public;
revoke all on function private.pos_layaway_sale_financial_to_jsonb_v2(public.pos_sales) from public;
revoke all on function private.pos_layaway_sale_item_financial_to_jsonb_v2(public.pos_sale_items) from public;
revoke all on function private.pos_layaway_sale_payment_financial_to_jsonb_v2(public.pos_sale_payments) from public;
revoke all on function private.pos_layaway_event_financial_to_jsonb_v2(public.pos_sync_events) from public;

revoke all on function public.pos_execute_financial_operation_v1(
  text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.pos_execute_financial_operation_v1(
  text, text, text, text, text, text, text, jsonb
) to anon, authenticated;

revoke all on function public.pos_get_financial_operation_receipt(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.pos_get_financial_operation_receipt(
  text, text, text, text, text, text
) to anon, authenticated;


notify pgrst, 'reload schema';

commit;
