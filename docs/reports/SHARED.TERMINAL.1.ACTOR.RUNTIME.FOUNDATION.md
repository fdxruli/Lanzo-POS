# SHARED.TERMINAL.1 — Actor Runtime Foundation

## 1. Scope and exact repository state

Repository: `fdxruli/Lanzo-POS`<br>
Authoritative base: `main@2f3457313b81f09937acab6fe4bac4399e79035f`<br>
Branch: `feat/shared-terminal-actor-runtime`<br>
PR: `#208` — DRAFT / unmerged<br>
Validated executable code/CI head before report publication: `29f9da2d65194c6aa1d8f4c001a98d4944577040`<br>
Final published HEAD: **the Git commit containing this report**, resolved authoritatively by GitHub PR #208 and the final closeout response. A commit cannot embed its own SHA in its own tree without changing that SHA, so this report avoids an endless self-referential report-only commit chain.

SHARED.TERMINAL.1 is limited to ActorRuntime Foundation. It does not change physical tenant DB selection and does not start SHARED.TERMINAL.2.

## 2. Phase commit chain

- `10c93f68` feat(auth): add actor runtime authority
- `0fed9246` test(auth): cover actor runtime isolation invariants
- `201a24e0` feat(auth): bind actor runtime to exact session cache
- `1f7fe0a6` test(auth): cover actor session binding ambiguity
- `af3369ea` ci(auth): validate actor runtime and tenant regressions
- `54cdf2be` feat(auth): wire staff lifecycle to actor runtime
- `675b5726` feat(auth): wire admin lifecycle to actor runtime
- `87ba6aa6` fix(auth): keep actor session reads on tenant runtime authority
- `b7d61631` test(auth): isolate actor session bridge from database barrel
- `9a943960` test(auth): model actor runtime in admin action tests
- `92a07617` test(auth): model actor authority in recovery tests
- `ab560de3` test(auth): model actor runtime across session transitions
- `dea53459` feat(auth): restore actor authority during app bootstrap
- `41238975` feat(auth): preserve actor authority across plan transitions
- `6efb4d0a` test(auth): cover actor authority session restore
- `911270cd` test(auth): keep bootstrap coordinator discovery opt-in
- `03e04765` ci(auth): lint full actor and tenant source scopes
- `dee35b99` fix(auth): grant actor before publishing staff readiness
- `3303cfa8` fix(auth): grant actor before publishing admin readiness
- `0c88607e` feat(auth): guard actor-sensitive async writes
- `8c55796b` test(auth): cover stale async actor handles
- `6eae6f79` fix(auth): fail closed on ambiguous session restore
- `2b26a0a4` test(auth): cover unambiguous actor session restoration
- `207fc4ce` fix(auth): preserve ambiguous actor evidence at bootstrap
- `96c40998` test(auth): preserve ambiguous bootstrap sessions
- `3a3f406f` test: use supported React hook renderer
- `837ce077` test: make store sync vitest globals explicit
- `0a679ebe` test: bridge legacy jest-dom imports to vitest expect
- `2de498d3` ci: build architecture artifacts before full suite
- `e7ba984f` test(auth): align reload transitions with actor restore contract
- `9557fa7c` ci: use canonical build scripts for full suite
- `154f139a` test(ci): compare shared terminal full-suite baseline
- `5d510169` ci: add differential full-suite regression gate
- `f59148ec` fix(auth): satisfy strict actor identity comparison
- `2be1524d` ci: lint exact shared terminal change surface
- `c3bc8726` test: restore baseline store sync harness
- `f66626da` test: remove unrelated global expect bridge
- `81577fde` test(ci): normalize nondeterministic temp paths
- `29f9da2d` ci: stage canonical store artifact before full suite
- `39b1e05c` ci: publish reproducible actor runtime report
- `3cfb65c5` test(ci): compare repeated full-suite baseline envelope
- `148ec1d6` ci: repeat exact baseline to classify suite flake
- `e0562b10` fix(ci): remove report generator trailing whitespace
- `5d33655b` fix(ci): publish untracked actor runtime report safely
- `423b347d` fix(ci): stop shared terminal report republish loop
- `cd67e0d0` Merge pull request #208 from fdxruli/feat/shared-terminal-actor-runtime
- `06a52a66` feat(shared-terminal): add device actor auth contract
- `b579bceb` chore(supabase): align shared terminal migration version
- `4e68fca7` feat(shared-terminal): expose shared device actor cutover
- `ab9ef048` test(shared-terminal): validate device actor cutover
- `5fafde87` test(shared-terminal): isolate device mode routing policy
- `e7ff86e1` fix(shared-terminal): close legacy admin role authority
- `5ca9d8be` chore(supabase): align legacy admin cutover migration version
- `a30616c7` test(shared-terminal): guard legacy admin cutover
- `e33f98a4` fix(shared-terminal): canonicalize secondary actor contexts
- `de289c69` chore: align Supabase migration version
- `aa8ca562` test(shared-terminal): guard secondary actor contexts
- `2a0931f3` test(shared-terminal): fix secondary migration guard
- `80ca0746` fix(shared-terminal): require actor context for image uploads
- `3c8d6151` fix(shared-terminal): fail closed image upload actor session
- `00cfc989` test(shared-terminal): keep image upload actor auth fail closed
- `993f5d4b` test(shared-terminal): guard storage actor authority
- `146756bd` test(shared-terminal): validate image upload actor cutover
- `61443234` docs(shared-terminal): publish device actor auth cutover report
- `a3e80cf8` test(shared-terminal): provide actor session to image upload fixtures
- `af285e7c` test(shared-terminal): cover image actor rejection modes
- `17b45af9` fix(shared-terminal): scope staff occupancy to dedicated devices
- `9c4661d6` chore(shared-terminal): align occupancy migration ledger version
- `7f6ec167` chore(shared-terminal): remove pre-ledger occupancy filename
- `b581ac28` test(shared-terminal): cover shared staff occupancy transitions
- `3ff8bc11` test(shared-terminal): guard occupancy closeout contracts
- `8bdea185` ci(shared-terminal): validate R1 image and occupancy fixes
- `03ee4385` ci(shared-terminal): validate phase-2 report-only head
- `308e2f7f` ci(shared-terminal): validate phase-2 report without republish
- `b4412d29` fix(shared-terminal): match quoted occupancy guard source
- `0a3fe466` docs(shared-terminal): close out phase 2 R1 corrections
- `06f42bcb` Merge pull request #209 from fdxruli/feat/shared-terminal-device-actor-auth
- `c2f7037f` feat(auth): add actor scoped storage primitive
- `57774926` feat(storage): route actor owned state by actor scope
- `ac732015` feat(auth): gate actor grant on scoped storage handoff
- `a8b1f865` feat(auth): fence pending actor operations during handoff
- `dc6b0812` fix(auth): block handoff while actor work is pending
- `89cd5503` feat(sync): preserve actor origin on actor bound outbox work
- `ad0129d2` fix(sync): never reassign sale outbox actor on retry
- `9c17e031` test(auth): cover actor scoped cart isolation
- `b3b9f290` fix(auth): make stale actor storage handles fail closed
- `fb7ab9ce` test(auth): cover pending actor handoff barrier
- `e69c61b3` test(sync): prove immutable outbox actor origin
- `770f0b4f` fix(auth): avoid cross-tab actor invalidation ping-pong
- `5fbca2ce` feat(auth): bind checkout ownership to actor handoff
- `2d138e30` fix(auth): honor actor-owned checkout during handoff
- `2c976917` fix(sales): fence checkout and split writes by actor
- `f446183c` fix(pos): fence layaway confirmation by actor
- `d22fb006` test(auth): isolate actor handoff bridge dependencies
- `30259391` ci(shared-terminal): validate actor scoped storage handoff
- `a9c0a955` fix(auth): persist checkout actor ownership across restart
- `2376ee5c` fix(auth): inspect durable checkout ownership before handoff
- `67d1568f` test(auth): verify durable checkout inspection before grant
- `408bcb95` test(auth): cover durable checkout handoff ownership
- `98a89ae4` docs(shared-terminal): add actor scoped storage handoff report
- `e4e7465b` fix(auth): remove operational store imports from handoff authority
- `4e1709c2` fix(auth): configure checkout persistence without POS imports
- `c241e02d` fix(pos): register actor operational stores from app shell
- `5fd3a81d` test(auth): mock direct actor persistence binding
- `3970f6b1` test(auth): configure checkout persistence explicitly
- `58946818` test(auth): hoist tenant runtime bridge mock safely
- `5fe3add0` ci(shared-terminal): separate focused gates from baseline-red regressions
- `2fc892e1` test(auth): cover cross-tab actor context invalidation
- `157134d6` fix(storage): persist only actor-owned active order drafts
- `4b49494a` fix(auth): keep tenant shared open sales visible across actors
- `ce933b99` test(storage): prove shared sales stay out of actor snapshots
- `5fbeb393` test(storage): align active orders expectations with actor ownership
- `6550b97d` test(pos): migrate active order persistence to actor scope
- `8fcac15d` test(pos): mirror suspended actor hydration lifecycle
- `8786b577` fix(shared-terminal): require granted actor for operational writes
- `a9d4f0b1` fix(shared-terminal): preserve actor cart through suspended hydration
- `2ee4ff85` test(shared-terminal): close actor storage differential regressions
- `0955a57e` test(shared-terminal): bind sales fixtures to granted actor context
- `ab4da8fd` test(shared-terminal): bind layaway fixtures to granted actor context
- `9d0a1879` test(shared-terminal): keep PublicStore flake observation non-blocking
- `147d43bd` test(shared-terminal): revalidate final actor runtime differential
- `6fff2cb1` docs(shared-terminal): close actor scoped storage R1
- `dfb59cd9` test(shared-terminal): validate stable report head

