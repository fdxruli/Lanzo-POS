# Authority v2 — supervised transition pilot R1

**RESEARCH ONLY — ADMISSION_UNPROVEN. SYNTHETIC_BOUNDARY_ONLY.**

No imports from product src, commercial activation, SQL, migration, PR or Preview. Never point the harness at a Lanzo URL or personal profile. The browser runner binds a random loopback port and creates isolated BrowserContexts; it never connects to a preexisting browser. Private-IP capability navigation is intercepted. HTTP/TLS localhost are synthetic origins. Temporary TLS keys and tooling must remain outside Git.

Main: `f48aab53634663438a06dc5187fa7e6d17b74fb3`. Parent research: `c6d5e56afdbdb0e2d59dc479bdd5ada94d418f61`. The inherited product src is a partial storage fix, not main and not approved for release.

## Components

- `fixtures/main-actorScopedStorage.mjs`: exact main Git blob `dcc09e7be2fcf2435801302c3199f8592e029edc`, independently checked before execution. Its tenant binding uses the expected product format but the named commercial DB is never opened.
- `client.mjs`: real legacy storage handle vs inherited v2 prototype. `protectedWrite` denies without admission and creates no effects. `write` on v2 deliberately bypasses admission to refute the unsafe activation hypothesis. That deliberate grant is never positive admission.
- `browser.mjs`: Chromium, CDP freeze/thaw, genuine CacheStorage/SW, native IDB, exact Dexie 4.4.3; synthetic effects only. Twelve FAIL rows are security counterexamples. Separate contexts demonstrate storage separation, not physical profiles. No full app bootstrap, Runtime auth, POS sale or RPC loaded.
- `financial.mjs`: Node/fake-indexeddb prototype and receipt-model tests. Nine FIN cases pass; FIN-T3-09 is pending, linked to actual browser waiting observation. Nine data-kind fixtures and ten rejected policy claims are separate counts. Metadata named credit/layaway/cash is not a test of those product repositories.
- `verify.mjs`: verifies artifact hashes, expected counterexamples, positive scoped results, fixture counts and that no positive admission exists. Exit zero means internally consistent research evidence.
- `evidence/browser-r2.json`: superseded first complete pass, not added to final totals. R2 note explains missing waiting observation and corrected source extraction newline.

## Reproduce

Use Node 24. Install the unchanged product lockfile only in an isolated clone (`npm ci --ignore-scripts --no-audit --no-fund`). No tooling dependency is added to package.json. This run used existing external Dexie 4.4.3, fake-indexeddb 6.2.5 and Vitest 4.0.14; Playwright from the primary runtime and an externally installed @sparticuz/chromium 143.0.4 yielding Chromium 143.0.7499.0. A normal external Chromium may be supplied instead; record its actual version and do not reuse these results for it.

```sh
node scripts/qa/authority-v2-supervised-transition/financial.mjs
ACTOR_QA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
ACTOR_QA_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
ACTOR_QA_TLS_KEY=/absolute/path/to/disposable.key \
ACTOR_QA_TLS_CERT=/absolute/path/to/disposable.crt \
node scripts/qa/authority-v2-supervised-transition/browser.mjs
```

Optional external modules: `AUTHORITY_QA_DEXIE` is the installed dexie.mjs path, `AUTHORITY_QA_FAKE_IDB` is fake-indexeddb's build/esm/index.js path. TLS is local with a disposable self-signed certificate accepted only by the fixture. Without certificate paths HTTPS remains PENDING; do not claim public-chain validation.

Run the inherited prototype/admission tests using a temporary Vitest config with node environment, exactly these two include paths, and no commercial bootstrap: `scripts/qa/actor-context-contract/prototype.test.mjs` and `scripts/qa/actor-authority-admission/admission.test.mjs`. This is 42 assertions, including five detections of counterexamples. It is not the historical 71-test Runtime suite.

```sh
node scripts/qa/authority-v2-supervised-transition/verify.mjs
```

The verifier checks this run's observed evidence, including local TLS. On another environment, a different legitimate PENDING/PASS observation needs explicit review, not silently changing expected safety assertions. Browser exit 2 reports harness errors; browser exit 0 alone does not certify the expected FAIL counterexamples. The verifier fails if an expected counterexample disappears or a positive scoped observation fails. Browser missing waiting is PENDING, not a product security failure. A registration/update attempt did not expose a waiting worker in this environment; pending intent and handle remained intact. No skipWaiting/reload was used to manufacture waiting.

R0 baseline; R1 harness; R2 ingress evidence; R3 browser/storage evidence; R4 evaluation/financial evidence; R5 reports. Every checkpoint is remotely reachable from the research branch. Source hashes, before/after snapshots, versions, profile labels and limitations are preserved in JSON. No installed-PWA, session restore, BFCache or physical Windows/Android claim.
