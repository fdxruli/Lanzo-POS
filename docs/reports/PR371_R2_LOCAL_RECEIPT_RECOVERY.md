# PR #371 — R2: reconciliación y recuperación de recibos

**Dictamen: `PR371_R2_PARTIAL_HOLD`.** El fallo de recibos está corregido y probado localmente sobre main. La instalación completa de V sigue bloqueada por sus cinco discrepancias conocidas de dependencias. No se declara terminado FIN-01 ni se autoriza despliegue.

## Referencias y reconciliación

- main remoto verificado: `622f29a84bfc6b82e7230e7dbbebd93aa6f02828`.
- #371 OPEN / Draft, HEAD remoto `2f33cea480f3d478f797b495b168feac9aed483f`, rama `feat/cloud-sync-protocol-v2-fin01-r1`. Su base remota continúa siendo #370; no hubo retarget.
- #374 OPEN / Draft, HEAD `a3bce02de50c92bef9b93345a1fe1c511feab95e`, dependiente de #371. Sin modificaciones.
- Ledger de migraciones consultado mediante lectura: F `20261022135915` instalada; V y Q ausentes. En R2 no se ejecutó SQL ni RPC de aplicación en Production.

Se reutilizó el worktree aislado `C:/Users/pituf/.codex/worktrees/cloud-sync-protocol-v2-fin01-r1/Lanzo-POS-Git`, inicialmente limpio. Se integró main mediante merge normal, preservando ambos padres. Hubo siete archivos con conflictos: los tres repositorios/migradores/handlers de crédito, los tres equivalentes de Clientes y la integración de retry de ventas. Se conservaron las protecciones actuales de main y se adaptó el transporte v2 a sus transacciones y ActorRuntime; no se reemplazaron archivos completos por versiones antiguas.

Un primer checkout de merge falló por unlink en Windows. Su estado parcial quedó preservado en stash `7cf41b2086327fcc07d52b7a010ed8f02e514341`; el reintento produjo el merge normal. El stash no se reaplicó ni eliminó. El checkout principal y sus cambios existentes se conservaron.

## Corrección financiera

El envelope de `financial_operations` identifica explícitamente `customer_projection_scope: OPERATION_RESULT` y devuelve `customer_projections: []`. El resultado persistido conserva clave, hash, estado y efectos históricos. Un recibo de deuda $10 sigue siendo válido después de un pago que deja $5: no se compara su snapshot con el saldo vigente.

El cliente valida identidad, versión, fechas, importes y coherencia deuda/centavos del snapshot; lo marca como evidencia de operación con proyección vigente `NOT_INCLUDED`. No aplica esos clientes históricos sobre la tabla de Clientes. Mantiene el saldo vigente, las ediciones pendientes y la deuda histórica pendiente; si no existe cliente local, el recibo no crea un cliente con deuda cero. Las respuestas de otras familias conservan validación de proyección vigente y su conciliación segura.

La capacidad `financial_operation_result_v1` se exige en discovery y en las dos RPC financieras v2, antes de ejecutar efectos. El cliente se pausa ante incompatibilidad. Se mantienen tenant, sesión, actor, origen, autorización, clave/hash e idempotencia. Los deltas de ledger aceptan pagos negativos; los saldos continúan exigiendo valores no negativos.

`UPDATE_REQUIRED` ahora emite el evento de aviso también cuando discovery recibe un contrato incompatible sin fila pendiente en outbox. Se reconoce además el rechazo SQL `P0001 / CLOUD_CLIENT_UPDATE_REQUIRED`. No se amplió el sistema de notificaciones.

## Archivos y razones

Rutas relativas al worktree indicado; los cambios heredados de main forman parte del merge, no de una reconstrucción R2.

