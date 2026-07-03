-- FASE REST.INV.5 — Inventario PRO/cloud con recetas + extras normalizados
-- Helpers base + auditoría de componentes. El resolver se versiona en una migración posterior
-- para mantener el replay limpio y equivalente a lo aplicado en Supabase.

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
    v_quantity := private.pos_sale_jsonb_numeric(p_modifier, array['ingredientQuantity','ingredient_quantity'], null);
    if v_quantity is not null and v_quantity > 0 then
      return v_quantity;
    end if;
    return null;
  end if;

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

  v_ingredient_id := private.pos_sale_jsonb_text(p_modifier, array['ingredientId','ingredient_id'], null);
  v_quantity := private.rest_inv5_modifier_inventory_quantity(p_modifier);

  if v_ingredient_id is null or v_quantity is null or v_quantity <= 0 then
    return false;
  end if;

  if (p_modifier ? 'tracksInventory') or (p_modifier ? 'tracks_inventory') then
    v_tracks_raw := lower(coalesce(p_modifier->>'tracksInventory', p_modifier->>'tracks_inventory', ''));
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
  v_batches := coalesce(p_payload->'batches_used', p_payload->'batchesUsed', p_payload->'metadata'->'batches_used', p_payload->'metadata'->'batchesUsed', '[]'::jsonb);
  v_selected_modifiers := coalesce(p_payload->'selected_modifiers', p_payload->'selectedModifiers', p_payload->'metadata'->'selected_modifiers', p_payload->'metadata'->'selectedModifiers', '[]'::jsonb);

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

create or replace function private.rest_inv5_build_sale_inventory_requirements(p_sale_id text, p_item_norm jsonb, p_source_product public.pos_products)
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
    for v_ingredient in select value as payload, ordinality from jsonb_array_elements(v_recipe) with ordinality loop
      v_target_id := private.pos_sale_jsonb_text(v_ingredient.payload, array['ingredientId','ingredient_id','productId','product_id','targetId','id'], null);
      v_component_quantity := private.pos_sale_jsonb_numeric(v_ingredient.payload, array['quantity','ingredientQuantity','ingredient_quantity','qty'], 0);
      v_component_unit := private.pos_sale_jsonb_text(v_ingredient.payload, array['unit','ingredientUnit','ingredient_unit'], null);
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

  for v_modifier in select value as payload, ordinality from jsonb_array_elements(coalesce(p_item_norm->'selected_modifiers', '[]'::jsonb)) with ordinality loop
    if private.rest_inv5_modifier_tracks_inventory(v_modifier.payload) is not true then
      continue;
    end if;

    v_target_id := private.pos_sale_jsonb_text(v_modifier.payload, array['ingredientId','ingredient_id'], null);
    v_component_quantity := private.rest_inv5_modifier_inventory_quantity(v_modifier.payload);
    v_needed_quantity := v_component_quantity * v_item_quantity;
    v_component_unit := private.pos_sale_jsonb_text(v_modifier.payload, array['ingredientUnit','ingredient_unit','unit'], null);
    v_modifier_id := coalesce(private.pos_sale_jsonb_text(v_modifier.payload, array['id','modifierId','modifier_id','optionId','option_id'], null), 'modifier:' || v_modifier.ordinality::text);
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
  v_response := private.apply_sale_inventory_effects_direct_rest_inv5(p_license_id, p_sale_id, p_allocations, p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name, p_idempotency_key);

  for v_allocation in select value as payload, ordinality from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) with ordinality loop
    v_product_id := nullif(v_allocation.payload->>'product_id', '');
    v_batch_id := nullif(v_allocation.payload->>'batch_id', '');
    v_sale_item_id := nullif(v_allocation.payload->>'sale_item_id', '');
    v_quantity := coalesce(nullif(v_allocation.payload->>'quantity', '')::numeric, 0);

    if v_product_id is null or v_sale_item_id is null or v_quantity <= 0 then
      continue;
    end if;

    v_movement_idem := coalesce(p_idempotency_key, p_sale_id) || ':inventory:' || v_sale_item_id || ':' || v_product_id || ':' || coalesce(v_batch_id, 'product') || ':' || v_allocation.ordinality::text;

    select im.id into v_movement_id
    from public.pos_inventory_movements im
    where im.license_id = p_license_id and im.idempotency_key = v_movement_idem
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
    set metadata = coalesce(im.metadata, '{}'::jsonb) || jsonb_build_object('phase', 'rest_inv_5_cloud_restaurant_inventory', 'inventory_component', v_component, 'inventory_source', coalesce(v_allocation.payload->>'inventory_source', 'product'), 'source_product_id', nullif(v_allocation.payload->>'source_product_id', ''), 'modifier_id', nullif(v_allocation.payload->>'modifier_id', ''))
    where im.license_id = p_license_id and im.id = v_movement_id;

    update public.pos_sale_items si
    set metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('inventoryComponentsUsed', coalesce(si.metadata->'inventoryComponentsUsed', '[]'::jsonb) || jsonb_build_array(v_component), 'restaurantInventoryPhase', 'rest_inv_5_cloud_restaurant_inventory'),
        server_version = si.server_version + 1
    where si.license_id = p_license_id and si.sale_id = p_sale_id and si.id = v_sale_item_id;
  end loop;

  update public.pos_sales s
  set metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('restaurantInventoryPhase', 'rest_inv_5_cloud_restaurant_inventory', 'inventoryComponentsUsed', v_components, 'inventoryComponentsUsedCount', jsonb_array_length(v_components)),
      server_version = s.server_version + 1,
      updated_at = now()
  where s.license_id = p_license_id and s.id = p_sale_id;

  perform private.record_pos_sale_audit_event(p_license_id, p_sale_id, 'sale.restaurant_inventory_components_audited', p_actor_device_id, p_actor_staff_user_id, p_actor_name, jsonb_build_object('sale_id', p_sale_id, 'component_count', jsonb_array_length(v_components), 'components', v_components, 'idempotency_key', p_idempotency_key, 'phase', 'rest_inv_5_cloud_restaurant_inventory'));

  return v_response || jsonb_build_object('restaurant_inventory_components', v_components, 'restaurant_inventory_component_count', jsonb_array_length(v_components));
end;
$$;

comment on function private.rest_inv5_build_sale_inventory_requirements(text, jsonb, public.pos_products)
is 'REST.INV.5: calcula requerimientos cloud equivalentes al inventario local: receta base, extras normalizados y producto directo legacy.';
