# ECOM.PORTAL.BUILDER.1 — corrección de bloqueantes residuales del PR #123

Fecha de corrección: 2026-07-19/20 (America/Mexico_City).

## 1. Control de rama y alcance

- Repositorio: `fdxruli/Lanzo-POS`.
- PR: `#123 — FASE ECOM.PORTAL.BUILDER.1 — documento versionado y publicación del sitio`.
- Rama: `fase-ecom-portal-builder-1`.
- Base: `main`.
- HEAD inicial remoto verificado antes de modificar: `b798ef6e668d7b4bcb31accf051cee4b80c11d9a`.
- HEAD de `main` verificado: `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- Merge-base verificado: `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- HEAD funcional final, antes de este commit exclusivamente documental: `14094dd8125e1d57667f1b604a3cb1a46bbb87ce`.
- El SHA exacto del HEAD de entrega se comprueba después de crear este reporte y se incluye en la entrega final; un commit no puede contener su propio SHA sin modificarlo nuevamente.
- El PR permaneció abierto, en draft, sin merge y apuntando a `main` durante toda la corrección.
- No se creó otro PR, no se modificó `main`, no se activó auto-merge, no se marcó ready for review y no se hizo despliegue manual de Vercel.
- No se amplió el alcance hacia BUILDER.2 ni se tocaron catálogo, inventario, precios, stock, variantes, extras, recetas, FEFO, pedidos, tracking, fulfillment, caja o checkout.
- No se modificaron `catalogRevision`, `configurationRevision`, `sourceRevision`, `availabilityRevision` ni `checkoutAttemptId`.

## 2. Estado remoto de Supabase

Proyecto: `odlrhijtfyavryeqivaa`.

La consulta inicial del historial remoto confirmó que producción termina en:

```text
20260719174618_ecom_portal_builder_versions_immutable
```

La migración pendiente:

```text
20260720010757_ecom_portal_builder_foundation_hardening
```

no estaba registrada en producción al iniciar la corrección. Por ello se corrigió directamente el archivo pendiente en la rama, en lugar de crear una migración compensatoria nueva.

No se ejecutó `supabase migration repair`, `db reset --linked`, `apply_migration`, `db push` ni ninguna escritura de prueba sobre datos reales. La migración no fue aplicada a producción.

## 3. Archivos modificados en esta corrección residual

```text
supabase/migrations/20260721113522_ecom_portal_builder_foundation_hardening.sql
supabase/tests/ecom_portal_builder_foundation_test.sql
src/components/ecommerce/site/EcommerceSiteRenderer.jsx
src/components/ecommerce/site/__tests__/EcommerceSiteRenderer.test.jsx
src/services/ecommerce/ecommercePublicService.js
src/services/ecommerce/__tests__/ecommercePublicSiteVersion.test.js
src/pages/__tests__/PublicStorePage.siteVersion.test.jsx
docs/reports/ECOM.PORTAL.BUILDER.1.md
```

## 4. Bloqueante 1 — validador SQL NULL-safe

### Causa

El validador anterior utilizaba comparaciones anulables, por ejemplo:

```sql
jsonb_typeof(value) <> 'object'
value->>'field' <> 'expected'
value not in (...)
```

Cuando una propiedad no existía, PostgreSQL podía producir `NULL`. En PL/pgSQL, una condición `IF NULL THEN` no entra en la rama de rechazo, por lo que documentos incompletos podían escapar de la validación.

### Corrección

`private.ecommerce_site_document_error(jsonb)` ahora:

- valida primero que la raíz sea un objeto;
- limita el documento a 65,536 bytes antes de recorrerlo;
- exige presencia explícita de `schemaVersion`, `global` y `sections`;
- rechaza claves raíz adicionales;
- usa `IS DISTINCT FROM` para tipos y valores que pueden ser `NULL`;
- exige `themeSource`, `contentWidth` y `density` dentro de `global`;
- confirma que `sections` sea un arreglo antes de llamar `jsonb_array_length` o `jsonb_array_elements`;
- exige `id`, `type`, `enabled`, `layout` y `props` en cada sección;
- no llama `jsonb_object_keys` antes de confirmar que el valor sea objeto;
- conserva las allowlists de tipos, layouts y props;
- exige `style` opcional y exactamente `{}`;
- detecta IDs duplicados;
- exige exactamente una sección activa de `header`, `catalog` y `footer`.

