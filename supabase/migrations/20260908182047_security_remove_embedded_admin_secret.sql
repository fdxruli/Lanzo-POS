-- SECURITY R1: retire the legacy admin dashboard RPC's embedded shared secret.
--
-- The signature is intentionally retained for compatibility while the legacy
-- route is retired. No secret value is copied, inferred, logged, or restored.
-- A future replacement must use an explicitly authorized actor-aware admin
-- surface; this compatibility stub is deliberately fail-closed.

create or replace function public.get_admin_dashboard_data(admin_secret text)
returns json
language sql
security invoker
set search_path = ''
as $function$
  select pg_catalog.json_build_object(
    'success', false,
    'code', 'ADMIN_DASHBOARD_RETIRED'
  )::json;
$function$;

revoke all on function public.get_admin_dashboard_data(text)
  from public, anon, authenticated;

grant execute on function public.get_admin_dashboard_data(text)
  to service_role;

comment on function public.get_admin_dashboard_data(text) is
  'SECURITY R1: legacy dashboard RPC retained for signature compatibility, fail-closed, service_role-only, and free of embedded secrets.';
