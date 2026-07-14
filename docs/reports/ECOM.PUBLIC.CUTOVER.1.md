# ECOM.PUBLIC.CUTOVER.1 — Activar el origen público provisional

Fecha: 2026-07-14  
Estado: **BLOQUEADA ANTES DE ACTIVACIÓN**

## 1. Resumen ejecutivo

La implementación local del cutover quedó terminada y validada. Existe una configuración central de orígenes, los enlaces públicos generados por la aplicación administrativa apuntan a `https://lanzo-store.vercel.app`, y las CTA de adquisición del build público apuntan a `https://lanzo-pos.vercel.app`.

Se ejecutó el único deployment Production autorizado de `lanzo-store`, porque `dist-store` cambió 1,714 B respecto de la línea base. El deployment quedó `Ready` y su contenido coincide byte a byte con `dist-store`. Sin embargo, el gate remoto falló: Vercel no hizo efectiva la configuración incluida en `vercel.json`. Faltan `X-Robots-Tag`, la caché inmutable de assets y los rewrites explícitos; rutas prohibidas como `/.env` reciben el fallback SPA.

Por el orden obligatorio store → validación → admin, no se publicó `lanzo-pos`, no se ejecutó rollback automático y no se declara la fase completa.

## 2. Alcance ejecutado

- Centralización y validación de orígenes públicos y administrativos.
- Corrección de abrir, copiar, compartir, QR y WhatsApp en configuración ecommerce.
- Corrección de tracking y WhatsApp post-checkout.
- Corrección de CTA de adquisición de la landing pública.
- Conservación de rutas legacy, navegación interna, denylist PWA y rewrites existentes.
- Pruebas unitarias/arquitectónicas, builds, auditorías y validación local.
- Un deployment Production de `lanzo-store` y validación remota segura.
- Preparación y auditoría local del paquete administrativo, sin publicarlo.

Fuera de alcance y no realizado: Supabase, SQL, pedidos reales, Git/GitHub, dominios, DNS, previews, Functions, Middleware, cron, Analytics, almacenamiento Vercel, add-ons, recursos pagados y rollback.

## 3. Estado inicial

- `dist-store`: 9 archivos, 722,887 B, sin manifest, Service Worker, Workbox ni código administrativo.
- `lanzo-store`: dos deployments Production `Ready`; el más reciente era `dpl_FSxe…ijFPD`.
- `lanzo-pos`: deployment Production `Ready` `dpl_AsAM…b56e`, sin cambios durante DEPLOY.1.
- Suites conocidas: 102/102 públicas, 64/64 PWA y 43/43 DEPLOY.1.1.
- El workspace no contenía `.git` ni `.vercel` raíz.

## 4. Archivos modificados

- `src/components/ecommerce/EcommercePortalSettings.jsx`
- `src/components/ecommerce/EcommercePortalSettings.css`
- `src/components/ecommerce/public/PublicCheckoutDialog.jsx`
- `src/components/ecommerce/public/PublicOrderConfirmation.jsx`
- `src/pages/PublicLanzoLandingPage.jsx`
- `package.json`

## 5. Archivos creados

- `src/config/publicOrigins.js`
- `src/config/__tests__/publicOrigins.test.js`
- `src/utils/copyTextWithFallback.js`
- `src/utils/__tests__/copyTextWithFallback.test.js`
- `src/components/ecommerce/PublicStoreQrCode.jsx`
- `src/components/ecommerce/__tests__/EcommercePortalPublicLinks.test.jsx`
- `src/components/ecommerce/__tests__/PublicStoreQrCode.test.jsx`
- `src/components/ecommerce/public/__tests__/PublicOrderConfirmation.cutover.test.jsx`
- `src/pages/__tests__/PublicLanzoLandingCutover.test.jsx`
- `src/architecture/__tests__/publicCutoverArchitecture.test.js`
- `src/architecture/__tests__/adminDeploymentPackage.test.js`
- `scripts/audit-public-cutover.mjs`
- `scripts/prepare-admin-deployment.mjs`
- `docs/reports/ECOM.PUBLIC.CUTOVER.1.md`

