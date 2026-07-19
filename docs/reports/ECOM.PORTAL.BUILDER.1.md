# ECOM.PORTAL.BUILDER.1

## Resumen

Implementa el documento estructurado de sitio, un borrador con revisión optimista, versiones publicadas inmutables, publicación atómica y renderer canónico. No cambia catálogo, inventario, pedidos, caja ni ventas.

## Base y rama

- HEAD inicial y merge-base: `405a371ad99d304bf81a6e94a4b91eedef0a0db8`.
- Rama: `fase-ecom-portal-builder-1`.
- PR #122 estaba mergeado y la migración `20260719150457` estaba aplicada antes de iniciar.
- Se utilizó un worktree limpio para preservar dos archivos locales sin seguimiento del checkout original.

## Arquitectura

- `ecommerce_site_documents`: una fila por `ecommerce_portals.id`, borrador mutable, `draft_revision` y puntero a versión pública.
- `ecommerce_site_versions`: historial por portal, número único y checksum SHA-256 del JSONB normalizado por PostgreSQL.
- Las tablas tienen RLS, no conceden acceso a `anon`/`authenticated`, y las RPC son `SECURITY DEFINER` con `search_path` vacío.
- El builder está protegido por `ecommerce_layout_customization = advanced`; el plan Free no puede invocar sus RPC.

## Contrato de documento v1

El documento admite únicamente `header`, `catalog` y `footer`; tiene máximo 30 secciones, IDs controlados, layouts allowlisted, props tipadas y ningún CSS, HTML o JavaScript arbitrario. Todo documento publicable contiene exactamente una sección activa de cada tipo. El límite es 64 KiB.

`classic`, `showcase` y `compact` se sintetizan como presets del mismo documento y siguen obteniendo tema, logotipo, portada y datos de negocio directamente del portal.

## RPC y publicación

- `ecommerce_admin_get_site_builder`
- `ecommerce_admin_save_site_draft`
- `ecommerce_admin_publish_site`
- `ecommerce_admin_list_site_versions`
- `ecommerce_admin_restore_site_version`

Todas reutilizan `ecommerce_admin_authorize_v2`, sesión de staff, token de dispositivo y rate limiting. Guardar exige `expectedRevision`; una revisión obsoleta devuelve `ECOMMERCE_SITE_DRAFT_CONFLICT`. Publicar bloquea el documento, valida, crea una versión y actualiza el puntero en la misma transacción. Restaurar solo copia la versión a borrador.

## Público, cache y fallback

La RPC pública entrega solo la versión publicada bajo `site`; si no existe, o si es inválida, sintetiza el preset seguro sin ocultar catálogo, carrito o checkout. El cliente conserva `siteVersionId`/`siteVersionNumber` separado de `catalogRevision` en el cache del portal.

`EcommerceSiteRenderer` compone secciones mediante un registro explícito y reutiliza `PublicStoreHeader` y `PublicCatalog`; carrito, barra móvil y checkout permanecen fuera del renderer.

## Migraciones Supabase

- `20260719172400_ecom_portal_builder_foundation.sql` aplicada.
- `20260719173418_ecom_portal_builder_document_validation_operator_fix.sql` aplicada para corregir de forma compensatoria la precedencia de operadores JSON del validador.
- `20260719174601_ecom_portal_builder_versions_immutable.sql` aplicada; un trigger rechaza `UPDATE` y `DELETE` de las versiones históricas.
- La validación remota confirmó que el documento por defecto es válido y que un documento sin secciones requeridas devuelve `ECOMMERCE_SITE_REQUIRED_SECTION_MISSING`.

## Validación

- PASS: lint focalizado de los archivos modificados.
- PASS: `ecommerceSiteDocument.test.js` (7/7).
- PASS: contrato público y configuración de productos (18 casos focalizados).
- BLOQUEO PREEXISTENTE: dos casos de `PublicStorePage.test.jsx` (uno espera el aria-label heredado sin `:` y otro agotó timeout); 29/31 pasaron.
- NO CONCLUYENTE: `npm run lint` completo y `npm run build` excedieron el límite; el build terminó con EPIPE, por lo que no se marca como PASS.

## Riesgos y siguiente fase

La interfaz actual solo expone estado, publicación e historial; no implementa edición visual. BUILDER.2 puede añadir controles de sección, reordenamiento y preview responsivo utilizando este contrato, sin tocar el flujo de ecommerce.

No hubo merge automático ni deployment manual. El PR debe permanecer draft.
