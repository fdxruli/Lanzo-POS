# ECOM.PUBLIC.CUTOVER.2

Fecha: 2026-07-14 (America/Mexico_City)  
Estado: **COMPLETA** — el cierre pendiente se verificó mediante `ECOM.PUBLIC.CUTOVER.2.1` con Chrome aislado y CDP directo. No se aplicó corrección ni se desplegó.

## 1. Resumen ejecutivo

El source revisado conserva CUTOVER y el hotfix QR. Los builds locales, el contrato CUTOVER, el lint dirigido, las pruebas dirigidas y las dos auditorías HTTP/PWA de `lanzo-store` pasaron. El alias público sigue siendo byte-idéntico al build público local (9/9 archivos). Vercel mantiene el deployment Git de `lanzo-pos` en `main` y el deployment CLI prebuilt de `lanzo-store` sin integración Git observable.

El cierre se completó mediante la comprobación remota en perfil efímero: registro `/sw.js`, scope `/`, activación, controller tras recarga, precache y aislamiento con `lanzo-store`.

## 2. Estado heredado

Fases cerradas registradas: `ECOM.PUBLIC.ARCH.0/.1/.2`, `PWA.1`, `DEPLOY.1/.1.1`, `CUTOVER.1/.1.1` y `HOTFIX ECOM.PUBLIC.QR.1`.

**Validación manual suministrada por el usuario:** Configuración → Portal online abre sin crash; se pudo generar una tienda de prueba; el enlace público abre y muestra productos. No se presenta como prueba ejecutada por Codex.

## 3. Alcance

Sólo lectura salvo este reporte y la regeneración temporal permitida de `dist` y `dist-store` mediante build. No se usaron Git/GitHub, Supabase, SQL, pedidos, `ecommerce_create_order`, credenciales, despliegues, previews, aliases, dominios, variables ni cambios de configuración.

## 4. Estado de main

El source del workspace contiene los archivos CUTOVER solicitados y sus contratos. La consulta remota identifica el deployment activo de admin como fuente Git, rama `main`, SHA `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`. Por restricción de fase no se ejecutó ningún comando Git para contrastar el `HEAD` local.

## 5. Historial accidental de cargas

Vercel lista varios deployments Git anteriores de `lanzo-pos` durante las cargas directas a `main`, incluidos intentos `ERROR`; no se atribuyen a CUTOVER.2. Esta fase creó 0 deployments.

## 6. Inventario de archivos

Presentes y coherentes: `src/config/publicOrigins.js`, `PublicStoreQrCode.jsx`, `EcommercePortalSettings.jsx`, `PublicCheckoutDialog.jsx`, `PublicOrderConfirmation.jsx`, `PublicLanzoLandingPage.jsx`, ambos tests QR, `vercel.json`, `vercel.store.json`, ambas configuraciones Vite, `src/pwa/sw.js` y los cuatro scripts solicitados.

Confirmaciones de source:

- `PUBLIC_STORE_ORIGIN`: `https://lanzo-store.vercel.app`; `ADMIN_APP_ORIGIN`: `https://lanzo-pos.vercel.app`.
- El QR entrega `new Map()` como quinto argumento de ZXing y contiene la excepción con fallback local accesible.
- La integración QR importa ZXing real, sin mock.
- Tracking usa `buildPublicTrackingUrl`; CTA de landing usa `buildAdminWelcomeUrl`; volver a tienda es relativo y slug/token se codifican.
- No hay builder con `window.location.origin` para tiendas, URL nueva bajo `lanzo-pos/tienda`, ni `redirects` añadidos.
- Las rutas legacy permanecen en `main.jsx` y el worker las excluye del fallback PWA administrativo.

## 7. Archivos duplicados/sospechosos

No se encontraron módulos `publicOrigins` duplicados, configuración Vercel copiada, tests QR duplicados, `.env`, `.vercel`, tokens, artefactos de navegador ni sufijos `copy`, `(1)`, `final`, temporales o backups.

Se encontraron reportes históricos fuera de `docs/reports` (principalmente `reports/` e informes de fases Supabase). Se clasifican como **históricos**, fuera del alcance CUTOVER y no bloqueantes. `dist` y `dist-store` existen como artefactos de build permitido; no se determinó su estado de versionado por prohibición de comandos Git.

## 8. Estado Vercel inicial

Snapshot inicial: 2026-07-14T23:02:29.740Z para HTTP store; Vercel mostraba los mismos deployments que el snapshot final. No hubo errores runtime agrupados en los últimos 7 días en ninguno de los dos proyectos.

## 9. Deployment administrativo

