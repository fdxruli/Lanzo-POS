# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**CORRECCIONES ECOM.FE.CATALOG.3.2 IMPLEMENTADAS / VALIDACIÓN GLOBAL PENDIENTE**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Estado del PR: **draft**
- Base y merge-base confirmados: `main` en `66315c445836bbf662224671c14524994acd0f13`
- HEAD inicial real de ECOM.FE.CATALOG.3.2: `af0f9977527b0bffeb11bc08cffb5cb044c8b7ae`
- HEAD funcional de ECOM.FE.CATALOG.3.2: `521cf646c3aae2ea600d5475836de2b041fda9a0`
- El HEAD final exacto queda registrado en la descripción del PR y en la entrega final, porque el commit que contiene este reporte pasa a ser el nuevo HEAD.
- Merge automático: **no realizado**

La corrección se limitó a los dos defectos residuales solicitados: transición segura a `source_missing` y prioridad de la disponibilidad efectiva sobre las etiquetas de inventario. Las correcciones anteriores de ECOM.FE.CATALOG.3.1 permanecen sin debilitarse.

## Archivos modificados por ECOM.FE.CATALOG.3.2

- `src/services/ecommerce/ecommercePublicProductRules.js`
- `src/services/ecommerce/__tests__/ecommercePublicProductRules.test.js`
- `src/components/ecommerce/public/PublicCatalog.jsx`
- `supabase/migrations/20260712210300_ecom_fe_catalog_3_2_source_missing.sql`
- `supabase/tests/ecom_fe_catalog_3_2_source_missing.sql`
- `reports/ecom_fe_catalog_3_sync_and_public_cache_report.md`

## 1. `source_missing` después de una sincronización previa

### Defecto

El frontend ya producía correctamente:

```json
{
  "sourceRevision": null,
  "sourceState": "source_missing",
  "sourceAvailable": false,
  "stockSnapshot": null,
  "fields": {}
}
```

Sin embargo, una fila previamente sincronizada conservaba revisión y hash confirmados. La decisión general interpretaba la revisión entrante nula y el nuevo payload como conflicto, por lo que la RPC terminaba el producto antes de aplicar:

```text
source_state = source_missing
source_available = false
is_available = false
```

El producto eliminado del origen podía continuar disponible públicamente.

### Migración correctiva

Se agregó, sin aplicarla:

```text
supabase/migrations/20260712210300_ecom_fe_catalog_3_2_source_missing.sql
```

La migración identifica la ausencia confirmada mediante:

```text
source-missing:<sha256>
```

La marca técnica no sustituye la idempotencia del lote. Solamente permite distinguir `source_missing` de una actualización normal de campos públicos.

### Reglas de concurrencia

Para una proyección `source_missing`:

- revisión comparable anterior: `stale`;
- revisión comparable igual: `apply` o `idempotent` si ya se aplicó el mismo estado;
- revisión comparable posterior: `apply`;
- revisión opaca igual: `apply` o `idempotent`;
- revisión opaca distinta: `conflict`;
- revisión entrante nula contra una revisión comparable almacenada: `apply`, porque el cliente actual no posee tombstone local pero la ausencia proviene de una lectura exitosa;
- ausencia sin historial previo: `apply`.

Una revisión explícitamente anterior nunca puede aplicar la ausencia.

La función también permite que una lectura confirmada posterior restaure un producto que estaba en `source_missing` cuando usa la misma revisión o una superior. Una revisión menor continúa siendo `stale`.

### Estado aplicado

Cuando la decisión es válida, la fila publicada se conserva y queda:

```text
source_state = source_missing
source_available = false
is_available = false
sync_status = review
sync_error_code = SOURCE_MISSING
```

No se elimina ni despublica el producto.

### Conservación de campos públicos

El guard server-side impide que `source_missing` modifique:

- nombre;
- descripción;
- categoría;
- precio;
- imagen.

También conserva internamente:

- último `stock_snapshot` confirmado;
- `stock_updated_at`;
- última revisión comparable, cuando la ausencia entrante no incluye revisión.

El hash almacenado sí cambia a la marca técnica `source-missing:` para que la concurrencia reconozca el estado y permita una recuperación posterior.

