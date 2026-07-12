-- ECOM.FE.CATALOG.3 - Snapshot transitorio para preservar disponibilidad legacy.
-- Se ejecuta inmediatamente antes de la migracion principal y no expone datos al cliente.

create schema if not exists private;

create table if not exists private.ecommerce_catalog_3_legacy_availability (
  product_id uuid primary key,
  is_available boolean not null
);

insert into private.ecommerce_catalog_3_legacy_availability (product_id, is_available)
select pp.id, pp.is_available
from public.ecommerce_published_products pp
on conflict (product_id) do nothing;

revoke all on table private.ecommerce_catalog_3_legacy_availability
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.ecommerce_catalog_3_legacy_availability
  to service_role;