No se modificó `package-lock.json` ni se agregaron dependencias.

## 6. Clasificación de coincidencias

El inventario final reproducible sobre archivos de texto del proyecto —excluyendo dependencias, builds, cobertura y lockfile— contiene 1,097 coincidencias de los términos obligatorios en 122 archivos. La cifra final incluye la nueva configuración y sus pruebas. El inventario previo aisló seis construcciones de URL pública que requerían corrección.

| Archivo/grupo | Uso | Origen esperado | Acción | Evidencia actual |
|---|---|---|---|---:|
| `EcommercePortalSettings.jsx` | enlaces públicos generados | lanzo-store | cambiar | abrir, copiar, compartir, QR y WhatsApp comparten `reservedLink` |
| `PublicOrderConfirmation.jsx` | tracking público | lanzo-store | cambiar | tracking, copiar y WhatsApp usan builder central |
| `PublicLanzoLandingPage.jsx` | adquisición administrativa | lanzo-pos | cambiar | todas las CTA usan builder central |
| routers públicos y legacy | navegación interna | relativo/origen actual | conservar | sin cambios |
| PWA denylist | exclusión de rutas públicas | relativo | conservar | sin cambios |
| Vercel/Vite/scripts existentes | entrega y auditoría | según proyecto | conservar | sin reemplazo masivo |
| tests y reportes históricos | fixtures/evidencia | contextual | conservar | sin reemplazo masivo |

Distribución final: 784 coincidencias preservadas en 106 archivos, 78 coincidencias dentro de cinco archivos preexistentes modificados y 235 coincidencias de CUTOVER nuevas en once archivos. Se modificaron seis construcciones preexistentes: dos de tienda administrativa, una de tracking y tres CTA fuente —una CTA reutilizada se renderiza en dos planes—.

## 7. Configuración central de orígenes

`src/config/publicOrigins.js` define:

- `ADMIN_APP_ORIGIN`: `https://lanzo-pos.vercel.app`.
- `PUBLIC_STORE_ORIGIN`: `https://lanzo-store.vercel.app`.
- overrides Vite opcionales `VITE_ADMIN_APP_ORIGIN` y `VITE_PUBLIC_STORE_ORIGIN`.
- builders para tienda, tracking, landing y bienvenida administrativa.
- helper para insertar tracking canónico en enlaces `wa.me`.

Los valores por defecto son privados al módulo y las superficies consumidoras usan sus exports/builders.

## 8. Validación de orígenes

La normalización usa `URL` nativa y:

- acepta únicamente `http:`/`https:`;
- exige HTTPS en Production;
- sólo acepta HTTP en `localhost`, `127.0.0.1` o `[::1]` fuera de Production;
- rechaza credenciales, path, query y hash;
- elimina slash final;
- codifica cada segmento dinámico con `encodeURIComponent`;
- valida `https://wa.me` antes de modificar un enlace WhatsApp.

Los 26 tests del módulo cubren defaults, overrides, loopback, protocolos, credenciales, paths, query, hash, slash y encoding.

## 9. Enlaces de tienda

La configuración ecommerce calcula una sola URL canónica con `buildPublicStoreUrl(portal.slug)`. Esa misma URL alimenta:

- botón **Abrir tienda**;
- copiar con Clipboard API y fallback seguro;
- `navigator.share` con fallback a copiar;
- enlace WhatsApp con texto codificado;
- QR SVG generado con la dependencia existente `@zxing/library`.

No se usa `window.location.origin` para construir una tienda pública.

## 10. Tracking

`PublicCheckoutDialog` entrega el slug al componente de confirmación. `PublicOrderConfirmation` construye la URL absoluta mediante `buildPublicTrackingUrl(slug, trackingToken)` y la reutiliza en abrir, copiar y WhatsApp. Si un fixture legacy no contiene token, conserva el WhatsApp original sin inventar una ruta.

