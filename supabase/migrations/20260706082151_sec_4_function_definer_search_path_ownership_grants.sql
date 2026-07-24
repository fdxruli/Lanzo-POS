-- FASE SEC.4 — Hardening transversal de funciones SECURITY DEFINER, search_path, ownership y grants residuales.
-- Enfoque conservador: no toca funciones internas administradas por Supabase; normaliza funciones app-owned
-- y agrega auditoría interna para detectar regresiones futuras.

CREATE SCHEMA IF NOT EXISTS private;

-- 1) Cierre defensivo de EXECUTE implícito por PUBLIC.
-- Mantiene intactos los grants explícitos ya aprobados a anon/authenticated para RPCs públicas activas.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- No revocar masivamente en realtime: contiene funciones administradas por Supabase.
-- Las funciones realtime.lanzo_* conservan sus grants actuales porque son parte del contrato de realtime privado.

-- 2) Default privileges defensivos para objetos nuevos creados por roles usados en migraciones/dashboard.
DO $$
DECLARE
  v_role text;
  v_schema text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      CONTINUE;
    END IF;

    FOREACH v_schema IN ARRAY ARRAY['public', 'private'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = v_schema) THEN
        CONTINUE;
      END IF;

      BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated', v_role, v_schema);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated', v_role, v_schema);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated', v_role, v_schema);
      EXCEPTION
        WHEN insufficient_privilege OR undefined_object THEN
          RAISE NOTICE 'SEC.4: skipped default privilege hardening for role %.% due to privileges/object availability', v_role, v_schema;
      END;
    END LOOP;
  END LOOP;
END;
$$;

-- 3) Bloqueo idempotente de helpers internos por convención de nombre y de todo private.* a roles cliente.
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND (
        n.nspname = 'private'
        OR p.proname ~ '(_unlimited|_internal|_helper|_legacy|_unsafe)($|_)'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      v_fn.schema_name,
      v_fn.function_name,
      v_fn.identity_args
    );
  END LOOP;
END;
$$;

-- 4) Normalizar SECURITY DEFINER legacy que aún usaban search_path=public o public,private.
-- pg_temp se declara explícitamente al final para evitar precedencia implícita de objetos temporales.
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

