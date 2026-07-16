-- HOTFIX ECOM.CATALOG.BOOTSTRAP.CONSISTENCY regression checks.
-- Read-only assertions against the effective schema and published catalog.

begin;

do $test$
declare
  v_definition text;
  v_trigger_enabled "char";
  v_row record;
  v_evaluation jsonb;
  v_expected_state text;
  v_expected_stock numeric;
  v_catalog jsonb;
  v_detail jsonb;
  v_item jsonb;
  v_group jsonb;
  v_found boolean;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'ecommerce_apply_product_configuration_checked'
  limit 1;

  if v_definition is null
     or position('ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH' in v_definition) = 0
     or position('v_canonical_source' in v_definition) = 0 then
    raise exception 'CONFIGURATION_CANONICAL_REVISION_GUARD_MISSING';
  end if;

  select t.tgenabled
  into v_trigger_enabled
  from pg_trigger t
  where t.tgrelid = 'public.ecommerce_published_products'::regclass
    and t.tgname = 'zz_ecommerce_recipe_projection_guard'
    and not t.tgisinternal;

  if v_trigger_enabled is distinct from 'O' then
    raise exception 'RECIPE_PROJECTION_TRIGGER_NOT_ENABLED: %', v_trigger_enabled;
  end if;

  for v_row in
    select pp.*, p.recipe, p.server_version
    from public.ecommerce_published_products pp
    join public.pos_products p
      on p.license_id = pp.license_id
     and p.id = pp.local_product_ref
    where pp.deleted_at is null
      and pp.is_published is true
      and pp.has_recipe is true
      and pp.availability_source = 'recipe'
      and jsonb_typeof(p.recipe) = 'array'
      and jsonb_array_length(p.recipe) > 0
  loop
    v_evaluation := private.ecommerce_recipe_capacity(
      v_row.license_id,
      v_row.recipe,
      current_date
    );
    v_expected_state := coalesce(v_evaluation->>'status', 'unverified');
    v_expected_stock := case
      when v_expected_state in ('in_stock', 'out_of_stock')
        then (v_evaluation->>'availableStock')::numeric
      else null
    end;

    if v_row.source_state is distinct from v_expected_state then
      raise exception 'RECIPE_STATE_DRIFT: product=%, stored=%, canonical=%',
        v_row.public_name, v_row.source_state, v_expected_state;
    end if;

    if v_expected_state = 'in_stock'
       and (v_row.source_available is not true or v_row.stock_snapshot is distinct from v_expected_stock) then
      raise exception 'RECIPE_AVAILABLE_PROJECTION_DRIFT: product=%, stored=%, canonical=%',
        v_row.public_name, v_row.stock_snapshot, v_expected_stock;
    end if;

    if v_expected_state = 'out_of_stock'
       and (v_row.source_available is not false or coalesce(v_row.stock_snapshot, -1) <> 0) then
      raise exception 'RECIPE_OUT_OF_STOCK_PROJECTION_DRIFT: product=%', v_row.public_name;
    end if;

    if v_row.metadata->>'ecommerce_configuration_source_revision'
       is distinct from 'version:' || v_row.server_version::text then
      raise exception 'CONFIGURATION_REVISION_DRIFT: product=%, stored=%, canonical=%',
        v_row.public_name,
        v_row.metadata->>'ecommerce_configuration_source_revision',
        'version:' || v_row.server_version::text;
    end if;
  end loop;

  if exists (
    select 1
    from public.ecommerce_portals p
    where p.slug = 'farmaciagary'
      and p.deleted_at is null
  ) then
    v_catalog := public.ecommerce_get_catalog('farmaciagary', 100, 0);
    if coalesce((v_catalog->>'success')::boolean, false) is not true then
      raise exception 'PUBLIC_CATALOG_FAILED: %', v_catalog;
    end if;

    for v_item in select value from jsonb_array_elements(v_catalog->'items')
    loop
      if v_item->>'name' in (
        'Hamburguesa de pollo',
        'Papas a la francesa',
        'Quesadilla de queso',
        'Taco al pastor'
      ) and coalesce((v_item->>'isAvailable')::boolean, false) is not true then
        raise exception 'PUBLIC_RECIPE_FALSE_UNAVAILABLE: %', v_item;
      end if;
    end loop;

    select public.ecommerce_get_product_configuration('farmaciagary', pp.id)
    into v_detail
    from public.ecommerce_published_products pp
    where pp.public_name = 'Taco al pastor'
      and pp.deleted_at is null
    limit 1;

    if v_detail is not null then
      v_found := false;
      for v_group in select value from jsonb_array_elements(v_detail->'groups')
      loop
        if v_group->>'publicName' = 'Extras' then
          v_found := true;
          if v_group->>'selectionType' <> 'multiple'
             or (v_group->>'minSelect')::integer <> 0
             or (v_group->>'maxSelect')::integer <> 3 then
            raise exception 'TACO_EXTRAS_CONFIGURATION_DRIFT: %', v_group;
          end if;
        end if;
      end loop;
      if not v_found then raise exception 'TACO_EXTRAS_GROUP_MISSING'; end if;
    end if;
  end if;

  if not exists (
    select 1
    from public.pos_sync_events e
    where e.metadata->>'source' = 'ecom_catalog_bootstrap_consistency_repair'
      and e.entity_type = 'product_batch'
  ) then
    raise exception 'BATCH_RECOVERY_EVENTS_MISSING';
  end if;
end;
$test$;

rollback;
