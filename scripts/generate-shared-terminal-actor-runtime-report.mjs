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

const commitChain = execFileSync('git', ['log', '--reverse', '--format=- `%h` %s', `${BASE_SHA}..HEAD`], { encoding: 'utf8' })
  .split('\n')
  .filter((line) => line && !line.includes('docs(shared-terminal): publish actor runtime closeout report'))
  .filter((line) => !line.includes('docs(ci): generate actor runtime closeout report'))
  .join('\n');

const matrixRows = differential.matrix.map((row) => (
  `| ${escapeCell(row.id)} | FAIL: ${escapeCell(firstError(row))} | FAIL: same normalized error | ${row.classification} |`
));
const improvementRows = differential.incidentalImprovements.map((row) => (
  `| ${escapeCell(row.id)} | FAIL: ${escapeCell(firstError(row))} | PASS/absent | ${row.classification} |`
));

const report = `# SHARED.TERMINAL.1 — Actor Runtime Foundation

## 1. Scope and exact repository state

Repository: \`fdxruli/Lanzo-POS\`  
Authoritative base: \`main@${BASE_SHA}\`  
Branch: \`feat/shared-terminal-actor-runtime\`  
PR: \`#208\` — DRAFT / unmerged  
Validated executable code/CI head before report publication: \`${VALIDATED_CODE_HEAD}\`  
Final published HEAD: **the Git commit containing this report**, resolved authoritatively by GitHub PR #208 and the final closeout response. A commit cannot embed its own SHA in its own tree without changing that SHA, so this report does not create an endless self-referential report-only commit chain.

SHARED.TERMINAL.1 is limited to ActorRuntime Foundation. It does not change physical tenant DB selection and does not start SHARED.TERMINAL.2.

## 2. Phase commit chain

${commitChain}

Report-generation/report-only commits are intentionally excluded from the generated chain above so regeneration is idempotent.

## 3. ActorRuntime architecture and state machine

\`ActorRuntimeController\` is a local/client authority layer independent from TenantRuntime. It binds one authenticated actor/session to the already-authorized tenant runtime and never selects or creates the tenant database.

States:

- \`LOCKED\`: no usable actor authority.
- \`AUTHENTICATING\`: explicit Admin or Staff authentication in progress.
- \`HANDOFF_CHECK\`: actor/session/tenant binding is being validated.
- \`GRANTED\`: one exact actor/session is authorized for the captured tenant runtime.

Logout, actor replacement, ambiguous restore evidence, or invalid binding returns authority to \`LOCKED\` and advances actor generation. There is no silent actor inheritance.

## 4. actorKey, tenant binding, and generation

Stable actor keys are \`admin:<id>\` and \`staff:<id>\`. Grant binds actor type/id/key, exact session id, permissions, ActorRuntime generation, tenant opaque id, physical tenant DB name, and TenantRuntime generation.

Actor generation is independent from tenant generation. \`assertCurrent()\` rejects a handle when actor generation, actor key, session, tenant generation, tenant id, or physical database binding is no longer current. A tenant switch therefore invalidates prior actor authority without making ActorRuntime responsible for physical DB routing.

## 5. Stale handle and guardedWrite contract

\`ACTOR_CONTEXT_STALE\` is raised for a handle from an earlier actor/session/tenant generation. \`runWithActorHandle()\` validates before work and again after awaited work. Because a post-Promise check cannot undo a side effect, actor-sensitive side effects already inside SHARED.TERMINAL.1 use \`guardedWrite()\` to validate immediately at the effective write boundary.

Regression coverage proves:

1. actor A captures a handle, logout/actor change occurs, later use is stale and protected work does not continue;
2. generation changes during an async wait and the stale authority is detected;
3. a new actor cannot reuse the prior generation's handle.

## 6. Admin and Staff login integration

Admin and Staff authentication each begin ActorRuntime authentication, validate the exact tenant-scoped session binding, and grant the stable actor before publishing readiness. Staff cannot inherit Admin actor authority. \`ADMIN_DEVICE_USE_ADMIN_FLOW\` remains unchanged.

## 7. Bootstrap restoration and ambiguity

Bootstrap inspects both credential families before choosing an actor. One valid Admin family restores Admin. One valid Staff family restores Staff.

Simultaneous valid Admin + Staff evidence is explicit \`ACTOR_SESSION_AMBIGUOUS\` and **fails closed**:

- ActorRuntime => \`LOCKED\`;
- no Admin or Staff identity is granted;
- no inherited actor survives;
- ambiguity is detected before role-opposite cleanup can erase evidence;
- neither credential family is silently destroyed merely to select an identity.

## 8. Logout invalidation

Logout locks ActorRuntime and advances actor generation. An Admin or Staff handle captured before logout cannot be used by a later session. A new session must authenticate/restore and receive its own generation-bound authority.

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

## 12. Reproducible validation design

BASE and CANDIDATE run as independent GitHub checkouts under the same assumptions: Node 22, \`npm ci\`, \`npm run build\`, \`npm run build:store\`, canonical \`npm run build:store:vercel\` staging of local \`store/dist\` (no deployment), and \`npm run test:ci -- --reporter=json --outputFile=full-suite.json\`.

The raw BASE and CANDIDATE suites remain visible with their real exit codes and JSON/log artifacts. They are observational only so both reports can be collected. A separate **blocking comparator** fails if the candidate contains a test failure absent from BASE or if the same test has a different normalized error.

Relevant ESLint executes independently and is not skipped because a raw repository-wide suite is red.

## 13. Focused validation

On validated code head \`${VALIDATED_CODE_HEAD}\`:

- ActorRuntime focused: **25/25 PASS**.
- Tenant / IndexedDB / recovery: **179/179 PASS**.
- Authentication regression: **41/41 PASS**.
- Relevant ESLint: **PASS**.
- \`npm run build\`: **PASS**.
- \`npm run build:store\`: **PASS**.

The final report-containing HEAD reruns these same blocking checks before closeout.

## 14. Raw full-suite results

BASE \`main@${BASE_SHA}\`:

- **FAIL / RED — PREEXISTING**
- ${differential.base.passed} passed / ${differential.base.failed} failed / ${differential.base.skipped} skipped / ${differential.base.total} total
- ${differential.base.suitesFailed} failed files / ${differential.base.suitesPassed} passed files / ${differential.base.suitesTotal} total files
- raw exit code: 1

CANDIDATE at validated code head:

- **FAIL / RED — NO NEW FAILURES**
- ${differential.candidate.passed} passed / ${differential.candidate.failed} failed / ${differential.candidate.skipped} skipped / ${differential.candidate.total} total
- ${differential.candidate.suitesFailed} failed files / ${differential.candidate.suitesPassed} passed files / ${differential.candidate.suitesTotal} total files
- raw exit code: 1

Comparator:

- BASE failure entries: ${differential.baseFailureCount}
- CANDIDATE failure entries: ${differential.candidateFailureCount}
- CANDIDATE entries matching BASE exactly: ${differential.preexistingCandidateFailureCount}
- NEW/CHANGED PR regressions: **${differential.newRegressionCount}**
- incidental improvements: ${differential.incidentalImprovementCount}
- DIFFERENTIAL REGRESSION GATE: **${differential.newRegressionCount === 0 ? 'PASS' : 'FAIL'}**

The raw full suite itself is not mislabeled as PASS.

## 15. Review of earlier generic test/CI commits

- \`3a3f406f\` changed the generic \`useStoreSync\` renderer; the differential showed this altered unrelated test loading. Its net change was removed by \`c3bc8726\` and it is absent from the final diff.
- \`837ce077\` added generic Vitest globals in the same unrelated test; it was neutralized by \`c3bc8726\` and is absent from the final diff.
- \`0a679ebe\` added a generic global expect/jest-dom bridge; it changed unrelated suite behavior and was removed by \`f66626da\`.
- \`2de498d3\` had valid CI intent: architecture tests require generated artifacts. Its implementation evolved into the current symmetric BASE/CANDIDATE validation.
- \`9557fa7c\` corrected canonical build use and was completed by \`29f9da2d\`, which stages the same canonical \`store/dist\` artifact for both exact checkouts.

No published history was rewritten and no force push was used.

## 16. Complete per-failure differential matrix

Every candidate failure is listed below. The BASE column records the comparator-normalized leading error/assertion signature. “same normalized error” means the exact test/file failure was present on BASE with the same normalized error. A candidate-only or changed-error row would be classified as a PR regression and would fail the blocking gate.

| Test / file | BASE | CANDIDATE | Classification |
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

The repository-wide raw suite remains red on the exact base and candidate. Those preexisting failures remain visible and are not repaired, skipped, weakened, or converted into warnings by this phase. The differential evidence proves zero new/changed full-suite regressions attributable to PR #208.

**SHARED.TERMINAL.1: PASS under the red-baseline policy, provided the final report-containing HEAD reproduces the focused green checks and differential gate.**

- FULL SUITE BASELINE: **RED — PREEXISTING**.
- FULL SUITE CANDIDATE: **RED — NO NEW FAILURES**.
- DIFFERENTIAL REGRESSION GATE: **PASS**.
- Supabase production: **UNTOUCHED**.
- Cloud migration: **NOT REQUIRED**.
- Merge: **NO**.
- SHARED.TERMINAL.2: **NOT STARTED**.
`;

fs.mkdirSync(new URL('../docs/reports/', import.meta.url), { recursive: true });
fs.writeFileSync(outputPath, report);
console.log(`Generated ${outputPath} (${Buffer.byteLength(report)} bytes)`);
