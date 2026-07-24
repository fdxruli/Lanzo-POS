create or replace function private.ecommerce_published_product_sync_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.sync_config := private.ecommerce_normalize_sync_config(
    new.sync_config,
    case when tg_op = 'UPDATE' then old.sync_config else null end
  );

  if tg_op = 'INSERT' then
    new.manual_available := coalesce(new.is_available, new.manual_available, true);
    new.source_available := coalesce(new.source_available, true);
  elsif new.manual_available is not distinct from old.manual_available
        and new.source_available is not distinct from old.source_available
        and new.requires_configuration is not distinct from old.requires_configuration
        and new.is_available is distinct from old.is_available then
    new.manual_available := coalesce(new.is_available, old.manual_available, true);
  end if;

  new.manual_available := coalesce(new.manual_available, true);
  new.source_available := coalesce(new.source_available, true);
  new.requires_configuration := coalesce(new.requires_configuration, false);

  if new.source_state = 'not_tracked' then
    new.track_stock := false;
    new.stock_mode := 'hidden';
    new.stock_snapshot := null;
  end if;

  if tg_op = 'UPDATE' and new.source_state in ('unverified', 'source_missing') then
    new.public_name := old.public_name;
    new.public_description := old.public_description;
    new.category_name := old.category_name;
    new.price := old.price;
    new.image_url := old.image_url;
    new.stock_snapshot := old.stock_snapshot;
    new.stock_updated_at := old.stock_updated_at;
  end if;

  if tg_op = 'UPDATE' and new.source_state = 'unverified' then
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
  elsif tg_op = 'UPDATE' and new.source_state = 'source_missing' then
    new.source_state := 'unverified';
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
    new.last_synced_at := old.last_synced_at;
  end if;

  new.is_available := new.manual_available
    and new.source_available
    and not new.requires_configuration;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$function$;

comment on function private.ecommerce_published_product_sync_guard() is
  'Maintains independent manual, source and requires_configuration dimensions. Effective availability is manual AND source AND NOT requires_configuration.';

