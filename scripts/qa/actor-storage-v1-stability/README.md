# Actor Scoped Storage V1 stability — isolated investigation

No PR, Preview, merge, production data or Authority v2. Start at main `f48aab53634663438a06dc5187fa7e6d17b74fb3`. Checkpoints A/B/C/D are documented in the reports. Do not deploy the experimental branch.

## Reproduce

Use Node 24 and the repository lockfile (`npm ci`). The recovered EXP14 test imports real bridge/controller/evaluator/storage and uses synthetic tenant/credentials/device. On main it must FAIL; with M-01 it passes. Existing storage tests are separate baseline regressions.

```sh
npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.test.js --maxWorkers=1
node --test scripts/qa/actor-storage-v1-stability/storage.node-test.mjs
```

Two of the five Node tests deliberately detect unresolved concurrent/pending counterexamples. Their assertion PASS does not approve those security properties.

Browser tooling is external to the product. Provide Playwright under `CODEX_PRIMARY_RUNTIME_NODE_MODULES` and an isolated Chromium binary via `ACTOR_QA_CHROMIUM_EXECUTABLE`. This run used Playwright from the runtime and @sparticuz/chromium 143.0.4 outside the repository, without modifying dependencies. The browser reports Chromium 143.0.7499.0.

```sh
node scripts/qa/actor-storage-v1-stability/browser.mjs > chromium.json
```

The server binds an ephemeral loopback port and serves only fixtures and bundled real modules. Each case uses a fresh BrowserContext. Multiple documents within a case share the same origin/localStorage. Session, device, tenant readiness and empty SALES provider are synthetic; browser authentication provider is not a certification of Admin eligibility. EXP14 Vitest uses the real evaluator for that separate proof.

The native concurrent interleaving pauses A in synchronous fixture XHR after its getItem; the server asks B's independent document to activate before allowing A to resume setItem. This is a controlled counterexample, not a frequency estimate. Do not reinterpret freeze as logout, or silence as exclusivity.

The JSON retains FAILs. Runner exit 0 indicates no harness exception, **not** security acceptance; concurrent LC13 remains FAIL. The V1-21 detecting observation is separately named PASS_LIMITATION_DETECTED and runs only a synthetic counter through Runtime, not a sale.

Global comparison: build Admin, Store and Store Vercel for each checkout, run `npm run test:ci -- --reporter=json` twice per side, then use the unchanged `scripts/compare-shared-terminal-full-suite.mjs`. PR127 uses the unchanged extract/focused/classify tools. Only checkout prefixes in JSON are normalized to canonical temporary main/pr paths, including shared node_modules symlink paths; original JSON is retained compressed. Do not change errors, assertions, timeouts, thresholds or test names.

Remote workflow success must be reported separately from local tools. No workflow_dispatch/PR was issued by this task. Windows/Android/PWA/LAN and financial E2E remain unexecuted.
