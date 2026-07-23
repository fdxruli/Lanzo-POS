-- HOTFIX ECOM.ORDERS.1.3
-- Restaura el acceso PostgREST para el cliente público de Lanzo POS.
-- La autorización real permanece dentro de las RPC mediante licencia,
-- dispositivo, security token, sesión staff, permisos, feature flags y rate limit.

revoke all on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) from public;
grant execute on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) to anon, authenticated;

revoke all on function public.ecommerce_admin_get_order(text, text, text, uuid, text) from public;
grant execute on function public.ecommerce_admin_get_order(text, text, text, uuid, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_mark_order_seen(text, text, text, uuid, text) from public;
grant execute on function public.ecommerce_admin_mark_order_seen(text, text, text, uuid, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) from public;
grant execute on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_reject_order(text, text, text, uuid, text, text) from public;
grant execute on function public.ecommerce_admin_reject_order(text, text, text, uuid, text, text) to anon, authenticated;

revoke all on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) from public;
grant execute on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) to anon, authenticated;

revoke all on function public.mark_pos_notification_read(text, text, text, uuid, text) from public;
grant execute on function public.mark_pos_notification_read(text, text, text, uuid, text) to anon, authenticated;

revoke all on function public.mark_all_pos_notifications_read(text, text, text, text) from public;
grant execute on function public.mark_all_pos_notifications_read(text, text, text, text) to anon, authenticated;

revoke all on function public.archive_pos_notification(text, text, text, uuid, text) from public;
grant execute on function public.archive_pos_notification(text, text, text, uuid, text) to anon, authenticated;

revoke all on function public.refresh_operational_notifications(text, text, text, text) from public;
grant execute on function public.refresh_operational_notifications(text, text, text, text) to anon, authenticated;

revoke all on function private.ecommerce_orders_authorize_v1(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.validate_pos_sync_context(text, text, text, text) from public, anon, authenticated;
revoke all on function private.get_pos_notification_context(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.pos_notification_required_permission_allowed_v1(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.pos_notification_target_allowed_v1(text, uuid, text, jsonb, text, uuid, jsonb) from public, anon, authenticated;;
