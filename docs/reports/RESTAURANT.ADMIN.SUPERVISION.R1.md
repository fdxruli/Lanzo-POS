# Restaurant administrative supervision r1

Draft stacked on #338. Initial parent: `fb17e9a43929d54087ab937cb760a8cd6e087c36`;
observed main: `2457c1716eb4b001b720743d15fd3f6761226ad0`.
No merge, production migration, or deployment promotion is part of this change.

## Authority and audit

The deployed definitions of `validate_pos_sync_context`, the financial dispatcher,
R2B financial authorization, split settlement, shared parent lock, restaurant
serializer, upsert, close, cancellation, public financial wrappers and their ACLs
were inspected through read-only `pg_proc` queries before editing.
The deployed POS context explicitly validates an Admin or Staff session and
rejects absent, ambiguous, expired, inactive or mismatched credentials. Device
role and absence of a Staff id do not grant administrative authority.

Ecommerce references: `ecommerceOrderCapabilities.js`,
`ecommercePosDraftServiceBase.js` and `EcommerceOrdersPage.jsx`. Restaurant adopts
captured actor/session/tenant authority, confirmations and recovery boundaries.
It does not release or reclaim physical inventory holds like an Ecommerce draft.

The canonical owner is the server's `created_by_staff_user_id`. A legacy null
owner, including an Admin-created table, never grants Staff mutation rights.
Historical creator fields are immutable in SQL. The local device fingerprint
is stored separately from the server's license-device UUID.

| Actor | Review | Edit / send | Checkout / split | Cancel |
|---|---|---|---|---|
| Owning Staff, origin device | POS permission | POS, current parent version | POS, atomic settlement | Refunds, origin device |
| Owning Staff, another device | POS permission | Blocked: origin holds | POS, atomic settlement | Blocked: origin holds |
| Foreign Staff | POS permission | Denied | Denied | Denied |
| Authenticated Admin, origin | Allowed | Version and intervention reason | Atomic settlement | Reason, confirmation, version |
| Authenticated Admin, another device | Allowed | Blocked pending inventory contract | Atomic settlement | Audited server cancellation |
| Legacy null owner | Staff review | Staff denied | Staff denied | Staff denied |
| Free/local without Cloud parent | Existing local permissions | Existing local behavior | Existing local behavior | Existing local behavior |

Cloud capabilities are returned by an authenticated RPC, bound to actor,
session, tenant, generation and table version. Each operation revalidates before
writing; SQL remains authoritative. Missing capabilities fail closed. Known Cloud
parents cannot use an offline local settlement fallback. Free/local creation and
editing do not acquire a Cloud owner requirement.

`restaurant_table_interventions` is a private RLS-enabled audit ledger recording
license, table, authenticated actor/session/device, operation, expected version,
reason, idempotency key and durable result. Browser roles cannot write it.
The dispatcher records successful normal/credit/inventory/split settlements;
upsert and cancellation record their own successful interventions. Idempotent
retries return their existing result without a second audit/effect.

## SQL boundaries

Migration: `20261010013258_restaurant_admin_supervision_r1.sql`.
`HOLD_SQL_DEPLOYMENT_APPROVAL`: it has not been applied to an application database.

All normal, inventory, credit and split financial routes check the table owner
before their effects. Existing public/legacy leaf routes also require a private
transaction-bound settlement permit for known restaurant parents. That permit
requires the locked parent and captured session; browser payloads cannot create
it. The shared advisory lock and parent `FOR UPDATE`, version check, financial
ledger and cash-session rules remain in place. Upsert uses the same shared lock,
requires a parent version on updates, refuses terminal reopening, preserves
creator and local/sale identity, and rejects cross-parent line-id collisions.
The separate Kitchen operational RPCs retain their Kitchen role contract;
they do not confer POS editing or financial authority over another Staff's table.

Admin remote cancellation writes no inventory delta on the viewing device.
It stores a confirmed receipt; shadows close without releasing holds, while
origin reconciliation releases origin reservations exactly once. Ambiguous
responses do not trigger destructive replay or speculative stock changes.

