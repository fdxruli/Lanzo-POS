# PR #338 — certificación financiera 3D.14 y gate de QA

Fecha: 2026-10-26. Repositorio: `fdxruli/Lanzo-POS`. Rama objetivo: `feat/restaurant-split-flexible-payments-r1`. Main observado: `52bb573e651529b323b6617e3161cd76ece14a39`. HEAD inicial de #338: `0e6d148b047cae973a63355f336e84b5b956d7fb`.

**Decisión:** `PR338_HOLD_WITH_EXACT_BLOCKERS`; `PR338_PRODUCTION_QA_HOLD`. Esta revisión no hizo escrituras en Production, no instaló SQL remoto y no ejecutó cobros reales. #352 y FIN-01 no se modificaron.

## Hallazgo P0 y corrección preparada

Las funciones activas de Production para `public.pos_execute_financial_operation_v1`, `private.lock_restaurant_order_settlement_v1`, `private.execute_split_sale_financial_v1` y el cierre de mesa coinciden con los cuerpos cargados en PostgreSQL 17 aislado. La ruta normal moderna comparte el lock y cierra la mesa en la misma transacción. Sin embargo, los RPC públicos `pos_create_cloud_sale_cashier`, `pos_create_cloud_sale_cashier_inventory` y `pos_create_cloud_sale_credit` siguen admitiendo clientes antiguos y delegan sin adquirir el lock Restaurante.

Se reprodujo una venta normal ya confirmada con la comanda todavía `unpaid`: un Split nuevo creó dos ventas hijas adicionales. En Production, un SELECT encontró **siete** comandas activas sin cierre/pago marcado pero con venta existente; total comercial de esas ventas: **$240.00**. Sus ventas son anteriores a 3D.1. No se tocaron esos registros.

La migración selectiva [3D.14](../../supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql) añade:

1. Un guard privado para impedir que los tres RPC de venta públicos liquiden una mesa reconocible fuera de un `pos_financial_operations` en estado `processing`, con identidad de operación, actor, dispositivo y caja verificados por el servidor.
2. Un rechazo en el dispatcher para una venta previa ligada al padre por `id` o `local_sale_id`, incluso si la venta fue marcada como eliminada. El reintento del mismo K/H conserva el recibo porque la lectura de `completed` ocurre antes del guard.
3. Rechazo de `sale.id` y `local_sale_id` divergentes cuando el segundo identifica una mesa, evitando una vía que escaparía del lock.
4. Precondiciones de hash de los cuatro cuerpos activos antes de reemplazarlos, transacción explícita, `search_path` seguro y preservación de los grants existentes por `CREATE OR REPLACE`.

La migración fue generada con Supabase CLI y compiló en PostgreSQL 17 aislado. Un segundo intento de aplicación abortó con `RESTAURANT_3D14_FUNCTION_DRIFT`, como se espera para una aplicación selectiva ya consumida. **No usar `supabase db push` ni `migration repair`:** los timestamps locales de 3D.1 y 3D.13 difieren de Production aunque sus cuerpos ya instalados fueron cotejados.

## Matriz de concurrencia de esta intervención

El informe histórico 3D enumera escenarios de aceptación, pero no contiene doce IDs originales. La suite 3D.13 registró ocho carreras, de las cuales dos eran normal/Split. C1–C12 son la matriz explícita de esta intervención, sin atribuirle falsamente los ocho PASS anteriores.

