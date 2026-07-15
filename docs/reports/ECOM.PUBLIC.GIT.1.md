# ECOM.PUBLIC.GIT.1 — Conectar lanzo-store a GitHub

## 1. Resumen ejecutivo

Estado: **PENDIENTE DE PUBLICAR IMPLEMENTACIÓN EN MAIN**.

La implementación local del build Git independiente quedó terminada y validada. La copia de trabajo no contiene `.git`, `gh` no está instalado y Vercel CLI no está disponible. Además, la comprobación directa de `main` confirmó que `store/vercel.json` y `scripts/build-store-vercel.mjs` responden 404 y que el `package.json` remoto aún no contiene `build:store:vercel`. Por el gate obligatorio no se conectó Git, no se modificó ningún proyecto Vercel y no se creó deployment.

## 2. Estado heredado

- Repositorio: `fdxruli/Lanzo-POS`; rama de producción solicitada: `main`.
- `main`: `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a` (2026-07-14T22:49:51Z).
- Admin conocido: `lanzo-pos`, `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`, deployment `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE`, Git/main, Ready.
- Store conocido: `lanzo-store`, `prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4`, deployment estable `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`, CLI/prebuilt, Ready, sin integración Git.
- La copia local no era un checkout Git y no tenía `.gitignore`.

## 3. Problema del deployment manual

El flujo anterior empaquetaba y desplegaba manualmente `dist-store`. CUTOVER.1 demostró que ejecutar Vercel desde la raíz podía consumir el `vercel.json` administrativo, exponer fallback SPA en rutas sensibles y perder headers/caché públicos. La solución local hace estructural la separación mediante Root Directory `store` y su propio `store/vercel.json`.

## 4. Arquitectura seleccionada

| Proyecto | Repo | Rama | Root | Build | Output | Git automático |
|---|---|---|---|---|---|---|
| lanzo-pos | fdxruli/Lanzo-POS | main | raíz | `npm run build` | `dist` | existente; no modificado |
| lanzo-store | fdxruli/Lanzo-POS | main | `store` | `cd .. && npm run build:store:vercel` | `store/dist` (`outputDirectory: dist`) | pendiente de publicación/configuración |

## 5. Archivos modificados

- `package.json`
- `scripts/prepare-store-deployment.mjs`
- `scripts/audit-vercel-build-output.mjs`
- `scripts/audit-public-cutover.mjs`
- `scripts/audit-public-delivery.mjs`
- `src/architecture/__tests__/publicDeploymentArchitecture.test.js`
- `src/architecture/__tests__/vercelPrebuiltDeployment.test.js`
- `src/architecture/__tests__/publicCutoverArchitecture.test.js`

## 6. Archivos creados

- `.gitignore`
- `store/vercel.json`
- `scripts/build-store-vercel.mjs`
- `src/architecture/__tests__/publicGitDeploymentArchitecture.test.js`
- `docs/reports/ECOM.PUBLIC.GIT.1.md`

Archivo retirado: `vercel.store.json`. No quedan dos configuraciones públicas activas.

## 7. Configuración pública canónica

`store/vercel.json` conserva `X-Robots-Tag: noindex, nofollow, noarchive`, HTML `must-revalidate`, assets `immutable`, los cuatro rewrites públicos y `trailingSlash: false`. Define `framework: null`, `installCommand: cd .. && npm ci`, `buildCommand: cd .. && npm run build:store:vercel` y `outputDirectory: dist`. No contiene COOP, manifest, worker, dominios, variables, Functions ni Middleware.

SHA-256 local: `2e185de5a72328f58938bf8d66f8e231c1c8ae195c20adf63b20bc42c607ec2a`.

## 8. Build store para Vercel

`build:store:vercel` ejecuta `scripts/build-store-vercel.mjs`. Confirma cwd raíz, limpia sólo `store/dist`, ejecuta el build público, audita `dist-store`, aplica allowlist, rechaza PWA/admin/sourcemaps/rutas fuente/secretos, copia, crea robots, compara hashes, audita el staging y emite JSON sin secretos. No contiene comandos de deployment ni llamadas a Vercel.

SHA-256 local del script: `4d141cefd75e0b6778f4dfa7c5a485ed0003c7ae20d8ce0002d434eeae5f00a0`.

## 9. Staging store/dist

- `dist-store`: 9 archivos, 724,601 B, árbol `c2d32afd5a4ba74dc56e7ed9293f0e8b7b1ea23fd6e3b13e1b4fe7d895897652`.
- `store/dist`: 10 archivos, 724,627 B, árbol `3119246a91ab0317ffe6d99b72c3c64e6795fba11acf2d1071c4d43111b48ac2`.
- Diferencia única: `robots.txt`, 26 B, contenido exacto `User-agent: *` + `Disallow: /`.
- Los nueve archivos compartidos son byte-idénticos.

## 10. Auditorías locales

- `npm run build`: PASS; 74 archivos, 6,349,691 B; manifest y `sw.js` presentes.
- `npm run build:store`: PASS; 9 archivos, 724,601 B.
- `npm run build:store:vercel`: PASS; staging limpio y 0 violaciones.
- `audit-public-delivery` sobre `dist-store` y `store/dist`: PASS.
- `audit:cutover`: PASS, 31/31.

## 11. Tests

- Arquitectura completa: 114/114 PASS en 8 archivos.
- DEPLOY + Git: 76/76 PASS.
- CUTOVER dirigido: 17/17 PASS.
- PWA dirigida: 49/49 PASS.
- Matriz pública dirigida: 134 tests PASS. Una suite histórica adicional, `EcommercePortalSettings.test.jsx`, no cargó porque su mock preexistente no exporta `syncPublishedCatalog`; no se modificó lógica ecommerce ni se debilitó la prueba.
- Las nuevas pruebas demuestran fallo ante código admin, ausencia de robots y secreto; ausencia de deployment; y paridad byte a byte salvo robots.

