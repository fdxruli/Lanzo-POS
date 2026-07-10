# ECOM.RPC.2 — Contratos administrativos para pedidos online

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-orders-1`  
Supabase producción: `odlrhijtfyavryeqivaa`

## Estado del reporte

La implementación SQL, la instalación controlada en producción y la matriz transaccional de seguridad están terminadas. La verificación read-only de ECOM.ORDERS.1.1 confirmó que los contratos y grants permanecen intactos.

## 1. Preflight de producción

Antes de modificar código se consultaron directamente en producción:

- columnas, defaults y nulabilidad de `ecommerce_orders`, `ecommerce_order_items`, `ecommerce_order_events`, `pos_notifications` y `pos_notification_reads`;
- constraints instalados mediante `pg_constraint`;
- definiciones reales mediante `pg_get_functiondef` de autorización ecommerce, rate limit, contexto de notificaciones y RPCs de notificaciones;
- índices existentes mediante `pg_indexes`;
- triggers de pedidos y eventos.

El preflight confirmó que `ecommerce_orders` ya contenía todos los estados y timestamps requeridos, incluyendo `seen_at`, `accepted_at`, `rejected_at`, `system_notification_status`, `pos_visibility_status`, `stock_reservation_status`, `converted_sale_id` y `metadata`. No se creó ninguna columna ni tabla paralela.

También confirmó que `private.ecommerce_admin_authorize_v2` pertenece a configuración del portal y exige `settings=true` al staff. No se reutilizó para la bandeja operativa.

## 2. Migración aplicada

Se aplicó exclusivamente una migración nueva mediante `apply_migration`:

- historial producción: `20260710174725_ecom_rpc_2_order_management`;
- archivo versionado: `supabase/migrations/20260710180000_ecom_rpc_2_order_management.sql`.

No se usaron `supabase db push`, `migration repair`, `--include-all`, edición de migraciones anteriores, deletes, truncates o drops destructivos.

## 3. Autorización operativa

Se creó:

```sql
private.ecommerce_orders_authorize_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_rpc_name text
) returns jsonb
```

Conserva los patrones seguros de la autorización administrativa existente:

- licencia activa y no expirada;
- dispositivo activo;
- security token actual o anterior mediante `private.validate_pos_sync_context`;
- sesión staff vinculada al dispositivo;
- rate limit antes de validar la sesión staff;
- bucket particionado por dispositivo, con `p_staff_session_token=null` y scope `ECOM_ORDERS`;
- features efectivas, sin hardcodear `license_type`, `plan_code`, usuario o licencia;
- `SECURITY DEFINER`;
- `SET search_path TO ''`.

La feature obligatoria es `ecommerce_order_inbox=true`.

### Matriz validada

| Actor | Resultado |
|---|---|
| Dispositivo admin válido | permitido |
| Staff `ecommerce=true`, `settings=false` | permitido |
| Staff `ecommerce=false`, `settings=true` | `ECOMMERCE_STAFF_PERMISSION_DENIED` |
| Staff sin sesión | `ECOMMERCE_STAFF_SESSION_REQUIRED` |
| Staff con sesión inválida | `ECOMMERCE_STAFF_SESSION_INVALID` |
| Dispositivo inválido | `ECOMMERCE_ORDERS_ACCESS_DENIED` |
| Feature inbox deshabilitada | `ECOMMERCE_ORDER_INBOX_DISABLED` |

`notifications=true` y `settings=true` no son requisitos para la bandeja.

## 4. Errores seguros

Se creó `private.ecommerce_orders_error_v1(...)` para responder códigos públicos normalizados. Las RPCs no devuelven SQL interno, nombres de tablas, IDs internos de licencia, hashes, tokens o fingerprints.

Códigos cubiertos:

- `ECOMMERCE_ORDERS_ACCESS_DENIED`;
- `ECOMMERCE_ORDER_INBOX_DISABLED`;
- `ECOMMERCE_STAFF_SESSION_REQUIRED`;
- `ECOMMERCE_STAFF_SESSION_INVALID`;
- `ECOMMERCE_STAFF_PERMISSION_DENIED`;
- `ECOMMERCE_ORDERS_RATE_LIMITED`;
- `ECOMMERCE_ORDER_NOT_FOUND`;
- `ECOMMERCE_ORDER_INVALID_TRANSITION`;
- `ECOMMERCE_REJECTION_REASON_REQUIRED`;
- `ECOMMERCE_REJECTION_REASON_TOO_LONG`;
- `ECOMMERCE_ORDER_ACTION_FAILED`.

## 5. Firmas públicas

```sql
public.ecommerce_admin_list_orders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
```

```sql
public.ecommerce_admin_get_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_staff_session_token text default null
) returns jsonb
```

```sql
public.ecommerce_admin_mark_order_seen(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_staff_session_token text default null
) returns jsonb
```

```sql
public.ecommerce_admin_accept_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_staff_session_token text default null
) returns jsonb
```

```sql
public.ecommerce_admin_reject_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_reason text,
  p_staff_session_token text default null
) returns jsonb
```

Todas son `SECURITY DEFINER`, tienen `search_path=''`, están revocadas para `public` y `anon`, y concedidas exclusivamente a `authenticated`.

## 6. Listado

Filtros permitidos:

- `all`;
- `pending`, interpretado como `new + seen`;
- `new`;
- `seen`;
- `accepted`;
- `rejected`.

Un filtro desconocido se normaliza explícitamente a `all`. No existe SQL dinámico derivado del cliente.

Paginación:

- límite mínimo 1;
- límite máximo 100;
- offset mínimo 0;
- `hasMore` calculado con una fila adicional.

El listado solo consulta `order.license_id` obtenido del contexto autorizado y exige `pos_visibility_status IN ('pending','visible')`. No cambia `new` a `seen`.

### Privacidad validada

Las claves de cada fila son únicamente:

- `id`;
- `code`;
- `status`;
- `customerName`;
- `fulfillmentMethod`;
- `itemCount`;
- `total`;
- `currency`;
- `createdAt`;
- `seenAt`;
- `acceptedAt`;
- `rejectedAt`.

La prueba automática confirmó `containsSensitive=false`: no se devuelven teléfono, dirección, notas, metadata completa, idempotency key, license ID, portal ID, hashes, user agent o mensaje WhatsApp.

## 7. Detalle

El detalle exige simultáneamente:

```sql
order.id = p_order_id
order.license_id = licencia_autorizada
```

Un UUID de otra licencia responde `ECOMMERCE_ORDER_NOT_FOUND` en lectura y mutaciones.

El payload incluye cliente, totales, pago, timestamps, items públicos, eventos sanitizados y un enlace manual `https://wa.me`. El enlace se oculta cuando no puede normalizarse y nunca se abre automáticamente.

