# FASE ECOM.PUBLIC.ARCH.0 — Línea base y contrato de arquitectura para separar las tiendas públicas

Estado de la fase: **INCOMPLETA**.

Motivo de no cierre: la copia local en C:\dev\Lanzo-POS-main no contiene un directorio .git. No fue posible registrar HEAD, rama ni estado del árbol de trabajo, tres datos obligatorios para declarar completa la fase. La auditoría estática, el build, el inventario de precache, la prueba local y el contrato futuro sí quedaron documentados.

## 1. Resumen ejecutivo

La separación actual es parcial:

- La clasificación de la URL ocurre en src/main.jsx y App.jsx se importa dinámicamente sólo para las rutas no públicas. En una visita limpia a /tienda/mi-negocio no se solicitaron chunks con nombres PosPage, CajaPage, DashboardPage o SettingsPage.
- La separación no existe en la entrega HTML ni en el build. Vercel sirve el mismo index.html para todas las rutas, y ese documento anuncia Lanzo POS, su manifiesto, sus iconos, sus colores y la captura global de beforeinstallprompt.
- Las páginas de tienda, tracking y landing se importan estáticamente juntas desde publicStoreRoutes.jsx; no tienen chunks independientes.
- La entrada pública importa el servicio público, que reutiliza el cliente monolítico src/services/supabase.js. El chunk de entrada generado mide 723,887 bytes e incluye cadenas y funciones administrativas demostrables, aunque App.jsx permanezca en otro chunk.
- Un navegador limpio no registró un Service Worker nuevo: el registro está dentro del componente administrativo UpdatePrompt y el index.html generado no contiene un registro global. Este punto cambió respecto del diagnóstico anterior.
- El Service Worker administrativo sigue registrándose con scope / y su navegación fallback sólo excluye /api y /auth. Un SW preexistente sí controla /tienda/....
- El precache generado declara 76 entradas, 72 URL únicas y 6,320,476 bytes de cuerpos. Incluye los 46 archivos JavaScript de assets, 17 CSS, index.html, manifest.webmanifest e imágenes. Se clasificaron conservadoramente 41 recursos administrativos por nombre explícito.
- La caché nueva del catálogo en IndexedDB reduce llamadas: con la misma revisión, una segunda visita hace una RPC de portal y cero RPC de catálogo para las páginas ya cacheadas. No reduce el JavaScript del entry ni el precache administrativo.

Conclusión ejecutiva: el diagnóstico anterior sigue vigente para HTML, PWA, scope, fallback y precache; ya no es correcto afirmar que una visita pública limpia carga App.jsx o descarga por el grafo normal todos los chunks administrativos. La descarga masiva ocurre al instalar o actualizar el SW administrativo, y el entry público todavía contiene código administrativo indirecto por el cliente Supabase compartido.

## 2. Alcance y restricciones

Se realizó exclusivamente inspección local, medición, documentación y definición de contrato. No se modificó comportamiento de producción.

No se realizaron:

- operaciones remotas de Git;
- commits, ramas, tags, PR o releases;
- despliegues o cambios en Vercel;
- escrituras, migraciones, RPC de escritura o cambios en Supabase;
- pedidos reales;
- cambios de PWA, scope, manifiesto, rutas, checkout, tracking, POS o caché de producción.

El único build fue npm run build. Los scripts de auditoría son opt-in, usan Node.js estándar, no participan en build/dev/test y no escriben en dist. El script de navegador sólo acepta loopback y bloquea DNS no local.

## 3. Estado local inspeccionado

Medición inicial: 2026-07-13T17:52:42-06:00, zona America/Mexico_City.

| Dato | Valor |
| --- | --- |
| Directorio | C:\dev\Lanzo-POS-main |
| Rama local | No disponible: no existe .git |
| HEAD local | No disponible: no existe .git |
| git status --short | No disponible: no es un repositorio Git |
| Árbol con cambios previos | No determinable sin .git |
| Node.js | v22.12.0 |
| npm | 10.9.0 |
| Sistema operativo | Microsoft Windows NT 10.0.19045.0, X64 |
| package | lanzo-pos-react 4.0.0 |

La ausencia de .git fue comprobada antes del análisis. No se ejecutó ningún comando destructivo y no se intentó reconstruir o descargar metadata Git.

Archivos de diagnóstico creados:

- docs/reports/ECOM.PUBLIC.ARCH.0.md
- docs/reports/ecom-public-arch-0/browser-clean-store.png
- docs/reports/ecom-public-arch-0/browser-landing.png
- scripts/audit-public-delivery.mjs
- scripts/audit-public-browser.mjs

dist fue regenerado por el build obligatorio. No puede determinarse su diff respecto del estado inicial por la ausencia de Git.

## 4. Arquitectura de entrada actual

### Clasificación y momento de decisión

src/main.jsx importa estáticamente React, ReactDOM, React Router, publicStoreRoutes, isPublicStorePath, preparePublicStoreDocument y nueve hojas de estilo antes de evaluar la ruta (líneas 1-15). La decisión se toma al final del módulo, en líneas 126-130:

- /tienda;
- /tienda/:slug;
- /tienda/:slug/pedido/:trackingToken;
- /conoce-lanzo;
- variantes con slash final.

La expresión está en src/router/isPublicStorePath.js:1-5. Rutas adicionales bajo /tienda, por ejemplo /tienda/uno/dos, no son públicas.

Si la ruta es pública se crea un createBrowserRouter con publicStoreRoutes. Si no lo es, renderPosApplication inicia importaciones dinámicas en src/main.jsx:32-53, entre ellas App.jsx, Google OAuth, StorageManager, ErrorBoundary y sincronización del POS.

### Importación de App y módulos siempre presentes

App.jsx es dinámico, no estático. El build confirma un chunk App-Dnac6Gk8.js independiente de 376,594 bytes.

Siempre forman parte del grafo público:

- React, ReactDOM y React Router;
- lucide-react;
- estilos globales y públicos;
- las tres páginas públicas;
- componentes públicos de tienda/checkout;
- Dexie y la caché pública;
- @supabase/supabase-js;
- src/services/supabase.js y dependencias alcanzadas desde él.

src/router/publicStoreRoutes.jsx:1-5 importa estáticamente PublicLanzoLandingPage, PublicOrderTrackingPage y PublicStorePage. Por ello tienda, tracking y landing están juntas en assets/index-DsZQ-AIF.js; no existen chunks públicos separados.

### Código administrativo alcanzado por la entrada pública

src/services/ecommerce/ecommercePublicService.js:1 importa el singleton desde src/services/supabase.js. Este último importa FingerprintJS, utilidades, base local y Logger en sus líneas 1-5 y contiene contratos de licencia, dispositivos y otros flujos administrativos.

La inspección del chunk de entrada encontró, entre otras, las cadenas:

- create_free_trial_license;
- device_security_token;
- staff_session_token;
- get_business_profile_anon;
- release_device_anon;
- AssistantBot;
- LanzoDB.

Esto demuestra inclusión en el JavaScript solicitado, no ejecución de esas operaciones. No se observó ninguna llamada administrativa durante la navegación pública bloqueada.

### Efectos anteriores a la clasificación

Antes de la condición de src/main.jsx:

1. index.html lee localStorage[theme-preference], cambia data-theme y theme-color e instala un MutationObserver (index.html:24-71).
2. index.html crea window.deferredPwaPrompt y listeners beforeinstallprompt/appinstalled (index.html:74-88).
3. Los imports ESM estáticos se evalúan.
4. Se crea el singleton Supabase en src/services/supabase.js:8-15.
5. Se instancia el objeto Dexie por defecto en ecommercePublicCatalogCache.js:289-299; la base se abre cuando se usa.

Por tanto, la separación actual es de arranque React y carga dinámica de App, no de HTML ni de build.

### Distinciones necesarias

- Importado por la entrada: las páginas públicas, el servicio público y el cliente Supabase compartido.
- Incluido en el build: también App, POS, caja, dashboard, configuración y demás chunks lazy.
- Precargado por Workbox: los 46 JS de assets, incluidos todos los anteriores.
- Solicitado por navegador limpio: cinco JS del entry/preloads; cero chunks administrativos con nombre propio.
- Ejecutado por React público: únicamente el router/página pública correspondiente; la presencia de una función en el bundle no prueba su ejecución.

## 5. Enrutamiento actual

vercel.json:23-27 contiene un único rewrite:

| Ruta | HTML local/Vercel configurado |
| --- | --- |
| / | /index.html |
| /pos | /index.html |
| /dashboard | /index.html |
| /configuracion | /index.html |
| /tienda/:slug | /index.html |
| /tienda/:slug/pedido/:trackingToken | /index.html |
| /conoce-lanzo | /index.html |

La prueba HTTP local obtuvo 200, el mismo SHA-256 e7fbec8f1de9342e101588a2eb1f560fe50c9cc19205efb3272b849acebb6d7a y el mismo título Lanzo POS para las siete rutas.

No existe:

- exclusión del fallback para rutas públicas;
- selección por hostname;
- build público independiente;
- configuración de subdominio;
- redirect desde el origen administrativo.

Los headers Cross-Origin-Opener-Policy se aplican globalmente. El fallback HTTP no implica que todas las rutas tengan una Route React equivalente; sólo confirma el HTML entregado.

## 6. PWA, manifiesto y Service Worker

### HTML recibido por rutas públicas

index.html contiene:

- título Lanzo POS;
- manifest /manifest.webmanifest;
- theme-color #FFFFFF, que el script puede cambiar a #171B22;
- apple-mobile-web-app-capable=yes;
- mobile-web-app-capable=yes;
- apple-touch-icon /pwa-192x192.png;
- captura global de beforeinstallprompt y appinstalled;
- script global de tema y acceso a localStorage;
- entrada única /src/main.jsx en fuente.

El build añade preloads para index, vendor_react, vendor_icons, vendor_utils y vendor_supabase, además de la hoja index. También termina con dos links de manifiesto: el original con query y el inyectado por vite-plugin-pwa. Chrome solicitó un manifiesto.

