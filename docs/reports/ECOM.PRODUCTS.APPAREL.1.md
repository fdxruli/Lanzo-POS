# FASE ECOM.PRODUCTS.APPAREL.1

Fecha: 2026-07-17 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-apparel-1`  
PR: `#112` — https://github.com/fdxruli/Lanzo-POS/pull/112  
Estado: **IMPLEMENTACIÓN PARCIAL — CÓDIGO, MIGRACIÓN, BUILD Y SQL COMPLETADOS; VITEST Y ESLINT PENDIENTES POR LIMITACIÓN DEL ENTORNO**

## 1. Resumen ejecutivo

Se implementó la proyección ecommerce de variantes apparel almacenadas físicamente como lotes en `pos_product_batches`. La solución conserva una sola familia publicada, agrupa ingresos físicos por identidad comercial, calcula stock por variante, expone talla/color/SKU de forma segura y restringe la conversión POS a lotes compatibles con la variante comprada.

El código de producción compila correctamente y la migración remota quedó aplicada y validada. La fase no se declara completa porque el entorno disponible no pudo descargar/clonar el repositorio para ejecutar `npm run test:ci` ni `npm run lint`. Las pruebas quedaron añadidas al PR, pero no se presentan como ejecutadas.

## 2. Estado Git inicial

- HEAD remoto confirmado de `main`: `9aab390498877b5f16d0dd00021aa015f639f720`.
- La rama se creó directamente desde ese SHA.
- `main` permaneció en el mismo SHA al cierre de la implementación.
- No se realizaron escrituras en `main`.
- No se hizo merge.
- El PR permanece abierto y draft.

## 3. Causa raíz confirmada

El alta asistida elimina `quickVariants` del producto padre y persiste cada ingreso como lote con `sku` y `attributes`. El POS consulta esos lotes y abre `VariantSelectorModal`, pero ecommerce construía la configuración principalmente desde `product.variants`.

Por ello:

```text
Camisa polo + lotes Negro/M, Azul/M
→ product.variants vacío
→ configuración ecommerce simple
→ tienda sin selector apparel
```

Además, el borrador ecommerce llegaba al POS con `batchId: undefined`. El resolvedor genérico podía elegir el primer lote válido del producto sin restringirlo al SKU, talla o color comprados.

## 4. Modelo actual de variantes apparel

Se mantuvo el modelo existente:

```text
pos_products
  └── variante comercial por SKU o atributos
        ├── pos_product_batches ingreso A
        └── pos_product_batches ingreso B
```

No se creó `pos_product_variants`.

Una variante pública representa una combinación comercial; los lotes continúan siendo ingresos físicos privados usados por inventario y FEFO.

## 5. Diseño del proyector

Se creó:

```text
src/services/ecommerce/ecommerceApparelVariants.js
```

Su función principal es:

```text
projectProductBatchesToEcommerceVariants({ product, batches })
```

Responsabilidades:

- filtrar lotes del producto;
- validar estado activo y no eliminado/bloqueado/cuarentenado;
- respetar vencimiento para `STRICT`, `SHELF_LIFE` y `BATCH`;
- reconocer `color`, `talla`, `modelo` y `marca`;
- normalizar atributos y SKU;
- agrupar lotes físicos;
- calcular stock y precio público;
- producir variantes compatibles con `buildEcommerceProductConfigurationSyncPayload`;
- excluir metadata privada e IDs físicos de lote.

## 6. Regla de identidad

Prioridad:

1. `sku:<SKU_NORMALIZADO>`.
2. Sin SKU: hash determinista del producto y atributos normalizados.

La identidad no depende de:

- `batch.id`;
- índice del array;
- orden de lotes;
- `Date.now()`;
- `Math.random()`.

## 7. Regla de agrupación

- Mismo SKU normalizado: una variante comercial.
- Sin SKU: mismo conjunto exacto de atributos normalizados.
- Mismo SKU con atributos incompatibles: error `ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_CONFLICT`.
- No se fusionan silenciosamente conflictos.

## 8. Regla de stock

Por variante:

```text
SUM(max(stock - committed_stock, 0))
```

Sólo participan lotes elegibles. Una variante con existencia cero permanece publicada como no disponible, permitiendo deshabilitar la combinación sin inventar disponibilidad.

## 9. Regla de precio

- Precio uniforme dentro del grupo: se usa el precio de variante.
- Igual al padre: `priceMode = base`.
- Distinto del padre: `priceMode = absolute`.
- Precios incompatibles dentro del mismo SKU: error `ECOMMERCE_APPAREL_VARIANT_PRICE_CONFLICT`.

No se elige un precio arbitrariamente.

