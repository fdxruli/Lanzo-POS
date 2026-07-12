# ECOM.FE.CATALOG.2 — Alertas de productos publicados sin stock

## Estado

**IMPLEMENTACIÓN FUNCIONAL COMPLETADA / VALIDACIÓN MANUAL PENDIENTE**

No se declara `ECOM.FE.CATALOG.2 PASS`.

El PR permanece en **DRAFT**. En esta corrección puntual no se ejecutaron pruebas, build, lint, Vitest, `test:ci` ni validación global.

## Referencias

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-2`
- PR: `#92 — FASE ECOM.FE.CATALOG.2 — Alertar productos publicados sin stock`
- Base del PR confirmada al iniciar: `main@dc4eef71b87200fdbe0835d84ea602f72fe79d0f`
- HEAD inicial de `ECOM.FE.CATALOG.2.1`: `646065c56eb062da733dc9f68e28a002ac75b82d`
- HEAD funcional después de corregir código y copy: `821401d63b9e222e04a9bae437a1ee600f20d305`
- HEAD final: commit actual de `fase-ecom-fe-catalog-2` que contiene este reporte; su SHA exacto queda registrado en la descripción del PR y en la entrega final para evitar conservar una referencia autorreferencial obsoleta dentro del mismo commit.
- Estado del PR: `DRAFT`

## Objetivo de la corrección puntual

Se corrigieron exclusivamente los pendientes de `ECOM.FE.CATALOG.2.1`:

1. eliminar el límite efectivo de 500 productos del selector administrativo;
2. proteger la paginación contra cursores repetidos;
3. deduplicar productos entre páginas;
4. impedir que un error intermedio confirme un catálogo parcial;
5. actualizar el copy obsoleto del modal PRO;
6. mantener intacta la arquitectura de alertas ya implementada.

## Carga completa del catálogo administrativo

Archivo modificado:

- `src/components/ecommerce/EcommercePortalSettings.jsx`

`loadLocalCatalog()` conserva el cache existente:

```js
if (localProducts.length > 0) return true;
```

La primera apertura del modal recorre todas las páginas mediante:

```js
productRepository.listProductsPage({
  limit: 500,
  status: 'active',
  cursor
});
```

El valor `500` se conserva únicamente como tamaño técnico de página. Ya no funciona como límite total del catálogo.

La paginación continúa mientras exista un `nextCursor` válido y termina cuando:

- `nextCursor` es `null`, `undefined` o una cadena vacía;
- la página devuelta está vacía;
- `nextCursor` es igual al cursor actual;
- `nextCursor` ya fue visitado.

Con esto, un catálogo PRO con más de 500 productos activos puede ser recorrido completo por el selector administrativo en condiciones normales.

## Protección contra cursores repetidos

La carga mantiene:

```js
const visitedCursors = new Set();
```

Antes de solicitar una página con cursor se comprueba que dicho cursor no haya sido utilizado. También se comprueba el cursor siguiente antes de continuar.

Esto evita ciclos en secuencias como:

- `A → A`;
- `A → B → A`;
- página vacía con cursor persistente.

Una respuesta defectuosa de paginación no puede mantener la interfaz en un ciclo infinito.

## Deduplicación estable

Los productos de todas las páginas se acumulan temporalmente y se deduplican al finalizar por `String(product.id)`.

Solo se conservan filas que cumplan:

```js
product?.id
product.isActive !== false
```

Se conserva la primera aparición de cada producto, por lo que el orden final es estable.

No se agregó una lectura por producto ni un patrón N+1.

## Manejo de errores y confirmación atómica

Cada página debe devolver un objeto válido con `data` como arreglo. Una respuesta malformada se trata como error de lectura.

Si una página o la carga de categorías falla:

- no se ejecuta `setLocalProducts(...)`;
- no se abre el modal con un catálogo parcial;
- se utiliza el `toast.error` existente;
- `loadLocalCatalog()` retorna `false`;
- `loadingCatalog` vuelve a `false` mediante `finally`.