| Archivos modificados en R2 | Razón |
| --- | --- |
| `src/services/sync/cloudSyncProtocolV2.js` | Semántica histórica explícita, capacidad financiera, validación conservada y aviso sin outbox. |
| `supabase/migrations/20261023033028_fin01_cloud_sync_protocol_v2_r1.sql` | Envelope y negociación de la nueva capacidad; no modifica recibos persistidos ni los 49 guards originales. |
| `src/services/customers/customerLocalRepository.js`, `customerMapper.js`, `customerMigrationService.js`, `customerSyncHandler.js` | Preservar validaciones #376, deuda histórica #370, concurrencia, actor y transacciones; excluir snapshots de recibos de la proyección local y deuda del payload de directorio. |
| `src/services/customerCredit/customerCreditLocalRepository.js`, `customerCreditMigrationService.js`, `customerCreditSyncHandler.js` | Conservar protección histórica, actor y aplicación atómica de las respuestas v2. |
| `src/services/sync/__tests__/cloudSyncProtocolV2.test.js`, `src/services/customerCredit/__tests__/historicalCreditCloudApply.test.js` | Recibo $10/saldo $5, proyección desconocida, historial, identidad/hash, aviso y rollback por actor obsoleto. |
| `src/services/customers/__tests__/customerRepository.indexeddb.integration.test.jsx` | Fixture con autenticación real del ActorRuntime y autoridad del tenant de la base sintética; mantiene las comprobaciones productivas. |
| `src/services/financial/__tests__/financialIntentLedger.test.js`, `financialIntentExplicitRetry.test.js`, `financialIntentDexieConcurrency.test.js`; `src/services/salesCloud/__tests__/salesCloudFinancialRetry.integration.test.js` | Recuperación sin redispatch, fixtures del nuevo contrato y preservación del caso split de main. |
| `scripts/supabase/fin01-cloud-sync-protocol-v2-contract.node-test.mjs`, `supabase/tests/fin01_cloud_sync_v2_receipts_r2.sql` | Contrato estático y comprobación complementaria con funciones SQL reales en base sintética. |
| Este informe | Resultado, límites y propuesta de piloto. |

Se conservan los componentes útiles heredados de #371: discovery, envelopes, outbox, recibos, retry e interfaz de incompatibilidad. F no tiene diferencias respecto de main; no se añade Q. Caja, inventario, restaurante, sesiones y tenants se mantienen desde main.

## Pruebas ejecutadas y límites

- Vitest: **169/169 casos únicos en nueve archivos**: protocolo 17, aplicación histórica 14, ledger financiero 42, mapper 10, repositorio Clientes IndexedDB 46, concurrencia financiera 3, retry explícito 25, retry ventas 6 y aislamiento tenant/outbox 6.
- Contrato SQL estático Node: **7/7**. No equivale a ejecución SQL.
- ESLint focal, 16 archivos: **exit 0**. `git diff --check main`: sin errores.
- React Doctor sobre aviso y Layout: completo, **0 errores / 1 advertencia** de complejidad de Layout; sin auditoría de dependencias ni puntuación.
- PostgreSQL **17.11**, clúster nuevo aislado, `127.0.0.1:55849`, base `fin01_cert_r2`: ejecutadas las definiciones reales seleccionadas del candidato. Un recibo completado sintético se precarga con deuda $10; el core real de pago reduce a $5. Tres consultas de la RPC real v2 conservan resultado, clave/hash y $10 históricos. Se rechazan hash cambiado, otro origen/tenant, sesión inválida y capacidad ausente. El retry del pago real no duplica efectos. Resultado: `R2_RECEIPT_REAL_SQL_PASS`; ledger 2, caja 1, operaciones financieras 1, claves de idempotencia 1; ventas/pagos de venta/inventario 0. La transacción se revierte y el servidor aislado queda detenido.

**Límite SQL:** no se ejecutó la venta original ni el dispatcher v2 completo; se precargó su recibo. No se aplicaron las migraciones completas F/V/Q, ni siquiera en esta base. El PASS corresponde a las funciones de recibo y al pago/retry descritos, no a instalar V ni al circuito financiero completo.

