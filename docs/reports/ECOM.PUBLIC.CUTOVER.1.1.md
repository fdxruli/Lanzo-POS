# ECOM.PUBLIC.CUTOVER.1.1

Fecha de ejecución: 2026-07-14 (America/Mexico_City)  
Estado: **COMPLETA**

## 1. Resumen ejecutivo

Se demostró la causa del deployment público defectuoso, se estabilizó temporalmente el alias con el deployment bueno anterior, se generó y auditó un Build Output API v3 correcto y se realizó un solo deployment Production correctivo de `lanzo-store`. Después de que la tienda pasó todos sus gates, se realizó un solo deployment Production prebuilt de `lanzo-pos`. Ambos aliases quedaron en artefactos `Ready` y verificados.

## 2. Estado heredado

CUTOVER.1 ya tenía builds locales y suites funcionales aprobados, pero su deployment público no había aplicado la configuración de `vercel.store.json`. El deployment administrativo aún no se había realizado. No existían `.git` ni `.vercel` en la raíz local y esa condición se preservó.

## 3. Alcance

Se corrigió exclusivamente ECOM.PUBLIC.CUTOVER.1 mediante la mini-fase 1.1: estabilización, causa raíz, flujo prebuilt correcto, un deployment público, un deployment administrativo condicionado al gate público, validaciones remotas y reporte. No se inició CUTOVER.2, SEO, dominios, DNS ni observación.

## 4. Restricciones

No se usó Git/GitHub, `--force`, `--public`, previews, dominios, DNS, Functions, Middleware, Edge Functions, add-ons, upgrades, nuevas dependencias ni escrituras Supabase. No se modificaron componentes de Producción, `package-lock.json`, rutas legacy ni configuración remota del proyecto.

## 5. Estado remoto inicial

`lanzo-store` tenía tres deployments Production `Ready` y cero previews. El alias apuntaba al deployment defectuoso de CUTOVER.1. `lanzo-pos` seguía en el deployment Git Production anterior `dpl_AsAMp9uP2eerwF6TvHzQ93gWb56e`; el proyecto conservaba su preset remoto Vite y su integración Git existente.

## 6. Deployment público defectuoso

- ID: `dpl_ZeMiHNuqzDWYd1WWBJzVTPChHPd9`.
- URL: `https://lanzo-store-m347cxg53-fdxrulis-projects.vercel.app`.
- Estado: `Ready`, Production.
- Defectos: COOP administrativo presente, falta de noindex público, assets sin `immutable`, rutas sensibles con fallback SPA, `/.env` como HTML 200 y `robots.txt` sin el contrato completo.

## 7. Verificación del deployment anterior

Se verificó `dpl_FSxecRjz4zGte1Wbf17NcW9ijFPD`, URL `https://lanzo-store-pqswlu7s3-fdxrulis-projects.vercel.app`, como Production `Ready`. Sus rutas públicas, canonicalización, 404 sensibles, robots y assets permitieron usarlo como estabilización autorizada.

## 8. Promoción temporal o motivo de omisión

Se ejecutó una promoción de `dpl_FSxecRjz4zGte1Wbf17NcW9ijFPD`. El alias `https://lanzo-store.vercel.app` volvió al artefacto bueno antes de construir o desplegar la corrección. La promoción no creó otro deployment.

## 9. Investigación de causa raíz

Se compararon config, headers remotos, cwd y comandos. El header `Cross-Origin-Opener-Policy: same-origin-allow-popups` del deployment defectuoso sólo existe en el `vercel.json` administrativo. Su presencia en `lanzo-store` demuestra qué configuración consumió Vercel.

## 10. Diferencias entre DEPLOY.1.1 y CUTOVER.1

DEPLOY.1.1 validó el paquete estático y su configuración como archivos. CUTOVER.1 ejecutó Vercel desde la raíz del repositorio con `--cwd` apuntando al temporal, sin `--local-config`. El contenido público subido fue correcto, pero la resolución de config tomó el `vercel.json` de la raíz administrativa. CUTOVER.1.1 hace cwd real en el temporal y usa `--local-config ./vercel.json` explícito.

