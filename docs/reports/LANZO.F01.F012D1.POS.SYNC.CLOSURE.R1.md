# LANZO POS — F01-2D.1 — POS SYNC BOUNDARIES R1

Fecha: 25 de octubre de 2026, America/Mexico_City.

**POS_SYNC_BOUNDARIES_PARTIAL / HOLD_POS_SYNC_BOUNDARIES.** Se corrigen el
productor Realtime opcional, la terminación de proyecciones locales concurrentes
de crédito y dos ventanas de admisión. Los handlers completos y sus consumidores
compartidos conservan UNKNOWN. **F01-2D no está completa; D3/licencia/preparación
siguen abiertas. El gate comercial continúa OFF y LC13 OPEN.**

## Identidad y autorización

Sólo `fdxruli/Lanzo-POS`, PR #373, rama `feat/f01-early-admission-recovery-r1`.
Se conserva la base `feat/f01-single-instance-coordinator-r1`, OPEN / Draft /
NOT MERGED. No se retargetea, hace force push, modifica #372 ni incorpora #371.

| Referencia | SHA de preflight / baseline |
| --- | --- |
| Main | `52bb573e651529b323b6617e3161cd76ece14a39` |
| #372 / base | `f1d69093ffe3ad180752773c178b7fbaefd92ce1` |
| #373 inicial exacto | `0f1625f46e6fe234e378487bb06f74f4bd1555e9` |
| #371 | `2f33cea480f3d478f797b495b168feac9aed483f` |
| #373 final | Commit que contiene esta entrega; SHA exacto, estado remoto y Preview en el PR y entrega final, sin hash autorreferente |

El HEAD inicial coincidía con el encargo. Checkout nuevo, sin cambios ajenos ni
AGENTS.md aplicable. Se consultaron los informes de implementación/evidencia
F01-1/2/A/B/C/D y el laboratorio D, priorizando sus límites D-14/15/29/30. No se
cuentan sus resultados antiguos como ejecuciones de esta fase. Node 24.22.1;
dependencias instaladas mediante `npm ci --ignore-scripts` desde el lockfile
existente, sin cambios a manifest/lockfile ni Docker.

## Cambios y contratos acreditados

| Archivo de producto | Cambio |
| --- | --- |
| `src/services/sync/scopedPosRealtimeListener.js` | Productor optativo nuevo, callbacks/fuentes y retirada observados |
| `src/services/posRealtime.js` | Selección optativa, protección de owner/legacy y reinicio explícito |
| `src/services/sync/syncExecutionScope.js` | Stop single-flight de una fuente previamente registrada |
| `src/services/sync/posSyncOrchestrator.js` | Propaga scope a Realtime, devuelve promesas de callbacks y cerca outbox tras markProcessing |
| `src/services/sync/posSyncBootstrapCoordinator.js` | Comprueba admisión después del await de tenant |
| `src/services/customerCredit/customerCreditSyncHandler.js` | Espera todas las proyecciones locales iniciadas antes de resolver/rechazar |

### Productor POS Realtime

`src/services/sync/scopedPosRealtimeListener.js` implementa únicamente la ruta
opcional. `posRealtime.js` conserva el cuerpo de inicio legacy y su scheduling;
sin `executionScope` mantiene esa ruta. No construye un scope por sí mismo.

El nuevo productor reserva su fuente y registra connect antes de crear el canal.
Captura scope/contexto original y la identidad de cada canal. Broadcast/status,
listener online y reconexión vuelven a comprobar admisión, contexto y canal. Las
reconexiones no adelantan una retirada pendiente. El handle puede devolverse antes
de terminar connect, pero connect permanece en el registro.

El callback de estado, broadcast o restored registra su factory antes del primer
efecto. El orchestrator devuelve sus promesas al productor; así, quitar listeners
no pierde callbacks ya iniciados. Los hijos del orchestrator conservan a su vez
sus contratos y UNKNOWN propios: esta corrección no vuelve completos los handlers.

