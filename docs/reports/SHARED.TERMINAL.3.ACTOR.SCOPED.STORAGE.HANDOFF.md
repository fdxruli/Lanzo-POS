# SHARED.TERMINAL.3 — Actor-scoped operational storage + safe handoff

## Status

**SHARED.TERMINAL.3: PASS — subject to same-HEAD validation of this report revision.**

The implementation source was validated on `147d43bd173efb5b06fc155d927460cfe151314e` with all four required workflows green and the SHARED.TERMINAL.3 repeated differential gate at `NEW/CHANGED REGRESSIONS = 0`. This report commit is intentionally a new final validation target; if any required workflow on the exact commit containing this document is not `success`, the authoritative phase status is **BLOCKED**, regardless of this text.

Do not merge PR #210. Keep it DRAFT. Do not start SHARED.TERMINAL.4.

## Repository / PR / base

- Repository: `fdxruli/Lanzo-POS`
- PR: `#210` — DRAFT
- Branch: `feat/shared-terminal-actor-scoped-storage`
- Starting independently reviewed HEAD for PR210.R1: `8fcac15d46801cbb9ccf8933ea1ee59a18a9e95d`
- Exact SHARED.TERMINAL.3 phase base: `main@06f42bcbbc4282c6f8f5d4e0b9065437d16f19ab`
- PR #209 precondition: MERGED into `main`
- Source-validation HEAD before this report revision: `147d43bd173efb5b06fc155d927460cfe151314e`
- Merge: prohibited

## PR210.R1 correction commits

- `8786b577511290979fb96d84a1c08594ff7d2fa7` — `fix(shared-terminal): require granted actor for operational writes`
- `a9d4f0b1f0c6918b8a173055c4a054c3f9598aa6` — `fix(shared-terminal): preserve actor cart through suspended hydration`
- `2ee4ff85257a5252a386efe900e458967ae0b916` — `test(shared-terminal): close actor storage differential regressions`
- `0955a57e171b5eae27a3042785bf26bc74062fca` — `test(shared-terminal): bind sales fixtures to granted actor context`
- `ab4da8fdfa478001cca8dd3bd62fd2a25629f3a3` — `test(shared-terminal): bind layaway fixtures to granted actor context`
- `9d0a18790daeb05f3b854a29adaf839d8f646cd7` — `test(shared-terminal): keep PublicStore flake observation non-blocking`
- `147d43bd173efb5b06fc155d927460cfe151314e` — `test(shared-terminal): revalidate final actor runtime differential` (empty-tree revalidation commit)

`238bb2f3e0f40cf8112efc65b66450565e39d9d8` was an idempotent SHARED.TERMINAL.1 report-only commit emitted after the successful ActorRuntime revalidation. It changed documentation only. GitHub marked its workflows `action_required` because the HEAD was authored by `github-actions[bot]`; this Phase-3 report revision supersedes that bot HEAD as a human-authored final validation target instead of creating an approve/report/republish loop.

## Storage classification

### TENANT_SHARED

Products, categories, inventory, batches, customers, business configuration, committed/open/closed `SALES` records, business history, and tenant-wide business data remain shared by actors of the same tenant according to permissions.

### ACTOR_SCOPED

Unsaved cart, persisted ActiveOrders editing state, `currentOrderId`, actor-owned ecommerce/restaurant POS drafts carried by ActiveOrders, actor-owned temporary editing state, checkout ownership metadata, actor-sensitive pending operations, and actor-bound sale outbox origin metadata.

### DEVICE_OWNED

Stable device identity, fingerprint/technical identity, device metadata/capability, `device_mode`, and pre-tenant device state. Device identity is never cart/draft ownership authority.

### REQUIRES_POLICY / FAIL-CLOSED

Legacy tenant-scoped ActiveOrders payloads, legacy actor-bound outbox rows with no actor proof, legacy checkout locks with no actor proof, incompatible checkout ownership, and future specialized persistent drafts not yet classified. Cash handoff remains outside this phase.

## ActorScopedStorage contract

Canonical primitive: `src/services/auth/actorScopedStorage.js`.

