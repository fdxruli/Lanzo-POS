# LANZO POS — F01-2D.1 — EVIDENCE R1

Fecha: 25 de octubre de 2026, America/Mexico_City.

**POS_SYNC_BOUNDARIES_PARTIAL / HOLD_POS_SYNC_BOUNDARIES.** La evidencia de
Realtime/cleanup y del fan-out local no acredita el drenaje integral de handlers,
suscriptores, licencia o preparación. F01-2D/D3 permanece parcial; gate OFF,
LC13 OPEN. Informe de contratos: `LANZO.F01.F012D1.POS.SYNC.CLOSURE.R1.md`.

## Identidad y fuentes

Baseline exacto #373: `0f1625f46e6fe234e378487bb06f74f4bd1555e9`.
Main: `52bb573e651529b323b6617e3161cd76ece14a39`.
#372/base: `f1d69093ffe3ad180752773c178b7fbaefd92ce1`.
Rama/base de #373 preservadas; OPEN/Draft, sin merge. HEAD final exacto y estado
remoto en el cuerpo del PR/entrega; no se inventa un hash autorreferente.
Preflight y solapamiento #371: `evidence/remote-preflight.json`.

Fuentes de producto congeladas mediante `frozen-sources.sha256`, cotejadas en el
checkout de trabajo y el checkout limpio de validación. Cinco archivos comerciales
preexistentes cambian, un productor nuevo se añade. Manifest/lock/configuración
Vite se incluyen en los hashes y permanecen iguales. Las correcciones finales de
reinicio de listener y respuesta desconocida de cleanup se volvieron a congelar
antes del run final de la candidata limpia; `attempts/initial-frozen-sources.sha256` conserva el checkpoint
anterior. Cambios documentales y runners no se hacen pasar por cambios de producto.

Dependencias compartidas del mismo lockfile: Node 24.22.1, Vitest 4.0.14, Vite
7.2.2, Dexie 4.4.3, supabase-js/realtime-js 2.87.1. `npm ci --ignore-scripts` no
cambió package.json/package-lock.json. Sin Docker ni proyectos Supabase.

## Pruebas nuevas

**36/36 assertions focales PASS**, incluidas después en la global. No se suman
otra vez como pruebas únicas. Los providers de RPC/transporte/respuesta se
controlan; el código cuyo contrato se evalúa es real.

| Archivo | Assertions | Alcance |
| --- | ---: | --- |
| realtime.test.js | 21 | posRealtime y productor/scope reales; sólo transporte/timers controlados; no navegador nativo |
| outbox.test.js | 5 | Orchestrator, productor Realtime, outbox/meta y Dexie reales; transporte y tenant guard controlados; handler sintético conserva UNKNOWN |
| handlers.test.js | 8 | Crédito, customer migration, sales shadow, mappers y repositorios locales/Dexie reales; RPC y retraso/fallo de una rama controlados |
| subscribers.test.jsx | 1 | Proyección real de cancelación, transacción Dexie y hook useCaja real; repositorio de lectura controlado. Contraejemplo, no cierre funcional |
| registry.test.js | 1 | Importación fría real del root auto-bootstrap; registro/keys reales, sin start, App ni RPC |

`focal.json`, `focal.log` y la selección de nuevas assertions en `candidate/global.json`
conservan resultados. `realtime-final.json` es una repetición solapada de 21 tests
tras la guarda de reinicio y el resultado desconocido de cleanup; no son 21 adicionales. Los errores esperados de las
inyecciones de fallo aparecen en logs sin convertirse en éxito comercial.

## Matriz del encargo