Stop cerca síncronamente el productor, cancela timers pendientes y retira online;
los callbacks viejos no crean trabajo. La limpieza registrada espera todos los
canales en conexión/retirada, una vez por canal, incluso si otra retirada falla.
Rechazo/error de limpieza mantiene UNKNOWN; una promesa que nunca termina retiene
drain sin timeout. Los timers internos de la conexión compartida no se adoptan:
se demuestra el cercado de sus salidas relevantes, no cierre global del SDK.

Una WeakMap privada acredita handles de esta implementación. Una etiqueta de
versión, un objeto copiado, null o un proveedor sustituido no la satisfacen; en
esos casos sigue `pos_realtime_internal_reconnect_lifetime`. Se evita emitir esa
marca sólo para futuras ejecuciones que usan el productor real auditado. Ningún
UNKNOWN previo se borra, reinicia o retira.

No se sustituye un propietario activo/UNKNOWN ni se adopta retrospectivamente una
ejecución legacy. Una generación nueva funciona después del drenaje de la anterior.
Reutilizar un listener detenido o cambiarle el topic con el mismo scope se rechaza
explícitamente con `POS_REALTIME_GENERATION_RESTART_REQUIRED`: no devuelve un handle
inerte como si hubiera reiniciado. La política no cambia topics/capacidades.

`removeChannel` se inspeccionó en la versión instalada: espera unsubscribe; sus
rutas ok/timeout ejecutan el cierre local del canal. Un timeout de unsubscribe no
es confirmación del servidor. Un resultado error, desconocido (también undefined) o un rechazo es UNKNOWN. Los
callbacks quedan cercados aunque el transporte siga pendiente. No se desconecta
el cliente compartido ni se altera autenticación de otros servicios.

### Limpieza registrada de fuentes

`syncExecutionScope.addSource` sigue devolviendo la función de baja existente y
añade `.stop()` para la limpieza de **esa fuente previamente registrada**. Reserva
la promesa antes de invocar la factory, admite limpieza tras pérdida de contexto
sin conceder autoridad comercial y es single-flight, incluso ante quiesce
reentrante. `quiesce` usa esa misma ruta. No permite factories comerciales nuevas
ni llama a drain desde el cleanup; la retirada Realtime no espera al orchestrator.

### Proyecciones locales de crédito

`applyCreditPayload` usaba `Promise.all`: un rechazo permitía terminar el handler
mientras seguían escribiendo clientes, ledgers, movimientos o sesiones. Ahora
espera todos los trabajos locales iniciados con `allSettled`. Conserva el primer
rechazo **en el tiempo**, el orden de inicio y el conteo de éxito; observa rechazos
tardíos. No cancela, revierte ni reintenta operaciones para conseguir drain.

La prueba usa los handlers, migración, mappers, repositorios locales y Dexie reales
sobre fake-indexeddb; sólo se controla RPC y el retraso/fallo de una rama. En éxito
se notifica después de las escrituras; en fallo no se notifican cambios como éxito.
Una rama que nunca termina mantiene pendiente el handler. Esto cierra ese fan-out,
no la totalidad del handler de crédito ni su autorización anidada.

Efecto observable también sin scope: el rechazo de crédito espera ahora a las
otras escrituras locales ya iniciadas. Conserva el mismo error/resultado y no
cambia retry ni datos financieros, pero puede tardar más; si una escritura nunca
termina, el handler sigue pendiente. Ese límite es explícito y se prueba, sin
introducir un timeout que finja terminación.

### Admisión de snapshots y outbox

Después del await del guard de tenant, un snapshot diferido comprueba también
admisión antes de marcar UNKNOWN/invocar el provider. Si quiesce llegó durante
`markProcessing`, outbox no entra al handler ni convierte ese rechazo local en un
retry comercial. La fila processing se conserva para el mecanismo existente de
recuperación; no se altera K/hash/origen, attempts ni orden durable.

## Grafo real e inventario finito

