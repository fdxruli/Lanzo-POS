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

## CLOSEOUT.R1 — Legacy outbox provenance compatibility + CI regression closure

La revision independiente detecto que el handoff original habia reportado PASS de forma incorrecta. El bloqueo reproducible estaba en `src/services/sync/__tests__/syncOutboxService.tenantIsolation.test.js`, test `returns only explicitly scoped operations for the active tenant`: BASE PASS y CANDIDATE FAIL (`expected [] to deeply equal ['operation-b']`). Los runs originales fueron PR127 `32942292727`, Actor Runtime `32942292660` y Actor Scoped Storage `32942292664`. La falla no era PublicStore.

La causa fue que R2D agrego `CATEGORY`, `PRODUCT`, `PRODUCT_BATCH` e `INVENTORY_ENTRY` a la clasificacion implicita `ACTOR_SENSITIVE_ENTITY_TYPES`. Eso convirtio retroactivamente filas pre-R2D, sin `actorSensitivity` ni origen inmutable, en filas actor-bound; `hasBoundActorOrigin` las retuvo y desaparecieron de la cola tenant-scoped. CLOSEOUT.R1 elimina esa inferencia por tipo. Solo `SALE` conserva la regla legacy implicita.

Compatibilidad resultante:

- Las filas historicas `PRODUCT`, `CATEGORY`, `PRODUCT_BATCH` e `INVENTORY_ENTRY` sin `actorSensitivity` siguen siendo candidatas de replay para su tenant, sin inventar ni persistir `currentActor`.
- Las nuevas mutaciones R2D de producto/inventario siguen usando `actorSensitive: true` y capturan `originActorType`, `originActorId`, `originActorKey`, `originActorGeneration` y `actorOwnershipStatus = bound` al crear/enqueuear la operacion.
- Una fila explicitamente `actor_bound` sin origen valido queda retenida fail-closed; no se sustituye el actor actual ni se repara el origen.
- Actor switch, generacion stale, tenant mismatch, sesion invalida y revocacion de `products` o `inventory` bloquean el replay. Las colisiones de idempotencia no reescriben el origen historico.
- La semantica legacy de `SALE` sin metadata permanece actor-bound.

Evidencia permanente agregada: fixtures para las cuatro clases legacy, producto actor-bound sin origen, producto e inventory-entry con origen completo, switch/generacion, revocaciones, tenant mismatch, colision de idempotencia; prueba de replay del handler; contrato de permisos Staff products/inventory; y prueba SQL rollback-safe de round-trip con cuatro combinaciones y valores no booleanos. La prueba SQL remota completo `BEGIN`/verificacion/`ROLLBACK` y el chequeo posterior devolvio `r2d_fixture_licenses = 0`, `r2d_fixture_staff = 0`.

Validacion local del cierre: contratos Node `26/26`; ActorRuntime/auth `168/168`; tenant/DB/sync `648/648`; producto/inventario `72/72`; `syncOutboxService.tenantIsolation.test.js` y actor-origin PASS; ESLint de archivos modificados PASS sin errores; `git diff --check` PASS; `npm run build`, `npm run build:store` y `npm run build:store:vercel` PASS. El lint global y la suite global siguen teniendo fallos preexistentes fuera del alcance del cierre; se conservaron y no se suprimieron.

Estado remoto del cierre:

- `BASE_SHA = 9843d69c3d17f7126b8f8857a48365b2d48db411`.
- `PREVIOUS_HEAD_SHA = f45b0c9f0db4fdfc1dad22bcbf48e5a46060c249`.
- El arbol de reparacion fue publicado como `6c04ece1acd918fe8534c5ed3651eadf8b27b2a5` mediante avance normal de la ref; el SHA observado para el candidato con este reporte fue `e6a31b10080774fc6326c375c59fc63cc5d2c963`; no hubo force-push.
- PR #230 continua abierto, Draft y no mergeado.
- Vercel check del candidato `e6a31b10080774fc6326c375c59fc63cc5d2c963`: `98229048058`, PASS.
- PR127 para el candidato: run `32984769891`, `startup_failure` en los intentos 1 y 2; no hubo jobs, pasos ni artefactos funcionales. El reintento de job fue aceptado por GitHub pero volvió a fallar al arrancar.
- Actor Runtime para el candidato: run `32984767723`, `queued` sin pasos ejecutados al cierre de esta evidencia.
- Actor Scoped Storage para el candidato: run `32984767339`, `queued` sin pasos ejecutados al cierre de esta evidencia.
- HOTFIX Dexie Recovery para el candidato: run `32984700625`, `queued` con sus ocho jobs sin pasos ejecutados al cierre de esta evidencia.
- Device Actor Auth no se activo porque ningun path protegido de device-auth cambio. Al no existir ejecucion funcional del comparador sobre el candidato, el diferencial remoto queda `NOT_VERIFIED_FOR_FINAL_HEAD`; los runs originales se conservan solo como evidencia del bloqueo, no como validacion del arreglo.

Migracion y produccion:

- `supabase/migrations/20260826010000_admin_staff_rbac_r2d_product_inventory_authority.sql` no fue modificada ni aplicada.
- El ledger remoto permanece en `20260825233834 / 20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority`.
- La CLI Supabase local no esta disponible y no se pudo ejecutar el camino canonico de dry-run para este branch sin merge. `MIGRATION_DRY_RUN = BLOCKED`; no se fabrica PASS.
- Diagnosticos Supabase fueron read-only salvo la prueba sintetica transaccional con rollback. `REAL_STAFF_MUTATIONS = 0`, `REAL_PRODUCTION_PRODUCT_MUTATIONS = 0`, `REAL_PRODUCTION_INVENTORY_MUTATIONS = 0`, `FIXTURE_RESIDUE = 0`.

