# LANZO ACTOR SCOPED STORAGE M-01 ONLY — EVIDENCE R1

Fecha: 21 de octubre de 2026, America/Mexico_City. Evidencia nueva local sobre main f48aab53 y candidata M-01-only. La primera publicación D conserva el estado de preparación; este cierre documental separado identifica expresamente la candidata D y sus resultados, sin mover el HEAD probado del PR #367.

Fuentes: main f48aab53634663438a06dc5187fa7e6d17b74fb3; focal 1cdc1cd029982e0279177ab29be1f8fffacb6ed8; checkpoint remoto de código 89c8f67c; pruebas finales remotas 9e98fd7f (árboles equivalentes a los checkpoints locales 6363772a y 95468ca9). Dos módulos comerciales idénticos al focal; invalidate idéntico a main. Runtime/controller/handoff/política/SW no cambian.

Los artefactos se conservan en `scripts/qa/actor-storage-m01-only/evidence/`. JSON, diffs y logs originales gzip sin pérdida. Node 24.19.0; lockfile SHA-256 `59e12324df46b964748524051be34760fcc3c1050ef57a8b03deb16c4ae2b581`, idéntico al checkout de dependencias reutilizado por symlink. No cambio de paquetes o configuración.

| Artefacto | Alcance |
| --- | --- |
| main-exp14/focal-exp14/candidate-exp14.json.gz | rojo baseline y comparación exacta de EXP14+storage |
| main-m01-expanded.json.gz | 5 PASS / 15 FAIL de matriz nueva en producto main |
| auth-first/m01-expanded.json.gz | intentos iniciales preservados, errores de mock/secuencia del fixture |
| auth-final.json.gz | 280 PASS antes de añadir las dos últimas negativas; no es el contador final del global |
| mock-boundary-final.json.gz | 47 PASS del fixture final; global ejecuta esas 47 |
| financial.json.gz | 188 PASS: sales/cash/credit/layaway/inventory/ledger/outbox/receipts/recovery/handoff |
| dexie.json.gz | 127 PASS, archivos únicos del workflow |
| license.json.gz | 118 PASS de licencias/sesiones/aislamiento |
| architecture.json.gz | primer ENOENT por ejecutar durante build Store, conservado |
| architecture-final.json.gz | 48 PASS después de todos los builds |
| chromium.json.gz | 34 observaciones: 11 PASS, 22 FAIL, 1 limitación detectada, 0 errores harness |
| global-main/candidate.json.gz | originales íntegros, 5612/75/52 y 5637/75/52 |
| pr127-raw/ | comparación sin canonicalizar paths: 78 exclusivas afectadas por raíces |
| pr127/phase-one.json y final.json/md | inputs con raíces canónicas, 91 compartidas y cero nuevas/exclusivas/sin resolver |
| pr127/focused/ | targets vacíos; cero repeticiones, no PASS inventados |
| build-*.log.gz | Admin/postbuild, Store y Store Vercel de ambas fuentes |
| product.diff.gz | diff comercial completo de M-01-only |
| pr338-auth.diff.gz / pr352-auth.diff.gz | drift de autoridad por HEAD exacto |
| merge-tree-338/352.txt | conflictos de integración observados sin modificar ramas |
| eslint-final.log.gz | lint focal aprobado, sólo aviso de paquete Baseline |

## Reproducción

```sh
npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.test.js --maxWorkers=1 --reporter=json --outputFile=exp14.json
npx vitest run src/services/auth/__tests__ src/services/tenant/__tests__/tenantScopedStorage.test.js src/store/slices/license/licenseMaintenanceActions.tenantIsolation.test.js --maxWorkers=2
node scripts/qa/actor-storage-m01-only/browser.mjs > chromium.json
npm run build
npm run build:store
npm run build:store:vercel
npm run test:ci -- --reporter=json --outputFile=global.json
node scripts/ci/pr127-global-comparison.mjs extract --candidate candidate.json --base main.json --output phase-one.json
node scripts/ci/pr127-focused-evidence.mjs --targets targets.json --output-dir focused/pr --repetitions 20 --max-workers 4
node scripts/ci/pr127-global-comparison.mjs classify --phase phase-one.json --base-focused focused/main --candidate-focused focused/pr --output final.json
```

Baseline global limpio: se retiró únicamente la copia no versionada de EXP14 tras su reproducción roja. Para matriz adicional sobre main se copió sólo su archivo de prueba después del global, se ejecutó y se retiró; el producto baseline nunca se modificó. Se comprobaron las 47 assertions finales de recuperación Admin dentro del JSON global candidato.

Normalización derivada: sustitución literal de los tres prefijos documentados en README, aplicada igual a ambos lados. No se borró ningún mensaje ni se cambió errorClass, timeout, expected/actual, frame restante o aserción. El comparador oficial se usa sin cambios y conserva los originales brutos. Los 75 tests fallidos no equivalen a 91 identidades de comparador, que incluye errores de archivo/importación.

Nivel de evidencia: jsdom con módulos comerciales y proveedores sintéticos; Chromium real con perfiles efímeros compartiendo origen por escenario; repositorios con doubles/fake-IDB. No hay operaciones comerciales live, RPC, sesiones/device reales, QA física Windows/Edge/Android ni garantías globales de exclusión/fencing. Los FAIL de LC13 se mantienen explícitos.

