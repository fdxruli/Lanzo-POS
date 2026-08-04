# Autohospedaje de Lanzo-POS

## 1. Estado y alcance

Estado de OSS.1.5: `BLOCKED`.

Decisión: **SELF-HOSTING BLOCKED**.

El Nivel 0 (instalación de dependencias y builds) fue reproducido en un
worktree temporal. El flujo completo no puede certificarse: el repositorio no
contiene `supabase/config.toml`, una migración obtiene SQL desde un recurso
externo en tiempo de ejecución, el daemon de Docker no estuvo disponible y la
función `lanzo-ai-agent` invocada por el cliente no está versionada.

Esta guía describe lo que sí fue verificado y separa los pasos no verificados.
No activa AGPL, no crea `LICENSE`, no resuelve OSS.1.4 y no incorpora el PR
#171.

## 2. Advertencia de madurez

No uses este resultado como certificación de una instalación productiva. La
instalación reproducible de los artefactos frontend es parcial; la nube,
Storage, Auth, RLS, RPC, Realtime, Edge Functions y recuperación no fueron
validados de extremo a extremo.

## 3. Arquitectura observada

- **Administración:** Vite + React desde `src/main.jsx`, con PWA `injectManifest`
  y persistencia local basada en IndexedDB/Dexie.
- **Tienda pública:** `store/`, con build independiente, cliente público de
  Supabase y dos handlers serverless: `/api/store-page` y `/api/og/store`.
- **Backend:** 215 migraciones SQL bajo `supabase/migrations/`, 34 pruebas SQL
  y una Edge Function bajo `supabase/functions/authorize-image-upload/`.
- **Servicios:** Supabase JS para Auth, Postgres/RPC, Realtime y Storage;
  `@vercel/og` y `sharp` para Open Graph/imágenes; Google Drive como integración
  opcional de respaldos locales.

## 4. Modos de operación

### Nivel 0 — instalación y build

`VERIFIED WITH NOTES`.

En el commit probado, `npm ci`, `npm ls --all`, `npm run build`,
`npm run build:store` y `npm run build:store:vercel` terminaron correctamente.
La instalación tardó aproximadamente 330 segundos y produjo advertencias de
Node 24, scripts opcionales no aprobados y vulnerabilidades reportadas por npm.
No se modificó el lockfile.

### Nivel 1 — Lanzo Local

`BLOCKED`.

Aunque el código usa IndexedDB y tiene rutas locales, `src/App.jsx` aborta si
faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_PUBLISHABLE_KEY`. Por tanto, no se
demostró un modo funcional sin backend configurado. El shell PWA sí llegó a la
pantalla de recuperación y mostró el error de configuración; eso no equivale
a validar creación de negocio, producto, venta, reinicio u operación offline.

### Nivel 2 — Supabase local

`BLOCKED`.

Supabase CLI estaba instalado, pero `docker info` no respondió y el repositorio
no contiene `supabase/config.toml`. No se ejecutaron `supabase start`,
`supabase db reset`, `supabase status` destructivo ni `supabase link`/`supabase
db push`.

Además, `supabase/migrations/20260715190958_ecom_products_model_1.sql` crea
temporalmente la extensión `http` y descarga otra migración desde un recurso
externo fijado por hash. Eso impide afirmar que una base vacía puede migrarse
sin red, sin una fuente local adicional y sin configuración de Supabase.

### Nivel 3 — flujo cloud aislado

`NOT VERIFIED`.

No se creó tenant, identidad, dispositivo, catálogo, pedido, tracking ni
conversión POS en una infraestructura aislada. La tienda puede compilarse,
pero no se probó una consulta por slug ficticio contra una base aislada.

### Nivel 4 — operación y recuperación

`NOT VERIFIED`.

El código contiene exportación/importación local y una integración opcional con
Google Drive, pero no se ejecutó un respaldo y restauración de PostgreSQL,
Auth, Storage, secretos, dominios ni despliegues. No uses la palabra
“certificado” para esos procedimientos.

## 5. Requisitos

Verificados en esta revisión:

- Windows x64.
- Git disponible.
- Node `v24.18.1` y npm `11.16.0`.
- Supabase CLI `2.51.0`.
- Docker CLI `28.3.2`, con daemon no disponible durante la prueba.
- Un navegador compatible; el navegador de validación reportó Chrome 150 en
  Windows 10/11.

Para una instalación comunitaria se requiere además un proyecto Supabase
aislado, Docker operativo para Supabase local o una plataforma equivalente,
un dominio propio si se publican superficies web y proveedores externos sólo
para las funciones que se activen.

## 6. Clonación e instalación

El siguiente procedimiento fue ejecutado en un worktree temporal, sin
`node_modules`, `dist`, `store/dist`, `.vercel`, `.supabase` ni archivos `.env`.

```powershell
git clone <repositorio-comunitario> Lanzo-POS
cd Lanzo-POS
npm ci
npm ls --all
```

El clon y las rutas anteriores son una receta; sólo `npm ci` y `npm ls --all`
fueron ejecutados en OSS.1.5. No uses `npm install`, `npm update` ni `npm audit
fix` para cambiar el resultado.

## 7. Variables de entorno

Usa `.env.example` como contrato público. Los nombres verificados del cliente
son:

- Supabase público: `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Orígenes: `VITE_ADMIN_APP_ORIGIN`, `VITE_PUBLIC_STORE_ORIGIN` y
  `PUBLIC_STORE_ORIGINS` para handlers de la tienda.
