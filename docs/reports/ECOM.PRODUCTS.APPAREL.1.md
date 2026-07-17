# FASE ECOM.PRODUCTS.APPAREL.1

Fecha: 2026-07-17 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-apparel-1`  
PR: `#112`  
Estado: **BLOQUEANTES CORREGIDOS — VALIDACIÓN GLOBAL PENDIENTE ANTES DEL MERGE**

## 1. Resumen ejecutivo

Se corrigieron los dos defectos confirmados durante la revisión independiente:

1. Las variantes apparel derivadas de lotes reutilizaban el ID del producto padre como `sourceProductId`, provocando conflicto con el índice único activo por `source_product_id`.
2. Un producto apparel reconocido podía degradarse silenciosamente a producto `simple` cuando temporalmente no existían variantes publicables.

La solución mantiene una sola tarjeta pública por familia, conserva la identidad comercial mediante `sourceVariantRef`, SKU y atributos, y continúa resolviendo inventario mediante lotes privados compatibles y FEFO dentro del subconjunto seleccionado.

No se creó `pos_product_variants`, no se retiraron índices existentes y no se expusieron IDs físicos de lote.

## 2. Estado Git verificado antes de modificar

```text
HEAD inicial de la rama: 9981db6b7cabbed21e4697ac53ab12ec18955bc6
HEAD de main:             9aab390498877b5f16d0dd00021aa015f639f720
Merge-base:               9aab390498877b5f16d0dd00021aa015f639f720
Behind de main:            0
```

El PR continuaba:

```text
OPEN
DRAFT
MERGED = FALSE
BASE = main
```

No se realizaron escrituras en `main`.

## 3. Causa raíz: `source_product_id`

El proyector producía para todas las variantes hermanas:

```js
sourceProductId: productId
localProductRef: productId
```

La tabla `public.ecommerce_published_product_variants` conserva un índice único activo equivalente a:

```sql
(published_product_id, source_product_id)
where deleted_at is null
```

Por ello, Negro/M, Negro/L y Azul/M intentaban reutilizar el mismo `source_product_id`, aunque el `ON CONFLICT` operativo trabaja por `source_variant_ref`.

## 4. Semántica corregida de identidad

Para variantes derivadas de `pos_product_batches`:

```js
{
  sourceVariantRef: identidadComercialEstable,
  sourceProductId: null,
  localProductRef: productId,
  sku,
  optionValues
}
```

Significado de los campos:

- `sourceVariantRef`: identidad comercial estable usada para upsert, resincronización y recuperación.
- `sourceProductId`: referencia a un producto fuente independiente; permanece `null` para variantes derivadas de lotes del mismo padre.
- `localProductRef`: referencia al producto padre local compartido por todas las variantes hermanas.

No se utiliza `batch.id` como identidad pública.

El normalizador mantiene explícitamente:

```text
sourceProductId = null
localProductRef = producto padre
```

y no vuelve a fusionar ambos conceptos.

## 5. Producto apparel sin variantes publicables

El proyector ahora distingue:

```text
Producto simple sin esquema apparel
≠
Producto apparel reconocido con cero variantes elegibles
```

La detección semántica reconoce el esquema por atributos apparel presentes en los lotes, incluso si los lotes están inactivos, archivados, vencidos o incompletos.

El estado vacío produce:

```text
recognizedAsApparel = true
configuration type = variant_parent
variants = []
availabilitySource = variant_aggregate
availabilityReasonCode = APPAREL_VARIANTS_UNAVAILABLE
sourceAvailable = false
stockSnapshot = 0
```

El producto:

- no se convierte en `simple`;
- continúa requiriendo configuración;
- no puede agregarse directamente al carrito;
- elimina mediante soft delete las variantes ausentes;
- recupera automáticamente `variant_parent` cuando reaparece una variante válida;
- conserva idempotencia al repetir el estado vacío.

Productos simples, recetas y modificadores no utilizan esta señal y conservan su comportamiento previo.