create or replace function private.ecommerce_configuration_error_from_message(
  p_message text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ecommerce_admin_error(
    case
      when p_message like 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED%' then 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED'
      when p_message like 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE%' then 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'
      when p_message like 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND%' then 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND'
      when p_message like 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND%' then 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND'
      when p_message like 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID%' then 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED%' then 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID%' then 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID'
      when p_message like 'ECOMMERCE_PRODUCT_NOT_FOUND%' then 'ECOMMERCE_PRODUCT_NOT_FOUND'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_STALE%' then 'ECOMMERCE_CATALOG_SOURCE_STALE'
      when p_message like 'ECOMMERCE_CATALOG_REVISION_CHANGED%' then 'ECOMMERCE_CATALOG_REVISION_CHANGED'
      when p_message like 'ECOMMERCE_CONFIGURATION_INVALID%' then 'ECOMMERCE_CONFIGURATION_INVALID'
      else 'ECOMMERCE_CONFIGURATION_SYNC_FAILED'
    end,
    case
      when p_message like 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED%' then 'La configuracion supera el limite de opciones permitido.'
      when p_message like 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE%' then 'La configuracion contiene una referencia que no pertenece a esta licencia.'
      when p_message like 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND%' then 'Una variante ya no existe en el catalogo autorizado.'
      when p_message like 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND%' then 'Un ingrediente de una opcion ya no existe en el catalogo autorizado.'
      when p_message like 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID%' then 'Los limites de seleccion del grupo no son validos.'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED%' then 'Cada variante debe indicar su combinacion de atributos.'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID%' then 'Una variante contiene un atributo invalido.'
      when p_message like 'ECOMMERCE_PRODUCT_NOT_FOUND%' then 'El producto publicado no existe.'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_STALE%' then 'Un dispositivo tiene una version anterior del producto.'
      when p_message like 'ECOMMERCE_CATALOG_REVISION_CHANGED%' then 'El catalogo cambio durante la sincronizacion.'
      when p_message like 'ECOMMERCE_CONFIGURATION_INVALID%' then 'La configuracion contiene referencias o valores invalidos.'
      else 'No se pudo sincronizar la configuracion del producto.'
    end
  );
$function$;

create or replace function private.ecommerce_apply_product_configuration(
  p_license_id uuid,
  p_published_product_id uuid,
  p_configuration jsonb,
  p_source_revision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_type text;
  v_version integer;
  v_variants jsonb;
  v_groups jsonb;
  v_variant jsonb;
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_variant_refs text[] := '{}'::text[];
  v_group_refs text[] := '{}'::text[];
  v_option_refs text[];
  v_variant_ref text;
  v_group_ref text;
  v_option_ref text;
  v_source_product_id text;
  v_option_values jsonb;
  v_required boolean;
  v_min integer;
  v_max integer;
  v_selection_type text;
  v_total_options integer := 0;
  v_has_recipe boolean;
  v_has_variants boolean;
  v_has_groups boolean;
  v_requires_configuration boolean;
  v_availability_source text;
  v_reason text;
  v_limiting jsonb;
  v_tracks_inventory boolean;
  v_metadata jsonb;
begin
  if p_license_id is null
     or p_published_product_id is null
     or p_configuration is null
     or jsonb_typeof(p_configuration) <> 'object'
     or pg_column_size(p_configuration) > 524288
     or private.ecommerce_jsonb_depth(p_configuration) > 6 then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
  end if;

  if (p_configuration - array[
    'type','version','hasRecipe','variants','optionGroups',
    'availabilitySource','availabilityReasonCode','limitingSource'
  ]) <> '{}'::jsonb then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
  end if;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null
  for update;
  if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  v_type := coalesce(nullif(p_configuration->>'type',''), 'simple');
  v_version := coalesce(nullif(p_configuration->>'version','')::integer, 1);
  v_variants := coalesce(p_configuration->'variants', '[]'::jsonb);
  v_groups := coalesce(p_configuration->'optionGroups', '[]'::jsonb);
  v_has_recipe := coalesce((p_configuration->>'hasRecipe')::boolean, false);
  v_has_variants := jsonb_typeof(v_variants) = 'array' and jsonb_array_length(v_variants) > 0;
  v_has_groups := jsonb_typeof(v_groups) = 'array' and jsonb_array_length(v_groups) > 0;

  if v_type not in ('simple','recipe','variant_parent','configurable')
     or v_version < 1 or v_version > 100
     or jsonb_typeof(v_variants) <> 'array'
     or jsonb_typeof(v_groups) <> 'array'
     or jsonb_array_length(v_variants) > 100
     or jsonb_array_length(v_groups) > 20 then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(g->'options','[]'::jsonb))),0)::integer
  into v_total_options
  from jsonb_array_elements(v_groups) g;
  if v_total_options > 100 then
    raise exception 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED';
  end if;

  v_limiting := coalesce(p_configuration->'limitingSource','{}'::jsonb);
  if jsonb_typeof(v_limiting) <> 'object'
     or (v_limiting - array['productId','name']) <> '{}'::jsonb then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
  end if;

  v_requires_configuration := v_has_variants;
  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    if jsonb_typeof(v_group) <> 'object'
       or (v_group - array[
         'sourceGroupRef','publicName','selectionType','required','minSelect',
         'maxSelect','displayOrder','options','metadata'
       ]) <> '{}'::jsonb
       or jsonb_typeof(coalesce(v_group->'options','[]'::jsonb)) <> 'array' then
      raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
    end if;
    v_required := coalesce((v_group->>'required')::boolean, false);
    v_min := coalesce(nullif(v_group->>'minSelect','')::integer, case when v_required then 1 else 0 end);
    if v_required or v_min > 0 then v_requires_configuration := true; end if;
  end loop;

  v_availability_source := coalesce(
    nullif(p_configuration->>'availabilitySource',''),
    case
      when v_has_variants then 'variant_aggregate'
      when v_has_recipe then 'recipe'
      else 'direct'
    end
  );
  if v_availability_source not in (
    'direct','recipe','variant_aggregate','not_tracked','manual','unverified'
  ) then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
  end if;
  v_reason := nullif(btrim(p_configuration->>'availabilityReasonCode'),'');

  for v_variant in select value from jsonb_array_elements(v_variants)
  loop
    if jsonb_typeof(v_variant) <> 'object'
       or (v_variant - array[
         'sourceVariantRef','sourceProductId','localProductRef','sku','publicName',
         'optionValues','priceMode','priceValue','imageUrl','imageRef','trackStock',
         'stockMode','stockSnapshot','sourceAvailable','manualAvailable','displayOrder',
         'sourceRevision','metadata'
       ]) <> '{}'::jsonb then
      raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
    end if;

    v_variant_ref := nullif(btrim(v_variant->>'sourceVariantRef'),'');
    v_source_product_id := nullif(btrim(v_variant->>'sourceProductId'),'');
    v_option_values := coalesce(v_variant->'optionValues','{}'::jsonb);
    v_metadata := coalesce(v_variant->'metadata','{}'::jsonb);

    if v_variant_ref is null
       or (v_source_product_id is null and nullif(btrim(v_variant->>'localProductRef'),'') is null)
       or jsonb_typeof(v_metadata) <> 'object' then
      raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
    end if;
    if jsonb_typeof(v_option_values) <> 'object' or v_option_values = '{}'::jsonb then
      raise exception 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED';
    end if;
    if exists (
      select 1 from jsonb_each_text(v_option_values)
      where length(key) > 50 or length(value) > 50 or btrim(key) = '' or btrim(value) = ''
    ) then
      raise exception 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID';
    end if;
    if coalesce(nullif(v_variant->>'priceMode',''),'base') not in ('base','delta','absolute')
       or coalesce(nullif(v_variant->>'priceValue','')::numeric,0) < 0
       or coalesce(nullif(v_variant->>'stockMode',''),'hidden') not in ('hidden','status','exact')
       or nullif(v_variant->>'stockSnapshot','')::numeric < 0 then
      raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
    end if;

    insert into public.ecommerce_published_product_variants as current_variant(
      published_product_id, portal_id, license_id, source_variant_ref,
      source_product_id, local_product_ref, sku, public_name, option_values,
      price_mode, price_value, image_url, image_ref, track_stock, stock_mode,
      stock_snapshot, source_available, manual_available, display_order,
      source_revision, metadata, deleted_at
    ) values (
      v_product.id, v_product.portal_id, v_product.license_id, v_variant_ref,
      v_source_product_id, nullif(btrim(v_variant->>'localProductRef'),''),
      upper(nullif(btrim(v_variant->>'sku'),'')),
      nullif(btrim(v_variant->>'publicName'),''), v_option_values,
      coalesce(nullif(v_variant->>'priceMode',''),'base'),
      coalesce(nullif(v_variant->>'priceValue','')::numeric,0),
      nullif(btrim(v_variant->>'imageUrl'),''),
      nullif(btrim(v_variant->>'imageRef'),''),
      coalesce((v_variant->>'trackStock')::boolean,true),
      coalesce(nullif(v_variant->>'stockMode',''),'hidden'),
      nullif(v_variant->>'stockSnapshot','')::numeric,
      coalesce((v_variant->>'sourceAvailable')::boolean,true),
      coalesce((v_variant->>'manualAvailable')::boolean,true),
      greatest(coalesce(nullif(v_variant->>'displayOrder','')::integer,0),0),
      nullif(btrim(v_variant->>'sourceRevision'),''),
      v_metadata, null
    )
    on conflict (published_product_id, source_variant_ref) where deleted_at is null
    do update set
      source_product_id = excluded.source_product_id,
      local_product_ref = excluded.local_product_ref,
      sku = excluded.sku,
      public_name = excluded.public_name,
      option_values = excluded.option_values,
      price_mode = excluded.price_mode,
      price_value = excluded.price_value,
      image_url = excluded.image_url,
      image_ref = excluded.image_ref,
      track_stock = excluded.track_stock,
      stock_mode = excluded.stock_mode,
      stock_snapshot = excluded.stock_snapshot,
      source_available = excluded.source_available,
      manual_available = excluded.manual_available,
      display_order = excluded.display_order,
      source_revision = excluded.source_revision,
      metadata = excluded.metadata,
      deleted_at = null
    where (
      current_variant.source_product_id,
      current_variant.local_product_ref,
      current_variant.sku,
      current_variant.public_name,
      current_variant.option_values,
      current_variant.price_mode,
      current_variant.price_value,
      current_variant.image_url,
      current_variant.image_ref,
      current_variant.track_stock,
      current_variant.stock_mode,
      current_variant.stock_snapshot,
      current_variant.source_available,
      current_variant.manual_available,
      current_variant.display_order,
      current_variant.source_revision,
      current_variant.metadata,
      current_variant.deleted_at
    ) is distinct from (
      excluded.source_product_id,
      excluded.local_product_ref,
      excluded.sku,
      excluded.public_name,
      excluded.option_values,
      excluded.price_mode,
      excluded.price_value,
      excluded.image_url,
      excluded.image_ref,
      excluded.track_stock,
      excluded.stock_mode,
      excluded.stock_snapshot,
      excluded.source_available,
      excluded.manual_available,
      excluded.display_order,
      excluded.source_revision,
      excluded.metadata,
      null::timestamptz
    );
    v_variant_refs := array_append(v_variant_refs, v_variant_ref);
  end loop;

  update public.ecommerce_published_product_variants
  set deleted_at = now(), is_available = false
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_variant_ref = any(v_variant_refs));

  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    v_group_ref := nullif(btrim(v_group->>'sourceGroupRef'),'');
    v_selection_type := coalesce(nullif(v_group->>'selectionType',''),'single');
    v_required := coalesce((v_group->>'required')::boolean,false);
    v_min := coalesce(nullif(v_group->>'minSelect','')::integer,case when v_required then 1 else 0 end);
    v_max := coalesce(nullif(v_group->>'maxSelect','')::integer,case when v_selection_type='single' then 1 else greatest(v_min,1) end);
    v_metadata := coalesce(v_group->'metadata','{}'::jsonb);

    if v_group_ref is null
       or nullif(btrim(v_group->>'publicName'),'') is null
       or jsonb_typeof(v_metadata) <> 'object'
       or v_selection_type not in ('single','multiple')
       or v_min < 0 or v_max < v_min
       or (v_selection_type='single' and v_max > 1)
       or (v_required and v_min < 1) then
      raise exception 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID';
    end if;

    v_group_id := null;
    insert into public.ecommerce_published_option_groups as current_group(
      published_product_id, portal_id, license_id, source_group_ref,
      public_name, selection_type, required, min_select, max_select,
      display_order, metadata, deleted_at
    ) values (
      v_product.id, v_product.portal_id, v_product.license_id, v_group_ref,
      btrim(v_group->>'publicName'), v_selection_type, v_required, v_min, v_max,
      greatest(coalesce(nullif(v_group->>'displayOrder','')::integer,0),0),
      v_metadata, null
    )
    on conflict (published_product_id, source_group_ref) where deleted_at is null
    do update set
      public_name = excluded.public_name,
      selection_type = excluded.selection_type,
      required = excluded.required,
      min_select = excluded.min_select,
      max_select = excluded.max_select,
      display_order = excluded.display_order,
      metadata = excluded.metadata,
      deleted_at = null
    where (
      current_group.public_name,
      current_group.selection_type,
      current_group.required,
      current_group.min_select,
      current_group.max_select,
      current_group.display_order,
      current_group.metadata,
      current_group.deleted_at
    ) is distinct from (
      excluded.public_name,
      excluded.selection_type,
      excluded.required,
      excluded.min_select,
      excluded.max_select,
      excluded.display_order,
      excluded.metadata,
      null::timestamptz
    )
    returning id into v_group_id;

    if v_group_id is null then
      select g.id into v_group_id
      from public.ecommerce_published_option_groups g
      where g.published_product_id = v_product.id
        and g.source_group_ref = v_group_ref
        and g.deleted_at is null;
    end if;

    v_group_refs := array_append(v_group_refs, v_group_ref);
    v_option_refs := '{}'::text[];

    for v_option in select value from jsonb_array_elements(coalesce(v_group->'options','[]'::jsonb))
    loop
      if jsonb_typeof(v_option) <> 'object'
         or (v_option - array[
           'sourceOptionRef','publicName','priceDelta','sourceIngredientId',
           'ingredientQuantity','ingredientUnit','tracksInventory','manualAvailable',
           'sourceAvailable','displayOrder','metadata'
         ]) <> '{}'::jsonb then
        raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
      end if;

      v_option_ref := nullif(btrim(v_option->>'sourceOptionRef'),'');
      v_tracks_inventory := coalesce((v_option->>'tracksInventory')::boolean,false);
      v_metadata := coalesce(v_option->'metadata','{}'::jsonb);
      if v_option_ref is null
         or nullif(btrim(v_option->>'publicName'),'') is null
         or jsonb_typeof(v_metadata) <> 'object'
         or coalesce(nullif(v_option->>'priceDelta','')::numeric,0) < 0 then
        raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
      end if;
      if v_tracks_inventory and (
        nullif(btrim(v_option->>'sourceIngredientId'),'') is null
        or nullif(v_option->>'ingredientQuantity','')::numeric is null
        or nullif(v_option->>'ingredientQuantity','')::numeric <= 0
        or private.ecommerce_normalize_inventory_unit(v_option->>'ingredientUnit') is null
      ) then
        raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
      end if;

      insert into public.ecommerce_published_options as current_option(
        group_id, published_product_id, portal_id, license_id, source_option_ref,
        public_name, price_delta, source_ingredient_id, ingredient_quantity,
        ingredient_unit, tracks_inventory, manual_available, source_available,
        display_order, metadata, deleted_at
      ) values (
        v_group_id, v_product.id, v_product.portal_id, v_product.license_id, v_option_ref,
        btrim(v_option->>'publicName'),
        coalesce(nullif(v_option->>'priceDelta','')::numeric,0),
        case when v_tracks_inventory then nullif(btrim(v_option->>'sourceIngredientId'),'') else null end,
        case when v_tracks_inventory then nullif(v_option->>'ingredientQuantity','')::numeric else null end,
        case when v_tracks_inventory then private.ecommerce_normalize_inventory_unit(v_option->>'ingredientUnit') else null end,
        v_tracks_inventory,
        coalesce((v_option->>'manualAvailable')::boolean,true),
        coalesce((v_option->>'sourceAvailable')::boolean,true),
        greatest(coalesce(nullif(v_option->>'displayOrder','')::integer,0),0),
        v_metadata, null
      )
      on conflict (group_id, source_option_ref) where deleted_at is null
      do update set
        public_name = excluded.public_name,
        price_delta = excluded.price_delta,
        source_ingredient_id = excluded.source_ingredient_id,
        ingredient_quantity = excluded.ingredient_quantity,
        ingredient_unit = excluded.ingredient_unit,
        tracks_inventory = excluded.tracks_inventory,
        manual_available = excluded.manual_available,
        source_available = excluded.source_available,
        display_order = excluded.display_order,
        metadata = excluded.metadata,
        deleted_at = null
      where (
        current_option.public_name,
        current_option.price_delta,
        current_option.source_ingredient_id,
        current_option.ingredient_quantity,
        current_option.ingredient_unit,
        current_option.tracks_inventory,
        current_option.manual_available,
        current_option.source_available,
        current_option.display_order,
        current_option.metadata,
        current_option.deleted_at
      ) is distinct from (
        excluded.public_name,
        excluded.price_delta,
        excluded.source_ingredient_id,
        excluded.ingredient_quantity,
        excluded.ingredient_unit,
        excluded.tracks_inventory,
        excluded.manual_available,
        excluded.source_available,
        excluded.display_order,
        excluded.metadata,
        null::timestamptz
      );
      v_option_refs := array_append(v_option_refs, v_option_ref);
    end loop;

    update public.ecommerce_published_options
    set deleted_at = now(), is_available = false
    where group_id = v_group_id
      and deleted_at is null
      and not (source_option_ref = any(v_option_refs));
  end loop;

  update public.ecommerce_published_options o
  set deleted_at = now(), is_available = false
  where o.published_product_id = v_product.id
    and o.deleted_at is null
    and exists (
      select 1
      from public.ecommerce_published_option_groups g
      where g.id = o.group_id
        and g.deleted_at is null
        and not (g.source_group_ref = any(v_group_refs))
    );

  update public.ecommerce_published_option_groups
  set deleted_at = now()
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_group_ref = any(v_group_refs));

  update public.ecommerce_published_products p
  set configuration_type = v_type,
      configuration_version = v_version,
      has_recipe = v_has_recipe,
      has_variants = v_has_variants,
      has_option_groups = v_has_groups,
      requires_configuration = v_requires_configuration,
      availability_source = v_availability_source,
      availability_reason_code = case
        when v_requires_configuration then 'CONFIGURATION_REQUIRED'
        else v_reason
      end,
      limiting_source_product_id = nullif(btrim(v_limiting->>'productId'),''),
      limiting_source_name = nullif(btrim(v_limiting->>'name'),''),
      source_revision = coalesce(nullif(btrim(p_source_revision),''),p.source_revision)
  where p.id = v_product.id
    and (
      p.configuration_type,
      p.configuration_version,
      p.has_recipe,
      p.has_variants,
      p.has_option_groups,
      p.requires_configuration,
      p.availability_source,
      p.availability_reason_code,
      p.limiting_source_product_id,
      p.limiting_source_name,
      p.source_revision
    ) is distinct from (
      v_type,
      v_version,
      v_has_recipe,
      v_has_variants,
      v_has_groups,
      v_requires_configuration,
      v_availability_source,
      case when v_requires_configuration then 'CONFIGURATION_REQUIRED' else v_reason end,
      nullif(btrim(v_limiting->>'productId'),''),
      nullif(btrim(v_limiting->>'name'),''),
      coalesce(nullif(btrim(p_source_revision),''),p.source_revision)
    );

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null;

  return jsonb_build_object(
    'success', true,
    'product', private.ecommerce_admin_product_jsonb(v_product),
    'configuration', jsonb_build_object(
      'type', v_product.configuration_type,
      'version', v_product.configuration_version,
      'hasRecipe', v_product.has_recipe,
      'hasVariants', v_product.has_variants,
      'hasOptionGroups', v_product.has_option_groups,
      'requiresConfiguration', v_product.requires_configuration
    )
  );
