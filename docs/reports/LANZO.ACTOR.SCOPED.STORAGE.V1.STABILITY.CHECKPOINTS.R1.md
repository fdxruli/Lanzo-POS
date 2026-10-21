# Actor Storage V1 stability — checkpoints

Branch: audit/actor-scoped-storage-v1-stability-r1, based on main f48aab53634663438a06dc5187fa7e6d17b74fb3.

No PR, Preview, merge or production changes authorized. Both Vercel configs disable this exact branch before its remote creation. No experimental v2 sources imported.

A: recovered EXP14 integration and browser runner; fresh main execution: 10 existing storage tests PASS, EXP14 FAIL. Chromium 143 main/main reproduces stale-event false suspension and LC13 durable overwrite. The recovered runner labels the working tree candidate even when it is still main; source at A is main in both slots. Raw results retained without relabeling.

B: alternative evaluation and unchanged focal checkpoint rerun, before new mitigation.

C: scoped experimental mitigation only after before/after evidence.

D: final validation, limitations, recommendation and evidence. SHA of each checkpoint is recorded by its successor and in the final delivery to avoid a self-referential hash.
