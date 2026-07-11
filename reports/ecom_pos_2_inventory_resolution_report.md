# ECOM.POS.2 — Resolución de inventario y lotes

## Estado

- Rama: `fase-ecom-pos-2`
- PR: `#89 — FASE ECOM.POS.2 — Resolver inventario y lotes de pedidos preparados`
- Base: `main` en `505764ff853ddc35c1cf0af9e7473e32a60b1aa1`
- PR: abierto, no mergeado y mantenido como draft.
- Cobro ecommerce: continúa bloqueado.
- Supabase: sin cambios.
- Vercel manual: no utilizado.
- Workflows temporales de GitHub Actions: no creados.

ECOM.POS.2 implementó la resolución local de inventario ilimitado, exacto y por lotes. ECOM.POS.2.1 corrige cuatro bloqueantes: demanda acumulada, respuestas asíncronas obsoletas, errores de lectura fail-closed y factor de conversión compartido con el checkout normal.

## Arquitectura conservada

La resolución permanece dentro de la orden activa ecommerce mediante `useActiveOrders`; no se crea otra copia en `localStorage` ni persistencia remota.

El estado de inventario continúa separado de `ecommerceDraftStatus` mediante:

- `ecommerceInventoryStatus: pending | ready | conflict`;
- `ecommerceInventoryResolvedAt`;
- `ecommerceInventoryResolutionVersion`;
- `ecommerceInventoryConflictCount`;
- `ecommerceInventoryError`;
- `inventoryResolution` compacto por línea.

Se reutilizan las fuentes y reglas actuales:

- `useProductStore` y Dexie `menu` para productos vigentes;
- Dexie `product_batches` para lotes;
- `getAvailableStock` para existencia menos `committedStock`;
- `fefoUtils` y `getBatchExpiryStatus` para FEFO y caducidad;
- `item.batchId` como contrato de un lote por línea;
- `useActiveOrders.updateOrder` para persistencia y revisión.

## Corrección ECOM.POS.2.1 — Consistencia acumulada y protección contra respuestas obsoletas

### Ledger provisional por producto

La resolución completa crea un `remainingStockByProduct` inmutable respecto de productos reales.

Para cada línea exacta, en orden estable:

1. obtiene la existencia local vigente menos `committedStock`;
2. calcula la cantidad real de inventario requerida;
3. comprueba el saldo provisional;
4. consume únicamente el ledger cuando alcanza;
5. marca `INSUFFICIENT_STOCK` cuando el saldo restante no cubre la línea.

Ejemplo cubierto:

- stock disponible: 5;
- línea A: 4;
- línea B: 4;
- A: `resolved`;
- B: `INSUFFICIENT_STOCK`, disponibilidad restante 1;
- estado global: `conflict`.

No se modifica `product.stock` ni `product.committedStock`.

### Ledger provisional por lote

La resolución crea `remainingStockByBatch`, indexado por producto y `batchId`, a partir de la disponibilidad real de cada lote.

El ledger:

- descuenta `committedStock` solo para el cálculo;
- se consume provisionalmente línea por línea;
- impide asignar dos veces la misma existencia;
- no escribe en lotes reales.

Con un lote de 5 y dos líneas de 4, solo una línea puede usar el lote. Con dos lotes de 4, las dos líneas se asignan de forma determinista según FEFO.

### Selecciones manuales y FEFO

El orden de resolución es:

1. selecciones manuales vigentes ya persistidas;
2. selección manual nueva pendiente de confirmación;
3. líneas restantes en su orden original;
4. dentro de cada línea automática, lotes ordenados FEFO.

Una selección manual válida se conserva mientras tenga saldo provisional suficiente. Una segunda selección manual incompatible queda en `BATCH_STALE` y no conserva un `batchId` válido para avanzar.

La selección manual vuelve a validar:

- pertenencia al producto;
- actividad y eliminación;
- caducidad;
- existencia individual suficiente;
- saldo provisional restante;
- contexto de licencia/actor;
- revisión y composición vigentes de la orden.

