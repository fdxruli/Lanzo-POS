# ECOM.PUBLIC.GIT.1 — Conectar lanzo-store a GitHub

## 1. Resumen ejecutivo

Estado: **COMPLETA**.

`lanzo-store` quedó conectado mediante la integración Git nativa de Vercel al repositorio `fdxruli/Lanzo-POS`, rama `main`, con Root Directory `store`, fuentes externas al root habilitadas y previews deshabilitadas. El deployment Production inicial `dpl_CZ7xgpSF38BEE2aiGLAWMAZA5BUE` compiló el SHA `26aa0432af6b3b6c0692c01db4cdb5a70b183324`, quedó Ready y recibió el alias `https://lanzo-store.vercel.app`. No se desplegó manualmente ni se modificó `lanzo-pos`.

## 2. Estado heredado

- `lanzo-pos` ya estaba conectado a GitHub/main y conservaba el build administrativo y la PWA.
- `lanzo-store` existía como `prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4`, sin integración Git, con deployment estable conocido `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`.
- El store dependía de preparación, prebuild, deployment y promoción manuales.

## 3. Problema del deployment manual

Desplegar desde la raíz administrativa podía hacer que Vercel consumiera `/vercel.json`, introduciendo headers administrativos, caché incorrecta y fallback SPA sobre rutas sensibles. La solución separa estructuralmente los dos proyectos mediante Root Directory y configuración propia.

## 4. Arquitectura seleccionada

| Proyecto | Repo | Rama | Root | Build | Output | Git automático |
|---|---|---|---|---|---|---|
| lanzo-pos | fdxruli/Lanzo-POS | main | raíz | `npm run build` | `dist` | Sí; existente y sin cambios |
| lanzo-store | fdxruli/Lanzo-POS | main | `store` | `cd .. && npm run build:store:vercel` | `store/dist` | Sí; integración nativa Vercel |

Cada proyecto genera su propio artefacto. No se creó un tercer proyecto, una ruta interna ni un artefacto compartido.

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

`store/vercel.json` es la fuente efectiva. Conserva `X-Robots-Tag: noindex, nofollow, noarchive`, HTML `public, max-age=0, must-revalidate`, assets `public, max-age=31536000, immutable`, rewrites de `/`, `/tienda`, `/tienda/:path*` y `/conoce-lanzo`, y `trailingSlash: false`. No contiene COOP, manifest, Service Worker, dominios, secretos, Functions ni Middleware.

## 8. Build store para Vercel

`build:store:vercel` ejecuta `scripts/build-store-vercel.mjs`: valida el cwd, limpia sólo `store/dist`, ejecuta `npm run build:store`, audita `dist-store`, aplica la allowlist, rechaza PWA/admin/source maps/fuentes/secretos, copia, crea `robots.txt`, compara hashes, audita nuevamente y emite JSON sin secretos. No despliega ni llama Vercel CLI.

## 9. Staging store/dist

La validación local produjo `dist-store` con 9 archivos y 724,601 bytes, y `store/dist` con 10 archivos y 724,627 bytes. La única diferencia permitida es `robots.txt`; cada archivo copiado fue byte-idéntico. Hash de árbol local: `dist-store` `c2d32afd…`; staging `3119246a…`.

En Vercel, el build exacto de `main` produjo 9 archivos/542,651 bytes en `dist-store` y 10 archivos/542,677 bytes en `store/dist`, con hashes de árbol `c3816ec13ffca3d4daf61dd06b1973a50c4a6e4a9188f416bcf6134fed2fe327` y `eafc8dc2c375d34df5cca1341a4a7d538bc24292b8cfc2458553d127e49e6f3e`. La comparación copiada fue idéntica y no hubo violaciones.

## 10. Auditorías locales

- Admin: PASS, 74 archivos, 6,349,691 bytes; manifest, Service Worker y PWA presentes.
- Store local: PASS, 9 archivos, 724,601 bytes; sin manifest, SW, Workbox, sourcemaps ni código administrativo.
- Store Vercel staging: PASS, 10 archivos, 724,627 bytes; `robots.txt` presente y artefacto permitido.
- Auditorías públicas, CUTOVER y DEPLOY: PASS en sus controles efectivos.

## 11. Tests

- Arquitectura Git pública: 114/114 PASS.
- PWA relacionada: 49/49 PASS.
- CUTOVER: 5/5 componentes y 31/31 auditoría PASS.
- Split público/deployment: 134/134 PASS.
- No se añadieron `.skip`, `.todo`, snapshots gigantes ni mocks que oculten el artefacto.

Una prueba ajena a esta fase, `EcommercePortalSettings.test.jsx`, conserva un fallo heredado porque su mock no define `syncPublishedCatalog`; no se cambió lógica ecommerce para ocultarlo.

## 12. Lint

Lint dirigido sobre los archivos modificados: PASS. React Doctor no se ejecutó, conforme a la restricción de la fase.

## 13. Estado remoto previo

Antes de conectar Git, `lanzo-store` no tenía repositorio asociado y mantenía como rollback el deployment estable `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg`. `lanzo-pos` estaba Ready, conectado a GitHub/main y no fue tocado.

## 14. GitHub

Repositorio: `fdxruli/Lanzo-POS`. El gate remoto confirmó en `main` todos los archivos requeridos y la ausencia de `vercel.store.json`. SHA desplegado: `26aa0432af6b3b6c0692c01db4cdb5a70b183324`.

## 15. Production Branch

`lanzo-store`: `main`. `lanzo-pos`: `main`, sin cambios.

## 16. Root Directory

`lanzo-store`: `store`. Esto hace que consuma `/store/vercel.json` y no `/vercel.json`.

