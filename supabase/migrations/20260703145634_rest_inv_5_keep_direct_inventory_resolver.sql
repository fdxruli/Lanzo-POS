do $$
begin
  if to_regprocedure('private.resolve_sale_inventory_allocations_direct_rest_inv5(uuid,jsonb,text)') is null then
    alter function private.resolve_sale_inventory_allocations(uuid,jsonb,text)
      rename to resolve_sale_inventory_allocations_direct_rest_inv5;
  end if;
end;
$$;;
