# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**CORRECCIONES ECOM.FE.CATALOG.3.1 IMPLEMENTADAS EN EL HEAD REVISADO / DOS BLOQUEANTES DE REVISIÓN Y VALIDACIÓN EJECUTABLE PENDIENTE**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Estado del PR: **draft**
- Base: `main`
- Base y merge-base confirmados: `66315c445836bbf662224671c14524994acd0f13`
- HEAD histórico revisado antes de ECOM.FE.CATALOG.3.1: `6b32df3f02aaa092f004c0a9906f1be794e5fab1`
- HEAD inicial real de esta revisión: `12ec335b6ea5a0ab87f411a41c56b9f859636334`
- Relación con `main`: `ahead`, `behind_by: 0`
- Relación con el HEAD histórico: `ahead_by: 18`, `behind_by: 0`
- Merge automático: **no realizado**

El PR debe permanecer en draft. El análisis estático confirma que los seis bloques originales tienen implementación posterior al HEAD histórico, pero todavía no puede declararse completa la fase debido a dos defectos o discrepancias residuales y a la falta de validación ejecutable sobre un checkout íntegro.

## Alcance revisado

Se revisaron los cambios posteriores a `6b32df3f02aaa092f004c0a9906f1be794e5fab1` en:

- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/ecommerceCatalogSyncService.js`
- `src/services/ecommerce/ecommerceCatalogSyncOutbox.js`
- `src/services/ecommerce/ecommercePublicCatalogCache.js`
- `src/components/ecommerce/EcommerceProductPublishModal.jsx`
- pruebas JavaScript/React relacionadas
- migraciones `20260712210000` y `20260712210100`
- `supabase/tests/ecom_fe_catalog_3_sync_and_revision.sql`

La arquitectura original se conserva: sincronización automática exclusivamente PRO, caché público FREE/PRO, revisión monótona, campos `source | manual`, disponibilidad manual/fuente, paginación versionada, reconciliación del carrito, checkout bloqueado durante validación, RPC batch, outbox IndexedDB, debounce, single-flight, dirty y stale protection.

## 1. Lecturas locales fail-closed

### Productos

`getProductsByIds` ya no transforma una excepción en un mapa vacío. Una falla genera `ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED`, se clasifica como reintentable, aborta antes de llamar a la RPC y conserva el trabajo en el outbox.

Consecuencias verificadas:

- una falla técnica no produce `source_missing`;
- no se envía `sourceAvailable: false`;
- no se modifica stock;
- no se modifican campos públicos;
- `source_missing` se utiliza únicamente después de una lectura masiva exitosa donde el ID realmente no existe.

### Categorías

Una falla al leer categorías omite `fields.category`. Se distingue correctamente entre:

- propiedad presente con `null`: borrar el valor enlazado;
- propiedad ausente: campo no evaluado, conservar el valor público anterior.

### Lotes

Una falla al leer lotes genera una proyección técnica:

```text
sourceState: unverified
sourceAvailable: null
stockSnapshot: null
```

No se inventa stock cero. La ruta de actualización SQL contiene expresiones para conservar disponibilidad, stock, revisión y hash confirmados cuando `sourceState = 'unverified'`.

### Bloqueante residual B1 — decisión de revisión antes de preservar `unverified`

La RPC calcula `private.ecommerce_source_revision_decision(...)` antes de entrar a la actualización especial de `unverified`.

Cuando ya existe una revisión confirmada y llega la misma revisión con el payload técnico `unverified`, el hash cambia porque también cambian `sourceState`, `sourceAvailable` y `stockSnapshot`. Con revisión igual y hash distinto, la decisión puede ser `conflict`, por lo que la función hace `continue` antes de ejecutar la rama que conserva el snapshot y registra `unverified`.

La disponibilidad y el stock no se sobrescriben, pero el resultado puede quedar como conflicto en lugar de `unverified`. La prueba SQL actual inspecciona la definición y los helpers, pero no ejecuta este caso completo contra una fila previamente confirmada.

Pendiente funcional:

1. resolver `unverified` antes o de manera explícita dentro de la decisión de concurrencia;
2. impedir que una proyección técnica permita sobrescribir campos desde una revisión antigua;
3. agregar una prueba RPC real: fila confirmada → misma revisión → lote incompleto → conserva snapshot y queda `review/SOURCE_UNVERIFIED`, no conflicto.

## 2. Firma idempotente completa

La llave cliente tiene la forma:

```text
ecom-catalog-sync:<portal>:<hash-semantico-completo>
```

Incluye:

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

La normalización usa orden estable de propiedades, orden estable de productos, números finitos, strings normalizados y presencia explícita de campos evaluados. No depende de `batchIndex`.

El servidor calcula el hash sobre el JSONB completo y devuelve `ECOMMERCE_IDEMPOTENCY_CONFLICT` cuando una llave ya utilizada llega con otro payload. Las pruebas cubren cambios de stock, precio, orden de propiedades y orden de productos.

## 3. Errores reintentables y outbox

La clasificación reconoce:

- navegador offline;
- `TypeError`, `AbortError`, `TimeoutError`;
- HTTP 502, 503 y 504;
- códigos PostgreSQL/PostgREST de conexión, timeout, bloqueo o recursos temporales;
- mensajes conocidos de red temporal.

Los fallos reintentables en portal, lista, lectura local y sync persisten:

- referencias originales o reconciliación completa;
- portal recordado cuando existe;
- motivo técnico seguro;
- timestamp;
- scope mediante hash, sin licencia, token ni sesión en claro.

Las entradas se reconocen únicamente después del éxito de todos los chunks de la ejecución. Ante un fallo en un chunk posterior, `replacePending` sustituye atómicamente las entradas anteriores por las referencias todavía no confirmadas.

### Bloqueante residual B2 — alcance real del backoff posterior a un fallo parcial

Después de persistir únicamente las referencias restantes, `scheduleRetry()` llama `scheduleSync()` sin `productIds`. `rememberPending()` interpreta un arreglo vacío como `fullReconcile`.

Por tanto:

- el outbox sí conserva correctamente los productos pendientes;
- no se pierde trabajo;
- la ejecución automática posterior puede volver a reconciliar todo el catálogo, incluidos chunks ya confirmados;
- la afirmación anterior de que los chunks exitosos no se reenvían era demasiado fuerte.

La reconciliación completa sigue siendo idempotente y es admisible si se documenta, pero la prueba actual solo comprueba que `replacePending` recibió las referencias restantes; no ejecuta el callback del backoff para comprobar el alcance real del siguiente envío.

Pendiente funcional o contractual:

- opción A: hacer que el backoff drene exclusivamente el outbox sin convertir refs vacías en `fullReconcile`;
- opción B: conservar la reconciliación completa, documentarla expresamente y agregar una prueba que demuestre su idempotencia y alcance.

Los reintentos por `online`, visibilidad e inicio del runtime también solicitan reconciliación completa deliberadamente.

Backoff configurado: 2 s, 5 s, 15 s, 30 s y máximo 60 s, con jitter. Los timers se cancelan al invalidar licencia, dispositivo, rol o sesión staff.

## 4. Protección entre dispositivos

La revisión cliente utiliza:

- `version:<decimal-canonico>`;
- `timestamp:<epoch-ms>`;
- `opaque:<valor>` cuando no existe una revisión comparable.

No se utiliza el texto fijo `local`. Las versiones numéricas grandes se comparan sin convertirlas a enteros inseguros de JavaScript.

Se agregaron:

- `source_revision_kind`;
- `source_revision_order`;
- `source_payload_hash`.

Reglas verificadas en helpers y RPC:

- revisión menor: stale, sin sobrescribir;
- revisión igual y mismo payload: idempotente;
- revisión igual y payload distinto: conflicto/review;
- revisión mayor: aplicar;
- revisión opaca: solo repetición exacta es idempotente;
- locks por portal y producto;
- resultados por producto y conteos `staleCount`, `conflictCount`, `reviewCount`, `updatedCount`, `skippedCount`.

El bloqueante B1 debe resolverse sin debilitar estas reglas.

## 5. Caché público mediante allowlists

Se reemplazó la blacklist amplia por sanitizadores explícitos:

- `sanitizePublicPortal`;
- `sanitizePublicHours`;
- `sanitizePublicFeatures`;
- `sanitizePublicProduct`;
- `sanitizePublicOptions`;
- allowlists separadas para tema y settings públicos.

### Portal conservado offline

`slug`, `name`, `headline`, `description`, `templateCode`, `customizationLevel`, tema permitido, `logoUrl`, `coverImageUrl`, `whatsappPhone`, `address`, `businessType`, `orderingEnabled`, `pickupEnabled`, `deliveryEnabled`, `scheduledOrdersEnabled`, `minOrderTotal`, `maxOrderItems`, `maxItemQuantity`, `stockMode` y settings públicos permitidos.

### Features conservadas

`whatsappCheckout`, `orderInbox`, `customSlug`, `brandingCustomization`, `layoutCustomization`, `businessHours`, `deliveryPickupSettings`, `stockVisibility` y `realtimeOrders`.

### Privacidad

El caché no permite respuestas arbitrarias de checkout ni conserva cliente, teléfono o dirección de checkout, notas, pedido, llave idempotente, token, licencia, staff, costo, proveedor o propiedades no allowlisted.

## 6. Política de stock público PRO

`EcommerceProductPublishModal` incorpora:

```text
Visibilidad del inventario
- Ocultar stock
- Mostrar Disponible / Agotado
- Mostrar cantidad exacta
```

Mapeo: `hidden | status | exact`.

Comportamiento verificado:

- FREE no muestra el selector y guarda `hidden`;
- PRO consulta `ecommerce_stock_visibility`;
- feature deshabilitada fuerza `hidden`;
- error al validar la feature bloquea el guardado;
- edición carga el modo existente;
- producto sin control de stock fuerza `hidden`;
- `not_tracked` fuerza `hidden` también server-side;
- estados no confirmados no publican cantidad cero;
- `status` expone solo disponible/agotado;
- `exact` expone cantidad confirmada no negativa;
- la disponibilidad pública respeta el control manual.

La RPC administrativa valida plan, feature y valores permitidos server-side.

## Migraciones

Migraciones originales pendientes:

1. `20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
2. `20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
3. `20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`

Migraciones correctivas posteriores:

4. `20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
5. `20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`

