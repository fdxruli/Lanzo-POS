# Mini-fase 3B — pagos explícitos y proyección de caja

Repositorio `fdxruli/Lanzo-POS`, PR #338, rama `feat/restaurant-split-flexible-payments-r1`.
HEAD inicial verificado: `70f839e249b9e83e4c913b6af4bbb4c7e6c4c9c7`.
Main inicial: `a7cd1efdea5ee6b0b26b690247442f6199b53e7f`.
PR inicialmente OPEN / Draft / MERGEABLE / sin merge. No había commits posteriores
al HEAD observado. 3A y 3A.1 permanecen incluidas y su implementación no se modifica.

## Evidencia y reproducción anterior al fix

La evidencia manual entregada para FG-01-000102 a FG-01-000107 confirma que Cloud
registró una venta comercial por cuenta, pagos reales, inventario, Fiado y efectivo
correctos. Esta mini-fase no vuelve a ejecutar ni modifica esas ventas.

La nueva integración ejecutó el handler real de Split, el repositorio real y Dexie,
cerró/reabrió la base y reconstruyó Caja exclusivamente desde datos persistidos.
Antes del fix, QA-10 falló: recibió `venta_tarjeta=100`, en lugar de
`venta=33.34` y `venta_tarjeta=66.66`. La snapshot había perdido los pagos.

Una segunda reproducción, tras arreglar la snapshot, incluyó el movimiento oficial
`abono_cliente=100` de QA-18: la conciliación devolvió efectivo teórico 250 con
fondo inicial 50, en vez de 150. Sumaba el mismo abono desde la venta y el movimiento.
La prueba pasa tras excluir únicamente el importe explícito enlazado y coincidente
que ya se contabiliza como cobro oficial de cliente.

## Auditoría del flujo

1. El RPC entrega `children[].sale/items/payments` o pagos globales con `sale_id`.
2. `applySplitSalesFinancialResponseProjection` selecciona los pagos de cada hijo
   y los entrega a `saveCloudCommittedSaleSnapshot`. Los pagos globales se filtran
   por venta; las filas sin ID dentro de un hijo se etiquetan con el ID de ese hijo.
   Una fila explícitamente asociada a otro hijo queda fuera de esa venta.
3. `buildLocalCloudCommittedSale` omitía `response.payments`. El `put` guardaba en
   SALES método/total/abono/saldo, pero sin el desglose. Ahora guarda pagos seguros.
4. `applyCloudSalesPayload` recibía y guardaba los pagos en SYNC_CACHE, pero omitía
   las actualizaciones de ventas ya `cloud_committed`. Ahora refresca sus pagos y
   asociación de sesión, conservando los campos comerciales y de inventario.
5. `getExplicitSalePaymentRows` lee `payments`, `paymentBreakdown` y
   `paymentDetails.payments` en ese orden. Sin fuente, Caja utilizaba el total
   legacy de la venta mixed para fabricar un movimiento no efectivo.
6. Con fuente explícita, `normalizeSaleMovements` tenía ramas excluyentes: efectivo
   impedía mostrar tarjeta/transferencia, y Fiado impedía mostrar sus pagos no
   efectivos. Ahora proyecta ambos componentes de forma independiente.
7. La clave de deduplicación usaba venta/efecto/importe, sin distinguir efectivo y
   no efectivo. Ahora incluye esa distinción, y el enriquecimiento puede resolver
   el vínculo financiero `cash_movement_id` además de las identidades de venta.
8. `CajaMovementsList` ya soporta una fila informativa `venta_tarjeta` y referencia
   secundaria. Recibe la proyección correcta; no se ocultan filas en la UI.

## Contrato persistido y compatibilidad

`salesCloudPaymentSnapshot` conserva el formato financiero Cloud: `method`, `amount`,
`received_amount`, `change_amount`, `id`, `sale_id`, `reference`, IDs de sesión,
estación, movimiento de caja y customer ledger. Solo permite metadata textual
`source`, `phase`, `split_payer_id`, `splitPayerId` y el booleano `snapshotOnly`.
No copia estructuras arbitrarias ni campos de tarjeta/CVV. Importes son strings
exactos producidos con Money. Acepta aliases camelCase/snake_case y `total`.

La primera fuente explícita no vacía sigue siendo autoritativa. La snapshot
conserva la cardinalidad de esa fuente incluso con cero, importes inválidos o método
desconocido; filas inválidas se reducen a campos seguros, no se borran habilitando
un fallback. El consumidor devuelve `[]` para una fuente sin pagos positivos válidos.
Devuelve `null` cuando todas las fuentes están ausentes o realmente vacías.

Los campos legacy `paymentMethod`, `abono` y `saldoPendiente` permanecen disponibles.
Cash/card/transfer/Fiado históricos siguen usando su comportamiento anterior.
Los mappers Cloud también reutilizan el selector existente: un arreglo vacío puede
continuar al siguiente desglose; una fuente no vacía inválida no fabrica el total.

La lectura de SALES existente y su escritura están dentro de la transacción de
snapshot: reintentos con evidencia parcial conservan los pagos ya persistidos.
Un payload de pull sin pagos tampoco borra un desglose de SALES/SYNC_CACHE.
El log mantiene identidad determinista; reaplicar la respuesta no añade ventas,
pagos, logs, movimientos físicos ni cobros remotos.

## Decisión visual y regla contable

