# LANZO POS — Certificación de Scoped Storage y preparación de QA integrada R1

**Fecha:** 2026-10-12
**Repositorio:** `fdxruli/Lanzo-POS`
**PR en revisión:** [#352](https://github.com/fdxruli/Lanzo-POS/pull/352) — `feat/restaurant-admin-supervision-r1`
**Estado de esta certificación:** `PARTIAL_WITH_DOCUMENTED_BLOCKERS`

## Alcance y límites de seguridad

Esta revisión investigó el bloqueo diferencial de Actor Scoped Storage, endureció el harness de CI para que cubra el escenario bloqueante y dejó preparada la evidencia para QA integrada. No se hizo merge, no se desplegó frontend ni SQL a producción, no se aplicaron migraciones, no se activó Admin para licencias reales y no se efectuaron ventas ni escrituras de datos de negocio reales.

Las dos migraciones existentes permanecen sólo en el repositorio:

- `20261010013257_restaurant_cloud_transition_bridge_v1.sql`
- `20261010013258_restaurant_admin_supervision_r1.sql`

`ADMIN_REMOTE_EDIT = BLOCKED_PENDING_INVENTORY_CONTRACT` se mantiene sin cambios.

## Referencias inmutables y trazabilidad

| Referencia | SHA | Estado / uso |
|---|---|---|
| PR #352 inicial | `1199af3397815b0eae71e013efdc9599ea7ae0e3` | Candidato del run histórico bloqueante |
| PR #338 / base autorizada | `fb17e9a43929d54087ab937cb760a8cd6e087c36` | BASE de las comparaciones diferenciales de #352 |
| PR #354 | `c7dd252722e7a1b8de0830773451a52f4374e662` | Diagnóstico técnico independiente; no integrado |
| `main` | `a8547bfc34f483d1d72020114510c8ebea74aace` | Referencia informativa; no sustituye PR #338 |
| Candidato de harness | `109c5431049cfb4390149603a5d7918778894d3a` | CI reforzado, previo al commit documental |

Los resultados de ejecución que siguen identifican explícitamente el SHA evaluado. Un commit documental posterior no se debe interpretar como cambio de comportamiento de Restaurante o Ecommerce.

## Diagnóstico del fallo de Actor Scoped Storage

El run histórico [38115602230](https://github.com/fdxruli/Lanzo-POS/actions/runs/38115602230) comparó correctamente `BASE=fb17e9…` frente a `CANDIDATE=1199af…`. El comparador terminó con `newRegressionCount=1`.

| Elemento | BASE | CANDIDATE | Clasificación |
|---|---:|---:|---|
| Suite completa, repetición 1 | 5,497 PASS / 73 FAIL / 51 SKIP | 5,558 PASS / 75 FAIL / 51 SKIP | Diferencial requiere inspección |
| Suite completa, repetición 2 | 5,498 PASS / 72 FAIL / 51 SKIP | 5,562 PASS / 71 FAIL / 51 SKIP | Diferencial requiere inspección |
| Regresión nueva señalada | pasa ambas repeticiones | falla sólo repetición 1 | `UNRESOLVED` |

El caso señalado fue:

```text
src/components/ecommerce/__tests__/EcommercePortalSettings.productModalLifecycle.test.jsx
invalidates a pending request when the modal closes and starts the next opening cleanly
```

Falló solamente en la primera repetición completa del candidato, con aproximadamente `15,017.868 ms` y `STACK_TRACE_ERROR`. La repetición 2 del candidato y ambas del BASE pasaron. El artefacto conserva stack genérico de Vitest, pero no trazas de promesas pendientes, orden de mocks one-shot, timers, listeners, suscripciones, almacenamiento scoped ni presión de recursos. Por ello el fallo histórico se conserva como evidencia, pero no permite demostrar su causa raíz.

La secuencia candidata fallida empezó con una aserción de búsqueda obsoleta (`expected 3 calls; received 2`) y continuó con timeouts de carga incremental, cierre/reapertura y cursor más reciente. Esta sucesión permite una hipótesis de cascada por estado asíncrono o mock, pero no una conclusión: no existe instrumentación suficiente para conocer el estado que dejó cada caso antes del siguiente.

### Evidencia focal histórica

El run conservó ocho targets, a 50 repeticiones por lado. El caso de cierre/reapertura que bloqueó el run **no estaba entre ellos**.

| Target histórico | BASE PASS/FAIL | CANDIDATE PASS/FAIL |
|---|---:|---:|
| BFCache authoritative not found | 45 / 5 | 46 / 4 |
| BFCache | 47 / 3 | 46 / 4 |
| Site version | 50 / 0 | 50 / 0 |
| Ecommerce latest cursor | 49 / 1 | 50 / 0 |
| Ecommerce same-search next page | 49 / 1 | 50 / 0 |
| Ecommerce clear-search catalog | 49 / 1 | 50 / 0 |
| Ecommerce stale search | 49 / 1 | 50 / 0 |
| Ecommerce stale load more | 50 / 0 | 50 / 0 |

Estos datos muestran flakiness ya presente en BASE; no reclasifican artificialmente el timeout de cierre/reapertura como baseline porque ese caso no tuvo evidencia focal equivalente. La clasificación correcta es `UNRESOLVED`, no `BASELINE_FAILURE` ni `SEMANTIC_REGRESSION` demostrada.

### Comparación de archivos relevantes

Los blobs de los siguientes archivos son iguales entre `fb17e9…` y `1199af…`:

- `EcommercePortalSettings.productModalLifecycle.test.jsx`
- `EcommercePortalSettings.jsx`
- `EcommerceProductPublishModal.jsx`
- `PublicStorePage.test.jsx`

Por tanto, no hay un cambio directo en esos archivos que pueda atribuir por sí solo el incidente a #352. Esto no prueba que #352 sea inocuo por efectos indirectos; impide declarar la hipótesis H8 como causa raíz sin nueva reproducción.

La revisión se repitió contra el candidato de harness `109c543…`: ambos tests focales y sus módulos directos (`PublicStorePage.jsx`, `EcommercePortalSettings.jsx` y `EcommerceProductPublishModal.jsx`) siguen byte-idénticos a `fb17e9…`, y `git diff fb17e9… 109c543… -- src/pages src/components/ecommerce` no contiene cambios. El único cambio transitorio localizado es `createPWASlice.js`, que trata el retorno `false` de `triggerUpdateRef(true)` en `runUpdate`; los dos tests focales no lo invocan. Es evidencia de ausencia de vínculo directo, no una prueba de ausencia de un efecto indirecto.

### Matriz de hipótesis

| Hipótesis | Evidencia observada | Conclusión |
|---|---|---|
| H1 — temporización de modal | Falla sólo en una suite completa; aislado y suite del componente pasan localmente | Posible; `UNPROVEN` |
| H2 — respuesta obsoleta | El código usa contadores de request/sesión y no se observó una escritura obsoleta | `UNPROVEN` |
| H3 — mocks one-shot | La primera falla registra `3` llamadas esperadas vs. `2` recibidas antes de timeouts posteriores | Posible cascada; `UNPROVEN` |
| H4 — debounce | Existe debounce de 250 ms y el incidente ocurrió bajo suite completa | Posible; `UNPROVEN` |
| H5 — listeners focus/pageshow | PR #354 sincroniza registro de listeners en otra prueba; no hay vínculo causal demostrado | `UNPROVEN` |
| H6 — estado compartido | No hay captura de LocalStorage, IndexedDB, módulos, timers ni fetch mocks al fallar | `UNPROVEN` |
| H7 — entorno/carga | Local aislado pasa y una repetición completa candidata falla; faltan métricas de recursos | Posible; `UNPROVEN` |
| H8 — regresión de #352 | Los archivos directamente implicados son idénticos entre BASE y candidato histórico | Sin evidencia directa; `UNPROVEN` |

El test local de ciclo de vida completo pasó `8/8`; la ejecución aislada del caso de cierre/reapertura pasó `1/1`. No se aumentó ningún timeout. Esas ejecuciones no reemplazan la reproducción diferencial de CI.

## Coordinación con PR #354

PR #354 está Draft/Open sobre `main`, no sobre PR #338. Cambia exclusivamente dos pruebas:

- añade espera de la tercera llamada y de `Producto Dos` al reabrir el modal antes de resolver una respuesta obsoleta;
- espera el registro efectivo de listeners `pageshow` y `focus` antes de emitirlos en `PublicStorePage`.

La propuesta coincide con el test bloqueante, pero su evidencia no resuelve #352: su PR127 exitoso comparó `main` con su propio candidato, tuvo 113 fallos compartidos, cero fallos exclusivos de candidato y ninguna repetición focal; tampoco aporta certificación Actor Runtime/Scoped Storage contra `fb17e9…`. No se hizo cherry-pick ni copia de sus cambios. El dueño de la sincronización de prueba propuesta sigue siendo #354 o una rama técnica independiente; #352 sólo incorpora una corrección de observabilidad y enforcement del gate.

## Endurecimiento del harness de CI

| Commit | Cambio permitido | Razón |
|---|---|---|
| `7995b7ff13a8d288ba3f8862bb3777ad6e97610d` | Conserva los ocho targets y añade `ecommerce-pending-close-reopen`; ejecuta y publica `compare-focused-target-evidence.mjs` en Scoped Storage | El caso bloqueante recibe 50 repeticiones por BASE/CANDIDATE y una regresión focal ya no puede quedar no bloqueante por falta de fallo raw equivalente |
| `109c5431049cfb4390149603a5d7918778894d3a` | PR127 recibe `base_ref`, valida SHA BASE/CANDIDATE y deja de fijar `main` como base | La comparación debe usar la base autorizada de #352, `fb17e9…` |

La primera ejecución de PR127 contra `base/` reveló un defecto adicional del propio harness: `normalizeFileName()` sólo reconocía checkout `pr/` y `main/`. Las fallas de archivo de `base/` no coincidían con sus equivalentes candidatos y acababan como targets `__FILE_FAILURE__` inseguros. El matcher ahora reconoce `base/` y tiene una prueba de regresión para rutas fuera de `src/`; no se alteró ninguna prueba de producto.

No se alteró el comportamiento comercial de Ecommerce, los contratos financieros, las aserciones existentes, las repeticiones previas ni los controles negativos. Los ocho targets se conservaron y el noveno fue aditivo. Los self-tests de workflows y los tests de evidencia focal pasaron antes de publicar estos cambios:

```text
node --test scripts/ci/restaurant-transition-workflows.node-test.mjs  PASS
node --test scripts/ci/focused-target-evidence.node-test.mjs          PASS (16/16)
git diff --check                                                       PASS
```

## Gates oficiales ejecutados

Los tres runs se ejecutaron sobre `109c5431049cfb4390149603a5d7918778894d3a`, con `base_ref=fb17e9a43929d54087ab937cb760a8cd6e087c36`. La comparación efectiva reportada por los workflows es siempre `BASE=fb17e9…` / `CANDIDATE=109c543…`.

| Gate | Run | Resultado | Clasificación |
|---|---:|---|---|
| PR127 Global Comparison | [38148233108](https://github.com/fdxruli/Lanzo-POS/actions/runs/38148233108) | FAIL | `TEST_HARNESS_DEFECT` |
| Shared Terminal Actor Runtime Validation | [38148235727](https://github.com/fdxruli/Lanzo-POS/actions/runs/38148235727) | PASS | Comparación completa sin regresiones nuevas |
| Shared Terminal Actor Scoped Storage Validation | [38148237842](https://github.com/fdxruli/Lanzo-POS/actions/runs/38148237842) | FAIL | `UNRESOLVED` / `CANDIDATE_ONLY_FAILURE` focal repetida |

### PR127 — fallo del harness, no regresión demostrada

El artefacto de PR127 contiene 94 fallas candidatas, 96 BASE, 92 compartidas y dos aparentes candidate-only. Las dos eran fallas a nivel de archivo: `scripts/oss/release-boundary.test.mjs` (`No test suite found`) y `supabase/functions/lanzo-ai-agent/index.test.ts` (`Deno is not defined`). Al usar `base/` en lugar de `main/`, sus rutas BASE permanecían absolutas y no podían emparejarse con las rutas candidatas. El focalizador rechazó los targets `__FILE_FAILURE__` como metadata insegura y el job falló antes de clasificación. Es un defecto reproducible del cambio de checkout, corregido con normalización de `base/`; requiere reejecución oficial de PR127 antes de certificarlo como PASS.

### Actor Runtime — aprobado

Runtime aprobó con `newRegressionCount=0`. En suite completa: BASE `5497/73/51/5621` y `5498/72/51/5621`; candidato `5561/72/51/5684` y `5562/71/51/5684`. Hubo dos observaciones focales exclusivas del candidato de una sola repetición, que el comparador clasificó correctamente como no bloqueantes; no constituyen un PASS de Scoped Storage.

### Actor Scoped Storage — bloqueo actual

Scoped Storage falló cerradamente tras ejecutar los nueve targets x50 y ambas suites completas. La evidencia focal contiene dos semánticas candidate-only repetidas tres veces:

| Target | BASE | CANDIDATE | Semántica |
|---|---:|---:|---|
| `bfcache` | 50/0 | 47/3 | `Timeout::Error: Test timed out in <duration>.` |
| `ecommerce-latest-search-cursor` | 50/0 | 47/3 | `Timeout::Error: Test timed out in <duration>.` |
| `ecommerce-pending-close-reopen` | 48/2 | 49/1 | timeout compartido; no candidate-only |

Los dos p-values de tasa de fallo son `0.1212`, por lo que no cruzan el umbral estadístico de tasa, pero el comparador está diseñado para bloquear semánticas candidate-only repetidas. No se relajó ese control. Las suites raw fueron BASE `5498/72/51/5621` en ambas repeticiones y candidato `5560/73/51/5684`, luego `5562/71/51/5684`. Como el comparador focal falló primero, el paso canónico de diferencial raw no se publicó; el análisis de sólo lectura de los artefactos reportó además dos observaciones raw candidate-only de `PublicStorePage` en la repetición candidata 1: estados `focus` `ECOMMERCE_PORTAL_PAUSED` y `ECOMMERCE_PORTAL_NOT_FOUND`, ambos con `expected 2 calls; received 1`.

La repetición local de `PublicStorePage.test.jsx` añadió evidencia de flakiness, no causa raíz: un intento agotó el worker de Vitest antes de descubrir pruebas y otro terminó `29/30`, fallando `focus` + `ECOMMERCE_PORTAL_NOT_FOUND` con la misma segunda llamada ausente. No se atribuye esto a #352 ni se copia #354 sin certificación diferencial.

El siguiente diagnóstico admisible es instrumentar temporalmente, sin aumentar timeout, los hitos de listener, llamada mock, respuesta diferida y cleanup de ambos targets; se debe comparar bajo la misma imagen de runner y concurrencia. Sin esa telemetría, el timeout genérico no demuestra una causa de producto.

## Preparación de QA integrada e infraestructura

| Componente | Evidencia | Estado |
|---|---|---|
| Supabase staging histórico `jdnbmvaphvjunwhnxowo` | El endpoint de health no resolvió DNS; el listado de proyectos no acredita que esté operativo | `UNAVAILABLE` |
| Supabase de producción | Existe un proyecto separado; la configuración local apunta a producción | Excluido de QA y mutaciones |
| Vercel Preview de #352 | Responde tras protección Vercel; no fue posible verificar SHA, target Supabase, callbacks o variables | `UNVERIFIED` |
| Auth / Realtime / RPC | No hay staging aislado autorizado | `BLOCKED` |
| Caja / Fiado / Inventario / Cocina | No hay ambiente integrado seguro ni identidades sintéticas | `BLOCKED` |
| Dos dispositivos físicos | No se inició prueba sobre datos reales ni producción | `NOT_RUN` |

`PREVIEW_ENVIRONMENT_ISOLATION = UNVERIFIED`: no se debe usar el Preview para casos destructivos ni para confirmar contratos financieros hasta demostrar que usa sólo staging autorizado, que no expone `service_role` al frontend y que los callbacks, RPC y Realtime no llegan a producción.

### Plantilla de evidencia por caso

```text
QA_ID
FRONTEND_SHA
SQL_MIGRATION_VERSION
DEVICE_ROLE
ACTOR_ROLE
SOURCE_DEVICE
TARGET_DEVICE
NETWORK_STATE
EXPECTED_RESULT
ACTUAL_RESULT
FINANCIAL_EVIDENCE
INVENTORY_EVIDENCE
DATABASE_EVIDENCE
SCREENSHOT_OR_LOG
PASS_FAIL_BLOCKED
```

Las capturas compartidas deben ocultar identificadores internos de clientes, datos personales, tokens y credenciales.

### Matriz de QA integrada

Ningún caso se marca PASS con base sólo en unit tests. Todos permanecen `BLOCKED` hasta contar con staging aislado, identidades sintéticas, Preview aislado y dispositivos autorizados.

| ID | Escenario | Resultado esperado | Estado actual |
|---|---|---|---|
| QA-01 | Staff A crea mesa | PASS | BLOCKED |
| QA-02 | Staff A añade productos | PASS | BLOCKED |
| QA-03 | Staff A envía a Cocina | PASS | BLOCKED |
| QA-04 | Staff B consulta la mesa | PASS | BLOCKED |
| QA-05 | Staff B intenta editarla | DENIED | BLOCKED |
| QA-06 | Staff B intenta cobrarla | DENIED | BLOCKED |
| QA-07 | Staff B intenta dividirla | DENIED | BLOCKED |
| QA-08 | Staff B intenta cancelarla | DENIED | BLOCKED |
| QA-09 | Admin consulta mesa ajena | PASS | BLOCKED |
| QA-10 | Admin cobra mesa ajena | PASS | BLOCKED |
| QA-11 | Admin divide mesa ajena | PASS | BLOCKED |
| QA-12 | Admin cancela mesa ajena | PASS | BLOCKED |
| QA-13 | Admin remoto intenta editar productos | DENIED | BLOCKED; contrato de inventario pendiente |
| QA-14 | Staff A pierde conexión | Mesa conservada | BLOCKED |
| QA-15 | Admin termina operación pendiente | Sin duplicados | BLOCKED |
| QA-16 | Staff A se reconecta | Reconciliación correcta | BLOCKED |
| QA-17 | Cocina rechaza un producto | Contrato operativo correcto | BLOCKED |
| QA-18 | Cocina rechaza último producto | Parent sigue abierto | BLOCKED |
| QA-19 | Cocina intenta cancelar parent ajeno | DENIED | BLOCKED |
| QA-20 | Admin y Staff cobran simultáneamente | Un settlement | BLOCKED |
| QA-21 | Admin y Staff cancelan simultáneamente | Una operación | BLOCKED |
| QA-22 | Cobro y cancelación concurrentes | Sin doble efecto | BLOCKED |
| QA-23 | División por platos | PASS | BLOCKED |
| QA-24 | División monetaria | PASS | BLOCKED |
| QA-25 | Pago mixto | PASS | BLOCKED |
| QA-26 | Fiado | Deuda correcta | BLOCKED |
| QA-27 | Abono | Registro correcto | BLOCKED |
| QA-28 | QuickCaja | Sesión válida | BLOCKED |
| QA-29 | Inventario simple | Sin duplicados | BLOCKED |
| QA-30 | Lotes y recetas | Reservas correctas | BLOCKED |
| QA-31 | CommittedStock | Consistencia | BLOCKED |
| QA-32 | Respuesta de cobro perdida | Recuperación por recibo | BLOCKED |
| QA-33 | Refresh durante actualización | Sin pérdida de mesa | BLOCKED |
| QA-34 | Cambio de actor | Operación obsoleta bloqueada | BLOCKED |
| QA-35 | Cambio de tenant | Acceso denegado | BLOCKED |
| QA-36 | Cliente con bundle antiguo | Bloqueo seguro | BLOCKED |
| QA-37 | Actualización de SW durante cobro | Cobro protegido | BLOCKED |
| QA-38 | Free/Local sin internet | Sin regresiones | BLOCKED |
| QA-39 | Mesa pagada se intenta reabrir | DENIED | BLOCKED |
| QA-40 | Mesa cancelada se intenta reabrir | DENIED | BLOCKED |

## Backup, restauración y recovery

El listado de proyectos no prueba que existan backups recuperables, PITR habilitado, retención suficiente ni permisos de restore. No se consultaron ni expusieron secretos, no se hizo restore y no se tocó producción.

| Control | Estado | Condición para certificar |
|---|---|---|
| Backup recuperable | `UNVERIFIED` | Confirmar desde fuente administrativa autorizada la fecha, alcance, retención e integridad |
| PITR | `UNVERIFIED` | Confirmar activación, ventana y RPO efectivo |
| Restore aislado | `NOT_RUN` | Restaurar sólo a destino no productivo, con webhooks/jobs/sincronización externos desactivados |
| RPO/RTO | `UNDEFINED` | Acordar valores, responsables y procedimiento de escalamiento |
| Rollback | `HOLD` | Ensayar recuperación de recibos, mesas, reservas, RLS, funciones y permisos sin sobrescribir producción |

Escenarios que deben ensayarse en staging: pérdida de conexión, respuesta de cobro perdida y recuperación por recibo, actualización de service worker durante cobro, intervención Admin con origen desconectado, rollback de migración sin restaurar funciones vulnerables y rechazo seguro de clientes con frontend antiguo.

## Cutover y secuencia segura recomendada

El reporte anterior documenta `17 PASS` de carreras SQL y código de transición, pero no existe aún simulación integral autorizada. `P0-A` se mantiene `HOLD`: una suite SQL no demuestra recovery de clientes físicos, aislación por tenant, recibos financieros ni compatibilidad de cliente.

Secuencia propuesta, exclusivamente para un staging autorizado:

1. Aprovisionar o reactivar staging aislado, sin copiar datos personales ni secretos de producción.
2. Confirmar que el Preview del PR usa ese staging, que la base de producción está bloqueada para mutaciones de prueba y que no hay `service_role` en el cliente.
3. Crear identidades sintéticas para Staff A, Staff B y Admin, y dos contextos/dispositivos independientes.
4. Aplicar en orden las dependencias de PR #338, el bridge y la migración de supervisión; mantener Admin OFF.
5. Verificar firmas RPC, RLS, GRANT/REVOKE, funciones privilegiadas, tenant isolation, locks, contrato financiero y Cocina.
6. Ejecutar backup/restore aislado con efectos externos desactivados y conservar evidencia de RPO/RTO.
7. Ejecutar QA-01 a QA-40 y los escenarios R1–R6, registrando la plantilla por caso.
8. Simular el cutover: drenaje, locks, rechazo de cliente antiguo, recuperación de mesa/recibo y protección contra doble cobro.
9. Sólo con CI, QA, recovery y cutover aprobados, realizar una auditoría de despliegue separada. Esta certificación no autoriza un despliegue.

## Campos de salida

```text
IMPLEMENTATION_STATUS = PARTIAL_WITH_DOCUMENTED_BLOCKERS
REPOSITORY = fdxruli/Lanzo-POS
PR352_NUMBER = 352
PR352_BRANCH = feat/restaurant-admin-supervision-r1

PR352_HEAD_INITIAL = 1199af3397815b0eae71e013efdc9599ea7ae0e3
PR352_HEAD_FINAL = publication HEAD; validate with PR branch before approval
PR338_HEAD = fb17e9a43929d54087ab937cb760a8cd6e087c36
PR354_HEAD = c7dd252722e7a1b8de0830773451a52f4374e662
MAIN_SHA = a8547bfc34f483d1d72020114510c8ebea74aace

SCOPED_STORAGE_ROOT_CAUSE = UNPROVEN
SCOPED_STORAGE_FIX_OWNER = CI harness in PR #352; synchronization proposal remains PR #354 / technical branch
PUBLICSTORE_FLAKINESS_STATUS = OBSERVED_IN_BASE_AND_CANDIDATE; UNRESOLVED
PRODUCT_MODAL_TIMEOUT_STATUS = HISTORICAL_CANDIDATE_ONLY_OBSERVATION; HOLD_PENDING_NEW_DIFFERENTIAL

BASE_COMPARISON_SHA = fb17e9a43929d54087ab937cb760a8cd6e087c36
CANDIDATE_SHA = 109c5431049cfb4390149603a5d7918778894d3a
NEGATIVE_CONTROLS = PRESERVED_BY_CONFIGURATION; FINAL_EXECUTION_PENDING
FOCAL_REPETITIONS = 9 targets x 50 per BASE/CANDIDATE
FULL_SUITE_DIFFERENTIAL = HISTORICAL_FAIL_38115602230; SCOPED_38148237842_FAIL (2 focal repeated candidate-only timeouts; raw differential blocked after focal comparator)

PR127_RESULT = FAIL_38148233108_TEST_HARNESS_DEFECT; NORMALIZER_FIXED; OFFICIAL_RERUN_REQUIRED
ACTOR_RUNTIME_RESULT = PASS_38148235727_NEW_REGRESSION_COUNT_0
ACTOR_SCOPED_STORAGE_RESULT = FAIL_38148237842_TWO_REPEATED_FOCAL_CANDIDATE_ONLY_TIMEOUTS

RESTAURANT_FOCAL_TESTS = PRIOR_REPORT_370_PASS; NOT_REEXECUTED_IN_THIS_DOCUMENTATION_COMMIT
ECOMMERCE_FOCAL_TESTS = modal suite 8/8 PASS; isolated close/reopen 1/1 PASS; PublicStore local 29/30 with focus NOT_FOUND failure; Scoped differential FAIL
ESLINT_FOCAL = NOT_RUN_IN_THIS_CERTIFICATION_PASS
ESLINT_FULL = NOT_RUN_IN_THIS_CERTIFICATION_PASS
BUILD_RESULT = NOT_RUN_IN_THIS_CERTIFICATION_PASS
POSTBUILD_RESULT = NOT_RUN_IN_THIS_CERTIFICATION_PASS

SQL_RACES_RESULT = PRIOR_REPORT_17_PASS; NOT_REEXECUTED
P0_A_STATUS = HOLD
P0_B_STATUS = RESOLVED_IN_CANDIDATE (prior evidence; not an authorization to deploy)

STAGING_AVAILABILITY = UNAVAILABLE
INTEGRATED_ENVIRONMENT_STATUS = BLOCKED
PREVIEW_ENVIRONMENT_ISOLATION = UNVERIFIED
AUTH_INTEGRATION = BLOCKED
REALTIME_INTEGRATION = BLOCKED
CASH_INTEGRATION = BLOCKED
CREDIT_INTEGRATION = BLOCKED
INVENTORY_INTEGRATION = BLOCKED
KITCHEN_INTEGRATION = BLOCKED

TWO_DEVICE_QA = NOT_RUN
ADMIN_STAFF_QA = NOT_RUN
FREE_OFFLINE_QA = NOT_RUN
PHYSICAL_CLIENT_UPGRADE = NOT_RUN
SERVICE_WORKER_RECOVERY = NOT_RUN
DEXIE_PRESERVATION = NOT_RUN

BACKUP_READINESS = UNVERIFIED
RESTORE_TEST_RESULT = NOT_RUN
ROLLBACK_READINESS = HOLD

CUTOVER_SIMULATION = NOT_RUN
OBSOLETE_CLIENT_PROTECTION = NOT_INTEGRATEDLY_VERIFIED
FINANCIAL_RECEIPT_RECOVERY = NOT_INTEGRATEDLY_VERIFIED

MIGRATIONS_CREATED = 20261010013257_restaurant_cloud_transition_bridge_v1.sql; 20261010013258_restaurant_admin_supervision_r1.sql
MIGRATIONS_APPLIED = NONE
PRODUCTION_SQL_WRITES = NONE
PRODUCTION_DATA_WRITES = NONE
PRODUCTION_FRONTEND_DEPLOYED = NO

PR338_MERGED = NO
PR352_MERGED = NO
PR354_MERGED = NO

FILES_CHANGED = CI harness configuration, CI workflow test, PR127 path-normalization regression test, this certification report
COMMIT_SHA = report publication commit recorded in PR history
PUSH_RESULT = SUCCESS for 7995b7ff and 109c5431; current publication pending

BLOCKERS = Scoped Storage repeated candidate-only timeouts; PR127 rerun after harness fix; isolated staging; Preview isolation; synthetic identities/devices; backup/PITR evidence; restore drill; integrated QA; cutover simulation
DEPLOYMENT_READINESS = HOLD
MERGE_READINESS = HOLD
NEXT_ACTIONS = complete final CI runs; provision authorized staging; verify Preview isolation; execute backup/restore and QA matrix; simulate cutover; conduct a separate deployment audit
```

## Cierre append-only — Hotfix Actor Runtime / BFCache

> Esta sección conserva el historial anterior y prevalece únicamente para las referencias, resultados y estados que declara de forma explícita. La certificación siguiente es de CI sobre código; no autoriza merge, despliegue, migraciones ni pruebas sobre datos reales.

### Referencias verificadas

| Referencia | Valor verificado |
|---|---|
| PR #352 | [OPEN / Draft](https://github.com/fdxruli/Lanzo-POS/pull/352), `feat/restaurant-admin-supervision-r1` |
| BASE inmutable / PR #338 | `fb17e9a43929d54087ab937cb760a8cd6e087c36` |
| HEAD de código certificado | `69858b1d202d98db75910637b0d3aefc67ea9961` |
| `main` observado | `5be67950eea27c1b25db3e8765339222f8217e35` |
| PR #354 | [MERGED](https://github.com/fdxruli/Lanzo-POS/pull/354); source `e12dcd41d7044fd6237eddcb5e63bae161752eff`; merge commit `5be67950eea27c1b25db3e8765339222f8217e35` |

PR #352 continúa basada en PR #338; PR #338 sigue sin merge. Se consultaron esos estados y referencias de forma remota, sin fusionar, rebasear ni alterar ninguna rama base.

### Corrección focal y causa demostrada

| Commit | Archivo y alcance | Corrección |
|---|---|---|
| `c0881af85c4fa7f9e697538683db317c1ce04954` | Sólo `src/pages/__tests__/PublicStorePage.test.jsx` (`+21/-5`) | Espera el registro observable del listener de recuperación antes de emitir el evento BFCache/autoridad. |
| `16a781e22261d9960363b4985023c8b3ecc3d5fa` | Sólo `src/components/ecommerce/__tests__/EcommercePortalSettings.productModalLifecycle.test.jsx` (`+26/-10`) | Espera la solicitud y respuesta de catálogo observables, en vez de una espera temporal, para el ciclo del modal. |
| `69858b1d202d98db75910637b0d3aefc67ea9961` | Sólo `src/pages/__tests__/PublicStorePage.test.jsx` (`+10/-2`) | Espera que `pageshow` esté registrado antes de emitir `pageshow.persisted` seguido de `focus`. |

La causa final fue una carrera de *readiness* de la prueba: React podía registrar su efecto pasivo después de que la prueba emitiera un evento. El artefacto del run Actor Runtime `38351698996` aisló un único timeout de 15 s, sólo en una repetición, de `deduplicates a persisted pageshow followed immediately by focus`; no fue una regresión de producto ni de contrato. El cambio de `69858b1d…` conserva todas las aserciones de número de solicitudes, deduplicación, recuperación y limpieza; no incrementa timeouts, no omite casos y no cambia código productivo, SQL, dependencias, autenticación ni datos.

`PR354_REUSE_DECISION = FOCAL_TEST_ONLY_ADAPTATION`: se reutilizó exclusivamente el patrón comprobable de sincronizar hitos observables de la PR #354. No se hizo merge, rebase ni cherry-pick integral de #354 en #352.

### Controles negativos ejercitados

Las mutaciones se hicieron en worktrees temporales aislados y se restauraron antes de este cierre:

- Quitar el listener `pageshow` o ignorar `persisted` hizo fallar el contrato BFCache esperado.
- Cortocircuitar la recuperación autoritativa produjo una llamada donde se esperaban dos.
- Omitir `applyAuthoritativePortalStatus` dejó fallar la transición de contenido cacheado a `NOT_FOUND`.
- Desactivar la guarda de respuesta obsoleta permitió que `Producto Stale` sustituyera a `Producto Dos`.
- Desactivar la invalidación close/reopen permitió que una respuesta anterior llegara al modal reabierto.
- Omitir sólo `removeEventListener('pageshow', handlePageShow)` produjo tres llamadas donde se esperaban dos, demostrando que el listener desmontado sí afecta el contrato.

`NEGATIVE_CONTROLS = PASS_RESTORED_IN_ISOLATED_WORKTREES`.

### Cronología de CI conservada

| Candidato | PR127 | Actor Runtime | Actor Scoped Storage | Lectura |
|---|---|---|---|---|
| `278bbb14…` | [PASS 38262989565](https://github.com/fdxruli/Lanzo-POS/actions/runs/38262989565) | [FAIL 38262993604](https://github.com/fdxruli/Lanzo-POS/actions/runs/38262993604) | [PASS 38262997586](https://github.com/fdxruli/Lanzo-POS/actions/runs/38262997586) | Bloqueo BFCache: BASE `50/0`; candidato `47/3`. |
| `c0881af…` | [PASS 38341621327](https://github.com/fdxruli/Lanzo-POS/actions/runs/38341621327) | [PASS 38341627205](https://github.com/fdxruli/Lanzo-POS/actions/runs/38341627205) | [FAIL 38341635313](https://github.com/fdxruli/Lanzo-POS/actions/runs/38341635313) | El bloqueo restante fue `ecommerce-latest-search-cursor`: BASE `50/0`; candidato `48/2`. |
| `16a781e…` | [PASS 38351694714](https://github.com/fdxruli/Lanzo-POS/actions/runs/38351694714) | [FAIL 38351698996](https://github.com/fdxruli/Lanzo-POS/actions/runs/38351698996) | [PASS 38351703091](https://github.com/fdxruli/Lanzo-POS/actions/runs/38351703091) | Runtime quedó fail-closed por una prueba nueva de deduplicación que hizo timeout una vez; el resto de los nueve targets estaba limpio. |
| `69858b1…` | [PASS 38355083089](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355083089) | [PASS 38355086818](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355086818) | [PASS 38355091640](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355091640) | Cierre de CI de código contra la misma base inmutable. |

Los resultados `PASS` diferenciales no reinterpretan suites raw con fallos compartidos como una suite absoluta verde. La política se mantuvo fail-closed: el fallo nuevo de `16a781e…` bloqueó Runtime hasta que la sincronización quedó corregida y repetida.

### Gates finales de código — `69858b1…` contra `fb17e9…`

| Gate | Run / artefacto | Resultado legible |
|---|---|---|
| PR127 Global Comparison | [38355083089](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355083089), [artefacto 11792991524](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355083089/artifacts/11792991524) | `OK`; 94 fallos compartidos, 0 candidate-only raw, 0 nuevos, 0 no resueltos, 0 flaky de base y 1 resuelto. |
| Shared Terminal Actor Runtime | [38355086818](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355086818), [diferencial 11794075859](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355086818/artifacts/11794075859) | `PASS`; 0 regresiones nuevas en suite completa y 0 regresiones candidate-only/rate en los targets focales. |
| Shared Terminal Actor Scoped Storage | [38355091640](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355091640), [diferencial 11793607628](https://github.com/fdxruli/Lanzo-POS/actions/runs/38355091640/artifacts/11793607628) | `PASS`; 0 regresiones nuevas en suite completa y 0 regresiones candidate-only/rate en los targets focales. |

Actor Runtime focal, BASE → CANDIDATE (`passes/failures/notExecuted/unreadable`):

| Target | BASE | CANDIDATE |
|---|---:|---:|
| `bfcache-authoritative-not-found` | `48/2/0/0` | `50/0/0/0` |
| `bfcache` | `48/2/0/0` | `50/0/0/0` |
| `site-version` | `50/0/0/0` | `50/0/0/0` |
| `ecommerce-latest-search-cursor` | `48/2/0/0` | `50/0/0/0` |
| `ecommerce-same-search-next-page` | `49/1/0/0` | `50/0/0/0` |
| `ecommerce-clear-search-restore-catalog` | `49/1/0/0` | `50/0/0/0` |
| `ecommerce-stale-search-response` | `50/0/0/0` | `50/0/0/0` |
| `ecommerce-stale-load-more-loading` | `50/0/0/0` | `50/0/0/0` |
| `ecommerce-pending-close-reopen` | `50/0/0/0` | `50/0/0/0` |

Actor Scoped Storage focal, BASE → CANDIDATE: `bfcache-authoritative-not-found 49/1/0/0 → 50/0/0/0`; `bfcache 48/2/0/0 → 50/0/0/0`; `site-version 50/0/0/0 → 50/0/0/0`; `ecommerce-latest-search-cursor 50/0/0/0 → 50/0/0/0`; `ecommerce-same-search-next-page 50/0/0/0 → 50/0/0/0`; `ecommerce-clear-search-restore-catalog 50/0/0/0 → 50/0/0/0`; `ecommerce-stale-search-response 46/4/0/0 → 50/0/0/0`; `ecommerce-stale-load-more-loading 50/0/0/0 → 50/0/0/0`; `ecommerce-pending-close-reopen 49/1/0/0 → 50/0/0/0`.

Para ambos gates focales: `candidateOnlySemanticRegressionCount=0`, `candidateOnlySemanticObservationCount=0`, `singleRunCandidateOnlySemanticObservationCount=0` y `candidateFailureRateRegressionCount=0`.

Las repeticiones de suite completa fueron también legibles: Runtime BASE `5498/72/51/5621` dos veces y CANDIDATE `5562/71/51/5684` dos veces (`newRegressionCount=0`, 90 fallos preexistentes estables, una mejora incidental). Scoped BASE `5498/72/51/5621` y `5497/73/51/5621`; CANDIDATE `5562/71/51/5684` dos veces (`newRegressionCount=0`, 90 fallos preexistentes estables, dos mejoras incidentales). Los builds y lint de los jobs focales completaron correctamente.

En local, el caso exacto de deduplicación pasó `1/1` (29 omitidos) y el lint del archivo cambiante terminó sin errores; el único aviso fue `baseline-browser-mapping` desactualizado. `react-doctor` no produjo salida y se detuvo de forma segura, por lo que `REACT_DOCTOR = UNVERIFIED_RUNNER_STALLED`, no un PASS.

### Staging, recovery, SQL y alcance seguro

La consulta administrativa de sólo lectura al staging histórico `jdnbmvaphvjunwhnxowo` (`Lanzo-staging-historical-r1`, `us-west-2`) mostró `INACTIVE`; sus metadatos informaron `pitr_enabled=false`, `backups_count=0`, `walg_enabled=true`. Esto no acredita backup recuperable, PITR, retención, restore ni permisos de otro ambiente.

No se reactivó ni creó infraestructura; no hubo restore, SQL aplicado, acceso/escritura a producción, datos reales ni despliegue frontend. El delta del hotfix no contiene SQL, por lo que se preserva la evidencia histórica de las 17 carreras SQL sin presentarla como una repetición nueva.

El archivo reservado local `NUL` se verificó como artefacto auxiliar de CI/diferencial y se eliminó mediante su ruta extendida exacta, comprobando después su ausencia. No se ejecutó `git clean`, no se incluyó en commits y no se eliminó otro archivo.

```text
IMPLEMENTATION_STATUS = CI_CODE_CERTIFIED__INTEGRATED_QA_BLOCKED
CERTIFIED_CODE_HEAD = 69858b1d202d98db75910637b0d3aefc67ea9961
BASE_COMPARISON_SHA = fb17e9a43929d54087ab937cb760a8cd6e087c36
DOCUMENTATION_PUBLICATION_COMMIT = INTENTIONALLY_NOT_SELF_REFERENTIAL
ROOT_CAUSE = TEST_READINESS_SYNCHRONIZATION_RACE
PR354_REUSE_DECISION = FOCAL_TEST_ONLY_ADAPTATION
NEGATIVE_CONTROLS = PASS_RESTORED_IN_ISOLATED_WORKTREES
PR127_RESULT = PASS_38355083089
ACTOR_RUNTIME_RESULT = PASS_38355086818
ACTOR_SCOPED_STORAGE_RESULT = PASS_38355091640
BF_CACHE_CI_CERTIFIED = YES
P0_A_STATUS = HOLD_PENDING_INTEGRATED_QA
P0_B_STATUS = RESOLVED_IN_CANDIDATE_CI_ONLY
STAGING_STATUS = INACTIVE_HISTORICAL__UNAVAILABLE_FOR_QA
PREVIEW_ISOLATION = UNVERIFIED
BACKUP_READINESS = UNVERIFIED
RESTORE_TEST = NOT_RUN
ROLLBACK_READINESS = HOLD
SQL_RACES_REEXECUTED = NO
SQL_RACES_RESULT = HISTORICAL_17_PASS_PRESERVED
MIGRATIONS_APPLIED = NONE
PRODUCTION_SQL_WRITES = NONE
PRODUCTION_DATA_WRITES = NONE
PRODUCTION_FRONTEND_DEPLOYED = NO
PR338_MERGED = NO
PR352_MERGED = NO
PR354_MERGED = YES
DEPLOYMENT_READINESS = HOLD
MERGE_READINESS = HOLD
NEXT_ACTIONS = publish this append-only evidence; rerun the three gates on that documentation HEAD; separately authorize isolated staging, backup/restore evidence, synthetic-device QA and cutover simulation before any merge or deployment
```
