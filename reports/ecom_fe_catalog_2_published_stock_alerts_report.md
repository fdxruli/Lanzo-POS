# ECOM.FE.CATALOG.2 — Alertas de productos publicados sin stock

## Estado

**IMPLEMENTACIÓN COMPLETADA / VALIDACIÓN EJECUTABLE PENDIENTE**

No se declara `ECOM.FE.CATALOG.2 PASS` porque en el entorno disponible no fue posible ejecutar `npm ci`, ESLint, Vitest, build ni `test:ci`. El PR permanece en draft.

## Referencias

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-catalog-2`
- PR: `#92 — FASE ECOM.FE.CATALOG.2 — Alertar productos publicados sin stock`
- Base confirmada de `main`: `dc4eef71b87200fdbe0835d84ea602f72fe79d0f`
- HEAD de implementación revisado antes de este reporte: `dc0fd2430f69336f496dec4237d9f2aef5d80714`
- Estado del PR: `DRAFT`

## Objetivo

Detectar únicamente productos publicados en el portal ecommerce cuyo stock vendible local y canónico esté confirmado en cero o negativo, y presentar una alerta operacional agregada según el plan:

- Plan Free: ticker local.
- Lanzo Nube / PRO: Centro de Notificaciones como alerta operacional local.
- Todos los administradores autorizados: banner general y warning individual dentro de la lista existente de Portal online.

No se agregó una segunda lista de productos.

## Arquitectura local compartida

Se creó un evaluador único en:

- `src/services/ecommerce/ecommercePublishedStockAlertService.js`
- `src/services/ecommerce/ecommercePublishedStockLocalSource.js`
- `src/services/ecommerce/ecommercePublishedStockAlertConstants.js`

El store compartido vive en:

- `src/store/slices/createEcommercePublishedStockAlertSlice.js`

Las superficies consumen el mismo snapshot mediante:

- `src/hooks/useEcommercePublishedStockAlerts.js`
- `src/components/ecommerce/EcommercePublishedStockAlertRuntime.jsx`

La invalidación por inventario se centralizó en un único runtime mediante el evento existente:

- `lanzo:ticker-inventory-alert`

Esto evita que ticker, campana y Portal online mantengan caches paralelos o ejecuten evaluaciones independientes.

## Motivo para no generar notificación cloud

La alerta PRO no se persiste ni se mezcla con las notificaciones cloud porque el inventario vendible actual reside en la fuente local/canónica del POS y el snapshot público puede estar desactualizado.

La implementación:

- no crea UUID sintéticos;
- no agrega la alerta al arreglo de notificaciones cloud;
- no llama acciones de marcar leída o archivar;
- no modifica `notificationsUnreadCount`;
- no modifica `refresh_operational_notifications(...)`;
- no modifica `list_pos_notifications(...)`.

La alerta PRO se presenta como una tarjeta operacional local separada dentro del drawer.

## Fuente canónica de stock

El evaluador reutiliza:

- `getAvailableStock(...)` para stock físico menos reservas;
- `getAvailableBatchStock(...)` para lotes;
- `isBatchActiveForFefo(...)` y `getBatchExpiryStatus(...)` para lotes activos y vigentes;
- `getInventoryQuantityForSale(...)` para factor de conversión de la unidad vendible;
- `normalizeStock(...)` para la precisión estándar del POS.

Se consideran:

- stock simple;
- cantidades reservadas;
- stock por lotes;
- lotes inactivos, eliminados, bloqueados, vencidos o sin stock vendible;
- factor de conversión;
- productos sin control de inventario;
- errores y datos no verificables.

Una lectura fallida o un lote activo con stock inválido no se transforma en cero. Se clasifica como `unverified`, salvo que exista otro lote vendible confirmado que demuestre stock positivo.

Los productos con receta se clasifican como `unverified` en esta fase porque confirmar su stock vendible requeriría resolver en bloque todos los ingredientes y modificadores; no se inventa stock directo para ellos.

## Estados de evaluación

- `in_stock`: stock vendible confirmado mayor que cero.
- `out_of_stock`: lectura exitosa, control de inventario confirmado y stock vendible menor o igual que cero.
- `not_tracked`: producto sin control de inventario.
- `unverified`: error de lectura, receta o datos activos que no permiten confirmar stock.
- `source_missing`: referencia local inexistente.
- `inactive_source`: producto local inactivo o eliminado.

