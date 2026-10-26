# PR #338 — Certificación financiera final y gate 3D.14

Fecha de corte: 2026-10-26. Moneda de la conciliación: MXN.
Alcance: PR #338 únicamente. No se modificaron #352 ni FIN-01.

## Decisión

**PR338_FINAL_CERTIFICATION_STATUS=PR338_PARTIAL_WITH_EXACT_BLOCKERS**

La regresión de replay legacy fue corregida y el helper de 3D.14, la ruta de Auth real del fixture y la instalación/fallo transaccional de la migración pasaron en PostgreSQL 17.6 aislado. La Preview del candidato está READY.

La certificación financiera integrada sigue parcial: C11 no invoca las hojas reales de venta/Caja/crédito/inventario; C12 no ejecuta carreras con inventario real; los efectos de efectivo, crédito, abono inicial y reversas no fueron invocados. No se autoriza instalar 3D.14 ni hacer QA financiera Productiva con esta evidencia.

## A. Identificación y alcance

| Campo | Valor |
| --- | --- |
| Repositorio / PR | fdxruli/Lanzo-POS / [#338](https://github.com/fdxruli/Lanzo-POS/pull/338) |
| Rama | feat/restaurant-split-flexible-payments-r1 |
| PR338_HEAD_INITIAL | 8350cf6e3756861720a1bfb35bc28bc91f3a0ab8 |
| PR338_HEAD_FINAL | 51e25e3b1d6ef06d6fd16851ee5ac233a16f6f03 |
| PR338_CERTIFIED_CODE_SHA | 51e25e3b1d6ef06d6fd16851ee5ac233a16f6f03 |
| MAIN_HEAD / PR base | 52bb573e651529b323b6617e3161cd76ece14a39 |
| PR338_STATE | OPEN / Draft |
| PR338_MERGEABILITY | mergeable=true; mergeStateStatus=unstable mientras siguen en curso los workflows repetidos |
| PREVIEW_SHA | 51e25e3b1d6ef06d6fd16851ee5ac233a16f6f03 |
| PREVIEW_URL | [https://lanzo-ai9xr3lmr-fdxrulis-projects.vercel.app](https://lanzo-ai9xr3lmr-fdxrulis-projects.vercel.app) |
| PREVIEW_STATUS | READY; no promovida |
| SUPABASE_PROJECT | odlrhijtfyavryeqivaa |
| PostgreSQL Production | 17.6; 332 migraciones registradas |
| PRODUCTION_WRITES | NO |
| MERGE_EXECUTED | NO |
| PR352_UNMODIFIED / FIN01_UNMODIFIED | YES / YES |

El SHA de la tabla identifica el código y las pruebas certificadas. La publicación de este informe es un commit documental posterior; el SHA actual de la punta del PR se confirma en GitHub al entregar.

## B. C11 — autoridad real de Auth

El fixture ejecuta cuerpos reales de las funciones de entitlement, sesión Admin, sesión Staff, dispositivo, permisos, resolución de actor, estación de Caja y guard 3D.14, extraídos de las migraciones del repositorio. Las licencias, dispositivos, tokens y hashes de sesión son sintéticos; no se usaron sesiones Productivas.

| Caso | Actor y contexto | Resultado | Efectos financieros |
| --- | --- | --- | --- |
| C11-A | Admin sintético autorizado; sesión, dispositivo, permiso y estación reales del fixture | Pasa validación, permiso, estación y guard | No se invocó la hoja financiera |
| C11-B | Staff sintético autorizado; sesión, permiso, estación y K/H en processing | Pasa validación, permiso, estación y guard | No se invocó la hoja financiera |
| C11-C | Staff autenticado sin permiso POS | Rechazado por POS_PERMISSION_DENIED | Conteos de venta, recibo, operación, Caja, pago, inventario y crédito iguales |
| C11-D | Sesión Staff caducada | Rechazada por STAFF_SESSION_EXPIRED | Mismos conteos, comprobados inmediatamente |
| C11-E | Dispositivo desconocido y sesión Staff revocada | Rechazados por DEVICE_NOT_ALLOWED y ACTOR_SESSION_INVALID | Mismos conteos después de cada rechazo |
| C11-F | Tenant B intenta usar el padre/recibo de A | Rechazado, sin resolver el recibo de otro tenant | Mismos conteos |
| C11-G | Sesión de Caja ligada a otra estación | Rechazada por CASH_SESSION_STATION_MISMATCH | Mismos conteos |
| C11-H | Otro Staff autorizado intenta reproducir el recibo del actor original | Rechazado por el guard de actor/dispositivo/sesión | Mismos conteos |

Resultado: **PR338_C11_REAL_AUTH_STATUS=PARTIAL**. La cadena real de autorización y guard pasó; el positivo no ejecutó el settlement completo ni probó que las hojas reales de venta, efectivo, crédito e inventario liquiden con ese actor.

## C. C12 — inventario real

| Carrera requerida | Stock inicial suficiente | Operación ganadora | Ventas / stock final / movimientos |
| --- | --- | --- | --- |
| Normal gana frente a Split | NOT TESTED | NOT TESTED | Sin datos: no se ejecutaron hojas reales |
| Split gana frente a normal | NOT TESTED | NOT TESTED | Sin datos: no se ejecutaron hojas reales |
| Dos solicitudes simultáneas en dos dispositivos y Cajas | NOT TESTED | NOT TESTED | Sin datos: no se ejecutaron hojas reales |
| Reintento del ganador y nueva clave del perdedor | NOT TESTED | NOT TESTED | Sin datos: no se ejecutaron hojas reales |

**PR338_C12_REAL_INVENTORY_STATUS=NOT_TESTED.** El fixture disponible no instala los contratos reales de productos, lotes, reservas, asignación de stock y hojas de venta/inventario necesarios para esta carrera. Las pruebas que llaman al dispatcher con hojas controladas no demuestran que el inventario Productivo se descuente una sola vez. El siguiente bloqueo concreto es construir un fixture PG17 aislado con esas definiciones y sus constraints, y ejecutar ambas órdenes de carrera con stock suficiente.

## D. Efectos financieros integrados

| Área | Contrato/hoja real ejecutada en esta intervención | Estado | Límite |
| --- | --- | --- | --- |
| Caja: efectivo, tarjeta, mixto, movimiento y totales | No | NOT_TESTED | La conciliación histórica es SELECT; no es una prueba de escritura |
| Crédito y deuda | No | NOT_TESTED | No se ejecutó la hoja de crédito |
| Abono inicial y saldo restante | No | NOT_TESTED | No se ejecutó la hoja de abono |
| Cancelación y reversas | No | NOT_TESTED | No se ejecutaron reversas de efectivo, inventario o crédito |
| Idempotencia | Guard 3D.14 y checker R2B real en fixture sintético | PARTIAL | Replay mismo hash, conflicto por hash distinto, expiración de recibo, actor/dispositivo/sesión/tenant y recibos incompletos; sin settlement financiero integrado |

**PR338_FINANCIAL_INTEGRITY_STATUS=PARTIAL**
**PR338_CONCURRENCY_STATUS=PARTIAL** — C1–C10 conservan evidencia PASS de la certificación anterior y no se repitieron porque este cambio solo afecta el guard/replay legacy. C12 permanece sin probar con inventario real.

## E. Conciliación de las siete comandas, solo lectura

Corte de Production: 2026-10-26 23:37 UTC. Los IDs de comanda y los folios están sustituidos por referencias O-xx y F-xxxxxxxx. Se encontró una sola venta ligada a cada comanda, una fila de pago y un movimiento de Caja por venta; pago y movimiento igualan el total vendido. Total de ventas: **MXN 240.00**. No se encontraron referencias adicionales a la comanda en metadatos de otras ventas/órdenes, conflictos de sync, filas de ledger de cliente ni cancelaciones formales de venta.

| Caso / folio enmascarado | Orden: estado, pago, total, actualizado | Venta única | Pago / Caja / sesión | Inventario | Clasificación y propuesta individual |
| --- | --- | --- | --- | --- | --- |
| O-01 / F-ec1f213b | delivered; payment_status NULL; 31; 2026-07-02 | 31 | 31 / 31, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 0 movimientos; not_required; artículo not_applied | **A**. Efectos monetarios coherentes. Verificar con el propietario que procede cerrar el estado operativo usando la venta existente y su recibo; no crear otro cobro. |
| O-02 / F-867c4167 | delivered; payment_status NULL; 31; 2026-07-02 | 31 | 31 / 31, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 0 movimientos; not_required; artículo not_applied | **A**. Mismo paso que O-01; validar el cierre operativo con el propietario, sin nueva venta. |
| O-03 / F-e016043b | delivered; payment_status NULL; 22; 2026-07-02 | 22 | 22 / 22, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 1 movimiento, cantidad 1; artículo aplicado | **A**. Confirmar recibo y movimiento; solo entonces usar el flujo autorizado para recuperar el cierre. |
| O-04 / F-a56cd4d5 | delivered; payment_status NULL; 33; 2026-07-02 | 33 | 33 / 33, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 1 movimiento, cantidad 1; dos líneas de venta muestran applied y not_applied | **E** para inventario: falta el motivo de not_applied. Revisar política de stock/producto y movimiento antes de decidir cierre; no repetir venta. |
| O-05 / F-f6d40886 | delivered; payment_status NULL; 112; 2026-07-02 | 72 | 72 / 72, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 1 movimiento, cantidad 1; estados applied y not_applied | **E** para el remanente de 40. Hay una línea de 40 marcada cancelled_at, pero conserva status delivered y no hay cancelación formal de venta. Confirmar autorización/historial de esa línea y saldo real con el propietario; no cobrar 112 ni alterar estado. |
| O-06 / F-91720ee1 | delivered; payment_status NULL; 50; 2026-07-02 | 30 | 30 / 30, 1 movimiento venta; Caja cerrada; 2 recibos legacy completos con hash/respuesta | 1 movimiento, cantidad 1; línea vendida aplicada | **E** para el remanente de 20. Una línea de 20 está marcada cancelled_at pero sigue delivered y no hay cancelación formal de venta. Confirmar historial y saldo con el propietario; no generar una segunda venta. |
| O-07 / F-870de0d4 | pending; payment_status NULL; 21; 2026-10-02 | 21 | 21 / 21, 1 movimiento venta; Caja abierta; 2 recibos legacy y 1 K/H de sale.cashier_inventory completos | 1 movimiento, cantidad 1; artículo aplicado | **E** por estado operativo: la orden/artículo siguen pending pese al settlement. Revisar cumplimiento y sesión de Caja con el propietario; resolver mediante el recibo existente, no repetir cobro ni cerrar Caja aquí. |

Auditoría adicional: no hay filas en pos_sale_cancellations para estas ventas. Todas tienen eventos de auditoría de venta; hay 0 conflictos de sincronización. Conteos de eventos sync por O-01 a O-07: 9, 6, 6, 8, 8, 8 y 3. Las siete ventas históricas permanecen sin modificar.

**PR338_HISTORICAL_7_ORDERS_STATUS=COMPLETE_READ_ONLY.** Se clasificaron las siete con sus límites exactos; O-04 a O-07 requieren una decisión o evidencia adicional antes de cualquier recuperación. No se infiere que una comanda se deba cerrar por el solo hecho de tener una venta.

## F. SQL 3D.14, seguridad y compatibilidad

Archivo: [20261026214837_restaurant_sale_dispatcher_guard_3d14.sql](../../supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql)
SHA-256: 74EA2507EA678CF4CE7F2F15D9BE454B827AEE68E7B4EC4C9D23A336A4E28D36

Funciones cuyo contrato se verifica al instalar:
- pos_execute_financial_operation_v1: 148918104b257982e3809a880bda7177
- pos_create_cloud_sale_cashier: 653ad817084920aa6adc1a60266ef37c
- pos_create_cloud_sale_cashier_inventory: 0c9dd22833c208dc20d78dd14bfd005d
- pos_create_cloud_sale_credit: 59977522691c4008711e4361bcb1e0bd

Los cuatro cuerpos Productivos se cotejaron por hash inmediatamente antes de la certificación; owner postgres, SECURITY DEFINER, search_path vacío. Sus ACL vigentes incluyen owner, anon, authenticated y service_role; la instalación aislada confirmó que CREATE OR REPLACE preserva esos grants. El helper nuevo es SECURITY INVOKER, owner postgres, search_path vacío y solo EXECUTE del owner. La migración no crea tablas ni cambia RLS, rate limits o datos.

La migración se instaló correctamente en una base desechable PostgreSQL 17.6 a partir de los cuatro cuerpos activos con hashes verificados. Huellas resultantes para verificar después de una aplicación futura:

| Función | MD5 normalizado después de instalar 3D.14 |
| --- | --- |
| pos_execute_financial_operation_v1 | 9c92bd0ad3dcbab07f3a02d46ce820e0 |
| pos_create_cloud_sale_cashier | 3ce63cdd05c3877d0e7cc4b58079aef2 |
| pos_create_cloud_sale_cashier_inventory | f5a3b1587f65e73e04aa16121881f764 |
| pos_create_cloud_sale_credit | f1e7e82ef7c789389db37b375c42982e |

Compatibilidad legacy probada en fixture: un recibo exacto, completo y ligado a actor/dispositivo/sesión puede llegar al checker R2B; R2B conserva la comprobación de hash y conflicto. Se cubrieron cashier, cashier_inventory, credit y el indicador legacy cloudInventoryEffects. Recibo faltante/incompleto, tenant, actor, dispositivo o sesión distintos se rechazan. Una venta no Restaurante no entra al guard. No se ejecutaron las hojas de los tres RPC completos.

| Instalación aislada / fallo | Resultado |
| --- | --- |
| Aplicación exacta con los cuatro hashes Productivos | PASS; BEGIN/COMMIT completo |
| Hash de función alterado | Falla con RESTAURANT_3D14_FUNCTION_DRIFT antes de crear el helper |
| Función requerida ausente | Falla con RESTAURANT_3D14_FUNCTION_DRIFT |
| Rol sin ser owner de las funciones | Falla por permisos; la transacción revierte el helper creado previamente |
| Error forzado después del DDL y antes de COMMIT | Rollback; helper ausente |
| Conexión terminada durante espera antes de COMMIT | Transacción interrumpida; helper ausente |
| Reaplicar tras instalar | Falla cerrada por drift; la instalación existente permanece intacta |

**PR338_3D14_SQL_STATUS=PASS_ISOLATED**
**PR338_3D14_LEGACY_COMPATIBILITY=PARTIAL** — el contrato de replay pasó, pero no se invocó cada wrapper completo.
**PR338_3D14_NON_RESTAURANT_REGRESSION=PARTIAL** — se comprobó el retorno del guard para una venta ordinaria; tienda, farmacia, verdulería y hojas sin mesa no se liquidaron de extremo a extremo.

## G. Aplicación selectiva y recuperación Productiva

Production registra Split 20260929091708, Atomic Settlement 20261006224032 y Origin Cancel 20261008030859. 3D.14 no está registrada. Los timestamps locales/Productivos de 3D.1 y 3D.13 difieren; no se debe usar db push general ni migration repair.

Procedimiento propuesto para revisión del propietario:
1. Congelar la propuesta al SHA de código certificado y confirmar proyecto odlrhijtfyavryeqivaa, nombre/ruta de la migración y SHA-256 indicado arriba.
2. En la misma ventana, volver a consultar el ledger, los cuatro hashes, owners, SECURITY DEFINER, search_path, ACL y sesiones de operación. Cualquier drift cancela la aplicación.
3. Obtener aprobación del dueño/custodio, ventana de mantenimiento y evidencia de recuperación.
4. Cuando exista esa aprobación, aplicar solo el SQL exacto mediante la herramienta de aplicación de migraciones de Supabase, con nombre restaurant_sale_dispatcher_guard_3d14. Confirmar la nueva entrada con list_migrations y SELECT de supabase_migrations.schema_migrations; si no hay registro exacto, detenerse. No usar SQL Editor para saltar el ledger ni insertar/repair versiones a mano.
5. Antes de admitir QA, consultar los cuatro hashes resultantes, atributos/ACL del helper, grants de RPC, que 3D.14 esté en el ledger y que las rutas de venta directa y dispatcher respondan a sus casos de guard/receipt. No ejecutar cobros como verificación de SQL.

El cambio es una transacción de reemplazo de funciones. Un error o interrupción anterior a COMMIT revierte todo, probado en PG17.6. Después de COMMIT, restaurar la definición anterior exige una restauración documentada de funciones o una corrección hacia adelante; restaurar un backup de base completo también puede descartar transacciones posteriores. Antes de GO se necesita un backup/punto de recuperación de Production y prueba de restauración a un proyecto aislado, custodiados por el propietario. No se creó ningún backup ni proyecto restaurado en esta intervención.

**PR338_SELECTIVE_MIGRATION_PLAN=READY_FOR_OWNER_REVIEW**
**PR338_BACKUP_RECOVERY_GATE=HOLD_BACKUP_RECOVERY**
La documentación de Supabase indica que las migraciones remotas deben pasar por un flujo que mantenga el ledger, y que el SQL Editor lo omite. La recuperación administrada se revisa en [Database Backups](https://supabase.com/docs/guides/platform/backups); el mecanismo de [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project) crea una copia solo de base de datos y requiere reconfigurar otros servicios.

## H. CI, Preview y QA

Pruebas de esta intervención:
- Helper 3D.14 + checker R2B, PostgreSQL 17.6 fresco: PASS.
- Auth/station guard real, PostgreSQL 17.6 fresco, aserción de conteos tras cada rechazo: PASS.
- Migración completa + pruebas de error/rollback/reinstalación descritas arriba: PASS.
- node --check para ambos runners y git diff --check: PASS.
- C1–C10: evidencia previa conservada; no se repitió la suite completa.
- No se ejecutó npm build local ni se repitió C1–C10 en PG17. GitHub Actions sí ejecutó los builds y la comparación global PR127 para el SHA exacto.

CI del SHA de código certificado 51e25e3b1d6ef06d6fd16851ee5ac233a16f6f03:
- PR127 Global Comparison: SUCCESS para el SHA exacto. Artefacto comparativo: 92 fallos compartidos, 0 fallos exclusivos del candidato, 0 fallos nuevos, 0 identidades sin resolver y 7 fallos resueltos ([workflow](https://github.com/fdxruli/Lanzo-POS/actions/runs/40421274462)).
- Shared Terminal Actor Runtime: IN_PROGRESS; builds/lint y suite focalizada PASS, observación repetida base/candidato aún activa ([workflow](https://github.com/fdxruli/Lanzo-POS/actions/runs/40421274414)).
- Shared Terminal Actor Scoped Storage: IN_PROGRESS; builds/lint, POS, tenant, sincronización y almacenamiento focalizados PASS, observación repetida base/candidato aún activa ([workflow](https://github.com/fdxruli/Lanzo-POS/actions/runs/40421274564)).
- Incident Recovery QA Lab, Ecommerce Public Phase 4, HOTFIX Dexie Recovery, FREE Local Product Authority, Store Git Runtime y Customer Messaging Phase 4: SUCCESS.
- No se atribuye un resultado al SHA anterior.

Gates finales:
- PREVIEW_UI_READY=YES para el deployment READY del SHA certificado.
- PRODUCTION_SQL_READY=NO mientras falte el gate de backup/restore.
- PRODUCTION_FINANCIAL_QA_GO=NO.
- OWNER_QA_STATUS=PENDING; doce casos manuales existentes siguen sin ejecutar.
- MERGE_READINESS=NO; PR sigue Draft.

Después de superar C12, las hojas financieras y los gates de backup/restore, ejecutar QA-338-01 a QA-338-12 solo en el negocio QA autorizado. La Preview de esta rama ha estado conectada a Production según el registro anterior; no enviar cobros desde ella hasta que el propietario confirme el destino y habilite el gate. La matriz existente cubre importes, comensales/artículos, entrada decimal móvil, efectivo/cambio, pago mixto, Fiado, abono, cancelación/reversa, conciliación de Caja, inventario, dos dispositivos y replay por recibo. QA-338-11 debe ser secuencial; la carrera con inventario suficiente se certifica en PostgreSQL aislado, no mediante dos cobros Productivos.

## I. Estados finales

| Estado | Resultado |
| --- | --- |
| PR338_FINAL_CERTIFICATION_STATUS | PR338_PARTIAL_WITH_EXACT_BLOCKERS |
| PR338_C11_REAL_AUTH_STATUS | PARTIAL |
| PR338_C12_REAL_INVENTORY_STATUS | NOT_TESTED |
| PR338_REAL_CASH_EFFECTS_STATUS | NOT_TESTED |
| PR338_REAL_CREDIT_EFFECTS_STATUS | NOT_TESTED |
| PR338_REAL_INITIAL_PAYMENT_STATUS | NOT_TESTED |
| PR338_REAL_REVERSAL_STATUS | NOT_TESTED |
| PR338_REAL_IDEMPOTENCY_STATUS | PARTIAL |
| PR338_FINANCIAL_INTEGRITY_STATUS | PARTIAL |
| PR338_CONCURRENCY_STATUS | PARTIAL |
| PR338_3D14_SQL_STATUS | PASS_ISOLATED |
| PR338_3D14_LEGACY_COMPATIBILITY | PARTIAL |
| PR338_3D14_NON_RESTAURANT_REGRESSION | PARTIAL |
| PR338_HISTORICAL_7_ORDERS_STATUS | COMPLETE_READ_ONLY |
| PR338_SELECTIVE_MIGRATION_PLAN | READY_FOR_OWNER_REVIEW |
| PR338_BACKUP_RECOVERY_GATE | HOLD_BACKUP_RECOVERY |
| PR338_CI_STATUS | PARTIAL_REPEATED_WORKFLOWS_IN_PROGRESS |
| PR338_PR127_STATUS | SUCCESS_NO_NEW_FAILURES |
| PR338_PREVIEW_STATUS | READY |
| PR338_PRODUCTION_FINANCIAL_QA_GO | NO |
| PR338_OWNER_QA_STATUS | PENDING |
| PR338_MERGE_READINESS | NO |
| PR352_UNMODIFIED | YES |
| FIN01_UNMODIFIED | YES |
| NEW_REGRESSIONS | NONE_FOUND_IN_TESTED_SCOPE |
| PRODUCTION_WRITES | NO |
| MERGE_EXECUTED | NO |
| NEXT_RECOMMENDED_ACTION | Completar la fixture PG17 con inventario/hojas reales y certificar caja/crédito/abonos/reversas; obtener backup/restore autorizado; entonces revisar aplicación selectiva 3D.14 antes de QA física |

Bloqueadores exactos para continuar: C12 requiere hojas reales de inventario y dos carreras competidoras con stock suficiente; las hojas reales de efectivo, crédito, abonos y reversas aún no corrieron; falta evidencia autorizada de backup/restauración; los workflows de observación repetida Actor Runtime y Actor Scoped Storage siguen IN_PROGRESS para el SHA certificado. PR127 sí terminó SUCCESS, con 0 fallos nuevos o exclusivos del candidato. Ninguno de estos pasos requiere modificar Production.
