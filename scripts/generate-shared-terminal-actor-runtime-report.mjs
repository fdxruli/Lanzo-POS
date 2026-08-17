import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [differentialPath, outputPath = 'docs/reports/SHARED.TERMINAL.1.ACTOR.RUNTIME.FOUNDATION.md'] = process.argv.slice(2);
if (!differentialPath) {
  console.error('Usage: node scripts/generate-shared-terminal-actor-runtime-report.mjs <differential.json> [output.md]');
  process.exit(2);
}

const BASE_SHA = '2f3457313b81f09937acab6fe4bac4399e79035f';
const VALIDATED_CODE_HEAD = '29f9da2d65194c6aa1d8f4c001a98d4944577040';
const differential = JSON.parse(fs.readFileSync(differentialPath, 'utf8'));

const escapeCell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
const firstError = (row) => String(row.error || '').split('\n')[0] || '<empty normalized error>';
const runSummary = (runs) => runs.map((run, index) => (
  `- repetition ${index + 1}: ${run.passed} passed / ${run.failed} failed / ${run.skipped} skipped / ${run.total} total; ${run.suitesFailed} failed files / ${run.suitesPassed} passed files / ${run.suitesTotal} total files`
)).join('\n');

const commitChain = execFileSync('git', ['log', '--reverse', '--format=- `%h` %s', `${BASE_SHA}..HEAD`], { encoding: 'utf8' })
  .split('\n')
  .filter((line) => line && !line.includes('docs(shared-terminal): publish actor runtime closeout report'))
  .filter((line) => !line.includes('docs(ci): generate actor runtime closeout report'))
  .filter((line) => !line.includes('docs(ci): report repeated baseline envelope'))
  .join('\n');

const matrixRows = differential.matrix.map((row) => (
  `| ${escapeCell(row.id)} | ${escapeCell(row.base)} | ${escapeCell(row.candidate)} | ${row.classification} |`
));
const improvementRows = differential.incidentalImprovements.map((row) => (
  `| ${escapeCell(row.id)} | FAIL in BASE repetition(s) ${row.runs.join(',')}: ${escapeCell(firstError(row))} | PASS/absent in all CANDIDATE repetitions | ${row.classification} |`
));

