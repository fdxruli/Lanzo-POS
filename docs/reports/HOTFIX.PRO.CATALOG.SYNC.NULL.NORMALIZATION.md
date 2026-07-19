# HOTFIX PRO CATALOG SYNC — Normalización local de campos complejos

PR: #120 — `HOTFIX PRODUCTS/ECOM — recuperación y sincronización robusta del catálogo Pro`
Rama: `hotfix-pro-catalog-sync-recovery`
Base remota: `main`

## Evidencia y causa raíz

El incidente confirmado ocurría antes de invocar `pos_upsert_product_batch`: al agregar un lote de una cuenta Pro, `saveBatchAndSyncProduct` reconstruía el padre y ejecutaba `validateOrThrow(productSchema, updatedProduct, 'Sync Product Parent')`.

La traza mostraba un `ZodError` por `bulkData`, `conversionFactor` y `wholesaleTiers` en `null`. Supabase representa configuraciones opcionales inexistentes como SQL `NULL`; el mapper cloud-local las guardaba como `null` en IndexedDB, mientras que `optional()` de Zod acepta `undefined`, no `null`. El mismo riesgo existía en `batchManagement`, `recipe` y `modifiers`. El `DatabaseError` de validación era además reempaquetado como `DB_ERROR:UNKNOWN` por el `catch` de lotes.

## Implementación

- Se añadió `normalizeProductComplexFields`, una normalización no mutante que conserva propiedades desconocidas, IDs, stock, precio, costo, metadatos y estado de sincronización. Sus representaciones locales canónicas son:
  - `bulkData`, `conversionFactor`, `batchManagement`: objeto válido o `undefined`.
  - `recipe`, `modifiers`, `wholesaleTiers`: arreglo válido o `[]`.
- `cloudProductToLocal` aplica esa normalización tanto a snapshots completos como a respuestas parciales. Si un campo complejo no viene en la respuesta, conserva la configuración local existente; si viene explícitamente como `null`, se normaliza al valor canónico.
- `productSchema` hace preprocess defensivo de entradas legacy nullish/incorrectas y mantiene `.passthrough()` para que una futura ruta que use su resultado parseado no descarte los campos de sincronización ni configuraciones de rubro.
- `saveBatchAndSyncProduct` normaliza el padre legacy dentro de la transacción Dexie antes de calcular y validar la proyección. La escritura conserva los campos cloud/locales adicionales.
- El `catch` de lotes relanza un `DatabaseError` ya normalizado, conservando `VALIDATION_ERROR` y `details`; solo los errores Dexie/no normalizados pasan por `handleDexieError`.

No se borra IndexedDB, no se sustituye masivamente `NULL` en Supabase y no se modificó la migración SQL existente.

## Cobertura automatizada

Se agregaron pruebas para:

- `NULL` cloud en los seis campos complejos, valores válidos y respuestas parciales.
- Normalización de un producto legacy sin mutar el registro origen ni perder metadata o configuración de rubro.
- Guardar un lote sobre padre legacy: lote persistido, stock y `committedStock` proyectados, costo ponderado, precio soberano y estado de sincronización preservado.
- Error de validación real: conserva `DatabaseError`, `VALIDATION_ERROR` y detalles; el mock transaccional confirma rollback de lote y padre.

Completaron correctamente:

```text
npx vitest run src/services/__test__/products/productMapper.test.js src/services/products/__tests__/productLocalRepository.test.js src/services/products/__tests__/productCatalogSyncRecovery.test.js src/services/products/__tests__/productCatalogSyncDiagnostics.test.js src/services/db/__tests__/saveBatchAndSyncProduct.test.js --pool=forks --maxWorkers=1 --reporter=dot
# 5 archivos, 13 pruebas aprobadas
```

También completaron correctamente:

```text
npx eslint src/services/products/productMapper.js src/schemas/productSchema.js src/services/db/products.js src/services/__test__/products/productMapper.test.js src/services/db/__tests__/saveBatchAndSyncProduct.test.js
git diff --check
```

No terminaron y no se reportan como PASS: `npm run build`, `npm run lint` y `npm run test:ci`; cada uno excedió el límite de 60 segundos de este entorno sin producir un resultado final. Un intento inicial que combinaba prueba focalizada y lint también excedió ese límite. Un segundo intento de Vitest con la opción inexistente `--minWorkers` terminó con error de CLI y tampoco cuenta como PASS.

No existen suites separadas en el árbol actual con los nombres `productRepository`, `productMigrationService` o `productSyncHandler`; la cobertura de catálogo disponible se ejecutó mediante `productCatalogSyncRecovery` y `productCatalogSyncDiagnostics`.

## Estado de Supabase y Git

- No se ejecutó SQL de escritura ni diagnóstico contra Supabase.
- No se borraron productos, lotes, eventos, conflictos ni llaves idempotentes.
- No se modificó `main`: antes del cambio, el HEAD remoto de la rama era `c17717fd9da27f9e2c686f7e985c09e541fad4da`, `origin/main` era `38b1eb964db50b9a9100f565382b00f132309033` y el merge-base coincidía con `origin/main`. El reflog local de `main` solo muestra actualizaciones por `pull`.

## Matriz manual pendiente

1. Dispositivo Pro afectado, sin borrar IndexedDB: agregar lote al producto con los tres `null` confirmados y comprobar que desaparece el ZodError.
2. Confirmar `pos_upsert_product_batch`, la fila remota `pos_product_batches` y la proyección del padre.
3. Desde un segundo dispositivo Pro, descargar el lote y el stock; editar y archivar el lote.
4. En Pro offline, guardar pending y comprobar que la reconexión procesa el outbox sin duplicar lote ni stock.
5. Confirmar que Free conserva el guardado local `LOCAL` y no realiza llamadas cloud.
6. Verificar que productos restaurant, apparel, farmacia y retail conservan su configuración.

## Riesgo residual

La corrección hace canónica la representación local y no modifica datos remotos. La matriz anterior sigue siendo necesaria para comprobar la RPC, el outbox real y la interoperabilidad entre dispositivos contra el entorno Supabase.
