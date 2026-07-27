# HOTFIX.ECOM.PUBLIC.RESUME.RECOVERY.1

## Resultado

PASS focal. La tienda pública conserva la vista y el carrito mientras reconstruye portal y primera página después de BFCache, suspensión prolongada o reconexión. La validación física en Chrome Android queda pendiente; no se afirma haberla ejecutado en este entorno.

## Problema y causa raíz

`PublicStorePage` revalidaba `catalogRevision` en `focus`, `visibilitychange`, conectividad e intervalo, pero no manejaba `pageshow`/BFCache. Una revisión igual evitaba reconstruir un árbol React incompleto. A la vez, `getPublicCatalog()` devolvía IndexedDB con una estrategia efectiva `cache-first`, por lo que una página guardada podía permanecer indefinidamente. Los overlays bloqueaban el scroll de forma independiente y la preparación del documento solo corregía el viewport.

## Alcance y arquitectura de recuperación

- Coordinador deduplicado con una única promesa activa, generación de solicitud, `slug` activo y descarte lógico al desmontar/cambiar de tienda.
- El instante de entrada a `hidden` se guarda en una referencia. Menos de 30 segundos usa revalidación ligera; 30 segundos o más reconstruye.
- `pageshow.persisted`, reconexión y suspensión prolongada ejecutan recuperación completa.
- `focus` y regreso visible se coalescen durante 75 ms para que eventos simultáneos no dupliquen solicitudes.
- La recuperación completa conserva portal/productos renderizados, muestra `Actualizando catálogo…`, obtiene portal y página cero, y sustituye productos + paginación de forma atómica.
- Una revisión igual no evita la reconstrucción completa.
- Fallos de red no vacían los productos actuales. La caché queda como fallback.
- BFCache/suspensión prolongada cierra carrito, checkout y configurador transitorios, pero no borra los artículos persistidos.

## Estrategias de caché

`getPublicCatalog()` conserva compatibilidad y acepta `cacheStrategy`:

- `cache-first`: devuelve una página válida de IndexedDB y consulta red solo sin caché.
- `network-first`: consulta red, persiste una respuesta válida y usa exclusivamente la misma revisión guardada si red falla.
- `stale-while-revalidate`: entrega la caché y obtiene red en segundo plano mediante `onRevalidated`.

La recuperación usa `network-first`. No se borra IndexedDB y una respuesta inválida continúa sin poder sustituir una entrada válida por las sanitizaciones existentes.

## Documento, scroll y overlays

`preparePublicStoreDocument()` aplica determinísticamente:

- `html.public-store-document`
- `body.public-store-body`
- `#root.public-store-root`

El CSS conserva `:has()` como compatibilidad, pero ya no depende de él. El bloqueo de scroll se centralizó con propietarios y snapshot de `overflow`, `position`, `inset` y overflow del elemento raíz. La recuperación crítica libera locks huérfanos.

## Chunks antiguos y Error Boundary

Se reconocen únicamente `ChunkLoadError`, `Loading chunk failed`, `Failed to fetch dynamically imported module` e `Importing a module script failed`. La marca `sessionStorage` incluye la ruta; solo permite una recarga automática. Errores ordinarios de red, Supabase o validación no recargan.

El Error Boundary público nunca deja el root vacío. Muestra “No pudimos restaurar la tienda”, intenta primero un reinicio controlado y conserva una actualización manual como último recurso, sin revelar detalles internos.

## Cambios por archivo

- `src/pages/PublicStorePage.jsx`: coordinador, `pageshow`, umbral oculto, recuperación atómica y carreras.
- `src/services/ecommerce/ecommercePublicServiceBase.js`: estrategias explícitas de caché.
- `src/router/preparePublicStoreDocument.js` y `PublicStorePage.css`: clases públicas explícitas.
- `src/utils/publicDocumentScroll.js`: bloqueo/restauración central.
- `PublicCartDrawer.jsx`, `PublicCheckoutDialog.jsx`, `PublicProductConfigurationModal.jsx`: uso del coordinador de scroll.
- `src/utils/publicChunkRecovery.js` y `src/main-store.jsx`: recarga única de chunks y limpieza tras arranque.
- `PublicStoreErrorBoundary.jsx`: fallback móvil con reintento controlado y recarga manual.
- Pruebas focales: página, servicio/caché, documento/scroll, chunks y Error Boundary.
- `store/vercel.json`: auditado, sin cambios.

