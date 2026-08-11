# Local tenant recovery

## Decision

RECOVERY uses a hybrid model based on a tenant-specific destination database
and an immutable-in-practice legacy vault:

```text
LanzoDB1 (legacy vault, read-only recovery source)
  └─ proven records only → LanzoDB_<opaque tenant identity> (future)
```

`LanzoDB1` is not globally bound to a tenant. A unique Tier-A outbox
candidate proves only the particular business mutations it records; it never
proves ownership of every unscoped legacy row.

## RECOVERY.1

RECOVERY.1 creates a deterministic, redacted `RecoveryPlan`. It inspects an
injected read-only adapter, resolves the active tenant identity in memory and
classifies records. It does **not** recover, copy, activate, delete, rewrite
or bind data. It does not start sync, drain outbox, make RPC calls or mutate
localStorage.

The only adapter supplied by this phase exposes `readSnapshot()` and uses a
Dexie `r` transaction. It has no mutation, sync or network operation.

Plan lifecycle available now:

```text
NOT_STARTED → INSPECTED → PLAN_CREATED
```

Later phases may use `USER_CONFIRMED`, `COPY_IN_PROGRESS`, `VERIFIED`,
`ACTIVATED`, `QUARANTINED`, `FAILED_RESUMABLE` and `CANCELLED`; none is
implemented by RECOVERY.1.

## Evidence tiers and row states

Tiers describe provenance, not permission to migrate:

- Tier A: first-party business-mutation provenance, currently stamped
  `sync_outbox` rows.
- Tier B: durable bootstrap/profile metadata (`company:<license>`, scoped
  `sync_meta`). These are not causally independent.
- Tier C: device/session/cache evidence.
- Tier D: unscoped legacy business data.

Rows are classified with explicit states: `PROVEN_DIRECT`,
`PROVEN_RELATIONAL`, `CLOUD_RECONCILABLE`, `AMBIGUOUS`, `FOREIGN`,
`DERIVED_RECOMPUTE`, `DO_NOT_MIGRATE` and `DEVICE_GLOBAL`.

The registry in `localTenantRecoveryPolicy.js` is the future single authority
for store primary keys, relationships, proof capabilities and destination
action. In particular:

- `sync_outbox` is Tier-A evidence but remains quarantined in the vault;
  it is never destination operational work.
- `sync_meta`, `company`, conflicts and mixed caches stay in the vault.
- stats are recomputed from future recovered records.
- sequence state is never copied to a new operational database.
- a product batch may become relationally proven only after its parent
  product is proven without conflict.
- an inventory event requires both its sale and product to be proven.
- product membership alone never proves a sale.

## Snapshot fingerprint

The plan includes `sha256:<digest>` for stale-plan detection. The digest is
deterministic over sorted store names, primary/relationship identifiers,
record presence, selected status/timestamp metadata and relevant localStorage
key presence. It excludes license values, payloads, business names, personal
data, tokens, cache contents and conflict contents. Identifiers only exist as
digest input; the plan exposes opaque row references, not raw record IDs.

Any future copy phase must re-inspect the vault and require an identical
fingerprint before acting.

## Cloud and offline boundary

RECOVERY.1 only reports `CLOUD_RECONCILABLE`; it performs no cloud lookup.
RECOVERY.3 may later prove an exact local ID through an authenticated tenant
cloud response. Offline/FREE rows without direct or relational proof remain
ambiguous and require assisted recovery.

## Future phases

- RECOVERY.2: tenant-specific destination DB, vault reader and durable journal.
- RECOVERY.3: authenticated exact-ID cloud proof.
- RECOVERY.4: idempotent copy of proven rows and derived-data recomputation.
- RECOVERY.5: assisted recovery/export for ambiguous and FREE/offline data.
- RECOVERY.6: crash, multi-tab, worker, service-worker and replay hardening.

RECOVERY.1 DOES NOT RECOVER DATA.