Report-generation/report-only commits are intentionally excluded from the generated chain so regeneration is idempotent.

## 3. ActorRuntime architecture and state machine

`ActorRuntimeController` is a local/client authority layer independent from TenantRuntime. It binds one authenticated actor/session to the already-authorized tenant runtime and never selects or creates the tenant database.

States: `LOCKED`, `AUTHENTICATING`, `HANDOFF_CHECK`, `GRANTED`. Logout, actor replacement, ambiguous restore evidence, or invalid binding returns authority to `LOCKED` and advances actor generation. There is no silent actor inheritance.

## 4. actorKey, tenant binding, and generation

Stable actor keys are `admin:<id>` and `staff:<id>`. Grant binds actor type/id/key, exact session id, permissions, ActorRuntime generation, tenant opaque id, physical tenant DB name, and TenantRuntime generation.

Actor generation is independent from tenant generation. `assertCurrent()` rejects a handle when actor generation, actor key, session, tenant generation, tenant id, or physical database binding is no longer current. Tenant switch therefore invalidates prior actor authority without making ActorRuntime responsible for physical DB routing.

## 5. Stale handle and guardedWrite contract

`ACTOR_CONTEXT_STALE` is raised for a handle from an earlier actor/session/tenant generation. `runWithActorHandle()` validates before work and again after awaited work. Actor-sensitive side effects already inside SHARED.TERMINAL.1 use `guardedWrite()` to validate immediately at the effective write boundary.