A writable handle is bound to:

- tenant opaque identity;
- tenant database name/generation;
- stable ActorRuntime `actorKey`;
- actor generation;
- opaque actor-storage identity;
- cross-tab context token.

Physical browser-storage namespace:

```text
lanzo:t:<tenant-opaque>:a:<sha256(tenant + actorKey)>:<logical-key>
```

The raw actor id is not required in the physical key. Actor identity is never derived from device id, fingerprint, `device_role`, or `device_mode`.

The first canonical actor-scoped logical key is:

```text
lanzo-active-orders-storage
```

## Actor authority bypass — root cause and correction

### Root cause

`runTrackedActorOperationIfGranted(...)` previously treated every non-`GRANTED` ActorRuntime state as permission to execute the callback without an actor handle. Conceptually, `LOCKED`, `AUTHENTICATING`, and `HANDOFF_CHECK` silently downgraded to an unguarded legacy path.

That contradicted the authority model because actor-sensitive callers such as sale processing without a checkout owner, split-open-table operations, and layaway confirmation could reach their callback without captured ActorRuntime authority.

### Corrected contract

The helper remains for compatibility at call sites, but its semantics are now fail-closed:

```text
GRANTED
→ capture canonical ActorRuntime handle
→ track operation
→ revalidate actor/tenant/generation
→ execute

LOCKED | AUTHENTICATING | HANDOFF_CHECK
→ ACTOR_CONTEXT_LOCKED
→ callback NOT executed
```

No parallel authority system was introduced. Strict actor-sensitive paths use the existing ActorRuntime error model and generation fencing.

### Authority regression evidence

Dedicated coverage proves:

- `LOCKED` → rejected, callback not executed;
- `AUTHENTICATING` → rejected, callback not executed;
- `HANDOFF_CHECK` → rejected, callback not executed;
- `GRANTED` → callback executes with captured handle;
- Admin async operation that resumes after logout / later actor generation → `ACTOR_CONTEXT_STALE`, guarded write not executed;
- same actor reauthentication → old generation remains stale; only the newly captured generation is valid.

Real caller contracts around `processSale`, layaway, checkout ownership, ActiveOrders and OrderStore are exercised without weakening financial ownership semantics.

## ActiveOrders persistence — root cause and hydration correction

### Root cause

ActiveOrders is actor-scoped, but `tenantScopedStorage.setTenantStorageItem(...)` routed actor-owned keys into ActorScopedStorage before honoring the outer tenant `writesSuspended` fence.

During logout/tenant invalidation the lifecycle could therefore be:

```text
suspend tenant writes
→ clear ActiveOrders in memory
→ Zustand persistence serializes empty state
→ actor storage is still writable for the transition window
→ valid actor cart overwritten by empty ActiveOrders payload
→ actor storage invalidated
```

This explains the deterministic candidate-only failures where preseeded actor cart state became effectively `{ state: { activeOrders: [] } }`.

### Corrected lifecycle

Tenant suspension is now the outer write fence for actor-routed browser-storage writes and removals:

```text
SUSPEND
→ PREPARE actor namespace (non-writable)
→ HYDRATE actor payload
→ HANDOFF_CHECK / session validation
→ GRANT
→ ACTIVATE actor binding
→ RESUME actor writes
```

Reads needed for PREPARE/HYDRATE remain available while writes are suspended. Empty in-memory reset state cannot overwrite a valid actor payload during logout or hydration.

Logout removes authority, increments generation, suspends writes and clears active in-memory editing state where required, but does **not** silently delete the persisted actor cart.

## Cart / draft isolation results

The persisted ActiveOrders contract now preserves all required ownership behavior:

- Admin A cart is not visible to Staff B;
- Staff X cart is not visible to Staff Y;
- Admin A → Staff B → Admin A restores only Admin A's cart;
- Staff X → Staff Y → Staff X restores only Staff X's cart;
- same actor restart/reauthentication restores that actor's persisted state;
- logout does not silently delete actor storage;
- hydration with writes suspended does not overwrite the persisted actor payload;
- ecommerce/restaurant drafts carried as unsaved ActiveOrders editing state follow the actor namespace.

