-- LANZO POS P1 / guarda legacy 6B: no se aplica en esta entrega.
-- Estado base: Supabase Production 2026-11-10, checksums exactos de funciones instaladas.
do $preflight$
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)'::pg_catalog.regprocedure))
      <> '839a06872bd5041317526e80ea0723e6'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'::pg_catalog.regprocedure))
      <> '2bc363f5395e296033e60bfad69c2199'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)'::pg_catalog.regprocedure))
      <> 'eb42c825c1e43b2c00ba53c74c899ae7' then
    raise exception 'CLOUD_LEGACY_GUARD_DEPENDENCY_DRIFT: revisar wrappers antes de instalar'
      using errcode='P0001';
  end if;
  if pg_catalog.to_regprocedure('private.rest_inv5_build_sale_inventory_requirements(text,jsonb,public.pos_products)') is null
     or pg_catalog.to_regprocedure('private.normalize_sale_inventory_item(jsonb,bigint)') is null then
    raise exception 'CLOUD_LEGACY_GUARD_MISSING_DEPENDENCY' using errcode='P0001';
  end if;
end;
$preflight$;

-- Guard de sólo lectura para items canónicos ya autorizados por R2B.
-- No se decide por flags del cliente; falla cerrado si no se puede determinar.
create or replace function private.assert_legacy_cloud_sale_no_inventory_required_v1(
  p_license_id uuid, p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path to ''
as $guard$
declare
  v_item record;
  v_norm jsonb;
  v_product public.pos_products;
  v_product_id text;
  v_requirements jsonb;
begin
  if p_license_id is null
     or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED: Actualiza LANZO POS para vender con inventario Cloud.'
      using errcode='P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from pg_catalog.jsonb_array_elements(p_items) with ordinality
  loop
    v_norm := private.normalize_sale_inventory_item(v_item.payload, v_item.ordinality);
    v_product_id := NULLIF(pg_catalog.btrim(v_norm->>'product_id'), '');
    if v_product_id is null then
      raise exception 'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED: Producto sin identidad Cloud verificable.'
        using errcode='P0001';
    end if;

    select * into v_product
    from public.pos_products p
    where p.license_id = p_license_id and p.id = v_product_id
    for share;

    if v_product.id is null or v_product.deleted_at is not null
       or v_product.is_active is not true then
      raise exception 'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED: Producto Cloud no disponible.'
        using errcode='P0001';
    end if;

    -- El control de stock, recetas y lotes procede exclusivamente de tablas Cloud.
    -- Una receta malformada tampoco constituye prueba de inventario no requerido.
    if v_product.track_stock is true
       or (v_product.recipe is not null and v_product.recipe <> '[]'::jsonb)
       or exists (
          select 1 from public.pos_product_batches b
          where b.license_id = p_license_id and b.product_id = v_product_id
            and b.deleted_at is null and b.is_active is true
            and b.track_stock is true
       ) then
      raise exception 'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED: Actualiza LANZO POS para vender con inventario Cloud.'
        using errcode='P0001';
    end if;

    -- Los modificadores canónicos vienen del catálogo del servidor vía R2B.
    v_requirements := private.rest_inv5_build_sale_inventory_requirements(
      'legacy_preflight', v_norm, v_product
    );
    if pg_catalog.jsonb_typeof(v_requirements) is distinct from 'array'
       or pg_catalog.jsonb_array_length(v_requirements) > 0 then
      raise exception 'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED: Actualiza LANZO POS para vender con inventario Cloud.'
        using errcode='P0001';
    end if;
  end loop;
end;
$guard$;

revoke all on function private.assert_legacy_cloud_sale_no_inventory_required_v1(uuid,jsonb)
  from public, anon, authenticated, service_role;

-- Se preservan firmas, SECURITY DEFINER, search_path, límites y ACL de wrappers.
CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_authorized jsonb;
  v_response jsonb;
  v_operation text := 'sale.cashier';
  v_trusted_6c_scope jsonb;
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) = 'object'
     and coalesce((p_sale->'metadata'->>'cloudInventoryEffects')::boolean, false) then
    v_operation := 'sale.cashier_inventory';
  end if;
  
