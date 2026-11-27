# Admin recovery from Solo Staff — R1

Status: candidate prepared on `codex/hotfix-b-staff-safe-exit-20261127`. This migration has not been installed in Supabase Production.

## Migration identity

- Version: `20261127010000`
- File: `supabase/migrations/20261127010000_admin_device_staff_only_recovery_r1.sql`
- SHA-256: `a553e66bf943e7bd304f0d989cf90d4fb3ab4728a866494a2e0daba4dc39bbdd`
- Database change: adds `public.admin_recover_staff_only_device(text,text,text,text,text)`; no table, policy, or existing login function is changed.

## Client compatibility

The change is additive. Existing clients continue calling the existing Admin and Staff RPCs. `admin_login_on_device` continues to reject devices in `staff_only`, and the existing Admin mode-change contract remains unchanged.

The new client calls the recovery RPC only from the Solo Staff login screen. Apply the migration before deploying that client. If the new client reaches an older database, it shows that the server recovery endpoint is unavailable; no device mode or session changes. The owner can retry after the server is updated.

## Installation plan

Run these steps only after separate authorization and after this migration is present on `main`.

### Preflight

1. Confirm the target is project `odlrhijtfyavryeqivaa`, status is healthy, and the recorded latest version is `20261126020000` (or stop and review any intervening migration).
2. Confirm the candidate version is absent from `supabase_migrations.schema_migrations` and `to_regprocedure('public.admin_recover_staff_only_device(text,text,text,text,text)')` is null.
3. Recompute the file hash and compare it with the value above. Confirm the release contains this version only.
4. Confirm the installed dependencies still match the read-only preflight: `public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)`, `public.build_pos_rpc_rate_limited_response(jsonb)`, `private.create_admin_session(uuid,uuid,uuid,text)`, `extensions.digest`, `extensions.crypt`, `extensions.gen_salt`, and `extensions.gen_random_bytes`. Confirm the referenced license, plan, owner, device, Staff session, business profile, and audit columns exist.
5. Confirm `anon`, `authenticated`, and `service_role` have the same `EXECUTE` access to `public.admin_login_on_device` as the candidate expects. Stop if any preflight differs.

### Install and postflight

Apply only the reviewed file through the approved single-migration executor in one transaction, using version `20261127010000` and name `admin_device_staff_only_recovery_r1`. Do not run a broad `db push` or include other pending files. The executor must record that exact version in the migration ledger; stop if it cannot preserve the version. The SQL notifies PostgREST to reload its schema.

Verify the ledger now contains exactly one new version, `20261127010000`. Then check:

```sql
select p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_execute
from pg_proc p
where p.oid = 'public.admin_recover_staff_only_device(text,text,text,text,text)'::regprocedure;
```

Expected: `prosecdef = true`, `proconfig` contains `search_path=""`, the three client-role grants are true, and `public_execute = false`. Verify `admin_login_on_device` still rejects `staff_only`. Run the isolated PostgreSQL contract, browser response-loss recovery, and the owner/device QA flow before deploying the client. Do not change a QA account or business during migration installation.

## Focused rollback

1. Roll the client back first so no active client calls the new RPC.
2. In one transaction, drop only `public.admin_recover_staff_only_device(text,text,text,text,text)` and notify PostgREST to reload its schema.
3. Mark only migration version `20261127010000` reverted in the migration ledger using the approved migration tool; verify it is absent and the RPC no longer resolves.
4. Do not reverse device modes or recreate Staff sessions. A completed owner recovery is a durable, authorized transition; a later mode change must use the existing Admin-authorized flow.

The migration creates no data that needs a table rollback. Dropping the function does not revoke or invalidate Admin sessions already issued by successful recovery.