Los eventos se reducen a `eventType`, `actorType`, etiqueta segura, mensaje público, payload permitido y fecha. El motivo de rechazo se devuelve únicamente para `order_rejected`.

## 8. Transiciones e idempotencia

### Visto

- permitido: `new -> seen`;
- define `seen_at`;
- cambia visibilidad a `visible`;
- crea un único evento `order_seen`;
- cualquier segunda apertura devuelve `changed=false` sin evento adicional.

### Aceptación

- permitidas: `new -> accepted`, `seen -> accepted`;
- define `accepted_at` y `seen_at`;
- crea exactamente un evento `order_accepted` con `fromStatus` y `toStatus`;
- `accepted -> accepted` devuelve `changed=false`;
- estados terminales o incompatibles devuelven `ECOMMERCE_ORDER_INVALID_TRANSITION`.

### Rechazo

- permitidas: `new -> rejected`, `seen -> rejected`;
- exige motivo trim de 3 a 300 caracteres;
- define `rejected_at` y `seen_at`;
- guarda el motivo únicamente en el evento `order_rejected`;
- `rejected -> rejected` devuelve `changed=false`;
- `accepted -> rejected` está bloqueado en esta fase.

## 9. Concurrencia

Las tres mutaciones seleccionan la orden con `SELECT ... FOR UPDATE`. Dos dispositivos concurrentes serializan sobre la misma fila. El segundo actor observa el estado definitivo y no crea un segundo evento.

La matriz transaccional confirmó un solo evento por transición y `changed=false` en la segunda ejecución.

## 10. Realtime de estados

Se creó `private.broadcast_ecommerce_order_change_v1(...)`.

Solo emite cuando la feature efectiva `ecommerce_realtime_orders=true`. El payload permitido contiene:

```json
{
  "event": "ecommerce_orders_changed",
  "reason": "order_seen|order_accepted|order_rejected",
  "metadata": {
    "source": "ecommerce",
    "category": "ecommerce",
    "order_id": "uuid",
    "status": "seen|accepted|rejected"
  }
}
```

No incluye nombre, teléfono, dirección, notas, licencia, token, fingerprint o IP.

## 11. Índices

El preflight encontró equivalentes existentes para:

- `ecommerce_orders (license_id, status, created_at desc)`;
- `ecommerce_order_events (order_id, created_at desc)`;
- `ecommerce_order_items (order_id)`;
- `pos_notifications (license_id, metadata->>'event_key')`.

Solo se agregó el índice faltante:

```sql
create index if not exists ix_ecommerce_orders_license_created
  on public.ecommerce_orders (license_id, created_at desc);
```

No se crearon duplicados.

## 12. EXPLAIN

### Lista de pendientes

La tabla real contiene actualmente muy pocas filas, por lo que PostgreSQL eligió `Seq Scan + Sort` con costo total aproximado `2.07`. El índice compuesto `ix_ecommerce_orders_license_status_created` ya existe y queda disponible cuando la cardinalidad haga rentable el acceso indexado.

### Detalle por order ID y licencia

Con la tabla actual de una fila, el planner eligió `Seq Scan` con costo total aproximado `2.05`. La PK por `id` continúa instalada; la elección corresponde a la cardinalidad mínima, no a falta de índice.

### Eventos por order ID

El planner utilizó `Bitmap Index Scan` sobre `ix_ecommerce_order_events_order_created`, seguido de `Bitmap Heap Scan` y ordenamiento por `created_at, id`.

## 13. Pruebas SQL

Todas las escrituras se ejecutaron dentro de `BEGIN ... ROLLBACK` con licencias, dispositivos, staff, sesiones, portales, órdenes, items y eventos fixture.

Resultado validado:

- autorización admin;
- autorización staff ecommerce con settings deshabilitado;
- denegaciones de sesión, dispositivo, permiso y feature;
- listado, filtros, counts, paginación y orden;
- listado sin campos sensibles;
- aislamiento de licencia en las cinco RPCs;
- `new -> seen`, segunda ejecución idempotente y un evento;
- `new -> accepted`, segunda ejecución idempotente y un evento;
- `new -> rejected`, segunda ejecución idempotente y un evento;
- motivo vacío y motivo de 301 caracteres rechazados;
- `accepted -> rejected` y `rejected -> accepted` bloqueados;
- separación total de ventas, caja, inventario, comandas, clientes y pagos.

El fixture activó secuencias GENERATED, las cuales PostgreSQL no revierte. Se restauró de forma explícita la secuencia de `order_number` al máximo real `10`. No se modificó ninguna orden.

## 14. Pedido real protegido

Después de toda la QA se verificó:

```text
Código: EC-00000010
order_number: 10
Estado: new
Total: 20.00 MXN
Modalidad: pickup
Items: 1
Eventos: 1
```

No fue marcado visto, aceptado, rechazado, eliminado ni actualizado.

## 15. Grants y acceso directo

- helpers privados: sin execute para `public`, `anon` o `authenticated`;
- RPCs administrativas: execute únicamente para `authenticated`;
- cero grants directos nuevos sobre las tablas ecommerce y notificaciones;
- el checkout público continúa siendo la única superficie ecommerce ejecutable por `anon`.

## 16. Separación POS

Las definiciones de las mutaciones fueron inspeccionadas y probadas. No contienen dependencias ni escrituras sobre:

- ventas;
- caja o movimientos de caja;
- inventario o movimientos de stock;
- comandas;
- clientes POS;
- pagos;
- reservas de stock.

Aceptar un pedido en ECOM.RPC.2 únicamente actualiza la orden e inserta su evento administrativo.

## 17. Riesgos residuales

1. Los estados posteriores `preparing`, `ready`, `completed`, `cancelled` y `converted_to_sale` existen en el esquema, pero no se exponen en esta fase.
2. No existe reserva de stock; el negocio debe confirmar disponibilidad operativa.
3. La concurrencia está protegida en servidor, pero la interfaz debe presentar correctamente una transición perdida frente a otro dispositivo; esto se valida en la capa frontend/realtime.
4. La etiqueta formal de cierre depende de checks específicos, regresiones, build y preview del PR conjunto.

## Verificación read-only ECOM.ORDERS.1.1

No se editó, renombró ni reaplicó ninguna migración. Producción sigue registrando `20260710174725_ecom_rpc_2_order_management` y `20260710175017_ecom_notif_1_order_notifications`.

La inspección read-only confirmó:

- RPC administrativas `SECURITY DEFINER` y `search_path=''`;
- execute para `authenticated` y denegado para `anon`/`public`;
- helpers privados sin execute para roles cliente;
- cero grants directos sobre órdenes, items, eventos, notificaciones y reads;
- constraints ecommerce conservados.

ECOM.ORDERS.1.1 no realizó escrituras SQL ni tocó `EC-00000010`.