## Pruebas y resultados

- PASS: 67/67 pruebas funcionales focales en el primer conjunto ampliado tras aislar el Error Boundary.
- PASS: pruebas de `PublicStorePage`, checkout, configuración, caché, rutas, documento, chunks y Error Boundary.
- PASS: ESLint focal de todos los archivos modificados.
- PASS: `npm run build:store`.
- PASS: `npm run build:store:vercel`; 10 archivos fuente/11 preparados, copia byte-idéntica, `compliance.passed=true`.
- PASS: auditoría del bundle: cero manifest, Service Worker, Workbox, `registerSW`, precache o chunks administrativos.
- PASS: `publicCutoverArchitecture`.
- PASS: `git diff --check`.
- Advertencia no bloqueante: Node 24 está fuera del rango declarado por `react-zxing` (`^18 || ^20 || ^22`).
- Deuda heredada: `publicBuildArchitecture` espera que el wrapper `ecommercePublicService.js` importe directamente `supabasePublic`, aunque actualmente delega en `ecommercePublicServiceBase.js`; el archivo no fue modificado por este hotfix.
- Entorno: `publicDeploymentArchitecture` no puede confirmar host/credencial/persistencia desde el artefacto porque las variables públicas de Supabase no están disponibles aquí (`public-client:persistSession-false-not-found`, `publishable-credential-not-found`, `expected-one-supabase-hostname`). El empaquetador propio sí pasó con cero violaciones. No se modificó ni ejecutó Supabase.

## Vercel

`store/vercel.json` conserva `framework: null`, `trailingSlash: false`, rewrite `/tienda/:path* -> /index.html`, HTML revalidable y assets versionados `immutable`. No se cambió la caché a `no-store`, no se usó la configuración administrativa y no se ejecutó deploy ni Preview manual.

## Seguridad y datos

- Supabase: sin cambios.
- Migraciones: ninguna.
- RPC/tablas/RLS/grants/SQL: sin cambios.
- Service Worker/PWA de tienda: no agregado.
- Carrito: preservado.
- Recarga automática: solo fallo confirmado de chunk, máximo una vez por ruta/sesión de arranque.

## Riesgos residuales

- Validación física Chrome Android pendiente.
- La heurística de chunks depende de mensajes estándar del navegador/Vite; errores distintos caen al Error Boundary sin recarga automática.
- Una recuperación sin red conserva la vista y el carrito, pero checkout permanece deshabilitado hasta validar información canónica.

## Protocolo manual Chrome Android

1. Abrir `/tienda/:slug`, desplazarse y agregar productos.
2. Abrir/cerrar carrito.
3. Cambiar a WhatsApp menos de 30 segundos; volver y verificar vista, scroll y carrito.
4. Cambiar de aplicación más de 30 segundos; volver y observar actualización silenciosa.
5. Dejar la pestaña varios minutos; volver y confirmar que no queda blanca.
6. Repetir con carrito abierto y con checkout abierto; deben cerrarse sin borrar el carrito.
7. Desactivar internet; volver y validar catálogo guardado + aviso offline.
8. Reactivar internet; confirmar sustitución canónica mediante red.
9. Con una pestaña antigua abierta, publicar por el flujo normal y provocar/corroborar un chunk antiguo: debe recargar una sola vez.
10. Si la recuperación falla, verificar fallback, “Intentar de nuevo” y “Actualizar tienda”.

## Trazabilidad

- Rama: `hotfix/ecom-public-resume-recovery`
- HEAD inicial remoto de `main`: `4e6d671798366461149fb0facf6dd99d14754188`
- HEAD final: ver SHA del PR/entrega, ya que el hash del commit que contiene este reporte no puede autorreferenciarse.
- Commits creados: se registran en la entrega final y en el PR draft.
