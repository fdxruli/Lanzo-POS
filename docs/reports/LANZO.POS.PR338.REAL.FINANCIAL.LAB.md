# PR #338 — Laboratorio financiero integrado

Fecha: 2026-10-26 (America/Mexico_City). Alcance exclusivo: #338, sin escrituras en Production, sin merge y sin intervención sobre #352 ni FIN-01.

## Identificación y reproducción

- Main consultado: `52bb573e651529b323b6617e3161cd76ece14a39`.
- HEAD inicial de #338: `c1f449ae493184ed3e60278ec13dea599da88558`; el código certificado anterior era `51e25e3b1d6ef06d6fd16851ee5ac233a16f6f03`, y el commit intermedio solo modificó documentación.
- Rama: `feat/restaurant-split-flexible-payments-r1`; PR abierto y Draft al inicio.
- Production consultada: `odlrhijtfyavryeqivaa`; PostgreSQL 17.6. Las migraciones Split, 3D.1 y 3D.13 constaban en el ledger; 3D.14 no.
- Laboratorio: PostgreSQL 17.6 nativo Windows, puerto aislado de loopback, base desechable y datos exclusivamente sintéticos.
- [Instrucciones, fixture y límites](../../supabase/tests/fixtures/pr338-real-financial/README.md). El runner guarda SQL, logs, resultados y conteos en `PR338_LAB_EVIDENCE_DIR`.

## Causa y corrección

Con funciones financieras reales, un checkout válido `sale.cashier_inventory` llegaba a la hoja de inventario, que llamaba al wrapper público `cashier` con la clave interna terminada en `:cashier_core`. El guard 3D.14 esperaba la identidad de `sale.cashier`, aunque la operación autorizada era `sale.cashier_inventory`, y rechazaba el cobro. El intento revirtió: stock 20, ventas 0, pagos 0, movimientos de Caja 0, movimientos de inventario 0, deuda 0 y recibos 0. El mismo payload, con cuerpos reales anteriores al guard, confirmó venta, pago y movimiento, bajó stock a 18 y marcó la comanda pagada.

La corrección valida la identidad de inventario en la hoja interna y conserva el rate limit y el preflight de estación que aplicaba el wrapper `cashier` antes de invocar su implementación. No se relaja el guard público. El RPC antiguo y la hoja interna rechazan llamadas no autorizadas, incluidos IDs inconsistentes. Se probó una llamada válida dentro de una subtransacción y un rate limit bloqueado sin efectos financieros.

La migración ahora comprueba además la huella real de `pos_create_cloud_sale_cashier_inventory_legacy_r2b`: MD5 normalizado anterior `24843a289bbfdb692b4d18a10880c0b5`. Las cuatro huellas preexistentes no se modificaron. La comprobación nueva falla cerrada ante drift y el reemplazo exige una única coincidencia exacta. El SHA-256 del archivo Windows CRLF es `fb963acd5a83bd6389380fb19c4a1f9e27654c66ecd6862fec8b0a3a2a1540f7`; el blob Git con LF es `02eafa69f7a91343890ecc3cb2515cb37d4fcddb1de0f0fe187aa3db9a26a18b`.

Después de aplicar exclusivamente en PG17 aislado, el MD5 normalizado de la hoja adicional es `ff91cb7b166ecc8af7fa6caf795018a1` y su SHA-256 normalizado es `d9e4107172e97b18fe0b661c8d1a04a9d5d6bc5b8ed85939a72555d6504e7573`. Los otros cuatro hashes posteriores coinciden con los del informe 3D.14 previo.

## Dependencias y alcance real

| Dependencia | Origen / ejecución |
| --- | --- |
| Dispatcher, recibos y reserva de idempotencia | Definiciones activas de catálogo y migración 3D.14 del PR; ejecutados en PG17. |
| Actor, sesión, dispositivo, permisos, estación y Caja | Cuerpos activos y tablas sintéticas con constraints, RLS y permisos del catálogo; positivos también con rol API `anon`. |
| Cashier, Cashier con inventario y Split | Wrappers, hojas y helpers reales del catálogo; el parche de 3D.14 modifica la delegación interna de inventario como se describe arriba. |
| Pagos, movimientos y sesión de Caja | Tablas, triggers y funciones reales; comprobación de importes y estación persistidos. |
| Productos, lotes, asignación, descuento y movimientos | Tablas, índices, constraints, triggers y hojas reales. Las carreras usan stock directo; una venta adicional con lote real descuenta producto y lote de 20 a 18 y persiste un movimiento, sin duplicar en replay. |
| Crédito, ledger, abono inicial y abono independiente | Funciones y tablas reales vigentes, sin FIN-01; se comprueban deuda, movimientos y replay. |
| Cancelación y reversa | Preview, autorización, hoja de cancelación, Caja, inventario y ledger reales. |
| pgcrypto | Extensión real; el laboratorio no simula escrituras financieras. |

El snapshot de solo esquema incluye 40 tablas, sus constraints, índices, triggers y políticas RLS, y 267 funciones verificadas por SHA-256 y MD5 normalizados contra `function-hashes.json`. Sus definiciones se recuperaron mediante catálogo; no se copiaron filas financieras de Production. No se invocó ni simuló `realtime.send` porque los dispositivos sintéticos no tienen topic. El helper ecommerce de reservas no usado por estas rutas no se instaló; el servicio Realtime y el flujo ecommerce quedan fuera del alcance.

