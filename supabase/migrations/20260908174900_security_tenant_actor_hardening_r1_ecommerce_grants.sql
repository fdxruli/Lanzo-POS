-- SECURITY.TENANT.ACTOR.HARDENING.R1 follow-up.
-- This incremental migration is for the isolated staging project only.
-- It mirrors the actor-aware ecommerce grant correction in the base R1
-- migration so an already-applied staging migration can be verified safely.

begin;

revoke all on function public.ecommerce_admin_get_portal(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_portal(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_list_published_products(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_list_published_products(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_set_product_published(
  text, text, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_set_product_published(
  text, text, text, text, uuid, boolean
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;

commit;