| ID | Caso | Estado | Evidencia y límite |
| --- | --- | --- | --- |
| C1 | Normal gana, Split intenta después | PASS aislado | Dos sesiones; una venta, pago y movimiento; Split rechazado. |
| C2 | Split gana, normal intenta después | PASS aislado | Dos ventas hijas; normal rechazado sin venta padre. |
| C3 | Solicitudes concurrentes | PASS aislado | PostgreSQL 17 con dos procesos `psql`; lock real y espera transaccional en ambos órdenes. |
| C4 | COMMIT y respuesta perdida | PASS aislado | Receipt `COMPLETED` y replay mismo K/H devolvieron el mismo resultado; ningún efecto adicional. |
| C5 | Venta confirmada, cierre pendiente | PASS de contención; HOLD de recuperación histórica | Sin 3D.14 se reprodujo el doble cobro; con 3D.14 se rechaza Split. Las siete mesas históricas requieren conciliación de solo lectura y una decisión operativa posterior. |
| C6 | Dos Split simultáneos | PASS aislado | Dos dispositivos, cajas, claves e IDs hijos distintos; una sola pareja de ventas. |
| C7 | Mesa pagada | PASS aislado | `RESTAURANT_ORDER_ALREADY_PAID`; ventas, pagos, Caja y K/H sin cambio. |
| C8 | Mesa cancelada | PASS aislado | `RESTAURANT_ORDER_ALREADY_CANCELLED`; cero efectos nuevos. |
| C9 | Versión anterior | PASS aislado | `RESTAURANT_ORDER_VERSION_CONFLICT`; cero efectos nuevos. |
| C10 | Dos cajas | PASS aislado | A usa estación/caja A y B estación/caja B; una liquidación. |
| C11 | Actores distintos y permisos | REQUIRES_RETEST | El proveedor Auth del fixture es doble; no certifica sesión Staff real ni autoridad multitenant. |
| C12 | Stock suficiente para ambas ventas | NOT_TESTED | Las hojas de inventario del fixture son dobles; la carrera no prueba inventario real. |

La base aislada ejecutó los cuerpos activos de dispatcher, lock, Split, cierre, reserva/completado K/H y receipt. Los dobles restantes son Auth y hojas de venta/Caja/inventario/crédito. Se compararon ventas, pagos, movimientos de Caja, K/H y estado de comanda en los casos ejecutados. **No se certifican aún** descuentos reales de inventario, deuda, abonos, reversas ni recibos derivados de las hojas financieras completas. El guard bloquea antes de llamarlas, pero la certificación integrada solicitada exige evidencia adicional.

## Idempotencia, seguridad y catálogo

- Mismo K/H: recibo idéntico y una venta. K igual con payload/hash distinto: `IDEMPOTENCY_CONFLICT`. Receipt de otro dispositivo: `NOT_FOUND`. Venta nueva sobre mesa pagada/cancelada: rechazo antes de efectos.
- Los tres RPC públicos admiten `anon` y `authenticated`; las variantes `_unlimited` y `_legacy_r2b` no admiten esos roles. El nuevo helper revoca `EXECUTE` a `public`, `anon`, `authenticated` y `service_role`.
- Los cuerpos auditados de Production son `SECURITY DEFINER` con `search_path=''`. La tabla K/H usa RLS y no concede escritura a clientes normales. La migración no desactiva RLS ni modifica saldos.
- Los hashes normalizados únicamente por CR de los wrappers activos son `653ad817084920aa6adc1a60266ef37c`, `0c9dd22833c208dc20d78dd14bfd005d` y `59977522691c4008711e4361bcb1e0bd`. Dispatcher: `148918104b257982e3809a880bda7177`.
- Production registra Split `20260929091708`, Atomic 3D.1 `20261006224032` y Origin Cancel 3D.13 `20261008030859`. 3D.14 **no está instalada**.

## Regresión ejecutada

| Prueba | Resultado |
| --- | --- |
| PostgreSQL 17: migración, dos sesiones, normal/Split en ambos órdenes y dos Split | PASS en fixture aislado |
| PostgreSQL 17: RPC antiguos, venta huérfana por `id` y por `local_sale_id`, recibo, replay, hash, paid/cancelled/stale | PASS en fixture aislado |
| Contrato Split SQL | 3/3 PASS |
| Contrato Atomic 3D.1 | 4/4 PASS |
| Vitest focal Restaurante, Split, checkout e inventario | 43/43 PASS |
| Build Production y postbuild PWA | PASS; advertencias de chunks/precache |
| `npm run lint` global | FAIL: 158 errores y 176 advertencias preexistentes en archivos JS/JSX no modificados por 3D.14; requiere comparación CI del nuevo SHA |
| PR127, workflows y Preview del nuevo SHA | PENDING hasta publicar la rama |

