# ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público

## Estado

**BLOQUEANTES RESIDUALES ECOM.FE.CATALOG.3.1 CORREGIDOS / VALIDACIÓN EJECUTABLE PENDIENTE**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-3`
- PR: `#93 — FASE ECOM.FE.CATALOG.3 — Sincronización automática y caché del catálogo público`
- Estado del PR: **draft**
- Base y merge-base: `main` en `66315c445836bbf662224671c14524994acd0f13`
- HEAD histórico previo a la serie ECOM.FE.CATALOG.3.1: `6b32df3f02aaa092f004c0a9906f1be794e5fab1`
- HEAD inicial de la revisión que detectó los bloqueantes: `12ec335b6ea5a0ab87f411a41c56b9f859636334`
- HEAD inicial de esta corrección residual: `5b2ad1e2512cbc02d7d6391b5fd6d463977932fb`
- HEAD funcional previo a esta actualización documental: `25730f79a3b9896dfee775c681fcea3c0f871646`
- Merge automático: **no realizado**

La implementación funcional de los dos bloqueantes residuales quedó incorporada. El PR debe permanecer en draft porque todavía faltan la instalación íntegra, las pruebas ejecutables completas, las pruebas SQL en una base local o transaccional y las pruebas manuales.

## Archivos modificados por la corrección residual

- `src/services/ecommerce/ecommerceCatalogSyncServiceBase.js`
- `src/services/ecommerce/ecommerceCatalogSyncService.js`
- `src/services/ecommerce/__tests__/ecommerceCatalogSyncService.retryOutbox.test.js`
- `supabase/migrations/20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql`
- `supabase/tests/ecom_fe_catalog_3_1_residual_blockers.sql`
- `reports/ecom_fe_catalog_3_sync_and_public_cache_report.md`

La implementación original del servicio se conservó sin cambios funcionales en `ecommerceCatalogSyncServiceBase.js`. El punto de importación público continúa siendo `ecommerceCatalogSyncService.js`, que ahora aplica la política segura de reintento antes de crear el servicio.

## Bloqueante B1 — `unverified` interceptado como conflicto

### Defecto

La RPC calculaba el hash completo y ejecutaba `private.ecommerce_source_revision_decision(...)` antes de aplicar su rama especial de preservación para `sourceState = 'unverified'`.

Una fila confirmada seguida por la misma revisión con una proyección técnica `unverified` podía producir:

```text
misma revisión + hash diferente = conflict
```

La función terminaba el producto mediante `continue` antes de registrar `SOURCE_UNVERIFIED`.

### Corrección

La migración correctiva:

```text
20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql
```

introduce dos defensas complementarias.

#### 1. Hash técnico explícito

`private.ecommerce_projection_payload_hash(...)` marca las proyecciones `unverified` con el prefijo:

```text
unverified:<sha256>
```

La llave idempotente del lote no cambia: la RPC continúa calculando el hash de solicitud sobre el JSONB completo antes de procesar cada producto.

#### 2. Decisión de revisión fail-closed

`private.ecommerce_source_revision_decision(...)` aplica estas reglas para un hash técnico `unverified`:

- revisión comparable inferior: `stale`;
- revisión comparable igual: `apply` únicamente para registrar el estado técnico;
- revisión comparable superior: `apply`;
- revisión opaca idéntica: `apply`;
- revisión opaca distinta: `conflict`;
- producto sin revisión confirmada previa: `apply`.

No se debilita la protección cross-device para proyecciones normales.

#### 3. Guard de preservación completa

Se endureció `private.ecommerce_published_product_sync_guard()` para que una actualización `unverified` sobre una fila existente conserve:

- `public_name`;
- `public_description`;
- `category_name`;
- `price`;
- `image_url`;
- `source_available`;
- `stock_snapshot`;
- `stock_updated_at`;
- `source_revision`;
- `source_revision_kind`;
- `source_revision_order`;
- `source_payload_hash`.

La RPC puede registrar:

```text
source_state = unverified
sync_status = review
sync_error_code = SOURCE_UNVERIFIED
```

sin restaurar campos antiguos ni perder el último snapshot confirmado. El cambio a estado no verificado puede ocultar el stock público y aumentar la revisión del catálogo cuando cambia la proyección pública efectiva, pero no inventa stock cero.

## Bloqueante B2 — backoff ampliaba un fallo parcial

### Defecto