exception
  when check_violation or foreign_key_violation or unique_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'ECOMMERCE_CONFIGURATION_INVALID';
end;
$function$;

revoke all on function private.ecommerce_configuration_error_from_message(text) from public, anon, authenticated;
revoke all on function private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function private.ecommerce_configuration_error_from_message(text) to service_role;
grant execute on function private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text) to service_role;

create or replace function public.ecommerce_admin_sync_product_configuration(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_published_product_id uuid,
  p_configuration jsonb,
  p_source_revision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_result jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_sync_product_configuration'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_result := private.ecommerce_apply_product_configuration(
    (v_auth->>'license_id')::uuid,
    p_published_product_id,
    p_configuration,
    p_source_revision
  );
  return v_result;
exception
  when others then
    return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

create or replace function public.ecommerce_admin_upsert_published_product_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_base_payload jsonb;
  v_base_result jsonb;
  v_configuration_result jsonb;
  v_product_id uuid;
  v_license_id uuid;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'configuration') <> 'object'
     or (p_payload ? 'configurationSourceRevision'
         and jsonb_typeof(p_payload->'configurationSourceRevision') not in ('string','null')) then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_INVALID',
      'La configuracion del producto no es valida.'
    );
  end if;

  v_base_payload := p_payload - array['configuration','configurationSourceRevision'];
  v_base_result := public.ecommerce_admin_upsert_published_product(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_base_payload
  );
  if coalesce((v_base_result->>'success')::boolean,false) is false then return v_base_result; end if;

  v_product_id := nullif(v_base_result#>>'{product,id}','')::uuid;
  select p.license_id into v_license_id
  from public.ecommerce_published_products p
  where p.id = v_product_id and p.deleted_at is null;
  if v_license_id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  v_configuration_result := private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    p_payload->'configuration',
    p_payload->>'configurationSourceRevision'
  );

  return v_base_result
    || jsonb_build_object(
      'product', v_configuration_result->'product',
      'configuration', v_configuration_result->'configuration'
    );
