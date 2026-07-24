create or replace function public.pos_create_product_batch_from_parent_stock(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_expiry_date timestamptz default null,
  p_quantity numeric default null,
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
  v_product public.pos_products;
  v_saved_batch public.pos_product_batches;
  v_saved_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_available numeric;
  v_quantity numeric;
  v_batch_id text;
  v_batch_sku text;
  v_idempotency_key text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'cad6.create_batch_from_stock:' || p_product_id || ':' || v_device_id::text);

  select * into v_product
  from public.pos_products p
  where p.license_id = v_license_id and p.id = p_product_id and p.deleted_at is null
  for update;

  if v_product.id is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
  end if;

  if private.product_uses_batches(v_product) is not true and coalesce(v_product.expiration_mode, 'NONE') <> 'STRICT' then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_DOES_NOT_REQUIRE_BATCH', 'message', 'Este producto no requiere lote para regularizar.');
  end if;

  v_available := greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0);
  v_quantity := coalesce(p_quantity, v_available);

  if v_quantity <= 0 or v_quantity > v_available then
    return jsonb_build_object('success', false, 'code', 'INVALID_REGULARIZATION_QUANTITY', 'message', 'La cantidad a regularizar no es valida.', 'available_quantity', v_available);
  end if;

  if coalesce(v_product.expiration_mode, 'NONE') in ('STRICT','SHELF_LIFE') and p_expiry_date is null then
    return jsonb_build_object('success', false, 'code', 'REGULARIZATION_EXPIRY_REQUIRED', 'message', 'Captura una fecha de caducidad o vida util estimada para crear el lote.');
  end if;

  v_batch_id := 'batch-reg-' || replace(gen_random_uuid()::text, '-', '');
  v_batch_sku := 'REG-' || to_char(now(), 'YYYYMMDDHH24MISS');

  insert into public.pos_product_batches (
    id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price,
    track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date,
    alert_type, location, notes, update_global_price, created_at, updated_at,
    server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id,
    updated_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    v_batch_id, v_license_id, p_product_id, v_batch_sku, private.normalize_pos_sku_key(v_batch_sku),
    v_quantity, 0, coalesce(v_product.cost, 0), coalesce(v_product.price, 0),
    true, true, 'active', case when v_quantity > 0 then 1 else 0 end,
    p_expiry_date, p_expiry_date,
    case when v_product.expiration_mode = 'SHELF_LIFE' then 'VIDA_UTIL_ESTIMADA' else 'CADUCIDAD_LEGAL' end,
    v_product.location, coalesce(nullif(btrim(p_notes), ''), 'Regularizacion de inventario sin lote'),
    false, now(), now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('phase', 'fase_cad_6', 'source', 'create_batch_from_parent_stock', 'regularization', true)
  ) returning * into v_saved_batch;

  v_saved_product := private.recalculate_pos_product_projection(v_license_id, p_product_id);
  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.create_batch_from_parent_stock', 'product_id', p_product_id), v_saved_batch.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.recalculate_after_regularization', 'batch_id', v_saved_batch.id), v_saved_product.server_version);

  return jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved_batch), 'product', private.pos_product_to_jsonb(v_saved_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'idempotency_key', v_idempotency_key, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq));
end;
$$;

revoke all on function public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamptz,numeric,text,text) from public;
grant execute on function public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamptz,numeric,text,text) to anon, authenticated;

comment on function public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamptz,numeric,text,text)
is 'CAD.6.1: crea lote trazable desde stock padre sin tocar caja, ventas ni cobro financiero.';;
