# HOTFIX ECOM.POS.3.3 — Estabilizar el inicio de cobro ante clics repetidos

## Estado

```text
IMPLEMENTACIÓN COMPLETA
VALIDACIÓN CRÍTICA PARCIAL: PASS
VALIDACIÓN GLOBAL Y MANUAL: PENDIENTE
PR DRAFT
```

No se declara `HOTFIX ECOM.POS.3.3 PASS` porque todavía faltan el checkout íntegro, las suites globales y la aceptación manual solicitada.

## Rama y base

```text
Repositorio: fdxruli/Lanzo-POS
Rama: hotfix-ecom-pos-3-3
PR: #91
Base: main @ a66c099c49a620264b1573d8c81002356ffbf17b
HEAD de implementación antes de actualizar este reporte: 4c0882e5070d8b89a217883747e4a2861b3d9397
Estado del PR: DRAFT
```

El PR #90 ya estaba mergeado en `main` antes de crear la rama. No se reutilizó `fase-ecom-pos-3`.

## Reproducción real

Con un pedido ecommerce preparado e inventario listo, una ráfaga de clics sobre `Cobrar pedido` podía iniciar varias ejecuciones concurrentes de `handleInitiateCheckout()` antes de que React reflejara el estado bloqueado.

La protección canónica evitaba ventas duplicadas, pero los inicios locales competían durante:

```text
recuperación
lectura remota
búsqueda idempotente
creación del attemptId
lock local
reserva remota
```

Los síntomas observados eran:

```text
La orden ya está siendo cobrada desde otro dispositivo.
No se pudo identificar el intento de cobro.
```

El modal podía no abrirse. Con un clic único, el flujo funcionaba correctamente.

## Causa raíz

`useEcommercePosCheckoutGate.handleInitiateCheckout()` generaba el `attemptId` y establecía `VALIDATING` después de varias operaciones asíncronas. El estado React y el atributo `disabled` se actualizaban demasiado tarde para excluir eventos ya ingresados.

El lock Dexie y la reserva remota continuaban protegiendo contra ventas dobles; el defecto era la ausencia de una exclusión síncrona local antes del primer `await`.

## Implementación

### 1. Single-flight global por `orderId`

Se agregó un registro compartido a nivel de módulo:

```text
Map<orderId, { token, promise }>
```

La primera llamada:

1. normaliza `order.id`;
2. crea `Symbol(orderId)`;
3. registra la promesa compartida en el `Map`;
4. establece el indicador visual `starting`;
5. libera la ejecución asíncrona del gate.

El registro queda publicado antes de que `run()` ejecute recuperación, lecturas, `createAttemptId`, lock o reserva.

Las llamadas adicionales para la misma orden reciben exactamente la misma promesa y no alcanzan efectos secundarios.

Pedidos distintos conservan entradas independientes y pueden iniciar checkout en paralelo.

### 2. Compare-and-clear

La limpieza solo elimina la entrada cuando el token propietario sigue siendo el actual:

```text
current?.token === ownedToken
```

Una operación A antigua no puede borrar la entrada perteneciente a una operación B posterior.

La limpieza visual se ejecuta después de retirar la entrada y una excepción visual no convierte un resultado exitoso en una promesa rechazada.

### 3. AttemptId estable

Una ráfaga local utiliza una sola ejecución del gate. Por diseño:

```text
createAttemptId: 1
recoverEcommercePosConversion: 1
getEcommercePosConversionRemoteState: 1
findEcommerceSale: 1
lockOrderForCheckout: 1
ecommerce_begin_pos_conversion: 1
```

El `attemptId` creado por esa ejecución se conserva al pasar a `payment_pending` y se usa para el lock y la reserva canónica.

### 4. Estado visual inmediato

Mientras existe una promesa viva para la orden, el panel muestra:

```text
Iniciando cobro…
```

El botón permanece deshabilitado. El indicador visual no sustituye al single-flight.

Un estado persistido `starting` o `validating` sin entrada viva en el `Map` se trata como obsoleto: no mantiene el botón bloqueado y el siguiente clic puede reintentar.

### 5. Propiedad del intento

`useEcommercePosCheckoutGate` ahora captura el `ownedAttemptId` y comprueba propiedad antes y después de los `await` críticos.

Las rutas antiguas no pueden modificar ni limpiar:

```text
ecommerceConversionAttemptId
ecommerceConversionActorIdentity
ecommerceCheckoutLockAttemptId
ecommerceCheckoutLockActorIdentity
ecommerceCheckoutSnapshot
ecommerceConversionStatus
```

La protección cubre:

- cancelación remota previa a venta;
- cierre del modal;
- lectura del estado remoto;
- revalidación de inventario;
- búsqueda idempotente de venta;
- selección del modo de venta;
- resultado del cobro;
- confirmación remota;
- quick caja.

Cuando una respuesta pertenece a un intento obsoleto, termina silenciosamente con `ECOMMERCE_STALE_CHECKOUT_ATTEMPT`, sin mensajes ni limpieza del intento vigente.

### 6. Fallo y reintento

Si el primer inicio falla:

- el `finally` retira la entrada single-flight;
- no queda una promesa rechazada dentro del `Map`;
- el indicador visual se limpia;
- un `VALIDATING` persistido sin promesa viva no impide el siguiente intento;
- el siguiente clic puede crear una operación y un `attemptId` nuevos.

### 7. Éxito y `payment_pending`

Cuando el primer inicio abre el modal:

- todas las llamadas duplicadas reciben el mismo resultado;
- el estado pasa a `payment_pending`;
- el lock conserva el `attemptId` propietario;
- clics posteriores durante `payment_pending` o `processing_sale` se ignoran sin mensajes ni efectos.

### 8. Lock local y otro dispositivo

No se debilitó `lockOrderForCheckout()`.

El wrapper no interpreta por sí solo `isLockedForCheckout` como duplicado local. Un lock preexistente con conversión local inactiva sigue llegando al checkout canónico, preservando la contención real y el mensaje para otra pestaña, contexto o dispositivo.

### 9. Reserva remota

Los clics absorbidos por el single-flight no alcanzan `installEcommercePosActiveOrderGuards`. Por tanto, la reserva `ecommerce_begin_pos_conversion(...)` se ejecuta como máximo una vez por inicio local.

No se modificó el contrato remoto ni Supabase.

### 10. POS normal

Las órdenes no ecommerce pasan directamente al checkout canónico. No se modificó la lógica normal de efectivo, fiado, tarjeta, `STOCK_WARNING` ni `Sí, Vender Igual`.

## Archivos modificados

```text
src/components/pos/EcommercePosConversionPanel.jsx
src/components/pos/__tests__/EcommercePosConversionPanel.test.jsx
src/hooks/pos/useEcommercePosCheckoutGate.js
src/hooks/pos/usePos.js
```

## Archivos agregados

```text
src/hooks/pos/ecommerceCheckoutInitiationSingleFlight.js
src/hooks/pos/useEcommercePosCheckoutSingleFlight.js
src/hooks/pos/__tests__/ecommerceCheckoutInitiationSingleFlight.test.js
src/hooks/pos/__tests__/useEcommercePosCheckoutSingleFlight.test.jsx
src/hooks/pos/__tests__/useEcommercePosCheckoutGate.singleFlight.test.jsx
reports/hotfix_ecom_pos_3_3_checkout_single_flight_report.md
```

## Cobertura agregada

Las pruebas nuevas o ampliadas cubren:

- diez llamadas simultáneas y una sola promesa;
- una sola ejecución subyacente;
- una creación de `attemptId`;
- una recuperación, lectura remota y búsqueda idempotente;
- un lock local y una reserva remota simulados;
- resultado compartido y cero mensajes para duplicados locales;
- `payment_pending` sin segundo inicio;
- fallo seguido de reintento;
- `starting` y `validating` obsoletos sin bloqueo permanente;
- intento A lento incapaz de cerrar, limpiar o sobrescribir el intento B;
- dos pedidos distintos concurrentes;
- preservación de la contención canónica de otro dispositivo;
- paso directo del checkout POS normal;
- estado visual inmediato solo mientras existe un single-flight vivo.

## Validación ejecutada

### Inspección estructural del PR

```text
Base de rama: PASS
Rama separada de main: PASS
PR único: #91
PR draft: PASS
PR mergeado: NO
Archivos cambiados: 10
Supabase: SIN CAMBIOS
Migraciones: NINGUNA
SQL de escritura: NINGUNO
Workflows temporales: NINGUNO
Vercel manual: NO UTILIZADO
```

La lista de archivos modificados contiene únicamente frontend, hooks, pruebas y este reporte.

