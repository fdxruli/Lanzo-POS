# LANZO POS — F01-2D.2 — Cancellation → Caja R1

Fecha: 26 de octubre de 2026. Fase posterior a F01-2D.1.

**CANCELLATION_CASH_ROUTE_SCOPED_CLOSED.** Contrato implementado y demostrado
para el productor y `useCaja` que reciben el mismo scope original autorizado.
**POS_SYNC_BOUNDARIES_PARTIAL / HOLD_POS_SYNC_BOUNDARIES; gate OFF; LC13 OPEN.**
No es el cierre del bus, de todos los efectos de Caja ni de POS Sync.

## Identidad y autorización

Preflight anterior a las ediciones: checkout limpio, rama
`feat/f01-early-admission-recovery-r1`, HEAD local/remoto
`ce03b04918347898396957c8b7f35eb955896b89`, correspondiente a #373 OPEN/Draft.
Base correcta y ancestro: `feat/f01-single-instance-coordinator-r1`,
`f1d69093ffe3ad180752773c178b7fbaefd92ce1` (#372 OPEN/Draft).
Main: `52bb573e651529b323b6617e3161cd76ece14a39`.
No había cambios locales que descartar. No se usaron reset/checkout destructivos.

Esta fase se entrega localmente, sin push, publicación, cambio de título/cuerpo,
Ready, merge ni despliegue. El SHA final local se registra en la entrega y en
`evidence/final-state.json`; el SHA remoto de #373 sigue siendo el del preflight.
La evidencia documental posterior identifica el commit probado sin intentar
incluir un hash autorreferente dentro de ese mismo commit.

## Recorrido y propietarios

| Frontera | Propietario y comportamiento |
| --- | --- |
| `recoverCurrentFinancialIntents({executionScope})` | Conserva el scope Sync original; usa el punto de inyección `project` existente sólo para adjuntarlo a `sale.cancel`. El token financiero interno permanece igual. |
| `applyFinancialProjection` → `applySaleCancellationFinancialProjection` | Propaga ese argumento opcional. Los checks de actor, patch, transacción Dexie y clave `txn_cloud_sale_cancel_*` siguen iguales. |
| Publicación | Tras el commit y el segundo check de actor, publica en el orden histórico sales → cash → products → customer-credit → reports. Cash conserva `CustomEvent`, nombre y `detail:null`; una WeakMap privada asocia ese objeto con el scope original capturado antes de los awaits. |
| Listener `useCaja({executionScope})` | La instancia React posee la suscripción. La ruta registrada como fuente del mismo scope posee su cierre. No instala además el listener cash legacy. |
| Timer de debounce | `scope.schedule('cancellation_cash:debounce', ..., 0)` posee el timer y su completion. Cada suscripción coalesce como antes; al disparar comprueba instancia activa y scope original vigente. |
| Lectura/efectos | `cargarEstadoCaja` captura el owner del hook y llama a `route.runRead(performRead)`. `scope.run` registra antes de iniciar la lectura. La promesa incluye `getCurrentCashSession` y su continuación; después del await se comprueba de nuevo el owner antes de publicar estado/error/finally. |
| Repositorio | Se mantiene `cashRepository.getCurrentCashSession`, con el flujo actual Local/Cloud. No se modifican cálculo, caché, fallback, consultas ni escrituras financieras. La prueba adicional recorre repositorio Local, proyección y Dexie reales. |

El cambio en el recovery coordinator es indispensable para esta misma ruta:
su token de tarea financiero no expone `schedule/addSource/isContextCurrent`.
Sin propagar el scope Sync original por el callback de proyección existente,
el productor pierde la identidad antes de emitir el evento. No se cambia el
contrato del ledger, recovery, leases, receipts ni otra operación de proyección.

## Contrato de cierre

Se reutiliza `syncExecutionScope` sin modificarlo ni construir otro scope.
La ruta es única por identidad de scope (WeakMap), con suscripciones removibles
por hook. No representa autorización comercial ni reemplaza Web Locks.

1. `quiesce()` cierra admisión de forma síncrona y cancela los timers registrados.
   El listener aún no retirado físicamente ya es inerte por `isCurrent()`.
   El cleanup de la fuente lo desvincula en la microtarea de cierre registrada.
   `route.stop()` además cerca y desvincula síncronamente antes de devolver.
2. Timer cancelado pero ya encolado: el registro de `schedule` lo rechaza.
   Timer disparado cuya factory aún no empezó: `run` vuelve a verificar admisión.
   La factory comprueba de nuevo owner/scope justo antes de llamar al loader.
3. Lectura ya iniciada: no se cancela ni se declara terminada por tiempo. Se espera
   su promesa real y la continuación del hook; la respuesta vieja no publica UI.
   Un read que no termina mantiene pendiente stop/drain. No es cancelación remota.
4. `stop()` repetido devuelve exactamente la misma promesa de `source.stop()`.
   No repite limpieza ni lecturas. El cleanup espera sus completions observadas,
   nunca llama a `scope.drain()` desde dentro de su propio drain.
5. Desmontar una suscripción retira listener y timer. No abandona el read iniciado:
   sigue registrado en la ruta/scope. La guardia de owner impide publicar en otro
   hook o tras reinstalarlo, incluso en StrictMode.
6. Evento etiquetado con scope viejo: lo ignoran la nueva instancia y el listener
   legacy. Un callback capturado del listener antiguo es inerte. Los otros
   consumidores del evento no cambian y no quedan certificados por esta guardia.

La publicación de la cancelación se conserva aunque la quiescencia ocurra entre
el evento sales y el evento cash: no se revierte ni se omite el patch financiero.
Se rechaza únicamente el nuevo refresco del consumidor cerrado.

## Actualización pendiente y siguiente instancia

Al cerrar se descarta el pulso/debounce pendiente, no la cancelación ya persistida.
No hay cola global, replay ni nueva sincronización. El siguiente scope autorizado
ejecuta el efecto de carga inicial existente de `useCaja`; el cambio de scope
también lo vuelve a ejecutar. La verificación en curso sólo se reutiliza dentro
del mismo owner, evitando adoptar una promesa antigua.

La prueba con repositorio Local real inserta una venta sintética de 10 en una
caja abierta, carga total 10, aplica la cancelación real, descarta su timer al
cerrar y carga total 0 con el siguiente scope. La caja y el único registro
determinista se conservan. Otra prueba confirma un nuevo evento del scope nuevo
con un único refresco. Son fixtures aislados, sin datos ni llamadas financieras
reales. No acreditan reconciliación remota Cloud ni todos sus caches compartidos.

## Archivos y alcance preservado

| Archivo | Símbolos afectados |
| --- | --- |
| `src/services/financial/cancellationCashRefreshRoute.js` (nuevo) | publicación/identidad privada, selección del receptor, ruta con `runRead`, `subscribe`, `stop` |
| `src/services/financial/financialCancellationProjection.js` | argumento opcional y publicación cash; transacción intacta |
| `src/services/financial/financialProjectionRegistry.js` | `applyFinancialProjection`: propagación opcional |
| `src/services/financial/financialIntentRecoveryCoordinator.js` | `recoverCurrentFinancialIntents`: callback `project` existente |
| `src/hooks/useCaja.js` | argumento opcional, owner del read, `cargarEstadoCaja`, efecto inicial y listener cash |
| `scripts/qa/single-instance-f012d2/` | 17 pruebas nuevas, comparación/auditoría, logs y hashes |
| Dos informes `LANZO.F01.F012D2.CANCELLATION.CASH.ROUTE*` | Contrato y evidencia de esta fase |

Los seis callsites reservados en F01-2B no se intervienen. `cashRepository` está
byte a byte intacto; en `useCaja`, sólo cambia el cuerpo de `cargarEstadoCaja`
entre sus 21 callbacks `useCallback`: los otros 20, incluido
`cerrarCajaAdministrativamente`, son idénticos. Es necesario proteger el loader
común porque es el efecto que este timer invoca; no se rediseñan los otros triggers.

## Límites y UNKNOWN

El contrato opcional exige que productor y consumidor reciban **el mismo scope**
por el flujo autorizado. No se cablea App ni se activa el coordinador comercial:
los callsites actuales siguen usando la firma legacy sin scope. El contraejemplo
legacy F01-2D.1 permanece intacto y continúa demostrando su riesgo; no se presenta
esta fase como su activación comercial. Las cancelaciones sin owner no se adoptan
retrospectivamente en una instancia scoped. Otros productores cash no etiquetados
siguen usando el evento existente; no se acredita su origen ni su lifecycle.

Se mantienen `financial_projection_subscriber_lifetime`,
`pos_handler_lifetime:*`, `snapshot_handler_lifetime:*` y todos los UNKNOWN no
investigados. Productos/Ecommerce, Dashboard, CustomersPage, KDS, otros eventos
de la proyección, triggers online/storage/policy, escrituras de Caja y providers
compartidos no obtienen un certificado de drain por esta intervención. Una lectura
ya iniciada puede terminar sus efectos internos actuales; stop espera su completion,
sin prometer que un proveedor externo no tenga trabajo no observable.

No cambia finanzas, ledger, idempotencia, origen, recibos, leases, modo offline
local, Admin max168h, Staff online-only, M-01/F-02, Actor Runtime/Storage, permisos,
SQL, dependencias, configuración, main o #372. Sin proyectos Supabase, migraciones,
producción ni QA comercial. Navegador nativo y dispositivos físicos:
**NOT_EXECUTED**, binario no disponible; no se descargaron herramientas.

Resultados exactos y comandos: informe `...CASH.ROUTE.EVIDENCE.R1.md`.
El bloqueo global de integración comercial permanece; no hay bloqueo adicional
para el contrato focal opcional descrito aquí.