Committed/open/closed SALES remain tenant-shared business records; actor scoping does not hide legitimate business history.

## Legacy tenant-scoped cart

A historical key such as:

```text
lanzo:t:<tenant>:lanzo-active-orders-storage
```

remains physically preserved and unresolved. It is not mounted as the current actor's state, not auto-claimed by Admin/Staff/first login, and not silently deleted.

No migration assigns ownership without actor proof.

## Handoff / generation / async writes

The handoff barrier remains:

```text
old actor authority blocked
→ generation invalidated
→ actor-sensitive writes suspended
→ pending work / durable checkout ownership inspected
→ new session authenticated
→ HANDOFF_CHECK
→ only the new actor namespace prepared and hydrated
→ GRANTED
→ writes resumed
```

Tracked operations capture their starting handle and revalidate before/after async work and immediately before guarded writes. A stale Admin or Staff operation cannot write under the later actor namespace.

Pending actor-sensitive operations keep HANDOFF_CHECK fail-closed until the barrier is safe.

## Checkout ownership

Existing persisted checkout ownership is preserved:

- `checkoutActorKey`;
- `checkoutActorGeneration`;
- `checkoutLockedAt`.

Same actor may reauthenticate and rebind ownership to a new generation. A different actor fails closed. A legacy lock without actor proof remains unresolved/fail-closed.

No checkout ownership is inferred from the current actor merely because a retry occurs later.

## Multi-tab

Cross-tab actor context fencing remains enabled through the existing localStorage/BroadcastChannel coordination. A stale tab cannot keep a writable old actor handle after another tab completes an incompatible handoff. The implementation avoids invalidation ping-pong.

The persistence correction does not disable cross-tab fencing.

## Outbox / origin actor

Actor-bound sale outbox work captures immutable origin at enqueue:

- `originActorType`;
- `originActorId`;
- `originActorKey`;
- `originActorGeneration`.

Retry under a later Staff/Admin session does not rewrite the origin actor. Legacy actor-bound rows without sufficient proof remain HOLD/fail-closed. Tenant-wide work remains tenant-wide.

## Cash

**UNCHANGED.**

No cash session is transferred, auto-closed, reopened, reassigned or deleted. ActorScopedStorage does not change cashStation ownership or historical financial actor attribution.

## IndexedDB / tenant isolation

Physical database selection remains exclusively TenantRuntime-owned:

```text
LanzoDB_t_<tenant-opaque-id>
```

Admin and Staff of the same tenant continue using the same physical IndexedDB. No `LanzoDB_admin_*`, `LanzoDB_staff_*`, or other actor-specific physical DB is introduced.

Tenant generation, local tenant binding, stale tenant handles, recovery/preflight, worker routing, and tenant isolation remain intact. A → B → A tenant isolation remains a higher-level boundary than actor scoping.

## Supabase

**UNTOUCHED.**

PR210.R1 created no Supabase migration, executed no production DDL, and made no cloud data mutation. No backend change was required for these local ActorRuntime/storage/CI defects.

## PublicStore candidate-only observation

The independently reviewed `8fcac15d...` run observed one candidate-only `STACK_TRACE_ERROR` in:

`src/pages/__tests__/PublicStorePage.siteVersion.test.jsx`

The failing attempt ended at the test timeout boundary (~15 seconds) while the second candidate repetition passed in well under one second and both original BASE repetitions passed.

R1 added repeated focused observation without changing PublicStore business behavior. A later exact BASE run reproduced the same timeout class on the PublicStore site-version test at the 15-second boundary. Subsequent SHARED.TERMINAL.3 full-suite differential evidence also recorded PublicStore failures as BASE-only incidental/baseline-flake observations.

Conclusion: the original PublicStore observation is baseline/environmental timeout behavior, not a SHARED.TERMINAL.3 actor-storage interaction. No PublicStore production logic was changed to make CI pass.

## Historical caller fixture regressions

