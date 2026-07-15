# FASE ECOM.PUBLIC.LEGACY.0 — Auditoría de compatibilidad heredada

**Fecha de auditoría:** 2026-07-14

**Workspace:** `C:\dev\Lanzo-POS-main`

**Estado de la fase:** COMPLETA

**Decisión:** MANTENER COMPATIBILIDAD Y OBSERVAR

## 1. Resumen ejecutivo

La aplicación conserva una separación funcional entre:

- `https://lanzo-pos.vercel.app`: build administrativo con soporte heredado de rutas públicas. El servidor devuelve el `index.html` administrativo y `src/main.jsx` decide en el navegador si monta el router público o el POS.
- `https://lanzo-store.vercel.app`: build público dedicado. No incluye el shell administrativo, manifest PWA ni service worker.

Las rutas públicas heredadas todavía responden en el origen administrativo y **no existen redirects cross-origin** hacia `lanzo-store.vercel.app`. La compatibilidad actual depende de la combinación de rewrite SPA, detección de ruta en `src/main.jsx`, router público y política del service worker.

No se encontró persistencia de URLs absolutas públicas de tienda o tracking en el código, migraciones ni almacenamiento cliente inspeccionado. Las URLs se generan en runtime desde `src/config/publicOrigins.js`. Sí existen riesgos externos no enumerables: QR ya impresos o descargados, WhatsApp, redes sociales, menús, capturas, marcadores, accesos directos, documentación y mensajes históricos.

La recomendación es **mantener la compatibilidad y observar** antes de retirar. No hay evidencia cuantitativa suficiente de tráfico histórico por ruta, ni una política confirmada de expiración para todos los tokens de tracking, y la coexistencia same-origin con el PWA administrativo merece una ventana de observación. Esta fase no autoriza ni inicia `LEGACY.1`.

## 2. Alcance y restricciones respetadas

Se auditó exclusivamente la compatibilidad heredada y la planificación de una retirada gradual.

No se hizo ninguna de las siguientes acciones:

- eliminar rutas, componentes o servicios;
- añadir redirects de producción;
- cambiar componentes productivos, `vercel.json`, `vercel.store.json`, service worker o configuración fuente;
- desplegar, crear previews, crear proyectos, dominios o recursos pagados;
- ejecutar SQL, migraciones, cambios de Supabase o escrituras remotas;
- crear órdenes o invocar `ecommerce_create_order`;
- usar Git/GitHub para cambiar refs, ramas, commits, push, PR, checkout o reset;
- añadir dependencias o modificar `package-lock`;
- habilitar SEO, dominio custom o indexación.

Se ejecutaron los builds que esta fase exige. Sus directorios generados (`dist` y `dist-store`) se regeneraron como artefactos de build; no se modificó código fuente.

## 3. Evidencia recopilada

| Área | Evidencia | Resultado |
|---|---|---|
| Código fuente | `src/main.jsx`, `src/main-store.jsx`, `src/router/publicStoreRoutes.jsx`, `src/router/isPublicStorePath.js` | La compatibilidad heredada está implementada deliberadamente en el build administrativo. |
| Configuración | `vercel.json`, `vercel.store.json`, `vite.config.js`, `vite.store.config.js` | El admin usa rewrite SPA y PWA; el store usa build separado, noindex y sin PWA. |
| Persistencia | Servicios públicos, hooks, cache Dexie, migraciones locales | No se encontró columna o clave de URL absoluta pública persistida. |
| PWA | `src/pwa/sw.js`, `src/pwa/publicNavigationPolicy.js`, `src/pwa/publicRouteWorkerUpdate.js` | El service worker administrativo excluye navegación pública del fallback offline y no se registra desde el store. |
| Builds | `npm run build`, `npm run build:store` | Ambos pasaron. |
| Pruebas | 21 archivos, 201 tests | Todas pasaron. |
| HTTP remoto | Alias de producción de ambos proyectos | El admin mantiene 200; el store normaliza trailing slash con 308. |
| Navegador | Chrome efímero con contexto limpio y contexto con PWA admin | Las rutas públicas renderizan UI controlada; el store no registra PWA. |
| Vercel | Snapshots de proyectos/despliegues y observabilidad agregada | No hubo nuevo despliegue durante la auditoría; no hubo errores runtime en los últimos 7 días. |

## 4. Inventario de rutas públicas y heredadas

### 4.1 Rutas reconocidas por el código

`src/router/publicStoreRoutes.jsx` define estas rutas para el router público:

| Ruta | Pantalla | Estado actual en admin | Estado actual en store |
|---|---|---|---|
| `/conoce-lanzo` | `PublicLanzoLandingPage` | Heredada, renderizada por la rama pública del admin | Canónica en el build público |
| `/tienda/:slug/pedido/:trackingToken` | `PublicOrderTrackingPage` | Heredada, renderizada por la rama pública del admin | Canónica en el build público |
| `/tienda/:slug` | `PublicStorePage` | Heredada, renderizada por la rama pública del admin | Canónica en el build público |
| `/tienda` | `PublicStoreNotFoundPage` | Heredada, renderiza estado controlado | Canónica como entrada sin slug del store |
| `*` dentro del public router | `PublicStoreNotFoundPage` | Solo aplica después de entrar a la rama pública | Aplica al build público |

`src/router/isPublicStorePath.js` reconoce de forma estricta:

- `/tienda` y `/tienda/`;
- `/tienda/<un segmento>` y su variante con trailing slash;
- `/tienda/<un segmento>/pedido/<un segmento>` y su variante con trailing slash;
- `/conoce-lanzo` y `/conoce-lanzo/`.

Una ruta arbitraria como `/tienda/a/b/c` no debe asumirse equivalente a la ruta pública catch-all: la detección de `main.jsx` no la selecciona como ruta pública. Cualquier redirect futuro debe usar el mismo contrato estricto, o auditar explícitamente los casos adicionales antes de cubrirlos.

### 4.2 Rutas no públicas que deben permanecer en el admin

`src/App.jsx` conserva, entre otras, `/`, `/caja`, `/pedidos`, `/pedidos-online`, `/productos`, `/clientes`, `/ventas`, `/configuracion`, `/acerca-de` y `/renovacion-urgente`. La ruta administrativa de pedidos online y sus parámetros internos no son equivalentes a una URL pública de tracking y no deben incluirse en una retirada de legacy público.

### 4.3 Enlaces de adquisición y retorno

- `PublicLanzoLandingPage` usa `buildAdminWelcomeUrl()` para sus CTAs de adquisición: `https://lanzo-pos.vercel.app/?welcome=1`.
- El retorno a una tienda usa `/tienda/<slug>` en el mismo origen público y valida el slug con `^[^/?#]+$`; no se observó open redirect.
- `PublicStorePage` usa el enlace relativo `/conoce-lanzo?tienda=<slug>`.
- `EcommercePortalSettings` genera el enlace público, QR y compartir WhatsApp desde `buildPublicStoreUrl()`; es código administrativo requerido y no debe retirarse junto con la vista pública.

## 5. Flujo de entrada y frontera de bundles

En `src/main.jsx`:

1. Se evalúa `isPublicStorePath(window.location.pathname)`.
2. Si coincide, se prepara el documento público, se intenta actualizar un service worker existente y se monta `renderPublicStore()`.
3. Si no coincide, se instala el documento PWA administrativo, se captura el prompt de instalación, se inicia el service worker admin y se carga dinámicamente `App.jsx` junto con sus servicios y stores.

Esto evita cargar `App.jsx` y `useAppStore` en la ruta pública directa, pero el admin build importa estáticamente el router público y sus dependencias desde el entry principal. Por tanto, el código público sí forma parte del entry del admin, aunque el shell POS no se monta en la navegación pública.

`src/main-store.jsx` monta exclusivamente el router público y no importa `App.jsx`, `useAppStore`, el PWA administrativo ni los repositorios administrativos.

### 5.1 Implicación para la retirada

Retirar la compatibilidad del admin podrá reducir complejidad y el peso del entry administrativo, pero no se puede atribuir un ahorro exacto a los bytes de la parte pública sin generar un build contrafactual removiendo esos imports. En esta fase no se hizo esa modificación, por lo que no se inventa una cifra de ahorro.

## 6. Separación de servicios y Supabase

`src/services/supabasePublic.js` crea `supabasePublicClient` con clave publicable y:

```js
{
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storageKey: 'lanzo-public-store-auth'
}
```

El servicio público usa ese cliente para RPCs públicas de portal, catálogo y tracking. La página pública no importa el cliente administrativo ni `useAppStore`.

