# ECOM.POS.2 — Resolución de inventario y lotes

## Estado actual

- Rama: `fase-ecom-pos-2`
- PR: `#89 — FASE ECOM.POS.2 — Resolver inventario y lotes de pedidos preparados`
- Base: `main` en `505764ff853ddc35c1cf0af9e7473e32a60b1aa1`
- PR abierto, mergeable, no mergeado y mantenido como draft.
- Cobro ecommerce: continúa bloqueado.
- Supabase: sin cambios.
- Vercel manual: no utilizado.

ECOM.POS.2 implementó la resolución local de inventario ilimitado, exacto y por lotes. ECOM.POS.2.1 corrige consistencia entre varias líneas, concurrencia asíncrona, errores de lectura y cantidades con factor de conversión.

## Arquitectura base de ECOM.POS.2

La resolución permanece dentro de la orden activa ecommerce y separada de `ecommerceDraftStatus` mediante:

- `ecommerceInventoryStatus: pending | ready | conflict`;
- `ecommerceInventoryResolvedAt`;
- `ecommerceInventoryResolutionVersion`;
- `ecommerceInventoryConflictCount`;
- `ecommerceInventoryError`;
- `inventoryResolution` compacto por línea.

Se reutilizan:

- `useProductStore` y Dexie `menu` para productos vigentes;
- Dexie `product_batches` para lotes;
- `getAvailableStock` para existencia disponible;
- `fefoUtils` y `getBatchExpiryStatus` para FEFO y caducidad;
- `item.batchId` como contrato compatible con el checkout normal;
- `useActiveOrders.updateOrder` para persistencia y aumento de revisión.

No existe una segunda copia en `localStorage` ni persistencia remota de la resolución.

## Clasificación de inventario

### Ilimitado

Un producto sin control directo de stock y sin receta queda resuelto sin consultar lotes, sin `batchId` y sin mutaciones.

### Exacto

La existencia exacta se obtiene del producto local vigente y descuenta `committedStock` únicamente dentro del cálculo. Los estados son:

- suficiente: `resolved`;
- insuficiente: `INSUFFICIENT_STOCK`;
- desconocido o inválido: `INVENTORY_UNKNOWN` fail-closed.

### Lotes

Solo participan lotes del producto correcto, activos, no eliminados, con existencia positiva y caducidad permitida. Los lotes se ordenan con los helpers FEFO existentes.

Cuando un lote cubre toda la cantidad se asigna provisionalmente. Si la suma de varios lotes alcanza pero ninguno individual cubre la línea, se devuelve `MULTI_BATCH_REQUIRED`; no se divide silenciosamente la línea.

## Selección manual

La UI solo muestra lotes válidos. Al confirmar se revalida:

- producto y pertenencia del lote;
- actividad y eliminación;
- caducidad;
- cantidad disponible;
- contexto de licencia/actor;
- revisión vigente de la orden.

Una selección válida se guarda con `selectionMode: manual`. La selección continúa siendo provisional y debe revalidarse en ECOM.POS.3 antes de cobrar.

## Conflictos implementados

- `PRODUCT_MISSING`
- `PRODUCT_INACTIVE`
- `INVENTORY_MODE_CHANGED`
- `PRODUCT_STALE`
- `INVENTORY_UNKNOWN`
- `INVENTORY_READ_FAILED`
- `INSUFFICIENT_STOCK`
- `NO_VALID_BATCH`
- `ONLY_EXPIRED_BATCHES`
- `INSUFFICIENT_BATCH_STOCK`
- `MULTI_BATCH_REQUIRED`
- `BATCH_STALE`

## Corrección ECOM.POS.2.1 — Consistencia acumulada y protección contra respuestas obsoletas

### Ledger provisional por producto

La resolución completa crea `remainingStockByProduct` a partir de la existencia vigente menos `committedStock`.

Cada línea exacta se procesa en orden estable:

1. lee el saldo provisional;
2. compara la cantidad real requerida;
3. consume el saldo solo dentro del ledger cuando alcanza;
4. deja la línea posterior en `INSUFFICIENT_STOCK` cuando el saldo restante no cubre la demanda.