After production authority was correctly made fail-closed, six historical unit tests failed with `ACTOR_CONTEXT_LOCKED` because they exercised ecommerce sale/layaway business contracts without modeling the newly required ActorRuntime precondition.

The production bypass was **not** restored. Those tests now declare their unit boundary explicitly as an already-GRANTED actor context, while the dedicated authority suite owns LOCKED/AUTHENTICATING/HANDOFF_CHECK/stale behavior. Original ecommerce idempotency and layaway expectations remain unchanged.

## Focused / static / build validation

On source-validation HEAD `147d43bd173efb5b06fc155d927460cfe151314e`:

- ActorScopedStorage tests: PASS
- ActorOperationalHandoff tests: PASS
- Actor authority tests: PASS
- ActorSessionRuntimeBridge tests: PASS
- tenantScopedStorage tests: PASS
- ActiveOrders tenant/actor persistence tests: PASS
- sale + layaway real caller fixture tests: PASS
- actor-origin outbox tests: PASS
- POS cart/draft/checkout/restaurant observation: PASS
- sync/outbox observation: PASS
- tenant isolation/recovery observation: PASS
- auth/shared-device observation: PASS
- cash observation: PASS
- relevant ESLint: PASS
- `git diff --check`: PASS
- `npm run build`: PASS
- `npm run build:store`: PASS
- `npm run build:store:vercel`: PASS

## BASE vs CANDIDATE — exact SHARED.TERMINAL.3 differential

Comparison base remained exactly:

`06f42bcbbc4282c6f8f5d4e0b9065437d16f19ab`

Source-validation run on `147d43bd173efb5b06fc155d927460cfe151314e`:

```text
BASE repetition 1:      2833 passed / 93 failed / 51 skipped / 2977 total
BASE repetition 2:      2833 passed / 93 failed / 51 skipped / 2977 total
CANDIDATE repetition 1: 2858 passed / 92 failed / 51 skipped / 3001 total
CANDIDATE repetition 2: 2858 passed / 92 failed / 51 skipped / 3001 total

NEW/CHANGED REGRESSIONS: 0
STABLE PREEXISTING CANDIDATE FAILURES: 112
PREEXISTING FLAKY CANDIDATE FAILURES: 0
INCIDENTAL/BASELINE-FLAKE OBSERVATIONS: 2
```

The differential gate passed because every candidate failure observation was reproduced with the same normalized error in at least one exact BASE repetition.

## Required workflow evidence on source-validation HEAD

`147d43bd173efb5b06fc155d927460cfe151314e` completed:

```text
Shared Terminal Actor Scoped Storage Validation: PASS
Shared Terminal Actor Runtime Validation: PASS
PR127 Global Comparison: PASS
HOTFIX Dexie Recovery Validation: PASS
```

This report revision must now complete the same same-HEAD checks before the phase is considered finally closed.

## Report self-publish safety

The Fase-1 report publisher is idempotent and excludes report-generation/report-only commits from the generated commit chain. One report-only commit was produced after the clean `147d43bd...` revalidation; its bot-authored HEAD required manual GitHub approval and was therefore not used as the final closure HEAD.

This Phase-3 report is published once through the GitHub connector as a human-authored commit. After publication no second report rewrite should occur. If the final validation detects that another report-only commit moved HEAD, closure reverts to BLOCKED until the exact new HEAD is validated.

## Risks / deferred

- No user-facing claim/recovery UI is added for ambiguous legacy cart; it remains preserved and hidden fail-closed.
- Legacy actor-bound outbox rows without proof remain held pending an explicit policy.
- Cash handoff is not implemented and must not be inferred from ActorScopedStorage.
- Future specialized persistent drafts must use the canonical actor-scoped ownership primitive or remain fail-closed until classified.
- Broader cash handoff / financial ownership work belongs to a dedicated later phase; SHARED.TERMINAL.4 is not started here.

## Closure state

```text
SHARED.TERMINAL.3:
PASS
```

This PASS is authoritative only if the exact commit containing this report has all required same-HEAD workflows green and remains the stable remote HEAD.

**NO MERGE. KEEP PR #210 DRAFT. DO NOT START SHARED.TERMINAL.4.**
