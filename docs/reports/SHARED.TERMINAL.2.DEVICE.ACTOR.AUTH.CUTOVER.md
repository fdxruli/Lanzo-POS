# SHARED.TERMINAL.2 — DEVICE + ACTOR AUTHENTICATION CUTOVER

## Status and closeout rule

**SHARED.TERMINAL.2-R1 closeout candidate: PASS**

This is the single permanent SHARED.TERMINAL.2 report. The PASS statement is valid only when the GitHub checks on the **exact commit containing this report** complete successfully with `NEW/CHANGED REGRESSIONS = 0`. If any required same-HEAD check is red, the authoritative status is BLOCKED regardless of this document text.

PR `#209` remains **DRAFT** and must not be merged before independent review.

## Preconditions

- Repository: `fdxruli/Lanzo-POS`
- Existing PR: `#209` — DRAFT
- Branch: `feat/shared-terminal-device-actor-auth`
- Exact post-#208 base: `main@cd67e0d0b299cbef1f299e5a3414a3cefe5d3a39`
- R1 starting remote HEAD verified before modification: `614432344abf00c2a776a666395f62cf203dcc3c`
- No new branch or PR was created.
- No merge, rebase, tenant redesign, actor-specific database, cash transfer, cart migration, or draft migration was performed.

The Phase 1 architecture remains authoritative:

- TenantRuntime owns one physical `LanzoDB_t_<opaque-id>` per tenant.
- ActorRuntime is separate and owns actor identity/session/generation.
- `device_mode` is `admin_only | staff_only | shared`.
- device token and actor session token are distinct authorities.
- ambiguous Admin + Staff evidence fails closed.
- no device is automatically promoted to `shared`.

## Independent-review findings corrected by R1

Independent review blocked the original closeout for two concrete reasons:

1. six candidate-only `imageUploadService.test.js` regressions after the actor-session security cutover;
2. a legacy Staff occupancy reservation that could survive `staff_only → shared` and falsely return `STAFF_ALREADY_IN_USE` after the Staff session ended.

R1 corrects only those closeout blockers and their permanent regression evidence.

---

## R1 blocker 1 — image upload regressions

### Cause

Production image upload had already been hardened correctly. `imageUploadService` requires all of:

- device fingerprint;
- device security token;
- actor session token.

If secure actor context is absent it fails locally with:

`SECURE_CONTEXT_REQUIRED`

The six historical success tests still configured:

`getActorSessionToken() => null`

and therefore expected successful actor-sensitive uploads without satisfying the new security contract. BASE did not contain that new requirement, so the six failures were legitimate candidate regressions and were not classified away.

### Correction

The production security rule was **not weakened**.

Historical success fixtures now provide an explicit actor session token and assert that the token is sent through the compatibility wire field `staff_session_token`.

Security coverage explicitly preserves:

- missing actor token → `SECURE_CONTEXT_REQUIRED` before Edge invocation;
- rejected/invalid actor token → fail closed;
- `ACTOR_SESSION_AMBIGUOUS` → fail closed;
- wrong-tenant actor evidence → fail closed;
- rejected actor session is never retried without actor authority.

The Edge Function remains the previously deployed hardened `authorize-image-upload` v8 contract using canonical actor context. No fallback to device-only authority was introduced.

### Result

The six original image-upload candidate regressions were removed without modifying production authorization to accommodate legacy tests.

`SECURE_CONTEXT_REQUIRED` remains part of the client contract.

---

## R1 blocker 2 — Staff occupancy after `staff_only → shared`

### Production investigation

Production project: `odlrhijtfyavryeqivaa`

The production audit inspected:

- `staff_login_on_device`;
- `staff_login_on_device_unlimited`;
- `admin_set_device_mode`;
- `license_devices`;
- `device_role`;
- `device_mode`;
- `staff_user_id`;
- `license_staff_sessions`;
- logout/revoke behavior;
- Staff deactivation behavior;
- the unique Staff-device reservation index;
- all `STAFF_ALREADY_IN_USE` consumers found in the installed contract.

The modern active-use check was already correct: an unrevoked, unexpired `license_staff_sessions` row on another active device is the primary evidence that Staff is currently in use.

Two legacy reservations still ignored `device_mode`:

1. `staff_login_on_device_unlimited` also treated an active `license_devices` row with matching `staff_user_id` and legacy `device_role='staff'` as occupied;
2. `uq_license_devices_one_active_device_per_staff` uniquely reserved `staff_user_id` on active legacy Staff-role devices regardless of whether the terminal had since become `shared`.