-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before R2B reservation.
  perform private.assert_cash_sale_station_for_request_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_cash_session_id
  );
  v_authorized := private.r2b_authorize_sale_financial_request_v1(
    v_operation, p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_sale, p_items, p_payments,
    p_cash_session_id, null, p_idempotency_key
  );
  if v_authorized ? 'idempotent_response' then return v_authorized->'idempotent_response'; end if;
  if coalesce((v_authorized->>'idempotency_processing')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_authorized->>'idempotency_key');
  end if;
  -- 6B siempre verifica stock, incluso si el cliente declara
  -- cloudInventoryEffects=true. La unica excepcion es la llamada 6C
  -- verificada dentro de ESTA misma transaccion que aplicara inventario.
  -- Esta marca se crea solo en la hoja 6C, nunca desde p_sale/metadata.
  v_trusted_6c_scope := NULLIF(
    pg_catalog.current_setting('lanzo.inventory_6c_core_scope_v1', true), ''
  )::jsonb;
  if v_trusted_6c_scope is null
     or v_trusted_6c_scope->>'license_id' is distinct from v_authorized->>'license_id'
     or v_trusted_6c_scope->>'sale_id' is distinct from v_authorized->'sale'->>'id'
     or v_trusted_6c_scope->>'idempotency_key' is distinct from v_authorized->>'idempotency_key'
  then
    perform private.assert_legacy_cloud_sale_no_inventory_required_v1(
      (v_authorized->>'license_id')::uuid, v_authorized->'items'
    );
  end if;
  v_response := public.pos_create_cloud_sale_cashier_legacy_r2b(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_authorized->'sale', v_authorized->'items', v_authorized->'payments',
    p_cash_session_id, v_authorized->>'idempotency_key'
  );
  if coalesce((v_response->>'success')::boolean, false)
     and v_operation = 'sale.cashier_inventory' then
    perform private.r2b_finalize_inventory_costs_v1(
      (v_authorized->>'license_id')::uuid,
      v_authorized->'sale'->>'id'
    );
  end if;
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_credit_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_authorized jsonb;
  v_response jsonb;
begin
  
