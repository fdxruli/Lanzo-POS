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

RECOVERY.1 creates a deterministic, redacted `RecoveryPlan`. It inspects a
read-only adapter, resolves the active tenant identity in memory and
classifies records. It does **not** recover, copy, activate, delete, rewrite
or bind data. It does not start sync, drain outbox, make RPC calls or mutate
localStorage/sessionStorage.

The only adapter supplied by this phase exposes `readSnapshot()` and uses the
existing native IndexedDB connection in a `readonly` transaction. It
inventories every physical object store, including one not declared by the
Recovery registry, and the canonical tenant-owned localStorage/sessionStorage
keys. Dynamic localStorage prefixes use `length`, `key(index)` and `getItem()`
only. It has no mutation, sync or network operation.

In a browser, localStorage and sessionStorage inspection is mandatory. The
adapter reads the canonical browser sources automatically when they were not
injected. Unavailable or denied storage fails closed with a storage-inspection
error; omission is never treated as empty browser state. Non-browser callers
must explicitly opt into `NOT_APPLICABLE` for tests or tooling.

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
  it is never destination operational work. An unambiguous record proves only
  that historical outbox mutation, never that a current business row with the
  same `entityId` still belongs to that tenant. It therefore cannot promote a
  current product, customer, sale, batch, category or cash row to
  `PROVEN_DIRECT` or start relational propagation.
- `sync_meta`, `company`, conflicts and mixed caches stay in the vault.
- stats are recomputed from future recovered records.
- sequence state is never copied to a new operational database.
- a product batch may become relationally proven only after its parent
  product is proven without conflict.
- an inventory event requires both its sale and product to be proven.
- product membership alone never proves a sale.

## Snapshot fingerprint

The plan includes a source-only `sourceSnapshotFingerprint` as
`sha256:<digest>` for stale-plan detection. The digest is
deterministic over source database identity, native version, physical object
store names/key paths, and every complete physical record. Each record is
canonicalized and contributes an internal domain-separated SHA-256 content
token; its raw value and per-row token are never exposed. The canonicalizer
supports primitives, arrays, sorted plain objects, Date, Blob, ArrayBuffer and
typed arrays. Unsupported structured-clone values fail closed with
`RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED`, rather than being silently reduced.
Relevant localStorage/sessionStorage values contribute only internal digest
tokens. Any material content, browser-state or source-structure change
therefore invalidates the fingerprint. The plan excludes raw license values,
payloads, business names, personal data, tokens, cache contents and conflict
contents.
Browser-storage values and tenant aliases exist only as digest input; the plan
exposes opaque row references and final digests, never their raw contents or
raw tenant identifiers.

The separate `recoveryContextFingerprint` is domain-separated and combines the
source fingerprint with the normalized active tenant aliases. It exposes only
its final digest: it is not a standalone tenant hash. Any future copy or
activation phase must re-resolve the authenticated tenant and require both
fingerprints to be unchanged. A matching vault with a changed context fails
closed with `RECOVERY_TENANT_CONTEXT_CHANGED`.

An already-bound source returns `RECOVERY_SOURCE_ALREADY_BOUND` and is not
eligible for future copying. Unknown physical stores are inventoried with a
safe `PRESERVE_VAULT` policy, emit `UNKNOWN_STORE_PRESENT` and also make a
future copy plan non-executable until the registry is explicitly extended.

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
