# FASE ECOM.PRODUCTS.MODEL.1

Fecha original: 2026-07-15 (America/Mexico_City)  
Corrección: 2026-07-15 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-model-1`  
PR: `#98 — FASE ECOM.PRODUCTS.MODEL.1 — Productos configurables y stock por receta`  
Estado: **ECOM.PRODUCTS.MODEL.1.1 IMPLEMENTADA — VALIDACIÓN LOCAL NODE PENDIENTE — PR DRAFT**

---

# PARTE I — HISTORIAL DE ECOM.PRODUCTS.MODEL.1

## 1. Objetivo original

La fase creó la base técnica y de datos para representar en ecommerce:

- productos simples;
- productos fabricados mediante receta;
- familias de variantes vinculadas a SKU reales;
- productos con grupos y opciones;
- opciones que pueden consumir ingredientes;
- disponibilidad derivada por receta e ingrediente limitante.

No inició `ECOM.PRODUCTS.PUBLIC.1`. Por tanto, no añadió selector público, `variantId`, `optionIds`, cobro de extras, descuento de ingredientes por opción ni conversión POS de configuraciones.

## 2. Modelo original

Tipos canónicos:

- `simple`
- `recipe`
- `variant_parent`
- `configurable`

Flags:

- `hasRecipe`
- `hasVariants`
- `hasOptionGroups`
- `requiresConfiguration`
- `tracksDerivedStock`

La autoridad de inventario continúa en `pos_products` y `pos_product_batches`; ecommerce no crea inventario paralelo.

## 3. Recetas

La fase original sustituyó la clasificación automática `recipe -> UNVERIFIED` por un evaluador que:

1. resuelve ingredientes;
2. descuenta stock comprometido;
3. respeta lotes activos y caducidad;
4. convierte `kg/g` y `lt/ml`;
5. calcula `floor(disponible / consumo)`;
6. toma el mínimo como capacidad vendible;
7. identifica el ingrediente limitante;
8. no modifica inventario.

Estados soportados:

- `in_stock`
- `out_of_stock`
- `unverified`
- `not_tracked`
- `inactive_source`
- `source_missing`

## 4. Tablas normalizadas originales

- `public.ecommerce_published_product_variants`
- `public.ecommerce_published_option_groups`
- `public.ecommerce_published_options`

Las tablas tienen RLS, soft delete, aislamiento por licencia, constraints y referencias a productos o ingredientes reales.

## 5. Contrato público original

El catálogo público sólo añade un resumen seguro:

```json
{
  "configuration": {
    "type": "simple",
    "version": 1,
    "hasVariants": false,
    "hasOptionGroups": false,
    "requiresConfiguration": false
  }
}
```

No expone IDs de ingredientes, costos, licencia, staff, dispositivos ni tokens.

## 6. Migraciones originales aplicadas e inmutables

| Archivo local | Historial remoto | Nombre remoto |
|---|---:|---|
| `20260715190000_ecom_products_model_1.sql` | `20260715190958` | `ecom_products_model_1` |
| `20260715193000_ecom_products_model_1_child_guard_fix.sql` | `20260715191822` | `ecom_products_model_1_child_guard_fix` |
| `20260715194500_ecom_products_model_1_option_soft_delete_fix.sql` | `20260715192025` | `ecom_products_model_1_option_soft_delete_fix` |
| `20260715195500_ecom_products_model_1_fk_indexes.sql` | `20260715192456` | `ecom_products_model_1_fk_indexes` |

Estas migraciones no fueron editadas, renombradas, reaplicadas ni reparadas durante la corrección.

## 7. Validación original

La matriz original `supabase/tests/ecom_products_model_1_test.sql` había pasado 30/30 casos con `BEGIN/ROLLBACK` y cero residuos.

---

# PARTE II — ECOM.PRODUCTS.MODEL.1.1

## 8. Motivo de la corrección

La revisión independiente del PR #98 confirmó tres bloqueantes:

1. `requires_configuration` contaminaba `source_available` y podía bloquear un producto de forma irreversible.
2. La RPC de configuración existía, pero los flujos productivos no la consumían.
3. El normalizador JavaScript generaba objetos internos incompatibles con la allowlist SQL.

Esta sección es aditiva y conserva el historial de los defectos; no presenta la implementación original como si hubiera estado completa.

## 9. Estado Git verificado antes de modificar

- HEAD remoto inicial de la rama: `a82aa04d3667faf74d685a808569ce050cdf9e9c`
- HEAD de `main`: `68e3b6ee7764b98c96cbfdccf928122c8ed573eb`
- merge-base: `68e3b6ee7764b98c96cbfdccf928122c8ed573eb`
- PR #98: abierto, draft, no fusionado.
- Las cuatro migraciones originales estaban presentes en Supabase.

HEAD final del código corregido antes del commit documental de este reporte: el HEAD indicado por la comparación final del PR. El commit que actualiza este documento no modifica producto ni SQL.

## 10. Preauditoría de datos

Antes de cualquier backfill se encontró:

- productos con `requires_configuration=true`: 0;
- productos con `availability_reason_code='CONFIGURATION_REQUIRED'`: 0;
- productos con hijos configurables activos: 0;
- productos con `source_available=false`: 2.

Decisión: **no realizar backfill**. Las dos indisponibilidades existentes se conservaron fail-closed y no se inventó disponibilidad.

## 11. Bloqueante 1 — causa raíz

La RPC original escribía:

```text
requires_configuration = true
source_available = false
is_available = false
```

Además, `private.ecommerce_published_product_sync_guard()` recalculaba:

```text
is_available = manual_available AND source_available
```

Por ello, al retirar variantes o grupos obligatorios, el producto podía volver a `simple` conservando `source_available=false`.

## 12. Contrato final de disponibilidad

Las dimensiones quedan separadas:

```text
manual_available
source_available
requires_configuration
```

Disponibilidad efectiva:

```text
is_available =
  manual_available
  AND source_available
  AND NOT requires_configuration
```

Reglas finales:

- `requires_configuration` nunca cambia por sí solo `source_available`;
- retirar configuración reactiva un producto cuya disponibilidad manual y de fuente siguen siendo verdaderas;
- `source_available=false` nunca se convierte automáticamente en `true`;
- `manual_available=false` continúa bloqueando;
- una fuente ausente, inactiva o agotada continúa bloqueando;
- escrituras legacy que sólo cambian `is_available` siguen actualizando la dimensión manual.

## 13. Bloqueante 2 — causa raíz

Existían:

- `public.ecommerce_admin_sync_product_configuration(...)`;
- `syncProductConfiguration(...)`.

No existían consumidores productivos en:

- publicación manual;
- `EcommerceProductPublishModal`;
- sincronización automática PRO;
- servicio de catálogo cloud.

Las tablas y la API podían existir sin recibir variantes, grupos u opciones desde el flujo normal.

## 14. Implementación canónica SQL

Se creó un único escritor privado:

```text
private.ecommerce_apply_product_configuration(...)
```

Responsabilidades:

- validar allowlists;
- validar límites;
- validar licencia y fuentes;
- insertar o actualizar variantes;
- insertar o actualizar grupos;
- insertar o actualizar opciones;
- retirar hijos omitidos sólo dentro del producto;
- calcular flags de configuración;
- calcular `requires_configuration`;
- conservar `source_available`;
- mantener atomicidad.

Se añadió un guard de revisión:

```text
private.ecommerce_apply_product_configuration_checked(...)
```

Este helper reutiliza `sourceRevision` como revisión privada de configuración, sin sustituir la revisión confirmada del snapshot de catálogo o inventario.

## 15. Publicación manual

Se añadió:

```text
public.ecommerce_admin_upsert_published_product_v2(...)
```

Flujo:

1. realiza el upsert administrativo heredado;
2. obtiene el producto publicado correcto;
3. invoca el escritor canónico;
4. devuelve producto y configuración;
5. si la configuración falla, la operación PostgreSQL completa se revierte.

