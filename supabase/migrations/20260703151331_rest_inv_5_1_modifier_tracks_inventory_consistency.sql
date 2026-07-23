create or replace function private.rest_inv5_modifier_tracks_inventory(p_modifier jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_ingredient_id text;
  v_quantity numeric;
begin
  if p_modifier is null or jsonb_typeof(p_modifier) <> 'object' then
    return false;
  end if;

  v_ingredient_id := private.pos_sale_jsonb_text(
    p_modifier,
    array['ingredientId','ingredient_id'],
    null
  );
  v_quantity := private.rest_inv5_modifier_inventory_quantity(p_modifier);

  return v_ingredient_id is not null
    and v_quantity is not null
    and v_quantity > 0;
end;
$$;

comment on function private.rest_inv5_modifier_tracks_inventory(jsonb)
is 'REST.INV.5.1: deriva tracking de ingredientId + cantidad válida; ignora tracksInventory explícito contradictorio.';;
