# Actor Storage V1 stability — checkpoints

Branch: audit/actor-scoped-storage-v1-stability-r1, based on main f48aab53634663438a06dc5187fa7e6d17b74fb3.

No PR, Preview, merge or production changes authorized. Both Vercel configs disable this exact branch before its remote creation. No experimental v2 sources imported.

A: recovered EXP14 integration and browser runner; fresh main execution: 10 existing storage tests PASS, EXP14 FAIL. Chromium 143 main/main reproduces stale-event false suspension and LC13 durable overwrite. The recovered runner labels the working tree candidate even when it is still main; source at A is main in both slots. Raw results retained without relabeling.

B: alternative evaluation and unchanged focal checkpoint rerun, before new mitigation.

C: scoped experimental mitigation only after before/after evidence.

D: final validation, limitations, recommendation and evidence. SHA of each checkpoint is recorded by its successor and in the final delivery to avoid a self-referential hash.

A remote: f7ab095cbb2f874a0b9aa5fbed0195e9dc44a2de.

B evaluation: recovered focal checkpoint rerun yields EXP14 PASS (11/11 with existing storage tests); Chromium focal preserves stale-event session but LC13 still FAIL in all three recovered pairs. Product sources at B exactly match old focal blobs. M-01 is retained for evaluation. M-02 caller-captured asynchronous invalidation is not introduced globally: logout finally and tenant teardown need distinct caller proofs. M-03 will guard only activated bindings against observed foreign durable ownership; pending-binding behavior remains unchanged. This is a sequential mitigation, not CAS. M-04 no global getState/controller redesign. M-05 preserves unproved paths. A controlled interleaving test must keep concurrent LC13 classified FAIL even if its detecting assertion passes.

B remote: b2322dc6284d597d3fd2b4759e45c574db2dd9ef.

C: M-01 plus M-03 activated-binding sequential mitigation. Auth focal final: 260/260 PASS. AUTH-25 mock updated to actual foreign_context identity/generation/token contract; two negative tests ensure obsolete bindings do not lock the current Admin. Initial mock-only failure retained in the final evidence narrative. Node: 5 detecting assertions PASS, including concurrent and pre-activation counterexamples whose SECURITY properties remain FAIL. Chromium final: 27 observations, 16 PASS / 11 FAIL / 0 harness errors; main-A/candidate-B still FAIL, candidate-A/main-B sequential PASS, candidate/candidate sequential PASS, controlled native read/write race still FAIL. No claim of full invalidation correction. Broad regression, build and CI attribution still in progress.
