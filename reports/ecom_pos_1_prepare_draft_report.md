# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha: 2026-07-11 (`America/Mexico_City`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- PR: `#88 — FASE ECOM.POS.1 — Preparar pedidos aceptados como órdenes activas del POS`
- Base: `main`
- Estado del PR: `draft`

## Estado actual

```text
ECOM.POS.1 PENDING GLOBAL VALIDATION
```

El PR permanece en draft. No debe marcarse `ready for review`, declararse `PASS` ni mergearse hasta completar la validación global sobre el HEAD final.

## Contexto conservado

Las correcciones anteriores permanecen intactas:

- `ECOM.POS.1.1`: mapeo seguro de productos, guards operativos, reconciliación, propiedad del claim y protección de PII;
- `ECOM.POS.1.2`: checkout real y descuentos ecommerce fail-closed;
- `ECOM.POS.1.3`: propiedad explícita del lock, snapshot obsoleto, unlock idempotente, quick caja y `Vender Igual` sin self-lock.

Contrato ecommerce estable:

```text
code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
message: Este pedido online está preparado para revisión. El cobro y la conversión definitiva se habilitarán en la siguiente fase.
```

## Corrección ECOM.POS.1.3.1 — Ruta controlada de cancelación de STOCK_WARNING

### Causa raíz

Cuando `processSale` devolvía `STOCK_WARNING`, el flujo conservaba correctamente el snapshot y su lock para permitir `Sí, Vender Igual`. Sin embargo, el aviso mostraba cancelación y era descartable por backdrop sin una ruta controlada que liberara el lock.

El estado podía quedar así:

```text
lockOwnedByCheckout=true
lockReleased=false
isLockedForCheckout=true
modal cerrado
```

### Cancelar venta

La rama `STOCK_WARNING` ahora define una cancelación explícita que:

1. llama `releaseCheckoutSnapshotLock(snapshot, { reason: 'stock_warning_cancelled' })`;
2. usa exclusivamente `snapshot.orderId`;
3. no ejecuta `processSale` ni force sale;
4. limpia `checkoutSnapshotRef.current` únicamente cuando la liberación queda resuelta correctamente;
5. deja la orden original editable tras liberar su lock;
6. no elimina la orden, no remueve artículos y no modifica inventario o caja.

### Fallo de unlock

Si el unlock falla:

- se conserva `lockOwnedByCheckout`;
- se conserva `lockReleased=false`;
- se conserva `checkoutAttemptId`;
- se conserva `checkoutSnapshotRef.current`;
- no se toca ninguna orden distinta;
- se muestra una advertencia segura;
- `handlePaymentModalClose` o `prepareForNewCheckout` pueden reintentar liberar el lock original.

### Backdrop

El aviso usa:

```text
showCancel=true
cancelButtonText=Cancelar venta
isDismissible=false
onCancel=cancelStockWarningCheckout
```

Un clic en el backdrop no confirma, no cancela, no libera el lock y no cierra el aviso. El lock permanece retenido intencionalmente mientras el operador decide.

### Sí, Vender Igual

El flujo existente se conserva:

- revalida el snapshot y la orden viva;
- bloquea si la orden cambió o se volvió ecommerce;
- reutiliza el lock cuando todavía pertenece al intento;
- readquiere únicamente si ya fue liberado;
- llama una sola vez `handleProcessOrder(paymentData, true)`.

No se libera el lock antes del force sale.

## Alcance

La corrección funcional se limita a:

```text
src/hooks/pos/usePosCheckout.js
```

No se modificaron:

- `useActiveOrders.js`;
- contratos públicos o códigos de error;
- checkout normal;
- quick caja;
- snapshot obsoleto;
- venta exitosa;
- errores normales de `processSale`;
- ecommerce guards;
- descuentos;
- cocina;
- apartados;
- split bill;
- dependencias o workflows.

## Validación

Por instrucción de esta corrección puntual no se solicitaron ni ejecutaron pruebas adicionales.

La validación global permanece pendiente.

## Supabase

```text
Supabase: SIN CAMBIOS
```

No se ejecutó SQL, no se aplicaron migraciones y no se modificaron pedidos, claims, `source_product_id` ni `EC-00000010–12`.

## Vercel

```text
Vercel manual: NO UTILIZADO
```

No se utilizó CLI, API, agentes, previews, redeploy, promoción, aliases, variables ni commits vacíos.

## Estado de la corrección

```text
ECOM.POS.1.3.1 IMPLEMENTADO

Cancelar STOCK_WARNING: CORREGIDO
Backdrop descartable: BLOQUEADO
Unlock de orden original: IMPLEMENTADO
Snapshot recuperable ante fallo: IMPLEMENTADO
Vender Igual: CONSERVADO
Supabase: SIN CAMBIOS
Vercel manual: NO UTILIZADO
```

El PR #88 permanece en draft y pendiente de validación global.