### Prueba ejecutable del núcleo single-flight

Comandos ejecutados sobre una copia exacta del helper:

```bash
node --check /mnt/data/work/ecom-single-flight-check/ecommerceCheckoutInitiationSingleFlight.mjs
node /mnt/data/work/ecom-single-flight-check/check.mjs
```

Resultado exacto:

```json
{
  "rapidClicks": 20,
  "starts": 1,
  "runs": 1,
  "settles": 1,
  "sharedPromise": true,
  "retryAfterFailure": true,
  "differentOrdersConcurrent": true,
  "staleTokenCannotClearNewEntry": true
}
```

Resultado:

```text
20 clics simultáneos: UN SOLO INICIO
Resultado compartido: PASS
Fallo y reintento: PASS
Pedidos diferentes concurrentes: PASS
Compare-and-clear A/B: PASS
```

### Parseo y transpilación

Comandos ejecutados:

```bash
node --check /mnt/data/work/useEcommercePosCheckoutGate.modified.js
node --check /mnt/data/work/hotfix-static/src/hooks/pos/useEcommercePosCheckoutSingleFlight.js
```

Se ejecutó además `typescript.transpileModule` con `target ES2022`, `module ESNext` y `jsx react-jsx` sobre ambos archivos.

Resultado:

```text
useEcommercePosCheckoutGate.js: PASS
useEcommercePosCheckoutSingleFlight.js: PASS
```

### ESLint específico crítico

Se ejecutó ESLint con las mismas reglas del `eslint.config.js` del repositorio sobre:

```text
src/hooks/pos/ecommerceCheckoutInitiationSingleFlight.js
src/hooks/pos/useEcommercePosCheckoutSingleFlight.js
src/hooks/pos/useEcommercePosCheckoutGate.js
```

Resultado:

```text
3 archivos críticos: PASS
Errores: 0
Advertencias del código: 0
```

La única salida adicional fue la advertencia de detección de versión de React en el workspace parcial, porque React no estaba instalado en ese workspace de validación; no corresponde a un defecto del código.

## Validación no completada

La sesión no dispone de `gh` y el contenedor no puede resolver los hosts de GitHub, por lo que no fue posible obtener un checkout íntegro del repositorio. No se inventan resultados para los comandos pendientes:

```text
npm ci sobre checkout íntegro
ESLint sobre todos los archivos modificados
suites enfocadas reales del repositorio
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
comparación global contra checkout limpio de main
```

No existen ejecuciones de GitHub Actions asociadas al HEAD. El estado automático de Vercel reportó un límite externo de builds; no se creó, forzó, promovió ni validó ningún preview manual.

## Validación funcional pendiente

No se ejecutó desde esta sesión la aceptación manual con el POS real. Permanecen pendientes:

```text
10–20 clics rápidos con pedido real
efectivo
fiado
inventario una vez
caja una vez
deuda y ledger una vez
otro dispositivo, mismo pedido
POS normal y STOCK_WARNING
```

Las pruebas manuales informadas antes del hotfix ya confirmaban efectivo, fiado, inventario y prevención de una segunda venta, pero no sustituyen la validación del nuevo HEAD.

## Restricciones respetadas

- `main`: sin modificación directa;
- rama `fase-ecom-pos-3`: no reutilizada;
- PR adicional: no creado;
- merge automático: no realizado;
- PR: permanece draft;
- Supabase: sin cambios;
- migraciones: ninguna;
- SQL de escritura: ninguno;
- workflows temporales: ninguno;
- previews Vercel: no creados, forzados, promovidos ni validados;
- pruebas existentes: no eliminadas ni debilitadas;
- `.skip`, `.todo`, `eslint-disable`: no utilizados.

## Conclusión actual

```text
Single-flight por orderId: IMPLEMENTADO
20 clics ejecutables sobre el núcleo: UN SOLO INICIO
AttemptId/lock/reserva en prueba de integración agregada: UNA VEZ
Propiedad A/B: IMPLEMENTADA Y CUBIERTA
Reintento tras estado obsoleto: IMPLEMENTADO Y CUBIERTO
Supabase: SIN CAMBIOS
Migraciones: NINGUNA
Estado del PR: DRAFT
HOTFIX ECOM.POS.3.3 PASS: NO DECLARADO — VALIDACIÓN GLOBAL Y MANUAL PENDIENTE
```