Los errores mantienen los contratos existentes:

- lote de otro producto o inexistente: `BATCH_STALE`;
- lote vencido o caducidad inválida: `ONLY_EXPIRED_BATCHES`;
- lote inactivo, agotado o inválido: `NO_VALID_BATCH`;
- lote válido pero insuficiente: `INSUFFICIENT_BATCH_STOCK`.

### Factor de conversión canónico

`src/services/sales/stockValidation.js` exporta:

```js
getInventoryQuantityForSale(item, product)
```

El mismo helper es utilizado por:

- `validateStockBeforeSale` del checkout normal;
- `ecommercePosInventoryResolution`.

Semántica conservada:

- factor habilitado, numérico y mayor que 1: `quantity / factor`;
- factor `null`, 0, 1 o no numérico: cantidad de venta sin transformación.

La resolución almacena:

- `requestedSaleQuantity`;
- `requiredInventoryQuantity`;
- `requestedQuantity` como alias compatible de la cantidad real de inventario.

La cantidad transformada se utiliza en stock exacto, lotes, ledger, FEFO, opciones manuales y selección manual. No se cambia la cantidad ni el precio del pedido.

Los productos con receta continúan en `INVENTORY_UNKNOWN`; esta corrección no implementa otro motor de ingredientes.

### Protección por revisión, firma e intento

Al iniciar una resolución se capturan:

- `revision`;
- `updatedAt`;
- firma relevante de líneas: identidad, producto, cantidad, `batchId`, modo de selección y conversión;
- generación local del intento por orden.

Antes de escribir se comprueba:

- que la orden siga existiendo;
- `origin === ecommerce`;
- `ecommerceDraftStatus === prepared`;
- mismo contexto/licencia y permisos;
- misma revisión y `updatedAt`;
- misma composición relevante;
- que el intento siga siendo el más reciente.

Una respuesta antigua devuelve:

```js
{
  success: false,
  stale: true,
  changed: false,
  code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE'
}
```

No escribe ni muestra un error operativo. Una selección manual invalida resoluciones automáticas anteriores. Una respuesta tardía no recrea un borrador liberado.

### Error de lectura fail-closed

Un fallo vigente al leer productos o lotes aplica:

- `ecommerceInventoryStatus: conflict`;
- `ecommerceInventoryResolvedAt: null`;
- `ecommerceInventoryError.code: INVENTORY_READ_FAILED`;
- al menos un conflicto;
- líneas con `status: conflict`, `code: INVENTORY_READ_FAILED` y `resolvedAt: null`.

Una selección manual previa puede conservarse únicamente como referencia visual; no queda validada para avanzar.

Copy:

> No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.

Una respuesta de error antigua se descarta como stale. Una revalidación posterior exitosa elimina `ecommerceInventoryError` y puede recuperar `ready`.

### Prevención de loops de revalidación

`EcommercePosDraftBanner` ya no hace depender `runResolution` del objeto completo de la orden. Utiliza dependencias primitivas estables:

- `storedOrderId`;
- `storedOrderOrigin`;
- `storedOrderDraftStatus`.

Esto evita que la escritura fail-closed, cuyo `occurredAt` cambia, vuelva a crear el callback y dispare una cadena de lecturas por el propio cambio de estado.

## UI

El banner:

- no muestra `Inventario: Listo` ante un error de lectura vigente;
- no muestra error por `ECOMMERCE_INVENTORY_STALE_RESPONSE`;
- permite reintentar con `Resolver inventario`;
- mantiene visible una selección manual cuando termina una respuesta automática anterior;
- muestra cantidad vendida y cantidad real requerida cuando existe conversión;
- continúa separando estado del pedido y estado del inventario.

## Ausencia de efectos operativos

ECOM.POS.2.1 no invoca ni modifica:

- `processSale`;
- decrementos de productos o lotes;
- `committedStock` real;
- movimientos de inventario;
- checkout/payment;
- quickCaja o caja;
- cocina/comanda;
- split bill;
- apartados;
- descuentos;
- `converted_to_sale`;
- `converted_sale_id`.