## 11. Cwd anterior

El proceso anterior fue iniciado desde `C:\dev\Lanzo-POS-main` y trató el temporal sólo como valor de `--cwd`. La ambigüedad entre directorio de invocación y directorio de archivos permitió consumir la config administrativa.

## 12. Config anterior consumida

- Config administrativa consumida: `C:\dev\Lanzo-POS-main\vercel.json`.
- SHA-256: `8fb3d88d201d13fb1a51b895a5ff91e31d9fa3129ca098dfb7e9fe1b8204094b`.
- Config pública que debió consumirse: `vercel.store.json`.
- SHA-256: `af10cb4007e18489b62aaaddd54be41f3bd165bd39a27d0b2abbc6ae61fb610c`.

## 13. Causa demostrada

La cadena causal quedó cerrada: cwd ambiguo + ausencia de `--local-config` → consumo de config administrativa → COOP administrativo y catch-all en la tienda → rutas sensibles 200 y headers/cache públicos ausentes. El flujo corregido produjo las rutas esperadas en `.vercel/output/config.json` antes de desplegar.

## 14. Corrección del empaquetador

Los preparadores crean la raíz temporal exacta, colocan artefactos y `vercel.json` directamente allí, validan project ID/org ID, hashes, allowlist y secretos, registran comandos prebuilt y finalizan sin desplegar. El auditor lee el output transformado y rechaza config vacía, IDs cruzados, archivos extra, Functions, Middleware, dominios o rutas indebidas.

Para admin se añadió una derivación temporal determinista con `"framework": null`. Vercel documenta este valor como el preset “Other”; evita que el preset remoto Vite intente recompilar un paquete estático sin cambiar el `vercel.json` del repositorio ni los settings remotos.

## 15. Estructura temporal nueva

- Store: `C:\Users\pituf\AppData\Local\Temp\lanzo-store-cutover-1-1-U3wCLq`.
- Admin: `C:\Users\pituf\AppData\Local\Temp\lanzo-pos-cutover-1-1-JIjTbT`.
- Cada raíz contenía directamente `vercel.json`, archivos estáticos y después `.vercel/output`.
- Los manifests SHA-256 fueron hermanos de las raíces.
- Todas las raíces/manifests creados por la fase se eliminaron al cierre.

## 16. vercel.json público

`vercel.store.json` quedó sin cambios funcionales y fue copiado como `vercel.json` a la raíz real del paquete. Conserva noindex global, robots, cache revalidable para shell, cache `immutable` para assets, canonicalización sin slash, allowlist SPA pública y exclusión de rutas sensibles. No contiene redirects al POS, Functions, Middleware ni dominios.

## 17. vercel build local

Desde la raíz temporal vinculada a `prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4` se ejecutó:

`vercel build --prod --yes --local-config ./vercel.json`

No hubo un build Vercel posterior entre el gate final y `vercel deploy --prebuilt --prod --yes`.

## 18. config.json generado

- Build Output API: versión 3.
- Store routes: 15.
- SHA-256: `70f1eef7a539473f3f69f6c6481a8b80a1edd7600f75c56f7ab925969412972e`.
- `output/static`: 10 archivos, 724,627 B (los nueve archivos de `dist-store` más `robots.txt`).
- Árbol output SHA-256: `3119246a91ab0317ffe6d99b72c3c64e6795fba11acf2d1071c4d43111b48ac2`.

## 19. Auditoría de config.json

PASS: versión/rutas, filesystem antes del SPA, error después del SPA, canonical 308 con noindex, noindex global, caches, rutas públicas, 404 sensibles, no fallback admin, cero source exposure, cero Functions/Middleware/domains/redirect POS y archivos estáticos exactos.

## 20. Tests

| Suite requerida | Resultado |
|---|---:|
| Públicos | 102/102 PASS |
| PWA | 64/64 PASS |
| DEPLOY.1.1 | 43/43 PASS |
| CUTOVER.1 | 57/57 PASS |
| CUTOVER.1.1 nuevos | 20/20 PASS |
| Total | 286/286 PASS |