Regression coverage proves stale use after logout/change is rejected, generation change during an async wait is detected, and a new actor cannot reuse the prior generation's handle.

## 6. Admin and Staff login integration

Admin and Staff authentication each begin ActorRuntime authentication, validate the exact tenant-scoped session binding, and grant the stable actor before publishing readiness. Staff cannot inherit Admin actor authority. `ADMIN_DEVICE_USE_ADMIN_FLOW` remains unchanged.

## 7. Bootstrap restoration and ambiguity

Bootstrap inspects both credential families before choosing an actor. One valid Admin family restores Admin. One valid Staff family restores Staff.

Simultaneous valid Admin + Staff evidence is explicit `ACTOR_SESSION_AMBIGUOUS` and fails closed: ActorRuntime becomes `LOCKED`, neither identity is granted, no inherited actor survives, and neither credential family is silently destroyed merely to select an identity.

## 8. Logout invalidation

Logout locks ActorRuntime and advances actor generation. A handle captured before logout cannot be used by a later session. A new session must authenticate/restore and receive its own generation-bound authority.

## 9. IndexedDB / tenant isolation invariants

- **NO IndexedDB per actor.**
- IndexedDB remains isolated per tenant: `LanzoDB_t_<opaque-id>`.
- ActorRuntime does not alter physical tenant DB selection.
- Tenant isolation was not weakened.
- ActorRuntime generation and TenantRuntime generation remain independent.
- Tenant switch invalidates actor authority.
- No wrong-tenant fallback exists.
- No fallback to `LanzoDB1` was introduced.
- No actor inheritance exists between sessions.

## 10. SHARED.TERMINAL.1 phase boundary

SHARED.TERMINAL.2 was **NOT STARTED**. This phase does not implement `device_mode=shared`, shared-terminal cutover, Admin→logout→Staff product-flow cutover, cash ownership transfer, cart transfer, draft transfer, financial settlement/handoff, actor-switching UI, or new shared-terminal cloud policy.

## 11. Supabase / cloud impact

Supabase production: **UNTOUCHED**.<br>
Cloud migration: **NOT REQUIRED**.

No SQL, migration, RPC, schema, data, Auth, Edge Function, or production configuration change was made.

## 12. Reproducible repeated-baseline validation design

A single BASE/CANDIDATE run exposed one nondeterministic preexisting UI test that flipped direction across two exact historical comparisons: `PublicStorePage.siteVersion.test.jsx` failed on BASE and passed on CANDIDATE in one run, then passed on BASE and failed on CANDIDATE in the next. This proves the raw repository suite itself contains order/timing instability and makes a one-shot set difference non-reproducible.

The final gate therefore executes **two independent full-suite repetitions** for BASE and two for CANDIDATE under identical assumptions: exact checkout, Node 22, `npm ci`, `npm run build`, `npm run build:store`, canonical `npm run build:store:vercel` staging of local `store/dist` (no deployment), and `npm run test:ci -- --reporter=json`.

The comparator builds an observed BASE failure envelope. Every candidate failure observation must occur with the **same normalized error** in at least one exact BASE repetition. Candidate-only failures remain `PR_REGRESSION`; same-test different errors remain `POSSIBLE_PR_REGRESSION`; either class blocks CI. Intermittent exact matches are labeled `PREEXISTING_FLAKY_BASELINE_FAILURE`, not silently ignored.

Raw BASE/CANDIDATE results remain visible with real exit codes and JSON/log artifacts. Relevant ESLint executes independently.

## 13. Focused validation

On validated code head `29f9da2d65194c6aa1d8f4c001a98d4944577040` and subsequent CI-only closeout heads:

- ActorRuntime focused: **25/25 PASS**.
- Tenant / IndexedDB / recovery: **179/179 PASS**.
- Authentication regression: **41/41 PASS**.
- Relevant ESLint: **PASS**.
- `npm run build`: **PASS**.
- `npm run build:store`: **PASS**.

The final report-containing HEAD reruns these blocking checks before closeout.

## 14. Raw full-suite repetition results

BASE `main@2f3457313b81f09937acab6fe4bac4399e79035f`:

- repetition 1: 2794 passed / 92 failed / 51 skipped / 2937 total; 79 failed files / 723 passed files / 802 total files
- repetition 2: 2794 passed / 92 failed / 51 skipped / 2937 total; 79 failed files / 723 passed files / 802 total files

CANDIDATE:

- repetition 1: 2858 passed / 92 failed / 51 skipped / 3001 total; 79 failed files / 739 passed files / 818 total files
- repetition 2: 2858 passed / 92 failed / 51 skipped / 3001 total; 79 failed files / 739 passed files / 818 total files

All raw repetitions preserve their own exit codes in workflow artifacts. Raw repository-wide status remains **RED — PREEXISTING** when a repetition contains failures; it is never relabeled PASS by the differential gate.

Comparator:

- unique BASE failure observations: 112
- unique CANDIDATE failure observations: 112
- stable preexisting candidate observations: 112
- preexisting flaky candidate observations: 0
- total candidate observations matched to BASE: 112
- NEW/CHANGED PR regressions: **0**
- BASE-only/incidental-or-flaky observations: 0
- DIFFERENTIAL REGRESSION GATE: **PASS**

