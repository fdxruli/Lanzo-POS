-- REST.INV.5 — Resolver cloud replayable para receta + extras.
-- Conserva el resolver histórico como directo, expande líneas restaurante a componentes
-- y enriquece las asignaciones antes de aplicar inventario.

do $$
begin
  if to_regprocedure('private.resolve_sale_inventory_allocations_direct_rest_inv5(uuid,jsonb,text)') is null then
    alter function private.resolve_sale_inventory_allocations(uuid,jsonb,text)
      rename to resolve_sale_inventory_allocations_direct_rest_inv5;
  end if;
end;
$$;

create or replace function private.rest_inv5_expand_sale_inventory_items(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
as $$
declare
  v_item record;
  v_req record;
  v_item_norm jsonb;
  v_source_product public.pos_products;
  v_requirements jsonb;
  v_expanded jsonb := '[]'::jsonb;
  v_original_id text;
  v_synthetic_id text;
  v_source text;
  v_metadata jsonb;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    v_item_norm := private.normalize_sale_inventory_item(v_item.payload, v_item.ordinality);
    v_original_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id','lineId','cartLineId'], null), p_sale_id || ':item:' || v_item.ordinality::text);

    select * into v_source_product
    from public.pos_products p
    where p.license_id = p_license_id
      and p.id = nullif(v_item_norm->>'product_id', '');

    if v_source_product.id is null or v_source_product.deleted_at is not null or v_source_product.is_active is not true then
      v_expanded := v_expanded || jsonb_build_array(v_item.payload);
      continue;
    end if;

    v_requirements := private.rest_inv5_build_sale_inventory_requirements(p_sale_id, v_item_norm, v_source_product);

    for v_req in
      select value as payload, ordinality
      from jsonb_array_elements(coalesce(v_requirements, '[]'::jsonb)) with ordinality
    loop
      if nullif(v_req.payload->>'product_id', '') is null or coalesce(nullif(v_req.payload->>'quantity', '')::numeric, 0) <= 0 then
        continue;
      end if;

      v_source := coalesce(v_req.payload->>'source', 'product');
      v_synthetic_id := v_original_id || '::rest_inv5::' || md5(v_req.payload::text || ':' || v_req.ordinality::text);
      v_metadata := coalesce(v_item.payload->'metadata', '{}'::jsonb) || jsonb_build_object(
        'originalSaleItemId', v_original_id,
        'inventorySource', v_source,
        'sourceProductId', v_req.payload->>'source_product_id',
        'sourceProductName', v_req.payload->>'source_product_name',
        'componentKey', v_req.payload->>'component_key',
        'componentQuantity', nullif(v_req.payload->>'component_quantity', '')::numeric,
        'componentUnit', nullif(v_req.payload->>'component_unit', ''),
        'modifierId', nullif(v_req.payload->>'modifier_id', ''),
        'modifierName', nullif(v_req.payload->>'modifier_name', ''),
        'restaurantInventoryPhase', 'rest_inv_5_cloud_restaurant_inventory'
      );

      v_expanded := v_expanded || jsonb_build_array(jsonb_build_object(
        'id', v_synthetic_id,
        'product_id', v_req.payload->>'product_id',
        'product_name', coalesce(v_req.payload->>'source_product_name', v_item_norm->>'product_name', 'Producto'),
        'quantity', nullif(v_req.payload->>'quantity', '')::numeric,
        'unit_cost', nullif(v_item_norm->>'unit_cost', '')::numeric,
        'batch_id', case when v_source = 'product' then nullif(v_item_norm->>'batch_id', '') else null end,
        'batches_used', case when v_source = 'product' then coalesce(v_item_norm->'batches_used', '[]'::jsonb) else '[]'::jsonb end,
        'metadata', v_metadata
      ));
    end loop;
  end loop;

  return v_expanded;
end;
$$;

create or replace function private.rest_inv5_enrich_inventory_allocations(p_expanded_items jsonb, p_response jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_alloc record;
  v_expanded_item jsonb;
  v_enriched jsonb := '[]'::jsonb;
  v_synthetic_id text;
  v_original_id text;
  v_meta jsonb;
begin
  if coalesce((p_response->>'ok')::boolean, false) is not true then
    return p_response;
  end if;

  for v_alloc in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_response->'allocations', '[]'::jsonb)) with ordinality
  loop
    v_synthetic_id := nullif(v_alloc.payload->>'sale_item_id', '');
    v_expanded_item := null;

    select e.value into v_expanded_item
    from jsonb_array_elements(coalesce(p_expanded_items, '[]'::jsonb)) e(value)
    where e.value->>'id' = v_synthetic_id
    limit 1;

    v_meta := coalesce(v_expanded_item->'metadata', '{}'::jsonb);
    v_original_id := coalesce(nullif(v_meta->>'originalSaleItemId', ''), v_synthetic_id);

    v_enriched := v_enriched || jsonb_build_array(
      (v_alloc.payload - 'sale_item_id') || jsonb_build_object(
        'sale_item_id', v_original_id,
        'inventory_source', coalesce(nullif(v_meta->>'inventorySource', ''), 'product'),
        'source_product_id', nullif(v_meta->>'sourceProductId', ''),
        'source_product_name', nullif(v_meta->>'sourceProductName', ''),
        'component_key', nullif(v_meta->>'componentKey', ''),
        'component_quantity', nullif(v_meta->>'componentQuantity', '')::numeric,
        'component_unit', nullif(v_meta->>'componentUnit', ''),
        'modifier_id', nullif(v_meta->>'modifierId', ''),
        'modifier_name', nullif(v_meta->>'modifierName', '')
      )
    );
  end loop;

  return p_response || jsonb_build_object(
    'allocations', v_enriched,
    'inventory_effect_status', case when jsonb_array_length(v_enriched) > 0 then 'applied' else 'not_required' end
  );
end;
$$;

create or replace function private.resolve_sale_inventory_allocations(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_expanded_items jsonb;
  v_response jsonb;
begin
  v_expanded_items := private.rest_inv5_expand_sale_inventory_items(p_license_id, p_items, p_sale_id);
  v_response := private.resolve_sale_inventory_allocations_direct_rest_inv5(p_license_id, v_expanded_items, p_sale_id);
  return private.rest_inv5_enrich_inventory_allocations(v_expanded_items, v_response);
end;
$$;
