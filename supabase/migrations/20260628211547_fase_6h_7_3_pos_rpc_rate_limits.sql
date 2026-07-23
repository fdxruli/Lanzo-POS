-- FASE 6H.7.3 — Rate limits server-side para lecturas pesadas cloud.
-- Protege snapshots, reportes, historiales, auditorías, exports y validaciones manuales.
-- No aplica límites a ventas/caja/abonos/mutaciones/pull incremental transaccional.

CREATE TABLE IF NOT EXISTS public.pos_rpc_rate_limits (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  license_key text NOT NULL,
  device_fingerprint text NOT NULL,
  staff_session_hash text NULL,
  rpc_name text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_seconds integer NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_rpc_rate_limits_unique_window
ON public.pos_rpc_rate_limits (
  license_key,
  device_fingerprint,
  rpc_name,
  window_start,
  window_seconds,
  (COALESCE(staff_session_hash, ''::text))
);

CREATE INDEX IF NOT EXISTS idx_pos_rpc_rate_limits_cleanup
ON public.pos_rpc_rate_limits (window_start);

CREATE INDEX IF NOT EXISTS idx_pos_rpc_rate_limits_license_rpc
ON public.pos_rpc_rate_limits (license_key, rpc_name, window_start DESC);

ALTER TABLE public.pos_rpc_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_rpc_rate_limits FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pos_rpc_rate_limits_window_seconds_positive'
      AND conrelid = 'public.pos_rpc_rate_limits'::regclass
  ) THEN
    ALTER TABLE public.pos_rpc_rate_limits
      ADD CONSTRAINT pos_rpc_rate_limits_window_seconds_positive CHECK (window_seconds > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pos_rpc_rate_limits_request_count_nonnegative'
      AND conrelid = 'public.pos_rpc_rate_limits'::regclass
  ) THEN
    ALTER TABLE public.pos_rpc_rate_limits
      ADD CONSTRAINT pos_rpc_rate_limits_request_count_nonnegative CHECK (request_count >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_pos_rpc_rate_limit(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text,
  p_rpc_name text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := now();
  v_license_key text := NULLIF(BTRIM(COALESCE(p_license_key, '')), '');
  v_device_fingerprint text := NULLIF(BTRIM(COALESCE(p_device_fingerprint, '')), '');
  v_rpc_name text := NULLIF(BTRIM(COALESCE(p_rpc_name, '')), '');
  v_window_seconds integer := GREATEST(COALESCE(p_window_seconds, 60), 1);
  v_max_requests integer := GREATEST(COALESCE(p_max_requests, 1), 1);
  v_window_start timestamp with time zone;
  v_request_count integer;
  v_retry_after_seconds integer := 0;
  v_staff_session_hash text := NULL;
BEGIN
  IF v_license_key IS NULL OR v_device_fingerprint IS NULL OR v_rpc_name IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'skipped', true,
      'reason', 'RATE_LIMIT_CONTEXT_INCOMPLETE',
      'request_count', 0,
      'max_requests', v_max_requests,
      'window_seconds', v_window_seconds,
      'retry_after_seconds', 0
    );
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_staff_session_token, '')), '') IS NOT NULL THEN
    v_staff_session_hash := encode(extensions.digest(p_staff_session_token, 'sha256'), 'hex');
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / v_window_seconds) * v_window_seconds
  );

  INSERT INTO public.pos_rpc_rate_limits (
    license_key,
    device_fingerprint,
    staff_session_hash,
    rpc_name,
    window_start,
    window_seconds,
    request_count,
    created_at,
    updated_at
  )
  VALUES (
    v_license_key,
    v_device_fingerprint,
    v_staff_session_hash,
    v_rpc_name,
    v_window_start,
    v_window_seconds,
    1,
    v_now,
    v_now
  )
  ON CONFLICT (
    license_key,
    device_fingerprint,
    rpc_name,
    window_start,
    window_seconds,
    (COALESCE(staff_session_hash, ''::text))
  )
  DO UPDATE SET
    request_count = public.pos_rpc_rate_limits.request_count + 1,
    updated_at = EXCLUDED.updated_at
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_max_requests THEN
    v_retry_after_seconds := GREATEST(
      CEIL(extract(epoch FROM ((v_window_start + make_interval(secs => v_window_seconds)) - v_now)))::integer,
      1
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'RATE_LIMITED',
      'message', 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.',
      'request_count', v_request_count,
      'max_requests', v_max_requests,
      'window_seconds', v_window_seconds,
      'retry_after_seconds', v_retry_after_seconds
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'request_count', v_request_count,
    'max_requests', v_max_requests,
    'window_seconds', v_window_seconds,
    'retry_after_seconds', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_pos_rpc_rate_limit(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text,
  p_rpc_name text,
  p_window_seconds integer,
  p_device_max_requests integer,
  p_license_max_requests integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device_limit jsonb;
  v_license_limit jsonb;
BEGIN
  v_device_limit := public.check_pos_rpc_rate_limit(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    p_rpc_name,
    p_window_seconds,
    p_device_max_requests
  );

  IF COALESCE((v_device_limit->>'allowed')::boolean, false) IS FALSE THEN
    RETURN v_device_limit || jsonb_build_object('scope', 'device');
  END IF;

  IF p_license_max_requests IS NOT NULL AND p_license_max_requests > 0 THEN
    v_license_limit := public.check_pos_rpc_rate_limit(
      p_license_key,
      '__license__',
      NULL,
      p_rpc_name,
      p_window_seconds,
      p_license_max_requests
    );

    IF COALESCE((v_license_limit->>'allowed')::boolean, false) IS FALSE THEN
      RETURN v_license_limit || jsonb_build_object('scope', 'license');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'scope', 'ok',
    'device_request_count', COALESCE((v_device_limit->>'request_count')::integer, 0),
    'license_request_count', COALESCE((v_license_limit->>'request_count')::integer, 0),
    'window_seconds', COALESCE((v_device_limit->>'window_seconds')::integer, p_window_seconds),
    'retry_after_seconds', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.build_pos_rpc_rate_limited_response(p_rate_limit jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'success', false,
    'code', 'RATE_LIMITED',
    'message', 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.',
    'retry_after_seconds', COALESCE((p_rate_limit->>'retry_after_seconds')::integer, 30)
  );
$$;

CREATE OR REPLACE FUNCTION public.cleanup_pos_rpc_rate_limits(
  p_older_than interval DEFAULT interval '24 hours'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
  v_older_than interval := GREATEST(COALESCE(p_older_than, interval '24 hours'), interval '1 hour');
BEGIN
  DELETE FROM public.pos_rpc_rate_limits
  WHERE window_start < now() - v_older_than;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.check_pos_rpc_rate_limit(text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_pos_rpc_rate_limit(text,text,text,text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_pos_rpc_rate_limited_response(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval) TO service_role;

COMMENT ON TABLE public.pos_rpc_rate_limits IS 'FASE 6H.7.3: counters por ventana para proteger RPCs POS cloud pesadas. No almacena tokens planos.';
COMMENT ON FUNCTION public.check_pos_rpc_rate_limit(text,text,text,text,integer,integer) IS 'Rate limit centralizado por licencia/dispositivo/RPC. Staff session se guarda como SHA-256, nunca en texto plano.';
COMMENT ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval) IS 'Limpia ventanas antiguas de pos_rpc_rate_limits. No requiere cron obligatorio.';

DO $$
DECLARE
  v_spec record;
  v_oid oid;
  v_unlimited_oid oid;
  v_identity_args text;
  v_args_with_defaults text;
  v_arg_refs text;
  v_unlimited_name text;
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

    SELECT p.oid
    INTO v_oid
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

    IF v_oid IS NOT NULL AND v_unlimited_oid IS NULL THEN
      v_identity_args := pg_get_function_identity_arguments(v_oid);
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
      RAISE NOTICE 'FASE 6H.7.3: RPC % no existe; se omite wrapper de rate limit.', v_spec.rpc_name;
      CONTINUE;
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
        v_rate_limit jsonb;
      BEGIN
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

NOTIFY pgrst, 'reload schema';;
