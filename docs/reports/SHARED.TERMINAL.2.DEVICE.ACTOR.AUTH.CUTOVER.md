# SHARED.TERMINAL.2 — DEVICE + ACTOR AUTHENTICATION CUTOVER

## Status

**SHARED.TERMINAL.2: PASS**

This report records the implementation and validation of the shared-device actor-authentication cutover. The pull request remains **DRAFT** and must not be merged until independent review is complete.

## Preconditions

- Repository: `fdxruli/Lanzo-POS`
- Phase 1 PR: `#208`
- PR #208 merge: **VERIFIED**
- Exact post-#208 `main` used as base: `cd67e0d0b299cbef1f299e5a3414a3cefe5d3a39`
- ActorRuntime Foundation was verified in that `main` before implementation.
- New branch: `feat/shared-terminal-device-actor-auth`
- New PR: `#209` — **DRAFT**
- No merge was performed.

## Architecture before this phase

The repository already had Phase 1 ActorRuntime authority with the lifecycle:

`LOCKED → AUTHENTICATING → HANDOFF_CHECK → GRANTED`

and protections for stable `actorKey`, actor generation, stale actor handles (`ACTOR_CONTEXT_STALE`), ambiguous actor evidence (`ACTOR_SESSION_AMBIGUOUS`), and ActorRuntime invalidation during logout/handoff.

Tenant isolation remained independently authoritative:

- one tenant/license → one opaque tenant runtime;
- one physical IndexedDB: `LanzoDB_t_<opaque-id>`;
- no actor-specific database;
- local tenant guard/generation protections unchanged.

## Architecture implemented

The cutover explicitly separates:

- **TENANT** — business/license authority;
- **DEVICE** — physical terminal authority;
- **ACTOR** — currently authenticated Admin or Staff identity;
- **SESSION** — credential proving that actor;
- **OPERATIONAL STATE** — cash/cart/drafts/outbox, which are not implicitly transferred during actor changes.

### Device mode contract

`public.license_devices.device_mode` is now canonical:

- `admin_only`
- `staff_only`
- `shared`

Semantics:

- `admin_only`: Admin allowed, Staff rejected.
- `staff_only`: Staff allowed, Admin rejected.
- `shared`: either authenticated Admin or authenticated Staff is allowed, exactly one actor authority at a time.

`device_role` remains as a legacy compatibility field. It is not the actor authority for a shared device.

### Conservative compatibility migration

Existing devices were mapped deterministically:

- legacy `device_role=admin` → `device_mode=admin_only`
- legacy `device_role=staff` → `device_mode=staff_only`

No existing device was promoted automatically to `shared`.

Post-apply production verification confirmed:

- `device_mode` is `NOT NULL`;
- there is no default that can accidentally promote a device;
- the CHECK constraint accepts only the three canonical values;
- automatic `shared` conversions: **0**;
- Admin backfill mismatches: **0**;
- Staff backfill mismatches: **0**.

## Supabase production

Project: `odlrhijtfyavryeqivaa`

Supabase was **TOUCHED**. Three additive migrations were applied in production and then verified read-only.

### Migration 1

`supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql`

Apply: **PASS**

Installed/updated the primary contract:

- `device_mode` column/constraint/backfill/compatibility behavior;
- shared-aware Admin authentication;
- shared-aware Staff authentication;
- canonical actor context in POS validation;
- device authority separated from actor authority;
- actor-derived permissions;
- fail-closed ambiguity;
- authenticated `admin_set_device_mode` operation;
- shared-safe device administration/list/release behavior.

`admin_set_device_mode` was verified as `SECURITY DEFINER` with an empty `search_path` and explicit grants. Mode changes require real Admin session authority; Staff and anonymous clients cannot promote a device to `shared`.

### Migration 2

`supabase/migrations/20260818165736_shared_terminal_legacy_admin_fail_closed.sql`

Apply: **PASS**

An audit found legacy public Staff-management/device-release paths that still treated physical `device_role='admin'` as sufficient Admin authority. They were closed before closeout.

The migration:

- preserves historical public signatures for compatibility;
- makes legacy mutation paths fail closed with `ADMIN_SESSION_REQUIRED`;
- routes canonical Admin overloads through `private.require_active_admin_session`;
- keeps private implementation helpers unavailable to `anon`;
- makes Staff deactivation affect only dedicated `staff_only` devices, never a shared physical terminal merely because the disabled Staff had been linked there.

