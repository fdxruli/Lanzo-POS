# HOTFIX ECOM.POS.3.3 — Estabilizar el inicio de cobro ante clics repetidos

## Estado

```text
IMPLEMENTACIÓN COMPLETA
VALIDACIÓN AUTOMATIZADA PENDIENTE
PR DRAFT
```

Este reporte documenta el hotfix aplicado exclusivamente en:

```text
hotfix-ecom-pos-3-3
```

Base confirmada:

```text
main @ a66c099c49a620264b1573d8c81002356ffbf17b
```

El PR #90 ya estaba mergeado antes de crear la rama.

## Reproducción real

Con un pedido ecommerce preparado e inventario listo, una ráfaga de clics sobre `Cobrar pedido` podía iniciar varias ejecuciones concurrentes de `handleInitiateCheckout()` antes de que React reflejara el estado bloqueado.

La protección canónica impedía duplicar la venta, pero las ejecuciones locales competían durante recuperación, lectura remota, búsqueda idempotente, creación del `attemptId`, lock local y reserva remota. Esto producía mensajes incorrectos:

```text
La orden ya está siendo cobrada desde otro dispositivo.
No se pudo identificar el intento de cobro.
```

El modal de pago podía no abrirse, aunque un clic único funcionaba correctamente.

## Causa raíz

`useEcommercePosCheckoutGate.handleInitiateCheckout()` creaba el `attemptId` y establecía `VALIDATING` después de varias operaciones asíncronas. El botón se deshabilitaba por estado React, pero varios eventos podían entrar antes de la actualización visual.

El lock Dexie seguía evitando ventas duplicadas; el defecto era la falta de exclusión síncrona para el inicio local del mismo pedido.

## Corrección

### Single-flight por `orderId`

Se agregó un registro compartido en módulo:

```text
Map<orderId, { token, promise }>
```

La primera llamada:

1. crea un token `Symbol(orderId)`;
2. registra la promesa compartida antes de ejecutar el flujo asíncrono;
3. establece inmediatamente `ecommerceCheckoutInitiationStatus = 'starting'`;
4. ejecuta el gate ecommerce existente una sola vez.

Las llamadas adicionales para el mismo `orderId` reciben exactamente la promesa ya registrada. Por lo tanto, no alcanzan recuperación, lectura remota, generación de `attemptId`, lock ni reserva.

Pedidos distintos conservan entradas independientes y pueden iniciar checkout simultáneamente.

### Compare-and-clear

La limpieza solo elimina la entrada cuando el token actual coincide con el token propietario:

```text
current.token === ownedToken
```

Una respuesta o limpieza antigua no puede borrar el single-flight de un intento posterior.

### Estado visual inmediato

El panel muestra:

```text
Iniciando cobro…
```

mientras la iniciación está pendiente y deshabilita el botón. Este estado es únicamente visual; la exclusión real depende del `Map` síncrono.

Un marcador visual `starting` restaurado sin una entrada viva en el `Map` se considera obsoleto, se limpia y permite reintentar.

### Éxito, fallo y reintento

- En éxito, las llamadas duplicadas comparten el mismo resultado y el checkout normal pasa a `payment_pending`.
- Durante `validating`, `payment_pending` o `processing_sale`, un clic posterior se ignora sin mensaje y sin efectos.
- En fallo, la promesa se retira mediante `finally`; el siguiente clic puede crear una nueva operación.
- Una excepción durante la limpieza visual no transforma un resultado exitoso en error.

### Propiedad y respuestas antiguas

El single-flight conserva una única operación local propietaria hasta que todas sus operaciones esperadas terminan. El token de registro aplica compare-and-clear. La prueba de respuesta antigua guarda el token real del intento A, inicia el intento B y confirma que el token A no puede eliminar la entrada B.

### Lock local y otro dispositivo

No se modificó ni debilitó `lockOrderForCheckout()`.

El wrapper no interpreta por sí solo `isLockedForCheckout` como clic duplicado. Un lock ya existente con conversión local inactiva sigue entrando al checkout canónico para conservar la contención real y el mensaje de otro dispositivo.

### Reserva remota

Los clics absorbidos no alcanzan `installEcommercePosActiveOrderGuards`, por lo que una ráfaga local ejecuta como máximo una vez la reserva `ecommerce_begin_pos_conversion(...)`.

No se modificó el contrato remoto ni Supabase.

### POS normal

Las órdenes no ecommerce pasan directamente al checkout canónico sin usar el single-flight ecommerce.

## Archivos modificados

```text
src/components/pos/EcommercePosConversionPanel.jsx
src/hooks/pos/usePos.js
```

## Archivos agregados

```text
src/hooks/pos/ecommerceCheckoutInitiationSingleFlight.js
src/hooks/pos/useEcommercePosCheckoutSingleFlight.js
src/hooks/pos/__tests__/ecommerceCheckoutInitiationSingleFlight.test.js
src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx
src/hooks/pos/__tests__/useEcommercePosCheckoutGate.singleFlight.test.jsx
```

## Pruebas agregadas

Las nuevas pruebas cubren:

- diez llamadas simultáneas para la misma orden;
- una sola promesa y una sola ejecución subyacente;
- una creación de `attemptId`;
- una recuperación, lectura remota y búsqueda idempotente;
- un lock local y una reserva remota simulados;
- resultado compartido y cero mensajes de error;
- `payment_pending` sin segundo inicio;
- fallo seguido de reintento;
- intento A incapaz de limpiar el intento B;
- dos pedidos distintos concurrentes;
- preservación de la contención canónica de otro dispositivo;
- paso directo del checkout POS normal;
- estado visual inmediato y recuperación de marcador visual obsoleto.

## Validación

### Inspección estructural

```text
Base de rama: PASS
Rama separada de main: PASS
Cambios limitados a frontend, hook, pruebas y reporte: PASS
Supabase: SIN CAMBIOS
Migraciones: NINGUNA
SQL de escritura: NINGUNO
Workflows temporales: NINGUNO
Vercel manual: NO UTILIZADO
```

### Comandos solicitados

La sesión de ejecución no dispone de `gh` y el contenedor no puede resolver `github.com`, por lo que todavía no fue posible obtener un checkout local para ejecutar:

```text
npm ci
ESLint específico
suites enfocadas
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
```

No se declaran resultados inventados. El PR permanece draft y se revisarán los checks existentes de GitHub sin crear workflows adicionales.

### Prueba manual

La aceptación manual de 10–20 clics rápidos permanece pendiente. No se declara `HOTFIX ECOM.POS.3.3 PASS` hasta completar la validación automatizada y manual requerida.

## HEAD de implementación documentado

```text
e416dfbe49bc2c23d7992ed669c43b7ddb781791
```

El HEAD final del PR incluye este reporte y debe consultarse en la descripción actualizada del PR.

## Restricciones respetadas

- `main`: sin modificación directa;
- rama `fase-ecom-pos-3`: no reutilizada;
- PR adicional: no creado;
- merge automático: no realizado;
- Supabase: sin cambios;
- migraciones: ninguna;
- SQL de escritura: ninguno;
- workflows temporales: ninguno;
- previews Vercel: no creados, forzados, promovidos ni validados;
- pruebas existentes: no eliminadas ni debilitadas;
- `.skip`, `.todo`, `eslint-disable`: no utilizados.
