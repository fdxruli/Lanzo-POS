# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha: 2026-07-11 (`America/Mexico_City`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- PR: `#88 — FASE ECOM.POS.1 — Preparar pedidos aceptados como órdenes activas del POS`
- Base: `main`
- Estado del PR: `draft`

## Estado actual

```text
ECOM.POS.1.3 PENDING GLOBAL VALIDATION
```

La implementación funcional de `ECOM.POS.1.3` quedó versionada en la rama del PR #88. El PR permanece en draft porque este entorno no dispone de un checkout íntegro ni de las dependencias del proyecto para ejecutar ESLint, Vitest, build, lint global y `test:ci`.

No se debe declarar `ECOM.POS.1.3 PASS`, marcar el PR como ready ni mergearlo hasta completar la validación global sobre el HEAD final.

## Contexto conservado

Las correcciones de `ECOM.POS.1.1` y `ECOM.POS.1.2` permanecen intactas:

- migraciones local/remoto alineadas;
- `source_product_id` resuelto para pedidos reales;
- trigger servidor para futuras filas;
- snapshot ecommerce con fallback seguro;
- protección central para `order?.origin === 'ecommerce'`;
- venta abierta, checkout, cocina, split bill y apartados bloqueados;
- reconciliación remoto/local;
- propiedad del claim y protección de PII;
- checkout real `usePosCheckout` protegido;
- descuentos generales y por línea ocultos y bloqueados para ecommerce.

Contrato estable:

```text
code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
message: Este pedido online está preparado para revisión. El cobro y la conversión definitiva se habilitarán en la siguiente fase.
```

## Integración de main

Antes de la corrección se integró el `main` actualizado mediante un merge controlado sobre la rama del PR:

```text
merge commit: 56fae9f3395665bc9819e71255dd737aa1cf7e12
```

Los cambios entrantes de `main` estaban limitados a la tienda pública responsiva y no se solapaban con checkout.

Comparación posterior:

```text
branch vs main: ahead
behind_by: 0
```

No se modificó directamente `main`.

## Corrección ECOM.POS.1.3 — Liberación idempotente de locks obsoletos

### Causa raíz

El snapshot anterior mezclaba dos conceptos distintos:

```text
snapshot inválido para vender
lock adquirido por el intento de checkout
```

Al marcar `invalidated=true`, los cierres y rollbacks omitían `unlockOrder`, aunque el intento original sí había adquirido el lock. La orden normal original podía quedar bloqueada cuando la orden activa cambiaba antes de una confirmación tardía.

### Identidad explícita del intento

Cada checkout genera un identificador no sensible:

```text
checkoutAttemptId
```

Se usa `crypto.randomUUID()` cuando está disponible y un fallback local seguro en caso contrario.

La propiedad se registra únicamente después de que `lockOrderForCheckout(orderId)` devuelve éxito. Se persiste en:

- la orden de `useActiveOrders.activeOrders`;
- el registro local de Dexie `STORES.SALES`.

El snapshot contiene:

```text
orderId
checkoutAttemptId
lockOwnedByCheckout
lockReleased
lockReleaseInFlight
lockReleasePromise
invalidated
consumed
```

### Propiedad del lock

La liberación usa exclusivamente `snapshot.orderId`; nunca selecciona la orden a desbloquear mediante `currentOrderId`.

Antes de llamar `unlockOrder(snapshot.orderId)` compara `checkoutAttemptId` contra:

- el registro persistido en Dexie;
- la orden correspondiente en memoria.

Si el propietario cambió, el helper devuelve `lock_not_owned` y no desbloquea la orden. Esto evita liberar locks adquiridos por otro intento, sesión o dispositivo.

### Unlock idempotente

Se agregó `releaseCheckoutSnapshotLock(snapshot, { reason })`.

El helper:

1. exige `orderId` y propiedad explícita;
2. ignora snapshots ya liberados;
3. reutiliza la misma promesa cuando existe una liberación en curso;
4. marca la liberación en curso antes del primer `await`;
5. valida propiedad en memoria y Dexie;
6. llama `unlockOrder` una sola vez por intento concurrente;
7. limpia el propietario únicamente tras éxito;
8. conserva `lockReleaseError` y la referencia cuando falla, permitiendo reintento.

Resultados estables:

```text
released=true
already_released
lock_not_owned
unlock_failed
```

### Invalidación separada de liberación

`invalidateCheckoutSnapshot` marca el snapshot como inválido para vender, pero conserva la obligación de liberar el lock propio.

La referencia solo se limpia cuando:

- el lock quedó liberado;
- el intento ya no es propietario;
- la venta consumió el snapshot.

Si el unlock falla, el snapshot permanece disponible para reintento fail-closed.

### Carrera A normal → B ecommerce

Cuando una orden normal A adquirió el lock y la orden viva cambia a una orden ecommerce B:

- prevalece `ECOMMERCE_POS_CHECKOUT_NOT_ENABLED`;
- `processSale` no se ejecuta;
- se invalida el snapshot A;
- se libera exclusivamente el lock de A;
- B no se desbloquea ni modifica;
- el cierre posterior del modal no repite el unlock.

### Carrera A normal → C normal

Cuando el target cambia de A a otra orden normal C:

- se devuelve `POS_CHECKOUT_SNAPSHOT_STALE`;
- se libera el lock propio de A;
- C no se desbloquea;
- no se procesa la venta tardía.

### Cierres de modal

`handlePaymentModalClose` y `handleQuickCajaClose` usan el helper idempotente.

Orden de operación:

1. capturar snapshot;
2. intentar liberar su lock propio;
3. limpiar la referencia si la liberación quedó resuelta;
4. cerrar el modal.

