# FASE NOTIF.DB.DRIFT.1 — Supabase versioning report

Proyecto Supabase producción: `odlrhijtfyavryeqivaa`

Fecha de cierre: 2026-07-09

## Objetivo

Cerrar el drift entre Supabase producción y la carpeta `supabase/` del repositorio para el Centro de Notificaciones, sin cambiar comportamiento funcional y sin borrar datos.

## Qué faltaba versionar

Producción ya tenía implementado el Centro de Notificaciones, pero el repositorio solo tenía versionada parte de `STAFF.NOTIF.1` en:

- `supabase/migrations/20260709232838_staff_notif_1_notification_staff_permissions.sql`

Faltaba versionar en `supabase/migrations`:

- `NOTIF.0` — flags de planes.
- `NOTIF.2` — tablas/RPCs core de notificaciones cloud.
- `NOTIF.3` — soporte interno con tickets.
- `NOTIF.4` — bandeja privada de soporte.
- `NOTIF.5` — notificaciones automáticas de licencia.
- `NOTIF.6` — realtime ligero para eventos de notificación.
- `NOTIF.8` — notificaciones operativas de sync/caja/staff.
- `NOTIF.9` — cleanup/copy/expiración/control de ruido.
- Revokes explícitos faltantes para helpers privados de `STAFF.NOTIF.1`.

## Migraciones creadas/modificadas

### Modificada

- `supabase/migrations/20260709232838_staff_notif_1_notification_staff_permissions.sql`
  - Agrega revokes explícitos para:
    - `private.default_staff_permissions()`
    - `private.normalize_staff_permissions(jsonb)`
    - `private.get_pos_notification_context(text,text,text,text,text)`
    - `private.get_support_ticket_context(text,text,text,text,text)`
  - Conserva revokes para `private.staff_has_permission(text, uuid, text)`.

### Creadas

- `supabase/migrations/20260710010000_notif_0_plan_features.sql`
- `supabase/migrations/20260710010100_notif_2_notifications_core.sql`
- `supabase/migrations/20260710010200_notif_3_support_tickets.sql`
- `supabase/migrations/20260710010300_notif_4_support_private_inbox.sql`
- `supabase/migrations/20260710010400_notif_5_6_8_9_operational_realtime_cleanup.sql`

## Objetos versionados

### Plan features

Se versionaron flags JSONB por plan con merge defensivo:

- `free_trial` / Lanzo Local:
  - ticker local activo.
  - centro cloud desactivado.
  - soporte por email.
  - sin tickets internos.
- `basic_monthly` / Lanzo Básico Legacy:
  - legacy/inactivo para cloud notifications.
  - soporte por email.
  - `legacy_plan = true`.
- `pro_monthly` / Lanzo Nube:
  - ticker summary.
  - centro cloud activo.
  - soporte in-app/tickets/historial/realtime activo.
  - mensajes personalizados.

No se tocaron precios ni límites.

### Tablas públicas versionadas

- `public.pos_notifications`
- `public.pos_notification_reads`
- `public.support_tickets`
- `public.support_ticket_messages`

Todas quedan con:

- `create table if not exists`.
- columnas/constraints actuales de producción.
- índices actuales de producción.
- RLS activo.
- grants directos cerrados a `public`, `anon`, `authenticated`.

### Vista privada versionada

- `private.support_ticket_inbox`

La vista privada queda sin grants para cliente.

### Índices versionados

Notificaciones:

- `idx_pos_notifications_license_active_window`
- `idx_pos_notifications_license_created_at`
- `idx_pos_notifications_license_metadata_event_key`
- `idx_pos_notifications_license_seed`
- `idx_pos_notifications_license_severity`
- `idx_pos_notifications_license_type`
- `idx_pos_notification_reads_license_archived_at`
- `idx_pos_notification_reads_license_id`
- `idx_pos_notification_reads_license_read_at`
- `idx_pos_notification_reads_notification_id`
- `uq_pos_notification_reads_device`
- `uq_pos_notification_reads_staff`

Soporte:

- `idx_support_tickets_license_category`
- `idx_support_tickets_license_status`
- `idx_support_tickets_license_updated_at`
- `idx_support_ticket_messages_license_created_at`
- `idx_support_ticket_messages_ticket_created_at`

### Funciones privadas versionadas

Core/helpers:

- `private.default_staff_permissions()`
- `private.normalize_staff_permissions(jsonb)`
- `private.staff_has_permission(text, uuid, text)`
- `private.get_pos_notification_context(text,text,text,text,text)`
- `private.get_support_ticket_context(text,text,text,text,text)`
- `private.touch_pos_notification_updated_at()`
- `private.touch_support_ticket_updated_at()`
- `private.support_message_preview(text)`

Notificaciones:

- `private.create_pos_notification(...)`
- `private.create_pos_notification_once(...)`
- `private.broadcast_notification_event(...)`

Soporte privado:

- `private.add_support_ticket_reply(uuid, text, jsonb)`
- `private.list_support_inbox(text, integer, integer)`
- `private.get_support_inbox_thread(uuid)`
- `private.update_support_ticket_status(uuid, text, text)`

Operativas/cleanup:

- `private.generate_license_operational_notifications(uuid)`
- `private.generate_sync_operational_notifications(uuid)`
- `private.generate_cash_operational_notifications(uuid)`
- `private.generate_staff_operational_notifications(uuid)`
- `private.cleanup_old_pos_notifications(boolean, boolean, boolean)`

Todas las privadas quedan con revokes explícitos para `public`, `anon`, `authenticated`.

### RPCs públicas versionadas

Notificaciones:

- `public.list_pos_notifications(...)`
- `public.mark_pos_notification_read(...)`
- `public.mark_all_pos_notifications_read(...)`
- `public.archive_pos_notification(...)`
- `public.refresh_operational_notifications(...)`

Soporte:

- `public.create_support_ticket(...)`
- `public.list_support_tickets(...)`
- `public.get_support_ticket_thread(...)`
- `public.reply_support_ticket(...)`
- `public.close_support_ticket(...)`

Las RPCs públicas conservan el contrato actual:

- `SECURITY DEFINER`.
- `SET search_path = ''`.
- acceso por `anon` y `authenticated`.
- validación de licencia/dispositivo/security token.
- soporte para `p_staff_session_token`.
- bloqueo de Lanzo Local.
- bloqueo de staff sin `notifications` o `support_center` según flujo.

## Confirmaciones de seguridad y datos

### Datos

No se ejecutó `drop table`, `drop function`, `truncate`, `delete` ni limpieza sobre producción.

No se borraron:

- tickets,
- mensajes de soporte,
- notificaciones,
- staff,
- licencias,
- dispositivos,
- planes.

Las verificaciones contra producción fueron consultas `SELECT`.

### RLS

Resultado producción:

| tabla | RLS |
|---|---:|
| `public.pos_notification_reads` | true |
| `public.pos_notifications` | true |
| `public.support_ticket_messages` | true |
| `public.support_tickets` | true |

### Grants directos sobre tablas/vista

Consulta sobre `public/anon/authenticated` para:

- `pos_notifications`
- `pos_notification_reads`
- `support_tickets`
- `support_ticket_messages`
- `support_ticket_inbox`

Resultado: `0 filas`.

### Grants privados

Funciones privadas revisadas para `anon`, `authenticated` y `public`:

- `create_pos_notification`
- `create_pos_notification_once`
- `broadcast_notification_event`
- `cleanup_old_pos_notifications`
- `generate_license_operational_notifications`
- `generate_sync_operational_notifications`
- `generate_cash_operational_notifications`
- `generate_staff_operational_notifications`
- `add_support_ticket_reply`
- `list_support_inbox`
- `get_support_inbox_thread`
- `update_support_ticket_status`
- `staff_has_permission`
- `get_pos_notification_context`
- `get_support_ticket_context`
- `default_staff_permissions`
- `normalize_staff_permissions`

Resultado: `can_execute = false` para todos los roles revisados.

### Funciones críticas

Las funciones críticas de notificaciones/soporte siguen con:

- `SECURITY DEFINER = true`.
- `proconfig = { search_path="" }`.

Aplica a RPCs públicas y funciones privadas críticas.

### Planes

Resultado producción:

| code | name | ticker_mode | notification_center | cloud_notifications | support_center | support_tickets | support_realtime |
|---|---|---|---|---|---|---|---|
| `basic_monthly` | Lanzo Básico Legacy | local | false | false | false | false | false |
| `free_trial` | Lanzo Local | local | false | false | false | false | false |
| `pro_monthly` | Lanzo Nube | summary | true | true | true | true | true |

### Notificaciones por plan

Resultado producción:

| plan | total_notifications | NOTIF.8 | test_data | archived_by_cleanup |
|---|---:|---:|---:|---:|
| Lanzo Básico Legacy | 0 | 0 | 0 | 0 |
| Lanzo Local | 0 | 0 | 0 | 0 |
| Lanzo Nube | 20 | 11 | 3 | 1 |

Lanzo Local y Lanzo Básico Legacy no tienen notificaciones cloud.

### Duplicados por `event_key`

Resultado: `0 filas`.

### Metadata sensible

Se buscó metadata que contenga:

- `token`
- `fingerprint`
- `password`
- `secret`
- `security`

Resultado: `0 filas`.

## Estado de producción

Producción sigue funcionando con el contrato actual:

- Lanzo Local sin notificaciones cloud.
- Lanzo Nube con Centro de Notificaciones, Soporte y realtime.
- Staff sin `notifications` queda bloqueado en Centro de Notificaciones.
- Staff sin `support_center` queda bloqueado en Soporte.
- Tablas con RLS activo.
- Tablas sin grants directos a cliente.
- Privadas sin `EXECUTE` para cliente.
- Sin duplicados por `event_key`.
- Sin metadata sensible detectada.

## Riesgos pendientes

- Existen `3` notificaciones en Lanzo Nube con `metadata.test_data = true`. No se eliminaron por restricción de no borrar datos. Si se decide limpiar, debe hacerse en una fase explícita y con revisión previa.
- Las migraciones nuevas son defensivas/idempotentes y fueron versionadas en GitHub; producción ya tenía los objetos. La verificación ejecutada fue contra el estado actual de producción, no un reset completo de una rama limpia.
