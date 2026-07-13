# ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido

## Estado

**Implementación funcional y migraciones terminadas. Validación local y manual pendiente. El PR debe permanecer draft. No mergear.**

- Repositorio: `fdxruli/Lanzo-POS`
- HEAD inicial verificado de `main`: `c5d38b43f92b936c195f677fbd30a062091bbcb9`
- Precondición: PR `#93` confirmado como mergeado en ese HEAD
- Rama creada: `fase-ecom-orders-2`
- Base exacta de la rama: `c5d38b43f92b936c195f677fbd30a062091bbcb9`
- PR: `#94 — FASE ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido`
- URL: `https://github.com/fdxruli/Lanzo-POS/pull/94`
- Estado del PR: **draft**
- Vercel manual: **no utilizado**
- Preview/deployment manual: **no creado, promovido, redeployado ni abierto para validación**
- Integración automática de GitHub/Vercel: emitió un check remoto; no fue disparado ni utilizado como sustituto del build local
- Merge: **no realizado**
- `supabase migration repair`: **no utilizado**

## Arquitectura de tracking

Se implementó un token opaco determinístico firmado con HMAC-SHA-256:

1. secreto aleatorio de 32 bytes, versionado por portal, en `private.ecommerce_order_tracking_keys`;
2. material firmado compuesto por `order_id`, `portal_id` y versión de clave, utilizado exclusivamente server-side;
3. token `trk1_<base64url-hmac>` de alta entropía;
4. almacenamiento exclusivo de `SHA-256(token)` y `token_last4` en `private.ecommerce_order_tracking_tokens`;
5. recomputación con la versión de clave registrada para devolver exactamente el mismo token en reintentos idempotentes;
6. revocación con `revoked_at` y expiración opcional con `expires_at`;
7. el token plano no se guarda en tablas, metadata, eventos, notificaciones ni logs.

El checkout conserva la RPC canónica `ecommerce_create_order(...)`. Solo se amplió el helper privado que forma su respuesta para devolver:

- `trackingToken`
- `trackingPath`
- `trackingVersion`

La misma orden recuperada por `idempotency_key` vuelve a calcular el mismo token y la misma URL.

## Modelo de estados

Campos aditivos en `public.ecommerce_orders`:

- `fulfillment_status`
- `fulfillment_version`
- `fulfillment_updated_at`
- `public_status_message`

Estados operativos:

- `accepted`
- `preparing`
- `ready`
- `out_for_delivery`
- `completed`
- `cancelled`
- `attention`

Transiciones permitidas server-side:

- `accepted → preparing`
- `preparing → ready`
- `ready → completed` para pickup
- `ready → out_for_delivery` para delivery
- `out_for_delivery → completed` para delivery
- `accepted|preparing|ready|out_for_delivery → cancelled`

La versión esperada y la llave idempotente se validan dentro de la RPC administrativa. Una repetición de la misma transición con la misma llave devuelve el resultado existente sin crear otro evento. Una versión anterior devuelve `ECOMMERCE_ORDER_STATUS_STALE`.

## Independencia respecto al POS

No se modificaron:

- `processSale`
- reservas
- FEFO
- locks de checkout
- `checkoutAttemptId`
- `conversionKey`
- movimientos de inventario
- movimientos de caja
- confirmación remota

Durante la revisión se detectó que el cobro canónico cambia el estado base a `converted_to_sale` y archiva la orden. Se corrigió de forma aditiva para que:

- el fulfillment siga siendo independiente después del pago;
- `converted_to_sale` no equivalga a entregado;
- pedidos convertidos no terminales permanezcan visibles en la bandeja operativa;
- las RPC POS continúen exigiendo sus guards originales (`accepted`, visibilidad activa y ausencia de conversión);
- al llegar a `completed` o `cancelled`, el pedido convertido deje de mostrarse como operativo.

Los tres pedidos convertidos existentes se inicializaron conservadoramente en `accepted`; ninguno fue marcado automáticamente como completado.

## Contratos RPC

### Pública

`public.ecommerce_get_order_tracking(p_slug text, p_tracking_token text)`

