-- FASE REST.INV.5 — Inventario PRO/cloud con recetas + extras normalizados
--
-- Objetivo:
-- - Mantener caja/cloud checkout existente.
-- - Extender el cálculo de inventario cloud para restaurante:
--   receta base + extras normalizados + producto directo legacy.
-- - Auditar cada componente usado en pos_inventory_movements.metadata y pos_sale_items.metadata.
-- - Reusar la reversa existente de cancelaciones cloud: la cancelación devuelve exactamente los sale_out auditados.

create or replace function private.rest_inv5_modifier_inventory_quantity(p_modifier jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  v_has_explicit boolean;
  v_quantity numeric;
begin
  if p_modifier is null or jsonb_typeof(p_modifier) <> 'object' then
    return null;
  end if;

  v_has_explicit := (p_modifier ? 'ingredientQuantity') or (p_modifier ? 'ingredient_quantity');

  if v_has_explicit then
    v_quantity := private.pos_sale_jsonb_numeric(
      p_modifier,
      array['ingredientQuantity','ingredient_quantity'],
      null
    );

    if v_quantity is not null and v_quantity > 0 then
      return v_quantity;
    end if;

    return null;
  end if;

  -- Compatibilidad legacy previa a REST.INV.1: ingredientId + quantity.
  if p_modifier ? 'quantity' then
    v_quantity := private.pos_sale_jsonb_numeric(p_modifier, array['quantity'], null);

    if v_quantity is not null and v_quantity > 0 then
      return v_quantity;
    end if;
  end if;

  return null;
end;
$$;

create or replace function private.rest_inv5_modifier_tracks_inventory(p_modifier jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_ingredient_id text;
  v_quantity numeric;
  v_tracks_raw text;
begin
  if p_modifier is null or jsonb_typeof(p_modifier) <> 'object' then
    return false;
  end if;

  v_ingredient_id := private.pos_sale_jsonb_text(
    p_modifier,
    array['ingredientId','ingredient_id'],
    null
  );
  v_quantity := private.rest_inv5_modifier_inventory_quantity(p_modifier);

  if v_ingredient_id is null or v_quantity is null or v_quantity <= 0 then
    return false;
  end if;

  if (p_modifier ? 'tracksInventory') or (p_modifier ? 'tracks_inventory') then
    v_tracks_raw := lower(coalesce(
      p_modifier->>'tracksInventory',
      p_modifier->>'tracks_inventory',
      ''
    ));

    return v_tracks_raw in ('true','t','1','yes','y','si','sí');
  end if;

  return p_modifier ? 'quantity';
end;
$$;

create or replace function private.normalize_sale_inventory_item(p_payload jsonb, p_ordinality bigint)
returns jsonb
language plpgsql
stable
as $$
declare
  v_product_id text;
  v_batch_id text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_stock_source text;
  v_batches jsonb;
  v_selected_modifiers jsonb;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_ITEM_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_product_id := private.pos_sale_jsonb_text(p_payload, array['product_id','productId','parentId']);
  v_batch_id := private.pos_sale_jsonb_text(p_payload, array['batch_id','batchId']);
  v_quantity := private.pos_sale_jsonb_numeric(p_payload, array['quantity','qty'], 0);
  v_unit_cost := private.pos_sale_jsonb_numeric(p_payload, array['unit_cost','unitCost','cost'], null);
  v_stock_source := lower(coalesce(private.pos_sale_jsonb_text(p_payload, array['stock_source','stockSource'], null), ''));
  v_batches := coalesce(
    p_payload->'batches_used',
    p_payload->'batchesUsed',
    p_payload->'metadata'->'batches_used',
    p_payload->'metadata'->'batchesUsed',
    '[]'::jsonb
  );
  v_selected_modifiers := coalesce(
    p_payload->'selected_modifiers',
    p_payload->'selectedModifiers',
    p_payload->'metadata'->'selected_modifiers',
    p_payload->'metadata'->'selectedModifiers',
    '[]'::jsonb
  );

  if v_quantity <= 0 then
    raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001';
  end if;

  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_batches) <> 'array' then
    v_batches := '[]'::jsonb;
  end if;

  if jsonb_typeof(v_selected_modifiers) <> 'array' then
    v_selected_modifiers := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'item_id', coalesce(private.pos_sale_jsonb_text(p_payload, array['id','lineId','cartLineId']), 'item:' || p_ordinality::text),
    'product_id', v_product_id,
    'product_name', coalesce(private.pos_sale_jsonb_text(p_payload, array['product_name','productName','name']), 'Producto'),
    'batch_id', v_batch_id,
    'quantity', v_quantity,
    'unit_cost', v_unit_cost,
    'stock_source', nullif(v_stock_source, ''),
    'batches_used', v_batches,
    'selected_modifiers', v_selected_modifiers
  );
