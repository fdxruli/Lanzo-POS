# LANZO POS — F01-2A — FINANCIAL EXECUTION LIFETIME R1

Fecha: 23 de octubre de 2026, America/Mexico_City. Repositorio: `fdxruli/Lanzo-POS`.

**LIFETIME_IMPLEMENTED_READY_FOR_OWNER_REVIEW**, limitado a la composición opcional y las fronteras locales ensayadas. **HOLD_RECOVERY_INTEGRATION permanece para F01-2; gate comercial no implementado ni activado.** LC13 OPEN. PR #373 OPEN / Draft / NOT MERGED, misma base `feat/f01-single-instance-coordinator-r1`. No implica permiso para integrar o desplegar el gate.

## 1. Identidad, antecedentes y alcance

Main remoto: `52bb573e651529b323b6617e3161cd76ece14a39`. PR #372: `f1d69093ffe3ad180752773c178b7fbaefd92ce1`, intacto. PR #373 inicial: `7d9f4562a4b12efdcdfb8d5fbb77a4ff9d81ec50`. HEAD publicado y árbol exactos se registran en el cuerpo del PR y entrega, evitando un hash autorreferente en este archivo.

Se consultaron los informes F01 LC13 Audit/Evidence, Design/Evidence y F01-0 Decisions/Evidence disponibles en el entorno anterior, y F01-1/F01-2 Implementation/Evidence del HEAD fijado. Se inspeccionaron los cuatro módulos solicitados, sus callers de caja/ventas/recuperación, registry/proyecciones y los cinco PR abiertos anteriores. Los datos históricos no se presentan como ejecuciones nuevas. El encargo actual autoriza exclusivamente esta corrección focal y sustituye el HOLD de implementación anterior sólo en este alcance.

Dos worktrees detached propios, base y candidata, desde el HEAD inicial exacto. Sin AGENTS.md aplicable; no se modifican los worktrees anteriores. Dependencias compartidas existentes, lockfile idéntico, sin instalación ni modificación de dependencias. Node 24.22.1; Chromium 143.0.7499.0/Playwright externos. Sin Docker ni perfiles del propietario.

Tres fuentes preexistentes cambian exclusivamente para propagar contexto opcional: `financialTimeout.js`, `financialIntentLedger.js`, `financialIntentRecovery.js`. Se añade `financialExecutionLifetime.js`, sin imports de Runtime, Supabase, coordinator, DB o React. App/main/instanceCoordinator, RPC, estados, claves, retries, leases, autorización, workflows y SQL no se modifican. No se importa el helper nuevo desde el arranque comercial. Los consumidores actuales continúan sin observación.

## 2. Diagnóstico y contrato anterior

`withFinancialTimeout` devuelve una carrera task/timer. El settlement del race no termina el task. `runExecutor` sólo espera lo que su factory devuelve. Envolver exclusivamente `recoverFinancialIntent` o el race deja invisible el RPC cuyo timer ya venció.

CE-DRAIN-01, CE-DRAIN-02, CE-RECOVERY-04 y CE-NATIVE-DRAIN-03 siguen siendo **COUNTEREXAMPLE de la garantía antigua**; no se cambia su clasificación al aprobar assertions de reproducción. La política financiera existente sí conserva PENDING_RECEIPT, K/hash/origen y ausencia de reenvío. La corrección no intenta cambiar esa política.

Baseline nuevo: ledger/recovery/Dexie reales sobre fake-IDB, actor/Auth/RPC sintéticos; timeout original 35.000ms y lease permitido de 120.000ms. Recovery termina antes que transporte, conserva ambigüedad y libera lease. Chromium baseline reproduce que B adquiere prematuramente si sólo se registra la promesa pública. RAW-TRACKING-PROPOSAL permanece un control histórico reejecutado, no la implementación financiera nueva.

## 3. Dos lifetimes independientes

