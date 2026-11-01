# Realtime FREE pilot 1A.5 — pilot remains closed pending Usage, secrets, and supervised QA

## Production continuation update — 2026-10-24

The user-authorized shared ACL change for PR #368 is applied and postflight
verified in migration `20261024123634_ecom_realtime_acl_six_rpcs_1a5.sql`.
It revokes only `PUBLIC EXECUTE` from the six routines listed in
`public-rpc-acl-proposal.sql`; explicit `anon`, `authenticated`, and
`service_role` execute grants remain, all six function body hashes are
unchanged, and each routine is executable by five effective roles. See
`docs/reports/evidence/ecom-realtime-auth-1a5/acl-postflight-live-20261024.json`.

Synthetic, rollback-only checks passed for Staff list/create/update, station
state, legacy adoption, and a focused cash-close wrapper case. The broader cash
regression stopped at its sale-before-close reconciliation assertion with
`CASH_TOTALS_CHANGED`; it is recorded separately and is not represented as a
passing full-suite result. No synthetic fixture rows remain.

The 1A.2–1A.5 backend SQL is installed in seven migrations recorded in the
live ledger after the ACL migration (six feature steps and one cleanup). The
singleton kill switch is active;
`pilot_allowlist` is empty; `authority_live` denies the selected device; and
there are zero QA identities, grants, Auth users, or sessions. The private QA
Realtime policy is present alongside the three original policies. The unused
race probe was removed in its own cleanup migration. No QA Edge function or
dedicated secret was deployed.

The latest saved billing Usage baseline is from 2026-10-22. Refresh the
current-cycle values and verify the below-70% gates before any Hosted/Auth/
Realtime pilot activity. Access to the owner's secret manager is also needed
to create and install the five purpose-separated QA secrets described below.
Keep the kill switch active and the allowlist empty until both gates and
supervised owner/device QA are ready. Backend state: `BACKEND_QA_BLOCKED`.

This is a reviewed candidate overlay for the native Supabase Auth bridge from
1A.2–1A.4. It replaces the effective synthetic R2 license-prefix gate with an
exact, server-controlled license/tenant/device allowlist. The R2 migration and
older candidate snapshots remain evidence only; do not install the R2 SQL.

## Historical production snapshot — 2026-10-23

Before the authorized 2026-10-24 execution, the ledger had 324 entries, no QA
schema/role or broker existed, the six shared functions still had `PUBLIC
EXECUTE`, and no pilot business/device had been selected. These facts were
superseded by the production continuation and live postflight recorded above.

## 1A.5 overlay

`allowlist.sql` expects the full 1A.2–1A.4 candidate chain already installed in
the same project. It alters only the private bridge schema and its QA RPCs. It
does not touch `public.licenses`, plans, entitlements, business data, shared
function bodies, or shared ACLs. The private `qa_tenants` table stays empty so
the existing 1A.2 rollback remains available. The migration creates:

- `pilot_allowlist`: exact license UUID, tenant UUID constrained to that
  license, device UUID, approval/revocation state, expiration, QA run UUID,
  approval operator/reference, and administrative metadata.
- `pilot_kill_switch`: defaults to active, and the guard also treats a missing
  row as closed.
- `acl_closed` and `pilot_device_eligible` checks.
- Server-only approve, kill-switch, and pilot-revoke RPCs. Approval records an
  approved row but leaves the global switch active; turning it off is a separate
  server-control action. Both are bounded to `free_trial` (`Lanzo Local`) and
  `license_type='free'`.

All effective routes use the same live guard: prepare/renew, Auth binding,
Realtime SELECT RLS, synthetic publisher, ordinary revocation, owner recovery,
and collector. The existing native Auth issuer, role, `sub`, `session_id`,
`aud=authenticated`, and immutable app-metadata binding remain unchanged. No
R2 issuer, role, or custom JWT is restored.

## Required order and gates

1. Confirm the current production ledger and exact object/ACL diff; never use
   `db push`.
2. The six exact revokes were applied on 2026-10-24 and postflight verified;
   see `docs/reports/evidence/ecom-realtime-auth-1a5/acl-postflight-live-20261024.json`.
   Do not reapply the proposal; `public-rpc-acl-rollback.sql` remains the exact
   ACL-only rollback reference.
3. The 1A.2 foundation/bridge, 1A.3 hardening, 1A.4 lifecycle/collection, and
   1A.5 closed allowlist overlay were applied as separate migrations in order,
   with a postflight after each step. Their exact applied files are in
   `supabase/migrations`. Do not edit applied migration history.
4. Deploy `lanzo-ecom-bridge-qa` only after SQL postflight and dedicated secrets
   are reviewed. Secret names: `LANZO_ECOM_QA_CONTROL_TOKEN`,
   `LANZO_ECOM_VAULT_KEY_ID`, `LANZO_ECOM_VAULT_KEYS`,
   `LANZO_ECOM_PASSWORD_KEY_ID`, and `LANZO_ECOM_PASSWORD_KEY`. Generate new
   purpose-separated values through the owner's secret manager; do not reuse
   `SUPABASE_SERVICE_ROLE_KEY`, and do not add values to Vercel or this repo.
5. The server control header must first approve exactly one selected license,
   tenant, device, QA run, approval reference, and expiry (maximum 24 hours).
   The SQL approval RPC leaves the kill switch on. Capture Usage baseline and
   confirm physical device control before a separate server-control action
   turns the switch off.
6. Production Vercel remains gated by owner approval of the exact frontend SHA.
   Frontend opt-in is `VITE_ENABLE_ECOM_SIGNAL_QA=true`; unset/false is default.
   It mounts only inside `/pedidos-online` after local Ecommerce access passes.
   The backend's exact server-side allowlist and kill switch remain authoritative.

The existing `lanzo-ecom-bridge-qa` Edge function is not deployed in Production.
No Auth Hosted, JWT, Realtime join, or `qa_probe` has run against Production in
this continuation.

## Rollback

Use `rollback.sql` first. It turns on the server kill switch and revokes every
pilot grant in one transaction. Then stop the QA Edge function, run the 1A.4
collector until every tagged Auth user is deleted, verify zero pilot Auth
sessions and no active grants, and apply the original 1A.4, 1A.3, and 1A.2
object rollbacks in reverse order. Keep the ledger untouched and never roll back
the shared ACL proposal without its separate owner approval.

See [`manifest.md`](manifest.md) for the exact 1A.5 object inventory and
rollback order. Exact installed SQL is preserved under `supabase/migrations`;
the ledger and current postflight are recorded in
`docs/reports/evidence/ecom-realtime-auth-1a5/backend-postflight-live-20261024.json`.

## Test limits

`scripts/supabase/ecom-realtime-allowlist-1a5.node-test.mjs` checks the source
contract and a local authorization decision matrix. It is **not** a Hosted
Postgres/Auth/Realtime test. The matrix includes positive Admin/Staff fixtures
and each required negative case. Production Auth/Realtime positive cases remain
gated on a fresh Usage baseline, installation of the five dedicated server-only
secrets, and the supervised physical QA run. The ACL and SQL broker are
installed, but the QA Edge function is not deployed and Hosted Auth/Realtime
has not run.
