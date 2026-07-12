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
- El HEAD final exacto se registra en la descripción del PR y en la entrega final.
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

El frontend ya producía una proyección técnica correcta, pero la decisión general la trataba como conflicto cuando la fila tenía revisión e hash previos. La migración nueva:

```text
supabase/migrations/20260712210300_ecom_fe_catalog_3_2_source_missing.sql
```

marca la ausencia como:

```text
source-missing:<sha256>
```

y aplica estas reglas:

- revisión comparable anterior: `stale`;
- revisión comparable igual o posterior: `apply`;
- revisión opaca igual: `apply`;
- revisión opaca distinta: `conflict`;
- revisión entrante nula contra una revisión comparable almacenada: `apply`, porque el cliente actual no dispone de tombstone local;
- repetición idéntica del estado: `idempotent`.

Una lectura confirmada posterior puede restaurar un producto desde `source_missing` con la misma revisión o una superior. Una revisión menor continúa siendo `stale`.

Cuando la ausencia es válida, la publicación se conserva con:

```text
source_state = source_missing
source_available = false
is_available = false
sync_status = review
sync_error_code = SOURCE_MISSING
```

El guard server-side conserva nombre, descripción, categoría, precio, imagen, último stock confirmado y última revisión comparable cuando el tombstone no trae revisión. El stock histórico no se expone: el contrato público oculta cantidad para cualquier estado distinto de `in_stock` y `out_of_stock`.

## 2. Etiquetas de stock contradictorias

`getPublicProductStockLabel(product)` ahora prioriza:

```js
if (product?.isAvailable === false) {
  return 'No disponible';
}
```

Por tanto:

- deshabilitado + `status available`: `No disponible`;
- deshabilitado + cantidad positiva: `No disponible`;
- disponible + falta real de stock: `Agotado`;
- disponible + cantidad positiva: `X disponibles`.

`PublicCatalog.jsx` aplica la clase `is-unavailable` tanto a `Agotado` como a `No disponible`.

## Pruebas enfocadas

### JavaScript

Se actualizaron los casos de `ecommercePublicProductRules.test.js` y se ejecutó:

- `node --check` de la regla: **PASS**;
- `node --check` de la prueba: **PASS**;
- ejecución directa con `node:assert/strict` de los cuatro escenarios: **PASS**;
- parseo JSX de `PublicCatalog.jsx`: **PASS**;
- `git diff --check` sobre la reproducción exacta de los archivos JS/JSX modificados: **PASS**.

Vitest no se ejecutó porque el entorno no dispone del checkout íntegro ni de dependencias instaladas.

### SQL

Se agregó:

```text
supabase/tests/ecom_fe_catalog_3_2_source_missing.sql
```

La prueba transaccional cubre la fila confirmada `version:10`, transición a `source_missing`, preservación de publicación y campos visuales, indisponibilidad efectiva, conservación de stock histórico, ocultamiento de cantidad pública, rechazo de `version:9` como `stale` y recuperación posterior con revisión válida.

La prueba está envuelta en `begin`/`rollback`. No fue ejecutada porque el entorno no dispone de PostgreSQL, Supabase CLI ni una base local/transaccional. No se ejecutó SQL remoto.

## Validaciones globales pendientes

No se declara validación global PASS. Continúan pendientes:

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

## Migraciones pendientes de aplicar

1. `20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
2. `20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
3. `20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`
4. `20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
5. `20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`
6. `20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql`
7. `20260712210300_ecom_fe_catalog_3_2_source_missing.sql`

**Ninguna migración fue aplicada.**

No se ejecutó `supabase db push`, `supabase migration repair` ni SQL de escritura remoto.

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