El inventario detallado contiene 24 filas en
`scripts/qa/single-instance-f012d1/evidence/inventory.json`: productor, trigger,
owner/contexto, efectos, resultado público/raw, hijos, scheduling, cleanup,
quiesce, clasificación anterior/final y evidencia. No es inventario financiero
completo/paginado por tenant. No exige vaciar filas durables para drenar ejecución.

La importación fría real de `posSyncBootstrapAutoCoordinator`, sin start/App/QA
comercial, produjo 17 registros, 16 entidades y seis implementaciones. La secuencia
está en `registrations.json`; se correlacionaron los logs del registro real con
los grupos síncronos de cada módulo y se cotejaron las keys del registry real.

| Implementación efectiva en ese root | Entidades |
| --- | --- |
| cashSyncHandler | cash_session, cash_movement |
| productSyncHandler | category, product, product_batch, inventory_entry |
| customerSyncHandler | customer |
| customerCreditSyncHandler | customer_ledger, customer_credit |
| salesCloudSyncHandler | sale, sale_item, sale_payment, sale_cancellation, inventory_movement |
| restaurantOrdersSyncHandler | restaurant_order, restaurant_order_item |

Productos también registra `inventory_movement`, pero ventas lo sobrescribe en
ese orden de importación. El Map permite sobrescritura; no se presupone un orden
universal entre otros roots/registro futuro ni se cambia la política del registry.
Un primer harness que importaba el orchestrator antes del root comercial expuso
un ciclo de importación existente. Se conserva como intento, no como prueba del
orden comercial ni como regresión corregida en esta fase.

| Frontera | Clasificación final |
| --- | --- |
| Connect/callbacks/retirada del productor Realtime auditado | OBSERVED_CRITICAL_WORK |
| Reconexiones, online y callbacks de canales antiguos | FENCED_SOURCE_OR_CONTINUATION |
| Fuente/cleanup manual y fan-out local de crédito | OBSERVED_CRITICAL_WORK |
| Ejecución outbox local | OBSERVED_CRITICAL_WORK, con UNKNOWN de handler cuando aplica |
| Filas pending sin executor, rama de snapshot reports que sólo devuelve skip | NOT_CRITICAL_FOR_THIS_DRAIN; no certifica consumidores de reports |
| Realtime sustituido sin contrato; handlers completos, snapshots anidados y consumidores compartidos | CRITICAL_UNKNOWN |

## HOLD concreto: consumidores compartidos y contexto anidado

No se retiran las marcas `pos_handler_lifetime:*`, `snapshot_handler_lifetime:*`
ni `financial_projection_subscriber_lifetime`.

1. **Contraejemplo con consumidor real:** la proyección real de cancelación
   completa su transacción Dexie y despacha el evento. El hook real `useCaja`
   deja un timer de refresco pendiente. Después de terminar la raíz y hacer
   quiesce, ese timer inicia otra lectura. Quitar el UNKNOWN permitiría declarar
   DRAINED antes de iniciar el trabajo real del consumidor. `subscribers.test.jsx`
   es PASS de reproducción del contraejemplo, no PASS de cierre funcional.
2. Productos emite también ticker y BroadcastChannel. Sus consumidores incluyen
   hidratación de stores, alertas operativas con persistencia y publicación del
   catálogo Ecommerce; el scheduler de publicación es compartido con triggers
   online/manual/visibility y tiene retry/debounce propios. Una notificación DOM
   no reserva ese productor ni permite adoptar trabajo que ya existía. Quitar
   listeners no termina una publicación iniciada. Es una frontera crítica concreta,
   no «sólo UI». No se transforma todo DOM en otro bus ni se reescribe Ecommerce.
3. Dashboard/CustomersPage disparan loaders sin devolver su completion al emisor.
   KDS agenda 700 ms de debounce y tiene polling/online/visibility independientes.
   No existe un contrato común de owner original, continuaciones y cleanup para
   afirmar que todos sus efectos cesan al quiesce del emisor.
