create or replace function private.resolve_sale_inventory_allocations(p_license_id uuid, p_items jsonb, p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_expanded_items jsonb;
  v_response jsonb;
begin
  v_expanded_items := private.rest_inv5_expand_sale_inventory_items(p_license_id, p_items, p_sale_id);
  v_response := private.resolve_sale_inventory_allocations_direct_rest_inv5(p_license_id, v_expanded_items, p_sale_id);
  return private.rest_inv5_enrich_inventory_allocations(v_expanded_items, v_response);
end;
$$;;
