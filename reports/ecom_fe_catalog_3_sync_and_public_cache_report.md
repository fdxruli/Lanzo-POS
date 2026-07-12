# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**CORRECCIONES ECOM.FE.CATALOG.3.1 IMPLEMENTADAS / VALIDACIÓN PENDIENTE**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Estado del PR: **draft**
- Base: `main`
- Base y merge-base confirmados: `66315c445836bbf662224671c14524994acd0f13`
- HEAD inicial real de la corrección: `6b32df3f02aaa092f004c0a9906f1be794e5fab1`
- HEAD funcional previo a esta actualización documental: `bc0950319eac669ac27c5ece7b711480154e6a08`
- Relación comprobada antes de actualizar este reporte: `ahead`, `behind_by: 0`
- Merge automático: **no realizado**

El HEAD final del PR es el commit que contiene esta actualización documental y debe consultarse en el propio PR. El PR debe permanecer en draft hasta completar la validación ejecutable, las pruebas SQL seguras y las pruebas manuales.

## Archivos modificados por ECOM.FE.CATALOG.3.1

- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/ecommerceCatalogSyncService.js`
- `src/services/ecommerce/ecommerceCatalogSyncOutbox.js`
- `src/services/ecommerce/ecommercePublicCatalogCache.js`
- `src/components/ecommerce/EcommerceProductPublishModal.jsx`
- `src/services/ecommerce/__tests__/ecommerceCatalogSyncService.test.js`
- `src/services/ecommerce/__tests__/ecommerceCatalogSyncOutbox.test.js`
- `src/services/ecommerce/__tests__/ecommercePublicCatalogCache.test.js`
- `src/components/ecommerce/__tests__/EcommerceProductPublishModal.stockMode.test.jsx`
- `supabase/migrations/20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
- `supabase/migrations/20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`
- `supabase/tests/ecom_fe_catalog_3_sync_and_revision.sql`
- `reports/ecom_fe_catalog_3_sync_and_public_cache_report.md`

La corrección conserva la arquitectura original de la fase: autosync únicamente PRO, caché público FREE/PRO, revisión monótona del catálogo, campos `source | manual`, disponibilidad efectiva manual/fuente, paginación versionada, carrito reconciliado, checkout bloqueado durante validación, RPC batch, outbox IndexedDB, debounce, single-flight, dirty y stale protection.

## 1. Lecturas locales fail-closed

### Productos

`getProductsByIds` ya no convierte una excepción en `new Map()`. Una falla de IndexedDB genera `ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED`, se clasifica como reintentable, aborta antes de llamar a la RPC y conserva el trabajo en el outbox.

Por tanto:

- una falla técnica no produce `source_missing`;
- no se envía `sourceAvailable: false`;
- no se modifica stock;
- no se modifican campos públicos;
- se conserva el último snapshot confirmado.

`source_missing` se produce únicamente cuando la lectura masiva terminó correctamente y el ID solicitado no existe en el resultado.

### Categorías

Una falla de lectura de categorías omite `fields.category` del payload. El servidor distingue así entre:

- propiedad presente con `null`: borrar el valor vinculado;
- propiedad ausente: no evaluada, conservar el valor público anterior.

### Lotes

Una falla de lectura de lotes continúa como `unverified`, con:

```text
sourceAvailable: null
stockSnapshot: null
```

La RPC conserva `source_available`, `stock_snapshot`, revisión confirmada y hash confirmados. No inventa stock cero ni altera la disponibilidad efectiva.

## 2. Firma idempotente completa

La llave cliente es:

```text
ecom-catalog-sync:<portal>:<hash-semantico-completo>
```

La normalización incluye:

- `publishedProductId`;
- `localProductRef`;
- `sourceRevision`;
- `sourceState`;
- `sourceAvailable`;
- `stockSnapshot`;
- `fields.name`;
- `fields.description`;
- `fields.category`;
- `fields.price`;
- `fields.image`.

La serialización usa orden estable de propiedades, normalización de `null`, strings y números, y orden estable de productos por identificadores. No incluye timestamps locales, motivos, `batchIndex` ni posición accidental del chunk.

El servidor calcula el hash sobre el JSONB completo. Reusar una llave con otro payload devuelve `ECOMMERCE_IDEMPOTENCY_CONFLICT`; repetir exactamente el mismo lote devuelve la respuesta idempotente.

Se agregaron pruebas para cambio solo de stock, cambio solo de precio, distinto orden de propiedades, distinto orden de productos y repetición idéntica.

## 3. Errores reintentables y outbox

La clasificación reconoce:

- navegador offline;
- `TypeError`, `AbortError`, `TimeoutError`;
- errores conocidos de red y fetch;
- HTTP 502, 503 y 504;
- códigos PostgreSQL/PostgREST de conexión, timeout, bloqueo o recursos temporales;
- mensajes conocidos de red temporal.

Los fallos reintentables en `getPortal`, `listPublishedProducts`, lectura local de productos y `syncBatch` persisten:

- referencias originales, o reconciliación completa;
- portal autorizado recordado cuando existe;
- motivo técnico seguro;
- timestamp;
- ámbito cifrado mediante hash, sin licencia ni tokens en claro.

El outbox admite además un ámbito de portal pendiente para fallos que ocurren antes de poder resolver el portal.

### Reconocimiento y fallo parcial

Las entradas se reconocen únicamente después de que todos los chunks correspondientes terminan correctamente.

Si un chunk posterior falla, `replacePending` reemplaza atómicamente el trabajo anterior por las referencias todavía no confirmadas. Los chunks ya confirmados no se reenvían indefinidamente y los pendientes no se pierden.

### Reintento

Se conserva el reintento por:

- inicio del runtime;
- evento `online`;
- aplicación visible;
- acción manual;
- backoff limitado con jitter: 2 s, 5 s, 15 s, 30 s y máximo 60 s.

Los timers se cancelan al invalidar licencia, dispositivo, rol o sesión staff.

## 4. Protección cross-device

La revisión de fuente cliente utiliza:

- `version:<decimal-canonico>`;
- `timestamp:<epoch-ms>`;
- `opaque:<valor>` cuando no existe una revisión comparable.

No se utiliza el texto fijo `local`. La normalización decimal no pierde precisión para versiones mayores que el rango seguro de JavaScript.

Se agregaron a `ecommerce_published_products`:

- `source_revision_kind`;
- `source_revision_order`;
- `source_payload_hash`.

La RPC bloquea cada fila y decide:

- revisión menor: `stale`, sin sobrescribir;
- revisión igual y mismo payload: idempotente;
- revisión igual y payload diferente: conflicto/review;
- revisión mayor: aplicar;
- revisión opaca o incomparable: conflicto, salvo repetición exacta de la misma revisión y payload.

El resultado incluye estados por producto y conteos seguros:

- `staleCount`;
- `conflictCount`;
- `reviewCount`;
- `updatedCount`;
- `skippedCount`.

Un lote mixto puede aplicar productos válidos y reportar stale/conflict en otros. Una respuesta tardía no puede restaurar un precio o snapshot anterior.

## 5. Caché público mediante allowlists

Se eliminó la blacklist amplia y se implementaron sanitizadores explícitos:

- `sanitizePublicPortal`;
- `sanitizePublicHours`;
- `sanitizePublicFeatures`;
- `sanitizePublicProduct`;
- `sanitizePublicOptions`;
- allowlists separadas para tema y settings públicos.

### Portal conservado offline

- `slug`;
- `name`;
- `headline`;
- `description`;
- `templateCode`;
- `customizationLevel`;
- tema público permitido;
- `logoUrl`;
- `coverImageUrl`;
- `whatsappPhone`;
- `address`;
- `businessType`;
- `orderingEnabled`;
- `pickupEnabled`;
- `deliveryEnabled`;
- `scheduledOrdersEnabled`;
- `minOrderTotal`;
- `maxOrderItems`;
- `maxItemQuantity`;
- `stockMode`;
- settings públicos permitidos.

### Features conservadas

- `whatsappCheckout`;
- `orderInbox`;
- `customSlug`;
- `brandingCustomization`;
- `layoutCustomization`;
- `businessHours`;
- `deliveryPickupSettings`;
- `stockVisibility`;
- `realtimeOrders`.

### Horarios

Se conservan exclusivamente los campos públicos de `weekly` y `exceptions` definidos por el contrato.

### Productos y opciones

Los productos se reducen a ID, contenido público, precio, moneda, imagen, disponibilidad, orden, stock público y opciones públicas allowlisted. Las opciones aceptan únicamente claves públicas escalares y colecciones explícitas.

El caché no admite respuestas de checkout ni conserva cliente, teléfono o dirección de checkout, notas, pedido, idempotencia, token, licencia, staff, costo, proveedor o datos arbitrarios del backend.

## 6. Política de stock público PRO

`EcommerceProductPublishModal` incorpora el selector:

```text
Visibilidad del inventario
- Ocultar stock
- Mostrar Disponible / Agotado
- Mostrar cantidad exacta
```

Mapeo:

```text
hidden | status | exact
```

Reglas finales:

- FREE no expone el selector y fuerza `hidden`;
- PRO consulta la feature server-side `ecommerce_stock_visibility`;
- feature deshabilitada fuerza `hidden`;
- fallo al validar la feature bloquea el guardado, para no alterar silenciosamente una política existente;
- edición carga y conserva el modo existente;
- `not_tracked` fuerza `hidden`;
- `unverified`, `source_missing` e `inactive_source` no publican cero inventado;
- `status` publica solo disponible/agotado;
- `exact` publica cantidad confirmada no negativa;
- la disponibilidad pública continúa respetando el control manual.

La RPC administrativa existente valida plan, feature y valores permitidos server-side. Las migraciones correctivas endurecen además la proyección pública de stock.

## Migraciones finales

Migraciones originales de la fase, todavía pendientes:

1. `20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
2. `20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
3. `20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`

Migraciones correctivas posteriores:

4. `20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
5. `20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`

Se eligieron migraciones posteriores para mantener una secuencia legible y no reescribir el bloque funcional previo. Toda la cadena debe validarse desde cero en una base local antes de aplicar a producción.

**Ninguna migración fue aplicada.** No se ejecutó `supabase db push`, `supabase migration repair`, SQL de escritura remoto ni modificación manual de tablas, funciones, permisos, datos o configuración de Supabase producción.

## Pruebas agregadas o ampliadas

### JavaScript / React

- fallos de lectura de productos, categorías y lotes;
- distinción entre error y `source_missing`;
- preservación de disponibilidad y stock para `unverified`;
- firma idempotente completa;
- clasificación de errores transitorios;
- portal/lista/sync reintentables;
- fallo en segundo chunk;
- reconocimiento solo tras éxito;
- cancelación de backoff;
- aislamiento y privacidad del outbox;
- allowlists del portal, features, horarios, productos y options;
- conservación offline de `orderingEnabled`, `orderInbox`, `maxOrderItems`, `whatsappPhone` y `address`;
- exclusión de PII, credenciales y checkout;
- FREE hidden;
- PRO status/exact;
- feature deshabilitada;
- `not_tracked`;
- edición existente;
- fallo de validación server-side de la feature.

### SQL

`supabase/tests/ecom_fe_catalog_3_sync_and_revision.sql` valida de forma transaccional:

- columnas y helpers de revisión;
- 10→9 stale;
- 10→10 mismo payload idempotente;
- 10→10 distinto payload conflicto;
- 10→11 actualización;
- revisiones opacas en conflicto;
- hash estable y sensible a stock/precio;
- revisión monótona pública;
- disponibilidad manual/fuente;
- `not_tracked` oculto;
- `unverified` sin cantidad inventada;
- contrato de la RPC y locks;
- validación server-side de stock mode;
- paginación versionada;
- ausencia de grants privados o directos.

## Validación realizada

En el entorno disponible se efectuó:

- revisión del estado real del PR, HEAD, base y merge-base;
- comprobación de que el HEAD inicial no tenía commits posteriores que resolvieran los seis puntos;
- `node --check` sobre los servicios JavaScript modificados: **PASS**;
- parseo/transpilación TypeScript de los archivos JS/JSX y pruebas modificados: **PASS**;
- comprobación estructural de delimitadores `$$` de los SQL: **PASS**;
- comparación GitHub de la rama frente a `main`: `ahead`, `behind_by: 0` antes de este commit documental.

## Validación pendiente

Este entorno no pudo obtener un checkout íntegro mediante red directa a GitHub. Por ello no se ejecutaron todavía:

```text
npm ci
ESLint enfocado
Vitest enfocado
npm run build
npm run lint
npm run test:ci
git diff --check
git status --short
pruebas SQL en base local/transaccional
comparación ejecutable equivalente contra main
pruebas manuales
```

No existen ejecuciones de GitHub Actions asociadas al HEAD funcional revisado. El único estado remoto observado fue Vercel fallando por límite de deployments/build rate; no se considera un defecto del código ni una validación aprobada y no se creó, forzó, promovió ni validó ningún preview manual.

## Estado de cierre

- Correcciones ECOM.FE.CATALOG.3.1: **implementadas**.
- Validación ejecutable completa: **pendiente**.
- Pruebas SQL: **pendientes de ejecución segura**.
- Pruebas manuales: **pendientes**.
- Migraciones: **sin aplicar**.
- Supabase producción: **sin cambios**.
- Flujo de cobro ecommerce / conversión a venta POS: **sin cambios**.
- PR: debe continuar **draft**.
- Ready for review: **no**.
- Merge: **no realizado**.
