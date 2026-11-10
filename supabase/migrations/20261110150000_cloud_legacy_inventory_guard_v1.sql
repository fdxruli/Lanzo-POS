-- LANZO POS P1 / guarda legacy 6B: no se aplica en esta entrega.
-- Estado base: Supabase Production 2026-11-10, checksums exactos de funciones instaladas.
do $preflight$
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)'::pg_catalog.regprocedure))
      <> '839a06872bd5041317526e80ea0723e6'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef('public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'::pg_catalog.regprocedure))
      <> '2bc363f5395e296033e60bfad69c2199' then
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
    v_product_id := pg_catalog.nullif(pg_catalog.btrim(v_norm->>'product_id'), '');
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
  -- Rechazo servidor antes de ejecutar la hoja 6B sin inventario.
  -- v_authorized.items son items canonizados por R2B contra el catálogo del tenant.
  if v_operation = 'sale.cashier' then
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
