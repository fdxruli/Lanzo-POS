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

ECOM.POS.2 implementó la resolución local de inventario ilimitado, exacto y por lotes. ECOM.POS.2.1 corrigió demanda acumulada, respuestas asíncronas obsoletas, errores de lectura fail-closed y el factor de conversión compartido con el checkout normal. ECOM.POS.2.1.1 extiende el mismo contrato seguro a la lectura del selector manual de lotes.

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

La resolución completa crea un `remainingStockByProduct` inmutable respecto de productos reales. Para cada línea exacta, en orden estable:

1. obtiene la existencia local vigente menos `committedStock`;
2. calcula la cantidad real de inventario requerida;
3. comprueba el saldo provisional;
4. consume únicamente el ledger cuando alcanza;
5. marca `INSUFFICIENT_STOCK` cuando el saldo restante no cubre la línea.

No se modifica `product.stock` ni `product.committedStock`.

### Ledger provisional por lote

La resolución crea `remainingStockByBatch`, indexado por producto y `batchId`, a partir de la disponibilidad real de cada lote.

El ledger:

- descuenta `committedStock` solo para el cálculo;
- se consume provisionalmente línea por línea;
- impide asignar dos veces la misma existencia;
- no escribe en lotes reales.

### Selecciones manuales y FEFO

El orden de resolución es:

1. selecciones manuales vigentes ya persistidas;
2. selección manual nueva pendiente de confirmación;
3. líneas restantes en su orden original;
4. dentro de cada línea automática, lotes ordenados FEFO.

Una selección manual válida se conserva mientras tenga saldo provisional suficiente. Una segunda selección manual incompatible queda en `BATCH_STALE` y no conserva un `batchId` validado para avanzar.

La selección manual vuelve a validar pertenencia, actividad, caducidad, existencia individual, saldo provisional, contexto de licencia, revisión y composición vigente de la orden.

### Factor de conversión canónico

`getInventoryQuantityForSale(item, product)` se comparte entre el checkout normal y `ecommercePosInventoryResolution`.

Semántica conservada:

- factor habilitado, numérico y mayor que 1: `quantity / factor`;
- factor `null`, 0, 1 o no numérico: cantidad de venta sin transformación.

La cantidad transformada se usa en stock exacto, lotes, ledger, FEFO, opciones manuales y selección manual. No se cambia la cantidad ni el precio del pedido.

### Protección por revisión, firma e intento

Al iniciar una operación se capturan:

- `revision`;
- `updatedAt`;
- firma relevante de líneas: identidad, producto, cantidad, `batchId`, modo de selección y conversión;
- generación local del intento por orden.

Antes de escribir se comprueba que la orden exista, continúe siendo ecommerce preparada, pertenezca al mismo contexto, conserve revisión y firma, y que el intento siga siendo el más reciente.

Una respuesta antigua devuelve:

```js
{
  success: false,
  stale: true,
  changed: false,
  code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE'
}
```

No escribe ni muestra un error operativo. Una respuesta tardía no recrea un borrador liberado.

### Error de lectura fail-closed

Un fallo vigente al leer productos o lotes aplica:

- `ecommerceInventoryStatus: conflict`;
- `ecommerceInventoryResolvedAt: null`;
- `ecommerceInventoryError.code: INVENTORY_READ_FAILED`;
- líneas con `status: conflict`, `code: INVENTORY_READ_FAILED` y `resolvedAt: null`;
- `needsInventoryResolution: true`.

Una selección manual previa puede conservar su `batchId` únicamente como referencia; deja de considerarse validada.

## Corrección ECOM.POS.2.1.1 — Lectura fail-closed del selector manual de lotes

### Servicio

`getEcommerceDraftBatchOptions(...)` ahora sigue el mismo contrato seguro que la revalidación general y la selección manual:

1. valida que la orden exista;
2. exige `origin === 'ecommerce'`;
3. exige `ecommerceDraftStatus === 'prepared'`;
4. valida contexto/licencia actual;
5. verifica que la línea solicitada todavía exista;
6. captura `expectation` y crea `attemptId` antes de leer;
7. protege `loadOrderInventoryInputs(...)` con `try/catch`;
8. vuelve a comprobar la expectativa después de la lectura;
9. devuelve `options: []` para errores, respuestas stale y estados no aplicables.

Un error vigente llama a `markEcommerceInventoryReadFailure(...)`. El resultado incluye:

```text
success: false
code: ECOMMERCE_INVENTORY_READ_FAILED
options: []
```

La orden anteriormente `ready` queda persistida como `conflict`, con `ecommerceInventoryResolvedAt: null` y `INVENTORY_READ_FAILED`.

Una lectura antigua que termina después de otra revalidación, selección, modificación de línea, cambio de revisión, cambio de contexto o liberación del borrador devuelve `ECOMMERCE_INVENTORY_STALE_RESPONSE`. No marca conflicto y no modifica ni recrea la orden.

