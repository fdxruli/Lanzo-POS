# HOTFIX ECOM.CATALOG.BOOTSTRAP.CONSISTENCY

Fecha: 2026-07-16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `hotfix-ecom-catalog-bootstrap-consistency`

## 1. Resumen ejecutivo

Se corrigieron falsos estados `No disponible` en productos preparados mediante receta y la regresión que convertía grupos de extras múltiples en selección única.

La solución cubre cuatro capas:

1. hidratación completa de productos y lotes antes de reconciliar el ecommerce;
2. estado `unverified` cuando el catálogo local carece de un lote que debería existir;
3. separación entre revisión de inventario y revisión de configuración;
4. validación server-side de disponibilidad y configuración contra el catálogo cloud autoritativo.

**Estado: IMPLEMENTACIÓN COMPLETA EN RAMA Y SUPABASE — PR PENDIENTE DE REVISIÓN.**

## 2. Causa raíz

### 2.1 Lotes ausentes en el dispositivo

Los lotes iniciales de varios ingredientes existían en `pos_product_batches`, pero nunca generaron eventos en `pos_sync_events`. El sincronizador incremental descargó productos sin sus lotes y el evaluador local interpretó la colección vacía como inventario confirmado en cero.

Esto produjo falsos `RECIPE_CAPACITY_ZERO` para:

- Hamburguesa de pollo;
- Papas a la francesa;
- Quesadilla de queso.

### 2.2 Reconciliación antes del snapshot

`EcommerceCatalogSyncRuntime` podía ejecutar la reconciliación completa antes de que el catálogo cloud y sus lotes terminaran de aplicarse en Dexie.

### 2.3 Revisión de configuración contaminada

La revisión utilizada para inventario incluía padre, ingredientes y lotes. Esa revisión dependiente se reutilizaba como `configurationSourceRevision`, aunque la configuración corresponde exclusivamente a la versión del producto padre.

Una configuración local antigua podía volver a sobrescribir una configuración canónica posterior. El caso confirmado fue `Taco al pastor`: el grupo `Extras` volvió de `multiple / maxSelect=3` a `single / maxSelect=1`.

## 3. Cambios frontend

### 3.1 Hidratación previa

Se añadió `ecommerceCatalogHydration.js`:

- descarga snapshot completo cloud;
- espera a que productos y lotes estén en Dexie;
- deduplica hidrataciones concurrentes por licencia;
- usa TTL para evitar lecturas completas excesivas;
- no ejecuta reconciliación con datos locales antiguos si falla el snapshot;
- cancela el paso final si cambia el contexto de licencia.

### 3.2 Runtime ordenado

Las reconciliaciones completas por:

- contexto listo;
- regreso de conexión;
- visibilidad de la aplicación;
- solicitud manual;

ahora siguen el orden:

```text
snapshot cloud → Dexie → reconciliación ecommerce
```

### 3.3 Ausencia de lote fail-safe

Cuando un ingrediente:

- maneja lotes;
- tiene stock positivo en el registro local;
- pero no tiene lote local cargado;

la proyección deja de declarar `out_of_stock`. Se fuerza una evaluación no verificada para conservar la última disponibilidad válida en Supabase hasta completar la hidratación.

### 3.4 Revisiones separadas

- `sourceRevision`: puede depender de padre, ingredientes y lotes.
- `configurationSourceRevision`: usa únicamente la versión original del producto padre.

## 4. Cambios Supabase

Migraciones aplicadas:

- `20260716155538_ecom_catalog_bootstrap_consistency`;
- `20260716155623_ecom_catalog_bootstrap_repair`;
- `20260716155739_ecom_catalog_bootstrap_review_cleanup`.

### 4.1 Guardia de configuración

`private.ecommerce_apply_product_configuration_checked` compara la revisión entrante contra la versión canónica de `pos_products`.

Una configuración obsoleta enviada por una reconciliación automática:

- no se aplica;
- no elimina hijos canónicos;
- queda identificada con `ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH`.

### 4.2 Guardia de recetas

El trigger `zz_ecommerce_recipe_projection_guard` recalcula la receta mediante `private.ecommerce_recipe_capacity` antes de guardar una proyección publicada.

El cliente ya no puede convertir una receta con inventario real en un falso agotado debido a datos locales incompletos.

### 4.3 Reparación incremental

Se generaron eventos compensatorios para entidades necesarias que carecían de evento vigente:

- 5 eventos de producto;
- 4 eventos de lote.

### 4.4 Reconstrucción de configuraciones

Las configuraciones de productos por receta sin variantes se reconstruyeron desde `pos_products.modifiers`, incluyendo:

- tipo de selección;
- mínimos y máximos;
- precios;
- dependencias de inventario;
- disponibilidad de cada opción.

## 5. Resultado verificado

| Producto | Estado | Capacidad |
|---|---|---:|
| Hamburguesa de pollo | Disponible | 66 |
| Papas a la francesa | Disponible | 60 |
| Quesadilla de queso | Disponible | 41 |
| Taco al pastor | Disponible | 99 |

La RPC `ecommerce_get_catalog` devuelve los cuatro productos con `isAvailable=true`.

La RPC `ecommerce_get_product_configuration` devuelve para `Taco al pastor`:

```text
Extras
selectionType = multiple
minSelect = 0
maxSelect = 3
```

Las tres opciones están disponibles:

- Queso extra;
- Orden de tortillas;
- Sin cebolla.

## 6. Pruebas añadidas

Frontend:

- `ecommerceCatalogSyncConsistency.test.js`;
- `ecommerceCatalogHydration.test.js`.

Supabase:

- `ecom_catalog_bootstrap_consistency_test.sql`.

La matriz SQL fue ejecutada contra el proyecto remoto y terminó sin excepciones. Incluye:

- presencia y habilitación del trigger;
- comparación de cada receta publicada contra la capacidad canónica;
- revisión canónica de configuración;
- catálogo público disponible;
- grupo Extras múltiple del taco;
- eventos compensatorios de lotes.

## 7. Validación pendiente

No se declara todavía PASS de Vitest, ESLint ni builds del repositorio porque el entorno conectado no dispone de un checkout instalable. Deben verificarse en CI o en un checkout local antes de mergear.

Comandos recomendados:

```bash
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogSyncConsistency.test.js
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogHydration.test.js
npx vitest run src/services/ecommerce/__tests__/ecommerceCatalogSyncRecipeDependencies.test.js
npx eslint src/services/ecommerce/ecommerceCatalogSyncService.js \
  src/services/ecommerce/ecommerceCatalogHydration.js \
  src/components/ecommerce/EcommerceCatalogSyncRuntime.jsx \
  src/services/ecommerce/__tests__/ecommerceCatalogSyncConsistency.test.js \
  src/services/ecommerce/__tests__/ecommerceCatalogHydration.test.js
npm run build
npm run build:store
npm run build:store:vercel
```

## 8. Restricciones respetadas

- No se modificó directamente `main`.
- No se hizo merge automático.
- No se modificaron pedidos, ventas, caja ni reservas.
- No se ajustó stock manualmente.
- No se forzaron previews manuales de Vercel.
- Las correcciones SQL se aplicaron mediante migraciones compensatorias nuevas.
