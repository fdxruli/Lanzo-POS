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

Se actualizaron pruebas del servicio administrativo y se añadió una suite dedicada a snapshot único, firma completa, idempotencia, ausencia de mutación y transporte sin segunda lectura.

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

## 18. Archivos

La implementación MODEL.1.2 modificó los servicios de catálogo y administración, sus pruebas y este reporte.

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

**ESTADO MODEL.1.2: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN LOCAL PENDIENTE.**

---

# ECOM.PRODUCTS.MODEL.1.3 — Contrato availabilitySource y política de retry

Fecha de corrección: 2026-07-15 (America/Mexico_City)

## 1. Defecto de `inventory`

MODEL.1.2 construía `availabilitySource = "inventory"` para productos con `trackStock=true`. Ese valor no pertenece al contrato SQL instalado y provocaba `ECOMMERCE_CONFIGURATION_INVALID` antes de aplicar la configuración.

## 2. Contrato SQL oficial

Los únicos valores remotos admitidos son:

- `direct`;
- `recipe`;
- `variant_aggregate`;
- `not_tracked`;
- `manual`;
- `unverified`.

JavaScript declara el mismo vocabulario en `ECOMMERCE_AVAILABILITY_SOURCES`. No se modificó la allowlist SQL.

## 3. Mapeo anterior

El mapeo anterior era:

- receta → `recipe`;
- sin stock controlado → `not_tracked`;
- cualquier otro producto → `inventory`.

El último caso era incompatible y además clasificaba incorrectamente a productos con variantes.

## 4. Mapeo nuevo

La utilidad pura `resolveEcommerceAvailabilitySource(...)` devuelve exclusivamente valores oficiales:

- variantes → `variant_aggregate`;
- receta sin variantes → `recipe`;
- `trackStock=false` → `not_tracked`;
- producto base controlado → `direct`.

El builder deriva la fuente desde la configuración ya normalizada. El servicio de catálogo sólo aporta razón y fuente limitante; no mantiene una segunda política.

## 5. Precedencia

La precedencia canónica es:

1. `hasVariants` o `variant_parent`;
2. `hasRecipe` o `recipe`;
3. `trackStock=false`;
4. `direct`.

Así, un producto con variantes nunca se clasifica como inventario directo.

## 6. Producto simple

- controlado: `type=simple`, `availabilitySource=direct`;
- no controlado: `type=simple`, `availabilitySource=not_tracked`.

## 7. Producto recipe

Un producto con receta y sin variantes usa `availabilitySource=recipe`. Conserva `availabilityReasonCode`, `limitingSource`, capacidad derivada, ingrediente limitante y estados de disponibilidad calculados por el evaluador existente.

## 8. Variant parent

Un producto `variant_parent` usa `availabilitySource=variant_aggregate`. Permanece `requires_configuration=true` y no se reactiva en esta fase.

## 9. Configurable

- configurable con receta: `recipe`;
- configurable sin receta, controlado: `direct`;
- configurable sin control de stock: `not_tracked`.

## 10. `not_tracked`

`not_tracked` se usa únicamente cuando el producto base no controla inventario. No se introduce como alias de errores o lecturas incompletas.

## 11. Serializer

`serializeEcommerceProductConfigurationForSync(...)`:

- acepta únicamente el vocabulario oficial cuando recibe una fuente explícita;
- deriva una fuente oficial cuando el campo no fue proporcionado;
- rechaza `inventory` y cualquier valor desconocido con `ECOMMERCE_CONFIGURATION_INVALID`;
- no convierte silenciosamente un valor desconocido a `direct`.

## 12. Errores retryable

Continúan siendo reintentables:

- offline y errores de red;
- timeouts;
- lectura local temporalmente indisponible;
- HTTP 502, 503 y 504;
- PostgreSQL `40001`, `40P01`, conexiones `08xxx` y recursos `53xxx`.

Una lectura fallida de productos se envuelve explícitamente como `ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED` con `retryable=true`.

## 13. Errores permanentes

Los errores de configuración, variantes y opciones se clasifican antes de evaluar patrones de red. No pueden volverse retryable aunque un error arrastre `retryable=true` o un mensaje con la palabra timeout.

El catch de `buildProjections` conserva códigos explícitos, reconoce códigos expresados como mensaje y usa `ECOMMERCE_CATALOG_SYNC_PROJECTION_FAILED` para errores desconocidos no transitorios.

## 14. Outbox

Un error permanente de construcción:

- no llama `outbox.enqueue`;
- no llama `outbox.replacePending`;
- no programa `scheduleRetry`;
- devuelve estado `error` y `pendingCount=0`.

Las entradas antiguas no se destruyen automáticamente; una corrección posterior y un nuevo evento pueden reconstruir el payload y completar la sincronización.

## 15. Tests

Se corrigieron expectativas heredadas que usaban `inventory` y se añadió cobertura para:

- simple controlado y no controlado;
- recipe;
- variant parent;
- configurable con receta, directo y no controlado;
- allowlist SQL explícita;
- rechazo de `unknown_value` e `inventory`;
- lectura temporal retryable;
- `ECOMMERCE_CONFIGURATION_INVALID` no retryable;
- límite de opciones no retryable;
- error desconocido no retryable;
- network y offline retryable;
- corrección posterior del producto;
- integración producto → proyección → firma → key → transporte → RPC v2.

## 16. ESLint

Pendiente en checkout real. La revisión estática local no encontró `eslint-disable`, `.skip`, `.todo`, imports evidentemente huérfanos ni promesas nuevas sin tratamiento.

## 17. Builds

Pendientes por falta de checkout y dependencias:

- admin: `npm run build`;
- store: `npm run build:store`;
- staging: `npm run build:store:vercel`.

No se declaran como PASS.

## 18. Archivos

Modificados:

- `src/utils/ecommerceProductConfigurationSync.js`;
- `src/services/ecommerce/ecommerceCatalogSyncServiceBase.js`;
- `src/services/ecommerce/__tests__/ecommerceCatalogSyncConfigurationSnapshot.test.js`;
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`;
- `docs/reports/ECOM.PRODUCTS.MODEL.1.2.md`.

Creado:

- `src/services/ecommerce/__tests__/ecommerceCatalogSyncAvailabilityRetry.test.js`.

## 19. Riesgos residuales

- Vitest, ESLint y los tres builds deben ejecutarse en el checkout real del proyecto.
- El PR debe continuar draft hasta completar esa validación y recibir revisión independiente.
- No se modificaron Supabase, migraciones, SQL, React, CSS, checkout, pedidos, caja, ventas ni inventario real.

## 20. Estado del PR

- PR #98 abierto: sí.
- Rama: `fase-ecom-products-model-1`.
- Base: `main`.
- Draft: sí.
- Merge: no.
- Auto-merge: no.
- Escrituras en `main`: no.
- Deployments manuales: 0.
- Previews manuales: 0.

**ESTADO MODEL.1.3: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN LOCAL PENDIENTE.**
