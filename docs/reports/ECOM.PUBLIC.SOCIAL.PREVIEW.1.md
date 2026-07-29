# ECOM.PUBLIC.SOCIAL.PREVIEW.1 — Vista previa social de tiendas públicas

## Estado de la minifase 1.0

- Estado: **PASS**
- Auditoría realizada contra `main` en `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- Rama: `feat/ecom-public-social-preview-1`.
- Alcance de este commit: documentación y contrato solamente.
- `SUPABASE_MIGRATION_REQUIRED = false`.
- No se modificó código productivo, configuración de Vercel ni migraciones.
- No se ejecutó ni se modificó Supabase remoto.
- No se ejecutaron `npm install`, `npm ci`, builds ni suites globales.

## 1. Objetivo

Definir la arquitectura y el contrato necesarios para entregar metadatos sociales personalizados, seguros y uniformes en la respuesta HTML inicial de:

```text
/tienda/:slug
```

La iniciativa cubrirá Open Graph y Twitter/X para el enlace principal de cada tienda y una imagen controlada de 1200 × 630. Esta fase no implementa funcionalidad visible.

Quedan fuera de esta iniciativa: metadatos por producto, precios, stock, horarios, estados de apertura, promociones, datos de pedidos, SSR completo, dominios personalizados y cualquier dato administrativo.

## 2. Estado actual de la entrega pública

La tienda usa un build Vite independiente:

- `vite.store.config.js` toma `store/index.html` como entrada y genera `dist-store`.
- `src/main-store.jsx` monta exclusivamente `publicStoreRoutes`.
- `scripts/build-store-vercel.mjs` construye el SPA, audita `dist-store`, copia solamente el artefacto permitido a `store/dist` y agrega `robots.txt`.
- `store/vercel.json` reescribe las rutas públicas hacia `/index.html`.
- `scripts/audit-public-delivery.mjs` bloquea PWA, service workers, contratos administrativos y referencias locales faltantes.
- `scripts/audit-vercel-build-output.mjs` verifica la precedencia de filesystem, el fallback SPA, la ausencia de funciones y middleware, el aislamiento administrativo, `noindex` y la caché inmutable de assets.
- `scripts/prepare-store-deployment.mjs` prepara un paquete temporal con allowlist estricta; rechaza fuentes, scripts, tests, documentación, Supabase, dependencias, secretos, service role, PWA y módulos administrativos.

El HTML inicial es genérico. `store/index.html` contiene:

- `lang="es-MX"`;
- viewport y theme-color;
- una descripción genérica;
- `<title>Tienda en línea — Lanzo</title>`;
- `#root`;
- el entrypoint Vite de la tienda.

No contiene etiquetas Open Graph, Twitter/X ni canonical personalizadas.

La configuración actual de Vercel aplica globalmente:

```text
X-Robots-Tag: noindex, nofollow, noarchive
```

El HTML y las rutas de tienda se revalidan; los assets usan:

```text
Cache-Control: public, max-age=31536000, immutable
```

## 3. Flujo actual de `/tienda/:slug`

1. Vercel recibe `/tienda/:slug`.
2. La regla `/tienda/:path*` responde con el `index.html` estático.
3. El navegador carga los assets hasheados del build independiente.
4. `src/main-store.jsx` prepara las clases del documento y monta React Router.
5. `publicStoreRoutes.jsx` selecciona `PublicStorePage`.
6. `PublicStorePage` lee `slug` con `useParams`.
7. `getPublicPortalBySlug(slug)` invoca `ecommerce_get_portal_by_slug` mediante el cliente público de Supabase.
8. El servicio normaliza portal, features, disponibilidad, `catalogRevision`, política de caché y `site`.
9. Una segunda llamada obtiene el catálogo versionado.
10. Solo después de recibir el portal, un `useEffect` cambia `document.title` y la meta description.
11. React renderiza el documento público y el catálogo.

Estados actuales:

- portal válido: render de tienda y catálogo;
- portal inexistente: “Esta tienda no está disponible”;
- fallo temporal: error recuperable sin exponer detalles;
- caché local pública: puede conservar lectura offline, pero el checkout exige revalidación.

## 4. Por qué `document.title` desde React no basta

La respuesta HTTP inicial siempre contiene el título y la descripción genéricos de `store/index.html`. El título personalizado se establece únicamente después de:

- descargar y ejecutar JavaScript;
- hidratar/montar React;
- resolver el router;
- completar la llamada pública a Supabase;
- ejecutar el efecto del componente.

Los rastreadores de enlaces de WhatsApp, Facebook, X y otros consumidores pueden no ejecutar JavaScript o no esperar esa secuencia. Para ellos no existen metadatos específicos del negocio en la respuesta inicial. Open Graph requiere que las etiquetas estén presentes en el HTML servido, antes de React.

La solución no necesita convertir toda la tienda a SSR: basta con generar el `<head>` inicial en servidor y preservar el HTML/assets producidos por Vite para que la SPA continúe funcionando.

## 5. Contrato público reutilizable

El frontend invoca:

```text
public.ecommerce_get_portal_by_slug(p_slug text)
```

El resultado normalizado tiene esta forma relevante:

```text
{
  portal: {
    slug,
    name,
    headline,
    description,
    templateCode,
    theme,
    logoUrl,
    coverImageUrl,
    businessType,
    ...
  },
  features,
  catalogRevision,
  site: {
    versionId,
    versionNumber,
    documentMode,
    document
  }
}
```

Campos confirmados para la vista previa:

| Campo | Confirmado | Evidencia y uso |
| --- | --- | --- |
| `portal.slug` | Sí | Normalizado por `normalizePortalResult`; URL canónica e imagen controlada. |
| `portal.name` | Sí | Serializador público y normalizador; título e imagen. |
| `portal.headline` | Sí | Serializador público y normalizador; descripción prioritaria. |
| `portal.description` | Sí | Serializador público y normalizador; segundo fallback. |
| `portal.templateCode` | Sí | Serializador público y normalizador; disponible, aunque no es imprescindible para la primera tarjeta. |
| `portal.theme` | Sí | Serializador público y normalizador; color visual con validación posterior. |
| `portal.logoUrl` | Sí | Serializador público y normalizador; logo opcional bajo allowlist. |
| `portal.coverImageUrl` | Sí | Serializador público y normalizador; portada opcional bajo allowlist. |
| `portal.businessType` | Sí | Snapshot normalizado con fallback heredado; no es necesario para el texto inicial. |
| `site.versionNumber` | Sí | Normalizado como entero positivo o `null`; ya se expone como `data-site-version`. |
| `features` | Sí | Normalizado por el servicio público; no se requiere para el contenido social inicial. |
| `catalogRevision` | Sí | Normalizado y usado para coherencia del catálogo; no debe sustituir la versión del sitio en la imagen. |

Se auditaron además los cambios SQL que mantienen el contrato:

- el reporte histórico `reports/ecom_rpc_1_public_contracts_report.md` identifica la migración fundacional `20260709000005_ecom_rpc_1_public_contracts.sql` y el RPC público;
- las migraciones del builder `20260719172400`–`20260720010757` introducen el documento/versiones de sitio consumidos por el cliente;
- `20260726133923_ecommerce_portal_business_contact_requirements.sql` recompone el serializador público con branding y datos de portal;
- `20260726173547_ecommerce_public_store_business_type_label.sql` conserva los campos anteriores y normaliza `businessType` desde `business_types_snapshot`;
- `20260726191819_ecommerce_portal_business_contact_compat_1.sql` conserva compatibilidad de administración sin cambiar el contrato social necesario.

La capa server-side deberá proyectar únicamente la allowlist social. Aunque el contrato público actual también contiene WhatsApp, correo, domicilio, horarios, configuración operativa y otros campos, ninguno debe pasar al constructor de metadatos ni a logs.

## 6. Decisión sobre Supabase

```text
SUPABASE_MIGRATION_REQUIRED = false
```

Motivo:

- nombre, headline y descripción ya están presentes;
- theme, logo y portada ya están presentes;
- slug y rubro ya están presentes;
- `site.versionNumber` ya permite versionar la URL de la imagen;
- el RPC ya está disponible para el rol público y el frontend lo consume mediante credenciales publicables;
- no hace falta abrir tablas, agregar columnas ni ampliar datos sensibles.

Las siguientes minifases deben reutilizar el RPC actual con URL pública y anon/publishable key. No se autoriza `service_role`.

## 7. Arquitectura propuesta

### 7.1 Constructores puros

Crear módulos server-side reutilizables para:

- validar y normalizar slug;
- normalizar texto;
- escapar HTML;
- truncar título y descripción;
- construir URL canónica absoluta;
- construir URL versionada de la imagen;
- validar imágenes solo contra protocolo y orígenes permitidos;
- producir el objeto completo Open Graph y Twitter/X.

No deben aceptar HTML preconstruido ni URLs de imagen arbitrarias del cliente.

### 7.2 Cliente público server-side

Crear un cliente restringido que:

- use exclusivamente URL pública y anon/publishable key;
- invoque `ecommerce_get_portal_by_slug`;
- aplique timeout;
- distinga `ok`, `not_found` y `unavailable`;
- proyecte solo `slug`, `name`, `headline`, `description`, `templateCode`, `theme`, `logoUrl`, `coverImageUrl`, `businessType` y `site.versionNumber`;
- no registre payloads completos;
- permita inyección de `fetch` para pruebas.

### 7.3 Imagen Open Graph

Agregar un endpoint controlado equivalente a:

```text
/api/og/store/:slug?v=:siteVersion
```

Debe devolver PNG 1200 × 630, usar branding permitido, fallback profesional y orígenes de imagen explícitos. La versión en la URL permite caché inmutable cuando existe.

### 7.4 HTML inicial dinámico

Agregar una función interna equivalente a:

```text
/api/store-page?slug=:slug
```

La función debe leer la plantilla generada por Vite o una plantilla derivada automáticamente durante el build, reemplazar un marcador inequívoco dentro de `<head>` y preservar:

- doctype;
- idioma;
- charset, viewport y theme-color;
- `#root`;
- scripts, CSS, modulepreload y hashes reales;
- navegación del SPA y React Router.

No se duplicará `index.html` ni se hardcodearán bundles.

### 7.5 Enrutamiento

Orden conceptual:

1. assets y archivos reales;
2. `/tienda/:slug/pedido/:trackingToken` hacia el SPA estático;
3. `/tienda/:slug` hacia el HTML dinámico;
4. `/tienda`, `/conoce-lanzo` y fallbacks públicos hacia el SPA estático.

El endpoint dinámico solo personaliza el enlace raíz de una tienda.

## 8. Rutas y archivos que se modificarán en minifases posteriores

Ubicaciones propuestas, sujetas a confirmar compatibilidad exacta con Vercel sin cambiar el contrato:

- `store/api/_lib/socialMetadata.js` o equivalente;
- `store/api/_lib/publicPortal.js` o equivalente;
- endpoint de imagen OG;
- endpoint de HTML dinámico;
- pruebas focales de esos módulos;
- `store/index.html` únicamente para un marcador de build inequívoco si es necesario;
- `store/vercel.json`;
- `scripts/build-store-vercel.mjs`;
- `scripts/prepare-store-deployment.mjs`;
- `scripts/audit-public-delivery.mjs`;
- `scripts/audit-vercel-build-output.mjs`;
- pruebas de arquitectura pública;
- este reporte.

`package.json` y lockfile solo se modificarán si la minifase de imagen demuestra que una dependencia es imprescindible y puede actualizarse coherentemente.

## 9. Rutas y superficies que deben permanecer aisladas

Deben conservar el comportamiento actual y no recibir metadatos personalizados:

| Superficie | Política |
| --- | --- |
| `/tienda/:slug/pedido/:trackingToken` | SPA estático; no consultar pedidos para metadata; no copiar el token a title, canonical, OG, imagen o logs. |
| `/tienda` | SPA estático y estado genérico. |
| `/conoce-lanzo` | SPA estático. |
| `/assets/:path*` | Filesystem primero y caché inmutable. |
| Rutas desconocidas públicas | Fallback controlado del SPA, sin confundirlas con una tienda. |
| Aplicación administrativa | Build, router, PWA, Vercel config y chunks administrativos separados. |
| Caja, POS, inventario, ventas, licencias y autenticación | No importar ni copiar al artefacto público. |
| Supabase privado | Sin acceso directo a tablas, helpers privados o `service_role`. |

## 10. Política de seguridad

- Validar slug antes de cualquier consulta.
- Usar solo credenciales públicas; prohibido `service_role`.
- Consumir el RPC existente, no tablas directas.
- Proyectar una allowlist mínima.
- Excluir teléfono, correo, domicilio, horarios, stock, precios, catálogo, pedidos, tokens, licencia, dispositivo, personal y configuración interna.
- Escapar cada valor insertado en HTML.
- Rechazar saltos y contenido ejecutable; aplicar límites de longitud.
- No usar contenido del negocio como HTML.
- No aceptar URL canónica ni URL OG desde el navegador.
- Construir canonical e imagen desde el origen Lanzo configurado y el slug validado.
- Para logo/portada: HTTPS, hostname allowlist, sin credenciales, puertos ni redirecciones a orígenes privados, timeout y límite de tamaño.
- Evitar SSRF: no descargar localhost, IP privadas, link-local, metadata endpoints ni esquemas distintos de HTTPS.
- No registrar respuestas completas, secretos, tokens ni URLs privadas.
- Mantener mensajes de error genéricos.
- Conservar `X-Robots-Tag: noindex, nofollow, noarchive`.
- Mantener las auditorías de secretos y aislamiento; ampliarlas de forma puntual para funciones nuevas.

## 11. Política inicial de caché

HTML personalizado:

```text
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400
```

Esto permite actualización razonable sin impedir la carga de la SPA ante una falla temporal.

Imagen con `site.versionNumber` válido:

```text
Cache-Control: public, max-age=31536000, immutable
```

Imagen sin versión válida:

- caché corta o revalidable;
- nunca `immutable`, porque la URL sería mutable.

Assets Vite:

```text
Cache-Control: public, max-age=31536000, immutable
```

Respuestas genéricas por error temporal no deben quedar fijadas permanentemente. El endpoint de HTML debe devolver metadatos genéricos y conservar React en vez de provocar una pantalla blanca.

## 12. Alcance de las siguientes minifases

- **1.1:** constructores puros, sanitización y pruebas.
- **1.2:** cliente público server-side; sin migración según esta decisión.
- **1.3:** imagen dinámica 1200 × 630, fallbacks y anti-SSRF.
- **1.4:** HTML inicial dinámico preservando los assets reales de Vite.
- **1.5:** rewrites y aislamiento explícito de tracking.
- **1.6:** integración de build, staging y auditorías.
- **1.7:** validación integral y corrección de bloqueantes.
- **1.8:** documentación final y entrega del mismo PR draft.

Cada minifase debe usar esta misma rama y PR; no debe adelantar el alcance de la siguiente.

## 13. Riesgos encontrados

