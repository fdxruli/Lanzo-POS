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

`NOT_APPLICABLE` is planning/test-only and never authorizes a future copy. A
future RECOVERY.2/4 executor must require all of: a `COMPLETE` browser-storage
inspection, `executableForFutureCopy === true`, a revalidated
`sourceSnapshotFingerprint`, and a revalidated `recoveryContextFingerprint`.
Missing inspection is represented as `UNVERIFIED`, fails closed, and changes
the source fingerprint relative to an otherwise identical `COMPLETE` snapshot.

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

## RECOVERY.2A — destination control plane only

RECOVERY.2A adds a separate `LanzoRecoveryControl` IndexedDB database. It
contains only opaque destination-directory metadata, alias tokens and durable
recovery journals; it stores no business rows, old outbox payloads, raw tenant
aliases, license keys, license IDs, business names or device identifiers.

The stable logical `tenantDatabaseId` is random and opaque. The directory maps
only domain-separated alias tokens to it, so a compatible key-only session may
later enrich the same namespace with a license-ID token only when a durable
alias already matches. Tokens retain only their alias class (`license_id` or
`license_key_sha256`), so compatibility follows #189's per-class overlap rule:
a shared key cannot attach a conflicting license ID, and a shared ID cannot
attach a conflicting key. Incompatible or unclassified durable metadata fails
closed without changing the directory. No business, device, company or
similarity heuristic participates.

The reserved destination is named `LanzoDB_t_<opaque-id>` and is deliberately
empty in this phase. The current POS Dexie schema remains owned by the existing
LanzoDB1 runtime, so RECOVERY.2A does not duplicate or refactor it. A later,
separately reviewed schema-factory phase must establish canonical reuse before
any tenant destination receives business stores or rows. Opening an existing
destination verifies that it has zero object stores. A nonempty namespace is
preserved unchanged and marks its journal `FAILED_RESUMABLE`; RECOVERY.2A
never deletes, upgrades or rewrites it.

Every resume re-inspects the physical destination before trusting a persisted
`DESTINATION_READY` journal. The reservation shape is native IndexedDB version
`1` with zero object stores. A missing, nonempty or version-mismatched
destination fails closed and transitions the journal to `FAILED_RESUMABLE`;
RECOVERY.2A never repairs or recreates it automatically on resume.

`RecoveryRunJournal` is mutable control metadata, distinct from the immutable
RECOVERY.1 plan. Its states are `CREATED`, `DESTINATION_NAMESPACE_RESERVED`,
`DESTINATION_READY`, `FAILED_RESUMABLE` and `CANCELLED`. It persists opaque run
and tenant destination IDs, plan version and both fingerprints. Resume
re-resolves the tenant and fails closed on
`RECOVERY_SOURCE_SNAPSHOT_CHANGED` or `RECOVERY_TENANT_CONTEXT_CHANGED` rather
than altering an old journal to match.

RECOVERY.2A requires a current plan with COMPLETE browser-storage inspection,
`executableForFutureCopy === true`, no bound source and no unknown store. The
control DB and empty destination namespace may write their own infrastructure
metadata; LanzoDB1 remains read-only and untouched. RECOVERY.2A DOES NOT
RECOVER BUSINESS DATA, copy rows, activate a destination, replay outbox, sync,
call RPCs or reconcile cloud data.

## RECOVERY.2B — canonical destination schema foundation

RECOVERY.2B advances only an already-reserved RECOVERY.2A namespace from the
empty native v1 shape to the current canonical Lanzo Dexie schema. It reuses
the historical `LanzoDatabase` declarations and
`registerCanonicalDexieExtensions()` through a named schema factory; it does
not keep a second hand-written store/index registry. Production keeps its
existing `LanzoDB1` singleton, middleware and write hooks. The named factory
declares schema only and does not install those operational hooks on the
destination.

The durable journal moves forward only as:

`DESTINATION_READY` → `DESTINATION_SCHEMA_INSTALLING` →
`DESTINATION_SCHEMA_READY`.

Before installation it rechecks the tenant, immutable RECOVERY.1 plan, source
and context fingerprints, plus the physical v1/zero-store reservation. After
installation it independently verifies the current canonical native version,
the full physical store/index/key shape and that every store has zero rows.
It persists only a domain-separated structural schema fingerprint, canonical
Dexie/native versions and no tenant data.