Cero fallos funcionales. No se reportaron tests omitidos/todo en las suites requeridas; tampoco se introdujeron `.skip`, `.todo` ni `eslint-disable` en los archivos modificados/creados.

## 21. Lint

El ESLint dirigido sobre los JS/JSX/MJS tocados terminó con código 0; sólo apareció el aviso informativo de `baseline-browser-mapping`. `npm run lint` global terminó con código 1 por deuda heredada: 382 problemas (158 errores y 224 warnings), entre ellos `RecipeBuilder` y `storageManager`. No se ocultó ni amplió esta deuda.

## 22. Builds

- Admin `dist`: 74 archivos, 6,349,439 B, entry `assets/index-03yt_zQI.js`.
- Store `dist-store`: 9 archivos, 724,601 B; JS 665,471 B y CSS 57,675 B.
- Auditorías de delivery: PASS en ambos.
- No quedaron listeners en 4173/4174.
- Las apariciones de `localhost` fueron clasificadas como defaults internos de React Router/Dexie/Supabase y validadores loopback; no hubo override Production a 4173/4174.

## 23. Paquete público

El paquete sólo contenía los nueve artefactos públicos, `robots.txt` y la config requerida por el build. No contenía PWA, manifest, Service Worker, Workbox, código administrativo, source maps, source, tests, docs, `.env`, packages ni secretos.

## 24. Deployment público nuevo

- Intentos nuevos: 1/1.
- ID: `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`.
- URL: `https://lanzo-store-d1wvbysqz-fdxrulis-projects.vercel.app`.
- Alias: `https://lanzo-store.vercel.app`.
- Estado: Production `Ready`.
- Previews nuevos: 0.

## 25. Matriz HTTP

Root, `/tienda`, slug, tracking y `/conoce-lanzo` devolvieron 200. Las variantes con slash devolvieron 308 a su canonical. Diecisiete rutas sensibles devolvieron 404 real `text/plain`; `/_src` sólo devolvió el redirect oficial de Source Protection y no expuso source. Robots y nueve artefactos requeridos respondieron correctamente.

## 26. Headers

Las rutas públicas, canonicalizaciones, robots y errores sensibles contienen `X-Robots-Tag: noindex, nofollow, noarchive`. No aparece COOP administrativo en store. El content type de cada shell, asset, robots y 404 coincide con su clase.

## 27. Caché

El shell/index/canonical/robots/errores usa `public, max-age=0, must-revalidate`. Los assets hasheados usan exactamente `public, max-age=31536000, immutable`.

## 28. Rutas sensibles

`/sw.js`, `/manifest.webmanifest`, `/registerSW.js`, `/.env*`, packages, `/src`, configs Vite/Vercel, `/.git`, `/node_modules`, `/docs` y `/scripts` no reciben el SPA y no publican contenido. Los casos auditados quedaron en 404; no hay PWA pública.

## 29. Canonicalización

La normalización sin trailing slash funciona con 308, conserva noindex y cache revalidable. La query de auditoría `?arch=cutover-1-1` se conservó al canonicalizar.

## 30. Hashes

Store remoto: 9/9 archivos y 724,601/724,601 B coinciden byte por byte con `dist-store`; index y ocho assets quedaron sin diferencias. Árbol local `dist-store`: `c2d32afd5a4ba74dc56e7ed9293f0e8b7b1ea23fd6e3b13e1b4fe7d895897652`.

## 31. Navegador público

PASS en 375, 768 y 1440 px para root y canonical, sin overflow ni imágenes rotas. Cero errores/excepciones, 404 de assets, mixed content, tokens en URL, chunks administrativos, manifest, SW, controller, Workbox o storage administrativo. El perfil efímero fue eliminado.

## 32. Supabase

La auditoría pública sólo hizo la lectura segura `ecommerce_get_portal_by_slug`: POST RPC de lectura y OPTIONS, ambos 200. Cero escrituras, cero pedidos, cero credenciales persistidas y cero cambios de schema/configuración.

## 33. Decisión del gate store

El gate store fue PASS completo. Por ello se autorizó continuar con la única activación administrativa. No fue necesario el rollback al deployment anterior.