1. **El HTML actual es solo SPA.** Los rastreadores reciben título y descripción genéricos.
2. **Rewrite demasiado amplio.** `/tienda/:path*` incluye tanto la raíz de tienda como tracking; la futura regla dinámica necesita precedencia explícita.
3. **Tracking sensible.** Un patrón incorrecto podría poner el token en canonical, OG, imagen, consulta o logs.
4. **Build allowlist estática.** Hoy `build-store-vercel.mjs` permite solo `index.html`, `robots.txt` y assets hasheados; las funciones nuevas requieren una extensión mínima y auditada.
5. **Auditoría prebuilt presupone cero funciones.** `audit-vercel-build-output.mjs` afirma `noFunctions`; deberá cambiar a “solo funciones OG/HTML permitidas” sin relajar la exclusión administrativa.
6. **Paquete de despliegue bloquea fuentes.** `prepare-store-deployment.mjs` excluye `src`, scripts y package files; hay que definir exactamente qué fuente/runtime necesita Vercel sin copiar el repositorio completo.
7. **Imágenes remotas.** Logo y portada son públicas pero descargarlas sin allowlist crearía riesgo SSRF y dependencia de hosts inestables.
8. **Caché de imagen.** Usar `immutable` sin `site.versionNumber` fijaría branding obsoleto.
9. **Fallas de Supabase.** El HTML dinámico no debe convertir un timeout en pantalla blanca ni bloquear el SPA.
10. **Duplicación de metadata.** La inyección debe garantizar un solo title, description, canonical y conjunto OG.
11. **Plantilla Vite.** Hardcodear hashes rompería cada build; la función debe consumir el HTML generado.
12. **Historial SQL.** El reporte histórico identifica `20260709000005_ecom_rpc_1_public_contracts.sql`, pero esa ruta no fue recuperable directamente en el HEAD auditado; las migraciones posteriores y el cliente confirman el contrato vigente. Debe mantenerse trazabilidad documental y evitar editar migraciones históricas.
13. **Contrato público más amplio que OG.** Contiene contacto, domicilio y configuración operativa; la capa server-side debe proyectar y registrar únicamente la allowlist social.

Ninguno de estos riesgos exige una migración de Supabase en esta iniciativa.

## 14. Criterios de aceptación generales

La iniciativa podrá considerarse completa cuando:

- `/tienda/:slug` entregue en el HTML inicial un único conjunto correcto de title, description, canonical, Open Graph y Twitter/X;
- la imagen sea PNG 1200 × 630, controlada, segura, con fallback y versionado;
- los caracteres del negocio no puedan cerrar etiquetas ni inyectar HTML;
- slug, canonical e imagen se construyan en servidor;
- el cliente use solo credenciales públicas y el RPC existente;
- no se expongan datos privados u operativos;
- tracking permanezca estático y su token nunca llegue a metadata o logs;
- tienda inexistente y error temporal produzcan fallbacks seguros sin pantalla blanca;
- los scripts y estilos reales del build Vite permanezcan intactos;
- assets mantengan caché inmutable y el HTML tenga caché revalidable;
- la integración de Vercel no cree bucles ni colisiones de rutas;
- las auditorías permitan solamente las funciones nuevas y sigan bloqueando secretos, PWA y código administrativo;
- las pruebas focales, de rutas, seguridad y arquitectura cubran los estados definidos;
- no exista una migración innecesaria;
- el PR permanezca draft, sin auto-merge ni merge.

## Evidencia auditada

Archivos principales revisados en el HEAD base:

- `store/vercel.json`
- `store/index.html`
- `package.json`
- `vite.store.config.js`
- `vite.config.js`
- `scripts/build-store-vercel.mjs`
- `scripts/prepare-store-deployment.mjs`
- `scripts/audit-public-delivery.mjs`
- `scripts/audit-vercel-build-output.mjs`
- `src/main-store.jsx`
- `src/pages/PublicStorePage.jsx`
- `src/router/publicStoreRoutes.jsx`
- `src/router/preparePublicStoreDocument.js`
- `src/services/supabasePublic.js`
- `src/services/ecommerce/ecommercePublicServiceBase.js`
- `reports/ecom_rpc_1_public_contracts_report.md`
- migraciones de contrato público, builder, contacto y rubro señaladas en las secciones anteriores.

## Habilitación

Con esta decisión y contrato, queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.1 — Constructores seguros de metadatos sociales
```

## Estado de la minifase 1.1

- Estado: **PASS**.
- HEAD inicial remoto: `56cdf7c5350a8ee7dbaa25e30f445fe695735446`.
- Rama: `feat/ecom-public-social-preview-1`.
- Módulo creado: `store/api/_lib/socialMetadata.js`.
- Pruebas creadas: `store/api/_lib/__tests__/socialMetadata.test.js`.
- Supabase modificado: **no**.
- Vercel modificado: **no**.
- Dependencias agregadas: **no**.
- Historial: se requirió un segundo commit correctivo para retirar del reporte un marcador literal detectado por la auditoría final; no cambió el código ni las pruebas.

### Contrato de entrada y salida

El constructor principal es:

```js
buildStoreSocialMetadata({
  publicOrigin,
  slug,
  portal,
  siteVersionNumber
})
```

`slug` se mantiene separado de `portal` para que el constructor solo lea de ese objeto la allowlist social `name`, `headline` y `description`. La salida es un objeto profundamente congelado con título, descripción, canonical, imagen, alt, locale, site name, indicador de versión y objetos consistentes de Open Graph y Twitter/X.

### Constantes y políticas

- `MIN_STORE_SLUG_LENGTH = 3`.
- `MAX_STORE_SLUG_LENGTH = 64`.
- `MAX_STORE_NAME_LENGTH = 80`.
- `MAX_SOCIAL_TITLE_LENGTH = 110`.
- `MAX_SOCIAL_DESCRIPTION_LENGTH = 200`.
- `MAX_IMAGE_ALT_LENGTH = 160`.
- Open Graph: `website`, 1200 × 630, `image/png`.
- Locale: `es_MX`.
- Site name: `Lanzo Tienda`.
- Twitter/X: `summary_large_image`.

El slug aplica estrictamente `^[a-z0-9][a-z0-9-]*[a-z0-9]$` y longitud de 3 a 64. No hace `trim`, no convierte mayúsculas y no transforma entradas inválidas. Los errores usan `SocialMetadataValidationError` con códigos `INVALID_STORE_SLUG` o `INVALID_PUBLIC_ORIGIN` y mensajes genéricos que no incluyen la entrada rechazada.

La normalización acepta solo strings, elimina caracteres de control, colapsa whitespace a un espacio, aplica `trim()` y conserva español y Unicode visible. El truncado cuenta puntos de código con `Array.from`, reserva un único carácter `…`, elimina espacio final y nunca rebasa el máximo.

El título usa `[Nombre] | Tienda en línea` y fallback `Tienda en línea | Lanzo`. La descripción prioriza headline, después description, después el fallback con nombre y finalmente el fallback global.

### Canonical, imagen y escape

`publicOrigin` debe ser una URL absoluta HTTPS, sin credenciales, query, hash ni pathname ajeno al origen. Se normaliza a `URL.origin`.

- Canonical: `[publicOrigin]/tienda/[slug]`.
- Imagen controlada: `[publicOrigin]/api/og/store/[slug]`.
- Solo un entero positivo seguro en `siteVersionNumber` agrega `?v=`; ningún otro campo actúa como reemplazo.
- `imageVersioned` indica si la URL quedó versionada.

`escapeHtmlText` y `escapeHtmlAttribute` son funciones explícitas y separadas del objeto semántico. Escapan `&`, `<`, `>`, comillas dobles y comilla simple. El constructor conserva texto plano para evitar doble escape.

### Campos permitidos y excluidos

Campos leídos desde `portal`: `name`, `headline`, `description`.

Campos ignorados y cubiertos por prueba de privacidad: WhatsApp, correo, domicilio y sus componentes, horarios, disponibilidad, stock, settings, features, catalogRevision, licencia, pedidos, tracking token, logo, portada y theme.

### Pruebas y validación

La suite focal cubre slug, texto, límites, Unicode, escape, intentos de cierre de tag y atributo, ausencia de preescape, origen confiable, canonical, imagen controlada, versiones válidas e inválidas, consistencia Open Graph/Twitter, inmutabilidad y exclusión de datos privados.

- Pruebas focales Vitest: **NOT RUN**.
- Motivo: la ejecución se realizó mediante integración directa de GitHub, sin checkout local ni dependencias instaladas; por alcance no se ejecutaron `npm install` ni `npm ci`.
- Comprobación sintáctica con `node --check`: **PASS**.
- Aserciones runtime-neutral independientes para slug, origen, truncado Unicode, escape, canonical, imagen, consistencia, privacidad e inmutabilidad: **PASS**.
- Inspección estática de imports, efectos secundarios, marcadores pendientes, secretos y aislamiento: **PASS**.

### Riesgos y habilitación

No se encontraron bloqueantes para esta minifase. Riesgo no bloqueante: la suite Vitest deberá ejecutarse en un entorno con las dependencias ya disponibles; no se adelantaron endpoints, consultas de red, imagen PNG, inyección HTML ni cambios de routing.

Se confirma que Supabase no fue modificado y `SUPABASE_MIGRATION_REQUIRED = false`.

Queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.2 — Cliente server-side del portal público
```

## Estado de la minifase 1.2

- Estado: **PASS**.
- HEAD inicial real de la rama: `b014e885f2a3314df0e10bb38396628a11f72dcb`.
- HEAD de `main` verificado: `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- El PR #141 permaneció abierto y como draft durante la implementación.
- Corrección preventiva: `socialMetadata.js` se renombró como `store/api/_socialMetadata.js`; sus pruebas se movieron a `store/tests/social-preview/socialMetadata.test.js`.
- Cliente nuevo: `store/api/_publicPortal.js`.
- Pruebas nuevas: `store/tests/social-preview/publicPortal.test.js`.
- Los auxiliares bajo `store/api` comienzan con `_` y las pruebas quedaron fuera de `/api`; ninguno constituye una función HTTP.
- No se creó endpoint, no se modificó routing y no se modificó `store/vercel.json`.

### Contrato del cliente público

Constructor:

```js
createPublicPortalSocialClient({
  supabaseUrl,
  publishableKey,
  fetchImpl,
  timeoutMs
})
```

Operación:

```js
client.getPortalBySlug(slug)
```

El módulo es JavaScript ESM puro, sin React, DOM, IndexedDB, cachés browser, imports administrativos, lectura de variables de entorno ni efectos secundarios de importación. `fetchImpl` es inyectable y el fallback usa únicamente `globalThis.fetch` disponible en runtime.

La URL configurada debe ser un origen HTTPS absoluto sin credenciales, query, hash ni pathname arbitrario. Se normalizan diagonales finales redundantes. La clave se normaliza solo con `trim()`; se aceptan credenciales públicas heredadas anon y `sb_publishable_*`, y se rechazan antes de red `service_role`, `SUPABASE_SERVICE_ROLE`, `sb_secret_*` y JWT cuyo payload declare rol `service_role`. Los errores de configuración son genéricos y nunca incluyen la URL completa ni la clave.

Configuración ausente produce:

```js
{ status: 'unavailable', reason: 'configuration_missing' }
```

Los valores presentes pero inválidos producen `PublicPortalClientConfigurationError` con códigos constantes.

### RPC, solicitud, timeout y límite

Única operación remota:

```text
POST [supabaseUrl]/rest/v1/rpc/ecommerce_get_portal_by_slug
```

Body exacto:

```json
{"p_slug":"slug-validado"}
```

Headers exactos:

- `Content-Type: application/json`
- `Accept: application/json`
- `apikey: [publishableKey]`
- `Authorization: Bearer [publishableKey]`

Se utiliza `redirect: "error"` y una señal de `AbortController`. `DEFAULT_PUBLIC_PORTAL_TIMEOUT_MS = 4000`; solo se aceptan enteros seguros entre 500 y 10000 ms. El timeout aborta la solicitud, cubre lectura del cuerpo y siempre libera el temporizador.

`MAX_PUBLIC_PORTAL_RESPONSE_BYTES = 262144` (256 KiB). Primero se inspecciona `Content-Length`, después se lee texto, se mide en bytes con `TextEncoder` y solo entonces se usa `JSON.parse`. No se registra ni se retorna el cuerpo remoto.

### Estados y proyección

Estados implementados:

- `{ status: 'ok', portal, siteVersionNumber }`
- `{ status: 'not_found' }` únicamente para `ECOMMERCE_PORTAL_NOT_FOUND`
- `{ status: 'unavailable', reason }` con `timeout`, `network`, `http_error`, `remote_error`, `invalid_response` o `configuration_missing`

Un HTTP 404 genérico permanece `http_error`. Para `ok` se exige HTTP exitoso, `success === true`, portal objeto, slug válido y coincidencia exacta con el solicitado. Se rechazan estructuras con claves propias `__proto__`, `constructor` o `prototype`.

Allowlist retornada:

- `slug`
- `name`
- `headline`
- `description`
- `templateCode`
- `theme`
- `logoUrl`
- `coverImageUrl`
- `businessType`
- `siteVersionNumber`

Se excluyen WhatsApp, correo, domicilio y componentes, horarios, disponibilidad, flags de pedidos, límites operativos, stock, settings, features, catálogo y revisión, licencia, pedidos, tracking, dispositivo, staff y metadata. La proyección se construye desde cero y se congela profundamente.

Los textos aceptan solo strings, normalizan espacios y aplican límites. `businessType` acepta solo arrays, elimina vacíos y duplicados y limita cantidad y longitud sin inferir rubros. `siteVersionNumber` solo conserva enteros positivos seguros y no usa `catalogRevision` como fallback.

`templateCode` reutiliza el normalizador vigente y cae a `classic`. `theme` reutiliza `normalizeEcommercePortalTheme` con una entrada previamente proyectada a `primaryColor`, `secondaryColor`, `cornerStyle` y `fontStyle`; no conserva JSON arbitrario ni settings.

`logoUrl` y `coverImageUrl` son únicamente candidatas: strings HTTPS válidos, sin credenciales y con longitud máxima de 2048. Se rechazan HTTP, `data:`, `javascript:`, `blob:` y `file:`. No se descargan imágenes ni se siguen redirecciones; la allowlist final de hosts y el control anti-SSRF corresponden a 1.3.

### Pruebas y validación

Las suites focales quedan en:

- `store/tests/social-preview/socialMetadata.test.js`
- `store/tests/social-preview/publicPortal.test.js`

La suite nueva cubre configuración, URLs, claves públicas y privilegiadas, solicitud exacta, validador compartido de slug, ausencia de red con slug inválido, inyección de fetch, señal, timeout, liberación de timer, portal completo y opcional, textos, template, theme, rubros, imágenes, versión, inmutabilidad, not found contractual, HTTP 400/401/404/500, red, JSON inválido, cuerpos excesivos, errores remotos, portales incompletos, slug discordante, claves de prototipo, privacidad, ubicación de credenciales y ausencia de logging.

- Pruebas focales Vitest: **NOT RUN**.
- Motivo: Vitest no está disponible en el entorno de trabajo conectado y el alcance prohíbe `npm install` y `npm ci`.
- Validación sintáctica con `node --check`: **PASS**.
- Aserciones runtime-neutral independientes para solicitud, proyección, normalización, privacidad, configuración faltante, slug inválido y rechazo de credenciales privilegiadas: **PASS**.
- Validación estática de imports, runtime, endpoint único, logging, marcadores pendientes y secretos reales: **PASS**.
- Comprobación equivalente a `git diff --check`: **PASS** por inspección del parche remoto sin errores de whitespace.

### Límites y habilitación

- Supabase modificado: **no**.
- Migración creada: **no**.
- RPC, tablas, RLS, grants o datos modificados: **no**.
- Vercel modificado: **no**.
- Endpoint HTTP creado: **no**.
- Dependencias agregadas: **no**.
- Builds o suites globales ejecutados: **no**.
- Bloqueantes residuales: ninguno conocido.
- Riesgos no bloqueantes: Vitest queda pendiente de ejecución en un entorno con dependencias existentes; la descarga de imágenes, allowlist de hosts y defensa anti-SSRF se implementarán en 1.3.

Queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.3 — Imagen Open Graph dinámica de tienda
```

