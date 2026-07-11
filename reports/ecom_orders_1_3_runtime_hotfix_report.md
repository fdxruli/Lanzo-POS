# HOTFIX ECOM.ORDERS.1.3 — Runtime y navegación de pedidos

- Fecha de implementación: 2026-07-10
- Fecha de validación global: 2026-07-10 (`America/Merida`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `hotfix-ecom-orders-1-3`
- HEAD funcional inicial validado: `9fec4f4b2c491e7e548ef739780bfedd92d2627a`
- Base `origin/main`: `cecfdd8f735e33fa6cf70359e173451e9c4b7ad5`
- HEAD final validado: el commit de la rama que contiene este reporte; su SHA exacto se publica en la descripción del PR #86 después del push
- Node.js: `v24.14.0`
- npm: `11.9.0`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`

## Estado

`ECOM.ORDERS.1.3` quedó implementado y aplicado en Supabase mediante una migración nueva y controlada.

La validación SQL/runtime previamente completada es **PASS**. La validación global posterior se ejecutó sobre un checkout íntegro del repositorio, con la rama y base correctas, dependencias instaladas desde el lockfile y comparación directa contra un worktree limpio de `origin/main`.

Resultado: **ECOM.ORDERS.1.3 VALIDACIÓN GLOBAL PASS**. No se detectaron regresiones nuevas atribuibles al PR #86.

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

## 11. Preparación reproducible del checkout

Se ejecutó sobre un clone completo, no shallow y sin sparse checkout:

```text
git fetch origin
git checkout hotfix-ecom-orders-1-3
git pull --ff-only origin hotfix-ecom-orders-1-3
```

Se confirmó:

- rama correcta;
- árbol limpio antes de validar;
- HEAD remoto del PR #86;
- `origin/main` y merge-base en `cecfdd8f735e33fa6cf70359e173451e9c4b7ad5`;
- base con el PR #85 ya integrado.

`npm ci`: **PASS**, 675 paquetes instalados desde `package-lock.json`.

La caché de npm se dirigió a `/tmp` porque la caché predeterminada del contenedor no era escribible. No se actualizó ninguna dependencia y `package.json`/`package-lock.json` permanecieron sin cambios. El warning de engine de `react-zxing@2.1.0` bajo Node 24 aparece igual en ambos checkouts y no impidió instalación, pruebas ni build.

## 12. ESLint específico

Resultado: **PASS**, 0 errores y 0 warnings de ESLint, para toda la superficie JavaScript/JSX modificada:

- `Navbar.jsx`;
- `Layout.jsx`;
- pruebas de Navbar y Layout;
- `ecommerceOrderService.js` y su prueba;
- prueba de `cloudNotificationService`.

También pasó ESLint después de reforzar la prueba de Navbar con aserciones del focus trap y del bloqueo durante backup. No se agregaron desactivaciones de reglas.

## 13. Vitest específico y regresiones relacionadas

### Hotfix

```text
4 suites PASS
25 pruebas PASS
0 fallos
```

La matriz cubre navegación desktop/móvil, drawer, bottom nav, badges, permisos fail-closed, shortcut eliminado, error `42501`, logging seguro y custom-auth de notificaciones.

### Ecommerce

Se ejecutaron todas las suites encontradas con `ecommerce`, además de la ruta pública del catálogo/checkout:

```text
17 suites PASS
123 pruebas PASS
0 fallos
```

Incluye bandeja, capacidades, aislamiento, respuestas tardías, carreras de filtro/detalle, cierre de detalle, `markSeen`, aceptar/rechazar, carrito, catálogo paginado, checkout e idempotencia.

### Centro de Notificaciones

Se ejecutaron todas las suites existentes localizadas por `notification|support` que ejercen la superficie solicitada:

```text
5 suites PASS
18 pruebas PASS
0 fallos
```

Incluye listar, marcar leída, marcar todas, archivar, refresh operativo, `required_permission=ecommerce`, deep link y reutilización del listener realtime.

No existen en este checkout suites adicionales con nombre o referencia a `NotificationCenterDrawer`, `NotificationTabs`, `createNotificationSlice` o soporte que amplíen esa matriz.

### Navegación

La matriz directamente relacionada con el hotfix quedó en:

```text
5 suites PASS
30 pruebas PASS
0 fallos
```

Además de los casos del hotfix, se validaron Escape, overlay, focus trap completo, retorno de foco, bloqueo durante backup y acciones de respaldo FREE/PRO. Los guards no modificados de Caja, Pedidos-Rest., Productos, Clientes, Reportes, Configuración y Acerca de se conservaron en el diff.

La búsqueda amplia también localizó dos suites heredadas sin anotación jsdom: `Navbar.backupPro.test.jsx` y `useNavigationGuard.test.jsx`. Con la configuración predeterminada producen 10 fallos por ausencia de `document` tanto en `main` como en el PR. La primera se ejecutó adicionalmente con su entorno DOM correcto y pasó 2/2. No se modificó configuración global ni código ajeno al hotfix para ocultar este baseline.

## 14. Build global real

`npm run build`: **PASS**.

```text
vite build
3283 módulos transformados
chunks y CSS generados
PWA generateSW completado
exit code 0
```

No hubo imports o estilos faltantes. `NavbarEcommerce.css` resolvió correctamente. Las únicas referencias textuales a `EcommerceOrdersNavShortcut` y `ecommerce-orders-nav-shortcut` están en la prueba que exige su ausencia; no quedan referencias productivas.

No se utilizó un build enfocado ni un preview de Vercel como evidencia.

## 15. Línea base global contra `main`

Se creó un worktree limpio en `origin/main` y se ejecutaron los mismos comandos con el mismo lockfile, Node y npm.

### `npm run lint`

| Checkout | Errores | Warnings | Resultado |
| --- | ---: | ---: | --- |
| `origin/main` | 156 | 226 | baseline heredado |
| PR #86 | 156 | 226 | 0 nuevos |

### `npm run test:ci`

| Checkout | Suites fallidas | Pruebas fallidas | Suites PASS | Pruebas PASS |
| --- | ---: | ---: | ---: | ---: |
| `origin/main` | 27 | 76 | 78 | 464 |
| PR #86 | 26 | 74 | 81 | 484 |

No hay archivos de prueba fallidos nuevos en el PR. `Navbar.test.jsx`, que falla en `main` por ejecutarse sin DOM, pasa en el PR junto con la cobertura ampliada. La diferencia global es favorable al PR: una suite y dos pruebas fallidas menos, además de las pruebas nuevas en PASS.

Conclusión: **SIN REGRESIONES NUEVAS RESPECTO DE `main`**.

## 16. Supabase

Supabase permaneció **SIN CAMBIOS** durante esta validación.

No se aplicaron migraciones, no se modificaron grants, permisos, sesiones, pedidos, notificaciones ni datos. No se tocaron los pedidos protegidos. La validación SQL/runtime anterior se aceptó como completada y no se repitió.

## 17. Vercel

No se invocó manualmente Vercel mediante API, CLI o agentes.

La integración automática de GitHub registró un check de Vercel para el commit del PR. Ese check no fue solicitado, forzado ni utilizado como criterio de validación de ECOM.ORDERS.1.3.

La validación del hotfix se realizó mediante ESLint, Vitest y npm run build sobre el checkout íntegro.

## 18. Estado de cierre

```text
ECOM.ORDERS.1.3 VALIDACIÓN GLOBAL PASS

ESLint específico: PASS
Pruebas hotfix: PASS
Regresión ecommerce: PASS
Regresión notificaciones: PASS
Regresión navegación: PASS
Build global: PASS
Línea base global: SIN REGRESIONES NUEVAS
Supabase: SIN CAMBIOS
Vercel manual: NO UTILIZADO
```

El PR #86 queda apto para marcarse ready for review después del commit documental, push y repetición de la matriz sobre ese HEAD final.

No mergear automáticamente.