## 6. Publicación manual Free

`ecommerceAdminService` proyecta los lotes locales antes de construir el payload V2.

Resultados:

- una familia apparel sigue contando como un solo producto publicado;
- `sourceProductId` llega como `null`;
- `localProductRef` conserva el padre;
- un apparel vacío se envía como `variant_parent` fail-closed;
- una variante válida posterior recupera la configuración sin recrear el producto padre.

## 7. Sincronización automática PRO

`ecommerceCatalogSyncService` conserva la proyección apparel completa y su estado vacío durante el `fullReconcile`.

La revisión pública cambia cuando cambia:

- SKU o atributos;
- variantes activas;
- stock o comprometido;
- disponibilidad;
- precio público;
- vencimiento relevante.

No cambia por costo, proveedor, ubicación ni metadata privada.

El estado vacío parchea también:

```text
sourceAvailable = false
sourceState = out_of_stock
stockSnapshot = 0
```

sin generar revisiones infinitas.

## 8. Checkout y conversión POS

El snapshot autoritativo continúa obteniendo desde Supabase:

```text
sourceVariantRef
sku
optionValues
```

No se acepta talla o color libre del navegador como autoridad.

La resolución POS conserva:

1. match exacto por SKU;
2. fallback por conjunto exacto de atributos sólo cuando el snapshot no tiene SKU;
3. FEFO únicamente dentro de los lotes compatibles;
4. conflicto seguro si desaparece el SKU;
5. ausencia de fallback al primer lote del producto padre;
6. ausencia de `batchId` en el contrato público.

## 9. Migración compensatoria

No se editó la migración aplicada previamente:

```text
20260717160018_ecom_products_apparel_variant_snapshot
```

Se creó y aplicó:

```text
supabase/migrations/20260717171605_ecom_apparel_variant_parent_consistency.sql
```

Historial remoto confirmado:

```text
20260717171605 ecom_apparel_variant_parent_consistency
```

La migración añade funciones y triggers privados para:

- mantener `requires_configuration = true` en `variant_parent` vacío;
- reconciliar `has_variants`, disponibilidad y stock agregado desde variantes activas;
- marcar `APPAREL_VARIANTS_UNAVAILABLE` al quedar vacío;
- recuperar `CONFIGURATION_REQUIRED` cuando reaparece una variante;
- reaccionar a stock, disponibilidad y soft delete de variantes.

Las funciones son `SECURITY DEFINER`, usan `search_path = ''` y no conceden ejecución directa a `public`, `anon` ni `authenticated`.

No se modificó ni eliminó el índice único por `source_product_id`.

## 10. Prueba SQL de integración

Archivo:

```text
supabase/tests/ecommerce_apparel_variant_projection.sql
```

Ejecutada contra `odlrhijtfyavryeqivaa` dentro de:

```sql
begin;
...
rollback;
```

Resultado: **PASS**.

Cobertura confirmada:

- tres variantes del mismo padre con `source_product_id = null`;
- mismo `local_product_ref`;
- tres `source_variant_ref` distintos;
- segunda ejecución idempotente;
- cero duplicados;
- cambio de stock aislado a una variante;
- soft delete aislado;
- hermanas activas intactas;
- restauración de variante;
- protección contra combinación duplicada;
- apparel vacío fail-closed;
- recuperación posterior.

No quedaron fixtures ni residuos.

## 11. Pruebas unitarias y de servicios

Se ejecutó un arnés Vitest focalizado con los módulos reales modificados y stubs únicamente para infraestructura externa no disponible en el checkout.

Resultado:

```text
Test files: 4 passed
Tests:      28 passed
```

Archivos cubiertos:

```text
src/services/ecommerce/__tests__/ecommerceApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceAdminApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceApparelVariantBlockers.test.js
src/services/ecommerce/__tests__/ecommerceCatalogApparelRevision.test.js
```

