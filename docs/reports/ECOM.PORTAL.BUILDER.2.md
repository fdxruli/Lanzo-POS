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

## 13. Corrección de bloqueantes residuales del PR #124

### Catálogo visible e inerte

La causa era que la preview entregaba arreglos vacíos a `PublicCatalog`, que retornaba antes de renderizar herramientas y tarjetas. `EcommercePortalSettings` ahora pasa sus productos ya cargados, sin otra RPC. El helper puro `ecommerceSiteBuilderPreview` selecciona como máximo seis productos publicados y conserva únicamente campos visuales; excluye referencias locales, metadata y demás datos internos.

Si no existen productos publicados, se crean en memoria tres ejemplos determinísticos, identificados mediante nombres y categorías de “contenido de ejemplo”. Nunca se guardan en store, IndexedDB, Supabase ni el documento del sitio. La preview usa el catálogo/renderer reales, deriva categorías y reutiliza el tema público. Los callbacks son no-op, las configuraciones se neutralizan para no abrir el modal real y todo el contenido permanece bajo `inert`.

### Carga estable ante cambios del portal

La pérdida local ocurría porque `applyRemoteState` dependía de `portal.templateCode`, cambiaba la identidad de `load` y reejecutaba el efecto inicial. La plantilla más reciente y el indicador de cambios locales ahora se actualizan mediante refs en efectos; `applyRemoteState` y `load` permanecen estables. Cambios de plantilla, tema, logo, portada o nombre actualizan la preview sin consultar ni reemplazar el borrador. “Restablecer diseño base” sí consume la plantilla más reciente. Solo un cambio real de `portal.id` puede iniciar otra carga y, si hay cambios locales, exige confirmación.

### Ventana de concurrencia

Publicación y restauración conservan `operationRef`, `publishing` o `restoringVersionId` hasta finalizar la recarga posterior, y limpian las guardas en `finally`. Una mutación exitosa seguida de fallo de refresco no se repite ni se presenta como fallo de la mutación: informa que el sitio fue publicado/restaurado y solicita pulsar Actualizar.

### Pruebas y validación posteriores

- Builder Foundation: 13/13 PASS.
- Preview real con `PublicCatalog`: 4/4 PASS.
- Adaptador de productos: 2/2 PASS.
- Regresiones Builder.1/2 restantes: 8 archivos, 40/40 PASS.
- Total focalizado: 9 archivos, 53/53 PASS.
- ESLint focalizado JS/JSX: PASS; solo aviso informativo de `baseline-browser-mapping`.
- `git diff --check`: PASS.
- React Doctor: 91/100, sin errores; queda una sugerencia previa de convertir el estado amplio de `EcommercePortalSettings` a reducer, fuera del alcance.
- `npm run build`: PASS, 3,375 módulos y service worker; advertencias heredadas de imports mixtos, chunk vacío y glob PWA.
- `npm run build:store`: PASS, 1,822 módulos.
- `npm run lint`: inconcluso; se interrumpió tras dos minutos sin diagnóstico. No se declara PASS.
- `npm run test:ci`: FAIL/incompleto fuera del alcance. Reprodujo los dos fallos de carrera conocidos de `ecommercePosInventoryResolution.test.js` y doce fallos de fixture Dexie en `motorInvariante.test.js`; se interrumpió con 14 fallos y 92 pruebas aprobadas de 235 archivos pendientes.

No se creó ni modificó archivo Supabase, migración o RPC. No se modificó `main`, no se hizo merge, no se activó auto-merge y el PR #124 debe continuar abierto y draft.

## 14. Corrección del bloqueante visual público residual

### Causa y superficie compartida

El documento v1 ya entregaba `data-site-density` y `data-site-layout`, pero los únicos estilos funcionales de `grid` y `compact` estaban restringidos a `.ecom-builder-preview-inert`. La tienda pública ignoraba esos valores y los selectores de `data-template-code` podían modificar portada, contenido y gaps aunque una versión publicada congelara otros layouts.

Los estilos funcionales se centralizaron en `PublicStorePage.css`. La preview ahora adopta la misma envoltura `public-store-shell`, importa esa hoja pública y usa el mismo `EcommerceSiteRenderer` y `PublicCatalog`. `EcommercePortalSettings.css` conserva únicamente el marco, tamaño del viewport e inercia administrativa; se eliminaron todas sus reglas exclusivas de layout.

### Efectos del documento v1

- `comfortable` y `compact` definen tokens distintos para separación de secciones, catálogo, tarjetas, herramientas y encabezado sin reducir controles ni texto.
- Header `default` conserva aproximadamente la portada actual; `showcase` amplía portada, ancho de contenido y escala del título.
- Catálogo `grid` usa tarjetas verticales y columnas automáticas; `compact` usa una columna de tarjetas horizontales, menor altura y descripción oculta.
- El renderer es un contenedor CSS compartido. La regla móvil del propio sitio fuerza `grid` a una columna según el ancho real de la tienda o del frame de preview, sin selector `.is-mobile` administrativo.

Se retiraron los selectores de layout basados en `data-template-code`. El template sigue creando el preset cuando no existe un documento válido, pero una versión entregada manda mediante `document.global.density` y `section.layout`. Por ello `templateCode=compact` no sustituye `catalog.layout=grid`, `templateCode=showcase` no sustituye `header.layout=default` y cambiar la plantilla después de publicar no altera el documento versionado.

### Pruebas y validación

- Contrato estructural y CSS público: densidades, headers, catálogos, contenedor móvil, ausencia de simulación de preview y ausencia de overrides por template.
- Renderer: clases estructurales derivadas del documento y precedencia de versión sobre `templateCode`.
- Preview: misma envoltura, renderer y catálogo públicos, permaneciendo inerte.
- Regresión focal completa Builder.1/2: 10 archivos, 59/59 PASS.
- ESLint focalizado: PASS; solo aviso informativo de `baseline-browser-mapping`.
- `git diff --check`: PASS.
- React Doctor: 89/100, sin errores. Reporta cuatro avisos no bloqueantes ya existentes en utilidades, estado amplio de configuración y exports auxiliares del renderer.
- `npm run build`: PASS, 3,375 módulos y service worker; conserva advertencias heredadas de imports mixtos, chunk vacío y glob PWA.
- `npm run build:store`: PASS, 1,822 módulos; conserva el chunk público vacío heredado de Supabase.
- `npm run lint`: inconcluso; se detuvo tras dos minutos sin diagnósticos adicionales. ESLint focalizado sí está en PASS.
- `npm run test:ci`: FAIL/incompleto por deuda ajena. Reprodujo fallos en carreras de inventario ecommerce, fixtures Dexie, fulfillment, navegación móvil, store de órdenes y single-flight de checkout. Se detuvo después de confirmar los fallos; las suites de Builder.1/2 ejecutadas dentro de la corrida continuaron en PASS.

No se modificó Supabase, migración o RPC. Esta corrección no modifica `main`, no publica, no hace merge ni cambia el estado draft del PR #124.
