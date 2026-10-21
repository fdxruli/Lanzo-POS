# LANZO POS — V1 STABILITY — EVIDENCE R1

Fecha: 21 de octubre de 2026, America/Mexico_City. Estado técnico: **ARCHITECTURAL_LIMITATION**.

El informe principal contiene conclusiones y matriz V1-01…28. Este documento permite repetir e inspeccionar los resultados sin confundir aserciones de detección con garantías de seguridad.

## 1. Identidad de fuentes

| Fuente | Commit / Git blob |
| --- | --- |
| Main | `f48aab53634663438a06dc5187fa7e6d17b74fb3` |
| Focal recuperado | `1cdc1cd029982e0279177ab29be1f8fffacb6ed8` |
| Investigación v2 sólo leída | `67c0a81ca41a2117beefb54f1a2c7f2555b02402` |
| C: código experimental validado | `93a9d6ef4fed76f964761951230afe50c70ebda1` |
| Main actorScopedStorage | `dcc09e7be2fcf2435801302c3199f8592e029edc` |
| C actorScopedStorage | `c597b8e8df2a86c7e5c6ac655a147b2b96021ed8` |
| C actorSessionRuntimeBridge | `dd9cbe8d57aff393019740697bc61a1d2be0458b` |
| Controller, idéntico a main | `5a87791742557fd3cadf1398e188a7a26f9d91ac` |
| Handoff, idéntico a main | `af09bc82d4a24c7e4726bc9f8b8a41cd104720c3` |

D agrega documentación, evidencia y ampliación del runner QA; no cambia el producto respecto de C. Los builds finales llevan HEAD C y el mismo código validado. No hay imports desde experimentos v2. Main y las ramas restaurante fueron reconsultados al cierre, sin cambio de SHA.

Checkpoints remotos A `f7ab095cbb2f874a0b9aa5fbed0195e9dc44a2de`, B `b2322dc6284d597d3fd2b4759e45c574db2dd9ef`, C arriba; D se identifica en la entrega por el SHA que contiene este documento. No se reescribe historia ni se fuerza un merge.

## 2. Procedencia de antecedentes

Cuatro informes PWA completos leídos mediante sus identidades persistentes: auditoría 3.1 (`libfile_3b27d58918b881919f5132c3a7c7cee2`), implementación 3.2 (`libfile_02fd16d6e7e081918269d26a61348c84`), B-01 (`libfile_29aceaedeca0819183f23d4a5ee80c2a`) y F02-only (`libfile_3b5fe2ac03688191b7564162d0225d10`). Se conservaron como texto para revisión; no se inventa hash de los bytes originales por una extracción de texto.

Los otros siete informes exigidos se recuperan con `git show 67c0a81c:docs/reports/<nombre>`: Late Context Hardening; Context Invalidation Architecture; Authority V2 Integration/Transition Design; Executive; Commit Matrix; Supervised Transition Pilot; Supervised Transition Evidence. Sus resultados son antecedentes, no PASS nuevos. Código EXP14/runner inicial recuperado con `git show 1cdc1cd0:<ruta>`.

## 3. Entorno y sustituciones

- Node 24, dependencias del lockfile instaladas por npm; sin cambios a package.json/lockfile.
- Playwright externo del runtime y Chromium 143.0.7499.0 headless en Linux. No Chrome/Edge físicos Windows ni Android/PWA instalada.
- Loopback HTTP temporal. Perfiles efímeros nuevos por caso; documentos A/B del mismo BrowserContext comparten origen y localStorage.
- Browser: módulos comerciales controller/bridge/handoff/storage/tenant; proveedores sintéticos de readiness/credenciales/device/autorización y SALES vacías.
- EXP14 Vitest: además usa el evaluador Admin offline real; navigator.onLine=false y reloj sintético.
- Carrera LC13 nativa: B activa storage directamente mientras A espera la barrera síncrona; no se atribuye autenticación Runtime real a B en ese caso.
- Node: módulos storage independientes y mapa compartido; sustitución secuencial de lectura para detectar TOCTOU, claramente distinta del navegador nativo.
- Regresiones financieras: suites existentes con sus propios doubles/fake-IDB, sin SQL live ni venta real.

No se usa el perfil, IndexedDB, licencia, dispositivo, sesión o cajas del propietario.

## 4. Comandos principales y resultados

Desde la raíz del repositorio, con referencias exactas preservadas:

```sh
npm ci --ignore-scripts
npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.test.js --maxWorkers=1 --reporter=json --outputFile=<evidence.json>
node --test scripts/qa/actor-storage-v1-stability/storage.node-test.mjs
node scripts/qa/actor-storage-v1-stability/browser.mjs > <chromium.json>
npx vitest run src/services/auth/__tests__ src/services/tenant/__tests__/tenantScopedStorage.test.js src/store/slices/license/licenseMaintenanceActions.tenantIsolation.test.js --maxWorkers=2 --reporter=json --outputFile=<candidate-auth.json>
npm run build
npm run build:store
npm run build:store:vercel
npm run test:ci -- --reporter=json --outputFile=<full-suite-N.json>
git diff --check origin/main...HEAD
```