preparePublicStoreDocument sólo elimina maximum-scale y user-scalable del viewport (src/router/preparePublicStoreDocument.js:1-19). No retira metadatos PWA, iconos, scripts o título. PublicStorePage cambia el título sólo después de obtener un portal (líneas 396-423); tracking y landing no lo cambian.

### Configuración observada

| Opción | Estado actual |
| --- | --- |
| VitePWA | Configurado en vite.config.js:23-58 |
| strategies | No explícito; build confirma generateSW |
| injectRegister | auto |
| registerType | prompt |
| scope de registro | /, confirmado en App-Dnac6Gk8.js |
| manifest.scope | / |
| manifest.start_url | / |
| navigateFallback | /index.html |
| navigateFallbackDenylist | /^\/api/, /^\/auth/ |
| globPatterns | **/*.{js,css,html,ico,png,svg,woff2} |
| globIgnores | No configurado explícitamente |
| maximumFileSizeToCacheInBytes | No configurado explícitamente |
| runtimeCaching | No configurado |
| cleanupOutdatedCaches | true |
| clientsClaim | No configurado; no aparece en sw.js |
| skipWaiting | No incondicional; sw.js espera mensaje SKIP_WAITING |

### Registro real

UpdatePrompt importa useRegisterSW desde virtual:pwa-register/react en src/components/common/UpdatePrompt.jsx:1-2. App importa y monta UpdatePrompt sólo en estado ready (src/App.jsx:17 y 332-340).

Aunque injectRegister sea auto, dist/index.html no contiene registerSW.js ni serviceWorker.register. El build coloca el código Workbox dentro de App-Dnac6Gk8.js y crea Workbox('/sw.js', { scope: '/', type: 'classic' }).

Consecuencias:

- navegador limpio en tienda: 0 registros y sin controlador;
- abrir sólo una tienda no instala un SW nuevo en la medición actual;
- un SW administrativo previamente instalado sí cubre /tienda/... por scope /;
- las rutas públicas no están en denylist y reciben el fallback de navegación del SW;
- el cleanup de SW de desarrollo sólo se carga por el arranque administrativo y sólo actúa en import.meta.env.DEV; no protege producción o preview.

El evento beforeinstallprompt no pudo observarse de forma fiable en headless. La lógica para capturarlo sí se ejecuta en todas las rutas públicas. La invitación instalable en un navegador limpio ya no puede darse por confirmada; con un SW administrativo preexistente sigue siendo un riesgo pendiente de validación manual.

## 7. Análisis del build de producción

Comando: npm run build.

Resultado: exitoso, Vite 7.2.2, 3,323 módulos transformados, 1 min 50 s de compilación reportada.

| Métrica | Valor |
| --- | ---: |
| Archivos totales en dist | 74 |
| Tamaño total sin comprimir | 6,340,786 B |
| Archivos JavaScript totales | 48 |
| JavaScript total | 4,110,962 B |
| Chunks JavaScript en assets | 46 |
| Tamaño JS en assets | 4,090,652 B |
| Archivos CSS | 17 |
| CSS total | 747,422 B |
| Sourcemaps | 0 |
| Manifiesto Vite de módulos | No generado |
| manifest.webmanifest | Sí, 465 B |
| sw.js | Sí, 5,273 B |
| runtime Workbox | workbox-1ef09536.js, 15,037 B |

Archivos mayores:

| Archivo | Bytes |
| --- | ---: |
| icono.png | 1,450,285 |
| assets/index-DsZQ-AIF.js | 723,887 |
| assets/ScannerModal-DinWqfgl.js | 407,626 |
| assets/App-Dnac6Gk8.js | 376,594 |
| assets/vendor_charts-qmMCIWdv.js | 375,816 |
| assets/DashboardPage-CAv_eWS8.js | 308,013 |
| assets/bot.worker-BlwF4Cka.js | 249,992 |
| assets/PosPage-B1c-I8ND.js | 217,886 |
| assets/ProductsPage-DW8nX57J.js | 217,815 |
| assets/vendor_supabase-C7EdO3SM.js | 181,130 |

Se detectaron por archivo o contenido: PosPage, CajaPage/CajaModals, DashboardPage, SettingsPage, AssistantBot, ScannerModal, inventario, productos, clientes, charts, workers de estadísticas/bot/backup, sincronización POS, notificaciones/licencias dentro del App/entry y utilidades administrativas.

Una tienda limpia solicitó:

- index-DsZQ-AIF.js;
- vendor_react;
- vendor_icons;
- vendor_utils;
- vendor_supabase;
- index-DTvjd8jq.css.

No solicitó App, PosPage, CajaPage, DashboardPage, SettingsPage ni sus CSS por el grafo normal. El total JS transferido fue 326,153 B; el tamaño sin comprimir de esos cinco JS es 1,056,263 B.

## 8. Inventario del precache

El build reportó 76 entradas y 6171.89 KiB. La auditoría encontró 76 declaraciones, 72 URL únicas, cuatro duplicados (log.svg, logIcon.svg y los dos iconos PWA) y 6,320,476 B de archivos únicos.

| Categoría | Archivos | Tamaño aproximado | ¿Necesario para tienda? |
| --- | ---: | ---: | --- |
| Entrada principal | 7 | 1,133,507 B | Parcialmente; incluye tienda/tracking/landing y vendors, pero también código indirecto no público |
| Tienda pública | 0 separados | Integrada en entry | Sí |
| Tracking público | 0 separados | Integrado en entry | Sí para tracking, no para tienda |
| Landing pública | 0 separados | Integrada en entry | No para una visita de tienda |
| POS | 2 | 347,298 B | No |
| Caja | 7 | 153,734 B | No |
| Dashboard/reportes | 4 | 919,763 B | No |
| Configuración | 2 | 186,555 B | No |
| Otros administrativos | 26 | 1,997,474 B | No |
| Fuentes e imágenes | 7 | 1,478,522 B | Parcialmente; no se demostró necesidad de todos |
| No determinado | 17 | 103,623 B | No determinado |

Datos confirmados:

- 46 JS precacheados;
- 46 de 46 JS generados en assets están incluidos;
- 17 CSS precacheados;
- index.html y manifest.webmanifest incluidos;
- PNG y SVG incluidos; no se generaron WOFF2;
- 41 recursos se clasificaron como administrativos mediante nombres explícitos y suman 3,604,824 B;
- la simulación en Chrome leyó 72 entradas y 6,320,476 B desde Cache Storage.

Cuando cambia un chunk administrativo cambia su URL con hash y el manifiesto de precache del SW. El nuevo SW debe obtener esa nueva URL durante instalación. Con registerType prompt no hay skipWaiting incondicional: el worker espera activación/aceptación; cleanupOutdatedCaches limpia versiones antiguas cuando el nuevo SW activa. La tienda pública no necesita el chunk, pero comparte el costo de almacenamiento/actualización del mismo worker.

## 9. Caché actual del catálogo

Implementación: src/services/ecommerce/ecommercePublicCatalogCache.js y src/services/ecommerce/ecommercePublicService.js.

| Propiedad | Valor |
| --- | --- |
| Base IndexedDB | lanzo-public-store-cache |
| Versión | 1 |
| Stores | pages, portals |
| Clave pages | slug:catalogRevision:offset:limit:schemaVersion |
| Clave portals | slug |
| fresh TTL | 300 s |
| máximo stale | 86,400 s |
| máximo tiendas | 12 |
| máximo páginas | 240 |
| tamaño de página inicial | 100 |
| límite RPC máximo | 100 |

pages tiene índices por slug, catalogRevision, schemaVersion, offset, limit, createdAt, lastAccess y compuesto [slug+catalogRevision]. portals conserva revisión, política y un subconjunto allowlist del portal.

Flujo:

1. Cada visita online consulta primero ecommerce_get_portal_by_slug para obtener catalogRevision.
2. El catálogo busca por slug + revisión + offset + limit + versión.
3. Una página hasta maxStale puede servirse desde IndexedDB; fresh/stale se reporta, pero allowStale es true en el servicio.
4. Una revisión nueva usa otra clave y deleteObsoleteRevisions elimina páginas anteriores del mismo slug.
5. cleanup elimina por antigüedad y aplica LRU aproximado a 12 tiendas/240 páginas.
6. Offline, el portal sólo cae a caché después del fallo de red; el catálogo puede servirse de caché si existe la página compatible.

Checkout queda bloqueado si el catálogo no está validado online, no está listo, se refresca, está marcado offline o navigator.onLine es false (PublicStorePage.jsx:70-79 y 511-545). No se crea un pedido en la ruta offline.

Revalidación:

- focus;
- visibilitychange a visible;
- cada 120 s mientras visible;
- evento online;
- refresh antes de checkout cuando está stale.

Conteo lógico para la primera página:

| Caso | RPC portal | RPC catálogo |
| --- | ---: | ---: |
| Primera visita sin caché, online | 1 | 1 |
| Segunda visita, misma revisión y página cacheada | 1 | 0 |
| Visita con revisión nueva | 1 | 1 |
| Offline con portal y página compatibles cacheados | 1 intento fallido, 0 exitosas | 0 |
| Offline sin caché suficiente | 1 intento fallido | 0; la vista falla |

Cada página adicional no cacheada añade una RPC de catálogo. La prueba ecommercePublicService.catalogCache confirmó una RPC de portal y cero de catálogo en la segunda visita, aislamiento de revisiones y lectura offline.

Políticas separadas:

- catálogo/portal: IndexedDB Dexie;
- carrito: sessionStorage con clave lanzo:ecommerce:cart:{slug}:v1;
- intento idempotente de checkout: sessionStorage;
- tracking: sessionStorage con identidad hash y polling de 45 s;
- tema/POS: localStorage y otras bases propias;
- shell PWA: Cache Storage de Workbox;
- caché HTTP: gestionada por navegador/servidor, independiente de Dexie.

La caché Dexie reduce RPC y permite lectura pública offline; no reduce el tamaño del entry ni el precache administrativo.

## 10. Comportamiento de Supabase público

Se inspeccionaron sólo archivos locales:

- supabase/migrations/20260712193000_ecom_fe_catalog_3_sync_and_public_cache.sql:889-1033;
- src/services/ecommerce/ecommercePublicService.js:314-448;
- pruebas del servicio/caché.

Contrato local:

- ecommerce_get_portal_by_slug(p_slug text), stable, retorna success, portal, hours, features, catalogRevision y cachePolicy;
- ecommerce_get_catalog(p_slug text, p_limit integer, p_offset integer, p_catalog_revision bigint), stable;
- firma legacy sin revisión conservada;
- respuesta de catálogo: success, catalogRevision, items y pagination {limit, offset, hasMore};
- límite entre 1 y 100 y offset no negativo;
- si la revisión esperada no coincide, retorna ECOMMERCE_CATALOG_REVISION_CHANGED;
- grants de ejecución para anon/authenticated en la migración local.

No se ejecutaron RPC remotas porque no se encontró un slug de desarrollo remoto conocido y seguro. La prueba headless bloqueó por DNS todo host no loopback; observó el intento lógico sin llegar a Supabase.

Por tanto:

- llamadas remotas medidas: 0;
- duración/tamaño de respuestas remotas: no medidos;
- datos personales expuestos: ninguno;
- escrituras: ninguna;
- no es posible declarar a Supabase como cuello de botella con esta medición.

El peso de entrega (326,153 B JS transferidos en limpio y 6,320,476 B de precache) es un costo confirmado independiente de la latencia RPC.

## 11. Pruebas realizadas

### Build y análisis

- npm ls --depth=0: dependencias instaladas coherentes; no se reinstalaron.
- npm run build: PASS.
- node scripts/audit-public-delivery.mjs: PASS.
- inspección de index.html, manifest.webmanifest, sw.js y chunks: PASS.

### HTTP local

Se levantó npm run preview únicamente en 127.0.0.1:4173 y se detuvo al finalizar. Todas las rutas solicitadas devolvieron el mismo index.html con 200.

### Navegador local

agent-browser no estaba instalado y el proyecto no incluye Playwright/Cypress. Se usó Chrome headless mediante DevTools Protocol desde scripts/audit-public-browser.mjs:

- perfil efímero;
- DNS no loopback bloqueado;
- sin túneles;
- sin contacto con Supabase;
- visita limpia, repetida y simulación controlada de SW administrativo.

La captura de tienda muestra el estado de carga bajo red remota bloqueada; no se usa como medición de tiempo de catálogo. La landing renderizó contenido completo y sin overlay.

### Lint

- npm run lint: sin resultado; timeout tras 240 s.
- ESLint dirigido a entrada, App, rutas, páginas públicas, servicios/caché y scripts: PASS.

### Tests dirigidos

Comando: Vitest dirigido a nueve archivos de routing, tienda, tracking, servicios, caché y carrito.

Resultado: 40 de 47 tests pasaron; 7 fallaron:

1. Cuatro tests de PublicOrderTrackingPage usan matchers jest-dom sin importar @testing-library/jest-dom/vitest; error Invalid Chai property.
2. La prueba de landing espera el copy antiguo “Vende mejor, sin complicarte.”; la página actual renderiza “Todo lo que necesitas para vender, controlar y crecer.”
3. Una prueba de restauración desde segunda página agotó 15 s.
4. Una regex de privacidad rechaza 9610000000, secuencia contenida dentro del teléfono público esperado 529610000000; el objeto recibido no contenía checkout.

Estos fallos parecen preexistentes o de harness/copy y no fueron corregidos por la restricción de ARCH.0. Sin Git no se puede demostrar su antigüedad.

## 12. Mediciones de línea base

La columna repetida corresponde a una repetición HTTP sin datos públicos válidos, porque el acceso remoto estuvo bloqueado. Las RPC esperadas con caché real se documentan por código/tests en la sección 9.

| Métrica | Navegador limpio | Visita repetida | SW administrativo preexistente | Offline |
| --- | ---: | ---: | ---: | ---: |
| Solicitudes totales | 12 | 11 | 11 | Pendiente manual |
| JavaScript solicitado | 5 / 1,056,263 B | 5 / 1,056,263 B | 5 / 1,056,263 B desde precache | Pendiente manual |
| JavaScript transferido | 326,153 B | 895 B | 0 B | Pendiente manual |
| CSS transferido | 12,731 B | 179 B | 0 B | Pendiente manual |
| Chunks administrativos | 0 con nombre; entry contiene código indirecto | 0 con nombre | 0 en navegación; 41 ya precacheados | Pendiente manual |
| RPC portal | 1 intento lógico bloqueado | 1 intento lógico bloqueado | 1 intento lógico bloqueado | Pendiente manual |
| RPC catálogo | 0, portal no disponible | 0 | 0, portal no disponible | Pendiente manual |
| Manifiesto solicitado | Sí, 1 | Sí, 1 | Sí, 1 | Pendiente manual |
| Service Worker controlador | No | No | Sí, /sw.js | Pendiente manual |
| Catálogo visible | No; red remota bloqueada | No | No; red remota bloqueada | Pendiente manual |
| Checkout permitido | No | No | No | Pendiente manual |

Detalles adicionales:

- primera visita local: 346,041 B transferidos en recursos locales;
- segunda visita: 1,455 B transferidos por revalidación HTTP;
- revisit con SW: ocho respuestas desde SW/Cache Storage;
- Cache Storage controlado: 72 entradas, 6,320,476 B, 46 JS;
- IndexedDB lanzo-public-store-cache apareció en la visita.

Las dos solicitudes remotas bloqueadas observadas por Chrome corresponden al transporte CORS de una única RPC lógica; no se cuentan como dos invocaciones del servicio.

## 13. Escenarios con Service Worker antiguo

No se arrancó el POS para evitar cualquier dependencia remota o inicialización administrativa no necesaria. En su lugar se registró directamente el sw.js generado en un perfil efímero, reproduciendo sólo el estado “SW administrativo ya instalado”.

Resultados confirmados:

- scope: http://127.0.0.1:4173/;
- registro activo: sí;
- controlador al reabrir /tienda/mi-negocio: sí;
- script controlador: /sw.js;
- cache: workbox-precache-v2-http://127.0.0.1:4173/;
- entradas: 72;
- bytes leídos de respuestas: 6,320,476;
- JS: 46;
- navegación pública servida desde SW: ocho recursos locales;
- JS transferido por red en revisit: 0 B.

La observación de Network del target de página no capturó las solicitudes internas durante la instalación del worker; el inventario se confirmó leyendo Cache Storage después de activación. La apertura administrativa real y el evento de instalación siguen pendientes manuales.

## 14. Hallazgos confirmados

### ECOM-PUBLIC-ARCH-001

- Severidad: **BLOQUEANTE**
- Estado: Confirmado por código, build y HTTP local.
- Evidencia: vercel.json:23-27 reescribe todo a /index.html; todas las rutas obtuvieron el mismo hash/título/entry.
- Impacto: no hay límite de entrega, hostname o HTML entre POS y tienda.
- Corrección futura: ECOM.PUBLIC.ARCH.1.

### ECOM-PUBLIC-ARCH-002

- Severidad: **BLOQUEANTE**
- Estado: Confirmado por configuración, sw.js, build y simulación Chrome.
- Evidencia: vite.config.js:40,48-56; scope /, fallback /index.html y denylist sólo /api y /auth. 72 entradas/6,320,476 B y 46/46 JS de assets precacheados.
- Impacto: un SW administrativo preexistente controla las tiendas y almacena código administrativo no requerido.
- Corrección futura: ECOM.PUBLIC.PWA.1 después de separar origen/build.

### ECOM-PUBLIC-ARCH-003

- Severidad: **ALTO**
- Estado: Confirmado por HTML y navegador.
- Evidencia: index.html:11-22 y 74-88; título, manifiesto, icono, metadatos PWA y beforeinstallprompt globales. Chrome solicitó manifest.webmanifest en tienda.
- Impacto: la tienda anuncia identidad e instalabilidad administrativa; con SW previo puede aparecer UX de instalación Lanzo POS.
- Corrección futura: ECOM.PUBLIC.PWA.1.

### ECOM-PUBLIC-ARCH-004

- Severidad: **ALTO**
- Estado: Confirmado por grafo y contenido del build.
- Evidencia: ecommercePublicService.js:1 y supabase.js:1-15; entry de 723,887 B con contratos administrativos demostrables.
- Impacto: una visita limpia evita App/PosPage, pero aún descarga más código y superficie administrativa de la necesaria.
- Corrección futura: ECOM.PUBLIC.ARCH.1 / ECOM.PUBLIC.DATA.1 con cliente público mínimo.

### ECOM-PUBLIC-ARCH-005

- Severidad: **MEDIO**
- Estado: Confirmado por código/build.
- Evidencia: publicStoreRoutes.jsx:1-5 importa tienda, tracking y landing estáticamente; no existen chunks públicos separados.
- Impacto: cualquier ruta pública recibe código de las otras dos páginas.
- Corrección futura: ECOM.PUBLIC.BUILD.1, después del entry público independiente.

### ECOM-PUBLIC-ARCH-006

- Severidad: **INFORMATIVO**
- Estado: Confirmado por código y tests.
- Evidencia: ecommercePublicCatalogCache.js:3-12,275-304,312-480; test de servicio confirma 1 RPC portal/0 catálogo en segunda visita.
- Impacto: menor consumo y mejor lectura offline, sin efecto sobre HTML/PWA/precache.
- Corrección futura: conservar en ECOM.PUBLIC.ARCH.1; no corregir.

### ECOM-PUBLIC-ARCH-007

- Severidad: **INFORMATIVO**
- Estado: Confirmado por build/navegador.
- Evidencia: UpdatePrompt.jsx:1-41; dist/index.html sin registro directo; navegador limpio con 0 registros.
- Impacto: corrige la afirmación anterior de registro global nuevo en cada tienda. No elimina el riesgo del SW preexistente.
- Corrección futura: documentar/migrar en ECOM.PUBLIC.PWA.1.

### ECOM-PUBLIC-ARCH-008

- Severidad: **ALTO**
- Estado: Confirmado, limitación de trazabilidad.
- Evidencia: git branch, git rev-parse y git status responden “not a git repository”; no existe .git.
- Impacto: no se puede anclar la línea base a un commit ni demostrar el estado inicial/final.
- Corrección futura: repetir los metadatos de sección 3 sobre una copia local con .git antes de aprobar ARCH.1.

### ECOM-PUBLIC-ARCH-009

- Severidad: **MEDIO**
- Estado: Confirmado por validación dirigida.
- Evidencia: 7/47 tests fallan por matchers ausentes, copy desactualizado, timeout y regex de fixture.
- Impacto: la suite pública no es una señal totalmente verde para iniciar cambios estructurales.
- Corrección futura: ECOM.PUBLIC.QA.1, fuera de ARCH.0.

### ECOM-PUBLIC-ARCH-010

- Severidad: **BAJO**
- Estado: Confirmado por build.
- Evidencia: dos links de manifest en dist/index.html y cuatro URL duplicadas declaradas en el precache.
- Impacto: ruido de entrega/configuración y menor claridad del inventario; Chrome sólo solicitó un manifest.
- Corrección futura: ECOM.PUBLIC.PWA.1.

## 15. Hallazgos del reporte anterior que ya cambiaron

Cambió:

- App.jsx ya no es importado estáticamente por la entrada; se carga sólo después de clasificar una ruta no pública.
- Una tienda limpia no solicitó chunks App, POS, caja, dashboard o configuración con nombre propio.
- El index generado no registra un SW global; el registro pertenece a UpdatePrompt administrativo.
- Una tienda limpia tuvo cero registros/controlador SW.
- La caché Dexie permite 1 RPC portal y 0 catálogo en segunda visita con misma revisión.
- El catálogo puede leerse offline por hasta 86,400 s si portal/páginas/revisión son compatibles, y checkout queda bloqueado.

No cambió:

- el mismo index.html se entrega a rutas públicas y administrativas;
- el HTML público anuncia Lanzo POS/PWA;
- el manifest tiene scope/start_url /;
- el SW administrativo tiene scope /;
- /tienda no está excluido del navigation fallback;
- todos los JS de assets entran al precache;
- el build/origen siguen siendo únicos.

Matiz obligatorio: “la tienda descarga chunks administrativos” no debe presentarse sin condición. En navegador limpio no ocurrió por navegación normal. Sí ocurre como precache al instalar/actualizar el SW administrativo, y parte de código administrativo ya está dentro del entry genérico.

## 16. Riesgos actuales

1. Un único origen mantiene colisión de identidad, almacenamiento, Service Worker y ciclo de actualización.
2. Una actualización administrativa puede descargar/almacenar recursos innecesarios para usuarios públicos.
3. El entry público depende de un cliente Supabase monolítico con superficie administrativa.
4. El HTML puede capturar UX de instalación administrativa en contexto público.
5. Tienda, tracking y landing no tienen presupuesto ni ownership de bundle independiente.
6. La caché de datos puede ocultar latencia RPC repetida, pero no corrige costos de JavaScript/PWA.
7. Faltan mediciones reales con un slug seguro, beforeinstallprompt y catálogo offline completo.
8. La copia sin Git impide trazabilidad de release.

## 17. Contrato arquitectónico futuro

Este contrato queda técnicamente definido para fases futuras; no se implementó.

### Origen administrativo

Conservará inicialmente el origen actual y contendrá:

- PWA administrativa;
- Service Worker administrativo;
- manifiesto de Lanzo POS;
- POS, caja, inventario y configuración;
- notificaciones;
- capacidades offline administrativas.

Su Service Worker, Cache Storage y metadatos no deberán controlar ni anunciar el origen público.

### Origen público

Se moverá a un origen independiente, por ejemplo https://tienda.dominio.com, conservando inicialmente:

- /tienda/:slug;
- /tienda/:slug/pedido/:trackingToken;
- /conoce-lanzo.

El artefacto/origen público deberá contener:

- tienda, catálogo, carrito y checkout público;
- seguimiento público;
- landing pública;
- caché IndexedDB pública del catálogo;
- cliente Supabase público mínimo.

No deberá contener:

- manifest de Lanzo POS;
- Service Worker administrativo;
- captura beforeinstallprompt administrativa;
- App.jsx;
- POS, caja, dashboard o configuración;
- asistente;
- licencias;
- notificaciones/offline administrativos.

### Compatibilidad

En una fase posterior, el dominio administrativo deberá redirigir:

- /tienda/:slug → https://tienda.dominio.com/tienda/:slug
- /tienda/:slug/pedido/:trackingToken → https://tienda.dominio.com/tienda/:slug/pedido/:trackingToken

No se simplificarán todavía las rutas a /:slug. ARCH.0 no implementa redirects, DNS, dominios ni proyectos Vercel.

### Criterios verificables del contrato

- HTML público sin tags/handlers administrativos.
- Grafo público sin App.jsx ni módulos administrativos.
- Ningún chunk administrativo en su build/precache.
- Ningún SW administrativo puede controlar el origen público por definición de same-origin.
- Caché Dexie y claves actuales se conservan o migran explícitamente.
- RPC públicas se limitan a contratos de lectura/checkout público necesarios.
- Las rutas antiguas sólo redirigen, no renderizan la tienda.

## 18. No objetivos de ARCH.0

No fueron objetivos ni se implementaron:

- store.html, main-store.jsx o main-pos.jsx;
- segundo build/proyecto Vercel;
- subdominio, DNS, redirects o rewrites nuevos;
- cambio de scope, desregistro o migración de Service Worker;
- manifiesto público;
- lazy loading nuevo;
- cliente Supabase público nuevo;
- cambios de caché, checkout, seguimiento, pedidos, fulfillment, POS, caja, inventario, reservas, lotes, notificaciones o licencias;
- corrección de tests preexistentes.

## 19. Criterios para iniciar ARCH.1

Antes de iniciar ECOM.PUBLIC.ARCH.1:

1. Repetir rama, HEAD y git status en una copia con .git.
2. Revisar/aprobar los hallazgos y el contrato de sección 17.
3. Disponer de un slug de desarrollo seguro y datos públicos no personales.
4. Completar las validaciones manuales prioritarias de sección 20.
5. Acordar ownership de entry público, cliente Supabase y PWA.
6. Definir presupuestos: cero chunks administrativos, cero metadata POS, cero control SW administrativo.
7. Resolver o aceptar explícitamente los siete fallos de tests dirigidos.
8. Confirmar estrategia de compatibilidad de URLs sin desplegarla todavía.

Hay evidencia suficiente para diseñar ARCH.1, pero no para declararla lista de ejecución formal mientras falte el anclaje Git y las validaciones manuales con datos reales seguros.

## 20. Validaciones manuales pendientes

### A. Navegador limpio con tienda segura

1. Abrir Chrome con un perfil nuevo.
2. DevTools → Application → Storage → Clear site data.
3. Confirmar Service Workers vacío, Cache Storage vacío e IndexedDB sin lanzo-public-store-cache.
4. DevTools → Network → Disable cache + Preserve log.
5. Abrir /tienda/{slug-seguro}.
6. Registrar total, JS/CSS transferido, manifest, RPC portal/catalog, DOMContentLoaded y catálogo visible.
7. En Console comprobar navigator.serviceWorker.controller y getRegistrations().
8. Comprobar window.deferredPwaPrompt y evento beforeinstallprompt sin aceptar instalación.

### B. Visita repetida

1. Conservar IndexedDB y recargar la misma tienda.
2. Filtrar Network por ecommerce_get_portal_by_slug y ecommerce_get_catalog.
3. Confirmar 1 portal y 0 catálogo para páginas de la misma revisión.
4. Confirmar lecturas pages/portals en Application → IndexedDB.

### C. SW administrativo real preexistente

1. En un perfil desechable, abrir el POS administrativo y llegar al estado que monta UpdatePrompt.
2. Confirmar /sw.js activo y scope /.
3. No desregistrarlo.
4. Cerrar la pestaña y abrir la tienda.
5. Confirmar controller, Cache Storage, install prompt y recursos servidos por SW.

### D. Offline con catálogo real cacheado

1. Tras A/B, seleccionar Network → Offline.
2. Recargar tienda.
3. Confirmar catálogo visible desde IndexedDB.
4. Confirmar checkout deshabilitado y ausencia de ecommerce_create_order.
5. Distinguir documento/assets desde Cache Storage de datos desde IndexedDB.

### E. Revisión nueva

1. Usar mocks/fixtures existentes, no Supabase productivo.
2. Cambiar catalogRevision.
3. Confirmar que no se reutilizan páginas de la revisión anterior.
4. Confirmar reconciliación del carrito y limpieza de revisiones.

Pendientes específicos: beforeinstallprompt real, tiempo hasta catálogo visible, transferencia con respuesta Supabase real, visita repetida con datos, offline completo y flujo de tracking con token seguro. No se inventaron valores.

## 21. Conclusión

El diagnóstico anterior sigue vigente en lo estructural: un único HTML/build/origen anuncia la PWA administrativa, y el SW de scope / puede controlar rutas públicas y precachear todo el JavaScript.

Cambió la implementación de arranque y caché:

- App.jsx ahora es dinámico y los chunks administrativos con nombre no se solicitan en una tienda limpia;
- el SW nuevo no se registra desde el HTML/entry público;
- IndexedDB reduce la segunda visita a una RPC de portal y cero de catálogo cuando la revisión coincide;
- el modo offline de datos bloquea checkout.

Esos avances no sustituyen la separación por origen. ARCH.1 debe conservarlos y extraer un entry/cliente/build públicos mínimos.

La documentación y medición de ARCH.0 están terminadas, pero la fase se declara **INCOMPLETA** por falta de HEAD/rama/status y por las validaciones manuales esenciales aún pendientes. No se inició ECOM.PUBLIC.ARCH.1.
