-- ADMIN.STAFF.RBAC.R2B
-- Sale price, discount, cost, and arithmetic authority closure.
--
-- This migration deliberately keeps the existing rate-limited public RPCs and
-- the existing transaction engines.  The service_role-only *_unlimited entry
-- points are renamed behind a private compatibility boundary and receive a
-- server-authorized payload first.  The legacy engines therefore retain their
-- cash, inventory, credit, folio, actor, and idempotency effects without
-- retaining client authority over financial values.

begin;

-- The legacy idempotency helper did not compare hashes on a conflict.  Keep
-- compatibility for old rows with a NULL hash, but make every new/replayed
-- sale request fail closed when its request bytes differ.
create or replace function private.insert_pos_idempotency_processing(
  p_license_id uuid,
  p_idempotency_key text,
  p_operation_type text,
  p_entity_type text,
  p_entity_id text,
  p_request_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row_count integer := 0;
  v_existing_hash text;
  v_existing_status text;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pos_idempotency_keys (
    license_id, idempotency_key, operation_type, entity_type,
    entity_id, request_hash, status, expires_at
  ) values (
    p_license_id, p_idempotency_key, p_operation_type, p_entity_type,
    p_entity_id, p_request_hash, 'processing', now() + interval '7 days'
  )
  on conflict (license_id, idempotency_key) do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count > 0 then return true; end if;

  select k.request_hash, k.status
  into v_existing_hash, v_existing_status
  from public.pos_idempotency_keys k
  where k.license_id = p_license_id
    and k.idempotency_key = p_idempotency_key
  for update;

  if p_request_hash is not null
     and v_existing_hash is not null
     and v_existing_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if v_existing_hash is null and p_request_hash is not null
     and v_existing_status = 'processing' then
    update public.pos_idempotency_keys
    set request_hash = p_request_hash
    where license_id = p_license_id
      and idempotency_key = p_idempotency_key
      and request_hash is null;
  end if;

  return false;
end;
$function$;

create or replace function private.r2b_modifier_matches_v1(
  p_selected jsonb,
  p_option jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select exists (
    select 1
    from unnest(array[
      nullif(btrim(p_selected->>'id'), ''),
      nullif(btrim(p_selected->>'optionId'), ''),
      nullif(btrim(p_selected->>'option_id'), ''),
      nullif(btrim(p_selected->>'name'), ''),
      nullif(btrim(p_selected->>'ingredientId'), ''),
      nullif(btrim(p_selected->>'ingredient_id'), '')
    ]) as selected_identity(value)
    cross join unnest(array[
      nullif(btrim(p_option->>'id'), ''),
      nullif(btrim(p_option->>'optionId'), ''),
      nullif(btrim(p_option->>'option_id'), ''),
      nullif(btrim(p_option->>'name'), ''),
      nullif(btrim(p_option->>'ingredientId'), ''),
      nullif(btrim(p_option->>'ingredient_id'), '')
    ]) as option_identity(value)
    where selected_identity.value is not null
      and option_identity.value is not null
      and selected_identity.value = option_identity.value
  );
$function$;

create or replace function private.r2b_normalize_discount_v1(
  p_input jsonb,
  p_subtotal numeric,
  p_scope text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_raw jsonb := coalesce(p_input, 'null'::jsonb);
  v_type text := 'amount';
  v_value numeric := 0;
  v_amount numeric := 0;
  v_reason text;
  v_result jsonb;
begin
  if jsonb_typeof(v_raw) = 'null' then
    return jsonb_build_object('amount', 0, 'discount', null);
  end if;

  begin
    if jsonb_typeof(v_raw) = 'object' then
      v_type := lower(btrim(coalesce(
        v_raw->>'type', v_raw->>'discountType', v_raw->>'discount_type', 'amount'
      )));
      v_value := coalesce(nullif(btrim(coalesce(
        v_raw->>'value', v_raw->>'percent', v_raw->>'percentage', v_raw->>'amount', '0'
      )), '')::numeric, 0);
      v_reason := nullif(btrim(coalesce(
        v_raw->>'reason', v_raw->>'discountReason', v_raw->>'discount_reason', ''
      )), '');
    else
      v_value := coalesce(nullif(btrim(v_raw #>> '{}'), '')::numeric, 0);
    end if;
  exception when others then
    raise exception 'DISCOUNT_VALUE_INVALID' using errcode = 'P0001';
  end;

  if v_type in ('percent', 'percentage', 'porcentaje', '%') then
    v_type := 'percent';
  else
    v_type := 'amount';
  end if;

  if v_value < 0 then
    raise exception 'DISCOUNT_VALUE_INVALID' using errcode = 'P0001';
  end if;
  if v_type = 'percent' and v_value > 100 then
    raise exception 'DISCOUNT_PERCENT_INVALID' using errcode = 'P0001';
  end if;

  v_amount := case
    when v_type = 'percent' then round(greatest(coalesce(p_subtotal, 0), 0) * v_value / 100, 2)
    else round(v_value, 2)
  end;

  if v_amount > greatest(coalesce(p_subtotal, 0), 0) + 0.005 then
    raise exception 'DISCOUNT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;

  if v_amount <= 0 then
    return jsonb_build_object('amount', 0, 'discount', null);
  end if;
  if v_reason is null then
    raise exception 'DISCOUNT_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'type', v_type,
    'value', round(v_value, 4),
    'amount', v_amount,
    'reason', v_reason,
    'scope', coalesce(nullif(btrim(p_scope), ''), 'sale'),
    'appliedAt', coalesce(v_raw->>'appliedAt', v_raw->>'applied_at'),
    'appliedByRole', coalesce(v_raw->>'appliedByRole', v_raw->>'applied_by_role'),
    'appliedByStaffUserId', coalesce(v_raw->>'appliedByStaffUserId', v_raw->>'applied_by_staff_user_id'),
    'appliedByDeviceId', coalesce(v_raw->>'appliedByDeviceId', v_raw->>'applied_by_device_id')
  ));
  return jsonb_build_object('amount', v_amount, 'discount', v_result);
end;
$function$;

create or replace function private.r2b_authoritative_modifiers_v1(
  p_product public.pos_products,
  p_item jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_groups jsonb := coalesce(p_product.modifiers, '[]'::jsonb);
  v_selected jsonb := coalesce(
    p_item->'selected_modifiers', p_item->'selectedModifiers',
    p_item->'metadata'->'selected_modifiers', p_item->'metadata'->'selectedModifiers',
    '[]'::jsonb
  );
  v_group jsonb;
  v_option jsonb;
  v_selected_option jsonb;
  v_canonical jsonb := '[]'::jsonb;
  v_canonical_option jsonb;
  v_unit_total numeric := 0;
  v_found boolean;
  v_required_found boolean;
  v_price numeric;
  v_ingredient_id text;
  v_ingredient_quantity numeric;
  v_ingredient_unit text;
begin
  if jsonb_typeof(v_groups) <> 'array' or jsonb_typeof(v_selected) <> 'array' then
    raise exception 'MODIFIER_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  for v_group in select value from jsonb_array_elements(v_groups) loop
    if coalesce((v_group->>'required')::boolean, false) then
      v_required_found := false;
      for v_option in select value from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb)) loop
        if exists (
          select 1 from jsonb_array_elements(v_selected) selected(value)
          where private.r2b_modifier_matches_v1(selected.value, v_option)
        ) then
          v_required_found := true;
          exit;
        end if;
      end loop;
      if not v_required_found then
        raise exception 'MODIFIER_REQUIRED:%', coalesce(v_group->>'name', 'group') using errcode = 'P0001';
      end if;
    end if;
  end loop;

  for v_selected_option in select value from jsonb_array_elements(v_selected) loop
    if jsonb_typeof(v_selected_option) <> 'object' then
      raise exception 'MODIFIER_PAYLOAD_INVALID' using errcode = 'P0001';
    end if;

    v_found := false;
    v_option := null;
    for v_group in select value from jsonb_array_elements(v_groups) loop
      for v_option in select value from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb)) loop
        if private.r2b_modifier_matches_v1(v_selected_option, v_option) then
          v_found := true;
          exit;
        end if;
      end loop;
      if v_found then exit; end if;
    end loop;

    if not v_found then
      raise exception 'MODIFIER_NOT_AUTHORIZED:%', coalesce(
        v_selected_option->>'name', v_selected_option->>'id', 'unknown'
      ) using errcode = 'P0001';
    end if;

    begin
      v_price := coalesce(nullif(btrim(coalesce(
        v_option->>'price', v_option->>'priceDelta', v_option->>'price_delta', '0'
      )), '')::numeric, 0);
      v_ingredient_quantity := coalesce(nullif(btrim(coalesce(
        v_option->>'ingredientQuantity', v_option->>'ingredient_quantity', v_option->>'quantity', ''
      )), '')::numeric, null);
    exception when others then
      raise exception 'MODIFIER_PRICE_INVALID' using errcode = 'P0001';
    end;
    if v_price < 0 then
      raise exception 'MODIFIER_PRICE_INVALID' using errcode = 'P0001';
    end if;

    v_ingredient_id := nullif(btrim(coalesce(v_option->>'ingredientId', v_option->>'ingredient_id', '')), '');
    v_ingredient_unit := nullif(btrim(coalesce(v_option->>'ingredientUnit', v_option->>'ingredient_unit', v_option->>'unit', '')), '');
    v_unit_total := v_unit_total + v_price;
    v_canonical_option := jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(v_option->>'id', v_option->>'optionId', v_option->>'option_id'),
      'optionId', coalesce(v_option->>'optionId', v_option->>'option_id', v_option->>'id'),
      'name', coalesce(v_option->>'name', v_option->>'publicName', 'Opción'),
      'price', v_price,
      'ingredientId', case when v_ingredient_id is not null and coalesce(v_ingredient_quantity, 0) > 0 then v_ingredient_id end,
      'ingredientQuantity', case when v_ingredient_id is not null and coalesce(v_ingredient_quantity, 0) > 0 then v_ingredient_quantity end,
      'ingredientUnit', case when v_ingredient_id is not null and coalesce(v_ingredient_quantity, 0) > 0 then v_ingredient_unit end,
      'tracksInventory', (v_ingredient_id is not null and coalesce(v_ingredient_quantity, 0) > 0),
      'quantity', case when v_ingredient_id is not null and coalesce(v_ingredient_quantity, 0) > 0 then v_ingredient_quantity end
    ));
    v_canonical := v_canonical || jsonb_build_array(v_canonical_option);
  end loop;

  return jsonb_build_object('unit_total', round(v_unit_total, 4), 'modifiers', v_canonical);
