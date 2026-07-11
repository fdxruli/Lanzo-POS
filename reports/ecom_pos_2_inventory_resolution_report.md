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

```text
ECOM.POS.2.1.1 IMPLEMENTADO
VALIDACIÓN GLOBAL DEL HEAD PENDIENTE
PR DRAFT
```

ECOM.POS.2 implementó la resolución local de inventario ilimitado, exacto y por lotes. ECOM.POS.2.1 corrige cuatro bloqueantes: demanda acumulada, respuestas asíncronas obsoletas, errores de lectura fail-closed y factor de conversión compartido con el checkout normal. ECOM.POS.2.1.1 extiende la política fail-closed y la protección stale a la lectura del selector manual de lotes.

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

## Corrección ECOM.POS.2.1.1 — Lectura fail-closed del selector manual de lotes

### Protección por expectativa e intento

`getEcommerceDraftBatchOptions(...)` valida antes de leer:

- que la orden exista;
- `origin === 'ecommerce'`;
- `ecommerceDraftStatus === 'prepared'`;
- que pertenezca al contexto/licencia actual;
- que la línea solicitada todavía exista.

Después captura:

```js
const expectation = captureOrderExpectation(order);
const attemptId = createAttempt(orderId);
```

La lectura queda protegida frente a una revalidación o selección posterior, cambios de líneas, cantidad, lote, revisión, contexto y liberación del borrador.

### Manejo de respuestas stale

`loadOrderInventoryInputs(...)` está dentro de `try/catch`. Después de la lectura y antes de construir o devolver opciones se vuelve a ejecutar `isExpectedOrderCurrent(...)` contra la orden viva.

Cuando la expectativa dejó de ser vigente se devuelve:

```js
{
  success: false,
  stale: true,
  changed: false,
  code: ECOMMERCE_INVENTORY_STALE_RESPONSE,
  options: []
}
```

La respuesta stale:

- no marca conflicto;
- no sobrescribe una resolución más reciente;
- no muestra error operativo;
- no abre el diálogo con datos antiguos;
- no recrea un borrador liberado.

### Error vigente fail-closed

Un error vigente llama a:

```js
markEcommerceInventoryReadFailure({
  orderId,
  ...expectation,
  attemptId,
  error,
  now,
  deps
})
```

El resultado incluye `success: false`, `code: ECOMMERCE_INVENTORY_READ_FAILED` y `options: []`.

La orden queda persistida con:

- `ecommerceInventoryStatus: conflict`;
- `ecommerceInventoryResolvedAt: null`;
- `ecommerceInventoryError.code: INVENTORY_READ_FAILED`;
- líneas con `inventoryResolution.status: conflict`;
- líneas con `inventoryResolution.code: INVENTORY_READ_FAILED`;
- líneas con `inventoryResolution.resolvedAt: null`;
- `needsInventoryResolution: true`.

Un `batchId` manual anterior puede conservarse como referencia, pero no continúa validado.

### Cierre garantizado del loading

`openBatchDialog(...)` utiliza `try/catch/finally`.

`setIsLoadingBatches(false)` se ejecuta en:

- éxito;
- error controlado;
- excepción;
- respuesta stale;
- línea eliminada;
- borrador liberado.

El `catch` del componente es una defensa final. La fuente principal del estado persistido fail-closed continúa siendo el servicio.

La UI:

- cierra cualquier diálogo incompleto ante fallo;
- no abre el diálogo con opciones inválidas;
- muestra `Inventario: Requiere atención` y `role="alert"` ante `READ_FAILED`;
- deja de mostrar `Inventario: Listo`;
- descarta stale sin error y conserva la resolución visual más reciente.

## Ausencia de efectos operativos

ECOM.POS.2.1 y ECOM.POS.2.1.1 no invocan ni modifican:

- `processSale`;
- decrementos de productos o lotes;
- `committedStock` real;
- reservas o movimientos de inventario;
- checkout/payment;
- quickCaja o caja;
- cocina/comanda;
- split bill;
- apartados;
- descuentos;
- `converted_to_sale`;
- `converted_sale_id`;
- pedidos ecommerce remotos.

`ECOMMERCE_POS_CHECKOUT_NOT_ENABLED` y los guards de ECOM.POS.1 permanecen sin cambios.

