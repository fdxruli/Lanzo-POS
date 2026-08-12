-- PRODUCT.INVENTORY.ENTRY.2 — canonical additive inventory entry.
-- No tables, columns or movement types are introduced by this migration.
-- The existing movement source contract is extended only with inventory_entry.

do $$
declare
  v_constraint_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid)
    into v_constraint_definition
  from pg_constraint constraint_row
  join pg_class relation_row on relation_row.oid = constraint_row.conrelid
  join pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
  where schema_row.nspname = 'public'
    and relation_row.relname = 'pos_inventory_movements'
    and constraint_row.conname = 'pos_inventory_movements_source_check';

  if v_constraint_definition is null then
    raise exception 'Expected public.pos_inventory_movements constraint % is missing',
      'pos_inventory_movements_source_check';
  end if;

  if v_constraint_definition <> $expected$CHECK ((source = ANY (ARRAY['sale'::text, 'sale_cancellation'::text, 'adjustment'::text, 'migration'::text, 'manual'::text])))$expected$ then
    raise exception 'Unexpected pos_inventory_movements source contract: %', v_constraint_definition;
  end if;
end;
$$;

alter table public.pos_inventory_movements
  drop constraint pos_inventory_movements_source_check;

alter table public.pos_inventory_movements
  add constraint pos_inventory_movements_source_check
  check (source = any (array[
    'sale',
    'sale_cancellation',
    'adjustment',
    'migration',
    'manual',
    'inventory_entry'
  ]::text[]));