| Operación | Servicio | Tipo | Ejecutada durante la auditoría |
|---|---|---|---|
| `ecommerce_get_portal_by_slug` | `ecommercePublicService` | Lectura pública | Sí, con slug sintético no existente |
| `ecommerce_get_catalog` | `ecommercePublicService` | Lectura pública | No fue necesario invocarla en la prueba de error |
| `ecommerce_get_order_tracking` | `ecommerceOrderTrackingService` | Lectura pública | Sí, con token sintético de formato válido y sin registro |
| `ecommerce_create_order` | `ecommercePublicService` | Escritura de orden | No |
| Realtime de tracking | `ecommerceOrderTrackingService` | Suscripción pública acotada | No fue necesario abrir una suscripción válida |

La prueba de token sintético válido produjo una respuesta 200 JSON de tracking no encontrado, con CORS permitido para `https://lanzo-store.vercel.app`. La solicitud usó el cliente público; se observaron headers `apikey` y `authorization` con prefijo `Bearer`, correspondientes a la clave publicable, no a una sesión administrativa. No hubo escritura ni creación de orden.

## 7. Persistencia y clasificación de URL

### 7.1 Código, migraciones y almacenamiento cliente

La búsqueda de `store_url`, `tracking_url`, `portal_url`, `checkout_url`, `share_url`, `absolute_url` y `redirect_url` fuera de pruebas/documentación no encontró campos de URL pública persistida.

Las migraciones de órdenes usan token hash/HMAC y retornan transitoriamente `trackingToken` y `trackingPath` relativo (`/tienda/<slug>/pedido/<token>`). No almacenan una URL absoluta del store. `metadata` de la orden contiene el origen `public_store`, no un link.

| Dato | Forma observada | Persistencia | Riesgo para legacy |
|---|---|---|---|
| Host público | `https://lanzo-store.vercel.app` | Configuración/runtime | Bajo en DB; alto en artefactos externos ya distribuidos |
| Host admin | `https://lanzo-pos.vercel.app` | Configuración/runtime para adquisición | No debe redirigirse indiscriminadamente: sigue siendo destino de onboarding |
| Store URL | `/tienda/<slug>` o URL absoluta generada | Cache/uso de runtime, no columna de URL | Los QR y copias externas pueden conservarla |
| Tracking path | `/tienda/<slug>/pedido/<token>` | URL actual del navegador; el token se almacena server-side como hash | Alto: puede existir en WhatsApp, marcadores o mensajes; no se debe romper prematuramente |
| Tracking cache key | Hash de `slug:token` en `sessionStorage` | Solo cache cliente | No es una URL redirigible por sí misma |
| Carrito | `lanzo:ecommerce:cart:<slug>:v1` | `sessionStorage` | Misma-origin; no contiene host absoluto |
| Idempotencia checkout | `lanzo:ecommerce:checkout-attempt:<slug>:v1` | `sessionStorage` | Misma-origin; no contiene URL absoluta |
| Cache público | Dexie `lanzo-public-store-cache` | `pages`/`portals` sanitizados | Contiene datos de catálogo/portal e imágenes; no ruta pública absoluta persistida |
| Imágenes/logo | URLs proporcionadas por el usuario o catálogo | Portal/cache | Pueden ser absolutas, pero no son rutas públicas del store |

No se inspeccionaron registros reales de clientes, órdenes, QR ni mensajes, de acuerdo con el alcance read-only y la prohibición de enumerar datos reales. La ausencia de una columna en el esquema no prueba la ausencia de links históricos fuera de la aplicación.

### 7.2 Fuentes externas no enumerables

Deben tratarse como dependencias potenciales hasta contar con evidencia operacional: QR impresos, PNG/SVG de QR descargados, WhatsApp, redes sociales, menús físicos, tickets, correos, capturas, favoritos, accesos directos, documentación, anuncios y textos copiados por clientes.

## 8. Service worker, PWA, cookies y almacenamiento same-origin

### 8.1 Service workers

`src/pwa/sw.js` registra primero una navegación `NetworkOnly` para rutas públicas y después el fallback precacheado administrativo con denylist:

```txt
^/api
^/auth
^/tienda
^/conoce-lanzo
```

Consecuencia: si el service worker admin ya existe y controla el origen, una navegación pública online se sirve por red y no cae al shell admin offline. En la prueba offline, una ruta pública heredada no obtuvo el fallback administrativo; el navegador falló la navegación de red. Esto es preferible a mostrar el POS, pero sigue siendo un comportamiento que debe observarse durante cualquier migración.

`publicRouteWorkerUpdate.js` solo solicita `registration.update()` si ya existe una registration; no registra un worker nuevo desde la ruta pública.