### UI

`openBatchDialog(...)` usa `try/catch/finally`.

- `finally` garantiza `setIsLoadingBatches(false)` en éxito, error controlado, excepción, stale, línea eliminada o borrador liberado;
- un error `READ_FAILED` activa el estado local fail-closed, cierra el diálogo y muestra el mensaje de lectura;
- una excepción inesperada del servicio recibe la misma defensa final;
- una respuesta stale cierra cualquier diálogo incompleto sin mostrar error operativo;
- el diálogo solo abre cuando el servicio devuelve opciones vigentes con `success: true`.

El banner deja de mostrar `Inventario: Listo` ante un fallo vigente y pasa a `Inventario: Requiere atención`.

### Ausencia de efectos operativos

La corrección no:

- descuenta productos;
- descuenta lotes;
- modifica `committedStock`;
- reserva stock;
- crea movimientos;
- llama `processSale`;
- abre checkout, payment o quickCaja;
- afecta caja;
- crea ventas;
- modifica pedidos ecommerce remotos.

`ECOMMERCE_POS_CHECKOUT_NOT_ENABLED` permanece sin cambios.

## Validación específica ECOM.POS.2.1.1

### ESLint

Comando ejecutado:

```bash
npx eslint \
  src/services/ecommerce/ecommercePosInventoryResolution.js \
  src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js \
  src/components/pos/EcommercePosDraftBanner.jsx \
  src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx
```

Resultado: **PASS — 0 errores, 0 warnings**.

### Vitest de servicio y UI

Comando ejecutado:

```bash
npx vitest run \
  src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js \
  src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx
```

Resultados:

- servicio ecommerce: **48/48 PASS**;
- UI de resolución: **9/9 PASS**;
- total del comando: **57/57 PASS**.

Cobertura nueva:

- fallo vigente al leer productos desde el selector manual;
- fallo vigente al leer lotes desde el selector manual;
- estado anteriormente `ready` persistido como `conflict`;
- conservación de `batchId` solo como referencia no validada;
- fallo tardío descartado después de una revalidación más reciente;
- borrador liberado sin recreación ni `updateOrder`;
- cambio de cantidad, lote o revisión descartado como stale;
- rechazo de promesa en UI con loading finalizado;
- resultado `READ_FAILED` sin diálogo y con `role="alert"`;
- resultado stale sin error y conservando la resolución visual más reciente.

### Regresión histórica del banner

Comando ejecutado:

```bash
npx vitest run \
  src/components/pos/__tests__/EcommercePosDraftBanner.test.jsx
```

Resultado: **2/2 PASS**.

### Resumen de la ejecución actual

- servicio + UI: **57/57 PASS**;
- banner histórico: **2/2 PASS**;
- total ejecutado para ECOM.POS.2.1.1: **59/59 PASS**.

La suite histórica de `stockValidation` permanece documentada en **3/3 PASS** desde ECOM.POS.2.1 y el archivo no fue modificado por esta corrección puntual.

El entorno aislado utilizó la transformación JSX automática de React mediante Vite, sin añadir imports ni cambios temporales a los archivos del PR.

No se usaron `eslint-disable`, `.skip`, `.todo`, snapshots artificiales ni eliminación de pruebas.

## Validación global pendiente

No se creó un workflow temporal, conforme a la restricción de la fase.

El entorno disponible no puede resolver `github.com`, por lo que no fue posible obtener un checkout íntegro nuevo del repositorio para ejecutar sobre el HEAD completo:

- `npm ci` global;
- `npm run build` global;
- `npm run lint` global;
- `npm run test:ci` global;
- todas las suites relacionadas;
- `git diff --check origin/main...HEAD`;
- `git status --short` desde un clon completo.

La ejecución específica se realizó sobre los archivos exactos modificados y sus contratos necesarios. No sustituye la validación global del HEAD.

Por tanto:

```text
ECOM.POS.2.1.1 CORRECCIÓN PUNTUAL PASS
VALIDACIÓN GLOBAL DEL HEAD PENDIENTE
PR DRAFT
```

## Supabase

**SIN CAMBIOS**.

No se crearon migraciones, SQL, RPC, estados remotos ni escrituras sobre pedidos reales.

## Vercel

**NO UTILIZADO MANUALMENTE**.

No se usó CLI, API, agentes, previews, redeploy, promoción, aliases ni variables.

## Conclusión

ECOM.POS.2.1.1 corrige la ruta de lectura del selector manual de lotes con expectativa, intento, protección stale, persistencia fail-closed y cierre garantizado del loading.

La corrección puntual y sus pruebas específicas están en PASS. El PR #89 debe permanecer draft porque la validación global obligatoria del HEAD continúa pendiente.
