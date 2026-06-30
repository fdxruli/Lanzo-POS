-- FASE CAD.6.1 — Cierre de deteccion perecedera desde perfil de negocio.
-- Idempotente: reemplaza solo el helper de contexto usado por SHELF_LIFE.

create or replace function private.pos_cad6_product_context_text(p_product public.pos_products)
returns text
language plpgsql
stable
set search_path to ''
as $$
declare
  v_category_name text;
  v_profile_type text;
begin
  select c.name into v_category_name
  from public.pos_categories c
  where c.license_id = p_product.license_id
    and c.id = p_product.category_id
    and c.deleted_at is null
  limit 1;

  select bp.business_type::text into v_profile_type
  from public.business_profiles bp
  where bp.license_id = p_product.license_id
  limit 1;

  return concat_ws(' ',
    p_product.category_id,
    v_category_name,
    v_profile_type,
    p_product.metadata->>'rubro',
    p_product.metadata->>'rubroContext',
    p_product.metadata->>'businessType',
    p_product.metadata->>'categoryName',
    p_product.metadata->>'category'
  );
end;
$$;