| Escenario | Evidencia / alcance final |
| --- | --- |
| 1. Registro anterior a efecto | Realtime register-before-connect, cleanup antes de factory; D-01/D-41 históricos reejecutados |
| 2. Quiesce antes de factory | Canal no se crea; root/cleanup quedan contabilizados |
| 3. Quiesce durante RPC/local | Outbox real con resultado pendiente; crédito con escritura Dexie retenida |
| 4. Resultado público con raw pendiente | Handle Realtime devuelto antes de conectar; stop público separado de limpieza/raw; scope D-21 conserva hijos |
| 5. Rechazo tardío | Retirada de canal y segunda proyección local observadas; primer error temporal se conserva |
| 6. Nunca termina | Retirada y proyección local no permiten drain por tiempo |
| 7. Timer cancelado vs disparado | Reconexión cancelada/no canal nuevo; reconexión ya disparada registrada; scope D-16/17 |
| 8. Listener retirado con callback iniciado | Online y broadcast async reales del productor permanecen observados |
| 9. Evento con consumidor async | COUNTEREXAMPLE real cancelación→useCaja: trabajo después de quiesce; UNKNOWN obligatorio |
| 10. Actor/sesión/tenant cambian | Predicado original capturado se invalida antes del callback. Políticas reales en regresión; handlers completos siguen PARTIAL |
| 11. Respuesta vieja/publicación | Orchestrator D-07/22/25 y callbacks viejos reejecutados. No certifica todos los caches/providers anidados: PARTIAL |
| 12. Outbox antes de quiesce | Fila real processing y root retenido hasta resultado/rechazo tardío |
| 13. Durables sin reenvío | K/hash/attempts/processing se conservan; pending sin ejecutor no es trabajo local vivo |
| 14. Snapshot ventas/shadow | Handler, retry y escrituras locales reales; snapshot espera shadow. Descendientes/contexto completo PARTIAL |
| 15. Migraciones clientes/crédito | Migración real y marcadores en Dexie sintética; no se amplía política. Contexto integral PARTIAL |
| 16. Stop conectando/reconectando | Canal en conexión retirado; reconnect pendiente/callback disparado cercados |
| 17. Canal antiguo tras stop | SUBSCRIBED/CLOSED/ERROR/broadcast capturados no disparan trabajo nuevo |
| 18. Stop/cleanup duplicados | Una retirada, promesa single-flight; reentrancia no duplica cleanup |
| 19. Generación nueva tras drain | Nuevo productor admitido sólo tras cerrar/dranar anterior; misma generación detenida/topic distinto rechaza |
| 20. Reemplazo owner activo/UNKNOWN | Rechazado; tampoco adopta legacy después de stop |
| 21. Sin scope | Cuerpo de inicio legacy idéntico; tests de payload/topic/stop y D-49 reejecutados |
| 22. Provider desconocido | WeakMap privada rechaza objeto copiado/flag; D-29 original mantiene UNKNOWN para sustituto |
| 23. Ausencia de ciclo de espera | Actual orchestrator→stop de productor→raw cleanup drena sin esperar su propio drain; allSettled retiene siblings |

La guarda inyectada en pruebas de contexto es sintética; no acredita por sí sola
autorización real Admin/Staff. Las suites de Runtime/Storage/tenant/168h/M-01/F-02
se ejecutan aparte en la regresión/global. No hay operaciones financieras reales.

## D-14 / D-15 / D-29 / D-30

Se conservan las assertions originales y sus significados, incluidas las marcas
para providers sustituidos. Sus 69 tests F01-2D se vuelven a ejecutar en la global.

- D-14 continúa PARTIAL: public settlement y fila durable reales observados,
  contrato completo del handler no certificado.
- D-15 continúa PARTIAL: shadow/migraciones son trabajo real del snapshot; no
  existe cierre probado de todos sus hijos/contexto.
- D-29 tiene cierre local del **productor real** en nueva prueba con Realtime y
  cola meta reales. Su test original con sustituto continúa UNKNOWN/PARTIAL.
- D-30 continúa PARTIAL para bootstrap/grafo completo. La nueva generación del
  productor limpio funciona; un snapshot con UNKNOWN sigue impidiendo reemplazo.

PASS de un test que exige UNKNOWN o reproduce una ejecución indebida no es PASS
de cierre funcional. `inventory.json` mantiene clasificaciones y límites por fila.

## Regresión diferencial y builds

| Árbol global | PASS | FAIL | SKIP | Total |
| --- | ---: | ---: | ---: | ---: |
| Main actual | 5,665 | 88 | 52 | 5,805 |
| HEAD inicial exacto de #373 | 5,933 | 88 | 52 | 6,073 |
| Candidata final | 5,969 | 88 | 52 | 6,109 |

**Cero resultados históricos cambiados** por archivo/test/status/firma en ambos
pares. Frente al HEAD inicial se añaden **36 PASS**; frente a main, el conjunto
acumulado de #373 añade **304 PASS**, sin nuevos fallos ni omisiones.

Selección amplia: base y candidata **1,167 PASS / mismos 4 FAIL / 50 SKIP / 1,221**.
Main **1,122 PASS / mismos 4 FAIL / 50 SKIP / 1,176**; los 45 PASS adicionales
pertenecen al coordinador F01-1 ya incluido. No se suman de nuevo a la global.

**PR127 original local: OK en ambos pares**, 104 fallos compartidos, 0 exclusivos,
0 nuevos, 0 resueltos y 0 sin resolver; targets vacíos. Sus unidades incluyen
fallos de archivo y no equivalen a las 88 assertions fallidas. No se modificó el
comparador original ni se ocultó un fallo histórico.

