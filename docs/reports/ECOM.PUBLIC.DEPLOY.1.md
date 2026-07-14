# FASE ECOM.PUBLIC.DEPLOY.1 — Crear el despliegue público independiente en Vercel

## 1. Resumen ejecutivo

Se creó el proyecto independiente `lanzo-store` y se realizó exactamente un deployment de producción desde un paquete estático aislado. El deployment está `Ready` y la aplicación carga correctamente en navegador, pero la fase queda **INCOMPLETA**: `/tienda/` y `/tienda/:slug/` responden 404, y la ruta reservada `/_src` responde 307 hacia una página de Vercel en vez del 404 exigido. Conforme al control de despliegues, no se hizo un segundo deployment después de que la validación funcional falló.

## 2. Alcance

Se ejecutó exclusivamente DEPLOY.1: preparación local, creación de un proyecto Vercel público separado, un deployment de producción, auditoría HTTP/hash/CDP y protección del proyecto administrativo. No se inició DOMAIN.1, DNS, cutover, redirects administrativos, dominio personalizado ni conexión Git.

## 3. Restricciones cumplidas

- No se creó `.git` ni se ejecutaron comandos Git/GitHub.
- La raíz local nunca se vinculó a Vercel; `.vercel` permaneció ausente.
- No se modificaron `vercel.json`, `vite.config.js`, `vite.store.config.js`, `src/main-store.jsx`, Supabase, checkout, tracking, catálogo, carrito, PWA ni POS.
- No se publicaron fuentes, `package.json`, `.env`, `node_modules`, credenciales privadas, manifest, Service Worker ni código administrativo.
- Se crearon cero previews, dominios personalizados, aliases personalizados, Functions, integraciones, add-ons y recursos pagados.
- No se realizó ninguna escritura en Supabase ni se creó ningún pedido.
- No se imprimieron ni registraron tokens de Vercel o claves completas.

## 4. Estado inicial

La copia local no tenía `.git`, `.vercel` ni vínculo Vercel. `lanzo-pos` ya existía como proyecto administrativo y `lanzo-store` no existía. `vercel.json` administrativo tenía SHA-256 `8fb3d88d201d13fb1a51b895a5ff91e31d9fa3129ca098dfb7e9fe1b8204094b`. `dist-store` se regeneró con 9 archivos, 722,887 B y sin diferencias contra su baseline aprobado.

## 5. Autenticación Vercel

Se utilizó Vercel CLI 56.1.0 mediante el caché temporal de `npx`, sin añadirla a las dependencias. La autenticación oficial fue confirmada con `vercel whoami`. La sesión quedó en la ubicación global de usuario y nunca se leyó ni imprimió su token.

## 6. Scope seleccionado

Se seleccionó inequívocamente `fdxrulis-projects`, el único scope personal mostrado por la CLI y el mismo que contiene `lanzo-pos`. La enumeración no mostró equipos alternativos. Se conservó el plan personal actual; la operación no solicitó upgrade, prueba o pago.

## 7. Proyecto administrativo protegido

Antes del cambio, `lanzo-pos` tenía como deployment de producción más reciente `lanzo-ljm0ojsxu-fdxrulis-projects.vercel.app`, creado el 13 de julio de 2026 a las 12:26:40 UTC-06:00. Después de DEPLOY.1 siguió siendo exactamente el mismo deployment. La raíz local no se vinculó, su `vercel.json` conservó el mismo hash y se crearon 0 deployments administrativos.

## 8. Proyecto público creado

| Elemento | Resultado |
|---|---|
| Proyecto | `lanzo-store` |
| Scope | `fdxrulis-projects` (personal) |
| Production deployment | 1, `Ready`, duración 2 s |
| URL temporal | `https://lanzo-store.vercel.app` |
| Git conectado | No |
| Dominio personalizado | 0 |
| Preview deployments creados | 0 |
| Functions | 0; build estático `.` de 0 ms |
| Recursos pagados | 0 activados |
| Admin project modificado | No; 0 deployments administrativos |

Project ID sanitizado: `prj_AVq3…pZW4`. El proyecto usa preset `Other`, directorio raíz `.` y no contiene variables de entorno.

## 9. Estrategia de despliegue

Se regeneró y auditó `dist-store`, después se creó `%TEMP%/lanzo-store-deploy-*/public` con allowlist estricta. Desde ese directorio aislado se creó/vinculó `lanzo-store` y se ejecutó una sola vez `vercel deploy --prod --yes --scope fdxrulis-projects`. No se ejecutó `vercel` sin `--prod`, deployment de prueba ni preview. La CLI subió 11 archivos; no hubo instalación, función o compilación de aplicación, y Vercel registró un build estático `.` de 0 ms.

