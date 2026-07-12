# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**Correcciones implementadas y migraciones aplicadas. Validación global y pruebas manuales pendientes.**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Base y merge-base: `main` en `66315c445836bbf662224671c14524994acd0f13`
- HEAD previo al despliegue: `ea92f911215795764fae8b7bd6b902d3637d64ac`
- Estado del PR: **draft**
- Merge: no realizado

## Corrección mínima de etiqueta pública

Se corrigió la prioridad de `getPublicProductStockLabel(product)`:

1. Un agotamiento confirmado por `stock.status = out_of_stock` o cantidad exacta `0` muestra `Agotado`, aunque `isAvailable` sea `false`.
2. Un producto deshabilitado manualmente con inventario positivo muestra `No disponible`.
3. El stock oculto continúa sin exponer etiquetas o cantidades.

Casos cubiertos:

```text
manual unavailable + status available => No disponible
manual unavailable + exact quantity 5 => No disponible
isAvailable false + status out_of_stock => Agotado
isAvailable false + exact out_of_stock quantity 0 => Agotado
isAvailable true + exact quantity 5 => 5 disponibles
```

Commits funcionales:

```text
ac6b0f78f97c98a4bb0f2c59a9216582c7ecaf37
2c750d7db2671e9eccb9f8ca4f2b9269aa8df9f7
```

Validación enfocada de la regla: **PASS**.

## Despliegue de Supabase

Proyecto:

```text
odlrhijtfyavryeqivaa
```

La primera migración se ejecutó y registró en una transacción individual. Después, los siete archivos se descargaron directamente desde la rama del PR y se verificaron contra su SHA Git; la primera versión ya registrada se omitió de forma idempotente y las seis migraciones restantes se ejecutaron en orden dentro de una única transacción.

Cada entrada de `supabase_migrations.schema_migrations` se registró solamente después de ejecutar correctamente su archivo y conserva el timestamp original del repositorio.

Versiones aplicadas:

```text
20260712192900 ecom_fe_catalog_3_legacy_availability_snapshot
20260712193000 ecom_fe_catalog_3_sync_and_public_cache
20260712193100 ecom_fe_catalog_3_backfill_and_trigger_fix
20260712210000 ecom_fe_catalog_3_1_source_revision_schema
20260712210100 ecom_fe_catalog_3_1_sync_rpc
20260712210200 ecom_fe_catalog_3_1_residual_blockers
20260712210300 ecom_fe_catalog_3_2_source_missing
```

No se utilizó `supabase migration repair`. No se dejó una versión generada distinta a los archivos del repositorio.

La extensión HTTP utilizada temporalmente para descargar los archivos fue eliminada antes de confirmar la transacción. También se eliminaron las tablas temporales de staging y el snapshot transitorio de disponibilidad fue eliminado por la propia cadena de migraciones.

## Verificación posterior

Resultado:

```text
catalog_revision_exists = true
sync_config_exists = true
source_revision_kind_exists = true
source_payload_hash_exists = true
sync_rpc_exists = true
revision_decision_exists = true
versioned_catalog_exists = true
legacy_snapshot_removed = true
temporary_http_removed = true
migration_versions_recorded = 7/7
```

Permisos comprobados:

```text
anon no tiene SELECT directo sobre ecommerce_portals
authenticated no tiene SELECT directo sobre ecommerce_published_products
anon puede ejecutar las RPC públicas del portal y catálogo
anon puede llamar la RPC administrativa, que conserva la autorización interna propia
anon no puede ejecutar private.ecommerce_source_revision_decision(...)
```

## Prueba transaccional enfocada

Se ejecutó una prueba reversible sobre una publicación existente y se hizo `ROLLBACK` al finalizar.

La prueba confirmó que `source_missing`:

- conserva nombre, descripción, categoría, precio e imagen;
- conserva el último stock confirmado como dato histórico;
- establece `source_available = false`;
- establece `is_available = false`;
- conserva `sync_status = review` y `sync_error_code = SOURCE_MISSING`;
- devuelve stock público en modo `hidden`;
- rechaza una revisión comparable anterior como `stale`;
- permite la ausencia actual sin revisión de tombstone como actualización técnica.

Resultado: **PASS**.

## Validación pendiente

No se declara validación global PASS. Continúan pendientes:

```text
npm ci
Vitest real
npm run build
npm run lint
npm run test:ci
git diff --check sobre checkout íntegro
pruebas manuales de sincronización PRO y caché público
```

El check automático del HEAD `41a82fce5b8e942bf5717d6d106b1a5c95e94708` terminó en **success**. Los commits exclusivamente documentales posteriores pueden aparecer con `failure` por `build-rate-limit`. No se realizó validación manual, promoción ni manipulación de previews.

## Estado para merge

```text
Corrección mínima frontend: PASS enfocado
source_missing: PASS transaccional
Migraciones Supabase: 7/7 aplicadas
Historial remoto: alineado con los timestamps del repositorio
PR: draft
Merge: no realizado
Validación global/manual: pendiente
```

El PR debe permanecer en draft hasta completar la validación global o hasta que se decida explícitamente aceptar las validaciones pendientes.