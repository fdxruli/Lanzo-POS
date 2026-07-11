# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha de corrección: 2026-07-11 (`America/Mexico_City`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- PR: `#88 — FASE ECOM.POS.1 — Preparar pedidos aceptados como órdenes activas del POS`
- Base: `main`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Estado del PR: `draft`

## Estado actual

```text
ECOM.POS.1.2 PENDING GLOBAL VALIDATION
```

La implementación funcional de `ECOM.POS.1.2` quedó versionada en la rama del PR #88. El PR no se declara listo para revisión porque este entorno no pudo ejecutar el checkout íntegro requerido: `npm ci`, ESLint, Vitest, build, lint global, `test:ci` ni la comparación ejecutable contra `origin/main`.

No se debe declarar `ECOM.POS.1.2 PASS` ni marcar el PR como `ready for review` hasta que esas validaciones se ejecuten sobre el HEAD final.

## Contexto conservado de ECOM.POS.1.1

La corrección anterior permanece intacta:

- migraciones local/remoto alineadas;
- `source_product_id` resuelto para pedidos reales;
- trigger servidor para filas futuras;
- snapshot con fallback seguro;
- protección central para `origin='ecommerce'`;
- `saveOrderAsOpen`, `closeOrder` y `lockOrderForCheckout` bloqueados;
- cocina, split bill y apartados bloqueados;
- reconciliación remoto/local;
- propiedad del claim en UI;
- protección de PII.

El criterio único durante `ECOM.POS.1` continúa siendo:

```js
order?.origin === 'ecommerce'
```

Contrato estable:

```text
code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
message: Este pedido online está preparado para revisión. El cobro y la conversión definitiva se habilitarán en la siguiente fase.
```

## Corrección ECOM.POS.1.2

### Checkout real utilizado por usePos

`src/hooks/pos/usePos.js` utiliza directamente:

```js
const checkout = usePosCheckout(...)
```

Por tanto, la defensa en profundidad fue agregada al flujo real:

```text
src/hooks/pos/usePosCheckout.js
```

El hook importa los guards centralizados desde:

```text
src/services/ecommerce/ecommercePosDraftGuards.js
```

No se duplicó el criterio de estado ecommerce por `ecommerceDraftStatus`; cualquier orden con `origin='ecommerce'` permanece bloqueada.

### Estado vivo del store

Cada operación sensible consulta `useActiveOrders.getState()` al momento de ejecutar el efecto.

La resolución viva usa:

```text
currentOrderId del store
fallback a pos.activeOrderId
activeOrders.get(orderId)
```

Esto evita depender únicamente de closures capturados por React.

### handleInitiateCheckout

El guard ecommerce es la primera operación funcional de `handleInitiateCheckout`.

Para una orden ecommerce se retorna:

```text
success: false
code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
```

El bloqueo ocurre antes de:

- validar cocina cloud;
- reconciliar artículos cancelados;
- actualizar artículos;
- llamar `saveOrderAsOpen`;
- cerrar el carrito móvil;
- adquirir `lockOrderForCheckout`;
- ejecutar FEFO;
- abrir prescription;
- abrir payment.

También se revalida la identidad viva de la orden después de operaciones asíncronas de cocina, persistencia, lock y FEFO.

### handleProcessOrder

El guard ecommerce se ejecuta antes de leer o convertir el snapshot en una venta.

Para ecommerce no se llama:

- `verifySessionIntegrity`;
- `asegurarCajaAbierta`;
- `processSale`;
- cierre de cocina cloud;
- `removeOrder`;
- `broadcastDBChange`;
- actualización posterior de inventario/mesas.

La orden se vuelve a validar:

- antes de verificar sesión;
- después de verificar sesión;
- antes y después de asegurar caja;
- antes de abrir quick caja;
- antes de cargar `salesService`;
- inmediatamente antes de `processSale`.

### Carrera de snapshot obsoleto

Se agregó coherencia entre:

```text
checkoutSnapshotRef.current.orderId
currentOrderId vivo
orden activa viva
```

Cuando el snapshot ya no pertenece a la orden activa se devuelve un resultado fail-closed con:

```text
POS_CHECKOUT_SNAPSHOT_STALE
```

Cuando la orden activa viva es ecommerce prevalece el contrato estable:

