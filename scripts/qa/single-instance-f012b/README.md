# F01-2B bootstrap lifecycle (no gate activation)

`initializeApp` keeps only its in-flight promise. A later invocation may reuse
current GRANTED authority after fresh session/device/tenant proof, full license
equality and online verification; never a permanently cached success. Admin
still uses the existing deadline/monotonic/offline proof; Staff remains online.
`force` and changed evidence take the original restoration path.

The optional `lifecycle` parameter supports `track(factory)`, `assertCurrent`,
`markUnobservable(reason)`, `quiesce`, `drain`, and `getSnapshot`. Register before
start. Quiesce prevents new work but does not cancel work already started. Drain
has no timeout or force release. Unknown critical work deliberately never drains.
Neither draining nor registration authorizes anything. A future coordinator must
register and await the lifecycle root/drain as an executor; no such commercial
wiring exists here. Unknown profile/preference/Drive and sync-processing paths
keep **HOLD_BACKGROUND_LIFETIME**. Do not use this helper to claim whole-App drain.

Reproduce from the repository root with the unchanged lockfile dependencies:

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012b --maxWorkers=2 --reporter=json --outputFile=/absolute/evidence/matrix.json
node scripts/qa/single-instance-f012b/validate.mjs /absolute/evidence/candidate --build
node /absolute/candidate/scripts/qa/single-instance-f012b/validate.mjs /absolute/evidence/base
node scripts/qa/single-instance-f012b/baseline-probe.mjs /absolute/separate-baseline-checkout /absolute/evidence
```

For the baseline use exact `5bfd0693224d92ae8957684bc85bc61ed6cbab90` and the
same dependencies. Run validation with that checkout as cwd. The probe creates
and removes an untracked synthetic test within that separate baseline checkout;
run it outside the checkout being used for the global comparison.
`validate` preserves failing suites and runs the next stage; its wrapper exit
alone is not evidence of PASS. Inspect each stage's exit/result files.

Fixtures use synthetic actors/providers/transport, the actual actor controller,
fake-IDB, real bootstrap and validation implementations. Background timeout tests
use the unchanged 8000ms interval with fake timers. `transport.test` uses actual
`revalidateLicense` and a mocked RPC, never Supabase projects. BG-36..40 exercise
preparation/activation with synthetic loaders; they do not mount the actual App
in restricted mode. Full-App restricted mounting remains prohibited.

Global and selected regression logs/JSON may be compressed losslessly (`gzip -dc`).
All initial failed fixture attempts are preserved as well as corrected final runs.

Run one validation pipeline per checkout at a time. Never overlap builds that
write the same dist/dist-store/store/dist outputs. Preserve any failed result
before rerunning. Store Vercel passed on a fresh candidate checkout with the same
six sources; EEXIST from a reused staging directory remains archived separately.
See fresh-store-vercel.json and the report rather than treating the serial
wrapper's exit code as a PASS. `verify-preservation.mjs` independently verifies
allowed source changes and absence of QA/coordinator markers in emitted outputs.