## 12. Lint

ESLint dirigido sobre los cinco scripts y cuatro tests modificados/nuevos: PASS, 0 errores y 0 warnings. Sólo apareció el aviso informativo preexistente de `baseline-browser-mapping`; no se cambiaron dependencias.

## 13. Estado remoto previo

La auditoría read-only del alias existente terminó PASS el 2026-07-14 local: rutas públicas, 308, query, noindex, caché, robots, rutas sensibles 404, paridad 9/9 y navegador sin PWA. No constituye un deployment Git nuevo; valida únicamente el deployment estable heredado `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`.

## 14. GitHub

No se creó rama ni PR: el workspace carece de `.git` y `gh` no está instalado. La API pública confirmó `main` en `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`. `store/vercel.json`, `scripts/build-store-vercel.mjs`, `.gitignore` y el test Git nuevo están ausentes (404). `package.json` remoto tiene SHA-256 observado `9b675d04e1ec885735c92b02b9bef5501c2b0291582bdfb3bdefc0243132300e` y no contiene `build:store:vercel`.

## 15. Production Branch

Objetivo: `main`. No se cambió remotamente porque la implementación aún no está en `main`.

## 16. Root Directory

Objetivo para `lanzo-store`: `store`. No configurado todavía por el gate.

## 17. Source files outside root

Objetivo: habilitado, necesario para `package*.json`, Vite, `src/**` y `scripts/**`. No configurado todavía por el gate.

## 18. Previews

No se creó ningún preview. El objetivo sigue siendo deshabilitarlas antes de activar la integración Git.

## 19. Build Command

Declarado localmente: `cd .. && npm run build:store:vercel`. No se instaló override remoto.

## 20. Output Directory

Declarado localmente: `dist` respecto a Root Directory `store`, es decir `store/dist`. No se instaló override remoto.

## 21. Deployment Git inicial

No ejecutado: el gate de `main` falló. Deployments Production creados por esta fase: 0.

## 22. SHA desplegado

Ninguno. El SHA actual de `main` es `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`, pero no contiene la implementación.

## 23. Headers

Contrato local PASS. El alias heredado devuelve noindex y no devuelve COOP administrativo. Falta validar estos headers sobre un deployment Git posterior al merge.

## 24. Cache

Contrato local PASS. El alias heredado devuelve `must-revalidate` para HTML y `max-age=31536000, immutable` para los ocho assets comparados.

## 25. Canonicalización

El alias heredado devuelve 200 para rutas canónicas y 308 para slash final, conserva query, hostname y no entra en loops. Falta atribuir la misma evidencia a un deployment Git.

## 26. Rutas sensibles

La auditoría heredada confirmó 404 real, sin `index.html`, para `.env`, `.env.local`, package files, `src`, configs Vite/Vercel, PWA, docs, scripts y `node_modules`. El contrato local no tiene fallback amplio.

## 27. PWA store

`dist-store` y `store/dist`: 0 manifest, 0 Service Worker, 0 Workbox, 0 sourcemaps. Navegador remoto heredado: 0 manifest links, 0 registros, controller false, Workbox false.

## 28. Protección admin

No se cambió `vercel.json`, la integración, branch, alias ni settings de `lanzo-pos`; no hubo deployment administrativo. Antes y después se conserva como referencia `dpl_F8nH6mQ7aGPicyeAehzAALWqF3PE`, Git/main, SHA `efbb6c7e…`, Ready, alias `https://lanzo-pos.vercel.app`. El build local conserva manifest, SW y PWA.

## 29. Supabase

Cambios: 0. SQL: 0. Escrituras: 0. Pedidos creados: 0. La auditoría remota usó slug seguro y registró 0 write requests.

## 30. Recursos creados

| Recurso | Cantidad creada |
|---|---:|
| Proyectos | 0 |
| Deployments Production | 0 |
| Previews | 0 |
| Dominios | 0 |
| Functions | 0 |
| GitHub Actions | 0 |
| Escrituras Supabase | 0 |

## 31. Rollback

No aplicado ni necesario: no hubo deployment ni cambio remoto. El deployment estable y el alias no se tocaron. La referencia de rollback permanece `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`.

## 32. Riesgos residuales

1. Publicar los archivos exactos en una rama basada en `main`, abrir un único PR draft y obtener revisión/merge.
2. Revalidar hashes desde `main` después del merge.
3. Configurar el proyecto existente `lanzo-store` y confirmar que Vercel permite fuentes fuera del Root Directory.
4. Observar exactamente un deployment Production Git inicial y ejecutar todos los gates remotos.
5. La suite histórica `EcommercePortalSettings.test.jsx` conserva un mock incompleto ajeno a esta fase.

## 33. Conclusión

| Control store | Resultado |
|---|---|
| Fuente GitHub | PENDIENTE |
| SHA main | `efbb6c7e6c72d8e044a01d1d32b5bd520a32b55a`; no contiene implementación |
| Build store | PASS local |
| store/vercel.json | PASS local; 404 en main |
| noindex | PASS local y baseline remoto |
| cache immutable | PASS local y baseline remoto |
| rutas sensibles 404 | PASS baseline remoto |
| manifest ausente | PASS |
| SW ausente | PASS |
| previews deshabilitadas | PENDIENTE de configuración; 0 creadas |

La arquitectura fuente está lista, mantiene separados admin y store y elimina la necesidad técnica del empaquetado manual una vez publicada/configurada. La automatización Git todavía no está activa. Estado obligatorio: **PENDIENTE DE PUBLICAR IMPLEMENTACIÓN EN MAIN**.