## 34. Paquete administrativo

La raíz separada se vinculó a `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`. Contenía 74 artefactos admin más el `vercel.json` temporal, sin source/secrets/extras. El árbol remoto final coincide con `dist`: 74/74 archivos, 6,349,439/6,349,439 B.

## 35. Config admin transformada

- Source config SHA-256: `8fb3d88d201d13fb1a51b895a5ff91e31d9fa3129ca098dfb7e9fe1b8204094b`.
- Derivación temporal (`framework: null`) SHA-256: `9b4e49b83ae016e59d33e89b466e05dc2463db0490308a63a5479da22003e63a`.
- Output config SHA-256: `52521beb7032f582d7fb2523e2fa8d5e92a833abd84a86f3155c66fe7b336705`.
- API v3, seis routes, filesystem antes del catch-all, fallback `/index.html`, COOP aprobado, cero Functions/Middleware/domains/store config.
- Árbol estático SHA-256: `b9009732dc25768b81a471dc9480f6c3dba21113ddb9f3883e61b4d9c2a28c90`.

El primer build administrativo local anterior a esta derivación falló con `spawn cmd.exe ENOENT` porque heredó el preset Vite remoto. No creó deployment. El build con `framework: null` terminó correctamente y no cambió los settings remotos, que siguen mostrando preset Vite.

## 36. Evidencia Git Integration

El deployment Git anterior declaró `ref: main`, repo ID `1044361831`, SHA `0ca6c5299ca08c1a89af40b5430b765ce01890f9` y repositorio `fdxruli/Lanzo-POS`. No se conectó, desconectó ni modificó Git. Riesgo residual: un futuro deployment Git Production puede reemplazar el deployment manual; deberá construir el mismo commit/configuración validada antes de promoverse.

## 37. Deployment administrativo

- Realizado: sí.
- Intentos nuevos: 1/1.
- ID: `dpl_39FyshBw92YaNMyKPN9BwWLfZ8uN`.
- URL: `https://lanzo-kjbaz4v9x-fdxrulis-projects.vercel.app`.
- Alias: `https://lanzo-pos.vercel.app`.
- Estado: Production `Ready`.
- Build remoto: prebuilt, 0 ms/2 s de deployment reportado.
- Previews nuevos: 0. Existen previews históricos anteriores a esta fase y no se alteraron.

## 38. Hashes administrativos

La descarga desde el alias activo comparó 74 archivos y 6,349,439 B: todos los hashes coinciden. Index, manifest, `sw.js` con Workbox embebido y todos los assets son exactos. Las sondas `/.env`, packages, source, tests y docs sólo recibieron el `index.html` virtual del catch-all y no archivos físicos; `output/static` demuestra que ninguno fue publicado.

## 39. PWA administrativa

Perfil remoto limpio: manifest presente, un registro, `/sw.js`, scope `/`, worker activo/controlando tras recarga, 26 entradas precache y 1,815,756 B, cero assets requeridos fallidos, mixed content, errores o excepciones. La migración local sobre el mismo artefacto remoto por hash dejó el worker nuevo en waiting, no autoactivó, envió un `SKIP_WAITING`, produjo un `controllerchange` y una recarga, sin loop. Conservó IndexedDB, `localStorage`, `sessionStorage`, cache público y cache externo; eliminó 57 paths obsoletos y el runtime admin v0. Perfiles y puerto efímeros fueron limpiados.

## 40. Enlaces cruzados

El bundle administrativo exacto contiene `https://lanzo-store.vercel.app`; no contiene nuevas construcciones `https://lanzo-pos.vercel.app/tienda/`. El bundle store contiene ambos orígenes en sus responsabilidades correctas: tienda pública en `lanzo-store` y CTA administrativa en `lanzo-pos`. Abrir/copy/share/QR/WhatsApp/tracking/landing/CTA están cubiertos por tests y auditorías locales de navegador sobre los mismos hashes. No había una sesión QA segura autorizada para repetir acciones autenticadas; esa comprobación manual queda pendiente y el contrato acepta A+B+C (hash remoto + bundle + tests exactos).

