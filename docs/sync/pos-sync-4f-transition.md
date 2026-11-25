# LANZO POS — Runbook de transición 4F

**Estado:** preparado en PR Draft #593. No se ha instalado SQL ni publicado código por esta tarea. La ejecución requiere autorización posterior.

## Referencias verificadas

- Proyecto Supabase: `odlrhijtfyavryeqivaa`; PostgreSQL Production 17.6.1.063.
- Proyecto Vercel `lanzo-pos`: el deployment Production más reciente que pude consultar corresponde al merge de #592 en `main`, SHA `8bc4395a5cf911603ba7a6b4848dd958e92a1bf4`. El historial confirma que merges recientes de `main` producen deployments `target=production`.
- Rama del PR: `codex/lanzo-pos-stage-4de-frontier-block1`; PR #593 permanece Draft.
- En Production las tres versiones candidatas todavía no están en el ledger. La inspección de solo lectura encontró las firmas, dueños, `search_path`, ACL, secuencia y políticas RLS que espera el preflight de B1. No se encontró un job conocido que borre `pos_sync_events`.

Hashes que deben verificarse otra vez contra el `main` exacto antes del corte:

| Versión | Archivo | SHA-256 | Depende de |
| --- | --- | --- | --- |
| `20261124183143` | `20261124183143_pos_sync_transactional_frontier_v1.sql` | `5762cfa725c06f45328abfcfe94638a59e93749fe7e456c2faf3638ac5de9da6` | Preflight B1 de Production |
| `20261124220046` | `20261124220046_pos_consistent_snapshots_v1.sql` | `b9f01c1d63eab86e581ce4f6be5d58670f0bd1eaf63ef6276e577e9b86a6c86b` | B1 |
| `20261125001528` | `20261125001528_pos_snapshot_contract_discovery_v1.sql` | `0792347ee92995b7631338b166d74cc46482a04602184fa27572284817dc9376` | B1 y B2 |

B1 es transaccional y no cambió. B2 añade los cinco RPC paginados. B3 anuncia el descubrimiento solo después de B2 y revoca `EXECUTE` de los siete RPC legacy OFFSET para `PUBLIC`, `anon` y `authenticated`; conserva `service_role` y los nuevos endpoints. B3 es la barrera que impide a clientes anteriores terminar una carga OFFSET incompleta como si fuera snapshot.

## Barrera global y alcance

`pos_change_seq` y `pos_sync_events` son objetos globales compartidos por todos los negocios. Una pausa solo por tenant no protege la instalación. La migración B1 toma locks exclusivos globales al final de su transacción y espera a que terminen las transacciones anteriores que usan la secuencia/log; los escritores que alcanzan esa barrera esperan y continúan después del commit con las definiciones nuevas.

En PostgreSQL 17.6 aislado se ejecutó B1 exacta con una transacción vieja retenida. B1 esperó el lock global; la escritura lanzada durante el corte quedó en cola y completó con secuencia/marca de la función nueva después del commit. La frontera siguió sin incluir la secuencia posterior no confirmada. En una segunda base, se retuvo el lock más de cinco segundos: el `lock_timeout=5s` canceló la migración completa y los hashes de asignador/recorder, default de secuencia y ausencia del helper confirmaron rollback íntegro. Este timeout es fallo cerrado, no una pausa de admission ni una estrategia de drenado.

No existe una compuerta global de mantenimiento que cierre solicitudes Cloud en el servidor. No se añade un mecanismo permanente: el corte requiere una **pausa global de toda actividad de sincronización Cloud**, tanto lecturas de snapshots como deltas y escrituras, desde antes de B1 hasta completar B3 y el postflight. Free/Local e IndexedDB siguen disponibles. La barrera DDL probada protege a los escritores mientras B1 tiene sus locks, pero no cubre los intervalos entre las tres migraciones: antes de B3, un cliente antiguo aún puede llamar un snapshot OFFSET. Por eso la pausa incluye snapshots y sesiones abiertas, no solo ventas/escrituras. Si el equipo no puede hacer cumplir esta ventana global y mantener fuera de línea los dispositivos que no estén listos, el dictamen pasa a **HOLD**.

El cliente PWA usa `registerType: 'prompt'`; una publicación no reemplaza inmediatamente todas las pestañas o instalaciones. El usuario puede posponer el aviso de actualización. El protocolo `UPDATE_REQUIRED` existente cubre familias FIN01, no obliga a instalar el contrato de snapshots. Después de B3, los clientes antiguos reciben denegación en los siete RPC OFFSET, pero no existe un bloqueo general que fuerce su actualización. La operación de reapertura debe comprobar la versión en cada terminal en línea; los dispositivos offline permanecen offline/local hasta actualizarse. Los Outbox locales no se borran.

## Orden ejecutable del corte

La secuencia no es atómica entre los tres archivos. Mantener la pausa global de sincronización Cloud (lecturas y escrituras) desde el preflight hasta completar postflight.

