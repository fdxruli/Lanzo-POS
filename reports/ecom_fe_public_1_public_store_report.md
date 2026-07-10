# ECOM.FE.PUBLIC.1 — Ruta pública, catálogo y carrito visual

Fecha de cierre: 2026-07-09

## 1. Resultado

**ECOM.FE.PUBLIC.1 PASS — alcance de la fase, sin errores nuevos.**

La implementación pública quedó aislada del shell POS, usa únicamente los contratos RPC públicos autorizados, incorpora catálogo, búsqueda, categorías y carrito visual, y no crea pedidos reales.

Validación específica:

- ESLint de todos los archivos creados/modificados por la fase: **PASS**.
- Vitest específico: **4 archivos / 17 pruebas PASS**.
- Vite build de producción: **PASS**.
- Preview final de Vercel: **READY**.
- Diff final: `package.json` y `vercel.json` sin cambios respecto de `main`.

La línea base global del repositorio no está completamente verde. Los fallos preexistentes se separan en la sección 14.

## 2. Arquitectura de la ruta pública

Se agregó detección previa al bootstrap en `src/main.jsx` mediante:

- `src/router/isPublicStorePath.js`
- `src/router/publicStoreRoutes.jsx`
- `src/router/preparePublicStoreDocument.js`

Rutas reconocidas:

- `/tienda`
- `/tienda/`
- `/tienda/:slug`
- `/tienda/:slug/`

Estas rutas crean un router público independiente. Cualquier otra ruta carga el POS mediante imports dinámicos y conserva el flujo existente.

## 3. Cómo se evita montar el shell POS

En una ruta pública no se importa ni monta `App`. Por tanto, el cliente no monta ni ejecuta:

- `WelcomeModal`, `SetupModal` o `StaffLoginModal`;
- `NavigationGuard`, `PermissionRoute` o `Layout`;
- navbar, ticker, `useSingleInstance` o notificaciones POS;
- realtime de licencia.

Las pruebas verifican que `/tienda/:slug` monta la página pública sin elementos del shell POS.

## 4. Cómo se evita iniciar storage y sincronización POS

Los módulos exclusivos del POS se importan dentro de `renderPosApplication()`:

- `storageManager`;
- `startPosSyncAutoBootstrap`;
- `installMobileZoomGuard`;
- `cleanupDevelopmentServiceWorkers`;
- logger, consola de desarrollo y `App`.

La rama pública no ejecuta `storageManager.initialize()`, bootstrap Dexie/IndexedDB, bootstrap de productos/ventas/caja/clientes, sincronización cloud ni bloqueo de zoom POS.

`preparePublicStoreDocument()` elimina en runtime público `maximum-scale` y `user-scalable` de la meta viewport, permitiendo zoom.

## 5. Archivos creados y modificados

### Modificado

- `src/main.jsx`

### Creados

- `src/router/isPublicStorePath.js`
- `src/router/preparePublicStoreDocument.js`
- `src/router/publicStoreRoutes.jsx`
- `src/router/__tests__/publicStoreRouting.test.jsx`
- `src/services/ecommerce/ecommercePublicService.js`
- `src/services/ecommerce/__tests__/ecommercePublicService.test.js`
- `src/hooks/ecommerce/usePublicCart.js`
- `src/hooks/ecommerce/__tests__/usePublicCart.test.jsx`
- `src/pages/PublicStorePage.jsx`
- `src/pages/PublicStorePage.css`
- `src/pages/__tests__/PublicStorePage.test.jsx`
- `src/components/ecommerce/public/PublicStoreErrorBoundary.jsx`
- `src/components/ecommerce/public/PublicStoreState.jsx`
- `src/components/ecommerce/public/PublicSafeImage.jsx`
- `src/components/ecommerce/public/PublicStoreHeader.jsx`
- `src/components/ecommerce/public/PublicCatalog.jsx`
- `src/components/ecommerce/public/PublicCartDrawer.jsx`

No se modificaron migraciones, RPC, datos de producción ni `vercel.json`.

## 6. Contratos RPC utilizados

El frontend público usa exclusivamente:

- `public.ecommerce_get_portal_by_slug(p_slug text)`
- `public.ecommerce_get_catalog(p_slug text, p_limit integer, p_offset integer)`

El servicio dedicado usa `supabaseClient.rpc(...)` con URL y publishable key normales.

No usa service role, tablas directas, `license_key`, `device_fingerprint`, `security_token`, `useAppStore`, IndexedDB/Dexie ni `ecommerce_create_order`.

Se agregó timeout de 12 segundos, normalización defensiva y errores públicos genéricos sin detalles internos de Supabase.

## 7. Estados de UI

Se implementaron estados para:

- cargando tienda;
- tienda no disponible;
- error de red con reintento;
- portal cargado y catálogo fallido parcialmente;
- catálogo cargando o vacío;
- búsqueda sin resultados;
- producto sin imagen;
- carrito vacío;
- mensajes por límites o disponibilidad.

El estado no disponible no revela licencia, plan, draft, pausa o deshabilitación.

## 8. Búsqueda y categorías

La búsqueda local cubre nombre y descripción. Las categorías se derivan de `categoryName`, se ordenan y se muestran con `Todos`.

La primera solicitud usa `limit = 100` y `offset = 0`. Si `pagination.hasMore` es verdadero, aparece `Cargar más`; ninguna llamada supera 100 productos.

No se agregaron tablas ni RPC.

## 9. Carrito visual

Permite agregar, incrementar, disminuir, escribir cantidad, eliminar, vaciar, ver unidades, subtotal, pedido mínimo y faltante.

Reglas:

- cantidades enteras positivas;
- máximo por artículo según `portal.maxItemQuantity`;
- máximo de líneas según `portal.maxOrderItems`;
- productos no disponibles o agotados no se agregan;
- cálculo monetario con `Big.js`;
- subtotal con precios del catálogo actual.

`Continuar pedido` permanece deshabilitado y no existe llamada a `ecommerce_create_order`.

## 10. Persistencia y revalidación

Clave:

`lanzo:ecommerce:cart:<slug>:v1`

Solo se guardan ID y cantidad en `sessionStorage`.

Al restaurar se eliminan productos inexistentes, no disponibles o agotados; se usan precios actuales; se aplican límites actuales; y cada slug conserva un carrito separado.

No se usa almacenamiento POS ni se confía en precios persistidos.

## 11. Reglas de stock FREE/PRO

La UI no infiere ni muestra el plan. Renderiza exclusivamente la respuesta pública:

- `hidden`: no muestra cantidad ni estado inventado;
- `status`: muestra disponible o agotado;
- `exact`: muestra cantidad solo si la RPC la entrega;
- `isAvailable === false` o `out_of_stock`: deshabilita Agregar.

No consulta, reserva ni descuenta inventario.

## 12. Seguridad y privacidad

Confirmado:

- cliente Supabase público dedicado y sin sesión persistente;
- sin service role, licencia, fingerprint o token POS;
- sin tablas directas ni nuevas concesiones;
- sin `dangerouslySetInnerHTML`;
- imágenes limitadas a `http`/`https` con fallback;
- sin analytics o fingerprinting;
- sin logs innecesarios de teléfonos;
- sin cambios en RLS, RPC o migraciones.

## 13. Pruebas ejecutadas

Resultado específico: **PASS — 4 archivos, 17 pruebas**.

- servicio público: 4;
- carrito: 3;
- página pública: 6;
- routing público: 4.

Cubren rutas públicas, ausencia de shell POS, zoom, RPC permitidas, ausencia de creación de pedido, errores seguros, stock oculto, portal/catálogo, búsqueda, categorías, disponibilidad, carrito, subtotal, límites, restauración por slug, precios actuales, error parcial y SEO.

## 14. Lint, test y build

### ESLint específico

**PASS** en `src/main.jsx` y todos los módulos/pruebas de la fase.

### `npm run lint` global

**FAIL preexistente**: 34 errores y 116 warnings en stores, pruebas heredadas y utilidades ajenas a esta fase. Ninguno corresponde a ECOM.FE.PUBLIC.1.

### Vitest específico

**PASS: 17/17**.

### `npm run test:ci` global

**FAIL preexistente**: 30 archivos y 79 pruebas fallidas en inventario, órdenes, NavigationGuard, backup, sincronización, notificaciones y otros módulos heredados.

No se afirma que la suite global esté verde; sí se confirma que las cuatro suites nuevas pasan.

### `npm run build`

**PASS**.

- Vite 7.2.2;
- 3267 módulos transformados;
- build en 22.42 segundos;
- PWA generada;
- solo warnings heredados de chunking/Browserslist.

## 15. Deployment preview

Preview final:

- Deployment: `dpl_38BV16vGuq9VYH6GmN322UqWAPZm`
- URL: `https://lanzo-jvtjkmi0a-fdxrulis-projects.vercel.app`
- Estado: **READY**
- Commit: `61a82f1eb276a11628e4f4c04e27eb8beab25d44`

El rewrite SPA existente se conservó. En un preview previo de la misma implementación se comprobó navegación directa a `/tienda` con HTTP 200 e `index.html`. El preview final está protegido por Vercel SSO, por lo que el verificador externo recibe 302 al login, no un 404 de aplicación.

Las pruebas validan `/tienda` y `/tienda/:slug`. El build separa `App`, `storageManager`, `mobileZoomGuard`, `posSyncBootstrapAutoCoordinator` y `useAppStore` en chunks cargados solo desde la rama POS.

## 16. Riesgos residuales

1. El portal QA conocido `qa-ecom-free-202607092110` está pausado; no se publicó ni modificó producción sin autorización.
2. No hubo smoke visual manual contra un portal publicado. Se usaron mocks y los contratos ya validados por `ECOM.QA.1 RETRY PASS`.
3. Lint y test global mantienen deuda preexistente que requiere una fase transversal.
4. El preview final requiere acceso SSO hasta el merge/despliegue de producción.
5. El horario es informativo y no bloquea carrito, conforme al alcance.
6. El carrito es temporal de sesión, conforme al alcance.

## 17. Pendientes para ECOM.FE.CHECKOUT.1

- formulario del cliente;
- método de entrega;
- validación final del mínimo;
- idempotency key;
- llamada a `ecommerce_create_order`;
- confirmación/número de pedido;
- WhatsApp Click-to-Chat, si se aprueba;
- revalidación final de artículos;
- reglas de horario y pedidos programados;
- pruebas de creación, idempotencia y rate limiting desde frontend.

## Criterios de aceptación

- ✅ `/tienda/:slug` funciona sin licencia.
- ✅ no monta `App`, shell POS o `WelcomeModal`.
- ✅ no inicia storage, sync, realtime o bloqueo de zoom POS.
- ✅ usa únicamente las dos RPC públicas permitidas.
- ✅ búsqueda, categorías, carrito, subtotal y `sessionStorage` funcionan.
- ✅ stock oculto no muestra cantidad exacta.
- ✅ no crea pedidos ni toca venta, caja o inventario.
- ✅ no envía licencia, fingerprint o tokens POS.
- ✅ no hay errores nuevos de lint, pruebas o build.
- ✅ Vercel genera preview READY y conserva el rewrite SPA.

**Conclusión: ECOM.FE.PUBLIC.1 PASS.**