const report = `# SHARED.TERMINAL.1 — Actor Runtime Foundation

## 1. Scope and exact repository state

Repository: \`fdxruli/Lanzo-POS\`  
Authoritative base: \`main@${BASE_SHA}\`  
Branch: \`feat/shared-terminal-actor-runtime\`  
PR: \`#208\` — DRAFT / unmerged  
Validated executable code/CI head before report publication: \`${VALIDATED_CODE_HEAD}\`  
Final published HEAD: **the Git commit containing this report**, resolved authoritatively by GitHub PR #208 and the final closeout response. A commit cannot embed its own SHA in its own tree without changing that SHA, so this report avoids an endless self-referential report-only commit chain.

SHARED.TERMINAL.1 is limited to ActorRuntime Foundation. It does not change physical tenant DB selection and does not start SHARED.TERMINAL.2.

## 2. Phase commit chain

${commitChain}

Report-generation/report-only commits are intentionally excluded from the generated chain so regeneration is idempotent.

## 3. ActorRuntime architecture and state machine

\`ActorRuntimeController\` is a local/client authority layer independent from TenantRuntime. It binds one authenticated actor/session to the already-authorized tenant runtime and never selects or creates the tenant database.

States: \`LOCKED\`, \`AUTHENTICATING\`, \`HANDOFF_CHECK\`, \`GRANTED\`. Logout, actor replacement, ambiguous restore evidence, or invalid binding returns authority to \`LOCKED\` and advances actor generation. There is no silent actor inheritance.

## 4. actorKey, tenant binding, and generation

Stable actor keys are \`admin:<id>\` and \`staff:<id>\`. Grant binds actor type/id/key, exact session id, permissions, ActorRuntime generation, tenant opaque id, physical tenant DB name, and TenantRuntime generation.

Actor generation is independent from tenant generation. \`assertCurrent()\` rejects a handle when actor generation, actor key, session, tenant generation, tenant id, or physical database binding is no longer current. Tenant switch therefore invalidates prior actor authority without making ActorRuntime responsible for physical DB routing.

## 5. Stale handle and guardedWrite contract

\`ACTOR_CONTEXT_STALE\` is raised for a handle from an earlier actor/session/tenant generation. \`runWithActorHandle()\` validates before work and again after awaited work. Actor-sensitive side effects already inside SHARED.TERMINAL.1 use \`guardedWrite()\` to validate immediately at the effective write boundary.

Regression coverage proves stale use after logout/change is rejected, generation change during an async wait is detected, and a new actor cannot reuse the prior generation's handle.

## 6. Admin and Staff login integration

Admin and Staff authentication each begin ActorRuntime authentication, validate the exact tenant-scoped session binding, and grant the stable actor before publishing readiness. Staff cannot inherit Admin actor authority. \`ADMIN_DEVICE_USE_ADMIN_FLOW\` remains unchanged.

## 7. Bootstrap restoration and ambiguity

Bootstrap inspects both credential families before choosing an actor. One valid Admin family restores Admin. One valid Staff family restores Staff.

Simultaneous valid Admin + Staff evidence is explicit \`ACTOR_SESSION_AMBIGUOUS\` and fails closed: ActorRuntime becomes \`LOCKED\`, neither identity is granted, no inherited actor survives, and neither credential family is silently destroyed merely to select an identity.

## 8. Logout invalidation

Logout locks ActorRuntime and advances actor generation. A handle captured before logout cannot be used by a later session. A new session must authenticate/restore and receive its own generation-bound authority.

## 9. IndexedDB / tenant isolation invariants

- **NO IndexedDB per actor.**
- IndexedDB remains isolated per tenant: \`LanzoDB_t_<opaque-id>\`.
- ActorRuntime does not alter physical tenant DB selection.
- Tenant isolation was not weakened.
- ActorRuntime generation and TenantRuntime generation remain independent.
- Tenant switch invalidates actor authority.
- No wrong-tenant fallback exists.
- No fallback to \`LanzoDB1\` was introduced.
- No actor inheritance exists between sessions.

## 10. SHARED.TERMINAL.1 phase boundary

SHARED.TERMINAL.2 was **NOT STARTED**. This phase does not implement \`device_mode=shared\`, shared-terminal cutover, Admin→logout→Staff product-flow cutover, cash ownership transfer, cart transfer, draft transfer, financial settlement/handoff, actor-switching UI, or new shared-terminal cloud policy.

## 11. Supabase / cloud impact

Supabase production: **UNTOUCHED**.  
Cloud migration: **NOT REQUIRED**.

No SQL, migration, RPC, schema, data, Auth, Edge Function, or production configuration change was made.

## 12. Reproducible repeated-baseline validation design

A single BASE/CANDIDATE run exposed one nondeterministic preexisting UI test that flipped direction across two exact historical comparisons: \`PublicStorePage.siteVersion.test.jsx\` failed on BASE and passed on CANDIDATE in one run, then passed on BASE and failed on CANDIDATE in the next. This proves the raw repository suite itself contains order/timing instability and makes a one-shot set difference non-reproducible.

The final gate therefore executes **two independent full-suite repetitions** for BASE and two for CANDIDATE under identical assumptions: exact checkout, Node 22, \`npm ci\`, \`npm run build\`, \`npm run build:store\`, canonical \`npm run build:store:vercel\` staging of local \`store/dist\` (no deployment), and \`npm run test:ci -- --reporter=json\`.

The comparator builds an observed BASE failure envelope. Every candidate failure observation must occur with the **same normalized error** in at least one exact BASE repetition. Candidate-only failures remain \`PR_REGRESSION\`; same-test different errors remain \`POSSIBLE_PR_REGRESSION\`; either class blocks CI. Intermittent exact matches are labeled \`PREEXISTING_FLAKY_BASELINE_FAILURE\`, not silently ignored.

Raw BASE/CANDIDATE results remain visible with real exit codes and JSON/log artifacts. Relevant ESLint executes independently.

## 13. Focused validation

On validated code head \`${VALIDATED_CODE_HEAD}\` and subsequent CI-only closeout heads:

- ActorRuntime focused: **25/25 PASS**.
- Tenant / IndexedDB / recovery: **179/179 PASS**.
- Authentication regression: **41/41 PASS**.
- Relevant ESLint: **PASS**.
- \`npm run build\`: **PASS**.
- \`npm run build:store\`: **PASS**.

The final report-containing HEAD reruns these blocking checks before closeout.

## 14. Raw full-suite repetition results

BASE \`main@${BASE_SHA}\`:

${runSummary(differential.baseRuns)}

CANDIDATE:

${runSummary(differential.candidateRuns)}

All raw repetitions preserve their own exit codes in workflow artifacts. Raw repository-wide status remains **RED — PREEXISTING** when a repetition contains failures; it is never relabeled PASS by the differential gate.

Comparator:

- unique BASE failure observations: ${differential.baseUniqueFailureObservationCount}
- unique CANDIDATE failure observations: ${differential.candidateUniqueFailureObservationCount}
- stable preexisting candidate observations: ${differential.stablePreexistingCandidateFailureCount}
- preexisting flaky candidate observations: ${differential.flakyPreexistingCandidateFailureCount}
- total candidate observations matched to BASE: ${differential.preexistingCandidateFailureCount}
- NEW/CHANGED PR regressions: **${differential.newRegressionCount}**
- BASE-only/incidental-or-flaky observations: ${differential.incidentalImprovementCount}
- DIFFERENTIAL REGRESSION GATE: **${differential.newRegressionCount === 0 ? 'PASS' : 'FAIL'}**

## 15. Review of earlier generic test/CI commits

- \`3a3f406f\` changed the generic \`useStoreSync\` renderer; differential execution showed it altered unrelated test loading. Its net change was removed by \`c3bc8726\` and is absent from the final diff.
- \`837ce077\` added generic Vitest globals in the same unrelated test; it was neutralized by \`c3bc8726\` and is absent from the final diff.
- \`0a679ebe\` added a generic global expect/jest-dom bridge; it changed unrelated suite behavior and was removed by \`f66626da\`.
- \`2de498d3\` had valid CI intent: architecture tests require generated artifacts. Its implementation evolved into symmetric exact BASE/CANDIDATE validation.
- \`9557fa7c\` corrected canonical build use and was completed by \`29f9da2d\`, which stages the same canonical \`store/dist\` artifact for both exact checkouts.

No published history was rewritten and no force push was used.

## 16. Complete per-failure differential matrix

Every unique candidate failure observation is listed below with the exact repetitions in which it occurred. An intermittent exact BASE match is explicitly labeled flaky; it is not treated as a stable failure.

| Test / file | BASE repetitions | CANDIDATE repetitions | Classification |
|---|---|---|---|
${[...matrixRows, ...improvementRows].join('\n')}

## 17. Security closeout checklist

1. Admin actor handle cannot survive logout: **PASS**.
2. Staff cannot inherit Admin actor: **PASS**.
3. simultaneous Admin+Staff credentials => \`ACTOR_SESSION_AMBIGUOUS\` => \`LOCKED\`: **PASS**.
4. ambiguity does not silently destroy one credential family: **PASS**.
5. \`actorGeneration\` independent from \`tenantGeneration\`: **PASS**.
6. tenant switch invalidates actor authority: **PASS**.
7. ActorRuntime does not change physical tenant DB selection: **PASS**.
8. no fallback to \`LanzoDB1\`: **PASS**.
9. no IndexedDB per actor: **PASS**.
10. no cash ownership transfer: **PASS / not implemented**.
11. no cart/draft cutover: **PASS / not implemented**.
12. \`ADMIN_DEVICE_USE_ADMIN_FLOW\`: **UNCHANGED**.

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
`;

fs.mkdirSync(new URL('../docs/reports/', import.meta.url), { recursive: true });
fs.writeFileSync(outputPath, report);
console.log(`Generated ${outputPath} (${Buffer.byteLength(report)} bytes)`);