No se alteró `trackingPath`, `trackingToken`, estado de pedidos, idempotencia ni lógica de creación.

## 11. Landing y CTA administrativa

Las CTA de adquisición de header, hero y planes usan `buildAdminWelcomeUrl()` y resuelven a `https://lanzo-pos.vercel.app/?welcome=1`. La navegación **Volver a la tienda** conserva su path relativo dentro del origen público actual.

## 12. QR, compartir, copiar y WhatsApp

- QR: codifica la URL completa de `lanzo-store`, expuesta además como `data-qr-value` para auditoría.
- Compartir: `navigator.share({ title, text, url })`; fallback a copiar.
- Copiar: Clipboard API; fallback a `document.execCommand('copy')` en contexto compatible.
- WhatsApp administrativo: `https://wa.me/?text=...` con tienda canónica.
- WhatsApp post-checkout: conserva destino y agrega tracking canónico cuando existe.

## 13. Compatibilidad legacy

Se conservaron:

- `/tienda`;
- `/tienda/:slug`;
- `/tienda/:slug/pedido/:token`;
- `/conoce-lanzo`;
- routers standalone y legacy;
- navegación relativa del build público;
- rutas internas administrativas.

No se añadieron redirects desde `lanzo-pos` hacia `lanzo-store`.

## 14. Service Worker y denylist

La PWA administrativa mantiene la exclusión de rutas públicas y landing. `dist-store` continúa con 0 manifest, 0 Service Worker y 0 Workbox. `dist` contiene manifest, `sw.js` y 26/26 entradas de precache.

## 15. Pruebas públicas históricas

Resultado final: **102/102 PASS** en las 16 suites públicas exigidas. No se omitieron casos.

## 16. Pruebas PWA históricas

Resultado final: **64/64 PASS** en las siete suites PWA exigidas. Cubren prompt de instalación, actualización, `SKIP_WAITING`, `controllerchange`, reload controlado, rutas públicas y persistencia.

## 17. Pruebas DEPLOY.1.1

Resultado final: **43/43 PASS** en `publicDeploymentArchitecture.test.js`.

## 18. Pruebas CUTOVER.1

Resultado final: **57/57 PASS** en ocho archivos:

- orígenes: 26;
- copy fallback: 2;
- enlaces administrativos: 5;
- QR: 1;
- confirmación/tracking: 3;
- landing: 2;
- arquitectura cutover: 12;
- paquete administrativo: 6.

Total de las suites obligatorias: **266/266 PASS**. Cero `.skip`, `.todo` o `eslint-disable` nuevos.

## 19. Lint

El lint dirigido sobre los 17 archivos JS/JSX/MJS creados o modificados terminó con exit code 0. Sólo informó que la metadata opcional de `baseline-browser-mapping` está desactualizada.

El lint global no se declara PASS: una ejecución agotó 244.1 s sin emitir resumen, consistente con la deuda global conocida. No se atribuye ese resultado al cutover.

## 20. Builds

| Build | Estado | Archivos | Bytes | Resultado relevante |
|---|---:|---:|---:|---|
| `dist` admin | PASS | 74 | 6,349,439 | PWA admin presente; origen store correcto |
| `dist-store` público | PASS | 9 | 724,601 | 0 PWA, 0 admin, 0 sourcemaps |

El build público aumentó de 722,887 B a 724,601 B: **+1,714 B (+0.24%)**. El JS pasó de 663,757 B a 665,471 B; CSS permaneció en 57,675 B.

Después de las pruebas con overrides loopback se reconstruyeron ambos artefactos en modo Production. Búsqueda final: cero referencias a `http://127.0.0.1:417*`.

## 21. Auditorías locales