Se conserva el contrato visual actual, con menor cambio arquitectónico:

- Una fila de efectivo aplicado (o abono de Fiado), deduplicada contra el oficial.
- Una fila informativa no efectiva `venta_tarjeta`, por tarjeta + transferencia.
- Referencia secundaria con cada importe real: por ejemplo,
  `Tarjeta $33.33 · Transferencia $33.33`.

Así, QA-10 muestra efectivo 33.34 y no efectivo 66.66, en la misma venta/folio,
nunca un componente no efectivo de 100. Ambas filas sintéticas tienen IDs distintos.
Tarjeta/transferencia no entran al efectivo esperado. Efectivo usa `amount`, nunca
el recibido antes del cambio. Filas `credit` representan deuda, no cobros.
Pagos aplicados cash/card/transfer + saldo pendiente = total comercial.

La conciliación resta del efectivo derivado de ventas solo los pagos explícitos
enlazados a un movimiento de cobro de cliente con el mismo importe aplicado. Esos
movimientos siguen visibles y se contabilizan una vez. Los abonos posteriores,
no enlazados al pago inicial, permanecen separados. No cambia el ledger.

Los totales oficiales Cloud de sesión siguen siendo la autoridad del arqueo Cloud.
`calculateSessionTotals`, el repositorio local de ventas y la conciliación usan
pagos explícitos para decidir efectivo. La vista de historial conserva método y
total comerciales; el total de la venta no es un componente de pago. No se altera
el flujo de crédito, identidad de cliente, límites, CHARGE ni PAYMENT.

## Regresiones automatizadas

| Caso | Efectivo aplicado | No efectivo pagado | Deuda |
| --- | ---: | ---: | ---: |
| QA-10, total 100 | 33.34 | 66.66 (33.33 + 33.33) | 0 |
| QA-11, total 450 | 150 | 300 (150 + 150) | 0 |
| QA-12, total 1000 | 300 | 700 (350 + 350) | 0 |
| QA-13, pizza única, total 300 | 150 | 150 | 0 |
| QA-15, total 400 | 0 | 250 (150 + 100) | 150 |
| QA-18, total 400 | 100, recibido 120/cambio 20 | 150 | 150 |

La integración nueva cubre estos seis casos, SALES/SYNC_CACHE, recarga, pagos cero,
inválidos y desconocidos, aliases y campos seguros, las cuatro rutas legacy,
BY_ITEMS con tres ventas aisladas, EQUAL_PAYMENT, CUSTOM_PAYMENT, respuesta repetida,
reparación mediante pull y deduplicación oficial con importes iguales efectivo/no
efectivo. La integración de retry ahora persiste realmente la venta reparada y sus
pagos, comprueba un solo RPC/log y conserva la reserva de Mesa B de 3A.

La prueba de UI renderiza la proyección QA-10 en CajaMovementsList: folio compartido,
33.34 y 66.66 visibles, desglose correcto y ausencia de una fila de 100.
La suite focal principal contiene 20 archivos y 367 pruebas, todos PASS, incluidos
los contratos solicitados, Fiado, retry, reservas Cloud, reconciliación y preflight.
La validación adicional de UI contiene 8/8 PASS: total local 21 archivos / 375
pruebas PASS. ESLint focal y `git diff --check` pasan. `npm run build` y postbuild
pasan; auditoría de 22 recursos de arranque. La comparación PR127 del nuevo HEAD
y sus contadores se registran en la descripción/reporte final del PR, sin reutilizar
la certificación de 3A.1.

## Snapshots históricas y QA manual pendiente

El pull normal de ventas (`salesCloudSyncHandler.onStart/onEvents`) aplica
`sale + items + payments` mediante el mismo repositorio y puede reparar snapshots
ya existentes si la venta entra en ese payload. El snapshot inicial tiene un límite
de 100 ventas: no garantiza refrescar automáticamente todo el historial. No hay
migración ni backfill masivo. Para QA usar ventas nuevas y folios nuevos; si se
revisa una antigua, refrescar/re-hidratar su snapshot con pagos antes de evaluar UI.

Repetir manualmente solo QA-10, QA-11, QA-12, QA-13, QA-15 y QA-18:

1. Desde Preview, crear cada venta con los componentes de la tabla anterior.
2. En Movimientos, comprobar efectivo + no efectivo reales y el desglose secundario.
3. Comprobar una venta comercial por cuenta; QA-13 conserva una pizza/unidad.
4. Recargar y reabrir Caja: importes iguales, sin movimiento no efectivo por el total.
5. Comprobar una sola representación oficial/sintética del efectivo aplicado.
6. En QA-15/18, comprobar cliente/saldo 150 y pagos 250. QA-18 recibe 120,
   devuelve 20 y aumenta efectivo físico solo 100.
7. Comprobar arqueo: fondo + efectivo aplicado + otras entradas - salidas;
   tarjeta/transferencia y deuda no aumentan efectivo físico.

No repetir QA-01 a QA-08 ni 3A/3A.1 salvo regresión observada.

`SQL_CHANGES = NONE`; `MIGRATIONS_APPLIED = NONE`;
`SUPABASE_PRODUCTION_CHANGES = NONE`. No se ejecutaron ventas QA automáticamente.
No se modifica inventario/reservas, la migración financiera, datos históricos ni
funciones SQL. No se hace merge ni se inicia 3C/3D/Fase 4.