end;
$$;

create or replace function private.rest_inv5_build_sale_inventory_requirements(
  p_sale_id text,
  p_item_norm jsonb,
  p_source_product public.pos_products
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_requirements jsonb := '[]'::jsonb;
  v_item_id text := nullif(p_item_norm->>'item_id', '');
  v_item_quantity numeric := coalesce(nullif(p_item_norm->>'quantity', '')::numeric, 0);
  v_recipe jsonb := coalesce(p_source_product.recipe, '[]'::jsonb);
  v_ingredient record;
  v_modifier record;
  v_target_id text;
  v_component_quantity numeric;
  v_needed_quantity numeric;
  v_component_unit text;
  v_modifier_id text;
  v_modifier_name text;
begin
  if v_item_quantity <= 0 then
    return '[]'::jsonb;
  end if;

  if jsonb_typeof(v_recipe) <> 'array' then
    v_recipe := '[]'::jsonb;
  end if;

  if jsonb_array_length(v_recipe) > 0 then
    for v_ingredient in
      select value as payload, ordinality
      from jsonb_array_elements(v_recipe) with ordinality
    loop
      v_target_id := private.pos_sale_jsonb_text(
        v_ingredient.payload,
        array['ingredientId','ingredient_id','productId','product_id','targetId','id'],
        null
      );
      v_component_quantity := private.pos_sale_jsonb_numeric(
        v_ingredient.payload,
        array['quantity','ingredientQuantity','ingredient_quantity','qty'],
        0
      );
      v_component_unit := private.pos_sale_jsonb_text(
        v_ingredient.payload,
        array['unit','ingredientUnit','ingredient_unit'],
        null
      );
      v_needed_quantity := v_component_quantity * v_item_quantity;

      if v_target_id is not null and v_needed_quantity > 0 then
        v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
          'sale_id', p_sale_id,
          'sale_item_id', v_item_id,
          'source', 'recipe',
          'source_product_id', p_source_product.id,
          'source_product_name', p_source_product.name,
          'product_id', v_target_id,
          'quantity', v_needed_quantity,
          'component_quantity', v_component_quantity,
          'component_unit', v_component_unit,
          'component_key', 'recipe:' || coalesce(v_target_id, 'unknown') || ':' || v_ingredient.ordinality::text
        ));
      end if;
    end loop;
  elsif p_source_product.track_stock is true then
    v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
      'sale_id', p_sale_id,
      'sale_item_id', v_item_id,
      'source', 'product',
      'source_product_id', p_source_product.id,
      'source_product_name', p_source_product.name,
      'product_id', p_source_product.id,
      'quantity', v_item_quantity,
      'component_quantity', v_item_quantity,
      'component_unit', null,
      'component_key', 'product:' || p_source_product.id
    ));
  end if;

  for v_modifier in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_item_norm->'selected_modifiers', '[]'::jsonb)) with ordinality
  loop
    if private.rest_inv5_modifier_tracks_inventory(v_modifier.payload) is not true then
      continue;
    end if;

    v_target_id := private.pos_sale_jsonb_text(v_modifier.payload, array['ingredientId','ingredient_id'], null);
    v_component_quantity := private.rest_inv5_modifier_inventory_quantity(v_modifier.payload);
    v_needed_quantity := v_component_quantity * v_item_quantity;
    v_component_unit := private.pos_sale_jsonb_text(v_modifier.payload, array['ingredientUnit','ingredient_unit','unit'], null);
    v_modifier_id := coalesce(
      private.pos_sale_jsonb_text(v_modifier.payload, array['id','modifierId','modifier_id','optionId','option_id'], null),
      'modifier:' || v_modifier.ordinality::text
    );
    v_modifier_name := private.pos_sale_jsonb_text(v_modifier.payload, array['name','label','optionName','option_name'], null);

    if v_target_id is not null and v_needed_quantity > 0 then
      v_requirements := v_requirements || jsonb_build_array(jsonb_build_object(
        'sale_id', p_sale_id,
        'sale_item_id', v_item_id,
        'source', 'modifier',
        'source_product_id', p_source_product.id,
        'source_product_name', p_source_product.name,
        'product_id', v_target_id,
        'quantity', v_needed_quantity,
        'component_quantity', v_component_quantity,
        'component_unit', v_component_unit,
        'component_key', 'modifier:' || v_modifier_id || ':' || coalesce(v_target_id, 'unknown') || ':' || v_modifier.ordinality::text,
        'modifier_id', v_modifier_id,
        'modifier_name', v_modifier_name
      ));
    end if;
  end loop;

  return v_requirements;
