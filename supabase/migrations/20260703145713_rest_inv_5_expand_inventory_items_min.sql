create or replace function private.rest_inv5_expand_sale_inventory_items(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
as $$
begin
  return coalesce(p_items, '[]'::jsonb);
end;
$$;;