El contrato público ya oculta el stock para estados distintos de `in_stock` y `out_of_stock`. Por tanto, el snapshot histórico no publica cantidad ni inventa cero.

## 2. Etiquetas de stock contradictorias

### Defecto

`isPublicProductAvailable(product)` ya daba prioridad a:

```js
product.isAvailable === false
```

pero `getPublicProductStockLabel(product)` evaluaba primero `stock.mode` y `stock.status`. Esto permitía mostrar simultáneamente:

```text
Disponible / No disponible
5 disponibles / No disponible
```

### Corrección

`getPublicProductStockLabel(product)` ahora comienza con:

```js
if (product?.isAvailable === false) {
  return 'No disponible';
}
```

Consecuencias:

- deshabilitado manualmente + stock disponible: `No disponible`;
- deshabilitado manualmente + cantidad positiva: `No disponible`;
- disponible + falta real de stock: `Agotado`;
- disponible + cantidad positiva: `X disponibles`.

`PublicCatalog.jsx` aplica la clase visual `is-unavailable` tanto a `Agotado` como a `No disponible`. El botón continúa mostrando `No disponible` y permanece deshabilitado.

## Pruebas enfocadas

### JavaScript

Se actualizó:

```text
src/services/ecommerce/__tests__/ecommercePublicProductRules.test.js
```

Casos agregados:

```text
isAvailable false + status available => No disponible
isAvailable false + exact quantity 5 => No disponible
isAvailable true + status out_of_stock => Agotado
isAvailable true + exact quantity 5 => 5 disponibles
```

Validación ejecutada en el entorno disponible:

- `node --check` de `ecommercePublicProductRules.js`: **PASS**;
- `node --check` de la prueba enfocada: **PASS**;
- ejecución directa con `node:assert/strict` de los cuatro casos: **PASS**;
- parseo JSX de `PublicCatalog.jsx` mediante el parser TypeScript: **PASS**;
- `git diff --check` sobre la reproducción exacta de los archivos JS/JSX modificados: **PASS**.

No se ejecutó Vitest porque el entorno no dispone del checkout íntegro ni de sus dependencias instaladas.

### SQL

Se agregó:

```text
supabase/tests/ecom_fe_catalog_3_2_source_missing.sql
```

La prueba transaccional cubre:

1. fila confirmada en `version:10`, disponible y con stock 5;
2. payload `source_missing` con revisión nula;
3. payload `source_missing` con revisión igual;
4. payload con revisión anterior `version:9`, esperado `stale`;
5. conservación física de la fila publicada;
6. conservación de nombre, descripción, categoría, precio e imagen;
7. `source_available = false` e `is_available = false`;
8. `sync_status = review` y `sync_error_code = SOURCE_MISSING`;
9. conservación interna del stock 5 y de la revisión 10;
10. ocultamiento de cantidad en el contrato público;
11. recuperación posterior mediante una proyección confirmada con revisión válida.

La prueba está envuelta en `begin`/`rollback`.

No fue ejecutada en esta intervención porque el entorno no dispone de PostgreSQL, Supabase CLI ni una base local/transaccional. No se ejecutó SQL remoto.

## Validaciones globales pendientes

No se declara validación global PASS. Continúan pendientes para la fase posterior:

```text
npm ci
Vitest real enfocado y global
ESLint enfocado y global
npm run build
npm run lint
npm run test:ci
git diff --check sobre checkout íntegro
git status --short
pruebas SQL locales/transaccionales
pruebas manuales
```

No se ejecutaron `npm run build`, `npm run lint` ni `npm run test:ci` en esta corrección puntual.

## Migraciones pendientes de aplicar

1. `20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
2. `20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
3. `20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`
4. `20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
5. `20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`
6. `20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql`
7. `20260712210300_ecom_fe_catalog_3_2_source_missing.sql`

**Ninguna migración fue aplicada.**

No se ejecutó:

```text
supabase db push
supabase migration repair
SQL de escritura remoto
```

## Estado final requerido

- PR: abierto.
- Draft: sí.
- Ready for review: no.
- Merge: no realizado.
- `main`: no modificado directamente.
- Supabase producción: no modificado.
- Migraciones aplicadas: ninguna.
- Workflows temporales: ninguno.
- Preview manual de Vercel: no creado ni validado.
- Flujo de cobro ecommerce: no modificado.