- Proyecto/ID: `lanzo-pos` / `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`.
- Production activo: `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE`, Ready, fuente Git.
- URL inmutable: `https://lanzo-ktqpxj9y7-fdxrulis-projects.vercel.app`.
- Rama/SHA: `main` / `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`.
- Alias: `https://lanzo-pos.vercel.app`, `lanzo-pos-fdxrulis-projects.vercel.app`, `lanzo-pos-git-main-fdxrulis-projects.vercel.app`.
- Framework: Vite; sin dominio personalizado observado.

## 10. Deployment público

- Proyecto/ID: `lanzo-store` / `prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4`.
- Production activo: `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`, Ready, fuente CLI/prebuilt.
- URL inmutable: `https://lanzo-store-d1wvbysqz-fdxrulis-projects.vercel.app`.
- Alias: `https://lanzo-store.vercel.app`, `lanzo-store-fdxrulis-projects.vercel.app`, `lanzo-store-fdxruli-fdxrulis-projects.vercel.app`.
- Framework: ninguno; metadata sólo `actor: codex`, sin metadata Git, consistente con store separado sin Git Integration.

| Proyecto | Deployment | Fuente | SHA | Estado |
|---|---|---|---|---|
| lanzo-pos | dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE | Git | efbb6c7… | Ready |
| lanzo-store | dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg | CLI prebuilt | — | Ready |

## 11. Paridad Git

El deployment admin activo declara explícitamente repo `fdxruli/Lanzo-POS`, `main` y SHA verificado. Su bundle remoto contiene `https://lanzo-store.vercel.app` y no contiene `https://lanzo-pos.vercel.app/tienda`. La igualdad byte a byte con build local no es exigible: el build inyecta fecha y metadato opcional de commit; para respetar la prohibición Git se construyó sin ejecutarlo, por lo que el metadato quedó `local`. La paridad semántica pasó.

## 12. Build admin

`npm run build` pasó (build principal 2m15s; worker 20.81s): 74 archivos, 6,349,691 B, entry `assets/index-CPCQmhfS.js`, index SHA-256 `ed74c42fcdaa2c68b23763e32f690a4f9ea97ca000fc11fbe658fb83a3e867bc`, entry SHA-256 `11621c0e508d958c41e4a096808d3a5d5333fbb9025d71c969736a706a221353`, SW SHA-256 `fbd8e6c02906d0113c576090f6c196a86de28375f91e1574f217c8bc62242dd1`.

Manifest y `sw.js` presentes; 26 entradas de precache (1,773.20 KiB), Workbox presente, 0 sourcemaps, secretos, `service_role` o URLs loopback de pruebas. Hubo sólo avisos existentes de imports dinámicos/estáticos y `baseline-browser-mapping`.

## 13. Build store

`npm run build:store` pasó: 9 archivos, 724,601 B. No contiene manifest, worker, Workbox, sourcemaps, secretos, QR administrativo, configuración/admin chunks. Sólo la responsabilidad esperada: `lanzo-store` como origen público y `lanzo-pos` en CTA administrativa.

## 14. Tests públicos

130/130 PASS en los grupos públicos actuales: config/orígenes, router, enlaces de portal, checkout, imágenes, landing, tracking, página tienda, catálogo, servicios y carrito. El histórico de 102 no coincide con la matriz actual, que incluye 28 casos adicionales; no hubo `.skip`, `.todo` ni aumento de timeout.

## 15. Tests PWA

49/49 PASS: `adminPwaDocument` 7, `adminServiceWorker` 6, `adminRuntimeCache` 14, `publicRouteWorkerUpdate` 3 y `publicNavigationPolicy` 19. El total actual explica la diferencia frente a los 64 históricos.

## 16. Tests DEPLOY

`publicDeploymentArchitecture`: 43/43 PASS; `vercelPrebuiltDeployment`: 20/20 PASS. El conjunto de arquitectura ejecutado fue 101/101, incluyendo además admin package 6, CUTOVER 12, PWA architecture 12, public build 5 y parity fixtures 3.

## 17. Tests CUTOVER

Los contratos CUTOVER incluidos en arquitectura y los componentes/enlaces públicos pasaron. `npm run audit:cutover` terminó PASS con los 31 checks: orígenes, QR, tracking, CTA, legacy, redirects, PWA admin y ausencia PWA store.

## 18. Tests QR

4/4 PASS: unitario Map/fallback/aislamiento y 1 integración con ZXing real. El fallo QR no propaga excepciones, mantiene el enlace y acciones portal; el test real valida SVG, path, quiet zone y `data-qr-value`.

## 19. Lint

