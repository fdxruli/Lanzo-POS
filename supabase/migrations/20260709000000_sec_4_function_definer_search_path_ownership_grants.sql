-- FASE SEC.4 — Hardening de funciones SECURITY DEFINER, search_path y grants residuales.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT n.nspname AS schema_name, p.proname AS function_name, pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND (n.nspname = 'private' OR p.proname ~ '(_unlimited|_internal|_helper|_legacy|_unsafe)($|_)')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated', v_fn.schema_name, v_fn.function_name, v_fn.identity_args);
  END LOOP;
END;
$$;

ALTER FUNCTION public.admin_create_license(text,uuid,text,text,integer,jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_delete_license(text,uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_get_global_logs(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_get_license_details(text,uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_get_plans(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_kick_device(text,uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_update_license(text,uuid,text,integer,timestamptz) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_upsert_plan(text,uuid,text,text,numeric,integer,jsonb,boolean) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_admin_dashboard_data(text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION private.apply_sale_inventory_effects(uuid,text,jsonb,uuid,uuid,text,text,text) SET search_path = pg_catalog, public, private, pg_temp;
ALTER FUNCTION private.resolve_sale_inventory_allocations(uuid,jsonb,text) SET search_path = pg_catalog, public, private, pg_temp;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_create_license(text,uuid,text,text,integer,jsonb)',
    'public.admin_delete_license(text,uuid)',
    'public.admin_get_global_logs(text)',
    'public.admin_get_license_details(text,uuid)',
    'public.admin_get_plans(text)',
    'public.admin_kick_device(text,uuid)',
    'public.admin_update_license(text,uuid,text,integer,timestamptz)',
    'public.admin_upsert_plan(text,uuid,text,text,numeric,integer,jsonb,boolean)',
    'public.get_admin_dashboard_data(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS private.sec4_security_surface_audit();

CREATE FUNCTION private.sec4_security_surface_audit()
RETURNS TABLE (check_name text, finding_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH fn AS (
    SELECT n.nspname schema_name, p.proname function_name, p.prosecdef, p.proowner owner_oid, p.proacl,
      coalesce((SELECT regexp_replace(u.cfg, '^search_path=', '') FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) u(cfg) WHERE u.cfg LIKE 'search_path=%' LIMIT 1), '<missing>') search_path
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','private','realtime')
  ), grants AS (
    SELECT fn.*, CASE WHEN a.grantee = 0::oid THEN 'PUBLIC' ELSE a.grantee::regrole::text END grantee, a.privilege_type
    FROM fn
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(fn.proacl, pg_catalog.acldefault('f'::"char", fn.owner_oid))) a
  ), findings AS (
    SELECT 'unsafe_secdef_search_path'::text AS check_name, count(*)::bigint AS finding_count FROM fn WHERE prosecdef AND search_path NOT IN ('""','pg_catalog, public, pg_temp','pg_catalog, public, private, pg_temp')
    UNION ALL SELECT 'private_client_execute', count(*)::bigint FROM grants WHERE schema_name='private' AND privilege_type='EXECUTE' AND grantee IN ('PUBLIC','anon','authenticated')
    UNION ALL SELECT 'public_execute_grant', count(*)::bigint FROM grants WHERE schema_name IN ('public','private') AND privilege_type='EXECUTE' AND grantee='PUBLIC'
    UNION ALL SELECT 'helper_client_execute', count(*)::bigint FROM grants WHERE schema_name IN ('public','private') AND function_name ~ '(_unlimited|_internal|_helper|_legacy|_unsafe)($|_)' AND privilege_type='EXECUTE' AND grantee IN ('PUBLIC','anon','authenticated')
  )
  SELECT findings.check_name, findings.finding_count
  FROM findings
  WHERE findings.finding_count > 0;
$$;

REVOKE ALL ON FUNCTION private.sec4_security_surface_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sec4_security_surface_audit() TO service_role;

NOTIFY pgrst, 'reload schema';
