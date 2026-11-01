# F01-2D.2: cancellation → cash event → useCaja

Contrato opcional, gate OFF. No App, RPC ni operaciones contra proyectos reales.
Ver los dos informes `docs/reports/LANZO.F01.F012D2.CANCELLATION.CASH.ROUTE*`.

Desde la raíz del checkout, con las dependencias ya instaladas del lockfile:

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d2 --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012d2/evidence/focal.json
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d2 scripts/qa/single-instance-f012d/recovery.test.js src/hooks/__tests__/useCaja.networkRecovery.test.jsx --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012d2/evidence/focal-related.json
node node_modules/eslint/bin/eslint.js src/hooks/useCaja.js src/services/financial/cancellationCashRefreshRoute.js src/services/financial/financialCancellationProjection.js src/services/financial/financialProjectionRegistry.js src/services/financial/financialIntentRecoveryCoordinator.js scripts/qa/single-instance-f012d2
```

La validación amplia usa **el runner preexistente F01-2D.1 sin modificar**:

```sh
node /absolute/Lanzo-POS/scripts/qa/single-instance-f012d1/validate.mjs /absolute/evidence/base --build
node /absolute/Lanzo-POS/scripts/qa/single-instance-f012d1/validate.mjs /absolute/evidence/candidate --build
```

Ejecutar el primero con cwd de un checkout aislado en
`ce03b04918347898396957c8b7f35eb955896b89`; el segundo en otro checkout con los
cinco archivos fuente y las pruebas nuevas. Mismo Node/dependencias/lock/config,
ejecución serial. Cada runner realiza cuatro builds, selección F-01 y global.
Los exit 1 de suites con fallos históricos no son PASS global.

```sh
node scripts/qa/single-instance-f012d2/compare.mjs
node /absolute/Lanzo-POS/scripts/qa/single-instance-f012d2/audit.mjs /absolute/evidence
git diff --check
```

`audit.mjs` usa cwd de la candidata que conserva los builds. `compare.mjs` requiere
JSON descomprimidos en `evidence/base` y `candidate`; los entregados `.gz` conservan
los bytes originales. El comparador PR127 original se invoca sin cambios; sólo
se normalizan prefijos absolutos conocidos simétricamente. No instalar navegador
para forzar la prueba; ausencia registrada como NOT_EXECUTED.