ESLint dirigido sobre los cinco archivos de source y los cuatro scripts solicitados: exit 0. Única salida: aviso externo `baseline-browser-mapping`.

## 20. Auditoría lanzo-store

Dos ejecuciones read-only de `audit:store:remote` pasaron, con perfiles Chrome efímeros eliminados. Se usó sólo `slug-inexistente-seguro`; no se enumeraron tiendas ni se creó pedido.

## 21. Headers

Store: shell/canonical/robots/404 llevan `X-Robots-Tag: noindex, nofollow, noarchive`; no hay COOP administrativo. Admin: `/`, manifest, SW, configuración y rutas legacy responden 200 con `Cross-Origin-Opener-Policy: same-origin-allow-popups`.

## 22. Caché

Store shell: `public, max-age=0, must-revalidate`; 8 assets hasheados: `public, max-age=31536000, immutable`; robots correcto. Admin shell, manifest y worker: revalidable.

## 23. Rutas sensibles

Store devuelve 404 real `text/plain`, noindex y sin index para `.env*`, packages, `src`, configs, `.git`, `node_modules`, docs/scripts, manifest y SW. `/_src` responde 307 sólo hacia `vercel.com`, sin exposición.

## 24. Auditoría lanzo-pos

HTTP read-only PASS: `/`, `/manifest.webmanifest`, `/sw.js`, `/configuracion?tab=portal-online`, `/tienda/slug-inexistente-seguro` y `/conoce-lanzo` son 200, sin redirect y con COOP. El entry remoto `assets/index-CLPq5GKE.js` contiene `lanzo-store` y no `lanzo-pos/tienda`; no se observó mixed content.

## 25. PWA

Admin: evidencia local completa (manifest, SW, Workbox y 26 precache) y evidencia HTTP remota (manifest/SW 200). Store: perfil efímero remoto confirma 0 manifest, 0 registro/controlador SW, 0 Workbox/caches/IndexedDB/localStorage administrativo.

## 26. Aislamiento de orígenes

Store se comprobó en perfil efímero: controller `null`, sin cookies administrativas, sin tokens en URL, sin mixed content y sin chunks admin. El aislamiento del worker admin sobre el store se infiere además de ser orígenes distintos. Falta confirmar con perfil efímero el registro/controlador del alias admin actual.

## 27. Tienda de prueba

No había URL QA exacta ni sesión administrativa segura disponible. Se validó exclusivamente `slug-inexistente-seguro`; carga shell, no overflow a 375/768/1440, sin imágenes rotas ni errores. La validación de productos, precios, carrito y móvil de una tienda real queda como **validación manual suministrada por el usuario**; pedidos creados: 0.

## 28. Acciones del portal

Sin sesión segura no se ejecutaron contra un portal real. Tests confirman Abrir/Copiar/Compartir/QR/WhatsApp con `https://lanzo-store.vercel.app/tienda/negocio-ejemplo`; bundle y source coinciden. Sin mensajes WhatsApp ni pedidos.

## 29. QR

Map real: sí. ZXing real: sí, 1 test PASS. Fallback: sí, no bloqueante. Renderizado autenticado/escaneo físico: no ejecutado. La prueba manual disponible es la suministrada por el usuario.

## 30. Tracking

Builders, tests y bundle conservan tracking en `lanzo-store`; token/slug se codifican; WhatsApp acepta sólo tracking público válido. Sin tokens reales.

## 31. Landing

La landing construye CTA administrativa con `https://lanzo-pos.vercel.app/?welcome=1`; retorno a tienda permanece relativo. Tests 2/2 PASS y no hay open redirect.

## 32. Compatibilidad legacy

`/tienda/:slug`, `/tienda/:slug/pedido/:trackingToken` y `/conoce-lanzo` permanecen registrados y responden 200 en admin, sin redirección hacia store.

## 33. Supabase

Única lectura remota observada: RPC `ecommerce_get_portal_by_slug` para el slug seguro (POST y OPTIONS; CORS sin error). Escrituras: 0; pedidos: 0; `ecommerce_create_order`: 0; `service_role`: 0.

## 34. Segunda instantánea

Store final: 2026-07-14T23:11:30.848Z, PASS, mismas rutas/headers/hash del snapshot inicial. Vercel final mantiene `dpl_F8n…` y `dpl_GkVE…`, aliases y estados Ready. No apareció deployment concurrente.

## 35. Costos

| Recurso | Cantidad creada en CUTOVER.2 |
|---|---:|
| Deployments | 0 |
| Previews | 0 |
| Proyectos | 0 |
| Dominios | 0 |
| Functions | 0 |
| Pedidos | 0 |
| Escrituras Supabase | 0 |

