-- ECOM.PHASE1.PUBLICATION.ELIGIBILITY
-- Run only after the phase-1 migration. It is rollback-only and never creates
-- orders, sales, cash movements, inventory movements, or license records.
begin;

do $test$
declare
  v_product_id uuid;
  v_revision_before bigint;
  v_revision_after bigint;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ecommerce_published_products_publication_eligible'
      and conrelid = 'public.ecommerce_published_products'::regclass
  ) then
    raise exception 'PHASE1_TEST: publication eligibility constraint is missing';
  end if;

  if has_function_privilege(
    'anon',
    'private.ecommerce_publication_eligibility(uuid,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'private.ecommerce_publication_eligibility(uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'PHASE1_TEST: private publication helper is client-callable';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_products
    where deleted_at is null
      and is_published is true
      and (
        business_capability_status not in ('compatible', 'simple_override')
        or public_configuration_mode not in ('compatible', 'simple_override')
      )
  ) then
    raise exception 'PHASE1_TEST: an invisible published product remains';
  end if;

  select pp.id, p.catalog_revision
  into v_product_id, v_revision_before
  from public.ecommerce_published_products pp
  join public.ecommerce_portals p on p.id = pp.portal_id
  where pp.deleted_at is null and pp.is_published is true
  order by pp.created_at
  limit 1;
  if v_product_id is null then
    raise exception 'PHASE1_TEST: requires one eligible published product fixture';
  end if;

  -- Database enforcement must reject the invalid state even if an RPC writer
  -- is bypassed. The caught check violation leaves this transaction usable.
  begin
    update public.ecommerce_published_products
    set is_published = true,
        business_capability_status = 'requires_review',
        public_configuration_mode = 'requires_review'
    where id = v_product_id;
    raise exception 'PHASE1_TEST: invalid published state was accepted';
  exception when check_violation then
    null;
  end;

  update public.ecommerce_published_products
  set is_published = false
  where id = v_product_id;
  select p.catalog_revision into v_revision_after
  from public.ecommerce_portals p
  join public.ecommerce_published_products pp on pp.portal_id = p.id
  where pp.id = v_product_id;
  if v_revision_after <= v_revision_before then
    raise exception 'PHASE1_TEST: unpublish did not invalidate catalog revision';
  end if;
end;
$test$;

rollback;
