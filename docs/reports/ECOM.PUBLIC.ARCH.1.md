# FASE ECOM.PUBLIC.ARCH.1 — Compilación pública independiente

Fecha de validación local: 2026-07-13 (America/Mexico_City).

Estado: **COMPLETA**.

## 1. Resumen ejecutivo

Se creó una compilación pública independiente de Lanzo POS. `npm run build` continúa generando el artefacto administrativo en `dist`, mientras que `npm run build:store` genera un artefacto autónomo en `dist-store` desde un HTML, entry JavaScript y configuración Vite propios.

La auditoría medida de `dist-store` encontró 9 archivos y 722,887 B totales. Su entry mide 87,471 B, frente a los 723,887 B del entry compartido registrado por ARCH.0: una reducción medida de 636,416 B (87.92%). El JavaScript solicitado por una carga pública es 663,757 B sin comprimir, frente a 1,056,263 B medidos en ARCH.0: 392,506 B menos (37.16%).

El artefacto público no contiene manifest, Service Worker, Workbox, `registerSW`, `App`, POS, caja, dashboard, settings, `AssistantBot`, `ScannerModal`, charts administrativos, workers administrativos ni los contratos administrativos buscados. El servicio público dejó de importar `src/services/supabase.js` y usa un cliente Supabase mínimo con credenciales publicables y sesión no persistente.

No se ejecutaron operaciones Git/GitHub, despliegues Vercel, escrituras Supabase, SQL ni RPC de escritura. No se creó `.git`.

## 2. Alcance

Esta fase implementa exclusivamente:

- build administrativo conservado en `dist`;
- build público independiente en `dist-store`;
- HTML y entry públicos propios;
- router exclusivo para `/tienda`, `/tienda/:slug`, `/tienda/:slug/pedido/:trackingToken` y `/conoce-lanzo`;
- fallback público seguro para rutas desconocidas del despliegue público;
- cliente Supabase público mínimo;
- preservación de caché Dexie, carrito, tracking y bloqueo de checkout offline;
- auditoría opt-in de ambos artefactos;
- pruebas de arquitectura y validación local en loopback.

No se iniciaron ECOM.PUBLIC.PWA.1, ECOM.PUBLIC.DEPLOY.1, ECOM.PUBLIC.DOMAIN.1 ni ECOM.PUBLIC.ARCH.2.

## 3. Limitaciones aceptadas de ARCH.0

- La copia local no contiene metadata Git. Esto se acepta como condición del entorno, no como incompletitud.
- El dominio principal y el despliegue no cambian en esta fase.
- El Service Worker administrativo mantiene scope `/` y puede controlar rutas públicas existentes en el dominio actual si ya estaba instalado. Su mitigación pertenece a PWA.1.
- No existe un slug remoto de desarrollo conocido y seguro. La validación de navegador bloqueó DNS no loopback y comprobó arranque, routing, estados controlados y ausencia de administración sin ejecutar RPC remotas.
- Se conservan siete fallos dirigidos conocidos de ARCH.0; la batería ampliada volvió a producir exactamente esos siete y ningún fallo nuevo.
- El lint global vuelve a agotar el límite acordado; el lint dirigido sí pasa.

## 4. Arquitectura anterior

`index.html` y `src/main.jsx` servían tanto rutas administrativas como públicas. La clasificación se realizaba en runtime con `isPublicStorePath`. Aunque `App.jsx` se importaba dinámicamente y una visita pública limpia no lo solicitaba, el router público y sus páginas formaban parte del mismo build y del mismo precache administrativo.

`src/services/ecommerce/ecommercePublicService.js` importaba `src/services/supabase.js`. Ese cliente monolítico importaba FingerprintJS, base local, Logger, licencias, dispositivos y sesiones de staff. ARCH.0 midió un entry compartido de 723,887 B y un precache de 6,320,476 B con los 46 JavaScript de assets.

## 5. Arquitectura implementada

La separación existe desde el proceso de build y el grafo de módulos:

- administrativo: `index.html` → `src/main.jsx` → `dist` mediante `vite.config.js`;
- público: `store/index.html` → `src/main-store.jsx` → `dist-store` mediante `vite.store.config.js`;
- `vite.store.config.js` no importa la configuración administrativa ni `vite-plugin-pwa`;
- `publicDir: false` evita copiar automáticamente assets administrativos;
- el único asset HTML reutilizado es `public/logIcon.svg`, que Vite procesa como asset con hash;
- `LogoMark` se extrajo a un módulo neutral para que las páginas públicas no importen `useAppStore` mediante `Logo.jsx`;
- el servicio público importa `supabasePublic.js`, no el cliente administrativo.

No se construye el POS para borrarlo después, no existen aliases falsos, externals administrativos ni decisión runtime dentro del entry público.

## 6. Entrada administrativa conservada

`src/main.jsx` se conserva como entrada administrativa. `npm run build` no ejecuta el build público y continúa escribiendo sólo `dist`. Las rutas públicas existentes permanecen disponibles dentro del build administrativo para la transición futura.

El build administrativo final pasó con 3,325 módulos transformados. Su PWA, manifest y configuración Workbox permanecen activos y no fueron modificados.

## 7. Entrada pública nueva

`src/main-store.jsx`:

- importa React, ReactDOM, React Router, `publicStoreRoutes` y el preparador neutral de viewport;
- no importa `App.jsx`, Google OAuth, StorageManager, ErrorBoundary administrativo, sincronización POS, licencias, caja, inventario, dashboard, scanner, workers, Drive, staff ni autenticación administrativa;
- importa sólo base/tokens compartidos, `ui-button.css` y `ui-card.css`; los estilos de tienda, checkout, tracking y landing llegan desde sus componentes existentes;
- crea un único `BrowserRouter` público y lo monta sin clasificar entre POS y tienda.

## 8. HTML público

`store/index.html` contiene charset, viewport accesible, theme-color, descripción neutral, favicon público, título `Tienda en línea — Lanzo`, root y el módulo público.

No contiene manifest, `beforeinstallprompt`, `window.deferredPwaPrompt`, `appinstalled`, metadatos instalables, apple touch icon, registro de Service Worker, `registerSW` ni scripts administrativos.

## 9. Configuración Vite pública

`vite.store.config.js` usa:

- root dedicado `store`;
- `envDir` en la raíz local para leer los nombres de variables existentes;
- base `/`;
- `publicDir: false`;
- app type `spa`;
- plugin React exclusivamente;
- salida absoluta `dist-store` con limpieza previa;
- chunks públicos separados para React/Router, Supabase, Dexie/Big.js e iconos.

No incluye PWA, Workbox, manifest ni copia del directorio `public` completo.

## 10. Cliente Supabase público

`src/services/supabasePublic.js` usa exclusivamente `createClient`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. No contiene valores reales ni usa `service_role`.

Opciones auth:

```text
persistSession: false
autoRefreshToken: false
detectSessionInUrl: false
storageKey: lanzo-public-store-auth
```

El grafo público no importa FingerprintJS, LanzoDB, database administrativa, Logger, licencias, dispositivos ni sesiones de staff. Las rutas públicas no invocan APIs de Supabase Auth. Si faltan las dos variables publicables, el cliente queda `null` y el servicio devuelve el error público seguro `ECOMMERCE_PUBLIC_CONFIG_MISSING`.

El alias exportado `ecommercePublicClient` se conserva para tracking y tests. No cambiaron firmas RPC, parámetros, respuestas, abort/rate-limit existentes ni manejo de errores.

## 11. Variables de entorno públicas