end;
$$;

create or replace function private.resolve_sale_inventory_allocations(
  p_license_id uuid,
  p_items jsonb,
  p_sale_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item record;
  v_item_norm jsonb;
  v_source_product public.pos_products;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_requirement record;
  v_batch_payload record;
  v_product_id text;
  v_product_name text;
  v_batch_id text;
  v_sale_item_id text;
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
  v_requirements jsonb;
  v_required_count integer := 0;
  v_virtual_product_allocations jsonb := '{}'::jsonb;
  v_virtual_batch_allocations jsonb := '{}'::jsonb;
  v_virtual_key text;
  v_virtual_allocated numeric;
  v_inventory_source text;
  v_source_product_id text;
  v_source_product_name text;
  v_component_key text;
  v_component_unit text;
  v_component_quantity numeric;
  v_modifier_id text;
  v_modifier_name text;
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
    v_sale_item_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id']), p_sale_id || ':item:' || v_item.ordinality::text);
    v_product_id := nullif(v_item_norm->>'product_id', '');

    if v_product_id is null then
      continue;
    end if;

    select * into v_source_product
    from public.pos_products p
    where p.license_id = p_license_id
      and p.id = v_product_id
    for update;

    if v_source_product.id is null then
      return jsonb_build_object(
        'ok', false,
        'success', false,
        'code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE',
        'message', 'Este producto aun no esta listo para venta cloud.',
        'product_id', v_product_id,
        'product_name', coalesce(v_item_norm->>'product_name', 'Producto'),
        'requested_quantity', coalesce(nullif(v_item_norm->>'quantity', '')::numeric, 0),
        'available_quantity', 0
      );
    end if;

    if v_source_product.deleted_at is not null or v_source_product.is_active is not true then
      return jsonb_build_object(
        'ok', false,
        'success', false,
        'code', 'CLOUD_PRODUCT_NOT_AVAILABLE',
        'message', 'El producto no esta activo en la nube.',
        'product_id', v_source_product.id,
        'product_name', coalesce(v_source_product.name, v_item_norm->>'product_name', 'Producto'),
        'requested_quantity', coalesce(nullif(v_item_norm->>'quantity', '')::numeric, 0),
        'available_quantity', 0
      );
    end if;

    v_requirements := private.rest_inv5_build_sale_inventory_requirements(p_sale_id, v_item_norm, v_source_product);

    for v_requirement in
      select value as payload, ordinality
      from jsonb_array_elements(coalesce(v_requirements, '[]'::jsonb)) with ordinality
    loop
      v_product_id := nullif(v_requirement.payload->>'product_id', '');
      v_sale_item_id := nullif(v_requirement.payload->>'sale_item_id', '');
      v_quantity := coalesce(nullif(v_requirement.payload->>'quantity', '')::numeric, 0);
      v_unit_cost := nullif(v_item_norm->>'unit_cost', '')::numeric;
      v_inventory_source := coalesce(v_requirement.payload->>'source', 'product');
      v_source_product_id := nullif(v_requirement.payload->>'source_product_id', '');
      v_source_product_name := nullif(v_requirement.payload->>'source_product_name', '');
      v_component_key := nullif(v_requirement.payload->>'component_key', '');
      v_component_unit := nullif(v_requirement.payload->>'component_unit', '');
      v_component_quantity := nullif(v_requirement.payload->>'component_quantity', '')::numeric;
      v_modifier_id := nullif(v_requirement.payload->>'modifier_id', '');
      v_modifier_name := nullif(v_requirement.payload->>'modifier_name', '');

      if v_product_id is null or v_sale_item_id is null or v_quantity <= 0 then
        continue;
      end if;

      select * into v_product
      from public.pos_products p
      where p.license_id = p_license_id
        and p.id = v_product_id
      for update;

      if v_product.id is null then
        return jsonb_build_object(
          'ok', false,
          'success', false,
          'code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE',
          'message', 'Este ingrediente/producto aun no esta listo para venta cloud.',
          'product_id', v_product_id,
          'product_name', coalesce(v_product_name, v_product_id),
          'requested_quantity', v_quantity,
          'available_quantity', 0,
          'inventory_source', v_inventory_source,
          'source_product_id', v_source_product_id
        );
      end if;

      v_product_name := coalesce(v_product.name, v_product_id);
      v_strict_expiry := coalesce(v_product.expiration_mode, 'NONE') = 'STRICT';
      v_shelf_life_blocked := coalesce(v_product.expiration_mode, 'NONE') = 'SHELF_LIFE'
        and private.pos_cad6_shelf_life_expired_for_sale(v_product);
      v_parent_available := greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0);

      if v_product.deleted_at is not null or v_product.is_active is not true then
        return jsonb_build_object(
          'ok', false,
          'success', false,
          'code', 'CLOUD_PRODUCT_NOT_AVAILABLE',
          'message', 'El ingrediente/producto no esta activo en la nube.',
          'product_id', v_product_id,
          'product_name', v_product_name,
          'requested_quantity', v_quantity,
          'available_quantity', 0,
          'inventory_source', v_inventory_source,
          'source_product_id', v_source_product_id
        );
      end if;

      if v_shelf_life_blocked then
        v_response := jsonb_build_object(
          'ok', false,
          'success', false,
          'code', 'SHELF_LIFE_EXPIRED_BLOCKED',
          'message', 'La vida útil de este producto ya venció. Revisa Caducidad/Merma antes de venderlo.',
          'product_id', v_product_id,
          'product_name', v_product_name,
          'requested_quantity', v_quantity,
          'available_quantity', v_parent_available,
          'expiration_mode', v_product.expiration_mode,
          'shelf_life_target_date', private.pos_cad6_product_shelf_life_target_date(v_product),
          'source', 'resolve_sale_inventory_allocations',
          'inventory_source', v_inventory_source,
          'source_product_id', v_source_product_id
        );
        return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.shelf_life_expired_blocked', v_response);
      end if;

      if v_product.track_stock is not true then
        continue;
      end if;

      v_required_count := v_required_count + 1;
      v_batch_id := case when v_inventory_source = 'product' then nullif(v_item_norm->>'batch_id', '') else null end;
      v_batches_used := case when v_inventory_source = 'product' then coalesce(v_item_norm->'batches_used', '[]'::jsonb) else '[]'::jsonb end;

      if jsonb_typeof(v_batches_used) <> 'array' then
        v_batches_used := '[]'::jsonb;
      end if;

      v_uses_batches := private.product_uses_batches(v_product)
        or v_strict_expiry
        or v_batch_id is not null
        or jsonb_array_length(v_batches_used) > 0;

      if not v_uses_batches then
        v_virtual_allocated := coalesce(nullif(v_virtual_product_allocations->>v_product_id, '')::numeric, 0);
        v_available := greatest(v_parent_available - v_virtual_allocated, 0);

        if v_available < v_quantity then
          return jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'INSUFFICIENT_CLOUD_STOCK',
            'message', 'No hay suficiente stock en la nube para completar esta venta.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'requested_quantity', v_quantity,
            'available_quantity', v_available,
            'inventory_source', v_inventory_source,
            'source_product_id', v_source_product_id
          );
        end if;

        v_virtual_product_allocations := jsonb_set(
          v_virtual_product_allocations,
          array[v_product_id],
          to_jsonb(v_virtual_allocated + v_quantity),
          true
        );

        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
          'sale_id', p_sale_id,
          'sale_item_id', v_sale_item_id,
          'product_id', v_product_id,
          'product_name', v_product_name,
          'batch_id', null,
          'quantity', v_quantity,
          'unit_cost', coalesce(v_unit_cost, v_product.cost),
          'stock_source', case when v_inventory_source = 'product' then 'product' else 'component' end,
          'inventory_source', v_inventory_source,
          'source_product_id', v_source_product_id,
          'source_product_name', v_source_product_name,
          'component_key', v_component_key,
          'component_quantity', v_component_quantity,
          'component_unit', v_component_unit,
          'modifier_id', v_modifier_id,
          'modifier_name', v_modifier_name
        ));
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

            v_virtual_key := v_product_id || ':' || v_batch_id;
            v_virtual_allocated := coalesce(nullif(v_virtual_batch_allocations->>v_virtual_key, '')::numeric, 0);
            v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0) - v_virtual_allocated, 0);

            if v_strict_expiry and (v_batch.expiry_date is null or private.is_pos_batch_expired_for_sale(v_batch.expiry_date)) then
              v_response := jsonb_build_object('ok', false, 'success', false, 'code', case when v_batch.expiry_date is null then 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' else 'STRICT_EXPIRED_BATCH_BLOCKED' end, 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'expiry_date', v_batch.expiry_date::date, 'requested_quantity', v_requested_batch_qty, 'available_quantity', 0, 'expired_available_quantity', v_available, 'source', 'resolve_sale_inventory_allocations');
              return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.strict_batch_blocked', v_response);
            end if;

            v_available_total := v_available_total + v_available;

            if v_available < v_requested_batch_qty then
              return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_requested_batch_qty, 'available_quantity', v_available);
            end if;

            v_allocated := v_allocated + v_requested_batch_qty;
            v_virtual_batch_allocations := jsonb_set(v_virtual_batch_allocations, array[v_virtual_key], to_jsonb(v_virtual_allocated + v_requested_batch_qty), true);
            v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
              'sale_id', p_sale_id,
              'sale_item_id', v_sale_item_id,
              'product_id', v_product_id,
              'product_name', v_product_name,
              'batch_id', v_batch_id,
              'batch_sku', v_batch.sku,
              'batch_expiry_date', v_batch.expiry_date::date,
              'quantity', v_requested_batch_qty,
              'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
              'stock_source', 'batch',
              'inventory_source', v_inventory_source,
              'source_product_id', v_source_product_id,
              'source_product_name', v_source_product_name,
              'component_key', v_component_key,
              'component_quantity', v_component_quantity,
              'component_unit', v_component_unit,
              'modifier_id', v_modifier_id,
              'modifier_name', v_modifier_name
            ));
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

          v_virtual_key := v_product_id || ':' || v_batch_id;
          v_virtual_allocated := coalesce(nullif(v_virtual_batch_allocations->>v_virtual_key, '')::numeric, 0);
          v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0) - v_virtual_allocated, 0);

          if v_strict_expiry and (v_batch.expiry_date is null or private.is_pos_batch_expired_for_sale(v_batch.expiry_date)) then
            v_response := jsonb_build_object('ok', false, 'success', false, 'code', case when v_batch.expiry_date is null then 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' else 'STRICT_EXPIRED_BATCH_BLOCKED' end, 'message', 'Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'batch_sku', v_batch.sku, 'expiry_date', v_batch.expiry_date::date, 'requested_quantity', v_quantity, 'available_quantity', 0, 'expired_available_quantity', v_available, 'source', 'resolve_sale_inventory_allocations');
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.strict_batch_blocked', v_response);
          end if;

          if v_available < v_quantity then
            return jsonb_build_object('ok', false, 'success', false, 'code', 'INSUFFICIENT_CLOUD_STOCK', 'message', 'No hay suficiente stock en la nube para completar esta venta.', 'product_id', v_product_id, 'product_name', v_product_name, 'batch_id', v_batch_id, 'requested_quantity', v_quantity, 'available_quantity', v_available);
          end if;

          v_virtual_batch_allocations := jsonb_set(v_virtual_batch_allocations, array[v_virtual_key], to_jsonb(v_virtual_allocated + v_quantity), true);
          v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
            'sale_id', p_sale_id,
            'sale_item_id', v_sale_item_id,
            'product_id', v_product_id,
            'product_name', v_product_name,
            'batch_id', v_batch_id,
            'batch_sku', v_batch.sku,
            'batch_expiry_date', v_batch.expiry_date::date,
            'quantity', v_quantity,
            'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
            'stock_source', 'batch',
            'inventory_source', v_inventory_source,
            'source_product_id', v_source_product_id,
            'source_product_name', v_source_product_name,
            'component_key', v_component_key,
            'component_quantity', v_component_quantity,
            'component_unit', v_component_unit,
            'modifier_id', v_modifier_id,
            'modifier_name', v_modifier_name
          ));
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
            v_virtual_key := v_product_id || ':' || v_batch.id;
            v_virtual_allocated := coalesce(nullif(v_virtual_batch_allocations->>v_virtual_key, '')::numeric, 0);
            v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0) - v_virtual_allocated, 0);
            v_available_total := v_available_total + v_available;

            if v_remaining > 0 and v_available > 0 then
              v_requested_batch_qty := least(v_remaining, v_available);
              v_remaining := v_remaining - v_requested_batch_qty;
              v_virtual_batch_allocations := jsonb_set(v_virtual_batch_allocations, array[v_virtual_key], to_jsonb(v_virtual_allocated + v_requested_batch_qty), true);
              v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
                'sale_id', p_sale_id,
                'sale_item_id', v_sale_item_id,
                'product_id', v_product_id,
                'product_name', v_product_name,
                'batch_id', v_batch.id,
                'batch_sku', v_batch.sku,
                'batch_expiry_date', v_batch.expiry_date::date,
                'quantity', v_requested_batch_qty,
                'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
                'stock_source', 'batch',
                'fefo', true,
                'inventory_source', v_inventory_source,
                'source_product_id', v_source_product_id,
                'source_product_name', v_source_product_name,
                'component_key', v_component_key,
                'component_quantity', v_component_quantity,
                'component_unit', v_component_unit,
                'modifier_id', v_modifier_id,
                'modifier_name', v_modifier_name
              ));
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
  end loop;

  return jsonb_build_object(
    'ok', true,
    'success', true,
    'inventory_effect_status', case when v_required_count > 0 then 'applied' else 'not_required' end,
    'allocations', v_allocations
  );