end;
$function$;

create or replace function private.r2b_assert_sale_idempotency_v1(
  p_license_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.pos_idempotency_keys;
begin
  select * into v_row
  from public.pos_idempotency_keys k
  where k.license_id = p_license_id
    and k.idempotency_key = p_idempotency_key
  for update;

  if v_row.idempotency_key is null then
    return jsonb_build_object('status', 'new');
  end if;
  if v_row.request_hash is not null
     and v_row.request_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_row.status = 'completed' and v_row.response_payload is not null then
    return jsonb_build_object('status', 'completed', 'response', v_row.response_payload);
  end if;
  if v_row.status = 'processing' then
    return jsonb_build_object('status', 'processing');
  end if;
  return jsonb_build_object('status', coalesce(v_row.status, 'unknown'));
end;
$function$;

create or replace function private.r2b_authorize_sale_financial_request_v1(
  p_operation_type text,
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_sale jsonb,
  p_items jsonb,
  p_payments jsonb,
  p_cash_session_id text,
  p_customer_id text,
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

    v_raw_batches := coalesce(
      v_item_payload->'batches_used', v_item_payload->'batchesUsed',
      v_item_payload->'metadata'->'batches_used', v_item_payload->'metadata'->'batchesUsed',
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

-- Preserve the existing effect engines behind names that cannot be reached by
-- anon/authenticated clients.  The public wrappers remain the rate-limited
-- names already exposed by the security-surface migration.
alter function public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)
  rename to pos_create_cloud_sale_cashier_legacy_r2b;
alter function public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)
  rename to pos_create_cloud_sale_cashier_inventory_legacy_r2b;
alter function public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)
  rename to pos_create_cloud_sale_credit_legacy_r2b;

