-- FASE SEC.4.1 — Versionar auditoría refinada aplicada en Supabase producción.
-- Esta migración no cambia contratos públicos ni abre private.* a roles cliente.

DROP FUNCTION IF EXISTS private.sec4_security_surface_audit();

CREATE FUNCTION private.sec4_security_surface_audit()
RETURNS TABLE(
  check_name text,
  severity text,
  schema_name text,
  object_type text,
  object_name text,
  identity_args text,
  detail jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH scoped_functions AS (
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
      p.oid,
      p.proowner AS owner_oid,
      p.proowner::regrole::text AS owner_name,
      p.prosecdef AS security_definer,
      p.proacl,
      sp.search_path
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL (
      SELECT pg_catalog.regexp_replace(u.cfg, '^search_path=', '') AS search_path
      FROM pg_catalog.unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS u(cfg)
      WHERE u.cfg LIKE 'search_path=%'
      LIMIT 1
    ) sp ON true
    WHERE n.nspname IN ('public', 'private', 'realtime')
  ), function_grants AS (
    SELECT
      f.*,
      CASE WHEN a.grantee = 0::oid THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
      a.privilege_type
    FROM scoped_functions f
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f'::"char", f.owner_oid))) a
  ), relation_grants AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS relation_name,
      c.relkind,
      c.relowner::regrole::text AS owner_name,
      c.reloptions,
      CASE WHEN a.grantee = 0::oid THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
      a.privilege_type
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))) a
    WHERE n.nspname IN ('public', 'private')
      AND c.relkind IN ('v', 'm')
  )
  SELECT
    'security_definer_unsafe_search_path'::text,
    'high'::text,
    f.schema_name,
    'function'::text,
    f.function_name,
    f.identity_args,
    pg_catalog.jsonb_build_object('owner', f.owner_name, 'search_path', coalesce(f.search_path, '<missing>'))
  FROM scoped_functions f
  WHERE f.security_definer
    AND coalesce(f.search_path, '<missing>') NOT IN ('""', 'pg_catalog, public, pg_temp', 'pg_catalog, public, private, pg_temp')

  UNION ALL

  SELECT 'private_function_client_executable', 'critical', g.schema_name, 'function', g.function_name, g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name = 'private'
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT 'helper_named_function_client_executable', 'critical', g.schema_name, 'function', g.function_name, g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND g.function_name ~ '(_unlimited|_internal|_helper|_legacy|_unsafe)($|_)'
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT 'public_execute_grant_present', 'medium', g.schema_name, 'function', g.function_name, g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee = 'PUBLIC'

  UNION ALL

  SELECT 'client_executable_non_definer_function', 'high', g.schema_name, 'function', g.function_name, g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND NOT g.security_definer
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT 'admin_function_client_executable', 'critical', g.schema_name, 'function', g.function_name, g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name = 'public'
    AND (g.function_name LIKE 'admin_%' OR g.function_name = 'get_admin_dashboard_data')
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT 'public_private_non_postgres_function_owner', 'medium', f.schema_name, 'function', f.function_name, f.identity_args,
    pg_catalog.jsonb_build_object('owner', f.owner_name)
  FROM scoped_functions f
  WHERE f.schema_name IN ('public', 'private')
    AND f.owner_name <> 'postgres'

  UNION ALL

  SELECT 'client_granted_definer_view', 'high', rg.schema_name,
    CASE rg.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END,
    rg.relation_name,
    NULL::text,
    pg_catalog.jsonb_build_object('grantee', rg.grantee, 'owner', rg.owner_name, 'reloptions', rg.reloptions)
  FROM relation_grants rg
  WHERE rg.grantee IN ('PUBLIC', 'anon', 'authenticated')
    AND rg.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    AND NOT ('security_invoker=true' = ANY (coalesce(rg.reloptions, ARRAY[]::text[])));
$function$;

REVOKE ALL ON FUNCTION private.sec4_security_surface_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sec4_security_surface_audit() TO service_role;

COMMENT ON FUNCTION private.sec4_security_surface_audit() IS
  'SEC.4.1: audit helper detallado para superficie SQL/PLpgSQL. Cerrado a roles cliente; ejecutable solo por service_role.';

NOTIFY pgrst, 'reload schema';