- Integraciones opcionales: `VITE_GOOGLE_CLIENT_ID`, `VITE_SUPPORT_EMAIL`,
  `VITE_AI_EDGE_FUNCTION` y `VITE_AI_PROVIDER`.
- Flags: `VITE_ENABLE_LICENSE_REALTIME`,
  `VITE_ENABLE_CLOUD_SALE_CANCELLATIONS`,
  `VITE_ENABLE_CLOUD_CASHIER_SALES` y `VITE_CLOUD_REQUEST_DEBUG`.
- Build: `VITE_APP_VERSION`, `VITE_BUILD_DATE` y `VITE_BUILD_COMMIT`.
- Compatibilidad de firma local: `VITE_LICENSE_SALT`; se incorpora al bundle y
  no debe tratarse como un secreto de servidor.

La única función Edge presente requiere `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`; están en
`supabase/functions/.env.example`. Nunca expongas la segunda como `VITE_*`.
`AI_API_KEY` y `OPENAI_API_KEY` aparecen en mensajes del cliente, pero no hay
una función `lanzo-ai-agent` versionada que permita validar su contrato.

## 8. Lanzo Local, IndexedDB y PWA

La persistencia local usa IndexedDB/Dexie y el build administrativo genera
Service Worker y manifest. Sin embargo, el guard de `App.jsx` exige las dos
variables públicas de Supabase antes de presentar la aplicación administrativa.
No se verificaron creación de negocio ficticio, producto, venta, reinicio del
navegador ni offline funcional. La pantalla de recuperación visual se observó;
el smoke no fue un PASS funcional.

## 9. Supabase, migraciones, RLS, RPC, Auth y Realtime

El árbol contiene migraciones para tablas, índices, funciones SQL, políticas
RLS, Storage y publicaciones Realtime. El inventario está en la matriz.

No existe `supabase/config.toml` y no se pudo iniciar Docker, por lo que no se
confirmaron orden de aplicación, extensiones, tablas, grants, RLS, RPC, Auth,
Storage, Realtime, seeds ni `supabase db reset` en una base vacía. La migración
que descarga SQL externo es un bloqueante independiente y debe corregirse en
una tarea posterior antes de prometer autohospedaje.

## 10. Edge Functions

Está versionada `authorize-image-upload`. Valida tipo, tamaño, propósito,
licencia y dispositivo; usa los RPC `enforce_pos_rpc_rate_limit_v2`,
`verify_device_license_unified` y `verify_staff_session`, y crea URLs firmadas
para el bucket `images`. Su ejecución local no fue verificada.

