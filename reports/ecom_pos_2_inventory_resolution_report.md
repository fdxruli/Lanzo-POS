# ECOM.POS.2 — Resolución de inventario y lotes

## Resultado

**ECOM.POS.2 PASS**, sujeto a conservar el PR #89 sin merge automático y con el cobro ecommerce bloqueado hasta ECOM.POS.3.

Rama: `fase-ecom-pos-2`

PR: `#89 — FASE ECOM.POS.2 — Resolver inventario y lotes de pedidos preparados`

Base validada: `main` en `505764ff853ddc35c1cf0af9e7473e32a60b1aa1`.

## Alcance implementado

La fase resuelve localmente el inventario de las órdenes activas con `origin: 'ecommerce'` y `ecommerceDraftStatus: 'prepared'`. No modifica el estado remoto del claim y mantiene separado el contrato del borrador mediante:

- `ecommerceInventoryStatus: pending | ready | conflict`;
- `ecommerceInventoryResolvedAt`;
- `ecommerceInventoryResolutionVersion`;
- `ecommerceInventoryConflictCount`;
- `inventoryResolution` compacto por línea.

El estado global se calcula con prioridad `conflict > pending > ready`.

## Arquitectura reutilizada

Se creó `src/services/ecommerce/ecommercePosInventoryResolution.js` como servicio central, separando lectura, cálculo, persistencia y renderizado.

El servicio reutiliza las fuentes y contratos actuales del POS:

- catálogo vigente desde `useProductStore` con fallback a Dexie `menu`;
- lotes desde Dexie `product_batches` por `productId`;
- disponibilidad exacta mediante `getAvailableStock` después de validar los valores crudos;
- identidad, disponibilidad, vigencia y orden FEFO mediante `fefoUtils`;
- semántica de caducidad mediante `getBatchExpiryStatus`;
- contrato de una sola selección `item.batchId` compatible con el checkout normal;
- persistencia de la orden mediante `useActiveOrders.updateOrder`.

No se creó un segundo motor de inventario ni un contrato multilote paralelo.

## Clasificación de inventario

### Inventario ilimitado

Un producto con `trackStock === false` y sin receta queda resuelto automáticamente:

- `mode: unlimited`;
- `status: resolved`;
- `batchId: null` en la resolución y `undefined` en la línea;
- `needsInventoryResolution: false`;
- sin consultar lotes.

### Stock exacto

El stock exacto usa la existencia local vigente, no el snapshot público ecommerce.

- existencia suficiente: `resolved`;
- existencia insuficiente: `INSUFFICIENT_STOCK`;
- stock `null`, ausente, no numérico o comprometido inválido: `INVENTORY_UNKNOWN` fail-closed;
- no se modifica `stock` ni `committedStock`.

Los productos con receta quedan fail-closed en esta fase porque su disponibilidad depende del motor de ingredientes del checkout y no se implementó un cálculo paralelo.

### Productos por lotes

Solo se consideran lotes que:

- pertenecen al producto;
- están activos y no eliminados;
- tienen disponibilidad positiva;
- no están vencidos;
- tienen una caducidad válida cuando la política del producto la exige.

Los lotes válidos se ordenan con los helpers FEFO existentes.

## FEFO automático

Cuando un lote válido cubre por sí solo toda la cantidad:

- se selecciona el primero por FEFO;
- se persiste `item.batchId`;
- se guarda número, caducidad y disponibilidad como snapshot de UI;
- `selectionMode: fefo_auto`;
- la selección es provisional y no reserva ni descuenta inventario.

Cuando ningún lote individual cubre la cantidad pero la suma sí alcanza, se marca `MULTI_BATCH_REQUIRED`. La línea no se divide silenciosamente porque el contrato actual de venta usa un solo `batchId` por línea.

## Selección manual

`EcommercePosDraftBanner` muestra la acción `Resolver inventario` solo para un borrador ecommerce preparado y un actor que conserva los permisos de preparación POS/ecommerce.

Para líneas por lote, el modal muestra:

- número de lote;
- fecha de caducidad;
- existencia disponible;
- indicador `FEFO recomendado`.

Los lotes inválidos no se incluyen. Los válidos que no cubren toda la cantidad se muestran deshabilitados. Al confirmar se revalida nuevamente:

- pertenencia al producto;
- vigencia;
- estado activo;
- existencia suficiente.

Una selección válida se persiste con `selectionMode: manual`. No se confía en un `batchId` recibido directamente desde React.

## Conflictos

Se implementaron mensajes específicos para:

- `PRODUCT_MISSING`;
- `PRODUCT_INACTIVE`;
- `INVENTORY_MODE_CHANGED`;
- `PRODUCT_STALE`;
- `INVENTORY_UNKNOWN`;
- `INSUFFICIENT_STOCK`;
- `NO_VALID_BATCH`;
- `ONLY_EXPIRED_BATCHES`;
- `INSUFFICIENT_BATCH_STOCK`;
- `MULTI_BATCH_REQUIRED`;
- `BATCH_STALE`.

Un lote seleccionado que se agota, vence o deja de pertenecer al producto limpia `item.batchId` y devuelve la línea a conflicto.

## Persistencia y liberación

La resolución se guarda dentro de la orden activa ecommerce mediante el mecanismo existente de `useActiveOrders`. No se creó una segunda copia ni una vía adicional en `localStorage`.

Al liberar el borrador se elimina la orden activa completa mediante el flujo existente, por lo que desaparecen conjuntamente:

- `inventoryResolution`;
- `batchId` provisional;
- `ecommerceInventoryStatus`;
- metadatos de resolución.

## Revalidación

La UI solicita revalidación sin polling agresivo cuando:

- se abre o restaura el borrador;
- cambia la composición de la orden;
- cambia el catálogo local observado;
- cambian los lotes del producto en Dexie;
- se pulsa `Resolver inventario`;
- se selecciona un lote;
- la ventana recupera foco;
- el dispositivo vuelve a estar online.

Una selección manual válida se conserva. Solo se sustituye por conflicto si deja de cumplir el contrato.

## UI

El banner separa explícitamente:

- `Estado del pedido: Preparado para revisión`;
- `Inventario: Listo | Pendiente de resolver | Requiere atención`.

Cada línea muestra su condición concreta. El copy histórico `Hay productos con lote pendiente de resolver en la siguiente fase` deja de renderizarse y es reemplazado por el motivo real.

## Ausencia de efectos operativos

La implementación no importa ni invoca:

- `processSale`;
- decrementos de productos;
- decrementos de lotes;
- movimientos de inventario;
- checkout/payment;
- quickCaja;
- caja;
- cocina o comanda cloud;
- split bill;
- apartados;
- descuentos;
- conversión a venta.

No se escribe `converted_to_sale` ni `converted_sale_id`.

Los guards de ECOM.POS.1.1–ECOM.POS.1.3.1 continúan ocultando y bloqueando las acciones operativas aun cuando `ecommerceInventoryStatus === 'ready'`. `ECOMMERCE_POS_CHECKOUT_NOT_ENABLED` no fue modificado.

## Pruebas específicas

### Servicio central

`src/services/ecommerce/__tests__/ecommercePosInventoryResolution.test.js`

Resultado: **22/22 PASS**.

Cobertura:

- ilimitado;
- exacto suficiente, insuficiente y desconocido;
- FEFO y exclusión de vencidos/agotados;
- sin lote vigente;
- solo lotes vencidos;
- stock distribuido entre lotes;
- selección manual válida e inválida;
- lote obsoleto;
- cambio de modo;
- estado global;
- persistencia y eliminación;
- ausencia de mutaciones y efectos de caja/venta.

### UI

`src/components/pos/__tests__/EcommercePosInventoryResolution.test.jsx`

Resultado: **2/2 PASS**.

Cobertura:

- separación entre estado del pedido e inventario;
- eliminación del copy de fase futura;
- acción de resolución;
- opciones manuales validadas;
- indicador FEFO;
- persistencia de selección mediante el servicio.

