# F01-1 isolated laboratory

No entry is added to Vite, App or the public tree. The server serves only synthetic fixtures and bundles the actual three coordinator modules. No database, actor, license, network service or financial runtime is imported. Use an isolated checkout and ephemeral Chromium processes.

```sh
npm ci --ignore-scripts
node node_modules/vitest/vitest.mjs run src/services/instance/__tests__ --maxWorkers=1
node node_modules/eslint/bin/eslint.js src/services/instance
node scripts/qa/single-instance-f011/run-regressions.mjs
ACTOR_QA_CHROMIUM_EXECUTABLE=/absolute/path/chromium CODEX_PRIMARY_RUNTIME_NODE_MODULES=/absolute/path/tooling/node_modules node scripts/qa/single-instance-f011/browser.mjs
node scripts/qa/single-instance-f011/inspect.mjs
npm run build
node scripts/qa/single-instance-f011/audit-build.mjs production dist
VERCEL_ENV=preview npm run build
node scripts/qa/single-instance-f011/audit-build.mjs preview dist
npm run build:store
node scripts/qa/single-instance-f011/audit-build.mjs store dist-store
npm run build:store:vercel
```

Use the lockfile's dependencies. Playwright and Chromium are external laboratory tooling, not product dependencies. Set the Chromium executable to an installed compatible binary. The runner uses `--no-sandbox` only inside the isolated Linux laboratory because the ephemeral process runs as root; it does not change Chrome settings, trust certificates, mark HTTP IP secure, or operate the owner's browser. Do not use that launch configuration as a desktop setup recommendation.

For a differential run, create a separate checkout at the `base` SHA recorded in evidence, point it at the same dependency installation, and invoke the candidate's `run-regressions.mjs` with an absolute output directory ending in `evidence/base`. Run `compare.mjs` in the candidate. The regression process intentionally exits 1 for the four unchanged historical split-close failures. Do not relax those assertions.

`browser.mjs` overwrites `evidence/chromium.json` as cases finish, records all errors, and exits 1 for unexpected FAIL or page errors. A deliberate COUNTEREXAMPLE remains a failed exclusion guarantee even when collection exits zero. HTTP IP interception is PARTIAL evidence, never a physical LAN test. F011-30 launches a separate browser process/profile; competitors in other cases share one context/origin. No installation/PWA or OS hibernation is simulated as a physical PASS.

`runExecutor` registers work before invoking its callback. Check the captured ticket after every relevant await and before effects. It cannot cancel ESM evaluation or undo effects that the callback performs without checking. Do not await `quiesceAndRelease` inside an executor that it must itself drain; request quiescing externally, or request it without awaiting and allow that executor to settle. Never add a drain timeout that grants ownership to another document.

Reports document the intentionally unmodified commercial bootstrap, legacy limitation and open LC13 boundary. No gate or React adapter is activated by this change.

Large JSON evidence is stored losslessly as `.json.gz` in this checkpoint. The runners emit plain JSON on reproduction; `compare.mjs` reads either representation. Decompress with `gzip -dc file.json.gz` to inspect the original bytes.
