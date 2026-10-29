# F01-2 boundary evidence — HOLD_RECOVERY_INTEGRATION

This is a stopped integration, not an active F01-2 implementation. No fixture is
reachable from main, App, public, Vite inputs or precache. The product remains
identical to the exact #372 source. No Supabase connection or owner's data is used.

Reproduce in an isolated checkout with the pinned package-lock:

```sh
npm ci --ignore-scripts
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012 --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012/evidence/probes.json
ACTOR_QA_CHROMIUM_EXECUTABLE=/absolute/path/chromium node scripts/qa/single-instance-f012/browser.mjs
node scripts/qa/single-instance-f012/inspect.mjs
node node_modules/vitest/vitest.mjs run src/services/instance/__tests__ --maxWorkers=1
node scripts/qa/single-instance-f011/run-regressions.mjs scripts/qa/single-instance-f012/evidence/regression
```

Playwright is external tooling loaded from CODEX_PRIMARY_RUNTIME_NODE_MODULES, or
the ordinary module resolver when that variable is absent. Chromium must be a
compatible external executable. --no-sandbox is for the ephemeral root Linux
laboratory only, not an owner's browser configuration. No insecure-origin flags,
certificates, user profiles, migrations or real financial operations are involved.

The recovery probe CE-RECOVERY-04 waits for the real, unchanged 35s financial
dispatch timeout. Its lease uses the supported 120s option so the result is not
obscured by lease expiry. No fake timers or patched product sources are used.
The shorter 30ms dispatch override in CE-DRAIN-02 is separately identified.

Four guarantees have counterexamples (timeout/native task, ledger/native task,
full inventory from the capped query, sequential bootstrap). CE-RECOVERY-04 adds
the real recovery path, and the browser shows the corresponding lock-release
counterexample. A passing assertion that reproduces a counterexample is not a
passing safety guarantee. The raw-tracking browser control demonstrates a possible
lifetime mechanism only; it is not wired into the ledger or commercial bootstrap.

Real modules: financial timeout, ledger, canonicalization, receipt classification,
recovery, projection registry/leases, Dexie on fake-indexeddb; coordinator and
native Chromium Web Locks. Substituted: database provider, actor handle, Auth,
tenant, profile and network. Bootstrap runs the real license bootstrap with those
providers; it does not verify Admin or Staff policy. Existing policy suites run
separately and never substitute for integrated F01-2 QA.

The 831-test regression selector intentionally preserves four historical split-close
failures and returns exit 1. Do not change their assertions. All F012-01..55
end-to-end acceptance cases remain NOT_TESTED because the gate was not activated.
