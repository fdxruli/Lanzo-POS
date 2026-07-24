create or replace function public.pos_create_cloud_sale_credit(
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
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_device_role text;
  v_actor_key text;
  v_actor_name text;
  v_features jsonb;
  v_inventory_enabled boolean := false;
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;
  v_sale public.pos_sales;
  v_customer public.pos_customers;
  v_customer_after public.pos_customers;
  v_cash_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_ledger_charge public.pos_customer_ledger;
  v_ledger_payment public.pos_customer_ledger;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_items_response jsonb := '[]'::jsonb;
  v_payments_response jsonb := '[]'::jsonb;
  v_inventory_movements_response jsonb := '[]'::jsonb;
  v_folio jsonb;
  v_cloud_folio text;
  v_folio_sequence bigint;
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_total numeric;
  v_subtotal numeric;
  v_discount_total numeric;
  v_tax_total numeric;
  v_amount_paid numeric := 0;
  v_payload_amount_paid numeric;
  v_change_amount numeric := 0;
  v_balance_due numeric;
  v_debt_before numeric := 0;
  v_debt_after numeric := 0;
  v_cash_component numeric := 0;
  v_non_cash_component numeric := 0;
  v_cash_received numeric := 0;
  v_cash_change numeric := 0;
  v_payment_method_raw text;
  v_payment_method text;
  v_payment_status text;
  v_effects_status text;
  v_item_count integer := 0;
  v_payment_count integer := 0;
  v_item record;
  v_payment record;
  v_item_id text;
  v_payment_id text;
  v_method_raw text;
  v_method text;
  v_payment_amount numeric;
  v_received_amount numeric;
  v_payment_change numeric;
  v_line_total numeric;
  v_qty numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_sold_at timestamptz;
  v_created_at timestamptz;
  v_cash_session_candidate text;
  v_preflight jsonb := jsonb_build_object('ok', true, 'inventory_effect_status', 'not_applied', 'allocations', '[]'::jsonb);
  v_apply_response jsonb := jsonb_build_object('success', true, 'inventory_effect_status', 'not_applied', 'inventory_movements', '[]'::jsonb);
  v_inventory_effect_status text := 'not_applied';
  v_latest_change_seq bigint;
  v_initial_exists boolean := false;
  v_initial_ledger public.pos_customer_ledger;
  v_amount_paid_text text;
  v_balance_due_text text;
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_credit_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  perform private.assert_pos_permission(v_context, 'customers');

  v_features := coalesce(v_context->'features', '{}'::jsonb);
  v_inventory_enabled := coalesce((v_features->>'cloud_sales_inventory')::boolean, false)
    and coalesce((v_features->>'cloud_products_sync')::boolean, false);

  if v_inventory_enabled then
    perform private.assert_cloud_sales_inventory_enabled(v_context);
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['id','cloud_sale_id','cloudSaleId']), 'sale_' || replace(gen_random_uuid()::text, '-', ''));
  v_local_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['local_sale_id','localSaleId']), v_sale_id);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.cloud_credit:' || v_local_sale_id || ':' || v_device_id::text);

  select * into v_idem
  from public.pos_idempotency_keys
  where license_id = v_license_id and idempotency_key = v_idempotency_key
  limit 1;

  if v_idem.status = 'completed' and v_idem.response_payload is not null then
    return v_idem.response_payload;
  elsif v_idem.status = 'processing' then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta fiada ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_idempotency_key);
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'sales.cloud_credit',
    'sale',
    v_sale_id,
    md5(coalesce(p_sale::text, '') || coalesce(p_items::text, '') || coalesce(p_payments::text, '') || coalesce(p_cash_session_id, '') || coalesce(p_customer_id, ''))
  );

  if not v_inserted_idem then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta fiada ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_idempotency_key);
  end if;

  update public.pos_idempotency_keys set entity_id = v_sale_id where license_id = v_license_id and idempotency_key = v_idempotency_key;

  select count(*) into v_item_count from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
  if v_item_count <= 0 then raise exception 'SALE_ITEMS_REQUIRED' using errcode = 'P0001'; end if;

  v_customer_id := coalesce(nullif(btrim(p_customer_id), ''), private.pos_sale_jsonb_text(p_sale, array['customer_id','customerId']));
  if v_customer_id is null or btrim(v_customer_id) = '' then raise exception 'CREDIT_SALE_CUSTOMER_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_customer
  from public.pos_customers c
  where c.license_id = v_license_id and c.id = v_customer_id
  for update;

  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_customer.deleted_at is not null then raise exception 'CUSTOMER_DELETED' using errcode = 'P0001'; end if;

  v_customer_name := coalesce(private.pos_sale_jsonb_text(p_sale, array['customer_name','customerName']), v_customer.name);
  v_customer_phone := coalesce(private.pos_sale_jsonb_text(p_sale, array['customer_phone','customerPhone']), v_customer.phone);

  v_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['total'], 0), 0);
  v_subtotal := greatest(private.pos_sale_jsonb_numeric(p_sale, array['subtotal'], v_total), 0);
  v_discount_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['discount_total','discountTotal'], 0), 0);
  v_tax_total := greatest(private.pos_sale_jsonb_numeric(p_sale, array['tax_total','taxTotal'], 0), 0);
  if v_total <= 0 then raise exception 'SALE_TOTAL_INVALID' using errcode = 'P0001'; end if;

  v_payment_method_raw := lower(btrim(coalesce(private.pos_sale_jsonb_text(p_sale, array['payment_method','paymentMethod']), 'credit')));
  if v_payment_method_raw in ('mixed_credit','partial_credit','credito_parcial','crédito_parcial') then
    v_payment_method := 'mixed_credit';
  else
    v_payment_method := private.normalize_pos_sale_payment_method(v_payment_method_raw);
  end if;
  if v_payment_method not in ('credit','mixed_credit') then
    raise exception 'SALE_PAYMENT_METHOD_NOT_CREDIT:%', coalesce(v_payment_method_raw, '') using errcode = 'P0001';
  end if;

  select count(*) into v_payment_count from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb));

  for v_payment in select value as payload, ordinality from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality loop
    v_method_raw := private.pos_sale_jsonb_text(v_payment.payload, array['method','payment_method','paymentMethod'], 'credit');
    v_method := private.normalize_pos_sale_payment_method(v_method_raw);
    if lower(btrim(coalesce(v_method_raw, ''))) in ('mixed_credit','partial_credit') then v_method := 'credit'; end if;
    if v_method = 'credit' then continue; end if;
    if v_method not in ('cash','card','transfer') then raise exception 'SALE_INITIAL_PAYMENT_METHOD_NOT_ALLOWED:%', coalesce(v_method_raw, '') using errcode = 'P0001'; end if;

    v_payment_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['amount','total'], 0), 0);
    v_received_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['received_amount','receivedAmount'], v_payment_amount), 0);
    v_payment_change := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['change_amount','changeAmount'], 0), 0);
    if v_payment_amount <= 0 then raise exception 'INITIAL_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001'; end if;

    if v_method = 'cash' then
      v_cash_component := v_cash_component + v_payment_amount;
      v_cash_received := v_cash_received + v_received_amount;
      v_cash_change := v_cash_change + v_payment_change;
    else
      v_non_cash_component := v_non_cash_component + v_payment_amount;
    end if;
    v_amount_paid := v_amount_paid + v_payment_amount;
    v_change_amount := v_change_amount + v_payment_change;
  end loop;

  v_amount_paid_text := private.pos_sale_jsonb_text(p_sale, array['amount_paid','amountPaid','abono']);
  if v_amount_paid_text is not null and btrim(v_amount_paid_text) <> '' then
    v_payload_amount_paid := greatest(v_amount_paid_text::numeric, 0);
    if v_payment_count = 0 and v_payload_amount_paid > 0.005 then raise exception 'INITIAL_PAYMENT_DETAIL_REQUIRED' using errcode = 'P0001'; end if;
    if v_payment_count > 0 and abs(v_payload_amount_paid - v_amount_paid) > 0.05 then raise exception 'INITIAL_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001'; end if;
    if v_payment_count = 0 then v_amount_paid := v_payload_amount_paid; end if;
  end if;

  if v_amount_paid < 0 or v_amount_paid > v_total + 0.005 then raise exception 'INITIAL_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001'; end if;

  v_balance_due_text := private.pos_sale_jsonb_text(p_sale, array['balance_due','balanceDue','saldoPendiente']);
  if v_balance_due_text is not null and btrim(v_balance_due_text) <> '' then
    v_balance_due := greatest(v_balance_due_text::numeric, 0);
    if abs((v_amount_paid + v_balance_due) - v_total) > 0.05 then raise exception 'CREDIT_SALE_BALANCE_MISMATCH' using errcode = 'P0001'; end if;
  else
    v_balance_due := greatest(v_total - v_amount_paid, 0);
  end if;
  if v_balance_due <= 0.005 then raise exception 'CREDIT_SALE_BALANCE_REQUIRED' using errcode = 'P0001'; end if;

  if v_cash_component > 0 then
    perform private.assert_cash_permission(v_context);
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.actor_key = v_actor_key and s.status = 'open' and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;
    if v_cash_session_candidate is null then raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;

    select * into v_cash_session
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_cash_session_candidate and s.deleted_at is null
    for update;

    if v_cash_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_cash_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
    if v_cash_session.actor_key <> v_actor_key then raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001'; end if;
  end if;

  if v_inventory_enabled then
    v_preflight := private.resolve_sale_inventory_allocations(v_license_id, p_items, v_sale_id);
    if coalesce((v_preflight->>'ok')::boolean, false) is not true then
      raise exception '%', coalesce(v_preflight->>'code', 'CLOUD_INVENTORY_PREFLIGHT_FAILED') using errcode = 'P0001';
    end if;
  end if;

  select exists(select 1 from public.pos_customer_ledger l where l.license_id = v_license_id and l.customer_id = v_customer_id and l.deleted_at is null) into v_initial_exists;
  if not v_initial_exists and coalesce(v_customer.debt, 0) > 0 then
    insert into public.pos_customer_ledger (
      id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
      payment_method, note, reference_type, reference_id, actor_device_id,
      actor_staff_user_id, actor_key, actor_name, idempotency_key, metadata
    ) values (
      'ldg_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_customer_id,
      'INITIAL_BALANCE', v_customer.debt, v_customer.debt, round(v_customer.debt * 100)::integer,
      null, 'Saldo inicial creado automaticamente antes de venta fiada cloud.', 'customer', v_customer_id,
      v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
      'customer_credit.initial_balance:auto:' || v_customer_id,
      jsonb_build_object('source', 'auto_initial_balance_before_cloud_credit_sale')
    )
    on conflict (license_id, idempotency_key) where idempotency_key is not null do nothing
    returning * into v_initial_ledger;

    if v_initial_ledger.id is not null then
      perform private.record_pos_customer_credit_event(v_license_id, 'customer_ledger', v_initial_ledger.id, 'initial_balance', v_device_id, v_staff_user_id, v_initial_ledger.idempotency_key, jsonb_build_object('customer_id', v_customer_id), v_initial_ledger.server_version);
    end if;
  end if;

  select coalesce(sum(l.amount), 0) into v_debt_before
  from public.pos_customer_ledger l
  where l.license_id = v_license_id and l.customer_id = v_customer_id and l.deleted_at is null;
  if v_debt_before <= 0 and coalesce(v_customer.debt, 0) > 0 then v_debt_before := v_customer.debt; end if;

  v_debt_after := greatest(v_debt_before + v_total - v_amount_paid, 0);

  v_folio := private.next_pos_sale_folio(v_license_id);
  v_cloud_folio := v_folio->>'folio';
  v_folio_sequence := (v_folio->>'sequence')::bigint;
  v_sold_at := coalesce(nullif(private.pos_sale_jsonb_text(p_sale, array['sold_at','soldAt','timestamp']), '')::timestamptz, now());
  v_created_at := coalesce(nullif(private.pos_sale_jsonb_text(p_sale, array['created_at','createdAt','timestamp']), '')::timestamptz, now());
  v_payment_status := case when v_amount_paid > 0 then 'partial' else 'credit_pending' end;
  v_payment_method := case when v_amount_paid > 0 then 'mixed_credit' else 'credit' end;
  v_inventory_effect_status := case when v_inventory_enabled then 'pending' else 'not_applied' end;
  v_effects_status := case when v_cash_component > 0 then 'cash_credit_applied' else 'credit_applied' end;

  insert into public.pos_sales (
    id, license_id, local_sale_id, device_id, staff_user_id, device_role, actor_key, actor_name,
    origin, source_mode, effects_status, status, fulfillment_status,
    payment_method, payment_status, folio, local_folio, cloud_folio, folio_sequence,
    sale_number, customer_id, customer_name, customer_phone,
    subtotal, discount_total, tax_total, total, amount_paid, change_amount, balance_due, currency,
    sold_at, created_at, updated_at, committed_at,
    cash_session_id, cash_movement_id, customer_ledger_id,
    cash_effect_status, inventory_effect_status, credit_effect_status,
    credit_customer_debt_before, credit_customer_debt_after,
    local_payload, metadata, idempotency_key, server_version
  ) values (
    v_sale_id, v_license_id, v_local_sale_id, v_device_id, v_staff_user_id, v_device_role, v_actor_key, v_actor_name,
    'cloud', 'cloud_committed', v_effects_status, 'closed', private.pos_sale_jsonb_text(p_sale, array['fulfillment_status','fulfillmentStatus']),
    v_payment_method, v_payment_status, v_cloud_folio, private.pos_sale_jsonb_text(p_sale, array['local_folio','localFolio','folio']), v_cloud_folio, v_folio_sequence,
    v_folio_sequence, v_customer_id, v_customer_name, v_customer_phone,
    v_subtotal, v_discount_total, v_tax_total, v_total, v_amount_paid, v_change_amount, v_balance_due, coalesce(private.pos_sale_jsonb_text(p_sale, array['currency']), 'MXN'),
    v_sold_at, v_created_at, now(), now(),
    case when v_cash_component > 0 then v_cash_session.id else null end, null, null,
    case when v_cash_component > 0 then 'applied' else 'not_required' end, v_inventory_effect_status, 'applied',
    v_debt_before, v_debt_after,
    coalesce(p_sale, '{}'::jsonb),
    coalesce(p_sale->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'fase6d_cloud_sales_credit_ledger', 'cloud_committed', true, 'cloudCreditEffects', true,
      'cloudInventoryEffects', v_inventory_enabled, 'noCloudCreditEffects', false,
      'payment_summary', jsonb_build_object('cash_component', v_cash_component, 'non_cash_component', v_non_cash_component, 'initial_payment_total', v_amount_paid, 'balance_due', v_balance_due, 'cash_received', v_cash_received, 'cash_change', v_cash_change),
      'credit_summary', jsonb_build_object('customer_id', v_customer_id, 'debt_before', v_debt_before, 'debt_after', v_debt_after)
    ),
    v_idempotency_key, 1
  ) returning * into v_sale;

  for v_item in select value as payload, ordinality from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality loop
    v_item_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id']), v_sale.id || ':item:' || v_item.ordinality::text);
    v_qty := private.pos_sale_jsonb_numeric(v_item.payload, array['quantity','qty'], 0);
    v_unit_price := private.pos_sale_jsonb_numeric(v_item.payload, array['unit_price','unitPrice','price'], 0);
    v_unit_cost := private.pos_sale_jsonb_numeric(v_item.payload, array['unit_cost','unitCost','cost'], null);
    v_line_total := private.pos_sale_jsonb_numeric(v_item.payload, array['line_total','lineTotal','total','exactTotal'], v_qty * v_unit_price);
    if v_qty <= 0 then raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001'; end if;
    if v_unit_price < 0 or v_line_total < 0 or (v_unit_cost is not null and v_unit_cost < 0) then raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001'; end if;

    insert into public.pos_sale_items (
      id, license_id, sale_id, product_id, product_name, product_sku, barcode,
      category_id, category_name, quantity, unit_price, unit_cost, discount_amount,
      tax_amount, line_total, batch_id, batch_sku, batch_expiry_date, rubro, metadata,
      inventory_effect_status, stock_source, server_version
    ) values (
      v_item_id, v_license_id, v_sale.id,
      private.pos_sale_jsonb_text(v_item.payload, array['product_id','productId','parentId']),
      coalesce(private.pos_sale_jsonb_text(v_item.payload, array['product_name','productName','name']), 'Producto'),
      private.pos_sale_jsonb_text(v_item.payload, array['product_sku','productSku','sku']),
      private.pos_sale_jsonb_text(v_item.payload, array['barcode','barCode']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_id','categoryId']),
      private.pos_sale_jsonb_text(v_item.payload, array['category_name','categoryName']),
      v_qty, v_unit_price, v_unit_cost,
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['discount_amount','discountAmount'], 0), 0),
      greatest(private.pos_sale_jsonb_numeric(v_item.payload, array['tax_amount','taxAmount'], 0), 0),
      v_line_total,
      private.pos_sale_jsonb_text(v_item.payload, array['batch_id','batchId']),
      private.pos_sale_jsonb_text(v_item.payload, array['batch_sku','batchSku']),
      nullif(private.pos_sale_jsonb_text(v_item.payload, array['batch_expiry_date','batchExpiryDate','expiryDate']), '')::date,
      private.pos_sale_jsonb_text(v_item.payload, array['rubro','category','categoryName']),
      coalesce(v_item.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6d_cloud_sales_credit_ledger', 'creditEffectStatus', 'applied', 'inventoryEffectStatus', case when v_inventory_enabled then 'pending_cloud' else 'not_applied' end),
      case when v_inventory_enabled then 'pending_cloud' else 'not_applied' end,
      private.pos_sale_jsonb_text(v_item.payload, array['stock_source','stockSource']),
      v_sale.server_version
    );

    perform private.record_pos_sync_event(v_license_id, 'sale_item', v_item_id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'source_mode', 'cloud_committed', 'credit_effect_status', 'applied'), v_sale.server_version::integer);
  end loop;

  if v_inventory_enabled then
    v_apply_response := private.apply_sale_inventory_effects(v_license_id, v_sale_id, coalesce(v_preflight->'allocations', '[]'::jsonb), v_device_id, v_staff_user_id, v_actor_key, v_actor_name, v_idempotency_key);
    if coalesce((v_apply_response->>'success')::boolean, false) is not true then
      raise exception '%', coalesce(v_apply_response->>'code', 'CLOUD_INVENTORY_APPLY_FAILED') using errcode = 'P0001';
    end if;
    update public.pos_sale_items
    set inventory_effect_status = 'not_required', metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('inventoryEffectStatus', 'not_required'), server_version = server_version + 1
    where license_id = v_license_id and sale_id = v_sale_id and inventory_effect_status in ('pending', 'pending_cloud');
  end if;

  insert into public.pos_customer_ledger (
    id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
    payment_method, note, cash_session_id, cash_movement_id,
    reference_type, reference_id, sale_id, sale_folio, allocation_payload,
    actor_device_id, actor_staff_user_id, actor_key, actor_name,
    idempotency_key, metadata
  ) values (
    'ldg_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_customer_id, 'CHARGE', v_total,
    v_debt_before + v_total, round((v_debt_before + v_total) * 100)::integer,
    null, 'Venta fiada ' || v_cloud_folio, null, null,
    'sale', v_sale.id, v_sale.id, v_cloud_folio, '[]'::jsonb,
    v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
    v_idempotency_key || ':ledger_charge',
    jsonb_build_object('source', 'pos_create_cloud_sale_credit', 'phase', 'fase6d_cloud_sales_credit_ledger', 'sale_id', v_sale.id, 'folio', v_cloud_folio)
  ) returning * into v_ledger_charge;

  perform private.record_pos_sync_event(v_license_id, 'customer_ledger', v_ledger_charge.id, 'create', v_device_id, v_staff_user_id, v_ledger_charge.idempotency_key, jsonb_build_object('customer_id', v_customer_id, 'sale_id', v_sale.id, 'type', 'CHARGE'), v_ledger_charge.server_version);
  perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.ledger_charge_created', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'customer_id', v_customer_id, 'ledger_charge_id', v_ledger_charge.id, 'charge_amount', v_total, 'debt_before', v_debt_before, 'balance_after_charge', v_debt_before + v_total, 'idempotency_key', v_idempotency_key));

  if v_amount_paid > 0 then
    insert into public.pos_customer_ledger (
      id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
      payment_method, note, cash_session_id, cash_movement_id,
      reference_type, reference_id, sale_id, sale_folio, allocation_payload,
      actor_device_id, actor_staff_user_id, actor_key, actor_name,
      idempotency_key, metadata
    ) values (
      'ldg_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_customer_id, 'PAYMENT', -v_amount_paid,
      v_debt_after, round(v_debt_after * 100)::integer,
      case when v_cash_component > 0 and v_non_cash_component > 0 then 'mixed' when v_cash_component > 0 then 'cash' when v_non_cash_component > 0 then 'non_cash' else 'unknown' end,
      'Abono inicial de venta fiada ' || v_cloud_folio,
      case when v_cash_component > 0 then v_cash_session.id else null end,
      null, 'sale', v_sale.id, v_sale.id, v_cloud_folio,
      jsonb_build_array(jsonb_build_object('sale_id', v_sale.id, 'charge_ledger_id', v_ledger_charge.id, 'amount', v_amount_paid)),
      v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
      v_idempotency_key || ':ledger_payment',
      jsonb_build_object('source', 'pos_create_cloud_sale_credit', 'phase', 'fase6d_cloud_sales_credit_ledger', 'sale_id', v_sale.id, 'folio', v_cloud_folio, 'initial_payment_amount', v_amount_paid, 'cash_component', v_cash_component, 'non_cash_component', v_non_cash_component)
    ) returning * into v_ledger_payment;

    perform private.record_pos_sync_event(v_license_id, 'customer_ledger', v_ledger_payment.id, 'create', v_device_id, v_staff_user_id, v_ledger_payment.idempotency_key, jsonb_build_object('customer_id', v_customer_id, 'sale_id', v_sale.id, 'type', 'PAYMENT'), v_ledger_payment.server_version);
    perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.ledger_initial_payment_created', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'customer_id', v_customer_id, 'ledger_payment_id', v_ledger_payment.id, 'initial_payment_amount', v_amount_paid, 'cash_component', v_cash_component, 'non_cash_component', v_non_cash_component, 'debt_after', v_debt_after, 'idempotency_key', v_idempotency_key));
  end if;

  for v_payment in select value as payload, ordinality from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality loop
    v_method_raw := private.pos_sale_jsonb_text(v_payment.payload, array['method','payment_method','paymentMethod'], 'credit');
    v_method := private.normalize_pos_sale_payment_method(v_method_raw);
    if lower(btrim(coalesce(v_method_raw, ''))) in ('mixed_credit','partial_credit') then v_method := 'credit'; end if;
    if v_method = 'credit' then continue; end if;

    v_payment_id := coalesce(private.pos_sale_jsonb_text(v_payment.payload, array['id']), v_sale.id || ':payment:' || v_payment.ordinality::text);
    v_payment_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['amount','total'], 0), 0);
    v_received_amount := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['received_amount','receivedAmount'], v_payment_amount), 0);
    v_payment_change := greatest(private.pos_sale_jsonb_numeric(v_payment.payload, array['change_amount','changeAmount'], 0), 0);

    insert into public.pos_sale_payments (id, license_id, sale_id, method, amount, received_amount, change_amount, reference, cash_session_id, cash_movement_id, customer_ledger_id, metadata, server_version)
    values (
      v_payment_id, v_license_id, v_sale.id, v_method, v_payment_amount, v_received_amount, v_payment_change,
      private.pos_sale_jsonb_text(v_payment.payload, array['reference','ref']),
      case when v_method = 'cash' and v_cash_session.id is not null then v_cash_session.id else null end,
      null,
      case when v_ledger_payment.id is not null then v_ledger_payment.id else null end,
      coalesce(v_payment.payload->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase6d_cloud_sales_credit_ledger', 'creditEffectStatus', 'applied', 'ledgerPaymentId', v_ledger_payment.id),
      v_sale.server_version
    );
    perform private.record_pos_sync_event(v_license_id, 'sale_payment', v_payment_id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'source_mode', 'cloud_committed', 'method', v_method, 'customer_ledger_id', v_ledger_payment.id), v_sale.server_version::integer);
  end loop;

  v_customer_after := private.recalculate_pos_customer_debt(v_license_id, v_customer_id);
  if abs(coalesce(v_customer_after.debt, 0) - v_debt_after) > 0.05 then raise exception 'CUSTOMER_DEBT_RECALC_MISMATCH' using errcode = 'P0001'; end if;

  if v_cash_component > 0 then
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id, sale_id, customer_ledger_id,
      created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_cash_session.id, v_cash_session.device_id, v_cash_session.staff_user_id, v_cash_session.actor_key,
      'abono_cliente', v_cash_component, 'Abono inicial venta fiada ' || v_cloud_folio || ': ' || v_customer.name,
      'sale_credit_payment', 'customer_ledger', v_ledger_payment.id, v_sale.id, v_ledger_payment.id,
      v_device_id, v_staff_user_id, v_actor_name, v_idempotency_key || ':cash',
      jsonb_build_object('phase', 'fase6d_cloud_sales_credit_ledger', 'sale_id', v_sale.id, 'folio', v_cloud_folio, 'customer_id', v_customer_id, 'customer_name', v_customer.name, 'ledger_payment_id', v_ledger_payment.id, 'cash_component', v_cash_component)
    ) returning * into v_cash_movement;

    update public.pos_customer_ledger set cash_movement_id = v_cash_movement.id where license_id = v_license_id and id = v_ledger_payment.id returning * into v_ledger_payment;
    update public.pos_sale_payments set cash_movement_id = v_cash_movement.id where license_id = v_license_id and sale_id = v_sale.id and method = 'cash';
    update public.pos_cash_sessions s
    set customer_payments_total = coalesce(s.customer_payments_total, 0) + v_cash_component,
        updated_at = now(), server_version = s.server_version + 1, last_idempotency_key = v_idempotency_key
    where s.license_id = v_license_id and s.id = v_cash_session.id
    returning * into v_cash_session;
    v_cash_session := private.recalculate_pos_cash_session_totals(v_license_id, v_cash_session.id, false);

    perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.credit_cash_movement_created', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'cash_session_id', v_cash_session.id, 'cash_movement_id', v_cash_movement.id, 'ledger_payment_id', v_ledger_payment.id, 'cash_component', v_cash_component, 'idempotency_key', v_idempotency_key));
    perform private.record_pos_sync_event(v_license_id, 'cash_movement', v_cash_movement.id, 'movement', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'cash_session_id', v_cash_session.id, 'source', 'sale_credit_payment', 'customer_ledger_id', v_ledger_payment.id), v_cash_movement.server_version);
    perform private.record_pos_sync_event(v_license_id, 'cash_session', v_cash_session.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_credit_initial_cash_payment'), v_cash_session.server_version);
  end if;

  update public.pos_sales
  set cash_session_id = case when v_cash_component > 0 then v_cash_session.id else null end,
      cash_movement_id = case when v_cash_movement.id is null then null else v_cash_movement.id end,
      customer_ledger_id = v_ledger_charge.id,
      credit_ledger_charge_id = v_ledger_charge.id,
      credit_ledger_payment_id = case when v_ledger_payment.id is null then null else v_ledger_payment.id end,
      credit_customer_debt_before = v_debt_before,
      credit_customer_debt_after = v_customer_after.debt,
      inventory_effect_status = case when v_inventory_enabled then coalesce(v_apply_response->>'inventory_effect_status', 'not_required') else 'not_applied' end,
      credit_effect_status = 'applied',
      cash_effect_status = case when v_cash_component > 0 then 'applied' else 'not_required' end,
      effects_status = case
        when v_inventory_enabled and coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied' and v_cash_component > 0 then 'cash_inventory_credit_applied'
        when v_inventory_enabled and coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied' then 'credit_applied'
        when v_cash_component > 0 then 'cash_credit_applied'
        else 'credit_applied'
      end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'creditEffectStatus', 'applied', 'inventoryEffectStatus', case when v_inventory_enabled then coalesce(v_apply_response->>'inventory_effect_status', 'not_required') else 'not_applied' end,
        'cashEffectStatus', case when v_cash_component > 0 then 'applied' else 'not_required' end,
        'creditLedgerChargeId', v_ledger_charge.id, 'creditLedgerPaymentId', v_ledger_payment.id,
        'cashMovementId', v_cash_movement.id, 'cashSessionId', v_cash_session.id,
        'customerDebtBefore', v_debt_before, 'customerDebtAfter', v_customer_after.debt
      ),
      updated_at = now(), server_version = server_version + 1
  where license_id = v_license_id and id = v_sale.id
  returning * into v_sale;

  perform private.record_pos_sync_event(v_license_id, 'customer', v_customer_id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('customer_id', v_customer_id, 'reason', 'sale_credit_committed', 'sale_id', v_sale.id, 'debt_before', v_debt_before, 'debt_after', v_customer_after.debt), v_customer_after.server_version);
  perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.customer_debt_updated', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'customer_id', v_customer_id, 'debt_before', v_debt_before, 'debt_after', v_customer_after.debt, 'charge_amount', v_total, 'initial_payment_amount', v_amount_paid, 'idempotency_key', v_idempotency_key));

  v_event := private.record_pos_sync_event(v_license_id, 'sale', v_sale.id, 'cloud_commit', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'source_mode', 'cloud_committed', 'effects_status', v_sale.effects_status, 'credit_effect_status', v_sale.credit_effect_status, 'inventory_effect_status', v_sale.inventory_effect_status, 'cash_session_id', v_sale.cash_session_id, 'cash_movement_id', v_sale.cash_movement_id, 'customer_ledger_id', v_sale.customer_ledger_id), v_sale.server_version::integer);
  perform private.record_pos_sync_event(v_license_id, 'report', 'overview', 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'sale_cloud_credit_committed', 'sale_id', v_sale.id), 1);

  perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.credit_committed', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_cloud_folio, 'customer_id', v_customer_id, 'debt_before', v_debt_before, 'debt_after', v_customer_after.debt, 'charge_amount', v_total, 'initial_payment_amount', v_amount_paid, 'cash_session_id', v_sale.cash_session_id, 'cash_movement_id', v_sale.cash_movement_id, 'ledger_charge_id', v_ledger_charge.id, 'ledger_payment_id', v_ledger_payment.id, 'actor', jsonb_build_object('actor_key', v_actor_key, 'actor_name', v_actor_name, 'device_id', v_device_id, 'staff_user_id', v_staff_user_id), 'idempotency_key', v_idempotency_key));

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb) into v_items_response from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb) into v_payments_response from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id = v_sale.id;
  select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at asc, m.id asc), '[]'::jsonb) into v_inventory_movements_response from public.pos_inventory_movements m where m.license_id = v_license_id and m.sale_id = v_sale.id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq from public.pos_sync_events where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_items_response,
    'payments', v_payments_response,
    'customer', private.pos_customer_to_jsonb(v_customer_after),
    'ledger_charge', private.pos_customer_ledger_to_jsonb(v_ledger_charge),
    'ledger_payment', private.pos_customer_ledger_to_jsonb(v_ledger_payment),
    'cash_session', case when v_cash_session.id is null then null else private.pos_cash_session_to_jsonb(v_cash_session) end,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'inventory_movements', v_inventory_movements_response,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key,
    'mode', case when v_inventory_enabled then 'cloud_credit_inventory' else 'cloud_credit' end
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  raise exception 'SALE_CREDIT_DUPLICATE_OR_CONFLICT' using errcode = 'P0001';
end;
$function$;

grant execute on function public.pos_create_cloud_sale_credit(text, text, text, text, jsonb, jsonb, jsonb, text, text, text) to anon, authenticated;;
