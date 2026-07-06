# FASE SEC.4 — Function hardening report

## Scope

Audited and hardened SQL/PLpgSQL functions in the `public`, `private`, and app-owned `realtime` surface after SEC.1, SEC.2, and SEC.3.

Focus areas:

- `SECURITY DEFINER` search path safety.
- Residual `EXECUTE` grants to `PUBLIC`, `anon`, and `authenticated`.
- Accidental exposure of private/helper functions.
- App-owned function ownership consistency.
- Views/materialized views with client grants.

## Production migrations applied

Applied in Supabase project `odlrhijtfyavryeqivaa`:

- `20260706082151_sec_4_function_definer_search_path_ownership_grants`
- `20260706082349_sec_4_1_refine_security_surface_audit`

## Changes

- Revoked implicit `PUBLIC` execution on functions in `public`.
- Revoked client execution on all functions in `private`.
- Re-applied defensive revokes for helper-style function names:
  - `_unlimited`
  - `_internal`
  - `_helper`
  - `_legacy`
  - `_unsafe`
- Normalized legacy admin `SECURITY DEFINER` functions to a fixed search path with `pg_temp` last.
- Normalized selected private inventory helpers to a fixed search path with `pg_temp` last.
- Preserved approved public RPC grants for active frontend contracts.
- Added `private.sec4_security_surface_audit()` as a service-role-only audit helper.

## SEC.4.1 — Versionado de auditoría refinada

Durante la verificación se detectó que producción ya tenía aplicada la migración:

- `20260706082349_sec_4_1_refine_security_surface_audit`

Esa migración refinó `private.sec4_security_surface_audit()` para devolver hallazgos detallados con:

- `check_name`
- `severity`
- `schema_name`
- `object_type`
- `object_name`
- `identity_args`
- `detail`

La corrección SEC.4.1 agrega el archivo versionado:

```txt
supabase/migrations/20260709000001_sec_4_1_refine_security_surface_audit.sql
```

para evitar drift entre GitHub `main` y Supabase producción.

## Production verification

Final audit result:

```txt
private.sec4_security_surface_audit() finding_count = 0
```

Catalog verification:

```txt
function_count                         = 349
security_definer_count                 = 239
unsafe_secdef_search_path_count        = 0
private_client_executable_count        = 0
public_execute_grant_count             = 0
exposed_helper_named_count             = 0
non_postgres_app_owner_count           = 0
```

Function signature and permissions:

```txt
result_type                  = TABLE(check_name text, severity text, schema_name text, object_type text, object_name text, identity_args text, detail jsonb)
proconfig                    = search_path=""
public_execute               = false
anon_execute                 = false
authenticated_execute        = false
service_role_execute         = true
```

Contract preservation checks:

```txt
anon_execute_public_functions                = 87
authenticated_execute_public_functions       = 87
verify_device_license_unified anon           = true
verify_device_license_unified authenticated  = true
save_business_profile_secure anon            = true
```

## Files

- `supabase/migrations/20260709000000_sec_4_function_definer_search_path_ownership_grants.sql`
- `supabase/migrations/20260709000001_sec_4_1_refine_security_surface_audit.sql`
- `reports/sec_4_function_hardening_report.md`

## Non-goals / exclusions

- Did not modify Supabase-managed internal `realtime` functions.
- Did not alter approved frontend RPC contracts for `anon`/`authenticated`.
- Did not apply new DDL to production for SEC.4.1 during this correction; production already matched the refined state.

## Status

SEC.4 is applied and verified in Supabase production. SEC.4.1 versioning drift is corrected in PR #72.
