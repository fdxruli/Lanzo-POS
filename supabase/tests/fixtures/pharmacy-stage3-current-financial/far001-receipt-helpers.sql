-- Receipt dependency definitions read from Production pg_catalog for isolated QA.
-- Load only in the disposable financial fixture.

CREATE OR REPLACE FUNCTION public.validate_pos_rpc_rate_limit_context(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null then
    return jsonb_build_object(
      'success', false, 'allowed', false, 'code', 'LICENSE_KEY_REQUIRED',
      'message', 'Licencia requerida.'
    );
  end if;
  if nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null then
    return jsonb_build_object(
      'success', false, 'allowed', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED',
      'message', 'Dispositivo requerido.'
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
    );
  exception
    when others then
      return jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', coalesce(nullif(sqlerrm, ''), 'POS_CONTEXT_INVALID'),
        'message', 'No se pudo validar el contexto seguro del dispositivo y actor.'
      );
  end;

  return v_context || jsonb_build_object('success', true, 'allowed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_cloud_products_sync_enabled(p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_products_sync')::boolean, false) is not true then
    raise exception 'CLOUD_PRODUCTS_SYNC_DISABLED' using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_inventory_actor_authority(p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.has_product_inventory_permission(p_context, 'inventory') then
    raise exception 'POS_PERMISSION_DENIED:inventory.write' using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.has_product_inventory_permission(p_context jsonb, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_context->>'actor_type' = 'admin' then true
    when p_context->>'actor_type' = 'staff'
      and jsonb_typeof(coalesce(p_context->'actor_permissions', '{}'::jsonb)) = 'object'
      and jsonb_typeof(coalesce(p_context->'actor_permissions'->p_permission, 'null'::jsonb)) = 'boolean'
      and (p_context->'actor_permissions'->p_permission) = 'true'::jsonb
      then true
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION private.pos_inventory_movement_to_jsonb(p_movement pos_inventory_movements)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_movement.id,
    'license_id', p_movement.license_id,
    'product_id', p_movement.product_id,
    'batch_id', p_movement.batch_id,
    'sale_id', p_movement.sale_id,
    'sale_item_id', p_movement.sale_item_id,
    'movement_type', p_movement.movement_type,
    'quantity', p_movement.quantity,
    'previous_stock', p_movement.previous_stock,
    'new_stock', p_movement.new_stock,
    'previous_batch_stock', p_movement.previous_batch_stock,
    'new_batch_stock', p_movement.new_batch_stock,
    'unit_cost', p_movement.unit_cost,
    'total_cost', p_movement.total_cost,
    'reason', p_movement.reason,
    'source', p_movement.source,
    'actor_device_id', p_movement.actor_device_id,
    'actor_staff_user_id', p_movement.actor_staff_user_id,
    'actor_key', p_movement.actor_key,
    'actor_name', p_movement.actor_name,
    'idempotency_key', p_movement.idempotency_key,
    'metadata', p_movement.metadata,
    'created_at', p_movement.created_at,
    'server_version', p_movement.server_version
  ))
$function$;

CREATE OR REPLACE FUNCTION private.pos_product_batch_to_jsonb(p_row pos_product_batches)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'product_id', p_row.product_id,
    'sku', p_row.sku,
    'sku_key', p_row.sku_key,
    'stock', p_row.stock,
    'committed_stock', p_row.committed_stock,
    'cost', p_row.cost,
    'price', p_row.price,
    'track_stock', p_row.track_stock,
    'is_active', p_row.is_active,
    'status', p_row.status,
    'active_stock_status', p_row.active_stock_status,
    'expiry_date', p_row.expiry_date,
    'alert_target_date', p_row.alert_target_date,
    'alert_type', p_row.alert_type,
    'manufacturer_batch_id', p_row.manufacturer_batch_id,
    'supplier', p_row.supplier,
    'attributes', p_row.attributes,
    'location', p_row.location,
    'notes', p_row.notes,
    'update_global_price', p_row.update_global_price,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$function$;