Ejemplo validado:

- stock 5;
- línea A requiere 4;
- línea B requiere 4;
- A queda resuelta;
- B queda en conflicto con disponibilidad restante 1;
- estado global `conflict`.

No se modifica `product.stock` ni `product.committedStock`.

### Ledger provisional por lote

La resolución crea `remainingStockByBatch`, indexado por producto y `batchId`, usando disponibilidad real menos `committedStock`.

El saldo se consume provisionalmente y evita asignar el mismo lote dos veces. Con un lote de 5 y dos líneas de 4, solo la primera puede usarlo; la segunda recibe conflicto con saldo restante 1.

Con dos lotes de 4, las dos líneas se asignan de forma determinista según FEFO, sin sobreasignación.

### Orden manual y FEFO

El procesamiento mantiene este orden:

1. selecciones manuales vigentes ya persistidas;
2. selección manual nueva pendiente de confirmación;
3. líneas restantes en su orden original;
4. dentro de cada línea automática, lotes ordenados FEFO.

Esto evita que una selección nueva consuma stock reservado provisionalmente por otra selección manual existente. Una segunda selección manual incompatible queda en conflicto y su `batchId` no se considera válido para avanzar.

### Factor de conversión canónico

`stockValidation.js` exporta ahora el helper puro:

```js
getInventoryQuantityForSale(item, product)
```

El mismo helper es utilizado por:

- `validateStockBeforeSale` del checkout normal;
- `ecommercePosInventoryResolution`.

Semántica conservada:

- factor habilitado, numérico y mayor que 1: `quantity / factor`;
- factor `null`, 0, 1 o no numérico: cantidad de venta sin transformación.

La resolución conserva:

- `requestedSaleQuantity`;
- `requiredInventoryQuantity`;
- `requestedQuantity` como alias compatible de la cantidad real de inventario.

La cantidad transformada se utiliza en stock exacto, lotes, ledger, FEFO y selección manual. No cambia la cantidad ni el precio del pedido.

### Protección por revisión y firma

Al iniciar una revalidación se capturan:

- `revision`;
- `updatedAt`;
- firma de líneas relevante: identidad, producto, cantidad, `batchId`, modo de selección y conversión.

Antes de aplicar se comprueba nuevamente:

- que la orden existe;
- `origin === ecommerce`;
- `ecommerceDraftStatus === prepared`;
- mismo contexto/licencia y permisos;
- misma revisión;
- mismo `updatedAt`;
- misma composición relevante.

Si no coincide, el resultado es:

```js
{
  success: false,
  stale: true,
  changed: false,
  code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE'
}
```

La respuesta obsoleta no escribe ni muestra un error operativo.

### Intento más reciente

`inventoryResolutionAttempts` mantiene una generación local por orden. Dos lecturas iniciadas con la misma revisión no pueden escribirse fuera de orden: solo el intento más reciente puede aplicar.

Una selección manual crea un intento nuevo, trabaja sobre la orden viva y aumenta la revisión mediante `updateOrder`. Una revalidación automática anterior no puede reemplazarla.

Una respuesta tardía tampoco puede recrear una orden liberada o eliminada.

### Error de lectura fail-closed

Un fallo vigente de producto/lote aplica:

- `ecommerceInventoryStatus: conflict`;
- `ecommerceInventoryResolvedAt: null`;
- al menos un conflicto;
- `ecommerceInventoryError.code: INVENTORY_READ_FAILED`;
- líneas en conflicto con `resolvedAt: null`.

La selección manual previa puede conservarse como referencia visual, pero no queda validada para continuar.

Copy:

> No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.

Una respuesta de error antigua se descarta como stale. Una revalidación posterior exitosa elimina `ecommerceInventoryError` y puede recuperar `ready`.

## UI ECOM.POS.2.1

`EcommercePosDraftBanner`:

- nunca muestra `Inventario: Listo` ante un error de lectura vigente;
- no muestra error por `ECOMMERCE_INVENTORY_STALE_RESPONSE`;
- permite volver a ejecutar `Resolver inventario`;
- mantiene visible una selección manual vigente cuando termina una respuesta automática anterior;
- muestra cantidad vendida y cantidad real de inventario cuando existe conversión.

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