Este cierre queda bloqueado unicamente por la falta de dry-run canonico y de runs remotos del SHA final; no se mergea, no se marca Ready, no se edita ninguna migracion historica, no se repara el ledger y no se aplica R2D a produccion. R2B, R2C, ventas, caja y ecommerce no fueron reabiertos.

## CLOSEOUT.R2 — Unlimited server authority + rate-limit preservation

Este cierre responde a los tres P1 confirmados por la revisión independiente:

1. Los caminos *_unlimited de lotes, merma, regularización y lote desde stock conservaban la autorización histórica de products; por eso un Staff con solo inventory=true era autorizado por el wrapper nuevo y rechazado en el choke point profundo.
2. Los caminos *_unlimited eran ejecutables por service_role y no resolvían por sí mismos la autoridad del actor Staff de la solicitud.
3. Las tres RPC públicas de caducidad/regularización habían sido reemplazadas por cuerpos de mutación y perdían enforce_pos_rpc_rate_limit_v2.

La solución R2D-CLOSEOUT.R2 mantiene una sola autoridad final por función: cada *_unlimited relevante valida el contexto actual con private.validate_product_inventory_actor y aplica exactamente la matriz products, inventory o ambas. Esto también se ejecuta cuando la entrada llega mediante service_role; el rol SQL conserva únicamente el transporte compatible y no sustituye al actor autenticado. Las funciones internas siguen revocadas para public, anon y authenticated.

Las RPC públicas pos_register_expiration_waste, pos_create_product_batch_from_parent_stock y pos_adjust_product_stock_without_batch_zero vuelven a conservar la arquitectura histórica:

PUBLIC RPC -> enforce_pos_rpc_rate_limit_v2 -> *_unlimited -> actor/session + R2D authority -> mutation

Se conservan los límites observados en producción: 120 intentos por ventana de 600 segundos y bloqueo de 300 segundos para las tres funciones. Los wrappers no contienen lógica de mutación.

| Choke point | Autoridad final |
|---|---|
| pos_upsert_category_unlimited, pos_delete_category_unlimited, pos_toggle_product_status_unlimited | products |
| pos_upsert_product_unlimited | products; agrega inventory para lotes iniciales o stock inicial positivo de un producto nuevo |
| pos_delete_product_unlimited | products + inventory |
| pos_upsert_product_batch_unlimited, pos_delete_product_batch_unlimited | inventory |
| pos_migrate_local_product_catalog_unlimited | products; agrega inventory si hay lotes o stock inicial positivo de productos nuevos |
| pos_register_expiration_waste_unlimited, pos_create_product_batch_from_parent_stock_unlimited, pos_adjust_product_stock_without_batch_zero_unlimited | inventory |

Se agregan controles de contrato Node para el choke point *_unlimited, ACL interna y preservación de rate limits, además de supabase/tests/admin_staff_rbac_r2d_server_authority_contract_test.sql para verificar definiciones instaladas, matriz booleana, ACL de service_role y ausencia de exposición API. La prueba SQL es transaccional y termina en ROLLBACK.

Producción permanece sin mutaciones: la migración R2D no fue aplicada, no se modificó el ledger y no se ejecutó DDL/DML productivo. R2B, R2C, outbox, UI, ventas, caja y ecommerce quedan fuera de este closeout.

## CLOSEOUT.R2 validation receipt

La implementación está en el commit `f236c1ce20757b5b856b603601f1db1bea9129b7`, hijo directo del HEAD anterior `a4553540fc362abbcc43a89203c4e437c4a34997`. Los resultados remotos del commit de implementación fueron:

- `PR127 Global Comparison`: PASS — run `33006532881`, job `98301613847`.
- `Shared Terminal Actor Runtime Validation`: PASS — run `33006532889`; gate focalizado `98301614170` y observaciones BASE/CANDIDATE `98301614261`/`98301613884`.
- `Shared Terminal Actor Scoped Storage Validation`: PASS — run `33006532882`; gate focalizado `98301614004` y observaciones BASE/CANDIDATE `98301614052`/`98301613668`.
- `Store Git Runtime Validation`: PASS — run `33006532880`.
- `HOTFIX Dexie Recovery Validation`: PASS — run `33006532923`.
- Check Vercel `Vercel – lanzo-pos`: PASS.

La prueba de contrato Node ejecutada localmente quedó en `8/8`; `git diff --check` pasó para los cuatro archivos del commit. La prueba SQL de contrato está escrita como bloque transaccional con `ROLLBACK`, pero no se ejecutó localmente porque este entorno no tiene `supabase` CLI ni `psql`. El dry-run canónico de migración permanece `BLOCKED_PREMERGE_BY_MAIN_ONLY_WORKFLOW`; no se sustituyó por una aplicación productiva.

Verificación read-only final de Supabase: el último migration aplicado es `20260825233834` (`20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority`); `20260826010000` no está aplicado. `PRODUCTION_APPLIED=NO`, `PRODUCTION_DDL_DML=0`, `FIXTURE_RESIDUE=0`. El PR conserva estado Draft/open/unmerged para revisión independiente.