En un contexto limpio contra `lanzo-store.vercel.app` no se observó registration, controller ni descarga de `sw.js`. El build público tampoco contiene manifest, Workbox ni source maps.

### 8.2 Misma origin

El hecho de que el admin legacy y sus rutas públicas compartan origen significa que comparten capacidades de navegador aunque el código público no las consuma deliberadamente:

| Capacidad | `lanzo-pos.vercel.app` | `lanzo-store.vercel.app` |
|---|---|---|
| Cookies/localStorage same-origin | Compartidos con admin | Origen independiente |
| IndexedDB admin | Disponible si fue creado por una visita admin (`LanzoDB1`) | No visible en contexto limpio |
| localStorage observado | `lanzo_device_id`, `lanzo-active-orders-storage` después de visitar admin | Vacío en contexto limpio |
| Service worker | Puede existir con scope `/` después de visitar admin | No se registra en la ruta pública |
| Cliente Supabase | Público en rama pública; admin solo en rama admin | Público |
| `useAppStore`/shell POS | No cargado en visita pública directa | No incluido |

La convivencia es actualmente controlada por código y política PWA, no por aislamiento de origen. Por eso la retirada futura debe incluir pruebas con contexto limpio, contexto ya autenticado y contexto con service worker activo.

## 9. Fuentes de URLs antiguas y generación actual

La fuente central es `src/config/publicOrigins.js`:

- `DEFAULT_ADMIN_APP_ORIGIN = https://lanzo-pos.vercel.app`;
- `DEFAULT_PUBLIC_STORE_ORIGIN = https://lanzo-store.vercel.app`;
- `buildPublicStoreUrl(slug)` y `buildPublicTrackingUrl(slug, token)` generan links del store nuevo;
- `buildAdminWelcomeUrl()` genera el onboarding administrativo intencional.

No se encontró un generador runtime de `https://lanzo-pos.vercel.app/tienda/...`. Las ocurrencias del dominio antiguo de rutas públicas están en pruebas, documentación, fixtures o evidencia histórica, no en un generador productivo vigente.

El QR administrativo y el botón de WhatsApp usan el origen público nuevo. El componente QR compartido no es legacy público: sigue siendo necesario en `EcommercePortalSettings` para administración.

## 10. Snapshot remoto inicial y final

El equipo consultado fue `fdxrulis-projects` (`team_buvft2mAJErTNR8gDhXcZGfS`). El snapshot final coincide con el inicial.

| Proyecto | Project ID | Deployment producción actual | Estado | Dominios observados |
|---|---|---|---|---|
| `lanzo-pos` | `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr` | `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE` | READY | `lanzo-pos.vercel.app`, alias de proyecto y alias de `main` |
| `lanzo-store` | `prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4` | `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg` | READY | `lanzo-store.vercel.app`, dos alias de proyecto |

Características observadas:

- ambos proyectos tienen `live: false` según la API consultada;
- el admin es Vite con Node 22.x;
- el store es un build estático separado con Node 24.x y sin framework declarado;
- no se creó deployment, preview, proyecto ni dominio durante esta fase;
- el despliegue admin sigue asociado a `main` y SHA `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`;
- el despliegue store actual figura como `source: cli` y actor de despliegue `codex`, sin mutarlo.

Los valores HTTP observados en la auditoría fueron:

| Origen | Entrada | Resultado | Headers relevantes |
|---|---|---|---|
| Admin | `/`, `/tienda`, `/tienda/<slug>`, tracking, `/conoce-lanzo` | 200, sin `Location` | HTML admin 2,513 bytes; `Cache-Control: public, max-age=0, must-revalidate`; sin `X-Robots-Tag` |
| Admin | variantes con trailing slash | 200, sin redirect | Conservan el comportamiento SPA; COOP se observó de forma inconsistente entre algunas variantes |
| Store | `/`, `/tienda`, `/tienda/<slug>`, tracking, `/conoce-lanzo` | 200, sin `Location` | HTML público 1,117 bytes; `X-Robots-Tag: noindex, nofollow, noarchive`; `Cache-Control: public, max-age=0, must-revalidate` |
| Store | `/tienda/`, `/tienda/<slug>/`, `/conoce-lanzo/` | 308 a versión slashless | `Location` conserva query string; después responde 200 |
| Store | `/robots.txt` | 200 | `User-agent: *` y `Disallow: /` |
| Store | `/manifest.webmanifest`, `/sw.js`, `/sitemap.xml` | 404 | No PWA ni sitemap público |
| Admin | `/manifest.webmanifest`, `/sw.js` | 200 | Manifest admin 467 bytes; service worker 27,994 bytes |
| Admin | `/robots.txt`, `/sitemap.xml` | 200 con HTML fallback | No son robots/sitemap dedicados |