`source_missing`, `inactive_source`, `unverified` y `not_tracked` no incrementan `outOfStockCount`.

## Carga eficiente

- Productos locales: `bulkGet` por todos los `localProductRef`, dividido únicamente en chunks técnicos de 500.
- Lotes: consultas indexadas `where('productId').anyOf(...)`, divididas en chunks de 200.
- No existe una consulta por cada producto publicado.
- No se usa el límite administrativo de 500 productos para evaluar alertas.
- Se agregaron pruebas para 601 productos y 410 lotes.

## Single-flight, TTL y respuestas antiguas

- TTL: 2 minutos.
- Cache separado por licencia, rol, identidad staff y dispositivo.
- Single-flight por contexto y epoch.
- `force: true` omite TTL.
- Una invalidación incrementa el epoch y permite iniciar una lectura fresca aunque exista una lectura anterior pendiente.
- Una respuesta iniciada con otra licencia, sesión o epoch retorna `stale: true` y no se confirma en el store.
- El store aplica compare-and-commit con `contextKey` y `requestEpoch`.
- Durante refresh seguro se conserva el último resultado del mismo contexto.

## Plan Free

El ticker recibe como máximo una alerta agregada:

```js
{
  id: 'ecommerce-published-out-of-stock',
  type: 'ecommerce-published-out-of-stock',
  count,
  urgency: WARNING,
  route: '/configuracion?tab=portal-online&focus=products'
}
```

No incluye nombres de productos. Solo se agrega cuando:

- `shouldUseLocalTicker(...)` habilita el ticker local;
- el portal está `published`;
- `outOfStockCount > 0`.

El ticker summary de PRO mantiene su arquitectura actual.

## Lanzo Nube / PRO

Se agregó una tarjeta operacional local dentro del Centro de Notificaciones:

- título: `Productos publicados sin stock`;
- contenido agregado;
- acción: `Revisar productos`;
- no descartable;
- no persistida;
- sin UUID cloud.

La campana conserva el contador cloud y usa un indicador visual/accesible separado para la alerta local.

La alerta desaparece cuando:

- `outOfStockCount` llega a cero;
- el portal deja de estar publicado;
- cambia la licencia o sesión;
- se pierde autorización.

## Portal online

La lista existente de productos sigue siendo la superficie principal.

Se agregó:

- banner agregado para `out_of_stock`;
- aviso separado para productos que requieren revisión;
- warning individual accesible por tarjeta;
- identificador estable `ecommerce-published-products`;
- soporte de foco mediante el deep link.

Los warnings administrativos se muestran aunque el portal esté pausado o en borrador. Las alertas externas de ticker/centro se muestran únicamente con portal publicado.

Después de crear, publicar, pausar o guardar el portal, y después de guardar, publicar o despublicar un producto, el snapshot se invalida y se recalcula con `force: true`.

La despublicación reconcilia primero el snapshot visible para retirar inmediatamente el producto y después ejecuta la lectura real.

## Permisos

- Administrador local autorizado: puede evaluar y abrir Portal online.
- Staff PRO: requiere `settings === true` y `ecommerce === true` para la lectura administrativa.
- La superficie del Centro de Notificaciones requiere además `notifications === true`.
- Staff sin permisos no recibe conteos ni deep link operativo.
- No se creó un permiso nuevo.

## Deep link

Ruta implementada:

```text
/configuracion?tab=portal-online&focus=products
```

`SettingsPage` consume `tab`, enfoca `#ecommerce-published-products`, hace scroll y elimina `focus` mediante navegación `replace`.

## Invalidación y recuperación

`notifyProductsChanged(...)` emite también `lanzo:ticker-inventory-alert`.

El runtime compartido escucha una sola vez el evento, invalida el cache y fuerza evaluación en background. Esto cubre los flujos que ya notifican cambios de producto/inventario sin introducir llamadas completas dentro de cada venta, merma o ajuste.

Cuando el stock se repone o se despublica el último producto afectado, el conteo llega a cero y desaparecen banner, ticker y alerta PRO sin recargar la aplicación.