## C11

| Caso | Autoridad y efectos | Resultado |
| --- | --- | --- |
| A Admin | Dispatcher y venta con inventario real, rol API, pago, Caja, stock, recibo y cierre de comanda ready. | PASS |
| B Staff autorizado | Dispatcher y Split real, rol API, dos pagos/ventas hijas, Caja, stock, recibo y cierre. | PASS |
| C sin POS | `POS_PERMISSION_DENIED`; conteos financieros y stock sin cambios. | PASS |
| D sesión vencida | `STAFF_SESSION_EXPIRED`; sin efectos financieros. | PASS |
| E dispositivo inválido | `DEVICE_NOT_ALLOWED`; sin efectos financieros. | PASS |
| F tenant ajeno | Comanda de A no encontrada bajo B; sin efectos. | PASS |
| G otra estación | `CASH_SESSION_STATION_MISMATCH`; sin efectos. | PASS |
| H otro actor | El recibo devuelve `NOT_FOUND` para el actor/dispositivo ajeno. | PASS |

Las pruebas de cierre operativo usan comandas activas en `ready`: terminan `paid/delivered` con `checkout_closed_at`. Para una comanda `pending`, el contrato anterior de checkout normal permite `paid` y mantiene cocina visible hasta terminar; no se cambia ni se presenta como cierre operativo.

## C12: carreras con stock suficiente

Se usaron sesiones PostgreSQL independientes. En las dos carreras dirigidas se observó al perdedor esperando el advisory lock; en la simultánea ambas sesiones esperaron una barrera antes de liberarse.

| Carrera | Stock inicial | Ganador | Ventas | Pagos | Movimientos Caja / inventario | Stock final | Comanda |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Normal primero | 20 | Normal | 1 | 1 | 1 / 1 | 18 | paid, delivered, cierre registrado |
| Split primero | 20 | Split | 2 hijas | 2 | 2 / 2 | 18 | paid, delivered, cierre registrado |
| Salida simultánea | 20 | Split en esta ejecución | 2 hijas | 2 | 2 / 2 | 18 | paid, delivered, cierre registrado |
| Replay y clave nueva | 20 | Mismo ganador | Sin duplicados | Sin duplicados | Sin duplicados | 18 | Sin segundo settlement |

En Split las dos ventas y movimientos representan las dos partes del mismo cobro, no dos liquidaciones. El stock disponible permitía materialmente ambas solicitudes. Se compararon efectos persistidos. Los replays normal y Split devuelven el mismo recibo; otra identidad financiera se rechaza.

## Caja, crédito y reversa

| Operación | Antes → después y efectos persistidos | Resultado |
| --- | --- | --- |
| Cashier sin inventario | Servicio sin stock: una venta, un pago y un movimiento de Caja; cierre de comanda y replay sin duplicación. | PASS |
| Efectivo con cambio | Venta 20, recibido 25, cambio 5; pago 20 y movimiento de Caja 20 en estación A. | PASS |
| Tarjeta | Venta/pago 20; sin movimiento de efectivo. | PASS |
| Mixto | Efectivo 8 recibido 10, cambio 2, tarjeta 12; movimiento de Caja 8. | PASS |
| Fiado completo | Deuda 0 → 20, un cargo de ledger, stock 20 → 18; replay y segunda identidad sin duplicar. | PASS |
| Fiado parcial y abono inicial | Venta 20, abono 5, deuda 15, cargo 20 y pago -5 en ledger, movimiento de Caja 5 y stock 18. | PASS |
| Abono independiente | Deuda 20 → 15; un pago ledger, un movimiento de Caja 5 y replay sin duplicación. | PASS |
| Cancelación autorizada | Fiado parcial: deuda 15 → 0, stock 18 → 20, contrapartidas de cargo y pago, reversa de Caja 5 y una cancelación. | PASS |
| Denegación y replay de cancelación | Staff sin refunds obtiene `POS_PERMISSION_DENIED:refunds`; la repetición autorizada conserva recibo y no duplica efectos. | PASS |

El recibo legacy de inventario se recuperó usando los registros persistidos por la hoja real sin repetir efectos. Una venta sin mesa se confirmó y reprodujo sin duplicación. También se creó un caso sintético de venta confirmada antes del cierre: Split se rechazó con `RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED` y sin nuevos efectos.

## Gates

El éxito del laboratorio se limita a los escenarios enumerados; no certifica Realtime, los siete casos históricos ni QA física. La nueva versión de 3D.14 toca una quinta función, por lo que el procedimiento previo de despliegue selectivo debe revisarse y volver a comprobar sus cinco hashes, atributos y ACL, además de backup/restauración. Ninguna prueba autoriza instalarla en Production.

`PRODUCTION_WRITES=NO`; `MERGE_EXECUTED=NO`; `PR338_PRODUCTION_MIGRATION_GATE=HOLD_OWNER_REVIEW_AND_RECOVERY`; `PR338_PRODUCTION_QA_GATE=HOLD`; `PR338_MERGE_READINESS=NO`. La conciliación histórica de siete comandas sigue siendo evidencia previa de solo lectura y debe revalidarse antes de cualquier intervención.