La entrada remota del admin observada fue `/assets/index-CLPq5GKE.js`; la entrada generada localmente por la auditoría fue `/assets/index-DfdZQ0Tt.js`. No se hizo deploy, por lo que no se pretende equivalencia byte a byte entre el artefacto local y la producción actual.

La prueba de query fue explícita: `/tienda/?utm_source=qr&x=1` redirigió a `/tienda?utm_source=qr&x=1`, y lo mismo para slug y landing. El fragmento URL no se envía en la solicitud HTTP; una futura redirección server-side no puede observarlo ni copiarlo.

## 11. Validación funcional en navegador

Se utilizó Chrome instalado en un contexto Playwright efímero, sin perfil personal, sin credenciales y sin datos reales. El CLI `agent-browser` no estaba instalado; se documenta el fallback usado para mantener la verificación visual y de red read-only.

### 11.1 Admin origin

- `/` mostró el welcome/admin shell y creó las claves/DB propias del admin.
- `/tienda/slug-inexistente-seguro` mostró `public-store-shell` y estado controlado de tienda no disponible.
- `/tienda/slug-inexistente-seguro/pedido/token-invalido-seguro` mostró estado controlado de tracking no encontrado; el token malformado fue rechazado localmente.
- `/conoce-lanzo` mostró `public-lanzo-landing`.
- después de visitar `/`, el service worker admin quedó activo y controló las rutas públicas; las solicitudes públicas no recibieron el fallback admin offline.
- no se cargaron chunks `App`, `PosPage` ni shell administrativo en las visitas públicas directas.

Se observaron warnings de persistencia/almacenamiento volátil y un `pageerror` con valor `undefined` en el arranque administrativo del entorno headless. No se reprodujeron en el contexto público limpio ni bloquearon las rutas auditadas; quedan como ruido de entorno, no como evidencia para retirar rutas.

### 11.2 Store origin

- tienda inexistente, tracking inválido y landing mostraron UI pública controlada;
- no hubo console errors ni page errors en el contexto limpio;
- no se observó registration/controller de service worker;
- solo se descargaron entry/vendor/CSS públicos, sin chunks POS;
- para slug inexistente se observó únicamente la lectura pública de portal;
- para token con formato válido pero sin registro se observó la lectura pública de tracking y una respuesta 200 JSON no encontrado;
- no se invocó `ecommerce_create_order`.

## 12. Tests y builds ejecutados

### 12.1 Tests dirigidos

Resultado: **21 archivos de test pasaron; 201 tests pasaron**.

Se cubrieron rutas públicas, origins, arquitectura de cutover/build, PWA admin, deployment architecture, landing, store, checkout, tracking, confirmación de orden, QR, enlaces públicos, navegación pública, actualización del worker y prebuilt deployment.

El script existente `scripts/audit-public-cutover.mjs` también pasó sus checks sobre origins, builders, router, denylist PWA, ausencia de redirects admin, fallback, trailing slash y flags noindex del store.

### 12.2 Build admin

Comando: `npm run build`

- Vite 7.2.2;
- 3,333 módulos transformados;
- 74 archivos en `dist`;
- 6,349,691 bytes totales;
- entry admin: `dist/assets/index-DfdZQ0Tt.js`, 384,575 bytes;
- CSS global: `dist/assets/index-DTvjd8jq.css`, 73,832 bytes;
- `dist/sw.js`, 27,994 bytes;
- manifest admin, 467 bytes;
- 26 entradas de precache Workbox;
- warning no bloqueante de Vite por imports estático/dinámico existentes de `useMessageStore` y `src/services/supabase.js`.

### 12.3 Build store

Comando: `npm run build:store`

- Vite 7.2.2;
- 1,809 módulos transformados;
- 9 archivos en `dist-store`;
- 724,601 bytes totales;
- entry público `dist-store/assets/index-CIg2B-UP.js`, 89,185 bytes;
- CSS público `dist-store/assets/index-HgNJK_No.css`, 57,675 bytes;
- vendors públicos separados para icons, React, store, Supabase y resto público;
- sin manifest, service worker, Workbox ni source maps.

## 13. Peso y candidatos de retiro

