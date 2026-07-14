# FASE ECOM.PUBLIC.PWA.1 — Aislar y preparar la transición del Service Worker administrativo

## 1. Resumen ejecutivo

La fase queda **COMPLETA** en la copia local. La PWA administrativa conserva manifest, instalación, `scope /`, actualización confirmada por el usuario y shell offline. Las rutas públicas transitorias del build administrativo no anuncian la PWA, no registran un worker nuevo y, cuando un worker ya las controla, sus navegaciones usan red sin caer en `/index.html` administrativo.

El precache medido bajó de 78 declaraciones, 74 URL únicas y 6,320,268 B a 26 declaraciones/URL y 1,813,055 B. La reducción es 71.31 % en bytes y 62.50 % en cantidad de JavaScript. La migración real en Chrome desde el artefacto anterior dejó el worker nuevo en `waiting`, requirió `SKIP_WAITING` explícito, produjo un solo `controllerchange` y una sola recarga, eliminó las 56 URL obsoletas del precache y conservó Cache Storage ajeno, IndexedDB, `localStorage` y `sessionStorage`.

`dist-store` se regeneró sin diferencias byte a byte respecto de su baseline: 9 archivos, 722,887 B y cero PWA. No se inició ECOM.PUBLIC.DEPLOY.1.

## 2. Alcance

Se cambió exclusivamente la infraestructura PWA administrativa permitida: configuración Vite, HTML compartido, bootstrap administrativo/público, prompt de actualización, recuperación de chunks lazy, módulos y tests `src/pwa/**`, y scripts locales de auditoría. No se modificó checkout, tracking, catálogo, carrito, Dexie, reglas de negocio ni la entrada pública independiente.

La validación cubrió builds, auditoría estática, 102 tests públicos preexistentes, 64 tests PWA nuevos y dos auditorías CDP de navegador sobre loopback.

## 3. Restricciones cumplidas

- Se trabajó únicamente en `C:\dev\Lanzo-POS-main`.
- No existía `.git` al inicio y no se creó; no se ejecutaron comandos Git o GitHub.
- No se ejecutó Vercel, no se modificó `vercel.json`, no hubo deploy, dominio, redirect, rewrite ni variable remota.
- No se modificó ni contactó Supabase; las auditorías bloquearon DNS externo. No hubo SQL, RPC de escritura ni pedidos reales.
- No se agregaron ni actualizaron dependencias y `package.json` quedó sin cambios.
- No se usó `Clear-Site-Data`, `registration.unregister()` ni borrado global de caches/storage.
- No se ejecutó React Doctor, conforme a la instrucción expresa.
- No se inició ECOM.PUBLIC.DEPLOY.1.

## 4. Estado inicial

La línea base se capturó antes de editar y se congeló fuera del repositorio en `C:\Users\pituf\AppData\Local\Temp\lanzo-pwa1-baseline-20260713-223630\dist`.

| Dato | Línea base |
|---|---|
| Directorio | `C:\dev\Lanzo-POS-main` |
| `.git` | Ausente |
| Fecha local | 2026-07-13 22:36:30 -06:00 |
| Zona | America/Mexico_City / Central Standard Time (Mexico) |
| Node | v22.12.0 |
| npm | 10.9.0 |
| Vite | 7.2.2 |
| vite-plugin-pwa | 1.2.0 |
| Workbox resuelto por el plugin | 7.4.0 |
| Build administrativo | PASS; 76 archivos; 6,340,679 B |
| Build público | PASS; 9 archivos; 722,887 B |
| Precache | 78 declaraciones; 74 URL únicas; 6,320,268 B |
| Tests públicos | 102/102 PASS |
| Tests PWA preexistentes | 0 específicos de esta fase |
| Lint global conocido | 158 errores; 224 warnings, deuda previa |

`npm ls vite vite-plugin-pwa workbox-build workbox-window --depth=0` confirmó Vite y el plugin como dependencias directas; Workbox 7.4.0 se resolvía transitivamente. Las auditorías iniciales de `dist` y `dist-store` pasaron.

