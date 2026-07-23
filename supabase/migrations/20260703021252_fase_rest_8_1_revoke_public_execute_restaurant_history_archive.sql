-- FASE REST.8.1 — Revocar execute público en RPCs REST.8
-- Mantiene execute solo para anon/authenticated.

revoke all on function public.pos_get_restaurant_orders_history(
  text, text, text, text, timestamptz, timestamptz, text, integer
) from public;

grant execute on function public.pos_get_restaurant_orders_history(
  text, text, text, text, timestamptz, timestamptz, text, integer
) to anon, authenticated;

revoke all on function public.pos_archive_restaurant_order(
  text, text, text, text, text, text, jsonb, text
) from public;

grant execute on function public.pos_archive_restaurant_order(
  text, text, text, text, text, text, jsonb, text
) to anon, authenticated;
;