### 13.1 Lo que sí puede atribuirse con seguridad

El build público aislado pesa 724,601 bytes, pero ese valor es el costo total del build store, no el ahorro que produciría retirar el legacy del admin.

En el admin, los módulos públicos se encuentran dentro del entry `index-DfdZQ0Tt.js` y del CSS global, que también contienen código administrativo o compartido. Por eso no se asigna como ahorro la suma de 384,575 + 73,832 bytes.

La estimación de ahorro de esta fase es: **no calculable con precisión sin un build contrafactual**. La confianza de cualquier cifra basada solo en chunks actuales sería baja.

### 13.2 Candidatos de código

Después de la ventana de observación, los candidatos de retiro serían:

- `src/pages/PublicStorePage.jsx`;
- `src/pages/PublicOrderTrackingPage.jsx`;
- `src/pages/PublicLanzoLandingPage.jsx`;
- componentes bajo `src/components/ecommerce/public/`;
- `src/services/ecommerce/ecommercePublicService.js`;
- `src/services/ecommerce/ecommerceOrderTrackingService.js`;
- `src/services/ecommerce/ecommercePublicCatalogCache.js`;
- `src/services/ecommerce/ecommerceCheckoutIdempotency.js`;
- `src/hooks/ecommerce/usePublicCart.js`;
- CSS público asociado.

No son candidatos de retiro automático:

- `src/config/publicOrigins.js`, porque el admin sigue generando URLs públicas y el onboarding admin;
- `src/components/ecommerce/PublicStoreQrCode.jsx`, porque `EcommercePortalSettings` lo usa administrativamente;
- servicios/repositorios de pedidos online admin;
- `LogoMark`, lucide, React, Supabase y estilos compartidos mientras sigan siendo usados por admin.

## 14. Riesgos de compatibilidad

| Riesgo | Evidencia | Severidad | Tratamiento recomendado |
|---|---|---:|---|
| QR viejo apunta a admin | Los QR se comparten externamente; no se enumeraron archivos impresos | Alta | Mantener alias; medir hits por ruta antes de retirar |
| Links de WhatsApp/social/documentos | No hay inventario de mensajes o publicaciones | Alta | Mantener; buscar evidencia de uso en fuentes operativas durante observación |
| Tracking histórico | Token puede estar en URLs externas; esquema devuelve token transientemente y puede tener expiración nullable | Alta | No eliminar pronto; probar redirect sin lookup y validar token byte a byte |
| Cache/bookmarks | Cliente puede conservar URL del admin | Media | Redirect 307/308 server-side después de evidencia |
| Misma origin/PWA | Admin SW puede controlar rutas públicas; fallback excluido por denylist | Alta | Probar contexto con SW activo y offline en cada etapa |
| SEO admin | Admin no tiene `X-Robots-Tag`; robots/sitemap caen al HTML admin | Media | Antes de SEO, definir canonical, robots, sitemap y destino oficial |
| SEO store | Store tiene noindex/no-follow y `Disallow: /` | Media | No retirar noindex en esta fase; requiere decisión separada |
| Query string | Vercel conserva query al normalizar slash | Baja | Mantener query; verificar parámetros de tracking/UTM en cada redirect |
| Fragment `#...` | No se transmite al servidor | Media | Si fuera necesario, conservarlo con script cliente o aceptación explícita de pérdida |
| Wildcards ambiguos | `isPublicStorePath` no cubre cualquier `/tienda/*` | Alta | Mapear solo contratos reconocidos; no usar catch-all ciego |
| Dependencia de origen admin para adquisición | Landing pública envía a `lanzo-pos.vercel.app/?welcome=1` | Media | Excluir `/?welcome=1` de cualquier redirect global |

## 15. Compatibilidad same-origin: conclusión

La separación lógica actual es correcta, pero no es aislamiento de seguridad ni de almacenamiento. El admin y el legacy comparten cookies, localStorage, IndexedDB y el scope potencial `/` del service worker. La rama pública no utiliza el store administrativo, y los tests de arquitectura confirman esa frontera, pero la coexistencia debe tratarse como una dependencia de migración.

No se observó una escritura de Supabase ni uso de sesión admin desde las rutas públicas. El riesgo principal no es la lectura cruzada observada, sino el comportamiento futuro o accidental si se modifica el bootstrap, el service worker, una clave de almacenamiento o un componente compartido.

## 16. Compatibilidad HTTP, query y fragment

### 16.1 Contratos que debe conservar una futura migración

