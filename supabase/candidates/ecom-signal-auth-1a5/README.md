# Realtime FREE pilot 1A.5 — owner approval required

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

The 1A.2–1A.5 backend overlay, pilot allowlist, QA Auth users/sessions, and QA
Edge function remain uninstalled. The latest saved billing Usage baseline is
from 2026-10-22; refresh the current-cycle values and verify the below-70%
gates before any Hosted/Auth/Realtime pilot activity. Keep the kill switch
closed until that check and supervised owner/device QA are complete.

This is a reviewed candidate overlay for the native Supabase Auth bridge from
1A.2–1A.4. It replaces the effective synthetic R2 license-prefix gate with an
exact, server-controlled license/tenant/device allowlist. The R2 migration and
older candidate snapshots remain evidence only; do not install the R2 SQL.

## Production facts captured 2026-10-23

- Project: `odlrhijtfyavryeqivaa` (Lanzo, active, us-east-2, PostgreSQL 17.6.1.063).
- Migration ledger: 324 entries; latest `20261022184218 qa_ecom_bridge_1a4_cleanup`.
- No QA role/schema, Auth user/session, broker function, Vault row, or pilot allowlist exists.
- The six shared SECURITY DEFINER routines still have `PUBLIC EXECUTE`; the
  candidate checks that ACL gate and denies issue, renewal, Auth binding, join,
  and publish until the separate ACL proposal is approved and applied.
- No pilot business/device was selected. A live allowlist row is not included.

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
2. Review consumers of the six exact functions in
   `public-rpc-acl-proposal.sql`. Apply that separate proposal only after
   specific owner approval; `public-rpc-acl-rollback.sql` is its exact rollback.
3. Install and review the previously prepared 1A.2, 1A.3, and 1A.4 candidates
   in their documented order, then `allowlist.sql`, with a postflight after
   each step. Do not edit applied migration history.
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
rollback order. It is candidate documentation, not evidence that the overlay
has been installed in Production.

## Test limits

`scripts/supabase/ecom-realtime-allowlist-1a5.node-test.mjs` checks the source
contract and a local authorization decision matrix. It is **not** a Hosted
Postgres/Auth/Realtime test. The matrix includes positive Admin/Staff fixtures
and each required negative case. Production positive cases remain gated on the
owner's business/device selection, ACL approval, deployed broker, and the
separate physical QA run in the 1A.5 guide.
