# STAFF.NOTIF.1 — Notification staff permissions report

Proyecto Supabase producción: `odlrhijtfyavryeqivaa`

Fecha de cierre: 2026-07-09

## Objetivo

Permitir que el admin controle si un usuario staff puede ver el Centro de Notificaciones y/o Soporte interno, cerrando explícitamente los helpers privados usados por la fase.

## Permisos agregados

Se agregaron dos permisos booleanos al contrato de staff:

- `notifications`
- `support_center`

Defaults de staff:

- `notifications: false`
- `support_center: false`

Esto evita que un staff existente o nuevo obtenga acceso al Centro/Soporte por accidente.

## Funciones privadas versionadas

La migración `supabase/migrations/20260709232838_staff_notif_1_notification_staff_permissions.sql` crea/reemplaza:

- `private.default_staff_permissions()`
- `private.normalize_staff_permissions(jsonb)`
- `private.staff_has_permission(text, uuid, text)`
- `private.get_pos_notification_context(text,text,text,text,text)`
- `private.get_support_ticket_context(text,text,text,text,text)`

## Revokes

Se cerraron explícitamente para `public`, `anon` y `authenticated`:

- `private.default_staff_permissions()`
- `private.normalize_staff_permissions(jsonb)`
- `private.staff_has_permission(text, uuid, text)`
- `private.get_pos_notification_context(text, text, text, text, text)`
- `private.get_support_ticket_context(text, text, text, text, text)`

También se mantiene cerrado el resto de privadas de NOTIF versionadas por `NOTIF.DB.DRIFT.1`.

Resultado verificado en producción:

- `can_execute = false` para `anon`, `authenticated` y `public` en todas las privadas revisadas.

## RPCs protegidas

### Centro de Notificaciones

RPCs públicas protegidas por licencia/dispositivo/security token y permiso staff `notifications`:

- `public.list_pos_notifications(...)`
- `public.mark_pos_notification_read(...)`
- `public.mark_all_pos_notifications_read(...)`
- `public.archive_pos_notification(...)`
- `public.refresh_operational_notifications(...)`

Comportamiento esperado:

- Admin/dispositivo no staff puede operar bajo contrato normal de licencia.
- Staff con `notifications = true` puede usar Centro de Notificaciones.
- Staff con `notifications = false` recibe bloqueo `STAFF_NOTIFICATIONS_DISABLED`.
- Lanzo Local queda bloqueado por flags de plan.

### Soporte interno

RPCs públicas protegidas por licencia/dispositivo/security token y permiso staff `support_center`:

- `public.create_support_ticket(...)`
- `public.list_support_tickets(...)`
- `public.get_support_ticket_thread(...)`
- `public.reply_support_ticket(...)`
- `public.close_support_ticket(...)`

Comportamiento esperado:

- Staff con `support_center = true` puede operar soporte.
- Staff con `support_center = false` recibe bloqueo `STAFF_SUPPORT_DISABLED`.
- Lanzo Local queda bloqueado por flags `support_center/support_tickets/support_channel`.

## Defaults y normalización

`private.default_staff_permissions()` ahora incluye:

```json
{
  "notifications": false,
  "support_center": false
}
```

`private.normalize_staff_permissions(jsonb)` preserva permisos válidos existentes y agrega defaults faltantes.

La migración actualiza `public.license_staff_users.permissions` únicamente cuando faltan las llaves nuevas:

- `notifications`
- `support_center`

No borra usuarios staff ni sesiones.

## Validaciones frontend/Supabase

### Frontend

El frontend ya estaba versionado antes de esta fase. Esta fase no modificó frontend.

Contrato esperado en frontend:

- Mostrar/ocultar Centro de Notificaciones según permiso `notifications`.
- Mostrar/ocultar Soporte según permiso `support_center`.
- Enviar `p_staff_session_token` en RPCs de notificaciones/soporte cuando aplica.

### Supabase

Producción verificada:

- Funciones críticas siguen con `SECURITY DEFINER`.
- Funciones críticas siguen con `SET search_path = ''`.
- Privadas sin `EXECUTE` para `anon/authenticated/public`.
- Tablas de notificaciones/soporte sin grants directos a cliente.
- RLS activo en tablas públicas.

## Estado de producción

Producción conserva el contrato actual:

- Lanzo Local: sin Centro de Notificaciones cloud y sin Soporte interno.
- Lanzo Básico Legacy: sin Centro de Notificaciones cloud y sin Soporte interno.
- Lanzo Nube: Centro de Notificaciones, Soporte y realtime activos.
- Staff sin `notifications`: bloqueado en Centro de Notificaciones.
- Staff sin `support_center`: bloqueado en Soporte interno.

## Resultado de verificaciones relevantes

### Planes

| code | name | ticker_mode | notification_center | cloud_notifications | support_center | support_tickets | support_realtime |
|---|---|---|---|---|---|---|---|
| `basic_monthly` | Lanzo Básico Legacy | local | false | false | false | false | false |
| `free_trial` | Lanzo Local | local | false | false | false | false | false |
| `pro_monthly` | Lanzo Nube | summary | true | true | true | true | true |

### Grants privados

Resultado: `can_execute = false` para `anon`, `authenticated` y `public` en las privadas revisadas.

### Grants de tablas

Resultado: `0 filas` para grants directos a `public`, `anon` o `authenticated` sobre:

- `pos_notifications`
- `pos_notification_reads`
- `support_tickets`
- `support_ticket_messages`
- `support_ticket_inbox`

### RLS

| tabla | RLS |
|---|---:|
| `public.pos_notification_reads` | true |
| `public.pos_notifications` | true |
| `public.support_ticket_messages` | true |
| `public.support_tickets` | true |

## Riesgos pendientes

- No se hizo limpieza de datos en producción por restricción explícita de no borrar notificaciones/tickets/mensajes.
- Hay `3` notificaciones Pro con `metadata.test_data = true`; se documentan como pendiente para una fase de limpieza separada si se decide intervenir.