- delivery admin: PASS; 74 archivos; 26/26 precache; 1,815,756 B precacheados.
- delivery store: PASS; 9 archivos; aislamiento público completo.
- CUTOVER: PASS; 31/31 controles.
- paquete público: PASS; cero paths prohibidos, secretos, PWA o módulos administrativos.
- paquete admin: PASS; cero paths prohibidos o secretos; manifest, SW, Workbox, assets y rewrites presentes.
- PWA admin local: PASS en estado limpio, online, offline, módulo visitado y rechazo de fallback admin en rutas públicas.

## 22. Navegador local

Se sirvieron builds con overrides sólo loopback en `127.0.0.1:4173` y `127.0.0.1:4174`.

- 11/11 escenarios admin y 11/11 store completaron su contrato funcional.
- Paridad semántica completa.
- 38 RPC lógicas interceptadas por lado; tres llamadas sintéticas de pedido interceptadas por lado; cero pedidos reales y cero servicios remotos alcanzados.
- 0 errores de consola, excepciones, 404 requeridos, manifest o SW en store.
- La auditoría de paridad terminó con exit 1 por un único error transitorio CDP administrativo `Invalid InterceptionId`; no fue un fallo funcional.
- `audit-admin-pwa.mjs` pasó íntegramente y liberó perfil/puerto.

Los intentos de DOM dump directo que devolvieron contenido vacío se consideraron no concluyentes y no se contaron como evidencia. Todos los perfiles temporales verificados y puertos locales fueron limpiados.

## 23. Deployment público

Se realizó porque el artefacto público cambió.

- proyecto/scope: `fdxrulis-projects/lanzo-store`;
- paquete: 11 archivos, 726,305 B;
- hash de artefacto: `c2d32afd…7897652`;
- hash de paquete: `224cf7c3…c0a3b`;
- intentos Production: **1**;
- previews: **0**;
- flags prohibidos: no usados;
- ID nuevo sanitizado: `dpl_ZeMi…HPd9`;
- URL inmutable: `https://lanzo-store-m347cxg53-fdxrulis-projects.vercel.app`;
- alias: `https://lanzo-store.vercel.app`;
- estado Vercel: `Ready`.

El contenido remoto comparado: 9/9 archivos, 724,601/724,601 B, todos con hash local coincidente.

## 24. Deployment administrativo

**Bloqueado; no ejecutado.**

El paquete aislado quedó preparado y auditado:

- 75 archivos, 6,349,962 B;
- hash `dc804373…91571`;
- cero paths prohibidos;
- cero secretos;
- `index.html`, manifest, `sw.js`, Workbox y assets presentes;
- rewrite administrativo `/(.*) → /index.html` y cero redirects.

No se publicó porque la validación remota previa de `lanzo-store` no pasó. Adicionalmente, la salida de `vercel project inspect` no expuso un campo con el que demostrar el estado de Git Integration de `lanzo-pos`; no se modificó dicha integración.

## 25. Service Worker administrativo

La validación post-deployment no aplica porque el deployment admin no se ejecutó. La evidencia local sí pasó:

- perfil limpio: manifest, metadatos Apple y un registro scope `/` activo;
- offline shell y módulo visitado: PASS;
- rutas públicas: sin fallback administrativo;
- precache: 26 entradas, sin lazy charts/workers no permitidos;
- sin errores de consola ni excepciones;
- sin loop observado localmente.

No se declaró prueba remota old → new porque no hubo nuevo deployment administrativo.

## 26. Validación remota

La parte funcional de `lanzo-store` pasó:

- `/`, `/tienda`, tienda inexistente segura, tracking inexistente seguro y `/conoce-lanzo`: 200 con shell correcto;
- slash final: 308 a la URL canónica sin slash, incluido query string;
- viewports 375×812, 768×1024 y 1440×900: sin overflow ni imágenes rotas;
- 0 manifest, 0 SW, 0 controller, 0 Cache Storage, 0 storage administrativo;
- RPC pública de lectura `ecommerce_get_portal_by_slug`: OPTIONS/POST 200, sin CORS;
- 0 escrituras y 0 pedidos.