A `DESTINATION_SCHEMA_READY` journal is never authoritative by itself: every
resume re-inspects the physical database and compares its descriptor with both
the current code descriptor and persisted fingerprint. Code schema drift,
unknown stores, index/key/version changes or any row fail closed without
repair, deletion, clearing or activation. An interrupted installation resumes
only when the destination is still either the original empty v1 reservation or
the complete canonical empty schema. RECOVERY.2A refuses to regress an
advanced RECOVERY.2B journal.

RECOVERY.2B DOES NOT COPY BUSINESS DATA, create a tenant binding, write sync
metadata/outbox records, activate the destination, redirect the POS runtime,
or make network, Supabase, sync or RPC calls.

## RECOVERY.2C — deterministic copy manifest and execution precheck

RECOVERY.2C does not copy a business row. It re-reads the legacy vault through
the existing native readonly adapter, revalidates the immutable source and
tenant-context fingerprints, revalidates the empty canonical destination, and
creates an in-memory execution projection using only existing RecoveryPlan
rows. A copy item requires both `PROVEN_DIRECT` or `PROVEN_RELATIONAL` and
`COPY_IF_PROVEN`; this phase creates no ownership proof. Tier-A `sync_outbox`
rows remain quarantined, and cloud-reconcilable, ambiguous, foreign, derived,
operationally ignored and vault-only rows are never automatic copy items.

The control journal advances only as `DESTINATION_SCHEMA_READY` →
`COPY_MANIFEST_BUILDING` → `COPY_MANIFEST_READY`. It persists redacted
fingerprints, counts and store summaries, never source keys, tenant aliases or
business payloads. The manifest fingerprint is domain-separated and excludes
timestamps and destination random identity. A zero-item manifest is valid and
represents a successful fail-closed result for mixed historical topology.

Every resume rebuilds and compares the projection against the supplied plan.
Source/context drift, destination schema or row changes, policy-projection
drift, opaque ref collision or a changed persisted manifest fail closed.
RECOVERY.2A and RECOVERY.2B refuse later manifest states without mutating the
journal or destination. RECOVERY.2C does not create binding, write destination
business data, initialize sync metadata, replay outbox, activate the POS
runtime, perform cloud reconciliation or use network/RPC/Supabase.

### RECOVERY.2C-R1 — durable manifest lock

The first fully revalidated manifest is durably locked, using only its
redacted fingerprint, version and count summaries, in the same control-plane
transition to `COPY_MANIFEST_BUILDING`. Both `COPY_MANIFEST_BUILDING` and
`COPY_MANIFEST_READY` therefore refer to one immutable manifest candidate.
Every later resume rebuilds the manifest and requires an exact match with the
lock before it can continue. A source, policy or execution-projection drift
remains fail-closed across repeated retries; it cannot replace the prior
candidate, including after `FAILED_RESUMABLE`. Failures before a lock exists
remain safely retryable once their underlying readonly prerequisite is fixed.

Manifest and execution-projection data are deeply immutable after hashing.
Any duplicate opaque ref among primary provenance rows now fails closed even
when its redacted fields happen to match. The intentionally repeated
`quarantined` compatibility summary is ignored only when its store, action and
tier exactly match its primary row; an incompatible summary ref is a collision.
RECOVERY.2C-R1 still persists no copy rows, refs, source keys, tenant aliases
or business payloads, and performs no business-data copy.

### RECOVERY.2C-R2 — advanced manifest lock integrity

`COPY_MANIFEST_BUILDING` and `COPY_MANIFEST_READY` are valid only with a
complete durable manifest lock: version, fingerprint, item count, store counts,
excluded counts and recompute summary. Zero items and empty count objects are
valid lock values. A missing or partial lock in either advanced state fails
closed and cannot be reconstructed from current policy or source data. The
resulting structural failure remains sticky when represented as
`FAILED_RESUMABLE` for the copy-manifest stage, while failures that occur
before any lock is calculated remain safely retryable. No reset, repair or
automatic replacement path exists in RECOVERY.2C-R2.
