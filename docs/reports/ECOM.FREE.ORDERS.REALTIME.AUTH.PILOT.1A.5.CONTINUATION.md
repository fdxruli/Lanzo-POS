# LANZO POS — PR #368 — 1A.5 integration continuation

**Review date:** 2026-10-23
**Initial PR head:** `8425fa779005f77beb13f98d19d74c0de3242687`
**Final PR head:** recorded in the current PR #368 metadata after push.
**Scope:** correct the synthetic R2 license gate, prepare exact allowlist/ACL artifacts, and add an Ecommerce Orders route-scoped Realtime QA diagnostic. This is not a general audit.

## Result

`READY_FOR_OWNER_APPROVALS` for the code and review artifacts. Physical QA is **not ready**: no business/device has been confirmed by the owner, the six shared ACL grants remain unchanged, and no current frontend SHA or broker is deployed. Keep `HOLD_SECURITY` and `HOLD_PRODUCTION_DEPLOYMENT`; do not mark `READY_FOR_OWNER_PHYSICAL_QA`.

No merge, Production Vercel deployment, persistent Supabase DDL, shared ACL change, active allowlist row, Auth user/session, Realtime join, or `qa_probe` was created in this continuation. No staging project or Docker was used.

## Exact production candidates

Read-only verification on the authorized Production project `odlrhijtfyavryeqivaa` found the same two FREE candidates. Both have effective `free_trial` (`Lanzo Local`) plans, active licenses, Ecommerce/Inbox entitlement, and a published portal accepting orders.

| Candidate | Business | License prefix | Device UUID | Mode | Active Ecommerce Staff |
|---|---|---|---|---|---:|
| A — recommended | `tio antonio` | `b36a0a4e` | `6e5c9c16-1fa0-4edf-86da-e70a680c9308` | `admin_only` | 0 |
| B | `Farmacia Gary Chrome` | `dd047a26` | `559f718d-7bfd-4af8-9774-b1c00409a9aa` | `admin_only` | 4 |

Candidate A is the narrower first pilot. Neither SQL evidence nor the active device record proves physical owner control. Owner selection and physical confirmation are still pending. No license, plan, device, or account was changed; no active allowlist entry exists. Staff sessions on B cannot receive through its `admin_only` device mode.

## Code and SQL prepared

- `supabase/candidates/ecom-signal-auth-1a5/allowlist.sql` adds a private exact license/tenant/device allowlist, a fail-closed server kill switch, `free_trial`/`free` entitlement checks, live device/actor validation, and server-only approve/kill/revoke RPCs. It replaces the synthetic-prefix check on the effective 1A.2–1A.4 native-Auth path. It has no seeded allowlist entry.
- The overlay checks the six exact shared RPC signatures and refuses bridge issue/renew/binding/RLS/publish while any `PUBLIC EXECUTE` remains. The ACL proposal and rollback remain separate and unapplied. No receiver role or administrative privilege was granted to bypass that gate.
- [Object manifest](../../supabase/candidates/ecom-signal-auth-1a5/manifest.md) records created/replaced objects and reverse rollback order. The overlay depends on the candidate 1A.2–1A.4 chain. It has not been installed or parsed by Hosted Postgres.
- Native Supabase Auth contract remains: issuer `${url}/auth/v1`, role `authenticated`, `aud`, `sub`, `session_id`, and immutable app-metadata binding. No R2 custom issuer, role, claims, or synthetic JWT was restored.
- The R2 candidate remains evidence only. No QA schema/role, Vault record, server control secret, or broker is currently deployed. New server control RPCs in the candidate Edge handler require the dedicated server-side control token; secret values are not in the frontend or repository.
- The fail-closed rollback first turns on the switch and clears/revokes grants. Then stop the Edge Function, use the 1A.4 collector to verify and remove only tagged Auth inventory, and roll back 1A.4 → 1A.3 → 1A.2. Do not touch migration history with `db push` or migration repair.

## Route mount and #369

The lazy QA diagnostic mounts only under `EcommerceOrdersRuntime` when the user is on `/pedidos-online`, has Ecommerce access, and `VITE_ENABLE_ECOM_SIGNAL_QA === 'true'`. The flag is unset by default. It reuses Actor Runtime capture, canonical actor/session tokens and device security credentials, online/visibility checks, Web Locks, generation checks, and transport cleanup. The receiver subscribes only to `qa_probe`; it never publishes or handles commercial order events. The Admin panel shows safe state, leadership, an abbreviated grant reference, an abbreviated probe reference, and a safe reconcile reason. It does not display JWTs or secrets.

PR #369 merged to `main` on 2026-10-23 as `52bb573e651529b323b6617e3161cd76ece14a39`; its description was stale. This branch was not rebased or merged with #369 and does not duplicate its `App.jsx` changes. The QA mount remains local to Ecommerce Orders, and the adapter releases the transport whenever its canonical runtime capture becomes invalid/LOCKED. Local compatibility checks include invalid actor locks, actor/session replacement, offline resume, stale responses, hidden/frozen pages, callbacks after cleanup, and Web Locks leadership. Full PWA physical resume QA remains NOT RUN.