El cliente también invoca `lanzo-ai-agent` desde `src/services/aiService.js` y
`src/services/aiAgentUsageService.js`, pero no existe esa carpeta bajo
`supabase/functions/`. La IA no es autohospedable desde este commit sin añadir
una implementación y documentar sus secretos/proveedor.

## 11. Aplicación administrativa y tienda pública

El build de administración produjo `dist` y el build de tienda produjo
`dist-store`. `build:store:vercel` generó un staging en `store/dist`, validó
plantilla, activos y las rutas `/api/og/store` y `/api/store-page`, sin llamar
al CLI de Vercel ni desplegar.

Esto demuestra empaquetado, no una tienda pública operativa. Slug, catálogo,
checkout, tracking, recepción administrativa y conversión POS requieren
Supabase, RPC, RLS y datos ficticios; no se validaron.

La ruta Open Graph depende de `@vercel/og` y la cadena de imágenes depende de
Storage público y `sharp`. La neutralidad completa de plataforma no está
demostrada: el staging sigue el contrato de Vercel y sus handlers serverless,
aunque la lógica puede adaptarse a otro runtime Node compatible.

## 12. Storage, imágenes, Auth y servicios opcionales

- **Storage:** bucket `images`, prefijo `public_uploads` y Edge Function de
  autorización; runtime no verificado.
- **Auth:** consumido por Supabase JS/RPC; no verificado en una instancia nueva.
- **Realtime:** hay código cliente y referencias a `supabase_realtime`; no
  verificado.
- **Google Drive:** opcional; requiere `VITE_GOOGLE_CLIENT_ID` y consentimiento
  de Drive con alcance de archivos. No se usó una cuenta real.
- **IA:** opcional en concepto, pero bloqueada en este árbol por la función
  faltante y por el proveedor externo que requeriría.

## 13. Actualización

Proceso esperado, no certificado en OSS.1.5:

1. Respaldar PostgreSQL, Storage, configuración y datos locales.
2. Obtener un commit/tag y revisar cambios de migración.
3. Ejecutar `npm ci` y regenerar ambos builds.
4. Aplicar migraciones en una instancia aislada antes de producción.
5. Desplegar las funciones presentes y revisar secretos.
6. Actualizar los handlers web y validar rutas, PWA, Auth, Storage y Realtime.
7. Si una migración es destructiva, restaurar el respaldo; no se asume un
   rollback SQL automático.

Los pasos 1, 4–7 no fueron ejecutados. El rollback de migraciones no está
demostrado.

## 14. Respaldo y restauración

La aplicación incluye mecanismos de exportación/importación local y un
adaptador opcional de Google Drive. Eso no respalda PostgreSQL, Auth, Storage,
Edge Function secrets, dominios ni metadatos de despliegue. No se ejecutó una
restauración completa, por lo que su estado es `NOT VERIFIED`.

## 15. Seguridad y diagnóstico

- Usa únicamente claves publicables y proyectos aislados.
- Mantén `SUPABASE_SERVICE_ROLE_KEY` fuera del frontend y fuera de los logs.
- No ejecutes `supabase link`, `supabase db push`, `vercel link`, `vercel deploy`
  ni `vercel --prod` durante una validación local.
- Ante pantalla de recuperación, revisa primero que existan las dos variables
  públicas de Supabase y que no sean una service role.
- Ante fallo de migración, verifica `supabase/config.toml`, Docker y la
  dependencia externa de `20260715190958_ecom_products_model_1.sql`.
- Ante fallo de imágenes, verifica la función `authorize-image-upload`, sus
  dos secretos, los RPC requeridos y el bucket `images`.

## 16. Estado de certificación

**SELF-HOSTING BLOCKED.** Hay un perfil frontend reproducible, pero faltan
configuración y validación de backend, existe una migración no hermética y falta
una función Edge invocada por el producto. OSS.1.4 continúa `NO-GO`; OSS.1.5 no
desbloquea OSS.2 ni activa AGPL.