## Cierre remoto de la candidata D

Candidata comercial/PR: `5ba07e42e52689e5f60825e3f6979f6ca7af047b`; árbol `46f8f162261a74b576e41128fd8e170bcfe57962`. Este checkpoint documental E conserva fuentes comerciales idénticas a D; sus resultados remotos pertenecen a D, no se atribuyen a otro SHA de código.

- PR127 [39689600184](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600184): SUCCESS, 99 identidades compartidas, cero exclusivas/nuevas/sin resolver; targets=[] y cero repeticiones focales. Artefacto `12387284624`, SHA-256 ZIP `5b15389ca06616e33f1aea3285f6ba7947c4303fee38ab1f9c319dea7bf2f04e`, verificado contra la descarga. Archivos originales de comparación en `remote-pr127-D/`.
- Las ocho identidades adicionales frente a PR127 local son ENOENT compartidos de artefactos de build: 2 de adminPwaArchitecture, 1 de publicBuildArchitecture y 5 de publicGitDeploymentArchitecture. El job PR127 no construye esos artefactos; el perfil local sí los construyó. No se mezclan 91 locales con 99 remotas.
- Actor Runtime [39689600221](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600221): SUCCESS. Job focal `119532266669`: SUCCESS; controller/bridge 30, preparación Admin 124, tenant/DB 216 y licencias 115 PASS; build/postbuild y Store PASS. Dos repeticiones completas por lado: BASE 5612 PASS/75 FAIL/52 SKIP; CANDIDATE 5637 PASS/75 FAIL/52 SKIP. Siete objetivos, 50/50 PASS en cada lado (350 por lado). Gate diferencial: 93 observaciones preexistentes estables, 0 regresiones nuevas, 0 incidentales, 0 flaky nuevas. El job Publish idempotent closeout report es SKIPPED por restringirse a otra rama; no se presenta como PASS. Artefactos base/candidata/diferencial descargados y hashes ZIP verificados; JSON originales en remote-runtime-*-D/.
- Actor Scoped [39689600173](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600173): SUCCESS. Job focal `119532262514`: SUCCESS, incluidos auth/storage/tenant/finanzas/lint/tres builds. La observación POS conserva 11 FAIL heredados, no se etiqueta PASS de suite bruta. Dos repeticiones por lado: BASE 5612 PASS/75 FAIL/52 SKIP; CANDIDATE 5637 PASS/75 FAIL/52 SKIP. Siete objetivos con 50/50 PASS en ambos lados; IA duplicate-submit 50/50 por lado; NEG-01, NEG-02 y NEG-03 PASS. Gate diferencial: 93 observaciones heredadas estables y cero regresiones nuevas. Artefactos base 12390115379, candidata 12389620399 y diferencial 12388859787 descargados con hashes ZIP verificados; originales en remote-scoped-*-D/. El workflow valida una assertion exacta por corrida IA y elimina sus JSON/log de éxito: se preservan el resumen PASS 1..50 y ese límite, no se inventan archivos ausentes.
- HOTFIX Dexie: NOT_TRIGGERED_PATHS; su YAML no tiene workflow_dispatch, las rutas M-01 no están en sus filtros y no es requerido por reglas. No se cambió el trigger ni se fabricó un diff para activarlo. Selección local equivalente 127/127 PASS. Device Actor Auth y FREE Local tampoco se activan por las rutas de este cambio.
- Reglas GitHub consultadas: main protected=false, required_status_checks vacío, rulesets=[]; esto no sustituye los tres gates aplicables definidos para este encargo.
- Preview [D](https://lanzo-qg6zkdxqr-fdxrulis-projects.vercel.app): READY, `dpl_LM4PivQcha1hf5aziPDptLapFqXb`, rama y SHA D exactos, target Preview, proyecto POS verificado. HTML Lanzo POS, 10 assets iniciales JS/CSS, SW y manifiesto: HTTP 200 y MIME correcto. Bundle recoveryContext contiene el handler M-01 compilado; manifiesto scope=/, start_url=/, display=standalone. No se confunde una página de protección con la app; se usó la lectura protegida autorizada.
- Host de backend compilado: `odlrhijtfyavryeqivaa.supabase.co` (producción). Sólo GET de archivos estáticos; no ejecución de login, dispositivo, sesión, negocio ni RPC. Sin cambios de env vars. La QA física sigue PENDING.

`remote-verification-D.json` conserva el resumen de metadatos y gates; `scope-proof.json` confirma igualdad de publicación, preparación/activación e invalidación (724 bytes, SHA-256 `725cbe6b387fe814a987146162c55508667fc83bc4840658aa8313b38c02db92`) con main. No hay M-03.

Checkpoint E se guarda en `audit/actor-storage-m01-only-closure-r1`, descendiente de D, únicamente documental/evidencia. El PR conserva el HEAD D y su Preview D. El SHA de E se entrega en el PR y la respuesta, sin autorreferencia circular.

Dictamen final de entrega: **READY_FOR_OWNER_QA**, con los tres workflows aplicables SUCCESS en D y Preview D READY. QA físico PENDING. LC13 permanece abierto. Merge NOT PERFORMED y no autorizado. Los resultados no son E2E comerciales ni una garantía de fencing global.