**Ninguna migración fue aplicada.** No se ejecutó `supabase db push`, `supabase migration repair`, SQL de escritura remoto ni modificación manual de Supabase producción.

## Pruebas revisadas

Las pruebas agregadas cubren gran parte del contrato solicitado:

- error de lectura vs `source_missing` real;
- categoría no evaluada;
- proyección `unverified` sin cero inventado;
- firma idempotente completa;
- errores transitorios y outbox;
- fallo en segundo chunk y persistencia de refs restantes;
- reconocimiento tras éxito;
- cancelación de backoff;
- allowlists y exclusión de PII;
- stock mode FREE/PRO;
- reglas auxiliares de concurrencia SQL.

Cobertura pendiente:

1. ejecutar el callback real del backoff después de un fallo en el segundo chunk;
2. ejecutar la RPC completa con una fila confirmada y una proyección `unverified` de igual revisión;
3. carrera real de dos sesiones/dispositivos contra la RPC;
4. instalación completa de migraciones desde cero en una base local.

## Validación realizada

- PR abierto, no mergeado y en draft: confirmado.
- HEAD inicial real de esta revisión: confirmado.
- Base y merge-base con `main`: confirmados.
- Rama `behind_by: 0`: confirmada.
- Revisión estática de servicios, UI, pruebas y SQL: realizada.
- Revisión de estados remotos: solo existe fallo Vercel por límite de build/deployments; no se considera validación de código.
- Review threads abiertos: ninguno.

