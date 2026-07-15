# ECOM.PRODUCTS.MODEL.1.2 — Snapshot único e idempotencia de configuración Pro

Fecha: 2026-07-15 (America/Mexico_City)  
PR: #98  
Rama: `fase-ecom-products-model-1`  
Base: `main`

## 1. Defecto

La sincronización automática Pro calculaba la idempotency key sobre una proyección incompleta y después `ecommerceAdminService.syncPublishedCatalog` volvía a leer los productos locales para añadir `configuration` y `configurationSourceRevision`.

## 2. Causa raíz

La responsabilidad de construir el snapshot estaba dividida entre el servicio de catálogo y el servicio administrativo. La firma se generaba antes de completar el payload real del RPC.

## 3. Doble lectura anterior

El flujo anterior era:

1. `ecommerceCatalogSyncServiceBase` leía productos locales.
2. Construía campos, stock y revisión.
3. Calculaba la key.
4. `ecommerceAdminService` ejecutaba una segunda llamada a `getProductsByIds`.
5. Enriquecía el payload con configuración posiblemente proveniente de otra versión local.

## 4. Arquitectura nueva

El servicio base es el único propietario del snapshot lógico. Construye la configuración antes de firmar y entrega al transporte administrativo una proyección completa e inmutable por intención.

## 5. Punto único de lectura

`buildProjections` conserva una sola llamada a `localSource.getProductsByIds(localRefs)` por batch lógico. Categorías, lotes, disponibilidad, campos, configuración y revisiones se derivan de los objetos obtenidos en esa lectura.

## 6. Proyección completa

Cada proyección contiene:

- `publishedProductId`;
- `localProductRef`;
- `sourceRevision`;
- `sourceState`;
- `sourceAvailable`;
- `stockSnapshot`;
- `fields`;
- `configuration`;
- `configurationSourceRevision`.

No se incorpora el producto Dexie completo, lotes completos, ingredientes completos, licencia, tokens, costos ni metadata privada fuera de la allowlist del serializer.

## 7. Firma completa

`normalizeProjectionForSignature` incluye `configuration` y `configurationSourceRevision`. La normalización ordena claves de objetos, descarta `undefined` y funciones, conserva arrays en su orden significativo y no muta el payload original.

## 8. Idempotency key

Se conserva el formato:

`ecom-catalog-sync:<portalId>:<hash>`

El hash se calcula sobre el contenido completo que llegará al RPC v2. Cambios en variantes, `optionValues`, grupos, opciones, receta, `priceDelta`, ingredientes, selección requerida, disponibilidad derivada o revisión de configuración cambian la key. Payloads semánticamente idénticos conservan la misma key.

## 9. configurationSourceRevision

La revisión de configuración usa preferentemente el `sourceRevision` ya calculado en el mismo snapshot. Sólo recurre a `getEcommerceConfigurationSourceRevision(localProduct)` cuando ese valor no existe. No se vuelve a leer el producto ni se recalcula después de firmar.

## 10. Outbox

Se conserva la estrategia B: la outbox persiste intención (`productRefs`, `fullReconcile`, `reason` y entradas), no persiste una key separada del payload. Cada intento reconstruye la proyección completa y genera su key correspondiente.

## 11. Reintentos

Un reintento exacto sin cambios locales reconstruye el mismo payload y obtiene la misma key. Si el producto cambió antes del nuevo intento, se reconstruye una proyección diferente y se genera una key nueva. No existe combinación de key antigua con payload nuevo.

## 12. Cambios en el servicio base

`src/services/ecommerce/ecommerceCatalogSyncServiceBase.js` ahora:

- importa el builder y el resolver de revisión canónicos;
- construye disponibilidad de configuración desde la evaluación del mismo snapshot;
- genera configuración simple, recipe, variantes y opciones antes de firmar;
- añade configuración y revisión a la proyección;
- incluye ambos campos en la firma;
- exporta únicamente internals limitados para pruebas.

## 13. Cambios en el servicio administrativo

`src/services/ecommerce/ecommerceAdminService.js` ahora:

- ya no depende de `ecommercePublishedStockLocalSource`;
- ya no acepta `configurationSource`;
- no llama `getProductsByIds`;
- no construye ni recalcula configuración;
- valida superficialmente el contenedor;
- transporta exactamente las proyecciones recibidas a `ecommerce_admin_sync_published_catalog_v2`;
- conserva auth, staff token, key, revisión esperada y errores seguros;
- mantiene sin cambios funcionales el flujo manual v2.

## 14. Tests

Se actualizaron pruebas del servicio administrativo y se añadió una suite dedicada a:

- flujo completo local → proyección → firma → key → transporte → RPC;
- una sola lectura local;
- snapshot versión 12 frente a mutación externa versión 13;
- key distinta por cambios sólo de configuración;
- key estable para payload idéntico;
- independencia del orden de claves de objetos;
- orden significativo de arrays;
- producto simple canónico;
- variantes, `optionValues`, grupos, opciones, `priceDelta` e ingredientes;
- revisión de configuración;
- retry exacto y payload reconstruido;
- no mutación.

## 15. ESLint

Pendiente de ejecución en un checkout local con dependencias instaladas. No se añadieron `eslint-disable`, `.skip`, `.todo`, timeouts ampliados ni mocks destinados a ocultar la segunda lectura.

## 16. Builds

Pendientes:

- `npm run build`;
- `npm run build:store`;
- `npm run build:store:vercel`.

## 17. Validación global

Pendientes por falta de checkout y resolución de `github.com` en el entorno de ejecución:

- `npm ci`;
- Vitest enfocado;
- `npm run lint`;
- `npm run test:ci`;
- `git diff --check` sobre un checkout real.

Sí se ejecutó `node --check` sobre los dos módulos modificados y los dos archivos de pruebas preparados. Los blobs remotos de los cuatro archivos coinciden con los blobs validados localmente.

## 18. Archivos

Modificados:

- `src/services/ecommerce/ecommerceCatalogSyncServiceBase.js`;
- `src/services/ecommerce/ecommerceAdminService.js`;
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`.

Creados:

- `src/services/ecommerce/__tests__/ecommerceCatalogSyncConfigurationSnapshot.test.js`;
- `docs/reports/ECOM.PRODUCTS.MODEL.1.2.md`.

## 19. Riesgos residuales

- Las suites Vitest, ESLint y builds todavía deben ejecutarse localmente.
- La corrección no debe marcarse ready ni mergearse hasta completar esa validación.
- No se modificó Supabase, las migraciones, Vercel, checkout, pedidos, caja, ventas ni inventario real.

## 20. Estado del PR

- PR abierto: sí.
- Draft: sí.
- Merge: no.
- Auto-merge: no.
- Escrituras en `main`: no.
- Deployments manuales: 0.
- Previews manuales: 0.

**ESTADO: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN LOCAL PENDIENTE.**
