-- FASE CAD.6 — Caducidad operativa, vida util y regularizacion de productos sin lote.
-- Mantiene caja/cobro/reportes financieros fuera de alcance.

create schema if not exists private;

create or replace function private.pos_cad6_normalize_text(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select lower(coalesce(p_value, ''));
$$;

create or replace function private.pos_cad6_truthy(p_value text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select private.pos_cad6_normalize_text(p_value) in ('true','1','yes','si','y','s');
$$;

create or replace function private.pos_cad6_text_matches_perishable(p_value text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select private.pos_cad6_normalize_text(p_value) like any (array[
    '%verduleria%', '%fruteria%', '%frutas%', '%verduras%',
    '%carniceria%', '%polleria%', '%pescaderia%', '%panaderia%',
    '%lacteo%', '%lacteos%', '%farmacia%', '%alimentos preparados%',
    '%food_service%', '%food service%', '%restaurante%', '%dark kitchen%',
    '%abarrotes perecederos%'
  ]);
$$;

create or replace function private.pos_cad6_product_context_text(p_product public.pos_products)
returns text
language plpgsql
stable
set search_path to ''
as $$
declare
  v_category_name text;
begin
  select c.name into v_category_name
  from public.pos_categories c
  where c.license_id = p_product.license_id
    and c.id = p_product.category_id
    and c.deleted_at is null
  limit 1;

  return concat_ws(' ',
    p_product.category_id,
    v_category_name,
    p_product.metadata->>'rubro',
    p_product.metadata->>'rubroContext',
    p_product.metadata->>'businessType',
    p_product.metadata->>'categoryName',
    p_product.metadata->>'category'
  );
end;
$$;

create or replace function private.pos_cad6_product_is_perishable_blocking(p_product public.pos_products)
returns boolean
language plpgsql
stable
set search_path to ''
as $$
declare
  v_context_text text;
begin
  if coalesce(p_product.expiration_mode, 'NONE') <> 'SHELF_LIFE' then
    return false;
  end if;

  if private.pos_cad6_truthy(p_product.metadata->>'perishableBlocking')
    or private.pos_cad6_truthy(p_product.metadata->>'perishable_blocking')
    or private.pos_cad6_truthy(p_product.metadata->>'isPerishable')
    or private.pos_cad6_truthy(p_product.metadata->>'is_perishable')
    or private.pos_cad6_truthy(p_product.batch_management->>'perishableBlocking')
    or private.pos_cad6_truthy(p_product.batch_management->>'perishable_blocking') then
    return true;
  end if;

  v_context_text := private.pos_cad6_product_context_text(p_product);
  return private.pos_cad6_text_matches_perishable(v_context_text);
end;
$$;

create or replace function private.pos_cad6_product_shelf_life_target_date(p_product public.pos_products)
returns date
language plpgsql
stable
set search_path to ''
as $$
declare
  v_raw text;
  v_unit text;
  v_value numeric;
  v_base timestamptz;
begin
  v_raw := coalesce(
    nullif(p_product.metadata->>'shelfLifeTargetDate', ''),
    nullif(p_product.metadata->>'shelf_life_target_date', ''),
    nullif(p_product.metadata->>'alertTargetDate', ''),
    nullif(p_product.metadata->>'alert_target_date', ''),
    nullif(p_product.metadata->>'expiryDate', ''),
    nullif(p_product.metadata->>'expiry_date', '')
  );

  if v_raw is not null and v_raw ~ '^\d{4}-\d{2}-\d{2}' then
    return v_raw::date;
  end if;

  v_value := coalesce(p_product.shelf_life_value, 0);
  if v_value <= 0 then
    return null;
  end if;

  v_unit := private.pos_cad6_normalize_text(coalesce(p_product.shelf_life_unit, 'days'));
  v_base := coalesce(p_product.created_at, now());

  if v_unit in ('hour','hours','hora','horas') then
    return (v_base + make_interval(hours => ceil(v_value)::integer))::date;
  elsif v_unit in ('month','months','mes','meses') then
    return (v_base + make_interval(months => ceil(v_value)::integer))::date;
  else
    return (v_base + make_interval(days => ceil(v_value)::integer))::date;
  end if;
end;
$$;

create or replace function private.pos_cad6_shelf_life_expired_for_sale(p_product public.pos_products)
returns boolean
language sql
stable
set search_path to ''
as $$
  select private.pos_cad6_product_is_perishable_blocking(p_product)
     and private.pos_cad6_product_shelf_life_target_date(p_product) is not null
     and private.pos_cad6_product_shelf_life_target_date(p_product) < current_date;
$$;

-- RPC controlada para regularizar stock padre creando lote trazable.
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
  v_idempotency_key text;
  v_response jsonb;
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

  if private.product_uses_batches(v_product) is not true then
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

  insert into public.pos_product_batches (
    id, license_id, product_id, sku, stock, committed_stock, cost, price,
    track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date,
    alert_type, location, notes, update_global_price, created_at, updated_at,
    server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id,
    updated_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    v_batch_id, v_license_id, p_product_id, 'REG-' || to_char(now(), 'YYYYMMDDHH24MISS'),
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

-- RPC controlada para ajustar a 0 stock padre no trazable. No toca caja ni ventas.
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

revoke all on function public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamptz,numeric,text,text) from public;
revoke all on function public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text) from public;
grant execute on function public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamptz,numeric,text,text) to anon, authenticated;
grant execute on function public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text) to anon, authenticated;
