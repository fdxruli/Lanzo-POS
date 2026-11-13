DO $assert$
DECLARE
  v RECORD;
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_acl text[];
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
       'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_idempotency_key text, p_request_hash text, p_operation_type text, p_request jsonb',
       ARRAY['search_path=""','statement_timeout=45s','lock_timeout=20s']::text[],
       ARRAY['anon:EXECUTE','authenticated:EXECUTE','postgres:EXECUTE','service_role:EXECUTE']::text[]),
      ('private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)',
       'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_idempotency_key text, p_request_hash text, p_operation_type text, p_request jsonb',
       ARRAY['search_path=""','statement_timeout=45s','lock_timeout=20s']::text[],
       ARRAY['postgres:EXECUTE']::text[]),
      ('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)',
       'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_idempotency_key text, p_request_hash text',
       ARRAY['search_path=""']::text[],
       ARRAY['anon:EXECUTE','authenticated:EXECUTE','postgres:EXECUTE','service_role:EXECUTE']::text[]),
      ('public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)',
       'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_idempotency_key text, p_request_hash text, p_sync_contract jsonb',
       ARRAY['search_path=""']::text[],
       ARRAY['anon:EXECUTE','authenticated:EXECUTE','postgres:EXECUTE','service_role:EXECUTE']::text[])
    ) AS expected(signature, identity_arguments, config, acl)
  LOOP
    v_oid := to_regprocedure(v.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'P0_METADATA_FUNCTION_MISSING:%', v.signature;
    END IF;
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      INTO v_owner, v_security_definer, v_config
      FROM pg_proc p WHERE p.oid = v_oid;
    IF pg_get_function_identity_arguments(v_oid) IS DISTINCT FROM v.identity_arguments THEN
      RAISE EXCEPTION 'P0_METADATA_ARGUMENT_DRIFT:%', v.signature;
    END IF;
    IF v_owner IS DISTINCT FROM 'postgres' OR v_security_definer IS DISTINCT FROM true OR v_config IS NULL
       OR cardinality(v_config) <> cardinality(v.config) OR NOT (v_config @> v.config) THEN
      RAISE EXCEPTION 'P0_METADATA_OWNER_OR_OPTIONS_DRIFT:%', v.signature;
    END IF;
    SELECT coalesce(array_agg(
             (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || ':' || a.privilege_type
             ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), a.privilege_type
           ), ARRAY[]::text[])
      INTO v_acl
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid = v_oid;
    IF v_acl IS DISTINCT FROM v.acl THEN
      RAISE EXCEPTION 'P0_METADATA_ACL_DRIFT:% expected=% actual=%', v.signature, v.acl, v_acl;
    END IF;
  END LOOP;
END;
$assert$;