CREATE OR REPLACE FUNCTION private.pos_product_to_jsonb(p_row pos_products)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'category_id', p_row.category_id,
    'name', p_row.name,
    'name_key', p_row.name_key,
    'description', p_row.description,
    'barcode', p_row.barcode,
    'barcode_key', p_row.barcode_key,
    'sku', p_row.sku,
    'sku_key', p_row.sku_key,
    'image_ref', p_row.image_ref,
    'image_url', p_row.image_url,
    'location', p_row.location,
    'price', p_row.price,
    'cost', p_row.cost,
    'stock', p_row.stock,
    'committed_stock', p_row.committed_stock,
    'min_stock', p_row.min_stock,
    'max_stock', p_row.max_stock,
    'track_stock', p_row.track_stock,
    'is_active', p_row.is_active,
    'product_type', p_row.product_type,
    'sale_type', p_row.sale_type,
    'bulk_data', p_row.bulk_data,
    'conversion_factor', p_row.conversion_factor,
    'batch_management', p_row.batch_management,
    'recipe', p_row.recipe,
    'modifiers', p_row.modifiers,
    'wholesale_tiers', p_row.wholesale_tiers,
    'prescription_type', p_row.prescription_type,
    'active_substance', p_row.active_substance,
    'laboratory', p_row.laboratory,
    'requires_prescription', p_row.requires_prescription,
    'presentation', p_row.presentation,
    'expiration_mode', p_row.expiration_mode,
    'shelf_life_value', p_row.shelf_life_value,
    'shelf_life_unit', p_row.shelf_life_unit,
    'search_tokens', p_row.search_tokens,
    'search_ngrams', p_row.search_ngrams,
    'low_stock_alert_status', p_row.low_stock_alert_status,
    'active_stock_status', p_row.active_stock_status,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$function$;

CREATE OR REPLACE FUNCTION private.recalculate_pos_product_projection(p_license_id uuid, p_product_id text)
 RETURNS pos_products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.pos_products;
  v_total_stock numeric := 0;
  v_total_committed numeric := 0;
  v_total_value numeric := 0;
  v_has_variants boolean := false;
  v_new_cost numeric;
begin
  select * into v_product
  from public.pos_products
  where license_id = p_license_id
    and id = p_product_id
  for update;

  if v_product.id is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    coalesce(sum(case when b.is_active and b.status = 'active' and b.deleted_at is null then b.stock else 0 end), 0),
    coalesce(sum(case when b.deleted_at is null then b.committed_stock else 0 end), 0),
    coalesce(sum(case when b.is_active and b.status = 'active' and b.deleted_at is null then b.stock * b.cost else 0 end), 0),
    coalesce(bool_or(b.attributes is not null and b.attributes <> '{}'::jsonb and b.deleted_at is null), false)
  into v_total_stock, v_total_committed, v_total_value, v_has_variants
  from public.pos_product_batches b
  where b.license_id = p_license_id
    and b.product_id = p_product_id;

  v_new_cost := case
    when v_has_variants then v_product.cost
    when v_total_stock > 0 then round((v_total_value / v_total_stock)::numeric, 4)
    else v_product.cost
  end;

  update public.pos_products
  set stock = greatest(v_total_stock, 0),
      committed_stock = greatest(v_total_committed, 0),
      cost = greatest(coalesce(v_new_cost, cost), 0),
      active_stock_status = case when is_active and v_total_stock > 0 and deleted_at is null then 1 else 0 end,
      updated_at = now(),
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('projection_recalculated_at', now())
  where license_id = p_license_id
    and id = p_product_id
  returning * into v_product;

  return v_product;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_product_inventory_actor(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
begin
  v_context := public.validate_pos_rpc_rate_limit_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  if coalesce((v_context->>'success')::boolean, false) is not true then
    raise exception '%', coalesce(v_context->>'code', 'ACTOR_CONTEXT_INVALID')
      using errcode = 'P0001';
  end if;

  return v_context;
end;
$function$;

-- The historical fixture omitted variants. Keep this projection table empty
-- for the synthetic pharmacy, while exercising the real committed-stock trigger.
create table public.ecommerce_published_product_variants (
  license_id uuid,
  source_product_id text,
  stock_snapshot numeric,
  source_available boolean,
  deleted_at timestamptz
);
