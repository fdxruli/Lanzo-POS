# Authority v2 — supervised transition pilot R1

RESEARCH ONLY. R0 baseline: main f48aab53634663438a06dc5187fa7e6d17b74fb3; inherited research c6d5e56afdbdb0e2d59dc479bdd5ada94d418f61. No product activation, PR, Preview, merge, Supabase operation or migration.

R0 plan: recover antecedents and exact source hashes; R1 isolated multi-version harness; R2 legacy admission controls; R3 lifecycle/cache/DB tests; R4 evaluate bounded external enforcement and synthetic recovery; R5 document every observation and limit. Preserve counterexamples as FAIL security observations. Never infer admission from silence, timeout, empty DB or a client boolean.

Only newly created synthetic profiles and databases may be cleaned. Tests must deny all non-fixture network requests. Authority/financial fixtures are SYNTHETIC_BOUNDARY_ONLY. Commercial financial certification and installed-PWA/physical OS testing remain separate.
