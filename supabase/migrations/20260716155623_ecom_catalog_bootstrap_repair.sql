with published_parents as (
  select distinct pp.license_id, p.id as product_id
  from public.ecommerce_published_products pp
  join public.pos_products p
    on p.license_id = pp.license_id
   and p.id = pp.local_product_ref
  where pp.deleted_at is null
    and pp.is_published is true
    and p.deleted_at is null
),
recipe_dependencies as (
  select distinct pp.license_id,
    nullif(btrim(coalesce(
      component->>'ingredientId',
      component->>'ingredient_id',
      component->>'productId'
    )), '') as product_id
  from public.ecommerce_published_products pp
  join public.pos_products parent
    on parent.license_id = pp.license_id
   and parent.id = pp.local_product_ref
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(parent.recipe) = 'array'
      then parent.recipe else '[]'::jsonb end
  ) component
  where pp.deleted_at is null
    and pp.is_published is true
),
modifier_dependencies as (
  select distinct pp.license_id,
    nullif(btrim(coalesce(
      option_value->>'ingredientId',
      option_value->>'ingredient_id',
      option_value->>'sourceIngredientId'
    )), '') as product_id
  from public.ecommerce_published_products pp
  join public.pos_products parent
    on parent.license_id = pp.license_id
   and parent.id = pp.local_product_ref
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(parent.modifiers) = 'array'
      then parent.modifiers else '[]'::jsonb end
  ) group_value
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(group_value->'options') = 'array'
      then group_value->'options' else '[]'::jsonb end
  ) option_value
  where pp.deleted_at is null
    and pp.is_published is true
),
required_products as (
  select license_id, product_id from published_parents
  union
  select license_id, product_id from recipe_dependencies where product_id is not null
  union
  select license_id, product_id from modifier_dependencies where product_id is not null
)
insert into public.pos_sync_events (
  license_id, entity_type, entity_id, operation, server_version, metadata
)
select p.license_id, 'product', p.id, 'update', p.server_version,
  jsonb_build_object(
    'source', 'ecom_catalog_bootstrap_consistency_repair',
    'reason', 'missing_or_stale_incremental_event'
  )
from required_products required
join public.pos_products p
  on p.license_id = required.license_id
 and p.id = required.product_id
where p.deleted_at is null
  and not exists (
    select 1 from public.pos_sync_events e
    where e.license_id = p.license_id
      and e.entity_type = 'product'
      and e.entity_id = p.id
      and e.server_version >= p.server_version
  );

with published_parents as (
  select distinct pp.license_id, p.id as product_id
  from public.ecommerce_published_products pp
  join public.pos_products p
    on p.license_id = pp.license_id
   and p.id = pp.local_product_ref
  where pp.deleted_at is null
    and pp.is_published is true
    and p.deleted_at is null
),
recipe_dependencies as (
  select distinct pp.license_id,
    nullif(btrim(coalesce(
      component->>'ingredientId',
      component->>'ingredient_id',
      component->>'productId'
    )), '') as product_id
  from public.ecommerce_published_products pp
  join public.pos_products parent
    on parent.license_id = pp.license_id
   and parent.id = pp.local_product_ref
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(parent.recipe) = 'array'
      then parent.recipe else '[]'::jsonb end
  ) component
  where pp.deleted_at is null
    and pp.is_published is true
),
modifier_dependencies as (
  select distinct pp.license_id,
    nullif(btrim(coalesce(
      option_value->>'ingredientId',
      option_value->>'ingredient_id',
      option_value->>'sourceIngredientId'
    )), '') as product_id
  from public.ecommerce_published_products pp
  join public.pos_products parent
    on parent.license_id = pp.license_id
   and parent.id = pp.local_product_ref
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(parent.modifiers) = 'array'
      then parent.modifiers else '[]'::jsonb end
  ) group_value
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(group_value->'options') = 'array'
      then group_value->'options' else '[]'::jsonb end
  ) option_value
  where pp.deleted_at is null
    and pp.is_published is true
),
required_products as (
  select license_id, product_id from published_parents
  union
  select license_id, product_id from recipe_dependencies where product_id is not null
  union
  select license_id, product_id from modifier_dependencies where product_id is not null
)
insert into public.pos_sync_events (
  license_id, entity_type, entity_id, operation, server_version, metadata
)
select b.license_id, 'product_batch', b.id, 'update', b.server_version,
  jsonb_build_object(
    'source', 'ecom_catalog_bootstrap_consistency_repair',
    'reason', 'missing_or_stale_incremental_event',
    'product_id', b.product_id
  )
from required_products required
join public.pos_product_batches b
  on b.license_id = required.license_id
 and b.product_id = required.product_id
where b.deleted_at is null
  and not exists (
    select 1 from public.pos_sync_events e
    where e.license_id = b.license_id
      and e.entity_type = 'product_batch'
      and e.entity_id = b.id
      and e.server_version >= b.server_version
  );

do $$
declare
  v_row record;
  v_group jsonb;
  v_option jsonb;
  v_groups jsonb;
  v_options jsonb;
  v_configuration jsonb;
  v_evaluation jsonb;
  v_selection_type text;
  v_required boolean;
  v_min_select integer;
  v_max_select integer;
  v_tracks_inventory boolean;
  v_ingredient_id text;
  v_ingredient_quantity numeric;
  v_ingredient_unit text;
  v_option_available boolean;
  v_result jsonb;
  v_group_options jsonb;
