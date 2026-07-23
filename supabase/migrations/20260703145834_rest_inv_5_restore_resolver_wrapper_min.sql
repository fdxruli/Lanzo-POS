create or replace function private.resolve_sale_inventory_allocations(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return private.resolve_sale_inventory_allocations_direct_rest_inv5(
    p_license_id,
    private.rest_inv5_expand_sale_inventory_items(p_license_id, p_items, p_sale_id),
    p_sale_id
  );
end;
$$;;