`EcommerceProductPublishModal` ahora entrega el producto local completo al servicio de dominio. No serializa configuraciones dentro del JSX.

El servicio usa v2 cuando recibe `localProduct` o una configuración explícita. El RPC legacy se conserva para consumidores antiguos que todavía no envían configuración.

## 16. Sincronización automática PRO

Se añadió:

```text
public.ecommerce_admin_sync_published_catalog_v2(...)
```

El servicio administrativo:

1. recibe las proyecciones construidas por el flujo cloud existente;
2. carga los productos locales en una operación masiva;
3. construye la configuración canónica;
4. adjunta `configuration` y `configurationSourceRevision`;
5. llama al wrapper v2.

El wrapper v2:

- reutiliza el RPC heredado de catálogo;
- invoca el mismo escritor privado para cada resultado aplicable;
- conserva revisión del catálogo;
- no duplica la lógica de variantes o grupos;
- mantiene el producto fail-closed cuando requiere selección.

## 17. Atomicidad

La publicación manual y la sincronización cloud invocan el escritor canónico dentro de la misma transacción PostgreSQL de sus wrappers.

Un error de configuración no puede dejar un producto nuevo comprable con contrato incompleto.

Los errores de un hijo revierten la sincronización de ese producto.

## 18. Idempotencia y carreras

Se añadió idempotencia estricta del payload completo en el wrapper PRO:

- misma clave y mismo payload: respuesta idempotente;
- misma clave y configuración diferente: `ECOMMERCE_IDEMPOTENCY_CONFLICT`;
- no se crean duplicados;
- los hijos omitidos se retiran mediante soft delete.

Revisión de configuración:

- primera revisión: permitida;
- misma revisión y mismo hash: idempotente;
- misma revisión y contenido distinto: `ECOMMERCE_CATALOG_SOURCE_CONFLICT`;
- revisión inferior: `ECOMMERCE_CATALOG_SOURCE_STALE`;
- revisión superior: permitida.

## 19. Aislamiento de revisiones

La revisión de configuración se almacena de forma privada en metadata:

```text
ecommerce_configuration_payload_hash
ecommerce_configuration_source_revision
```

No sobrescribe:

- `source_revision`;
- `source_revision_kind`;
- `source_revision_order`;
- `source_payload_hash`.

Estos campos continúan representando la revisión confirmada del snapshot de catálogo o inventario.

## 20. Bloqueante 3 — contrato de transporte

Se creó:

```text
serializeEcommerceProductConfigurationForSync(configuration)
```

y el constructor:

```text
buildEcommerceProductConfigurationSyncPayload(product, overrides)
```

El serializer:

- incluye sólo campos permitidos por SQL;
- elimina `id` local de variante, grupo y opción;
- conserva `sourceVariantRef`, `sourceGroupRef` y `sourceOptionRef`;
- conserva `optionValues`, precios, stock, disponibilidad e ingredientes;
- no envía `undefined` ni funciones;
- no envía objetos Dexie;
- no envía costos;
- no envía licencia, dispositivo, staff, token o sesión;
- sanitiza metadata;
- no genera source refs únicamente desde el índice del array.

## 21. Allowlists finales

Configuración:

```text
type
version
hasRecipe
variants
optionGroups
availabilitySource
availabilityReasonCode
limitingSource
```

Variante:

```text
sourceVariantRef
sourceProductId
localProductRef
sku
publicName
optionValues
priceMode
priceValue
imageUrl
imageRef
trackStock
stockMode
stockSnapshot
sourceAvailable
manualAvailable
displayOrder
sourceRevision
metadata
```

Grupo:

```text
sourceGroupRef
publicName
selectionType
required
minSelect
maxSelect
displayOrder
options
metadata
```

Opción:

```text
sourceOptionRef
publicName
priceDelta
sourceIngredientId
ingredientQuantity
ingredientUnit
tracksInventory
manualAvailable
sourceAvailable
displayOrder
metadata
```