## Isolated SQL reproduction

Use an empty, dedicated PostgreSQL database named
`lanzo_admin_supervision_fixture`, on `127.0.0.1`, with `PGPORT`, `PGUSER` and
`PSQL_BIN` configured. Run:

```text
node scripts/supabase/restaurant-admin-supervision-test.mjs --isolated-fixture
```

The harness refuses other database names, non-loopback hosts and nonempty
schemas. It loads the existing cancellation fixture, the isolated auth/context
fixture and the complete migration. It executes actual capability, ownership,
upsert, cancellation, dispatcher, shared lock and bypass-rejection functions.
Authentication and final financial leaf effects are controlled fixture doubles;
this is not a claim of integrated Supabase authentication or production
inventory/credit accounting QA.

PostgreSQL 17.11: PASS for authority/bypass/version checks and seven real
multi-session races: checkout/checkout, checkout/cancel, cancel/checkout,
split/checkout, cancel/split, cancel/cancel, cancel/edit. Each produces at most
one effect and one audit entry, preserves the creator and leaves no permits.

## Automated matrix and remaining integrated QA

| Cases | Automated evidence |
|---|---|
| A01–A03 | Capability tests; actual SQL own upsert and checkout; split service tests |
| A04–A08 | Capabilities; SQL foreign Staff denied for edit, cancel and every financial route; checkout hook denial before lock/payment |
| A09–A11 | SQL Admin checkout/split/cancel; verified remote capabilities; administrative cancel receipt tests |
| A12 | Remote edit explicitly `BLOCKED_PENDING_INVENTORY_CONTRACT`; same-origin edit retains existing inventory reconciliation |
| A13–A14 | SQL terminal checks; hydration/preflight terminal rejection; upsert cannot reopen a paid/cancelled table |
| A15–A16 | Real multi-session SQL race; direct R2B and legacy settlement permit rejection |
| A17–A18 | Expired/missing SQL session; stale actor/tenant bindings; deferred checkout response rejected after handoff; cancel stale-response tests |
| A19–A21 | Exact parent-version preflight and SQL checks; stale QuickCaja target; unchanged-commercial Kitchen transition tests |
| A22–A24 | Actual cancel/edit race; Cloud/Dexie hydration and reservation integration tests; two tables sharing stock/batches/recipes; receipt recovery |
| A25–A26 | Free-only Dexie discovery, local cancellation/checkout and explicit Free legacy capability test; null Cloud owner denies Staff |
| A27–A28 | Authority uses authenticated actor, independent of legacy device role; SQL cross-license/invalid session checks and tenant tests |
| A29–A30 | SQL cancellation retry/audit uniqueness; financial ledger and flexible split/credit service regression tests |

These checks do not substitute for manual QA of valid Admin and Staff sessions
on two real devices with the migration installed in an authorized staging
environment. Before merge, run all A01–A30 interactively, including Admin login
on a Staff/shared terminal, QuickCaja handoff, Kitchen transitions during a
payment, recipe/batch changes, lost responses, stale Dexie reconnect, origin
cleanup after remote cancellation, and complete cash/Fiado accounting effects.
Check dialogs, keyboard/focus behavior and narrow screens on the final Preview.

## Separate plan for remote editing

1. Introduce a durable server reservation ledger keyed by license, parent,
   stable line, product/batch/recipe component and reservation revision.
2. Apply an edit delta under the existing shared settlement lock and exact
   parent version; reserve/release stock and record the audit in one transaction.
   Preserve historical line identity and Kitchen cancellation evidence.
3. Return a durable idempotent receipt. Origin devices reconcile acknowledged
   deltas/revisions without reconstructing or releasing another table's holds.
4. Test additions/removals, partial Kitchen cancellation, recipes, batches,
   offline origin, response loss and edits racing checkout/split/cancel with real
   financial/inventory functions in staging.

Do not enable remote product editing until that contract and integrated QA pass.
Required CI gates remain unchanged; no assertions or timeouts were relaxed.