ESLint focal: actorScopedStorage, actorSessionRuntimeBridge, actorLateContext.integration, adminLoginRecovery.integration y los tres runners MJS. Lint del browser se repitió tras añadir V1-21/V1-16, sin errores de código. El aviso baseline-browser-mapping externo no cambió dependencias.

| Ejecución | Resultado |
| --- | --- |
| main EXP14 + storage existente | 10 PASS / 1 FAIL; fallo EXP14 esperado y conservado |
| checkpoint focal exacto | 11/11 PASS; LC13 navegador sigue FAIL |
| Auth/tenant/health focal candidato | 260/260 PASS |
| Finanzas/handoff seleccionadas | 188/188 PASS, sin certificación E2E |
| Dexie Recovery focal | 127/127 PASS |
| Arquitectura/PWA/packaging final | 33 PASS / 0 FAIL / 50 omitidos |
| Node | 5 assertions PASS; 2 detectan propiedades de seguridad FAIL |
| Chromium final | 29 observaciones: 17 PASS acotados, 11 FAIL, 1 PASS_LIMITATION_DETECTED, 0 HARNESS_ERROR |
| Build/postbuild/Store/Store Vercel | PASS main y candidato; último build código C |
| Main full 1 y 2 | 5612 PASS / 75 FAIL / 52 omitidos / 5739 cada uno |
| Candidato full 1 y 2 | 5615 PASS / 75 FAIL / 52 omitidos / 5742 cada uno |
| Diferencial repetido local | 93 observaciones de fallo estables compartidas; 0 nuevas |
| PR127 local | 91 identidades compartidas; 0 exclusivas, nuevas o sin resolver |

Los grupos se solapan: no sumar 260+188+127 como total único. 75 son assertions fallidas; los comparadores incluyen file-level failures, por eso sus 91/93 identidades no equivalen a otros 91/93 tests. Las omisiones no son PASS.

## 5. Selección financiera y recuperación

La ejecución financiera incluye salesRepository, cashLocalRepository, customerCreditRepository, layawaysCashConsistency, inventoryEntryService (normal y freeLocalAuthority), syncOutboxService.actorOrigin/tenantIsolation, todo `src/services/financial/__tests__` y actorOperationalHandoff. El JSON conserva los nombres completos de las 188 assertions, incluidas ledger, lease/concurrency, receipts, recovery y projection.

La selección Dexie conserva los archivos del workflow: indexedDbPrimaryKeyRecovery, databaseSchemaRegistration, databaseRuntime.activity, DatabaseRecoveryGate, main.initialRecoveryBootstrap, PosApplicationBootstrap, AdminLoginModal.recovery, licenseAdminActions, licenseSessionTransitions, licenseAdminActions.localRecovery, licenseBootstrapCoordinator, productStoreRecoveryGuard, useProductStore.structuralRecovery, syncMetaService.recovery y storageManager.bestEffort. Se ejecutó cada archivo una sola vez en esa selección; 127 PASS, no multiplicar por su aparición en varios jobs.

## 6. Comparadores sin alterar criterios

```sh
node scripts/ci/pr127-global-comparison.mjs extract --candidate <candidate.json> --base <main.json> --output <phase-one.json>
node scripts/ci/pr127-focused-evidence.mjs --targets <targets.json> --output-dir <focused-side> --repetitions 20 --max-workers 4
node scripts/ci/pr127-global-comparison.mjs classify --phase <phase-one.json> --base-focused <focused-main> --candidate-focused <focused-pr> --output <pr127-final.json>
node scripts/compare-shared-terminal-full-suite.mjs <base-dir> <candidate-dir> <matrix.md> <summary.json>
```

Se preservan los scripts del repositorio. Sólo se normalizan prefijos absolutos de checkout y su symlink compartido node_modules para el transporte local. PR127 usa prefijos canónicos main/pr; el comparador repetido usa un prefijo común subject como sus jobs de workflow. No se modifican assertions, errores restantes, timeouts ni umbrales.

El primer extract PR127 conservaba rutas de node_modules de un lado y produjo 16 diferencias de firma; se comprobó el symlink y se aplicó la misma normalización de prefijo a ambos lados. El primer comparador repetido conservaba main/pr en tres errores file-level y produjo tres POSSIBLE_PR_REGRESSION. Eran exactamente paquete ausente o archivo sin suite con raíz distinta. El diagnóstico inicial se conserva; con prefijo común los mismos cuatro reports producen 93 fallos compartidos y cero nuevos. Esto no convierte las suites rojas en verdes.

PR127 produjo cero targets: el runner focal sale sin ejecutar repeticiones. Se invocó en ambos lados; **no se declaran 20 ensayos PASS inexistentes**. El resultado es una comprobación local, no un job remoto SUCCESS. Las 50 repeticiones PublicStore/controles negativos adicionales de los workflows Shared Terminal no se ejecutaron en esta investigación y no se declara ese gate remoto certificado.

