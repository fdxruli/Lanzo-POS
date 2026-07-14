# FASE ECOM.PUBLIC.DEPLOY.1.1 — Corregir la canonicalización de rutas del despliegue público

> **Cierre operativo — 14 de julio de 2026:** la copia fuente completa estuvo disponible posteriormente en `C:\dev\Lanzo-POS-main`. Se ejecutaron todas las validaciones, el deployment adicional autorizado y la auditoría remota con resultado **COMPLETA**. Las secciones 1–37 se conservan como historial de la entrega inicialmente bloqueada; las secciones 38–50 registran el cierre que las sustituye operativamente.

## 1. Resumen ejecutivo

Se recibieron y verificaron los archivos actuales de DEPLOY.1 requeridos para revisar la corrección: configuración pública, scripts de preparación y auditoría, test de arquitectura, reporte histórico y los nueve archivos de `dist-store`. El artefacto público coincide con el baseline de DEPLOY.1: 9 archivos y 722,887 B.

Se preparó una corrección local que agrega `trailingSlash: false`, actualiza el empaquetador para exigir esa propiedad, amplía el auditor remoto para conservar la respuesta inicial de canonicalización y reclasifica `/_src` únicamente como ruta reservada aceptable bajo condiciones estrictas de Vercel.

La fase permanece **BLOQUEADA antes del deployment** porque el material adjunto no contiene el proyecto fuente completo necesario para ejecutar `npm run build`, `npm run build:store`, `scripts/audit-public-delivery.mjs`, las 102 pruebas públicas, las 64 pruebas PWA ni el `vercel.json` administrativo real. El contrato prohíbe desplegar si esa prevalidación no puede confirmarse.

## 2. Alcance

Corrección local y revisión remota de solo lectura. No se ejecutó deployment, preview, dominio, DNS, cutover, redirect del POS, escritura en Supabase ni DOMAIN.1.

## 3. Estado anterior

`lanzo-store` conserva un único deployment Production `Ready`, identificado de forma sanitizada como `dpl_7U6D…Ygsw`. `lanzo-pos` conserva su deployment anterior `dpl_AsAM…b56e`.

## 4. Defecto de trailing slash

El deployment previo responde 404 en variantes públicas con barra final. La configuración adjunta no contenía `trailingSlash`.

## 5. Análisis de /_src

`/_src` queda fuera de los rewrites SPA. El auditor corregido acepta sólo 404 o 307/308 HTTPS hacia `vercel.com` o un subdominio oficial de `vercel.com`, siempre que la respuesta no contenga el índice público, fuentes, archivos del paquete, secretos ni listado de directorios.

## 6. Restricciones cumplidas

No se creó proyecto, deployment, preview, Function, Middleware, dominio, variable, integración, recurso pagado, `.git` ni vínculo `.vercel` en una raíz administrativa.

## 7. Proyecto y scope

- Proyecto público: `lanzo-store`
- Scope: `fdxrulis-projects`
- ID sanitizado: `prj_AVq3…pZW4`

## 8. Proyecto administrativo protegido

- Proyecto: `lanzo-pos`
- Deployment antes/después de la inspección: sin cambio
- Deployments administrativos creados: 0

## 9. Corrección de vercel.store.json

Se agregó `"trailingSlash": false`. Se conservaron headers globales, caché revalidable de HTML, caché immutable de assets y rewrites públicos genéricos. Se retiró la regla redundante específica `/conoce-lanzo/` para que la canonicalización lleve primero a `/conoce-lanzo`.

## 10. Política canónica

Forma canónica sin barra final. No se añadieron redirects por slug ni slugs concretos.

## 11. Rewrites

Se conservan `/`, `/tienda`, `/tienda/:path*` y `/conoce-lanzo` hacia `/index.html`.

## 12. Auditor actualizado

Registra `initialStatus`, `Location`, URL canónica esperada, destino, `finalStatus`, Content-Type final y hash final. Detecta redirect múltiple, cambio de hostname, pérdida de query y fallback administrativo.

## 13. Tests actualizados

