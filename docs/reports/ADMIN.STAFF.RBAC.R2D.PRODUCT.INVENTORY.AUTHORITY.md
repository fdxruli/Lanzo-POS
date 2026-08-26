# ADMIN.STAFF.RBAC.R2D - Product Catalog + Inventory Server Authority

## Estado y base de trabajo

- Branch: codex/admin-staff-product-inventory-authority-r2d
- Base: origin/main en 9843d69c3d17f7126b8f8857a48365b2d48db411
- Fetch: REMOTE_MATCH=YES; no hubo commits intermedios desde el handoff.
- Migration nueva: supabase/migrations/20260826010000_admin_staff_rbac_r2d_product_inventory_authority.sql
- Politica: forward-only; no se edito ninguna migracion historica y no se reparo el ledger.
- PR: se dejara como Draft; no se mergea, no se marca Ready y no se usa force-push.
- Alcance congelado: ventas, caja, pricing/discount e inventory side-effects de ventas no se redisenan en R2D.

## Preflight de produccion

La inspeccion read-only de public.license_staff_users en el proyecto odlrhijtfyavryeqivaa devolvio:

| Control | Resultado |
|---|---:|
| Staff activos | 6 |
| products = true | 5 |
| products false o ausente | 1 |
| inventory = true | 4 |
| inventory false o ausente | 2 |
| Ambos permisos true | 4 |
| products ausente | 0 |
| inventory ausente | 0 |

El ultimo migration ledger observado antes de R2D fue 20260825233834 20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority. No se aplico ninguna migracion a produccion durante este trabajo.

## Matriz de autoridad

| Superficie / operacion | products | inventory | Admin vigente | Staff solo products | Staff solo inventory | Offline/replay |
|---|---:|---:|---:|---:|---:|---|
| Crear/editar categoria | Requerido | No | Permitido | Permitido | Denegado | Origin actor-bound |
| Crear/editar producto metadata/catalogo | Requerido | No | Permitido | Permitido | Denegado | Origin actor-bound |
| Crear producto con stock/lotes iniciales | Requerido | Requerido | Permitido | Denegado | Denegado | Origin actor-bound; ambos permisos |
| Editar variante que toca inventario | Requerido | Requerido | Permitido | Denegado | Denegado | Origin actor-bound; ambos permisos |
| Activar/desactivar producto | Requerido | No | Permitido | Permitido | Denegado | Origin actor-bound |
| Archivar/eliminar producto | Requerido | Requerido | Permitido | Denegado | Denegado | Origin actor-bound; archiva lotes hijos |
| Crear/editar lote | No | Requerido | Permitido | Denegado | Permitido | Origin actor-bound |
| Archivar/eliminar lote | No | Requerido | Permitido | Denegado | Permitido | Origin actor-bound |
| Entrada de inventario | No | Requerido | Permitido | Denegado | Permitido | Origin actor-bound |
| Merma por caducidad | No | Requerido | Permitido | Denegado | Permitido | Actor actual validado antes de RPC |
| Crear lote desde stock padre | No | Requerido | Permitido | Denegado | Permitido | Actor actual validado antes de RPC |
| Ajustar stock sin lote a cero | No | Requerido | Permitido | Denegado | Permitido | Actor actual validado antes de RPC |
| Migrar catalogo local sin lotes | Requerido | No | Permitido | Permitido | Denegado | Origin actor-bound |
| Migrar catalogo local con lotes | Requerido | Requerido | Permitido | Denegado | Denegado | Origin actor-bound; ambos permisos |
| Lecturas de catalogo/inventario | Read path historico preservado | Read path historico preservado | Permitido | Segun read path | Segun read path | No se cambia el alcance de lectura |
| Efectos de inventario derivados de venta | Fuera de R2D | Fuera de R2D | Congelado | Congelado | Congelado | Handler de ventas existente permanece intacto |

## Implementacion server

La migracion:

1. Usa private.validate_product_inventory_actor, que delega a public.validate_pos_rpc_rate_limit_context y al resolver actual de actor/sesion. La sesion Admin actual se conserva valida; Staff se resuelve con permisos booleanos estrictos.
2. Define helpers private separados para products e inventory, con search_path = '' y revoke a roles API.
3. Renombra las funciones historicas de catalogo a sufijo _legacy_r2d, les revoca ejecucion directa y publica wrappers estrictos con las firmas, nombres y defaults historicos.
4. Hace que pos_upsert_product y pos_migrate_local_product_catalog exijan inventory para lotes iniciales y para stock positivo al crear registros nuevos; las ediciones de metadata de productos existentes no reescriben stock.
5. Hace que pos_delete_product exija ambos permisos porque archiva lotes hijos.
6. Reemplaza las cuatro RPC standalone de inventario con sus cuerpos historicos y cambia unicamente el validador/autoridad a inventory.
7. Revoca public y concede explicitamente anon, authenticated y service_role en cada RPC publica. La autoridad no se delega al rol SQL.
8. No toca pricing de venta, descuentos, caja, cancelaciones ni los RPC de ecommerce publicados.

## Implementacion cliente y offline