El catálogo y las categorías se asignan al estado únicamente después de completar correctamente toda la operación.

## Copy actualizado del modal PRO

Archivo modificado:

- `src/components/ecommerce/EcommerceProductPublishModal.jsx`

Texto final para Lanzo Nube / PRO:

> Las alertas utilizan el inventario disponible en este dispositivo. La sincronización automática del catálogo público se habilitará en una fase posterior.

El texto de Plan Free se conservó.

El copy ya no presenta `ECOM.FE.CATALOG.2` como una fase futura ni promete sincronización cloud actualmente inexistente.

## Arquitectura de alertas conservada

No se modificaron:

- `src/services/ecommerce/ecommercePublishedStockAlertService.js`
- `src/services/ecommerce/ecommercePublishedStockLocalSource.js`
- `src/store/slices/createEcommercePublishedStockAlertSlice.js`
- `src/hooks/useEcommercePublishedStockAlerts.js`
- `src/components/ecommerce/EcommercePublishedStockAlertRuntime.jsx`
- `src/components/notifications/NotificationBell.jsx`
- `src/components/notifications/EcommercePublishedStockOperationalAlert.jsx`
- `src/hooks/useTickerAlerts.js`
- `src/services/tickerAlerts.js`

Se conserva:

- snapshot compartido;
- TTL de 2 minutos;
- single-flight;
- epochs;
- compare-and-commit;
- separación por licencia, staff y dispositivo;
- ticker agregado para Plan Free;
- tarjeta operacional local para PRO;
- contador cloud separado;
- deep link a Portal online;
- invalidación mediante `lanzo:ticker-inventory-alert`;
- estados `in_stock`, `out_of_stock`, `not_tracked`, `unverified`, `source_missing` e `inactive_source`.

No se creó una segunda lista de productos sin stock y los errores de lectura no se convierten en stock cero.

## Evaluación masiva sin N+1

El evaluador de alertas continúa resolviendo productos publicados mediante `bulkGet`, con chunks técnicos cuando corresponde.

La corrección del selector administrativo no modifica el evaluador masivo, el repositorio de productos, `loadDataPaginated(...)`, `productRepository.listProductsPage(...)` ni `productLocalRepository.listProductsPage(...)`.

## Archivos modificados por ECOM.FE.CATALOG.2.1

- `src/components/ecommerce/EcommercePortalSettings.jsx`
- `src/components/ecommerce/EcommerceProductPublishModal.jsx`
- `reports/ecom_fe_catalog_2_published_stock_alerts_report.md`

## Validación

Por instrucción expresa, en esta tarea no se ejecutaron:

```text
npm ci
npm run build
npm run lint
npm run test:ci
Vitest
ESLint
```

Tampoco se ejecutó validación global ni se declaró que las pruebas pasaron.

La validación funcional y global queda pendiente de ejecución manual sobre el HEAD final.

## Alcance no modificado

- Supabase: sin cambios.
- Migraciones: sin cambios.
- SQL: no ejecutado.
- RPC, grants, RLS, tablas y funciones: sin cambios.
- Tienda pública: sin cambios.
- Checkout ecommerce: sin cambios.
- Workflows temporales de GitHub Actions: ninguno.
- Preview manual de Vercel: no creado, no forzado, no promovido y no validado.
- PR: no mergeado y no marcado ready for review.

## Conclusión

La corrección funcional `ECOM.FE.CATALOG.2.1` quedó implementada. El límite efectivo de 500 productos fue eliminado mediante paginación por `nextCursor`, existen barreras contra cursores repetidos y páginas vacías, el catálogo se deduplica por `id`, los errores no confirman resultados parciales y el copy PRO fue actualizado.

El PR #92 debe permanecer en **DRAFT / VALIDACIÓN MANUAL PENDIENTE** hasta completar la validación manual solicitada.
