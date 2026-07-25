# ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1

> Actualización PR #128 (2026-07-25): la sección “Corrección de bloqueantes
> confirmados” al final de este documento sustituye los resultados de validación
> y el estado de HEAD descritos por el informe inicial.

## 1. Estado inicial de Git

- Repositorio: `fdxruli/Lanzo-POS`.
- Base solicitada y verificada: `main`.
- El árbol de trabajo estaba limpio antes de iniciar.
- Se consultaron ramas y PR remotos antes de modificar código. El único PR abierto
  con alcance ecommerce relevante fue el PR draft #77, antiguo, con conflictos y
  basado en una implementación previa; no se reutilizó.

## 2. HEAD inicial de `main`

`fe15eb64ef5d7fddc6675b1c5a116082a4fbe41a`

## 3. Rama creada

`fase/ecom-business-capabilities-wholesale-1`

## 4. PR creado

PR [#128](https://github.com/fdxruli/Lanzo-POS/pull/128), creado abierto y
**draft** contra `main`.

## 5. Auditoría inicial de Supabase

Proyecto: `odlrhijtfyavryeqivaa`, PostgreSQL 17.6.1.

Antes del backfill se cuantificó:

| Métrica | Resultado |
|---|---:|
| Portales | 3 |
| Productos publicados activos | 21 |
| Configurables incompatibles | 4 |
| Productos publicados con niveles de mayoreo | 0 |
| Instantáneas de rubro del portal en `NULL` | 2 |
| Perfiles con rubro en `NULL` | 1 |
| Representaciones portal/perfil no reconciliadas | 3 |

Los cuatro incompatibles correspondían al caso observado de Farmacia Gary:
Hamburguesa de pollo, Papas a la francesa, Quesadilla de queso y Taco al pastor.
La identificación fue por reglas generales y relación entre perfil, portal,
producto y configuración; no se codificó el slug, nombre ni ID.

Se revisaron firmas, `SECURITY DEFINER`, `search_path`, grants y definiciones de
`ecommerce_get_catalog`, `ecommerce_get_product_configuration`,
`ecommerce_create_order`, `ecommerce_admin_upsert_published_product_v2` y
`ecommerce_admin_sync_published_catalog_v2`.

## 6. Causa raíz

El POS conservaba correctamente `modifiers`, pero la proyección ecommerce trataba
cualquier arreglo de modificadores como configuración publicable. La publicación,
las lecturas públicas, el checkout y la sincronización PRO no compartían una
política autoritativa basada en el rubro vigente del perfil. El cambio de rubro
tampoco reconciliaba las publicaciones ya creadas.

## 7. Matriz de capacidades

`src/utils/businessCapabilities.js` es la fuente canónica del cliente y las
funciones `private.ecommerce_business_types_for_license` y
`private.ecommerce_business_capabilities` son la contraparte autoritativa de base
de datos.

La resolución usa la unión de uno o varios rubros y expone:

- `supportsRestaurantModifiers`
- `supportsWholesalePricing`
- `supportsVariants`
- `supportsBulkSales`
- `supportsPrescriptionFields`
- `supportsRecipes`

Restaurante, food service, dark kitchen y antojitos permiten modificadores.
Abarrotes, ferretería/hardware y retail/comercio permiten mayoreo. Farmacia
habilita campos de prescripción. Valores desconocidos no inventan capacidades.

## 8. Decisiones de producto

- `business_profiles.business_type` es autoritativo.
- `ecommerce_portals.business_types_snapshot` es una instantánea normalizada.
- Los estados tipados son `compatible`, `requires_review`, `simple_override` y
  `hidden_incompatible`.
- Las razones están restringidas a
  `RESTAURANT_MODIFIERS_NOT_SUPPORTED`, `WHOLESALE_NOT_SUPPORTED`,
  `BUSINESS_TYPE_UNKNOWN` y `BUSINESS_CAPABILITY_CHANGED`.
- Ningún dato original del producto se elimina.
- Un rubro desconocido queda fail-closed y requiere revisión.

## 9. Modelo SQL

Se añadieron campos tipados de capacidad, modo público, razón, revisión y
habilitación de mayoreo a `ecommerce_published_products`, además de la instantánea
de rubros al portal.

Se creó `ecommerce_published_wholesale_tiers` con:

- claves foráneas y guard de pertenencia portal/licencia/producto;
- cantidades mínimas positivas y precios no negativos;
- unicidad por referencia estable y cantidad activa;
- orden, disponibilidad manual/fuente/efectiva y soft delete;
- RLS, índices y revocación de DML directo;
- escritor canónico con validación estructural y protección contra precio inferior
  al costo.

## 10. Migraciones creadas

- `20260725030000_ecom_business_capabilities_wholesale_1.sql`
  - aplicada remotamente como versión `20260725081822`.
- `20260725040000_ecom_business_capabilities_wholesale_1_legacy_writer_guard.sql`
  - aplicada remotamente como versión `20260725082414`.
  - preserva `simple_override` y fuerza hijos incompatibles a soft delete incluso
    cuando escribe un cliente canónico v2 anterior.

No se editó ni renombró ninguna migración histórica.

## 11. Backfill

El backfill fue conservador:

- `wholesale_enabled=false` para todas las publicaciones existentes;
- configuraciones compatibles conservadas;
- configuraciones incompatibles y rubros desconocidos marcados para revisión;
- grupos y opciones públicos retirados por soft delete;
- modificadores, recetas, variantes y datos históricos del POS conservados;
- reconciliación idempotente y revisión de catálogo actualizada bajo el orden de
  locks existente.

Resultado verificado: 14 publicaciones en revisión, 0 publicaciones con mayoreo
activo y 0 niveles públicos preexistentes. Las cuatro publicaciones incompatibles
de Farmacia Gary dejaron de aparecer en el catálogo; sus cuatro fuentes con
modificadores permanecen intactas.

## 12. Comportamiento Free

Se conserva el máximo de 10 productos y la publicación manual. Cada alta o edición
usa la misma política de capacidades y la RPC v3 valida nuevamente en Supabase, por
lo que el frontend no permite evadir la restricción.

## 13. Comportamiento Pro

La sincronización automática proyecta capacidades y mayoreo, respeta
`simple_override`, no restaura extras incompatibles y conserva personalizaciones
manuales. Los guards compensatorios también protegen escrituras de clientes v2.

## 14. Comportamiento multirrubro

La matriz combina capacidades. Un perfil `["abarrotes", "restaurante"]` permite
mayoreo y modificadores; `["abarrotes"]` no publica modificadores de restaurante.

## 15. Publicación como simple

El panel muestra “Publicar sin extras en la tienda online”. Esta decisión:

- conserva los modificadores del POS;
- publica `configuration_type=simple`;
- deja `has_option_groups=false`;
- deja `requires_configuration` sólo si aún existen variantes;
- retira grupos y opciones mediante soft delete;
- no se revierte automáticamente si el rubro vuelve a ser compatible.

## 16. Mayoreo público

La opción individual “Mostrar precios de mayoreo en la tienda online” inicia
desactivada, sólo se ofrece con niveles válidos y rubro compatible, y muestra una
vista previa. La normalización ordena niveles, detecta duplicados, asigna
referencias estables, ignora entradas inválidas y bloquea niveles inferiores al
costo. La tienda muestra niveles y estima el precio alcanzado al cambiar cantidad.

## 17. Checkout autoritativo

`ecommerce_create_order` vuelve a bloquear y leer la publicación, comprueba rubro,
modo y revisión, lee niveles públicos activos y elige el mayor `min_quantity`
alcanzado. Ignora precios, niveles y subtotales del navegador.

El snapshot guarda `pricingMode`, `baseUnitPrice`, `appliedUnitPrice`,
`wholesaleMinQuantity` y `wholesaleTierRef`. La conversión POS existente consume
el `unit_price` ya guardado en el pedido; no recalcula contra el precio actual y la
creación pública del pedido no toca ventas, caja ni inventario.

## 18. Seguridad

- RLS habilitado en la tabla de niveles.
- Sin DML directo para `PUBLIC`, `anon`, `authenticated` ni `service_role`.
- Funciones nuevas con `search_path=''`.
- Escritores `SECURITY DEFINER` limitados a funciones canónicas con autorización
  interna.
- Guards de aislamiento por licencia y referencias cruzadas.
- Lectura pública filtrada por capacidad y disponibilidad.
- Checkout rechaza configuraciones antiguas, revisiones obsoletas y referencias
  incompatibles.
- No se usa `user_metadata` para autorización.

Los advisors mostraron avisos heredados de tablas con RLS sin políticas directas y
avisos informativos de índices nuevos aún no utilizados; la tabla nueva se escribe
y lee exclusivamente por RPC canónica.

## 19. Locks

Se conservó el protocolo `portal → padres ordenados → hijos`. La reconciliación
bloquea portal y padres antes de escribir hijos; no se añadió un escritor paralelo
ni una inversión del orden.

## 20. Pruebas SQL

`supabase/tests/ecom_business_capabilities_wholesale_1_test.sql` ejecuta 24
aserciones dentro de `BEGIN/ROLLBACK`: rubros simple/múltiple/desconocido, cambio de
rubro, ocultamiento, checkout, `simple_override`, soft delete, idempotencia,
revisiones, mayoreo apagado/activo y límites, duplicados, precios inválidos/costo,
payload manipulado, snapshot, cross-license, grants y residuos.

Resultado: **24/24 PASS**, ejecutado dos veces. Verificación posterior:
`test_tiers=0`, `wholesale_enabled=0`; no quedaron residuos de fixtures.

## 21. Pruebas JavaScript

- Suite focal nueva y de servicios: **38/38 PASS** en 5 archivos.
- Regresión focal de tienda, checkout, conversión POS, pedidos, modificadores,
  pricing y product mapper: **97/97 PASS** en 8 archivos.
- Una novena suite focal (`ecommerceCatalogSyncService.test.js`) no inicia por un
  mock heredado de `createEcommercePublishedStockAlertService`; se reprodujo igual
  sobre el HEAD inicial de `main`.
- `npm run test:ci`: **185 archivos / 1277 pruebas PASS**, **70 archivos / 124
  pruebas FAIL**, **59 skipped**. Los fallos globales incluyen mocks incompletos,
  suites sin entorno DOM, dependencias de prueba ausentes y artefactos requeridos
  fuera de orden; no se declara PASS global.

## 22. Lint

- ESLint focal de todos los archivos modificados: PASS.
- `npm run lint`: FAIL, 383 problemas (159 errores y 224 warnings).
- El mismo resultado exacto, 383/159/224, se reprodujo en el HEAD inicial de
  `main`; es deuda heredada.

## 23. Builds

- `npm run build`: PASS.
- `npm run build:store`: PASS.
- `npm run build:store:vercel`: PASS después de retirar de forma recuperable el
  artefacto previo que provocaba `EEXIST`; estado `staged`, `deployed=false`.
- `git diff --check`: PASS.

## 24. Deuda heredada

El lint global y numerosas suites globales ya fallan en `main`. Se documentó la
reproducción exacta del lint y del mock ecommerce representativo. No se amplió la
fase para corregir deuda ajena.

## 25. Archivos modificados

- Política y mayoreo: `src/utils/businessCapabilities.js`,
  `src/utils/ecommerceWholesalePricing.js`.
- Servicios: admin, sincronización base, servicio público y caché pública.
- UI: ajustes de portal, modal de publicación, catálogo y carrito públicos.
- Carrito: estimación por cantidad y subtotal.
- Pruebas: utilidades, carrito, admin, sincronización y SQL transaccional.
- Dos migraciones compensatorias nuevas.
- Este reporte.

## 26. Commits

- `8edf5b788c7c7a51375def38ca6f37a5e88cb283` —
  `feat(ecommerce): add rubro capabilities and public wholesale`
- `24cb777d2a747abbaf40888a9ae650729b399749` —
  `feat(supabase): enforce capabilities and wholesale checkout`
- `68ce7dd7f971368b3269908bca685f2722ec2729` —
  `test(ecommerce): cover rubro and wholesale contracts`
- `717fcef2573c35d7f8553470df53d22eeecea6c2` —
  `docs(ecommerce): report capabilities wholesale phase`

## 27. HEAD final

HEAD de implementación con el que se creó el PR:
`717fcef2573c35d7f8553470df53d22eeecea6c2`. Este informe recibe un último
commit documental para registrar el número y estado del PR; el HEAD efectivo de
la rama se confirma en el resumen de cierre.

## 28. Estado final del PR

PR #128 abierto, draft, no fusionado y sin auto-merge.

## 29. Pendientes de validación manual

- Recorrido visual con una sesión real Free y una PRO.
- Activación manual de `simple_override` y mayoreo en un producto de prueba.
- Confirmación de texto/espaciado en viewport móvil.
- Conversión completa de un pedido de prueba con mayoreo a venta POS, sin usar
  datos reales de caja, inventario o ventas.

## 30. Confirmaciones operativas

- No se hizo merge.
- No se activó auto-merge.
- No se ejecutó despliegue manual de Vercel.
- No se creó preview manual, ni se cambiaron dominios, aliases o secretos.

## Corrección de bloqueantes confirmados del PR #128

### Estado auditado

- HEAD de `main`: `fe15eb64ef5d7fddc6675b1c5a116082a4fbe41a`.
- HEAD inicial auditado del PR: `e203e01f47983e92067b8c5f092978703ce1e7b5`.
- Rama: `fase/ecom-business-capabilities-wholesale-1`.
- PR #128: abierto, draft, base `main`, sin auto-merge.
- No existían commits posteriores al HEAD auditado al iniciar esta corrección.
- El workflow comparativo remoto `PR127 Global Comparison` fallaba con cuatro
  regresiones exclusivas: dos mocks del modal y dos degradaciones apparel.

### Correcciones

- La proyección recibe el perfil/capacidades explícitamente. Un perfil ausente o
  desconocido preserva configuración fuente y variantes, conserva
  `variant_parent` y queda fail-closed para disponibilidad pública.
- La política separa compatibilidad de configuración, mayoreo y variantes.
  Mayoreo no soportado se deshabilita con advertencia, sin retirar extras válidos
  ni marcar por sí solo el producto completo para revisión.
- La fórmula común es `base mayoreo o estándar + ajuste de variante con signo +
  opciones`, redondeada a dos decimales y limitada sólo al precio final no
  negativo. El snapshot autoritativo incluye base mayoreo, tier, mínimo y ambos
  ajustes.
- Los niveles sin referencia usan `min:<cantidad>`. Desactivar sólo retira niveles
  activos; sincronizaciones desactivadas repetidas no insertan tombstones, no
  cambian timestamps ni revisiones. Reactivar reutiliza la identidad lógica bajo
  el lock del padre.
- Las RPC v3 releen `catalog_revision` después de todos los escritores y devuelven
  esa revisión final.
- Los guards privados y escritores auxiliares quedaron sin `EXECUTE` para
  `PUBLIC`, `anon`, `authenticated` y `service_role`, con propietario `postgres`
  y `search_path=''`.

### Migración compensatoria

- Archivo:
  `20260725190000_ecom_business_capabilities_wholesale_1_blockers_fix.sql`.
- Registro remoto Supabase:
  `20260725131157_ecom_business_capabilities_wholesale_1_blockers_fix`.
- Aplicada al proyecto `odlrhijtfyavryeqivaa`.
- No se editaron las migraciones aplicadas `20260725030000` ni `20260725040000`.
- La tabla de tiers permanece con RLS y deny-all por ausencia de políticas y DML
  revocado. El advisor mantiene el aviso informativo
  `rls_enabled_no_policy`; es intencional.

### Validación ejecutada

- Suites focales obligatorias y regresiones apparel/modal: **9 archivos,
  62/62 pruebas PASS**.
- ESLint focal de todos los archivos JavaScript modificados: **PASS**.
- `git diff --check`: **PASS**.
- Build administrativo: **PASS**.
- Build tienda: **PASS**.
- Build Vercel de tienda: **PASS**, sin despliegue.
- SQL transaccional de la fase: **PASS** con `BEGIN/ROLLBACK`, incluyendo
  activado/desactivado/reactivado, conteos estables, revisiones sin cambio,
  preservación de modificadores y permisos.
- Verificación remota posterior: 0 tiers reales, 0 fixtures/residuos.
- `npm run test:ci` del PR: **FAIL heredado/global**, 64 archivos y 117 pruebas
  fallidas; 191 archivos y 1298 pruebas pasaron, 59 omitidas.
- `npm run test:ci` de `main`: **FAIL heredado/global**, 67 archivos y 124 pruebas
  fallidas; 186 archivos y 1276 pruebas pasaron, 59 omitidas.
- Comparación remota normalizada del HEAD de implementación
  `e07b8b3afb1863e801290e4758dac931f067a612`: workflow
  `PR127 Global Comparison` #51, run `30159562706`, **PASS**.
  El artefacto `pr127-global-comparison-e07b8b3...` registró 148 fallos
  compartidos, **0 fallos exclusivos del PR** y 1 fallo heredado resuelto.
  Por tanto, `PR-only failures = 0`.

La suite histórica `ecom_products_model_1_1_test.sql` falla bajo la política
fail-closed vigente porque su fixture no crea `business_profiles`; espera que un
perfil ausente sea públicamente compatible. Esa expectativa contradice el contrato
confirmado de esta corrección y no se relajó.

### Archivos de esta corrección

- `src/utils/businessCapabilities.js`
- `src/utils/ecommerceWholesalePricing.js`
- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/ecommerceCatalogSyncServiceBase.js`
- `src/hooks/ecommerce/usePublicCart.js`
- pruebas focales de capacidades, pricing, apparel y modal
- `supabase/tests/ecom_business_capabilities_wholesale_1_test.sql`
- migración compensatoria indicada arriba
- este reporte

### Estado operativo

- Commit de implementación remoto:
  `e07b8b3afb1863e801290e4758dac931f067a612` —
  `fix(ecommerce): resolve wholesale capability blockers`.
- El HEAD final incluye este cierre documental; su SHA autoritativo es el
  `head_sha` del PR #128 y se informa en la entrega final.
- No se creó otro PR.
- No se modificó `main`.
- No se hizo merge ni se activó auto-merge.
- No se marcó el PR como ready.
- No se desplegó ni se creó preview manual de Vercel.
