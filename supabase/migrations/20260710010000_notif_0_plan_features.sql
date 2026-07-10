-- FASE NOTIF.DB.DRIFT.1
-- NOTIF.0 — Plan features para Centro de Notificaciones / Soporte.
-- Idempotente: solo mezcla flags JSONB; no toca precios, límites ni otros campos.

update public.plans p
set features = coalesce(p.features, '{}'::jsonb) || jsonb_build_object(
  'ticker_enabled', true,
  'ticker_mode', 'local',
  'local_system_alerts', true,
  'local_inventory_alerts', true,
  'local_backup_alerts', true,
  'notification_center', false,
  'cloud_notifications', false,
  'support_channel', 'email',
  'support_email_enabled', true,
  'support_center', false,
  'support_tickets', false,
  'support_ticket_history', false,
  'support_realtime', false,
  'commercial_messages', 'generic',
  'plan_messages_personalized', false
)
where p.code = 'free_trial';

update public.plans p
set features = coalesce(p.features, '{}'::jsonb) || jsonb_build_object(
  'ticker_enabled', true,
  'ticker_mode', 'local',
  'notification_center', false,
  'cloud_notifications', false,
  'support_channel', 'email',
  'support_email_enabled', true,
  'support_center', false,
  'support_tickets', false,
  'support_ticket_history', false,
  'support_realtime', false,
  'commercial_messages', 'generic',
  'plan_messages_personalized', false,
  'legacy_plan', true
)
where p.code = 'basic_monthly';

update public.plans p
set features = coalesce(p.features, '{}'::jsonb) || jsonb_build_object(
  'ticker_enabled', true,
  'ticker_mode', 'summary',
  'local_system_alerts', true,
  'local_inventory_alerts', true,
  'local_backup_alerts', false,
  'notification_center', true,
  'cloud_notifications', true,
  'support_channel', 'in_app',
  'support_email_enabled', true,
  'support_center', true,
  'support_tickets', true,
  'support_ticket_history', true,
  'support_realtime', true,
  'commercial_messages', 'personalized',
  'plan_messages_personalized', true
)
where p.code = 'pro_monthly';
