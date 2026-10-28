# LANZO POS — F01-2A — FINANCIAL LIFETIME EVIDENCE R1

Fecha: 23 de octubre de 2026, America/Mexico_City. Dictamen focal: **LIFETIME_IMPLEMENTED_READY_FOR_OWNER_REVIEW**. F01-2: HOLD_RECOVERY_INTEGRATION, sin gate activo. LC13 OPEN. PR #373 OPEN/Draft/NOT MERGED; base inalterada #372. El informe principal delimita contrato y callers pendientes.

## Procedencia y ejecución

Baseline nuevo: `7d9f4562a4b12efdcdfb8d5fbb77a4ff9d81ec50`, HEAD anterior exacto de #373. Main `52bb573e651529b323b6617e3161cd76ece14a39` y #372 `f1d69093ffe3ad180752773c178b7fbaefd92ce1` verificados por conector y ls-remote. Candidata en worktree detached propia. SHA final publicado y árbol de estas fuentes en el cuerpo del PR/entrega. Sin rebase, retarget, merge ni modificación de otras ramas.

Antecedentes F01 Audit/Design/F010, F011 y F012 revisados; pruebas históricas no sumadas. `remote-preflight.json` conserva estados/HEAD de #338/#352/#368/#370/#371/#372/#373. Sus contratos financieros/authority/sync requieren revalidación posterior; no se importó ni fusionó su código. No hay AGENTS.md aplicable a las fuentes.

Node 24.22.1. Dependencias existentes compartidas por symlink, `package-lock.json` SHA-256 `59e12324df46b964748524051be34760fcc3c1050ef57a8b03deb16c4ae2b581`, idéntico al checkout base y a la instalación. Sin cambios de package/lockfile. Chromium 143.0.7499.0 y Playwright externo del runtime; executable/fontconfig/librerías en tooling previo del entorno. Sin Docker, paquetes nuevos, certificados o perfiles del propietario.

Reales en los tests focales: timeout/observer/ledger/recovery/receipt classifier/canonicalización/hash/registry/leases y Dexie sobre fake-indexeddb. Sustituidos: DB provider de la app, actor handle/Auth y transporte RPC; callback de proyección sintético. Suites Runtime/Storage/tenant/políticas reales en diferencial separado. No se llama al bridge de fixture como certificación Staff online. Chromium nuevo usa coordinator/observer/timeout reales y Web Locks nativos; transporte/continuación/durable son sintéticos, sin módulos comerciales del POS.

## Resultados nuevos

Paths relativos a `scripts/qa/single-instance-f012a/evidence/`. Los `.json.gz` conservan losslessly los JSON originales completos. Los runners generan JSON plano; `gzip -dc` restaura los bytes para análisis o comparador.

| Artefacto | Resultado |
| --- | --- |
| life-final.json.gz | 33/33 PASS; LIFE-01..30 + LIFE-05B/09B + CE-RECOVERY-04 |
| life-matrix.json | Mapping exacto ID → archivo/fullName/status y límites |
| recovery-traces.json | CE-RECOVERY-04 candidata: 35.023ms medidos en cierre global, timeout default35.000 intacto, public rejected/pendingTasks1/closedfalse |
| base-probes.json.gz, base-financial-traces.json | 4/4 assertions de reproducciones baseline; CE-DRAIN-01/02, inventario y CE-RECOVERY-04 permanecen COUNTEREXAMPLE |
| base-native.json | CE-NATIVE-DRAIN-03 COUNTEREXAMPLE y RAW-TRACKING-PROPOSAL control PASS, 0 pageerrors |
| chromium.json | Candidata drain PASS + cierre real PASS_BOUNDARY, 0 pageerrors |
| candidate/regressions.json.gz | 1.167 PASS / 4 FAIL / 50 SKIP / 1.221 total |
| base/regressions.json.gz | Mismos conteos y nombres/estados/primer error |
| differential-final.json | Cero diferencias en 1.221 assertions; misma selección, incluye 45 F01-1 |
| base/global.json.gz | 5.715 PASS / 88 FAIL / 52 SKIP / 5.855 total |
| candidate/global.json.gz | 5.748 PASS / 88 FAIL / 52 SKIP / 5.888 total; +33 PASS nuevas |
| pr127/final.json.gz | OK; 104 identidades de fallo compartidas, cero exclusivas/nuevas/sin resolver |
| pr127/phase-one.json.gz, targets.json | targets=[]; focused runner no ejecuta repeticiones para lista vacía |
| base/builds.json, candidate/builds.json | Cuatro builds por lado, todos exit0; entornos Preview/Production explícitos |
| timeout-inventory.json | 11 callsites, todos los campos de lifetime/efectos/autoridad/cleanup requeridos; 5 OPT_IN y 6 pendientes |
| source-preservation.json | 2.055 fuentes/configs preexistentes del selector preservadas; sólo tres fuentes preexistentes modificadas |
| eslint.log | exit0 focal; único aviso tooling preexistente baseline-browser-mapping |
| legacy-candidate-traces.json | Contraejemplos legacy reejecutados por global candidata, preservados aparte antes de restaurar evidencia F012 heredada |
| *.log.gz, *-exit.json | Salidas brutas/exit codes, incluidos no-cero históricos |
| artifact-hashes.json | SHA-256 de informes, fuentes nuevas/modificadas y archivos de laboratorio; excluye propio manifiesto |