El vínculo aislado descargó automáticamente `.env.local` con OIDC y creó `.gitignore`; ambos se eliminaron sin leerlos antes del deployment. `.vercel/project.json` permaneció únicamente como metadato local de vínculo y no formó parte de los 11 archivos subidos.

## 10. Paquete estático

El paquete tenía 11 archivos y 724,831 B, con SHA-256 de árbol `cfbd669540a5e6ea0a9a1e018cbd4d0343aac8745432556b8ce912261521f8a1`. Incluyó los 9 archivos de `dist-store`, `robots.txt` y la configuración pública como `vercel.json`. Hallazgos: 0 rutas prohibidas, 0 secretos, 0 PWA y 0 código administrativo. El manifest SHA-256 se guardó fuera del paquete publicable. El temporal completo se eliminó después de la auditoría.

## 11. Configuración Vercel pública

`vercel.store.json` sólo define headers y rewrites estáticos; no contiene builds, Functions, crons, dominios, redirects, variables, integraciones ni recursos. El deployment reveló dos defectos de compatibilidad: `/tienda/:path*` no cubre las variantes vacías con barra final en Vercel, y `/_src` es interceptada por una ruta reservada de la plataforma. No se corrigió ni redeplegó automáticamente.

## 12. Rutas SPA

| Ruta | Status | Resultado |
|---|---:|---|
| / | 200 | PASS; sirve `index.html` |
| /tienda | 200 | PASS; sirve `index.html` |
| /tienda/:slug | 200 | PASS; slug inexistente muestra shell seguro |
| /tienda/:slug/pedido/:token | 200 | PASS; sirve el shell sin crear pedido |
| /conoce-lanzo | 200 | PASS; query/hash compatibles |
| /sw.js | 404 | PASS |
| /manifest.webmanifest | 404 | PASS |
| /.env | 404 | PASS |
| /package.json | 404 | PASS |
| /_src | 307 → 200 externo | **FAIL**; redirige a `vercel.com/.../source`, no devuelve 404 |

Adicionalmente, `/tienda/` y `/tienda/slug-inexistente-seguro/` devolvieron 404 en vez de `index.html`. Las variantes sin barra final y la ruta de tracking sin barra final sí devolvieron 200.

## 13. Headers y noindex

Las respuestas del origen temporal incluyen `X-Robots-Tag: noindex, nofollow, noarchive`. Index y shells usan `public, max-age=0, must-revalidate`; los assets hasheados usan `public, max-age=31536000, immutable`. `robots.txt` respondió 200 y coincidió con `User-agent: *` / `Disallow: /`. No se añadió sitemap ni CSP nueva.

## 14. Variables públicas

El proyecto remoto contiene 0 variables de entorno. El artefacto usa el hostname público esperado de Supabase y una credencial publicable incorporada por Vite; se confirmó `persistSession: false` y ausencia de `service_role`. No se documentan valores de claves.

## 15. Auditoría de secretos

El paquete y `dist-store` dieron 0 hallazgos de `service_role`, tokens Vercel/GitHub, claves privadas, secretos Supabase, claves Stripe, credenciales Google o JWT privilegiados. El vocabulario genérico incluido dentro del SDK se revisó como nombres internos, no como valores secretos. Los archivos OIDC descargados durante el vínculo se retiraron sin leerse y no fueron publicados.

## 16. Deployment realizado

Se realizó exactamente 1 intento. Deployment ID sanitizado `dpl_7U6D…Ygsw`, tipo `Production`, creado el 14 de julio de 2026 a las 08:11:36 UTC-06:00, duración 2 s y estado `Ready`. La subida fue de 707.8 KiB/11 archivos. No existe un segundo deployment ni previews. Aunque Vercel marcó el deployment `Ready`, la validación funcional posterior falló y se detuvo la fase.

## 17. URL temporal

URL principal: `https://lanzo-store.vercel.app`. Vercel añadió únicamente sus aliases automáticos `.vercel.app`; se crearon 0 aliases personalizados y 0 dominios personalizados.

## 18. Validación HTTP

HTTPS, origen, content type, noindex, caché, robots, hashes y rutas sin barra final pasaron. Todos los sensibles probados devolvieron 404 salvo `/_src`. Fallaron 7 aserciones agrupadas en tres causas: status/content-type/hash para `/tienda/`, status/content-type/hash para `/tienda/:slug/`, y status de `/_src`. La inspección directa confirmó 404 `text/plain` en las dos rutas con barra y 307 con `Location` externo en `/_src`.

## 19. Comparación de hashes

| Métrica | Local | Remoto | Coincide |
|---|---:|---:|---|
| Archivos públicos | 9 | 9 | Sí |
| index SHA-256 | `f5e303d9…f18c9` | `f5e303d9…f18c9` | Sí |
| JS referenciado | 6 / 663,757 B | 6 / 663,757 B | Sí |
| CSS referenciado | 1 / 57,675 B | 1 / 57,675 B | Sí |
| SVG/favicon | 1 / 338 B | 1 / 338 B | Sí |
| Tamaño total | 722,887 B | 722,887 B | Sí |

