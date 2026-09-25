# Pro → Free lifecycle: invariants and diagnostics

This note documents the final recovery contract shared by the license, device/session, and historical cash flows. It is intentionally narrow: it does not define pricing, billing, or new commercial behavior.

## State sequence

The canonical lifecycle is:

`Pro active → grace_period → expired → materialized Free → device/session reconciliation → owner recovery when required → Lanzo Local ready`.

A later upgrade returns the license to the normal Pro contract. A future downgrade is a **new lifecycle cycle** and must use evidence created by that cycle, not evidence from an older downgrade.

The canonical database lifecycle is derived by `private.license_entitlement_state_v1`. The seven-day grace boundary remains entitled through the exact boundary; materialization is allowed only after the state becomes `expired`.

## Invariants

- Owner identity is not device identity. Device pruning cannot remove the owner account.
- `active_devices <= max_devices`. Free may legitimately have zero active devices; it is not forced to one until an operation needs an active device.
- A device retired by the downgrade loses both current and previous security tokens. Live Admin/Staff sessions on retired devices are revoked in the same plan-limit transaction.
- Owner takeover is available only for an active one-device Free plan, valid owner credentials, and qualifying device-pruning evidence from the **current Free transition**.
- A completed takeover leaves exactly one active Admin device, revokes displaced actor sessions, and is idempotent only for the winning device/event.
- Upgrade to Pro invalidates Free takeover authority. A later Pro → Free cycle cannot reuse an older pruning event.
- Downgrade never closes cash automatically. Historical cash remains open until an explicit owner reconciliation.
- The post-downgrade cash bridge does not re-enable `cloud_cash_sync`. Free remains Free before, during, and after reconciliation.
- Cash bridge eligibility requires current Free, a canonical previous cloud-capable plan, an opening before the current downgrade boundary, canonical OPENED/sync evidence, a current active owner requester, and the same tenant.
- The Local POS does not wait for the pending-cash bridge. Pending cash is informational and may be `unknown` while offline.
- Runtime recovery state is scoped to `license + owner`. A late request from an old tenant/actor cannot publish into the current scope, and takeover-success UI is one-scope transient state.

## Frontend runtime rules

`usePostDowngradeCashPending` owns one shared snapshot and one in-flight request. Concurrent consumers reuse the same request. A generation counter invalidates requests when the scope changes, the app goes offline, or the runtime resets.

Known pending data may remain visible as `offline_known`. Without a prior snapshot, offline state is `unknown`, never a synthetic zero. Reconnect starts one new request for the active scope. Unmounting the final subscriber clears transient state and invalidates stale responses.

The recovery banner consumes takeover success only when its scope matches the authenticated tenant/owner and resets its local dismissed state on a scope change.

## Second-cycle evidence

Migration `20260924211248_license_free_owner_takeover_current_cycle_hardening_r1.sql` binds pruning evidence to the current active Free transition. The helper requires:

- current license status `active`;
- current plan `free_trial`;
- current limit of one device;
- the latest canonical `PLAN_CHANGED → free_trial` transition;
- a qualifying `PLAN_LIMITS_ENFORCED` event produced in that same plan-change transaction with at least one over-limit device blocked.

This prevents a pruning event from cycle 1 from becoming usable again after `Free → Pro → Free` when cycle 2 did not itself prune a device.

## Financial recovery

The bridge is an exception for historical cleanup, not a Free entitlement. It must not be placed on the Local sales critical path. Explicit reconciliation continues to use the existing row/version locks, idempotency key, financial audit trail, and canonical cash evidence.

## Diagnostics and tests

Use `scripts/supabase/license-pro-free-lifecycle-diagnostic-r1.sql` for a read-only tenant investigation. It intentionally ships with a null parameter. Substitute a license key only in a temporary SQL session and never commit real keys, tokens, or fingerprints.

The cross-phase rollback matrix is `supabase/tests/license_pro_to_free_lifecycle_final_r1_test.sql`. It covers normal Pro, the exact grace boundary, materialization, device/session pruning, owner takeover and retry, token invalidation, no financial mutation before explicit close, bridge reconciliation/idempotency, upgrade, a second Pro → Free cycle, direct Free behavior, and cross-tenant non-mutation.

The focal phase tests remain authoritative for their internal contracts; the final matrix connects them rather than duplicating every assertion.