## Pruebas específicas

### Servicio ecommerce

`src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`

Resultado actual: **48/48 PASS**.

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
- ausencia de mutaciones y efectos;
- error de productos al cargar opciones manuales;
- error de lotes al cargar opciones manuales;
- error tardío del selector descartado como stale;
- borrador liberado durante la lectura sin recreación;
- cambio de cantidad, lote o revisión descartado como stale.

### UI ECOM.POS.2.1.1

`src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`

Resultado actual: **9/9 PASS**.

Incluye:

- rechazo de la promesa al cargar opciones;
- resultado `ECOMMERCE_INVENTORY_READ_FAILED`;
- resultado `ECOMMERCE_INVENTORY_STALE_RESPONSE`;
- loading finalizado en todos los caminos cubiertos;
- diálogo bloqueado con datos inválidos;
- `Listo` eliminado ante fallo vigente;
- `Requiere atención` y alerta visibles;
- stale sin error y con resolución visual vigente conservada.

### Helper compartido del checkout

`src/services/__test__/sales/stockValidation.test.js`

Resultado previo de ECOM.POS.2.1: **3/3 PASS**. El archivo no fue modificado por ECOM.POS.2.1.1.

### Regresión del banner existente

`src/components/pos/__tests__/EcommercePosDraftBanner.test.jsx`

Resultado actual: **2/2 PASS**.

### Total específico

Ejecución actual requerida para ECOM.POS.2.1.1:

- servicio + UI: **57/57 PASS**;
- banner histórico: **2/2 PASS**;
- total actual: **59/59 PASS**.

Superficie documentada, incluyendo el helper compartido no modificado:

- **62/62 pruebas verdes**.

El entorno aislado utilizó la transformación JSX automática de React mediante Vite; no se añadieron imports temporales ni cambios de ejecución al repositorio.

## ESLint específico

Archivos:

- `src/services/ecommerce/ecommercePosInventoryResolution.js`;
- `src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`;
- `src/components/pos/EcommercePosDraftBanner.jsx`;
- `src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`.

Resultado: **PASS, 0 errores y 0 warnings**.

No se usaron `eslint-disable`, `.skip`, `.todo`, snapshots artificiales ni eliminación de cobertura.

## Compilación de superficie

La compilación de superficie documentada en ECOM.POS.2.1 permanece como evidencia previa para esos archivos. La ejecución actual de ECOM.POS.2.1.1 utilizó la transformación ESM/JSX de Vite para las suites específicas.

Esta evidencia no sustituye `npm run build` global.

## Validación global pendiente

No se creó un workflow temporal, conforme a la restricción de ECOM.POS.2.1.1.

El entorno disponible no puede resolver `github.com`, por lo que no fue posible obtener un checkout íntegro nuevo del HEAD actual para ejecutar:

- `npm ci` completo;
- `npm run build` global;
- `npm run lint` global;
- `npm run test:ci` global;
- todas las suites relacionadas sobre el checkout real;
- `git diff --check origin/main...HEAD`;
- `git status --short` desde un clon completo.

La validación global previa de ECOM.POS.2 no se utiliza como prueba de que el HEAD actual pasó esos comandos.

La corrección puntual ECOM.POS.2.1.1 y su superficie específica están en PASS, pero el PR permanece draft hasta completar la validación global obligatoria.

## Supabase

**SIN CAMBIOS**.

No se crearon migraciones, SQL, RPC, estados remotos ni escrituras sobre pedidos reales.

## Vercel

**NO UTILIZADO MANUALMENTE**.

No se usó CLI, API, agentes, previews, redeploy, promoción, aliases ni variables.

## Conclusión

ECOM.POS.2.1.1 corrige la ruta de lectura del selector manual de lotes con:

- protección por expectativa e intento;
- manejo de respuestas stale;
- fail-closed ante error vigente;
- cierre garantizado del loading mediante `finally`;
- bloqueo del diálogo con datos inválidos;
- ausencia de efectos operativos.

```text
ECOM.POS.2.1.1 CORRECCIÓN PUNTUAL PASS
VALIDACIÓN GLOBAL DEL HEAD PENDIENTE
PR DRAFT
```

El PR #89 debe permanecer draft y no debe mergearse automáticamente.