El SHA-256 de árbol del artefacto público local fue `5ab64750dac51fa1365cbcf938c041bbc3ca1de65e5d0f96db382818853919a9`. Los 9 archivos comparados remotamente coincidieron byte por byte.

## 20. Validación de navegador

Chrome CDP con perfil efímero pasó en 375×812, 768×1024 y 1440×900: root presente, 0 overflow, 0 imágenes rotas, 0 errores de consola, 0 excepciones, 0 assets requeridos con 404, 0 mixed content, 0 tokens en URL y 0 chunks administrativos. El perfil efímero se eliminó.

## 21. Conectividad Supabase

Se observó `ecommerce_get_portal_by_slug` por `OPTIONS` y `POST`, ambos con status 200 y sin error CORS. No se usaron credenciales privadas. Se observaron 0 solicitudes de escritura y nunca apareció `ecommerce_create_order`.

## 22. Slug seguro o motivo de omisión

No había un slug demo inequívocamente autorizado. Se usó `slug-inexistente-seguro`, permitido por la fase para demostrar conectividad y fallback sin enumerar tiendas reales. Tracking usó `token-invalido-seguro`. Se realizaron 0 pedidos y 0 escrituras.

## 23. Catálogo público

No se hizo validación positiva con catálogo real por ausencia de slug demo. El shell público cargó sin errores con el slug inexistente y la RPC pública respondió correctamente. Los 102 tests públicos locales cubren portal, catálogo, categorías, paginación, carrito, checkout y tracking.

## 24. Service Worker y manifest

El paquete contiene 0 manifest, Service Worker, Workbox o registro PWA. Remotamente `/sw.js`, `/manifest.webmanifest`, `/registerSW.js` y `/workbox-archivo.js` devolvieron 404. En navegador hubo 0 enlaces manifest, 0 registros, controller nulo, 0 respuestas desde Service Worker y 0 eventos `beforeinstallprompt`.

## 25. Aislamiento de origen

El origen público es `https://lanzo-store.vercel.app`, separado del administrativo. No cargó shell ni chunks administrativos y no compartió Service Worker, Cache Storage, IndexedDB o cookies del POS. No hubo navegación o redirect al POS en las rutas públicas válidas; la única salida de origen fue la ruta reservada fallida `/_src` hacia Vercel.

## 26. Storage

Al inicio y al final de la prueba hubo 0 bases IndexedDB, 0 claves de `localStorage`, 0 claves de `sessionStorage` y 0 caches. No apareció `LanzoDB`, `LanzoDB1` ni storage administrativo. La auditoría registró sólo nombres, nunca valores.

## 27. Seguridad remota

HTTPS funcionó, no hubo mixed content, cookies, tokens en URL, sourcemaps publicados, archivos fuente directos ni archivos sensibles accesibles. `vercel.json` remoto devolvió 404. El hallazgo de seguridad/contrato pendiente es `/_src`: Vercel lo intercepta con 307 hacia su página de código fuente; por tanto no cumple el 404 requerido aunque no haya servido el `index.html` ni los archivos fuente del paquete.

## 28. Proyecto administrativo intacto

Confirmado local y remotamente: `.vercel` ausente antes/después, `vercel.json` con hash idéntico, `package-lock.json` con SHA-256 `d15402c248324bba30b5432451f829775a49c42eab991219b3c8654f9bce8c29`, y el deployment de producción más reciente de `lanzo-pos` no cambió. Deployments administrativos creados por esta fase: 0.

## 29. Costos y recursos

No se aceptó upgrade, prueba, compra, add-on ni integración. El scope personal actual no solicitó cambio de plan. Se activaron 0 Functions, Edge Functions, crons, Blob, KV, Postgres, Analytics, Speed Insights, dominios y recursos pagados. No se promete costo cero futuro.

## 30. Tests

- Públicos: 102/102 PASS en 16 archivos; 0 fallos, 0 omitidos.
- PWA: 64/64 PASS en 7 archivos; 0 fallos, 0 omitidos.
- DEPLOY.1: 33/33 PASS en 1 archivo; 0 fallos, 0 omitidos.
- Tracking service adicional: 6/6 PASS, no contado dentro de las 102.

Estos tests locales no detectaron la semántica real de `:path*` con barra vacía ni la ruta reservada `/_src` de Vercel; la auditoría remota sí las detectó.

## 31. Lint

ESLint dirigido sobre los dos scripts y el test DEPLOY.1 terminó con código 0. `npm run lint` reprodujo la deuda global previa: 382 problemas, 158 errores y 224 warnings fuera de los archivos de la fase. No se declara PASS global.

## 32. Builds finales

