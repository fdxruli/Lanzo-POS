# LANZO POS — F01-2D — EVIDENCE R1

**SYNC_LIFETIME_PARTIAL / HOLD_SYNC_LIFETIME.** Sólo #373 OPEN/Draft. Gate OFF,
LC13 OPEN, sin merge ni producción. Las pruebas certifican las fronteras indicadas,
no toda la aplicación, un pago real ni exclusión universal de clientes legacy.

## Fuentes y reproducción

Baseline exacto `c20e3538c8be897dc7b3c937429000ac8006f42d`. Main `52bb573e` y
#372 `f1d69093` verificados al inicio; se reconsultan antes y después de publicar.
SHA remoto final, árbol y CI del SHA exacto quedan en el PR y respuesta de entrega;
no se inventa un hash autorreferente en este informe. La base no se cambia para
activar workflows.

Node 24.22.1, dependencias/lockfile originales compartidos. Cinco fuentes finales
se copian por bytes a un checkout de validación independiente y permanecen
inmutables durante todos sus builds/suites. `immutable-validation-sources.json`
y `tested-sources.json` registran SHA-256. Los cuatro archivos preexistentes
modificados son los tres coordinadores POS y recovery coordinator; el scope es
nuevo. Los módulos durables financieros no se editan.

`scripts/qa/single-instance-f012d/README.md` contiene comandos completos. Se usa
el runner previo `single-instance-f012b/validate.mjs` y los mismos comandos y
dependencias en ambos árboles. Continúa después de errores históricos: exit del
wrapper no es PASS. Cada etapa conserva exit, JSON y log. Builds seriales por
checkout, sin descargas de Chromium ni dependencias.

Los antecedentes F01 Audit/Design/F01-0 se recuperaron como textos completos con
325/438/210 líneas; no se adjuntan copias duplicadas al repo. Hashes de contenido:

| Documento original | SHA-256 |
| --- | --- |
| F01 LC13 Audit R1 | `32d3fab8e543403f9ab6ba478b52ba7b1978d95c01789de3cbd16da5d8e13871` |
| F01 Design R1 | `fa44e3f3cbdfac39693aa15b7f6f010443d5a474963a3f98e675b9465b439fb3` |
| F01-0 Decisions R1 | `5168c4439231eff8e2c5013e756668397813e12ff2d7c223753f6730269e9d92` |

## Resultados definitivos

| Validación | Resultado |
| --- | --- |
| Nuevas assertions focales F01-2D | **69/69 PASS**, también dentro de la global definitiva |
| Matriz D-01..60 | **56 PASS / 4 PARTIAL**; límites D-14/15/29/30 conservados |
| Amplia baseline y candidata | **1.167 PASS / mismos 4 FAIL / 50 SKIP / 1.221 total**, cero diferencias |
| Global baseline exacta | **5.864 PASS / 88 FAIL / 52 SKIP / 6.004 total** |
| Global candidata final inmutable | **5.933 PASS / mismos 88 FAIL / 52 SKIP / 6.073 total** |
| Diferencial global | **0 resultados históricos cambiados; 69 nuevas PASS** |
| PR127 local original | **104 fallos compartidos; 0 exclusivos; 0 nuevos; 0 sin resolver** |
| Production / Preview real / Store / Store Vercel | **PASS en ambos checkouts**, ocho builds definitivos |
| Precache/bundles | Sin faltantes; 0 marcadores QA/coordinador/scope factory nuevo |
| ESLint focal / diff-check | PASS |
| Chromium | **NOT_EXECUTED**, ejecutable ausente |
| F01-1, assertions incluidas en global | 45 PASS / 0 FAIL / 0 pendientes |
| F01-2, assertions incluidas en global | 5 PASS / 0 FAIL / 0 pendientes |
| F01-2A, assertions incluidas en global | 33 PASS / 0 FAIL / 0 pendientes |
| F01-2B, assertions incluidas en global | 45 PASS / 0 FAIL / 0 pendientes |
| F01-2C, assertions incluidas en global | 71 PASS / 0 FAIL / 0 pendientes |
| F01-2D, assertions incluidas en global | 69 PASS / 0 FAIL / 0 pendientes |


Las selecciones se solapan: no sumarlas como casos únicos. Los casos adicionales
F01-2D son assertions únicas, no la suma de sus reejecuciones. La matriz tiene
60 filas porque enlaza escenarios nuevos, regresiones originales y auditorías;
no significa 60 pruebas E2E nuevas ni 60 certificaciones completas de drenaje.