create or replace function private.r2b_finalize_inventory_costs_v1(
  p_license_id uuid,
  p_sale_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.pos_sale_items si
  set unit_cost = costs.weighted_unit_cost,
      metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object(
        'r2bCostAuthority', 'pos_inventory_movements'
      )
  from (
    select m.sale_item_id,
           round(sum(coalesce(m.total_cost, 0)) / nullif(sum(m.quantity), 0), 4) as weighted_unit_cost
    from public.pos_inventory_movements m
    where m.license_id = p_license_id
      and m.sale_id = p_sale_id
      and m.movement_type = 'sale_out'
      and m.quantity > 0
    group by m.sale_item_id
  ) costs
  where si.license_id = p_license_id
    and si.sale_id = p_sale_id
    and si.id = costs.sale_item_id
    and costs.weighted_unit_cost is not null;
end;
$function$;

create or replace function public.pos_create_cloud_sale_cashier_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_cash_session_id text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized jsonb;
  v_response jsonb;
  v_operation text := 'sale.cashier';
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) = 'object'
     and coalesce((p_sale->'metadata'->>'cloudInventoryEffects')::boolean, false) then
    v_operation := 'sale.cashier_inventory';
  end if;
  v_authorized := private.r2b_authorize_sale_financial_request_v1(
    v_operation, p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_sale, p_items, p_payments,
    p_cash_session_id, null, p_idempotency_key
  );
  if v_authorized ? 'idempotent_response' then return v_authorized->'idempotent_response'; end if;
  if coalesce((v_authorized->>'idempotency_processing')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_authorized->>'idempotency_key');
  end if;
  v_response := public.pos_create_cloud_sale_cashier_legacy_r2b(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_authorized->'sale', v_authorized->'items', v_authorized->'payments',
    p_cash_session_id, v_authorized->>'idempotency_key'
  );
  if coalesce((v_response->>'success')::boolean, false)
     and v_operation = 'sale.cashier_inventory' then
    perform private.r2b_finalize_inventory_costs_v1(
      (v_authorized->>'license_id')::uuid,
      v_authorized->'sale'->>'id'
    );
  end if;
  return v_response;