`admin_set_device_mode` intentionally preserves historical `device_role` and `staff_user_id`, while Staff logout revokes the session rather than erasing device history. Therefore a legitimate `staff_only → shared` transition could leave stale dedicated-device semantics even though no Staff session remained active.

### New policy

Active Staff sessions remain the primary active-occupancy authority.

Legacy `staff_user_id` reservation remains only when the device is an active dedicated terminal:

`device_mode = 'staff_only'`

A `shared` terminal may retain legacy `device_role='staff'` and `staff_user_id=X` as historical compatibility metadata, but those fields no longer reserve Staff X after the real Staff session is revoked or expires.

This preserves dedicated-device compatibility without granting exclusivity semantics to shared historical metadata.

### New additive migration

`supabase/migrations/20260818234329_shared_terminal_staff_occupancy_fix.sql`

Production apply: **PASS**

Post-apply verification: **PASS**

The migration:

- fails closed if existing production data already violates the new dedicated `staff_only` uniqueness invariant;
- changes only the legacy reservation predicate inside `staff_login_on_device_unlimited` from physical legacy role to `device_mode='staff_only'`;
- verifies the active-session check remains installed;
- recreates `uq_license_devices_one_active_device_per_staff` with a `staff_only` predicate;
- preserves the existing public wrapper/helper grant split;
- performs no device/session deletion;
- performs no `staff_user_id` cleanup;
- performs no automatic shared conversion;
- performs no ID change and no financial-state mutation.

Production post-apply evidence confirmed:

- active-session guard present: YES;
- `staff_only` legacy guard present: YES;
- old `device_role='staff'` occupancy guard absent: YES;
- unique index uses `device_mode='staff_only'`: YES;
- unique index contains no `device_role` authority: YES;
- duplicate active dedicated Staff reservations: 0;
- no persistent fixture/data cleanup was required.

## Staff occupancy integration evidence

A transactional integration fixture was added at:

`supabase/tests/shared_terminal_staff_occupancy_test.sql`

The same fixture logic was executed against production inside `BEGIN ... ROLLBACK`; all synthetic writes were rolled back.

Validated scenarios:

### A — dedicated legacy `staff_only`

Active dedicated Device A with Staff X reservation; Staff X login on Device B:

`STAFF_ALREADY_IN_USE`

**PASS**

### B — `staff_only → shared`

Staff X logs into A, authorized mode transition changes A to `shared`, Staff X logs out, historical `device_role/staff_user_id` remain, then Staff X logs into B:

**PASS**

No false legacy reservation remains.

### C — shared with legacy Staff metadata

Shared A retains legacy `device_role='staff'` and `staff_user_id=Staff X`, with no active Staff session. Staff X login on B:

**PASS**

### D — real active Staff session

Shared A has a real unrevoked Staff X session. Staff X login on B:

`STAFF_ALREADY_IN_USE`

**PASS**

The product continues to enforce one active Staff session across devices.

### E — actor change on the same shared terminal

Staff X logs out of shared A; Staff Y logs into that same A:

**PASS**

Staff Y does not inherit Staff X authority, and the preserved historical device metadata is not silently reassigned.

---

## Actor authority invariants preserved

R1 does not replace or fork ActorRuntime.

The existing regressions continue to cover:

- `admin_only + Staff` → fail;
- `staff_only + Admin` → fail;
- `shared + Admin` → pass;
- `shared + Staff` → pass;
- shared Staff on a device with legacy `device_role=admin` receives Staff permissions only;
- simultaneous Admin + Staff evidence → `ACTOR_SESSION_AMBIGUOUS`;
- residual Admin evidence cannot elevate the Staff actor;
- stale actor generation → `ACTOR_CONTEXT_STALE`;
- wrong tenant → fail closed;
- inactive device → fail;
- inactive Staff → fail;
- invalid device token → fail;
- invalid actor token → fail.

## Same IndexedDB / tenant isolation

No physical-storage architecture changed.

For Admin and Staff on the same tenant:

- same tenant id;
- same opaque tenant id;
- same `databaseName`;
- same physical `LanzoDB_t_<opaque-id>`.

Actor/session/generation change, but the tenant database does not.

Tenant A → Staff A → logout → Tenant B → Tenant A regressions remain in the dedicated workflows, including tenant generation, binding/recovery and runtime routing protections.

No actor from Tenant A may write Tenant B.

## Cash / operational state