- `SECURITY DEFINER`
- `SET search_path = ''`
- owner `postgres`
- validación estricta de formato
- lookup por hash
- aislamiento por portal/licencia
- payload público allowlisted
- error uniforme para token inválido, slug incorrecto, token revocado o pedido inexistente
- no devuelve PII, IDs internos, token, claims ni datos de inventario/costos
- `anon` y `authenticated` solo reciben `EXECUTE` sobre la función, no acceso a tablas

### Administrativa

`public.ecommerce_admin_update_order_fulfillment(...)`

- reutiliza `private.ecommerce_orders_authorize_v1(...)`;
- valida licencia, dispositivo, security token, staff session y permiso ecommerce;
- bloquea otro `license_id` y otro portal;
- usa lock de fila, versión esperada y llave idempotente;
- valida modalidad pickup/delivery server-side;
- mensaje público de texto plano, máximo 280 caracteres, sin `<` ni `>`;
- registra un evento privado versionado y un evento administrativo sin secretos.

`public.ecommerce_admin_get_order(...)` continúa siendo la lectura administrativa canónica y ahora adjunta el objeto `fulfillment`.

## Realtime y actualización pública

- FREE: botón Actualizar, revalidación al recuperar foco/conexión y polling visible cada 45 segundos.
- PRO: canal privado derivado de una huella SHA-256 del token, nunca del `order_id`.
- El payload realtime solo contiene una señal de cambio, motivo general y versión.
- Todo evento realtime dispara una nueva lectura de `ecommerce_get_order_tracking`; nunca se confía en el payload como estado verdadero.
- La política de `realtime.messages` valida que el topic corresponda a un hash activo/no revocado y que la licencia tenga `ecommerce_realtime_orders`.

## Rate limits

La RPC pública reutiliza `enforce_pos_rpc_rate_limit_v2`:

- scope: `ECOMMERCE_ORDER_TRACKING`
- máximo: `120` consultas
- ventana: `600` segundos
- bloqueo: `300` segundos
- la identidad del bucket usa licencia y huella parcial del token, no el token plano.

Las RPC administrativas conservan el rate limit y contexto de autorización centralizados en `private.ecommerce_orders_authorize_v1`.

## Grants y revocaciones

- tablas `private.ecommerce_order_tracking_keys`, `private.ecommerce_order_tracking_tokens` y `private.ecommerce_order_fulfillment_events`: RLS habilitado y cero grants directos a `anon`/`authenticated`;
- helpers privados: revocados para `PUBLIC`, `anon` y `authenticated`;
- `ecommerce_get_order_tracking`: `EXECUTE` para `anon` y `authenticated`;
- `ecommerce_admin_update_order_fulfillment`: `EXECUTE` para `anon` y `authenticated`, con autenticación propia obligatoria dentro de la RPC;
- función de autorización realtime: `EXECUTE` para `anon` y `authenticated`;
- owners verificados como `postgres`;
- funciones críticas verificadas con `SECURITY DEFINER` y `search_path=''`.

## Archivos modificados

- `reports/ecom_orders_2_public_tracking_and_fulfillment_report.md`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.css`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.jsx`
- `src/components/ecommerce/orders/EcommerceOrdersRuntime.jsx`
- `src/components/ecommerce/public/PublicOrderConfirmation.jsx`
- `src/pages/PublicOrderTrackingPage.css`
- `src/pages/PublicOrderTrackingPage.jsx`
- `src/router/__tests__/publicOrderTrackingRouting.test.js`
- `src/router/isPublicStorePath.js`
- `src/router/publicStoreRoutes.jsx`
- `src/services/ecommerce/__tests__/ecommerceOrderFulfillmentService.test.js`
- `src/services/ecommerce/__tests__/ecommerceOrderTrackingService.test.js`
- `src/services/ecommerce/__tests__/ecommercePublicTrackingContract.test.js`
- `src/services/ecommerce/ecommerceOrderFulfillmentService.js`
- `src/services/ecommerce/ecommerceOrderTrackingService.js`
- `src/services/ecommerce/ecommercePublicService.js`
- `supabase/migrations/20260712235439_ecom_orders_2_tracking_schema.sql`
- `supabase/migrations/20260712235807_ecom_orders_2_tracking_rpc.sql`
- `supabase/migrations/20260713000133_ecom_orders_2_fulfillment_state_machine.sql`
- `supabase/migrations/20260713000326_ecom_orders_2_grants_realtime_hardening.sql`
- `supabase/migrations/20260713002329_ecom_orders_2_conversion_independence_hardening.sql`
- `supabase/migrations/20260713003008_ecom_orders_2_converted_fulfillment_visibility.sql`
- `supabase/tests/ecom_orders_2_public_tracking_and_fulfillment_test.sql`