```text
ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
```

Escenario cubierto:

```text
1. una orden POS normal abre payment;
2. currentOrderId cambia a una orden ecommerce;
3. llega una confirmación tardía;
4. verifySessionIntegrity y processSale no se ejecutan.
```

Los snapshots cruzados se invalidan sin borrar otra orden. El rollback final comprueba que el snapshot todavía pertenece a la orden activa y que esa orden no es ecommerce antes de liberar un lock.

### handleQuickCajaSubmit

El guard ecommerce se ejecuta antes de:

- `abrirCaja`;
- `asegurarCajaAbierta`;
- cerrar quick caja;
- abrir payment.

También se revalida el snapshot después de abrir caja y antes de volver a payment, para impedir que un cambio de orden continúe el cobro.

### Acciones rápidas de mesas

`useTableManagement.handleQuickTableAction` conserva el comportamiento fail-closed existente: si hay un borrador ecommerce activo, bloquea antes de cargar o procesar la mesa objetivo.

Se añadió una prueba de coherencia para:

```text
orden ecommerce activa + acción rápida sobre mesa normal
```

Resultado esperado documentado:

- la mesa normal no se carga;
- el checkout no se inicia;
- cocina no se consulta;
- se devuelve `ECOMMERCE_POS_CHECKOUT_NOT_ENABLED`.

## Descuentos bloqueados en todas las superficies

### PosPageContent

`src/components/pos/PosPageContent.jsx` obtiene la orden activa desde `useActiveOrders` y no monta `OrderDiscountPanel` cuando la orden es ecommerce.

El panel desktop externo a `OrderSummary` ya no depende del selector CSS `:has()`.

### OrderDiscountPanel

`src/components/pos/OrderDiscountPanel.jsx` agrega dos defensas:

1. retorna `null` antes de renderizar botones o formularios cuando la orden activa es ecommerce;
2. `applyDiscount` y `removeDiscount` vuelven a leer la orden viva y abortan antes de `updateCurrentOrder` si el guard está activo.

Para ecommerce no se aplica ni elimina `saleDiscount`.

### OrderLineDiscountList

`src/components/pos/OrderLineDiscountList.jsx` también retorna `null` para ecommerce.

Las mutaciones `applyLineDiscount` y `removeLineDiscount` consultan la orden viva y abortan si es ecommerce, por lo que no dependen solamente del componente padre.

### OrderSummary y móvil

Se conservó la protección existente en:

- `OrderSummary`;
- `MobilePosCart`;
- `EcommercePosDraftGuards.css`.

La barrera lógica interna de `OrderDiscountPanel` hace que los slots desktop/restaurante/móvil no produzcan triggers ni formularios aunque sean montados desde otra superficie futura.

No se modificó la decisión existente sobre cantidades o edición de líneas. El checkout completo continúa bloqueado.

## Pruebas añadidas o ampliadas

### Checkout real

Archivo nuevo:

```text
src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx
```

Casos cubiertos:

- `claimed`;
- `prepared`;
- `error_releasing`;
- estado faltante;
- estado desconocido;
- inicio bloqueado antes de cocina, persistencia, FEFO, lock y modales;
- proceso bloqueado antes de sesión, caja, venta, cocina y broadcast;
- quick caja bloqueada antes de apertura;
- snapshot normal seguido por cambio vivo a ecommerce;
- regresión de checkout y `processSale` para orden POS normal;
- regresión de quick caja para orden POS normal.

La suite previa se conserva:

```text
src/hooks/pos/__tests__/useCheckoutFlow.ecommerce.test.jsx
```

### Descuentos

Archivos nuevos:

```text
src/components/pos/__tests__/PosPageContent.ecommerce.test.jsx
src/components/pos/__tests__/OrderDiscountPanel.ecommerce.test.jsx
src/components/pos/__tests__/OrderLineDiscountList.ecommerce.test.jsx
src/components/pos/__tests__/OrderSummary.ecommerce.test.jsx
```

Cobertura añadida:

- desktop sin mesas no monta el panel para ecommerce;
- orden POS normal conserva el panel;
- montaje directo de `OrderDiscountPanel` retorna `null` para ecommerce;
- descuento general normal puede aplicarse y quitarse;
- `OrderLineDiscountList` retorna `null` para ecommerce;
- descuento por línea normal puede aplicarse y quitarse;
- slots integrados de `OrderSummary` no exponen descuentos ecommerce;
- orden POS normal conserva las superficies de descuento.