**Production / Preview real VERCEL_ENV=preview / Store / Store Vercel: PASS en los
tres árboles** (12 builds definitivos, separados de intentos anteriores). Precache:
24 assets iniciales Production / 32 Preview, cero faltantes y cero fixtures nuevos.
`coreLocalRouteAssets=[]` es literal del auditor, no QA offline fría integral.

Fuentes y QA ejecutables finales idénticos al commit de código
`1bd74b26e0b53ccbe00f335964978a5ac1f9700b`; candidata evaluada en un checkout final
limpio. `differential.json`, `comparison.log`, `pr127-base/final.json`,
`pr127-main/final.json`, los JSON/logs brutos de cada árbol y
`final-validation.json` preservan resultados y comandos. Los runs brutos globales
siguen con exit 1 por los fallos históricos; el PASS pertenece al diferencial.

Se usan los mismos comandos Vitest, configuración y dependencias en cada par;
fuentes de producto inmutables durante los runs aceptados. Se comparan candidata
contra el HEAD inicial exacto y contra main actual. La selección amplia incluye
F01-1, Actor Runtime/Scoped Storage, tenant/DB/Dexie, Admin/Staff, M-01/F-02,
bootstrap/PWA, recovery financiero/intents/proyección, outbox, caja, ventas,
inventario y restaurante. Global incluye además Ecommerce/Store y todos los
laboratorios heredados pertinentes. Grupos solapados no se suman otra vez.

Los 88 fallos históricos globales y cuatro split-close de la selección amplia
no se declaran verdes. El comparador exige archivo/test/status/primera firma de
error sin cambios y conserva errores completos; se normalizan simétricamente
sólo prefijos absolutos de checkout/instalación compartida. `normalization.json`
registra cada reemplazo. PR127 original se ejecuta sin editar assertions,
thresholds ni comparador. CI remoto se informa separado de este gate local.

## Intentos y límites de la evidencia

Se conserva `attempts/candidate-initial`: el primer workspace reutilizado produjo
dos assets PosApplicationBootstrap en dist; el postbuild lo rechazó y la auditoría
de tamaño de precache falló. Apareció además un fallo frío de importación que se
investiga/revalida con la misma prueba. Ese run no acredita una candidata verde. La candidata intermedia anterior al
endurecimiento de cleanup se conserva en `attempts/pre-cleanup-result-candidate`;
su global de 35 pruebas nuevas no certifica el código final, que tiene 36.
La repetición aceptada se realiza en otro checkout con los hashes de fuente
idénticos, sin tocar reglas de precache ni la prueba.

La primera auditoría adicional buscó `unknown_critical_work` como si fuera un
marcador exclusivo del scope nuevo. Identificó dos bundles, pero ambas coincidencias
pertenecen al `bootstrapLifecycle` preexistente, cuyo blob permanece idéntico.
Se conserva `attempts/audit-generic-marker.log`; el auditor utiliza después el
sentinel exclusivo `SYNC_EXECUTION_QUIESCE_REQUIRED` y los marcadores QA/lock. No
se cambian tests de producto, presupuestos de precache ni el comparador PR127.

El primer wrapper intentado desde main buscó los scripts F01 mediante rutas
relativas que allí no existen; no cuenta como ejecución. `validate.mjs` resuelve
el runner común por ruta absoluta y mantiene comandos/config desde el cwd que
evalúa. La validación final ejecuta los árboles por separado, con dos workers
Vitest por run. Se registran exit codes reales, incluso cuando son históricos.

Un intento de inventariar imports empezando por el orchestrator aislado expuso
un ciclo existente (`registerEntitySyncHandler` antes de inicializar). Se conserva
en `attempts/registry-import-order.log`. El root auto-bootstrap real se probó
después sin activar servicios y produjo el inventario válido; no se cambió el
producto para hacer pasar ese harness. La prueba de registro por logs queda
limitada al root y orden expresamente ensayados.

## Navegador nativo

**Chromium NOT_EXECUTED.** El runtime tiene Playwright, pero no el ejecutable
requerido. Se intentó instalar Chromium y headless shell compatibles; las descargas
fallaron (archivo incompleto/no ZIP válido). `chromium.json` conserva la causa
actual de launch por binario ausente. No se desactiva sandbox/seguridad del
navegador ni se sustituye este resultado con LockManager sintético.