PR127 usa `scripts/ci/pr127-global-comparison.mjs` original, sin cambiar assertions,
mensajes, umbrales o clasificación. `compare.mjs` sustituye únicamente el prefijo
absoluto de cada checkout por `/tmp/lanzo-checkout`, simétricamente, incluso cuando
una traza forma parte del nombre parametrizado. No normaliza resultados, clases
de error ni diferencias funcionales. Inputs crudos, derivados y manifest se
conservan; tras comprimir, descomprimir `.json.gz` antes de reejecutar el comparador.

El conjunto amplio y global incluye Actor Runtime/Storage, M-01/F-02, Admin/Staff,
tenant/Dexie/PWA/SW, bootstrap/license/realtime/POS sync/outbox/recovery, caja,
ventas/restaurante y Ecommerce. Una suite con fallos históricos conserva ese
estado: no se declara global verde ni QA física completa.

## Qué prueban las nuevas assertions

- Scope real: registro antes de factory, carreras de quiesce, timers cancelados
  frente a disparados, jobs concurrentes, parent/child y ramas que sobreviven a
  settlement público, contexto obsoleto, rechazo tardío, cleanup/observer que
  fallan, UNKNOWN y no-settlement sin timeout de liberación.
- Auto/bootstrap/orchestrator reales, providers sintéticos: starts únicos y
  concurrentes, stop durante tenant await, reserva síncrona de ownership, rechazo
  de adopción legacy, reinicio sólo tras DRAINED, actor/tenant obsoletos, cambio de
  plan, offline/online, callbacks viejos, route/snapshot/warmup, debounce, pull,
  outbox y cola de estado. No se conectan Supabase ni negocios.
- Recovery coordinator real, actor/ledger/runner sintéticos: registration temprana,
  activeRuns compartidos sin nuevo dispatch, uninstall con run vivo, actor/tenant
  obsoletos, hijos raw registrados por contrato F01-2A, proyección/subscribers
  UNKNOWN y rechazo de fuentes de otro owner. Esos mocks no certifican por sí
  mismos los receipts o leases reales: los validan aparte las suites originales.
- Coordinator F01-1 real con LockManager determinista: B no comienza efectos del
  harness antes de que A drene y libere; UNKNOWN retiene el executor de A. No es
  una implementación comercial ni sustituye un navegador nativo.

`scope-traces.json`, `sync-traces.json`, `recovery-traces.json` contienen eventos
registrados/iniciados/settled/rejected, contexto/generación sintéticos y snapshots
finales; sync/recovery añaden llamadas y writes sintéticos. `d-matrix.json` los
vincula con las assertions, fuentes, límites y estados. Los checkpoints intermedios
pending/timer se acreditan por las assertions de cada fixture; las trazas no son
un orden total de microtasks ni una captura de producción. Instance harness usa
assertions de snapshots, sin traza universal de todas las escrituras posibles.

## Matriz D-01..60