## Estado de la minifase 1.3

- Estado tras revisión posterior: **BLOCKED** por cinco hallazgos de endurecimiento,
  corregidos en la minifase 1.3.1 documentada a continuación.
- HEAD inicial real de la rama: `8425f06418812e951a0ff059446520358aebfc33`.
- HEAD de `main` verificado: `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- El PR #141 permaneció abierto, sin merge y como draft.
- Endpoint público nuevo: `store/api/og/store.js`.
- Ruta: `/api/og/store?slug=:slug&v=:siteVersionNumber`.
- Dimensiones: 1200 × 630.
- Formato: PNG mediante `ImageResponse`.
- Supabase modificado: **no**.
- `store/vercel.json` modificado: **no**.
- HTML dinámico o rewrites de tienda modificados: **no**.
- `SUPABASE_MIGRATION_REQUIRED = false`.

### Gates correctivos de 1.2

`store/api/_publicPortal.js` dejó de depender de `response.text()` cuando el runtime
ofrece un stream. La lectura:

- inspecciona primero `Content-Length`;
- rechaza declaraciones superiores a 256 KiB sin leer el cuerpo;
- usa `response.body.getReader()` por chunks;
- deja de acumular al superar `MAX_PUBLIC_PORTAL_RESPONSE_BYTES`;
- cancela el reader al exceder el límite o abortarse la solicitud;
- libera el lock en la salida;
- conserva un fallback medido para mocks o runtimes sin `response.body`;
- permanece cubierta por el timeout global de la consulta;
- no registra ni expone el cuerpo.

También se corrigió la precedencia de clasificación. Después de analizar el cuerpo
y rechazar claves peligrosas, la respuesta HTTP no exitosa prevalece sobre los
códigos contractuales. Un HTTP 500 que contenga
`ECOMMERCE_PORTAL_NOT_FOUND` ahora es `http_error`; el mismo código bajo HTTP
exitoso sigue siendo `not_found`.

Las regresiones agregadas cubren stream válido, múltiples chunks, límite exacto,
exceso y cancelación, timeout durante lectura, fallback sin stream y ambos casos
de precedencia HTTP.

### Dependencia y lockfile

La auditoría confirmó que `@vercel/og` no existía en el contrato. Se agregó como
dependencia de producción:

```text
@vercel/og@0.11.1
```

La versión publicada declara Node `>=16` y no declara peer dependency
incompatible con React 19. El `package-lock.json` se regeneró de forma coherente
con:

```text
npm --cache /tmp/lanzo-npm-cache install \
  --package-lock-only \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  @vercel/og@0.11.1
```

No se ejecutó `npm ci`, no se instalaron módulos, no se hizo instalación global y
no se ejecutó un build global. npm emitió únicamente una advertencia histórica de
engine para `react-zxing@2.1.0` porque el entorno conectado usa Node 24; no impidió
la generación del lockfile.

### Endpoint, runtime y variables

El endpoint usa la firma Web API:

```js
export default {
  async fetch(request) {
    // Response o ImageResponse
  }
}
```

Admite `GET` y `HEAD`. Otros métodos devuelven 405 con `Allow: GET, HEAD`. El
`slug` debe aparecer exactamente una vez y pasar `validateStoreSlug`; no se
normaliza silenciosamente ni se consulta red con un valor inválido. `v` solo se
conserva cuando aparece una vez y es un entero positivo seguro; nunca selecciona
branding histórico ni reemplaza `result.siteVersionNumber`.

La configuración se lee exclusivamente desde:

```text
process.env.VITE_SUPABASE_URL
process.env.VITE_SUPABASE_PUBLISHABLE_KEY
```

Estos valores se pasan a `createPublicPortalSocialClient`. Configuración ausente o
inválida produce una tarjeta genérica con caché temporal; no se incluye la razón
técnica, stack, URL de Supabase ni credencial en la salida.

### Arquitectura y diseño

La minifase separa:

1. validación de request y política de respuesta en `store/api/og/store.js`;
2. consulta pública mediante `store/api/_publicPortal.js`;
3. descarga controlada en `store/api/_safePublicImage.js`;
4. modelo visual puro y render en `store/api/_storeOgCard.js`;
5. PNG mediante `@vercel/og` `ImageResponse`;
6. headers y caché determinados por estado y versión.

`createStoreOgHandler` permite inyectar cliente, cargador de imágenes e
implementación de `ImageResponse`. Las pruebas no necesitan Supabase, Vercel,
imágenes ni credenciales reales.

La tarjeta contiene fondo completo, superficie de branding, logo o inicial,
etiqueta “Tienda en línea”, nombre, descripción breve, decoración derivada del
tema y “Impulsado por Lanzo”. Usa flexbox, posicionamiento absoluto y estilos
inline deterministas; no usa CSS Grid, clases externas ni fuentes descargadas.

El modelo normaliza `primaryColor`, `secondaryColor`, `cornerStyle` y `fontStyle`
con el tema canónico. Sus funciones puras calculan luminancia, texto legible y
mezclas claras u oscuras. El nombre y la descripción se limitan a dos líneas
visuales; el tamaño del nombre se reduce según longitud.

Fallbacks:

```text
portada + logo
→ color del tema + logo
→ color del tema + inicial
→ plantilla genérica Lanzo
```

La inicial usa la primera letra visible del nombre y cae a `L`. No se muestran
teléfono, WhatsApp, correo, domicilio, horarios, disponibilidad, stock, precios,
promociones, cantidades, pedidos, tracking, licencia, usuario ni datos
administrativos.

### Imágenes públicas y anti-SSRF

`store/api/_safePublicImage.js` deriva el único hostname permitido desde
`VITE_SUPABASE_URL`. Exige HTTPS, hostname exacto, puerto estándar, ausencia de
credenciales y una de estas rutas:

```text
/storage/v1/object/public/
/storage/v1/render/image/public/
```

Rechaza hosts parecidos, subdominios inesperados, localhost, IPv4, IPv6, puertos
no estándar, rutas no públicas y esquemas `http:`, `data:`, `blob:`, `file:` o
`javascript:`. No amplía la allowlist a CDN o hosts externos.

La descarga usa `GET`, `redirect: "error"`, timeout independiente de 2500 ms,
`Accept: image/png,image/jpeg,image/webp`, máximo de 5 MiB, revisión de
`Content-Length`, lectura limitada por stream y allowlist estricta de
`Content-Type`. No envía cookies, `Authorization`, `apikey` ni headers de
Supabase. Los bytes validados se convierten con `Buffer` a data URI para evitar
una segunda descarga de Satori. Un fallo omite la imagen y conserva el PNG de
fallback.

### Caché y headers

Tarjeta `ok` con `v` coincidente con `siteVersionNumber`:

```text
Cache-Control: public, max-age=31536000, immutable
```

Tarjeta `ok` sin versión, versión inválida o discordante:

```text
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400
```

Tienda inexistente:

```text
Cache-Control: public, max-age=0, s-maxage=300
```

Error temporal, configuración faltante o slug inválido:

```text
Cache-Control: public, max-age=0, s-maxage=60
```

Todas las respuestas controladas conservan `Content-Type: image/png`,
`X-Content-Type-Options: nosniff` y
`X-Robots-Tag: noindex, nofollow, noarchive`. `HEAD` consulta el estado necesario
para elegir caché pero no descarga imágenes ni renderiza el cuerpo PNG.

### Pruebas y validación

Pruebas creadas:

- `store/tests/social-preview/storeOgCard.test.js`;
- `store/tests/social-preview/storeOgEndpoint.test.js`;
- `store/tests/social-preview/safePublicImage.test.js`.

Pruebas ampliadas:

- `store/tests/social-preview/publicPortal.test.js`;
- `store/tests/social-preview/socialMetadata.test.js`.

Cobertura declarada: modelo y fallbacks; nombres y descripciones largas; temas
claros, oscuros e inválidos; inmutabilidad; privacidad; GET, HEAD y 405; query de
slug y versión; estados `ok`, `not_found` y `unavailable`; dimensiones, formato y
headers; caché coincidente y fallbacks no inmutables; allowlist exacta,
anti-SSRF, redirects, tipos, límites, streams, timeouts, errores de red y ausencia
de headers privados.

- Suites focales Vitest: **NOT RUN**.
- Motivo: las dependencias no están instaladas en el entorno conectado y la
  minifase autoriza solo la actualización `--package-lock-only`.
- `node --check` sobre archivos `.js` productivos y pruebas: **PASS**.
- Validación focal del parser para `store/api/og/store.js`, sin transformación JSX,
  extensión temporal `.mjs` porque no contiene sintaxis JSX: **PASS**.
- Aserciones runtime-neutral para lectura stream, límite, precedencia HTTP,
  metadata con `URLSearchParams` y allowlist anti-SSRF: **PASS**.

### Archivos creados y modificados

Creados:

- `store/api/og/store.js`;
- `store/api/_safePublicImage.js`;
- `store/api/_storeOgCard.js`;
- `store/tests/social-preview/storeOgCard.test.js`;
- `store/tests/social-preview/storeOgEndpoint.test.js`;
- `store/tests/social-preview/safePublicImage.test.js`.

Modificados:

- `store/api/_publicPortal.js`;
- `store/api/_socialMetadata.js`;
- `store/tests/social-preview/publicPortal.test.js`;
- `store/tests/social-preview/socialMetadata.test.js`;
- `package.json`;
- `package-lock.json`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`.

No se modificaron Supabase, migraciones, RPC, tablas, RLS, grants, datos,
`store/vercel.json`, checkout, catálogo, pedidos, stock, horarios, HTML dinámico,
rewrites ni fuentes.

### Riesgos residuales y habilitación

Vitest permanece pendiente de un entorno que ya tenga las dependencias
instaladas. La integración del endpoint en el paquete de despliegue y las
auditorías prebuilt corresponde a la minifase 1.6; esta minifase no relajó
allowlists de build ni modificó Vercel. La personalización del HTML inicial aún
no existe y corresponde a 1.4.

La revisión posterior identificó bloqueantes en el fallback sin stream, la
validación binaria, la resiliencia del renderer, las familias tipográficas no
incorporadas y la ausencia de una prueba real con `ImageResponse`. La habilitación
de 1.4 quedó suspendida hasta completar 1.3.1.

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.3.1 — Endurecimiento del render Open Graph
```

## Estado de la minifase 1.3.1

- Estado: **PASS**.
- HEAD inicial remoto: `034ac911c1f80d8c312b1600f504d66c0f4abe18`.
- Base `main`: `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- PR #141: abierto y draft durante la implementación.
- Dependencias agregadas o modificadas: **no**.
- Supabase modificado: **no**.
- Migración creada: **no**.
- `store/vercel.json` modificado: **no**.
- HTML dinámico, rewrites o empaquetado implementados: **no**.

### Límite real sin stream

`store/api/_safePublicImage.js` conserva la lectura por
`response.body.getReader()` como vía preferente. Cuando el runtime o un mock no
ofrece stream, el fallback ahora exige un `Content-Length` decimal válido,
entero, no negativo y menor o igual al límite configurado antes de invocar
`arrayBuffer()`.

Una longitud ausente, inválida, negativa o excesiva rechaza la imagen sin
asignar el cuerpo en memoria. Después de leer, se comprueba nuevamente que el
tamaño real no exceda ni `Content-Length` ni `maximumBytes`. Las pruebas cubren
longitud válida, ausente, inválida, negativa, excesiva, cuerpo real mayor al
declarado y tamaño exactamente igual al máximo.

### Firmas binarias

La función pura `hasValidImageSignature(contentType, bytes)` aplica estas reglas:

- PNG: `89 50 4E 47 0D 0A 1A 0A`;
- JPEG: inicio `FF D8 FF`;
- WebP: `RIFF` en bytes 0–3 y `WEBP` en bytes 8–11.

El tipo declarado debe coincidir con los bytes. Un cuerpo vacío, corto,
truncado, aleatorio o con una firma de otro formato devuelve `null` antes de la
conversión a data URI y nunca llega a `ImageResponse`. Los fixtures unitarios
dejan explícito que la firma PNG completa se usa para reconocimiento de formato
y no pretende representar por sí sola un PNG decodificable.

### Fallback del renderer

El render quedó separado en:

```js
renderStoreOgImage({
  ImageResponseImpl,
  model,
  status,
  headers
})
```

El endpoint construye primero el modelo personalizado y realiza un intento. Si
la construcción de `ImageResponse` lanza, crea un modelo genérico nuevo sin logo
ni portada y reintenta exactamente una vez. Este segundo intento siempre usa:

```text
Cache-Control: public, max-age=0, s-maxage=60
```

Por ello una tarjeta originalmente versionada pierde `immutable` después de un
fallo del primer render.

Si el segundo intento también lanza, la respuesta es:

```text
HTTP 500
Cache-Control: no-store
Content-Type: text/plain; charset=utf-8
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow, noarchive
```

El cuerpo contiene únicamente `Open Graph image unavailable.`. No declara PNG,
no incluye stack, slug, credenciales, detalles internos y no existe un ciclo de
reintento ni logging sensible.

### Fuentes no incorporadas

Se eliminaron `Arial`, `Georgia` y toda propiedad `fontFamily` del modelo y del
árbol renderizado. `fontStyle` continúa normalizándose en el contrato público,
pero no altera el render en esta versión. `ImageResponse` utiliza su fuente
incorporada predeterminada.

La diferenciación editorial o rounded queda fuera de alcance mientras no exista
una estrategia de fuentes autorizada. No se agregaron `.ttf`, `.otf`, `.woff` o
`.woff2`, URLs de fuentes ni otra dependencia.

### Prueba con ImageResponse real

Se creó:

```text
store/tests/social-preview/storeOgRender.test.js
```

La prueba importa `ImageResponse` directamente desde `@vercel/og` y cubre:

1. tarjeta genérica sin imágenes;
2. tarjeta con nombre y tema;
3. fallback de tienda inexistente.

Para cada caso valida respuesta 200, `image/png`, cuerpo no vacío, firma PNG,
dimensiones leídas del IHDR de 1200 × 630, ausencia de red, Supabase y fuentes
externas.

```text
Prueba real ImageResponse: NOT RUN
Motivo: dependencias no instaladas en el entorno conectado
```

La minifase no instaló módulos ni ejecutó `npm ci`.

### Pruebas y validación

Suites focales completas en código:

- `store/tests/social-preview/socialMetadata.test.js`;
- `store/tests/social-preview/publicPortal.test.js`;
- `store/tests/social-preview/safePublicImage.test.js`;
- `store/tests/social-preview/storeOgCard.test.js`;
- `store/tests/social-preview/storeOgEndpoint.test.js`;
- `store/tests/social-preview/storeOgRender.test.js`.