Las comparaciones anulables que permitían omitir campos obligatorios fueron eliminadas del flujo de aceptación.

## 5. Bloqueante 2 — separación entre borrador y publicación

### Modelo del borrador

`public.ecommerce_site_documents` conserva:

```text
draft_document
draft_revision
document_mode
published_version_id
```

`document_mode` se calcula para los borradores existentes, queda `NOT NULL` y se restringe a:

```text
default
custom
```

Guardar un borrador actualiza el documento y su modo, incrementa exactamente `draft_revision` y no modifica `published_version_id`.

### Modelo publicado

`public.ecommerce_site_versions` incorpora un `document_mode` inmutable, también `NOT NULL` y restringido a `default|custom`.

Para el backfill de versiones existentes, la migración suspende temporalmente el trigger de inmutabilidad dentro de la misma transacción, calcula el modo comparando cada documento con el preset del portal y recrea inmediatamente el trigger antes de redefinir las RPC.

Cada versión publicada congela conjuntamente:

```text
document
document_checksum
document_mode
version_number
```

### Publicación

`public.ecommerce_admin_publish_site` ahora:

- valida el borrador con el validador endurecido;
- copia `draft_document` y `document_mode` a la versión;
- considera idempotente una publicación solo cuando coinciden tanto `document_checksum` como `document_mode`;
- devuelve el modo publicado en la respuesta administrativa;
- crea una versión nueva cuando el documento o el modo no corresponden a la versión publicada actual;
- mantiene la inserción protegida por el contexto interno autorizado.

### Restauración

`public.ecommerce_admin_restore_site_version` copia exactamente:

```text
v_version.document
v_version.document_mode
```

al borrador. Incrementa `draft_revision`, actualiza los metadatos del actor y no modifica `published_version_id`, no crea una versión y no publica automáticamente.

### Contrato público

`public.ecommerce_get_portal_by_slug` ya no consulta ningún campo mutable del borrador para resolver la tienda pública.

Cuando existe una versión publicada válida entrega exactamente:

```text
versionId     = version.id
versionNumber = version.version_number
documentMode  = version.document_mode
document      = version.document
```

Cuando no existe una versión o el documento publicado es inválido usa un fallback seguro y coherente:

```text
versionId     = null
versionNumber = null
documentMode  = default
document      = preset válido del portal
```

Una versión inválida nunca conserva su ID si el contenido mostrado es un fallback diferente. El diagnóstico se registra únicamente mediante un mensaje interno sin datos del borrador ni identificadores de actores.

## 6. Renderer y cache público

`EcommerceSiteRenderer` dejó de reemplazar el documento recibido cuando `documentMode` es `default`.

En modo público:

- siempre intenta renderizar el `siteDocument` entregado por la RPC/version;
- lo normaliza de forma segura;
- genera un preset desde `templateCode` únicamente si el documento está ausente o es inválido;
- trata `documentMode` como metadato de la versión, no como instrucción para regenerarla.

Por tanto, cambiar `portal.templateCode` no reescribe retroactivamente una versión publicada.

La superficie `ecommercePublicService` conserva:

- `versionId` no nulo sin alterarlo;
- `versionNumber` válido sin alterarlo;
- `documentMode` y el documento normalizado asociados a esa versión;
- `versionId = null` y `versionNumber = null` para el fallback, incluso después de recuperar el resultado desde cache.

`siteVersionId`/`siteVersionNumber` permanecen separados de `catalogRevision`; no se modificó la clave ni la revisión del catálogo.

## 7. Suite SQL exacta