## 10. Publicación manual Free

`ecommerceAdminService` carga los lotes locales antes de preparar el payload V2 cuando el producto no trae variantes embebidas.

Resultado:

- Free publica la familia como un solo producto;
- no se afecta el límite de diez productos;
- editar el producto vuelve a proyectar sus variantes;
- productos simples sin atributos reales permanecen simples;
- modificadores y recetas conservan su configuración existente.

## 11. Sincronización automática PRO

`ecommerceCatalogSyncService` reutiliza los lotes precargados para construir variantes, no sólo para calcular disponibilidad del padre.

La `configurationSourceRevision` se deriva de la configuración pública serializada. Cambia con:

- altas y bajas de variantes;
- SKU y atributos;
- precio;
- stock y comprometido;
- disponibilidad;
- expiración relevante.

No cambia por costo, proveedor u otra metadata privada que no forme parte del contrato público.

Se conservaron el servicio base, outbox, reintentos, orden operativo e idempotencia por firma de proyección.

## 12. Contrato público

Al tener variantes proyectadas, los normalizadores existentes producen:

```text
configuration_type = variant_parent
has_variants = true
requires_configuration = true
availability_source = variant_aggregate
```

La UI existente conserva una tarjeta del padre y usa `PublicProductConfigurationModal` para los ejes y combinaciones disponibles. No se creó una tarjeta por talla ni por color.

La RPC pública ahora incluye únicamente identidad comercial segura:

```text
sourceVariantRef
sku
optionValues
```

No devuelve IDs físicos de lotes.

## 13. Checkout

El checkout remoto existente continúa siendo autoritativo para:

- pertenencia de variante al producto;
- revisión vigente;
- disponibilidad;
- stock de la variante;
- cantidad solicitada;
- precio vigente.

La migración añade un trigger servidor que enriquece el snapshot del pedido con `sourceVariantRef` y `sku`, tomando esos valores de `ecommerce_published_product_variants` y no del navegador.

## 14. Conversión POS

Se creó:

```text
src/services/ecommerce/ecommercePosApparelVariantResolution.js
```

La conversión lee la identidad del snapshot y prepara la línea con:

- `parentId`;
- `batchId` compatible;
- `sku`;
- atributos de variante;
- `ecommerceOptions` originales;
- detalle de resolución.

El nombre se vuelve comprensible, por ejemplo:

```text
Camisa polo (Negro M)
```

No se crean productos locales nuevos ni se modifica el padre.

## 15. Resolución de inventario

Reglas:

1. Coincidencia exacta por SKU normalizado.
2. Sin SKU, coincidencia por conjunto exacto de atributos.
3. FEFO sólo dentro del subconjunto compatible.
4. Nunca coincidencia parcial.
5. Nunca fallback por nombre o primer lote del producto.

Conflictos añadidos:

```text
ECOMMERCE_VARIANT_LOCAL_MAPPING_MISSING
ECOMMERCE_VARIANT_LOCAL_MAPPING_AMBIGUOUS
ECOMMERCE_VARIANT_STOCK_INSUFFICIENT
ECOMMERCE_VARIANT_SELECTION_STALE
```

El ledger temporal de la preparación evita que varias líneas del mismo borrador consuman virtualmente la misma existencia.

## 16. Seguridad

- No se expusieron `batchId` físicos en la tienda.
- No se enviaron costo, proveedor, ubicación, licencia, dispositivo, staff ni tokens.
- No se añadió `service_role` al frontend.
- El trigger es `SECURITY DEFINER` con `search_path = ''`.
- Se revocó ejecución pública directa de la función privada.
- El lookup del trigger exige coincidencia de variante, producto publicado, portal y licencia.
- La función pública conserva el alcance por portal/licencia/producto.

## 17. Migraciones creadas

```text
supabase/migrations/20260717160018_ecom_products_apparel_variant_snapshot.sql
```

Aplicada al proyecto remoto como:

```text
20260717160018 ecom_products_apparel_variant_snapshot
```

No se editaron migraciones aplicadas ni se utilizó `migration repair`.

## 18. Pruebas ejecutadas y resultados reales

### PASS

- `npm run build` mediante el build automático de Vercel sobre el HEAD de implementación `d6217d4c8900c7e8c852f4a3390dc23aaf658379`.
- Vite: 3354 módulos transformados.
- PWA/service worker: build completado.
- Validación SQL en `BEGIN/ROLLBACK`:
  - trigger presente y habilitado;
  - `SECURITY DEFINER`;
  - `search_path = ''`;
  - función privada sin ejecución pública;
  - alcance por producto/portal/licencia;
  - campos `sourceVariantRef` y `sku` presentes en contrato/snapshot.