| Caso | Estado | Evidencia / límite |
| --- | --- | --- |
| D-01 | PASS | BGX-26 SHARED-01 owner and consumer join one raw lifetime; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-02 | PASS | BGX-27 SHARED-02 two consumers share owner without additional transport; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-03 | PASS | BGX-28 SHARED-03 public owner timeout does not settle either lifetime; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-04 | PASS | BGX-29 SHARED-04 consumer quiesce never cancels shared transport; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-05 | PASS | BGX-30 SHARED-05 public deadline plus raw reject records late failure in both consumers; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-06 | PASS | BGX-31 SHARED-06 logout blocks shared old continuations; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-07 | PASS | BGX-32 SHARED-07 tenant switch blocks shared old continuations; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-08 | PASS | BGX-33 SHARED-08 late shared rejection has no unhandled promise; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-09 | PASS | BGX-34 SHARED-09 new actor cannot reuse old actor validation; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-10 | PASS | BGX-35 SHARED-10 originally unobserved owner remains conservatively UNKNOWN; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-11 | PASS | F012D actual POS coordinators with synthetic providers D-11 bootstrap initial pull stays scheduled until explicitly stopped; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-12 | PASS | F012D actual POS coordinators with synthetic providers D-12 initial pull already running remains in scope after stop; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-13 | PASS | F012D actual POS coordinators with synthetic providers D-13 scheduled outbox is cancelled without durable row writes; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-14 | PARTIAL | F012D actual POS coordinators with synthetic providers D-14 fired outbox handler remains observed through delayed settlement; Handler public settlement observed; raw/descendant lifetime remains UNKNOWN. |
| D-15 | PARTIAL | F012D actual POS coordinators with synthetic providers D-15 snapshot raw public continuation is retained and descendant UNKNOWN persists; Snapshot public continuation retained; snapshot handler descendants remain UNKNOWN. |
| D-16 | PASS | F012D local ownership and admission D-16 cancelled timer has no executor and is distinct from settlement; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-17 | PASS | F012D local ownership and admission D-17 fired timer is registered before callback and remains pending; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-18 | PASS | F012D actual POS coordinators with synthetic providers D-18 removed store listener retains in-flight reconciliation; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-19 | PASS | F012D actual POS coordinators with synthetic providers D-19 late store callback cannot reactivate a quiesced generation; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-20 | PASS | F012D actual POS coordinators with synthetic providers D-20 Realtime debounce is registered and cancelled independently; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-21 | PASS | F012D local ownership and admission D-21 public root finishes before its detached registered child; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-22 | PASS | F012D actual POS coordinators with synthetic providers D-22 late pull after stop does not publish cursor or metadata; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-23 | PASS | F012D actual POS coordinators with synthetic providers D-23 late outbox rejection observes error without stale durable retry writes; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-24 | PASS | F012D local ownership and admission D-24 concurrent jobs retain distinct ids and finish independently; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-25 | PASS | F012D actual POS coordinators with synthetic providers D-25 tenant change during pull blocks local event dispatch; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-26 | PASS | F012D actual POS coordinators with synthetic providers D-26 transport failure settles local task and retains degraded behavior; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-27 | PASS | F012D local ownership and admission D-27 rejected detached child is observed and counted after public result; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-28 | PASS | F012D local ownership and admission D-28 nonsettling executor stays pending after arbitrarily long time; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-29 | PARTIAL | F012D actual POS coordinators with synthetic providers D-29 status callback queued before stop is observed through queue settlement; Status queue registered; lower realtime reconnect/remove lifetime remains UNKNOWN. |
| D-30 | PARTIAL | F012D actual POS coordinators with synthetic providers D-30 bootstrap restart rejects old UNKNOWN snapshot owner; Unknown-owner restart rejected. Clean drained restart separately demonstrated in D-04. |
| D-31 | PASS | F012D actual recovery coordinator, synthetic financial runner D-31 actor GRANTED admits a scoped recovery before list work; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-32 | PASS | F012D actual recovery coordinator, synthetic financial runner D-32 existing activeRun is shared without extra dispatch or ownership replacement; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-33 | PASS | F012D actual recovery coordinator, synthetic financial runner D-33 online admits through owned listener and duplicate install is idempotent; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-34 | PASS | F012D actual recovery coordinator, synthetic financial runner D-34 uninstall during activeRun removes sources but retains executor; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-35 | PASS | F012D actual recovery coordinator, synthetic financial runner D-35 run registered synchronously before factory and activeRun publication; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-36 | PASS | F012D actual recovery coordinator, synthetic financial runner D-36 actor changes while list is pending: no recovery begins; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-37 | PASS | F012D actual recovery coordinator, synthetic financial runner D-37 tenant changes while list is pending: next intent remains blocked; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-38 | PASS | F012D actual recovery coordinator, synthetic financial runner D-38 receipt pending public result does not settle registered raw child; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-39 | PASS | F012D actual recovery coordinator, synthetic financial runner D-39 ambiguous remote outcome retains UNKNOWN after public recovery; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-40 | PASS | F012D actual recovery coordinator, synthetic financial runner D-40 no new recovery is dispatched after quiesce or late actor callback; Actual coordinator, synthetic actor/ledger/recovery runner. Real financial protocol separately exercised by original and F01-2A suites. |
| D-41 | PASS | F012D local ownership and admission D-41 quiesce before factory starts blocks effects; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-42 | PASS | F012D local ownership and admission D-42 quiesce during admitted callback retains real settlement; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-43 | PASS | F012D local ownership and admission D-43 rejects all external admissions after quiesce; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-44 | PASS | F012D local ownership and admission D-44 live parent registers a required continuation after quiesce; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-45 | PASS | F012D local ownership and admission D-45 UNKNOWN keeps drain unresolved without a timeout escape; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-46 | PASS | F012D local ownership and admission D-46 empty closed scope drains only after sources stop; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-47 | PASS | F012D local ownership and admission D-47 failing synchronous and asynchronous observers cannot lose tasks; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-48 | PASS | F012D actual POS coordinators with synthetic providers D-48 duplicate auto install creates one subscription and recovery source; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-49 | PASS | F012D actual POS coordinators with synthetic providers D-49 no-scope bootstrap preserves existing delayed pull and outbox behavior; Focal synthetic-provider boundary only; see assertions for pending/timers/children and rejected writes. |
| D-50 | PASS | Gate remains OFF; App/main and instance coordinator unchanged; no scope factory/QA in commercial bundles.; Exact source and bundle audit only; no physical/product E2E claim. |
| D-51 | PASS | OFFLINE-AUTH-P2: Admin offline continuity applies v2 evidence restrictions to real wrapped transport: valid; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-52 | PASS | OFFLINE-AUTH-P2: Admin offline continuity applies v2 evidence restrictions to real wrapped transport: expired; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-53 | PASS | OFFLINE-AUTH-P2: Admin offline continuity applies v2 evidence restrictions to real wrapped transport: staff; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-54 | PASS | M-01 durable notification boundary (real bridge/runtime; synthetic authorization) StorageEvent: historical, duplicated and reordered hints preserve the exact grant; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-55 | PASS | F-02 resume events and policy boundaries EXP-F02-05 / 168h: uses the existing shortest deadline without renewal; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-56 | PASS | posSyncClient tenant isolation rejects before reading credentials or issuing an RPC on mismatch; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-57 | PASS | inventoryEntryService FREE/local authority applies and deduplicates a STRICT FREE inventory entry without actor-bound outbox; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-58 | PASS | Financial durable source blobs unchanged except explicitly authorized recovery coordinator; idempotency/receipt/ledger contracts preserved.; Exact source and bundle audit only; no physical/product E2E claim. |
| D-59 | PASS | EcommercePortalCustomizationPanel image intents does not expose upload controls on Free; Policy/preservation regression evidence; does not certify a live operation or a scoped commercial flow. |
| D-60 | PASS | F012D synthetic instance boundary D-60 secondary harness starts zero writes until owner scope drains and releases; Deterministic LockManager substitute and actual F01-1 coordinator. Native Chromium NOT_EXECUTED. |