-- 5) Cerrar roles cliente en funciones administrativas y helpers privados; conservar service_role.
REVOKE EXECUTE ON FUNCTION public.admin_create_license(text,uuid,text,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_delete_license(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_global_logs(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_license_details(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_plans(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_kick_device(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_license(text,uuid,text,integer,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_plan(text,uuid,text,text,numeric,integer,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_data(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_license(text,uuid,text,text,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_license(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_global_logs(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_license_details(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_plans(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_kick_device(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_license(text,uuid,text,integer,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_plan(text,uuid,text,text,numeric,integer,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_data(text) TO service_role;

REVOKE EXECUTE ON FUNCTION private.apply_sale_inventory_effects(uuid,text,jsonb,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.resolve_sale_inventory_allocations(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.admin_create_license(text,uuid,text,text,integer,jsonb) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_delete_license(text,uuid) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_get_global_logs(text) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_get_license_details(text,uuid) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_get_plans(text) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_kick_device(text,uuid) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_update_license(text,uuid,text,integer,timestamptz) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.admin_upsert_plan(text,uuid,text,text,numeric,integer,jsonb,boolean) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION public.get_admin_dashboard_data(text) IS 'SEC.4: admin RPC service_role-only; SECURITY DEFINER con search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION private.apply_sale_inventory_effects(uuid,text,jsonb,uuid,uuid,text,text,text) IS 'SEC.4: helper privado internal-only; search_path fijo y pg_temp al final.';
COMMENT ON FUNCTION private.resolve_sale_inventory_allocations(uuid,jsonb,text) IS 'SEC.4: helper privado internal-only; search_path fijo y pg_temp al final.';

-- 6) Auditoría interna post-hardening para detectar regresiones de funciones, grants, owners, defaults y views.
CREATE OR REPLACE FUNCTION private.sec4_security_surface_audit()
RETURNS TABLE (
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
  ), default_grants AS (
    SELECT
      d.defaclrole::regrole::text AS owner_name,
      coalesce(n.nspname, '<all schemas>') AS schema_name,
      d.defaclobjtype,
      CASE WHEN a.grantee = 0::oid THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
      a.privilege_type
    FROM pg_catalog.pg_default_acl d
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE coalesce(n.nspname, '<all schemas>') IN ('public', 'private')
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
    'security_definer_unsafe_search_path'::text AS check_name,
    'high'::text AS severity,
    f.schema_name,
    'function'::text AS object_type,
    f.function_name AS object_name,
    f.identity_args,
    pg_catalog.jsonb_build_object('owner', f.owner_name, 'search_path', coalesce(f.search_path, '<missing>')) AS detail
  FROM scoped_functions f
  WHERE f.security_definer
    AND coalesce(f.search_path, '<missing>') NOT IN (
      '""',
      'pg_catalog, public, pg_temp',
      'pg_catalog, public, private, pg_temp'
    )

  UNION ALL

  SELECT
    'private_function_client_executable'::text,
    'critical'::text,
    g.schema_name,
    'function'::text,
    g.function_name,
    g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name = 'private'
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT
    'helper_named_function_client_executable'::text,
    'critical'::text,
    g.schema_name,
    'function'::text,
    g.function_name,
    g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND g.function_name ~ '(_unlimited|_internal|_helper|_legacy|_unsafe)($|_)'
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT
    'public_execute_grant_present'::text,
    'medium'::text,
    g.schema_name,
    'function'::text,
    g.function_name,
    g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee = 'PUBLIC'

  UNION ALL

  SELECT
    'client_executable_non_definer_function'::text,
    'high'::text,
    g.schema_name,
    'function'::text,
    g.function_name,
    g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name IN ('public', 'private')
    AND NOT g.security_definer
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT
    'admin_function_client_executable'::text,
    'critical'::text,
    g.schema_name,
    'function'::text,
    g.function_name,
    g.identity_args,
    pg_catalog.jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type, 'owner', g.owner_name)
  FROM function_grants g
  WHERE g.schema_name = 'public'
    AND (g.function_name LIKE 'admin_%' OR g.function_name = 'get_admin_dashboard_data')
    AND g.privilege_type = 'EXECUTE'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT
    'public_private_non_postgres_function_owner'::text,
    'medium'::text,
    f.schema_name,
    'function'::text,
    f.function_name,
    f.identity_args,
    pg_catalog.jsonb_build_object('owner', f.owner_name)
  FROM scoped_functions f
  WHERE f.schema_name IN ('public', 'private')
    AND f.owner_name <> 'postgres'

  UNION ALL

  SELECT
    'default_client_privilege_present'::text,
    'medium'::text,
    dg.schema_name,
    CASE dg.defaclobjtype
      WHEN 'f' THEN 'default_function_privilege'
      WHEN 'r' THEN 'default_table_privilege'
      WHEN 'S' THEN 'default_sequence_privilege'
      ELSE 'default_privilege'
    END::text,
    dg.owner_name,
    NULL::text,
    pg_catalog.jsonb_build_object('grantee', dg.grantee, 'privilege', dg.privilege_type, 'object_type', dg.defaclobjtype)
  FROM default_grants dg
  WHERE dg.grantee IN ('PUBLIC', 'anon', 'authenticated')

  UNION ALL

  SELECT
    'client_granted_definer_view'::text,
    'high'::text,
    rg.schema_name,
    CASE rg.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END::text,
    rg.relation_name,
    NULL::text,
    pg_catalog.jsonb_build_object('grantee', rg.grantee, 'privilege', rg.privilege_type, 'owner', rg.owner_name, 'reloptions', rg.reloptions)
  FROM relation_grants rg
  WHERE rg.grantee IN ('PUBLIC', 'anon', 'authenticated')
    AND rg.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    AND NOT ('security_invoker=true' = ANY (coalesce(rg.reloptions, ARRAY[]::text[])));
$function$;

REVOKE ALL ON FUNCTION private.sec4_security_surface_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sec4_security_surface_audit() TO service_role;
COMMENT ON FUNCTION private.sec4_security_surface_audit() IS
  'SEC.4: auditoría interna de regresiones SECURITY DEFINER/search_path/grants/owners/default privileges/views. Service role only.';

NOTIFY pgrst, 'reload schema';;
