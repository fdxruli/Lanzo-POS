-- FASE SEC.2 — Rate limit server-side y auditoría defensiva de abuso por RPC crítica.
-- Reutiliza public.pos_rpc_rate_limits y wrappers *_unlimited existentes de FASE 6H.7.3.
-- No guarda security_token, staff_session_token, passwords ni secretos planos.

-- SEC.2.1 Inspect/reuse rate limit infrastructure

ALTER TABLE public.pos_rpc_rate_limits
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS blocked_until timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS last_limited_at timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pos_rpc_rate_limits_blocked
ON public.pos_rpc_rate_limits (license_key, device_fingerprint, rpc_name, blocked_until)
WHERE blocked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_rpc_rate_limits_scope_cleanup
ON public.pos_rpc_rate_limits (scope, window_start);

CREATE INDEX IF NOT EXISTS idx_pos_rpc_rate_limits_scope_rpc_window
ON public.pos_rpc_rate_limits (scope, rpc_name, window_start DESC);

COMMENT ON COLUMN public.pos_rpc_rate_limits.scope IS 'SEC.2: categoría defensiva del límite, por ejemplo AUTH_LICENSE, STAFF_AUTH, POS_WRITE, REPORT_EXPORT o SYNC_PULL.';
COMMENT ON COLUMN public.pos_rpc_rate_limits.blocked_until IS 'SEC.2: bloqueo temporal derivado de abuso. No contiene secretos.';
COMMENT ON COLUMN public.pos_rpc_rate_limits.last_limited_at IS 'SEC.2: última vez que una ventana excedió el límite.';
COMMENT ON COLUMN public.pos_rpc_rate_limits.metadata IS 'SEC.2: metadata defensiva no sensible. No guardar tokens, passwords ni security_token plano.';

