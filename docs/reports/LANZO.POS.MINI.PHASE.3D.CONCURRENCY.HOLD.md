# LANZO.POS — MINI.PHASE.3D — Concurrency HOLD

`IMPLEMENTATION_STATUS = HOLD_REMOTE_TABLE_VERSIONED_UPDATE_REQUIRED`

Repositorio: `fdxruli/Lanzo-POS`; PR: `#338`; rama: `feat/restaurant-split-flexible-payments-r1`.
HEAD de origen auditado: `5415af44b7276551e4355c754c90edc8b0acd8b8`.
Alcance: lectura del contrato financiero versionado y del código de trabajo 3D; sin consultas SQL, migraciones, cambios de producción ni commits ejecutados por esta auditoría. No se certificó una definición SQL de producción mediante introspección.

## Conclusión

El split Cloud protege dos liquidaciones split del mismo padre mediante lock y versión, pero el checkout normal del dispositivo de origen no participa en esa barrera. Crear la venta normal y cerrar la comanda son dos llamadas/transacciones distintas. Durante esa ventana el split remoto puede crear otra venta para la misma mesa. Las claves de idempotencia y los IDs financieros de ambas rutas son diferentes.

Por ello, habilitar el split desde un shadow remoto no queda certificado. La contención 3D requerida es permitir cargar/revisar el shadow y bloquear edición, cancelación, checkout normal y split financiero remotos. El checkout del dispositivo de origen mantiene su alcance previo; este reporte no autoriza cambios en su matemática ni en 3A/3B/3B.0/3C. Los marcadores Cloud `paid`/terminal tras refresh son útiles, pero no sustituyen una barrera financiera atómica.

## Contrato y evidencia

Las referencias siguientes son rutas del repositorio y líneas observadas durante la auditoría; los archivos frontend siguen en edición por la implementación 3D.

| Evidencia | Archivo y líneas | Implicación |
| --- | --- | --- |
| Venta normal conserva `activeOrderId` como ID financiero. | `src/services/sales/processSaleCore.js:438–474`, en particular `439` | Para la mesa padre `P`, la venta normal tiene ID `P`. El objeto de venta no incorpora versión esperada de la comanda. |
| Mapper normal genera `id = sale.id`, `local_sale_id = sale.id`. | `src/services/salesCloud/salesCloudCashierMapper.js:404–432` | No envía una identidad/versionado de comanda para liquidación atómica; `metadata.orderType` es procedencia, no una barrera de settlement. |
| Normal llama a `processCloudCashierSale`, que elige efectivo/inventario/crédito. | `src/services/sales/processSaleCore.js:477–487`; `src/services/salesCloud/salesCloudCashierService.js:1042–1083` | Las tres rutas siguen el contrato financiero normal. |
| Repository crea intentos `sale.cashier`, `sale.cashier_inventory` o `sale.credit`, con sale/items/payments/cash-session/customer. | `src/services/salesCloud/salesCloudRepository.js:145–156`; `src/services/financial/financialIntentLedger.js:1014–1020` | El RPC vigente es `pos_execute_financial_operation_v1`, no una supuesta llamada directa a `pos_create_sale`. |
| Dispatch financiero vigente envía normal a `pos_create_cloud_sale_cashier`, `..._inventory`, `..._credit`; split a `private.execute_split_sale_financial_v1`. | `supabase/migrations/20260903180000_cloud_layaways_financial_response_serialization_hardening_r2.sql:2172–2194` | Son ramas financieras distintas. |
| Wrappers normales `_unlimited` autorizan y llaman a las funciones `_legacy_r2b`. | `supabase/migrations/20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql:1091–1227`; guard de estación en `20260829145747_cash_multi_admin_station_server_guard_r1.sql:142–166` | RBAC, caja y pricing no establecen exclusión por padre Restaurante. |
| Helper de autorización vigente valida IDs, split-child/pricing, ecommerce, productos y caja, sin consultar `pos_restaurant_orders` ni adquirir `restaurant_split:`. | `supabase/migrations/20260901044425_cloud_special_checkout_r1.sql:185–934`; ID/local ID en `306–312`; producto `428–431` | El checkout normal no comprueba `payment_status` ni `updated_at` del padre antes de efectos financieros. La protección ecommerce de esa función corresponde a otra entidad. |
| IDs del split se calculan como `sale_split_<hash(splitGroupId:label)>`. | `src/services/sales/splitOrderService.js:926–937`; metadatos de padre `591–603` | No coinciden con `P`: el índice único por `(license_id, local_sale_id)` no excluye normal contra split. Índice: `supabase/migrations/20260625112333_fase6a_ventas_cloud_base.sql:144–146`. |
| Receipt/idempotencia bloquea por tenant y clave externa; normal y split usan claves distintas. | `supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql:152–168`; `src/services/salesCloud/salesCloudCashierService.js:405–408`, `940` | Idempotencia del mismo intento no es exclusión entre dos intentos diferentes sobre la misma mesa. |
| Preflight del split suministra la versión Cloud y el request envía `parent_order_id`, `parent_order_version`. | `src/services/sales/splitOrderService.js:960–970`; `src/services/salesCloud/salesCloudCashierService.js:932–948` | Conserva el contrato esperado del split; una lectura previa no descubre una venta normal cuyo cierre aún no ocurrió. |
| Split toma advisory lock tenant/padre, bloquea la fila, valida versión y estado, y cierra dentro del RPC. | `supabase/migrations/20260929091708_restaurant_payment_split_financial_r1.sql:479–508`, `815–829` | El split es atómico respecto de otros participantes que bloqueen/actualicen esa comanda; normal-create no es uno de esos participantes. |
| Checkout UI primero espera `processSale`, luego solicita cierre Restaurante. | `src/hooks/pos/usePosCheckout.js:1225–1267`; repository cierre `src/services/restaurant/restaurantOrdersRepository.js:137–151` | Existe una ventana material entre el commit de venta y el cierre de la comanda. |
| Cierre SQL bloquea la comanda después de la venta; no exige versión ni rechaza una comanda ya pagada por otra venta. | `supabase/migrations/20260702231833_fase_rest_7_close_restaurant_order_after_checkout.sql:193–198`, `258–265`, `279–299` | Puede reemplazar `paid_sale_id` con el último cierre. No revierte una venta normal ni los efectos de un split ya confirmados. |