El archivo actualizado modela canonicalización antes de rewrites, verifica `trailingSlash: false`, ausencia de slugs codificados, rutas sensibles, PWA, código administrativo y escenarios positivos/negativos de `/_src`.

## 14. Prevalidación local

No reproducible con los adjuntos. Faltan el árbol fuente, `scripts/audit-public-delivery.mjs`, `vercel.json` administrativo, suites públicas/PWA restantes, configuración ESLint y dependencias instaladas del proyecto.

## 15. Paquete desplegado

No se generó un paquete autorizado para deployment porque el script de preparación depende de archivos no adjuntos y la prevalidación completa no pudo ejecutarse.

## 16. Deployment realizado

0 deployments adicionales.

## 17. URL de producción temporal

`https://lanzo-store.vercel.app`

## 18. Matriz HTTP

| Ruta | Respuesta inicial | Location | Respuesta final | Resultado |
|---|---:|---|---:|---|
| /tienda | No revalidada | — | No revalidada | Pendiente |
| /tienda/ | No desplegada | — | — | Pendiente |
| /tienda/slug | No revalidada | — | No revalidada | Pendiente |
| /tienda/slug/ | No desplegada | — | — | Pendiente |
| /tienda/slug/pedido/token | No revalidada | — | No revalidada | Pendiente |
| /tienda/slug/pedido/token/ | No desplegada | — | — | Pendiente |
| /conoce-lanzo | No revalidada | — | No revalidada | Pendiente |
| /conoce-lanzo/ | No desplegada | — | — | Pendiente |
| /_src | 307 previo | HTTPS Vercel | No seguida | Clasificación implementada; pendiente reauditoría |

## 19. Redirects de canonicalización

Pendientes de un deployment autorizado después de la prevalidación completa.

## 20. Conservación de query parameters

El auditor exige `/tienda/slug/?arch=deploy-1-1` → `/tienda/slug?arch=deploy-1-1`.

## 21. Rutas sensibles

El contrato actualizado exige 404 y prohíbe fallback a `index.html`.

## 22. Resultado de /_src

Contrato corregido localmente; no revalidado remotamente después de un deployment.

## 23. Comparación de hashes

Los nueve archivos adjuntos suman 722,887 B. `index.html` conserva SHA-256 `f5e303d9…f18c9`, coincidente con DEPLOY.1.

## 24. Auditoría de navegador

No ejecutada contra un deployment nuevo. El auditor ahora incluye una entrada con slash final y verifica la URL final canónica.

## 25. Supabase

Sin solicitudes nuevas, escrituras ni pedidos.

## 26. Aislamiento

El trabajo se realizó en un directorio aislado de artefactos. No se asumió acceso a `C:\dev\Lanzo-POS-main`.

## 27. Proyecto administrativo intacto

Confirmado mediante inspección remota de solo lectura: el deployment Production de `lanzo-pos` no cambió.

## 28. Costos y recursos

| Recurso | Resultado |
|---|---|
| Proyecto nuevo | 0 |
| Production deployments adicionales | 0 |
| Previews | 0 |
| Dominios personalizados | Sin cambios realizados |
| Git conectado | Sin cambios realizados |
| Functions | 0 creadas |
| Recursos pagados | 0 creados |
| Proyecto administrativo modificado | No |

## 29. Tests

No ejecutables de forma completa con el conjunto adjunto. No se declara PASS.

## 30. Lint

No ejecutable con la configuración real del proyecto ausente. No se declara PASS.

## 31. Archivos creados y modificados

Creados en el paquete de entrega aislado:

- `docs/reports/ECOM.PUBLIC.DEPLOY.1.1.md`

Modificados:

- `vercel.store.json`
- `scripts/prepare-store-deployment.mjs`
- `scripts/audit-remote-store-deployment.mjs`
- `src/architecture/__tests__/publicDeploymentArchitecture.test.js`

## 32. Cambios remotos

Ninguno.

## 33. Riesgos residuales

La corrección aún no ha pasado los builds, suites completas, lint real, preparación oficial ni auditoría remota posterior al deployment.

## 34. Rollback remoto

