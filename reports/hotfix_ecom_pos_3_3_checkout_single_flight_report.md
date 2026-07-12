# HOTFIX ECOM.POS.3.3 — Estabilizar el inicio de cobro ante clics repetidos

## Estado

```text
ECOM.POS.3.3.1 IMPLEMENTACIÓN: COMPLETA
VALIDACIÓN ENFOCADA LOCAL: PASS
VALIDACIÓN GLOBAL DEL REPOSITORIO: PENDIENTE
ACEPTACIÓN MANUAL: PENDIENTE
PR: DRAFT
```

No se declara `ECOM.POS.3.3.1 CORRECCIÓN DE IDENTIDAD PASS` mientras no se ejecuten sobre un checkout íntegro del repositorio:

```text
npm ci
suites enfocadas reales del repositorio
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
comparación global contra main
```

Tampoco se declara aceptación manual hasta repetir los cobros reales solicitados.

## Rama y alcance

```text
Repositorio: fdxruli/Lanzo-POS
Rama: hotfix-ecom-pos-3-3
PR: #91
Base: main
Estado del PR: DRAFT
Merge automático: NO
```

Restricciones respetadas:

- no se modificó `main`;
- no se creó otro PR;
- no se modificó Supabase;
- no se crearon ni modificaron migraciones;
- no se ejecutó SQL contra producción;
- no se crearon workflows temporales;
- no se creó, forzó, promovió ni validó un preview manual en Vercel;
- no se usaron `.skip`, `.todo`, `eslint-disable` ni mocks destinados a ocultar el comportamiento real.

## ECOM.POS.3.3 — Single-flight del inicio

La primera parte del hotfix mantiene un registro single-flight compartido por `orderId`:

- la primera llamada registra síncronamente la operación;
- 10–20 llamadas rápidas reciben la misma promesa;
- recuperación, lecturas, `attemptId`, lock y reserva se ejecutan una vez;
- `payment_pending` y `processing_sale` ignoran clics posteriores;
- un fallo retira únicamente su entrada mediante compare-and-clear;
- pedidos distintos conservan entradas independientes;
- la contención canónica de otra pestaña o dispositivo no se reemplaza por un mensaje local falso.

## ECOM.POS.3.3.1 — Identidad estricta del checkout

### Cruce A/B original

El gate capturaba la orden ecommerce A. Después de varias operaciones asíncronas invocaba el checkout canónico sin indicar la orden esperada. El checkout canónico volvía a leer `currentOrderId`; si el usuario ya había seleccionado B, la ejecución antigua de A podía adquirir un lock, abrir un modal o continuar con datos de B mientras el gate seguía actualizando A.

Además, la función de propiedad del intento aceptaba una orden inexistente como propietaria:

```text
orden A ausente + respuesta tardía A => owner = true
```

Eso permitía que A intentara cerrar el modal global, liberar un lock o limpiar un snapshot que ya pertenecía a B.

### `expectedOrderId` y `expectedOrigin`

El contrato interno del checkout canónico acepta ahora:

```js
handleInitiateCheckout({
  expectedOrderId,
  expectedOrigin
})
```

El gate ecommerce siempre llama:

```js
checkout.handleInitiateCheckout({
  expectedOrderId: orderId,
  expectedOrigin: 'ecommerce'
});
```

Las llamadas POS normales continúan funcionando sin argumentos:

```js
handleInitiateCheckout();
```

Cuando existe `expectedOrderId`, esa identidad es la fuente de verdad para:

- leer la orden;
- validar el target;
- adquirir el lock;
- persistir `checkoutAttemptId`;
- construir el snapshot;
- validar FEFO;
- validar o abrir caja;
- abrir el modal de pago;
- procesar la venta;
- liberar el lock.

No se sustituye posteriormente por `currentOrderId`, `pos.activeOrderId` u otra orden activa.

### Revalidación del target

Se agregó `resolveCheckoutTarget(...)` y un resultado controlado:

```text
ECOMMERCE_CHECKOUT_TARGET_CHANGED
```

Mensaje:

```text
La orden activa cambió durante el inicio del cobro. Vuelve a abrir el pedido e inténtalo nuevamente.
```

El target estricto requiere simultáneamente:

```text
activeOrders.has(expectedOrderId)
currentOrderId === expectedOrderId
order.id === expectedOrderId
order.origin === expectedOrigin
```

El checkout revalida después de las operaciones asíncronas relevantes, incluyendo preparación previa, cocina, persistencia de mesa, lectura Dexie, lock, propiedad del lock, FEFO, caja y antes de abrir el modal.

Política A → B:

```text
A se aborta.
B permanece seleccionada.
A no bloquea B.
A no abre el modal de B.
A no pasa a payment_pending.
A libera únicamente su lock y su reserva si ya los había adquirido.
```

### Propiedad estricta del intento

La propiedad local quedó estricta:

```js
if (!orderId || !ownedAttemptId) return false;

const current = getOrderById(orderId);
return Boolean(current)
  && current.ecommerceConversionAttemptId === ownedAttemptId;
```

Una orden inexistente ya no autoriza acciones locales.

Se separaron los conceptos:

- `isAttemptOwner(...)` para propiedad del intento local;
- `isCheckoutTargetStillActive(...)` para selección y existencia del target;
- `ownsCheckoutSnapshot(...)` para propiedad del snapshot/modal/lock;
- contexto inmutable para recuperar o cancelar la reserva remota de A.

### Snapshot canónico con ownership

El snapshot canónico contiene explícitamente:

```js
{
  orderId,
  checkoutAttemptId,
  origin
}
```

Las rutas de cierre, error y liberación exigen coincidencia exacta de:

```text
snapshot.orderId === expectedOrderId
snapshot.checkoutAttemptId === expectedCheckoutAttemptId
```

Cuando no coincide, devuelven un no-op exitoso:

```text
success: true
ignored: true
staleAttempt: true
code: ECOMMERCE_STALE_CHECKOUT_ATTEMPT
```

En ese caso no se ejecuta:

- `modal.closeModal`;
- `unlockOrder`;
- limpieza de `checkoutSnapshotRef`;
- advertencia al usuario;
- modificación de otra orden.

### Reserva remota separada del modal global

Antes de los `await` se captura un contexto inmutable con:

```js
{
  localOrderId,
  ecommerceOrderId,
  attemptId,
  actorIdentity,
  claimToken,
  conversionKey,
  saleId,
  orderSnapshot
}
```

Ese contexto puede cancelar o recuperar exclusivamente la reserva remota de A aunque A ya no esté en `activeOrders`.

No autoriza cerrar el modal actual, liberar el lock de B, limpiar el snapshot de B ni modificar B.

Si el cambio A → B ocurre después de que A adquirió el lock, el wrapper de `unlockOrder`:

1. captura el contexto inmutable de A;
2. libera el lock local de A;
3. cancela únicamente la reserva remota de A;
4. limpia A solo si el mismo `attemptId` todavía le pertenece;
5. deja B intacta.

Si el cambio ocurre antes del lock y la reserva remota aún está en `idle`, el settlement del single-flight devuelve A de `validating` a `idle` sin tocar B.

### Un solo checkout por pestaña

El single-flight sigue dividido por `orderId`, pero el checkout canónico y el modal son globales para la pestaña.

Si B ya posee el snapshot activo y A intenta iniciar:

```text
POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER
```

A no adquiere lock, no invalida B y no cierra su modal.

Pedidos distintos en pestañas o dispositivos separados conservan independencia mediante sus locks y reservas remotas.

### Protección de `removeOrder`

`removeOrder` protege ahora los estados:

```text
validating
payment_pending
processing_sale
sale_created
confirmation_pending
```

Comportamiento:

- `validating`: eliminación rechazada mientras el inicio, lock o reserva estén activos;
- `payment_pending`: eliminación rechazada hasta cancelar el checkout por la ruta propietaria;
- `processing_sale`, `sale_created`, `confirmation_pending`: orden preservada para recuperación o confirmación.

La orden no se elimina antes de comprobar ownership y estado operativo.

## Archivos principales modificados

```text
src/hooks/pos/checkoutTargetIdentity.js
src/hooks/pos/useEcommercePosCheckoutGate.js
src/hooks/pos/useEcommercePosCheckoutSingleFlight.js
src/hooks/pos/usePosCheckout.js
src/services/ecommerce/installEcommercePosActiveOrderGuards.js
src/hooks/pos/__tests__/checkoutTargetIdentity.test.js
src/hooks/pos/__tests__/useEcommercePosCheckoutGate.singleFlight.test.jsx
src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx
src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx
src/services/ecommerce/__tests__/installEcommercePosActiveOrderGuards.test.js
```