`supabase/tests/ecom_portal_builder_foundation_test.sql` se reescribió como una transacción descartable con comprobaciones exactas.

### Validador directo

Incluye los casos:

```text
default válido
null
array
objeto vacío
schemaVersion ausente, null e incorrecta
global ausente y null
themeSource/contentWidth/density ausentes
sections ausente, null, no array y más de 30
id/type/enabled/layout/props ausentes
props null
style con contenido
tipo desconocido
layout desconocido
prop extra
ID duplicado
sección obligatoria deshabilitada
documento mayor de 64 KiB
```

Cada caso compara el código exacto esperado.

### Autorización

Mantiene variables separadas y comprueba:

```text
admin válido
staff con settings + ecommerce
staff sin permisos
staff session inválida
dispositivo inválido
licencia expirada/inactiva
plan Free
PRO sin ecommerce_layout_customization=advanced
PRO válido
```

No reutiliza el resultado Free para extraer la revisión del borrador.

### Revisión, publicación y separación

Comprueba:

- estado inicial exacto;
- guardado válido e incremento exacto de `draft_revision`;
- conflicto obsoleto sin mutar borrador ni publicación;
- rechazo exacto de documento inválido y demasiado grande;
- v1 default con documento, checksum, modo y pointer exactos;
- segunda publicación idempotente sin nueva versión;
- v2 custom con incremento de versión;
- escenario A: custom publicado + default restaurado como borrador mantiene custom público;
- escenario B: publicar el default crea otra versión y cambia ID/número/documento/modo;
- escenario C: custom guardado sin publicar mantiene default público;
- escenario D: versión default publicada bajo classic permanece exacta tras cambiar el portal a compact;
- escenario E: portal sin versión devuelve IDs nulos y fallback default válido;
- versión publicada inválida devuelve fallback con IDs nulos.

### Historial e integridad

Comprueba:

- historial sin `document`;
- límite por defecto 20, máximo 50 y offset negativo normalizado a 0;
- orden descendente y `hasMore` correcto;
- aislamiento entre portales;
- FK compuesta entre portal y versión;
- rechazo de UPDATE y DELETE de versiones;
- rechazo de TRUNCATE bajo `service_role`;
- rechazo de INSERT directo no autorizado;
- publicación autorizada sí inserta;
- grants exactos de `service_role`;
- ausencia de acceso directo para `anon` y `authenticated`.

## 8. Pruebas frontend añadidas

### Renderer

Se añadieron casos para:

```text
public mode usa el documento entregado
documentMode default no sustituye el documento publicado
cambiar templateCode no altera el documento versionado
documento ausente usa fallback
documento inválido usa fallback
showSearch y showCategories funcionan
```

### Servicio/cache

Se añadieron casos para:

```text
versionId/versionNumber/documentMode/document se conservan en red y cache
fallback conserva versionId=null y versionNumber=null
una nueva siteVersion no cambia catalogRevision
```

### PublicStorePage

Se añadió un escenario donde:

```text
v1 custom renderiza controles ocultos
una revalidación sin nueva publicación conserva v1
v2 publicada cambia el renderer
catalogRevision permanece igual
```

## 9. Validación realmente ejecutada

### Ejecutado y aprobado

- Revisión estática del diff y de los archivos finales mediante GitHub.
- Verificación remota, solo lectura, del estado del PR y de los SHAs.
- Verificación remota, solo lectura, del historial y definiciones actuales de Supabase.
- Build automático de Vercel para el HEAD funcional `61922a7448672363a7419ef7440863d0371a518c`: estado `READY`; Vite transformó 3,369 módulos, completó el bundle y el service worker, y el deployment terminó correctamente.

El build de Vercel mostró advertencias heredadas/no bloqueantes sobre imports dinámicos/estáticos, datos desactualizados de `baseline-browser-mapping` y un glob PWA sin coincidencias para `assets/cashSyncHandler-*.js`.

### No ejecutado; no se cuenta como PASS

