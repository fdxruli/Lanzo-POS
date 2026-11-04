# F01-2A financial execution lifetime — optional, no commercial gate

Only `financialTimeout`, ledger/recovery optional propagation and the new
`financialExecutionLifetime` helper change. The helper injects the existing
F01-1 executor contract; no coordinator, Runtime, DB, React or network imports.
A complete root factory and every timeout-hidden child must be observable.
Client settlement never confirms server outcome. Unknown work must remain held.
No App/main wiring, Supabase projects, real payments, migrations or deployment.

From an isolated checkout with the unchanged package-lock dependencies:

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012a --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012a/evidence/life-final.json
ACTOR_QA_CHROMIUM_EXECUTABLE=/absolute/path/chromium node scripts/qa/single-instance-f012a/browser.mjs
node scripts/qa/single-instance-f012a/builds.mjs /absolute/evidence/candidate
node scripts/qa/single-instance-f012a/run-regressions.mjs /absolute/evidence/candidate
node scripts/qa/single-instance-f012a/global.mjs /absolute/evidence/candidate
```

Run the same validation scripts with cwd at an independent baseline checkout of
`7d9f4562a4b12efdcdfb8d5fbb77a4ff9d81ec50`, using the same dependencies and a distinct
output directory. Run its existing `single-instance-f012/financial-drain.test.js`
and `single-instance-f012/browser.mjs` for actual negative controls. Preserve
those COUNTEREXAMPLE results. New helper tests are candidate-specific, not
expected to work on a baseline that lacks the helper.

Builds run actual `VERCEL_ENV=preview` and `VERCEL_ENV=production` separately, then
Store and Store Vercel. Run architecture/global tests after builds. These are local
compilations, not Vercel deployments. The scripts do not connect to Supabase.
Global/selected suites preserve historical failures and nonzero exit statuses.
Do not change assertions/thresholds to obtain green. Evidence JSON may be gzip
compressed after execution; `gzip -dc` recovers the exact original bytes.

LIFE tests use real timeout/observer/ledger/recovery/lease code and Dexie on
fake-indexeddb. Auth/actor/provider/RPC and projection callback are synthetic;
Runtime/Storage policy is separately tested in regressions. CE-RECOVERY-04 uses
the unchanged real 35s dispatch timer, with the existing supported 120s lease
option. Other short timers use fixture options; no fake timers in the new suite.
Never-settling tests intentionally keep isolated fake runners pending.

Chromium uses same context/origin A and B, native Web Locks, real coordinator and
observer, synthetic transport followed by a synthetic local continuation. It
checks B stays queued after public timeout AND after transport completion until
the local continuation finishes. Separate real document close preserves ambiguous
synthetic localStorage evidence. That and ledger reopen do not jointly certify
an E2E crash/payment/receipt flow. No real financial dispatch is performed.

Playwright loads from CODEX_PRIMARY_RUNTIME_NODE_MODULES, or the normal resolver.
Chromium is external tooling; supply LD_LIBRARY_PATH/FONTCONFIG_FILE if your
binary needs them. Ephemeral root Linux flags are not browser settings for users.
No profile, certificates, flags for insecure origins, package/config changes or
Docker. Fixtures are not reachable from App/main/public or precache.

Read both `LANZO.F01.F012A.FINANCIAL.LIFETIME.*.md` reports for pending cash/hook,
detached sync/bootstrap callers, unknown frontier handling and F01-2 HOLD.
