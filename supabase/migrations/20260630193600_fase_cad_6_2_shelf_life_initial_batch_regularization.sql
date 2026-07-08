create or replace function private.calculate_pos_shelf_life_target(
  p_base_date timestamptz,
  p_shelf_life_value numeric,
  p_shelf_life_unit text default 'days'
)
returns timestamptz
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_base timestamptz := coalesce(p_base_date, now());
  v_value numeric := coalesce(p_shelf_life_value, 0);
  v_unit text := translate(lower(btrim(coalesce(p_shelf_life_unit, 'days'))), 'áéíóúü', 'aeiouu');
begin
  if v_value <= 0 then
    return null;
  end if;

  if v_unit in ('hour', 'hours', 'hora', 'horas') then
    return v_base + ((v_value::text || ' hours')::interval);
  elsif v_unit in ('month', 'months', 'mes', 'meses') then
    return v_base + ((v_value::text || ' months')::interval);
  end if;

  return v_base + ((v_value::text || ' days')::interval);
end;
$function$;

create or replace function public.pos_upsert_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_product jsonb default '{}'::jsonb,
  p_initial_batches jsonb default '[]'::jsonb,
  p_expected_version integer default null::integer,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product_id text;
  v_category_id text;
  v_name text;
  v_name_key text;
  v_barcode text;
  v_barcode_key text;
  v_sku text;
  v_sku_key text;
  v_product_type text;
  v_sale_type text;
  v_expiration_mode text;
  v_shelf_life_value numeric;
  v_shelf_life_unit text;
  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_committed_stock numeric;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_saved_batch public.pos_product_batches;
  v_batch_item jsonb;
  v_batch_id text;
  v_batch_sku text;
  v_batch_sku_key text;
  v_batch_stock numeric;
  v_batch_cost numeric;
  v_batch_price numeric;
  v_batch_status text;
  v_batch_created_at timestamptz;
  v_batch_expiry_date timestamptz;
  v_batch_alert_target_date timestamptz;
  v_batch_alert_type text;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
  v_has_initial_batches boolean := false;
  v_search_tokens text[];
  v_search_ngrams text[];
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if coalesce(jsonb_typeof(p_initial_batches), 'array') <> 'array' then
    raise exception 'INITIAL_BATCHES_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;
  v_has_initial_batches := jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0;

  v_product_id := nullif(btrim(coalesce(p_product->>'id', '')), '');
  if v_product_id is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  v_name := nullif(btrim(coalesce(p_product->>'name', '')), '');
  if v_name is null then raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);

  v_category_id := nullif(btrim(coalesce(p_product->>'category_id', p_product->>'categoryId', '')), '');
  if v_category_id is not null and not exists (
    select 1 from public.pos_categories c where c.license_id = v_license_id and c.id = v_category_id and c.deleted_at is null
  ) then
    v_category_id := null;
  end if;

  v_barcode := nullif(btrim(coalesce(p_product->>'barcode', '')), '');
  v_barcode_key := private.normalize_pos_barcode_key(coalesce(p_product->>'barcode_key', p_product->>'barcodeKey', v_barcode));
  v_sku := nullif(btrim(coalesce(p_product->>'sku', '')), '');
  v_sku_key := private.normalize_pos_sku_key(coalesce(p_product->>'sku_key', p_product->>'skuKey', v_sku));
  v_product_type := lower(coalesce(nullif(p_product->>'product_type', ''), nullif(p_product->>'productType', ''), 'sellable'));
  v_sale_type := lower(coalesce(nullif(p_product->>'sale_type', ''), nullif(p_product->>'saleType', ''), 'unit'));
  v_expiration_mode := upper(coalesce(nullif(p_product->>'expiration_mode', ''), nullif(p_product->>'expirationMode', ''), 'NONE'));
  if v_product_type not in ('sellable','ingredient') then raise exception 'INVALID_PRODUCT_TYPE' using errcode = 'P0001'; end if;
  if v_sale_type not in ('unit','bulk') then raise exception 'INVALID_SALE_TYPE' using errcode = 'P0001'; end if;
  if v_expiration_mode not in ('STRICT','SHELF_LIFE','NONE') then raise exception 'INVALID_EXPIRATION_MODE' using errcode = 'P0001'; end if;

  v_shelf_life_value := nullif(coalesce(p_product->>'shelf_life_value', p_product->>'shelfLifeValue', ''), '')::numeric;
  v_shelf_life_unit := nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', '')), '');
  v_price := greatest(coalesce(nullif(p_product->>'price', '')::numeric, 0), 0);
  v_cost := greatest(coalesce(nullif(p_product->>'cost', '')::numeric, 0), 0);
  v_stock := greatest(coalesce(nullif(p_product->>'stock', '')::numeric, 0), 0);
  v_committed_stock := greatest(coalesce(nullif(p_product->>'committed_stock', '')::numeric, nullif(p_product->>'committedStock', '')::numeric, 0), 0);

  if jsonb_typeof(p_product->'search_tokens') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_tokens')) into v_search_tokens;
  else
    v_search_tokens := null;
  end if;
  if jsonb_typeof(p_product->'search_ngrams') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_ngrams')) into v_search_ngrams;
  else
    v_search_ngrams := null;
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.upsert', 'product', v_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = v_product_id for update;
  v_is_create := v_existing.id is null;

  if v_is_create
    and v_stock > 0
    and v_has_initial_batches is not true
    and (
      v_expiration_mode in ('STRICT','SHELF_LIFE')
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'boolean'
        and coalesce(p_product->'batch_management', p_product->'batchManagement') = 'true'::jsonb
      )
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'object'
        and (
          lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'enabled', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'batchManagement', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'manageBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'useBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'mode', '')) in ('batch','batches','lote','lotes','fefo')
        )
      )
    )
  then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INITIAL_BATCH_REQUIRED_FOR_EXPIRING_PRODUCT',
      'message', 'No se puede guardar stock inicial sin lote para productos con caducidad. Crea un lote inicial o guarda el producto sin stock.',
      'field', 'initialBatches',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if not v_is_create then
    if v_existing.deleted_at is not null then
      v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_DELETED', 'message', 'El producto ya fue eliminado.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
      values (v_license_id, 'product', v_product_id, 'VERSION_CONFLICT', p_product, private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if v_expiration_mode = 'SHELF_LIFE'
    and v_has_initial_batches
    and coalesce(v_shelf_life_value, v_existing.shelf_life_value, 0) <= 0
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_initial_batches, '[]'::jsonb)) as pre_batch(value)
      where greatest(coalesce(nullif(pre_batch.value->>'stock', '')::numeric, 0), 0) > 0
        and nullif(pre_batch.value->>'expiry_date', '') is null
        and nullif(pre_batch.value->>'expiryDate', '') is null
        and nullif(pre_batch.value->>'alert_target_date', '') is null
        and nullif(pre_batch.value->>'alertTargetDate', '') is null
    )
  then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'SHELF_LIFE_VALUE_REQUIRED',
      'message', 'Indica una vida util valida para crear inventario con caducidad estimada.',
      'field', 'shelfLifeValue',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_barcode_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.barcode_key = v_barcode_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BARCODE', 'message', 'El codigo de barras ya esta registrado en otro producto.', 'field', 'barcode', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_sku_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.sku_key = v_sku_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_SKU', 'message', 'El SKU ya esta registrado en otro producto.', 'field', 'sku', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_products (
      id, license_id, category_id, name, name_key, description, barcode, barcode_key, sku, sku_key,
      image_ref, image_url, location, price, cost, stock, committed_stock, min_stock, max_stock,
      track_stock, is_active, product_type, sale_type, bulk_data, conversion_factor, batch_management,
      recipe, modifiers, wholesale_tiers, prescription_type, active_substance, laboratory,
      requires_prescription, presentation, expiration_mode, shelf_life_value, shelf_life_unit,
      search_tokens, search_ngrams, low_stock_alert_status, active_stock_status,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_product_id, v_license_id, v_category_id, v_name, v_name_key,
      nullif(btrim(coalesce(p_product->>'description', '')), ''), v_barcode, v_barcode_key, v_sku, v_sku_key,
      nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', '')), ''),
      nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', '')), ''),
      nullif(btrim(coalesce(p_product->>'location', '')), ''),
      v_price, v_cost,
      case when v_has_initial_batches then 0 else v_stock end,
      case when v_has_initial_batches then 0 else v_committed_stock end,
      nullif(p_product->>'min_stock', '')::numeric,
      nullif(p_product->>'max_stock', '')::numeric,
      coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, true),
      coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true),
      v_product_type, v_sale_type, p_product->'bulk_data', p_product->'conversion_factor', p_product->'batch_management',
      p_product->'recipe', p_product->'modifiers', p_product->'wholesale_tiers',
      nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', '')), ''),
      nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', '')), ''),
      nullif(btrim(coalesce(p_product->>'laboratory', '')), ''),
      coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, null),
      nullif(btrim(coalesce(p_product->>'presentation', '')), ''),
      v_expiration_mode,
      v_shelf_life_value,
      v_shelf_life_unit,
      v_search_tokens, v_search_ngrams,
      nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', '')), ''),
      case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true) and (case when v_has_initial_batches then 0 else v_stock end) > 0 then 1 else 0 end,
      coalesce(nullif(p_product->>'created_at', '')::timestamptz, nullif(p_product->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'images_cloud', false)
    ) returning * into v_saved;
  else
    update public.pos_products
    set category_id = v_category_id,
        name = v_name,
        name_key = v_name_key,
        description = nullif(btrim(coalesce(p_product->>'description', description, '')), ''),
        barcode = v_barcode,
        barcode_key = v_barcode_key,
        sku = v_sku,
        sku_key = v_sku_key,
        image_ref = nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', image_ref, '')), ''),
        image_url = nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', image_url, '')), ''),
        location = nullif(btrim(coalesce(p_product->>'location', location, '')), ''),
        price = v_price,
        cost = v_cost,
        min_stock = coalesce(nullif(p_product->>'min_stock', '')::numeric, nullif(p_product->>'minStock', '')::numeric, min_stock),
        max_stock = coalesce(nullif(p_product->>'max_stock', '')::numeric, nullif(p_product->>'maxStock', '')::numeric, max_stock),
        track_stock = coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, track_stock),
        is_active = coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active),
        product_type = v_product_type,
        sale_type = v_sale_type,
        bulk_data = coalesce(p_product->'bulk_data', bulk_data),
        conversion_factor = coalesce(p_product->'conversion_factor', conversion_factor),
        batch_management = coalesce(p_product->'batch_management', batch_management),
        recipe = coalesce(p_product->'recipe', recipe),
        modifiers = coalesce(p_product->'modifiers', modifiers),
        wholesale_tiers = coalesce(p_product->'wholesale_tiers', wholesale_tiers),
        prescription_type = nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', prescription_type, '')), ''),
        active_substance = nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', active_substance, '')), ''),
        laboratory = nullif(btrim(coalesce(p_product->>'laboratory', laboratory, '')), ''),
        requires_prescription = coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, requires_prescription),
        presentation = nullif(btrim(coalesce(p_product->>'presentation', presentation, '')), ''),
        expiration_mode = v_expiration_mode,
        shelf_life_value = coalesce(v_shelf_life_value, shelf_life_value),
        shelf_life_unit = nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', shelf_life_unit, '')), ''),
        search_tokens = coalesce(v_search_tokens, search_tokens),
        search_ngrams = coalesce(v_search_ngrams, search_ngrams),
        low_stock_alert_status = nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', low_stock_alert_status, '')), ''),
        active_stock_status = case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active) and stock > 0 and deleted_at is null then 1 else 0 end,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'stock_not_mutated_by_catalog_edit', true)
    where license_id = v_license_id and id = v_product_id
    returning * into v_saved;
  end if;

  for v_batch_item in select value from jsonb_array_elements(coalesce(p_initial_batches, '[]'::jsonb)) loop
    v_batch_id := nullif(btrim(coalesce(v_batch_item->>'id', '')), '');
    if v_batch_id is null then
      v_batch_id := 'batch-' || gen_random_uuid()::text;
    end if;

    if exists (select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.id = v_batch_id) then
      v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BATCH_ID', 'message', 'El lote inicial ya existe y no se sobreescribira desde catalogo.', 'field', 'batch.id', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if nullif(btrim(coalesce(v_batch_item->>'product_id', v_batch_item->>'productId', v_product_id)), '') <> v_product_id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'Un lote inicial no pertenece al producto.', 'field', 'productId', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    v_batch_stock := greatest(coalesce(nullif(v_batch_item->>'stock', '')::numeric, 0), 0);
    v_batch_created_at := coalesce(nullif(v_batch_item->>'created_at', '')::timestamptz, nullif(v_batch_item->>'createdAt', '')::timestamptz, now());
    v_batch_expiry_date := coalesce(nullif(v_batch_item->>'expiry_date', '')::timestamptz, nullif(v_batch_item->>'expiryDate', '')::timestamptz, null);
    v_batch_alert_target_date := coalesce(nullif(v_batch_item->>'alert_target_date', '')::timestamptz, nullif(v_batch_item->>'alertTargetDate', '')::timestamptz, v_batch_expiry_date);
    v_batch_alert_type := nullif(btrim(coalesce(v_batch_item->>'alert_type', v_batch_item->>'alertType', '')), '');

    if v_expiration_mode = 'STRICT' and v_batch_stock > 0 and v_batch_expiry_date is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'El modo estricto requiere caducidad para lotes con stock.', 'field', 'expiryDate', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if v_expiration_mode = 'SHELF_LIFE' and v_batch_stock > 0 then
      if v_batch_expiry_date is null and v_batch_alert_target_date is null then
        v_batch_expiry_date := private.calculate_pos_shelf_life_target(v_batch_created_at, v_saved.shelf_life_value, v_saved.shelf_life_unit);
        if v_batch_expiry_date is null then
          v_response := jsonb_build_object(
            'success', false,
            'code', 'SHELF_LIFE_VALUE_REQUIRED',
            'message', 'Indica una vida util valida para crear inventario con caducidad estimada.',
            'field', 'shelfLifeValue',
            'idempotency_key', p_idempotency_key
          );
          perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
          return v_response;
        end if;
        v_batch_alert_target_date := v_batch_expiry_date;
        v_batch_alert_type := 'VIDA_UTIL_ESTIMADA';
      else
        v_batch_expiry_date := coalesce(v_batch_expiry_date, v_batch_alert_target_date);
        v_batch_alert_target_date := coalesce(v_batch_alert_target_date, v_batch_expiry_date);
      end if;
    end if;

    v_batch_cost := greatest(coalesce(nullif(v_batch_item->>'cost', '')::numeric, v_cost, 0), 0);
    v_batch_price := greatest(coalesce(nullif(v_batch_item->>'price', '')::numeric, v_price, 0), 0);
    v_batch_sku := nullif(btrim(coalesce(v_batch_item->>'sku', '')), '');
    v_batch_sku_key := private.normalize_pos_sku_key(coalesce(v_batch_item->>'sku_key', v_batch_item->>'skuKey', v_batch_sku));
    v_batch_status := lower(coalesce(nullif(v_batch_item->>'status', ''), 'active'));
    if v_batch_status not in ('active','inactive','archived') then v_batch_status := 'active'; end if;

    insert into public.pos_product_batches (
      id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price, track_stock,
      is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type,
      manufacturer_batch_id, supplier, attributes, location, notes, update_global_price,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_batch_id, v_license_id, v_product_id, v_batch_sku, v_batch_sku_key, v_batch_stock,
      greatest(coalesce(nullif(v_batch_item->>'committed_stock', '')::numeric, nullif(v_batch_item->>'committedStock', '')::numeric, 0), 0),
      v_batch_cost, v_batch_price,
      coalesce(nullif(v_batch_item->>'track_stock', '')::boolean, nullif(v_batch_item->>'trackStock', '')::boolean, true),
      coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true),
      v_batch_status,
      case when coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true) and v_batch_status = 'active' and v_batch_stock > 0 then 1 else 0 end,
      v_batch_expiry_date,
      v_batch_alert_target_date,
      v_batch_alert_type,
      nullif(btrim(coalesce(v_batch_item->>'manufacturer_batch_id', v_batch_item->>'manufacturerBatchId', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'supplier', '')), ''),
      v_batch_item->'attributes',
      nullif(btrim(coalesce(v_batch_item->>'location', p_product->>'location', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'notes', 'Stock inicial')), ''),
      coalesce(nullif(v_batch_item->>'update_global_price', '')::boolean, nullif(v_batch_item->>'updateGlobalPrice', '')::boolean, false),
      v_batch_created_at,
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(v_batch_item->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'source', 'initial_batch')
    ) returning * into v_saved_batch;

    v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product.initial_batches', 'product_id', v_product_id), v_saved_batch.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
    v_batches := v_batches || jsonb_build_array(private.pos_product_batch_to_jsonb(v_saved_batch));
  end loop;

  if v_has_initial_batches then
    v_saved := private.recalculate_pos_product_projection(v_license_id, v_product_id);
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product', 'initial_batches_count', jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb))), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'batches', v_batches, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_PRODUCT_KEY', 'message', 'Codigo de barras o SKU duplicado.', 'idempotency_key', p_idempotency_key);
    if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
    return v_response;