El timing exacto de cada repetición vive en su JSON; el número anterior corresponde a la traza final indicada, no a una cota universal. Los ensayos rápidos usan overrides de fixture existentes; ningún timeout de producción cambia. Ninguna prueba nueva usa fake timers. Lease120s es opción existente para aislar 35s de la expiración por defecto, no cambio del default comercial.

## Matriz LIFE-01..30

Todos los PASS son de la frontera indicada, no certificación de todos los callers ni de operaciones reales.

| ID | Resultado | Frontera y límite |
| --- | --- | --- |
| 01 | PASS | Respuesta antes de timeout, misma referencia de valor |
| 02 | PASS | Timeout público con tarea subyacente pendiente |
| 03 | PASS | Rechazo temprano, misma referencia de error |
| 04 | PASS | Rechazo tardío observado, drain posterior |
| 05 | PASS | Transporte terminado y continuación local pendiente; 05B añade proyección/lease/finally reales con handler sintético |
| 06 | PASS | Runner rechaza síncrona/asíncronamente antes de iniciar: cero invocaciones |
| 07 | PASS | Legacy sin contexto acepta función/promesa y conserva timeout/error |
| 08 | PASS | Invocaciones concurrentes con registros independientes |
| 09 | PASS | Registro raíz/child previo a factory; 09B preflight anidado que sobrevive al timeout externo sin inserción tardía |
| 10 | PASS | Quiesce durante continuación, coordinator real con adaptador de lock de unidad |
| 11 | PASS | Quiesce después de timeout mantiene executor pendiente |
| 12 | PASS | Ticket revocado rechaza antes del efecto mediante check explícito; observer no añade autorización |
| 13 | PASS | Handle de fixture obsoleto durante dispatch; ledger real rechaza escritura tardía |
| 14 | PASS | Tenant/generación cambia durante receipt; origen durable intacto, cero dispatch |
| 15 | PASS | Receipt PROCESSING mantiene PENDING_RECEIPT sin envío |
| 16 | PASS | Raw completion no confirma; COMPLETED posterior en recovery preserva origen y no reenvía |
| 17 | PASS | Receipt inaccesible: no autoriza primer envío |
| 18 | PASS | NOT_FOUND después de intento: cero redispatch |
| 19 | PASS | PREPARED/0 + NOT_FOUND mantiene primer dispatch legítimo |
| 20 | PASS | PREPARED con intentos previos pasa a receipt-required |
| 21 | PASS | Lease liberado y transporte pendiente; nueva recovery PROCESSING no reenvía |
| 22 | PASS | Fila de fixture expirada rechaza escritura tardía; sin extensión de lease |
| 23 | PASS | Rechazo tardío sin unhandledRejection, listener Node explícito |
| 24 | PASS | Tarea que nunca termina retiene QUIESCING; observación finita no promete liveness |
| 25 | PASS de fronteras / PARTIAL E2E | Reopen Dexie de fila ambigua sin reenvío; cierre real Chromium conserva evidencia sintética. No crash/cobro/servidor E2E combinado |
| 26 | PASS | Dos tareas, terminar una mantiene otra registrada |
| 27 | PASS | Dos runners compuestos esperan la misma ejecución completa |
| 28 | PASS | Set vacío tras settlement; scope cerrado rechaza nuevas altas antes del efecto |
| 29 | PASS de clasificación | markUnobservable idempotente conserva retención desconocida sin escape; factory requerido. No descubre detached automáticamente |
| 30 | PASS | Consumidor financiero legacy sin contexto conserva receipt-first |