## Validación no ejecutada

No se obtuvo un checkout íntegro ejecutable en el entorno disponible. Permanecen pendientes:

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
comparación ejecutable contra main
pruebas manuales
```

No se utilizó Vercel como sustituto del build local y no se creó, forzó, promovió ni validó preview manual.

## Estado de criterios de aceptación

Cumplidos por inspección estática: 1, 2, 3, 5, 6, 7, 8, 9, 10, 11 parcialmente, 12, 13, 14, 15, 16, 17, 18 y 19.

Pendientes o bloqueados:

- criterio 4: la preservación física existe, pero `unverified` puede quedar interceptado como conflicto;
- criterio 11: stale está implementado, pendiente corregir la interacción con `unverified`;
- criterios 20, 21 y 22: validación ejecutable no realizada;
- criterios 23 y 24: se mantienen cumplidos; el PR sigue draft y no fue mergeado.

## Entrega resumida

1. PR y rama: `#93`, `fase-ecom-fe-catalog-3`.
2. HEAD inicial de esta revisión: `12ec335b6ea5a0ab87f411a41c56b9f859636334`.
3. HEAD final: consultar el PR después del commit documental.
4. Archivos funcionales revisados: servicios de sync/outbox/cache/admin, modal, pruebas y migraciones.
5. Errores de productos abortan; `source_missing` solo procede de lectura exitosa.
6. Categoría no evaluada se omite; stock y disponibilidad no se sustituyen por cero o falso.
7. Firma completa, determinista y ordenada.
8. Errores transitorios clasificados y persistidos.
9. Outbox reconocido solo tras éxito total de la ejecución.
10. Fallo parcial conserva las refs restantes; el backoff puede ampliar a full reconcile.
11. Revisiones viejas se bloquean; queda pendiente el caso técnico `unverified`.
12. Caché con allowlists explícitas.
13. Campos públicos necesarios se conservan offline.
14. PII, credenciales y checkout arbitrario se excluyen.
15. Selector PRO implementado.
16. FREE hidden; PRO hidden/status/exact según feature y tracking.
17. Dos migraciones correctivas agregadas después de las tres originales.
18. Migraciones no aplicadas.
19. Pruebas enfocadas inspeccionadas, no ejecutadas en este entorno.
20. Pruebas SQL no ejecutadas; cobertura estática revisada.
21. Build, lint y test:ci pendientes.
22. Comparación estructural con `main`: rama ahead y behind 0; comparación ejecutable pendiente.
23. PR permanece draft.
24. Bloqueos: B1, B2 y validación ejecutable/manual.