-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before R2B reservation.
  perform private.assert_cash_sale_station_for_request_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_cash_session_id
  );
  v_authorized := private.r2b_authorize_sale_financial_request_v1(
    'sale.credit', p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_sale, p_items, p_payments,
    p_cash_session_id, p_customer_id, p_idempotency_key
  );
  if v_authorized ? 'idempotent_response' then return v_authorized->'idempotent_response'; end if;
  if coalesce((v_authorized->>'idempotency_processing')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La venta fiada ya esta en proceso. Evita cobrarla dos veces.', 'idempotency_key', v_authorized->>'idempotency_key');
  end if;
  -- Si la licencia carece de inventario Cloud, sólo admite items sin obligación real.
  -- La autorización R2B ya resolvió la licencia y los productos canónicos.
  if not (
    coalesce((private.validate_pos_sync_context(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
    )->'features'->>'cloud_sales_inventory')::boolean, false)
    and
    coalesce((private.validate_pos_sync_context(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
    )->'features'->>'cloud_products_sync')::boolean, false)
  ) then
    perform private.assert_legacy_cloud_sale_no_inventory_required_v1(
      (v_authorized->>'license_id')::uuid, v_authorized->'items'
    );
  end if;
  v_response := public.pos_create_cloud_sale_credit_legacy_r2b(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_authorized->'sale', v_authorized->'items', v_authorized->'payments',
    p_cash_session_id, v_authorized->>'customer_id', v_authorized->>'idempotency_key'
  );
  -- Defensa adicional ante cambio concurrente de capacidades: ningún éxito
  -- con inventario omitido puede sobrevivir al COMMIT para productos controlados.
  if coalesce((v_response->>'success')::boolean, false)
     and coalesce(v_response->'sale'->>'inventory_effect_status', 'not_applied') <> 'applied' then
    perform private.assert_legacy_cloud_sale_no_inventory_required_v1(
      (v_authorized->>'license_id')::uuid, v_authorized->'items'
    );
  end if;
  if coalesce((v_response->>'success')::boolean, false) then
    perform private.r2b_finalize_inventory_costs_v1(
      (v_authorized->>'license_id')::uuid,
      v_authorized->'sale'->>'id'
    );
  end if;
  return v_response;
end;
$function$;

-- Cambio focal adicional: delimitar el único tramo interno 6C que reutiliza 6B.
CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_core_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;
  v_sale_payload jsonb;
  v_preflight jsonb;
  v_core_response jsonb;
  v_apply_response jsonb;
  v_sale public.pos_sales;
  v_cash_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_items_response jsonb := '[]'::jsonb;
  v_payments_response jsonb := '[]'::jsonb;
  v_inventory_movements_response jsonb := '[]'::jsonb;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_latest_change_seq bigint;
  v_effects_status text;
  v_saved_6c_scope text;
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_inventory_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  -- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: preflight before idempotency/effects.
  if nullif(btrim(p_cash_session_id), '') is not null then
    perform private.assert_cash_session_station(v_license_id, v_device_id, p_cash_session_id);
  end if;
  

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(p_sale, array['id','cloud_sale_id','cloudSaleId']),
    'sale_' || replace(gen_random_uuid()::text, '-', '')
  );
  v_local_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['local_sale_id','localSaleId']), v_sale_id);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.cloud_commit.inventory:' || v_local_sale_id || ':' || v_device_id::text);
  v_core_idempotency_key := v_idempotency_key || ':cashier_core';

  select * into v_idem
  from public.pos_idempotency_keys
  where license_id = v_license_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if v_idem.status = 'completed' and v_idem.response_payload is not null then
    return v_idem.response_payload;
  elsif v_idem.status = 'processing' then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'sales.cloud_commit.inventory',
    'sale',
    v_sale_id,
    md5(coalesce(p_sale::text, '') || coalesce(p_items::text, '') || coalesce(p_payments::text, '') || coalesce(p_cash_session_id, ''))
  );

  if not v_inserted_idem then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  v_sale_payload := coalesce(p_sale, '{}'::jsonb)
    || jsonb_build_object(
      'id', v_sale_id,
      'local_sale_id', v_local_sale_id,
      'metadata', coalesce(p_sale->'metadata', '{}'::jsonb) || jsonb_build_object(
        'phase', 'fase6c_cloud_sales_inventory',
        'cloudInventoryEffects', true,
        'noCloudInventoryEffects', false,
        'noCloudCreditEffects', true
      )
    );

  v_preflight := private.resolve_sale_inventory_allocations(v_license_id, p_items, v_sale_id);

  if coalesce((v_preflight->>'ok')::boolean, false) is not true then
    delete from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key;

    return v_preflight;
  end if;

  perform private.assert_restaurant_sale_dispatcher_context_v1(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_sale_payload, p_cash_session_id, v_idempotency_key, 'sale.cashier_inventory'
  );
  v_core_response := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'pos_create_cloud_sale_cashier',
    p_scope := 'POS_WRITE',
    p_max_attempts := 60,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'RPC_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );
  if coalesce((v_core_response->>'allowed')::boolean, false) is false then
    v_core_response := public.build_pos_rpc_rate_limited_response(v_core_response);
  else
    perform private.assert_cash_sale_station_for_request_v1(
      p_license_key, p_device_fingerprint, p_security_token,
      p_staff_session_token, p_cash_session_id
    );
    -- La hoja 6C ya autorizo la licencia e hizo preflight de inventario.
    -- La llamada a 6B es un paso interno del commit atomico, no una ruta
    -- legacy para consumidores externos. Restaurar siempre la marca.
    v_saved_6c_scope := pg_catalog.current_setting('lanzo.inventory_6c_core_scope_v1', true);
    perform pg_catalog.set_config(
      'lanzo.inventory_6c_core_scope_v1',
      pg_catalog.jsonb_build_object(
        'license_id', v_license_id,
        'sale_id', v_sale_id,
        'idempotency_key', v_core_idempotency_key
      )::text, true
    );
    v_core_response := public.pos_create_cloud_sale_cashier_unlimited(
      p_license_key,
      p_device_fingerprint,
      p_security_token,
      p_staff_session_token,
      v_sale_payload,
      p_items,
      p_payments,
      p_cash_session_id,
      v_core_idempotency_key
    );
    perform pg_catalog.set_config(
      'lanzo.inventory_6c_core_scope_v1', coalesce(v_saved_6c_scope, ''), true
    );
  end if;

  if coalesce((v_core_response->>'success')::boolean, false) is not true then
    delete from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key;

    return v_core_response;
  end if;

  v_apply_response := private.apply_sale_inventory_effects(
    v_license_id,
    v_sale_id,
    coalesce(v_preflight->'allocations', '[]'::jsonb),
    v_device_id,
    v_staff_user_id,
    v_actor_key,
    v_actor_name,
    v_idempotency_key
  );

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = v_sale_id
  for update;

  if v_sale.id is null then
    raise exception 'CLOUD_SALE_NOT_FOUND_AFTER_CORE_COMMIT' using errcode = 'P0001';
  end if;

  v_effects_status := case
    when coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied'
      and coalesce(v_sale.cash_effect_status, '') = 'applied' then 'cash_inventory_applied'
    when coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied' then 'inventory_applied'
    else coalesce(v_sale.effects_status, 'payment_recorded')
  end;

  update public.pos_sales
  set effects_status = v_effects_status,
      inventory_effect_status = coalesce(v_apply_response->>'inventory_effect_status', 'not_required'),
      credit_effect_status = 'not_applied',
      idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'phase', 'fase6c_cloud_sales_inventory',
          'cloudInventoryEffects', true,
          'noCloudInventoryEffects', false,
          'noCloudCreditEffects', true,
          'inventoryEffectStatus', coalesce(v_apply_response->>'inventory_effect_status', 'not_required'),
          'inventoryMovementCount', jsonb_array_length(coalesce(v_apply_response->'inventory_movements', '[]'::jsonb)),
          'core_idempotency_key', v_core_idempotency_key
        ),
      updated_at = now(),
      server_version = server_version + 1
  where license_id = v_license_id
    and id = v_sale_id
  returning * into v_sale;

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_sale.id,
    'sale.inventory_cloud_committed',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale.cloud_folio,
      'inventory_effect_status', v_sale.inventory_effect_status,
      'effects_status', v_sale.effects_status,
      'idempotency_key', v_idempotency_key
    )
  );

  v_event := private.record_pos_sync_event(
    v_license_id,
    'sale',
    v_sale.id,
    'cloud_commit',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale.cloud_folio,
      'source_mode', 'cloud_committed',
      'effects_status', v_sale.effects_status,
      'inventory_effect_status', v_sale.inventory_effect_status,
      'cash_session_id', v_sale.cash_session_id,
      'cash_movement_id', v_sale.cash_movement_id
    ),
    v_sale.server_version::integer
  );

  perform private.record_pos_sync_event(
    v_license_id,
    'report',
    'overview',
    'update',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('reason', 'sale_cloud_inventory_committed', 'sale_id', v_sale.id),
    1
  );

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
  into v_items_response
  from public.pos_sale_items i
  where i.license_id = v_license_id and i.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
  into v_payments_response
  from public.pos_sale_payments p
  where p.license_id = v_license_id and p.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at asc, m.id asc), '[]'::jsonb)
  into v_inventory_movements_response
  from public.pos_inventory_movements m
  where m.license_id = v_license_id and m.sale_id = v_sale.id;

  if v_sale.cash_session_id is not null then
    select * into v_cash_session
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_sale.cash_session_id;
  end if;

  if v_sale.cash_movement_id is not null then
    select * into v_cash_movement
    from public.pos_cash_movements m
    where m.license_id = v_license_id and m.id = v_sale.cash_movement_id;
  end if;

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_items_response,
    'payments', v_payments_response,
    'inventory_movements', v_inventory_movements_response,
    'cash_session', case when v_cash_session.id is null then null else private.pos_cash_session_to_jsonb(v_cash_session) end,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key,
    'mode', 'cloud_cashier_inventory'
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  raise exception 'SALE_DUPLICATE_OR_FOLIO_CONFLICT' using errcode = 'P0001';
end;
$function$;