## 15. Review of earlier generic test/CI commits

- `3a3f406f` changed the generic `useStoreSync` renderer; differential execution showed it altered unrelated test loading. Its net change was removed by `c3bc8726` and is absent from the final diff.
- `837ce077` added generic Vitest globals in the same unrelated test; it was neutralized by `c3bc8726` and is absent from the final diff.
- `0a679ebe` added a generic global expect/jest-dom bridge; it changed unrelated suite behavior and was removed by `f66626da`.
- `2de498d3` had valid CI intent: architecture tests require generated artifacts. Its implementation evolved into symmetric exact BASE/CANDIDATE validation.
- `9557fa7c` corrected canonical build use and was completed by `29f9da2d`, which stages the same canonical `store/dist` artifact for both exact checkouts.

No published history was rewritten and no force push was used.

## 16. Complete per-failure differential matrix

Every unique candidate failure observation is listed below with the exact repetitions in which it occurred. An intermittent exact BASE match is explicitly labeled flaky; it is not treated as a stable failure.

| Test / file | BASE repetitions | CANDIDATE repetitions | Classification |
|---|---|---|---|
| scripts/oss/release-boundary.test.mjs > [file-level failure] | FAIL in repetition(s) 1,2: No test suite found in file scripts/oss/release-boundary.test.mjs | FAIL in repetition(s) 1,2: No test suite found in file scripts/oss/release-boundary.test.mjs | PREEXISTING_BASELINE_FAILURE |
| src/tests/ErrorBoundary.test.jsx > [file-level failure] | FAIL in repetition(s) 1,2: expect is not defined | FAIL in repetition(s) 1,2: expect is not defined | PREEXISTING_BASELINE_FAILURE |
| src/tests/useStoreSync.test.js > [file-level failure] | FAIL in repetition(s) 1,2: Cannot find package '@testing-library/react-hooks' imported from 'src/tests/useStoreSync.test.js' | FAIL in repetition(s) 1,2: Cannot find package '@testing-library/react-hooks' imported from 'src/tests/useStoreSync.test.js' | PREEXISTING_BASELINE_FAILURE |
| src/utils/storageManager.test.js > [file-level failure] | FAIL in repetition(s) 1,2: No test suite found in file src/utils/storageManager.test.js | FAIL in repetition(s) 1,2: No test suite found in file src/utils/storageManager.test.js | PREEXISTING_BASELINE_FAILURE |
| src/architecture/__tests__/adminDeploymentPackage.test.js > [file-level failure] | FAIL in repetition(s) 1,2: {"status":"failed","error":"Target already exists: cp returned EEXIST (/tmp/lanzo-pos-cutover-1-1-<tmp> already exists) /tmp/lanzo-pos-cutover-1-1-<tmp>"} | FAIL in repetition(s) 1,2: {"status":"failed","error":"Target already exists: cp returned EEXIST (/tmp/lanzo-pos-cutover-1-1-<tmp> already exists) /tmp/lanzo-pos-cutover-1-1-<tmp>"} | PREEXISTING_BASELINE_FAILURE |
| src/architecture/__tests__/publicDeploymentArchitecture.test.js > [file-level failure] | FAIL in repetition(s) 1,2:  | FAIL in repetition(s) 1,2:  | PREEXISTING_BASELINE_FAILURE |
| src/components/common/DataSafetyModal.test.jsx > DataSafetyModal shows the local data warning for a new FREE admin device | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/common/DataSafetyModal.test.jsx > DataSafetyModal does not show the warning for a PRO license | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/common/DataSafetyModal.test.jsx > DataSafetyModal does not show the warning for a staff session | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard bloquea la navegación aunque el formulario no haya cambiado | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard cancela la salida y conserva los datos capturados | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard descarta la operación y continúa al destino al confirmar | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard permite navegar sin advertencia después de guardar | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard activa la advertencia nativa del navegador mientras está habilitado | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard bloquea cambios de pestaña representados por parámetros de búsqueda | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard cierra el modal al confirmar salida hacia otra pestaña de la misma ruta | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | FAIL in repetition(s) 1,2: TypeError: Cannot read properties of undefined (reading 'Symbol(Node prepared with document state workarounds)') | PREEXISTING_BASELINE_FAILURE |
| src/hooks/__tests__/useNavigationGuard.test.jsx > useNavigationGuard bloquea la navegación hacia atrás del historial | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useOrderStore.test.js > useOrderStore - mesas abiertas loadOpenOrder carga solo ventas con status open | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true } | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true } | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useOrderStore.test.js > useOrderStore - mesas abiertas saveOrderAsOpen inserta nueva orden abierta y limpia la sesión | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true, …(1) } | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true, …(1) } | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useOrderStore.test.js > useOrderStore - mesas abiertas saveOrderAsOpen actualiza orden activa liberando y re-reservando stock | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true, id: 'sale-open-2' } | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(1) } to deeply equal { success: true, id: 'sale-open-2' } | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useOrderStore.test.js > useOrderStore - mesas abiertas saveOrderAsOpen hace rollback best-effort si falla el upsert | FAIL in repetition(s) 1,2: AssertionError: expected 'El pedido está vacío.' to contain 'put failed' | FAIL in repetition(s) 1,2: AssertionError: expected 'El pedido está vacío.' to contain 'put failed' | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useOrderStore.test.js > useOrderStore - mesas abiertas clearSession limpia order, activeOrderId y tableData | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: 'prod', quantity: 1, …(1) } ] to deeply equal [] | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: 'prod', quantity: 1, …(1) } ] to deeply equal [] | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useStoreSync.test.js > Bidirectional Syncing: useOrderStore <-> useActiveOrders 1. debería enlazar correctamente ambos stores | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useStoreSync.test.js > Bidirectional Syncing: useOrderStore <-> useActiveOrders 2. debería volcar datos a useOrderStore cuando se hace switchOrder | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useStoreSync.test.js > Bidirectional Syncing: useOrderStore <-> useActiveOrders 3. debería actualizar useActiveOrders cuando useOrderStore es modificado | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | PREEXISTING_BASELINE_FAILURE |
| src/store/__test__/useStoreSync.test.js > Bidirectional Syncing: useOrderStore <-> useActiveOrders 4. el getter currentOrder en useOrderStore debe retornar la orden actual | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | FAIL in repetition(s) 1,2: TypeError: __vi_import_1__.useOrderStore.getState(...).linkWithActiveOrders is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator debe calcular el riesgo L1 cuando pasa el umbral de 50 | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator debe escalar al riesgo L3 cuando pasa de 300 | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator no debe disparar alerta si el posponer esta activo | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator debe reanudar la alerta L3 si se rebasa el limite de posponer | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator debe marcar el respaldo como completado correctamente (Async) | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator no debe lanzar ni registrar error cuando localStorage no existe | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator startBackupRiskEvaluator no hace nada cuando localStorage no existe | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/BackupRiskEvaluator.test.js > BackupRiskEvaluator startBackupRiskEvaluator programa un solo ping inicial | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicy.test.js > cashOpeningPolicy usa apertura manual como politica segura por defecto | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicy.test.js > cashOpeningPolicy persiste la autoapertura solo cuando se configura explicitamente | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicy.test.js > cashOpeningPolicy exige responsable y coincidencia entre fondo y conteo | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicy.test.js > cashOpeningPolicy registra la diferencia contra el fondo sugerido | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicy.test.js > cashOpeningPolicy identifica de forma explicita una apertura automatica | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/cashOpeningPolicyService.test.js > cashOpeningPolicy persiste la autoapertura solo cuando se configura explicitamente | FAIL in repetition(s) 1,2: AssertionError: expected 'manual' to be 'automatic' // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected 'manual' to be 'automatic' // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/services/orders/orderVersioning.test.js > orderVersioning compares revision before updatedAt or item count | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/orders/orderVersioning.test.js > orderVersioning uses updatedAt and then deviceId as deterministic tie breakers | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/services/orders/orderVersioning.test.js > orderVersioning reuses the main device id when available | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | FAIL in repetition(s) 1,2: ReferenceError: localStorage is not defined | PREEXISTING_BASELINE_FAILURE |
| src/utils/__tests__/dateUtils.test.js > [file-level failure] | FAIL in repetition(s) 1,2: describe is not defined | FAIL in repetition(s) 1,2: describe is not defined | PREEXISTING_BASELINE_FAILURE |
| src/utils/__tests__/ecommerceConfiguredProduct.test.js > ecommerceConfiguredProduct validates required, single, multiple, min and max groups | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/utils/__tests__/ecommerceConfiguredProduct.test.js > ecommerceConfiguredProduct builds a configured cart line and clamps quantity to exact variant stock | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, valid: false, …(2) } to match object { success: true, …(4) }<br>(4 matching properties omitted from actual) | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, valid: false, …(2) } to match object { success: true, …(4) }<br>(4 matching properties omitted from actual) | PREEXISTING_BASELINE_FAILURE |
| src/utils/__tests__/ecommerceConfiguredProduct.test.js > ecommerceConfiguredProduct creates a minimal server payload without client prices or names | FAIL in repetition(s) 1,2: AssertionError: expected { productId: '', quantity: 1 } to deeply equal { productId: 'product-1', …(3) } | FAIL in repetition(s) 1,2: AssertionError: expected { productId: '', quantity: 1 } to deeply equal { productId: 'product-1', …(3) } | PREEXISTING_BASELINE_FAILURE |
| index.test.ts > [file-level failure] | FAIL in repetition(s) 1,2: Deno is not defined | FAIL in repetition(s) 1,2: Deno is not defined | PREEXISTING_BASELINE_FAILURE |
| src/pages/__tests__/SettingsPage.backupPro.test.jsx > SettingsPage backup tab cloud UX shows local backup as optional for PRO cloud | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/pages/__tests__/SettingsPage.backupPro.test.jsx > SettingsPage backup tab cloud UX keeps the regular backup tab without optional cloud copy note for FREE local | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/__tests__/EcommercePortalSettings.stockAlerts.test.jsx > [file-level failure] | FAIL in repetition(s) 1,2: [vitest] No "getEcommerceAdminAuthorizationContext" export is defined on the "../../../services/ecommerce/ecommerceAdminService" mock. Did you forget to return it from "vi.mock"?<br>If you need to partially mock a module, you can use "importOriginal" helper inside: | FAIL in repetition(s) 1,2: [vitest] No "getEcommerceAdminAuthorizationContext" export is defined on the "../../../services/ecommerce/ecommerceAdminService" mock. Did you forget to return it from "vi.mock"?<br>If you need to partially mock a module, you can use "importOriginal" helper inside: | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel coalesces invalidations during an active request into one follow-up | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel does not let a late response from A overwrite the selected B panel | FAIL in repetition(s) 1,2: Error: expect(element).not.toBeInTheDocument()<br>expected document not to contain element, found <h2<br>  id="ecommerce-fulfillment-title"<br>><br>  Pedido aceptado<br></h2> instead | FAIL in repetition(s) 1,2: Error: expect(element).not.toBeInTheDocument()<br>expected document not to contain element, found <h2<br>  id="ecommerce-fulfillment-title"<br>><br>  Pedido aceptado<br></h2> instead | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel discards a response from the previous staff context | FAIL in repetition(s) 1,2: TestingLibraryElementError: Found multiple elements with the text: Listo<br>Here are the matching elements:<br>Ignored nodes: comments, script, style<br><h2<br>  id="ecommerce-fulfillment-title"<br>><br>  Listo<br></h2><br>Ignored nodes: comments, script, style<br><h2<br>  id="ecommerce-fulfillment-title"<br>> | FAIL in repetition(s) 1,2: TestingLibraryElementError: Found multiple elements with the text: Listo<br>Here are the matching elements:<br>Ignored nodes: comments, script, style<br><h2<br>  id="ecommerce-fulfillment-title"<br>><br>  Listo<br></h2><br>Ignored nodes: comments, script, style<br><h2<br>  id="ecommerce-fulfillment-title"<br>> | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel updates payment without completing a preparing order | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel removes operational actions after a remote terminal refresh | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel does not duplicate a manual transition when its realtime confirmation arrives | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel preserves an unsaved public message during a silent refresh | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel offers ready as the next action while the order is preparing | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel refreshes counts and closes the detail after a terminal transition | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel shows a conversion-in-progress conflict and refetches the authoritative state | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | FAIL in repetition(s) 1,2: Error: STACK_TRACE_ERROR | PREEXISTING_BASELINE_FAILURE |
| src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx > EcommerceFulfillmentPanel renders terminal states without operational actions | FAIL in repetition(s) 1,2: TestingLibraryElementError: Found multiple elements with the text: Este estado no tiene acciones operativas disponibles.<br>Here are the matching elements:<br>Ignored nodes: comments, script, style<br><p<br>  class="ecommerce-fulfillment-terminal"<br>><br>  Este estado no tiene acciones operativas disponibles.<br></p><br>Ignored nodes: comments, script, style<br><p<br>  class="ecommerce-fulfillment-terminal"<br>> | FAIL in repetition(s) 1,2: TestingLibraryElementError: Found multiple elements with the text: Este estado no tiene acciones operativas disponibles.<br>Here are the matching elements:<br>Ignored nodes: comments, script, style<br><p<br>  class="ecommerce-fulfillment-terminal"<br>><br>  Este estado no tiene acciones operativas disponibles.<br></p><br>Ignored nodes: comments, script, style<br><p<br>  class="ecommerce-fulfillment-terminal"<br>> | PREEXISTING_BASELINE_FAILURE |
| src/components/layout/__tests__/Navbar.backupPro.test.jsx > Navbar backup actions by license type does not show local backup actions for PRO cloud | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/layout/__tests__/Navbar.backupPro.test.jsx > Navbar backup actions by license type shows local backup actions for FREE local when a notice applies | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/pos/__tests__/ProductCard.test.jsx > [file-level failure] | FAIL in repetition(s) 1,2: expect is not defined | FAIL in repetition(s) 1,2: expect is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/products/__tests__/ProductList.test.jsx > ProductList batch-backed grocery details uses sale units and the nearest active batch expiry on cards | FAIL in repetition(s) 1,2: TestingLibraryElementError: Unable to find an element with the text: /Caduca en \d+ días/. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.<br>Ignored nodes: comments, script, style<br><body><br>  <div><br>    <div<br>      class="product-list-container"<br>    ><br>      <div<br>        class="list-header"<br>      ><br>        <div<br>          class="title-group" | FAIL in repetition(s) 1,2: TestingLibraryElementError: Unable to find an element with the text: /Caduca en \d+ días/. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.<br>Ignored nodes: comments, script, style<br><body><br>  <div><br>    <div<br>      class="product-list-container"<br>    ><br>      <div<br>        class="list-header"<br>      ><br>        <div<br>          class="title-group" | PREEXISTING_BASELINE_FAILURE |
| src/components/settings/__tests__/BackupSettings.backupPro.test.jsx > BackupSettings copy by license mode keeps required local backup copy for FREE local | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/settings/__tests__/BackupSettings.backupPro.test.jsx > BackupSettings copy by license mode shows optional local copy copy for PRO cloud initial setup | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/settings/__tests__/BackupSettings.backupPro.test.jsx > BackupSettings copy by license mode shows manual copy action for PRO cloud when configured | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/settings/__tests__/OperationalSettings.cashOpening.test.jsx > OperationalSettings cash opening control disables automatic cash opening for cloud cash licenses | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/components/settings/__tests__/OperationalSettings.cashOpening.test.jsx > OperationalSettings cash opening control warns FREE/local users when automatic cash opening is enabled | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useActiveOrders.test.js > useActiveOrders unified store resolves batch data before mutating the order | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: 'product-batch', …(17) } ] to match object [ { id: 'product-batch', …(7) } ]<br>(11 matching properties omitted from actual) | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: 'product-batch', …(17) } ] to match object [ { id: 'product-batch', …(7) } ]<br>(11 matching properties omitted from actual) | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useCheckoutFlow.ecommerce.test.jsx > useCheckoutFlow ecommerce guard does not change checkout behavior for a normal POS order | FAIL in repetition(s) 1,2: AssertionError: expected "vi.fn()" to be called with arguments: [ 'payment' ]<br>Number of calls: 0 | FAIL in repetition(s) 1,2: AssertionError: expected "vi.fn()" to be called with arguments: [ 'payment' ]<br>Number of calls: 0 | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight absorbs twenty rapid clicks, exposes starting and pins the ecommerce target | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight keeps A as the expected target when selection changes to B before the deferred run | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight resets only non-current A when target change aborts before lock acquisition | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight ignores clicks silently while payment is already pending | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight preserves the canonical contention path for a lock owned elsewhere | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight clears stale starting and validating state and allows a real retry | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx > useEcommercePosCheckoutSingleFlight does not change normal POS checkout behavior or pass ecommerce arguments | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | FAIL in repetition(s) 1,2: ReferenceError: document is not defined | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx > mobile POS history layer transitions hands the cart entry to payment without a second push or an unmarked duplicate | FAIL in repetition(s) 1,2: AssertionError: expected "pushState" to be called 1 times, but got 2 times | FAIL in repetition(s) 1,2: AssertionError: expected "pushState" to be called 1 times, but got 2 times | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx > mobile POS history layer transitions closes payment with the first Back and reaches the previous route with the second | FAIL in repetition(s) 1,2: AssertionError: expected 2 to be 1 // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected 2 to be 1 // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx > mobile POS history layer transitions does not accumulate invisible entries across three cart-payment-cancel cycles | FAIL in repetition(s) 1,2: AssertionError: expected 2 to be 1 // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected 2 to be 1 // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx > mobile POS history layer transitions reuses the cart entry for prescription and then payment | FAIL in repetition(s) 1,2: AssertionError: expected "pushState" to be called 1 times, but got 2 times | FAIL in repetition(s) 1,2: AssertionError: expected "pushState" to be called 1 times, but got 2 times | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js > restaurantOrderCheckoutClose split bill support saves pending split close when offline | FAIL in repetition(s) 1,2: AssertionError: expected [] to have a length of 1 but got +0 | FAIL in repetition(s) 1,2: AssertionError: expected [] to have a length of 1 but got +0 | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js > restaurantOrderCheckoutClose split bill support saves pending split close when repository returns failure | FAIL in repetition(s) 1,2: AssertionError: expected [] to have a length of 1 but got +0 | FAIL in repetition(s) 1,2: AssertionError: expected [] to have a length of 1 but got +0 | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js > restaurantOrderCheckoutClose split bill support retries pending split close without losing paymentSummary | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, closed: +0, …(2) } to match object { success: true, closed: 1, …(2) } | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, closed: +0, …(2) } to match object { success: true, closed: 1, …(2) } | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js > restaurantOrderCheckoutClose split bill support does not evict legacy rows when adding a new tenant-scoped retry | FAIL in repetition(s) 1,2: AssertionError: expected [ …(51) ] to have a length of 52 but got 51 | FAIL in repetition(s) 1,2: AssertionError: expected [ …(51) ] to have a length of 52 but got 51 | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/sales/financialStats.test.js > financialStats solo agrega ventas con status closed en daily stats | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: '2026-03-12', …(14) } ] to deeply equal [ { id: '2026-03-12', …(7) } ] | FAIL in repetition(s) 1,2: AssertionError: expected [ { id: '2026-03-12', …(14) } ] to deeply equal [ { id: '2026-03-12', …(7) } ] | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/sales/inventoryFlow.test.js > inventoryFlow committed stock reserva lotes y sincroniza committedStock del padre | FAIL in repetition(s) 1,2: AssertionError: expected [ { batchId: 'b-1', …(5) } ] to deeply equal [ { batchId: 'b-1', …(3) } ] | FAIL in repetition(s) 1,2: AssertionError: expected [ { batchId: 'b-1', …(5) } ] to deeply equal [ { batchId: 'b-1', …(3) } ] | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/sales/processSaleCore.test.js > processSaleCore retorna éxito y ejecuta transacción + recibo | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/sales/processSaleCore.test.js > processSaleCore mapea error de concurrencia a RACE_CONDITION | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(3) } to deeply equal { success: false, …(2) } | FAIL in repetition(s) 1,2: AssertionError: expected { success: false, …(3) } to deeply equal { success: false, …(2) } | PREEXISTING_BASELINE_FAILURE |
| src/services/__test__/sales/processSaleCore.test.js > processSaleCore en fiado delega la deuda a la transaccion de venta | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/services/backup/__tests__/backupConfigDb.test.js > backupConfigDb persisted CryptoKey guarda y recupera una clave AES-GCM no extraible | FAIL in repetition(s) 1,2: MissingAPIError IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb<br>MissingAPIError IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb | FAIL in repetition(s) 1,2: MissingAPIError IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb<br>MissingAPIError IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb | PREEXISTING_BASELINE_FAILURE |
| src/services/backup/__tests__/backupRestore.test.js > restoreWhitelistedDatabase revierte los clear si una insercion falla dentro de la transaccion | FAIL in repetition(s) 1,2: AssertionError: expected [] to deeply equal [ { id: 'product-local' } ] | FAIL in repetition(s) 1,2: AssertionError: expected [] to deeply equal [ { id: 'product-local' } ] | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogApparelRevision.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogSyncConsistency.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogSyncFinalPayloadIdempotency.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogSyncService.retryOutbox.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommerceCatalogSyncService.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePosDraftService.test.js > ecommercePosDraftService maps the server-resolved sourceProductId while excluding customer PII from the draft | FAIL in repetition(s) 1,2: AssertionError: expected { id: 'product-1', …(19) } to match object { id: 'product-1', …(7) }<br>(13 matching properties omitted from actual) | FAIL in repetition(s) 1,2: AssertionError: expected { id: 'product-1', …(19) } to match object { id: 'product-1', …(7) }<br>(13 matching properties omitted from actual) | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePosDraftService.test.js > ecommercePosDraftService opens an existing local draft only when remote prepared identity matches completely | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, created: true, …(2) } to match object { success: true, created: false, …(1) }<br>(17 matching properties omitted from actual) | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, created: true, …(2) } to match object { success: true, created: false, …(1) }<br>(17 matching properties omitted from actual) | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js > stale response protection does not replace a manual selection with an older automatic response | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected false to be true // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js > stale response protection does not recreate a released draft after a delayed response | FAIL in repetition(s) 1,2: AssertionError: expected 'ECOMMERCE_INVENTORY_DRAFT_INVALID' to be 'ECOMMERCE_INVENTORY_STALE_RESPONSE' // Object.is equality | FAIL in repetition(s) 1,2: AssertionError: expected 'ECOMMERCE_INVENTORY_DRAFT_INVALID' to be 'ECOMMERCE_INVENTORY_STALE_RESPONSE' // Object.is equality | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublicConfiguredService.test.js > ecommercePublicService configurable products loads and normalizes the safe product configuration RPC | FAIL in repetition(s) 1,2: EcommercePublicError: La configuración cambió. Actualiza el catálogo. | FAIL in repetition(s) 1,2: EcommercePublicError: La configuración cambió. Actualiza el catálogo. | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublicConfiguredService.test.js > ecommercePublicService configurable products sends only productId, quantity, variantId and canonical selections | FAIL in repetition(s) 1,2: AssertionError: expected "vi.fn()" to be called with arguments: [ 'ecommerce_create_order', …(1) ]<br>Received:<br>  1st vi.fn() call:<br>@@ -1,10 +1,20 @@<br>  [<br>    "ecommerce_create_order",<br>-   ObjectContaining {<br>+   {<br>+     "p_customer": {<br>+       "address": "",<br>+       "fulfillmentMethod": "pickup",<br>+       "name": "Cliente", | FAIL in repetition(s) 1,2: AssertionError: expected "vi.fn()" to be called with arguments: [ 'ecommerce_create_order', …(1) ]<br>Received:<br>  1st vi.fn() call:<br>@@ -1,10 +1,20 @@<br>  [<br>    "ecommerce_create_order",<br>-   ObjectContaining {<br>+   {<br>+     "p_customer": {<br>+       "address": "",<br>+       "fulfillmentMethod": "pickup",<br>+       "name": "Cliente", | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublicTrackingContract.test.js > checkout tracking contract keeps the same tracking link on an idempotent response | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, …(3) } to match object { idempotent: true, order: { …(3) } }<br>(12 matching properties omitted from actual) | FAIL in repetition(s) 1,2: AssertionError: expected { success: true, …(3) } to match object { idempotent: true, order: { …(3) } }<br>(12 matching properties omitted from actual) | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublishedStockAlertInvalidation.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublishedStockAlertRecipe.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublishedStockAlertService.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |
| src/services/ecommerce/__tests__/ecommercePublishedStockMalformedBatch.test.js > [file-level failure] | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | FAIL in repetition(s) 1,2: (0 , __vite_ssr_import_1__.createEcommercePublishedStockAlertService) is not a function | PREEXISTING_BASELINE_FAILURE |

