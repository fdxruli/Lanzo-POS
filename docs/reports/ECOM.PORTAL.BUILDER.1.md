# ECOM.PORTAL.BUILDER.1 — correcciones de revisión PR #123

## Alcance y control de rama

- Rama: `fase-ecom-portal-builder-1`; base: `main`; PR: [#123](https://github.com/fdxruli/Lanzo-POS/pull/123).
- HEAD inicial remoto: `cbed64b830f01ed54dabe89ec3017c6d714175f8`.
- `origin/main` y merge-base confirmado: `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- Antes de editar, el worktree estaba limpio, `main` no tenía commits locales accidentales, y el PR estaba `OPEN`, draft y sin merge.
- No se hizo merge, despliegue manual de Vercel, ni se aplicó la migración de hardening a producción.

## Drift de migraciones y alineación

La causa fue que la primera publicación registró las migraciones en Supabase con timestamps de servidor distintos a los nombres locales. La tabla remota `supabase_migrations.schema_migrations` contiene las declaraciones efectivamente ejecutadas y confirmó que su contenido corresponde al de los cuatro archivos originales; no hubo reparación del historial ni reaplicación.

| Local anterior | Remoto y local final |
| --- | --- |
| `20260719172400_ecom_portal_builder_foundation.sql` | `20260719173158_ecom_portal_builder_foundation.sql` |
| `20260719173231_ecom_portal_builder_document_validation_fix.sql` | `20260719173300_ecom_portal_builder_document_validation_fix.sql` |
| `20260719173418_ecom_portal_builder_document_validation_operator_fix.sql` | `20260719173452_ecom_portal_builder_document_validation_operator_fix.sql` |
| `20260719174601_ecom_portal_builder_versions_immutable.sql` | `20260719174618_ecom_portal_builder_versions_immutable.sql` |

No se conservan ambos timestamps ni se crearon duplicados. La consulta remota solicitada y el listado de migraciones del conector de Supabase confirman las cuatro versiones remotas. `supabase migration list --linked` no pudo ejecutarse desde este worktree: la CLI local no dispone de credenciales de Management API (`Unauthorized` al enlazar); no se usa ese error como PASS.

## Migración compensatoria pendiente de revisión

`20260720010757_ecom_portal_builder_foundation_hardening.sql` es una migración nueva y no modifica semánticamente las ya desplegadas. Aún no está aplicada a producción.

- Añade `unique (portal_id, id)` en versiones y sustituye la FK simple por `foreign key (portal_id, published_version_id)`, por lo que un portal no puede publicar una versión de otro.
- Revoca los privilegios heredados, deja a `service_role` solo `SELECT/INSERT/UPDATE` en documentos y `SELECT/INSERT` en versiones, y revoca acceso directo a `anon` y `authenticated`.
- Mantiene el trigger de inmutabilidad de `UPDATE`/`DELETE`, deniega `TRUNCATE` por privilegios y añade un trigger de sentencia que rechaza ese evento. Un trigger adicional exige el flujo de publicación autorizado para insertar versiones.
- Añade `document_mode` (`default` o `custom`). Los documentos base se regeneran al cambiar `classic`, `showcase` o `compact`; un documento estructuralmente distinto se conserva como `custom`. Tema, logo y portada siempre se toman del portal en render.
- `showSearch` y `showCategories` ya se transmiten al catálogo; no quedan props publicables ignoradas.
- El historial devuelve metadatos sin `document`, con `limit` por defecto 20, máximo 50, `offset` no negativo y `hasMore`. La restauración continúa usando solo `versionId` y no publica automáticamente.

## Contrato público y regresiones

`EcommerceSiteRenderer` vuelve a sintetizar el preset cuando el modo es `default`; así el documento inicial no congela plantilla. `PublicStorePage` recibe `documentMode`, mientras que `siteVersion` sigue separado de `catalogRevision`. Carrito y checkout se mantienen fuera del documento; no se modificaron stock, precios, FEFO, pedidos, tracking, fulfillment, ni los contadores operativos indicados.

## Pruebas ejecutadas

- PASS: pruebas focalizadas de documento, renderer, servicio y foundation: **26/26**.
  - Validador: estructura, allowlists, secciones obligatorias, IDs, layouts, props, CSS/HTML/JS arbitrario, claves peligrosas, tamaño, checksum y normalización determinista.
  - Renderer: orden, preset `compact`, preview, y aplicación efectiva de controles de catálogo.
  - Servicio: contexto de autorización, argumentos RPC, conflicto, validación local y sanitización/paginación del historial.
  - Foundation: Free no llama RPC, carga Pro, publicar, restaurar como borrador y cargar la siguiente página.
- PASS: ESLint de todos los módulos de aplicación modificados.
- PASS: regresión pública focalizada: `PublicStorePage.test.jsx` **13/13**, `PublicStorePage.configurationContext.test.jsx` **2/2** y checkout focalizado **8/8**. Se corrigió el nombre accesible del botón de catálogo (`Agregar Producto`) sin tocar carrito, checkout ni revisiones operativas.
- PASS: `git diff --check`.
- PASS: `npm run build` (1m 37s de bundle más service worker).
- PASS: `npm run build:store` (36.46s, 1,822 módulos).
- PENDIENTE/no calificado: la suite SQL real completa requiere una rama de base de datos aislada para aplicar y revertir esta migración sin tocar producción. No se creó porque Supabase exige confirmación de coste para ello. Por tanto, no se declara como una prueba SQL completa.
- PENDIENTE/no calificado: `npm run lint` completo agotó el límite de la terminal y `npm run test:ci` volvió a agotar 122s sin completar. Ninguno se cuenta como PASS.

## Estado de servicios y riesgos residuales

- Supabase `odlrhijtfyavryeqivaa`: las cuatro migraciones fundacionales están registradas; la compensatoria sigue local y pendiente de revisión. Los advisors de seguridad/rendimiento consultados antes de esta migración no representan el esquema aún no desplegado.
- Vercel, en modo solo lectura: `lanzo-pos` tiene producción Ready de hace 10h y un preview Ready de hace 8h; existe la integración separada `lanzo-store`, cuya producción más reciente está Ready (10h). No se creó ningún despliegue ni preview manual.
- Riesgo residual principal: hasta probar y revisar la migración compensatoria en una rama Supabase aislada, sus garantías SQL nuevas (FK, grants, triggers y RPC) no deben considerarse verificadas en una base real.

El PR debe permanecer draft y no debe hacerse merge automático.