R1 performs no cash handoff.

An open cash session owned by Admin A remains:

- owned by Admin A;
- `actorKey=admin:A`;
- open unless an explicit financial operation changes it.

Logging Staff B into the shared terminal does not transfer, relabel, close, delete, or inherit that session.

ActorScopedStorage for cart/drafts and the complete financial handoff policy remain deferred to later phases.

---

## CI and differential evidence

### Starting blocked HEAD

R1 started from verified remote HEAD:

`614432344abf00c2a776a666395f62cf203dcc3c`

The dedicated repeated differential there reproduced the independent-review finding:

- BASE: `2823 passed / 92 failed / 51 skipped / 2966 total`
- CANDIDATE: six additional image-upload failures
- `NEW/CHANGED REGRESSIONS = 6`

### R1 code-head evidence before report publication

On R1 code HEAD `b4412d298570a067c4c9be8b4fd8d7ffc5cb411a`:

- Shared Terminal Device Actor Auth focused job: **PASS**
  - migration/authority guard: PASS
  - image upload focused tests: PASS
  - device/ActorRuntime focused tests: PASS
  - tenant/recovery: PASS
  - auth: PASS
  - relevant ESLint: PASS
  - `git diff --check`: PASS
  - `npm run build`: PASS
  - `npm run build:store`: PASS
  - `npm run build:store:vercel`: PASS
- Shared Terminal Actor Runtime focused + repeated differential: **PASS**
- PR127 Global Comparison: **PASS**

One SHARED.TERMINAL.2 repeated candidate run observed an unrelated one-repetition `PublicStorePage.siteVersion.test.jsx` `STACK_TRACE_ERROR` while BASE passed that test. It was **not** labeled preexisting and kept that run red exactly as required. A separate ActorRuntime repeated comparison and PR127 comparison on the same code HEAD were green. The report-only final HEAD must therefore be re-run rather than using the earlier green checks as a substitute.

### Final same-HEAD gate

This report path is now included in both Shared Terminal workflow path filters. Therefore the commit containing this report must itself run:

- `Shared Terminal Device Actor Auth Validation`;
- `Shared Terminal Actor Runtime Validation`;
- `PR127 Global Comparison`;
- required additional regression workflows.

The final closeout requirement is:

`NEW/CHANGED REGRESSIONS = 0`

**Final CI result: PASS only when all required checks on this exact report-containing commit are `success`.** The GitHub check state of this commit is the authoritative post-publication evidence; no previous HEAD may be substituted.

---

## Report self-publish / loop protection

The existing ActorRuntime publisher now treats a commit that changes only either permanent Shared Terminal report as report-only.

For a Phase 2 report-only HEAD it:

1. validates the HEAD;
2. detects the sole changed report path;
3. skips report regeneration/publication;
4. must not create another report commit.

Thus this report commit is expected to be the stable final HEAD after its checks complete. If another report commit is produced, R1 closeout is BLOCKED until the loop is corrected.

## Residual/deferred scope

Intentionally not implemented in R1:

- ActorScopedStorage migration for cart/drafts;
- cashStation/full cash-session handoff;
- historical cash reassignment;
- general actor-scoped outbox redesign.

These remain later-phase work and are not allowed to weaken actor authority, tenant isolation, stale-generation protection, or financial ownership in this phase.

## Final disposition contract

R1 can be closed as PASS only if the exact report-containing HEAD proves all of the following in GitHub:

- PR #209 remains DRAFT/open/unmerged;
- `SECURE_CONTEXT_REQUIRED` preserved;
- image-upload new regressions: 0;
- `staff_only → shared` false occupancy fixed;
- dedicated `staff_only` occupancy preserved;
- real active Staff session protection preserved;
- actor ambiguity fail-closed;
- no residual Admin privilege escalation;
- stale actor generation protected;
- same IndexedDB per tenant;
- cash ownership unchanged;
- tenant isolation intact;
- production migration applied and post-apply verified;
- build/lint/diff checks pass;
- Shared Terminal Device Actor Auth Validation passes;
- Shared Terminal Actor Runtime Validation passes;
- PR127 Global Comparison passes;
- repeated differential reports `NEW/CHANGED REGRESSIONS = 0`;
- report-only commit produces no follow-up report commit;
- final HEAD remains stable.

When those same-HEAD conditions are green, the final disposition is:

**SHARED.TERMINAL.2: PASS**

Stop here. Do not begin SHARED.TERMINAL.3. Do not merge PR #209 before independent review.