Las filas PARTIAL conservan el límite probado: cancelar timer no prueba un RPC
terminado; esperar handler público no prueba sus hijos; cola de status observada
no certifica removeChannel/reconnect interno. D-60 prueba sólo el harness
sintético. D-51..59 no inventan un scope comercial: son las políticas originales
sin scope y la auditoría exacta de fuentes/bundles.

## Chromium y QA física

`chromium.json`: **NOT_EXECUTED**, launch real falla porque no existe
`/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.
No se descarga. Se incluye runner para dos documentos del mismo origen/contexto,
locks nativos y scope real: timer, pull/outbox/recovery sintéticos, callback tardío,
no-settlement, cambio de tenant y cierre abrupto. Ninguno se presenta como ejecutado
con binario ausente. Pruebas anteriores de F01-1/F01-2A no cuentan como Chromium
actual. Chrome/Edge Windows, PWA Windows/Android, suspensión/BFCache/hibernación y
LAN/HTTPS físicos permanecen OWNER_QA_REQUIRED.

## Conservación y bundles

Auditoría de 2.060 archivos preexistentes de producto/config: **2.056 idénticos,
cuatro fuentes autorizadas modificadas**. Más un scope nuevo. App/main, Actor
Runtime/Storage, M-01/F-02, tenant, contratos financieros durables, seis callsites
reservados de caja, license sync/security realtime, Ecommerce FREE, SW/SQL,
workflows y dependencias conservan blobs. ESLint focal y diff-check PASS.

Los cuatro builds definitivos de cada checkout pasan. Precache sin faltantes y
cero marcadores QA/coordinador/scope factory nuevo en bundles comerciales. La
infraestructura optativa de los coordinadores sí se compila en el POS, pero no
crea scopes ni activa gate. `coreLocalRouteAssets=[]` del auditor no demuestra
arranque offline frío de todas las rutas.

`bundle-comparison.json`: Admin JS/CSS/HTML/JSON pasa de 5.225.936 a 5.233.127 bytes
(+7.191); gzip conjunto por archivo, 1.407.184 a 1.409.724 (+2.540). Store y Store
Vercel conservan las métricas de 708.010 bytes / 204.899 gzip cada uno. Tamaños
agregados no sustituyen equivalencia de comportamiento; las fuentes públicas
están preservadas. Artefactos de ambos builds son locales, no una certificación
de los assets servidos en producción.

## Intentos conservados y correcciones de la fase

- `initial-legacy`: coordinadores originales focales pasan antes de ampliar QA.
- `scope-initial`: scope inicial 20/20. Después se añade la cobertura que conserva
  el token de una rama con raw pendiente tras su respuesta pública.
- `sync-initial`: fixture olvidó declarar jsdom, 29 fallos de harness por window
  ausente. Se añade el pragma del entorno; no se cambian assertions comerciales.
- `sync-second`: 24 PASS/5 FAIL. Un test esperaba rechazo async donde la reserva
  rechaza síncronamente; cuatro fixtures omitían reason=initial_bootstrap y por
  eso ejecutaban pull/outbox inmediatos además del timer, o quedaban esperando
  el pull antes de llegar al escenario. Se corrigen los inputs y la expectativa
  de error; la ruta default y las assertions originales no se alteran.
- Revisión posterior agrega preflight completo, reserva síncrona entre bootstrap
  y orchestrator, rechazo de owner legacy aunque stop ya terminó, UNKNOWN de
  proyección y tokens vivos hasta terminar descendientes registrados. Sus pruebas
  nuevas pasan; las fuentes finales se congelan en otro checkout antes de validar.
- `before-reservation/validation` preserva una ejecución intermedia **no aceptada**:
  5.930 PASS / 89 FAIL / 52 SKIP. Se cambiaron fuentes durante esa ejecución;
  un test recién añadido vio un coordinator previamente cacheado sin la nueva
  marca de proyección. No se atribuye al baseline ni se usa como certificación.
  `sources.json.gz` conserva el checkpoint anterior; VALIDATION_STATUS explica
  el alcance. La repetición definitiva inmutable es la autoridad de la tabla.
- El primer auditor de conservación en el checkout limpio no pudo escribir su
  resultado porque aún no existía la carpeta de evidencia. Se añadió mkdir al
  helper y se repitió el auditor: producto/assertions intactos.
- ESLint de entrega pidió const en un binding del fixture de observer reentrante.
  Se corrigió sólo esa declaración y se repitieron lint y las 69 assertions focales.
  Ninguna fuente de producto ni assertion cambió después de la global definitiva.
- Advertencia preexistente de baseline-browser-mapping conservada. No se actualizan
  paquetes para eliminarla. No hubo cambio de comparador ni fallo exclusivo
  ocultado; todos los intentos relevantes siguen separados del resultado final.

Las suites antiguas pueden regenerar sus trazas históricas. Las versiones nuevas
se guardan bajo `generated-legacy-traces`, y sólo esos paths de evidencia originales
se restauran a sus blobs antes de commit. Logs/JSON grandes se comprimen con gzip
sin pérdida. El manifiesto `artifact-hashes.json` cubre fuentes nuevas/modificadas,
QA, informes y evidencia, excluido sí mismo; no contiene credenciales.

## CI y dictamen

GitHub Actions y statuses Vercel se consultan sobre el SHA exacto publicado. El
conector de runs filtra eventos pull_request y primera página: cero resultados
no acredita todos los eventos ni SUCCESS. Por base apilada y filtros se informa
NOT_TRIGGERED cuando corresponde, sin retarget. Los estados y enlaces definitivos
se registran en el PR después de publicar; al escribir estos informes aún no hay
un SHA de publicación al cual atribuirlos. Preview SUCCESS/READY no prueba drain,
autoridad financiera, gate ni QA del POS real.

UNKNOWN críticos restantes: handlers/event subscribers de sync y snapshots,
realtime interno, proyección financiera, owners previamente no observados,
license interval/check/security callbacks y preparación Admin/offline amplia.
No se retira el UNKNOWN del lifecycle bootstrap anterior. Tampoco se conectan
los lifecycles entre sí ni al lock comercial. D1 revisable; D2/D3 parciales;
**SYNC_LIFETIME_PARTIAL / HOLD_SYNC_LIFETIME**. No integrar gate/caja/inventario
como si estuvieran certificados. Propuesta mínima siguiente en el informe principal.

Main/#372 SIN CAMBIOS; Supabase project calls/production writes NONE; migraciones
NONE; operaciones financieras reales NONE; licencias/dispositivos/Google Drive
real SIN CAMBIOS; producción NOT DEPLOYED; merge NOT PERFORMED.