- Historial remoto de migraciones confirmado.

### PENDIENTE POR LIMITACIÓN DEL ENTORNO

```text
npm run test:ci
npm run lint
```

El entorno de ejecución no pudo resolver GitHub para clonar o descargar la rama. No se declara PASS para estas suites.

### Pruebas añadidas, no ejecutadas

```text
src/services/ecommerce/__tests__/ecommerceApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceAdminApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceCatalogApparelRevision.test.js
src/services/ecommerce/__tests__/ecommercePosApparelVariantResolution.test.js
```

Cubren proyección, agrupación, stock comprometido, expiración, precios, privacidad, identidad estable, publicación Free, revisión PRO, matching exacto, FEFO y conflictos.

## 19. Limitaciones

- Las suites Vitest y ESLint deben ejecutarse antes del merge.
- La resolución conserva la restricción actual de una línea POS contra un lote físico con cantidad suficiente. Si el mismo SKU requiere dividir una sola línea entre varios lotes, queda bloqueado de forma segura como stock insuficiente en vez de sustituir variante.
- No había variantes publicadas ni pedidos configurados existentes en el proyecto remoto para una prueba destructiva sobre datos reales.
- La integración GitHub–Vercel generó previews automáticamente por los commits de la rama. No se ejecutó despliegue manual ni producción.

## 20. Evidencia de cero residuos

- Las verificaciones SQL se ejecutaron dentro de `BEGIN/ROLLBACK`.
- No se insertaron fixtures.
- No se crearon productos, variantes ni pedidos de prueba remotos.
- No quedaron filas de prueba ni objetos temporales.

## 21. HEAD final

HEAD de implementación auditado antes de añadir este reporte:

```text
d6217d4c8900c7e8c852f4a3390dc23aaf658379
```

El commit posterior contiene exclusivamente este reporte. El HEAD definitivo de la rama debe consultarse en el PR antes de revisión o merge.

## 22. URL y estado del PR

```text
PR: #112
URL: https://github.com/fdxruli/Lanzo-POS/pull/112
Estado: OPEN
Draft: TRUE
Merged: FALSE
Base: main
```

## Archivos modificados

```text
src/services/ecommerce/ecommerceAdminService.js
src/services/ecommerce/ecommerceApparelVariants.js
src/services/ecommerce/ecommerceCatalogSyncService.js
src/services/ecommerce/ecommercePosApparelVariantResolution.js
src/services/ecommerce/ecommercePosInventoryResolutionRecipeBase.js
src/services/ecommerce/__tests__/ecommerceAdminApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceApparelVariants.test.js
src/services/ecommerce/__tests__/ecommerceCatalogApparelRevision.test.js
src/services/ecommerce/__tests__/ecommercePosApparelVariantResolution.test.js
supabase/migrations/20260717160018_ecom_products_apparel_variant_snapshot.sql
docs/reports/ECOM.PRODUCTS.APPAREL.1.md
```

## Pruebas manuales requeridas

### Free

1. Crear o editar `Camisa polo` con Negro/M, Negro/S y Azul/M, cada una con SKU distinto.
2. Publicar una sola vez la familia.
3. Confirmar que cuenta como un producto del límite Free.
4. Abrir la tienda y comprobar una sola tarjeta con `Seleccionar opciones`.
5. Confirmar ejes Color/Talla y ausencia de combinaciones inexistentes.
6. Agotar Negro/M y comprobar que esa combinación queda deshabilitada.

### PRO

1. Cambiar stock o precio de un SKU y forzar/revisar reconciliación.
2. Confirmar que no se duplica la variante al añadir otro lote del mismo SKU.
3. Crear un SKU nuevo y confirmar que aparece como variante nueva.
4. Retirar el último lote válido y confirmar que deja de estar disponible.

### Checkout y POS

1. Comprar Negro/M y revisar que el pedido conserva SKU, color y talla.
2. Convertir el pedido al POS y confirmar `batchId` de Negro/M.
3. Verificar que no use Azul/M ni Negro/S.
4. Repetir con dos lotes Negro/M y confirmar FEFO dentro del SKU.
5. Eliminar o cambiar el SKU local antes de convertir y confirmar conflicto, no sustitución.
6. Intentar cantidad superior al stock de la variante y confirmar rechazo remoto.

### Regresiones

1. Producto simple agrega directamente al carrito.
2. Producto con receta mantiene disponibilidad por ingredientes.
3. Extras single y multiple conservan selección y precios.
4. Producto con variantes y extras mantiene ambos conceptos separados.
