# M-01 only QA

Run from the repository root with the lockfile dependencies installed. Browser QA additionally requires external Playwright (`CODEX_PRIMARY_RUNTIME_NODE_MODULES/playwright/index.mjs`) and `ACTOR_QA_CHROMIUM_EXECUTABLE` pointing to Chromium. Product dependencies are unchanged.

```sh
node scripts/qa/actor-storage-m01-only/browser.mjs > chromium.json
npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.m01.integration.test.js --maxWorkers=1
```

The runner loads main f48aab53, recovered focal 1cdc1cd0, and the current working tree into real Chromium documents sharing one origin within each BrowserContext. It uses commercial storage/controller/bridge/tenant/handoff with synthetic authentication, device, tenant readiness and empty SALES providers. It never opens the commercial app or Supabase.

FAIL results for EXP14-main and LC13 remain FAIL. Exit zero means evidence collection completed without HARNESS_ERROR; it does not turn the security properties into PASS. The concurrent barrier instruments Storage.setItem: v1 invalidation has no ownership read, so B activates after A's last observation and immediately before A's publication. No claim of CAS or physical OS hibernation.

Evidence JSON is losslessly gzip-compressed; use gzip -dc. Global suite originals retain all stacks. PR127 inputs replace only these exact path prefixes, in both reports: lanzo-main -> /home/runner/work/Lanzo-POS/main; lanzo-m01 -> /home/runner/work/Lanzo-POS/pr; shared install -> /home/runner/work/Lanzo-POS/shared/node_modules. No semantic content, timeout or assertion is normalized. Raw diagnostic and official comparator output are retained. Zero focal targets means zero repetitions, not 20 passes.
