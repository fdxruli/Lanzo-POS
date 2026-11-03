# F01-2D — delegated sync lifecycle

Only PR #373, stacked on #372. Gate remains OFF. No production services or data.
Use the existing lockfile/dependencies, separate clean baseline/candidate checkouts,
and run builds serially within each checkout. No Docker or dependency downloads.

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012d/evidence/focal.json
node scripts/qa/single-instance-f012b/validate.mjs /absolute/evidence/candidate --build
# Same command/dependencies, cwd baseline exactly c20e3538:
node scripts/qa/single-instance-f012b/validate.mjs /absolute/evidence/base --build
node scripts/qa/single-instance-f012d/compare.mjs /absolute/evidence
node scripts/qa/single-instance-f012d/audit.mjs
node scripts/qa/single-instance-f012d/browser.mjs
```

The validation wrapper continues after failures: inspect exit/global/build JSON.
Global includes F01-1/A/B/C/D and all original policy/financial/architecture tests.
The comparator normalizes only checkout prefixes symmetrically and invokes the
original PR127 comparator unchanged. No altered assertions, thresholds or errors.
Retain initial harness errors and any intermediate candidate evidence separately.
Large JSON/logs may be losslessly gzip compressed; decompress before comparison.
Legacy labs can regenerate their traces; preserve generated versions under this
phase before restoring only those original historical trace paths to their blobs.

`scope.test.js` tests the actual scope, registration, continuations and drain.
`sync.test.js` tests the actual auto/bootstrap/orchestrator with synthetic providers.
`recovery.test.js` tests the actual automatic coordinator with synthetic actor,
ledger and recovery providers. F01-2A and the original financial tests separately
exercise real receipt-first/ledger/timeout policies. Mock recovery results alone
never certify an actual payment or prove every projection subscriber has settled.
`instance.test.js` uses the real F01-1 coordinator and a deterministic LockManager
substitute: it is not Chromium. `browser.mjs` requires an existing binary; a failed
launch is NOT_EXECUTED. No prior browser results count as this phase's execution.

Scopes are optional and must be reserved before default work in that document.
A caller injects an immutable actor/session/tenant generation guard; the scope
never obtains, refreshes or grants authority. A token.track factory is only an
internal continuation necessary to finish already admitted work; it cannot
install sources or timers. The financial coordinator reuses F01-2A's parameter.
All domain authorization/lease/receipt/idempotency contracts remain mandatory.

`quiesce()` closes admission synchronously, cancels untriggered timers and
registers cleanup before invoking it. `stop()` returns scheduling teardown only.
`settleObserved()` waits for registered local work and reports DRAINED or UNKNOWN.
`drain()` resolves only for DRAINED, with no timeout or forced release. UNKNOWN
is irreversible; cleanup failure remains UNKNOWN. The module never releases a
Web Lock. A caller must register its drain with the instance executor before
requesting voluntary release. That commercial wiring remains unimplemented.

Handlers/snapshots and low-level POS realtime descendants keep explicit UNKNOWN.
License sync/security realtime and broad Admin/offline preparation are not wired
into this scope. Existing bootstrap lifecycle UNKNOWN markers are not removed.
No full-app SYNC_QUIESCED, remote confirmation, LC13 fix or gate activation follows.
Physical Windows/Android/PWA/BFCache/LAN/HTTPS QA remains outside this lab.