1. **Preparar el corte.** Confirmar aprobación técnica de PR #593, verificar diff y hashes de los tres SQL candidatos. No fusionar hasta tener la autorización posterior. El merge de `main` inicia deployment Production automáticamente según el historial y configuración observados.
2. **Iniciar la ventana global antes del merge.** Avisar a todos los negocios y cerrar temporalmente el uso Cloud en todas las terminales conectadas: no iniciar lecturas, snapshots, deltas ni escrituras. Mantener el servicio Free/Local y no borrar/cerrar datos locales. Un dispositivo offline no se considera actualizado por no estar conectado; debe permanecer offline hasta cargar el bundle compatible.
3. **Fusionar y fijar la versión.** Solo con autorización posterior expresa, fusionar #593 a `main` manteniendo la ventana. Capturar el SHA completo resultante, verificar los tres hashes canónicos en ese checkout y esperar el deployment Production de ese SHA en estado `READY`. Si el deployment falla, mantener la pausa y detener SQL.
4. **Revisar transacciones.** Leer `pg_stat_activity` y `pg_locks` para `pos_sync_events` y `pos_change_seq`. Si existe una transacción financiera/sync larga, esperar su fin; no terminar sesiones a la fuerza. El lock global de B1 vuelve a drenar la carrera entre esta lectura y el inicio de DDL.
5. **Dry run canónico.** Ejecutar `.github/workflows/supabase-production-migrations.yml` manualmente en `main`, con `release_package=canonical`, `mode=DRY_RUN`, `expected_git_sha=<SHA completo de main>` y `expected_versions=20261124183143,20261124220046,20261125001528`. El workflow fija proyecto `odlrhijtfyavryeqivaa`, CLI 2.79.0 y comprueba el conjunto pendiente exacto. Si informa otra versión, drift, hash o SHA, cancelar el corte; no incluir migraciones ajenas.
6. **Aplicar el conjunto exacto.** Solo con autorización posterior expresa, ejecutar el mismo workflow con `mode=APPLY` y `apply_confirmation=APPLY 20261124183143,20261124220046,20261125001528`. El workflow vuelve a comparar remoto/checkout, repite dry-run y ejecuta `supabase db push --linked --yes` exclusivamente si el guard del conjunto exacto pasa. No ejecutar ese comando manualmente.
7. **No anunciar capacidad antes de B3.** La ejecución ordenada registra B1, luego B2, y B3 al final. B3 publica descubrimiento y cierra las rutas legacy en la misma transacción. Si B1/B2 falla, la capacidad no se anuncia. Si ya se aplicó B1 o B2, conservarlas y aplicar hacia adelante la siguiente versión pendiente; no intentar deshacer DDL a mano.
8. **Postflight.** Volver a consultar el ledger y hashes; comprobar recorder/helper/frontier, los siete lectores, los cinco RPC de snapshots, ACL/RLS, y que `pos_snapshot_sync_contract_v1` anuncia los cinco endpoints. En un entorno no productivo, probar una lectura autorizada de catálogo y un pull incremental aplazado. La inspección Production de este encargo no realizó escrituras ni llamadas de prueba.
9. **Reapertura escalonada.** Mantener fuera del Cloud a las terminales legacy/offline. En cada terminal online, aplicar la actualización PWA publicada y recargar una vez que B1+B2+B3 y el deployment estén `READY`; esto vuelve a ejecutar la hidratación inicial si había fallado antes del discovery. Las operaciones Outbox permanecen en IndexedDB y se reanudan con la identidad idempotente existente. Reabrir Cloud para el resto solo tras verificar actualización, snapshot/delta y Outbox en terminales representativas. Si una PWA no puede confirmar la build compatible, dejarla en modo local; no confiar en que Vercel refresque una pestaña abierta.

El paso 4 espera que las tres versiones sean el conjunto pendiente exacto. Si una ejecución parcial ya instaló B1, reanudar con una nueva corrida y `expected_versions=20261124220046,20261125001528`; si ya instaló B1+B2, usar `expected_versions=20261125001528`. La validación canónica rechaza versiones esperadas ya aplicadas y no permite arrastrar extras. Después de completar, `DRY_RUN` con `expected_versions=NONE` sirve para acreditar que no hay versiones pendientes.

## Compatibilidad, Outbox y reconciliación