end;
$$;

do $$
begin
  if to_regprocedure('private.apply_sale_inventory_effects_direct_rest_inv5(uuid,text,jsonb,uuid,uuid,text,text,text)') is null then
    alter function private.apply_sale_inventory_effects(uuid,text,jsonb,uuid,uuid,text,text,text)
      rename to apply_sale_inventory_effects_direct_rest_inv5;
  end if;
end;
$$;

create or replace function private.apply_sale_inventory_effects(
  p_license_id uuid,
  p_sale_id text,
  p_allocations jsonb,
  p_actor_device_id uuid default null,
  p_actor_staff_user_id uuid default null,
  p_actor_key text default null,
  p_actor_name text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_response jsonb;
  v_allocation record;
  v_product_id text;
  v_batch_id text;
  v_sale_item_id text;
  v_quantity numeric;
  v_movement_idem text;
  v_movement_id text;
  v_component jsonb;
  v_components jsonb := '[]'::jsonb;
begin
  v_response := private.apply_sale_inventory_effects_direct_rest_inv5(
    p_license_id,
    p_sale_id,
    p_allocations,
    p_actor_device_id,
    p_actor_staff_user_id,
    p_actor_key,
    p_actor_name,
    p_idempotency_key
  );

  for v_allocation in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) with ordinality
  loop
    v_product_id := nullif(v_allocation.payload->>'product_id', '');
    v_batch_id := nullif(v_allocation.payload->>'batch_id', '');
    v_sale_item_id := nullif(v_allocation.payload->>'sale_item_id', '');
    v_quantity := coalesce(nullif(v_allocation.payload->>'quantity', '')::numeric, 0);

    if v_product_id is null or v_sale_item_id is null or v_quantity <= 0 then
      continue;
    end if;

    v_movement_idem := coalesce(p_idempotency_key, p_sale_id)
      || ':inventory:'
      || v_sale_item_id
      || ':'
      || v_product_id
      || ':'
      || coalesce(v_batch_id, 'product')
      || ':'
      || v_allocation.ordinality::text;

    select im.id into v_movement_id
    from public.pos_inventory_movements im
    where im.license_id = p_license_id
      and im.idempotency_key = v_movement_idem
    limit 1;

    if v_movement_id is null then
      continue;
    end if;

    v_component := jsonb_build_object(
      'movement_id', v_movement_id,
      'sale_id', p_sale_id,
      'sale_item_id', v_sale_item_id,
      'source', coalesce(v_allocation.payload->>'inventory_source', 'product'),
      'source_product_id', nullif(v_allocation.payload->>'source_product_id', ''),
      'source_product_name', nullif(v_allocation.payload->>'source_product_name', ''),
      'product_id', v_product_id,
      'product_name', nullif(v_allocation.payload->>'product_name', ''),
      'ingredient_id', v_product_id,
      'batch_id', v_batch_id,
      'batch_sku', nullif(v_allocation.payload->>'batch_sku', ''),
      'batch_expiry_date', nullif(v_allocation.payload->>'batch_expiry_date', ''),
      'quantity', v_quantity,
      'unit', nullif(v_allocation.payload->>'component_unit', ''),
      'component_quantity', nullif(v_allocation.payload->>'component_quantity', '')::numeric,
      'modifier_id', nullif(v_allocation.payload->>'modifier_id', ''),
      'modifier_name', nullif(v_allocation.payload->>'modifier_name', ''),
      'component_key', nullif(v_allocation.payload->>'component_key', ''),
      'stock_source', coalesce(v_allocation.payload->>'stock_source', case when v_batch_id is null then 'product' else 'batch' end),
      'unit_cost', nullif(v_allocation.payload->>'unit_cost', '')::numeric,
      'phase', 'rest_inv_5_cloud_restaurant_inventory'
    );

    v_components := v_components || jsonb_build_array(v_component);

    update public.pos_inventory_movements im
    set metadata = coalesce(im.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'phase', 'rest_inv_5_cloud_restaurant_inventory',
        'inventory_component', v_component,
        'inventory_source', coalesce(v_allocation.payload->>'inventory_source', 'product'),
        'source_product_id', nullif(v_allocation.payload->>'source_product_id', ''),
        'modifier_id', nullif(v_allocation.payload->>'modifier_id', '')
      )
    where im.license_id = p_license_id
      and im.id = v_movement_id;

    update public.pos_sale_items si
    set metadata = coalesce(si.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'inventoryComponentsUsed', coalesce(si.metadata->'inventoryComponentsUsed', '[]'::jsonb) || jsonb_build_array(v_component),
        'restaurantInventoryPhase', 'rest_inv_5_cloud_restaurant_inventory'
      ),
      server_version = si.server_version + 1
    where si.license_id = p_license_id
      and si.sale_id = p_sale_id
      and si.id = v_sale_item_id;
  end loop;

  update public.pos_sales s
  set metadata = coalesce(s.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'restaurantInventoryPhase', 'rest_inv_5_cloud_restaurant_inventory',
      'inventoryComponentsUsed', v_components,
      'inventoryComponentsUsedCount', jsonb_array_length(v_components)
    ),
    server_version = s.server_version + 1,
    updated_at = now()
  where s.license_id = p_license_id
    and s.id = p_sale_id;

  perform private.record_pos_sale_audit_event(
    p_license_id,
    p_sale_id,
    'sale.restaurant_inventory_components_audited',
    p_actor_device_id,
    p_actor_staff_user_id,
    p_actor_name,
    jsonb_build_object(
      'sale_id', p_sale_id,
      'component_count', jsonb_array_length(v_components),
      'components', v_components,
      'idempotency_key', p_idempotency_key,
      'phase', 'rest_inv_5_cloud_restaurant_inventory'
    )
  );

  return v_response || jsonb_build_object(
    'restaurant_inventory_components', v_components,
    'restaurant_inventory_component_count', jsonb_array_length(v_components)
  );
end;
$$;

comment on function private.rest_inv5_build_sale_inventory_requirements(text, jsonb, public.pos_products)
is 'REST.INV.5: calcula requerimientos cloud equivalentes al inventario local: receta base, extras normalizados y producto directo legacy.';
