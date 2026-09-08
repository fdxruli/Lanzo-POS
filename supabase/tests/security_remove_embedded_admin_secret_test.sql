-- SECURITY R1 contract for the retired legacy dashboard RPC.
-- Catalog-only assertions; no business data or credentials are created.

begin;

do $security$
declare
  v_signature regprocedure := 'public.get_admin_dashboard_data(text)'::regprocedure;
  v_definition text := pg_get_functiondef(v_signature);
  v_search_path text;
  v_response json;
begin
  select coalesce(string_agg(config, ','), '<database default>')
    into v_search_path
  from unnest(coalesce((select proconfig from pg_proc where oid = v_signature), array[]::text[])) as config;

  if (select prosecdef from pg_proc where oid = v_signature) then
    raise exception 'LEGACY_DASHBOARD_MUST_BE_SECURITY_INVOKER';
  end if;

  if v_search_path <> 'search_path=""' then
    raise exception 'LEGACY_DASHBOARD_SEARCH_PATH_NOT_EMPTY: %', v_search_path;
  end if;

  if has_function_privilege('public', v_signature, 'EXECUTE')
     or has_function_privilege('anon', v_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_signature, 'EXECUTE')
     or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'LEGACY_DASHBOARD_GRANT_REGRESSION';
  end if;

  if v_definition !~* 'ADMIN_DASHBOARD_RETIRED'
     or v_definition ~* '(real_secret|vite_license_salt|-----begin[^-]*private key-----|sk_(live|test)_[a-z0-9]+|sb_(secret|service_role)_[a-z0-9]+)' then
    raise exception 'LEGACY_DASHBOARD_SECRET_REPLACEMENT_REGRESSION';
  end if;

  v_response := public.get_admin_dashboard_data(null);
  if coalesce(v_response->>'success', 'true') <> 'false'
     or v_response->>'code' <> 'ADMIN_DASHBOARD_RETIRED' then
    raise exception 'LEGACY_DASHBOARD_NOT_FAIL_CLOSED';
  end if;
end;
$security$;

rollback;