`ECOMMERCE_POS_CHECKOUT_NOT_ENABLED` y los guards de ECOM.POS.1 permanecen sin cambios.

## Pruebas específicas

### Servicio ecommerce

`src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`

Resultado: **43/43 PASS**.

Cubre:

- ilimitado;
- acumulación exacta suficiente e insuficiente;
- `committedStock`;
- stock desconocido;
- recetas fail-closed;
- conversión válida e inválida;
- FEFO y exclusión de lotes inválidos;
- no sobreasignación de lote;
- dos lotes deterministas;
- prioridad manual;
- selecciones manuales incompatibles;
- errores manuales específicos;
- opciones con saldo restante;
- respuestas R1/R2 fuera de orden;
- selección manual durante revalidación;
- orden liberada;
- error de lectura vigente y antiguo;
- recuperación a `ready`;
- persistencia y no reescritura;
- ausencia de mutaciones y efectos.

### UI ECOM.POS.2.1

`src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`

Resultado: **6/6 PASS**.

### Helper compartido del checkout

`src/services/__test__/sales/stockValidation.test.js`

Resultado: **3/3 PASS**.

### Regresión del banner existente

`src/components/pos/__tests__/EcommercePosDraftBanner.test.jsx`

Resultado: **2/2 PASS**.

### Total específico ejecutado

- 4 archivos de prueba;
- **54/54 tests PASS**.

El entorno aislado requirió añadir temporalmente el import clásico de React únicamente durante la ejecución local de JSX; esos imports no se escribieron en el repositorio. El repositorio usa su transformación JSX habitual, ya validada previamente para estos archivos.

## ESLint específico

Archivos:

- `src/services/sales/stockValidation.js`;
- `src/services/ecommerce/ecommercePosInventoryResolution.js`;
- `src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`;
- `src/components/pos/EcommercePosDraftBanner.jsx`;
- `src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`.

Resultado: **PASS, 0 errores y 0 warnings**.

No se usaron `eslint-disable`, `.skip`, `.todo`, snapshots artificiales ni eliminación de cobertura.

## Compilación de superficie

Los módulos modificados y sus imports se empaquetaron como ESM/JSX mediante esbuild.

- JavaScript generado: 153509 bytes;
- resultado: **PASS**.

Esta compilación de superficie no sustituye `npm run build` global.

## Validación global pendiente

No se creó un workflow temporal, conforme a la restricción de ECOM.POS.2.1.

El entorno disponible no puede resolver `github.com`, por lo que no fue posible obtener un checkout íntegro nuevo del HEAD corregido para ejecutar:

- `npm ci` del repositorio completo;
- `npm run build` global;
- `npm run lint` global;
- `npm run test:ci` global;
- todas las suites relacionadas sobre el checkout real;
- `git diff --check origin/main...HEAD`;
- `git status --short` desde un clon completo.

La validación global previa de ECOM.POS.2 no se utiliza como prueba de que el HEAD de ECOM.POS.2.1 pasó esos comandos.

Por este motivo el PR permanece draft y **ECOM.POS.2.1 no se declara PASS todavía**, aunque los cuatro bloqueantes están corregidos y la superficie específica está verde.

## Supabase

**SIN CAMBIOS**.

No se crearon migraciones, SQL, RPC, estados remotos ni escrituras sobre pedidos reales.

## Vercel

**NO UTILIZADO MANUALMENTE**.

No se usó CLI, API, agentes, previews, redeploy, promoción, aliases ni variables.

## Conclusión

Los cuatro bloqueantes de ECOM.POS.2.1 quedaron corregidos en código y cubiertos por pruebas específicas:

- demanda exacta acumulada;
- demanda por lote acumulada;
- protección stale;
- error de lectura fail-closed;
- cantidad canónica con conversión.

La validación global obligatoria del HEAD actual continúa pendiente, por lo que el PR #89 debe permanecer draft.
