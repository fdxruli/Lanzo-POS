# HOTFIX ECOM.FREE.LOCAL.CATALOG.HYDRATION

Fecha: 2026-07-17 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `agent/ecom-free-local-catalog-hydration`  
Estado: **IMPLEMENTADO — PR DRAFT PENDIENTE DE VALIDACIÓN MANUAL**

## 1. Resumen ejecutivo

Se corrigió la regresión que provocaba que una licencia Free intentara ejecutar:

```text
pos_pull_product_catalog_snapshot
```

La RPC pertenece a la sincronización completa del catálogo POS en la nube y Supabase la rechazaba correctamente con:

```text
CLOUD_POS_SYNC_DISABLED
SQLSTATE P0001
HTTP 400
```

La corrección mantiene separados ambos contratos:

```text
Pro/Nube
→ hidrata el catálogo POS desde Supabase
→ reconcilia el ecommerce

Free
→ omite la hidratación POS cloud
→ reconcilia el ecommerce desde IndexedDB
```

No se modificó Supabase, no se añadieron migraciones y no se cambió la política de planes.

## 2. Causa raíz

`EcommerceCatalogSyncRuntime` iniciaba una hidratación forzada siempre que existiera una licencia, sin comprobar las capacidades:

```text
cloud_pos_sync
cloud_products_sync
```

La validación del backend funcionaba correctamente y bloqueaba la RPC para Free. El defecto estaba en el frontend, que trataba la presencia de una `licenseKey` como autorización suficiente para descargar el snapshot POS cloud.

El fallo detenía la reconciliación ecommerce inicial porque `syncEcommerceCatalogAfterHydration` no alcanzaba `ecommerceCatalogSyncService.syncNow` cuando la hidratación era rechazada.

## 3. Corrección implementada

### 3.1 Control explícito de hidratación

`hydrateEcommerceCatalogSnapshot` ahora acepta:

```text
hydrateCloudCatalog
```

Cuando su valor no es `true`, retorna:

```json
{
  "success": true,
  "skipped": true,
  "reason": "cloud_products_sync_disabled"
}
```

No llama `productMigrationService.pullFullSnapshot` ni crea estado de hidratación cloud.

### 3.2 Reconciliación local conservada

La omisión de hidratación no se considera un error. `syncEcommerceCatalogAfterHydration` continúa normalmente y ejecuta:

```text
ecommerceCatalogSyncService.syncNow({ fullReconcile: true })
```

Por lo tanto, Free utiliza categorías, productos, recetas, modificadores, lotes y stock disponibles en IndexedDB para construir la proyección ecommerce permitida por su plan.

### 3.3 Evaluación de capacidades en tiempo de ejecución

`EcommerceCatalogSyncRuntime` utiliza:

```text
isCloudProductsSyncEnabled(licenseDetails)
```

La evaluación se realiza:

- al iniciar o cambiar el contexto de licencia;
- al recuperar conexión;
- al volver visible la aplicación;
- durante solicitudes manuales de reconciliación completa.

La identidad del contexto también incorpora el modo `cloud-products` o `local-products`, de manera que un cambio de plan con la misma clave vuelve a inicializar correctamente el runtime.

## 4. Pruebas añadidas

Se añadieron casos unitarios que verifican:

1. Pro espera el snapshot cloud antes de reconciliar.
2. Free omite `pullFullSnapshot`.
3. Free retorna `cloud_products_sync_disabled` como omisión válida.
4. Free ejecuta de todas formas `syncNow({ fullReconcile: true })` desde el catálogo local.
5. La deduplicación de hidrataciones Pro se conserva.
6. Un fallo real de hidratación Pro continúa bloqueando la reconciliación de datos potencialmente obsoletos.
7. Un cambio de contexto durante la hidratación continúa cancelando la reconciliación.

## 5. Archivos modificados

```text
src/components/ecommerce/EcommerceCatalogSyncRuntime.jsx
src/services/ecommerce/ecommerceCatalogHydration.js
src/services/ecommerce/__tests__/ecommerceCatalogHydration.test.js
```

## 6. Exclusiones confirmadas

No se modificaron:

- Supabase;
- migraciones;
- RPC;
- validaciones de plan del backend;
- límites de diez productos de Free;
- inventario, recetas o lotes;
- pedidos ecommerce;
- checkout;
- caja o ventas;
- Vercel;
- workflows de GitHub Actions.

## 7. Validación manual requerida

En un negocio Free actualizado:

1. cerrar y volver a abrir Lanzo POS;
2. abrir la consola antes de que termine la inicialización;
3. confirmar que no exista un `POST` a `pos_pull_product_catalog_snapshot`;
4. confirmar que no aparezcan `HTTP 400`, `P0001` ni `CLOUD_POS_SYNC_DISABLED`;
5. modificar o publicar un producto dentro del límite Free;
6. confirmar que el catálogo público refleje el cambio;
7. volver a la pestaña o recuperar conexión y confirmar que no se reintente el snapshot cloud.

En un negocio Pro/Nube:

1. confirmar que `pos_pull_product_catalog_snapshot` siga respondiendo `200`;
2. confirmar que la hidratación ocurra antes del `fullReconcile`;
3. confirmar que productos, lotes, recetas y extras sigan sincronizando normalmente.

## 8. Resultado esperado

```text
Free: catálogo POS local + ecommerce permitido, sin RPC cloud rechazada.
Pro: catálogo POS cloud hidratado + ecommerce reconciliado.
```
