# LANZO ACTOR SCOPED STORAGE M-01 ONLY — EVIDENCE R1

Fecha: 21 de octubre de 2026, America/Mexico_City. Evidencia nueva local sobre main f48aab53 y candidata M-01-only. CI y Preview pendientes al crear este checkpoint; cierre se añadirá después de observarlos.

Fuentes: main f48aab53634663438a06dc5187fa7e6d17b74fb3; focal 1cdc1cd029982e0279177ab29be1f8fffacb6ed8; checkpoint de código 6363772a; pruebas finales 95468ca9. Dos módulos comerciales idénticos al focal; invalidate idéntico a main. Runtime/controller/handoff/política/SW no cambian.

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
