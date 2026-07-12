-- ECOM.POS.3 — Permisos y cierre de superficie
-- Alineado con la migración aplicada en producción: 20260712032526.

revoke all on function private.ecommerce_pos_sale_lookup_v2(uuid, text, text) from public, anon, authenticated;

revoke all on function public.ecommerce_get_pos_conversion_state(text, text, text, text, uuid, uuid) from public;
revoke all on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_cancel_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_admin_release_pos_draft(text, text, text, text, uuid, uuid, text) from public;

grant execute on function public.ecommerce_get_pos_conversion_state(text, text, text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_cancel_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_admin_release_pos_draft(text, text, text, text, uuid, uuid, text) to anon, authenticated;

revoke all on table public.ecommerce_orders from public, anon, authenticated;
revoke all on table public.ecommerce_order_events from public, anon, authenticated;