La suite móvil existente se conserva:

```text
src/components/pos/__tests__/MobilePosCart.ecommerce.test.jsx
```

### Mesas

Se amplió:

```text
src/hooks/pos/__tests__/useTableManagement.ecommerce.test.jsx
```

Incluye la coherencia de target para una acción rápida sobre una mesa normal mientras el borrador ecommerce sigue activo.

## Validación ejecutada en este entorno

Se realizó revisión estática del diff y comprobación sintáctica local de los dos archivos de mayor riesgo:

```text
node --check src/hooks/pos/usePosCheckout.js: PASS sobre el contenido final preparado
parseo TypeScript AST de usePosCheckout.js: PASS
parseo TypeScript AST de usePosCheckout.ecommerce.test.jsx: PASS
```

Estas comprobaciones no sustituyen ESLint, Vitest ni build.

Metadatos GitHub observados antes del commit documental final:

```text
HEAD funcional: 2706305f32fb434724ccfde343c8a69596494c76
PR open: sí
PR draft: sí
PR merged: no
GitHub Actions para el HEAD: 0 ejecuciones
estado automático visible: Vercel pending
```

El estado automático de Vercel no se utilizó como evidencia ni se abrió mediante API, CLI o agentes de Vercel.

## Validación global pendiente

No fue posible ejecutar:

```text
npm ci
npx eslint <todos los archivos modificados>
npx vitest run <suites específicas y regresión>
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
git diff --name-status origin/main...HEAD
```

Motivo verificable:

- el contenedor no puede resolver `github.com` y no pudo clonar el repositorio;
- no existe un checkout local íntegro disponible;
- las dependencias del proyecto no están instaladas en el contenedor;
- el HEAD no tiene workflows de GitHub Actions asociados;
- no se creó ningún workflow temporal;
- Vercel no se usa como sustituto.

La comparación de metadatos de GitHub contra el `main` actual indicó que la rama estaba, antes del commit documental final:

```text
ahead_by: 38
behind_by: 3
```

Por tanto, también sigue pendiente ejecutar la línea base real de `main` y comparar sus resultados contra el HEAD final de la rama. No se integró `main` automáticamente porque no puede validarse el resultado en este entorno.

## Supabase

No se realizaron cambios en Supabase durante `ECOM.POS.1.2`.

No se aplicaron migraciones, no se modificaron triggers, claims, pedidos, `source_product_id` ni los pedidos `EC-00000010–12`.

```text
Supabase: SIN CAMBIOS
```

## Vercel

No se invocó manualmente Vercel mediante API, CLI o agentes. No se creó, intentó, forzó, promovió ni validó preview.

```text
Vercel manual: NO UTILIZADO
```

Un check automático de GitHub puede aparecer, pero no se utiliza como evidencia.

## Estado de aceptación

```text
Checkout real usePosCheckout: IMPLEMENTADO
handleInitiateCheckout fail-closed: IMPLEMENTADO
handleProcessOrder fail-closed: IMPLEMENTADO
handleQuickCajaSubmit fail-closed: IMPLEMENTADO
Snapshot obsoleto: IMPLEMENTADO + COBERTURA AÑADIDA
Quick action de mesas: COBERTURA AÑADIDA
Descuentos desktop: IMPLEMENTADO + COBERTURA AÑADIDA
Descuentos móvil: PROTECCIÓN CONSERVADA + COBERTURA EXISTENTE
OrderDiscountPanel directo: IMPLEMENTADO + COBERTURA AÑADIDA
Descuentos por línea: IMPLEMENTADO + COBERTURA AÑADIDA
Orden POS normal: COBERTURA DE REGRESIÓN AÑADIDA
Parseo sintáctico limitado: PASS
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
ECOM.POS.1.2 PENDING GLOBAL VALIDATION
```

El PR #88 debe permanecer en draft. No marcar `ready for review`, no declarar `ECOM.POS.1.2 PASS` y no mergear hasta ejecutar la validación frontend/global íntegra sobre el HEAD final y corregir únicamente regresiones introducidas por esta rama.