No aplica porque no hubo deployment. El deployment anterior sigue disponible y es candidato de rollback.

## 35. Rollback local

Restaurar los cuatro archivos adjuntos originales y eliminar este reporte. `dist-store` no fue modificado.

## 36. Criterios para iniciar DOMAIN.1

No se cumplen. Primero deben ejecutarse todas las validaciones obligatorias, realizar exactamente un deployment adicional y aprobar la matriz HTTP/hash/navegador/Supabase/aislamiento.

## 37. Conclusión

La corrección está preparada localmente, pero DEPLOY.1.1 permanece **BLOQUEADA** y no autoriza DOMAIN.1. `lanzo-store` y `lanzo-pos` no recibieron cambios remotos.

## 38. Reanudación en el proyecto completo

Se reanudó la mini-fase en `C:\dev\Lanzo-POS-main` sin rediseñar la solución ni reemplazar los archivos recibidos. Existían `vercel.store.json`, los dos scripts, el test de arquitectura y este reporte. `vercel.store.json` contenía `"trailingSlash": false`. La raíz no contenía `.git` ni `.vercel`.

Se inventariaron antes y después los archivos protegidos. Sus SHA-256 permanecieron idénticos:

- `vercel.json`: `8fb3d88d…8204094b`
- `vite.config.js`: `393ec453…028f9ce`
- `vite.store.config.js`: `595fb367…2e14ff`
- `src/main-store.jsx`: `70f3babd…26651b`
- `store/index.html`: `fb7f8374…36885fe1`
- `package-lock.json`: `d15402c2…bce8c29`

## 39. Comandos y prevalidación ejecutados

Comandos reales principales:

```text
node --version
npm --version
npm run build
npm run build:store
node scripts/audit-public-delivery.mjs dist
node scripts/audit-public-delivery.mjs dist-store
npx vitest run …16 suites públicas… --maxWorkers=2
npx vitest run …7 suites PWA… --maxWorkers=2
npx vitest run src/architecture/__tests__/publicDeploymentArchitecture.test.js --maxWorkers=1
npx eslint scripts/prepare-store-deployment.mjs scripts/audit-remote-store-deployment.mjs src/architecture/__tests__/publicDeploymentArchitecture.test.js
npm run --silent deploy:store:prepare
vercel deploy --prod --yes --scope fdxrulis-projects
npm run --silent audit:store:remote -- https://lanzo-store.vercel.app
```

Entorno: Node.js `v22.12.0`, npm `10.9.0`, Vercel CLI `56.1.0`.

## 40. Builds y auditorías locales finales

- `npm run build`: PASS; `dist` con 74 archivos y 6,343,112 B.
- `npm run build:store`: PASS; `dist-store` con 9 archivos y 722,887 B.
- Auditoría de `dist`: PASS; 26/26 entradas de precache administrativas encontradas.
- Auditoría de `dist-store`: PASS; 0 violaciones, 0 referencias faltantes.
- Artefacto público: 0 manifest, 0 Service Worker, 0 Workbox, 0 sourcemaps, 0 código administrativo, 0 archivos prohibidos y 0 secretos.
- SHA-256 de árbol público: `5ab64750dac51fa1365cbcf938c041bbc3ca1de65e5d0f96db382818853919a9`.

## 41. Tests y lint finales

- Suites públicas: 16/16 archivos y 102/102 tests PASS.
- Suites PWA: 7/7 archivos y 64/64 tests PASS.
- DEPLOY.1.1: 1/1 archivo y 43/43 tests PASS.
- ESLint dirigido: PASS, código 0.
- Marcadores `.skip`, `.todo` y `eslint-disable` en los archivos de la fase: 0.
- `vercel.store.json`: JSON válido y `trailingSlash === false`.

La primera ejecución pública obtuvo 101/102 por timeout de 15 s en `PublicStoreCheckout.test.jsx`. El archivo aislado pasó 10/10 sin cambios y la repetición completa con menor concurrencia pasó 102/102; se clasificó como contención transitoria, no como fallo funcional. No se modificaron tests ni timeouts.