## Migraciones

### Migración 1

**Migración**

`20260712235439_ecom_orders_2_tracking_schema.sql`

**Objetivo**

Crear columnas operativas, tablas privadas de claves/tokens/eventos, constraints, índices, RLS, trigger inicial y backfill conservador de aceptados.

**Precondiciones**

- HEAD y PR #93 verificados.
- `pgcrypto` disponible en `extensions`.
- timestamp inexistente local y remotamente.
- SQL completo revisado.
- preflight `BEGIN/ROLLBACK`: PASS.

**SQL aplicado**

Aplicado mediante migración versionada; no se ejecutó SQL DDL improvisado fuera del archivo.

**Resultado**

PASS.

**Historial remoto**

`20260712235439 — ecom_orders_2_tracking_schema` confirmado.

**Verificaciones**

- columnas/defaults;
- constraints validados;
- índices;
- tablas privadas y RLS;
- owner/search path del trigger;
- cero grants directos;
- aceptados sin fulfillment: `0`;
- pedidos no aceptados backfilled en ese momento: `0`.

**Riesgos**

Backfill conservador; ningún pedido fue marcado completado.

**Rollback disponible**

DDL aditivo reversible con migración compensatoria. No se ejecutó rollback destructivo.

### Migración 2

**Migración**

`20260712235807_ecom_orders_2_tracking_rpc.sql`

**Objetivo**

Generación HMAC determinística, hash/lookup/revocación, contrato idempotente del checkout y RPC pública.

**Precondiciones**

- migración 1 verificada;
- timestamp inexistente;
- SQL completo revisado.

**SQL aplicado**

Aplicado mediante migración versionada.

**Resultado**

PASS después de corregir un preflight fallido.

**Incidente documentado**

El primer preflight falló porque PostgreSQL no admite combinar una variable `%rowtype` con otra variable en el mismo `INTO`. La transacción hizo `ROLLBACK`; no hubo cambios persistentes ni entrada de historial. La secuencia se detuvo, se corrigieron las dos lecturas y el preflight posterior pasó antes de aplicar.

**Historial remoto**

`20260712235807 — ecom_orders_2_tracking_rpc` confirmado.

**Verificaciones**

- token y URL estables en repetición;
- token plano no almacenado;
- payload sin campos prohibidos ni token reflejado;
- token inválido, slug incorrecto y token revocado devuelven el mismo not found;
- grants y owners correctos.

**Riesgos**

Rotación futura de claves debe conservar versiones antiguas mientras existan tokens activos.

**Rollback disponible**

Migración compensatoria para revocar RPC/helpers, preservando pedidos.

### Migración 3

**Migración**

`20260713000133_ecom_orders_2_fulfillment_state_machine.sql`

**Objetivo**

Implementar la máquina de estados server-side, versión esperada, idempotencia y payload operativo administrativo.

**Precondiciones**

- migraciones 1 y 2 verificadas;
- timestamp inexistente;
- preflight transaccional PASS.

**SQL aplicado**

Aplicado mediante migración versionada.

**Resultado**

PASS.

**Historial remoto**

`20260713000133 — ecom_orders_2_fulfillment_state_machine` confirmado.

**Verificaciones**

- transiciones permitidas y bloqueadas;
- lock de fila;
- `expected_version` stale;
- `idempotency_key` única por pedido;
- mensaje público limitado;
- autorización administrativa centralizada.

**Riesgos**

La ruta happy-path completa con una sesión staff real no se ejecutó desde SQL para evitar reutilizar o fabricar credenciales productivas.

**Rollback disponible**

Reemplazo de RPC y eliminación compensatoria de estructuras sin tocar ventas/inventario.