## 41. Compatibilidad legacy

`/tienda/:slug`, `/tienda/:slug/pedido/:trackingToken` y `/conoce-lanzo` en `lanzo-pos` devuelven 200 con el index administrativo exacto y permanecen en el router legacy. No se creó redirect. El Service Worker excluye estas rutas del fallback administrativo y las pruebas de navegador confirmaron el comportamiento público con worker activo.

## 42. Noindex

`lanzo-store` conserva noindex completo en shell, canonical, robots y 404. `robots.txt` contiene `User-agent: *` y `Disallow: /`. No se creó sitemap ni se habilitó SEO. No se modificó la política SEO de `lanzo-pos`.

## 43. Costos

Se crearon cero proyectos, dominios, DNS, aliases personalizados, Functions, Edge Functions, Middleware, add-ons, recursos pagados o upgrades. Hubo dos deployments Production nuevos autorizados (store y admin), una promoción de un deployment existente y cero previews nuevos. No se promete costo cero indefinido; aplica el consumo normal del plan Vercel existente.

## 44. Archivos creados

- `scripts/audit-vercel-build-output.mjs`
- `src/architecture/__tests__/vercelPrebuiltDeployment.test.js`
- `docs/reports/ECOM.PUBLIC.CUTOVER.1.1.md`

## 45. Archivos modificados

- `scripts/prepare-store-deployment.mjs`
- `scripts/prepare-admin-deployment.mjs`
- `scripts/audit-remote-store-deployment.mjs`
- `package.json`
- `src/architecture/__tests__/publicDeploymentArchitecture.test.js`
- `src/architecture/__tests__/adminDeploymentPackage.test.js`

Además se regeneraron `dist` y `dist-store` mediante sus builds; no se editaron a mano. No se modificó `package-lock.json`.

## 46. Cambios remotos

1. Promoción temporal del store bueno anterior.
2. Un deployment Production correctivo de `lanzo-store` y actualización de sus aliases estándar.
3. Un deployment Production prebuilt de `lanzo-pos` y actualización de sus aliases estándar.

No hubo otros cambios remotos, Supabase, Git Integration, proyecto, dominio o recurso.

## 47. Riesgos residuales

- Un futuro deployment Git de admin puede reemplazar manualmente el artefacto; debe validarse contra estos hashes/contratos.
- Las acciones autenticadas de abrir/copiar/compartir/QR/WhatsApp/tracking/CTA no se repitieron remotamente por ausencia de sesión QA segura; están demostradas por A+B+C y queda una comprobación manual opcional.
- `npm run lint` mantiene deuda global heredada.
- Las rutas legacy se mantienen intencionalmente y todavía no deben eliminarse.

## 48. Rollback

Store: promover `dpl_FSxecRjz4zGte1Wbf17NcW9ijFPD` al alias estándar si aparece una regresión pública grave. Admin: promover el deployment Production anterior `dpl_AsAMp9uP2eerwF6TvHzQ93gWb56e` si aparece un defecto grave administrativo. No borrar datos, storage real, proyectos, deployments ni integración Git durante el rollback.

## 49. Criterios de cierre

Cumplidos: causa demostrada; raíz/config inequívocas; Build Output API completo; máximo un deployment nuevo por proyecto; ambos `Ready`; headers/cache/robots/404/canonical/query/hashes/navegador/Supabase store en PASS; PWA pública ausente; admin byte-exacto y PWA operativa; enlaces nuevos en bundles; legacy disponible; cero redirects/previews nuevos/domains/functions/recursos pagados; rollback y reporte presentes.

## 50. Conclusión

Vercel aplicó correctamente la configuración pública transformada. `lanzo-store` quedó restaurado primero y luego corregido en el deployment nuevo; `lanzo-pos` activó el artefacto que contiene los enlaces nuevos, mantiene la PWA administrativa y conserva las rutas legacy. ECOM.PUBLIC.CUTOVER.1.1 queda **COMPLETA** y CUTOVER.1 puede cerrarse. No se inicia otra fase; queda pendiente revisión.