## 22. Forma real de modificadores

Se auditó `restaurantModifiers`.

La forma real utiliza:

- `price`;
- `ingredientId`;
- `ingredientQuantity`;
- `ingredientUnit`;
- `tracksInventory`.

El normalizador existente ya traduce esos campos al contrato de transporte. No se añadió un modelo alterno.

## 23. Migraciones compensatorias de MODEL.1.1

| Archivo local | Historial remoto | Nombre remoto |
|---|---:|---|
| `20260715221029_ecom_products_model_1_1_integration_availability.sql` | `20260715221029` | `ecom_products_model_1_1_integration_availability` |
| `20260715222335_ecom_products_model_1_1_revision_idempotency.sql` | `20260715222335` | `ecom_products_model_1_1_revision_idempotency` |
| `20260715222524_ecom_products_model_1_1_revision_guard_fix.sql` | `20260715222524` | `ecom_products_model_1_1_revision_guard_fix` |
| `20260715222639_ecom_products_model_1_1_revision_metadata_fix.sql` | `20260715222639` | `ecom_products_model_1_1_revision_metadata_fix` |
| `20260715223230_ecom_products_model_1_1_configuration_revision_isolation.sql` | `20260715223230` | `ecom_products_model_1_1_configuration_revision_isolation` |

Las correcciones posteriores preservan el historial de los defectos encontrados durante las pruebas. Ninguna migración aplicada fue editada.

## 24. Seguridad SQL final

Funciones auditadas:

- `private.ecommerce_published_product_sync_guard`
- `private.ecommerce_configuration_error_from_message`
- `private.ecommerce_apply_product_configuration`
- `private.ecommerce_apply_product_configuration_checked`
- `public.ecommerce_admin_sync_product_configuration`
- `public.ecommerce_admin_upsert_published_product_v2`
- `public.ecommerce_admin_sync_published_catalog_v2`

Resultado:

- owner: `postgres`;
- `SECURITY DEFINER`: sí;
- `search_path=''`: sí;
- helpers privados: sólo `postgres` y `service_role`;
- wrappers administrativos: `anon`, `authenticated`, `service_role` y `postgres`, con autorización interna;
- grants directos nuevos sobre tablas a `anon`/`authenticated`: 0.

Los wrappers públicos reutilizan `private.ecommerce_admin_authorize_v2`, incluyendo licencia, dispositivo, security token, sesión staff, permisos y rate limit vigente.

## 25. Manejo seguro de errores

Se conservaron códigos seguros para:

- `ECOMMERCE_CONFIGURATION_INVALID`
- `ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED`
- `ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE`
- `ECOMMERCE_VARIANT_SOURCE_NOT_FOUND`
- `ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND`
- `ECOMMERCE_OPTION_GROUP_SELECTION_INVALID`
- `ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED`
- `ECOMMERCE_VARIANT_OPTION_VALUE_INVALID`
- `ECOMMERCE_PRODUCT_NOT_FOUND`
- `ECOMMERCE_CATALOG_SOURCE_STALE`
- `ECOMMERCE_CATALOG_SOURCE_CONFLICT`
- `ECOMMERCE_CATALOG_REVISION_CHANGED`
- `ECOMMERCE_IDEMPOTENCY_CONFLICT`

No se exponen SQL interno, tablas, stack trace, licencia, tokens, staff, dispositivos, costos ni metadata privada.

## 26. Pruebas SQL ejecutadas remotamente

Se ejecutaron sobre filas QA reales, siempre dentro de `BEGIN/ROLLBACK`:

1. `requires_configuration=true` conserva `source_available=true` y cambia `is_available=false`.
2. ciclo `variant_parent -> simple` restaura `is_available=true` cuando manual y fuente siguen disponibles.
3. payload canónico completo con una variante, un grupo y dos opciones.
4. opción con ingrediente y `priceDelta`.
5. referencia cross-license rechazada con `ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE`.
6. repetición idéntica sin duplicados.
7. retiro de variante mediante soft delete.
8. retiro coordinado de grupo y opciones.
9. grupo sólo opcional no inventa `requires_configuration`.
10. primera revisión de configuración aceptada.
11. misma revisión y mismo contenido aceptados idempotentemente.
12. misma revisión con contenido distinto rechazada como conflicto.
13. revisión inferior rechazada como obsoleta.
14. revisión superior aceptada.
15. revisión de configuración aislada de la revisión de inventario.

Todas las transacciones ejecutadas se revirtieron.

## 27. Pruebas SQL versionadas

- `supabase/tests/ecom_products_model_1_1_test.sql`: matriz correctiva prevista de 20 casos.
- `supabase/tests/ecom_products_model_1_1_revision_test.sql`: matriz de 7 casos.

El conector de Supabase bloqueó la ejecución monolítica de los archivos y bloqueó los wrappers autenticados cuando la consulta incluía claves o tokens, incluso sintéticos y dentro de rollback. Por ello:

- no se declara 20/20 ni 7/7 remoto;
- no se declara PASS remoto de los wrappers públicos autenticados;
- los casos del escritor canónico y disponibilidad sí fueron ejecutados individualmente;
- las matrices completas quedan pendientes para un entorno local de Supabase o una sesión que permita su ejecución.

## 28. Residuos

Comprobación posterior:

- licencias sintéticas: 0;
- portales sintéticos: 0;
- productos sintéticos: 0;
- dispositivos sintéticos: 0;
- productos publicados sintéticos: 0;
- variantes QA residuales: 0;
- grupos QA residuales: 0;
- opciones QA residuales: 0;
- pedidos sintéticos: 0;
- ventas sintéticas: 0;
- movimientos de caja sintéticos: 0;
- movimientos de inventario sintéticos: 0.

Los datos reales permanecieron sin configuraciones activas después de los rollback.

## 29. Pruebas JavaScript añadidas o ampliadas

