create or replace function private.pos_cad6_truthy(p_value text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select private.pos_cad6_normalize_text(p_value) in ('true','1','yes','si','y','s');
$$;

create or replace function private.pos_cad6_text_matches_perishable(p_value text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select private.pos_cad6_normalize_text(p_value) like any (array[
    '%verduleria%', '%fruteria%', '%frutas%', '%verduras%',
    '%carniceria%', '%polleria%', '%pescaderia%', '%panaderia%',
    '%lacteo%', '%lacteos%', '%farmacia%', '%alimentos preparados%',
    '%food_service%', '%food service%', '%restaurante%', '%dark kitchen%',
    '%abarrotes perecederos%'
  ]);
$$;

create or replace function private.pos_cad6_product_context_text(p_product public.pos_products)
returns text
language plpgsql
stable
set search_path to ''
as $$
declare
  v_category_name text;
begin
  select c.name into v_category_name
  from public.pos_categories c
  where c.license_id = p_product.license_id
    and c.id = p_product.category_id
    and c.deleted_at is null
  limit 1;

  return concat_ws(' ',
    p_product.category_id,
    v_category_name,
    p_product.metadata->>'rubro',
    p_product.metadata->>'rubroContext',
    p_product.metadata->>'businessType',
    p_product.metadata->>'categoryName',
    p_product.metadata->>'category'
  );
end;
$$;

create or replace function private.pos_cad6_product_is_perishable_blocking(p_product public.pos_products)
returns boolean
language plpgsql
stable
set search_path to ''
as $$
declare
  v_context_text text;
begin
  if coalesce(p_product.expiration_mode, 'NONE') <> 'SHELF_LIFE' then
    return false;
  end if;

  if private.pos_cad6_truthy(p_product.metadata->>'perishableBlocking')
    or private.pos_cad6_truthy(p_product.metadata->>'perishable_blocking')
    or private.pos_cad6_truthy(p_product.metadata->>'isPerishable')
    or private.pos_cad6_truthy(p_product.metadata->>'is_perishable')
    or private.pos_cad6_truthy(p_product.batch_management->>'perishableBlocking')
    or private.pos_cad6_truthy(p_product.batch_management->>'perishable_blocking') then
    return true;
  end if;

  v_context_text := private.pos_cad6_product_context_text(p_product);
  return private.pos_cad6_text_matches_perishable(v_context_text);
end;
$$;

create or replace function private.pos_cad6_product_shelf_life_target_date(p_product public.pos_products)
returns date
language plpgsql
stable
set search_path to ''
as $$
declare
  v_raw text;
  v_unit text;
  v_value numeric;
  v_base timestamptz;
begin
  v_raw := coalesce(
    nullif(p_product.metadata->>'shelfLifeTargetDate', ''),
    nullif(p_product.metadata->>'shelf_life_target_date', ''),
    nullif(p_product.metadata->>'alertTargetDate', ''),
    nullif(p_product.metadata->>'alert_target_date', ''),
    nullif(p_product.metadata->>'expiryDate', ''),
    nullif(p_product.metadata->>'expiry_date', '')
  );

  if v_raw is not null and v_raw ~ '^\d{4}-\d{2}-\d{2}' then
    return v_raw::date;
  end if;

  v_value := coalesce(p_product.shelf_life_value, 0);
  if v_value <= 0 then
    return null;
  end if;

  v_unit := private.pos_cad6_normalize_text(coalesce(p_product.shelf_life_unit, 'days'));
  v_base := coalesce(p_product.created_at, now());

  if v_unit in ('hour','hours','hora','horas') then
    return (v_base + make_interval(hours => ceil(v_value)::integer))::date;
  elsif v_unit in ('month','months','mes','meses') then
    return (v_base + make_interval(months => ceil(v_value)::integer))::date;
  else
    return (v_base + make_interval(days => ceil(v_value)::integer))::date;
  end if;
end;
$$;

create or replace function private.pos_cad6_shelf_life_expired_for_sale(p_product public.pos_products)
returns boolean
language sql
stable
set search_path to ''
as $$
  select private.pos_cad6_product_is_perishable_blocking(p_product)
     and private.pos_cad6_product_shelf_life_target_date(p_product) is not null
     and private.pos_cad6_product_shelf_life_target_date(p_product) < current_date;
$$;;
