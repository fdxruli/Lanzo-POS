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