Un fallo no provoca que el modal desbloquee otra orden y queda recuperable mediante un reintento posterior o el inicio controlado de otro checkout.

### Quick caja

`handleQuickCajaSubmit` valida el snapshot:

- antes de `abrirCaja`;
- después de `abrirCaja`;
- después de `asegurarCajaAbierta`;
- antes de volver a `payment`.

Si la caja ya se abrió y después se detecta el cambio de orden, no se intenta revertir la apertura. El cobro se bloquea, se libera A y se muestra un mensaje seguro.

### Stock warning y Vender Igual

Un resultado `STOCK_WARNING` conserva intencionalmente:

```text
lockOwnedByCheckout=true
lockReleased=false
invalidated=false
```

El callback `Vender Igual`:

- revalida snapshot y orden viva;
- reutiliza el lock propio si sigue vigente;
- no vuelve a llamar `lockOrderForCheckout` contra su propio lock;
- readquiere únicamente si el lock fue liberado;
- ejecuta `processSale(..., ignoreStock=true)` una sola vez por confirmación.

### Error y venta exitosa

Cuando `processSale` falla o devuelve un error no recuperable, el `finally` libera el lock propio mediante el helper idempotente.

Cuando la venta tiene éxito:

- el snapshot se marca `consumed`;
- la propiedad se considera resuelta;
- `removeOrder(snapshot.orderId)` elimina la orden;
- no se ejecuta rollback ni unlock posterior.

## Pruebas añadidas o ampliadas

### usePosCheckout

Se actualizó:

```text
src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx
```

Cubre:

- estados ecommerce `claimed`, `prepared`, `error_releasing`, faltante y desconocido;
- A normal → B ecommerce;
- A normal → C normal;
- unlock exactamente una vez;
- cierre de modal después de invalidación;
- quick caja obsoleta;
- stock warning y `Vender Igual` sin readquirir el lock propio;
- cancelación normal;
- error de `processSale`;
- venta exitosa sin rollback;
- unlock fallido y reintento recuperable sobre A;
- quick caja normal sin regresiones.

### useActiveOrders

Se agregó:

```text
src/hooks/pos/__tests__/useActiveOrders.checkoutLock.test.js
```

Cubre:

- lock A persistido en memoria y Dexie;
- unlock A limpiando memoria y Dexie;
- `currentOrderId=C` preservado al desbloquear A;
- `isCurrentOrderLocked` solo cambia cuando corresponde;
- dos unlock consecutivos seguros;
- otra orden no se modifica.

La suite existente `src/hooks/pos/__tests__/useActiveOrders.test.js` se conserva como regresión.

## Validación ejecutada en este entorno

Los blobs remotos coinciden byte por byte con los archivos validados localmente.

```text
node --check src/hooks/pos/usePosCheckout.js: PASS
node --check src/hooks/pos/__tests__/useActiveOrders.checkoutLock.test.js: PASS
parseo TypeScript AST de usePosCheckout.ecommerce.test.jsx: PASS
trailing whitespace en los tres archivos: 0
caracteres tab accidentales: 0
newline final: PASS
main integrado: PASS
branch behind main: 0
```

Estas comprobaciones no sustituyen ESLint, Vitest ni build.

## Validación global pendiente

No fue posible ejecutar en este entorno:

```text
npm ci
npx eslint <archivos modificados>
npx vitest run <suites específicas y regresión>
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
git diff --name-status origin/main...HEAD
```

Motivo verificable:

- el contenedor no puede resolver `github.com` para clonar el checkout;
- no existe un checkout íntegro accesible localmente;
- las dependencias del proyecto no están instaladas;
- no se creó ningún workflow temporal;
- Vercel no se usa como sustituto de la validación.

## Supabase

No se realizaron cambios en Supabase.

No se aplicaron migraciones ni se modificaron claims, pedidos, `source_product_id` o `EC-00000010–12`.

```text
Supabase: SIN CAMBIOS
```

## Vercel

No se invocó manualmente Vercel mediante API, CLI o agentes. No se creó, intentó, forzó, promovió ni validó preview.

```text
Vercel manual: NO UTILIZADO
```

## Estado de aceptación

```text
Propiedad explícita del lock: IMPLEMENTADA
Snapshot obsoleto fail-closed: IMPLEMENTADO
Unlock idempotente: IMPLEMENTADO
Cambio a ecommerce: COBERTURA AÑADIDA
Cambio a orden normal: COBERTURA AÑADIDA
Cierre de modal idempotente: COBERTURA AÑADIDA
Quick caja obsoleta: COBERTURA AÑADIDA
Stock warning: COBERTURA AÑADIDA
Vender Igual sin self-lock: COBERTURA AÑADIDA
Error de processSale: COBERTURA AÑADIDA
Venta exitosa sin rollback: COBERTURA AÑADIDA
Unlock fallido recuperable: COBERTURA AÑADIDA
Orden POS normal: COBERTURA DE REGRESIÓN AÑADIDA
Ecommerce fail-closed: CONSERVADO
Parseo sintáctico limitado: PASS
main integrado: PASS
ESLint específico: PENDIENTE
Vitest específico: PENDIENTE
Regresión completa: PENDIENTE
Build global: PENDIENTE
npm run lint: PENDIENTE
npm run test:ci: PENDIENTE
Comparación ejecutable contra main: PENDIENTE
Supabase: SIN CAMBIOS
Vercel manual: NO UTILIZADO
```

## Decisión final

```text
ECOM.POS.1.3 PENDING GLOBAL VALIDATION
```

El PR #88 debe permanecer en draft. No marcar `ready for review`, no declarar `ECOM.POS.1.3 PASS` y no mergear hasta ejecutar la validación frontend/global completa sobre el HEAD final y corregir únicamente regresiones introducidas por esta rama.