CREATE OR REPLACE FUNCTION public.enforce_pos_rpc_rate_limit_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text,
  p_rpc_name text,
  p_scope text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_code text DEFAULT 'RPC_RATE_LIMITED',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := now();
  v_license_key text := COALESCE(NULLIF(BTRIM(COALESCE(p_license_key, '')), ''), '__missing_license__');
  v_device_fingerprint text := COALESCE(NULLIF(BTRIM(COALESCE(p_device_fingerprint, '')), ''), '__missing_device__');
  v_staff_session_hash text := NULL;
  v_rpc_name text := COALESCE(NULLIF(BTRIM(COALESCE(p_rpc_name, '')), ''), '__missing_rpc__');
  v_scope text := COALESCE(NULLIF(BTRIM(COALESCE(p_scope, '')), ''), 'RPC');
  v_max_attempts integer := GREATEST(COALESCE(p_max_attempts, 1), 1);
  v_window_seconds integer := GREATEST(COALESCE(p_window_seconds, 60), 1);
  v_block_seconds integer := GREATEST(COALESCE(p_block_seconds, 60), 1);
  v_code text := COALESCE(NULLIF(BTRIM(COALESCE(p_code, '')), ''), 'RPC_RATE_LIMITED');
  v_window_start timestamp with time zone;
  v_request_count integer := 0;
  v_retry_after_seconds integer := 0;
  v_blocked_until timestamp with time zone;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_staff_session_token, '')), '') IS NOT NULL THEN
    v_staff_session_hash := encode(extensions.digest(p_staff_session_token, 'sha256'), 'hex');
  END IF;

  SELECT max(blocked_until)
  INTO v_blocked_until
  FROM public.pos_rpc_rate_limits
  WHERE license_key = v_license_key
    AND device_fingerprint = v_device_fingerprint
    AND rpc_name = v_rpc_name
    AND scope = v_scope
    AND COALESCE(staff_session_hash, ''::text) = COALESCE(v_staff_session_hash, ''::text)
    AND blocked_until IS NOT NULL
    AND blocked_until > v_now;

  IF v_blocked_until IS NOT NULL THEN
    v_retry_after_seconds := GREATEST(CEIL(extract(epoch FROM (v_blocked_until - v_now)))::integer, 1);

    RETURN jsonb_build_object(
      'allowed', false,
      'code', v_code,
      'message', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
      'scope', v_scope,
      'rpc_name', v_rpc_name,
      'request_count', 0,
      'max_requests', v_max_attempts,
      'window_seconds', v_window_seconds,
      'blocked_until', v_blocked_until,
      'retry_after_seconds', v_retry_after_seconds
    );
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / v_window_seconds) * v_window_seconds
  );

  INSERT INTO public.pos_rpc_rate_limits (
    license_key,
    device_fingerprint,
    staff_session_hash,
    rpc_name,
    scope,
    window_start,
    window_seconds,
    request_count,
    blocked_until,
    last_limited_at,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    v_license_key,
    v_device_fingerprint,
    v_staff_session_hash,
    v_rpc_name,
    v_scope,
    v_window_start,
    v_window_seconds,
    1,
    NULL,
    NULL,
    v_metadata,
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
    scope = EXCLUDED.scope,
    metadata = COALESCE(public.pos_rpc_rate_limits.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = EXCLUDED.updated_at
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_max_attempts THEN
    v_blocked_until := v_now + make_interval(secs => v_block_seconds);
    v_retry_after_seconds := GREATEST(v_block_seconds, 1);

    UPDATE public.pos_rpc_rate_limits
    SET blocked_until = v_blocked_until,
        last_limited_at = v_now,
        updated_at = v_now
    WHERE license_key = v_license_key
      AND device_fingerprint = v_device_fingerprint
      AND rpc_name = v_rpc_name
      AND window_start = v_window_start
      AND window_seconds = v_window_seconds
      AND COALESCE(staff_session_hash, ''::text) = COALESCE(v_staff_session_hash, ''::text);

    RETURN jsonb_build_object(
      'allowed', false,
      'code', v_code,
      'message', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
      'scope', v_scope,
      'rpc_name', v_rpc_name,
      'request_count', v_request_count,
      'max_requests', v_max_attempts,
      'window_seconds', v_window_seconds,
      'blocked_until', v_blocked_until,
      'retry_after_seconds', v_retry_after_seconds
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'scope', v_scope,
    'rpc_name', v_rpc_name,
    'request_count', v_request_count,
    'max_requests', v_max_attempts,
    'window_seconds', v_window_seconds,
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
    'code', COALESCE(NULLIF(p_rate_limit->>'code', ''), 'RPC_RATE_LIMITED'),
    'message', COALESCE(NULLIF(p_rate_limit->>'message', ''), 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'),
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
  WHERE window_start < now() - v_older_than
    AND (blocked_until IS NULL OR blocked_until < now());

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_pos_rpc_rate_limited_response(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval) TO service_role;

COMMENT ON FUNCTION public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)
IS 'SEC.2: rate limit defensivo por licencia/dispositivo/RPC/scope con bloqueo temporal. Staff session se guarda como SHA-256; no guarda tokens ni passwords planos.';
COMMENT ON FUNCTION public.build_pos_rpc_rate_limited_response(jsonb)
IS 'SEC.2: respuesta JSON/JSONB controlada para RPCs limitadas.';
COMMENT ON FUNCTION public.cleanup_pos_rpc_rate_limits(interval)
IS 'SEC.2: limpia ventanas antiguas sin borrar bloqueos aún vigentes.';

-- SEC.2.2 Auth/license RPC rate limits
-- SEC.2.3 Staff login/session rate limits
-- SEC.2.4 POS write RPC rate limits
-- SEC.2.5 Reports/export/sync rate limits
-- SEC.2.6 AI usage rate limits

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
    "rpc_name": "activate_license_on_device",
    "category": "AUTH_LICENSE",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "LICENSE_ACTIVATION_RATE_LIMITED",
    "license_expr": "'__license_activation__'",
    "device_expr": "$2",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "verify_device_license_unified",
    "category": "AUTH_LICENSE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "create_free_trial_license",
    "category": "AUTH_LICENSE",
    "max_attempts": 3,
    "window_seconds": 86400,
    "block_seconds": 86400,
    "code": "LICENSE_ACTIVATION_RATE_LIMITED",
    "license_expr": "'__free_license_creation__'",
    "device_expr": "$1",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "renew_license_free",
    "category": "AUTH_LICENSE",
    "max_attempts": 5,
    "window_seconds": 3600,
    "block_seconds": 3600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "staff_login_on_device",
    "category": "STAFF_AUTH",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "STAFF_LOGIN_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "COALESCE(NULLIF(BTRIM($2), ''), '__missing_device__') || ':user:' || encode(extensions.digest(lower(BTRIM(COALESCE($5, ''))), 'sha256'), 'hex')",
    "staff_expr": "NULL",
    "metadata_expr": "jsonb_build_object('username_hash', encode(extensions.digest(lower(BTRIM(COALESCE($5, ''))), 'sha256'), 'hex'))"
  },
  {
    "rpc_name": "verify_staff_session",
    "category": "STAFF_AUTH",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$3",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "staff_logout_session",
    "category": "STAFF_AUTH",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$3",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "save_business_profile_secure",
    "category": "PROFILE",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "get_business_profile_anon",
    "category": "PROFILE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "'__profile_read__'",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "register_term_acceptance",
    "category": "PROFILE",
    "max_attempts": 20,
    "window_seconds": 600,
    "block_seconds": 600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$3",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "get_license_devices_anon",
    "category": "DEVICE_ADMIN",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "release_device_anon",
    "category": "DEVICE_ADMIN",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$2",
    "device_expr": "$3",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "deactivate_device_anon",
    "category": "DEVICE_ADMIN",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 600,
    "code": "AUTH_RATE_LIMITED",
    "license_expr": "$2",
    "device_expr": "$3",
    "staff_expr": "NULL",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_upsert_customer",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_delete_customer",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_upsert_category",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_delete_category",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_upsert_product",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_delete_product",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_toggle_product_status",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_upsert_product_batch",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_delete_product_batch",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_create_product_batch_from_parent_stock",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_adjust_product_stock_without_batch_zero",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_upsert_restaurant_order",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_update_restaurant_order_status",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_update_restaurant_order_item_status",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_archive_restaurant_order",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_register_expiration_waste",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_upsert_preparation_station",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_toggle_preparation_station",
    "category": "POS_WRITE",
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
    "rpc_name": "pos_open_cash_session",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_close_cash_session",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_register_cash_movement",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_adjust_initial_cash_fund",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_upsert_sale_shadow",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_create_cloud_sale_cashier",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_create_cloud_sale_cashier_inventory",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_create_cloud_sale_credit",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_cancel_cloud_sale",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_close_restaurant_order_after_checkout",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_record_customer_payment",
    "category": "POS_WRITE",
    "max_attempts": 60,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_get_reports_overview",
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
    "rpc_name": "pos_get_reports_credit_overview",
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
    "rpc_name": "pos_get_report_timeseries",
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
    "rpc_name": "pos_get_sales_final_overview",
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
    "rpc_name": "pos_get_sales_final_timeseries",
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
    "rpc_name": "pos_get_cash_report",
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
    "rpc_name": "pos_get_product_catalog_report",
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
    "rpc_name": "pos_get_expiring_batches_report",
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
    "rpc_name": "pos_get_expiration_fefo_recommendations",
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
    "rpc_name": "pos_get_expiration_waste_history",
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
    "rpc_name": "pos_preview_cloud_sale_cancellation",
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
    "rpc_name": "pos_validate_cloud_sale_integrity",
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
    "rpc_name": "pos_get_sales_final_history",
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
    "rpc_name": "pos_get_sales_profit_report",
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
    "rpc_name": "pos_get_sales_audit_report",
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
    "rpc_name": "pos_get_customer_credit_report",
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
    "rpc_name": "pos_get_restaurant_orders_history",
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
    "rpc_name": "pos_export_report_data",
    "category": "REPORT_EXPORT",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_export_sales_final",
    "category": "REPORT_EXPORT",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_export_sales_shadow",
    "category": "REPORT_EXPORT",
    "max_attempts": 10,
    "window_seconds": 600,
    "block_seconds": 900,
    "code": "REPORT_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_customers_snapshot",
    "category": "SYNC_PULL",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_product_catalog_snapshot",
    "category": "SYNC_PULL",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_cash_snapshot",
    "category": "SYNC_PULL",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_sales_snapshot",
    "category": "SYNC_PULL",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_customer_credit_snapshot",
    "category": "SYNC_PULL",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "RPC_RATE_LIMITED",
    "license_expr": "$1",
    "device_expr": "$2",
    "staff_expr": "$4",
    "metadata_expr": "'{}'::jsonb"
  },
  {
    "rpc_name": "pos_pull_customer_changes",
    "category": "SYNC_PULL",
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
    "rpc_name": "pos_pull_product_catalog_changes",
    "category": "SYNC_PULL",
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
    "rpc_name": "pos_pull_cash_changes",
    "category": "SYNC_PULL",
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
    "rpc_name": "pos_pull_sales_changes",
    "category": "SYNC_PULL",
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
    "rpc_name": "pos_pull_customer_credit_changes",
    "category": "SYNC_PULL",
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
    "rpc_name": "pos_pull_sync_events",
    "category": "SYNC_PULL",
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
    "rpc_name": "get_ai_agent_usage",
    "category": "AI_USAGE",
    "max_attempts": 30,
    "window_seconds": 600,
    "block_seconds": 300,
    "code": "AI_RATE_LIMITED",
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
      RAISE NOTICE 'SEC.2: RPC % no existe; se omite wrapper de rate limit.', v_spec.rpc_name;
      CONTINUE;
    END IF;

    SELECT
      pg_get_function_identity_arguments(v_unlimited_oid),
      pg_get_function_arguments(v_unlimited_oid),
      pg_get_function_result(v_unlimited_oid)
    INTO v_identity_args, v_args_with_defaults, v_result_type;

    IF v_result_type NOT IN ('json', 'jsonb') THEN
      RAISE NOTICE 'SEC.2: RPC % retorna %, no json/jsonb; se omite wrapper.', v_spec.rpc_name, v_result_type;
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
      'SEC.2 wrapper: ' || v_spec.category || ' rate limit ' || v_spec.max_attempts || ' requests / ' || v_spec.window_seconds || 's; block ' || v_spec.block_seconds || 's. Delegates to ' || v_unlimited_name || '.'
    );
  END LOOP;
END;
$$;

-- SEC.2.7 Verification helpers/report queries

COMMENT ON TABLE public.pos_rpc_rate_limits
IS 'SEC.2: counters por ventana para proteger RPCs públicas críticas. No almacena security_token, staff_session_token, passwords ni admin secrets planos.';

NOTIFY pgrst, 'reload schema';