### Migración 4

**Migración**

`20260713000326_ecom_orders_2_grants_realtime_hardening.sql`

**Objetivo**

Configurar topic privado, autorización realtime, broadcast como señal y hardening final de grants/owners.

**Precondiciones**

- migración 3 verificada;
- timestamp inexistente;
- preflight transaccional PASS.

**SQL aplicado**

Aplicado mediante migración versionada.

**Resultado**

PASS.

**Historial remoto**

`20260713000326 — ecom_orders_2_grants_realtime_hardening` confirmado.

**Verificaciones**

- policy de broadcast privado;
- topic no reversible derivado del hash;
- feature PRO obligatoria;
- broadcast sin PII ni IDs internos;
- RPC pública sigue siendo fuente de verdad;
- grants/revocaciones y owners.

**Riesgos**

Realtime requiere validación manual con un navegador PRO; el fallback por polling permanece disponible.

**Rollback disponible**

Eliminar policy/trigger y mantener polling/RPC pública.

### Migración 5

**Migración**

`20260713002329_ecom_orders_2_conversion_independence_hardening.sql`

**Objetivo**

Permitir que fulfillment continúe después de `converted_to_sale`, manteniendo pago y entrega como conceptos separados.

**Precondiciones**

- revisión del contrato POS y constraints actuales;
- timestamp inexistente;
- preflight transaccional con assertions PASS.

**SQL aplicado**

Aplicado mediante migración versionada.

**Resultado**

PASS.

**Historial remoto**

`20260713002329 — ecom_orders_2_conversion_independence_hardening` confirmado.

**Verificaciones**

- fulfillment tiene prioridad en la proyección pública;
- fallback conservador de `converted_to_sale` es `accepted`;
- la RPC administrativa permite base `accepted` o `converted_to_sale`;
- no se modificó la conversión POS.

**Riesgos**

Se necesitaba además conservar visibilidad operativa de órdenes archivadas; se resolvió en migración 6.

**Rollback disponible**

Reemplazar las dos funciones con la versión anterior; no requiere modificar ventas.

### Migración 6

**Migración**

`20260713003008_ecom_orders_2_converted_fulfillment_visibility.sql`

**Objetivo**

Backfill conservador de convertidos históricos y visibilidad administrativa solo mientras fulfillment sea no terminal.

**Precondiciones**

- guards POS revisados: claim/confirm/release mantienen validaciones propias y bloquean convertidos;
- timestamp inexistente;
- SQL completo revisado;
- preflight transaccional PASS.

**SQL aplicado**

Aplicado mediante migración versionada.

**Resultado**

PASS.

**Historial remoto**

`20260713003008 — ecom_orders_2_converted_fulfillment_visibility` confirmado.

**Verificaciones**

- convertidos sin fulfillment: `0`;
- convertidos inicializados en otro estado distinto de accepted: `0`;
- tres convertidos históricos inicializados en `accepted`;
- snapshot/listado amplían únicamente lectura operativa de convertidos archivados no terminales;
- claim/confirm/release POS siguen bloqueados por sus guards canónicos;
- owner, `SECURITY DEFINER`, `search_path` y grants verificados.

**Riesgos**

Los pedidos históricos convertidos aparecen como aceptados para resolución manual, porque no existe evidencia segura para marcarlos completados automáticamente.

**Rollback disponible**

Migración compensatoria para restaurar filtros de lectura; el backfill puede conservarse sin afectar venta/inventario.

## Historial local y remoto

Los seis archivos locales usan exactamente los timestamps confirmados en el historial remoto:

1. `20260712235439`
2. `20260712235807`
3. `20260713000133`
4. `20260713000326`
5. `20260713002329`
6. `20260713003008`

No se alteró ningún timestamp después de aplicar. No se utilizó `migration repair` ni se editó manualmente el historial remoto.

## Pruebas SQL ejecutadas

Ejecutadas dentro de `BEGIN`/`ROLLBACK`:

- token válido + slug correcto;
- token inválido;
- slug incorrecto;
- token revocado;
- token y URL idempotentes;
- payload allowlisted sin PII/IDs/token;
- transiciones pickup válidas;
- transiciones delivery válidas;
- bloqueo de new/rejected/completed/cancelled y pickup→out_for_delivery;
- proyección de `converted_to_sale` independiente del fulfillment;
- backfill de convertidos;
- llamada administrativa sin contexto autenticado bloqueada.