## 5. Arquitectura PWA anterior

La configuración anterior usaba la estrategia implícita `generateSW`, `injectRegister: auto`, `registerType: prompt`, `scope /`, `navigateFallback: /index.html`, denylist sólo para `/api` y `/auth`, y `globPatterns: **/*.{js,css,html,ico,png,svg,woff2}`. No había runtime cache.

`index.html` contenía un link manual al manifest, metadatos instalables, `apple-touch-icon` y listeners globales de `beforeinstallprompt`/`appinstalled`; el plugin añadía un segundo link al manifest. `UpdatePrompt` importaba `virtual:pwa-register/react` y el registro sólo se montaba cuando el estado administrativo era `ready`. El worker esperado recibía `SKIP_WAITING` desde ese hook, pero su fallback también cubría `/tienda/**` y `/conoce-lanzo`.

El inventario anterior incluía todos los 48 JS producidos, 22 chunks lazy identificados, tres workers de funcionalidades y el chunk de charts.

## 6. Arquitectura PWA implementada

`vite-plugin-pwa` usa ahora `injectManifest` con `src/pwa/sw.js`, sin inyección HTML ni registro automático. Un plugin local de build emite `manifest.webmanifest` desde una definición administrativa única; esta solución no depende del orden no documentado de transformaciones HTML entre plugins.

El bootstrap de `src/main.jsx` clasifica primero la ruta. La rama administrativa instala documento PWA, listeners de instalación y registro. La rama pública prepara su documento y sólo pide `registration.update()` si ya existe un registro en `/`; nunca llama `register()`.

El worker separa cuatro responsabilidades: precache mínimo, `NetworkOnly` para navegaciones públicas, fallback administrativo, y runtime cache segura para assets administrativos hasheados.

## 7. Manifest administrativo

`src/pwa/adminManifest.js` conserva nombre `Lanzo POS`, nombre corto `Lanzo`, descripción, `start_url: /`, `scope: /`, `display: standalone`, colores, idioma, orientación e iconos de 192/512 px, incluido maskable.

El archivo se genera en `dist/manifest.webmanifest`, pero no aparece en el HTML estático compartido. `installAdminPwaDocument()` agrega exactamente un link al iniciar una ruta administrativa. CDP confirmó una solicitud de manifest en administración y cero en ruta pública limpia.

## 8. Metadatos instalables