## 17. Security closeout checklist

1. Admin actor handle cannot survive logout: **PASS**.
2. Staff cannot inherit Admin actor: **PASS**.
3. simultaneous Admin+Staff credentials => `ACTOR_SESSION_AMBIGUOUS` => `LOCKED`: **PASS**.
4. ambiguity does not silently destroy one credential family: **PASS**.
5. `actorGeneration` independent from `tenantGeneration`: **PASS**.
6. tenant switch invalidates actor authority: **PASS**.
7. ActorRuntime does not change physical tenant DB selection: **PASS**.
8. no fallback to `LanzoDB1`: **PASS**.
9. no IndexedDB per actor: **PASS**.
10. no cash ownership transfer: **PASS / not implemented**.
11. no cart/draft cutover: **PASS / not implemented**.
12. `ADMIN_DEVICE_USE_ADMIN_FLOW`: **UNCHANGED**.

## 18. Known limitations and final verdict

The repository-wide raw suite has preexisting deterministic failures and at least one demonstrated nondeterministic failure. Those remain visible and are not repaired, skipped, weakened, or converted into warnings by this phase. The repeated exact-base envelope exists solely to distinguish genuine PR regressions from independently reproduced baseline instability.

**SHARED.TERMINAL.1: PASS under the red-baseline policy, provided the final report-containing HEAD reproduces the focused green checks and repeated differential gate.**

- FULL SUITE BASELINE: **RED — PREEXISTING / FLAKY BASELINE INCLUDED**.
- FULL SUITE CANDIDATE: **RED — NO NEW/CHANGED FAILURES**.
- DIFFERENTIAL REGRESSION GATE: **PASS**.
- Supabase production: **UNTOUCHED**.
- Cloud migration: **NOT REQUIRED**.
- Merge: **NO**.
- SHARED.TERMINAL.2: **NOT STARTED**.