## Verification performed

| Check | Result |
|---|---|
| Native broker + 1A.5 source/matrix Node contracts | **43/43 PASS** |
| Ecommerce Orders route mount Vitest | **10/10 PASS** |
| Actor adapter Vitest | **17/17 PASS** |
| Focal ESLint, including new UI component | **PASS**; only stale `baseline-browser-mapping` data notice |
| React Doctor on six changed React files | **93/100, no issues found** |
| Deno check for broker entry point | **PASS** |
| `npm run build` | **PASS**; Vite reports pre-existing mixed dynamic/static import chunk warnings |
| `npm run build:store` | **PASS** |
| SQL parser/Hosted overlay, Auth, Realtime, and physical QA | **NOT RUN**; SQL remains a candidate and gates are open |

The Node matrix has positive FREE Admin and Ecommerce Staff fixtures and negative cases for outside allowlist, PRO, entitlement/portal, staff permission, device, sessions, runtime generations, tenant, expiration/revocation, kill switch, PUBLIC ACL, foreign topic, and receiver publish. These are local contract/model tests, **not Hosted tests**.

## Existing CI at initial HEAD 8425…

These remote runs belong to the old PR head, not the final continuation SHA. The next pushed SHA must receive its own CI results.

- **Ecommerce Native Bridge QA — FAIL** ([run 39874309429](https://github.com/fdxruli/Lanzo-POS/actions/runs/39874309429)). Focal broker contracts, Deno, focal lint, admin build, and store build passed. `node --test scripts/supabase/*.node-test.mjs` had one failure in `license-expired-material-downgrade-r1.node-test.mjs`: its source-text assertion forbids `/cash_movements|ledger|counted_cash|closing_counted_amount/`, while an existing migration comment contains “cash”. This test and migration are byte-identical to current `origin/main`; the package manifests also match. The regression artifact reported **1,321/1,331 pass, 10 fail**. The failing cases were: `ecommercePosDraftService maps the server-resolved sourceProductId while excluding customer PII from the draft`; `ecommercePosDraftService opens an existing local draft only when remote prepared identity matches completely`; stale inventory responses replacing a manual selection and recreating a released draft; configurable public products normalization and canonical order arguments; three controlled public checkout error mappings; and idempotent checkout tracking-link preservation. Every affected source/test path is byte-identical to current `origin/main`. These failures are not caused by this continuation; they remain raw failures and were not hidden or edited.
- **PR127 Global Comparison — FAIL** ([run 39874309327](https://github.com/fdxruli/Lanzo-POS/actions/runs/39874309327)). Both PR and base runs emitted `Not implemented: navigation to another Document`; each ended with zero failed tests and 12 cancelled tests. The comparison step received `PR_OUTCOME=failure` and `MAIN_OUTCOME=failure` and failed to classify the cancelled suites, so there is no valid differential PASS to report.
- Vercel’s previous success was for the initial PR head only. It does not certify the continuation SHA, and no Preview or Production deployment was created here.

## Production, usage, and remaining gates

The last known ledger remains 324 entries, latest `20261022184218 qa_ecom_bridge_1a4_cleanup`; no 1A.5 SQL or Edge Function was applied/deployed. The six shared RPC signatures still have `PUBLIC EXECUTE`. `allowlist.sql` intentionally denies all bridge paths while this ACL gate remains open. The separate ACL proposal preserves explicit `anon`, `authenticated`, and `service_role` grants; its exact rollback restores only the six PUBLIC grants.

The last Usage snapshot available is from 2026-10-22: Edge 94/500k, Realtime messages 2,726/2M, peak concurrent Realtime 4/200, Auth MAU 22/50k, DB 94/500 MB, egress 0.12/5 GB, storage 0/1 GB, log ingestion 0.11/1 GB, and log query 9.94/100 GB. It was **not re-read on 2026-10-23**. Do not use it as an activation baseline; reread the Usage panel immediately before any future activation.

Remaining owner actions:

1. Confirm candidate A or B and physical control of that exact device.
2. Review external consumers and approve or reject the separate six-signature ACL proposal.
3. Explicitly accept or reject the residual supervised-QA Auth risk.
4. Review the final SHA and its own CI before any Production deployment; no deployment is performed here.
5. Only after gates, install reviewed candidate SQL in the named production project, review postflight, set dedicated server secrets, deploy the QA broker, approve one expiring allowlist row, capture current Usage, then separately turn off the server kill switch for QA.
6. Run the physical QA-01–22 guide and the fail-closed cleanup/collector sequence. Keep all commercial order signals disabled.

## Repository and PR state

PR #368 remains OPEN/Draft; no merge was performed. The initial head was `8425fa779005f77beb13f98d19d74c0de3242687`; final SHA will be recorded after this continuation commit. No other worktree or untracked user artifact was changed.
