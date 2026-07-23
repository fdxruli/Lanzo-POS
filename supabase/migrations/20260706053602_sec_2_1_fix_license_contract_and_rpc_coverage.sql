-- FASE SEC.2.1 — Corrección de contratos JSON y cobertura faltante de RPCs activas.
-- Complementa 20260707000000_sec_2_rpc_rate_limits.sql antes del merge.
-- No guarda tokens planos, no reabre *_unlimited ni private.*.

-- SEC.2.1.1 Contrato rate-limited seguro para verify_device_license_unified

CREATE OR REPLACE FUNCTION public.build_license_validation_rate_limited_response(p_rate_limit jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'valid', false,
    'success', false,
    'reason', COALESCE(NULLIF(p_rate_limit->>'code', ''), 'AUTH_RATE_LIMITED'),
    'code', COALESCE(NULLIF(p_rate_limit->>'code', ''), 'AUTH_RATE_LIMITED'),
    'message', COALESCE(NULLIF(p_rate_limit->>'message', ''), 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'),
    'retry_after_seconds', COALESCE((p_rate_limit->>'retry_after_seconds')::integer, 300),
    'is_rate_limited', true
  );
$$;

REVOKE ALL ON FUNCTION public.build_license_validation_rate_limited_response(jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.build_license_validation_rate_limited_response(jsonb)
IS 'SEC.2.1: respuesta rate-limited compatible con el contrato de verify_device_license_unified. AUTH_RATE_LIMITED no equivale a licencia inválida permanente.';

DO $$
DECLARE
  v_current_oid oid;
  v_unlimited_oid oid;
  v_identity_args text;
BEGIN
  SELECT p.oid
  INTO v_current_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'verify_device_license_unified'
  ORDER BY p.oid
  LIMIT 1;

  SELECT p.oid
  INTO v_unlimited_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'verify_device_license_unified_unlimited'
  ORDER BY p.oid
  LIMIT 1;

  IF v_current_oid IS NOT NULL AND v_unlimited_oid IS NULL THEN
    SELECT pg_get_function_identity_arguments(v_current_oid)
    INTO v_identity_args;

    EXECUTE format(
      'ALTER FUNCTION public.verify_device_license_unified(%s) RENAME TO verify_device_license_unified_unlimited',
      v_identity_args
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'verify_device_license_unified_unlimited'
  ) THEN
    CREATE OR REPLACE FUNCTION public.verify_device_license_unified(
      p_license_key text,
      p_device_fingerprint text,
      p_security_token text DEFAULT NULL::text
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
    DECLARE
      v_rate_limit jsonb;
    BEGIN
      v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
        p_license_key := p_license_key,
        p_device_fingerprint := p_device_fingerprint,
        p_staff_session_token := NULL,
        p_rpc_name := 'verify_device_license_unified',
        p_scope := 'AUTH_LICENSE',
        p_max_attempts := 60,
        p_window_seconds := 600,
        p_block_seconds := 300,
        p_code := 'AUTH_RATE_LIMITED',
        p_metadata := '{}'::jsonb
      );

      IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
        RETURN public.build_license_validation_rate_limited_response(v_rate_limit);
      END IF;

      RETURN public.verify_device_license_unified_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token
      );
    END;
    $fn$;

    REVOKE ALL ON FUNCTION public.verify_device_license_unified_unlimited(text,text,text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.verify_device_license_unified(text,text,text) TO anon, authenticated;

    COMMENT ON FUNCTION public.verify_device_license_unified(text,text,text)
    IS 'SEC.2.1 wrapper: AUTH_LICENSE rate limit 60 requests / 600s; rate-limited response preserves license validation contract with valid=false, reason/code=AUTH_RATE_LIMITED and is_rate_limited=true.';
  ELSE
    RAISE NOTICE 'SEC.2.1: verify_device_license_unified_unlimited no existe; se omite corrección de contrato.';
  END IF;
END;
$$;

-- SEC.2.1.2 Cobertura faltante de RPCs activas usadas por frontend

DO $$
DECLARE
  v_spec record;
  v_current_oid oid;
  v_unlimited_oid oid;
  v_identity_args text;
  v_args_with_defaults text;
  v_arg_refs text;
  v_unlimited_name text;
  v_result_type text;
BEGIN
  FOR v_spec IN
    SELECT *
    FROM jsonb_to_recordset($specs$
[
  {
    "rpc_name": "pos_get_current_cash_session",
    "category": "POS_READ_HEAVY",
    "max_attempts": 120,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_admin_list_cash_sessions",
    "category": "POS_READ_HEAVY",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_admin_get_cash_session_detail",
    "category": "POS_READ_HEAVY",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_validate_sales_consistency",
    "category": "POS_READ_HEAVY",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_restaurant_orders",
    "category": "POS_READ_HEAVY",
    "max_attempts": 120,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_restaurant_order_by_local_order",
    "category": "POS_READ_HEAVY",
    "max_attempts": 120,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_preparation_stations",
    "category": "POS_READ_HEAVY",
    "max_attempts": 120,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_customer_credit_summary",
    "category": "POS_READ_HEAVY",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_sale",
    "category": "POS_READ_HEAVY",
    "max_attempts": 120,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_migrate_local_customers",
    "category": "SYNC_PULL",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_migrate_local_product_catalog",
    "category": "SYNC_PULL",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_migrate_local_customer_credit",
    "category": "SYNC_PULL",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  }
]
$specs$::jsonb) AS specs(
      rpc_name text,
      category text,
      max_attempts integer,
      window_seconds integer,
      block_seconds integer,
      code text,
      license_expr text,
      device_expr text,
      staff_expr text,
      metadata_expr text
    )
  LOOP
    v_unlimited_name := v_spec.rpc_name || '_unlimited';

    SELECT p.oid
    INTO v_current_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_spec.rpc_name
    ORDER BY p.oid
    LIMIT 1;

    SELECT p.oid
    INTO v_unlimited_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_unlimited_name
    ORDER BY p.oid
    LIMIT 1;

    IF v_current_oid IS NOT NULL AND v_unlimited_oid IS NULL THEN
      SELECT pg_get_function_identity_arguments(v_current_oid)
      INTO v_identity_args;

      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) RENAME TO %I',
        v_spec.rpc_name,
        v_identity_args,
        v_unlimited_name
      );

      SELECT p.oid
      INTO v_unlimited_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_unlimited_name
      ORDER BY p.oid
      LIMIT 1;
    END IF;

    IF v_unlimited_oid IS NULL THEN
      RAISE NOTICE 'SEC.2.1: RPC % no existe; se omite wrapper de rate limit.', v_spec.rpc_name;
      CONTINUE;
    END IF;

    SELECT
      pg_get_function_identity_arguments(v_unlimited_oid),
      pg_get_function_arguments(v_unlimited_oid),
      pg_get_function_result(v_unlimited_oid)
    INTO v_identity_args, v_args_with_defaults, v_result_type;

    IF v_result_type NOT IN ('json', 'jsonb') THEN
      RAISE NOTICE 'SEC.2.1: RPC % retorna %, no json/jsonb; se omite wrapper.', v_spec.rpc_name, v_result_type;
      CONTINUE;
    END IF;

    SELECT string_agg('$' || gs::text, ', ' ORDER BY gs)
    INTO v_arg_refs
    FROM generate_series(1, (
      SELECT p.pronargs
      FROM pg_proc p
      WHERE p.oid = v_unlimited_oid
    )) AS gs;

    EXECUTE format($wrapper$
      CREATE OR REPLACE FUNCTION public.%1$I(%2$s)
      RETURNS %3$s
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $fn$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := %4$s,
          p_device_fingerprint := %5$s,
          p_staff_session_token := %6$s,
          p_rpc_name := %7$L,
          p_scope := %8$L,
          p_max_attempts := %9$s,
          p_window_seconds := %10$s,
          p_block_seconds := %11$s,
          p_code := %12$L,
          p_metadata := %13$s
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::%3$s;
        END IF;

        RETURN public.%14$I(%15$s)::%3$s;
      END;
      $fn$;
    $wrapper$,
      v_spec.rpc_name,
      v_args_with_defaults,
      v_result_type,
      v_spec.license_expr,
      v_spec.device_expr,
      v_spec.staff_expr,
      v_spec.rpc_name,
      v_spec.category,
      v_spec.max_attempts,
      v_spec.window_seconds,
      v_spec.block_seconds,
      v_spec.code,
      COALESCE(v_spec.metadata_expr, '''{}''::jsonb'),
      v_unlimited_name,
      COALESCE(v_arg_refs, '')
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

    EXECUTE format(
      'COMMENT ON FUNCTION public.%I(%s) IS %L',
      v_spec.rpc_name,
      v_identity_args,
      'SEC.2.1 wrapper: ' || v_spec.category || ' rate limit ' || v_spec.max_attempts || ' requests / ' || v_spec.window_seconds || 's; block ' || v_spec.block_seconds || 's. Delegates to ' || v_unlimited_name || '.'
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';;