end;
$function$;

create or replace function public.pos_create_cloud_sale_cashier_inventory_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_cash_session_id text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized jsonb;
  v_response jsonb;
begin
  v_authorized := private.r2b_authorize_sale_financial_request_v1(
    'sale.cashier_inventory', p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_sale, p_items, p_payments,
    p_cash_session_id, null, p_idempotency_key
  );
  if v_authorized ? 'idempotent_response' then return v_authorized->'idempotent_response'; end if;
  if coalesce((v_authorized->>'idempotency_processing')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_authorized->>'idempotency_key');
  end if;
  v_response := public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_authorized->'sale', v_authorized->'items', v_authorized->'payments',
    p_cash_session_id, v_authorized->>'idempotency_key'
  );
  if coalesce((v_response->>'success')::boolean, false) then
    perform private.r2b_finalize_inventory_costs_v1(
      (v_authorized->>'license_id')::uuid,
      v_authorized->'sale'->>'id'
    );
  end if;
  return v_response;
end;
$function$;

create or replace function public.pos_create_cloud_sale_credit_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_cash_session_id text default null,
  p_customer_id text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_authorized jsonb;
  v_response jsonb;
begin
  v_authorized := private.r2b_authorize_sale_financial_request_v1(
    'sale.credit', p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_sale, p_items, p_payments,
    p_cash_session_id, p_customer_id, p_idempotency_key
  );
  if v_authorized ? 'idempotent_response' then return v_authorized->'idempotent_response'; end if;
  if coalesce((v_authorized->>'idempotency_processing')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta fiada ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_authorized->>'idempotency_key');
  end if;
  v_response := public.pos_create_cloud_sale_credit_legacy_r2b(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_authorized->'sale', v_authorized->'items', v_authorized->'payments',
    p_cash_session_id, v_authorized->>'customer_id', v_authorized->>'idempotency_key'
  );
  if coalesce((v_response->>'success')::boolean, false) then
    perform private.r2b_finalize_inventory_costs_v1(
      (v_authorized->>'license_id')::uuid,
      v_authorized->'sale'->>'id'
    );
  end if;
  return v_response;
end;
$function$;

revoke all on function private.insert_pos_idempotency_processing(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function private.r2b_modifier_matches_v1(jsonb,jsonb) from public, anon, authenticated;
revoke all on function private.r2b_normalize_discount_v1(jsonb,numeric,text) from public, anon, authenticated;
revoke all on function private.r2b_authoritative_modifiers_v1(public.pos_products,jsonb) from public, anon, authenticated;
revoke all on function private.r2b_assert_sale_idempotency_v1(uuid,text,text) from public, anon, authenticated;
revoke all on function private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function private.r2b_finalize_inventory_costs_v1(uuid,text) from public, anon, authenticated;

revoke all on function public.pos_create_cloud_sale_cashier_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.pos_create_cloud_sale_cashier_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) to service_role;

revoke all on function public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) to service_role;

comment on function public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)
  is 'R2B server-authorized cashier sale engine; service_role only.';
comment on function public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)
  is 'R2B server-authorized inventory cashier sale engine; service_role only.';
comment on function public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)
  is 'R2B server-authorized credit sale engine; service_role only.';

commit;
