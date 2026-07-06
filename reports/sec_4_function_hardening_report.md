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

Contract preservation checks:

```txt
anon_execute_public_functions                = 87
authenticated_execute_public_functions       = 87
verify_device_license_unified anon           = true
verify_device_license_unified authenticated  = true
save_business_profile_secure anon            = true
```

## Non-goals / exclusions

- Did not modify Supabase-managed internal `realtime` functions.
- Did not rewrite admin function bodies or expose embedded administrative secrets in repository migrations.
- Did not alter approved frontend RPC contracts for `anon`/`authenticated`.

## Status

SEC.4 is applied and verified in Supabase production.