**PUBLIC_SETTLEMENT** es el valor/error que obtiene el llamador. Continúa venciendo a los tiempos originales, incluidos error ambiguo y receipt-first. No se espera indefinidamente para devolver ese resultado.

**CLIENT_EXECUTION_SETTLEMENT** abarca la invocación raíz completa, sus awaits/continuaciones locales/finally y cada factory subyacente registrado mediante el mismo contexto. No se alcanza por timeout público. Puede quedar pendiente indefinidamente.

**CLIENT_EXECUTION_SETTLEMENT no equivale a FINANCIAL_OPERATION_CONFIRMED.** Un fetch/thenable terminado o rechazado no acredita que el servidor no siga procesando una solicitud aceptada. Tampoco abortar un consumidor o cerrar un documento equivale a cancelar un commit. Resultado remoto: receipts e idempotencia originales, sin cambios.

## 4. Diseño elegido y contrato de uso

`observeFinancialExecution(operation, { runExecutor })` entrega `{ result, settled, getSnapshot }`. `result` es la promesa pública de la invocación; conserva referencias de valor/error, sin convertir éxito o ambigüedad por el postcheck del executor. `settled` siempre cumple con un snapshot sin resultados, errores, credenciales, IDs de intent ni identidad de tenant.

Se inyecta el runner existente de F01-1. Debe registrar antes de llamar al factory y retenerlo hasta su settlement: no es un callback informativo arbitrario que pueda llamar al trabajo y luego olvidarlo. La invocación financiera comienza **dentro** de ese factory admitido, no antes del registro. Un rechazo síncrono/asíncrono de admisión antes de invocar el factory rechaza `result` sin iniciar la operación. El error del runner se observa; sus rechazos tardíos no crean unhandled rejection ni sustituyen el resultado financiero ya obtenido.

La operación recibe `(executionScope, ticket)`. El contexto se pasa opcionalmente al ledger/recovery y a `withFinancialTimeout`. `executionScope.track(factory)` registra antes de invocar el factory en microtask; requiere un factory aún no iniciado. No acepta una promesa preiniciada como si probara registro previo. Los consumidores legacy siguen admitiendo funciones/promesas como antes.

El contexto es de una sola invocación: Set local, sin registry global, sin herencia implícita entre tenants y sin monkeypatch de Promise. Los factories anidados comparten ese Set. Al terminar el cuerpo raíz se entrega `result`, pero su executor espera hasta vaciar todos los completions registrados. Añadidos por tareas aún pendientes entran en el siguiente ciclo de drain. Cada completion cumple tanto si el task cumplió como si rechazó; se retira la referencia tras settlement. Al cerrar el contexto se rechazan nuevas altas antes de iniciar su factory.

`executionScope.markUnobservable()` clasifica explícitamente una frontera crítica desconocida: añade una única retención sin resolver y marca `unobservable=true`. No ofrece token de liberación, timer ni escape de cancelación. El estado es terminalmente no drenado para esa invocación. Si un caller no puede entregar una frontera completa, debe conservar HOLD y no afirmar drain. Este método no descubre automáticamente trabajo detached; una omisión de instrumentación permanece fuera del contrato.

Ejemplo conceptual para una fase futura; **no está conectado al producto**:

```js
const observed = observeFinancialExecution(
  (executionScope, ticket) => recoverFinancialIntent({
    ...existingOptions,
    actorHandle: existingHandleWithAdmissionChecks(ticket),
    executionScope,
  }),
  { runExecutor: coordinator.runExecutor },
);
await observed.result; // conserva el resultado público, incluido timeout
// La salida se solicita desde fuera del executor, nunca esperando su propio drain.
await coordinator.quiesceAndRelease();
```

`existingHandleWithAdmissionChecks` representa el wrapper restrictivo pendiente de F01-2, no una función nueva implementada aquí. Tiene que comprobar ticket y handle actor/tenant originales antes de efectos y tras awaits. La observación no reemplaza esas comprobaciones. No usar `settled` como ticket, autorización o recibo.

