# SHARED.TERMINAL.3 — Actor-scoped operational storage + safe handoff

## Status

**VALIDATION PENDING. No PASS claim is made until the exact final remote HEAD completes focused and differential CI.**

## Precondition and base

- Repository: `fdxruli/Lanzo-POS`
- PR #209: MERGED into `main`.
- PR #209 head: `0a3fe466a6fdbf333950e301c4ca6363b1069f92`.
- Post-#209 remote main/base: `06f42bcbbc4282c6f8f5d4e0b9065437d16f19ab`.
- Branch: `feat/shared-terminal-actor-scoped-storage`.
- PR: pending creation at this report revision.
- Merge: prohibited; keep DRAFT.

## Storage classification

### TENANT_SHARED
Products, categories, inventory, batches, customers, business configuration, committed/open/closed SALES records, business history, cash records under the existing financial contract, and tenant-wide product/customer sync work.

### ACTOR_SCOPED
Persisted `useActiveOrders` editing state, `currentOrderId`, unsaved cart, ecommerce POS draft carried by ActiveOrders, restaurant/table editing state carried by ActiveOrders, checkout ownership, actor-sensitive async POS operations, layaway confirmation side effects, and actor-bound sale outbox origin metadata.

### DEVICE_OWNED
Stable device identity, fingerprint/technical identity, device metadata/capability, `device_mode`, and pre-tenant device state. Device identity is never used as cart/draft ownership.

### REQUIRES_POLICY / FAIL-CLOSED
Legacy tenant-scoped ActiveOrders payload, legacy actor-bound sale outbox rows with no actor proof, legacy checkout locks with no actor proof, incompatible checkout ownership, and any future specialized persistent draft not yet classified. Cash handoff is out of scope.

## ActorScopedStorage

Canonical primitive: `src/services/auth/actorScopedStorage.js`.

Binding includes tenant opaque id, tenant database name/generation, stable `actorKey`, actor generation, opaque actor storage id, and cross-tab context token.

Namespace:

```text
lanzo:t:<tenant-opaque>:a:<sha256(tenant + actorKey)>:<logical-key>
```

Initial actor-scoped key:

```text
lanzo-active-orders-storage
```

The raw actor id is not required in the physical storage key.

## Legacy cart policy

Historical tenant-scoped `lanzo-active-orders-storage` is detected as unresolved, physically preserved, never mounted automatically, never assigned to the first/current actor, and never deleted by logout.

No new IndexedDB is created and no Dexie schema version is required for actor cart storage.

## Cart and drafts

`tenantScopedZustandStorage` routes ActiveOrders persistence through ActorScopedStorage. Admin A, Staff B, Staff X and Staff Y therefore persist different editing namespaces inside the same tenant runtime.

DB-only open SALES remain tenant-shared business records. They are not retained automatically in another actor's persisted editing set; an actor can still explicitly open a valid shared order by id.

Ecommerce POS drafts and restaurant editing state represented inside ActiveOrders inherit actor scoping. Modal-only checkout/payment/discount values remain ephemeral rather than gaining a new persistent store.

## Handoff

Before GRANTED the bridge validates session + TenantRuntime, enters HANDOFF_CHECK, installs operational guards, inspects durable checkout ownership, rejects pending/incompatible work, prepares actor storage with writes suspended, hydrates that actor's state, grants the actor, rebinds same-actor checkout ownership to the new generation, activates actor storage, then resumes writes.

Failure leaves ActorRuntime locked and actor storage non-writable.

## Generation and async writes

Actor-sensitive operations capture the starting actor handle. Tracked operations revalidate before/after async work and before guarded writes. Old handles fail with `ACTOR_CONTEXT_STALE` after logout/generation change.

Covered paths include ActiveOrders async actions, legacy OrderStore async actions, background batch resolution, checkout sale processing, split bill and layaway confirmation. Batch resolution also captures the original order id instead of consulting a later current cart.

## Checkout / restart

A successful checkout lock records `checkoutActorKey`, `checkoutActorGeneration` and `checkoutLockedAt` on the existing SALES row. On later authentication:

- same actorKey may reauthenticate and rebind to the new generation;
- a different actorKey is blocked;
- a legacy locked row with no actor proof is unresolved and blocked.

`processSale` uses the checkout owner's handle when present, so a later currentActor is never substituted for checkout ownership.

## Multi-tab

Actor storage publishes a per-tenant context token using localStorage plus BroadcastChannel. A foreign actor context makes the old tab stale and locks that tab's ActorRuntime. The old tab does not publish a competing lock context in response, avoiding cross-tab invalidation ping-pong.

## Outbox / origin actor

Actor-bound sale outbox rows capture origin at enqueue: actor type/id/key/generation plus ownership status. Idempotent retry never rewrites origin. Older actor-bound rows without proof stay physically present but are excluded from automatic pending transport. Tenant-wide product/customer work remains processable.

Origin ownership is separate from whatever current session may later provide transport authority.

## Cash

Cash code is unchanged. Existing cash repositories keep their financial actor/session contract. This phase does not auto-close, reassign, delete, or create cash ownership because ActorScopedStorage mounted.

## IndexedDB / tenant isolation

Physical database selection remains a TenantRuntime responsibility using `LanzoDB_t_<tenant opaque id>`. No actor database is introduced. Tenant generation, physical binding, recovery, stale tenant handles, tenant storage and worker routing remain superior isolation layers.

## Supabase

**UNTOUCHED.** No production DDL, migration, data mutation, cash reassignment, or actor-id mutation was required.

## Tests and CI

Focused tests cover cart isolation/restoration, legacy cart no-claim, opaque namespace, stale handles, pending async barrier, stale guarded writes, persisted checkout ownership after restart, legacy checkout fail-closed, same-actor checkout rebind, actor session ambiguity, immutable outbox origin, legacy actor-bound outbox HOLD, and tenant-wide outbox continuity.

The dedicated workflow also runs POS hook tests, tenant/recovery, auth/shared-device, cash regression, relevant ESLint, `git diff --check`, `npm run build`, `npm run build:store`, and `npm run build:store:vercel`.

BASE is exact SHA `06f42bcbbc4282c6f8f5d4e0b9065437d16f19ab`. BASE and CANDIDATE are each executed twice by the full-suite workflow and compared with the existing differential comparator.

Current evidence:

- focused validation: PENDING
- BASE repetitions: PENDING
- CANDIDATE repetitions: PENDING
- NEW/CHANGED REGRESSIONS: PENDING

## Risks / deferred

- No user-facing recovery/claim UI is added for legacy ambiguous cart; data remains preserved and hidden fail-closed.
- Legacy actor-bound outbox rows without proof remain held pending an explicit recovery policy.
- Cash handoff is not implemented; any transfer/reassignment semantics require a dedicated financial phase.
- Future specialized persistent drafts must register with the canonical actor-scoped primitive.

## Closure state

```text
SHARED.TERMINAL.3:
VALIDATION PENDING
```

Do not merge. Do not start SHARED.TERMINAL.4.