create or replace function public.pos_add_inventory_entry(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_batch_id text default null,
  p_quantity numeric default null,
  p_input_unit text default null,
  p_base_quantity numeric default null,
  p_base_unit text default null,
  p_unit_cost numeric default null,
  p_supplier text default null,
  p_manufacturer_batch_id text default null,
  p_expiry_date timestamptz default null,
  p_occurred_at timestamptz default null,
  p_entry_kind text default 'restock',
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_saved_batch public.pos_product_batches;
  v_saved_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_event public.pos_sync_events;
  v_batch_event public.pos_sync_events;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request jsonb;
  v_request_hash text;
  v_batch_id text;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_uses_batches boolean;
  v_is_variant boolean;
  v_has_variants boolean;
  v_response jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_add_inventory_entry', 'POS_WRITE', 60, 60, 60,
    'RPC_RATE_LIMITED', jsonb_build_object('operation', 'inventory_entry')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'operationId es obligatorio.');
  end if;
  if nullif(btrim(coalesce(p_product_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto es obligatorio.');
  end if;
  if coalesce(p_quantity, 0) <= 0 or coalesce(p_base_quantity, 0) <= 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_QUANTITY', 'message', 'La cantidad debe ser mayor a cero.');
  end if;
  if abs(p_quantity - p_base_quantity) > 0.000001 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'La conversión de unidades aún no está disponible.');
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'El costo no puede ser negativo.');
  end if;

  v_request := jsonb_build_object(
    'product_id', p_product_id, 'batch_id', p_batch_id, 'quantity', p_quantity,
    'input_unit', p_input_unit, 'base_quantity', p_base_quantity, 'base_unit', p_base_unit,
    'unit_cost', p_unit_cost, 'supplier', p_supplier, 'manufacturer_batch_id', p_manufacturer_batch_id,
    'expiry_date', p_expiry_date, 'occurred_at', p_occurred_at, 'entry_kind', p_entry_kind,
    'metadata', coalesce(p_metadata, '{}'::jsonb)
  );
  v_request_hash := md5(v_request::text);
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'inventory.entry', 'inventory_entry', p_product_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
    if coalesce(v_idem.request_hash, '') <> v_request_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'message', 'operationId ya fue usado con otro payload.');
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operación ya está en proceso.');
  end if;

  select * into v_product from public.pos_products where license_id = v_license_id and id = p_product_id and deleted_at is null for update;
  if v_product.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if v_product.track_stock is false then
    v_response := jsonb_build_object('success', false, 'code', 'STOCK_TRACKING_DISABLED', 'message', 'El producto no administra existencias.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if jsonb_typeof(coalesce(v_product.recipe, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(v_product.recipe, '[]'::jsonb)) > 0 then
    v_response := jsonb_build_object('success', false, 'code', 'RECIPE_INVENTORY_ENTRY_NOT_ALLOWED', 'message', 'Los platillos con receta no admiten entradas directas.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;

  v_uses_batches := private.product_uses_batches(v_product);
  v_previous_stock := greatest(coalesce(v_product.stock, 0), 0);
  if v_uses_batches then
    select exists (
      select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.product_id = v_product.id
        and b.deleted_at is null and b.attributes is not null and b.attributes <> '{}'::jsonb
    ) into v_has_variants;
    if v_has_variants and nullif(btrim(coalesce(p_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_REQUIRED', 'message', 'Este producto requiere seleccionar una variante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    v_batch_id := nullif(btrim(coalesce(p_batch_id, '')), '');
    if v_batch_id is null then v_batch_id := 'batch-entry-' || regexp_replace(p_idempotency_key, '[^a-zA-Z0-9_-]', '-', 'g'); end if;
    select * into v_batch from public.pos_product_batches where license_id = v_license_id and id = v_batch_id and deleted_at is null for update;
    if v_batch.id is not null and v_batch.product_id <> v_product.id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'El lote no pertenece al producto.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_has_variants and (v_batch.id is null or v_batch.attributes is null or v_batch.attributes = '{}'::jsonb) then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'La variante seleccionada ya no existe.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and nullif(btrim(coalesce(p_manufacturer_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_MANUFACTURER_BATCH_REQUIRED', 'message', 'Se requiere lote del fabricante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and p_expiry_date is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'Se requiere fecha de caducidad.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    v_previous_batch_stock := greatest(coalesce(v_batch.stock, 0), 0);
    v_new_batch_stock := v_previous_batch_stock + p_base_quantity;
    if v_batch.id is null then
      insert into public.pos_product_batches (id, license_id, product_id, stock, committed_stock, cost, price, track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type, manufacturer_batch_id, supplier, attributes, notes, created_at, updated_at, server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata)
      values (v_batch_id, v_license_id, v_product.id, v_new_batch_stock, 0, greatest(coalesce(p_unit_cost, v_product.cost, 0), 0), greatest(coalesce(v_product.price, 0), 0), true, true, 'active', 1, p_expiry_date, p_expiry_date, case when p_expiry_date is null then null else 'CADUCIDAD_LEGAL' end, nullif(btrim(coalesce(p_manufacturer_batch_id, '')), ''), nullif(btrim(coalesce(p_supplier, '')), ''), null, 'Entrada de inventario', coalesce(p_occurred_at, now()), now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry')) returning * into v_saved_batch;
    else
      update public.pos_product_batches set stock = v_new_batch_stock, cost = greatest(coalesce(p_unit_cost, cost, 0), 0), supplier = coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier), is_active = true, status = 'active', active_stock_status = 1, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_batch.id returning * into v_saved_batch;
    end if;
    v_saved_product := private.recalculate_pos_product_projection(v_license_id, v_product.id);
    v_new_stock := v_saved_product.stock;
    v_batch_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, case when v_batch.id is null then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_saved_batch.server_version);
  else
    v_new_stock := v_previous_stock + p_base_quantity;
    update public.pos_products set stock = v_new_stock, active_stock_status = case when is_active then 1 else 0 end, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_product.id returning * into v_saved_product;
  end if;

  v_movement := private.record_pos_inventory_movement(v_license_id, v_product.id, case when v_uses_batches then v_saved_batch.id else null end, null, null, 'manual_in', p_base_quantity, v_previous_stock, v_new_stock, case when v_uses_batches then v_previous_batch_stock else null end, case when v_uses_batches then v_new_batch_stock else null end, coalesce(p_unit_cost, v_saved_batch.cost, v_product.cost), coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inventory_entry', v_device_id, v_staff_user_id, private.resolve_cash_actor_key(v_context), private.resolve_cash_actor_name(v_context), p_idempotency_key, jsonb_build_object('entryKind', coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inputQuantity', p_quantity, 'inputUnit', p_input_unit, 'baseQuantity', p_base_quantity, 'baseUnit', p_base_unit) || coalesce(p_metadata, '{}'::jsonb));
  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'batch_id', case when v_uses_batches then v_saved_batch.id else null end), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_movement.server_version::integer);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'batch', case when v_uses_batches then private.pos_product_batch_to_jsonb(v_saved_batch) else null end, 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'event', to_jsonb(v_event), 'batch_event', case when v_uses_batches then to_jsonb(v_batch_event) else null end, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

revoke all on function public.pos_add_inventory_entry(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) from public;
grant execute on function public.pos_add_inventory_entry(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) to anon, authenticated;
notify pgrst, 'reload schema';