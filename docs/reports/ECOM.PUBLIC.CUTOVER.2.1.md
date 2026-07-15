# ECOM.PUBLIC.CUTOVER.2.1

Fecha: 2026-07-14 (America/Mexico_City)  
Estado: **COMPLETA**

## 1. Resumen

Se cerró la única evidencia pendiente de CUTOVER.2: la PWA del alias administrativo actual se registró, activó y controló una página tras recarga en un perfil efímero. El store permaneció sin PWA. No se modificó producto, datos ni configuración remota.

## 2. Estado heredado

CUTOVER.2 ya había aprobado source, builds, 130/130 públicos, 49/49 PWA, 101/101 arquitectura, auditor CUTOVER 31/31, QR 4/4 y paridad store 9/9. Sólo faltaba navegador remoto admin.

## 3. Restricciones

No se usaron Git/GitHub, Supabase, SQL, pedidos, `ecommerce_create_order`, credenciales, despliegues, previews, alias, dominios, variables, dependencias ni cambios de source/configuración.

## 4. Método de navegador

Método A/D autorizado: `chrome.exe` 150.0.7871.115, headless, perfil `user-data-dir` temporal, remote debugging en puerto efímero y CDP mediante módulos estándar Node. La integración Chrome propia seguía sin `scripts/browser-client.mjs`; por instrucción de la fase se usó el fallback explícitamente autorizado.

## 5. Perfil efímero

Dos perfiles independientes bajo `%TEMP%/lanzo-cutover-2-1-chrome-*`, sin extensiones, cookies ni sesión iniciales. Ambos procesos se cerraron y perfiles se eliminaron; el script temporal también se eliminó.

## 6. Snapshot inicial

Antes del navegador, Vercel reportó admin `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE` Ready, fuente Git, rama `main`, SHA `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`; store `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg` Ready, fuente CLI prebuilt. No había deployment concurrente.

## 7. Documento admin

`https://lanzo-pos.vercel.app/` cargó 200; 0 errores de consola, excepciones, mixed content o fallos de recursos requeridos. La única recarga online posterior se sirvió desde Service Worker.

## 8. Manifest

`/manifest.webmanifest`: 200, `application/manifest+json`; presente en el documento admin. El manifiesto declara nombre Lanzo POS, `start_url: /`, `display: standalone` e iconos PWA 192/512.

## 9. Service Worker

`/sw.js`: 200, JavaScript. Se registró exactamente un worker del alias admin; no existe script inesperado.

## 10. Registro

Una sola registration: `https://lanzo-pos.vercel.app/`; `installing: null`, `waiting: null`, `updateViaCache: none`.

## 11. Scope

Scope confirmado: `https://lanzo-pos.vercel.app/`.

## 12. Instalación

En `navigator.serviceWorker.ready`, el worker podía transitoriamente figurar `activating`; antes de la recarga ya estaba disponible su precache y no hubo error de instalación.

## 13. Activación

El registro y el worker activo alcanzaron `activated` con script `https://lanzo-pos.vercel.app/sw.js`.

## 14. Controller inicial

En la primera navegación limpia el controller fue `null`, comportamiento esperado antes de que un worker nuevo tome control.

## 15. Controller posterior

Tras una sola recarga normal: controller no nulo, script `/sw.js`, estado `activated`, un único registro y mismo scope `/`.

## 16. Recargas

Recargas solicitadas: 1. Navegaciones atribuibles a esa recarga: 1.

## 17. Controllerchange

0 durante la ventana estable de 10 s; no hubo cambio repetitivo.

## 18. Loops

0 loops, 0 recargas continuas y 0 navegaciones inesperadas durante observación de 10 s.

## 19. Precache

Cache `workbox-precache-v2-https://lanzo-pos.vercel.app/` con 26 entradas: index, manifest, iconos y assets administrativos. No contiene rutas `/tienda` como shell precache.

## 20. Navegación admin

`/` y `/configuracion?tab=portal-online` cargaron 200 bajo controller activo. La falta de sesión/licencia no se trató como fallo ni se inventaron credenciales.

## 21. Rutas legacy

`/tienda/slug-inexistente-seguro` y `/conoce-lanzo` devolvieron 200, conservaron el origen admin y controller activo; sin redirect al store, error de servidor ni loop.

## 22. Store sin PWA

En segundo perfil: `/tienda/slug-inexistente-seguro` y `/conoce-lanzo` devolvieron 200 sin manifest ni solicitud `/sw.js`; `getRegistrations()` fue `[]` y controller `null`.

## 23. Aislamiento

El worker admin se limita al scope `https://lanzo-pos.vercel.app/`. En el perfil independiente store tuvo 0 Workbox/caches, IndexedDB, local/session storage, cookies administrativas o tokens URL; no hubo respuestas desde Service Worker.

## 24. Consola y red

Admin/store: 0 `console.error`, 0 excepciones, 0 mixed content y 0 fallos de recursos requeridos. Admin registró 63 respuestas desde Service Worker después de activación; store registró 0.

## 25. Snapshot final

Los deployments, aliases y estados siguieron idénticos al snapshot inicial. Admin index ETag `e15ff5cef48b16eb8b93f7c4fdf75ced`, entry `/assets/index-CLPq5GKE.js`; store index ETag `ccbe02d6a678f735e38047c35d0b5904`, entry `/assets/index-CIg2B-UP.js`, robots 200 y `/.env` 404. No apareció deployment concurrente.

## 26. Supabase

El store realizó sólo la lectura automática pública `ecommerce_get_portal_by_slug` para el slug seguro. Escrituras: 0; pedidos: 0; `ecommerce_create_order`: 0; `service_role`: 0.

## 27. Recursos creados

| Recurso | Cantidad creada |
|---|---:|
| Deployments | 0 |
| Previews | 0 |
| Proyectos | 0 |
| Dominios | 0 |
| Functions | 0 |
| Pedidos | 0 |
| Escrituras Supabase | 0 |

## 28. Limpieza

Perfiles temporales: eliminados. Procesos iniciados: cerrados. Puerto de depuración: cerrado. Script temporal: eliminado. No se tocó el perfil personal.

## 29. Riesgos

Ninguno bloqueante para CUTOVER.2. La observación se realizó sobre el alias activo y no implica prueba de autenticación, pedido ni escaneo QR.

## 30. Conclusión

| Control PWA admin | Resultado |
|---|---|
| Manifest 200 | PASS |
| SW 200 | PASS |
| Registro encontrado | PASS |
| Cantidad de registros | 1 |
| Scope / | PASS |
| Estado activated | PASS |
| Controller inicial | null admisible |
| Controller tras recarga | `/sw.js`, activated |
| Controllerchange | 0 repetitivos |
| Recargas | 1 |
| Loop | 0 |
| Precache | 26 entradas |

| Control store | Resultado |
|---|---|
| Manifest ausente | PASS |
| Registros SW | 0 |
| Controller | null |
| Workbox | 0 |
| Cache admin | 0 |
| IndexedDB admin | 0 |
| Cookies admin | 0 |
| Tokens URL | 0 |

CUTOVER.2.1 queda **COMPLETA**. El Service Worker administrativo se registró y controla el alias actual; `lanzo-store` permanece sin PWA. Por tanto, **ECOM.PUBLIC.CUTOVER.2 queda cerrada**.
