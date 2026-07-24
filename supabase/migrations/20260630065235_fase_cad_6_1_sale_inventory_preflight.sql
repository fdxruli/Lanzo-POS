create or replace function private.resolve_sale_inventory_allocations(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item record;
  v_item_norm jsonb;
  v_batch_payload record;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_product_id text;
  v_item_id text;
  v_product_name text;
  v_batch_id text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_batches_used jsonb;
  v_requested_batch_qty numeric;
  v_allocated numeric;
  v_remaining numeric;
  v_available numeric;
  v_available_total numeric;
  v_expired_available_total numeric;
  v_parent_available numeric;
  v_uses_batches boolean;
  v_strict_expiry boolean;
  v_shelf_life_blocked boolean;
  v_response jsonb;
  v_allocations jsonb := '[]'::jsonb;
  v_required_count integer := 0;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED_FOR_INVENTORY' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    v_item_norm := private.normalize_sale_inventory_item(v_item.payload, v_item.ordinality);
    v_item_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id']), p_sale_id || ':item:' || v_item.ordinality::text);
    v_product_id := nullif(v_item_norm->>'product_id', '');
    v_product_name := coalesce(v_item_norm->>'product_name', 'Producto');
    v_batch_id := nullif(v_item_norm->>'batch_id', '');
    v_quantity := (v_item_norm->>'quantity')::numeric;
    v_unit_cost := nullif(v_item_norm->>'unit_cost', '')::numeric;
    v_batches_used := coalesce(v_item_norm->'batches_used', '[]'::jsonb);

    if v_product_id is null then
      continue;
    end if;

    select * into v_product
    from public.pos_products p
    where p.license_id = p_license_id
      and p.id = v_product_id
    for update;

    if v_product.id is null then
      return jsonb_build_object('ok', false, 'success', false, 'code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE', 'message', 'Este producto aun no esta listo para venta cloud.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', 0);
    end if;

    v_product_name := coalesce(v_product.name, v_product_name);
    v_strict_expiry := coalesce(v_product.expiration_mode, 'NONE') = 'STRICT';
    v_shelf_life_blocked := coalesce(v_product.expiration_mode, 'NONE') = 'SHELF_LIFE' and private.pos_cad6_shelf_life_expired_for_sale(v_product);
    v_parent_available := greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0);

    if v_product.deleted_at is not null or v_product.is_active is not true then
      return jsonb_build_object('ok', false, 'success', false, 'code', 'CLOUD_PRODUCT_NOT_AVAILABLE', 'message', 'El producto no esta activo en la nube.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', 0);
    end if;

    if v_shelf_life_blocked then
      v_response := jsonb_build_object('ok', false, 'success', false, 'code', 'SHELF_LIFE_EXPIRED_BLOCKED', 'message', 'La vida útil de este producto ya venció. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_parent_available, 'expiration_mode', v_product.expiration_mode, 'shelf_life_target_date', private.pos_cad6_product_shelf_life_target_date(v_product), 'source', 'resolve_sale_inventory_allocations');
      return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.shelf_life_expired_blocked', v_response);
    end if;

    if v_product.track_stock is not true then
      continue;
    end if;

    v_required_count := v_required_count + 1;
    v_uses_batches := private.product_uses_batches(v_product) or v_strict_expiry or v_batch_id is not null or jsonb_array_length(v_batches_used) > 0;

    if not v_uses_batches then
      v_available := v_parent_available;
      if v_available < v_quantity then
        return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_available);
      end if;

      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_item_id, 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', null, 'quantity', v_quantity, 'unit_cost', coalesce(v_unit_cost, v_product.cost), 'stock_source', 'product'));
    else
      v_allocated := 0;
      v_available_total := 0;
      v_expired_available_total := 0;

      if jsonb_array_length(v_batches_used) > 0 then
        for v_batch_payload in
          select value as payload, ordinality
          from jsonb_array_elements(v_batches_used) with ordinality
        loop
          v_batch_id := coalesce(private.pos_sale_jsonb_text(v_batch_payload.payload, array['batch_id','batchId','id']), null);
          v_requested_batch_qty := private.pos_sale_jsonb_numeric(v_batch_payload.payload, array['quantity','qty','usedQuantity','used_quantity'], 0);

          if v_batch_id is null or v_requested_batch_qty <= 0 then
            continue;
          end if;

          select * into v_batch
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.id = v_batch_id
            and b.deleted_at is null
            and b.is_active is true
          for update;

          if v_batch.id is null then
            return jsonb_build_object('ok', false, 'success', false, 'code', 'CLOUD_BATCH_NOT_AVAILABLE', 'message', 'El lote no esta activo en la nube.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_requested_batch_qty, 'available_quantity', 0);
          end if;

          v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);

          if v_strict_expiry and (v_batch.expiry_date is null or private.is_pos_batch_expired_for_sale(v_batch.expiry_date)) then
            v_response := jsonb_build_object('ok', false, 'success', false, 'code', case when v_batch.expiry_date is null then 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' else 'STRICT_EXPIRED_BATCH_BLOCKED' end, 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'expiry_date', v_batch.expiry_date::date, 'requested_quantity', v_requested_batch_qty, 'available_quantity', 0, 'expired_available_quantity', v_available, 'source', 'resolve_sale_inventory_allocations');
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.strict_batch_blocked', v_response);
          end if;

          v_available_total := v_available_total + v_available;

          if v_available < v_requested_batch_qty then
            return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_requested_batch_qty, 'available_quantity', v_available);
          end if;

          v_allocated := v_allocated + v_requested_batch_qty;
          v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_item_id, 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'batch_expiry_date', v_batch.expiry_date::date, 'quantity', v_requested_batch_qty, 'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost), 'stock_source', 'batch'));
        end loop;

        if abs(v_allocated - v_quantity) > 0.00001 then
          return jsonb_build_object('ok', false, 'success', false, 'code', 'CLOUD_BATCH_ALLOCATION_MISMATCH', 'message', 'Las asignaciones de lote no cuadran con la cantidad vendida.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_available_total);
        end if;
      elsif v_batch_id is not null then
        select * into v_batch
        from public.pos_product_batches b
        where b.license_id = p_license_id
          and b.product_id = v_product_id
          and b.id = v_batch_id
          and b.deleted_at is null
          and b.is_active is true
        for update;

        if v_batch.id is null then
          return jsonb_build_object('ok', false, 'success', false, 'code', 'CLOUD_BATCH_NOT_AVAILABLE', 'message', 'El lote no esta activo en la nube.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_quantity, 'available_quantity', 0);
        end if;

        v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);

        if v_strict_expiry and (v_batch.expiry_date is null or private.is_pos_batch_expired_for_sale(v_batch.expiry_date)) then
          v_response := jsonb_build_object('ok', false, 'success', false, 'code', case when v_batch.expiry_date is null then 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' else 'STRICT_EXPIRED_BATCH_BLOCKED' end, 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'expiry_date', v_batch.expiry_date::date, 'requested_quantity', v_quantity, 'available_quantity', 0, 'expired_available_quantity', v_available, 'source', 'resolve_sale_inventory_allocations');
          return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.strict_batch_blocked', v_response);
        end if;

        if v_available < v_quantity then
          return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_quantity, 'available_quantity', v_available);
        end if;

        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_item_id, 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'batch_expiry_date', v_batch.expiry_date::date, 'quantity', v_quantity, 'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost), 'stock_source', 'batch'));
      else
        v_remaining := v_quantity;
        v_available_total := 0;
        v_expired_available_total := 0;

        select coalesce(sum(greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0)), 0)
        into v_expired_available_total
        from public.pos_product_batches b
        where b.license_id = p_license_id
          and b.product_id = v_product_id
          and b.deleted_at is null
          and b.is_active is true
          and b.track_stock is true
          and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
          and ((v_strict_expiry and (b.expiry_date is null or private.is_pos_batch_expired_for_sale(b.expiry_date))) or (v_strict_expiry is not true and private.is_pos_batch_expired_for_sale(b.expiry_date)));

        for v_batch in
          select *
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.deleted_at is null
            and b.is_active is true
            and b.track_stock is true
            and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
            and (v_strict_expiry is not true or (b.expiry_date is not null and private.is_pos_batch_expired_for_sale(b.expiry_date) is not true))
          order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
          for update
        loop
          v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);
          v_available_total := v_available_total + v_available;

          if v_remaining > 0 then
            v_requested_batch_qty := least(v_remaining, v_available);
            v_remaining := v_remaining - v_requested_batch_qty;
            v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_item_id, 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch.id, 'batch_sku', v_batch.sku, 'batch_expiry_date', v_batch.expiry_date::date, 'quantity', v_requested_batch_qty, 'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost), 'stock_source', 'batch', 'fefo', true));
          end if;
        end loop;

        if v_remaining > 0.00001 then
          if v_uses_batches and v_parent_available > 0 and v_available_total <= 0 then
            v_response := jsonb_build_object('ok', false, 'success', false, 'code', 'PRODUCT_STOCK_WITHOUT_BATCH', 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_available_total, 'parent_available_quantity', v_parent_available, 'expired_available_quantity', v_expired_available_total, 'source', 'resolve_sale_inventory_allocations');
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.product_stock_without_batch', v_response);
          end if;

          if v_strict_expiry then
            v_response := jsonb_build_object('ok', false, 'success', false, 'code', case when v_expired_available_total > 0 then 'STRICT_EXPIRED_BATCH_BLOCKED' else 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' end, 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_available_total, 'expired_available_quantity', v_expired_available_total, 'source', 'resolve_sale_inventory_allocations');
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.no_current_batch_for_strict_product', v_response);
          end if;

          return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'requested_quantity', v_quantity, 'available_quantity', v_available_total);
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'success', true, 'inventory_effect_status', case when v_required_count > 0 then 'applied' else 'not_required' end, 'allocations', v_allocations);
end;
$$;

comment on function private.resolve_sale_inventory_allocations(uuid,jsonb,text)
is 'CAD.6.1: preflight transaccional. STRICT bloquea vencido/sin lote vigente/stock padre sin lote; SHELF_LIFE solo bloquea si pos_cad6_shelf_life_expired_for_sale=true.';;