- `npm run build`: PASS; `dist` con 74 archivos y 6,343,112 B.
- `npm run build:store`: PASS; 9 archivos, 722,887 B, 663,757 B JS, 57,675 B CSS y entry de 87,471 B.
- `node scripts/audit-public-delivery.mjs dist`: PASS; 26/26 recursos de precache encontrados.
- `node scripts/audit-public-delivery.mjs dist-store`: PASS; 0 violaciones y 0 referencias faltantes.
- Diferencia contra baseline público: 0 archivos y 0 B.

## 33. Archivos creados y modificados

Creados:

- `vercel.store.json`
- `scripts/prepare-store-deployment.mjs`
- `scripts/audit-remote-store-deployment.mjs`
- `src/architecture/__tests__/publicDeploymentArchitecture.test.js`
- `docs/reports/ECOM.PUBLIC.DEPLOY.1.md`

Modificado:

- `package.json`: sólo comandos opt-in `deploy:store:prepare` y `audit:store:remote`.

No se modificó `package-lock.json`. El directorio temporal de deployment fue eliminado.

## 34. Cambios remotos realizados

Se creó 1 proyecto `lanzo-store` en `fdxrulis-projects` y 1 deployment `Production` `Ready`. Vercel asignó sus aliases automáticos `.vercel.app`. Se crearon 0 previews, 0 dominios personalizados, 0 aliases personalizados, 0 conexiones Git, 0 variables de entorno, 0 Functions, 0 integraciones y 0 recursos pagados. El proyecto se conserva porque la fase falló después de publicar y no se autoriza borrarlo automáticamente.

## 35. Riesgos residuales

1. `/tienda/` y `/tienda/:slug/` devuelven 404.
2. `/_src` redirige a una página de Vercel en lugar de devolver 404.
3. La URL `.vercel.app` es temporal y no hay dominio personalizado.
4. Los enlaces actuales del POS siguen apuntando al origen anterior.
5. No existen redirects desde el origen administrativo y no se hizo cutover.
6. No hubo validación positiva con datos reales por falta de slug demo.
7. El proyecto se despliega desde artefacto local, no mediante Git.
8. Las actualizaciones futuras requieren repetir build, auditoría y deployment.
9. El proyecto administrativo no recibió remotamente PWA.1 en esta fase.
10. La separación definitiva para clientes depende de DOMAIN.1 y CUTOVER.1.

## 36. Validaciones manuales pendientes

Antes de otro deployment se debe diseñar y probar localmente una configuración que cubra explícitamente las variantes con barra final y una estrategia válida para impedir o aceptar formalmente la ruta reservada `/_src`. Cualquier intento correctivo requiere una decisión humana y una nueva autorización de despliegue; no debe ejecutarse como continuación automática de este intento. Después deberán repetirse la auditoría HTTP/hash/CDP y la comprobación administrativa. DOMAIN.1 permanece detenido.

## 37. Rollback remoto

No se ejecutó rollback. Si se autoriza: (1) retirar o desactivar el deployment público desde `lanzo-store`; (2) eliminar `lanzo-store` sólo con autorización explícita, pues fue creado exclusivamente por esta fase; (3) volver a comprobar que `lanzo-pos` conserva deployments, variables y dominios; (4) verificar que no queden dominios ni aliases personalizados; (5) confirmar 0 variables, integraciones y recursos facturables; (6) conservar este reporte; y (7) para recrearlo, regenerar/auditar `dist-store`, preparar un paquete aislado nuevo y autorizar expresamente otro `--prod`.

## 38. Rollback local

Sin Git, el rollback manual eliminaría los cinco archivos creados de la sección 33 y retiraría de `package.json` los dos scripts opt-in. `dist` y `dist-store` son regenerables. Se pueden eliminar temporales `lanzo-store-deploy-*` sólo después de verificar que estén bajo `%TEMP%`; el usado ya fue eliminado. No se debe crear ni tocar un `.vercel` administrativo. No se ejecutó rollback local.

## 39. Criterios para iniciar ECOM.PUBLIC.DOMAIN.1

No se cumplen. Aunque el origen, assets, PWA, Supabase, aislamiento y proyecto administrativo están verificados, las rutas profundas con barra final y `/_src` incumplen el contrato. Se requiere una publicación posterior que pase por completo la matriz HTTP y navegador, sin recursos pagados y con rollback documentado. No se inició DOMAIN.1, dominio, DNS ni redirects.

## 40. Conclusión

El proyecto público quedó separado y la URL temporal carga, pero el contrato remoto no está completamente satisfecho. El proyecto administrativo quedó intacto, se realizó un solo deployment y no hubo efectos en Supabase ni costos adicionales. **ESTADO: INCOMPLETA** por los 404 con barra final y el 307 de `/_src`. No existen condiciones para iniciar ECOM.PUBLIC.DOMAIN.1.