## 5. Frontera local efectiva y cobertura

Inventario íntegro de **11 callsites** en `evidence/timeout-inventory.json`: para cada uno se registran inicio, promesa pública, tarea, timeout, cancelación, finalización cliente, continuaciones, escrituras, efectos remotos, idempotencia, autoridad y cleanup.

| Callsite | Default intacto | Frontera observada / estado |
| --- | ---: | --- |
| Ledger resolveStation | 10s | Factory RPC; prepare/hash e inserción se cubren por la raíz y preflight anidado. OPT_IN |
| Ledger receiptForCurrentOrigin | 10s | Auth + RPC + parseo dentro del factory; persistReceipt/proyección/finally dentro de raíz. OPT_IN |
| Ledger createFinancialIntent preflight | 15s | Prepare completo y estación anidada; inserción sólo tras éxito público, esperada por raíz. OPT_IN |
| Ledger executeNewFinancialIntent preflight | 15s | Prepare completo; allocator/retry/dispatch/proyección/cleanup en raíz. OPT_IN |
| Ledger executeDurable dispatch | 35s | Auth/guard/RPC como task; parseo/estados/receipt alternativo/proyección/finally en raíz. OPT_IN |
| Caja resolveAdministrativeTargetStation audit | 10s | PENDING: repositorio/cache/dedupe y sus transportes internos aún sin contexto |
| Caja getCashSessionDetailForAudit | 10s | PENDING: consulta decorada y applyCloudResponse posterior |
| Caja adminClose station | 10s | PENDING: identidad/binding de estación y continuación externa |
| Caja adminClose preflight | 15s | PENDING: consulta/binding local que puede continuar tarde |
| Caja adminClose local projection | 10s | PENDING: proyección posterior y pullIncremental detached |
| useCaja cerrarCajaAdministrativamente sync | 10s | PENDING: sincronización/estado local después de éxito público |

Los entrypoints `createFinancialIntent`, `executeNewFinancialIntent`, `executeFinancialIntent`, receipt de recovery, prepared/blocked recovery, `recoverFinancialIntent` y retry explícito propagan contexto opcional sin cambiar argumentos obligatorios. Ningún consumidor existente empieza automáticamente a registrarse. La raíz debe envolver la **última continuación efectiva** del flujo a certificar; envolver sólo un RPC o un método inferior no incluye código que el caller ejecute después de `result`.

`runFinancialProjectionUnderLease` y registry esperan sus handlers y sus escrituras de lifecycle: quedan incluidos cuando se ejecutan **dentro de la raíz**. LIFE-05B prueba esa frontera real con handler sintético pendiente; no acredita todos los repositorios comerciales E2E. Un handler propio que lance trabajo detached debe devolver su finalización completa o registrar ese trabajo explícitamente; de no poder hacerlo, marcar no observable/HOLD.

El auto recovery coordinator actual, repositorios de ventas/caja de alto nivel, sincronización posterior, pulls de catálogo detached, bootstrap background validation, outbox/handoff autónomos e imports/IndexedDB independientes **no reciben wiring nuevo**. No se certifica su drain. La parada de listeners no equivale a terminación de tareas ya lanzadas. Este inventario impide reutilizar la candidata como prueba de que toda la aplicación está drenada.

## 6. Rechazos tardíos y cleanup

Los tasks registrados tienen manejadores de ambos resultados; su completion no rechaza. El race mantiene el manejador del task original. El runner tiene handler de rechazo separado. LIFE-04/23 comprueban rechazo posterior al timeout y ausencia de unhandledRejection. La responsabilidad habitual de observar `result` sigue siendo del consumidor, igual que cualquier API pública.

El timer se limpia como antes. La raíz incluye el finally existente de lease; no se mueve ese cleanup al settlement subyacente. Los Set pierden referencias de tasks tras settlement; no se guardan respuestas/credenciales en snapshots. No se borra evidencia durable. Una promesa desconocida o que nunca termina conserva retención; no se declara fuga resuelta forzando release.

