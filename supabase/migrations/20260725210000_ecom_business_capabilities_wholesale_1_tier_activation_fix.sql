-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1
-- Compensating migration. The canonical tier writer must derive
-- wholesale_enabled from the parent product, never from a tier row's id.

do $migration$
declare
  v_definition text;
  v_replaced text;
  v_matches integer;
begin
  select pg_get_functiondef(
    'private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb)'::regprocedure
  ) into v_definition;

  v_matches := (length(v_definition) - length(replace(
    v_definition,
    't.published_product_id = id',
    ''
  ))) / length('t.published_product_id = id');
  if v_matches <> 2 then
    raise exception 'ECOMMERCE_WHOLESALE_PARENT_REFERENCE_PATCH_NOT_APPLIED: % match(es)', v_matches;
  end if;

  v_replaced := replace(
    v_definition,
    't.published_product_id = id',
    't.published_product_id = v_product.id'
  );
  execute v_replaced;
end;
$migration$;

alter function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb)
  owner to postgres;
revoke all on function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb)
  from public, anon, authenticated, service_role;

comment on function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb) is
  'Canonical normalized wholesale tier writer. Tiers and wholesale_enabled are derived from the locked published-product parent.';
