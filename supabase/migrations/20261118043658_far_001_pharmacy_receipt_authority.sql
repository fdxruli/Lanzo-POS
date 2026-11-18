begin;

do $receipt_precondition$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.pos_add_inventory_entry(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text)'::pg_catalog.regprocedure
      and p.prosecdef and pg_catalog.md5(p.prosrc) = '85045a54126eb442300a81c5962be820'
  ) then
    raise exception 'FAR_001_RECEIPT_PRECONDITION_FAILED';
  end if;
end;
$receipt_precondition$;

create function private.far_001_inventory_projection(p_license_id uuid, p_product_id text)
returns jsonb language sql stable set search_path to ''
as $projection$
  select jsonb_build_object(
    'product', private.pos_product_to_jsonb(p),
    'batches', coalesce((
      select jsonb_agg(private.pos_product_batch_to_jsonb(b))
      from public.pos_product_batches b
      where b.license_id = p.license_id and b.product_id = p.id
    ), '[]'::jsonb)
  )
  from public.pos_products p
  where p.license_id = p_license_id and p.id = p_product_id and p.deleted_at is null;
$projection$;

revoke all on function private.far_001_inventory_projection(uuid,text)
  from public, anon, authenticated, service_role;

-- Share the installed receipt transaction between the two public contracts.
-- The route is selected by the server wrapper. Completed legacy keys remain readable.
create function private.far_001_add_inventory_entry(p_pharmacy_receipt boolean, p_legacy_status boolean, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_input_unit text DEFAULT NULL::text, p_base_quantity numeric DEFAULT NULL::numeric, p_base_unit text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier text DEFAULT NULL::text, p_manufacturer_batch_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_entry_kind text DEFAULT 'restock'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_status_projection jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_add_inventory_entry', 'POS_WRITE', 60, 60, 60,
    'RPC_RATE_LIMITED', jsonb_build_object('operation', 'inventory_entry')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;

  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'operationId es obligatorio.');
  end if;
  if nullif(btrim(coalesce(p_product_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto es obligatorio.');
  end if;
  if coalesce(p_quantity, 0) <= 0 or coalesce(p_base_quantity, 0) <= 0
     or (p_pharmacy_receipt and (
       p_quantity::text in ('NaN', 'Infinity', '-Infinity')
       or p_base_quantity::text in ('NaN', 'Infinity', '-Infinity')
       or p_unit_cost::text in ('NaN', 'Infinity', '-Infinity')
     )) then
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
  if p_pharmacy_receipt then
    v_request := v_request || jsonb_build_object('pharmacy_receipt_protocol', 1);
  end if;
  v_request_hash := md5(v_request::text);
  if p_legacy_status then
    if not private.pharmacy_stage2_protected_product(v_license_id, p_product_id) then
      raise exception 'PHARMACY_CLASSIFICATION_REQUIRED' using errcode = 'P0001';
    end if;
    select * into v_idem from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key;
    if found then
      if v_idem.request_hash is distinct from v_request_hash then
        return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      end if;
      if v_idem.status is distinct from 'completed' or v_idem.response_payload is null then
        return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING');
      end if;
    elsif exists (
      select 1 from public.pos_inventory_movements m
      where m.license_id = v_license_id and m.idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object('success', false, 'code', 'PHARMACY_RECEIPT_PROOF_UNAVAILABLE');
    end if;

    v_status_projection := private.far_001_inventory_projection(v_license_id, p_product_id);
    if v_status_projection is null then
      return jsonb_build_object('success', false, 'code', 'PHARMACY_INVENTORY_REVIEW_REQUIRED');
    end if;
    return v_status_projection || jsonb_build_object(
      'success', true, 'idempotency_key', p_idempotency_key,
      'receipt_outcome', case
        when v_idem.response_payload->>'success' = 'true'
          and v_idem.response_payload->'inventory_movement'->>'id' is not null then 'confirmed'
        when v_idem.response_payload is null or v_idem.response_payload->>'success' = 'false' then 'rejected'
        else 'uncertain' end,
      'inventory_movement', v_idem.response_payload->'inventory_movement'
    );
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'inventory.entry', 'inventory_entry', p_product_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
    if coalesce(v_idem.request_hash, '') <> v_request_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'message', 'operationId ya fue usado con otro payload.');
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      if p_pharmacy_receipt and v_idem.response_payload->>'success' = 'true' then
        v_status_projection := private.far_001_inventory_projection(v_license_id, p_product_id);
        if v_status_projection is null then
          return jsonb_build_object('success', false, 'code', 'INVENTORY_RECEIPT_PROJECTION_PENDING');
        end if;
        select b into v_response from jsonb_array_elements(v_status_projection->'batches') b
        where b->>'id' = v_idem.response_payload->'batch'->>'id';
        return v_idem.response_payload || v_status_projection || jsonb_build_object('batch', v_response);
      end if;
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operación ya está en proceso.');
  end if;

  select * into v_product from public.pos_products where license_id = v_license_id and id = p_product_id and deleted_at is null for update;
  if v_product.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if private.pharmacy_stage2_protected_product(v_license_id, v_product.id) then
    if not p_pharmacy_receipt then
      raise exception 'PHARMACY_RECEIPT_CLIENT_UPDATE_REQUIRED' using errcode = 'P0001';
    end if;
    if v_product.is_active is distinct from true then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif p_pharmacy_receipt then
    raise exception 'PHARMACY_CLASSIFICATION_REQUIRED' using errcode = 'P0001';
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
    if p_pharmacy_receipt then
      if (p_batch_id is not null and v_batch.id is null)
         or (p_batch_id is null and v_batch.id is not null)
         or (v_batch.id is not null and (v_batch.is_active is distinct from true or v_batch.status is distinct from 'active'))
         or exists (
           select 1 from public.pos_product_batches b
           where b.license_id = v_license_id and b.id = v_batch_id and b.deleted_at is not null
         ) then
        raise exception 'BATCH_NOT_FOUND' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.pos_product_batches b
        where b.license_id = v_license_id and b.product_id = v_product.id
          and b.id is distinct from v_batch.id
          and lower(btrim(b.manufacturer_batch_id)) =
              lower(btrim(coalesce(v_batch.manufacturer_batch_id, p_manufacturer_batch_id)))
      ) then
        raise exception 'PHARMACY_EXISTING_BATCH_REQUIRED' using errcode = 'P0001';
      end if;
      if not isfinite(coalesce(v_batch.expiry_date, p_expiry_date)) then
        raise exception 'PHARMACY_BATCH_IDENTITY_REQUIRED' using errcode = 'P0001';
      end if;
    end if;
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
    perform private.pharmacy_stage2_validate_receipt(
      v_license_id,v_product,v_batch,coalesce(p_metadata,'{}'::jsonb),
      p_supplier,p_manufacturer_batch_id,p_expiry_date,p_occurred_at);
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
    perform private.pharmacy_stage2_validate_receipt(
      v_license_id,v_product,v_batch,coalesce(p_metadata,'{}'::jsonb),
      p_supplier,p_manufacturer_batch_id,p_expiry_date,p_occurred_at);
    v_new_stock := v_previous_stock + p_base_quantity;
    update public.pos_products set stock = v_new_stock, active_stock_status = case when is_active then 1 else 0 end, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_product.id returning * into v_saved_product;
  end if;

  v_movement := private.record_pos_inventory_movement(v_license_id, v_product.id, case when v_uses_batches then v_saved_batch.id else null end, null, null, 'manual_in', p_base_quantity, v_previous_stock, v_new_stock, case when v_uses_batches then v_previous_batch_stock else null end, case when v_uses_batches then v_new_batch_stock else null end, coalesce(p_unit_cost, v_saved_batch.cost, v_product.cost), coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inventory_entry', v_device_id, v_staff_user_id, private.resolve_cash_actor_key(v_context), private.resolve_cash_actor_name(v_context), p_idempotency_key, jsonb_build_object('entryKind', coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inputQuantity', p_quantity, 'inputUnit', p_input_unit, 'baseQuantity', p_base_quantity, 'baseUnit', p_base_unit) || coalesce(p_metadata, '{}'::jsonb)
    || case when p_pharmacy_receipt then jsonb_build_object('far001ReceiptProtocol', 1) else '{}'::jsonb end);
  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'batch_id', case when v_uses_batches then v_saved_batch.id else null end), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_movement.server_version::integer);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'batch', case when v_uses_batches then private.pos_product_batch_to_jsonb(v_saved_batch) else null end, 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'event', to_jsonb(v_event), 'batch_event', case when v_uses_batches then to_jsonb(v_batch_event) else null end, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