- El cliente #593 puede publicarse antes que SQL sin caer a OFFSET: si no existe discovery, sus nuevas cargas iniciales fallan cerradas antes de abrir un recorrido durable o guardar su finalización. La hidratación se reintenta al iniciar después de que el contrato esté instalado; por eso cada instancia debe recargarse antes de salir de mantenimiento.
- B3 revoca exactamente los siete RPC legacy verificados en Production. Los clientes anteriores a #593 que los usen reciben denegación; no existe una barrera general `UPDATE_REQUIRED` ni una actualización PWA forzada para todas las RPC. La seguridad durante los intervalos B1/B2/B3 depende de la pausa global Cloud descrita arriba, y después de B3 depende de mantener fuera del Cloud las instancias legacy hasta actualizarlas. No asumir que una pestaña abierta o PWA instalada cambia al publicarse un deployment.
- #589 conserva Outbox local y permite reanudar los pendientes; #590 no usa ACK de escritura como cursor de descarga; #592 entiende lecturas aplazadas. La suite focal confirma que `UPDATE_REQUIRED` pausa operaciones por familia sin borrarlas y que `resumeUpdateRequired` reanuda las filas existentes. El rechazo de un snapshot legacy no cambia estado a `complete`.
- No reiniciar ni retroceder cursores globalmente. `cursor_ahead_of_safe_frontier` no descubre todas las omisiones antiguas. Al entrar el cliente compatible, los marcadores durables nuevos permiten una reconciliación de estado acotada por stream/actor/scope; luego el delta desde la referencia recupera cambios. El marcador completo evita volver a recorrer páginas. Cambios locales, Outbox, recepciones farmacéuticas y proyecciones más nuevas conservan sus protecciones. Esto reconcilia el estado cubierto por los cinco contratos; no afirma que detecte todo evento histórico fuera de su alcance.
- No se encontró purga de eventos en las funciones/cron inspeccionados. Mantener `pos_sync_events` desde cada referencia de snapshot hasta terminar su delta; una futura política de retención requerirá una señal de referencia expirada y recuperación antes de activarse.

## Fallos y recuperación

| Fallo | Acción segura |
| --- | --- |
| B1 alcanza `lock_timeout` | La transacción B1 revierte completamente. Mantener mantenimiento, revisar el bloqueador y reintentar el mismo archivo solo después del drenado. No aumentar timeout para forzarlo. |
| B2 o B3 falla después de migraciones previas | Mantener mantenimiento y deployment controlado; dejar las versiones exitosas instaladas y corregir hacia adelante con el conjunto pendiente exacto del workflow. No ejecutar un rollback DDL improvisado. |
| Fallo en discovery o ACL postflight | No reabrir Cloud. Corregir con una migración forward pequeña, conservar Outbox local y repetir postflight. |
| Deployment nuevo falla | Mantener el release detenido. B1/B2/B3 no se revierten; restaurar el bundle compatible mediante un deployment/release revisado. Antes de reabrir, demostrar que ese bundle no completa snapshots OFFSET; de lo contrario, conservar maintenance. |
| Dispositivo antiguo u offline regresa | No borrar su base ni Outbox. Cargar bundle compatible; permitir que su Outbox idempotente se reenvíe y que su snapshot/delta se complete con el contrato nuevo. |
| Reconciliación interrumpida | Reanudar desde su marcador durable y cursor opaco. No iniciar una descarga nueva por cambio normal de sesión y no retroceder cursores. |

La reversión de routing de Vercel no revierte SQL. Después de que un cliente use B2/B3, se requiere una corrección forward o probar por separado que cualquier restauración de grants/contrato no expone OFFSET ni invalida estado durable.

## QA y estado operativo

- **Código preparado:** B3 bloquea los RPC snapshot OFFSET para roles de cliente; el cliente nuevo falla cerrado si no se anuncia snapshot keyset. Se añadió cobertura PostgreSQL–Dexie de los cuatro deltas faltantes y del scheduler real tras rollback PostgreSQL sin Broadcast.
- **QA automatizado:** doce suites focales de snapshots, protocolo, migración de catálogo, repositorio de clientes, handlers, Outbox, lecturas aplazadas, metadata y actualización PWA: 189 pruebas pasadas; ESLint focal pasó. Build pasó con advertencias de bundle/importación y patrones PWA sin assets coincidentes.
- **QA SQL/integrado:** PostgreSQL 17.6 local, no Production. B1 drain/timeout; se aplicó el archivo candidato B3 exacto y se verificó que los siete RPC legacy niegan `anon` y `authenticated` pero conservan `service_role`; snapshots PostgreSQL–Dexie de clientes/crédito/ventas/caja; delta SQL real conectado a cada handler; transacción pendiente revertida, pull real aplazado, timer del scheduler y recuperación real sin Broadcast. El cliente nuevo que no descubre contrato no llama el RPC legacy ni marca la carga completa. No se ejecutó el bundle histórico #592 como aplicación completa ni se probó una pausa global sobre PWA físicas. La automatización no verifica que todos los dispositivos reales acaten esa pausa y actualicen.
- **Rendimiento:** no se repitió benchmark por los cambios focales de transición. Se conserva como referencia del Bloque 4 una carga integrada local de 12.08 s en una ejecución; no es p50/p95 ni representa Production.
- **QA manual:** no ejecutado; recorrido físico entre terminales sigue reservado para el cierre principal.
- **Production:** consultas de solo lectura y observación de deployment Vercel. Sin escritura, pausa, instalación, publicación ni activación.
- **Dictamen:** **APTO CON RESTRICCIONES** únicamente si el propietario puede hacer cumplir la pausa global Cloud durante toda la cadena y mantener fuera del servicio las terminales legacy/offline hasta confirmar su actualización. Si esa condición no puede garantizarse operativamente, **HOLD**: falta una barrera server-side que cierre el intervalo entre migraciones. Este PR sigue Draft, no está apto para merge/instalación por este reporte y no demuestra QA manual físico.
