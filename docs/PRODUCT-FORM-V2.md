# Product Form V2

El formulario V2 existe en paralelo y todavía no sustituye el formulario productivo.

## Objetivo y arquitectura

`src/components/products/form-v2/` contiene una pantalla única para altas y futuras ediciones. `useProductFormV2` es la única fuente de estado: aplica valores predeterminados, cambios de precio/margen, inventario, caducidad, variantes, validación y construcción del payload. Los componentes son de presentación y reciben únicamente datos y handlers.

`PRODUCT_RUBRO_CONFIG` usa `normalizeBusinessType` y los identificadores canónicos existentes. Abarrotes, ferretería, frutería, apparel, farmacia, restaurante y general tienen campos declarativos separados. Las recetas, modificadores, estaciones, lotes, categorías, escáner e imágenes conservan sus contratos existentes y se conectarán de forma controlada en la fase 2.

## Inventario y caducidad

El payload conserva los nombres que usa el repositorio actual. Para productos nuevos con `trackStock` y existencia positiva se envía `stock`, dejando que `productLocalRepository.prepareProduct` cree el lote inicial; V2 no crea un lote adicional. Sin inventario, no se envían datos de entrada inicial. En edición se conserva el stock almacenado y no se interpreta como una reposición.

Los modos `NONE`, `STRICT` y `SHELF_LIFE` se normalizan de manera excluyente. `NONE` limpia fecha, vida útil y lote; `STRICT` conserva solo fecha/lote; `SHELF_LIFE` conserva solo vida útil. Farmacia exige lote y fecha únicamente para una entrada inicial positiva.

## Compatibilidad y límites actuales

V2 reutiliza `ProductImagePicker`, `CategorySelect`, `QuickVariantEntry` y `ScannerModal`. El guardado se expone como callback para que la integración posterior mantenga `productRepository.saveProduct`, el flujo offline-first y la preparación de imagen existentes. No se modificaron `ProductsPage`, `ProductForm`, los formularios legacy, Supabase ni la infraestructura de despliegue.

La fase 2 conectará V2 detrás de una activación controlada de `ProductsPage`, enlazará los editores completos de receta/modificadores/estaciones y realizará la comparación funcional final contra los formularios legacy.