begin
  for v_row in
    select pp.*, p.recipe, p.modifiers, p.server_version
    from public.ecommerce_published_products pp
    join public.pos_products p
      on p.license_id = pp.license_id
     and p.id = pp.local_product_ref
    where pp.deleted_at is null
      and pp.is_published is true
      and pp.has_recipe is true
      and pp.has_variants is false
      and jsonb_typeof(p.modifiers) = 'array'
      and jsonb_array_length(p.modifiers) > 0
  loop
    v_groups := '[]'::jsonb;
    v_evaluation := private.ecommerce_recipe_capacity(
      v_row.license_id,
      v_row.recipe,
      current_date
    );

    for v_group in
      select value || jsonb_build_object('__ordinality', ordinality)
      from jsonb_array_elements(v_row.modifiers) with ordinality
      order by ordinality
    loop
      v_group_options := case when jsonb_typeof(v_group->'options') = 'array'
        then v_group->'options' else '[]'::jsonb end;
      v_selection_type := case
        when lower(coalesce(v_group->>'selectionType', '')) = 'multiple'
          or coalesce(nullif(v_group->>'multiple', '')::boolean, false)
          then 'multiple'
        else 'single'
      end;
      v_required := coalesce(nullif(v_group->>'required', '')::boolean, false);
      v_min_select := coalesce(
        nullif(v_group->>'minSelect', '')::integer,
        case when v_required then 1 else 0 end
      );
      v_max_select := coalesce(
        nullif(v_group->>'maxSelect', '')::integer,
        case
          when v_selection_type = 'multiple'
            then greatest(jsonb_array_length(v_group_options), 1)
          else 1
        end
      );
      v_options := '[]'::jsonb;

      for v_option in
        select value || jsonb_build_object('__ordinality', ordinality)
        from jsonb_array_elements(v_group_options) with ordinality
        order by ordinality
      loop
        v_tracks_inventory := coalesce(
          nullif(v_option->>'tracksInventory', '')::boolean,
          false
        );
        v_ingredient_id := nullif(btrim(coalesce(
          v_option->>'ingredientId',
          v_option->>'ingredient_id',
          v_option->>'sourceIngredientId'
        )), '');
        v_ingredient_quantity := nullif(coalesce(
          v_option->>'ingredientQuantity',
          v_option->>'ingredient_quantity'
        ), '')::numeric;
        v_ingredient_unit := nullif(btrim(coalesce(
          v_option->>'ingredientUnit',
          v_option->>'ingredient_unit'
        )), '');

        if v_tracks_inventory
           and v_ingredient_id is not null
           and v_ingredient_quantity is not null
           and v_ingredient_quantity > 0 then
          v_option_available := coalesce(
            private.ecommerce_recipe_capacity(
              v_row.license_id,
              jsonb_build_array(jsonb_build_object(
                'ingredientId', v_ingredient_id,
                'quantity', v_ingredient_quantity,
                'unit', v_ingredient_unit
              )),
              current_date
            )->>'status' in ('in_stock', 'not_tracked'),
            false
          );
        else
          v_option_available := true;
        end if;

        v_options := v_options || jsonb_build_array(jsonb_build_object(
          'sourceOptionRef', coalesce(
            nullif(btrim(v_option->>'id'), ''),
            nullif(btrim(v_option->>'name'), '')
          ),
          'publicName', coalesce(nullif(btrim(v_option->>'name'), ''), 'Opción'),
          'priceDelta', greatest(coalesce(nullif(v_option->>'price', '')::numeric, 0), 0),
          'sourceIngredientId', case when v_tracks_inventory then v_ingredient_id else null end,
          'ingredientQuantity', case when v_tracks_inventory then v_ingredient_quantity else null end,
          'ingredientUnit', case when v_tracks_inventory then v_ingredient_unit else null end,
          'tracksInventory', v_tracks_inventory,
          'manualAvailable', true,
          'sourceAvailable', v_option_available,
          'displayOrder', greatest((v_option->>'__ordinality')::integer - 1, 0),
          'metadata', '{}'::jsonb
        ));
      end loop;

      v_groups := v_groups || jsonb_build_array(jsonb_build_object(
        'sourceGroupRef', coalesce(
          nullif(btrim(v_group->>'id'), ''),
          nullif(btrim(v_group->>'name'), '')
        ),
        'publicName', coalesce(nullif(btrim(v_group->>'name'), ''), 'Opciones'),
        'selectionType', v_selection_type,
        'required', v_required,
        'minSelect', greatest(v_min_select, 0),
        'maxSelect', greatest(v_max_select, 1),
        'displayOrder', greatest((v_group->>'__ordinality')::integer - 1, 0),
        'options', v_options,
        'metadata', jsonb_strip_nulls(jsonb_build_object(
          'emptyLabel', nullif(btrim(v_group->>'emptyLabel'), '')
        ))
      ));
    end loop;

    v_configuration := jsonb_build_object(
      'type', 'configurable',
      'version', greatest(coalesce(v_row.configuration_version, 1), 1),
      'hasRecipe', true,
      'variants', '[]'::jsonb,
      'optionGroups', v_groups,
      'availabilitySource', 'recipe',
      'availabilityReasonCode', nullif(v_evaluation->>'reasonCode', ''),
      'limitingSource', jsonb_build_object(
        'productId', nullif(v_evaluation->>'limitingIngredientId', ''),
        'name', nullif(v_evaluation->>'limitingIngredientName', '')
      )
    );

    v_result := private.ecommerce_apply_product_configuration_checked(
      v_row.license_id,
      v_row.id,
      v_configuration,
      'version:' || v_row.server_version::text,
      false
    );
  end loop;
end;
$$;

update public.ecommerce_published_products pp
set updated_at = pp.updated_at
where pp.deleted_at is null
  and pp.is_published is true
  and pp.has_recipe is true
  and pp.availability_source = 'recipe';
;