end;
$function$;

do $$
declare
  v_row record;
  v_product public.pos_products;
begin
  for v_row in
    update public.pos_product_batches b
    set
      expiry_date = private.calculate_pos_shelf_life_target(
        coalesce(b.created_at, p.created_at, now()),
        p.shelf_life_value,
        p.shelf_life_unit
      ),
      alert_target_date = private.calculate_pos_shelf_life_target(
        coalesce(b.created_at, p.created_at, now()),
        p.shelf_life_value,
        p.shelf_life_unit
      ),
      alert_type = coalesce(b.alert_type, 'VIDA_UTIL_ESTIMADA'),
      updated_at = now(),
      server_version = b.server_version + 1,
      metadata = coalesce(b.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'cad6_2_repaired_missing_shelf_life_date', true,
          'cad6_2_repaired_at', now()
        )
    from public.pos_products p
    where b.license_id = p.license_id
      and b.product_id = p.id
      and p.expiration_mode = 'SHELF_LIFE'
      and p.shelf_life_value > 0
      and b.deleted_at is null
      and b.is_active is true
      and b.status = 'active'
      and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
      and b.expiry_date is null
      and b.alert_target_date is null
      and private.calculate_pos_shelf_life_target(coalesce(b.created_at, p.created_at, now()), p.shelf_life_value, p.shelf_life_unit) is not null
    returning b.license_id, b.product_id, b.id, b.server_version
  loop
    perform private.record_pos_sync_event(
      v_row.license_id,
      'product_batch',
      v_row.id,
      'update',
      null,
      null,
      null,
      jsonb_build_object('source', 'fase_cad_6_2_repair', 'product_id', v_row.product_id),
      v_row.server_version
    );

    v_product := private.recalculate_pos_product_projection(v_row.license_id, v_row.product_id);

    perform private.record_pos_sync_event(
      v_row.license_id,
      'product',
      v_row.product_id,
      'update',
      null,
      null,
      null,
      jsonb_build_object('source', 'fase_cad_6_2_repair', 'repaired_batch_id', v_row.id),
      v_product.server_version
    );
  end loop;
end $$;
