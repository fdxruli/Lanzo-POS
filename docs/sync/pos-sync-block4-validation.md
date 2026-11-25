# LANZO POS sync — validación conjunta, Bloque 4

**Estado:** código preparado en el PR Draft #593; no está aprobado para merge ni instalación. Esta nota separa evidencia integrada, pruebas previas reutilizadas y condiciones pendientes de 4F.

## Base y migraciones

- PR: [#593](https://github.com/fdxruli/Lanzo-POS/pull/593), rama `codex/lanzo-pos-stage-4de-frontier-block1`.
- Base `main`: `8bc4395a5cf911603ba7a6b4848dd958e92a1bf4`.
- HEAD al iniciar este cierre: `20cb1fb1fa5d300e155a07f2af1e45e62bc07ae4`.
- Bloque 1, `20261124183143_pos_sync_transactional_frontier_v1.sql`: `5762cfa725c06f45328abfcfe94638a59e93749fe7e456c2faf3638ac5de9da6`.
- Bloque 2, `20261124220046_pos_consistent_snapshots_v1.sql`: `b9f01c1d63eab86e581ce4f6be5d58670f0bd1eaf63ef6276e577e9b86a6c86b`.
- Bloque 3, `20261125001528_pos_snapshot_contract_discovery_v1.sql`: `5a663f56828bdbad77b1fde60292c84e6e4bc03e2863f12a79affc836f458f55`.

Las migraciones B2 y B3 recibieron correcciones focales durante este bloque; B1 permanece intacta. B2 valida el envelope V2 de clientes/crédito sin admitir al negocio en el piloto de escrituras FIN01. B3 añade descubrimiento read-only de snapshots independiente de FIN01. El descubrimiento anuncia el conjunto solo si las cinco firmas versionadas existen; cada RPC de página conserva su propia validación de tenant, dispositivo, sesión, entitlement y permisos.

## Laboratorio y Production

La QA SQL se ejecutó en PostgreSQL 17.6.1 local, contenedor aislado `lanzo-pos-b1-pg176`, base sintética `pr593_block4_qa`; al verificar había 55 GiB libres en el filesystem de 63 GiB. La base deriva de los fixtures aislados del Bloque 3 y contiene las tres migraciones candidatas y licencias sintéticas. El transporte de integración llama SQL mediante `psql` dentro del contenedor; no usa un Supabase remoto.

Production `odlrhijtfyavryeqivaa` se inspeccionó únicamente en lectura. PostgreSQL es 17.6; la función de descubrimiento y los cinco snapshots nuevos no están instalados. No hubo escrituras, instalación, cambio de piloto, `db push` ni reinicio de cursores.

La inspección focal anterior de retención no encontró una función directa que borre `pos_sync_events` ni un job cron que lo haga. La cobertura solo acredita esos mecanismos inspeccionados: conservar el log desde la referencia de snapshot hasta aplicar el delta sigue siendo una precondición del contrato.

## Matriz de integración PostgreSQL–Dexie

La prueba nueva `snapshotConsumers.postgres.integration.test.jsx` usa los servicios, handlers, repositorios locales y Dexie reales. Solo sustituye el cliente de transporte para ejecutar las llamadas RPC contra PostgreSQL local.

| Módulo | Evidencia SQL y cliente | Alcance observado |
|---|---|---|
| Catálogo | Prueba PostgreSQL–Dexie existente de `productMigrationService`/repositorios: contrato real, referencia fija, transacción pendiente, inversión de COMMIT, delta, proyecciones de catálogo, creación, tombstone y Outbox local | Más de 500 productos, categoría y lote; el valor concurrente de un producto ya recorrido converge tras el delta. La edición local y su Outbox siguen pendientes. |
| Clientes | `customerMigrationService`, repositorio local y Dexie reales contra `pos_pull_customers_snapshot_v3` | 501 clientes, dos páginas, envelope V2 y `server_version`. |
| Crédito | `customerCreditSyncHandler`, repositorios y Dexie reales contra `pos_pull_customer_credit_snapshot_v3` | 501 movimientos, dos páginas y clientes relacionados. |
| Ventas | `salesCloudSyncHandler` y caché Dexie reales contra `pos_pull_sales_snapshot_v2` | 501 ventas en dos páginas, con artículos y pagos proyectados. |
| Caja | `cashSyncHandler` y repositorios/Dexie reales contra `pos_pull_cash_snapshot_v2` como Staff | Scope `mine`, 501 sesiones y 501 movimientos en tres páginas. Las filas sintéticas Admin con estación legacy no canónica quedaron fuera del scope y sin mutación. |

La prueba de módulos ejercitó cuatro descubrimientos read-only y nueve llamadas de página, con límite máximo 500 y sin reintentos. Para clientes, crédito y ventas: dos páginas cada uno; caja: tres. La medición integrada completa observada fue una corrida, no p50/p95 ni capacidad de Production.

La convergencia de catálogo con concurrentes usa PostgreSQL real y Dexie real. Las pruebas SQL del Bloque 2 ya documentan 37/38, desplazamiento A/B/C/D, altas, tombstones, commits/rollbacks pendientes, permisos, cursores y paginación de los cinco RPC. Los handlers de delta de clientes/crédito/ventas/caja tienen además pruebas Dexie con transporte simulado; esta corrida no los conectó a deltas PostgreSQL reales en esos cuatro módulos.

## Recuperación y autoridad local

- `durableSnapshotService` comparte el mismo recorrido en curso para llamadas solapadas con la misma licencia, stream y contexto de autoridad/alcance.
- Un fallo `RPC_RATE_LIMITED` deja guardados referencia y cursor opaco de la página ya aplicada; el cursor incremental no avanza por una página interrumpida. La prueba focal reinicia la llamada de servicio sobre el mismo metadato durable y continúa la página pendiente.
- Tras completar snapshot y delta, el marcador `complete` evita volver a descargar páginas para el mismo contexto.
- La suite focal del orquestador verifica recuperación incremental programada sin nuevo Broadcast; otra prueba focal fija el respeto de `retry_after_seconds` en un fallo de inicio de snapshot.
- El alcance exacto de autoridad se incorpora al marcador y al cursor SQL. Si cambian actor, sesión, permisos, tenant o filtros, el cursor opaco anterior no se reutiliza. El marcador anterior permanece en IndexedDB bajo su contexto; una reconciliación para la autoridad nueva empieza su propio recorrido seguro.
- El Outbox y cambios locales protegidos se comprobaron en la convergencia de catálogo. No se borró IndexedDB ni se reiniciaron cursores globales.

El test `RPC_RATE_LIMITED` usa respuesta controlada del servicio; el límite de espera se comprueba con reloj Vitest, no esperando 60 segundos. No se forzó el rate limit real de Production. La suite no compone todavía una sola prueba que pase desde rollback real PostgreSQL, scheduler real y RPC de delta PostgreSQL sin Broadcast; la protección SQL del rollback y la recuperación automática del scheduler tienen evidencia focal separada.

## Rendimiento y solicitudes

En el recorrido integrado de muestra se hicieron 13 RPC de snapshots (4 descubrimientos y 9 páginas) para los cinco contratos cargados, cero reintentos, y terminó en 12.08 s en una corrida de laboratorio. Ese tiempo incluye inicialización local y escritura en Dexie; no es un benchmark p50/p95. La muestra de Bloque 2 documenta tiempos p50/p95 por endpoint, y Bloque 1 documenta la latencia de la frontera bajo contención. No se atribuye a esta corrida integrada una medición aislada de WAL ni de espera de locks. No se hizo benchmarking financiero integrado adicional en este bloque.

## Compatibilidad y 4F

El cliente nuevo usa `pos_snapshot_sync_contract_v1`. Un servidor anterior sin esa función conserva el camino legacy sin tratar sus páginas OFFSET como snapshot consistente ni avanzar un cursor aplicado a partir de su máximo. Una respuesta explícita `UPDATE_REQUIRED`, permisos inválidos o un conjunto parcial de capacidades no baja silenciosamente a legacy. Los clientes antiguos no llaman al contrato nuevo y seguirían con RPC legacy; antes de activar la transición deben actualizarse o quedar bloqueados de forma segura. La nueva negociación no activa FIN01 ni concede permisos financieros.

Orden futuro: verificar proyecto/versión/ledger/hashes; confirmar y probar el mecanismo operativo de pausa; detener admisión de nuevas escrituras, drenar transacciones activas y lecturas sensibles, revisar `lock_timeout=5s`; instalar B1, B2 y B3 como transacciones separadas con verificación entre cada paso; desplegar/forzar el cliente compatible antes de exponer la capacidad; comprobar ACL/RLS, descubrimiento, frontera, límites, outbox y recuperación; luego reanudar escritores y observar. Si el preflight o lock timeout falla, detener el corte y mantener la admisión cerrada hasta restablecer el servicio; no ejecutar una reversión DDL improvisada después de que clientes hayan consumido los contratos.

La búsqueda focal en migraciones y servicios no encontró una compuerta existente para pausar únicamente los escritores POS de un tenant. `lock_timeout` aborta el DDL si no obtiene locks a tiempo, pero no evita nuevas escrituras ni sustituye la pausa/drenado. 4F debe identificar o preparar una compuerta operativa con pruebas y conservar Outbox local; hasta entonces el paso de instalación no tiene un procedimiento ejecutable suficiente.

## Estado de QA

- **Código preparado:** cambios focales cliente/SQL y esta evidencia quedan en el mismo PR Draft.
- **QA SQL:** PostgreSQL local 17.6; B1–B3 candidatas, permisos y convergencia previa de catálogo; no Production.
- **QA automatizado:** 12 archivos focales / 154 Vitest pasaron; ESLint focal terminó sin errores. `npm run build` terminó y corrió ambas auditorías postbuild: 26 assets de inicio, 0 assets core Local, y 5 recursos de bot con 24 dependencias estáticas. Vite/PWA informó advertencias de anotaciones/importaciones y patrones glob sin coincidencias; las auditorías terminaron correctamente.
- **QA integrado:** catálogo, clientes, crédito, ventas y caja, PostgreSQL local a servicios/repositorios/Dexie con los límites señalados arriba.
- **QA manual:** no ejecutado; QA físico entre terminales queda reservado al cierre del roadmap.
- **Production:** inspección read-only; sin instalación ni activaciones.
- **Dictamen:** **APTO CON RESTRICCIONES** para preparar 4F. La falta de una compuerta operativa probada de pausa de escritores y la actualización requerida de clientes legacy deben resolverse antes de cualquier instalación/activación. Este PR no está completo, no está apto para merge y no es apto para Production.
