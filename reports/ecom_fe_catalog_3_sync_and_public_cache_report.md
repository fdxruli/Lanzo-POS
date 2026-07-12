# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**Corrección mínima final implementada. Migraciones y validación global pendientes.**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Base y merge-base: `main` en `66315c445836bbf662224671c14524994acd0f13`
- HEAD previo a la corrección mínima: `b6a54e3d70100f7bb363cff4d473865239cc4049`
- HEAD final de código: `2c750d7db2671e9eccb9f8ca4f2b9269aa8df9f7`
- Estado del PR: **draft**
- Merge: no realizado

## Corrección mínima de etiqueta pública

Se corrigió la prioridad de `getPublicProductStockLabel(product)`:

1. Un agotamiento confirmado por `stock.status = out_of_stock` o cantidad exacta `0` muestra `Agotado`, aunque `isAvailable` sea `false` como resultado de la disponibilidad efectiva.
2. Un producto deshabilitado manualmente, pero con inventario positivo confirmado, muestra `No disponible`.
3. El stock oculto continúa sin exponer etiquetas o cantidades.

Casos cubiertos:

```text
manual unavailable + status available => No disponible
manual unavailable + exact quantity 5 => No disponible
isAvailable false + status out_of_stock => Agotado
isAvailable false + exact out_of_stock quantity 0 => Agotado
isAvailable true + exact quantity 5 => 5 disponibles
```

Archivos modificados:

- `src/services/ecommerce/ecommercePublicProductRules.js`
- `src/services/ecommerce/__tests__/ecommercePublicProductRules.test.js`

Commits:

- `ac6b0f78f97c98a4bb0f2c59a9216582c7ecaf37`
- `2c750d7db2671e9eccb9f8ca4f2b9269aa8df9f7`

## Validación enfocada

Se ejecutó una validación directa con Node sobre los casos anteriores:

```text
focused label validation: PASS
```

No se declara validación global PASS. Continúan pendientes:

```text
npm ci
Vitest real
npm run build
npm run lint
npm run test:ci
git diff --check sobre checkout íntegro
pruebas SQL locales/transaccionales
pruebas manuales
```

## Estado de Supabase producción

Proyecto revisado:

```text
odlrhijtfyavryeqivaa
```

La inspección confirmó que el esquema de `ECOM.FE.CATALOG.3` todavía no está desplegado:

- `sync_config`: ausente;
- `source_revision_kind`: ausente;
- `ecommerce_admin_sync_published_catalog(...)`: ausente;
- `private.ecommerce_source_revision_decision(...)`: ausente.

Por lo tanto, las migraciones del PR sí son necesarias para habilitar la fase.

Se verificó la vía de despliegue mediante el conector de Supabase. `apply_migration` registró la primera migración con un timestamp generado distinto al timestamp del archivo del repositorio. Continuar por esa vía habría desalineado `supabase_migrations.schema_migrations` y futuros `supabase db push`.

El intento fue revertido completamente:

- se eliminó la tabla temporal de staging;
- se eliminó el snapshot temporal de disponibilidad;
- se eliminó la entrada de historial generada por el intento;
- se confirmó que `sync_config` sigue ausente;
- no quedó ninguna parte de `CATALOG.3` aplicada.

Verificación posterior:

```text
staging_removed = true
legacy_snapshot_removed = true
migration_history_restored = true
catalog3_not_partially_applied = true
```

Producción quedó en el mismo estado previo al intento. No se ejecutó `supabase db push` ni `supabase migration repair`.

## Migraciones pendientes

Deben desplegarse desde un checkout autenticado del repositorio mediante el flujo normal de Supabase, conservando sus timestamps originales:

```text
20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql
20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql
20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql
20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql
20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql
20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql
20260712210300_ecom_fe_catalog_3_2_source_missing.sql
```

Flujo requerido antes del merge:

```text
supabase migration list
supabase db push
supabase migration list
```

Después debe comprobarse la presencia de las columnas, RPC y helpers, y ejecutar las pruebas SQL transaccionales de la fase.

## Estado para merge

```text
Corrección mínima frontend: PASS enfocado
source_missing: corregido por revisión estática
Supabase producción: limpio, sin aplicación parcial
Migraciones: pendientes
PR: draft
Merge: no realizado
```

No debe mergearse el PR hasta desplegar o validar correctamente las migraciones con sus timestamps originales y completar la validación necesaria.