Post-apply verification confirmed no legacy `device_role` Admin authorization remains in those wrappers.

### Migration 3

`supabase/migrations/20260818170333_shared_terminal_secondary_actor_context.sql`

Apply: **PASS**

A second audit found secondary cloud contexts that still inferred actor behavior from the physical role. A canonical private actor-session resolver was introduced and the following contexts were migrated to it:

- ecommerce authorization;
- support context;
- POS RPC rate-limit context;
- AI usage;
- operational notifications.

These paths now resolve `device_mode + actor session`, preserve Staff permission enforcement, and fail closed on invalid/ambiguous actor evidence.

## Device and actor backend authority

The authoritative POS context now separates device fields from actor fields.

Device authority includes:

- license/tenant;
- fingerprint;
- active device;
- device security token;
- `device_mode` capability.

Actor authority includes exactly one valid actor session and returns canonical fields including:

- `actor_type`
- `actor_id`
- `actor_key`
- `actor_session_id`
- `actor_permissions`

The historical wire parameter `p_staff_session_token` remains for compatibility in several APIs, but on the shared cutover path it transports the current **actor session token**, whether the actor is Admin or Staff.

## Ambiguity / residual tokens

Fail-closed behavior is preserved.

If valid Admin and Staff evidence cannot be disambiguated, the result is:

`ACTOR_SESSION_AMBIGUOUS`

There is no:

- Admin-wins rule;
- Staff-wins rule;
- newest-token rule;
- `device_role` fallback;
- first-token fallback.

The local `getActorSessionToken()` contract also returns no actor token when simultaneous residual Admin and Staff authority is present.

## Permissions

Permissions are derived from the authenticated actor.

Required regression was explicitly verified conceptually and read-only against production helpers:

- device: `device_mode=shared`
- legacy metadata: `device_role=admin`
- current actor: Staff

Result:

- actor resolves as Staff;
- Admin authority is false;
- only Staff permissions are honored;
- cash actor key remains `staff:<staff-user-id>`.

Legacy device metadata cannot elevate Staff.

## Client cutover

Client changes include:

- canonical `deviceModePolicy`;
- Admin-authenticated `deviceModeService`;
- Device Manager UI that displays device capability separately from legacy role metadata;
- Admin-only device-mode mutation;
- Staff routing that evaluates explicit `device_mode` before legacy metadata;
- no inference of a shared actor from `device_role` alone.

Both Admin and Staff login shells retain an explicit profile-selection handoff so a shared terminal can change actor without changing tenant/IndexedDB.

## Storage / Edge Function security audit

A final serverless audit found a P0 bypass in the historical `authorize-image-upload` Edge Function: it could still branch on physical `device_role`, and the old client contained a retry path that could drop the actor credential.

This was corrected before closeout.

### Production deployment

Edge Function: `authorize-image-upload`

Production version: **v8**

State: **ACTIVE**

`verify_jwt=true`

The deployed function now:

- requires an actor session credential;
- calls the canonical `validate_pos_rpc_rate_limit_context`;
- requires canonical `actor_type` and `actor_key`;
- validates canonical `device_mode`;
- does not call legacy `verify_device_license_unified` / `verify_staff_session` to infer actor authority;
- fails closed if actor authority is absent or invalid.

The client no longer retries a rejected image authorization without actor authority.

A legacy test double can return `undefined` even though the runtime contract is token-or-`null`; explicit `null` remains a local fail-closed condition, while any out-of-contract value is still rejected by production Edge v8 unless a canonical actor context is proven. Dedicated tests preserve this distinction without removing or hiding existing tests.

## ActorRuntime / same IndexedDB

Phase 1 ActorRuntime remains the only actor authority.

Regression coverage verifies Admin → logout → Staff within the same tenant keeps:

- same tenant;
- same opaque tenant id;
- same `databaseName`;
- same physical `LanzoDB_t_<opaque-id>`.

The actor changes:

- actor id/key;
- session;
- actor generation.

No actor-specific IndexedDB is created.

## Stale actor protection

The stale-generation regression remains active:

- Admin operation captures generation N;
- Admin logs out;
- Staff authenticates;
- generation advances;
- old Admin handle/write fails with `ACTOR_CONTEXT_STALE`.

## Cash / operational state

This phase performs **no cash ownership transfer**.

Regression coverage verifies an existing cash/operational record is not:

- reassigned to the next actor;
- relabeled with the new actor key;
- closed automatically by actor logout;
- deleted by the handoff.

Cart, drafts and full ActorScopedStorage migration remain outside SHARED.TERMINAL.2. Ambiguous actor-sensitive state must remain blocked/hand-off pending rather than silently transferred.

## Outbox / sync

Pending operations are not reinterpreted as belonging to the new current actor. Actor evidence is preserved when known; ambiguous evidence fails closed. POS sync obtains the canonical actor session token and passes it through the historical token parameter without deriving actor identity from physical device role.

## Tests and regression evidence

### Focused SHARED.TERMINAL.2 validation

**PASS**

Coverage includes:

- device-mode policy and conservative legacy mapping;
- shared Staff routing with legacy Admin metadata;
- ActorRuntime state/generation/handoff;
- same tenant/opaqueId/databaseName;
- stale actor handles;
- cash ownership preservation;
- image-upload actor-session fail-closed behavior;
- tenant isolation;
- database recovery;
- authentication regression;
- relevant ESLint;
- `git diff --check`;
- `npm run build`;
- `npm run build:store`;
- `npm run build:store:vercel`.

### Full suite / BASE vs CANDIDATE

The repository has preexisting raw full-suite failures. They were not hidden or rewritten.

The dedicated differential workflow runs repeated BASE and CANDIDATE suites against exact base `cd67e0d0b299cbef1f299e5a3414a3cefe5d3a39` and gates on normalized failure classes/counts rather than pretending the raw suite is green.

A validated pre-storage cutover repetition recorded:

- BASE: `2823 passed / 92 failed / 51 skipped / 2966 total`
- CANDIDATE: `2830 passed / 92 failed / 51 skipped / 2973 total`
- candidate-only failure classes: `0`
- failure-count regressions: `0`
- `NEW/CHANGED REGRESSIONS = 0`

During the final Storage hardening, the global comparison correctly detected six candidate-only failures in the existing `imageUploadService.test.js` fixture because its old mock returned `undefined` for actor session. This was treated as a real candidate regression signal, not classified away. The compatibility correction preserves production fail-closed authority and the Storage tests were rerun without removing any case.

Final closeout criterion remains:

`NEW/CHANGED REGRESSIONS = 0`

## Report publishing / HEAD stability

SHARED.TERMINAL.2 does not introduce an automatic report-publishing job. The permanent report is committed once as ordinary source documentation and does not create a report-only self-publish loop.

The PR must remain DRAFT and unmerged after this report commit.

## Security invariants after cutover

The implementation is designed so that it is not valid to:

1. elevate a Staff actor because legacy `device_role=admin`;
2. use an old Admin handle after Staff handoff;
3. silently use a residual Admin session for a Staff operation;
4. auto-select one actor from ambiguous Admin+Staff evidence;
5. change tenant as a side effect of shared login;
6. open an actor-specific IndexedDB;
7. transfer/relabel/delete the previous actor's cash session;
8. reinterpret pending outbox operations as the new actor;
9. let Staff/anonymous authority change `device_mode`;
10. authorize image uploads by physical role instead of canonical actor context.

## Risks / deferred work

Intentionally deferred to later phases:

- full cart migration to ActorScopedStorage;
- full draft migration;
- cashStation/cash-session handoff policy;
- historical cash reassignment (explicitly forbidden here);
- broad actor-scoped outbox redesign.

These items are not treated as blockers for SHARED.TERMINAL.2 because this phase blocks/retains ambiguous state rather than silently transferring authority.

## Final disposition

- PR #208 prerequisite: **VERIFIED**
- post-#208 main base: **VERIFIED**
- new branch/PR: **VERIFIED**
- device_mode: **PASS**
- backward compatibility: **PASS**
- Admin auth: **PASS**
- Staff auth: **PASS**
- shared Admin/Staff authority: **PASS**
- actor ambiguity: **PASS / fail closed**
- stale generation: **PASS**
- same IndexedDB: **PASS**
- cash ownership unchanged: **PASS**
- tenant isolation: **PASS**
- Supabase apply/post-apply verification: **PASS**
- Edge Function production deployment: **PASS**
- focused/build/lint/diff checks: **PASS**
- differential criterion: **NEW/CHANGED REGRESSIONS = 0**
- report self-publish loop: **not introduced**

**SHARED.TERMINAL.2: PASS**

Stop here. Do not begin SHARED.TERMINAL.3. Do not merge PR #209 before independent review.
