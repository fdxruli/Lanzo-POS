# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado del PR

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Estado: **draft**
- Merge automático: **no realizado**
- Base real de `main`: `66315c445836bbf662224671c14524994acd0f13`
- Merge base confirmado: `66315c445836bbf662224671c14524994acd0f13`
- HEAD funcional antes de este commit documental: `329e5e6b027721c001a2a88fde05a879a98bdf92`
- La rama está `ahead` de `main` y `behind_by: 0` al cerrar la implementación funcional.

## Migraciones creadas

1. `supabase/migrations/20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
   - Captura transitoriamente la disponibilidad efectiva previa para conservar exactamente las filas existentes durante el backfill.
2. `supabase/migrations/20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
   - Agrega revisión monótona, modelo source/manual, estados operacionales, RPC batch, contrato público versionado e idempotencia.
3. `supabase/migrations/20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`
   - Restaura el snapshot legacy, endurece la separación entre disponibilidad manual y de fuente, normaliza `not_tracked`, calcula la firma pública efectiva y elimina la tabla transitoria.

Las migraciones están versionadas en el repositorio, pero **no fueron aplicadas a producción**. No se ejecutó `supabase db push`, `supabase migration repair`, SQL de escritura remoto ni modificación manual de funciones o tablas remotas.

## Modelo de campos vinculados y manuales

Cada producto publicado incorpora `sync_config` JSONB con los campos:

```json
{
  "name": "source | manual",
  "description": "source | manual",
  "category": "source | manual",
  "price": "source | manual",
  "image": "source | manual"
}
```

- Las filas existentes se conservan inicialmente en modo `manual` para no sobrescribir nombre, descripción, categoría, precio ni imagen.
- Las publicaciones nuevas de Lanzo Nube pueden iniciar vinculadas y convertir campos individuales a manual.
- Plan Free fuerza configuración manual y no expone sincronización automática.
- `is_published`, `display_order`, opciones públicas y disponibilidad manual nunca son sobrescritos por el runtime de sincronización.

## Disponibilidad efectiva

Se separaron:

- `manual_available`: decisión del administrador.
- `source_available`: estado confirmado de la fuente local.
- `is_available`: proyección efectiva persistida.

La regla aplicada es:

```text
is_available = manual_available AND source_available
```

La publicación pública además requiere `is_published = true`. El trigger de compatibilidad solo interpreta una escritura legacy de `is_available` como cambio manual cuando `source_available` no cambió. Por ello, una sincronización automática nunca reactiva un producto deshabilitado manualmente ni convierte una falta de stock de fuente en una decisión manual permanente.

## Estados de sincronización

Se agregaron:

- `sync_status`: `synced`, `pending`, `review`, `error`, `manual`.
- `source_state`: `source_missing`, `inactive_source`, `unverified`, `not_tracked`, `in_stock`, `out_of_stock` y `manual` para compatibilidad.
- `source_revision`, `last_sync_attempt_at`, `last_synced_at` y `sync_error_code` seguro.

No se guardan mensajes SQL, payloads completos, tokens ni metadatos sensibles.

## RPC batch administrativa

Se creó `ecommerce_admin_sync_published_catalog`.

Características:

- reutiliza `private.ecommerce_admin_authorize_v2`;
- acepta admin y staff según la autorización administrativa vigente;
- verifica `ecommerce_cloud_catalog_source` server-side;
- aísla por licencia y portal;
- valida pertenencia de cada producto al portal autorizado;
- máximo técnico de 200 proyecciones por lote, con múltiples lotes permitidos;
- rechaza IDs y referencias duplicadas;
- rechaza columnas arbitrarias y tipos no permitidos;
- usa una llave idempotente y tabla privada de respuestas;
- valida revisión esperada;
- ejecuta cada invocación dentro de la transacción de la función;
- devuelve únicamente conteos seguros y la nueva revisión.

La proyección enviada contiene solo identificadores necesarios, revisión de fuente, estado, disponibilidad, stock confirmado y campos públicos sincronizables. No incluye costos, proveedores, ventas, clientes, recetas completas, tokens ni información privada del negocio.

## Idempotencia

- El cliente genera una firma del lote normalizado.
- La llave incorpora portal, índice de chunk, firma y revisión esperada.
- El servidor guarda hash de solicitud y respuesta en `private.ecommerce_catalog_sync_requests`.
- Reutilizar la misma llave con otro payload produce conflicto seguro.
- Las entradas antiguas se purgan después de siete días.

## Revisión monótona del catálogo

`ecommerce_portals.catalog_revision` inicia en `1` y aumenta dentro de la misma transacción cuando cambia la firma que realmente observa el cliente:

- alta o baja pública;
- publicación/despublicación;
- nombre, descripción, categoría, precio, imagen;
- disponibilidad efectiva;
- orden;
- stock público efectivo según la feature y el modo;
- opciones públicas.

No aumenta por:

- intentos o fechas internas de sincronización;
- código de error;
- estado operacional interno;
- una cantidad de stock que el plan o modo oculta al público.

No se usa `max(updated_at)`.

## Contrato público versionado

`ecommerce_get_portal_by_slug` retorna:

