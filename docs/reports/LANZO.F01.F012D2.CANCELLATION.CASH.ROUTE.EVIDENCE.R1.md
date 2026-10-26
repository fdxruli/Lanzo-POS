# LANZO POS — F01-2D.2 — Evidencia Cancellation → Caja R1

Fecha: 26 de octubre de 2026. **CANCELLATION_CASH_ROUTE_SCOPED_CLOSED**;
POS_SYNC_BOUNDARIES_PARTIAL / HOLD; gate OFF; LC13 OPEN.
Contrato y recorrido: `LANZO.F01.F012D2.CANCELLATION.CASH.ROUTE.R1.md`.

## SHAs y evidencia inmutable

| Referencia | SHA / estado |
| --- | --- |
| Baseline pertinente: #373 al comenzar | `ce03b04918347898396957c8b7f35eb955896b89` |
| Implementación final local | `2765a8a85a8246df2916db76c01f5e94ff22dccb` |
| #373 remoto verificado | `ce03b04918347898396957c8b7f35eb955896b89`, OPEN/Draft, sin merge |
| Base / #372 | `f1d69093ffe3ad180752773c178b7fbaefd92ce1`, OPEN/Draft, intacto |
| Main remoto | `52bb573e651529b323b6617e3161cd76ece14a39`, intacto |

Rama local autorizada: `feat/f01-early-admission-recovery-r1`. Base del PR:
`feat/f01-single-instance-coordinator-r1`, ancestro comprobado. Preflight limpio
antes de editar: `evidence/remote-preflight.json`. Estado remoto final y comparación
de título/cuerpo/flags/HEAD/base/updated_at: `evidence/final-state.json`.
No push ni modificación de PR: esta fase **no tiene CI ni Preview nueva**.
Los resultados siguientes son ejecuciones locales, no resultados de CI.
El commit documental de entrega posterior no modifica producto/tests ni publica.

`frozen-sources.sha256` fija las cinco fuentes, lock y Vite config.
`tested-code-manifest.json` coteja **15 archivos** del checkout de trabajo con
la candidata aislada: los siete del commit de implementación y ocho harnesses,
scope/dependencias/configuración. Se usaron las mismas dependencias instaladas:
Node 24.22.1, Vitest 4.0.14, Vite 7.2.2, Dexie 4.4.3. No instalación/descarga
adicional. La validación base y candidata se ejecutó serialmente, usando
`scripts/qa/single-instance-f012d1/validate.mjs` y sus tres runners F01-2A
**sin modificar**. Misma selección, workers=2 y configuración por árbol.

## Pruebas focalizadas

**17/17 nuevas PASS**, incluidas en la global; no se suman dos veces.
`route.test.jsx`: 16; `actual-read.test.jsx`: 1. Hook, scope, registry,
cancelación y transacción Dexie reales. En las primeras 16 se controla el read
de Caja; en la última es real el repositorio Local y su proyección, con estado
admin e identidad de dispositivo sintéticos. No se usan proyectos Supabase.
La prueba de coordinator controla la lista y el resultado de recovery financiero,
manteniendo reales coordinator → callback project → registry → proyección →
evento → hook; no certifica RPC/ledger remoto.

| Requisito | Pruebas y resultado |
| --- | --- |
| 1. Publicación financiera preservada | Orden de cinco eventos, detail null, actor checks, patch y clave de log real: PASS |
| 2. Activo, coalescing una vez | Dos proyecciones antes del timer, un solo refresco; carga inicial separada: PASS |
| 3. Quiesce con timer pendiente | Avanzar timers tras quiesce no inicia otro read: PASS |
| 4. Callback ya encolado | Dos intercalados deterministas: cancelado pero invocado; disparado antes de ejecutar factory: PASS |
| 5. Trabajo ya admitido | Stop/drain esperan gate del read real controlado, sin publicación vieja; read inicial compartido observado y read que nunca termina: PASS |
| 6. Eventos tardíos y doble stop | Listener capturado y evento viejo inertes; promesa de stop idéntica y una sola limpieza: PASS |
| 7. Nueva instancia | Carga inicial recupera pulso descartado, nuevo evento funciona una vez; prueba Local real total 10 → 0, caja/log conservados: PASS |
| Otros intercalados | Owner reemplazado durante read, contexto invalidado/rechazo tardío, StrictMode, quiesce dentro del evento sales anterior a cash: PASS |
| Propagación/límites | Coordinator conserva scope original en sale.cancel; UNKNOWN ajeno no se elimina: PASS |