Resultados:

- Vitest focal: **NOT RUN**, porque `node_modules` no existe en el entorno
  conectado.
- Prueba real `ImageResponse`: **NOT RUN** por el mismo motivo.
- `node --check` para módulos `.js` y pruebas: **PASS ejecutado**.
- Validación del parser del endpoint `.jsx` mediante copia temporal `.mjs` sin
  modificar el fuente: **PASS ejecutado**.
- Aserciones runtime-neutral de firmas y fallback sin stream:
  **PASS ejecutado**.
- Revisión estática del fallback del renderer, doble fallo, headers, caché,
  privacidad, fuentes e imports: **PASS por inspección estática**.

### Archivos creados y modificados

Creado:

- `store/tests/social-preview/storeOgRender.test.js`.

Modificados:

- `store/api/_safePublicImage.js`;
- `store/api/_storeOgCard.js`;
- `store/api/og/store.js`;
- `store/tests/social-preview/safePublicImage.test.js`;
- `store/tests/social-preview/storeOgCard.test.js`;
- `store/tests/social-preview/storeOgEndpoint.test.js`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`.

No se modificaron `package.json`, `package-lock.json`, Supabase, migraciones,
RPC, RLS, grants, tablas, datos, `store/vercel.json`, checkout, catálogo,
pedidos, stock, horarios, rutas de tienda, HTML dinámico, rewrites, scripts de
build o empaquetado.

### Riesgos residuales y habilitación

Riesgo no bloqueante: el render real queda pendiente de ejecución en un entorno
que ya tenga instaladas las dependencias aprobadas. La integración de la función
en el paquete `lanzo-store` y sus auditorías continúa reservada a 1.6.

No quedan bloqueantes conocidos dentro del alcance de 1.3.1. Queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.4 — HTML dinámico con metadatos sociales
```

## Estado de la minifase 1.4

- Estado: **PASS**.
- HEAD inicial real de la rama:
  `08f5efe8b9c32debdd6bb4c71dba4205b675d4b2`.
- HEAD de `main` al iniciar:
  `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- PR #141 permaneció abierto y como draft.
- Rama exclusiva: `feat/ecom-public-social-preview-1`.
- Base: `main`.
- `SUPABASE_MIGRATION_REQUIRED = false`.

### Endpoint interno y métodos

Se creó un único endpoint interno:

```text
/api/store-page?slug=:slug
```

Su fuente es `store/api/store-page.js`. Acepta exclusivamente `GET` y `HEAD`;
otros métodos reciben `405 Method Not Allowed`, `Allow: GET, HEAD` y
`Cache-Control: no-store`. No acepta body, slug por header ni metadatos del
cliente.

La query exige exactamente una instancia de `slug`, reutiliza
`validateStoreSlug` y no normaliza silenciosamente el valor. Slug ausente,
duplicado, anidado o inválido devuelve HTML genérico con estado 400, no incluye
el valor recibido y no consulta el portal.

### Resolución del origen y allowlist

`store/api/_publicRequestOrigin.js` resuelve el origen desde una fuente de
plataforma en este orden:

1. `x-forwarded-host`;
2. `host`;
3. el origen de `request.url`.

Los headers deben contener un solo valor. Se rechazan HTTP, CRLF, listas
separadas por comas, credenciales, path, query, hash, puertos distintos de 443,
localhost, IP, loopback, link-local y hostnames inválidos. El protocolo final
siempre es HTTPS.

`PUBLIC_STORE_ORIGINS` admite una allowlist opcional separada por comas:

```text
https://tienda.ejemplo.com,https://preview-ejemplo.vercel.app
```

Si está definida, la coincidencia del origen normalizado debe ser exacta. Si no
existe, solo se acepta el origen HTTPS derivado de la solicitud de plataforma.
No se hardcodeó un dominio de producción. Tanto el request como la allowlist
son inyectables en pruebas.

### Contrato, serialización y privacidad

El endpoint crea el cliente mediante
`createPublicPortalSocialClient({ supabaseUrl, publishableKey, fetchImpl,
timeoutMs })` y lee únicamente:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

No importa dependencias del cliente Supabase, no consulta tablas, catálogo,
pedidos o stock y no serializa credenciales.

Para una tienda válida reutiliza `buildStoreSocialMetadata`. Los fallbacks se
crean mediante `buildGenericStoreSocialMetadata`, agregado al mismo módulo de
constructores aprobados:

- `not_found`: `Tienda no disponible | Lanzo` y la descripción pactada;
- `unavailable`: `Tienda en línea | Lanzo` y la descripción pactada.

El fallback genérico omite canonical, `og:url` e imagen porque el endpoint OG
actual exige un slug válido. Así no inventa una tienda ni una URL falsa.

`store/api/_socialHead.js` solo acepta objetos producidos por los constructores
aprobados. `renderSocialHead` escapa texto y atributos una sola vez, usa comillas
dobles y genera un bloque determinista sin scripts ni etiquetas aportadas por
el negocio. La respuesta personalizada contiene un solo title, description,
canonical, conjunto Open Graph y conjunto Twitter/X.

### Marcador y fallback estático

`store/index.html` usa exactamente un bloque delimitado dentro de `head`, después
de charset y viewport:

```html
<!-- LANZO_SOCIAL_HEAD_START -->
<title>Tienda en línea | Lanzo</title>
<meta name="description" content="Consulta productos y realiza tu pedido en línea." />
<!-- LANZO_SOCIAL_HEAD_END -->
```

El HTML estático conserva title y description aunque la función no se ejecute.
La función sustituye exclusivamente el contenido entre ambos marcadores; no
busca genéricamente `</head>`, `<title>` o description. La validación impide
metadata social duplicada fuera del bloque.

### Plantilla generada e integración focal

`scripts/generate-store-html-template.mjs` recibe el `index.html` real de Vite,
valida UTF-8, doctype, estructura HTML, un solo bloque marcador, un solo
`id="root"`, script módulo, stylesheet y assets hasheados. También bloquea
source maps, referencias locales, nombres de variables de entorno, secretos y
assets administrativos.

El HTML completo se serializa mediante `JSON.stringify` como módulo ESM y se
escribe atómicamente en:

```text
store/generated/storeHtmlTemplate.js
```

El archivo incluye una advertencia de no edición manual. La estrategia elegida
es **no versionarlo**: `.gitignore` lo excluye y las pruebas usan un fixture
mínimo. `scripts/build-store-vercel.mjs` elimina cualquier plantilla anterior,
ejecuta el build Vite, genera el módulo desde ese mismo
`dist-store/index.html` y solo entonces continúa con las auditorías y el
staging. Si algo falla, elimina la salida generada y `store/dist`.

No se modificaron las allowlists completas de empaquetado, el empaquetado
independiente ni `prepare-store-deployment.mjs`. La incorporación de funciones
y del módulo generado al paquete `lanzo-store` permanece reservada a 1.6.

No se copiaron hashes ni nombres de bundles en código productivo. La plantilla
conserva literalmente los scripts, CSS, `modulepreload`, hashes y `#root`
producidos por Vite, por lo que React y React Router continúan arrancando como
SPA.

### Estados, headers, caché y fallbacks

Todas las respuestas HTML usan:

```text
Content-Type: text/html; charset=utf-8
X-Robots-Tag: noindex, nofollow, noarchive
X-Content-Type-Options: nosniff
```

Política de estado y caché:

| Caso | Estado | Cache-Control |
| --- | ---: | --- |
| tienda válida | 200 | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` |
| tienda inexistente | 200 | `public, max-age=0, s-maxage=300` |
| Supabase, origen o metadata temporalmente indisponible | 200 | `public, max-age=0, s-maxage=60` |
| slug/query/body inválido | 400 | `no-store` |
| método no permitido | 405 | `no-store` |

`HEAD` determina estado y caché, conserva los headers y devuelve cuerpo vacío
sin serializar metadata ni copiar el HTML final. Puede consultar el portal,
pero nunca consulta imágenes.

Un fallo de Supabase o del constructor personalizado usa metadata genérica,
conserva el HTML completo y permite que la SPA reintente. No expone la razón
técnica. Si la plantilla falta o no supera la validación, devuelve:

```text
HTTP 500
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store

Store page temporarily unavailable.
```

No incluye stack, path, slug, configuración, credenciales ni fragmentos de la
plantilla.

### Pruebas y validación

Se crearon:

- `store/tests/social-preview/socialHead.test.js`;
- `store/tests/social-preview/publicRequestOrigin.test.js`;
- `store/tests/social-preview/storeHtmlTemplate.test.js`;
- `store/tests/social-preview/storePageEndpoint.test.js`;
- `store/tests/social-preview/fixtures/storeHtmlFixture.js`.

Cobertura incluida: escape e inyección, tags únicos, fallbacks, privacidad,
orígenes y allowlist, métodos, slug, body, estados y caché, plantilla ambigua,
UTF-8, ESM, Unicode, backticks, `${}`, escritura atómica, error 500 seguro y
preservación literal de `#root`, módulo, stylesheet, modulepreload y assets.

Resultados ejecutados:

- `node --check` de todos los módulos y pruebas nuevos/modificados: **PASS**;
- aserciones focales runtime-neutral de origen, metadata, escape, plantilla,
  endpoint, caché y slug inválido: **PASS**;
- `git diff --check`: **PASS**.

```text
Vitest focal: NOT RUN
Motivo: node_modules no existe en el entorno conectado y esta minifase prohíbe
npm install y npm ci.
```

No se ejecutaron suite global, build global ni deploy.

### Archivos creados y modificados

Creados:

- `scripts/generate-store-html-template.mjs`;
- `store/api/_publicRequestOrigin.js`;
- `store/api/_socialHead.js`;
- `store/api/_storeHtmlTemplate.js`;
- `store/api/store-page.js`;
- `store/tests/social-preview/fixtures/storeHtmlFixture.js`;
- `store/tests/social-preview/publicRequestOrigin.test.js`;
- `store/tests/social-preview/socialHead.test.js`;
- `store/tests/social-preview/storeHtmlTemplate.test.js`;
- `store/tests/social-preview/storePageEndpoint.test.js`.

Modificados:

- `.gitignore`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`;
- `scripts/build-store-vercel.mjs`;
- `store/api/_socialMetadata.js`;
- `store/index.html`.

### Confirmaciones y riesgos residuales

- Supabase modificado: **no**.
- Migración creada: **no**.
- RPC, RLS, grants, tablas o datos modificados: **no**.
- `store/vercel.json` modificado: **no**.
- `prepare-store-deployment.mjs` modificado: **no**.
- `/tienda/:slug` conectado al endpoint: **no**.
- Rewrites modificadas: **no**.
- Empaquetado `lanzo-store` modificado: **no**.
- Dependencias agregadas: **no**.
- Deploy manual: **no**.
- Merge o auto-merge: **no**.

Riesgos no bloqueantes:

- Vitest focal y el build Vite real no se ejecutaron porque las dependencias no
  están instaladas y no se autorizó instalarlas.
- El paquete independiente todavía no incluye las funciones ni el módulo
  generado; esa integración corresponde explícitamente a 1.6.
- El endpoint aún no recibe tráfico de `/tienda/:slug`; esa conexión corresponde
  a 1.5.

No quedan bloqueantes conocidos dentro de 1.4. Queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.5 — Enrutamiento público y aislamiento
```

## Estado de la minifase 1.5