Casos extra: CE-RECOVERY-04 candidata con recuperación real/35s; LIFE-05B proyección local y cleanup, LIFE-09B preflight anidado. Los grupos se solapan; no sumar global + focal + repeticiones como casos únicos. Los 33 tests nuevos aparecen también en global candidata.

Lease activo y reemplazo/expiración se validan además en financialIntentDexieConcurrency/projectionConcurrency y suites existentes; no se modifica su semántica. Cambio de generación actor, tenant, sesión y M-01/F-02/Staff/Admin se prueban en suites reales por separado; los fixtures nuevos no pretenden reemplazarlas.

## Chromium y controles negativos

Mismo BrowserContext/origen/socket loopback por A/B; no usar dos perfiles como si compitieran por un lock. Baseline ejecuta su código exacto desde el worktree anterior:

1. A adquiere; B SECONDARY. A registra sólo race público. Timeout: publicSettled=true, nativeActive=true, pendingExecutors=0.
2. Quiesce libera; B adquiere antes de completar raw: COUNTEREXAMPLE antiguo.
3. Control RAW-TRACKING-PROPOSAL mantiene A hasta completar raw; sigue control aislado.

Candidata nueva:

1. A registra la invocación antes de factory; timeout público con pendingExecutors=1.
2. Quiesce: A QUIESCING/nativeHeld, B SECONDARY.
3. Termina transporte; continuación local aún pendiente: A conserva lock y B espera.
4. Termina continuación: settled observado, executor drena, release legítimo y B adquiere.
5. dispatch sintético A=1, B=0; ninguna operación financiera adicional ni cambio de evidencia ambigua.

Segundo caso: cierre real de A con tarea pendiente libera por navegador; B adquiere con la misma evidencia localStorage ambigua y dispatchCount0. No es confirmación de servidor ni prueba de un pago real. Documentos efímeros, sin perfil/DB del propietario. Metafile muestra sólo fixture, observer, timeout y las tres fuentes del coordinator; no App/Runtime/DB/Supabase.

## Diferencial, preparación y omisiones

Selección amplia en `run-regressions.mjs`/selectors.json: F01-1, Runtime/Storage/handoff/M-01/F-02/Admin offline/Staff, tenant/DB/Dexie, PWA/SW/architecture/bootstrap, intents/recovery/receipts/proyección, outbox y bootstrap sync, caja, ventas, apartados, inventario y restaurante. Mismos comandos/dependencias/HEAD base para ambos lados. El comparador focal sólo compara estado/primer mensaje; los errores completos quedan en JSON brutos.

50 SKIP focales pertenecen a `adminDeploymentPackage.test.js` y `publicDeploymentArchitecture.test.js`, sujetos a condiciones de packaging. No se convierten en PASS. Los cuatro restaurant split-close mantienen sus assertions y exit1; no se atribuye solución inexistente. El global conserva 88 FAIL/52 SKIP por lado, incluyendo fallos de archivo además de assertions en el comparador; no suite global verde.

PR127 **local**, comparador original sin editar: extract → targets[] → focused no-op → classify OK. Se normalizan únicamente prefijos literales de checkout a `/home/runner/work/Lanzo-POS/main` y `/pr`, y node_modules compartido a `/shared/node_modules`; manifest exacto en `pr127/normalization.json`. No se elimina ningún mensaje, error, status, nombre o frame restante. Entradas originales y derivadas conservadas. Esto compara HEAD anterior de #373, no main remoto ni el CI PR127 de #372.

Preparación: primera selección amplia antes de builds produjo ocho ENOENT de arquitectura compartidos + cuatro históricos. Se conservaron `before-build-*` y se repitió la misma selección después de los builds, sin tocar tests. Primer intento Preview sólo modo Vite no activó la variable requerida; `before-preview-fix-*` conserva ese intento. Build final usa realmente VERCEL_ENV=preview y Production explícito; los artefactos que requieren las suites se generan antes de global.