Total nuevo: **24/24 PASS**.

## Regresión ECOM.POS.1

Se ejecutaron individualmente 14 archivos relacionados para evitar contaminación de mocks y stores entre suites.

Resultado:

- 11 archivos PASS completos;
- 74 tests PASS;
- 3 tests con fallos que también existen en `main` sin ECOM.POS.2:
  - reapertura de borrador existente en `ecommercePosDraftService.test.js`;
  - navegación normal a payment en `useCheckoutFlow.ecommerce.test.jsx`;
  - submit de quickCaja con lock obsoleto en `usePosCheckout.ecommerce.test.jsx`.

Los mismos tres nombres de fallo aparecen en la línea base global de `main`; ECOM.POS.2 no modifica sus módulos de producción.

Las suites PASS confirman los guards de:

- checkout ecommerce;
- descuentos;
- cocina;
- split bill;
- apartados;
- órdenes activas y locks;
- banner ecommerce;
- POS móvil;
- administración de mesas.

## Validación global y comparación contra main

### Instalación

`npm ci`: **PASS**.

### ESLint específico

Los cuatro archivos JS/JSX de implementación y pruebas nuevas: **PASS**.

### Build

`npm run build`: **PASS**.

### Lint global

El repositorio mantiene una línea base global no limpia:

- PR: 382 problemas, 156 errores y 226 warnings;
- `main`: 382 problemas, 156 errores y 226 warnings;
- los logs normalizados son idénticos byte por byte;
- regresiones introducidas por ECOM.POS.2: **0**.

### Test global

- PR: 77 tests fallidos en 29 archivos, 580 PASS en 123 archivos;
- `main`: 77 tests fallidos en 29 archivos, 556 PASS en 121 archivos;
- los 83 registros `FAIL` normalizados tienen exactamente los mismos nombres en ambos checkouts;
- ECOM.POS.2 agrega 2 archivos y 24 tests, todos PASS;
- regresiones globales nuevas: **0**.

### Git

- `git diff --check origin/main...HEAD`: **PASS**;
- los artefactos de instalación/build se limpian antes de la comprobación final;
- el árbol rastreado queda sin modificaciones pendientes.

## Smoke test documentado

| Escenario | Resultado esperado/validado |
|---|---|
| Producto ilimitado | Inventario listo, sin lote, cobro bloqueado |
| Exacto con existencia | Stock verificado, inventario listo, cobro bloqueado |
| Exacto sin existencia | `INSUFFICIENT_STOCK`, requiere atención |
| Exacto desconocido | `INVENTORY_UNKNOWN`, fail-closed |
| Lote vigente | lote FEFO, número/caducidad visibles, cobro bloqueado |
| Sin lote vigente | `NO_VALID_BATCH`, requiere atención |
| Solo lote vencido | `ONLY_EXPIRED_BATCHES`, no seleccionable |
| Stock repartido | `MULTI_BATCH_REQUIRED`, sin división automática |
| Selección obsoleta | `BATCH_STALE`, `batchId` eliminado |

La matriz está respaldada por pruebas unitarias del servicio y pruebas renderizadas del banner. No se ejecutó un cobro porque esta fase debe mantenerlo bloqueado.

## Supabase

**SIN CAMBIOS**.

No se crearon tablas, estados remotos, RPC, migraciones ni modificaciones en producción. El claim existente es suficiente para conservar la propiedad del borrador y la resolución permanece local.

## Vercel

**NO UTILIZADO MANUALMENTE**.

No se usó CLI, API, agentes, preview, redeploy, promoción, alias, variables ni commits vacíos. La integración automática de GitHub puede publicar un check, pero no fue abierta ni usada como evidencia de validación.

## Conclusión

ECOM.POS.2 resuelve de forma provisional y fail-closed el inventario de pedidos ecommerce preparados, conserva compatibilidad con el checkout normal y no produce efectos operativos. El cobro continúa bloqueado para ECOM.POS.3.