4. El snapshot real de ventas espera `retryPendingShadowSales`, que puede mutar
   shadow/local/outbox; clientes/crédito pueden ejecutar sus migraciones. Las
   pruebas verifican esas rutas reales y sus awaits, pero no certifican toda la
   propagación actor/sesión/tenant hasta providers y consumidores. CloudRequestManager
   espera su pipeline propio, pero cache/dedupe compartidos no acreditan por sí
   solos propiedad de la generación de POS Sync.

La corrección independiente segura termina en las fronteras acreditadas. Para
retirar el HOLD hace falta un contrato explícito en esos productores/consumidores
compartidos, reservado antes de sus efectos y con contexto original comprobado;
envolver de nuevo el emisor no lo resuelve. No se demuestra imposibilidad del
proyecto ni necesidad de Authority v2. Tampoco se declara que esa integración más
amplia esté implementada. D3/licencia/preparación conserva sus HOLD anteriores.

## D-14 / D-15 / D-29 / D-30

| Caso original | Reevaluación |
| --- | --- |
| D-14 | PARTIAL. Outbox real/Dexie conserva execution viva, fila processing e identidad ante resultado/rechazo tardío; raw/consumidores del handler completo siguen UNKNOWN. |
| D-15 | PARTIAL. Snapshot de ventas con shadow y migraciones iniciales se ejercitan con providers reales locales; los descendientes/contexto completo no están cerrados. |
| D-29 | Frontera del productor real cerrada en laboratorio local: status pendiente y retirada se drenan sin UNKNOWN Realtime. El caso original con proveedor sustituido sigue UNKNOWN/PARTIAL, como corresponde. No certifica navegador/servidor. |
| D-30 | PARTIAL para el grafo comercial. Se rechaza reemplazar owner UNKNOWN; generación limpia nueva del productor funciona tras drain y callbacks antiguos quedan cercados. Un snapshot real no acreditado sigue impidiendo reinicio global. |

No se modifica el significado ni las assertions históricas para convertirlos en
PASS. Un test de conservación de UNKNOWN no convierte la frontera en completa.

## Validación, compatibilidad y rollout

Conteos, comandos, intentos descartados, comparación con baseline/main, builds,
Chromium, CI/Preview e integridad final en el informe Evidence de esta fase.
Las pruebas focales nuevas se incluyen en la global; no se suman dos veces.

Cinco archivos preexistentes de producto modificados y uno nuevo. No se tocan
`useCaja` ni sus seis callsites financieros, App/main, entry gate, coordinator
Web Locks, autoridad, ledger/recovery state machine, licencias/security Realtime,
SQL, dependencias, workflows o capacidades/topics Ecommerce FREE. Admin offline
máximo 168h, Staff online-only, M-01/F-02 y Actor Runtime/Storage se conservan.

#371 toca directamente `posSyncOrchestrator.js` y `customerCreditSyncHandler.js`,
y modifica además outbox/ledger/repositorios/migraciones de cliente/crédito.
Debe reconciliarse y revalidarse al integrarse; ausencia de merge no certifica
compatibilidad conjunta. No se copian cambios de esa rama. #372 queda intacto.

Rollback focal: revertir sólo el commit de producto F01-2D.1 o sus cinco fuentes
al baseline y retirar el helper junto con sus consumidores opcionales. No borrar
IndexedDB/outbox/intents/receipts, cerrar cajas, soltar leases, cambiar origen ni
reenviar operaciones ambiguas. Revertir código no termina documentos abiertos
ni cancela trabajo aceptado por un servidor.

Siguiente trabajo recomendado: contrato focal de suscriptores y productores
compartidos con mayor impacto (Caja/proyección y publicación de catálogo), con
reserva de owner, guards tras awaits y evidencia de raw settlement; después
reevaluar handlers/snapshots concretos. No activar gate, LC13 ni la siguiente fase
automáticamente con esta entrega.

```
MERGE: NOT_PERFORMED
COMMERCIAL_GATE: OFF
PRODUCTION_DEPLOY: NOT_PERFORMED
SUPABASE_PROJECT_CALLS: NONE
MIGRATIONS: NONE
LC13: OPEN
```
