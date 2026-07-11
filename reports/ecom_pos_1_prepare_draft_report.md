# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha: 2026-07-11 (`America/Mexico_City`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- PR: `#88 — FASE ECOM.POS.1 — Preparar pedidos aceptados como órdenes activas del POS`
- Base: `main`
- Estado del PR: `draft`

## Resultado de la validación global final

```text
ECOM.POS.1 VALIDACIÓN GLOBAL BLOCKED
```

No se declara `PASS`, no se marca el PR como `ready for review` y no se debe mergear.

El entorno disponible no permitió obtener el checkout íntegro requerido. La validación ejecutable quedó bloqueada antes de la instalación de dependencias; por tanto, no existen resultados reales de ESLint, Vitest, build, lint global ni `test:ci` que permitan promover el PR.

## HEAD y relación con main

Estado remoto confirmado mediante la API de GitHub antes de actualizar este reporte:

```text
HEAD funcional inspeccionado: ac61ee2da09e871600392ad7d5b75c16d6ed1cad
main comparado:             e823b04c179b9ac3683c59ecb278f8e1fc9a71f5
merge-base:                 e823b04c179b9ac3683c59ecb278f8e1fc9a71f5
ahead_by:                   45
behind_by:                  0
```

La rama no estaba atrasada respecto de `main`; no fue necesario integrar `main` ni resolver conflictos.

El commit que actualiza este reporte es posterior al HEAD funcional anterior y no modifica código de producción, dependencias, pruebas, migraciones ni workflows.

## Entorno disponible

```text
Node: v22.16.0
npm: 10.9.2
git: 2.47.3
gh: NO INSTALADO
```

## Checkout íntegro

Comando intentado:

```bash
GIT_TERMINAL_PROMPT=0 git clone \
  https://github.com/fdxruli/Lanzo-POS.git \
  /tmp/lanzo-pos-pr88-validation
```

Resultado real:

```text
exit code: 128
fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/':
Could not resolve host: github.com
```

No existía un checkout previo del repositorio en el sistema de archivos. El contenedor tampoco dispone de GitHub CLI y no se creó ningún workflow temporal para sustituir la validación local.

## Instalación limpia

```text
npm ci: NO EJECUTADO
clasificación: INDETERMINADO — bloqueado antes de obtener el checkout
```

No se reutilizó `node_modules` de otra rama y no se modificaron `package.json` ni `package-lock.json`.

## Superficie modificada

La comparación remota `main...fase-ecom-pos-1` confirmó 42 archivos modificados y `behind_by=0`.

La superficie JavaScript/JSX incluye los archivos mínimos solicitados:

```text
src/components/ecommerce/orders/EcommerceOrdersRuntime.jsx
src/components/pos/EcommercePosDraftBanner.jsx
src/components/pos/MobilePosCart.jsx
src/components/pos/OrderDiscountPanel.jsx
src/components/pos/OrderLineDiscountList.jsx
src/components/pos/OrderSummary.jsx
src/components/pos/OrderTabs.jsx
src/components/pos/PosPageContent.jsx
src/hooks/pos/useActiveOrders.js
src/hooks/pos/useCheckoutFlow.js
src/hooks/pos/useLayawayFlow.js
src/hooks/pos/usePosCheckout.js
src/hooks/pos/useTableManagement.js
src/pages/EcommerceOrdersPage.jsx
src/services/ecommerce/ecommerceOrderCapabilities.js
src/services/ecommerce/ecommerceOrderService.js
src/services/ecommerce/ecommercePosDraftGuards.js
src/services/ecommerce/ecommercePosDraftService.js
src/services/ecommerce/installEcommercePosActiveOrderGuards.js
```

También se confirmaron las suites específicas agregadas o modificadas por el PR.

## ESLint específico

```text
xargs npx eslint < /tmp/pr88-eslint-files.txt: NO EJECUTADO
clasificación: INDETERMINADO — no existe checkout ejecutable
```

No se desactivaron reglas, no se añadieron `eslint-disable` y no se ocultaron warnings.

## Suites específicas y regresión

```text
npx vitest run <suites ECOM.POS.1>: NO EJECUTADO
suites adicionales relacionadas: NO EJECUTADAS
clasificación: INDETERMINADO — no existe checkout ejecutable
```

No se añadieron `.skip`, `.todo`, snapshots de silenciamiento ni se borraron pruebas.

## Revisión puntual STOCK_WARNING

Revisión estática del HEAD funcional `ac61ee2da09e871600392ad7d5b75c16d6ed1cad`:

```text
STOCK_WARNING conserva snapshot y lock: PASS ESTÁTICO
Sí, Vender Igual reutiliza el lock: PASS ESTÁTICO
No readquiere su propio lock: PASS ESTÁTICO
Cancelar venta llama releaseCheckoutSnapshotLock: PASS ESTÁTICO
Cancelación usa snapshot.orderId: PASS ESTÁTICO
Cancelación no llama processSale: PASS ESTÁTICO
Snapshot solo se limpia tras release resuelto: PASS ESTÁTICO
Unlock fallido conserva snapshot recuperable: PASS ESTÁTICO
isDismissible=false: PASS ESTÁTICO
Backdrop no ejecuta cancelación: PASS ESTÁTICO
```

Evidencia revisada:

- `usePosCheckout.js` conserva `checkoutSnapshotRef.current = snapshot` y excluye `STOCK_WARNING` del release automático del `finally`.
- `Cancelar venta` ejecuta `releaseCheckoutSnapshotLock(snapshot, { reason: 'stock_warning_cancelled' })`.
- El helper libera exclusivamente `snapshot.orderId` y conserva `lockOwnedByCheckout`, `lockReleased=false`, `checkoutAttemptId` y la referencia cuando el unlock falla.
- `Sí, Vender Igual` solo readquiere cuando `lockOwnedByCheckout !== true` o `lockReleased === true`.
- El aviso define `isDismissible: false` y `onCancel: cancelStockWarningCheckout`.
- `MessageModal.jsx` solo invoca `handleCancel()` desde el backdrop cuando `isDismissible` es verdadero; con `false` únicamente muestra feedback visual.

Esta revisión estática no sustituye Vitest.

## Build global

```text
npm run build: NO EJECUTADO
clasificación: INDETERMINADO — no existe checkout ejecutable
```

No se utilizó un deploy o preview de Vercel como sustituto.

## Validación global

```text
npm run lint: NO EJECUTADO
npm run test:ci: NO EJECUTADO
clasificación: INDETERMINADO — no existe checkout ejecutable
```

Los scripts remotos confirmados son:

```text
build: vite build
lint: eslint src/**/*.{js,jsx}
test:ci: vitest run --maxWorkers=4
```

## Comparación contra main

La rama está `behind_by=0`, pero no fue posible crear el worktree local de `main` porque el checkout inicial falló.

```text
build PR vs main: NO COMPARADO
lint PR vs main: NO COMPARADO
test:ci PR vs main: NO COMPARADO
clasificación de fallos ejecutables: INDETERMINADO
```

No se corrigió deuda heredada de `main` ni se realizó ningún cambio funcional durante esta validación.

## Git y residuos

```text
git diff --check: NO EJECUTADO
working tree local: NO DISPONIBLE
git status --short: NO EJECUTADO
búsqueda de residuos local: NO EJECUTADA
```

La comparación remota no muestra cambios en dependencias ni workflows dentro del PR. La actualización de este archivo es el único cambio realizado durante esta sesión.

## Revisión de alcance

La inspección estática conserva el contrato fail-closed de preparación:

```text
ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
Este pedido online está preparado para revisión. El cobro y la conversión definitiva se habilitarán en la siguiente fase.
```

No se encontró evidencia estática de habilitación de conversión ecommerce. Sin embargo, el alcance completo no puede promoverse sin ejecutar las suites y regresiones indicadas.

## Supabase

```text
Supabase: SIN CAMBIOS
```

No se ejecutó SQL, no se aplicaron migraciones y no se modificaron pedidos, claims, `source_product_id` ni datos reales.

## Vercel

```text
Vercel manual: NO UTILIZADO
```

No se invocó manualmente Vercel mediante API, CLI o agentes. No se creó, intentó, forzó, promovió ni validó un preview. Un check automático existente no se utilizó como evidencia de ESLint, Vitest o build.

## Estado final del PR

```text
Rama actualizada respecto de main: PASS REMOTO (behind_by=0)
Checkout íntegro: BLOCKED
npm ci: NO EJECUTADO
ESLint específico: NO EJECUTADO
Suites específicas: NO EJECUTADAS
Build global: NO EJECUTADO
Lint global: NO EJECUTADO
test:ci: NO EJECUTADO
Comparación ejecutable contra main: NO REALIZADA
git diff --check: NO EJECUTADO
Working tree: NO DISPONIBLE
Revisión STOCK_WARNING: PASS ESTÁTICO
Supabase: SIN CAMBIOS
Vercel manual: NO UTILIZADO
Estado del PR: DRAFT
```

## Bloqueante exacto

```text
Comando bloqueante: git clone https://github.com/fdxruli/Lanzo-POS.git /tmp/lanzo-pos-pr88-validation
Fallo: Could not resolve host: github.com
Clasificación: INDETERMINADO — limitación del entorno de validación
Corrección aplicada al código: NO
Estado del PR: DRAFT
```

No mergear.