Los callbacks del timer y del listener se capturan/invocan explícitamente en los
intercalados críticos. No se depende de una carrera de tiempo del navegador.
La comprobación del evento antiguo en la prueba Local observa directamente
el timerApi de la nueva instancia, sin sleep. `waitFor` sólo espera IndexedDB/React.
El test de no-settlement deja su promesa sin resolver intencionalmente para
demostrar que no hay éxito por timeout; no representa un cierre completado.

```sh
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d2 --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012d2/evidence/focal.json
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d2 scripts/qa/single-instance-f012d/recovery.test.js src/hooks/__tests__/useCaja.networkRecovery.test.jsx --maxWorkers=1 --reporter=json --outputFile=scripts/qa/single-instance-f012d2/evidence/focal-related.json
```

Primer comando: **17 PASS / 0 FAIL / 0 SKIP**, exit 0.
Segundo: **43 PASS / 0 FAIL / 0 SKIP**, exit 0 = 17 nuevas + 14 recovery
anteriores + 12 network recovery del hook. Es una repetición solapada, no 43
adicionales. `focal*.json/log` conservan resultados finales. Las primeras
ejecuciones de desarrollo y `initial-related.log.gz` no son el run de aceptación.

## Comparación F-01 y global

Dos checkouts aislados, sin alterar los otros worktrees anteriores:
`/workspace/scratch/2a5709f8e222/Lanzo-cash-route-base` en ce03b049 y
`/workspace/scratch/2a5709f8e222/Lanzo-cash-route-candidate` con fuentes/tests
idénticos al commit local de implementación.

Desde cada cwd se ejecutó, con tag `base` o `candidate`:

```sh
node /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012d1/validate.mjs /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012d2/evidence/TAG --build
```

`validation-driver.json`, `TAG/driver.log`, `TAG/exit.json` y
`TAG/global-exit.json` conservan comandos expandidos y exit codes. La base
combinada termina exit 1 por fallos históricos. En candidata, builds terminan
exit 0 y selección/global exit 1; no se declara suite global verde.

El driver combinado inicial desapareció antes de emitir el reporte de la global
candidata. Su causa queda UNKNOWN: no se capturó un exit del padre. Ese intento
no aporta resultado de assertions. Se conservan observación y comparación
prematura ENOENT en `attempts/interrupted-global`. Se repitió únicamente la global
con código/dependencias congelados, sin repetir los builds ni selección completos:

```sh
node /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012a/global.mjs /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012d2/evidence/candidate
```

Cwd de candidata; la tabla siguiente usa sólo el reporte completo de esa repetición.

| Ejecución | PASS | FAIL | SKIP | Total |
| --- | ---: | ---: | ---: | ---: |
| F-01 base | 1.167 | 4 | 50 | 1.221 |
| F-01 candidata | 1.167 | 4 | 50 | 1.221 |
| Global base | 5.969 | 88 | 52 | 6.109 |
| Global candidata | 5.986 | 88 | 52 | 6.126 |

**Cero resultados históricos cambiados; +17 PASS globales atribuibles a esta
fase.** La selección amplia preexistente no incluye el directorio nuevo de QA;
las nuevas pruebas se ejecutan focalmente y en la global.
Los cuatro fallos de la selección están en
`restaurantOrderCheckoutClose.test.js`, casos de retry split bill. Los 88
fallos globales y sus mensajes se enumeran en `historical-failures.json`; no se
arreglan ni se reclasifican en esta fase. No se afirma nada sobre su causa
funcional más allá de su reproducción en ambas versiones.

```sh
node scripts/qa/single-instance-f012d2/compare.mjs
```

`differential.json` compara cada assertion histórica y su primer mensaje de
error; `normalization.json` registra sólo prefijos absolutos conocidos,
normalizados simétricamente. `pr127-base` conserva la ejecución **local** del
comparador original `scripts/ci/pr127-global-comparison.mjs extract/classify`,
sin modificar assertions, thresholds ni comparador: **status OK, 104 fallos
compartidos, cero exclusivos/nuevos/resueltos/sin resolver**. Además de las
assertions fallidas, el comparador considera errores de archivo/suite; por eso
104 no se presenta como el número de assertions FAIL (88). JSON/logs comprimidos con
gzip son copias sin pérdida; descomprimir para repetir el comparador.
`compressed-artifacts.json` registra SHA-256 de cada JSON original y su gzip,
con roundtrip verificado.