La ejecución detectó y corrigió un fixture `STRICT` inválido que no incluía `expiryDate` para el lote considerado vendible.

La suite global:

```text
npm run test:ci
```

no pudo ejecutarse porque el entorno local no resuelve `github.com` y no fue posible obtener un checkout completo. No se declara PASS global.

Riesgo residual: alguna prueba ajena al conjunto focalizado podría revelar una integración no cubierta.

## 12. Lint

Se reconstruyó la configuración exacta de `eslint.config.js` y se ejecutó ESLint sobre los módulos y pruebas modificados.

Resultado focalizado: **PASS, sin errores**.

La ejecución global:

```text
npm run lint
```

no pudo ejecutarse sin el checkout completo. No se declara PASS global.

## 13. Build

El build automático de Vercel ejecutó:

```text
npm run build
```

sobre el HEAD de corrección:

```text
1cf2d4c01e34dddaeba966d45c88f63fc8b6d0d6
```

Resultado: **PASS**.

```text
Vite: 3354 módulos transformados
PWA/service worker: completado
Deployment preview: READY
```

No se realizó despliegue manual ni despliegue a producción. Los previews observados fueron creados automáticamente por la integración GitHub–Vercel al escribir la rama.

## 14. Pruebas manuales

No ejecutadas.

Motivo: requieren una sesión autenticada y datos controlados de un negocio apparel Free/Pro. No se utilizaron datos reales de producción para simularlas.

Pendientes antes del merge:

- una tarjeta padre con Negro/M, Negro/L y Azul/M;
- selector de talla/color;
- combinaciones agotadas deshabilitadas;
- pedido Negro/M conservado exactamente;
- FEFO entre dos lotes Negro/M;
- archivo de todas las variantes sin degradación a simple;
- restauración y recuperación automática;
- regresión de productos simples, recetas y modificadores.

## 15. Commits de la corrección residual

```text
27558e0 fix(ecommerce): separate apparel commercial identity
e7e054e fix(ecommerce): preserve empty apparel configuration
2ed925a fix(ecommerce): keep empty apparel fail closed in pro sync
72b7710 test(ecommerce): cover apparel publication blockers
1318483 test(ecommerce): cover apparel identity and empty state
184c511 db(ecommerce): keep apparel variant parents consistent
f01abd7 test(db): cover apparel variant persistence and recovery
1cf2d4c test(ecommerce): make strict apparel fixture valid
```

## 16. Archivos añadidos o modificados por la corrección

```text
src/services/ecommerce/ecommerceApparelVariants.js
src/services/ecommerce/ecommerceAdminService.js
src/services/ecommerce/ecommerceCatalogSyncService.js
src/services/ecommerce/__tests__/ecommerceApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceAdminApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceApparelVariantBlockers.test.js
supabase/migrations/20260717171605_ecom_apparel_variant_parent_consistency.sql
supabase/tests/ecommerce_apparel_variant_projection.sql
docs/reports/ECOM.PRODUCTS.APPAREL.1.md
```

No se modificaron checkout simple, recetas, modificadores, seguimiento, fulfillment, caja, `processSale`, `conversionKey`, `checkoutAttemptId`, límites Free/Pro ni FEFO global fuera del adaptador apparel.

## 17. Estado final y riesgos residuales

HEAD de corrección antes del commit documental:

```text
1cf2d4c01e34dddaeba966d45c88f63fc8b6d0d6
```

Estado esperado del PR tras este reporte:

```text
OPEN
DRAFT
MERGED = FALSE
BASE = main
MAIN SIN CAMBIOS
```

Bloqueantes funcionales confirmados: **resueltos**.

Pendientes para declarar la fase completamente validada:

1. `npm run test:ci` sobre un checkout completo.
2. `npm run lint` sobre todo `src`.
3. pruebas manuales Free/Pro, checkout y conversión POS.
4. nueva revisión independiente del diff final.

No mergear hasta completar esas validaciones.