exception
  when others then
    return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

create or replace function public.ecommerce_admin_sync_published_catalog_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_projections jsonb,
  p_idempotency_key text,
  p_expected_catalog_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_legacy_projections jsonb;
  v_full_hash text;
  v_internal_key text;
  v_result jsonb;
  v_result_item jsonb;
  v_projection jsonb;
  v_product public.ecommerce_published_products%rowtype;
  v_configuration_result jsonb;
  v_configuration_count integer := 0;
  v_catalog_revision bigint;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections) < 1
     or jsonb_array_length(p_projections) > 200
     or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null
     or length(p_idempotency_key) > 240 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_projections) item
    where jsonb_typeof(item) <> 'object'
       or not (item ?& array[
         'publishedProductId','localProductRef','sourceRevision','sourceState',
         'sourceAvailable','stockSnapshot','fields','configuration',
         'configurationSourceRevision'
       ])
       or (item - array[
         'publishedProductId','localProductRef','sourceRevision','sourceState',
         'sourceAvailable','stockSnapshot','fields','configuration',
         'configurationSourceRevision'
       ]) <> '{}'::jsonb
       or jsonb_typeof(item->'configuration') not in ('object','null')
       or jsonb_typeof(item->'configurationSourceRevision') not in ('string','null')
  ) then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD',
      'La proyeccion contiene campos no permitidos.'
    );
  end if;

  select jsonb_agg(value - array['configuration','configurationSourceRevision'] order by ordinality)
  into v_legacy_projections
  from jsonb_array_elements(p_projections) with ordinality;

  v_full_hash := encode(extensions.digest(p_projections::text,'sha256'),'hex');
  v_internal_key := left(p_idempotency_key, 170) || ':cfg:' || left(v_full_hash, 48);

  v_result := public.ecommerce_admin_sync_published_catalog(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_legacy_projections,
    v_internal_key,
    p_expected_catalog_revision
  );
  if coalesce((v_result->>'success')::boolean,false) is false then return v_result; end if;

  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'results','[]'::jsonb))
  loop
    if not (
      v_result_item->>'status' in ('updated','idempotent')
      or (v_result_item->>'status' = 'review' and not (v_result_item ? 'code'))
    ) then
      continue;
    end if;

    select value into v_projection
    from jsonb_array_elements(p_projections)
    where value->>'publishedProductId' = v_result_item->>'publishedProductId'
    limit 1;
    if jsonb_typeof(v_projection->'configuration') <> 'object' then continue; end if;

    select p.* into v_product
    from public.ecommerce_published_products p
    where p.id::text = v_result_item->>'publishedProductId'
      and p.deleted_at is null
    for update;
    if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

    v_configuration_result := private.ecommerce_apply_product_configuration(
      v_product.license_id,
      v_product.id,
      v_projection->'configuration',
      v_projection->>'configurationSourceRevision'
    );
    if coalesce((v_configuration_result->>'success')::boolean,false) is false then
      raise exception 'ECOMMERCE_CONFIGURATION_SYNC_FAILED';
    end if;
    v_configuration_count := v_configuration_count + 1;
  end loop;

  select p.catalog_revision into v_catalog_revision
  from public.ecommerce_portals p
  join public.ecommerce_published_products pp on pp.portal_id = p.id
  where pp.id::text = p_projections->0->>'publishedProductId'
  limit 1;

  return v_result || jsonb_build_object(
    'configurationUpdatedCount', v_configuration_count,
    'catalogRevision', coalesce(v_catalog_revision,(v_result->>'catalogRevision')::bigint)
  );
exception
  when others then
    return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

revoke all on function public.ecommerce_admin_sync_product_configuration(text,text,text,text,uuid,jsonb,text) from public;
revoke all on function public.ecommerce_admin_upsert_published_product_v2(text,text,text,text,jsonb) from public;
revoke all on function public.ecommerce_admin_sync_published_catalog_v2(text,text,text,text,jsonb,text,bigint) from public;
grant execute on function public.ecommerce_admin_sync_product_configuration(text,text,text,text,uuid,jsonb,text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_upsert_published_product_v2(text,text,text,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_sync_published_catalog_v2(text,text,text,text,jsonb,text,bigint) to anon, authenticated, service_role;

comment on function private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text) is
  'Canonical normalized configuration writer reused by direct, manual publication and cloud catalog wrappers. It never changes source_available solely because selection is required.';
comment on function public.ecommerce_admin_upsert_published_product_v2(text,text,text,text,jsonb) is
  'Atomic manual published-product upsert plus normalized configuration sync.';
comment on function public.ecommerce_admin_sync_published_catalog_v2(text,text,text,text,jsonb,text,bigint) is
  'Atomic PRO catalog sync plus normalized configuration sync using the canonical private writer.';;