Los workflows remotos no se dispararon: la tarea prohíbe abrir PR/Preview y los conectores expuestos carecen de workflow_dispatch. Main sí tiene sus estados remotos observados; no se reutilizan para C/D.

## 7. Casos Chromium y lectura correcta

`chromium.json` guarda estado durable, binding/token, generación, Runtime, suspensión, probes de handles y writes antes/después. Sus resultados incluyen:

- EXP14 main FAIL; focal y candidata PASS.
- LC13 main/main FAIL con y sin freeze; main-A/candidata-B también FAIL.
- Candidata-A/main-B y candidata/candidata PASS secuencial, con A o B congelados por CDP.
- Focal/focal continúa FAIL secuencial: atribución de beneficio a M-03, no a M-01.
- Concurrente candidata FAIL: el durable termina locked después de que B haya activado entre lectura/escritura A.
- Sustitución legítima B→C PASS, con y sin BC.
- BC viejo, missing/corrupt/access denied y duplicación/desorden de hints: resultados separados.
- Grants cercanos: exactamente un handle storage actual al estabilizar hints; ambas llamadas retornan granted en la observación, por lo que no demuestra admisión atómica.
- V1-21: storage rechaza durable extranjero, Runtime admite un contador sintético antes del hint. PASS_LIMITATION_DETECTED significa limitación confirmada, no seguridad financiera aprobada.

El runner mantiene FAILs explícitos. Exit 0 sólo significa que pudo recoger evidencia sin errores de harness. Las 11 propiedades fallidas impiden declarar corrección completa. El fixture Node también conserva las dos limitaciones active-read/write y pending-cleanup como contraejemplos detectados.

## 8. Artefactos y hashes

Todos bajo `scripts/qa/actor-storage-v1-stability/`:

| Archivo | Contenido |
| --- | --- |
| README.md | Dependencias, reproducción y límites |
| recovered-browser.mjs | Runner exacto anterior, sin reinterpretar sus etiquetas |
| browser.mjs | Runner real con módulos/variantes/freeze/interleaving |
| storage.node-test.mjs | Mitigación secuencial y contraejemplos |
| evidence/main-exp14.json, main-browser.json | Ejecuciones rojas baseline |
| evidence/previous-focal-exp14.json, previous-focal-browser.json | Rerun exacto del checkpoint anterior |
| evidence/candidate-auth.json | Auth/actor/tenant/health focal 260 PASS |
| evidence/financial-regressions.json | 188 assertions y su alcance |
| evidence/dexie-recovery.json | 127 assertions |
| evidence/build-architecture.json | 33 PASS / 50 omitidos |
| evidence/chromium.json | 29 observaciones, hashes de fuentes, snapshots y errores |
| evidence/global-base-1/2.json.gz | JSON originales completos de main, gzip sin pérdida |
| evidence/global-candidate-1/2.json.gz | JSON originales completos del candidato |
| evidence/pr127-*.json/md | Comparación semántica local y fase inicial |
| evidence/repeated-differential.json/md | Comparación repetida, scripts intactos |
| evidence/repeated-path-diagnostic.json | Atribución inicial afectada sólo por prefijos distintos |
| evidence/build-*.log | Build Admin/Store/Store Vercel de ambos lados |
| evidence/product.diff.gz | Diff exacto de los dos módulos comerciales contra main |
| evidence/consumer-inventory.txt | Referencias de consumidores auditadas |
| evidence/validation-summary.json | Contadores separados, código validado y blobs |
| evidence/artifact-hashes.json | SHA-256 y Git blob de artefactos, excluyendo el propio manifest |

Los logs textuales Admin de main/candidata normalizan exclusivamente espacios finales de dos avisos Vite para higiene de diff; no cambian mensajes ni resultados. Los JSON originales de tests se conservan sin cambios.

Los gzip pueden abrirse con `gzip -dc <archivo>`. Se conservan bytes originales de los JSON; la normalización es sólo una entrada de comparación derivada. El manifest comprueba reportes, scripts, configuración y evidencia para recuperación; no contiene secretos ni filas reales de negocio.

## 9. Restricciones finales

MIGRATIONS_CREATED=NONE; MIGRATIONS_APPLIED=NONE; SUPABASE_CALLS=NONE; PRODUCTION_DATA_WRITES=NONE; USER_IDB_CLEARED=NO; FINANCIAL_REAL_OPERATIONS=NONE; AUTHORITY_V2_IMPLEMENTED=NO.

PR_CREATED=NO; PREVIEW_PUBLISHED=NO; MERGE=NOT_PERFORMED. Cero deployments de la rama verificados en POS y Store. Conservación remota de la investigación expresamente autorizada por el adjunto; no autorización de integración comercial.

Próxima decisión: revisión del alcance de M-01 y sus riesgos residuales, manteniendo M-03 experimental. LC13 concurrente, pending y writer antiguo permanecen abiertos. Las pruebas físicas y los jobs remotos completos siguen pendientes antes de una candidata de integración.