| Entrada heredada | Destino recomendado | Reglas |
|---|---|---|
| `/tienda` | `https://lanzo-store.vercel.app/tienda` | Conservar query; no hacer lookup de portal para redirigir |
| `/tienda/<slug>` | `https://lanzo-store.vercel.app/tienda/<slug>` | Conservar slug; normalizar solo slash; conservar query |
| `/tienda/<slug>/pedido/<token>` | `https://lanzo-store.vercel.app/tienda/<slug>/pedido/<token>` | No modificar token, no decodificar/re-encodear innecesariamente, no hacer lookup antes del redirect |
| `/conoce-lanzo` | `https://lanzo-store.vercel.app/conoce-lanzo` | Conservar `tienda`, UTM y soporte; no redirigir el CTA de adquisición admin |

La URL destino debe ser una origin allowlisted y fija; nunca se debe tomar el hostname desde un parámetro del usuario. Los fragmentos no pueden preservarse con una regla HTTP pura porque el navegador no los envía al servidor.

### 16.2 Estrategias candidatas

| Estrategia | Código HTTP/efecto | Ventaja | Riesgo/limitación | Recomendación |
|---|---|---|---|---|
| Mantener 200 actual | 200 + render público | Máxima compatibilidad | Mantiene código y dependencia PWA | Elegida ahora |
| Redirect Vercel server-side | 307/308, o 302 temporal | Ocurre antes del JS, medible y reversible | Requiere reglas exactas y prueba de query | Preferida en LEGACY.1 para etapa temporal |
| `window.location.replace()` | Navegación cliente | Fácil de añadir | Primer 200/JS, peor para SEO/offline y puede generar loops | No preferida |
| Redirect React | Render/efecto en cliente | Puede reutilizar router | Descarga bundle y depende del runtime | Solo contingencia |
| Rewrite cross-origin | Mantiene URL admin visible | No rompe link visible | No prueba separación real; cookies/origin y observabilidad confusas | No recomendada |
| 410 Gone | 410 | Señal explícita de retiro | Rompe todos los enlaces | Solo después de evidencia fuerte y comunicación |
| Eliminar ruta/catch-all | 404 o shell admin | Menor mantenimiento final | Mayor riesgo de ruptura silenciosa | Último paso |

## 17. Tratamiento gradual por familia de rutas

| Familia | Etapa A — compatibilidad | Etapa B — transición | Etapa C — observación | Etapa D — retiro |
|---|---|---|---|---|
| `/tienda` | Mantener 200 | 307 temporal al store | Medir hits, status, query y soporte | Eliminar solo con evidencia |
| `/tienda/:slug` | Mantener 200 | 307 temporal al mismo slug en store | Vigilar QR/WhatsApp y slug inválido | Eliminar después de ventana acordada |
| tracking | Mantener por más tiempo | 307 sin lookup, token intacto | Confirmar tokens activos/expiración y soporte | Retiro tardío; considerar mantener indefinidamente si no existe expiración comprobable |
| `/conoce-lanzo` | Mantener 200 | 307/308 al store | Verificar CTAs, `tienda`, UTM y onboarding | Retirar cuando el store sea destino consolidado |
| trailing slash | Mantener compatibilidad | Redirigir al canonical slashless del store | Confirmar query/fragment/analytics | Consolidar con la regla de la familia |
| `/?welcome=1` | Mantener admin | No redirigir | Verificar onboarding | Fuera de legacy público |

La secuencia sugerida es `A → B → C → D`, pero el tracking debe permanecer en A hasta comprobar que los tokens históricos ya no requieren soporte. No se recomienda una fecha de retiro basada únicamente en la fecha del despliegue.

## 18. Observabilidad requerida antes de LEGACY.1

La auditoría no contó visitas reales por ruta porque no se accedió a datos de clientes ni a analytics con paths potencialmente sensibles. La API de Vercel consultada mostró:

- sin runtime errors agregados en los últimos 7 días para `lanzo-pos`;
- sin runtime errors agregados en los últimos 7 días para `lanzo-store`;
- el conteo de logs de runtime no ofrece por sí mismo un contador fiable de visitas estáticas; en `lanzo-store` aparecieron 6 eventos agrupados como `redirect`, consistentes con las comprobaciones de trailing slash de esta auditoría;
- no se tomó esa señal como evidencia de tráfico histórico de clientes.

Antes de añadir redirects se necesita una fuente de observación agregada y sin datos sensibles que permita, como mínimo:

1. contar solicitudes por familia de ruta y status;
2. distinguir trailing slash de la ruta canónica;
3. registrar destino y motivo de redirect sin token completo;
4. detectar errores 4xx/5xx y loops;
5. correlacionar soporte de QR/WhatsApp sin almacenar tokens crudos;
6. conservar una ventana suficiente para cubrir menús, campañas y ciclos de pedidos.

## 19. SEO e indexación

El store actual aplica globalmente `X-Robots-Tag: noindex, nofollow, noarchive`, además de `robots.txt` con `Disallow: /`, y no tiene sitemap válido. El admin legacy responde HTML sin `X-Robots-Tag`, y sus `robots.txt`/`sitemap.xml` reciben el fallback HTML por la rewrite SPA. El HTML estático no aporta canonical público.

Esto significa:

- no debe interpretarse el estado actual como SEO listo;
- pueden existir respuestas HTML duplicadas en dos orígenes, aunque el contenido real se complete en el cliente;
- antes de retirar o habilitar SEO debe decidirse el origen canónico, canonical, robots, sitemap, headers y estrategia de redirect;
- esta fase no cambia ninguno de esos controles.

## 20. Plan de rollback conceptual

### Si LEGACY.1 introduce redirects

Rollback: retirar únicamente las reglas de redirect y restaurar el deployment administrativo anterior que ya soporta las rutas públicas, sin tocar Supabase, órdenes ni tokens. El store independiente permanece intacto.

### Si una etapa posterior elimina el código público del admin

Rollback: promover el último deployment administrativo compatible o volver a construir el artefacto que contiene `main.jsx`, router público y componentes públicos. Debe conservarse una copia de las reglas de compatibilidad y de la matriz de rutas.

### Invariantes de rollback

- no borrar deployments históricos;
- no revocar ni regenerar tokens de tracking;
- no modificar datos de órdenes;
- no cambiar el origen público nuevo;
- no convertir un redirect temporal en permanente como parte del rollback;
- comprobar `/tienda`, slug, tracking y `/conoce-lanzo` en ambos origins después de restaurar.

## 21. Criterios de entrada para LEGACY.1

No se deben iniciar cambios de producción hasta que exista:

- decisión aprobada sobre el destino canónico y el dominio futuro;
- ventana de observación acordada, especialmente para tracking;
- inventario o evidencia suficiente de QR/WhatsApp/documentación;
- métrica agregada de requests por familia de ruta;
- prueba automatizada de 307/308, query, trailing slash, slug, token y exclusión de `/?welcome=1`;
- prueba con PWA admin activo, contexto limpio y modo offline;
- plan para `robots.txt`, canonical y `X-Robots-Tag` si se cambia SEO;
- rollback probado y un deployment compatible conservado.

## 22. Recursos creados durante esta fase

| Recurso | Cantidad |
|---|---:|
| Deployments | 0 |
| Previews | 0 |
| Proyectos | 0 |
| Dominios | 0 |
| Serverless/Edge Functions nuevas | 0 |
| Órdenes | 0 |
| Escrituras Supabase | 0 |
| Dependencias nuevas | 0 |
| Recursos pagados | 0 |

## 23. Archivos y artefactos

### Creado

- `docs/reports/ECOM.PUBLIC.LEGACY.0.md` — este informe.

### Regenerado por los builds permitidos

- `dist/**` — salida del build administrativo;
- `dist-store/**` — salida del build público.

### No modificado

- código fuente `src/**`;
- `package.json` y `package-lock.json`;
- `vercel.json` y `vercel.store.json`;
- service worker fuente y configuración PWA;
- migraciones y configuración Supabase;
- tests y scripts existentes.

## 24. Conclusión de la fase

La compatibilidad heredada está viva, funciona en los casos reconocidos y tiene cobertura local, de build, HTTP y navegador. La arquitectura actual ya separa el build público y evita que el public route bootstrap monte el POS, pero el origen administrativo sigue siendo una entrada externa válida y comparte scope/capacidades del navegador con el PWA.

Por los QR, enlaces externos, tokens de tracking potencialmente duraderos, falta de tráfico histórico enumerado y decisión SEO todavía abierta, la salida segura de esta fase es:

> **MANTENER COMPATIBILIDAD Y OBSERVAR.**

La fase termina aquí. No se elimina ninguna ruta, no se añade ningún redirect y no se inicia `FASE ECOM.PUBLIC.LEGACY.1`.