## Pruebas ECOM.POS.2.1

### Servicio ecommerce

Archivo:

`src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`

Resultado aislado: **43/43 PASS**.

Incluye:

- ilimitado;
- acumulación exacta suficiente e insuficiente;
- `committedStock`;
- stock desconocido;
- recetas fail-closed;
- conversión válida e inválida;
- FEFO;
- lotes vencidos y agotados;
- no sobreasignación de lote;
- dos lotes deterministas;
- prioridad manual;
- selecciones manuales incompatibles;
- selección manual válida e inválida;
- opciones manuales con saldo restante;
- R1/R2 fuera de orden;
- selección manual durante revalidación;
- orden liberada;
- error de lectura vigente y antiguo;
- recuperación a ready;
- persistencia;
- ausencia de mutaciones y efectos.

### UI

Archivo:

`src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`

Resultado aislado: **6/6 PASS**.

### Helper compartido del checkout

Archivo existente:

`src/services/__test__/sales/stockValidation.test.js`

Resultado: **3/3 PASS**.

Confirma que exportar y reutilizar el helper no cambia la validación acumulada del checkout normal.

### Regresión del banner existente

`src/components/pos/__tests__/EcommercePosDraftBanner.test.jsx`: **2/2 PASS** en el entorno aislado.

### Total ejecutado sobre la superficie corregida

- pruebas de servicio/UI/helper: **52/52 PASS**;
- banner histórico adicional: **2/2 PASS**;
- total distinto ejecutado: **54 PASS**.

## ESLint específico

Se ejecutó sobre:

- `src/services/sales/stockValidation.js`;
- `src/services/ecommerce/ecommercePosInventoryResolution.js`;
- `src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`;
- `src/components/pos/EcommercePosDraftBanner.jsx`;
- `src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`.

Resultado: **PASS, 0 errores y 0 warnings**.

No se usaron `eslint-disable`, `.skip`, `.todo`, snapshots artificiales ni eliminación de cobertura para ocultar fallos.

## Compilación de superficie

Los módulos modificados se compilaron y empaquetaron como ESM/JSX con sus imports mediante esbuild:

- JavaScript generado: 167877 bytes;
- CSS generado: 53 bytes;
- resultado: **PASS**.

## Validación global pendiente

No se creó un workflow temporal, conforme a la restricción de ECOM.POS.2.1.

El entorno de ejecución disponible no puede resolver `github.com`, por lo que no fue posible obtener un checkout íntegro nuevo de la rama para volver a ejecutar en esta corrección:

- `npm ci` del repositorio completo;
- `npm run build` global;
- `npm run lint` global;
- `npm run test:ci` global;
- las 14 suites relacionadas completas sobre el checkout real;
- `git diff --check origin/main...HEAD` y `git status --short` desde un clon local real.

La validación global de ECOM.POS.2 previa a esta corrección sí había pasado build y había clasificado la deuda global contra `main`, pero no se reutiliza como prueba de que el HEAD de ECOM.POS.2.1 pasó esos comandos.

Por este motivo el PR debe permanecer draft y **ECOM.POS.2.1 no se declara PASS todavía**, aunque los cuatro bloqueantes están implementados y la superficie específica está verde.

## Supabase

**SIN CAMBIOS**.

No se crearon migraciones, SQL, RPC, estados remotos ni escrituras sobre pedidos reales.

## Vercel

**NO UTILIZADO MANUALMENTE**.

No se usó CLI, API, agentes, previews, redeploy, promoción, alias ni variables.

## Conclusión

Los cuatro bloqueantes de ECOM.POS.2.1 quedaron corregidos en código y cubiertos por pruebas específicas:

- demanda exacta acumulada;
- demanda por lote acumulada;
- protección stale;
- error de lectura fail-closed;
- cantidad canónica con conversión.

El PR permanece draft hasta completar la validación global obligatoria sobre un checkout íntegro del HEAD actual.