Resultado consolidado: **PASS**.

No se crearon pedidos persistentes mediante SQL directo. Las pruebas no dejaron tokens, eventos ni cambios de estado persistentes.

Pendiente por falta de un fixture seguro con sesión productiva real:

- happy-path completo de la RPC administrativa con staff válido;
- repetición idempotente de una transición real;
- carrera real de dos sesiones autenticadas.

## Pruebas frontend agregadas

Archivos:

- `ecommerceOrderTrackingService.test.js`
- `ecommerceOrderFulfillmentService.test.js`
- `ecommercePublicTrackingContract.test.js`
- `publicOrderTrackingRouting.test.js`

Cobertura escrita:

- contrato del enlace tras checkout idempotente;
- normalización allowlisted;
- token no reflejado ni registrado en consola;
- cache en sessionStorage bajo clave opaca derivada;
- error uniforme;
- realtime solo como señal;
- pickup no ofrece En camino;
- delivery sí ofrece En camino;
- acciones continúan tras `converted_to_sale`;
- terminales no ofrecen acciones;
- expected version e idempotency key enviados a la RPC;
- fail-closed sin contexto staff/dispositivo;
- clasificación de la ruta pública.

Estado de ejecución: **pendiente**. El entorno disponible no expone un checkout ejecutable del repositorio ni binarios instalados de Vitest/ESLint/Vite.

## Validación local

No fue posible ejecutar de forma honesta:

- `npm ci`
- ESLint enfocado
- Vitest enfocado
- suites de checkout/bandeja/servicio
- `npm run build`
- `git diff --check`
- `git status --short`

Motivo: el entorno de ejecución no pudo clonar/descargar un checkout completo del repositorio y no contiene sus dependencias. Los intentos de obtener el repositorio por red/archive no produjeron un checkout utilizable.

No se utilizó Vercel para sustituir estas validaciones. El check automático de la integración remota no se declara como build local ni como PASS global.

## Revisión del diff

- lista completa de 23 archivos revisada;
- no se modificaron archivos del flujo canónico de cobro;
- no se añadieron `.skip`, `.todo`, `eslint-disable` ni mocks para ocultar defectos;
- no se añadieron workflows temporales;
- no se hicieron commits vacíos;
- el token no se registra en consola ni en almacenamiento global persistente;
- el cache público contiene solo payload allowlisted.

## Fallos y correcciones durante la implementación

1. Preflight de migración 2: error SQL de `INTO` con `%rowtype`; rollback completo, corregido antes de aplicar.
2. Revisión de integración POS: fulfillment inicialmente quedaba bloqueado tras `converted_to_sale`; corregido con migración 5.
3. Revisión de bandeja: convertidos archivados no podían completar entrega; corregido con migración 6, sin ampliar operaciones POS.
4. Frontend: panel inicialmente oculto para `converted_to_sale`; corregido.
5. Frontend: clase destructiva no definida; sustituida por una clase local explícita.

No se ocultaron reintentos ni diferencias de historial.

## Pruebas manuales

Pendientes en desarrollo local:

- pickup completo;
- delivery completo;
- token alterado/slug incorrecto/revocado en navegador;
- sesión privada;
- dos dispositivos y carrera stale;
- FREE polling/offline;
- PRO realtime como señal;
- responsive en 320×568, 360×800, 390×844, 768×1024, 1024×768 y 1440×900;
- regresión checkout/WhatsApp/bandeja/POS/cobro/inventario/venta.

## Riesgos pendientes

- ejecución real de Vitest y ESLint;
- build local Vite;
- pruebas manuales de los dos flujos;
- validación visual/accessibility en tamaños requeridos;
- concurrencia con dos sesiones reales;
- revisión funcional, técnica y de seguridad por una segunda persona.

## Estado del PR

- PR `#94` creado como draft.
- No está ready for review.
- No fue mergeado.
- No se declarará PASS global mientras las validaciones locales y manuales sigan pendientes.