## Pruebas agregadas o actualizadas

- `ecommercePublishedStockAlertService.test.js`
  - stock cero, negativo y positivo;
  - despublicado y referencia ausente;
  - `not_tracked`, `source_missing`, `inactive_source`, `unverified`;
  - lotes agotados, vencidos, bloqueados y vendibles;
  - reservas;
  - factor de conversión;
  - más de 500 productos;
  - single-flight;
  - cambio de licencia;
  - portal pausado.
- `ecommercePublishedStockAlertInvalidation.test.js`
  - invalidación con lectura anterior pendiente;
  - nueva lectura por epoch;
  - respuesta anterior descartada.
- `ecommercePublishedStockMalformedBatch.test.js`
  - lote activo no verificable;
  - lote verificable positivo junto a lote corrupto.
- `ecommercePublishedStockLocalSource.test.js`
  - 601 productos con `bulkGet`;
  - 410 lotes por consulta indexada, sin N+1.
- `EcommercePortalSettings.stockAlerts.test.jsx`
  - banner y warning individual;
  - estados diferenciados;
  - producto despublicado;
  - recálculo después de despublicar.
- `tickerAlerts.ecommerce.test.js`
  - alerta FREE agregada;
  - sin nombres;
  - portal pausado sin alerta.
- `NotificationBell.test.jsx`
  - indicador local separado;
  - contador cloud intacto;
  - tarjeta local sin marcar ni archivar cloud.
- `notificationCapabilities.ecommerce.test.js`
  - matriz `notifications + settings + ecommerce`.

## Validación solicitada

Comandos requeridos:

```bash
npm ci
npx eslint <archivos modificados>
npx vitest run <suites enfocadas>
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
```

### Resultado en este entorno

- `git ls-remote https://github.com/fdxruli/Lanzo-POS.git HEAD`: **BLOQUEADO**, el runtime no pudo resolver `github.com`.
- Checkout local íntegro: **NO DISPONIBLE** por el bloqueo de red anterior.
- `npm ci`: **NO EJECUTADO**; no existe checkout local.
- ESLint específico: **NO EJECUTADO**.
- Vitest enfocado: **NO EJECUTADO**.
- Regresión relacionada: **NO EJECUTADA**.
- `npm run build`: **NO EJECUTADO**.
- `npm run lint`: **NO EJECUTADO**.
- `npm run test:ci`: **NO EJECUTADO**.
- GitHub Actions asociados al commit: **NINGUNO DISPONIBLE**.
- Estado automático Vercel: **FAIL EXTERNO**, `build-rate-limit`; no se creó ni forzó preview manual.
- Comparación GitHub `main...fase-ecom-fe-catalog-2`: **ahead 32 / behind 0** al generar este reporte.
- Auditoría de archivos modificados: **sin archivos de Supabase, migraciones o tienda pública**.
- Revisión estática del diff: **COMPLETADA**, incluyendo corrección de runtime faltante, single-flight por epoch, listener central y fail-closed de lotes.

## Fallos heredados o externos

No se confirmó un fallo funcional heredado de `main` porque no existe una ejecución de línea base comparable.

Bloqueos externos actuales:

1. resolución DNS de `github.com` no disponible desde el runtime local;
2. ausencia de workflows de GitHub Actions para el HEAD;
3. límite de builds de Vercel.

## Alcance no modificado

- Supabase: sin cambios.
- Migraciones: ninguna.
- RPC, grants, RLS, tablas y funciones: sin cambios.
- `refresh_operational_notifications(...)`: sin cambios.
- `list_pos_notifications(...)`: sin cambios.
- Tienda pública: sin cambios.
- Checkout ecommerce: sin cambios.
- Ventas POS, caja, reservas y semántica operativa: sin cambios.
- Workflows temporales: ninguno.
- Preview manual de Vercel: ninguno.

## Conclusión

La implementación y su cobertura automatizada quedaron preparadas en el PR draft #92. La fase debe permanecer como **VALIDACIÓN PENDIENTE** hasta ejecutar los comandos obligatorios sobre un checkout íntegro y comparar los resultados globales con `main`.

No corresponde declarar `ECOM.FE.CATALOG.2 PASS` mientras esos comandos sigan sin ejecutarse.