```json
{
  "catalogRevision": 1,
  "cachePolicy": {
    "schemaVersion": 1,
    "freshSeconds": 300,
    "maxStaleSeconds": 86400
  }
}
```

`ecommerce_get_catalog` conserva la firma pública anterior y agrega una sobrecarga con `p_catalog_revision`. Si la revisión esperada no coincide, devuelve `ECOMMERCE_CATALOG_REVISION_CHANGED`. La paginación mantiene orden determinista por `display_order`, `public_name` e `id`.

El frontend solo activa el caché versionado cuando el servidor entrega una revisión explícita. Esto mantiene compatibilidad segura si el frontend se despliega antes que las migraciones.

## Runtime de sincronización PRO

Componentes principales:

- `ecommerceCatalogSyncService.js`
- `EcommerceCatalogSyncRuntime.jsx`
- `ecommerceCatalogSyncOutbox.js`
- infraestructura masiva de `ecommercePublishedStockLocalSource.js`

Eventos considerados:

- `PRODUCT_SYNC_EVENT`;
- `lanzo:ticker-inventory-alert`;
- `online`;
- `visibilitychange` a visible;
- solicitud manual desde Portal online;
- cambio de licencia, rol de dispositivo o sesión staff mediante invalidación de contexto.

## Single-flight, dirty y protección stale

- Debounce por defecto: 900 ms.
- Los IDs se coalescen en un `Set`.
- Existe una única ejecución activa por runtime/contexto.
- Un evento durante una ejecución marca `dirty`.
- Al terminar se realiza una repetición consolidada; una tercera acumulación se agenda como seguimiento consolidado.
- Cada commit se protege con `contextKey` y `contextEpoch`.
- Cambiar licencia, rol o sesión staff invalida timers y respuestas pendientes.
- Una respuesta antigua no puede actualizar el estado del contexto nuevo.
- Si el evento no trae IDs confiables se solicita reconciliación masiva.
- La evaluación local obtiene productos, categorías y lotes en bloque, con chunks técnicos, sin consulta por producto.

## Cola offline

Base independiente: `lanzo-ecommerce-catalog-sync-outbox`.

La cola almacena exclusivamente:

- hash del ámbito de licencia/contexto;
- `portalId` previamente autorizado;
- referencia local del producto o bandera de reconciliación completa;
- motivo seguro y timestamp.

No almacena licencia en claro, tokens, sesión staff ni productos completos. Las entradas están aisladas por hash de ámbito y portal, se coalescen por producto, sobreviven recargas y solo se eliminan después de confirmación. La asociación segura `scopeHash + portalId` permite encolar también cuando un runtime nuevo inicia completamente offline.

## Diseño del caché público IndexedDB

Base independiente: `lanzo-public-store-cache`.

No importa ni inicializa el store del POS, la Dexie privada del negocio, servicios de licencia ni `useAppStore`.

Tablas:

- `pages`: clave por slug, revisión, offset, límite y versión de esquema.
- `portals`: snapshot público mínimo para fallback offline.

Datos permitidos:

- slug;
- revisión;
- versión;
- página, offset, límite y paginación;
- productos públicos normalizados;
- timestamps de creación y último acceso.

Un sanitizador descarta payloads malformados y claves potencialmente privadas como cliente, teléfono, dirección de checkout, notas, pedidos, idempotencia, tokens, licencia, staff, costos y proveedores. No se guardan respuestas administrativas.

## Política de caché

- `schemaVersion`: 1.
- `freshSeconds`: 300.
- `maxStaleSeconds`: 86400.
- La revisión server-side, no el TTL, determina vigencia.
- Limpieza por esquema, expiración, revisión obsoleta, máximo de tiendas/páginas y acceso menos reciente.
- La limpieza es asíncrona y no bloquea el primer render.

## Comportamiento con la misma revisión

Flujo esperado en una segunda entrada o recarga:

1. una RPC ligera a `ecommerce_get_portal_by_slug` confirma la revisión;
2. la página se obtiene de IndexedDB;
3. no se ejecuta `ecommerce_get_catalog` para páginas ya cacheadas.

Las páginas posteriores también consultan primero IndexedDB.

## Comportamiento al cambiar revisión

- No se reutilizan páginas de la revisión anterior.
- Se muestra `Actualizando catálogo…`.
- El checkout queda bloqueado.
- La primera página nueva reemplaza el estado visible de forma controlada.
- `ECOMMERCE_CATALOG_REVISION_CHANGED` reinicia desde offset cero una sola vez y evita ciclos.
- Las revisiones antiguas se limpian en segundo plano.
- Los guards existentes por slug, generación, offsets solicitados, paginación y deduplicación se conservaron.

## Comportamiento offline

Si existe caché dentro de `maxStaleSeconds`:

- se permite navegación de solo lectura;
- se muestra aviso de falta de conexión;
- el checkout permanece deshabilitado;
- no se presentan precios o stock como confirmados.

Sin caché válido se mantiene el estado de tienda no disponible/error. Nunca se reutiliza información entre slugs ni se usa caché vencido indefinidamente.

## Reconciliación del carrito

La llave de reconciliación incluye slug y `catalogRevision`.