Cuatro builds finales PASS por lado. Auditoría startup/precache: Production24/Preview32 assets iniciales, cero missing y cero marcadores nuevos/coordinador. `coreLocalRouteAssets=[]` no certifica rutas offline completas. Store/Store Vercel conservan tests de arquitectura y builds independientes. No se sirven ni abren apps comerciales para esta validación.

El lint completo del código focal y todos los scripts nuevos terminó exit0. Sólo se corrigió prefer-const en un test y se retiraron imports no usados del fixture; no cambió código financiero ni assertions. La suite unitaria de lifetime se repitió 18/18 PASS después de ese cleanup; los resultados globales anteriores conservan su alcance y conteos, sin atribuirles un nuevo SHA remoto.

## Reproducción

README del laboratorio explica dependencias/tooling y alcance. Comandos de prueba/build/global incluidos en sus scripts y archivos exit. Desde candidata y baseline separadas:

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012a --maxWorkers=1 --reporter=json --outputFile=/ruta/candidate/life-final.json
node scripts/qa/single-instance-f012a/builds.mjs /ruta/candidate
node scripts/qa/single-instance-f012a/run-regressions.mjs /ruta/candidate
node scripts/qa/single-instance-f012a/global.mjs /ruta/candidate
ACTOR_QA_CHROMIUM_EXECUTABLE=/ruta/chromium node scripts/qa/single-instance-f012a/browser.mjs
node scripts/qa/single-instance-f012a/compare.mjs /ruta/evidence
node scripts/ci/pr127-global-comparison.mjs extract --candidate candidate-normalized.json --base base-normalized.json --output phase-one.json
node scripts/ci/pr127-focused-evidence.mjs --targets targets.json --output-dir focused/candidate --repetitions 20 --max-workers 2
node scripts/ci/pr127-focused-evidence.mjs --targets targets.json --output-dir focused/base --repetitions 20 --max-workers 2
node scripts/ci/pr127-global-comparison.mjs classify --phase phase-one.json --base-focused focused/base --candidate-focused focused/candidate --output final.json
```

En baseline, invocar builds/regressions/global por path absoluto del runner candidato, con cwd del checkout baseline. Los controles negativos usan sus propios `single-instance-f012/financial-drain.test.js` y browser.mjs, sin helper candidato. Las trazas generadas de F012 heredadas se copiaron a la carpeta nueva y se restauraron los blobs previos de esa evidencia: no se reescribe historia ni se altera #372. No usar `.result` como señal de drain ni llamar quiesce esperando el propio executor desde dentro.

## CI remota, conservación y riesgos

Los workflows PR127, Actor Runtime, Scoped Storage y Dexie tienen filtros de base main y/o ramas/paths. #373 sigue apilado sobre #372. Estado exacto por SHA se consulta después de publicar y se entrega en el cuerpo del PR; NOT_TRIGGERED no es SUCCESS. Una Preview automática READY no certifica gate ni pagos. No se cambia workflow para simular verde ni se dispara SQL/deploy de producción.

Sólo tres fuentes preexistentes modificadas más un helper nuevo. 2.055 blobs del selector de preservación quedan idénticos (ver source-preservation.json), incluidos Runtime/Storage/M-01/F-02/coordinator/App/main/SQL/workflows/contratos de caja/ventas/outbox. Artifact hashes cubren evidencia y código focal; fuentes probadas no cambian durante cierre documental.

Cobertura pendiente explícita: seis callsites de caja/hook, coordinador recovery automático, bootstrap/background validations, pulls detached, procesos autónomos de outbox/handoff y handlers no awaitables. Antes de futura integración, entregar factory completo o marcar desconocido y conservar HOLD. No afirmar cobertura de servidor, LC13, JS legacy, perfiles/orígenes distintos ni PWA/hibernación Windows/Android no ensayados.

Sin proyecto Supabase consultado ni mutado; sólo docs públicas. Supabase production writes NONE; SQL/migraciones NONE; operaciones financieras reales NONE; licencias/dispositivos sin cambios; Production deploy NOT PERFORMED; Merge NOT PERFORMED. **La revisión focal está preparada; F01-2 permanece desactivada y LC13 abierto.**
