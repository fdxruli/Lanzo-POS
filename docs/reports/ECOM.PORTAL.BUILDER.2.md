# ECOM.PORTAL.BUILDER.2 — editor visual del borrador y vista previa

## 1. Resumen ejecutivo

Se implementó un editor visual Pro para el documento v1 existente. La edición es local e inmutable, la vista previa usa `EcommerceSiteRenderer`, guardar usa revisión optimista, publicar consume exclusivamente el borrador remoto guardado y restaurar nunca publica.

## 2. Git

- HEAD inicial de `main`: `afab7e530d09d5247985c68c85de7f0c14ca0ccd` (merge de PR #123).
- Rama: `fase-ecom-portal-builder-2`.
- Worktree aislado: `C:\dev\Lanzo-POS-builder2`; el checkout principal tenía 17 commits locales y dos archivos Supabase sin seguimiento, que no se modificaron.
- Merge-base inicial: `afab7e530d09d5247985c68c85de7f0c14ca0ccd`.

## 3. Alcance y arquitectura reutilizada

Se conservaron la ruta/export de `EcommerceSiteBuilderFoundation`, el servicio y sus cinco contratos, el validador/normalizador/migrador/checksum/preset y el renderer de Builder.1. La UI se dividió en controles, estado, preview e historial; no se agregó renderer, esquema, editor JSON, drag-and-drop ni dependencia nueva.

Archivos de implementación:

- `src/components/ecommerce/EcommerceSiteBuilderFoundation.jsx`
- `src/components/ecommerce/site-builder/EcommerceSiteBuilderControls.jsx`
- `src/components/ecommerce/site-builder/EcommerceSiteBuilderPreview.jsx`
- `src/components/ecommerce/site-builder/EcommerceSiteBuilderHistory.jsx`
- `src/components/ecommerce/site-builder/EcommerceSiteBuilderStatus.jsx`
- `src/utils/ecommerceSiteBuilderDocument.js`
- `src/components/ecommerce/EcommercePortalSettings.jsx`
- `src/components/ecommerce/EcommercePortalSettings.css`

Pruebas:

- `src/components/ecommerce/__tests__/EcommerceSiteBuilderFoundation.test.jsx`
- `src/utils/__tests__/ecommerceSiteBuilderDocument.test.js`
- `src/services/ecommerce/__tests__/ecommerceSiteBuilderService.test.js`

## 4. Modelo de estado

El componente mantiene `remoteState`, `savedDocument`, `workingDocument`, `versions`, `hasMoreVersions`, cargas separadas, `restoringVersionId` y `previewViewport`. El payload real se lee desde `draft.document`, se migra/normaliza y se clona para evitar mutar objetos recibidos de Supabase.

El checksum canónico distingue `workingDocument` de `savedDocument` para “Cambios sin guardar”. `remoteState.hasUnpublishedChanges` alimenta por separado “Borrador sin publicar”. La publicación vigente se toma de `remoteState.published`.

## 5. Controles y vista previa

Se permiten densidad cómoda/compacta, layouts de encabezado y catálogo, visibilidad de búsqueda/categorías y reordenamiento accesible Subir/Bajar. El footer permanece bloqueado. “Restablecer diseño base” usa el `templateCode` del portal y solo cambia estado local.

La vista previa renderiza inmediatamente `workingDocument` mediante `EcommerceSiteRenderer`, reutiliza el portal actual, funciona en anchos escritorio/móvil y queda inerte mediante `inert` más bloqueo de puntero. No consulta el portal público ni modifica cache, pedidos, carrito o publicación.

## 6. Guardado, conflicto y publicación

Guardar llama `saveSiteDraft` con la revisión remota exacta y el documento validado. Una respuesta correcta actualiza revisión y copias canónicas; no publica. El código `ECOMMERCE_SITE_DRAFT_CONFLICT` conserva los cambios y ofrece recargar remoto o conservarlos, sin overwrite ni reintento automático.

Publicar bloquea cambios locales, no envía documento, impide doble clic mediante guardas síncronas y, al terminar, recarga estado e historial. El resultado idempotente tiene mensaje específico.

## 7. Historial y restauración

El historial usa `limit=20` y `offset=versions.length` reales. Muestra únicamente metadatos disponibles: número, fecha, modo e indicador publicado. Restaurar confirma si perdería cambios locales, bloquea la versión activa, llama la RPC existente, recarga el borrador y no publica.

## 8. Seguridad y accesibilidad

Para Free el componente retorna `null` y los efectos no invocan ninguna RPC. Los controles tienen labels visibles o nombres accesibles, selectores con `aria-pressed`, estados con `aria-live`, botones de orden con sección explícita y navegación nativa por teclado. `beforeunload` se instala únicamente con cambios locales y se limpia al revertir o desmontar.

## 9. Validación ejecutada

Pruebas focalizadas, todas PASS en ejecuciones aisladas:

- editor: 8/8;
- helpers Builder.2: 3/3;
- documento Builder.1: 19/19;
- servicio Builder: 3/3;
- renderer: 5/5;
- identidad/cache pública: 3/3;
- `PublicStorePage.siteVersion`: 1/1.

ESLint focalizado sobre todos los JS/JSX modificados: PASS, con solo aviso informativo heredado de `baseline-browser-mapping`.

`git diff --check`: PASS.

`npm run build`: PASS, 3,374 módulos y service worker; conserva advertencias heredadas de imports mixtos, chunk vacío y glob PWA.

`npm run build:store`: PASS, 1,822 módulos.

`npm run lint`: inconcluso; se interrumpió después de varios minutos sin diagnóstico. No se declara PASS.

`npm run test:ci`: FAIL/incompleto. Detectó dos fallos fuera del alcance en `ecommercePosInventoryResolution.test.js` (“does not replace a manual selection…” y “does not recreate a released draft…”); se interrumpió con 2 fallos y 46 pruebas aprobadas de 233 archivos pendientes.

React Doctor: no ejecutado de forma válida. `npx` rechazó Node 22.12 frente al mínimo 22.13 y reportó un `package.json` temporal truncado; no produjo diagnósticos.

## 10. Matriz manual pendiente

No se usaron datos reales ni credenciales de una cuenta Pro/Free. Quedan pendientes en entorno seguro:

- carga del borrador y verificación de que la tienda pública no cambia;
- edición de cada control, reordenamiento, preview inmediato y advertencia de recarga;
- guardado, incremento de revisión y separación respecto de la tienda pública;
- publicación exacta del borrador guardado;
- publicación de v2, restauración de v1 como borrador y publicación como versión nueva;
- conflicto entre dos sesiones sin overwrite;
- cuenta Free sin RPC ni controles.

## 11. Riesgos residuales

- La matriz manual requiere cuentas y datos no sensibles de prueba.
- React Doctor requiere actualizar el runtime/caché de herramientas; ESLint focalizado cubrió el diff.
- Lint global y `test:ci` no concluyeron en PASS por comportamiento/deuda fuera de Builder.2.

## 12. Supabase y restricciones

No se agregó ni modificó migración, RPC o archivo Supabase. No se ejecutó Docker, `db push`, `db pull`, `migration repair`, `db reset`, `migration up` ni `apply_migration`. La solución usa exclusivamente los contratos de Builder.1.

No se modificó `main`, no se hizo merge, no se activó auto-merge y no se realizó despliegue manual. El PR debe permanecer draft.
