# ECOM.NOTIF.1 — Notificaciones de nuevos pedidos para PRO

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-orders-1`  
Supabase producción: `odlrhijtfyavryeqivaa`

## Estado del reporte

La migración, feature gate, deduplicación, protección de PII, permiso requerido y QA SQL están terminados. El cierre formal `ECOM.NOTIF.1 PASS` depende todavía de regresiones frontend, build y preview del PR conjunto.

## 1. Preflight del sistema existente

Se inspeccionaron en producción las definiciones reales de:

- `private.create_pos_notification`;
- `private.create_pos_notification_once`;
- `private.broadcast_notification_event`;
- `private.get_pos_notification_context`;
- `public.list_pos_notifications`;
- `public.mark_pos_notification_read`;
- `public.mark_all_pos_notifications_read`;
- `public.archive_pos_notification`;
- `public.refresh_operational_notifications`.

No se creó un segundo sistema de notificaciones. La implementación extiende el Centro de Notificaciones actual, su deduplicación, sus reads y su canal realtime privado.

## 2. Migración aplicada

Se aplicó exclusivamente una migración nueva mediante `apply_migration`:

- historial producción: `20260710175017_ecom_notif_1_order_notifications`;
- archivo versionado: `supabase/migrations/20260710183000_ecom_notif_1_order_notifications.sql`.

No se generaron notificaciones retroactivas para órdenes anteriores.

## 3. Categoría ecommerce

Los constraints de `pos_notifications` se reemplazaron de forma idempotente para añadir:

```text
type = ecommerce
source = ecommerce
```

Se conservaron todos los valores anteriores de ambos constraints. No se eliminó ninguna categoría existente.

## 4. Feature gate FREE/PRO

Se creó:

```sql
private.ecommerce_order_notifications_enabled(
  p_license_id uuid
) returns boolean
```

Usa la unión efectiva de features de plan y licencia. No consulta `license_type` ni `plan_code`.

Devuelve verdadero únicamente cuando:

- `ecommerce_order_inbox=true`;
- `ecommerce_realtime_orders=true`;
- Centro de Notificaciones cloud habilitado explícitamente o inferido;
- cloud notifications habilitadas explícitamente o inferidas.

La inferencia usa `realtime_license_sync`, igual que la capacidad existente del frontend.

### Resultado por plan

- FREE: bandeja disponible, realtime falso, Centro cloud falso → no crea notificación;
- PRO: inbox, realtime y Centro cloud efectivos → crea notificación.

## 5. Punto de creación

No se añadió un trigger sobre `ecommerce_orders`.

Se creó un trigger `AFTER INSERT` sobre `ecommerce_order_events`, condicionado a:

```sql
event_type = 'order_created'
```

En ese punto ya existen la orden, sus items, total y código público.

El trigger llama a:

```sql
private.ensure_ecommerce_order_notification(p_order_id uuid)
```

La función y el trigger capturan errores internamente. Un fallo de notificación no revierte el checkout ni expone información al cliente público.

## 6. Contenido

La notificación genera:

- título: `Nuevo pedido online <código público>`;
- body: cantidad de artículos, total, moneda y modalidad;
- acción: `Ver pedido`;
- route: `/pedidos-online?order=<uuid>`.

La pluralización distingue `1 artículo` y `N artículos`.

Modalidades:

- pickup: `Recoger en el negocio`;
- delivery: `Entrega a domicilio`.

## 7. Metadata y PII

La metadata contiene exclusivamente:

```json
{
  "category": "ecommerce",
  "required_permission": "ecommerce",
  "order_id": "uuid",
  "order_code": "EC-00000010",
  "event_key": "ecommerce_order_created:<uuid>",
  "generated_by": "ECOM.NOTIF.1"
}
```

La prueba SQL verificó exactamente esas seis claves y `hasPii=false`.

No se incluyen:

- nombre;
- teléfono;
- dirección;
- notas;
- mensaje WhatsApp;
- idempotency key;
- license key;
- fingerprint;
- security token;
- IP hash.

El motivo de rechazo tampoco se incluye en notificaciones cloud.

## 8. Deduplicación

El event key es:

```text
ecommerce_order_created:<order_id>
```

La creación usa `private.create_pos_notification_once(...)`, no un insert directo.

La QA ejecutó una segunda llamada explícita para la misma orden fixture. Resultado:

- primera ejecución: una notificación;
- retry: `created=false`, retorna la existente;
- conteo final: una notificación.

Un retry idempotente del checkout no duplica la orden ni la notificación.

## 9. Estado de notificación en la orden

Cuando PRO y la notificación termina correctamente:

```text
system_notification_status = notified
```

Cuando la creación interna falla:

```text
system_notification_status = failed
```

Cuando la feature está deshabilitada, como en FREE, no se crea fila ecommerce y no se presenta error al checkout público.

## 10. Permiso requerido

Se crearon helpers privados reutilizables:

```sql
private.pos_notification_required_permission_allowed_v1(...)
private.pos_notification_target_allowed_v1(...)
```

Regla aplicada:

- admin → puede ver y manipular;
- staff `notifications=true` + `ecommerce=true` → puede ver y manipular;
- staff `notifications=true` + `ecommerce=false` → no puede listar, contar, marcar, marcar todas o archivar;
- staff `notifications=false` → Centro de Notificaciones bloqueado por la guarda existente.

Las notificaciones sin `metadata.required_permission` conservan el comportamiento previo.

La protección fue incorporada en:

- listado;
- unread count del listado;
- marcar como leída;
- marcar todas como leídas;
- archivar.

La QA confirmó que adivinar el UUID no permite modificar una notificación ecommerce sin permiso.

## 11. Broadcast y realtime

`private.create_pos_notification` continúa llamando al sistema de broadcast existente. Para ecommerce emite el evento normal:

```text
notifications_changed
reason = ecommerce_order_created
```

La metadata realtime se reduce a:

- type;
- severity;
- source;
- category;
- order ID validado.

No contiene PII.

Las transiciones de pedido usan el evento separado `ecommerce_orders_changed`, igualmente sobre los topics privados de `license_devices` y solo cuando `ecommerce_realtime_orders=true`.

## 12. Integración frontend

Se actualizaron:

- `notificationPreferencesService.js`;
- `NotificationPreferencesPanel.jsx`;
- `NotificationTabs.jsx`;
- `NotificationCenterDrawer.jsx`;
- `NotificationItem.jsx`;
- `notificationRealtimeService.js`.

### Categoría y preferencias

`ecommerce` queda habilitada por defecto para:

- ticker;
- destacado en centro;
- sin mute inicial.

Silenciar ecommerce oculta el ticker temporalmente, pero no elimina la notificación del Centro.

### Tab

Se añadió `Pedidos online` con contador y filtro propio. La tab especial de Soporte conserva su flujo independiente.

### Item y acción

Las notificaciones ecommerce muestran icono `ShoppingBag` y etiqueta `Pedidos online`.

Al pulsar `Ver pedido`:

1. espera la respuesta de marcar leída;
2. si el servidor la autoriza, cierra el Centro;
3. navega a `action_route`;
4. la página carga el detalle por RPC;
5. si está `new`, se marca visto.

Si el servidor deniega marcar la notificación, no se navega con un UUID adivinado.

WhatsApp no se abre automáticamente.

## 13. Reutilización del canal realtime

`notificationRealtimeService` conserva un único canal privado por topic.

- FREE con `ecommerce_realtime_orders=false` no inicia canal por ecommerce;
- PRO puede usar el canal por notificaciones cloud o por realtime de pedidos;
- `notifications_changed` ecommerce actualiza campana y dispara invalidación de la bandeja;
- `ecommerce_orders_changed` invalida resumen/lista sin alterar la bandeja de notificaciones;
- eventos no ecommerce no causan refresh de pedidos.

El runtime de pedidos agrega debounce de 600 ms y el slice evita promesas duplicadas.

## 14. QA SQL

Todas las escrituras se realizaron con `BEGIN ... ROLLBACK`.

### PRO

Para órdenes fixture PRO:

- una orden;
- una notificación por event key;
- `system_notification_status=notified`;
- metadata sin PII;
- route correcta;
- retry sin duplicado.

### FREE

Para una orden fixture FREE:

- orden creada;
- cero notificaciones `source=ecommerce`;
- helper de feature devuelve falso.

### Permisos

- admin: notificación visible;
- staff notifications+ecommerce: visible;
- staff notifications sin ecommerce: lista vacía y unread cero;
- staff sin notifications: Centro bloqueado;
- UUID adivinado: mark read y archive responden `NOTIFICATION_NOT_FOUND`;
- mark all sin ecommerce actualiza cero filas.

### Protección de producción

No se disparó ninguna notificación persistente sobre la licencia real. Todos los fixtures se revirtieron.

La orden `EC-00000010` permanece con un item, un evento y estado `new`; no recibió notificación retroactiva.

## 15. Grants

- helpers privados: sin execute para `public`, `anon` o `authenticated`;
- RPCs de notificación: únicamente `authenticated`, igual que el contrato actual del POS;
- ninguna RPC administrativa ecommerce se concedió a `anon`;
- no se concedió acceso directo a `pos_notifications`, `pos_notification_reads` ni tablas ecommerce.

## 16. Índice de event key

El preflight encontró el índice equivalente existente:

```sql
idx_pos_notifications_license_metadata_event_key
  (license_id, (metadata->>'event_key'))
```

No se creó otro índice.

## 17. Pruebas frontend añadidas

- `NotificationItem.ecommerce.test.jsx`: etiqueta, mark read, cierre, navegación y denegación;
- `notificationRealtimeService.ecommerce.test.js`: FREE/PRO, canal compartido, transición y notificación ecommerce;
- `notificationPreferencesService.ecommerce.test.js`: defaults, clasificación y mute solo en ticker;
- pruebas de bandeja verifican el deep link y marcado visto.

## 18. Build y regresiones

Pendiente de completar sobre el SHA final del PR:

- ESLint específico;
- Vitest específico;
- regresión Notification Center, soporte, preferencias y realtime;
- regresión ecommerce pública y checkout;
- `npm run build`;
- comparación global contra `main`;
- preview Vercel `READY`.

## 19. Riesgos residuales

1. El canal realtime entrega invalidaciones, no el contenido completo del pedido; la UI vuelve a consultar por RPC, de forma intencional.
2. Un mute del ticker es local al dispositivo y no altera reads cloud.
3. No existen sonidos persistentes, alarmas invasivas ni WhatsApp automático en esta fase.
4. La etiqueta formal de cierre depende del resultado de checks y preview.