El entorno de esta sesión no proporcionó un checkout local del repositorio ni GitHub CLI, Supabase CLI, Docker o `psql`. Por ello no fue posible ejecutar aquí:

```text
git diff --check
npm run lint
npm run test:ci
npm run build:store
pruebas focalizadas Vitest
suite SQL en una base aislada
```

El build de Vercel acredita compilación del proyecto web, pero no sustituye lint, Vitest, `test:ci`, `build:store` ni la ejecución SQL.

No existen workflow runs de GitHub Actions asociados al HEAD funcional revisado. No se inventan resultados ni se consideran PASS procesos no ejecutados.

## 10. Estado de Vercel

- No se hizo deploy manual.
- La integración Git de Vercel creó previews automáticos por los commits de la rama.
- El preview del HEAD funcional consultado quedó `READY`.
- El estado del HEAD final documental se vuelve a consultar después de este commit y se reporta en la entrega final.

## 11. Riesgos residuales

1. La migración y la suite SQL aún deben ejecutarse juntas en Supabase local, una rama de desarrollo desechable o PostgreSQL/Supabase local con Docker antes de considerar verificadas en runtime las garantías de FK, grants, triggers y RPC.
2. Los tests frontend añadidos deben ejecutarse en un checkout completo; su presencia y lógica fueron revisadas estáticamente, pero no se declara un resultado Vitest.
3. `npm run lint`, `npm run test:ci`, `npm run build:store` y `git diff --check` siguen pendientes en un entorno con el repositorio materializado.
4. Las advertencias de chunking y del glob PWA observadas en Vercel no bloquearon el build, pero permanecen fuera del alcance de esta corrección.

## 12. Conclusión

Los tres defectos residuales identificados quedaron corregidos en código:

- el validador SQL es NULL-safe y exige presencia explícita;
- el borrador ya no decide el documento público;
- cada versión inmutable conserva documento y modo publicado;
- la RPC y el renderer mantienen la correspondencia `versionId → documento`;
- las suites SQL/frontend fueron ampliadas para detectar la implementación defectuosa anterior.

La entrega no debe mergearse hasta ejecutar la migración y la suite SQL en una base aislada, además de completar lint, `test:ci`, pruebas focalizadas y `build:store` en un checkout completo. El PR debe permanecer draft.

## 13. Intento de validacion y ejecucion de la migracion pendiente (2026-07-20)

Este addendum refleja el intento de ejecucion realizado con el checkout materializado en `C:\\dev\\Lanzo-POS-builder1`; prevalece sobre las notas de entorno de la seccion 9 cuando describen esta misma sesion.

