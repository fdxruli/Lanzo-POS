-- LANZO POS / PRODUCCIÓN / CREACIÓN MANUAL FREE SIN DISPOSITIVO.
-- NO ES MIGRACIÓN. MODIFICA DATOS REALES. Ejecutar SOLO en SQL Editor con rol postgres.
-- Verificar primero 00_PRECHECK_SOLO_LECTURA.sql y el proyecto correcto.
-- CAMBIAR folio, nombre, rubro y contacto. El folio aparece DOS veces: variable y SELECT final.
-- NO usar este script para PRO. No incluir huella ficticia, token ni administrador.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $lanzo_manual_free$
DECLARE
  v_folio text := 'MANUAL-2026-0001';          -- CAMBIAR: identificador único del encargo
  v_business_name text := 'Abarrotes Ejemplo'; -- CAMBIAR: nombre exacto del negocio
  v_category public.business_category := 'abarrotes'; -- CAMBIAR: rubro permitido
  v_contact_email text := NULL;               -- OPCIONAL: email del contacto (con su consentimiento)
  v_phone text := NULL;                       -- OPCIONAL: teléfono del negocio
  v_plan public.plans%ROWTYPE;
  v_license_id uuid;
  v_period_id uuid;
  v_payload text;
  v_key text;
  v_now timestamptz := now();
  v_free_features jsonb := jsonb_build_object(
    'full_access', true,
    'max_rubros', 1,
    'allowed_rubros', jsonb_build_array('*'),
    'realtime_license_sync', false,
    'staff_roles', false,
    'cloud_pos_sync', false,
    'cloud_cash_sync', false,
    'cloud_products_sync', false,
    'cloud_reports_sync', false,
    'restaurant_orders_cloud', false,
    'ai_agents', false
  );
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'LANZO_OPERADOR_NO_AUTORIZADO';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261107152500'
  ) OR to_regprocedure('private.issue_license_onboarding_invitation(text)') IS NULL THEN
    RAISE EXCEPTION 'LANZO_ONBOARDING_NO_INSTALADO';
  END IF;
  IF char_length(btrim(v_folio)) < 8 OR char_length(btrim(v_folio)) > 100
     OR char_length(btrim(v_business_name)) < 3 OR char_length(btrim(v_business_name)) > 200 THEN
    RAISE EXCEPTION 'LANZO_FOLIO_O_NOMBRE_INVALIDO';
  END IF;

  -- Serializar la ejecución del mismo folio y evitar altas duplicadas por reintentos.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lanzo-manual-free:' || v_folio, 0));
  IF EXISTS (
    SELECT 1 FROM public.license_periods
    WHERE metadata->>'manual_issue_ref' = v_folio
  ) THEN
    RAISE EXCEPTION 'LANZO_FOLIO_YA_EMITIDO: consultar script 05';
  END IF;

  SELECT * INTO v_plan FROM public.plans
   WHERE code = 'free_trial' AND is_active IS TRUE FOR SHARE;
  IF v_plan.id IS NULL OR v_plan.max_devices IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'LANZO_PLAN_FREE_NO_COINCIDE';
  END IF;

  -- Formato de la creación Free instalada (8 bytes CSPRNG: 4x4 hex).
  -- Colisión: el índice UNIQUE aborta la transacción; no inventar nueva clave manual.
  v_payload := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  v_key := 'LANZO-' || substr(v_payload,1,4) || '-' || substr(v_payload,5,4)
                   || '-' || substr(v_payload,9,4) || '-' || substr(v_payload,13,4);

  INSERT INTO public.licenses (
    license_key, plan_id, license_type, max_devices,
    duration_months, status, expires_at, is_lifetime,
    product_name, organization_name, owner_email, features
  ) VALUES (
    v_key, v_plan.id, 'free', 1,
    NULL, 'active', NULL, true,
    'Lanzo POS Free', v_business_name, v_contact_email, v_free_features
  ) RETURNING id INTO v_license_id;

  -- 'trial' es el valor técnico histórico para Free vitalicio; NO supone caducidad.
  INSERT INTO public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) VALUES (
    v_license_id, v_plan.id, v_plan.code, v_plan.name,
    'trial', 'active', v_now, NULL, 0,
    jsonb_build_object(
      'source', 'manual_admin_sql_provisioning_v1',
      'manual_issue_ref', v_folio,
      'license_kind', 'free_lifetime',
      'license_type', 'free',
      'is_lifetime', true,
      'expires_at', null,
      'identity_version', 'LANZO.IDENTITY.1'
    )
  ) RETURNING id INTO v_period_id;

  INSERT INTO public.business_profiles (
    license_id, business_name, phone_number, business_type
  ) VALUES (
    v_license_id, v_business_name, v_phone, ARRAY[v_category]
  );

  -- Auditoría sin códigos, contraseñas, huellas ni tokens.
  INSERT INTO public.license_events (license_key, event_type, metadata)
  VALUES
    (v_key, 'FREE_LICENSE_CREATED', jsonb_build_object(
      'source', 'manual_admin_sql_provisioning_v1',
      'manual_issue_ref', v_folio,
      'period_id', v_period_id,
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'created_at', v_now
    )),
    (v_key, 'PERIOD_CREATED', jsonb_build_object(
      'source', 'manual_admin_sql_provisioning_v1',
      'manual_issue_ref', v_folio,
      'period_id', v_period_id,
      'starts_at', v_now,
      'ends_at', null,
      'license_kind', 'free_lifetime',
      'is_lifetime', true
    ));

  -- Cierre: se invalida TODA la transacción si falta un componente.
  PERFORM 1 FROM private.license_entitlement_state_v1(v_license_id)
   WHERE is_entitled IS TRUE AND plan_code = 'free_trial';
  IF NOT FOUND THEN RAISE EXCEPTION 'LANZO_ENTITLEMENT_FREE_INVALIDO'; END IF;
  IF (SELECT count(*) FROM public.license_periods WHERE license_id=v_license_id AND status='active') <> 1
     OR (SELECT count(*) FROM public.business_profiles WHERE license_id=v_license_id) <> 1
     OR (SELECT count(*) FROM public.license_admin_users WHERE license_id=v_license_id) <> 0
     OR (SELECT count(*) FROM public.license_devices WHERE license_id=v_license_id) <> 0 THEN
    RAISE EXCEPTION 'LANZO_INVARIANTE_PROVISIONING_INVALIDA';
  END IF;
END
$lanzo_manual_free$;

COMMIT;

-- RESULTADO FINAL (CAMBIAR EL MISMO FOLIO). Si no devuelve una sola fila, NO entregar nada.
SELECT l.license_key AS licencia_para_cliente,
       l.id AS licencia_id_interno,
       bp.business_name,
       p.code AS plan_interno,
       l.max_devices,
       l.is_lifetime,
       lp.status AS periodo,
       lp.metadata->>'manual_issue_ref' AS folio
FROM public.license_periods lp
JOIN public.licenses l ON l.id=lp.license_id
JOIN public.plans p ON p.id=l.plan_id
JOIN public.business_profiles bp ON bp.license_id=l.id
WHERE lp.metadata->>'manual_issue_ref' = 'MANUAL-2026-0001' -- CAMBIAR EL MISMO FOLIO
  AND lp.metadata->>'source' = 'manual_admin_sql_provisioning_v1';