Sin DNS, Middleware, recursos pagados ni cambios Supabase. Los deployments Git accidentales previos no se atribuyen a esta fase.

## 36. Archivos creados

- `docs/reports/ECOM.PUBLIC.CUTOVER.2.md`

## 37. Archivos modificados

- `docs/reports/ECOM.PUBLIC.CUTOVER.2.md`
- `dist` y `dist-store` fueron regenerados sólo como artefactos temporales permitidos de validación.

## 38. Riesgos residuales

El único riesgo de cierre es la falta de comprobación PWA remota administrativa mediante perfil efímero. La integración Chrome no pudo inicializarse porque su `scripts/browser-client.mjs` no está instalado localmente. No es evidencia de regresión de producto.

## 39. Rollback

No ejecutado. Referencias conservadas: store bueno `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`; admin manual anterior `dpl_39FyshBw92YaNMyKPN9BwWLfZ8uN`; admin Git actual `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE`. Cualquier rollback requiere fase separada autorizada.

## 40. Conclusión

| Superficie | Source main | Build local | Remoto | Resultado |
|---|---|---|---|---|
| Origen tienda | lanzo-store | presente | bundle/admin y store | PASS |
| Origen admin | lanzo-pos | presente | landing/admin | PASS |
| QR Map | sí | incluido | Git/main semántico | PASS |
| QR fallback | sí | incluido | Git/main semántico | PASS |
| Tracking | lanzo-store | incluido | store/auditoría | PASS |
| Landing CTA | lanzo-pos | incluido | store/auditoría | PASS |
| PWA admin | sí | manifest/SW/26 precache | HTTP sólo | PENDIENTE PERFIL |
| PWA store | ausente | ausente | perfil efímero ausente | PASS |

| Acción | URL esperada | Resultado |
|---|---|---|
| Abrir tienda | lanzo-store | PASS por test/source |
| Copiar | lanzo-store | PASS por test |
| Compartir | lanzo-store | PASS por test |
| QR | lanzo-store | PASS por test real |
| WhatsApp | lanzo-store | PASS por test |
| Tracking | lanzo-store | PASS |
| CTA administración | lanzo-pos | PASS |

La fuente y build reproducen el contrato CUTOVER, el deployment Git conserva `main`, `lanzo-store` sigue estable y el hotfix QR puede cerrarse técnicamente. CUTOVER.2 no puede cerrarse aún porque falta una sola evidencia remota obligatoria de PWA admin. Mini-fase mínima propuesta, sin cambios de source ni deployment: **CUTOVER.2.1** debe restaurar el cliente Chrome o proporcionar un perfil efímero equivalente y validar registro, scope y controlador de `/sw.js` en `lanzo-pos`; después repetir la instantánea Vercel/HTTP.

## 41. Cierre mediante CUTOVER.2.1

Método: Chrome 150.0.7871.115 en modo headless con remote debugging/CDP y dos perfiles bajo `%TEMP%/lanzo-cutover-2-1-chrome-*`; no se usó perfil personal, extensión, credencial ni dependencia nueva. Los perfiles y el script temporal se eliminaron al finalizar.

- Deployment probado: admin `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE`, Git `main`, SHA `efbb6c7…`, Ready; store `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`, CLI prebuilt, Ready.
- Admin: manifest y `/sw.js` 200; un único registro con scope `https://lanzo-pos.vercel.app/`; activo `/sw.js` en estado `activated`; `updateViaCache: none`.
- Controller: `null` antes de la recarga (admisible en perfil nuevo); después de una sola recarga, `/sw.js` `activated`. Sin `controllerchange` repetido, sin navegación inesperada durante 10 s y sin loop.
- Precache: `workbox-precache-v2-https://lanzo-pos.vercel.app/` con 26 entradas, incluido index y assets administrativos; sin rutas `/tienda` como shell precache.
- Admin y legacy: `/`, configuración, `/tienda/slug-inexistente-seguro` y `/conoce-lanzo` respondieron 200, quedaron controlados y no redirigieron al store; 0 errores de consola, excepciones, mixed content o solicitudes fallidas requeridas.
- Store: en perfil independiente, 0 registros, controller `null`, 0 manifest/SW solicitados, 0 Workbox/caches/IndexedDB/storage/cookies administrativas y 0 tokens URL.
- Snapshot final: permanecieron IDs, aliases y estados de los dos deployments; no hubo deployment concurrente. ETags finales: admin index `e15ff5cef48b16eb8b93f7c4fdf75ced`, store index `ccbe02d6a678f735e38047c35d0b5904`.

Con esta evidencia CUTOVER.2 queda **COMPLETA**.
