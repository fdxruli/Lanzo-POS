-- Read-only Production pg_proc snapshot of the public rate-limited Restaurant upsert wrapper.
-- Synthetic database fixture only; this is not a migration and contains no business rows.
CREATE OR REPLACE FUNCTION public.pos_upsert_restaurant_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text DEFAULT NULL::text,
  p_staff_session_token text DEFAULT NULL::text,
  p_order jsonb DEFAULT '{}'::jsonb,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_upsert_restaurant_order',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_upsert_restaurant_order_unlimited($1, $2, $3, $4, $5, $6, $7)::jsonb;
      END;
      $function$;

ALTER FUNCTION public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text) TO anon, authenticated, service_role;
