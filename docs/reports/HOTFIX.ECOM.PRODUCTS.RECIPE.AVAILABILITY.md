# HOTFIX ECOM.PRODUCTS.RECIPE.AVAILABILITY

Fecha: 2026-07-16 (America/Mexico_City)

## Estado

**IMPLEMENTACIÓN COMPLETA EN RAMA — VALIDACIÓN VITEST/ESLINT/BUILD PENDIENTE.**

Rama: `hotfix-ecom-products-recipe-availability`

Base verificada: `main@0d380ef4d8a5f36bcc4aed16b1dad009eaeb40bd`

No se modificó `main`. No se ejecutó SQL de escritura ni se aplicaron migraciones en Supabase.

## Problema confirmado

Los productos preparados mediante receta podían sincronizarse como `out_of_stock` aunque sus ingredientes y lotes tuvieran inventario suficiente.

La sincronización automática solicitaba lotes únicamente cuando el producto padre tenía manejo de lotes directo. En restaurante, el padre normalmente no controla stock y son los ingredientes de la receta quienes tienen `batchManagement.enabled=true`.

Esto dejaba vacía la colección de lotes entregada al evaluador de receta, produciendo un falso `RECIPE_CAPACITY_ZERO`, `source_available=false` y `stock_snapshot=0`.

## Corrección

Se agregó un adaptador de fuente local exclusivamente alrededor del sincronizador automático:

1. Detecta los ingredientes enriquecidos de cada producto preparado por receta.
2. Cuando al menos un ingrediente maneja lotes, expone temporalmente al padre como candidato de carga de lotes.
3. Reutiliza `getBatchesByProductIds(parentId)`, que ya expande la receta y devuelve los lotes de sus ingredientes.
4. No muta los registros originales de Dexie.
5. No cambia la clasificación canónica: `classifyProduct` continúa entrando primero por la ruta de receta.
6. Genera una revisión dependiente de las fechas/versiones del padre, ingredientes y lotes para que un cambio de inventario reconstruya la proyección y la clave de idempotencia.

## Comportamientos cubiertos

- Padre sin stock directo y sin manejo de lotes + ingredientes batch-managed con stock: disponible.
- Extra opcional no disponible: no bloquea el producto padre.
- Ingrediente requerido agotado: producto agotado con `RECIPE_CAPACITY_ZERO` y limiting source correcto.
- Cambio únicamente en un lote: modifica `sourceRevision` e idempotency key.

## Archivos

- `src/services/ecommerce/ecommerceCatalogSyncService.js`
- `src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js`

## Supabase

Revisión únicamente de lectura sobre el proyecto `odlrhijtfyavryeqivaa`.

No se modificaron:

- tablas;
- funciones;
- grants;
- RLS;
- migraciones;
- historial remoto;
- datos de productos publicados.

Los registros actualmente afectados deben repararse mediante una reconciliación completa normal del catálogo después de desplegar el frontend corregido. No se recomienda un `UPDATE` manual porque no corregiría la causa.

## Validación ejecutada

- `node --check src/services/ecommerce/ecommerceCatalogSyncService.js`: PASS sobre la copia exacta preparada.
- `node --check src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js`: PASS sobre la copia exacta preparada.
- Comparación de rama contra `main`: únicamente dos archivos funcionales antes de este reporte.

## Validación pendiente

El entorno conectado no dispone de checkout instalable ni de `gh`, y no puede resolver `github.com` desde Git. Por tanto, no se declara PASS para:

```bash
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogSyncConfigurationSnapshot.test.js
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogSyncAvailabilityRetry.test.js
npx eslint src/services/ecommerce/ecommerceCatalogSyncService.js \
  src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js
npm run build
npm run build:store
npm run build:store:vercel
npm run test:ci
npm run lint
```

También permanece pendiente la prueba manual en la tienda pública y la reconciliación completa posterior al despliegue.

## Resultado esperado después del despliegue

Al abrir el POS Pro conectado y ejecutar/esperar la reconciliación completa:

- `Papas a la francesa` debe cambiar de `source_state=out_of_stock` a `in_stock` y calcular capacidad aproximada según la receta.
- `Quesadilla de queso` debe cambiar a `in_stock` mientras tortilla, queso y salsa tengan disponibilidad suficiente.
- La tienda pública debe habilitar `Seleccionar opciones`.
- Los grupos y extras ya sincronizados deben continuar visibles.