- `src/utils/__tests__/ecommerceProductConfigurationSync.test.js`
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`
- `src/components/ecommerce/__tests__/EcommerceProductPublishModal.configurationSync.test.jsx`

Cobertura preparada:

- allowlists exactas;
- eliminación de IDs internos;
- metadata privada;
- referencias estables;
- contrato de disponibilidad;
- publicación manual v2;
- sincronización PRO v2;
- producto local ausente fail-closed;
- sesión staff;
- errores seguros;
- entrega del producto local desde el modal para Free y Pro.

## 30. Validación de sintaxis ejecutada

Con los archivos de implementación recuperados desde GitHub:

- `node --check src/utils/ecommerceProductConfigurationSync.js`: PASS.
- `node --check src/services/ecommerce/ecommerceAdminService.js`: PASS.
- transpilo de `EcommerceProductPublishModal.jsx` mediante el compilador TypeScript instalado: PASS.

Estas comprobaciones no sustituyen Vitest, ESLint ni build.

## 31. npm, Vitest, ESLint y builds

Se intentó crear un checkout local:

```text
git clone --branch fase-ecom-products-model-1 --single-branch https://github.com/fdxruli/Lanzo-POS.git /tmp/Lanzo-POS
```

Resultado real:

```text
fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/':
Could not resolve host: github.com
```

Sin checkout ni `package.json`, los comandos solicitados no pudieron ejecutarse de forma válida:

- `npm ci`: no existe lockfile en el directorio vacío;
- `npm run build`: `ENOENT package.json`;
- `npm run build:store`: `ENOENT package.json`;
- `npm run build:store:vercel`: `ENOENT package.json`;
- `npm run lint`: `ENOENT package.json`;
- `npm run test:ci`: `ENOENT package.json`;
- `git diff --check`: no existe repositorio local;
- `git status --short`: no existe repositorio local.

Por tanto, no se afirma PASS de:

- Vitest enfocado;
- ESLint enfocado;
- lint global;
- test global;
- build administrativo;
- build store;
- build store Vercel;
- `git diff --check`;
- `git status --short`.

## 32. Asesores Supabase

Seguridad:

- no se reportaron advertencias nuevas atribuibles a las funciones o tablas de MODEL.1.1;
- permanecen advertencias heredadas sobre `user_profiles` y configuración Auth.

Rendimiento:

- no se reportaron nuevas claves foráneas sin índice atribuibles a MODEL.1.1;
- permanecen advertencias heredadas del proyecto;
- índices de las tablas configurables aparecen inicialmente como no usados porque todavía no existe tráfico real.

## 33. Compatibilidad y límites

No se modificó:

- `ecommerce_create_order`;
- checkout público;
- payload de pedidos;
- carrito público;
- seguimiento;
- pedidos online;
- fulfillment;
- POS;
- `processSale`;
- inventario real;
- reservas;
- lotes reales;
- caja;
- ventas;
- pagos;
- conversión ecommerce;
- comandas;
- personalización Pro;
- Vercel.

No se inició `ECOM.PRODUCTS.PUBLIC.1`.

## 34. Archivos creados por MODEL.1.1

- `src/utils/ecommerceProductConfigurationSync.js`
- `src/utils/ecommerceProductAvailability.js`
- `src/utils/__tests__/ecommerceProductConfigurationSync.test.js`
- `src/components/ecommerce/__tests__/EcommerceProductPublishModal.configurationSync.test.jsx`
- `supabase/migrations/20260715221029_ecom_products_model_1_1_integration_availability.sql`
- `supabase/migrations/20260715222335_ecom_products_model_1_1_revision_idempotency.sql`
- `supabase/migrations/20260715222524_ecom_products_model_1_1_revision_guard_fix.sql`
- `supabase/migrations/20260715222639_ecom_products_model_1_1_revision_metadata_fix.sql`
- `supabase/migrations/20260715223230_ecom_products_model_1_1_configuration_revision_isolation.sql`
- `supabase/tests/ecom_products_model_1_1_test.sql`
- `supabase/tests/ecom_products_model_1_1_revision_test.sql`

## 35. Archivos modificados por MODEL.1.1

- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`
- `src/components/ecommerce/EcommerceProductPublishModal.jsx`
- `docs/reports/ECOM.PRODUCTS.MODEL.1.md`

## 36. Estado del PR

- PR: #98.
- Rama: `fase-ecom-products-model-1`.
- Base: `main`.
- Estado: draft.
- Merge: no.
- Auto-merge: no.
- `main` modificado: no.
- Deployments manuales: 0.
- Previews manuales: 0.
- Cambios de Vercel: 0.

## 37. Bloqueos pendientes

Antes de aprobar o marcar ready for review se requiere, en un checkout local real:

1. `npm ci`;
2. suites enfocadas de Vitest;
3. ESLint sobre todos los archivos modificados;
4. `npm run build`;
5. `npm run build:store`;
6. `npm run build:store:vercel`;
7. `npm run lint`;
8. `npm run test:ci`;
9. `git diff --check`;
10. `git status --short`;
11. ejecutar las matrices SQL completas de MODEL.1.1 con rollback;
12. revisión independiente del PR.

## 38. Conclusión correctiva

Los tres bloqueantes fueron corregidos en código y Supabase:

- `requires_configuration` ya no contamina `source_available`;
- retirar configuración vuelve a habilitar un producto válido;
- productos realmente indisponibles continúan bloqueados;
- la publicación manual usa un wrapper atómico v2;
- la sincronización PRO usa el mismo escritor canónico;
- el serializer JavaScript coincide con la allowlist SQL;
- las revisiones obsoletas y conflictos se bloquean;
- configuración e inventario conservan revisiones independientes;
- no existen residuos de prueba;
- no se modificó `main`;
- no se hizo merge;
- no se realizó deployment.

La implementación correctiva está lista para validación local, pero el PR debe continuar **draft** hasta que Vitest, ESLint, los tres builds y las matrices SQL completas se ejecuten y reciban una revisión independiente.
