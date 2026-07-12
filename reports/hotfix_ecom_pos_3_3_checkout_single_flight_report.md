# HOTFIX ECOM.POS.3.3 — Estabilizar el inicio de cobro ante clics repetidos

## Estado

```text
ECOM.POS.3.3.1 IMPLEMENTACIÓN: COMPLETA
VALIDACIÓN ENFOCADA LOCAL: PASS
BUILD AUTOMÁTICO DEL CÓDIGO PRODUCTIVO: PASS
VALIDACIÓN GLOBAL DEL REPOSITORIO: PENDIENTE
ACEPTACIÓN MANUAL: PENDIENTE
PR: DRAFT
```

No se declara `ECOM.POS.3.3.1 CORRECCIÓN DE IDENTIDAD PASS` mientras no se ejecuten en un checkout íntegro del repositorio:

```text
npm ci
suites enfocadas reales del repositorio
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
comparación global contra main
```

También permanece pendiente la aceptación manual del flujo real de cobro.

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
- no se crearon workflows temporales de GitHub Actions;
- no se creó, forzó, promovió ni validó manualmente un preview de Vercel;
- no se usaron `.skip`, `.todo`, `eslint-disable` ni mocks destinados a ocultar el comportamiento real.

## ECOM.POS.3.3 — Single-flight del inicio

Se conserva el single-flight compartido por `orderId`:

- la primera llamada registra síncronamente la operación;
- 10–20 llamadas rápidas reciben la misma promesa;
- recuperación, lecturas, `attemptId`, lock y reserva se ejecutan una sola vez;
- `payment_pending` y `processing_sale` ignoran clics posteriores;
- un fallo retira únicamente su entrada mediante compare-and-clear;
- pedidos distintos conservan entradas independientes;
- la contención real de otra pestaña o dispositivo mantiene el mensaje canónico.

## ECOM.POS.3.3.1 — Identidad estricta del checkout

### Cruce A/B original

El gate capturaba la orden ecommerce A, pero después de varios `await` llamaba al checkout canónico sin indicar qué orden debía cobrar. El checkout volvía a leer `currentOrderId`; si el usuario había seleccionado B, la ejecución antigua podía adquirir un lock, abrir un modal o continuar con datos de B mientras el gate seguía actualizando A.

Además, la propiedad del intento aceptaba una orden inexistente:

```text
orden A ausente + respuesta tardía A => owner = true
```

Eso permitía que A intentara cerrar el modal global, liberar un lock o limpiar un snapshot que ya pertenecía a B.

### `expectedOrderId` y `expectedOrigin`

El checkout canónico acepta:

```js
handleInitiateCheckout({
  expectedOrderId,
  expectedOrigin
})
```

El gate ecommerce llama:

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

- lectura y validación de la orden;
- `lockOrderForCheckout`;
- persistencia de `checkoutAttemptId`;
- snapshot canónico;
- validación FEFO;
- validación o apertura de caja;
- apertura del modal de pago;
- procesamiento de venta;
- liberación del lock.

No se sustituye posteriormente por `currentOrderId`, `pos.activeOrderId` ni otra orden activa.

### Revalidación del target

Se agregó `resolveCheckoutTarget(...)` y el resultado controlado:

```text
ECOMMERCE_CHECKOUT_TARGET_CHANGED
```

Mensaje:

```text
La orden activa cambió durante el inicio del cobro. Vuelve a abrir el pedido e inténtalo nuevamente.
```

El target estricto exige:

```text
activeOrders.has(expectedOrderId)
currentOrderId === expectedOrderId
order.id === expectedOrderId
order.origin === expectedOrigin
```

Se revalida después de las operaciones asíncronas relevantes: preparación previa, recuperación ecommerce, lecturas remotas, comprobación idempotente, cocina, guardado de mesa, lectura Dexie, lock, persistencia de ownership, FEFO, caja y antes de abrir el modal.

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

- `isAttemptOwner(...)`: propiedad del intento local;
- `isCheckoutTargetStillActive(...)`: existencia, selección y origin del target;
- `ownsCheckoutSnapshot(...)`: propiedad del snapshot, modal y lock;
- contexto inmutable: propiedad de la reserva remota de A.

### Snapshot canónico con ownership

El snapshot contiene:

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

Antes de los `await` se captura un contexto inmutable:

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

Ese contexto permite cancelar o recuperar exclusivamente la reserva remota de A aunque A ya no esté en `activeOrders`. No autoriza cerrar el modal actual, liberar el lock de B, limpiar el snapshot de B ni modificar B.

La `conversionKey` se obtiene ahora de un snapshot de preflight calculado antes de entrar al checkout canónico. Esto evita que una falla posterior a la reserva —por ejemplo FEFO después del lock— pierda la clave porque el guard todavía no la había persistido en la copia local capturada por el gate.