Los metadatos `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `mobile-web-app-capable` y `apple-touch-icon` se crean sólo en el bootstrap administrativo y se marcan con `data-lanzo-admin-pwa` para poder retirarlos de forma acotada.

Las rutas públicas del build compartido no contienen esos metadatos ni identidad instalable administrativa. El `theme-color` general se conserva porque también forma parte del documento visual, no del anuncio de instalación.

## 9. beforeinstallprompt

`src/pwa/adminInstallPrompt.js` instala `beforeinstallprompt` y `appinstalled` una sola vez por ventana administrativa. Conserva temporalmente el consumidor real mediante `window.deferredPwaPrompt`, impide el prompt automático, emite `lanzo-pwa-ready`, limpia el evento tras su consumo por la UI existente y lo vuelve a limpiar en `appinstalled`.

La API permite retirar ambos listeners y evita duplicarlos. En una ruta pública limpia el alias no existe y no se instalan listeners administrativos. Chrome headless no emitió de forma fiable el evento real; su aparición visual queda correctamente como validación manual, no como PASS automático.

## 10. Registro del Service Worker

`startAdminServiceWorker()` registra explícitamente `/sw.js` con `{ scope: '/', updateViaCache: 'none' }`, observa `updatefound`, publica estados y solicita `registration.update()` cada hora únicamente si hay conexión.

Una ruta pública limpia no ejecuta ese módulo de registro. `updateExistingAdminWorkerOnPublicRoute()` usa `getRegistration('/')`; si no encuentra registro retorna sin crear uno, y si existe sólo llama `update()` con errores silenciados. No desregistra, activa, borra caches, muestra prompts ni recarga.

## 11. Scope

El scope se conserva intencionalmente en `/`, tanto en el registro como en el manifest. No se intentó cambiarlo a `/app/` porque el POS aún vive en la raíz del origen administrativo. Las excepciones públicas se implementan en la política de navegación; un scope no admite huecos físicos arbitrarios.

## 12. Exclusión de rutas públicas

La denylist anclada cubre `/tienda`, todos sus descendientes y `/conoce-lanzo`, además de preservar `/api` y `/auth`. Se probaron raíz, slash final, slug, tracking token, query y hash. Rutas administrativas que sólo contienen palabras parecidas no coinciden.

Las expresiones son:

- `^/api(?:/|[?#]|$)`
- `^/auth(?:/|[?#]|$)`
- `^/tienda(?:/|[?#]|$)`
- `^/conoce-lanzo(?:/|[?#]|$)`

## 13. Navigation fallback

Una ruta `NetworkOnly` registrada antes del fallback intercepta exclusivamente requests `GET`, `mode: navigate`, mismo origen y pathname público. Después, `NavigationRoute(createHandlerBoundToURL('/index.html'))` atiende sólo navegaciones administrativas no incluidas en la denylist.

En línea, CDP confirmó que la respuesta pública provenía de red. Con el servidor físicamente detenido, la ruta pública produjo error de red y no mostró login, dashboard, POS ni `/index.html`. `/api` y `/auth` continúan fuera del fallback.

## 14. Precache anterior

El artefacto congelado se midió tanto estáticamente como en Cache Storage de Chrome:

- 78 declaraciones y 74 URL únicas.
- 6,320,268 B de cuerpos.
- 48 JS / 4,090,499 B.
- 17 CSS / 747,422 B.
- 22 chunks lazy, tres workers y un chunk de charts.
- Dos links al manifest en el HTML generado.

La lista abarcaba todas las páginas y funcionalidades, incluidos módulos que el usuario no había visitado.

## 15. Precache nuevo

`ADMIN_SHELL_GLOB_PATTERNS` selecciona por patrones estables `index.html`, manifest, iconos PWA, favicon, entry, `App`, CSS base, vendors esenciales y módulos de bootstrap requeridos para arrancar el POS. No contiene hashes concretos.

El artefacto final contiene 26 entradas/URL, 1,813,055 B, 18 JS y tres CSS. No incluye páginas lazy, `PosPage`, `DashboardPage`, `SettingsPage`, `ProductsPage`, `CustomersPage`, `EcommerceOrdersPage`, modales pesados, workers ni charts. Workbox reportó 1,770.56 KiB durante el build; la auditoría leyó los bytes exactos de los cuerpos.

## 16. Comparación cuantitativa

| Métrica | Worker anterior | Worker nuevo | Cambio |
|---|---:|---:|---:|
| Entradas declaradas | 78 | 26 | -52 (-66.67 %) |
| URLs únicas | 74 | 26 | -48 (-64.86 %) |
| Bytes Cache Storage | 6,320,268 B | 1,813,055 B | -4,507,213 B (-71.31 %) |
| JS precacheados | 48 | 18 | -30 (-62.50 %) |
| CSS precacheados | 17 | 3 | -14 (-82.35 %) |
| Chunks lazy | 22 | 0 | -22 (-100 %) |
| Workers | 3 | 0 | -3 (-100 %) |
| Charts | 1 | 0 | -1 (-100 %) |
| Manifest duplicados | 2 links estáticos | 0 links estáticos | -2; administración crea 1 en runtime |

Se supera el umbral requerido de 50 % de reducción en bytes y 60 % en cantidad de JS.

## 17. Shell administrativo offline

Tras instalar el worker nuevo, una navegación offline a `/configuracion` devolvió documento 200 desde el Service Worker, permaneció controlada y mostró el cuerpo administrativo. Esto demuestra que el precache reducido no rompe el arranque del shell.

La fase no promete que todas las páginas lazy estén disponibles sin haber sido visitadas. Esa promesa no existía documentada y sería incompatible con la reducción solicitada.

## 18. Runtime cache

| Cache | Estrategia | Límite | Vigencia |
|---|---|---:|---:|
| `lanzo-admin-static-v1` | CacheFirst | 60 entradas | 30 días |
| `lanzo-admin-media-v1` | CacheFirst | 30 entradas | 7 días |

Sólo se aceptan `GET` de mismo origen, respuesta 200, nombre hasheado bajo `/assets/`, destino `script`/`style` o `font`/`image`, y referrer no público. Un chunk lazy no visitado permanece ausente durante instalación. La auditoría visitó `AboutPage`: el chunk no estaba en precache, llegó por red, se almacenó con 15,626 B y luego se importó offline.

## 19. Seguridad del cache

| Recurso | ¿Cacheado? | Justificación |
|---|---|---|
| JS/CSS hasheado | Sí, administrativo | GET, mismo origen, ruta/destino acotados y respuesta 200 |
| Imágenes estáticas | Sí, administrativas | Sólo asset hasheado, mismo origen, GET y respuesta 200 |
| Supabase RPC | No | No coincide con `/assets/`, ni destino permitido; externo además falla same-origin |
| Auth | No | No coincide con reglas runtime y navegación `/auth` está excluida |
| POST | No | Todas las reglas runtime exigen GET |
| Pedidos | No | No son assets estáticos permitidos |
| Clientes | No | Datos privados/API no coinciden con la regla |
| Inventario remoto | No | Respuesta de datos/API no coincide con la regla |
| Catálogo público | No en Workbox | Su cache aprobada sigue siendo Dexie |
| Tracking | No | Navegación pública usa NetworkOnly; datos no se cachean |

No se almacenan tokens, sesiones, credenciales, direcciones, teléfonos, correos, caja, ventas, staff, `/rest/`, `/functions/`, `/storage/` ni `/rpc/`.

## 20. Actualización y waiting

El registro detecta `registration.waiting` y workers recién instalados como actualización. El estado se comunica a `UpdatePrompt`, pero no se llama `skipWaiting()` en instalación ni activación. La simulación mantuvo el worker nuevo en `waiting` durante 1.5 s y confirmó que el worker anterior seguía activo hasta la acción explícita.

## 21. SKIP_WAITING

`activateAdminServiceWorkerUpdate()` sólo opera si existe un worker en espera. Una promesa compartida y el flag `skipWaitingSent` garantizan como máximo un mensaje `{ type: 'SKIP_WAITING' }`, incluso ante acciones repetidas. El worker también ignora mensajes posteriores mediante `skipWaitingRequested`.

La auditoría registró exactamente un mensaje y una activación. No existe activación automática incondicional ni `clientsClaim()`.

## 22. Controller change

El listener de `controllerchange` sólo recarga si antes se envió `SKIP_WAITING`. `controllerChangeHandled` limita el efecto a una vez, resuelve la promesa de actualización, limpia el timeout y elimina el estado waiting.

La migración midió un `controllerchange` y una recarga. No hubo loop.

## 23. Migración desde worker antiguo

`scripts/audit-pwa-upgrade.mjs` sirvió primero el `dist` congelado, instaló su worker real y verificó 74 URL/6,320,268 B. Sin cambiar el perfil, sirvió el `dist` nuevo en el mismo origen y pidió actualización.

El worker nuevo llegó a `waiting`; no activó por sí solo. Tras el mensaje explícito activó, controló la página, recargó una sola vez y dejó 26 URL/1,813,055 B. De las 56 rutas obsoletas detectadas en el precache anterior quedaron cero. No hubo errores de consola ni excepciones.

## 24. Limpieza de caches

`cleanupOutdatedCaches()` conserva la limpieza normal de precaches Workbox después de activar. La limpieza adicional sólo elimina nombres que cumplan `^lanzo-admin-(static|media)-v\d+$` y no sean la versión actual.

La prueba creó `lanzo-admin-static-v0`, que fue eliminado. Se conservaron el precache actual, `lanzo-admin-static-v1`, `lanzo-admin-media-v1`, el cache ficticio `external-fixture-cache` y el cache `lanzo-public-store-cache`. No existe un barrido indiscriminado de `caches.keys()`.

## 25. Conservación de almacenamiento

Antes de migrar se escribieron sentinelas en IndexedDB, `localStorage` y `sessionStorage`. Después de la activación se conservaron:

- bases IndexedDB `LanzoDB1`, `lanzo-public-store-cache` y `pwa-upgrade-sentinel`;
- valor del sentinel de IndexedDB;
- claves/valores de `localStorage` y `sessionStorage`;
- Cache Storage `lanzo-public-store-cache`;
- cache externo ficticio.

No se llamó a APIs de borrado de bases o storage.

## 26. Rutas públicas con worker activo

| Escenario | Resultado |
|---|---|
| Pública limpia | PASS: 0 manifest, 0 registros, 0 controller, sin alias ni shell administrativo |
| Administrativa limpia | PASS: 1 manifest, 1 registro activo, scope `/`, shell administrativo |
| Instalación nueva | PASS: 26 entradas, runtime caches inicialmente vacíos |
| Shell offline | PASS: navegación administrativa 200 desde SW |
| Módulo visitado offline | PASS: AboutPage guardado bajo demanda e importable offline |
| Módulo no visitado | PASS: ausente de instalación/precache |
| Pública online con SW | PASS: respuesta de red, sin fallback administrativo |
| Pública offline con SW | PASS: error de red, sin POS/login/dashboard |
| Update antiguo → nuevo | PASS: worker real anterior y nuevo medidos en el mismo perfil |
| Worker waiting | PASS: permaneció esperando confirmación |
| Activación explícita | PASS: un `SKIP_WAITING` |
| Limpieza de cache | PASS: precache/runtimes obsoletos acotados eliminados |
| Storage conservado | PASS: Cache Storage ajeno, IndexedDB, local y session intactos |
| Sin loop | PASS: un controllerchange y una recarga |

## 27. Build público preservado

`npm run build:store` generó exactamente 9 archivos y 722,887 B: 663,757 B de JavaScript, 57,675 B de CSS y entry de 87,471 B. La comparación SHA-256 contra el baseline congelado encontró cero archivos diferentes.

`dist-store` conserva cero manifest, `sw.js`, Workbox, registro PWA, App/POS y chunks administrativos. No se cambió `src/main-store.jsx`, `store/index.html`, `vite.store.config.js` ni la arquitectura pública.

## 28. Pruebas automatizadas

- Tests públicos originales: **102/102 PASS**. Se ejecutaron en sublotes de 41, 46 y 15 por el costo del entorno; todos terminaron con código 0.
- Tests PWA nuevos: **64/64 PASS** en 7 archivos.
- Cobertura: documento/manifest, listeners, registro público/administrativo, denylist, reglas runtime, seguridad, cleanup, waiting, `SKIP_WAITING`, recarga única, `UpdatePrompt` y contrato del build.
- Fallos finales: 0.
- Tests omitidos: 0.
- Búsqueda final: sin `.skip`, `.todo` ni `eslint-disable` en tests, módulos o auditores nuevos.

Los archivos principales son `adminPwaDocument.test.js`, `publicNavigationPolicy.test.js`, `adminRuntimeCache.test.js`, `publicRouteWorkerUpdate.test.js`, `adminServiceWorker.test.js`, `UpdatePrompt.test.jsx` y `adminPwaArchitecture.test.js`.

## 29. Auditoría de navegador

`node scripts/audit-admin-pwa.mjs` pasó los escenarios limpio público, limpio administrativo, instalación, shell offline, chunk bajo demanda y pública online/offline con worker activo. `node scripts/audit-pwa-upgrade.mjs --baseline-dir <baseline> --new-dir dist` pasó la migración antigua → nueva y la conservación de storage.

Ambos auditores limitaron URLs a loopback, usaron perfiles efímeros, bloquearon DNS externo mediante CDP, no contactaron servicios remotos y emitieron JSON sanitizado. Hubo cero errores de consola y cero excepciones. Los perfiles se eliminaron; Chrome y los servidores se cerraron. Los puertos 50500 y 50528 quedaron libres.

`beforeinstallprompt` real no se observó en headless y no se contabilizó como PASS visual.

## 30. Lint

El lint dirigido sobre Vite, `main.jsx`, `App.jsx`, `UpdatePrompt`, todos los módulos/tests PWA y scripts de auditoría terminó con código 0 en 54.6 s. Sólo mostró el aviso no bloqueante de `baseline-browser-mapping` desactualizado; no se actualizó la dependencia por restricción.

`npm run lint` se ejecutó con límite razonable y agotó 244.2 s sin producir resumen; por tanto, **no se declara PASS**. La deuda global conocida más reciente sigue siendo 158 errores y 224 warnings. El lint dirigido demuestra que ningún hallazgo pertenece a los archivos de esta fase.

## 31. Builds finales

- `npm run build`: PASS; `dist` con 74 archivos y 6,343,112 B; manifest y `sw.js` presentes; 26 entradas de precache.
- `npm run build:store`: PASS; `dist-store` con 9 archivos y 722,887 B; cero PWA y cero bytes de diferencia contra baseline.
- `node scripts/audit-public-delivery.mjs dist`: PASS; 26/26 recursos de precache encontrados, sin referencias locales faltantes.
- `node scripts/audit-public-delivery.mjs dist-store`: PASS; cero violaciones PWA/administrativas y sin referencias faltantes.

Los directorios `dist` y `dist-store` son artefactos regenerables; no se editaron manualmente.

## 32. Hallazgos y correcciones

1. La inyección automática del manifest no podía distinguir rutas en el HTML compartido. Se desactivó y se reemplazó por generación de archivo + enlace administrativo en runtime.
2. `generateSW` no ofrecía el control explícito requerido para navegación pública, cleanup y seguridad. Se migró a `injectManifest` con worker fuente auditable.
3. El precache global incluía páginas lazy, workers y charts. Se reemplazó por patrones estables del shell mínimo.
4. La recuperación de errores lazy borraba caches de forma demasiado amplia. Ahora sólo elimina los dos caches runtime administrativos actuales.
5. La primera ejecución de los tests PWA nuevos mostró 11 fallos por fixtures de documento incompletos y una aserción ubicada en el módulo incorrecto. Se corrigieron los fixtures/aserciones sin desactivar pruebas ni ampliar timeouts globales; el cierre fue 64/64.
6. El lote combinado de nueve archivos UI públicos agotó el límite externo y terminó con EPIPE sin reportar fallos. Se dividió, sin cambiar tests: 46/46 y 15/15 PASS; junto con 41/41 confirma 102/102.
7. `agent-browser` no estaba instalado y se prohibió descargar herramientas; se utilizó Chrome local por CDP, permitido por la fase.

## 33. Riesgos residuales

1. Un worker antiguo puede permanecer activo hasta que el navegador compruebe la actualización y el usuario acepte activarla.
2. Usuarios que no vuelvan al POS pueden tardar en recibir el worker nuevo.
3. Las rutas públicas continúan temporalmente en el origen administrativo.
4. El aislamiento total sólo ocurrirá al desplegar `dist-store` en otro origen.
5. No existe forma de excluir físicamente `/tienda` del `scope /`; la exclusión actual es de comportamiento.
6. El futuro redirect debe esperar una transición razonable del parque de workers.
7. Debe existir observación de adopción/errores antes del cutover.
8. La matriz automatizada usa Chrome/Edge local, no todos los navegadores.
9. `beforeinstallprompt` depende de criterios del navegador y requiere comprobación manual.
10. No hubo deploy; por definición no puede afirmarse eliminación instantánea de workers antiguos de producción.

## 34. Validaciones manuales pendientes

La única validación funcional no automatizable de forma fiable es la aparición visual del prompt de instalación:

1. Crear un perfil nuevo de Chrome.
2. Abrir una ruta administrativa.
3. En Application → Manifest confirmar el manifest de Lanzo POS.
4. En Application → Service Workers confirmar `/sw.js` y scope `/`.
5. Confirmar la opción de instalación cuando Chrome la habilite.
6. Abrir una ruta pública en otro perfil limpio.
7. Confirmar que Manifest está vacío y que no existe registration nueva.
8. Repetir con el worker anterior previamente instalado.
9. Esperar el prompt administrativo de actualización y pulsar “Actualizar ahora”.
10. Confirmar una sola recarga y la reducción de Cache Storage.
11. Confirmar que IndexedDB, `localStorage`, `sessionStorage` y datos POS permanecen.

No debe usarse “Clear site data” durante esta validación de migración.

## 35. Rollback local

No ejecutar salvo decisión explícita. Como no hay Git, el rollback es manual y no debe borrar datos ni caches reales del usuario.

Eliminar los archivos creados:

- `src/pwa/adminManifest.js`
- `src/pwa/adminPwaDocument.js`
- `src/pwa/adminInstallPrompt.js`
- `src/pwa/publicNavigationPolicy.js`
- `src/pwa/adminRuntimeCache.js`
- `src/pwa/publicRouteWorkerUpdate.js`
- `src/pwa/adminServiceWorker.js`
- `src/pwa/sw.js`
- los cinco tests bajo `src/pwa/__tests__` y `src/components/common/UpdatePrompt.test.jsx`
- `src/architecture/__tests__/adminPwaArchitecture.test.js`
- `scripts/lib/pwa-audit-helpers.mjs`
- `scripts/audit-admin-pwa.mjs`
- `scripts/audit-pwa-upgrade.mjs`
- este reporte.

Restaurar manualmente `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/components/common/UpdatePrompt.jsx` y `scripts/audit-public-delivery.mjs` desde una copia anterior confiable. En Vite, volver a `generateSW` implícito, `injectRegister: auto`, `registerType: prompt`, manifest configurado por el plugin, `globPatterns: **/*.{js,css,html,ico,png,svg,woff2}`, `navigateFallback: /index.html`, denylist sólo `/api` y `/auth`, y `cleanupOutdatedCaches: true` sin runtime cache.

En `index.html`, restaurar el link/metadatos instalables y listeners globales de `beforeinstallprompt`/`appinstalled`. En `UpdatePrompt`, restaurar `useRegisterSW` de `virtual:pwa-register/react` y su flujo anterior. En `App.jsx`, restaurar la limpieza lazy anterior sólo si la copia confiable así lo contiene. Retirar el registro bootstrap y la comprobación pública de actualización de `main.jsx`.

Los nombres nuevos `lanzo-admin-static-v1` y `lanzo-admin-media-v1` dejarán de recibir escrituras; no borrarlos manualmente del navegador durante el rollback. `dist` y `dist-store` se regeneran con sus comandos de build y no deben restaurarse archivo por archivo.

## 36. Criterios para iniciar ECOM.PUBLIC.DEPLOY.1

Se cumplen localmente los criterios técnicos: migración antigua → nueva, precache reducido, shell administrativo offline, rutas públicas sin fallback administrativo, `dist-store` limpio, 102 tests públicos y 64 tests PWA verdes, storage conservado y ausencia de loop.

Antes de iniciar DEPLOY.1 se recomienda completar la validación manual de instalación, revisar este informe, definir observación del worker antiguo y acordar la ventana de transición/cutover. Esta fase no creó el despliegue, dominio ni redirects.

## 37. Conclusión

La PWA administrativa sigue funcional y ahora está aislada por bootstrap y política de navegación. Las rutas públicas temporales quedaron fuera del fallback administrativo; una visita limpia no anuncia ni registra la PWA. El precache bajó 71.31 % en bytes y eliminó páginas lazy, workers y charts, mientras el shell mínimo sigue funcionando offline y los módulos visitados se cachean bajo demanda.

La actualización real desde el worker anterior funciona con waiting, confirmación explícita, una sola activación/recarga y limpieza acotada, sin pérdida de storage. `dist-store` continúa aislado y sin cambios. Existen condiciones técnicas locales para evaluar ECOM.PUBLIC.DEPLOY.1 después de revisión, pero esa fase no se inició.
