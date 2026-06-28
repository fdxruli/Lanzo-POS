-- FASE 6H.7.3.1 — Validar contexto antes de consumir rate limit.
-- El objetivo es evitar que tokens inválidos consuman contadores de RPCs pesadas.
-- No toca operaciones críticas transaccionales ni modifica payloads de las RPCs _unlimited.

CREATE OR REPLACE FUNCTION public.validate_pos_rpc_rate_limit_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb := '{}'::jsonb;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_license_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'LICENSE_KEY_REQUIRED',
      'message', 'Licencia requerida.'
    );
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_device_fingerprint, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'DEVICE_FINGERPRINT_REQUIRED',
      'message', 'Dispositivo requerido.'
    );
  END IF;

  SELECT
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    COALESCE(p.code, l.license_type::text) AS plan_code,
    p.name AS plan_name,
    COALESCE(p.features, '{}'::jsonb) AS plan_features,
    COALESCE(l.features, '{}'::jsonb) AS license_features
  INTO v_license
  FROM public.licenses l
  LEFT JOIN public.plans p ON p.id = l.plan_id
  WHERE l.license_key = p_license_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'LICENSE_NOT_FOUND',
      'message', 'Licencia no encontrada.'
    );
  END IF;

  IF v_license.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'LICENSE_NOT_ACTIVE',
      'message', 'La licencia no está activa.'
    );
  END IF;

  IF v_license.expires_at IS NOT NULL AND v_license.expires_at < now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'LICENSE_EXPIRED',
      'message', 'La licencia expiró.'
    );
  END IF;

  SELECT
    d.id,
    d.license_id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    COALESCE(d.device_role, 'staff') AS device_role,
    d.staff_user_id,
    d.realtime_topic
  INTO v_device
  FROM public.license_devices d
  WHERE d.license_id = v_license.id
    AND d.device_fingerprint = p_device_fingerprint
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'DEVICE_NOT_ALLOWED',
      'message', 'Dispositivo no autorizado.'
    );
  END IF;

  IF v_device.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'DEVICE_NOT_ACTIVE',
      'message', 'Dispositivo inactivo.'
    );
  END IF;

  IF v_device.security_token IS NULL OR NULLIF(BTRIM(COALESCE(p_security_token, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'DEVICE_TOKEN_REQUIRED',
      'message', 'Token del dispositivo requerido.'
    );
  END IF;

  IF p_security_token <> v_device.security_token
     AND (v_device.previous_security_token IS NULL OR p_security_token <> v_device.previous_security_token) THEN
    RETURN jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', 'DEVICE_TOKEN_INVALID',
      'message', 'Token del dispositivo inválido.'
    );
  END IF;

  v_features := COALESCE(v_license.plan_features, '{}'::jsonb) || COALESCE(v_license.license_features, '{}'::jsonb);

  IF v_device.device_role = 'staff' THEN
    IF v_device.staff_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', 'STAFF_LOGIN_REQUIRED',
        'message', 'Inicio de sesión staff requerido.'
      );
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_staff_session_token, '')), '') IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', 'STAFF_SESSION_REQUIRED',
        'message', 'Sesión staff requerida.'
      );
    END IF;

    SELECT
      ss.id AS session_id,
      ss.expires_at,
      ss.revoked_at,
      s.id AS staff_user_id,
      s.username,
      s.display_name,
      s.role_name,
      COALESCE(s.permissions, '{}'::jsonb) AS permissions,
      s.is_active AS staff_is_active
    INTO v_session
    FROM public.license_staff_sessions ss
    JOIN public.license_staff_users s ON s.id = ss.staff_user_id
    WHERE ss.license_id = v_license.id
      AND ss.device_id = v_device.id
      AND ss.staff_user_id = v_device.staff_user_id
      AND ss.revoked_at IS NULL
      AND extensions.crypt(COALESCE(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', 'STAFF_SESSION_INVALID',
        'message', 'Sesión staff inválida.'
      );
    END IF;

    IF v_session.expires_at < now() THEN
      RETURN jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', 'STAFF_SESSION_EXPIRED',
        'message', 'Sesión staff expirada.'
      );
    END IF;

    IF v_session.staff_is_active IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', 'STAFF_USER_INACTIVE',
        'message', 'Usuario staff inactivo.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'allowed', true,
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_role', v_device.device_role,
    'staff_user_id', CASE WHEN v_device.device_role = 'staff' THEN v_session.staff_user_id ELSE NULL END,
    'staff_permissions', CASE WHEN v_device.device_role = 'staff' THEN COALESCE(v_session.permissions, '{}'::jsonb) ELSE '{}'::jsonb END,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', COALESCE(v_features, '{}'::jsonb),
    'realtime_topic', v_device.realtime_topic
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_pos_rpc_rate_limit_context(text,text,text,text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_spec record;
  v_unlimited_oid oid;
  v_identity_args text;
  v_args_with_defaults text;
  v_arg_refs text;
  v_unlimited_name text;
  v_arg_names text[];
BEGIN
  FOR v_spec IN
    SELECT *
    FROM (
      VALUES
        ('pos_pull_product_catalog_snapshot', 6, 60),
        ('pos_pull_customers_snapshot', 6, 60),
        ('pos_pull_cash_snapshot', 6, 60),
        ('pos_pull_customer_credit_snapshot', 6, 60),
        ('pos_pull_sales_snapshot', 6, 60),
        ('pos_get_reports_overview', 10, 80),
        ('pos_get_reports_credit_overview', 10, 80),
        ('pos_get_sales_final_overview', 10, 80),
        ('pos_get_sales_final_timeseries', 10, 80),
        ('pos_get_sales_final_history', 10, 80),
        ('pos_get_sales_profit_report', 10, 80),
        ('pos_get_sales_audit_report', 10, 80),
        ('pos_get_cash_report', 10, 80),
        ('pos_get_customer_credit_report', 10, 80),
        ('pos_get_product_catalog_report', 10, 80),
        ('pos_get_report_timeseries', 10, 80),
        ('pos_admin_list_cash_sessions', 10, 80),
        ('pos_admin_get_cash_session_detail', 10, 80),
        ('pos_export_sales_final', 3, 20),
        ('pos_export_report_data', 3, 20),
        ('pos_validate_sales_consistency', 5, NULL::integer)
    ) AS specs(rpc_name, device_max_requests, license_max_requests)
  LOOP
    v_unlimited_name := v_spec.rpc_name || '_unlimited';

    SELECT p.oid, p.proargnames
    INTO v_unlimited_oid, v_arg_names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_unlimited_name
    ORDER BY p.oid
    LIMIT 1;

    IF v_unlimited_oid IS NULL THEN
      RAISE EXCEPTION 'FASE 6H.7.3.1: falta función base %', v_unlimited_name;
    END IF;

    IF COALESCE(v_arg_names[1], '') <> 'p_license_key'
       OR COALESCE(v_arg_names[2], '') <> 'p_device_fingerprint'
       OR COALESCE(v_arg_names[3], '') <> 'p_security_token'
       OR COALESCE(v_arg_names[4], '') <> 'p_staff_session_token' THEN
      RAISE EXCEPTION 'FASE 6H.7.3.1: firma inesperada en %. Primeros args: %, %, %, %',
        v_unlimited_name,
        COALESCE(v_arg_names[1], '<null>'),
        COALESCE(v_arg_names[2], '<null>'),
        COALESCE(v_arg_names[3], '<null>'),
        COALESCE(v_arg_names[4], '<null>');
    END IF;

    SELECT
      pg_get_function_identity_arguments(v_unlimited_oid),
      pg_get_function_arguments(v_unlimited_oid)
    INTO v_identity_args, v_args_with_defaults;

    SELECT string_agg('$' || gs::text, ', ' ORDER BY gs)
    INTO v_arg_refs
    FROM generate_series(1, (
      SELECT p.pronargs
      FROM pg_proc p
      WHERE p.oid = v_unlimited_oid
    )) AS gs;

    EXECUTE format($wrapper$
      CREATE OR REPLACE FUNCTION public.%1$I(%2$s)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $fn$
      DECLARE
        v_context jsonb;
        v_rate_limit jsonb;
      BEGIN
        v_context := public.validate_pos_rpc_rate_limit_context($1, $2, $3, $4);

        IF COALESCE((v_context->>'success')::boolean, false) IS FALSE THEN
          RETURN v_context;
        END IF;

        v_rate_limit := public.enforce_pos_rpc_rate_limit(
          $1,
          $2,
          $4,
          %3$L,
          60,
          %4$s,
          %5$s
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit);
        END IF;

        RETURN public.%6$I(%7$s);
      END;
      $fn$;
    $wrapper$,
      v_spec.rpc_name,
      v_args_with_defaults,
      v_spec.rpc_name,
      v_spec.device_max_requests,
      COALESCE(v_spec.license_max_requests::text, 'NULL'),
      v_unlimited_name,
      v_arg_refs
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated',
      v_spec.rpc_name,
      v_identity_args
    );

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_unlimited_name,
      v_identity_args
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.validate_pos_rpc_rate_limit_context(text,text,text,text)
IS 'FASE 6H.7.3.1: valida licencia/dispositivo/token/staff antes de consumir rate limit. No ejecuta lecturas pesadas ni guarda tokens.';

NOTIFY pgrst, 'reload schema';
