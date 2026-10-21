# Fase 3.2A.3 — admission and recovery research

RESEARCH ONLY. No imports from product src. No production backend or financial data. Never run this against a personal browser profile or Lanzo origin.

Baseline main: f48aab53634663438a06dc5187fa7e6d17b74fb3. Parent fixture: R3 a6a3b16232f11c27eb547317bd371bd90bc25618. The inherited src contains the PARTIAL storage fix; it is not identical to main and is not approved for merge.

## Reproduce

Node 24; `npm ci --ignore-scripts --no-audit --no-fund` uses the unchanged product lockfile. The research tests use the already-declared fake-indexeddb and Vitest. Do not add product dependencies.

```sh
./node_modules/.bin/vitest run scripts/qa/actor-authority-admission/admission.test.mjs --maxWorkers=1
./node_modules/.bin/vitest run scripts/qa/actor-context-contract/*.test.mjs src/services/auth/__tests__/actorRuntimeController.test.js src/services/auth/__tests__/actorSessionRuntimeBridge.test.js src/services/auth/__tests__/actorOperationalHandoff.test.js src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.test.js --maxWorkers=2
node scripts/qa/actor-authority-admission/scan-main.mjs
./node_modules/.bin/eslint scripts/qa/actor-authority-admission/*.mjs
```

The scanner reads the immutable main through git objects; does not import/execute app code. `main-write-candidates.json` includes method-name candidates, including false positives such as Set.add. It is not a full runtime call graph or financial certification. Optional AUTHORITY_QA_SOURCE_INDEX writes a function-range index to an explicit scratch path; the final commit matrix references real AST ranges, not guessed lines.

For browser reproduction use the original `scripts/qa/actor-context-contract/browser.mjs` and its README. Set ACTOR_QA_PLAYWRIGHT_MODULE to an externally installed Playwright module and ACTOR_QA_CHROMIUM_EXECUTABLE to an external Chromium binary. This execution used Playwright 1.62.1 from the runtime and Chromium 143.0.7499.0 from @sparticuz/chromium 143.0.4 installed outside the repo. Binary extraction used Node brotli and tar --no-same-owner because the package's automatic tar extraction hit host chown restrictions. No package/lock changes. No TLS fixture provided in this run: ARCH22 PENDING. PWA installed remains PENDING. See the original runner README for TLS options; do not commit TLS keys.

```sh
ACTOR_QA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs ACTOR_QA_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node scripts/qa/actor-context-contract/browser.mjs > browser-r3-replay.json
```

Main financial tests must be run in a separate checkout of the main SHA, not the inherited research src:

```sh
./node_modules/.bin/vitest run src/services/cash/cashLocalRepository.test.js src/services/db/__tests__/customerCreditRepository.test.js src/services/db/__tests__/layawaysCashConsistency.test.js src/services/financial/__tests__/financialIntentDexieConcurrency.test.js src/services/financial/__tests__/financialReceiptReconciliation.test.js src/services/sync/__tests__/syncOutboxService.actorOrigin.test.js src/services/inventory/__tests__/inventoryEntryService.test.js --maxWorkers=2
./node_modules/.bin/vitest run src/services/__test__/db/salesRepository.test.js --maxWorkers=1
```

## Interpret results

- R3 replay: 71 assertions, including five detections of counterexamples.
- New admission tests: 18 assertions, including one EXPECTED COUNTEREXAMPLE. PASS on that assertion proves the unsafe uncoordinated write was reproduced.
- The admission policy model accepts a synthetic boundary assumption only for downstream testing. There is NO real commercial verifier of that assumption. Do not implement verifiedBoundary=true as a feature flag or use empty head/DB/ACK as proof.
- Receipt tests model a remote result, without network/RPC. They do not certify SQL or real payments.
- Main focal tests: 42 + 8 unique assertions. They exercise existing behavior without v2. No complete global-suite or CI claim.
- Browser exit 0 means expected counterexamples reproduced: the seven FAIL observations remain FAIL for the security properties. 20 PASS / 7 FAIL / 2 PENDING, 29 observations. Physical Windows/Android/LAN/BFCache and financial integration remain pending.

All evidence belongs to isolated fixtures. `remote-baseline.json` contains non-secret refs, PR states, deployment SHAs and migration-history metadata only. No SQL executed, no row data, no credentials. See the design report and matrix under docs/reports. Final status TRANSITION_CONTRACT_UNRESOLVED.