- productInventoryAuthority.js centraliza la matriz, captura de actor y comprobacion de generacion/tenant/sesion.
- Las mutaciones locales, cloud y callbacks posteriores a RPC revalidan el handle actual.
- La outbox guarda actorSensitivity = actor_bound, originActorKey, originActorId, originActorType y originActorGeneration.
- Las filas actor-bound sin procedencia inmutable quedan retenidas y no sustituyen silenciosamente el actor actual.
- El replay valida que actor y generacion coincidan; un cambio de Staff, revocacion o contexto stale se convierte en conflicto fail-closed y no se reintenta como si fuera un fallo transitorio.
- Las entradas de inventario y las mutaciones de producto/lote generan procedencia en el momento de la mutacion, no al sincronizar.
- INVENTORY_MOVEMENT derivado de ventas no fue incluido en la nueva clasificacion actor-bound; permanece en el flujo de ventas congelado.

## UI y navegacion

- /productos admite products OR inventory.
- Staff solo products ve y modifica catalogo, categorias y estado, pero no ve lotes, mermas ni entrada de existencia.
- Staff solo inventory puede entrar a /productos, leer el catalogo y ve las pestañas/acciones de lotes, entradas, mermas y regularizacion; no ve alta/edicion/categorias/precios.
- Eliminar producto solo aparece cuando existen ambos permisos.
- Caducidad y regularizacion consultan inventory, no products.
- Las guardas de servicio permanecen activas aunque un boton viejo o una llamada directa intente saltarse la UI.

## Pruebas permanentes

- scripts/supabase/admin-staff-product-inventory-authority-contract.node-test.mjs
  - valida helpers y search_path
  - valida wrappers y ACL exactos
  - valida la matriz de catalogo, lotes iniciales y stock positivo de productos nuevos
  - valida las cuatro RPC standalone de inventario
  - valida procedencia actor-bound, replay stale y retencion de outbox
  - valida ruta, pestañas y botones de UI
- Pruebas unitarias existentes de producto/sync deben conservar sus mocks de actor y se ejecutan junto con la suite Vitest cuando se reinstalen dependencias locales.

## Exclusiones explicitas

- No se cambian las tablas ecommerce_* ni los RPC de catalogo publicado online; son un dominio separado y quedan deferred.
- No se cambia la autoridad de venta ni sus movimientos de inventario derivados.
- No se hace backfill automatico de outbox antigua: las filas actor-bound sin origen se retienen fail-closed para no atribuirlas al Staff equivocado.
- No se edita ni se reescribe el historial de migraciones.


## Inventario de entry points y controles

- Producto cliente: ProductsPage/ProductList -> productRepository (categoria, producto, precio, estado, borrado, lote) -> productCloudRepository -> RPC catalogo; toda mutacion local y outbox pasa por ActorRuntime.
- Inventario cliente: inventoryEntryService.addInventoryEntry, productRepository.saveBatch/deleteBatch y productExpirationWasteCloudRepository (merma, lote desde stock padre, ajuste a cero); todos requieren inventory.
- Producto PostgreSQL: pos_upsert_category, pos_delete_category, pos_upsert_product, pos_delete_product, pos_toggle_product_status, pos_migrate_local_product_catalog; wrappers SECURITY DEFINER, actor actual y products; stock/lotes combinados agregan inventory.
- Inventario PostgreSQL: pos_upsert_product_batch, pos_delete_product_batch, pos_add_inventory_entry, pos_register_expiration_waste, pos_create_product_batch_from_parent_stock y pos_adjust_product_stock_without_batch_zero; SECURITY DEFINER, actor actual e inventory.
- Todas las firmas publicas anteriores revocan API por defecto y conceden solo anon/authenticated/service_role para llegar al wrapper validado. Las funciones legacy renombradas _legacy_r2d no tienen execute API. No hay overload sin auditar en las firmas objetivo.
- service_role no es bypass: aunque conserva EXECUTE para compatibilidad de RPC, cada wrapper resuelve el actor/sesion y exige permiso actual; helpers private tienen EXECUTE revocado para public/anon/authenticated/service_role.

## Normalizacion y evidencia de validacion

- Preflight read-only: products true=5, false=1, malformed=0, missing=0; inventory true=4, false=2, malformed=0, missing=0. No hubo backfill ni grants automaticos.
- Side effects de pruebas: no se usaron cuentas ni datos reales; fixture residue=0, product/inventory mutations en produccion=0.
- Validacion local: contrato R2D 5/5; suite focalizada authority/ActorRuntime/product/inventory/sync 65/65; ESLint en archivos cambiados 0 errores y 0 warnings; build oficial PASS.
- Dry-run/apply de produccion: no ejecutado; CLI Supabase no esta disponible localmente y la migracion permanece sin aplicar. Ledger pre-R2D: 20260825233834 / 20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority.
- Final HEAD SHA y numero/URL del Draft PR se registran en el handoff final despues del commit; no se ejecuta merge, Ready ni force-push.

## Criterio de cierre

La revision independiente debe confirmar:

- migracion nueva forward-only y ACLs exactas;
- Admin vigente permitido;
- Staff solo products no puede mutar inventario;
- Staff solo inventory no puede mutar catalogo;
- operaciones conjuntas exigen ambos;
- revocacion server-side efectiva sin logout;
- offline/replay conserva actor origin y falla cerrado ante stale;
- ventas/ecommerce permanecen fuera de alcance;
- PR final queda Draft, sin merge, sin Ready y sin force-push.