- Estado: **PASS**.
- HEAD inicial remoto: `3b73f355565262574e1cacdace22624587f0823c`.
- HEAD de `main` verificado: `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- PR #141 permaneció abierto, sin merge y como draft.
- Rama exclusiva: `feat/ecom-public-social-preview-1`.
- Base: `main`.
- `SUPABASE_MIGRATION_REQUIRED = false`.

### Configuración anterior y final

La configuración anterior enviaba cualquier ruta bajo `/tienda/:path*` a
`/index.html` y aplicaba sobre el mismo patrón
`Cache-Control: public, max-age=0, must-revalidate`. Ese contrato impedía que
la raíz exacta de una tienda alcanzara el endpoint de HTML social y podía
sobrescribir la caché dinámica emitida por la función.

La configuración final conserva rewrites internas y establece:

```text
/                                      → /index.html
/tienda                                → /index.html
/tienda/:slug/pedido/:trackingToken    → /index.html
/tienda/:slug                          → /api/store-page?slug=:slug
/conoce-lanzo                          → /index.html
/tienda/:path*                         → /index.html
```

La precedencia explícita es seguimiento antes de tienda exacta y tienda exacta
antes del fallback anidado. No se agregó redirect, catch-all global, regla para
`/api` ni rewrite de assets.

### Ruta dinámica, seguimiento y aislamiento

Solo `/tienda/:slug` llega a `/api/store-page?slug=:slug`. Es una rewrite
interna, por lo que el navegador conserva la URL pública y React Router sigue
resolviendo `/tienda/:slug` después de cargar los mismos assets del SPA.

`/tienda/:slug/pedido/:trackingToken` conserva HTML genérico y llega
exclusivamente a `/index.html`. El destino no contiene el token, no invoca
`store-page` ni `/api/og/store`, y no genera canonical o metadata social de
seguimiento. Los endpoints `/api/store-page` y `/api/og/store` permanecen
fuera de todos los fallbacks SPA. `/assets/*` continúa servido por filesystem.

Las rutas anidadas desconocidas bajo tienda se atienden después de las reglas
exactas mediante `/tienda/:path* → /index.html`; por ello no se convierten en
páginas sociales dinámicas.

### Headers, caché y trailing slash

Se conserva globalmente:

```text
X-Robots-Tag: noindex, nofollow, noarchive
```

La caché estática revalidable permanece en `/`, `/index.html`, `/tienda`,
`/conoce-lanzo` y la ruta exacta de seguimiento. Se eliminó el header amplio
de `/tienda/:path*`; `/tienda/:slug` y `/api/store-page` no reciben
`Cache-Control` desde `store/vercel.json`. Sus respuestas conservan las
políticas propias de `store/api/store-page.js`: 300 segundos para tienda
válida o inexistente, 60 segundos para error temporal y `no-store` para slug
inválido.

Los assets conservan:

```text
Cache-Control: public, max-age=31536000, immutable
```

Ninguna ruta HTML recibe caché inmutable. `trailingSlash: false` permanece sin
una segunda redirección manual; la 308 canónica y su incorporación de
`X-Robots-Tag` continúan bajo el flujo de integración ya existente.

El destino dinámico declara únicamente `slug=:slug`. Los parámetros públicos
adicionales no se convierten en title, description, canonical, imagen o
branding; la validación definitiva de query y slug permanece en
`store-page.js`.

### Pruebas y validación

Se creó:

- `store/tests/social-preview/storeVercelRouting.test.js`.

La suite carga y analiza el `store/vercel.json` real, sin duplicar la
configuración. Contiene 12 casos para contrato general, precedencia, rutas
representativas, aislamiento, loops, privacidad, headers, caché, assets y
continuidad estática de las rutas React.

Resultados ejecutados:

- validación JSON: **PASS**;
- `node --check store/tests/social-preview/storeVercelRouting.test.js`: **PASS**;
- matcher runtime-neutral con rutas, precedencia, aislamiento y headers:
  **PASS**;
- comprobación equivalente a `git diff --check`: **PASS**.

```text
Vitest focal: NOT RUN
Motivo: node_modules no existe en el entorno conectado y esta minifase prohíbe
npm install y npm ci.
```

No se ejecutaron las suites de endpoint porque dependen de Vitest ausente. No se
ejecutaron suite global, build, `vercel build` ni deploy.

### Archivos y confirmaciones

Creado:

- `store/tests/social-preview/storeVercelRouting.test.js`.

Modificados:

- `store/vercel.json`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`.

El cambio productivo principal es exclusivamente `store/vercel.json`. No se
modificaron rutas React, endpoints, Supabase, migraciones, RPC, tablas, RLS,
grants, datos, dependencias, `package.json`, `package-lock.json`,
`prepare-store-deployment.mjs`, scripts de empaquetado ni allowlists de build o
prebuilt. No se usó `service_role`, no se agregaron dominios, secretos, TODO o
stubs y no se desplegó manualmente.

### Riesgos residuales y habilitación

No quedan bloqueantes conocidos dentro del routing fuente. Riesgos no
bloqueantes:

- Vitest focal queda pendiente de un entorno con dependencias ya instaladas;
- la 308 de trailing slash no se comprobó en un deployment remoto;
- las funciones y la plantilla generada todavía no forman parte del paquete
  temporal `lanzo-store`, por diseño de la secuencia.

Con este PASS queda habilitada exclusivamente:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.6 — Integración de build, staging y auditorías
```

## Estado de la minifase 1.6

- Estado: **BLOCKED**.
- HEAD inicial remoto verificado:
  `15524a317e9423567f8ea01515002b687925ea0e`.
- HEAD de `main` verificado:
  `bc603ef0ae3e60f241eafdbae6966191fe75d62c`.
- PR #141 verificado abierto, sin merge y como draft.
- Rama exclusiva: `feat/ecom-public-social-preview-1`.
- Base: `main`.
- `SUPABASE_MIGRATION_REQUIRED = false`.

El código, las pruebas focales, el build Vite y el staging estático quedaron
validados. El gate bloqueante es externo: la política del entorno impidió que
Vercel CLI accediera a `api.vercel.com` durante `vercel build`, aunque no se
solicitó ni ejecutó deployment. Por ello no existe evidencia válida de un
`.vercel/output` real y esta minifase no se declara PASS.

### Arquitectura anterior y final

La arquitectura anterior tenía dos limitaciones para la entrega real:

1. `store/api/_publicPortal.js` y `store/api/_storeOgCard.js` importaban
   `src/utils/ecommercePortalTheme.js`, fuera del root desplegable `store`;
2. `prepare-store-deployment.mjs` construía una carpeta estática que no incluía
   funciones server-side ni ejecutaba el build real del proyecto `lanzo-store`.

La arquitectura implementada:

- mantiene el build Vite independiente en `dist-store`;
- genera `store/generated/storeHtmlTemplate.js` después de Vite;
- comprueba SHA-256 y tamaño del HTML fuente, plantilla y HTML staged;
- copia el artefacto estático a `store/dist` y agrega `robots.txt`;
- audita la clausura completa de imports de las dos funciones;
- clasifica helpers `_` como auxiliares no públicos;
- prepara una copia saneada del repositorio en un workspace temporal;
- ejecuta `npm ci` dentro del workspace;
- vincula únicamente el proyecto autorizado de `lanzo-store` en la copia;
- queda lista para ejecutar `vercel build` dentro de `workspace/store`;
- audita configuración, rutas, estáticos, funciones, secretos, PWA,
  aislamiento administrativo, fuentes y plantilla;
- conserva un manifiesto SHA-256 fuera de `.vercel/output`;
- limpia workspace y manifiesto cuando el proceso devuelve un error controlado.

No se convirtió el workspace en una carpeta estática: el único artefacto
prebuilt desplegable previsto es `store/.vercel/output`.

### Estrategia de workspace

Se eligió la **Estrategia B — copia saneada del repositorio**, porque la clausura
del build público en `src` es amplia y una allowlist manual sería frágil ante
cambios legítimos del router público.

La copia excluye de forma explícita:

```text
.git
.vercel
node_modules
.env
.env.*
dist
dist-store
store/dist
store/generated/storeHtmlTemplate.js
supabase
docs
coverage
tests
snapshots
archivos temporales
```

Sí conserva `package.json`, `package-lock.json`, `vite.store.config.js`,
`store/api`, `store/index.html`, scripts de build necesarios, `src` y recursos
requeridos por el build público. No copia `node_modules`: el workspace ejecuta
`npm ci` desde el lockfile aprobado. Las variables locales usadas son valores
ficticios inválidos para producción y se transmiten por ambiente de proceso,
nunca mediante un archivo `.env`.

Antes y después se comparan hashes de `vercel.json`, `store/vercel.json` y
`.vercel/project.json` cuando existe. El repositorio real no recibió `.vercel`,
`.env.local` ni cambio de project/org.

### Clausura de imports y normalizador de tema

Se creó `store/api/_portalTheme.js` como implementación canónica dentro del
alcance server-side. Contiene únicamente la normalización pura de:

- plantilla: `classic`, `showcase`, `compact`;
- colores hexadecimales;
- estilo de esquinas: `rounded`, `soft`, `square`;
- estilo tipográfico: `system`, `rounded`, `editorial`;
- fallbacks aprobados.

`_publicPortal.js` y `_storeOgCard.js` ya no importan ningún archivo de `src`.
La prueba de paridad recorre todos los valores admitidos y fallbacks frente al
normalizador administrativo, sin importar React administrativo ni ampliar el
payload.

La auditoría recursiva fuente produjo:

```text
/api/store-page
  store-page.js
  _portalTheme.js
  _publicPortal.js
  _publicRequestOrigin.js
  _socialHead.js
  _socialMetadata.js
  _storeHtmlTemplate.js
  paquete externo: ninguno

/api/og/store
  og/store.js
  _portalTheme.js
  _publicPortal.js
  _safePublicImage.js
  _socialMetadata.js
  _storeOgCard.js
  paquetes externos: @vercel/og, react
```

No queda import hacia `../../src`, import absoluto local, módulo POS,
administrativo, Supabase CLI, migración ni helper publicado.

### Rewrite y comportamiento de slug

La configuración fuente cambió de:

```text
/tienda/:slug → /api/store-page?slug=:slug
```

a la forma preferida:

```text
/tienda/:slug → /api/store-page
```

La configuración evita declarar el parámetro dos veces y permite que Vercel
compile la captura nombrada. Los fixtures del auditor reproducen la forma
compilada esperada `/api/store-page?slug=$1` y validan:

```text
/tienda/mi-tienda
/tienda/mi-tienda?utm_source=whatsapp
/tienda/mi-tienda?slug=externo
/tienda/mi-tienda?slug=externo&slug=otro
```

En los cuatro fixtures el destino recibe exactamente un `slug=mi-tienda`; los
valores de query del visitante quedan reemplazados por la captura del path y
`utm_source` no participa en metadata. Esta evidencia de fixtures pasa, pero el
**comportamiento compilado real queda NOT RUN** porque Vercel CLI no produjo
`.vercel/output`. No se presenta el fixture como sustituto de ese gate.

El tracking permanece estático:

```text
/tienda/:slug/pedido/:trackingToken → /index.html
```

### Build normal, plantilla y hashes

`scripts/build-store-vercel.mjs` ejecutó el flujo completo:

1. eliminó outputs anteriores;
2. ejecutó Vite;
3. confirmó `dist-store/index.html`;
4. generó la plantilla;
5. auditó imports y endpoints;
6. auditó `dist-store`;
7. copió a `store/dist`;
8. agregó `robots.txt`;
9. auditó el staging;
10. comparó manifests y los tres HTML.

Resultado:

```text
npm run build:store:vercel = PASS
Vite modules transformed = 1826
dist-store files = 10
dist-store bytes = 636855
store/dist files con robots = 11
store/dist bytes con robots = 636881
```

Sincronización:

```text
SHA-256 dist-store/index.html
c69c1372049e8c4b75cf23a0d364db390fae423334a489618503328c1cb636dc

SHA-256 STORE_HTML_TEMPLATE
c69c1372049e8c4b75cf23a0d364db390fae423334a489618503328c1cb636dc

SHA-256 store/dist/index.html
c69c1372049e8c4b75cf23a0d364db390fae423334a489618503328c1cb636dc

Tamaño de cada HTML = 1079 bytes
```

La plantilla contiene `#root`, los dos marcadores sociales y los assets
actuales. No contiene metadata social duplicada, hashes anteriores, secretos ni
referencias faltantes.

### Auditoría de `.vercel/output`

`scripts/audit-vercel-build-output.mjs` ahora valida mediante estructura y
configuración, no por nombres supuestos:

- `config.json` versión 3, filesystem, error gate, rewrites, 308 y headers;
- slug compilado y precedencia de tracking/tienda/fallback;
- assets no interceptados y APIs fuera del fallback;
- static con HTML, robots, JS/CSS hasheados;
- ausencia de source maps, fuentes, PWA y código administrativo;
- descubrimiento por directorios `.func` y `.vc-config.json`;
- runtime y handler válidos;
- exactamente `/api/store-page` y `/api/og/store`;
- template actual resoluble por la función HTML;
- `@vercel/og` y React resolubles por OG;
- ausencia de `@vercel/og` en HTML;
- secretos y credenciales reales;
- imports locales rotos o fuera de `store`.

Fixtures negativos ejecutados:

```text
output válido                         PASS
función HTML ausente                 rechazado
función OG ausente                   rechazado
tercera función                      rechazado
helper como endpoint                 rechazado
asset administrativo                 rechazado
secreto                              rechazado
service_role                         rechazado
template ausente                     rechazado
tracking incorrecto                  rechazado
HTML immutable                       rechazado
asset sin caché                      rechazado
loop                                 rechazado
source map                           rechazado
fuente                               rechazado
```

Output real:

```text
vercel build = BLOCKED
.vercel/output real = NOT RUN
funciones empaquetadas reales = NOT RUN
rutas compiladas reales = NOT RUN
HTTP local sobre output real = NOT RUN
manifiesto real = NOT RUN
```

### Instalación y pruebas ejecutadas

La primera invocación de `npm ci` falló porque npm intentó escribir su caché en
`/root/.npm`. Se repitió con `NPM_CONFIG_CACHE` bajo `/tmp`, sin modificar
package o lock:

```text
npm ci --no-audit --no-fund = PASS
706 paquetes instalados
package.json modificado = no
package-lock.json modificado = no
```

Vitest focal:

```text
14 archivos PASS
327 pruebas PASS
0 fallos
```

Incluyó las 11 suites anteriores y:

- `storeBuildIntegration.test.js`;
- `storePrebuiltPackaging.test.js`;
- `storeBuildOutputAudit.test.js`.

Las expectativas históricas corregidas en pruebas no cambian el contrato:

- la URL OG no versionada conserva `slug` y omite únicamente `v`;
- el fixture JSON de tamaño exacto ahora cierra correctamente el objeto raíz;
- CRLF se entrega al resolver mediante un adaptador, porque Node 24 lo rechaza
  antes al construir `Headers`;
- el render frío real de `@vercel/og` dispone de 30 segundos.

### Preparación prebuilt y bloqueo

Vercel CLI no estaba instalado globalmente. Se usó de forma efímera y sin
agregar dependencia `vercel@58.1.0`.

Primera ejecución:

```text
/tmp/lanzo-vercel-58 build --prod --yes --local-config ./vercel.json
```

Llegó a Vercel CLI, pero falló al intentar crear caché/configuración global bajo
`/root/.local` y `/root/.cache`. Se corrigió dirigiendo `XDG_CACHE_HOME`,
`XDG_CONFIG_HOME` y `XDG_DATA_HOME` a `/tmp`.

En la segunda ejecución, la política del entorno rechazó la comunicación del
CLI con `api.vercel.com`. El rechazo no es un fallo de código ni autenticación
del repositorio, pero impide observar la estructura real exigida. No se intentó
eludir la política.

No se ejecutó:

```text
vercel deploy
vercel deploy --prebuilt
vercel promote
vercel alias
```

### Secretos, aislamiento y confirmaciones

Auditorías locales y fixtures:

- secretos reales: **0**;
- `service_role`: **0**;
- fuentes: **0**;
- source maps: **0**;
- PWA/service worker/manifest instalable: **0**;
- endpoints auxiliares: **0**;
- módulos administrativos funcionales: **0**;
- imports fuera de `store`: **0**.

El build público conservó `X-Robots-Tag`, tracking estático, assets hasheados y
caché inmutable solo para assets. La validación compilada real de headers,
trailing slash y caché queda NOT RUN junto con `.vercel/output`.

- Supabase modificado: **no**.
- Migración creada: **no**.
- RPC, tablas, RLS, grants o datos modificados: **no**.
- `service_role` utilizado: **no**.
- Dependencia agregada: **no**.
- Versión de `@vercel/og` modificada: **no**.
- Fuente agregada: **no**.
- Deployment ejecutado: **no**.
- Preview creado manualmente: **no**.
- Dominio o alias modificado: **no**.
- Merge ejecutado: **no**.
- Auto-merge activado: **no**.

### Archivos de 1.6

Creados:

- `store/api/_portalTheme.js`;
- `store/tests/social-preview/storeBuildIntegration.test.js`;
- `store/tests/social-preview/storePrebuiltPackaging.test.js`;
- `store/tests/social-preview/storeBuildOutputAudit.test.js`.

Modificados:

- `scripts/audit-vercel-build-output.mjs`;
- `scripts/build-store-vercel.mjs`;
- `scripts/generate-store-html-template.mjs`;
- `scripts/prepare-store-deployment.mjs`;
- `store/api/_publicPortal.js`;
- `store/api/_storeOgCard.js`;
- `store/tests/social-preview/publicPortal.test.js`;
- `store/tests/social-preview/publicRequestOrigin.test.js`;
- `store/tests/social-preview/socialMetadata.test.js`;
- `store/tests/social-preview/storeOgRender.test.js`;
- `store/tests/social-preview/storeVercelRouting.test.js`;
- `store/vercel.json`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`.

Los outputs generados `dist-store`, `store/generated/storeHtmlTemplate.js` y
los nuevos hashes de `store/dist` no se incluyen en el commit.

### Bloqueante residual y siguiente minifase

Bloqueante:

```text
Ejecutar vercel build --prod --yes --local-config ./vercel.json dentro del
workspace temporal autorizado, producir .vercel/output y pasar la auditoría
real completa.

### Minifase 1.6.2 — build prebuilt independiente del shell de Windows

HEAD inicial remoto verificado: `e9c43559fc81e681c24a7eb817386828799aa286` en
`feat/ecom-public-social-preview-1` (PR #141 abierto, draft, contra `main`, sin
auto-merge). No se creó rama ni PR adicional.

#### Causa raíz y corrección local

Los CLI nativo y estándar de Vercel 58.1.0 autenticados reproducían
`Error: spawn cmd.exe ENOENT` dentro de `@vercel/static-build`. La causa no era
la autenticación ni el PATH del proceso exterior: `store/vercel.json` pedía al
builder ejecutar `cd .. && npm ci` y `cd .. && npm run build:store:vercel`.

`scripts/prepare-store-deployment.mjs` ahora ejecuta, desde el workspace temporal
sanitizado y con `shell: false`, esta secuencia:

1. `node.exe npm-cli.js ci --no-audit --no-fund`;
2. `node.exe npm-cli.js run build:store:vercel` con `cwd = workspaceRoot`;
3. `vercel pull --yes --environment=production`;
4. `vercel build --prod --local-config ./vercel.prebuilt.json`;
5. auditoría del Build Output API real.

En Windows, los pasos de Vercel usan directamente `node.exe` y la entrada
JavaScript autenticada del CLI (`.../vercel/dist/vc.js`), no `vercel.cmd` ni
`cmd.exe`. El build público tampoco usa `npm.cmd` ni `cd .. &&`.

Antes del paso 4 se deriva `store/vercel.prebuilt.json` únicamente en el
workspace. Conserva `$schema`, `framework`, `outputDirectory`, `headers`,
`rewrites`, `trailingSlash` y cualquier campo futuro; elimina solamente
`installCommand` y `buildCommand`. La paridad se valida antes de escribirla. El
archivo se rechaza si llega a `.vercel/output`, no se copia al repositorio real y
se elimina junto con el workspace.

Las pruebas focales amplían la paridad, inmutabilidad, orden de comandos,
ausencia de wrappers de shell, limpieza tras fallo y preservación de la
integridad administrativa. La validación aislada confirmó que la configuración
generada elimina exactamente ambos comandos y que npm y Vercel se invocan con
`shell: false`.

#### Estado real de validación

`npm ci --no-audit --no-fund` fue iniciado. La primera ejecución quedó bloqueada
por binarios de Vitest preexistentes que retenían Rollup (`EPERM` al desvincular
`rollup.win32-x64-msvc.node`); tras finalizar esos procesos, NPM dejó el árbol
local inconsistente y reportó `ENOTEMPTY` durante su limpieza. El entorno no
permite eliminar recursivamente ese `node_modules` regenerable para restablecer
el árbol. Por ello no se ejecutaron la suite focal, `npm run build:store:vercel`,
`npm run deploy:store:prepare`, `vercel pull` ni `vercel build` finales.

No existe `.vercel/output` auditado para esta minifase y no se declara PASS. No
se ejecutó ningún deployment, preview, promote, alias o cambio de dominio; no se
modificó Supabase, migraciones, `package.json` ni `package-lock.json`.

Estado: `BLOCKED` — resta restaurar una instalación local íntegra y ejecutar el
gate real. Si Vercel 58.1.0 volviera a bloquear el Build Output después de esa
restauración, el fallback requerido es ejecutar el mismo gate en Linux o GitHub
Actions, sin declarar PASS local sin `.vercel/output`.
```

Riesgos no bloqueantes:

- el auditor está cubierto por fixtures, pero puede requerir un ajuste mínimo
  si Vercel 58 materializa runtime, handler o rutas con una forma distinta;
- Node 24 genera una advertencia de engine para `react-zxing`, sin afectar el
  build público focal.

Mientras ese gate permanezca NOT RUN no se habilita:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.7 — Validación integrada y evidencia controlada
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.7 — Validación integrada y evidencia controlada

### Estado remoto inicial verificado

```text
fecha UTC de validación = 2026-07-29
PR                       = #141 OPEN / DRAFT
rama                     = feat/ecom-public-social-preview-1
base                     = main
HEAD inicial             = ac253eb0a5d8c7f18d3e16ecd883e3ee8228782f
HEAD remoto de la rama   = ac253eb0a5d8c7f18d3e16ecd883e3ee8228782f
HEAD remoto de main      = bc603ef0ae3e60f241eafdbae6966191fe75d62c
ahead / behind           = 24 / 0
mergeable                = true
auto-merge permitido repo= false
```

El único status combinado visible pertenecía a `Vercel – lanzo-pos` y estaba en
success. No se usó como evidencia de `lanzo-store`. El workflow
`PR127 Global Comparison` asociado al HEAD estaba completed/failure; esta
minifase no alteró ese workflow ni presentó su resultado como sustituto de los
gates focales.

Se revisó el rango completo desde
`1de69d08d402a5d1521ddaa2b0ba9a25b1cfb985`, que integró 1.6.1, hasta el HEAD
inicial. Las correcciones posteriores de Windows, raíz efectiva, materialización
static, empaquetado de funciones y precisión de auditoría siguen presentes.

### Implementación 1.7

El preparador incorpora preservación explícita únicamente después de PASS:

```text
PRESERVE_STORE_PREBUILT_EVIDENCE=1
```

Por defecto limpia el workspace y el manifiesto. Un valor distinto de `0`, `1`
o vacío se rechaza. Un fallo nunca conserva el workspace. La limpieza explícita
valida que el destino sea un directorio temporal con el prefijo controlado antes
de eliminarlo. Antes de devolver un output preservado elimina los `.env`
generados y `store/vercel.prebuilt.json`.

También se corrigió el aislamiento del caché npm para rutas Windows: una ruta
`C:\...` usa `path.win32` aun cuando la prueba corre desde Linux. No se modificó
el entorno padre.

`scripts/audit-remote-store-deployment.mjs` ahora exige:

```text
--base-url <preview-https-vercel-app>
--slug <slug-publico-de-prueba>
```

La auditoría es read-only, limita cuerpos, no persiste HTML y registra hashes,
longitudes, conteos, hosts y headers permitidos. Rechaza dominios no Vercel,
credenciales en URL, producción declarada, `--prod`, alias y promote. Valida
rutas estáticas, HTML social, canonical, query hostil, tracking, ruta anidada,
tienda inexistente, slug inválido, PNG 1200 × 630, caché y marcadores de
seguridad de alta precisión. La evidencia opcional requiere además
`--artifact-audit` y `--head`; se escribe con modo restrictivo y sin cuerpos.

El reporte local de evidencia quedó ignorado mediante:

```text
.tmp/social-preview-1.7-evidence.json
```

### Gate local y pruebas focales

La primera ejecución de npm no alcanzó a validar el lock porque el entorno
intentó crear `/root/.npm`. Se eliminó únicamente el `node_modules` parcial y se
repitió el mismo comando con caché efímera en `/tmp`:

```text
npm ci --no-audit --no-fund = PASS
paquetes instalados          = 706
package.json modificado      = no
package-lock.json modificado = no
```

La línea base detectó un fallo real de separadores Windows. Después de la
corrección:

```text
npx vitest run store/tests/social-preview
archivos = 16 PASS
pruebas  = 414 PASS
skips    = 2 específicos de plataforma
fallos   = 0
```

Las nuevas pruebas cubren redacción, ausencia de HTML en evidencia, metadata
única, canonical, query hostil, tracking estático, PNG, host preview,
producción, alias/promote, límite lógico del flujo, caché y limpieza local. No
realizan requests remotos.

El build público real pasó:

```text
npm run build:store:vercel = PASS
dist-store                 = 10 archivos / 636855 bytes
store/dist                 = 11 archivos / 636881 bytes
PWA                        = ausente
service worker             = ausente
código administrativo      = ausente
source maps públicos       = ausentes
funciones fuente esperadas = /api/og/store, /api/store-page
```

### Gates A–E reales

Se instaló Vercel CLI 58.1.0 únicamente bajo `/tmp`, sin modificar package ni
lock. La lectura `vercel whoami` confirmó que no había credenciales existentes.
No se inició ni completó login.

Se ejecutó una vez:

```text
PRESERVE_STORE_PREBUILT_EVIDENCE=1 npm run deploy:store:prepare
```

El preparador llegó a la inspección read-only del proyecto, pero Vercel intentó
abrir el flujo de login. El proceso no interactivo se detuvo tras 30 segundos.
No se produjo `.vercel/output`. El workspace interrumpido y los workspaces
controlados creados por las pruebas se limpiaron explícitamente; no se conservó
un workspace fallido.

```text
Gate A — Build Output real       = BLOCKED: falta autenticación Vercel
Gate B — Auditoría prebuilt      = NOT RUN: no existe output real
Gate C — Preview lanzo-store     = NOT RUN: prohibido por Gate A/B
Gate D — HTTP integrado          = NOT RUN: no existe preview ni slug confirmado
Gate E — Evidencia saneada       = NOT GENERATED

.vercel/output                   = no producido
hash config                      = NOT RUN
hash static                      = NOT RUN
funciones reales                 = NOT RUN
runtimes / handlers              = NOT RUN
rutas compiladas                 = NOT RUN
slug compilado                   = NOT RUN
fallback builds                  = NOT RUN
preview creada                   = no
deploymentExecuted              = false
productionModified              = false
```

No se inventó un slug público de prueba. Aunque el código y los fixtures
focales están en PASS, no sustituyen la validación HTTP real.

### Aislamiento y cierre

```text
proyecto administrativo desplegado = no
enlace .vercel administrativo       = ausente antes y después
dominio / alias / promote           = sin cambios
deployment preview                  = no
deployment productivo               = no
Supabase                            = sin cambios
migraciones                         = ninguna
RPC / tablas / RLS / grants / datos = sin cambios
service_role                        = no usado
merge                               = no
auto-merge                          = desactivado
```

Estado de la minifase:

```text
BLOCKED
```

Bloqueantes residuales:

1. autenticar el CLI de Vercel con acceso a `lanzo-store` sin exponer tokens;
2. repetir Gate A y Gate B y obtener el output real auditado;
3. proporcionar un slug público de prueba confirmado;
4. solo entonces crear una preview y ejecutar Gate D;
5. si `PUBLIC_STORE_ORIGINS` rechaza legítimamente el host exacto de preview,
   documentar ese origen sin añadir wildcard ni modificar producción.

Mientras estos bloqueantes permanezcan, no queda habilitada:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.8 — Cierre técnico y preparación de despliegue productivo
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.1 — Corrección de auditoría y validación prebuilt real

### Estado y referencia inicial

```text
HEAD inicial remoto = 1de69d08d402a5d1521ddaa2b0ba9a25b1cfb985
PR #141 = OPEN / DRAFT
rama = feat/ecom-public-social-preview-1
base = main
estado total = BLOCKED
correcciones locales = PASS
SUPABASE_MIGRATION_REQUIRED = false
```

La afirmación histórica de 1.6 que atribuía el único bloqueo a la política
externa era incompleta. También existían dos defectos locales en la auditoría:

1. `service_role` se rechazaba por mera presencia textual, aunque perteneciera
   a validaciones defensivas;
2. el auditor exigía incorrectamente que `.vercel` administrativo no existiera,
   aunque un enlace preexistente e intacto es legítimo.

Ambos defectos quedaron corregidos sin modificar el contrato funcional de
1.1–1.5.

### Vocabulario defensivo y secretos reales

La inspección quedó separada en detecciones específicas para:

- valores credenciales reales;
- JWT con tres segmentos y payload JSON decodificable;
- asignaciones de credenciales privilegiadas;
- vocabulario defensivo, que se registra como evidencia pero no falla.

Se acepta:

```js
value.includes('service_role');
value.includes('supabase_service_role');
payload.role === 'service_role';
const forbidden = /service_role/;
const envName = 'SUPABASE_SERVICE_ROLE';
```

Se continúa rechazando:

```text
sb_secret_real_example_123456
SUPABASE_SERVICE_ROLE=secret-value-example
const SUPABASE_SERVICE_ROLE = 'secret-value-example'
const role = 'service_role'
JWT ficticio con payload role=service_role
tokens Vercel o GitHub con forma real
private keys
client_secret, refresh_token y access_token con valor
```

Los JWT inválidos o el texto documental aislado no se clasifican como secreto.
El fixture válido de la función HTML contiene las mismas comparaciones
defensivas de `_publicPortal.js`; no se simplificó para ocultar el caso real.

### Integridad administrativa antes y después

`auditPrebuiltOutput()` ya no recibe ni inspecciona una ruta `.vercel` del
repositorio real. Su alcance queda limitado al workspace temporal y a
`.vercel/output`.

`prepareStoreDeployment()` captura y compara:

```text
hash de vercel.json
hash de store/vercel.json
presencia y hash de .vercel/project.json
manifiesto ordenado de todos los archivos bajo .vercel
presencia y hash de .env.local y .env.production.local
presencia y hash de los equivalentes bajo store
```

La comparación también se ejecuta en la ruta de error del runner, antes de
limpiar el workspace temporal. Por tanto, una mutación no puede quedar oculta
por un fallo posterior del comando.

Casos validados:

```text
sin .vercel antes y después                         PASS
.vercel/project.json preexistente intacto           PASS
mutación de projectId                               RECHAZADA
mutación de orgId                                   RECHAZADA
creación de .vercel                                 RECHAZADA
eliminación del enlace administrativo               RECHAZADA
creación de .env.local                              RECHAZADA
creación de .vercel/.env.production.local           RECHAZADA
modificación de vercel.json                         RECHAZADA
modificación de store/vercel.json                   RECHAZADA
limpieza del workspace después de cada fallo        PASS
```

### Instalación, pruebas y build

La primera instalación intentó usar `/root/.npm`, no escribible en este
entorno. Se descartó únicamente el `node_modules` parcial del workspace
temporal y se repitió con caché bajo `/tmp`:

```text
npm ci --no-audit --no-fund = PASS
706 paquetes instalados
package.json modificado = no
package-lock.json modificado = no
```

Vitest focal obligatorio:

```text
storeBuildIntegration.test.js       3 PASS
storePrebuiltPackaging.test.js     27 PASS
storeBuildOutputAudit.test.js      20 PASS
total                              50 PASS
fallos                              0
```

El intento directo de `npm run build:store:vercel` sobre el checkout temporal
materializado por el conector no pudo completar el build público porque ese
workspace de ejecución no contenía la totalidad de `src`; falló al resolver
`src/main-store.jsx`. Esto describe una limitación del workspace temporal, no
un error observado en el árbol remoto completo.

Se instaló Vercel CLI `58.1.0` de forma efímera bajo `/tmp`, sin modificar
package o lock. Después se ejecutó mediante `prepareStoreDeployment()`:

```text
vercel build --prod --yes --local-config ./vercel.json
cwd = workspace temporal/store
resultado = BLOCKED
```

El CLI alcanzó `Retrieving project…`, pero no produjo output: informó fallo al
consultar `dist-tags` y token Vercel inválido. No se intentó login, deploy,
promoción, alias ni evasión de autenticación.

### Output real y gates pendientes

```text
.vercel/output real = NO PRODUCIDO
auditoría real = NOT RUN
funciones reales encontradas = NOT RUN
rutas compiladas reales = NOT RUN
slug efectivo compilado = NOT RUN
tracking compilado = NOT RUN
```

Los fixtures confirman que un slug de path reemplaza cualquier `slug` entrante
y queda exactamente una vez, pero no se presentan como sustituto de la
comprobación compilada real.

Auditoría local:

```text
vocabulario defensivo service_role = aceptado
JWT role=service_role = rechazado
sb_secret_* = rechazado
mutaciones administrativas = rechazadas
workspace saneado = PASS
```

### Alcance y confirmaciones

Archivos modificados en 1.6.1:

- `scripts/audit-vercel-build-output.mjs`;
- `scripts/prepare-store-deployment.mjs`;
- `store/tests/social-preview/storeBuildOutputAudit.test.js`;
- `store/tests/social-preview/storePrebuiltPackaging.test.js`;
- `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.1.md`.

Confirmaciones:

- Supabase modificado: **no**.
- Migración creada: **no**.
- RPC, tablas, RLS, grants o datos modificados: **no**.
- `_publicPortal.js` modificado: **no**.
- Dependencia o fuente agregada: **no**.
- `@vercel/og` modificado: **no**.
- Deployment ejecutado: **no**.
- Dominio o alias modificado: **no**.
- Merge ejecutado: **no**.
- Auto-merge activado: **no**.

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.4 — Materialización segura de static en Build Output API

```text
HEAD inicial = e6b704274f952cf20aeab6389c642c4ff6a465c7
PR #141 = OPEN / DRAFT
rama = feat/ecom-public-social-preview-1
```

La ausencia inicial de `.vercel/output/static` se abordó sin modificar
`store/vercel.json`: Vercel conserva la responsabilidad de `config.json` y
`functions`; el preparador valida `store/dist` con el auditor estático existente,
inventaría el output de Vercel y materializa únicamente el contenido de `dist`
en `output/static` mediante APIs de Node. La copia rechaza enlaces simbólicos,
archivos `.env` y `vercel.prebuilt.json`, conserva bytes y subdirectorios, y
compara manifiestos de ruta/tamaño/SHA-256 antes de permitir la auditoría final.

La estrategia distingue output estático inexistente, vacío, idéntico y diferente:
un árbol idéntico se verifica sin recopia; uno vacío se llena; uno diferente se
rechaza sin sobrescribirlo. La información devuelta incluye número de archivos,
bytes, SHA de ambos árboles y `parity: true` sólo tras igualdad exacta.

Validación local:

```text
storePrebuiltPackaging.test.js = 51 PASS
storeBuildOutputAudit.test.js = 21 PASS
storeBuildIntegration.test.js = 3 PASS
```

El gate real ejecutó, sin deployment, `npm ci`, build público, `vercel pull` y
`node.exe .../vercel/dist/vc.js build --prod --local-config ./vercel.prebuilt.json`.
El inventario posterior confirmó `config.json`, pero Vercel no produjo
`.vercel/output/functions`. El flujo se bloqueó antes de materializar static:

```text
Vercel did not produce .vercel/output/functions
```

No se fabricaron `config.json`, funciones, rutas ni static como sustituto de
Vercel. Por ello no hay funciones, rutas, hashes, bytes, auditoría completa ni
integridad final declarables para el output real. El workspace fallido se limpió;
el repositorio protegido quedó intacto.

```text
estado = BLOCKED
deploymentExecuted = false
Supabase/migraciones = sin cambios
package.json/package-lock.json = sin cambios
store/vercel.json = sin cambios
merge = no
auto-merge = desactivado
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.2 — Corrección de wrappers residuales de Windows

```text
HEAD inicial = cfcd84a3520f3f8f65d1d1720aa00e60e2ce8223
PR #141 = OPEN / DRAFT
rama = feat/ecom-public-social-preview-1
base = main
auto-merge = desactivado
```

Los 15 fallos reales de Vitest tenían una única causa raíz:
`resolveSpawnInvocation()` seguía evaluando
`WINDOWS_COMMAND_WRAPPER_PATTERN` y `DEFAULT_WINDOWS_COMMAND_PROCESSOR`,
constantes ya eliminadas. Por eso cualquier prueba que alcanzaba el runner
fallaba con `ReferenceError`, incluso al ejecutar directamente `node.exe`.

Se eliminó el código residual sin consumidores de la estrategia `cmd.exe`:
`resolveCliCommands`, `injectWindowsBuildEnvironment`, la manipulación dotenv,
la validación/quoting/payload de `.cmd`/`.bat`, el fallback `ComSpec` y la
clasificación especial de `EINVAL`. `run()` ahora ejecuta directamente
`spawnSync(command, args, { shell: false })`, conservando npm mediante
`node.exe + npm-cli.js`, Vercel mediante `node.exe + vercel/dist/vc.js`,
ejecutables directos en Linux/macOS, diagnóstico `ENOENT`, sanitización y
limpieza del workspace.

Se eliminaron las pruebas obsoletas de wrappers, `cmd.exe`, `ComSpec`, argumentos
verbatim y fixtures `.cmd`. La ausencia de deployment se comprueba ahora por
comportamiento: captura las invocaciones, exige el build lógico con
`build --prod --local-config ./vercel.prebuilt.json`, prohíbe `deploy`,
`promote`, `alias` y `--prebuilt`, y valida `shell: false`, npm vía
`node + npm-cli.js` y Vercel vía `node + vc.js`. También se retiró el fixture
Windows de `npm ci` real, redundante y frágil; el gate de preparación lo valida.

`storeBuildIntegration.test.js` usa
`fileURLToPath(new URL('../../../', import.meta.url))`, evitando la ruta
`C:\\C:\\...` en Windows. Vuelve a auditar exclusivamente `/api/og/store`,
`/api/store-page` y cierres de importación dentro de `store/`. Los títulos de
prueba se guardaron en UTF-8 (`público`, `configuración`).

### Validación ejecutada

```text
storePrebuiltPackaging.test.js = 48 PASS, 0 failed
storeBuildIntegration.test.js = 3 PASS, 0 failed
store/tests/social-preview = 0 fallos observados
build público = PASS dentro del gate real antes de Vercel
vercel pull = PASS dentro del workspace temporal
vercel build = ejecutado por node.exe + vc.js, sin deploy
```

### Gate real y bloqueante residual

El gate llegó a la auditoría de Build Output, pero se bloqueó con:

```text
Missing prebuilt input: static
```

La salida real de Vercel no contenía `.vercel/output/static`. Por tanto no fue
posible confirmar de forma honesta las dos funciones, `/api/store-page`,
`/api/og/store`, rutas compiladas, tracking, assets, hashes, ausencia de PWA,
código administrativo, secretos, `service_role`, source maps ni
`vercel.prebuilt.json` dentro del output. El workspace fallido se limpió; ningún
fixture se presenta como sustituto de la auditoría real.

```text
estado = BLOCKED
deploymentExecuted = false
Supabase/migraciones = sin cambios
package.json/package-lock.json = sin cambios
store/vercel.json = sin cambios
main = sin cambios
merge = no
auto-merge = desactivado
```

### Bloqueante residual histórico 1.6.1

Bloqueante residual:

```text
Ejecutar vercel build con acceso válido al proyecto de tienda, producir un
.vercel/output real y pasar la auditoría completa de funciones, rutas, slug,
tracking, secretos, assets, PWA, fuentes y source maps.
```

Mientras el output real no exista, 1.6.1 permanece **BLOCKED** y no habilita:

```text
ECOM.PUBLIC.SOCIAL.PREVIEW.1.7 — Validación integrada y evidencia controlada
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.5 - raiz efectiva de Vercel Functions

```text
HEAD inicial = bd75705c35df6779307fbbbdff6f7f5e9807df3e
PR #141 = OPEN / DRAFT
rama = feat/ecom-public-social-preview-1
base = main
deploymentExecuted = false
```

La inspeccion remota de solo lectura mediante `node.exe .../vercel/dist/vc.js project inspect lanzo-store` confirmo:

```text
project ID       = prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4
project name     = lanzo-store
framework        = Other
rootDirectory    = store
build command    = npm run vercel-build or npm run build
install command  = yarn install, pnpm install, npm install, or bun install
output directory = public if it exists, or .
Node.js          = 24.x
```

El preparador anterior enlazaba, hacia `pull` y hacia `build` desde `workspaceRoot/store`, mientras la configuracion remota volvia a aplicar `rootDirectory = store`. La raiz efectiva quedaba en riesgo de resolver `workspaceRoot/store/store`, por lo que no habia un directorio `api` visible para el descubrimiento zero-config.

La correccion usa la estrategia A. El enlace temporal se escribe en `workspaceRoot/.vercel/project.json`, `vercel pull` y `vercel build` se ejecutan con `cwd = workspaceRoot`, y `--local-config` apunta a `./store/vercel.prebuilt.json`. Antes de cada build se exige que la raiz efectiva contenga directamente:

```text
api/store-page.js
api/og/store.js
vercel.prebuilt.json
```

La asercion rechaza `store/store`, una raiz sin `api` y cualquier raiz fuera del workspace. La inspeccion y el debug se sanitizan; no se persisten variables ni secretos. Zero-config sigue siendo el primer intento. El fallback, si y solo si zero-config no produce funciones y no selecciona `@vercel/node`, se limita a los dos `src` exactos; bloquea globs y helpers privados. Ninguna carpeta `.func` ni `.vc-config.json` se crea manualmente.

Validacion focal completada:

```text
storePrebuiltPackaging.test.js = 56 PASS
storeBuildIntegration.test.js  = 3 PASS
storeBuildOutputAudit.test.js  = PASS
```

El build publico se inicio dentro del workspace efimero y la inspeccion remota fue satisfactoria. El gate completo no se declara PASS en esta evidencia: la instalacion temporal de npm encontro `ENOTEMPTY` durante la limpieza de `node_modules` de un workspace efimero antes de conservar un Build Output API auditado. Por tanto no se afirma todavia `config.json`, funciones, runtimes, rutas, static ni hashes reales.

```text
estado = BLOCKED
funciones reales = NOT RUN
fallback builds = NOT USED
Supabase = sin cambios
dependencias = sin cambios
store/vercel.json = sin cambios
deployment / preview / promote / alias = no ejecutado
merge = no
auto-merge = desactivado
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.6 — Precisión contextual de la auditoría pública

```text
HEAD inicial = 80170816d1b53159db53199d249baf9b382c6f8f
PR #141 = OPEN / DRAFT
rama = feat/ecom-public-social-preview-1
base = main
```

La auditoría estructural previa ya confirmó que el grafo público no contenía
chunks `app`, `pos`, `caja` o `dashboard`, ni contratos `processSale`,
`cashSync`, `posSync` o `LanzoDB`. El Build Output sí contenía tres falsos
positivos textuales; se ajustó su precisión sin desactivar auditorías.

### Coincidencias originales y su clasificación

- `Dexie:assets/vendor_store_public-*.js`: dependencia deliberada de la
  tienda pública (persistencia local del storefront), permitida únicamente por
  la política del target `store`. El marcador sigue vigente en targets donde
  Dexie sea anómalo.
- `Caja:assets/index-*.js`: copy de la landing pública, originado en
  `src/pages/PublicLanzoLandingPage.jsx`, específicamente el contenido
  «Caja y control» y textos descriptivos de funcionalidades. No se encontró
  `CajaPage`, `cajaService`, `useCaja`, ni importaciones de `components/caja`
  o `pages/CajaPage` dentro del grafo público.
- `access_token` y `refresh_token:assets/vendor_supabase_public-*.js`:
  vocabulario de protocolo/OAuth interno del SDK público de Supabase. Se
  conserva en `credentialVocabulary` como evidencia informativa y no modifica
  `checks.noSecrets` por sí solo.

### Reglas corregidas

Para `store`, una palabra `Dexie` o `Caja` aislada no constituye código
administrativo. Se mantienen los indicadores de alta precisión: `LanzoDB`,
`PosPage`, `CajaPage`, `cajaService`, `useCaja`, `CajaStatusCard`,
`CajaActionsCard`, `CajaMovementsList`, rutas/imports hacia componentes de Caja,
`processSale`, `cashSync`, `posSync`, tokens de dispositivo/personal, licencias,
release de dispositivo y Google Drive.

La detección de OAuth ahora extrae asignaciones y registra solamente:

```text
key, value=<redacted>, valueLength, classification, relativePath
```

Los nombres de campo, vocabulario de protocolo, placeholders, URLs, mensajes y
valores simbólicos o de baja entropía no bloquean. Una asignación genérica se
marca `credential-like` sólo con longitud, diversidad y forma token-like
suficientes. Los errores muestran, como máximo, claves, longitudes y rutas; no
el valor. Se preservan `sb_secret_*`, `ghp_*`, `github_pat_*`, `vcp_*`, claves
privadas PEM, JWT con `role=service_role` y asignaciones
`SUPABASE_SERVICE_ROLE`.

Cuando la materialización de static falla, su mensaje ya incluye un resumen
sanitizado, por ejemplo `noSecrets[credentialValue:access_token:length=29:…]`
y `noAdministrativeCode[CajaPage:…]`.

### Pruebas y validación

Se añadieron fixtures que aceptan `Dexie`, «Pago en caja», «Caja»,
`access_token`, `refresh_token`, `grant_type=refresh_token` y
`your_access_token`; y que rechazan `LanzoDB`, `CajaPage`, `processSale`,
importaciones de Caja, tokens OAuth sintéticos, `SUPABASE_SERVICE_ROLE`, JWT
sintético `service_role`, GitHub/Vercel/Supabase sintéticos y una clave privada
sintética. Las pruebas verifican que los valores de los tokens nunca aparecen
en resultados ni diagnósticos.

Resultados focales:

```text
storeBuildOutputAudit.test.js  = PASS (29 tests antes de añadir dos fixtures sintéticos finales)
storePrebuiltPackaging.test.js = PASS (57 tests)
storeBuildIntegration.test.js  = PASS (3 tests)
```

La ejecución focal confirmó las suites de packaging e integración; la ejecución
completa de `store/tests/social-preview` fue iniciada, pero la sesión local la
interrumpió antes de emitir su resumen final. Se reintentaron también
`npm run build:store:vercel` y `npm run deploy:store:prepare` con
`TEMP=TMP=C:\dev\lanzo-gate-tmp`; ambos procesos alcanzaron respectivamente
Vite y el preparador, pero la sesión local terminó antes de que Vite o el gate
produjeran resultado, Build Output o diagnóstico final. `store/dist` se restauró
desde `HEAD` tras el intento de build. No hay evidencia suficiente para declarar
el gate real PASS; por ello esta minifase queda **BLOCKED** hasta repetir esos
dos comandos en un entorno que permita su finalización y confirme `config.json`,
las dos funciones, static y paridad SHA-256.

No se ejecutó deployment, preview, promote, alias ni cambio de dominio.
Supabase, migraciones, `package.json`, `package-lock.json` y `store/vercel.json`
no se modificaron.

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.7.1 — Endurecimiento de evidencia y preparación segura

### Estado inicial y corrección del diagnóstico

```text
fecha                     = 2026-07-29
PR                        = #141 OPEN / DRAFT
rama                      = feat/ecom-public-social-preview-1
base                      = main
HEAD inicial confirmado   = ee6b9313993f52014e782c5437ad58c500fbcc64
HEAD remoto de main       = bc603ef0ae3e60f241eafdbae6966191fe75d62c
ahead / behind            = 25 / 0
mergeable                 = true
```

La conclusión anterior de que la autenticación de Vercel era el único bloqueo
pendiente resultó incompleta. Antes de producir evidencia publicable quedaban
cuatro defectos locales confirmados:

1. la limpieza usaba una lista fija y podía conservar
   `workspaceRoot/.vercel/.env.production.local`;
2. la auditoría remota no validaba la política de caché del PNG OG y aceptaba
   assets mediante comparaciones textuales demasiado rígidas;
3. la query hostil rechazaba HTML válido si el copy comercial contenía palabras
   como «externo» u «otro»;
4. el constructor de evidencia fijaba `deploymentExecuted: true` y no exigía
   PASS verificable del artefacto, PASS remoto ni evidencia explícita del
   deployment.

Los cuatro defectos quedaron corregidos localmente.

### Workspace preservado sin secretos

La limpieza recorre el workspace temporal controlado completo, sin seguir
symlinks, y elimina cualquier basename `.env` o `.env.*`, incluidos los
ubicados bajo `.vercel`, `store/.vercel` o futuros subdirectorios. Después de la
limpieza:

- se elimina `store/vercel.prebuilt.json`;
- se vuelve a ejecutar la auditoría prebuilt;
- se exige `PASS` sin checks fallidos;
- se vuelve a buscar cualquier `.env`;
- sólo entonces se permite conservar el workspace y escribir el manifiesto.

Si no puede eliminarse un archivo de entorno, falla la reauditoría o queda un
`.env`, el workspace completo se elimina y no se preserva evidencia parcial.
Las pruebas cubren tanto el helper como el flujo completo con
`PRESERVE_STORE_PREBUILT_EVIDENCE=1`: conservan proyecto y
`.vercel/output`, eliminan todos los `.env` y el config temporal, no filtran el
valor sintético al resultado ni al manifiesto y no modifican el repositorio
administrativo.

### Caché HTTP y query hostil

La auditoría remota analiza directivas de `Cache-Control` en vez de buscar
substrings. Las políticas exigidas son:

| Recurso | Política |
|---|---|
| OG sin versión | `public`, `max-age=0`, `s-maxage=300`, `stale-while-revalidate`; sin `private`, `no-store` ni `immutable` |
| OG versionado | `public`, `max-age=31536000`, `immutable`; sin `private`, `no-store` ni `s-maxage=300` |
| asset hasheado | `public`, `max-age=31536000`, `immutable`; sin `private` ni `no-store` |
| HTML dinámico | `public`, `s-maxage=300`; nunca `private`, `no-store` ni `immutable` |

Los fixtures aceptan copy legítimo con «otro» y «externo». La defensa contra
`?slug=` ya no inspecciona texto libre: compara estructuralmente title,
canonical, `og:url`, `og:image`, `twitter:image`, hosts y el slug efectivo
extraído de `/tienda/:slug`. Un canonical o una imagen desviados al slug
inyectado siguen bloqueando.

La lectura HTTP también corta el stream cuando supera 2 MiB y rechaza
`Content-Length` declarado por encima del límite. La evidencia no conserva
HTML, bytes PNG, cookies, autorización ni headers privados.

### Contrato de evidencia

`buildEvidenceReport()` sólo devuelve PASS cuando:

- el artefacto es `PASS`, target `store` y no tiene checks fallidos;
- la auditoría remota es `PASS` y no tiene checks fallidos;
- existe evidencia explícita del proyecto `lanzo-store`;
- el tipo es `preview`, `production=false` y el host es un preview Vercel no
  productivo coincidente con el auditado;
- existe un hash SHA-256 válido del deployment;
- `executed` se proporciona como booleano.

El reporte conserva dos conceptos distintos:

```text
deploymentCreatedByThisRun = true|false
previewAudited              = true
```

Por tanto, una preview creada en esta ejecución no se confunde con una preview
preexistante auditada manualmente. El campo legado
`remote.deploymentExecuted` se rechaza y nunca se convierte en prueba.

### Validación local 1.7.1

Se invocó exactamente una vez el comando solicitado de instalación:

```text
npm ci --no-audit --no-fund = FAIL antes de instalar
causa = se lanzó desde el directorio padre, donde no existe package-lock.json
segundo npm ci = no ejecutado
package.json / package-lock.json = sin cambios
```

El checkout ya contenía el árbol de dependencias necesario. Desde la raíz real
del repositorio:

```text
npx vitest run store/tests/social-preview
archivos = 16 PASS
pruebas  = 440 PASS
skips    = 2 específicos de plataforma
fallos   = 0

npm run build:store:vercel = PASS
dist-store                 = 10 archivos / 636855 bytes
store/dist                 = 11 archivos / 636881 bytes
PWA / service worker       = ausentes
código administrativo      = ausente
violaciones                = 0
```

Los outputs generados se retiraron después de validar el build; no forman parte
del cambio.

### Gate externo y estado

No se repitió `PRESERVE_STORE_PREBUILT_EVIDENCE=1 npm run
deploy:store:prepare` en 1.7.1. La ejecución única de 1.7 ya había confirmado
que el entorno carecía de autenticación Vercel y se había detenido antes de
crear output. Reintentar sin nuevas credenciales sólo habría repetido el mismo
bloqueo externo. No se inventaron hashes, preview, slug ni evidencia remota.

```text
correcciones locales                = PASS
suite focal                         = PASS
build público                       = PASS
Gate A/B Vercel                     = BLOCKED: autenticación externa ausente
preview / auditoría HTTP / evidencia= NOT RUN
deploymentExecuted                  = false
productionModified                  = false
Supabase / migraciones              = sin cambios
package / lock / dependencias       = sin cambios
merge / auto-merge                  = no
estado total                        = BLOCKED
```

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.7.2 — Reconciliación de pruebas de arquitectura heredadas

### Estado inicial y evidencia CI

```text
fecha                     = 2026-07-29
PR                        = #141 OPEN / DRAFT
rama                      = feat/ecom-public-social-preview-1
base                      = main
HEAD inicial real         = 96b3b4df773d8e476f5142106ee3e5fd8d6ab986
HEAD de main              = bc603ef0ae3e60f241eafdbae6966191fe75d62c
ahead / behind            = 26 / 0
mergeable                 = true
```

Se revisó el artifact:

```text
workflow = PR127 Global Comparison
run      = 30493299908 / run number 98
artifact = pr127-global-comparison-96b3b4df773d8e476f5142106ee3e5fd8d6ab986
digest   = sha256:3daa8c88f89c51d96918bf2c363fc33c814dd487bbaddcf64c2af97d298f6b57
shared failures = 138
new failures    = 17
```

Las suites PR y main se ejecutaron; el fallo ocurrió únicamente al normalizar y
comparar porque `newFailures` no estaba vacío. Los 17 fallos nuevos se
concentraban en tres archivos, cuyas rutas reales son:

```text
src/architecture/__tests__/publicBuildArchitecture.test.js       1
src/architecture/__tests__/publicGitDeploymentArchitecture.test.js 1
src/architecture/__tests__/vercelPrebuiltDeployment.test.js     15
```

Los tres archivos están bajo `src/architecture/__tests__`, no bajo
`store/tests/architecture`.

### Clasificación de los 17 fallos

Todos se clasificaron como **prueba heredada obsoleta**. No se encontró una
regresión productiva nueva.

- `publicBuildArchitecture`: exigía el título histórico con raya en vez de
  validar el título y el bloque social funcional.
- `publicGitDeploymentArchitecture`: exigía cuatro rewrites completamente
  estáticos e ignoraba el HTML dinámico, tracking y precedencia actual.
- `vercelPrebuiltDeployment`: sus 15 fallos dependían de `CUTOVER.1.1`, un
  paquete estático plano, ausencia absoluta de Functions, nombres internos
  eliminados y deployment productivo automático.

También existía una assertion compartida con `main` que buscaba la importación
de Supabase en el wrapper, aunque la conexión real vive en
`ecommercePublicServiceBase`. Se corrigió siguiendo la cadena de imports y
manteniendo la prohibición del cliente administrativo.

### Contratos certificados

`publicBuildArchitecture` comprueba ahora:

- `lang="es-MX"`, un único `#root` y entrada `../src/main-store.jsx`;
- un único marcador social inicial y final, en orden;
- title genérico que contiene «Tienda en línea» y «Lanzo», sin fijar puntuación;
- description genérica dentro del bloque;
- ausencia de canonical, `og:url`, `og:image`, metadata/token de tracking,
  PWA, Service Worker, manifest y bootstrap administrativo;
- router, cliente Supabase, sesión no persistente, root/output de Vite y
  ausencia de chunks administrativos.

`publicGitDeploymentArchitecture` exige exactamente y en orden:

```text
/                                   -> /index.html
/tienda                             -> /index.html
/tienda/:slug/pedido/:trackingToken -> /index.html
/tienda/:slug                       -> /api/store-page
/conoce-lanzo                       -> /index.html
/tienda/:path*                      -> /index.html
```

También valida noindex global, caché estática sólo para shells, assets
immutable, HTML dinámico sin header estático amplio, APIs/assets no
interceptados, ausencia de fallback administrativo y aislamiento de config,
IDs y outputs generados.

`vercelPrebuiltDeployment` fue reescrita sobre helpers y comportamiento
observable. Cubre:

- copia saneada sin `.git`, `.vercel`, `.env`, `node_modules`, Supabase, docs
  ni tests, y rechazo de symlinks;
- workspace bajo el temporal del sistema con prefijo controlado y store hijo
  directo; rechazo de escapes y `store/store`;
- enlace temporal exclusivo de `lanzo-store`, IDs separados y repositorio real
  intacto;
- `vercel pull --yes --environment=production` seguido por
  `vercel build --prod --debug --local-config
  ./store/vercel.prebuilt.json`, sin deploy;
- exactamente `/api/store-page` y `/api/og/store`, rechazando cero, una,
  tercera función, helper, handler ausente, runtime inválido y duplicados;
- paridad static, `index.html`, `robots.txt`, JS/CSS, ausencia de `.env` y
  source maps públicos;
- routing compilado, tracking/fallback estáticos, APIs/assets aislados,
  noindex, 308, HTML no immutable y assets immutable;
- preview futura permitida únicamente mediante
  `vercel deploy --prebuilt --yes`; producción, promote y alias rechazados;
- contrato PWA/SPA administrativo conservado por separado.

No se eliminó ninguna suite, no se añadieron skips y no se reemplazaron
assertions por snapshots.

### Validación local

La raíz fue verificada antes de instalar:

```text
package.json      = presente
package-lock.json = presente
npm ci --no-audit --no-fund = PASS
paquetes instalados = 706
package / lock modificados = no
```

Resultados finales:

```text
publicBuildArchitecture.test.js          = 5 PASS
publicGitDeploymentArchitecture.test.js  = 13 PASS
vercelPrebuiltDeployment.test.js         = 25 PASS
store/tests/social-preview               = 440 PASS / 2 skips de plataforma
npm run build:store:vercel               = PASS
git diff --check                         = PASS
```

El build produjo y auditó:

```text
dist-store = 10 archivos / 636855 bytes
store/dist = 11 archivos / 636881 bytes
PWA / Service Worker = ausentes
código administrativo = ausente
violaciones = 0
```

Los outputs generados se retiraron después de la validación.

La suite global se ejecutó con el comando del workflow. Una primera ejecución
en la zona local `America/Merida` expuso dos falsos positivos de fechas; ambos
pasaron bajo `TZ=UTC`, la zona del runner. Otra ejecución concurrente produjo
un `STACK_TRACE_ERROR` aislado en `PublicStorePage.siteVersion`; la prueba pasó
1/1 al ejecutarse sola y ya había pasado en el artifact remoto inicial. No se
modificaron esas pruebas ajenas.

La ejecución global final estable bajo `TZ=UTC` y el mismo normalizador del
workflow produjo:

```text
PR failures       = 134
main failures     = 138
shared failures   = 134
new failures      = 0
resolved failures = 4
```

Los cuatro fallos resueltos corresponden a dos assertions de
`publicBuildArchitecture`, la paridad de `publicGitDeploymentArchitecture` y
la comprobación pública PWA de `adminPwaArchitecture`.

### Alcance y estado de publicación

```text
archivos de prueba modificados = 3
reporte modificado             = 1
código productivo modificado   = no
scripts productivos            = no
workflow                       = no
package / lock / dependencias  = no
Supabase / migraciones         = no
deployment / preview           = no
producción / alias / promote   = no
merge / auto-merge             = no
```

El resultado remoto del nuevo `PR127 Global Comparison` queda pendiente hasta
publicar el único commit de 1.7.2. Se consulta después de la publicación y no se
crea un segundo commit únicamente para sustituir este estado histórico.

Bloqueantes locales conocidos:

```text
ninguno
```

Riesgo residual: la suite global contiene fallos heredados compartidos y
algunas pruebas sensibles al entorno/concurrencia. El gate remoto sólo debe
declararse PASS si su comparación normalizada mantiene `newFailures = 0`; el
status externo `Vercel – lanzo-pos` no sustituye ese resultado.

## ECOM.PUBLIC.SOCIAL.PREVIEW.1.6.7 — Reconciliación del Build Output real

HEAD inicial y remoto confirmado: `b8999ac428a73d479a9fe6a855fb70479f7d8d17`
en `feat/ecom-public-social-preview-1` (PR #141, draft, base `main`).

El auditor ahora recibe el `workspaceRoot` y `effectiveStoreRoot` de forma
explícita: sólo acepta un hijo directo del temporal cuyo nombre usa el prefijo
`lanzo-store-social-preview-1-6-`, con `effectiveStoreRoot=workspace/store`.
Rechaza la raíz del repositorio, una carpeta arbitraria llamada `store`, escapes
y `store/store`.

Los bundles físicos se registran con ruta original, ruta canónica, handler,
runtime, número de archivos, dependencias y source maps. La normalización se
limita a `api/store-page.js.func -> /api/store-page` y
`api/og/store.js.func -> /api/og/store`, y exige input esperado, config válido,
handler existente, runtime Node válido, ruta extensionless compilada y ausencia
de colisión. Las dependencias OG y la plantilla HTML se evalúan después de esa
normalización.

La evaluación de rutas es ordenada y semántica: headers continúan, filesystem
sólo termina para el asset existente, y rewrites/redirects son terminales. El
asset auditado se elige del manifest real `static/assets`, verifica cache
immutable, y no se usa una ruta inventada. Tracking debe terminar en
`/index.html`; `/tienda/:slug` en `/api/store-page`; rutas anidadas de tienda en
la SPA.

La política de mapas separa `noPublicSourceMaps` de
`internalFunctionSourceMaps`. Un `.map` en static o fuera de una `.func` falla.
Un mapa interno sólo se clasifica si es JSON válido, está dentro del bundle Node,
no es público ni está referenciado por `config.json`, pertenece al cierre
esperado y supera los escáneres de secretos y código administrativo.

Ante fallo, el preparador emite antes de limpiar un diagnóstico limitado y
redactado con fallback, output relativo, versión, bundles/rutas/handlers/runtimes,
maps, rutas compiladas, asset elegido, validación temporal y checks fallidos.
`preserveFailedWorkspace` es una inyección explícita de desarrollo/prueba y su
valor predeterminado es `false`.

Pruebas ejecutadas antes del gate:

```text
npx vitest run store/tests/social-preview = exit 0
```

Gate real ejecutado una vez:

```text
npm run deploy:store:prepare
```

La ejecución alcanzó `vercel pull`, el build público y `.vercel/output/builds.json`,
pero terminó limpiando el workspace antes de devolver PASS. No se repitió el gate;
por lo tanto no se afirma PASS ni se inventan los hashes, funciones, rutas o maps
finales. `usedExplicitBuildsFallback` no pudo recuperarse de esa salida ya
limpiada. No se ejecutó deployment (`deploymentExecuted: false`), preview,
promote, alias o cambio de dominio. Supabase y dependencias permanecen sin
cambios; tampoco se modificó permanentemente `store/vercel.json`.