El cliente público referencia únicamente:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY`.

No referencia Google OAuth, licencias, Drive, Vercel, `service_role` ni secretos administrativos. Vite sólo incorpora variables realmente referenciadas por el código; no se imprimieron valores durante la auditoría.

## 12. Rutas públicas

Se preservaron exactamente:

- `/tienda`;
- `/tienda/:slug`;
- `/tienda/:slug/pedido/:trackingToken`;
- `/conoce-lanzo`.

No se simplificaron slug, trackingToken, checkout ni enlaces. Se agregó `*` únicamente como fallback dentro del despliegue público; muestra `PublicStoreNotFoundPage` y nunca carga login, dashboard ni administración.

Vite preview devolvió `dist-store/index.html` con HTTP 200 para tienda, tracking, landing y una ruta desconocida. React Router resolvió cada ruta desde recarga directa.

## 13. Caché Dexie preservada

No se modificó `ecommercePublicCatalogCache.js`.

| Propiedad | Valor conservado |
|---|---|
| Base | `lanzo-public-store-cache` |
| Stores | `pages`, `portals` |
| Clave pages | `slug:catalogRevision:offset:limit:schemaVersion` |
| Clave portals | `slug` |
| fresh TTL | 300 s |
| max stale | 86,400 s |
| límite tiendas | 12 |
| límite páginas | 240 |

Las pruebas confirman una RPC de portal y cero RPC de catálogo en la segunda visita con la misma revisión, aislamiento por revisión, nueva RPC con revisión nueva y lectura desde caché cuando falla la red. Se preservan focus, visibilitychange, intervalo, evento online y revalidación previa a checkout del código existente.

La prueba explícita agregada confirma que con `navigator.onLine = false` el catálogo compatible puede renderizarse, `Continuar pedido` queda deshabilitado y `createPublicOrder` no se invoca.

## 14. PWA excluida del build público

La auditoría de `dist-store` midió:

- 0 manifest links;
- 0 `manifest.webmanifest`;
- 0 `sw.js`;
- 0 `workbox-*`;
- 0 `registerSW`;
- 0 `virtual:pwa-register`;
- 0 entradas de precache.

El build administrativo conserva `manifest.webmanifest`, `sw.js`, Workbox y 78 declaraciones de precache. No se modificaron scope, fallback, glob patterns, registerType ni limpieza de cachés administrativas.

## 15. Archivos creados y modificados

### Creados

- `store/index.html`
- `vite.store.config.js`
- `src/main-store.jsx`
- `src/services/supabasePublic.js`
- `src/components/common/LogoMark.jsx`
- `src/architecture/__tests__/publicBuildArchitecture.test.js`
- `docs/reports/ECOM.PUBLIC.ARCH.1.md`
- `dist-store/` como artefacto regenerable

### Modificados

- `package.json`
- `scripts/audit-public-delivery.mjs`
- `src/components/common/Logo.jsx`
- `src/components/ecommerce/public/PublicSafeImage.jsx`
- `src/components/ecommerce/public/__tests__/PublicSafeImage.test.jsx`
- `src/pages/PublicStorePage.jsx`
- `src/pages/PublicLanzoLandingPage.jsx`
- `src/pages/__tests__/PublicStoreCheckout.test.jsx`
- `src/router/publicStoreRoutes.jsx`
- `src/services/ecommerce/ecommercePublicService.js`
- `src/services/ecommerce/__tests__/ecommercePublicService.test.js`
- `dist/` regenerado como artefacto administrativo

`package-lock.json`, `vercel.json`, `vite.config.js`, `src/main.jsx`, la carpeta `supabase/` y el Service Worker administrativo no fueron modificados.

## 16. Comparación de builds

Mediciones obtenidas con `node scripts/audit-public-delivery.mjs dist` y `node scripts/audit-public-delivery.mjs dist-store` después de ambos builds:

| Métrica | Build anterior/admin | Build público nuevo |
|---|---:|---:|
| Archivos totales | 76 | 9 |
| Tamaño total | 6,340,653 B | 722,887 B |
| JS total | 4,110,910 B | 663,757 B |
| CSS total | 747,422 B | 57,675 B |
| Tamaño entry | 379,513 B admin actual; 723,887 B baseline ARCH.0 | 87,471 B |
| Chunks administrativos | presentes; 14 archivos en categorías obligatorias | 0 |
| Manifest | sí | no |
| Service Worker | sí | no |
| Workbox | sí | no |
| App.jsx | chunk `App-*` presente | ausente |
| Cliente Supabase monolítico | presente para administración | ausente |

Otras comparaciones medidas:

- JS solicitado en una visita pública ARCH.0: 1,056,263 B; nuevo build: 663,757 B.
- JS total generado admin: 4,110,910 B; público: 663,757 B.
- tamaño total admin: 6,340,653 B; público: 722,887 B.
- el build público genera React/Router, Supabase, Dexie/Big.js y lucide como dependencias principales esperadas.

## 17. Auditoría de dependencias administrativas

`scripts/audit-public-delivery.mjs` acepta ahora un directorio opcional, conserva `dist` como default y registra archivos, tamaños, JS, CSS, mayores archivos, entry, preloads, stylesheets, manifest, SW, Workbox, precache, chunks por nombre, contratos por contenido y dependencias públicas.

Resultado `dist-store`: `compliance.passed = true`, cero violaciones.

No se encontraron en el artefacto público:

- `App-*`, `PosPage`, `Caja`, `Dashboard`, `Settings`, `AssistantBot`, `ScannerModal`, `vendor_charts` o workers administrativos;
- `create_free_trial_license`, `device_security_token`, `staff_session_token`, `release_device_anon`, `LanzoDB`, `processSale`, `cashSync`, `posSync` o `googleDrive`.

No hubo cadenas que requirieran excepción o justificación pública.

## 18. Pruebas ejecutadas

### Builds y auditoría

- `npm run build`: PASS.
- `npm run build:store`: PASS.
- `node scripts/audit-public-delivery.mjs dist`: PASS de lectura.
- `node scripts/audit-public-delivery.mjs dist-store`: PASS, cero violaciones.

### Vitest dirigido

1. Arquitectura, servicio y caché de servicio: 19/19 PASS.
2. Arquitectura + `PublicSafeImage` tras aislar su DOM: 7/7 PASS.
3. Batería pública ampliada de 15 archivos: 80 PASS, 7 FAIL conocidos, 87 total.
4. Checkout final con caso offline explícito: 10/10 PASS.

La batería ampliada cubrió routing, tienda, checkout mockeado, tracking, servicio público, tracking service, caché Dexie, carrito, revisión del catálogo, imágenes seguras y arquitectura de build.

Comparación ARCH.0: los mismos siete fallos conocidos permanecen; no apareció ningún fallo nuevo después del ajuste de harness de `PublicSafeImage`.

## 19. Resultados de lint

- ESLint dirigido a todos los archivos creados/modificados: PASS, exit 0.
- `npm run lint`: sin resultado; timeout después de 244.1 s, sin diagnósticos emitidos.
- No se declara que el lint global pasó.
- React Doctor auxiliar (`npx -y react-doctor@latest . --verbose --diff`): timeout después de 184.2 s sin salida; no sustituye las validaciones anteriores.

## 20. Validación manual local

Comando:

```text
npm run preview:store -- --host 127.0.0.1 --port 4174 --strictPort
```

Resultados:

- servidor limitado a `127.0.0.1:4174`;
- `/tienda/mi-negocio`: HTTP 200, shell público renderizado y estado controlado con DNS remoto bloqueado;
- `/tienda/mi-negocio/pedido/trk1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`: HTTP 200, shell de tracking y estado público controlado;
- `/conoce-lanzo?tienda=mi-negocio`: HTTP 200, landing renderizada;
- `/ruta-publica-desconocida`: HTTP 200, fallback público seguro;
- ningún DOM inspeccionado incluyó shell administrativo, manifest ni bootstrap PWA;
- `agent-browser` no estaba instalado; se usó Chrome/Edge headless local como fallback con perfil efímero y DNS no loopback bloqueado;
- el proceso se detuvo y el puerto 4174 quedó cerrado.

No se usaron túneles ni datos remotos. No se creó pedido real.

| Función pública | Resultado |
|---|---|
| Tienda | PASS local; shell/estado público, sin administración |
| Tracking | PASS local; ruta profunda y estado controlado |
| Landing | PASS local; contenido público renderizado |
| Caché misma revisión | PASS; 1 RPC portal, 0 RPC catálogo en segunda visita |
| Cambio de revisión | PASS; nueva revisión no reutiliza página anterior |
| Offline solo lectura | PASS; portal/página compatible desde Dexie |
| Checkout offline bloqueado | PASS; botón deshabilitado, 0 creación de pedido |
| Recarga de ruta profunda | PASS; HTTP 200 + router público |

## 21. Fallos conocidos no corregidos

Se conservaron exactamente los siete fallos registrados por ARCH.0:

1. Cuatro tests de `PublicOrderTrackingPage.unpublished.test.jsx` usan matchers jest-dom sin importar su extensión.
2. Un test de routing espera el copy antiguo `Vende mejor, sin complicarte.` en lugar del copy actual.
3. Un test de restauración desde segunda página excede 15 s en esta máquina.
4. Una regex de privacidad rechaza la subsecuencia `9610000000` dentro del teléfono público fixture `529610000000`.

No se debilitaron, omitieron ni marcaron con `.skip`/`.todo`.

Se corrigió únicamente el aislamiento DOM en `PublicSafeImage.test.jsx` porque la extracción neutral de `LogoMark` volvió ese test parte directa de ARCH.1. El cambio fue `cleanup` entre casos y no alteró código de negocio.

## 22. Riesgos residuales

- Un Service Worker administrativo antiguo con scope `/` todavía puede controlar las rutas públicas del dominio actual. ARCH.1 no hace el corte de dominio ni la migración PWA.
- Falta validar contra un slug remoto seguro, catálogo real y latencia RPC real; no se inventaron datos ni credenciales.
- La landing pública conserva enlaces de adquisición hacia `/?welcome=1`; en un despliegue independiente futuro deberán resolverse mediante la estrategia de dominio/redirect de fases posteriores, no mediante carga del POS dentro de este build.
- Todos los vendors públicos se precargan desde el HTML actual. El artefacto ya es independiente y significativamente menor; una optimización adicional de carga por ruta puede evaluarse en una fase posterior sin mezclarla con ARCH.1.
- El lint global y React Doctor no concluyeron dentro de sus límites; el lint dirigido y builds sí concluyeron.

## 23. Rollback local

Como no existe `.git`, el rollback es manual y no se ejecutó.

1. Eliminar archivos nuevos:
   - `store/index.html` y la carpeta `store` si queda vacía;
   - `vite.store.config.js`;
   - `src/main-store.jsx`;
   - `src/services/supabasePublic.js`;
   - `src/components/common/LogoMark.jsx`;
   - `src/architecture/__tests__/publicBuildArchitecture.test.js`;
   - `docs/reports/ECOM.PUBLIC.ARCH.1.md`.
2. Restaurar en `ecommercePublicService.js` el import de `supabaseClient` desde `../supabase` y su asignación a `ecommercePublicClient`.
3. Restaurar `LogoMark` dentro de `Logo.jsx` y los imports públicos desde `components/common/Logo`.
4. Retirar el fallback `*` de `publicStoreRoutes.jsx` si se requiere reproducir exactamente el estado anterior.
5. Retirar `dev:store`, `build:store` y `preview:store` de `package.json`.
6. Restaurar el test del singleton Supabase y retirar las pruebas ARCH.1/offline agregadas; el `cleanup` de `PublicSafeImage` puede conservarse por ser aislamiento de test.
7. Restaurar la versión anterior de `scripts/audit-public-delivery.mjs` si ya no se requiere soporte de `dist-store`.
8. Eliminar `dist` y `dist-store` únicamente si se desea limpiar artefactos; ambos son regenerables. No borrar archivos de usuario.

## 24. Criterios para iniciar ECOM.PUBLIC.ARCH.2

Antes de iniciar ARCH.2 se recomienda:

1. revisión y aceptación formal de este artefacto/reporte;
2. designar un slug de desarrollo remoto seguro sin datos personales;
3. decidir el límite exacto de la siguiente fase sin adelantar PWA, dominio o deploy;
4. mantener `npm run build` y `npm run build:store` independientes;
5. resolver o aceptar explícitamente los siete fallos heredados del harness;
6. coordinar por separado la estrategia frente al Service Worker administrativo antiguo antes de cualquier corte real.

## 25. Conclusión

ARCH.1 queda **COMPLETA**. `dist-store` es una compilación funcional e independiente desde su HTML, entry, configuración Vite, cliente Supabase y grafo de módulos. No depende de una decisión runtime del entry administrativo, no contiene funcionalidad administrativa demostrable y no genera PWA.

Existen condiciones técnicas para revisar e iniciar ECOM.PUBLIC.ARCH.2 después de aceptación humana y definición de su alcance. ARCH.2 no fue iniciado en esta fase.