## QA física del propietario — preparada, aún no autorizada contra Production

Los doce casos quedan `PENDING`. Usar únicamente negocio QA, actor, dispositivos, Caja, inventario y baseline aprobados tras el gate SQL. Evidencia por caso: video/capturas con hora, folio, IDs no sensibles, recibo, totales antes/después y movimientos de Caja/stock/deuda pertinentes.

| Caso | Preparación, actor y dispositivo | Pasos y resultado esperado |
| --- | --- | --- |
| QA-338-01 Importe | Admin, móvil A, mesa nueva $100 | Dividir $33.34/$66.66; suma y recibos exactos. |
| QA-338-02 Comensales | Admin, móvil A, mesa con varios comensales | Asignar artículos; cada total y suma comercial correctos. |
| QA-338-03 Personalizado | Admin, móvil A, misma clase de mesa | Editar con coma/punto, borrar y teclado móvil; no aceptar importes inválidos. |
| QA-338-04 Efectivo | Admin, caja A abierta, mesa nueva | Cobrar y dar cambio; efectivo aplicado y cambio correctos. |
| QA-338-05 Mixto | Admin, caja A abierta | Efectivo + tarjeta; Caja cuenta solo efectivo y muestra tarjeta informativa. |
| QA-338-06 Fiado | Admin con cliente QA válido | Fiado parcial; deuda correcta, sin entrada ficticia de efectivo. |
| QA-338-07 Abono | Admin con cliente QA y caja A | Abono inicial; saldo y movimiento real deduplicados. |
| QA-338-08 Cancelación | Admin autorizado, operación QA identificada | Cancelar una vez; reversas y recibo correctos, retry sin doble reversa. |
| QA-338-09 Caja | Admin, caja A con baseline registrado | Comparar efectivo/otros medios antes y después; conciliación exacta. |
| QA-338-10 Inventario | Admin, producto QA con stock conocido | Liquidar una vez; stock disminuye una vez y coincide con venta. |
| QA-338-11 Dos dispositivos | Admin A/B, misma mesa QA, sin cobros simultáneos reales | Ver estado remoto y terminal tras cobro controlado; no intentar carrera Productiva sin gate separado. |
| QA-338-12 Recuperación | Admin, operación QA con clave registrada | En entorno permitido simular respuesta incierta; consultar receipt y reintentar misma clave, sin venta nueva. |

## Bloqueos exactos para GO

1. **P0 / #338 / requiere SQL Productivo y aprobación del propietario:** 3D.14 no instalada. El contrato activo todavía deja la ruta directa antigua y la ventana C5. Antes de aplicar, revalidar hashes, ledger, respaldo/restauración, ACL, clientes antiguos y plan selectivo. No hacer QA financiera real ni merge.
2. **P1 / #338 / no requiere SQL adicional conocido:** C11 y C12 y los efectos completos de Caja, inventario, crédito, abonos y reversas aún no tienen prueba integrada de alta fidelidad. Completar antes de afirmar integridad financiera plena.
3. **Gate CI / #338:** ejecutar PR127 y workflows del nuevo SHA tras publicar el parche; revisar el lint global contra la base sin ocultar sus 158 errores.
4. **QA manual:** doce casos pendientes del propietario después del gate SQL; Preview lista por sí sola no habilita cobros.

`PRODUCTION_WRITES=NO`; `MERGE_EXECUTED=NO`; `PREVIEW_UI_READY=PENDING_NEW_SHA`; `PRODUCTION_FINANCIAL_QA_GO=NO`; `FIN01_NOT_REQUIRED_FOR_RESTAURANT_PR_CLOSURE` con la evidencia disponible.