Al cambiar la revisión:

- se actualizan precio y disponibilidad;
- se limita cantidad por stock vigente;
- se eliminan productos inexistentes solo después de agotar la paginación;
- se cargan páginas adicionales para resolver IDs persistidos;
- se mantiene el aviso de reconciliación;
- un producto de una revisión anterior no puede confirmar checkout.

El servidor continúa siendo la autoridad final sobre precio, disponibilidad y creación del pedido.

## Diferencias FREE / PRO

### Plan Free

- máximo 10 productos;
- snapshot y edición manual;
- stock público oculto;
- alertas locales de productos publicados sin stock;
- caché público IndexedDB habilitado;
- sin autosync cloud, stock exacto público ni controles de sincronización.

### Lanzo Nube / PRO

- autosync solo cuando `ecommerce_cloud_catalog_source === true`;
- campos vinculados actualizables y campos manuales preservados;
- evaluación masiva de producto, categoría, stock y lotes;
- cola offline;
- resumen, badges, última sincronización y botón `Sincronizar ahora`.

## Pruebas agregadas

Frontend y servicios:

- `ecommercePublicCatalogCache.test.js`
- `ecommercePublicService.catalogCache.test.js`
- `ecommerceCatalogSyncOutbox.test.js`
- `ecommerceCatalogSyncService.test.js`
- `usePublicCart.catalogRevision.test.jsx`

Cobertura incluida:

- aislamiento de slug/revisión/esquema;
- segunda entrada sin nueva RPC de catálogo;
- cambio de revisión;
- fallback offline;
- descarte de payload malformado y datos privados;
- FREE sin autosync;
- 20 eventos rápidos consolidados;
- single-flight y repetición dirty;
- IDs duplicados coalescidos;
- `source_missing` y `unverified`;
- cola offline, aislamiento y recarga completamente offline;
- reconciliación del carrito por revisión y paginación pendiente.

SQL local/transaccional:

- `supabase/tests/ecom_fe_catalog_3_sync_and_revision.sql`
- backfill, revisión inicial, incremento público, ausencia de incremento interno, disponibilidad efectiva, autorización/feature, duplicados, límite, idempotencia, revisión esperada, paginación versionada y ausencia de grants directos.

## Validación ejecutada y pendiente

Validación realizada mediante inspección del diff y contratos a través del conector de GitHub:

- rama parte exactamente del HEAD confirmado de `main`;
- merge base coincide con `main`;
- rama no está detrás de `main`;
- PR abierto, no mergeado y draft;
- revisión estática de compatibilidad de firmas públicas;
- revisión de separación FREE/PRO;
- revisión de ausencia de credenciales y PII en estructuras persistidas;
- revisión de ausencia de `.skip`, `.todo`, `eslint-disable`, workflows temporales y reglas genéricas de Service Worker.

No fue posible ejecutar en este entorno:

```text
npm ci
ESLint enfocado
suites Vitest
npm run build
npm run lint
npm run test:ci
git diff --check
git status --short
pruebas SQL locales
comparación ejecutable contra un checkout limpio de main
```

Motivo: el entorno conectado permite operar el repositorio mediante la API de GitHub, pero no dispone de un checkout autenticado del repositorio privado, `gh`, dependencias instaladas ni acceso de red del contenedor al repositorio. Por ello, **no se declara PASS** para build, lint o tests y el PR permanece draft.

## Comparación con main

- Base y merge base: `66315c445836bbf662224671c14524994acd0f13`.
- `behind_by: 0` al cerrar implementación funcional.
- Los cambios se limitan a catálogo ecommerce, tienda pública, carrito, runtime, caché, pruebas y migraciones nuevas.
- No se modificó el contrato de cobro ecommerce ni la conversión de pedidos a ventas POS.
- No se ejecutó una comparación de comandos contra un checkout limpio de `main`; queda pendiente de la validación manual posterior.

## Vercel

No se creó, forzó, promovió ni validó manualmente ninguna preview de Vercel. GitHub reportó un deployment automático asociado al PR, pero no fue iniciado por esta tarea ni se utilizó como evidencia de validación.

## Riesgos y pendientes reales

1. Aplicar y revisar las tres migraciones en una tarea separada, primero en entorno local/transaccional y después según el proceso de despliegue de Supabase.
2. Ejecutar instalación, ESLint, suites enfocadas, regresiones, build, lint global, `test:ci`, `git diff --check` y `git status --short` sobre checkout íntegro.
3. Ejecutar las pruebas SQL locales.
4. Realizar pruebas manuales de segunda entrada con cero RPC de catálogo, cambio de revisión, navegación offline, recuperación de conexión, carrito persistido y controles PRO/FREE.
5. Mantener el PR en draft hasta completar todos los puntos anteriores.

## Confirmaciones

- Migraciones aplicadas a producción: **no**.
- SQL remoto de escritura: **no**.
- Cambios manuales en Supabase: **no**.
- Preview manual de Vercel: **no**.
- PII o credenciales en caché público: **no**.
- PII, tokens o productos completos en outbox: **no**.
- PR mergeado: **no**.
- PR draft: **sí**.