Con esta corrección, una falla de inicio posterior a la reserva puede cancelar exactamente:

```text
order A
attemptId A
saleId A
conversionKey A
```

sin tocar B.

Si A cambia a B después de adquirir el lock, el wrapper propietario de `unlockOrder`:

1. captura el contexto inmutable de A;
2. libera el lock local de A;
3. cancela únicamente la reserva remota de A;
4. limpia A solo si el mismo `attemptId` todavía le pertenece;
5. deja B intacta.

Si el cambio ocurre antes del lock y la reserva sigue en `idle`, el settlement del single-flight devuelve A de `validating` a `idle` sin tocar B.

### Un solo checkout por pestaña

El single-flight sigue dividido por `orderId`, pero el checkout canónico y el modal son globales para la pestaña.

Si B posee el snapshot activo y A intenta iniciar:

```text
POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER
```

A no adquiere lock, no invalida B y no cierra su modal.

Pedidos distintos en pestañas o dispositivos separados conservan independencia mediante sus locks y reservas remotas.

### Protección de `removeOrder`

`removeOrder` protege:

```text
validating
payment_pending
processing_sale
sale_created
confirmation_pending
```

Comportamiento:

- `validating`: eliminación rechazada mientras inicio, lock o reserva estén activos;
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
src/hooks/pos/__tests__/useEcommercePosCheckoutGate.reservationContext.test.jsx
src/hooks/pos/__tests__/useEcommercePosCheckoutGate.singleFlight.test.jsx
src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx
src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx
src/services/ecommerce/__tests__/installEcommercePosActiveOrderGuards.test.js
```

Los archivos previos de ECOM.POS.3.3 para UI, wiring y helper single-flight permanecen dentro del mismo PR.

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
12. falla de inicio después de la reserva conserva y usa la `conversionKey` de A;
13. contención canónica de otro dispositivo;
14. POS normal sin argumentos;
15. efectivo;
16. tarjeta;
17. fiado;
18. `STOCK_WARNING` y `Sí, Vender Igual` sin readquirir el lock.

Las pruebas A/B usan órdenes diferentes:

```text
ecom-order-a
ecom-order-b
```

## Validación ejecutada

### Parseo y ESLint enfocado

Se ejecutó sobre los cinco módulos de implementación modificados:

```text
node --check: PASS
ESLint enfocado: PASS
Errores: 0
Advertencias del código: 0
```

### Harness enfocado con módulos reales

El entorno no pudo obtener un checkout íntegro desde GitHub. Se utilizó un harness local temporal que carga los módulos reales modificados y sustituye únicamente dependencias externas por dobles controlados.

Resultado final:

```text
Test files: 6 PASS
Tests: 24 PASS
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
- contexto remoto inmutable y `conversionKey` de preflight;
- efectivo, tarjeta, fiado y stock warning.

Este resultado valida la lógica modificada, pero no reemplaza las suites del repositorio completo.

### Build automático del código productivo

El commit productivo final:

```text
c0ac6133baf9618c75a16ec2b454520d9fa2be7c
```

generó automáticamente un despliegue de Vercel en estado `READY`. Se revisaron únicamente sus logs de compilación, sin abrir ni validar manualmente el preview.

Resultado del log:

```text
npm run build / vite build: PASS
Vite: 3300 módulos transformados
Build: 16.93 s
PWA generateSW: PASS
Build Completed: 22 s
Deployment completed
```

Advertencias no bloqueantes observadas:

- imports dinámicos y estáticos que no se separan en otro chunk;
- datos de `baseline-browser-mapping` y `caniuse-lite` desactualizados.

No hubo error de compilación.

El HEAD posterior agrega pruebas y documentación; su check automático de Vercel quedó bloqueado por el límite de builds del plan, no por un error de código.

## Validación pendiente

Permanecen pendientes por no disponer de un checkout íntegro del repositorio:

```text
npm ci en el repositorio completo
ESLint de todos los archivos modificados dentro del checkout real
suites enfocadas reales del repositorio
suite del panel ecommerce
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
comparación de fallos contra un checkout limpio de main
```

El build automático del commit productivo pasó, pero no sustituye la ejecución local de todos los comandos globales solicitados.

No se crearon workflows temporales para suplir esta limitación.

## Aceptación manual pendiente

Debe comprobarse en la aplicación real:

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
Contexto remoto inmutable: PASS ENFOCADO
ConversionKey preflight: PASS ENFOCADO
Remove validating: PROTEGIDO
Remove payment_pending: PROTEGIDO
Single-flight clics rápidos: PASS ENFOCADO
POS normal: PASS ENFOCADO
Build código productivo: PASS AUTOMÁTICO
Supabase: SIN CAMBIOS
Migraciones: NINGUNA
Estado del PR: DRAFT
```

La entrega final permanece bloqueada por validación global y aceptación manual. No se debe mergear automáticamente.