## 17. Source files outside root

Habilitado para que el build público pueda leer `package.json`, lockfile, `vite.store.config.js`, `src/**` y `scripts/**` desde la raíz compartida.

## 18. Previews

Preview Branch Tracking quedó `Disabled`. Se crearon 0 previews y no existe ignored build step personalizado.

## 19. Build Command

`store/vercel.json` declara `cd .. && npm run build:store:vercel`. Los logs del deployment confirman su ejecución; no se ejecutó el build administrativo como build del store.

## 20. Output Directory

`outputDirectory: dist`, relativo al Root Directory `store`, por lo que el artefacto efectivo es `store/dist`.

## 21. Deployment Git inicial

- ID: `dpl_CZ7xgpSF38BEE2aiGLAWMAZA5BUE`
- Fuente: GitHub
- Repo/rama: `fdxruli/Lanzo-POS`, `main`
- Target: Production
- Estado: Ready
- URL de deployment: `lanzo-store-5si1hjddw-fdxrulis-projects.vercel.app`
- Alias: `https://lanzo-store.vercel.app`

Se creó exactamente un deployment Production inicial y ningún preview. No fue necesario redeployment correctivo.

## 22. SHA desplegado

`26aa0432af6b3b6c0692c01db4cdb5a70b183324`, coincidente con el `main` validado.

## 23. Headers

Las rutas HTML canónicas responden 200 con `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: public, max-age=0, must-revalidate` y sin COOP administrativo. Los assets también conservan noindex y no presentan COOP.

## 24. Cache

HTML y `robots.txt`: must-revalidate. Los siete assets referenciados por el HTML remoto respondieron 200 con `public, max-age=31536000, immutable`.

## 25. Canonicalización

`/`, `/tienda`, la ruta segura de slug, la ruta segura de tracking y `/conoce-lanzo` responden 200. Las variantes con slash responden 308 al mismo hostname y a la ruta sin slash; la query se conserva y no hay loops.

## 26. Rutas sensibles

`/.env`, `/.env.local`, `/package.json`, `/package-lock.json`, `/src`, `/src/main-store.jsx`, `/vercel.json`, `/vite.config.js`, `/vite.store.config.js`, `/sw.js`, `/manifest.webmanifest`, `/docs`, `/scripts` y `/node_modules` devolvieron 404 real `text/plain` y no entregaron `index.html`.

## 27. PWA store

Manifest: 0. Service Worker: 0. Workbox: 0. Registros SW: 0. Controller: ausente. Cache Storage: vacío. Shell administrativo: ausente.

## 28. Protección admin

Antes y después, el deployment activo de `lanzo-pos` fue `dpl_2P8PHJQ8L2UREfPSchVxx7zzjQN9`, Ready, GitHub/main, SHA `26aa0432af6b3b6c0692c01db4cdb5a70b183324`, alias `https://lanzo-pos.vercel.app`. Conserva raíz del repositorio, `/vercel.json`, `npm run build`, output `dist` y PWA. No se realizó deployment manual ni cambio de settings administrativos.

## 29. Supabase

Cambios: 0. SQL: 0. Escrituras: 0. Pedidos creados: 0. WhatsApp: 0. No se añadieron secretos ni `service_role`.

## 30. Recursos creados

| Recurso | Cantidad creada |
|---|---:|
| Proyectos | 0 |
| Deployments Production | 1 |
| Previews | 0 |
| Dominios | 0 |
| Functions | 0 |
| GitHub Actions | 0 |
| Escrituras Supabase | 0 |

También se crearon 0 Middleware, 0 Edge Functions y 0 recursos pagados.

## 31. Rollback

No se ejecutó: todos los gates públicos efectivos pasaron. Permanece documentado `dpl_GkVEb88ELVzwwUUjfyKCKiX8cheg` como deployment estable previo si se necesitara rollback futuro.

## 32. Riesgos residuales

- Node 24.x se conservó; `react-zxing` emitió una advertencia de engine, pero el build terminó correctamente. No se cambiaron dependencias ni versiones.
- Los 308 generados por Vercel no incluyen `X-Robots-Tag`; sus destinos canónicos 200 sí lo incluyen. No hay contenido indexable en la respuesta vacía del redirect.
- El auditor genérico local compara contra el artefacto de la copia de trabajo y marcó diferencias al confrontarlo con el artefacto exacto de `main`; la auditoría remota autocontenida tomó los assets del HTML desplegado y todos respondieron 200 con hashes/caché coherentes.
- No había un slug de producto real explícitamente autorizado; se validó el flujo con slugs seguros inexistentes, sin escribir datos ni crear pedidos.

## 33. Conclusión

| Control store | Resultado |
|---|---|
| Fuente GitHub | PASS — integración nativa Vercel |
| SHA main | PASS — `26aa0432af6b3b6c0692c01db4cdb5a70b183324` |
| Build store | PASS — `build:store:vercel` |
| store/vercel.json | PASS — configuración efectiva |
| noindex | PASS |
| cache immutable | PASS |
| rutas sensibles 404 | PASS |
| manifest ausente | PASS |
| SW ausente | PASS |
| previews deshabilitadas | PASS — 0 previews |

`lanzo-store` ya se actualiza automáticamente desde GitHub con un build público independiente. `lanzo-pos` permanece protegido y conserva su pipeline administrativo. Desde ahora, un push o merge válido a `main` activa dos pipelines Production independientes: uno para `lanzo-pos` y otro para `lanzo-store`; no se garantiza que concluyan al mismo segundo. Ya no se requiere `prepare-store-deployment`, build local de Vercel, deployment prebuilt, promoción manual de alias ni copia manual de `dist-store`.