## 7. Autoridad, tenant, leases e idempotencia

Observer no concede actor ni modifica handles. Permanecen las comprobaciones existentes de actor/tenant/device, generaciones, origen, equivalencia, status y lease. Un ticket de ventana no habilita una escritura durable. LIFE-12 comprueba ticket revocado antes de efecto local mediante guard explícita; LIFE-13/14 prueban actor obsoleto y tenant/generación cambiados con handles de fixture y ledger real. Las suites reales de Runtime/Storage/M-01/F-02 se ejecutan por separado.

**Lease financiero y Web Lock son recursos distintos.** LIFE-21 y CE-RECOVERY-04 prueban lease liberado al timeout con transporte registrado todavía pendiente. LIFE-22 expira sólo la fila de fixture, sin cambiar reloj del sistema ni reglas productivas, y demuestra rechazo de escritura tardía. No hay extensión, renovación, retención ni nuevo significado del lease por observación.

Receipt PROCESSING/inaccesible/NOT_FOUND tras intento mantiene restricción y cero redispatch. PREPARED/0 conserva su primer dispatch legítimo bajo autoridad/lease/receipt; PREPARED con intentos exige recibo. COMPLETED tardío se confirma sólo en recovery posterior, conservando todos los campos inmutables. Raw completion después del timeout no convierte por sí sola PENDING_RECEIPT en éxito.

## 8. Web Lock, trabajo desconocido y terminación abrupta

Se reutiliza F01-1 sin modificar ni un byte: `getDocumentInstanceCoordinator`, `runExecutor`, `waitForExecutors`, `quiesceAndRelease`. Registro raíz anterior al trabajo. Quiesce revoca tickets/rechaza altas nuevas y espera el executor completo. El lock permanece mientras haya trabajo crítico registrado pendiente, incluso después del timeout público y de terminar el transporte si queda continuación local.

No hay timer de drain ni takeover. Una tarea que jamás termina o `unobservable=true` conserva QUIESCING/lock. UX futura: explicar «La operación sigue pendiente de verificar; no la repitas», mantener diagnóstico/estado/acceso a ayuda y no ofrecer forzar acceso ni limpieza. Aquí sólo se especifica: no se implementa shell/UI comercial.

Un cierre abrupto puede terminar la ejecución cliente y liberar el recurso por decisión del navegador. El caso Chromium de cierre real conserva evidencia ambigua sintética; reopen/recovery del ledger se prueba aparte. **No se certifica como un único E2E de crash + servidor + cobro.** Debe recuperarse mediante receipt-first, nunca deducir confirmación/cancelación de adquirir el lock.

## 9. Validación y límites

Resultados nuevos y comandos íntegros en el informe Evidence. LIFE-01..30 cubiertos por 30 tests; se añaden LIFE-05B, LIFE-09B y CE-RECOVERY-04: **33/33 PASS**. Los timers de producto no cambian. LIFE-25 tiene alcance parcial de terminación/reopen; no pago remoto. LIFE-29 prueba clasificación desconocida/no drain, no capacidad para descubrir tareas omitidas.

Diferencial amplio del HEAD anterior y candidata, mismas dependencias/selección: **1.167 PASS / los mismos 4 FAIL restaurant split-close / 50 SKIP / 1.221 total por lado; cero diferencias de estado o primer mensaje de fallo**. Omisiones no son PASS. Los tests F01-1 (45) están incluidos en ese grupo. No se ajustan assertions, thresholds, comparadores o workflows.

Global nuevo: baseline **5.715 PASS / 88 FAIL / 52 SKIP / 5.855 total**; candidata **5.748 PASS / 88 FAIL / 52 SKIP / 5.888 total**. Los 33 PASS adicionales son las pruebas nuevas. Comparador PR127 local original: **OK**, 104 identidades de fallo compartidas, cero exclusivas/nuevas/sin resolver; targets vacíos, ninguna repetición focal necesaria. No es CI remota ni comparación nueva contra main: baseline exacto es el HEAD anterior de #373. Las unidades de fallo del comparador incluyen archivos y no equivalen al número de assertions fallidas.

