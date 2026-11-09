-- Validate recipe references at the catalog boundary, preserving historical data.
-- No existing records are changed. A broken legacy recipe can still be edited
-- for unrelated fields, but cannot be reactivated or saved as a new recipe.
create or replace function private.pos_guard_recipe_references_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_unit text;
  v_new_unit text;
  v_check_dependencies boolean := false;
  v_validate_recipe boolean := false;
  v_dependent text;
  v_item record;
  v_id text;
  v_quantity text;
  v_seen text[] := array[]::text[];
  v_ingredient public.pos_products;
  v_ingredient_unit text;
begin
  -- Prevent active recipes from being orphaned by ingredient updates/deletes.
  if tg_op = 'DELETE' then
    v_check_dependencies := old.product_type = 'ingredient';
  elsif tg_op = 'UPDATE' and old.product_type = 'ingredient' then
    v_old_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      nullif(old.metadata->>'unit', ''),
      nullif(old.bulk_data->'purchase'->>'unit', ''),
      nullif(old.bulk_data->>'unit', ''),
      nullif(old.metadata->>'measurementUnit', ''),
      nullif(old.metadata->>'saleUnit', ''),
      case when old.sale_type = 'unit' then 'pza' else 'kg' end));
    v_new_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      nullif(new.metadata->>'unit', ''),
      nullif(new.bulk_data->'purchase'->>'unit', ''),
      nullif(new.bulk_data->>'unit', ''),
      nullif(new.metadata->>'measurementUnit', ''),
      nullif(new.metadata->>'saleUnit', ''),
      case when new.sale_type = 'unit' then 'pza' else 'kg' end));
    v_check_dependencies := new.product_type <> 'ingredient'
      or new.is_active is false or new.deleted_at is not null
      or new.track_stock is false
      or v_old_unit is distinct from v_new_unit;
  end if;

  if v_check_dependencies then
    select dish.name into v_dependent
      from public.pos_products dish
      where dish.license_id = old.license_id
        and dish.id <> old.id
        and dish.product_type = 'sellable'
        and dish.is_active and dish.deleted_at is null
        and pg_catalog.jsonb_typeof(dish.recipe) = 'array'
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(dish.recipe) component
          where coalesce(component->>'ingredientId', component->>'productId') = old.id
        )
      limit 1;
    if v_dependent is not null then
      raise exception 'RECIPE_INGREDIENT_IN_USE: %', v_dependent using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  v_validate_recipe := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_validate_recipe := new.recipe is distinct from old.recipe
      or (new.is_active is true and old.is_active is distinct from new.is_active)
      or (new.product_type = 'sellable' and new.product_type is distinct from old.product_type);
  end if;
  if not v_validate_recipe or new.recipe is null then return new; end if;

  if pg_catalog.jsonb_typeof(new.recipe) <> 'array' then
    raise exception 'RECIPE_INVALID_FORMAT' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(new.recipe) = 0 then return new; end if;
  if new.product_type <> 'sellable' then
    raise exception 'RECIPE_PRODUCT_TYPE_INVALID' using errcode = 'P0001';
  end if;

  -- Stable lock order serializes catalog changes with recipe validation.
  for v_item in
    select component.value as item from pg_catalog.jsonb_array_elements(new.recipe) component
    order by coalesce(component.value->>'ingredientId', component.value->>'productId')
  loop
    v_id := nullif(coalesce(v_item.item->>'ingredientId', v_item.item->>'productId'), '');
    v_quantity := v_item.item->>'quantity';
    if pg_catalog.jsonb_typeof(v_item.item) <> 'object'
       or v_id is null or v_id = new.id or v_id = any(v_seen)
       or v_quantity is null
       or v_quantity !~ '^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$'
    then
      raise exception 'RECIPE_COMPONENT_INVALID' using errcode = 'P0001';
    end if;
    if v_quantity::numeric <= 0 then
      raise exception 'RECIPE_QUANTITY_INVALID' using errcode = 'P0001';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_id);

    select * into v_ingredient from public.pos_products p
      where p.id = v_id and p.license_id = new.license_id
        and p.deleted_at is null and p.is_active
        and p.product_type = 'ingredient' and p.track_stock
      for update;
    if not found then
      raise exception 'RECIPE_INGREDIENT_UNAVAILABLE: %', v_id using errcode = 'P0001';
    end if;

    v_ingredient_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      nullif(v_ingredient.metadata->>'unit', ''),
      nullif(v_ingredient.bulk_data->'purchase'->>'unit', ''),
      nullif(v_ingredient.bulk_data->>'unit', ''),
      nullif(v_ingredient.metadata->>'measurementUnit', ''),
      nullif(v_ingredient.metadata->>'saleUnit', ''),
      case when v_ingredient.sale_type = 'unit' then 'pza' else 'kg' end));
    if v_ingredient_unit is null or
       (nullif(v_item.item->>'unit', '') is not null and
        private.ecommerce_normalize_inventory_unit(v_item.item->>'unit') is distinct from v_ingredient_unit)
    then
      raise exception 'RECIPE_INGREDIENT_UNIT_MISMATCH: %', v_id using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$function$;

revoke all on function private.pos_guard_recipe_references_v1()
  from public, anon, authenticated, service_role;

create trigger trg_pos_products_guard_recipe_references_v1
before insert or update of recipe, product_type, is_active, deleted_at,
  track_stock, metadata, bulk_data, sale_type or delete
on public.pos_products
for each row
execute function private.pos_guard_recipe_references_v1();