revoke all on function private.far_001_add_inventory_entry(boolean,boolean,text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text)
  from public, anon, authenticated, service_role;

create or replace function public.pos_add_inventory_entry(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_input_unit text DEFAULT NULL::text, p_base_quantity numeric DEFAULT NULL::numeric, p_base_unit text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier text DEFAULT NULL::text, p_manufacturer_batch_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_entry_kind text DEFAULT 'restock'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to ''
as $rpc$
  select private.far_001_add_inventory_entry(false, false, p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product_id, p_batch_id, p_quantity, p_input_unit, p_base_quantity, p_base_unit, p_unit_cost, p_supplier, p_manufacturer_batch_id, p_expiry_date, p_occurred_at, p_entry_kind, p_metadata, p_idempotency_key);
$rpc$;

revoke all on function public.pos_add_inventory_entry(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_add_inventory_entry(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) to anon, authenticated, service_role;

create or replace function public.pos_receive_pharmacy_inventory_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_input_unit text DEFAULT NULL::text, p_base_quantity numeric DEFAULT NULL::numeric, p_base_unit text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier text DEFAULT NULL::text, p_manufacturer_batch_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_entry_kind text DEFAULT 'restock'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to ''
as $rpc$
  select private.far_001_add_inventory_entry(true, false, p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product_id, p_batch_id, p_quantity, p_input_unit, p_base_quantity, p_base_unit, p_unit_cost, p_supplier, p_manufacturer_batch_id, p_expiry_date, p_occurred_at, p_entry_kind, p_metadata, p_idempotency_key);
$rpc$;

revoke all on function public.pos_receive_pharmacy_inventory_v1(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_receive_pharmacy_inventory_v1(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) to anon, authenticated, service_role;

create or replace function public.pos_verify_legacy_pharmacy_receipt_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_input_unit text DEFAULT NULL::text, p_base_quantity numeric DEFAULT NULL::numeric, p_base_unit text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier text DEFAULT NULL::text, p_manufacturer_batch_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_entry_kind text DEFAULT 'restock'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to ''
as $rpc$
  select private.far_001_add_inventory_entry(false, true, p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product_id, p_batch_id, p_quantity, p_input_unit, p_base_quantity, p_base_unit, p_unit_cost, p_supplier, p_manufacturer_batch_id, p_expiry_date, p_occurred_at, p_entry_kind, p_metadata, p_idempotency_key);
$rpc$;

revoke all on function public.pos_verify_legacy_pharmacy_receipt_v1(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_verify_legacy_pharmacy_receipt_v1(text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text) to anon, authenticated, service_role;

-- Financial RPCs link the server-side stock effect after inserting the sale
-- line. Validate the final state in the same transaction, including layaways.
create function private.far_001_require_pharmacy_sale_inventory()
returns trigger
language plpgsql security definer set search_path to ''
as $sale_guard$
begin
  if not private.pharmacy_stage2_business(new.license_id)
     or not private.pharmacy_stage2_protected_product(new.license_id, new.product_id) then
    return null;
  end if;

  if not exists (
    select 1
    from public.pos_sale_items i
    join lateral (
      select sum(m.quantity) as quantity,
             bool_or(m.id = i.inventory_movement_id and m.batch_id = i.batch_id) as linked,
             bool_and(coalesce(
               b.deleted_at is null and b.is_active is true and b.status = 'active'
               and isfinite(b.expiry_date) and (b.expiry_date at time zone 'UTC')::date >= current_date
               and nullif(btrim(b.manufacturer_batch_id), '') is not null
               and m.new_batch_stock >= 0 and m.previous_batch_stock - m.new_batch_stock = m.quantity,
               false
             )) as valid
      from public.pos_inventory_movements m
      left join public.pos_product_batches b
        on b.license_id = m.license_id and b.id = m.batch_id and b.product_id = m.product_id
      where m.license_id = i.license_id and m.sale_id = i.sale_id and m.sale_item_id = i.id
        and m.product_id = i.product_id and m.movement_type = 'sale_out'
        and m.created_at = transaction_timestamp()
    ) amounts on amounts.valid and amounts.linked and amounts.quantity = i.quantity
    where i.license_id = new.license_id and i.id = new.id
      and i.inventory_effect_status = 'applied'
  ) then
    raise exception 'PHARMACY_CLOUD_AUTHORITY_REQUIRED' using errcode = 'P0001';
  end if;
  return null;
end;
$sale_guard$;

revoke all on function private.far_001_require_pharmacy_sale_inventory()
  from public, anon, authenticated, service_role;

create constraint trigger trg_far_001_pharmacy_sale_inventory
after insert on public.pos_sale_items deferrable initially deferred
for each row execute function private.far_001_require_pharmacy_sale_inventory();

-- Existing generic product/batch/import routes also write this table. Any
-- increase in pharmaceutical stock must have its own matching ledger entry.
create function private.far_001_require_pharmacy_batch_increase()
returns trigger
language plpgsql security definer set search_path to ''
as $batch_increase$
declare
  v_previous numeric := 0;
begin
  if tg_op = 'UPDATE' then v_previous := coalesce(old.stock, 0); end if;
  if coalesce(new.stock, 0) <= v_previous
     or not private.pharmacy_stage2_business(new.license_id)
     or not private.pharmacy_stage2_protected_product(new.license_id, new.product_id) then
    return null;
  end if;

  if not exists (
    select 1 from public.pos_inventory_movements m
    where m.license_id = new.license_id and m.product_id = new.product_id and m.batch_id = new.id
      and m.idempotency_key = new.last_idempotency_key
      and m.created_at = transaction_timestamp()
      and m.previous_batch_stock = v_previous and m.new_batch_stock = new.stock
      and m.quantity = new.stock - v_previous
      and (
        (m.movement_type = 'manual_in' and m.source = 'inventory_entry'
          and m.metadata->>'far001ReceiptProtocol' = '1')
        or (m.movement_type = 'return_in' and m.source = 'sale_cancellation'
          and m.sale_id is not null and m.sale_item_id is not null)
      )
  ) then
    raise exception 'PHARMACY_BATCH_STOCK_CHANGE_REQUIRES_DOCUMENTED_MOVEMENT' using errcode = 'P0001';
  end if;
  return null;
end;
$batch_increase$;

revoke all on function private.far_001_require_pharmacy_batch_increase()
  from public, anon, authenticated, service_role;

create constraint trigger trg_far_001_pharmacy_batch_increase
after insert or update of stock on public.pos_product_batches
deferrable initially deferred
for each row execute function private.far_001_require_pharmacy_batch_increase();

create function private.far_001_guard_pharmacy_batch_identity()
returns trigger
language plpgsql security definer set search_path to ''
as $batch_identity$
declare
  v_manufacturer text := nullif(lower(btrim(new.manufacturer_batch_id)), '');
begin
  if not private.pharmacy_stage2_business(new.license_id)
     or not private.pharmacy_stage2_protected_product(new.license_id, new.product_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.deleted_at is not null and new.deleted_at is null)
       or ((old.is_active is false or old.status = 'archived')
          and new.deleted_at is null and new.is_active is true and new.status = 'active') then
      raise exception 'PHARMACY_ARCHIVED_BATCH_EXISTS' using errcode = 'P0001';
    end if;
    if (old.license_id, old.product_id) is distinct from (new.license_id, new.product_id)
       or (nullif(lower(btrim(old.manufacturer_batch_id)), '') is not null
           and lower(btrim(old.manufacturer_batch_id)) is distinct from v_manufacturer) then
      raise exception 'PHARMACY_BATCH_IDENTITY_IMMUTABLE' using errcode = 'P0001';
    end if;
    if lower(btrim(old.manufacturer_batch_id)) is not distinct from v_manufacturer then
      return new;
    end if;
  end if;

  if v_manufacturer is not null then
    perform 1 from public.pos_products p
    where p.license_id = new.license_id and p.id = new.product_id for update;
    if exists (
      select 1 from public.pos_product_batches b
      where b.license_id = new.license_id and b.product_id = new.product_id and b.id <> new.id
        and lower(btrim(b.manufacturer_batch_id)) = v_manufacturer
    ) then
      raise exception 'PHARMACY_EXISTING_BATCH_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$batch_identity$;

revoke all on function private.far_001_guard_pharmacy_batch_identity()
  from public, anon, authenticated, service_role;
create trigger trg_far_001_pharmacy_batch_identity
before insert or update of manufacturer_batch_id, license_id, product_id, deleted_at, status, is_active
on public.pos_product_batches
for each row execute function private.far_001_guard_pharmacy_batch_identity();

commit;