- HEAD remoto de `fase-ecom-portal-builder-1` confirmado antes de modificar: `0c7af19a2808a75a2a4d7f149eb01e22272cace0`.
- Durante la validacion el remoto avanzo por cambios ya publicados por el PR a `6aaef183dcfeaf371aaf0b5bb3a84ee6430df0e5`; se hizo `fetch` y rebase normal, sin force-push ni perdida de cambios remotos. El HEAD final local y remoto coincide en `6aaef183dcfeaf371aaf0b5bb3a84ee6430df0e5`.
- HEAD de `main` y merge-base: `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- PR #123: `OPEN`, `draft=true`, `mergedAt=null`, base `main`.
- Workspace de la rama: limpio. No se modifico `main`, no se creo otro PR, no se hizo merge, no se hizo deploy manual y no se aplico `supabase migration repair`.
- El proyecto `odlrhijtfyavryeqivaa` esta `ACTIVE_HEALTHY`. El historial remoto sigue terminando en `20260719174618_ecom_portal_builder_versions_immutable`; la migracion `20260720010757_ecom_portal_builder_foundation_hardening` sigue pendiente.
- La migracion local pendiente quedo alineada en la rama y contiene FK compuesta, grants minimos, defensa de `TRUNCATE`, insercion autorizada, `document_mode` y listado paginado sin `document`.
- `supabase status` no pudo inspeccionar el contenedor porque Docker Desktop no expone `dockerDesktopLinuxEngine` en este entorno.
- `supabase migration list --linked` y `supabase db push --dry-run` no pudieron ejecutarse porque el checkout no esta enlazado y la CLI no tiene autorizacion para enlazar el proyecto. No se ejecuto `supabase db push`.
- La suite SQL transaccional esta presente en `supabase/tests/ecom_portal_builder_foundation_test.sql`, pero no se declara ejecutada: no existe una base local o desechable disponible. La rama desechable de Supabase tiene un coste consultado de `0.01344 USD/h` y no se creo porque requiere confirmacion explicita.
- La integracion de Vercel reporta el preview del PR como `pass` y deployment completado; no se hizo despliegue manual.
- Los advisors de Supabase fueron consultados en modo lectura. Permanecen avisos INFO preexistentes de RLS sin politicas y de indices no usados; no se atribuyen a esta migracion sin ejecucion.

Estado de entrega: **BLOQUEADO**. No es valido afirmar que la migracion fue aplicada ni que la suite SQL fue aprobada hasta disponer de Docker/Supabase local, una rama desechable con confirmacion del coste, o credenciales validas para enlazar un entorno de prueba. No se realizaron escrituras sobre produccion.

## 14. Resultados locales de esta sesion

- Pruebas focalizadas de documento, renderer, servicio, foundation, cache y
  `PublicStorePage`: `8 archivos, 47/47 PASS`.
- Un intento que incluyo ademas `useActiveOrders.checkoutLock.test.js` termino
  `9 archivos PASS, 53 tests PASS, 1 archivo FAIL`; el fallo fue el fixture
  Dexie (`db.tables` indefinido en `syncDexieBootstrap.js`), fuera del alcance
  de esta migracion. No se cuenta como PASS de la suite completa.
- `npm run build`: PASS (3369 modulos; bundle admin y service worker generados).
- `npm run build:store`: PASS (1822 modulos; `dist-store` generado).
- `npm run lint`: FAIL, con 159 errores y 224 warnings preexistentes en otras
  areas del repositorio; no se alteraron para mantener el alcance.
- `npm run test:ci`: timeout a los 900 s; proceso incompleto, no PASS.
- `git diff --check`: PASS antes de registrar este addendum; se repite despues
  del commit documental.

## 15. Reintento por Supabase CLI remoto (2026-07-20)

- Se verifico `fase-ecom-portal-builder-1` en el worktree dedicado, con HEAD
  `7e918422c940583b117f7c2f8b1b15498f2e7328`; `origin/main` y merge-base siguen
  en `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- El path solicitado `C:\\dev\\lanzo-pos-git` estaba en el branch local `main`,
  con `main` local adelantado 17 commits y dos archivos de configuracion sin
  seguimiento. No se uso ni modifico ese worktree; `origin/main` no cambio.
- `supabase link --project-ref odlrhijtfyavryeqivaa` termino correctamente.
  `supabase projects list` marco `odlrhijtfyavryeqivaa` como `LINKED` (Lanzo,
  us-east-2).
- Antes del push, `supabase migration list` mostro la migracion pendiente
  `20260720010757_ecom_portal_builder_foundation_hardening` y las cuatro
  migraciones ECOM historicas alineadas (`20260719173158`, `20260719173300`,
  `20260719173452`, `20260719174618`). Tambien mostro drift historico global:
  muchas versiones remotas no tienen archivo local y varias versiones locales
  no estan en remoto.
- `git diff --check`: PASS.
- `supabase db push --dry-run`: **FAIL/BLOCKED antes de planificar cambios**.
  La CLI devolvio `Remote migration versions not found in local migrations
  directory` y sugirio `supabase migration repair` o `supabase db pull`.
  Ninguna de esas acciones se ejecuto; tampoco se uso `--include-all`.
- `supabase db push` no se ejecuto porque el dry-run no produjo exclusivamente
  la migracion esperada.

Verificacion remota posterior, solo lectura, sin aplicar cambios:

- La version `20260720010757` no existe en `supabase_migrations.schema_migrations`.
- `ecommerce_site_documents` no tiene `document_mode`; `published_version_id`
  aun usa la FK simple `ecommerce_site_documents_published_version_id_fkey`.
- `ecommerce_site_versions` no tiene la unique compuesta `(portal_id, id)` ni
  `document_mode`.
- Solo existe el trigger de inmutabilidad para `UPDATE`/`DELETE`; no existe el
  trigger de `TRUNCATE`.
- Las RPC publicas existen con sus firmas anteriores; el listado de versiones
  aun usa cuatro argumentos.
- `anon` y `authenticated` no tienen grants directos sobre las tablas. El
  estado remoto actual de `service_role` conserva privilegios amplios hasta que
  se aplique el hardening.
- Conteo remoto actual: `documents=0`, `broken_pointers=0`,
  `cross_portal_pointers=0`.

Estado de este reintento: **BLOCKED** por drift historico global del checkout,
no por un error sintactico evidente de la migracion. No hubo `db push`,
`migration repair`, `db pull`, `db reset`, inserciones de prueba, escrituras
manuales ni cambios en `main`.

## 16. Aplicacion MCP de la migracion pendiente (2026-07-21)

Esta seccion sustituye el estado BLOCKED de los intentos anteriores para esta
ejecucion concreta. El drift historico global permanece como trabajo separado.

- Metodo: Supabase MCP `apply_migration`, proyecto `odlrhijtfyavryeqivaa`, una
  sola operacion atomica con el SQL completo de la migracion.
- HEAD inicial utilizado: `b561d45e8d00cd5b15e39388552957f90e06c230`.
- Timestamp local anterior: `20260720010757`.
- Timestamp remoto generado por Supabase: `20260721113522`.
- Nombre final del archivo:
  `supabase/migrations/20260721113522_ecom_portal_builder_foundation_hardening.sql`.
- SHA-256 antes y despues del renombrado:
  `b5dec5bc6f3b6682142eebe47b265f11e67349be8bf81a4b4cf082113b6f10ed`;
  ambos hashes son identicos y el SQL no cambio.
- Resultado exacto de `apply_migration`: `{"success":true}`.
- `list_migrations` devolvio una sola fila con nombre
  `ecom_portal_builder_foundation_hardening` y version `20260721113522`.
- Verificaciones remotas de solo lectura: `document_mode` existe y es `NOT
  NULL` en documentos y versiones; existe la unique `(portal_id, id)`; existe
  la FK compuesta `ecommerce_site_documents_portal_published_version_fkey`;
  existen las defensas `UPDATE`/`DELETE`, `TRUNCATE` y de insercion no
  autorizada; el RPC de historial tiene `p_limit integer, p_offset integer`;
  `service_role` conserva solo `SELECT, INSERT, UPDATE` en documentos y
  `SELECT, INSERT` en versiones; `DELETE`/`TRUNCATE`/`UPDATE` de versiones son
  falsos; `anon` y `authenticated` no tienen acceso directo; la funcion publica
  no menciona `draft_document`; y los conteos siguen
  `documents=0`, `versions=0`, `cross_portal_pointers=0`.
- No se uso `supabase db push`, `--include-all`, `migration repair`, `db pull`,
  `db reset`, `migration up`, Docker ni `execute_sql` para DDL. Las consultas
  `execute_sql` de esta sesion fueron exclusivamente `SELECT` de verificacion.
- No se insertaron datos de prueba, no se aplico ninguna otra migracion, no se
  modifico `main`, no se hizo merge y el PR #123 permanece abierto y draft.

- HEAD final y remoto confirmado: `77c6ba9dfb464e8567d12d4f5dc9a3a2cf054ad3`.
- Commit creado: `chore(db): align builder hardening migration with remote history`.
- Push confirmado exclusivamente a `origin/fase-ecom-portal-builder-1`.

Estado de esta ejecucion: **PASS**.