`browser.mjs` queda reproducible: productor/scope reales servidos por HTTP local,
transporte externo controlado y dos documentos del mismo origen usando Web Locks
nativos. Comprueba canal conectando, callback antiguo y retirada que no termina;
no abre App ni proyectos Supabase. No hay QA nativa/física de esta fase, ni se
reutiliza como nueva evidencia Chromium de F01-1/F01-2A. Windows/Android/PWA,
BFCache/hibernación y LAN/HTTPS física siguen pendientes.

## Integridad, publicación y seguridad

Auditoría final: **2,062 archivos preexistentes de producto/config; 2,057 idénticos y exactamente cinco fuentes autorizadas modificadas**, más el productor nuevo. Los 15 archivos ejecutables de código/QA del commit `1bd74b26e0b53ccbe00f335964978a5ac1f9700b` tienen SHA-256 idénticos en el checkout final de validación (`tested-code-manifest.json`). El cuerpo de inicio legacy conserva sus bytes; 45 assets JS/HTML/JSON inspeccionados y **0 violaciones** de fixtures/lock/scope factory nuevo. Código opcional del productor sí es alcanzable, pero no construye scopes ni activa el gate. `audit.json` y `frozen-sources.sha256` preservan el alcance exacto. Lint focal exit 0 y diff-check PASS; aviso preexistente baseline-browser-mapping conservado.

El estado remoto del **HEAD final publicado**, sus Actions/check-runs y la Preview
se registran después del push en la descripción del [PR #373](https://github.com/fdxruli/Lanzo-POS/pull/373)
y en la entrega de esta intervención, con SHA/URL exactos. Ese registro se actualiza
sin crear un nuevo HEAD documental que invalide la referencia consultada. No se
atribuye al HEAD nuevo un check de otro commit o de fases anteriores.

El push nativo no encontró credenciales de escritura. Se publica por Git Data
API, comprobando que el árbol de código remoto es idéntico al checkpoint local
`51158e00cec0c83e3e0c1600b6e3f50b672a6ed4` (tree `8618a6ce3083da5f3a4880a0e8debe0e6d41417b`). Los SHA de commit difieren por autoría/fecha del conector; los bytes de producto y QA no cambian.
Sólo se publica en la rama existente mediante avance fast-forward y comprobación
del HEAD remoto. Base/Draft se preservan. Si Actions no se dispara se informa
NOT_TRIGGERED; Vercel se informa separado, sin deducir CI ni QA a partir de READY.
No se retargetea el PR ni se modifican workflows para dispararlos.

No se consulta ni escribe ningún proyecto Supabase. La documentación pública del
SDK se consultó, y se inspeccionó su código instalado. SQL/migraciones/Edge
Functions/deploy Production/merge: NONE. Pruebas de migración inicial son rutas
locales existentes con registros sintéticos, no migraciones de esquema remotas.
Sin licencias/dispositivos/Google Drive real ni datos del propietario.

## Reproducción

Desde cada checkout y con dependencias idénticas; usar ruta absoluta del runner
candidato al evaluar main (no contiene los scripts F01):

```sh
node /ruta/candidata/scripts/qa/single-instance-f012d1/validate.mjs /ruta/evidence/base --build
node /ruta/candidata/scripts/qa/single-instance-f012d1/validate.mjs /ruta/evidence/main --build
node /ruta/candidata/scripts/qa/single-instance-f012d1/validate.mjs /ruta/evidence/candidate --build
node node_modules/vitest/vitest.mjs run scripts/qa/single-instance-f012d1 --maxWorkers=1 --reporter=json --outputFile=/ruta/evidence/focal.json
node scripts/qa/single-instance-f012d1/compare.mjs /ruta/evidence
node scripts/qa/single-instance-f012d1/audit.mjs /ruta/evidence
node scripts/qa/single-instance-f012d1/browser.mjs /ruta/evidence
sha256sum -c scripts/qa/single-instance-f012d1/evidence/frozen-sources.sha256
git diff --check
```

Los JSON/logs grandes se guardan con gzip sin pérdida; descomprimir antes de
comparar. `artifact-hashes.json` registra sus hashes excluyendo su propio archivo.
Las trazas regeneradas por laboratorios previos se conservan en la carpeta nueva;
no se sobrescribe evidencia histórica. Rollback focal sin borrar datos descrito
en el informe principal.

```
MERGE: NOT_PERFORMED
COMMERCIAL_GATE: OFF
PRODUCTION_DEPLOY: NOT_PERFORMED
SUPABASE_PROJECT_CALLS: NONE
MIGRATIONS: NONE
LC13: OPEN
```