## 42. Paquete preparado y vínculo aislado

El empaquetador generó 11 archivos y 724,591 B con SHA-256 de árbol `bc7541e108116633bec58159600739344ea11441e2adfd1e5fb9fea36be5a244`: los 9 archivos públicos, `robots.txt` y el `vercel.json` público. Confirmó `trailingSlash: false`, 0 PWA, 0 código administrativo, 0 secretos y 0 `.env`, `src`, tests, docs, paquetes o `dist` administrativo.

El vínculo a `lanzo-store` existió sólo bajo `%TEMP%`. Vercel descargó `.env.local` OIDC y creó `.gitignore`; ambos se eliminaron sin leerlos antes del upload. `.vercel/project.json` fue únicamente metadato del temporal. El directorio completo se eliminó después de la auditoría y la raíz continuó sin `.vercel`.

## 43. Inspección remota y deployment autorizado

La inspección previa confirmó `lanzo-store` en `fdxrulis-projects`, con un único deployment anterior `Ready` (`dpl_7U6D…Ygsw`), 0 variables, 0 Git, 0 dominios personalizados, 0 previews y 0 Functions. `lanzo-pos` conservaba su deployment anterior.

Se ejecutó exactamente un deployment adicional, `Production`, sin `--force` y sin `--public`:

- ID sanitizado: `dpl_FSxe…ijFPD`
- Creado: 14 de julio de 2026, 09:16:09 UTC-06:00
- Estado: `Ready`
- Duración mostrada en listado: 4 s
- Build estático: `.` en 0 ms
- URL inmutable: `https://lanzo-store-pqswlu7s3-fdxrulis-projects.vercel.app`
- Alias canónico: `https://lanzo-store.vercel.app`
- Intentos en DEPLOY.1.1: 1

Después quedaron exactamente dos deployments, ambos Production y Ready: el original de DEPLOY.1 y el autorizado de DEPLOY.1.1. Previews creados: 0.

## 44. Matriz HTTP y canonicalización

| Ruta | Inicial | Location | Final | Resultado |
|---|---:|---|---:|---|
| `/tienda` | 200 | — | 200 | PASS |
| `/tienda/` | 308 | `/tienda` | 200 | PASS |
| `/tienda/slug-inexistente-seguro` | 200 | — | 200 | PASS |
| `/tienda/slug-inexistente-seguro/` | 308 | forma sin slash | 200 | PASS |
| `/tienda/slug-inexistente-seguro/pedido/token-invalido-seguro` | 200 | — | 200 | PASS |
| `/tienda/slug-inexistente-seguro/pedido/token-invalido-seguro/` | 308 | forma sin slash | 200 | PASS |
| `/conoce-lanzo` | 200 | — | 200 | PASS |
| `/conoce-lanzo/` | 308 | `/conoce-lanzo` | 200 | PASS |
| `/tienda/slug-inexistente-seguro/?arch=deploy-1-1` | 308 | forma sin slash conservando query | 200 | PASS |

Todos los destinos conservaron `lanzo-store.vercel.app`, realizaron como máximo un redirect, no generaron loop ni redirect al POS, terminaron como HTML y coincidieron con el hash del index local. Query parameters y hash del navegador se conservaron.

## 45. Rutas sensibles y `/_src`

`/sw.js`, `/manifest.webmanifest`, `/registerSW.js`, `/workbox-fixture.js`, `/.env`, `/.env.local`, `/package.json`, `/package-lock.json`, `/src/main-store.jsx`, `/vite.store.config.js` y `/vercel.json` respondieron 404 y nunca devolvieron `index.html`.

`/_src` respondió 307 con destino HTTPS `https://vercel.com/deployments/lanzo-store.vercel.app/source`. Host final clasificado: `vercel.com`, oficial. Clasificación: `platform-reserved-redirect`, aceptada por el contrato. No entregó index, fuentes, paquetes, `.env`, sourcemaps, secretos ni marcadores de exposición. No se intentó sobrescribir con Function, Middleware o rewrite.

## 46. Hashes y navegador

Los 9 archivos públicos remotos sumaron 722,887 B y coincidieron byte por byte con `dist-store`:

| Métrica | Local | Remoto | Resultado |
|---|---:|---:|---|
| Archivos | 9 | 9 | PASS |
| Bytes | 722,887 | 722,887 | PASS |
| Index SHA-256 | `f5e303d9…f18c9` | `f5e303d9…f18c9` | PASS |
| JS | 6 / 663,757 B | 6 / 663,757 B | PASS |
| CSS | 1 / 57,675 B | 1 / 57,675 B | PASS |
| SVG | 1 / 338 B | 1 / 338 B | PASS |

El auditor lanzó Chrome real por CDP con perfil efímero. Pasaron 375×812, 768×1024 y 1440×900: 0 overflow, 0 imágenes rotas, root presente y ruta canónica correcta. Resultado adicional: 0 manifest, 0 Service Worker, controller nulo, 0 Workbox, 0 chunks administrativos, 0 errores de consola, 0 excepciones, 0 assets requeridos con 404, 0 mixed content y 0 tokens en URL. El perfil efímero fue eliminado.

La utilidad externa `agent-browser` no estaba instalada; no se instaló ninguna dependencia. El auditor CDP obligatorio de la mini-fase proporcionó la verificación real de navegador.

## 47. Supabase, aislamiento y seguridad

Con `slug-inexistente-seguro` se observaron únicamente `OPTIONS` y `POST` de lectura a `ecommerce_get_portal_by_slug`, ambos status 200 y sin CORS. Hubo 0 `ecommerce_create_order`, 0 escrituras, 0 pedidos, 0 credenciales privadas y 0 `service_role`. No se enumeraron tiendas reales.

Al inicio y final hubo 0 IndexedDB, 0 claves de `localStorage`, 0 claves de `sessionStorage`, 0 Cache Storage y 0 cookies. No aparecieron shell, chunks ni storage administrativos. HTTPS, noindex, caché, robots y aislamiento de origen pasaron.

## 48. Protección administrativa y costos

Después del deployment, `lanzo-pos` conservó como producción más reciente `lanzo-ljm0ojsxu-fdxrulis-projects.vercel.app`, sin deployments administrativos nuevos. Los hashes de todos los archivos protegidos coincidieron con el inventario inicial; `.vercel` siguió ausente en la raíz y `package-lock.json` no cambió.

En `lanzo-store` quedaron 0 variables, 0 Git, 0 dominios personalizados, 0 aliases personalizados, 0 previews, 0 Functions, 0 integraciones, 0 add-ons y 0 recursos pagados. No se aceptó upgrade ni prueba comercial.

## 49. Riesgos residuales y cambios realizados

Cambios locales integrados por la entrega recibida:

- `vercel.store.json`
- `scripts/prepare-store-deployment.mjs`
- `scripts/audit-remote-store-deployment.mjs`
- `src/architecture/__tests__/publicDeploymentArchitecture.test.js`
- `docs/reports/ECOM.PUBLIC.DEPLOY.1.1.md`

Esta ejecución sólo actualizó el presente reporte; no corrigió ni rediseñó los cuatro archivos funcionales recibidos. Cambio remoto único: un deployment Production adicional en el proyecto existente `lanzo-store`.

Riesgos residuales: la URL sigue siendo temporal `.vercel.app`; no existe dominio personalizado ni cutover; no hubo prueba positiva con una tienda real; futuras publicaciones manuales deben repetir el gate completo; `/_src` sigue siendo una ruta reservada controlada por Vercel, aunque cumple la excepción autorizada; y DOMAIN.1 requiere revisión humana separada.

## 50. Conclusión final

**ESTADO FINAL: COMPLETA.** La canonicalización sin barra final, preservación de query, rutas sensibles, excepción estricta de `/_src`, hashes, navegador, Supabase e integridad administrativa pasaron. DEPLOY.1 puede cerrarse técnicamente. Se cumplen los criterios técnicos previos para evaluar DOMAIN.1, pero esta mini-fase no lo inició ni configuró dominio, DNS, redirects o cutover. El proceso se detiene aquí para revisión.