## Builds, lint y preservación

Los runners ejecutaron en cada árbol:

| Build | Comando | VERCEL_ENV | Base / candidata |
| --- | --- | --- | --- |
| Preview | `node node_modules/vite/bin/vite.js build` | `preview` | exit 0 / exit 0 |
| Production | `npm run build` | `production` | exit 0 / exit 0 |
| Store | `npm run build:store` | `production` | exit 0 / exit 0 |
| Store Vercel | `npm run build:store:vercel` | `production` | exit 0 / exit 0 |

**8/8 builds PASS**, locales; Store Vercel sólo empaqueta, no despliega.
`TAG/builds.json` y logs gzip conservan comandos y auditoría precache existente.
Preview y Production: referencias 32/24, sin assets faltantes ni violaciones
del auditor. No se confunde `VERCEL_ENV=preview` con un despliegue remoto.

```sh
node node_modules/eslint/bin/eslint.js src/hooks/useCaja.js src/services/financial/cancellationCashRefreshRoute.js src/services/financial/financialCancellationProjection.js src/services/financial/financialProjectionRegistry.js src/services/financial/financialIntentRecoveryCoordinator.js scripts/qa/single-instance-f012d2
git diff --check
sha256sum -c scripts/qa/single-instance-f012d2/evidence/frozen-sources.sha256
```

Los tres comandos: exit 0. Lint conserva sólo el aviso preexistente
`baseline-browser-mapping` sobre antigüedad de sus datos; no se actualizan
dependencias por ese aviso. `local-checks.json` y logs lo registran.

```sh
node /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012d2/audit.mjs /workspace/scratch/2a5709f8e222/Lanzo-POS/scripts/qa/single-instance-f012d2/evidence
```

Cwd: candidata con builds. **2.063 archivos preexistentes auditados: 2.059
idénticos y exactamente cuatro fuentes permitidas modificadas**, más el helper
nuevo. `audit.json`: 45 assets JS/HTML/JSON inspeccionados, cero fixtures nuevos,
lock name o factoría de scope. Código opcional alcanzable, sin construir scope
en el grafo comercial ni cablear App. Gate OFF por preservación de App/main/
activación y sus callsites, no por un flag de prueba.
`callsite-preservation.json`: 21 callbacks del hook, sólo cambia
`cargarEstadoCaja`; otros 20 idénticos, incluido cierre administrativo. Los otros
cinco callsites reservados viven en `cashRepository`, íntegramente idéntico.
No hay excepción que requiera intervenir ninguno de los seis.

`getCurrentCashSession` se inspeccionó hasta sus awaits Local/Cloud, snapshot,
proyección y fallback; esta lectura no usa las carreras `withFinancialTimeout`
de los callsites financieros reservados. El scope espera la promesa retornada
completa. Esto no certifica servidor/caches compartidos/otros providers ni
modifica sus contratos; la prueba con repositorio real es Local.

## NOT_EXECUTED y límites

`command -v chromium chromium-browser google-chrome`: sin ejecutables.
**Navegador nativo NOT_EXECUTED**, sin descargas en esta fase. jsdom no sustituye
Web Locks nativo, Windows/Edge/Android/PWA, HTTPS/LAN ni dispositivos físicos.
Cloud remoto, Supabase, migraciones, producción, QA comercial y CI de esta fase:
**NOT_EXECUTED**. No se usaron proyectos Supabase ni se enviaron mensajes externos.

No se cambian las pruebas antiguas para convertir el contraejemplo legacy en
PASS funcional. La nueva ruta exige scope original compartido; los callsites
comerciales actuales siguen sin inyectarlo con el gate apagado. No se elimina
`financial_projection_subscriber_lifetime` porque quedan otros consumidores.
El resto de UNKNOWN de F01-2D.1 permanece UNKNOWN: POS Sync global sigue HOLD.
No se cierra LC13 ni se autoriza activación, Ready, merge o siguiente fase.
