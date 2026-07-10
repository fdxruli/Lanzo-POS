# HOTFIX ECOM.ORDERS.1.3 — Runtime y navegación de pedidos

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `hotfix-ecom-orders-1-3`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`

## Estado

`ECOM.ORDERS.1.3` quedó implementado y aplicado en Supabase mediante una migración nueva y controlada.

La validación SQL y runtime real es **PASS**. Las pruebas enfocadas de los archivos modificados son **PASS**. El PR debe permanecer en **draft** porque el entorno disponible no puede clonar GitHub ni reconstruir el checkout completo del repositorio para certificar honestamente todas las suites de regresión y el `npm run build` global sobre la rama final.

No se declara `ECOM.ORDERS.1.3 PASS` hasta completar esa validación global desde un checkout íntegro.

## 1. Causa raíz

Lanzo POS crea el cliente de Supabase con la publishable key y no abre una sesión de Supabase Auth. La identidad operativa se verifica dentro de las RPC mediante:

- licencia;
- fingerprint del dispositivo;
- security token del dispositivo;
- token de sesión staff cuando el dispositivo es staff;
- permisos efectivos;
- feature flags;
- aislamiento por `license_id`;
- rate limit.

Las cinco RPC administrativas de pedidos tenían `EXECUTE` para `authenticated`, pero no para `anon`. PostgREST evaluaba el rol de la publishable key y rechazaba la llamada antes de ejecutar la autorización interna segura.

El mismo desajuste existía en cuatro RPC consumidas directamente por `cloudNotificationService`.

## 2. Grants anteriores

Antes del hotfix se verificó en producción:

### Pedidos ecommerce

Las cinco RPC tenían:

- `anon execute = false`;
- `authenticated execute = true`;
- `PUBLIC execute = false`.

### Centro de Notificaciones

`list_pos_notifications`, `mark_pos_notification_read`, `mark_all_pos_notifications_read` y `archive_pos_notification` tenían `anon execute = false`.

`refresh_operational_notifications` ya permitía `anon` y `authenticated`.

### Superficie privada

Los helpers privados permanecían cerrados y no existían grants directos a roles públicos sobre tablas de pedidos, sesiones, dispositivos o notificaciones.

## 3. Migración nueva

Se creó y aplicó exclusivamente:

```text
supabase/migrations/20260710221500_ecom_orders_1_3_runtime_grants.sql
```

La migración:

- revoca `ALL` de `PUBLIC` sobre cada firma pública aprobada;
- concede `EXECUTE` únicamente a `anon` y `authenticated`;
- reafirma los revokes de helpers privados;
- no modifica cuerpos de funciones;
- no modifica tablas, RLS, datos, pedidos ni notificaciones.

No se editaron las migraciones ya aplicadas de ECOM.ORDERS.1.

La aplicación se realizó mediante el mecanismo controlado `apply_migration`. No se usaron `db push`, `migration repair` ni `--include-all`.

## 4. Grants nuevos verificados

Después de aplicar la migración se verificó:

### RPC de pedidos

Para las cinco firmas exactas:

- `anon execute = true`;
- `authenticated execute = true`;
- `PUBLIC execute = false`.

### RPC de notificaciones

Para las cinco RPC consumidas por el cliente:

- `anon execute = true`;
- `authenticated execute = true`;
- `PUBLIC execute = false`.

### Helpers privados

Para:

- `private.ecommerce_orders_authorize_v1`;
- `private.validate_pos_sync_context`;
- `private.get_pos_notification_context`;
- `private.pos_notification_required_permission_allowed_v1`;
- `private.pos_notification_target_allowed_v1`;

se verificó:

- `anon execute = false`;
- `authenticated execute = false`;
- `PUBLIC execute = false`.

### Tablas

Se verificaron cero grants directos a `anon`, `authenticated` o `PUBLIC` sobre:

- `ecommerce_orders`;
- `ecommerce_order_items`;
- `ecommerce_order_events`;
- `license_staff_users`;
- `license_staff_sessions`;
- `license_devices`;
- `pos_notifications`;
- `pos_notification_reads`.

## 5. Por qué `anon` continúa siendo seguro

El grant permite que PostgREST invoque las RPC, pero no concede acceso libre a los datos.

Las RPC de pedidos continúan llamando la autorización interna que valida:

- licencia activa;
- dispositivo activo y perteneciente a la licencia;
- coincidencia de fingerprint y security token;
- sesión staff válida cuando corresponde;
- permiso `ecommerce=true`;
- feature `ecommerce_order_inbox=true`;
- aislamiento por `license_id`;
- rate limit.

Las RPC de notificaciones continúan validando el contexto custom-auth, el permiso `notifications` y el filtro `required_permission`. Una notificación ecommerce sigue requiriendo `ecommerce=true`.

Ningún helper privado ni tabla quedó expuesto.

## 6. Prueba runtime controlada con `caja1`

Se ejecutó una batería dentro de una sola transacción con `SET LOCAL ROLE anon` y `ROLLBACK` final. Se utilizó una sesión temporal adicional con hash y no se imprimieron tokens.

Resultados:

- admin válido lista pedidos: **PASS**;
- staff `caja1` lista pedidos: **PASS**;
- `caja1` ve `EC-00000010`, `EC-00000011` y `EC-00000012`: **PASS**;
- `caja1` abre el detalle de `EC-00000011`: **PASS**;
- pedido `new` pasa a `seen`: **PASS**;
- aceptar pedido: **PASS**;
- rechazar pedido: **PASS**;
- staff sin sesión: **BLOQUEADO** con `ECOMMERCE_STAFF_SESSION_REQUIRED`;
- staff con `ecommerce=false`: **BLOQUEADO** con `ECOMMERCE_STAFF_PERMISSION_DENIED`;
- pedido de otro `license_id`: **BLOQUEADO** con `ECOMMERCE_ORDER_NOT_FOUND`.

Después del rollback:

- los tres pedidos continuaron en estado `new`;
- `caja1` conservó `ecommerce=true`;
- no quedó ninguna sesión temporal;
- no quedó ningún cambio operativo persistido.

## 7. Centro de Notificaciones

La misma prueba transaccional verificó con rol `anon`:

- listar notificaciones cloud: **PASS**;
- marcar una notificación como leída: **PASS**;
- marcar todas como leídas: **PASS**;
- archivar una notificación: **PASS**;
- refrescar notificaciones operativas: **PASS**;
- una notificación ecommerce contiene una ruta `/pedidos-online?order=...`: **PASS**;
- al retirar temporalmente `ecommerce`, las notificaciones con `required_permission=ecommerce` dejan de aparecer: **PASS**.

Todos los cambios de lectura, archivo y permisos fueron revertidos mediante `ROLLBACK`.

## 8. Diagnóstico seguro del servicio ecommerce

`src/services/ecommerce/ecommerceOrderService.js` ahora:

- registra con `Logger` únicamente `rpcName`, `error.code`, `error.message` y `error.details`;
- no registra licencia, fingerprint, security token, staff token ni argumentos completos;
- mapea PostgREST `42501` a `ECOMMERCE_ORDERS_RPC_ACCESS_DENIED`;
- muestra un mensaje seguro y específico al usuario;
- conserva el error genérico para fallos internos diferentes.

## 9. Navegación desktop

Se eliminó el shortcut flotante y sus estilos.

En el sidebar desktop el orden es:

1. Punto de Venta;
2. Pedidos online;
3. Caja;
4. resto de módulos.

El acceso:

- utiliza `ShoppingBag`;
- usa las clases `nav-link` y la protección existente durante backups;
- depende de `canAccessEcommerceOrders`, no del permiso genérico `orders`;
- muestra badge solo cuando existen pedidos `new`;
- muestra `99+` a partir de 100.

## 10. Navegación móvil

`Pedidos online` no fue agregado al bottom nav.

Se agregó como primera opción del drawer móvil con:

- label `Pedidos online`;
- descripción `Pedidos recibidos desde la tienda`;
- icono `ShoppingBag`;
- badge de nuevos;
- cierre del drawer al navegar;
- active state;
- participación en `isSectionFromMenu`;
- focus trap existente;
- protección de navegación durante backup.

Visibilidad cubierta:

- admin + inbox: visible;
- staff `ecommerce=true`: visible;
- staff `ecommerce=false`: oculto;
- rol `null`: oculto;
- feature inbox deshabilitada: oculto.

## 11. Pruebas frontend enfocadas

Se creó un workspace local reproducible con los archivos modificados y sus dependencias directas.

### ESLint específico

Resultado: **PASS**, sin errores ni warnings, para:

- `Navbar.jsx`;
- pruebas de Navbar;
- `Layout.jsx`;
- prueba de ausencia del shortcut;
- `ecommerceOrderService.js` y su prueba;
- `cloudNotificationService.js` y su prueba.

### Vitest enfocado

Resultado:

```text
4 archivos de prueba PASS
24 pruebas PASS
0 pruebas fallidas
```

Cobertura:

- Navbar desktop y drawer móvil;
- badge 0, número y `99+`;
- matriz admin/staff/rol nulo/feature;
- ausencia en bottom nav;
- cierre del drawer;
- ausencia del shortcut en Layout;
- normalización ecommerce;
- mapeo y logging seguro de `42501`;
- custom-auth de las cinco RPC de notificaciones.

### Build enfocado

Se ejecutó `npm run build` en el workspace enfocado que importa Navbar, servicio ecommerce y servicio de notificaciones.

Resultado: **PASS**.

```text
vite build
1694 módulos transformados
build completado
```

## 12. Validación global pendiente

El entorno de ejecución no puede resolver ni clonar dominios de GitHub. El conector permite leer y modificar archivos, pero no entrega un checkout completo al contenedor.

Por esa limitación no se presenta como ejecutado sobre el repositorio íntegro:

- `npm run build` global;
- la regresión completa de `EcommerceOrdersPage`;
- la regresión completa de `createEcommerceOrderSlice`;
- la regresión completa de `NotificationCenterDrawer`;
- la regresión completa de `notificationRealtimeService`.

Esos módulos no fueron modificados y la validación runtime real de pedidos/notificaciones pasó, pero el criterio exige resultados reproducidos; por eso el PR permanece draft.

## 13. Vercel

Vercel omitido por instrucción explícita.

No se utilizó:

- Vercel CLI;
- API de Vercel;
- agentes de Vercel;
- aliases;
- redeploy;
- preview;
- commits vacíos o archivos artificiales para disparar deployments.

## 14. Estado de cierre

Estado actual:

```text
Runtime RPC: PASS
Staff caja1: PASS
Navegación móvil: PASS en pruebas enfocadas
Navegación desktop: PASS en pruebas enfocadas
Centro de Notificaciones: PASS
Seguridad SQL: PASS
ESLint específico: PASS
Vitest enfocado: PASS — 24 pruebas
Build enfocado: PASS
Build global del checkout completo: PENDIENTE
Vercel: OMITIDO
```

No declarar `ECOM.ORDERS.1.3 PASS` ni marcar el PR ready for review hasta ejecutar la regresión completa y el build global desde un checkout íntegro.

No mergear automáticamente.