La allowlist financiera normal confirma la carencia de identidad/versionado del padre: `supabase/migrations/20260929091708_restaurant_payment_split_financial_r1.sql:116–134`; la allowlist de sale en `20260820165842_shared_terminal_financial_receipt_contract.sql:453–478` tampoco vincula una versión Restaurante. No se encontró un trigger versionado que cierre la comanda al insertar una venta normal.

## Secuencia multi-dispositivo alcanzable

Supuestos: misma licencia, mesa `P` activa/unpaid con versión `V`; A conserva su OPEN original; B conserva shadow íntegro de `P`; caja autorizada y stock suficiente para ambos intentos.

1. A ejecuta checkout normal. El servidor confirma venta `P` y sus efectos financieros; la comanda sigue unpaid con versión `V`, porque el cierre es otra llamada.
2. Antes del cierre de A, B hace preflight. Cloud devuelve el mismo snapshot y `V`, por lo que el preflight resulta válido.
3. B ejecuta split. El lock de padre está libre; `V` coincide y unpaid sigue vigente. El servidor crea sus hijos `sale_split_*`, aplica sus efectos y cierra `P` dentro de la transacción split.
4. A envía su cierre normal. Este bloquea la fila ya pagada, pero no rechaza paid-by-another-sale ni versión obsoleta. El cierre puede actualizar `paid_sale_id` hacia la venta de A.
5. Resultado permitido por contrato: venta normal más venta(s) split, con caja y potencial inventario/deuda correspondientes a ambos cobros de la misma mesa.

La ventana puede extenderse si A pierde red después del commit de venta: el cierre tiene recuperación pendiente en `src/services/restaurant/restaurantOrderCheckoutClose.js:241–307`. También puede cobrar A desde su OPEN viejo después de que B haya terminado, si aún no recibió un refresh terminal. Ningún lock de inventario/caja resuelve la identidad de settlement; con stock suficiente ambos cobros pueden ser válidos individualmente.

## Contrato servidor faltante — propuesta documental

Una corrección futura, en una migración separada revisada expresamente, necesita:

1. Un settlement Restaurante con `localOrderId` canónico y versión esperada obligatoria, enlazados al contrato/hash financiero.
2. Exclusión compartida tenant/padre para todas las rutas autorizadas que puedan liquidar la mesa: checkout normal, crédito y split. No basta agregar una lectura/preflight al frontend o revisar si existe una venta `P`; una ausencia de fila no bloquea una creación posterior.
3. Dentro de la misma transacción: bloquear padre, validar existencia/tenant, estado unpaid/no cancelado, versión y snapshot comercial antes de crear ventas, caja, inventario o deuda.
4. Crear los efectos financieros y marcar la comanda pagada/versionada atómicamente, dejando una única identidad de settlement. Un retry del mismo intento devuelve el receipt confirmado; un intento diferente contra el mismo padre falla antes de efectos.
5. Evitar que clientes/rutas normales antiguas omitan esa barrera al cobrar una mesa identificable. Cancelación/edición remotas requieren su propio compare-and-set de versión bajo la misma autoridad de la comanda.
6. Preservar el contrato actual de importes, descuentos, split, Fiado, Device Auth, ActorRuntime y receipts; la migración no queda autorizada por este documento.

Pruebas de aceptación futuras: normal-A vs split-B en ambos órdenes; normal commit con cierre pendiente; dos splits concurrentes; paid/cancelled/version stale; reintento idéntico y tentativa distinta; dos cajas/actores autorizados; suficiente stock para que un rechazo de stock no oculte el defecto. Debe verificarse una sola liquidación y ausencia de venta/caja/inventario/deuda en el perdedor.

`SQL_CHANGES = NONE`; `MIGRATIONS_CREATED = NONE`; `MIGRATIONS_APPLIED = NONE`; `SUPABASE_PRODUCTION_CHANGES = NONE`.
`MERGE_READINESS = HOLD`; `REMOTE_FINANCIAL_SETTLEMENT = BLOCKED_PENDING_SERVER_CONTRACT`.
La conclusión procede del contrato del repositorio; no se ejecutó una duplicación financiera real ni se afirmó que la producción tuviera una definición distinta o idéntica.
