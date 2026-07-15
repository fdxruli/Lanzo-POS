-- ECOM.PRODUCTS.MODEL.1.1 revision and availability regression test.
-- Execute in an isolated test database. All changes are rolled back.
begin;

do $test$
declare
  v_license_id uuid := '23300000-0000-4000-8000-000000000001';
  v_portal_id uuid := '23300000-0000-4000-8000-000000000002';
  v_published_id uuid := '23300000-0000-4000-8000-000000000003';
  v_conflict boolean := false;
  v_stale boolean := false;
  v_original_revision text;
  v_original_kind text;
  v_original_order numeric;
  v_original_hash text;
begin
  insert into public.licenses(id,license_key,license_type,status,expires_at,features)
  values (
    v_license_id,'ECOM-MODEL-1-1-REVISION-ROLLBACK','free','active',now()+interval '1 hour',
    '{"ecommerce_portal_enabled":true,"ecommerce_max_published_products":10}'::jsonb
  );

  insert into public.ecommerce_portals(id,license_id,slug,status,name)
  values (v_portal_id,v_license_id,'model-1-1-revision-rollback','published','Model 1.1 revision');

  insert into public.ecommerce_published_products(
    id,portal_id,license_id,local_product_ref,public_name,price,
    manual_available,source_available,requires_configuration,is_available,
    source_state,source_revision,source_revision_kind,source_revision_order,source_payload_hash
  ) values (
    v_published_id,v_portal_id,v_license_id,'revision-product','Revision product',10,
    true,true,false,true,
    'in_stock','version:5','version',5,'inventory-snapshot-hash'
  );

  select source_revision,source_revision_kind,source_revision_order,source_payload_hash
  into v_original_revision,v_original_kind,v_original_order,v_original_hash
  from public.ecommerce_published_products
  where id=v_published_id;

  -- First configuration revision and exact repeat are accepted.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,v_published_id,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[]}',
    'version:100',false
  );
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,v_published_id,
    '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[]}',
    'version:100',false
  );

  if (select metadata->>'ecommerce_configuration_source_revision' <> 'version:100'
      or metadata->>'ecommerce_configuration_payload_hash' is null
      from public.ecommerce_published_products where id=v_published_id) then
    raise exception 'REVISION_IDEMPOTENCY_FAILED';
  end if;

  -- Equal revision with different content conflicts.
  begin
    perform private.ecommerce_apply_product_configuration_checked(
      v_license_id,v_published_id,
      '{"type":"recipe","version":1,"hasRecipe":true,"variants":[],"optionGroups":[]}',
      'version:100',false
    );
  exception when others then
    if sqlerrm like 'ECOMMERCE_CATALOG_SOURCE_CONFLICT%' then
      v_conflict := true;
    else
      raise;
    end if;
  end;
  if not v_conflict then raise exception 'EQUAL_REVISION_CONFLICT_NOT_DETECTED'; end if;

  -- Lower revision is stale.
  begin
    perform private.ecommerce_apply_product_configuration_checked(
      v_license_id,v_published_id,
      '{"type":"simple","version":1,"hasRecipe":false,"variants":[],"optionGroups":[]}',
      'version:99',false
    );
  exception when others then
    if sqlerrm like 'ECOMMERCE_CATALOG_SOURCE_STALE%' then
      v_stale := true;
    else
      raise;
    end if;
  end;
  if not v_stale then raise exception 'STALE_REVISION_NOT_DETECTED'; end if;

  -- Higher revision is accepted.
  perform private.ecommerce_apply_product_configuration_checked(
    v_license_id,v_published_id,
    '{"type":"recipe","version":1,"hasRecipe":true,"variants":[],"optionGroups":[]}',
    'version:101',false
  );

  if (select configuration_type <> 'recipe'
      or metadata->>'ecommerce_configuration_source_revision' <> 'version:101'
      from public.ecommerce_published_products where id=v_published_id) then
    raise exception 'HIGHER_REVISION_NOT_APPLIED';
  end if;

  -- Configuration revision never overwrites catalog/inventory revision.
  if (select source_revision is distinct from v_original_revision
      or source_revision_kind is distinct from v_original_kind
      or source_revision_order is distinct from v_original_order
      or source_payload_hash is distinct from v_original_hash
      from public.ecommerce_published_products where id=v_published_id) then
    raise exception 'CONFIGURATION_REVISION_NOT_ISOLATED';
  end if;

  -- Availability remains three independent dimensions.
  update public.ecommerce_published_products
  set manual_available=true,source_available=true,requires_configuration=true
  where id=v_published_id;
  if (select source_available is not true or is_available is not false
      from public.ecommerce_published_products where id=v_published_id) then
    raise exception 'CONFIGURATION_BLOCK_CONTAMINATED_SOURCE';
  end if;

  update public.ecommerce_published_products
  set requires_configuration=false
  where id=v_published_id;
  if (select source_available is not true or is_available is not true
      from public.ecommerce_published_products where id=v_published_id) then
    raise exception 'CONFIGURATION_BLOCK_NOT_REVERSIBLE';
  end if;

  raise notice 'ECOM.PRODUCTS.MODEL.1.1 revision matrix passed: 7/7.';
end;
$test$;

rollback;

select
  (select count(*) from public.licenses where license_key='ECOM-MODEL-1-1-REVISION-ROLLBACK') as synthetic_licenses,
  (select count(*) from public.ecommerce_portals where id='23300000-0000-4000-8000-000000000002') as synthetic_portals,
  (select count(*) from public.ecommerce_published_products where id='23300000-0000-4000-8000-000000000003') as synthetic_products;