Después de que `replacePending` guardaba únicamente las referencias no confirmadas, el callback interno del backoff ejecutaba `scheduleSync()` sin IDs. La implementación base interpreta una lista vacía como reconciliación completa.

Por tanto, el siguiente intento podía reenviar productos ya confirmados.

### Corrección

El servicio público ahora envuelve las operaciones de persistencia reintentable:

```text
enqueue
replacePending
```

Cuando la persistencia termina correctamente, el timer del backoff no llama al callback base que genera una reconciliación completa. En su lugar agenda una solicitud interna con un marcador que no corresponde a ningún producto real:

```text
productIds: [__lanzo_catalog_outbox_retry__]
fullReconcile: false
```

`executeOnce` combina esa solicitud con las referencias reales leídas del outbox. El marcador no genera proyección y únicamente se procesan los productos pendientes.

Si la escritura del outbox falla, se conserva una ruta de recuperación mediante reconciliación completa, porque en ese caso no existe una lista persistida confiable que pueda drenarse.

Los reintentos deliberadamente completos por inicio del runtime, evento `online`, visibilidad o acción manual no cambian.

## Pruebas agregadas

### JavaScript

`ecommerceCatalogSyncService.retryOutbox.test.js` cubre el flujo completo:

1. 201 productos generan dos chunks;
2. el primer chunk termina correctamente;
3. el segundo devuelve HTTP/PostgREST 503;
4. `replacePending` conserva únicamente `product-200`;
5. se ejecuta realmente el callback del backoff;
6. el tercer envío contiene exactamente una proyección;
7. el outbox se reconoce después del éxito.

Esta prueba cubre la parte que la prueba anterior no ejecutaba: el alcance real del siguiente intento automático.

### SQL

`ecom_fe_catalog_3_1_residual_blockers.sql` valida:

- payload confirmado sin marcador técnico;
- payload `unverified` con marcador técnico;
- revisión `10 → 10 unverified`: `apply`, no conflicto;
- revisión `10 → 9 unverified`: `stale`;
- revisión `10 → 11 unverified`: `apply`;
- revisión opaca igual: `apply`;
- revisión opaca distinta: `conflict`;
- la RPC continúa usando los helpers de hash y revisión;
- la RPC conserva disponibilidad, stock, revisión y hash;
- el trigger conserva también nombre, descripción, categoría, precio e imagen.

La prueba está envuelta en `begin`/`rollback` y debe ejecutarse únicamente en una base local o transaccional segura.

## Validación realizada en esta intervención

- Estado real del PR confirmado: abierto, draft y no mergeado.
- Rama confirmada basada en `main`, `behind_by: 0` antes de modificar.
- Revisión estática de los archivos modificados.
- `node --check` del wrapper `ecommerceCatalogSyncService.js`: **PASS**.
- `node --check` de `ecommerceCatalogSyncService.retryOutbox.test.js`: **PASS**.
- Secuencia y delimitadores de las nuevas funciones SQL revisados estáticamente.

No se pudo obtener un checkout íntegro del repositorio desde el entorno disponible, por lo que siguen pendientes:

```text
npm ci
ESLint enfocado
Vitest enfocado
npm run build
npm run lint
npm run test:ci
git diff --check
git status --short
pruebas SQL locales/transaccionales
comparación ejecutable contra main
pruebas manuales
```

## Migraciones finales pendientes de aplicar

1. `20260712192900_ecom_fe_catalog_3_legacy_availability_snapshot.sql`
2. `20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql`
3. `20260712193100_ecom_fe_catalog_3_backfill_and_trigger_fix.sql`
4. `20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql`
5. `20260712210100_ecom_fe_catalog_3_1_sync_rpc.sql`
6. `20260712210200_ecom_fe_catalog_3_1_residual_blockers.sql`

**Ninguna migración fue aplicada.**

No se ejecutó:

```text
supabase db push
supabase migration repair
SQL de escritura remoto
```

No se modificaron tablas, funciones, datos, permisos ni configuraciones de Supabase producción.

## Estado final requerido

- PR: abierto.
- Draft: sí.
- Ready for review: no, hasta completar todas las validaciones.
- Merge: no realizado.
- `main`: no modificado directamente.
- Supabase producción: no modificado.
- Migraciones aplicadas: ninguna.
- Workflows temporales: ninguno.
- Preview manual de Vercel: no creado ni validado.
- Flujo de cobro ecommerce: no modificado.
