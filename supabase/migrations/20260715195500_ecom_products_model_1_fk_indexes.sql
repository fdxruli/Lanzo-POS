-- ECOM.PRODUCTS.MODEL.1 compensatory performance hardening.
-- Add direct covering indexes for foreign keys reported by the Supabase advisor.

create index if not exists idx_ecommerce_option_groups_portal_id
  on public.ecommerce_published_option_groups(portal_id);

create index if not exists idx_ecommerce_option_groups_license_id
  on public.ecommerce_published_option_groups(license_id);

create index if not exists idx_ecommerce_options_published_product_id
  on public.ecommerce_published_options(published_product_id);

create index if not exists idx_ecommerce_options_portal_id
  on public.ecommerce_published_options(portal_id);

comment on index public.idx_ecommerce_option_groups_portal_id is
  'Covering index for ecommerce_published_option_groups.portal_id foreign key.';
comment on index public.idx_ecommerce_option_groups_license_id is
  'Covering index for ecommerce_published_option_groups.license_id foreign key.';
comment on index public.idx_ecommerce_options_published_product_id is
  'Covering index for ecommerce_published_options.published_product_id foreign key.';
comment on index public.idx_ecommerce_options_portal_id is
  'Covering index for ecommerce_published_options.portal_id foreign key.';