Build Production, **Preview real con VERCEL_ENV=preview**, Store y Store Vercel: PASS en ambos árboles. Precache 24/32 assets iniciales Production/Preview, cero faltantes/fixtures/coordinador. `coreLocalRouteAssets=[]` es literal del auditor, no QA offline fría. Lint focal exit0; aviso preexistente baseline-browser-mapping conservado.

Remote CI/Preview del SHA publicado se registra en el PR. Los filtros de PR apuntan a main y este PR conserva base apilada: PR127/Runtime/ScopedStorage/Dexie no se declaran SUCCESS si no se disparan. Una Preview READY no certifica F01-2 ni este protocolo financiero frente a servidor. No abrir App contra producción para obtener esa etiqueta.

## 10. Regresiones, rollout y rollback

Se conservan las cuatro fallas históricas: saves pending split close when offline; saves pending split close when repository returns failure; retries pending split close without losing paymentSummary; does not evict legacy rows when adding a new tenant-scoped retry. No se declara arreglo de restaurante ni suite global verde.

Los primeros tests de arquitectura se ejecutaron antes de disponer de builds y tuvieron ocho ENOENT compartidos, además de los cuatro históricos. Se conservan salidas `before-build-*`; se generaron artefactos en ambos lados y se repitió exactamente la selección. El primer build etiquetado Preview usó sólo modo Vite y no activó la variable real del proyecto; se conserva `before-preview-fix-*` y se repitieron los cuatro builds con entorno correcto. No son regresiones del producto ni PASS de la configuración Preview inicial.

Rollout: sólo código opcional en #373 Draft; sin entrada ni activación comercial. Revalidar #338/#352/#368/#370/#371 si cambian o llegan a main: contratos superpuestos no se integran automáticamente. #372 permanece intacto.

Rollback focal: revertir sólo los tres cambios de propagación y retirar el helper nuevo/tests/docs de esta fase; los consumidores legacy no activan el contexto. No hay esquema/datos a revertir. En una integración futura, dejar de admitir nuevas tareas y esperar todos los ejecutores propios antes de retirar coordinación; desconocidos requieren restricción, no force-release. Conservar intents/receipts/outbox/K/hash/origen; no borrar IndexedDB, cerrar cajas, liberar dispositivos ni reenviar cobros.

## 11. Dictamen y siguiente fase

¿Lifetime local delimitado?: **sí para raíz completa + factories registrados explícitamente y continuaciones awaitables ensayadas; no para toda la aplicación ni código detached omitido.**

¿Implementado o diseñado?: implementación focal opcional, probada y entregada para revisión. ¿F01-2?: puede retomarse su trabajo de diseño/integración después de revisar este contrato; **no puede activarse/certificarse con esta entrega**. Permanecen pendientes separación bootstrap/background, inventario estable completo, propagación de las seis rutas caja/hook cuando entren en alcance, cercado explícito ticket/actor/tenant y prueba de todas las continuaciones/servicios antes de release. No iniciar esas modificaciones en esta fase.

Riesgos residuales: transporte/servidor ambiguo, tareas omitidas o no observables, restricciones indefinidas por no settlement, callers legacy sin observación, PWA/hibernación física pendiente, perfiles/orígenes/JS legacy fuera de exclusión, LC13 OPEN. Mantener Admin offline máximo168h, Staff online-only, M-01/F-02, idempotencia y outbox sin cambios.

Supabase production writes NONE; llamadas a proyectos Supabase NONE (sólo documentación pública); migraciones NONE; SQL NONE; operaciones financieras reales NONE; licencias/dispositivos sin cambios; datos del propietario no usados; Production deploy NOT PERFORMED; Merge NOT PERFORMED.