Los archivos previos de ECOM.POS.3.3 para UI y helper single-flight permanecen dentro del mismo PR.

## Pruebas agregadas o ampliadas

Se cubrieron expresamente:

1. veinte llamadas simultáneas sobre A comparten una ejecución;
2. un solo `attemptId`, lock y reserva;
3. A cambia a B mientras recuperación está pendiente;
4. A cambia a B después del lock;
5. A desaparece antes de una respuesta tardía;
6. A desaparece y B mantiene su intento vigente;
7. snapshot B frente a cierre o fallo de A;
8. B activo impide que A reemplace el checkout global;
9. `removeOrder` durante `validating`;
10. `removeOrder` durante `payment_pending`;
11. limpieza exclusiva de la reserva de A con contexto inmutable;
12. contención canónica de otro dispositivo;
13. POS normal sin argumentos;
14. efectivo;
15. tarjeta;
16. fiado;
17. `STOCK_WARNING` y `Sí, Vender Igual` sin reacquirir el lock.

Las pruebas A/B usan órdenes distintas:

```text
ecom-order-a
ecom-order-b
```

## Validación ejecutada en esta sesión

### Parseo y ESLint enfocado

Se ejecutó sobre los módulos de implementación modificados:

```text
node --check: PASS
ESLint enfocado: PASS
Errores: 0
Advertencias del código: 0
```

### Harness enfocado ejecutando módulos reales

Debido a que el entorno no pudo obtener un checkout íntegro desde GitHub, se creó un harness local temporal que carga los módulos reales modificados y sustituye únicamente sus dependencias externas por dobles controlados.

Resultado acumulado:

```text
Test files: 6 PASS
Tests: 23 PASS
Failures: 0
```

Cobertura del harness:

- helper de identidad y ownership;
- helper single-flight;
- wrapper single-flight React;
- gate ecommerce React;
- checkout canónico React;
- guards de órdenes activas;
- A/B antes y después del lock;
- cierre owner-aware;
- efectivo, tarjeta, fiado y stock warning.

Este resultado valida la lógica modificada, pero no reemplaza las suites del repositorio completo.

## Validación pendiente

El entorno de ejecución no pudo resolver los hosts de GitHub y no dispone de un checkout completo del repositorio. Permanecen pendientes:

```text
npm ci en el repositorio completo
ESLint sobre todos los archivos modificados dentro del checkout real
suites enfocadas reales del repositorio
panel ecommerce
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
comparación de fallos contra un checkout limpio de main
```

No se crearon workflows temporales para suplir esta limitación.

## Aceptación manual pendiente

Todavía debe comprobarse en la aplicación real:

- 10–20 clics rápidos sobre el mismo pedido;
- cambio A → B durante recuperación;
- cambio A → B después del lock;
- efectivo;
- tarjeta;
- fiado y ledger;
- `STOCK_WARNING` / `Sí, Vender Igual`;
- cancelación del modal;
- mismo pedido desde otro dispositivo;
- pedidos distintos desde dispositivos separados;
- POS normal.

## Resultado actual

```text
expectedOrderId: IMPLEMENTADO
Orden A abre B: BLOQUEADO POR PRUEBAS ENFOCADAS
Cambio A → B: ABORTO SEGURO EN PRUEBAS ENFOCADAS
Orden inexistente como owner: BLOQUEADO
Respuesta antigua A cierra B: NO EN PRUEBAS ENFOCADAS
Respuesta antigua A libera lock B: NO EN PRUEBAS ENFOCADAS
Snapshot con ownership: PASS ENFOCADO
Remove validating: PROTEGIDO
Remove payment_pending: PROTEGIDO
Single-flight clics rápidos: PASS ENFOCADO
POS normal: PASS ENFOCADO
Supabase: SIN CAMBIOS
Migraciones: NINGUNA
Estado del PR: DRAFT
```

La entrega final permanece bloqueada por validación global y aceptación manual; no se debe mergear automáticamente.
