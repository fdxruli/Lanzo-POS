# F01-2D.1 — POS Sync boundaries

Only #373, stacked on #372. Gate OFF, LC13 OPEN, no merge/production/Supabase
projects. Overall PARTIAL: event consumers and full handlers retain UNKNOWN.

Use clean baseline `0f1625f46e6fe234e378487bb06f74f4bd1555e9`, current main
`52bb573e651529b323b6617e3161cd76ece14a39` and candidate checkouts with the same
lockfile/dependencies. Freeze product sources before accepted runs. Run builds
serially within each checkout; do not build into the same dist from two processes.
When main lacks the F01 runners, invoke the candidate runner by absolute path;
its inner commands still use cwd's source/config. Do not retarget the PR for CI.

```sh
node /candidate/scripts/qa/single-instance-f012d1/validate.mjs /evidence/base --build
node /candidate/scripts/qa/single-instance-f012d1/validate.mjs /evidence/main --build
node /candidate/scripts/qa/single-instance-f012d1/validate.mjs /evidence/candidate --build
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d1 --maxWorkers=1 --reporter=json --outputFile=/evidence/focal.json
node scripts/qa/single-instance-f012d1/compare.mjs /evidence
node scripts/qa/single-instance-f012d1/audit.mjs /evidence
node scripts/qa/single-instance-f012d1/browser.mjs /evidence
sha256sum -c scripts/qa/single-instance-f012d1/evidence/frozen-sources.sha256
git diff --check
```

`validate.mjs` retains real stage exit codes; existing failing suites are not
green. `compare.mjs` compares identity/status/error signature against BOTH
baselines and invokes the original PR127 classifier without changing it. Only
known absolute checkout/dependency prefixes are normalized symmetrically.

36 new focal assertions are also included in the candidate global count, never
added a second time. `realtime.test.js` runs the actual producer/scope with
controlled transport. `outbox.test.js` uses actual orchestrator, producer,
outbox/meta and Dexie (controlled tenant/transport). `handlers.test.js` uses real
handlers/local repositories/mappers, customer/credit migration and sales shadow
with controlled RPC or one delayed/failed branch. `subscribers.test.jsx` is a
PASS of reproducing a real cancellation/useCaja counterexample, not closure.
`registry.test.js` records the actual cold auto-root registration order without
calling start, activation or App. Other roots may overwrite shared registrations.

`browser.mjs` requires a compatible native Chromium and Playwright. It preserves
the browser sandbox and tests actual producer/scope in same-origin documents
using native Web Locks and controlled external transport. Missing binary is
NOT_EXECUTED, never substituted by deterministic lock tests. It does not test
App/gate, server commits or physical PWA/BFCache/LAN behavior.

Scope does not grant authority. All original tenant/actor/session/device,
permission, lease, receipt, idempotency and origin rules remain mandatory. The
Realtime callback lifetime covers its returned promise and the audited
orchestrator descendants; arbitrary detached work in caller callbacks requires
its own contract. Private handle provenance is not a general certification of
unknown handlers/providers. Existing UNKNOWN remains irreversible.

`stop()` fences producer scheduling synchronously; registered cleanup waits raw
channel retirement. A pending callback or timer already fired stays observed.
No cleanup calls or awaits its own drain. Never-settling raw work blocks drain.
Same generation cannot silently restart a stopped listener/change topic; new
scope requires previous drain. Public rejection/local settlement is not success
or remote confirmation. Durable pending rows are distinct from live execution.

Full inventory, limits and source links: `evidence/inventory.json` and the two
F012D1 reports. Large evidence is losslessly gzip-compressed; decompress before
comparison. Preserve regenerated historical traces under this new phase and
restore only their original historical paths. Do not overwrite earlier reports.