El gate HTTP global falló con **43 violaciones**:

- 10 faltas de `X-Robots-Tag` en rutas/canonicalizaciones;
- 24 respuestas de fallback 200 para 12 paths prohibidos;
- 1 falta de noindex en `robots.txt`;
- 8 assets sin caché `immutable`.

La revalidación manual posterior confirmó: `/`, `/robots.txt`, un asset, `/.env` y la tienda segura responden sin `X-Robots-Tag`; `/.env` entrega `text/html` 200 y el asset entrega `max-age=0, must-revalidate`.

No se validaron enlaces cruzados remotos desde admin porque `lanzo-pos` se conservó intacto.

## 27. Supabase

No se modificó Supabase, SQL, schema, RLS, Storage, Auth, datos ni funciones. La única interacción remota fue la RPC pública de lectura autorizada con `slug-inexistente-seguro`. No se invocó `ecommerce_create_order`, no se enumeraron tiendas, no se usaron clientes reales y no hubo escrituras.

## 28. Noindex

El source y el paquete contienen:

`X-Robots-Tag: noindex, nofollow, noarchive`

`robots.txt` remoto contiene `Disallow: /`. No obstante, el header requerido no está activo en el deployment nuevo. Por ello este criterio está **FAIL** y la fase no puede declararse completa.

## 29. Costos

| Recurso | Cambio |
|---|---:|
| Proyectos | 0 nuevos |
| Production deployments | 1 |
| Previews | 0 |
| Dominios/DNS | 0 |
| Functions/Edge/Middleware/cron | 0 |
| Analytics/Speed Insights | 0 |
| Blob/KV/DB/add-ons | 0 |
| Recursos pagados | 0 |

Durante un diagnóstico de un deployment inmutable protegido, `vercel curl` informó que generó automáticamente un token de bypass de protección para el proyecto. Su valor nunca se imprimió ni se leyó; no es un producto pagado ni una variable de aplicación, pero se registra como efecto auxiliar de la CLI.

## 30. Seguridad y secretos

- Paquete store: cero secretos, cero service role, sólo credencial Supabase publicable esperada y `persistSession: false`.
- Paquete admin: cero secretos detectados.
- `.env.local` y `.gitignore` creados por `vercel link` dentro del paquete temporal store fueron eliminados antes del upload.
- `.vercel` raíz permaneció ausente.
- No se publicó source, tests, docs, reportes, lockfile, dependencias ni archivos temporales.

## 31. Git Integration

No existe `.git` local y no se ejecutaron comandos Git/GitHub. No se conectó `lanzo-store` a Git ni se modificó la integración Git de `lanzo-pos`. La inspección de proyecto confirmó IDs, scope y settings generales, pero no mostró el campo de conexión Git solicitado; esta falta de evidencia se conserva como condición de bloqueo del deployment admin.

Riesgo documentado: cuando la integración existente de GitHub produzca un deployment automático, podría sustituir cualquier deployment manual futuro de `lanzo-pos`.

## 32. Cambios remotos

| Proyecto | Deployment anterior | Deployment nuevo | Resultado |
|---|---|---|---|
| lanzo-store | `dpl_FSxe…ijFPD` | `dpl_ZeMi…HPd9` | Ready; artefacto exacto; gate HTTP FAIL |
| lanzo-pos | `dpl_AsAM…b56e` | no realizado | intacto; activación bloqueada |

| Categoría | Cantidad |
|---|---:|
| Proyectos creados | 0 |
| Production deployments adicionales | 1 |
| Previews | 0 |
| Dominios/aliases personalizados | 0 |
| Functions | 0 |
| Pedidos/escrituras Supabase | 0 |

## 33. Riesgos residuales