Los primeros intentos del fixture de Clientes fallaron por actor bloqueado y después por autoridad tenant de prueba no configurada; se corrigió el fixture y el resultado final es 46/46. Los intentos fallidos se conservan. La primera exploración amplia de React Doctor se canceló; sólo se cuenta la ejecución focal completada. No se ejecutaron build, todas las suites históricas, CI ni QA manual en Preview.

Evidencia local conservada en `C:/dev/Lanzo-POS-Git/.tmp/pr371-r2/`: `validation-summary.json`, los JSON de Vitest allí referenciados, `sql-receipt.log`, `sql-setup.log`, `fixture/source-manifest.json` y `react-doctor-components.json`. No contiene una certificación de Production.

## Piloto legacy: propuesta mínima, sin implementación

1. Una política privada, administrada por servidor y acotada al `license_id` validado, autoriza el piloto. El cliente no puede seleccionar ese tenant mediante JSON ni habilitar el piloto declarando capacidades. Los negocios fuera de la lista siguen en v1.
2. Un helper de contención en las 14 entradas legacy identificadas, después de autenticación/autorización y antes de reservas, replay o mutaciones, rechaza las operaciones incompatibles del negocio piloto con un error de actualización. No se revoca EXECUTE globalmente. Las lecturas/replays obsoletos que puedan sobrescribir deuda también deben quedar contenidos en el piloto. El dispatcher privado v2 conserva acceso controlado a sus cores; deben comprobarse sus llamadas transitivas antes de envolver las rutas públicas.
3. La admisión legacy toma un lock compartido por tenant durante la transacción; activar la política exige el lock exclusivo del mismo tenant, drenando sus llamadas en curso. Esto permite un corte por negocio sin bloquear al resto. La secuencia de migración se revisa sobre F ya instalada: no reinstalar F; validar V y después la contención del piloto.
4. Antes del corte se actualizan y drenan los dispositivos/pestañas autorizados. Una PWA antigua conserva IndexedDB, outbox, claves/hashes y recibos pendientes. El cliente actualizado intenta recuperar recibo antes de reenviar y conserva el origen/sesión exigidos por servidor. Si la evidencia pendiente no permite esa recuperación, queda retenida para revisión explícita; nunca se borra, cambia de clave ni se reejecuta automáticamente. No se promete compatibilidad de cualquier PWA antigua sin probar ese corte.

La solución concreta es política privada + helper + guards en wrappers existentes; no requiere rediseñar FIN-01 según la evidencia disponible. No se ha implementado, activado ni certificado. No se deshabilitaron las 14 rutas, no se creó Q y no hubo activación comercial.

## Bloqueos y siguiente acción

Persisten las cinco discrepancias conocidas de los guards de V: `private.execute_split_sale_financial_v1`, `public.pos_close_restaurant_order_after_checkout_unlimited`, `public.pos_create_cloud_sale_cashier`, `public.pos_create_cloud_sale_cashier_inventory` y `public.pos_execute_financial_operation_v1`. Sus versiones actuales incorporan protecciones de restaurante/transición. Los hashes no se sustituyeron: la aplicación completa de V continúa retenida por `FIN01_V_DEPENDENCY_DRIFT`.

La próxima acción concreta es revisar esas cinco dependencias y sus guards sobre los cuerpos actuales y validar V completa y el dispatcher/replay en PostgreSQL aislado, en una iteración acotada. Después se revisa con el propietario la implementación y prueba del corte por negocio. Esta R2 se detiene aquí; no encadena esas correcciones ni demuestra inviabilidad estructural.

Se prepara un commit local de merge con la corrección validada. Sin push, merge remoto, retarget, cierre de PR, despliegue, cambios de #374 ni modificaciones de licencias, negocios, dispositivos o datos reales.
