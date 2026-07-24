create or replace function public.pos_cancel_cloud_sale(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_sale_id text := nullif(btrim(coalesce(p_sale_id, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;

  v_sale public.pos_sales;
  v_sale_folio text;
  v_cancellation_id text;
  v_cancellation public.pos_sale_cancellations;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_latest_change_seq bigint;
  v_now timestamptz := now();

  v_cash_original record;
  v_cash_reversal public.pos_cash_movements;
  v_cash_session public.pos_cash_sessions;
  v_cash_reversal_movements jsonb := '[]'::jsonb;
  v_cash_sessions_response jsonb := '[]'::jsonb;
  v_cash_session_ids text[] := array[]::text[];
  v_cash_reversal_amount numeric := 0;
  v_sale_cash_component numeric := 0;
  v_sale_non_cash_component numeric := 0;
  v_counter_cash_delta numeric := 0;

  v_inventory_original record;
  v_inventory_reversal public.pos_inventory_movements;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_product_version integer;
  v_batch_version integer;
  v_sale_item_version bigint;
  v_inventory_reversal_movements jsonb := '[]'::jsonb;
  v_inventory_reversal_quantity numeric := 0;
  v_inventory_movement_idem text;

  v_customer public.pos_customers;
  v_customer_after public.pos_customers;
  v_charge public.pos_customer_ledger;
  v_payment public.pos_customer_ledger;
  v_ledger_reversal public.pos_customer_ledger;
  v_ledger_reversals jsonb := '[]'::jsonb;
  v_credit_debt_before numeric := 0;
  v_credit_running_balance numeric := 0;
  v_credit_reversal_amount numeric := 0;
  v_payment_reversal_id text;
  v_charge_reversal_id text;

  v_cash_reversal_status text := 'not_required';
  v_inventory_reversal_status text := 'not_required';
  v_credit_reversal_status text := 'not_required';
  v_reversal_status text := 'applied';
  v_customer_payload jsonb := null;

  v_permissions jsonb;
  v_requires_specific_permission boolean := false;
  v_has_specific_permission boolean := false;
  v_has_global_permission boolean := false;
begin
  if v_sale_id is null then
    return jsonb_build_object('success', false, 'code', 'SALE_ID_REQUIRED', 'message', 'La venta a cancelar es obligatoria.');
  end if;

  if v_reason is null then
    return jsonb_build_object('success', false, 'code', 'CLOUD_SALE_CANCELLATION_REASON_REQUIRED', 'message', 'Indica el motivo de cancelacion.');
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_cancellations_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.cloud_cancel:' || v_sale_id || ':' || v_device_id::text);

  select * into v_idem
  from public.pos_idempotency_keys
  where license_id = v_license_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if v_idem.status = 'completed' and v_idem.response_payload is not null then
    return v_idem.response_payload;
  elsif v_idem.status = 'processing' then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La cancelacion ya esta en proceso. Evita presionar dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'sales.cloud_cancel',
    'sale',
    v_sale_id,
    md5(v_sale_id || ':' || v_reason)
  );

  if not v_inserted_idem then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La cancelacion ya esta en proceso. Evita presionar dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = v_sale_id
  for update;

  if v_sale.id is null then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'SALE_NOT_FOUND', 'message', 'Venta no encontrada.');
  end if;

  if v_sale.source_mode <> 'cloud_committed' then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'SALE_NOT_CLOUD_COMMITTED', 'message', 'Esta venta no fue confirmada en cloud.');
  end if;

  if v_sale.status = 'cancelled' or v_sale.cancelled_at is not null then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'SALE_ALREADY_CANCELLED', 'message', 'La venta ya fue cancelada anteriormente.');
  end if;

  if v_sale.status <> 'closed' then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'SALE_NOT_CLOSED', 'message', 'Solo se pueden cancelar ventas cerradas.');
  end if;

  -- Permiso especifico opcional: si el staff trae la llave, debe venir true.
  if coalesce(v_context->>'device_role', 'staff') = 'staff' then
    v_requires_specific_permission := (v_permissions ? 'sales_cancellations') or (v_permissions ? 'cancel_sales');
    v_has_specific_permission := coalesce((v_permissions->>'sales_cancellations')::boolean, false)
      or coalesce((v_permissions->>'cancel_sales')::boolean, false);
    v_has_global_permission := coalesce((v_permissions->>'reports')::boolean, false)
      or coalesce((v_permissions->>'sales_cancellations_global')::boolean, false)
      or coalesce((v_permissions->>'all_sales')::boolean, false);

    if v_requires_specific_permission and not v_has_specific_permission then
      raise exception 'POS_PERMISSION_DENIED:sales_cancellations' using errcode = 'P0001';
    end if;

    if v_sale.staff_user_id is distinct from v_staff_user_id and not v_has_global_permission then
      raise exception 'SALE_CANCELLATION_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  v_sale_folio := coalesce(v_sale.cloud_folio, v_sale.folio, v_sale.local_folio, v_sale.id);
  v_cancellation_id := 'cancel_' || replace(gen_random_uuid()::text, '-', '');

  v_sale_cash_component := coalesce(nullif(v_sale.metadata #>> '{payment_summary,cash_component}', '')::numeric, 0);
  v_sale_non_cash_component := coalesce(nullif(v_sale.metadata #>> '{payment_summary,non_cash_component}', '')::numeric, 0);

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_sale.id,
    'sale.cancel_requested',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale_folio,
      'reason', v_reason,
      'cancellation_id', v_cancellation_id,
      'idempotency_key', v_idempotency_key,
      'actor', jsonb_build_object('actor_key', v_actor_key, 'actor_name', v_actor_name, 'device_id', v_device_id, 'staff_user_id', v_staff_user_id)
    )
  );

  -- 1) Crédito/ledger: se inserta reversa de pago primero para mantener balance_after no negativo.
  if coalesce(v_sale.credit_effect_status, 'not_applied') = 'applied'
     or v_sale.credit_ledger_charge_id is not null
     or v_sale.credit_ledger_payment_id is not null then
    perform private.assert_cloud_sales_credit_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'customers');

    if v_sale.customer_id is null then
      raise exception 'CREDIT_SALE_CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;

    select * into v_customer
    from public.pos_customers c
    where c.license_id = v_license_id
      and c.id = v_sale.customer_id
    for update;

    if v_customer.id is null then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;

    select * into v_charge
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and (
        (v_sale.credit_ledger_charge_id is not null and l.id = v_sale.credit_ledger_charge_id)
        or (v_sale.credit_ledger_charge_id is null and l.sale_id = v_sale.id and l.type = 'CHARGE')
      )
    order by l.created_at asc
    limit 1
    for update;

    if v_charge.id is null then
      raise exception 'CREDIT_CHARGE_LEDGER_NOT_FOUND' using errcode = 'P0001';
    end if;

    select * into v_payment
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and (
        (v_sale.credit_ledger_payment_id is not null and l.id = v_sale.credit_ledger_payment_id)
        or (v_sale.credit_ledger_payment_id is null and l.sale_id = v_sale.id and l.type = 'PAYMENT')
      )
    order by l.created_at asc
    limit 1
    for update;

    select coalesce(sum(l.amount), 0) into v_credit_debt_before
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.customer_id = v_sale.customer_id
      and l.deleted_at is null;

    v_credit_running_balance := v_credit_debt_before;

    if v_payment.id is not null and v_payment.amount < 0 then
      v_credit_running_balance := v_credit_running_balance + abs(v_payment.amount);

      insert into public.pos_customer_ledger (
        id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
        payment_method, note, cash_session_id, cash_movement_id,
        reference_type, reference_id, sale_id, sale_folio, allocation_payload,
        actor_device_id, actor_staff_user_id, actor_key, actor_name,
        idempotency_key, metadata
      ) values (
        'ldg_' || replace(gen_random_uuid()::text, '-', ''),
        v_license_id,
        v_sale.customer_id,
        'CANCEL_PAYMENT',
        abs(v_payment.amount),
        v_credit_running_balance,
        round(v_credit_running_balance * 100)::integer,
        v_payment.payment_method,
        'Reversa de abono inicial por cancelacion de venta ' || v_sale_folio,
        v_payment.cash_session_id,
        null,
        'sale_cancellation',
        v_cancellation_id,
        v_sale.id,
        v_sale_folio,
        jsonb_build_array(jsonb_build_object('reversal_of', v_payment.id, 'amount', abs(v_payment.amount))),
        v_device_id,
        v_staff_user_id,
        v_actor_key,
        v_actor_name,
        v_idempotency_key || ':credit_reversal_payment',
        coalesce(v_payment.metadata, '{}'::jsonb) || jsonb_build_object(
          'reversal', true,
          'reversal_of', v_payment.id,
          'sale_cancellation_id', v_cancellation_id,
          'original_sale_id', v_sale.id,
          'phase', 'fase6e_cloud_sale_cancellations'
        )
      ) returning * into v_ledger_reversal;

      v_payment_reversal_id := v_ledger_reversal.id;
      v_ledger_reversals := v_ledger_reversals || jsonb_build_array(private.pos_customer_ledger_to_jsonb(v_ledger_reversal));
      perform private.record_pos_sync_event(v_license_id, 'customer_ledger', v_ledger_reversal.id, 'create', v_device_id, v_staff_user_id, v_ledger_reversal.idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'customer_id', v_sale.customer_id, 'reversal_of', v_payment.id, 'type', 'CANCEL_PAYMENT'), v_ledger_reversal.server_version);
    end if;

    v_credit_running_balance := v_credit_running_balance - abs(v_charge.amount);
    if v_credit_running_balance < -0.005 then
      raise exception 'CUSTOMER_DEBT_NEGATIVE_AFTER_CANCEL' using errcode = 'P0001';
    end if;
    v_credit_running_balance := greatest(v_credit_running_balance, 0);

    insert into public.pos_customer_ledger (
      id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
      payment_method, note, cash_session_id, cash_movement_id,
      reference_type, reference_id, sale_id, sale_folio, allocation_payload,
      actor_device_id, actor_staff_user_id, actor_key, actor_name,
      idempotency_key, metadata
    ) values (
      'ldg_' || replace(gen_random_uuid()::text, '-', ''),
      v_license_id,
      v_sale.customer_id,
      'CANCEL_CHARGE',
      -abs(v_charge.amount),
      v_credit_running_balance,
      round(v_credit_running_balance * 100)::integer,
      null,
      'Reversa de cargo por cancelacion de venta ' || v_sale_folio,
      null,
      null,
      'sale_cancellation',
      v_cancellation_id,
      v_sale.id,
      v_sale_folio,
      jsonb_build_array(jsonb_build_object('reversal_of', v_charge.id, 'amount', -abs(v_charge.amount))),
      v_device_id,
      v_staff_user_id,
      v_actor_key,
      v_actor_name,
      v_idempotency_key || ':credit_reversal_charge',
      coalesce(v_charge.metadata, '{}'::jsonb) || jsonb_build_object(
        'reversal', true,
        'reversal_of', v_charge.id,
        'sale_cancellation_id', v_cancellation_id,
        'original_sale_id', v_sale.id,
        'phase', 'fase6e_cloud_sale_cancellations'
      )
    ) returning * into v_ledger_reversal;

    v_charge_reversal_id := v_ledger_reversal.id;
    v_ledger_reversals := v_ledger_reversals || jsonb_build_array(private.pos_customer_ledger_to_jsonb(v_ledger_reversal));
    perform private.record_pos_sync_event(v_license_id, 'customer_ledger', v_ledger_reversal.id, 'create', v_device_id, v_staff_user_id, v_ledger_reversal.idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'customer_id', v_sale.customer_id, 'reversal_of', v_charge.id, 'type', 'CANCEL_CHARGE'), v_ledger_reversal.server_version);

    v_customer_after := private.recalculate_pos_customer_debt(v_license_id, v_sale.customer_id);
    v_customer_payload := private.pos_customer_to_jsonb(v_customer_after);
    v_credit_reversal_amount := greatest(abs(v_charge.amount) - coalesce(abs(v_payment.amount), 0), 0);
    v_credit_reversal_status := 'applied';

    perform private.record_pos_sync_event(v_license_id, 'customer', v_sale.customer_id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_cancelled_credit_reversed', 'debt_before', v_credit_debt_before, 'debt_after', v_customer_after.debt), v_customer_after.server_version);

    perform private.record_pos_sale_audit_event(
      v_license_id, v_sale.id, 'sale.credit_reversed', v_device_id, v_staff_user_id, v_actor_name,
      jsonb_build_object('sale_id', v_sale.id, 'folio', v_sale_folio, 'cancellation_id', v_cancellation_id, 'charge_ledger_id', v_charge.id, 'payment_ledger_id', v_payment.id, 'charge_reversal_id', v_charge_reversal_id, 'payment_reversal_id', v_payment_reversal_id, 'debt_before', v_credit_debt_before, 'debt_after', v_customer_after.debt, 'idempotency_key', v_idempotency_key)
    );

    perform private.record_pos_sale_audit_event(
      v_license_id, v_sale.id, 'sale.customer_debt_recalculated', v_device_id, v_staff_user_id, v_actor_name,
      jsonb_build_object('sale_id', v_sale.id, 'customer_id', v_sale.customer_id, 'debt_after', v_customer_after.debt, 'cancellation_id', v_cancellation_id)
    );
  end if;

  -- 2) Inventario/lotes: devolver stock con return_in, sin borrar sale_out.
  if coalesce(v_sale.inventory_effect_status, 'not_applied') = 'applied'
     or exists (
       select 1 from public.pos_inventory_movements im
       where im.license_id = v_license_id and im.sale_id = v_sale.id and im.movement_type = 'sale_out'
     ) then
    perform private.assert_cloud_sales_inventory_enabled(v_context);

    for v_inventory_original in
      select *
      from public.pos_inventory_movements im
      where im.license_id = v_license_id
        and im.sale_id = v_sale.id
        and im.movement_type = 'sale_out'
        and im.deleted_at is null
      order by im.created_at asc, im.id asc
    loop
      v_inventory_movement_idem := v_idempotency_key || ':inventory_reversal:' || v_inventory_original.id;

      if v_inventory_original.batch_id is null then
        select * into v_product
        from public.pos_products p
        where p.license_id = v_license_id
          and p.id = v_inventory_original.product_id
          and p.deleted_at is null
        for update;

        if v_product.id is null then
          raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_inventory_original.product_id using errcode = 'P0001';
        end if;

        v_previous_stock := coalesce(v_product.stock, 0);
        v_new_stock := v_previous_stock + coalesce(v_inventory_original.quantity, 0);

        update public.pos_products
        set stock = v_new_stock,
            updated_at = now(),
            server_version = server_version + 1,
            updated_by_device_id = v_device_id,
            updated_by_staff_user_id = v_staff_user_id,
            last_idempotency_key = v_inventory_movement_idem,
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventoryCancellationId', v_cancellation_id, 'lastInventoryReturnAt', now())
        where license_id = v_license_id
          and id = v_inventory_original.product_id
        returning stock, server_version into v_new_stock, v_product_version;

        v_inventory_reversal := private.record_pos_inventory_movement(
          v_license_id,
          v_inventory_original.product_id,
          null,
          v_sale.id,
          v_inventory_original.sale_item_id,
          'return_in',
          v_inventory_original.quantity,
          v_previous_stock,
          v_new_stock,
          null,
          null,
          v_inventory_original.unit_cost,
          'Cancelacion de venta cloud ' || v_sale_folio,
          'sale_cancellation',
          v_device_id,
          v_staff_user_id,
          v_actor_key,
          v_actor_name,
          v_inventory_movement_idem,
          coalesce(v_inventory_original.metadata, '{}'::jsonb) || jsonb_build_object('reversal', true, 'reversal_of', v_inventory_original.id, 'sale_cancellation_id', v_cancellation_id, 'phase', 'fase6e_cloud_sale_cancellations')
        );

        perform private.record_pos_sync_event(v_license_id, 'product', v_inventory_original.product_id, 'update', v_device_id, v_staff_user_id, v_inventory_movement_idem, jsonb_build_object('reason', 'sale_inventory_return_in', 'sale_id', v_sale.id, 'movement_id', v_inventory_reversal.id, 'cancellation_id', v_cancellation_id), v_product_version);
      else
        select * into v_batch
        from public.pos_product_batches b
        where b.license_id = v_license_id
          and b.id = v_inventory_original.batch_id
          and b.product_id = v_inventory_original.product_id
          and b.deleted_at is null
        for update;

        if v_batch.id is null then
          raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_inventory_original.batch_id using errcode = 'P0001';
        end if;

        select * into v_product
        from public.pos_products p
        where p.license_id = v_license_id
          and p.id = v_inventory_original.product_id
          and p.deleted_at is null
        for update;

        if v_product.id is null then
          raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_inventory_original.product_id using errcode = 'P0001';
        end if;

        v_previous_stock := coalesce(v_product.stock, 0);
        v_previous_batch_stock := coalesce(v_batch.stock, 0);
        v_new_batch_stock := v_previous_batch_stock + coalesce(v_inventory_original.quantity, 0);

        update public.pos_product_batches
        set stock = v_new_batch_stock,
            updated_at = now(),
            server_version = server_version + 1,
            updated_by_device_id = v_device_id,
            updated_by_staff_user_id = v_staff_user_id,
            last_idempotency_key = v_inventory_movement_idem,
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventoryCancellationId', v_cancellation_id, 'lastInventoryReturnAt', now())
        where license_id = v_license_id
          and id = v_inventory_original.batch_id
        returning stock, server_version into v_new_batch_stock, v_batch_version;

        select coalesce(sum(coalesce(b.stock, 0)) filter (where b.deleted_at is null and b.is_active is true), 0)
        into v_new_stock
        from public.pos_product_batches b
        where b.license_id = v_license_id
          and b.product_id = v_inventory_original.product_id;

        update public.pos_products
        set stock = coalesce(v_new_stock, 0),
            updated_at = now(),
            server_version = server_version + 1,
            updated_by_device_id = v_device_id,
            updated_by_staff_user_id = v_staff_user_id,
            last_idempotency_key = v_inventory_movement_idem,
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventoryCancellationId', v_cancellation_id, 'lastInventoryReturnAt', now())
        where license_id = v_license_id
          and id = v_inventory_original.product_id
        returning stock, server_version into v_new_stock, v_product_version;

        v_inventory_reversal := private.record_pos_inventory_movement(
          v_license_id,
          v_inventory_original.product_id,
          v_inventory_original.batch_id,
          v_sale.id,
          v_inventory_original.sale_item_id,
          'return_in',
          v_inventory_original.quantity,
          v_previous_stock,
          v_new_stock,
          v_previous_batch_stock,
          v_new_batch_stock,
          v_inventory_original.unit_cost,
          'Cancelacion de venta cloud ' || v_sale_folio,
          'sale_cancellation',
          v_device_id,
          v_staff_user_id,
          v_actor_key,
          v_actor_name,
          v_inventory_movement_idem,
          coalesce(v_inventory_original.metadata, '{}'::jsonb) || jsonb_build_object('reversal', true, 'reversal_of', v_inventory_original.id, 'sale_cancellation_id', v_cancellation_id, 'phase', 'fase6e_cloud_sale_cancellations')
        );

        perform private.record_pos_sync_event(v_license_id, 'product_batch', v_inventory_original.batch_id, 'update', v_device_id, v_staff_user_id, v_inventory_movement_idem, jsonb_build_object('reason', 'sale_inventory_return_in', 'sale_id', v_sale.id, 'product_id', v_inventory_original.product_id, 'movement_id', v_inventory_reversal.id, 'cancellation_id', v_cancellation_id), v_batch_version);
        perform private.record_pos_sync_event(v_license_id, 'product', v_inventory_original.product_id, 'update', v_device_id, v_staff_user_id, v_inventory_movement_idem, jsonb_build_object('reason', 'sale_inventory_return_in', 'sale_id', v_sale.id, 'batch_id', v_inventory_original.batch_id, 'movement_id', v_inventory_reversal.id, 'cancellation_id', v_cancellation_id), v_product_version);
      end if;

      v_inventory_reversal_movements := v_inventory_reversal_movements || jsonb_build_array(private.pos_inventory_movement_to_jsonb(v_inventory_reversal));
      v_inventory_reversal_quantity := v_inventory_reversal_quantity + coalesce(v_inventory_original.quantity, 0);

      update public.pos_sale_items
      set inventory_reversal_status = 'applied',
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'inventoryReversalStatus', 'applied',
              'inventoryReversalMovementIds', coalesce(metadata->'inventoryReversalMovementIds', '[]'::jsonb) || jsonb_build_array(v_inventory_reversal.id),
              'saleCancellationId', v_cancellation_id
            ),
          server_version = server_version + 1
      where license_id = v_license_id
        and sale_id = v_sale.id
        and id = v_inventory_original.sale_item_id
      returning server_version into v_sale_item_version;

      perform private.record_pos_sync_event(v_license_id, 'sale_item', v_inventory_original.sale_item_id, 'update', v_device_id, v_staff_user_id, v_inventory_movement_idem, jsonb_build_object('sale_id', v_sale.id, 'reason', 'inventory_reversal_applied', 'movement_id', v_inventory_reversal.id, 'cancellation_id', v_cancellation_id), coalesce(v_sale_item_version, 1)::integer);
      perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_inventory_reversal.id, 'create', v_device_id, v_staff_user_id, v_inventory_movement_idem, jsonb_build_object('sale_id', v_sale.id, 'sale_item_id', v_inventory_original.sale_item_id, 'product_id', v_inventory_original.product_id, 'batch_id', v_inventory_original.batch_id, 'cancellation_id', v_cancellation_id), v_inventory_reversal.server_version::integer);

      perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.inventory_reversed', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_sale_folio, 'cancellation_id', v_cancellation_id, 'original_movement_id', v_inventory_original.id, 'reversal_movement_id', v_inventory_reversal.id, 'product_id', v_inventory_original.product_id, 'batch_id', v_inventory_original.batch_id, 'quantity', v_inventory_original.quantity, 'idempotency_key', v_inventory_movement_idem));
    end loop;

    v_inventory_reversal_status := case when v_inventory_reversal_quantity > 0 then 'applied' else 'not_required' end;
  end if;

  -- 3) Caja: movimientos compensatorios positivos + decremento de totales oficiales del turno.
  if v_sale.cash_session_id is not null
     or exists (
       select 1 from public.pos_cash_movements cm
       where cm.license_id = v_license_id and cm.sale_id = v_sale.id and cm.deleted_at is null
     ) then
    perform private.assert_cloud_cash_sync_enabled(v_context);

    for v_cash_original in
      select *
      from public.pos_cash_movements cm
      where cm.license_id = v_license_id
        and cm.sale_id = v_sale.id
        and cm.deleted_at is null
        and cm.type in ('venta', 'venta_efectivo', 'abono_cliente')
        and cm.source not in ('sale_cancellation', 'sale_credit_cancellation')
      order by cm.created_at asc, cm.id asc
    loop
      select * into v_cash_session
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.id = v_cash_original.cash_session_id
        and s.deleted_at is null
      for update;

      if v_cash_session.id is null then
        raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
      end if;

      insert into public.pos_cash_movements (
        id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
        type, amount, concept, source, reference_type, reference_id, sale_id, customer_ledger_id,
        created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
      ) values (
        'mov_' || replace(gen_random_uuid()::text, '-', ''),
        v_license_id,
        v_cash_session.id,
        v_cash_session.device_id,
        v_cash_session.staff_user_id,
        v_cash_session.actor_key,
        case when v_cash_original.type = 'abono_cliente' then 'cancelacion_abono_inicial' else 'cancelacion_venta' end,
        abs(v_cash_original.amount),
        case when v_cash_original.type = 'abono_cliente'
          then 'Cancelacion de abono inicial venta ' || v_sale_folio
          else 'Cancelacion de venta ' || v_sale_folio
        end,
        case when v_cash_original.type = 'abono_cliente' then 'sale_credit_cancellation' else 'sale_cancellation' end,
        'sale_cancellation',
        v_cancellation_id,
        v_sale.id,
        coalesce(v_payment_reversal_id, v_cash_original.customer_ledger_id),
        v_device_id,
        v_staff_user_id,
        v_actor_name,
        v_idempotency_key || ':cash_reversal:' || v_cash_original.id,
        coalesce(v_cash_original.metadata, '{}'::jsonb) || jsonb_build_object(
          'reversal', true,
          'reversal_of', v_cash_original.id,
          'sale_cancellation_id', v_cancellation_id,
          'original_sale_id', v_sale.id,
          'phase', 'fase6e_cloud_sale_cancellations',
          'amount_sign', 'cash_out_compensation'
        )
      ) returning * into v_cash_reversal;

      if v_cash_original.type = 'abono_cliente' then
        update public.pos_cash_sessions s
        set customer_payments_total = greatest(coalesce(s.customer_payments_total, 0) - abs(v_cash_original.amount), 0),
            updated_at = now(),
            server_version = s.server_version + 1,
            last_idempotency_key = v_idempotency_key
        where s.license_id = v_license_id
          and s.id = v_cash_session.id
        returning * into v_cash_session;
      else
        update public.pos_cash_sessions s
        set cash_sales_total = greatest(coalesce(s.cash_sales_total, 0) - abs(v_cash_original.amount), 0),
            updated_at = now(),
            server_version = s.server_version + 1,
            last_idempotency_key = v_idempotency_key
        where s.license_id = v_license_id
          and s.id = v_cash_session.id
        returning * into v_cash_session;
      end if;

      v_cash_session := private.recalculate_pos_cash_session_totals(v_license_id, v_cash_session.id, false);
      v_cash_reversal_amount := v_cash_reversal_amount + abs(v_cash_original.amount);
      v_cash_reversal_movements := v_cash_reversal_movements || jsonb_build_array(private.pos_cash_movement_to_jsonb(v_cash_reversal));
      v_cash_session_ids := array_append(v_cash_session_ids, v_cash_session.id);

      update public.pos_sale_payments
      set reversal_status = 'applied',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reversalStatus', 'applied', 'cashReversalMovementId', v_cash_reversal.id, 'saleCancellationId', v_cancellation_id),
          server_version = server_version + 1
      where license_id = v_license_id
        and sale_id = v_sale.id
        and cash_movement_id = v_cash_original.id;

      perform private.record_pos_sync_event(v_license_id, 'cash_movement', v_cash_reversal.id, 'movement', v_device_id, v_staff_user_id, v_cash_reversal.idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'cash_session_id', v_cash_session.id, 'source', v_cash_reversal.source, 'cancellation_id', v_cancellation_id, 'reversal_of', v_cash_original.id), v_cash_reversal.server_version);
      perform private.record_pos_sync_event(v_license_id, 'cash_session', v_cash_session.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_cancelled_cash_reversed', 'cancellation_id', v_cancellation_id), v_cash_session.server_version);

      perform private.record_pos_sale_audit_event(v_license_id, v_sale.id, 'sale.cash_reversed', v_device_id, v_staff_user_id, v_actor_name, jsonb_build_object('sale_id', v_sale.id, 'folio', v_sale_folio, 'cancellation_id', v_cancellation_id, 'original_cash_movement_id', v_cash_original.id, 'cash_reversal_movement_id', v_cash_reversal.id, 'cash_session_id', v_cash_session.id, 'amount', abs(v_cash_original.amount), 'idempotency_key', v_cash_reversal.idempotency_key));
    end loop;

    -- Ajustar ventas brutas/netas del turno para ventas no fiadas. En venta fiada 6D solo se movió customer_payments_total si hubo abono efectivo.
    if coalesce(v_sale.credit_effect_status, 'not_applied') <> 'applied' and v_sale.cash_session_id is not null then
      select * into v_cash_session
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.id = v_sale.cash_session_id
        and s.deleted_at is null
      for update;

      if v_cash_session.id is not null then
        v_counter_cash_delta := case when v_cash_reversal_amount = 0 then greatest(v_sale_cash_component, 0) else 0 end;

        update public.pos_cash_sessions s
        set sales_total = greatest(coalesce(s.sales_total, 0) - coalesce(v_sale.total, 0), 0),
            sales_count = greatest(coalesce(s.sales_count, 0) - 1, 0),
            cash_sales_total = greatest(coalesce(s.cash_sales_total, 0) - v_counter_cash_delta, 0),
            non_cash_sales_total = greatest(coalesce(s.non_cash_sales_total, 0) - greatest(v_sale_non_cash_component, 0), 0),
            updated_at = now(),
            server_version = s.server_version + 1,
            last_idempotency_key = v_idempotency_key
        where s.license_id = v_license_id
          and s.id = v_cash_session.id
        returning * into v_cash_session;

        v_cash_session := private.recalculate_pos_cash_session_totals(v_license_id, v_cash_session.id, false);
        v_cash_session_ids := array_append(v_cash_session_ids, v_cash_session.id);
        perform private.record_pos_sync_event(v_license_id, 'cash_session', v_cash_session.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_cancelled_sales_totals_reversed', 'cancellation_id', v_cancellation_id), v_cash_session.server_version);
      end if;
    end if;

    v_cash_reversal_status := case when v_cash_reversal_amount > 0 then 'applied' else 'not_required' end;
  end if;

  -- 4) Registrar auditoría de cancelación y marcar venta cancelada al final.
  insert into public.pos_sale_cancellations (
    id, license_id, sale_id, sale_folio, reason, status,
    cash_reversal_status, inventory_reversal_status, credit_reversal_status,
    original_total, cash_reversal_amount, inventory_reversal_quantity, credit_reversal_amount,
    actor_device_id, actor_staff_user_id, actor_key, actor_name, idempotency_key, metadata, server_version
  ) values (
    v_cancellation_id,
    v_license_id,
    v_sale.id,
    v_sale_folio,
    v_reason,
    'completed',
    v_cash_reversal_status,
    v_inventory_reversal_status,
    v_credit_reversal_status,
    coalesce(v_sale.total, 0),
    v_cash_reversal_amount,
    v_inventory_reversal_quantity,
    v_credit_reversal_amount,
    v_device_id,
    v_staff_user_id,
    v_actor_key,
    v_actor_name,
    v_idempotency_key,
    jsonb_build_object(
      'phase', 'fase6e_cloud_sale_cancellations',
      'sale_id', v_sale.id,
      'folio', v_sale_folio,
      'cash_reversal_movements', v_cash_reversal_movements,
      'inventory_reversal_movements', v_inventory_reversal_movements,
      'ledger_reversals', v_ledger_reversals,
      'credit_debt_before', v_credit_debt_before,
      'customer_after', v_customer_payload
    ),
    1
  ) returning * into v_cancellation;

  update public.pos_sales
  set status = 'cancelled',
      fulfillment_status = 'cancelled',
      cancelled_at = v_now,
      cancel_reason = v_reason,
      cancelled_by_device_id = v_device_id,
      cancelled_by_staff_user_id = v_staff_user_id,
      cancellation_id = v_cancellation_id,
      cancellation_status = 'completed',
      reversal_status = v_reversal_status,
      cash_reversal_status = v_cash_reversal_status,
      inventory_reversal_status = v_inventory_reversal_status,
      credit_reversal_status = v_credit_reversal_status,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cloudCancellation', jsonb_build_object(
          'id', v_cancellation_id,
          'status', 'completed',
          'reason', v_reason,
          'cancelledAt', v_now,
          'cashReversalStatus', v_cash_reversal_status,
          'inventoryReversalStatus', v_inventory_reversal_status,
          'creditReversalStatus', v_credit_reversal_status,
          'cashReversalAmount', v_cash_reversal_amount,
          'inventoryReversalQuantity', v_inventory_reversal_quantity,
          'creditReversalAmount', v_credit_reversal_amount,
          'idempotencyKey', v_idempotency_key
        )
      ),
      updated_at = now(),
      server_version = server_version + 1
  where license_id = v_license_id
    and id = v_sale.id
  returning * into v_sale;

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_sale.id,
    'sale.cancelled',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale_folio,
      'cancellation_id', v_cancellation_id,
      'reason', v_reason,
      'cash_reversal_status', v_cash_reversal_status,
      'inventory_reversal_status', v_inventory_reversal_status,
      'credit_reversal_status', v_credit_reversal_status,
      'idempotency_key', v_idempotency_key
    )
  );

  perform private.record_pos_sync_event(v_license_id, 'sale_cancellation', v_cancellation_id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'folio', v_sale_folio, 'reason', v_reason), v_cancellation.server_version::integer);

  v_event := private.record_pos_sync_event(v_license_id, 'sale', v_sale.id, 'cancel', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('sale_id', v_sale.id, 'folio', v_sale_folio, 'cancellation_id', v_cancellation_id, 'status', v_sale.status, 'cash_reversal_status', v_cash_reversal_status, 'inventory_reversal_status', v_inventory_reversal_status, 'credit_reversal_status', v_credit_reversal_status), v_sale.server_version::integer);

  perform private.record_pos_sync_event(v_license_id, 'report', 'overview', 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'sale_cloud_cancelled', 'sale_id', v_sale.id, 'cancellation_id', v_cancellation_id), 1);

  select coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.updated_at desc), '[]'::jsonb)
  into v_cash_sessions_response
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.id = any(v_cash_session_ids);

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'cancellation', to_jsonb(v_cancellation),
    'cash_reversal_movements', v_cash_reversal_movements,
    'cash_sessions', v_cash_sessions_response,
    'inventory_reversal_movements', v_inventory_reversal_movements,
    'ledger_reversals', v_ledger_reversals,
    'customer', v_customer_payload,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key,
    'mode', 'cloud_sale_cancellation'
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    raise exception 'SALE_CANCELLATION_DUPLICATE_OR_CONFLICT' using errcode = 'P0001';
end;
$$;;
