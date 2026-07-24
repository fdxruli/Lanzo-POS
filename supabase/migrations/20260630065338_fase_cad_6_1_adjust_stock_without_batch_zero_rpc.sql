create or replace function public.pos_adjust_product_stock_without_batch_zero(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_reason text default 'regularizacion_stock_sin_lote',
  p_notes text default null,
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
  v_product public.pos_products;
  v_saved_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_previous_stock numeric;
  v_idempotency_key text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'cad6.adjust_stock_without_batch_zero:' || p_product_id || ':' || v_device_id::text);

  select * into v_product
  from public.pos_products p
  where p.license_id = v_license_id and p.id = p_product_id and p.deleted_at is null
  for update;

  if v_product.id is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
  end if;

  v_previous_stock := greatest(coalesce(v_product.stock, 0), 0);
  if v_previous_stock <= 0 then
    return jsonb_build_object('success', false, 'code', 'NO_PARENT_STOCK_TO_ADJUST', 'message', 'El producto ya no tiene stock padre por ajustar.');
  end if;

  update public.pos_products
  set stock = 0,
      committed_stock = 0,
      active_stock_status = 0,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cad6RegularizedStockWithoutBatch', true, 'cad6RegularizedAt', now())
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved_product;

  insert into public.pos_inventory_movements (
    id, license_id, product_id, movement_type, quantity, previous_stock, new_stock,
    unit_cost, total_cost, reason, source, actor_device_id, actor_staff_user_id,
    actor_key, actor_name, idempotency_key, metadata, created_at, server_version
  ) values (
    'mov_inv_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, p_product_id,
    'adjustment', v_previous_stock, v_previous_stock, 0, coalesce(v_product.cost, 0),
    v_previous_stock * coalesce(v_product.cost, 0), coalesce(nullif(btrim(p_reason), ''), 'regularizacion_stock_sin_lote'),
    'adjustment', v_device_id, v_staff_user_id, v_actor_key, v_actor_name, v_idempotency_key,
    jsonb_build_object('phase', 'fase_cad_6', 'source', 'adjust_stock_without_batch_zero', 'notes', p_notes),
    now(), 1
  ) returning * into v_movement;

  perform private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.adjust_stock_without_batch_zero', 'previous_stock', v_previous_stock), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.adjust_stock_without_batch_zero', 'product_id', p_product_id), v_movement.server_version::integer);

  return jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'idempotency_key', v_idempotency_key);
end;
$$;

revoke all on function public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text) from public;
grant execute on function public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text) to anon, authenticated;

comment on function public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text)
is 'CAD.6.1: ajusta stock padre sin lote a 0 mediante pos_inventory_movements tipo adjustment; no toca caja ni ventas.';;
