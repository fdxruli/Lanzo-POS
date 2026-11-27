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

After separate authorization, inspect the current migration ledger and function grants again. Install this single version through the approved migration runner; do not use a broad schema push for this hotfix. Verify the migration ledger, function signature, `SECURITY DEFINER`, empty `search_path`, and `EXECUTE` grants for `anon`, `authenticated`, and `service_role`; confirm `PUBLIC` has no `EXECUTE`. The migration notifies PostgREST to reload its schema.

Run the isolated PostgreSQL contract test and browser recovery flow before shipping the client. Production QA should confirm the intended owner identity and device against the production release process; no test account or business should be changed as part of migration installation.

## Focused rollback

1. Roll the client back first so no active client calls the new RPC.
2. Drop only `public.admin_recover_staff_only_device(text,text,text,text,text)` and notify PostgREST to reload its schema.
3. Do not reverse device modes or recreate Staff sessions as part of code rollback. A successful owner recovery is an authorized, durable device transition; any later mode change must use the existing Admin-authorized flow.

The migration creates no data that needs a table rollback. Dropping the function does not revoke or invalidate Admin sessions already issued by successful recovery.