1. El alias público apunta actualmente al artefacto nuevo sin `X-Robots-Tag` efectivo y con fallback SPA en paths prohibidos.
2. El `vercel.json` del paquete es idéntico al source y pasó auditoría local, pero la inspección del deployment muestra un build estático `.` de 0 ms y la conducta remota demuestra que sus reglas no quedaron activas.
3. No está autorizado un segundo deployment store en esta fase para corregir o experimentar.
4. `lanzo-pos` conserva el código anterior; por tanto, el cutover no está activado desde la aplicación administrativa.
5. La conexión Git administrativa no pudo demostrarse mediante la salida disponible de CLI, aunque no fue modificada.
6. El error CDP local `Invalid InterceptionId` impidió declarar PASS al proceso completo de paridad, aun cuando sus 22 escenarios funcionales pasaron.

## 34. Rollback

No se ejecutó rollback automático.

Plan documentado, sujeto a autorización explícita:

1. Promover en Vercel el deployment público anterior `dpl_FSxe…ijFPD` / `lanzo-store-pqswlu7s3-fdxrulis-projects.vercel.app`.
2. Confirmar alias, HTTPS, rutas profundas, canonicalización, `X-Robots-Tag`, `robots.txt`, caché y ausencia de PWA/admin.
3. Mantener `lanzo-pos` en `dpl_AsAM…b56e`; no hay deployment admin que revertir.
4. Para rollback de código futuro, restaurar los cinco consumidores preexistentes y retirar los helpers/componentes CUTOVER sólo mediante cambio fuente revisado; no borrar rutas nuevas.
5. No restaurar variables, porque no se cambiaron.
6. No borrar pedidos, Supabase, storage, caches reales de usuarios, proyectos ni deployments.
7. Confirmar que cualquier enlace vuelve al origen legacy únicamente después de una decisión explícita de producto.

## 35. Criterios para siguiente fase

No iniciar CUTOVER.2 ni otra fase hasta que exista autorización para resolver el deployment público fallido. Para reanudar CUTOVER.1 se requiere:

- identificar por qué Vercel ignoró las reglas del paquete;
- autorizar una nueva acción remota —nuevo deployment o promoción del anterior—;
- obtener PASS en noindex, caché, paths prohibidos y auditoría remota completa;
- demostrar el estado de Git Integration admin;
- repetir el gate store antes de publicar admin;
- publicar como máximo el deployment admin que se autorice y validar PWA/enlaces cruzados.

## 36. Conclusión

```text
RESULTADO GLOBAL:
BLOQUEADA ANTES DE ACTIVACIÓN

Coincidencias encontradas:
1,097 coincidencias finales en 122 archivos; 6 construcciones preexistentes requerían cambio.

Coincidencias modificadas:
6 construcciones preexistentes de URL; 5 archivos de producción preexistentes contienen cambios CUTOVER.

Coincidencias preservadas:
784 coincidencias en 106 archivos fuera del conjunto modificado/nuevo; rutas, routers, denylist, rewrites y fixtures legacy conservados.

Nuevo origen público:
https://lanzo-store.vercel.app

Origen administrativo:
https://lanzo-pos.vercel.app

Tests:
102/102 públicas; 64/64 PWA; 43/43 DEPLOY.1.1; 57/57 CUTOVER.1; total 266/266.

Builds:
PASS admin (74 archivos, 6,349,439 B) y store (9 archivos, 724,601 B).

Deployment público:
REALIZADO, 1 intento Production, dpl_ZeMi…HPd9, Ready; validación HTTP global FAIL.

Deployment administrativo:
BLOQUEADO; 0 intentos, 0 previews; dpl_AsAM…b56e permanece intacto.

PWA:
PASS local; validación post-deployment admin omitida porque no hubo deployment admin.

Fallos:
43 violaciones HTTP remotas store; un error transitorio CDP en el proceso de paridad local.

Omisiones:
Deployment/validación admin y enlaces cruzados remotos, por gate store fallido. Rollback no ejecutado por prohibición expresa.

Riesgo restante:
El alias store sirve el artefacto nuevo sin X-Robots-Tag efectivo, sin caché inmutable y con fallback SPA para paths prohibidos; admin aún no activa el cutover.
```
