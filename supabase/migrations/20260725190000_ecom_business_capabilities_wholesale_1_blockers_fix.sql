-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1
-- Compensating migration: capability isolation, idempotent wholesale snapshots,
-- final v3 catalog revisions, authoritative variant-aware pricing, and grants.

create or replace function private.ecommerce_apply_wholesale_tiers(
  p_product_id uuid,
  p_enabled boolean,
  p_tiers jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_tier jsonb;
  v_refs text[] := '{}'::text[];
  v_quantities integer[] := '{}'::integer[];
  v_ref text;
  v_min integer;
  v_price numeric;
  v_cost numeric := 0;
  v_row_id uuid;
  v_changed boolean := false;
  v_effective_enabled boolean := false;
  v_count integer;
begin
  select * into v_product
  from public.ecommerce_published_products
  where id = p_product_id and deleted_at is null
  for update;
  if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_tiers, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_tiers, '[]'::jsonb)) > 50 then
    raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
  end if;

  v_effective_enabled := coalesce(p_enabled, false)
    and private.ecommerce_business_supports_capability(
      v_product.license_id, 'wholesale_pricing'
    );

  -- Disabled or unsupported wholesale is warning-only at the product-policy
  -- layer. Do not materialize payload tiers as already-deleted rows.
  if not v_effective_enabled then
    update public.ecommerce_published_wholesale_tiers
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
    get diagnostics v_count = row_count;
    v_changed := v_count > 0;

    update public.ecommerce_published_products
    set wholesale_enabled = false,
        wholesale_revision = wholesale_revision + 1
    where id = v_product.id and wholesale_enabled is distinct from false;
    get diagnostics v_count = row_count;
    return jsonb_build_object(
      'success', true,
      'changed', v_changed or v_count > 0,
      'warningCode', case when p_enabled then 'WHOLESALE_NOT_SUPPORTED' end
    );
  end if;

  select coalesce(p.cost, 0) into v_cost
  from public.pos_products p
  where p.license_id = v_product.license_id
    and p.id = v_product.local_product_ref
    and p.deleted_at is null;

  for v_tier in select value
    from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb))
  loop
    if jsonb_typeof(v_tier) <> 'object'
       or not (v_tier ?& array['minQuantity','unitPrice'])
       or (v_tier - array[
         'sourceTierRef','minQuantity','unitPrice','displayOrder',
         'sourceAvailable','warningCode'
       ]) <> '{}'::jsonb then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end if;
    begin
      v_min := (v_tier->>'minQuantity')::integer;
      v_ref := coalesce(
        nullif(btrim(v_tier->>'sourceTierRef'), ''),
        'min:' || v_min::text
      );
      v_price := round((v_tier->>'unitPrice')::numeric, 2);
    exception when others then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end;
    if length(v_ref) > 160 or v_min < 1 or v_min > 1000000
       or v_price < 0 or v_min = any(v_quantities) or v_ref = any(v_refs) then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end if;
    v_refs := array_append(v_refs, v_ref);
    v_quantities := array_append(v_quantities, v_min);

    -- The locked parent serializes writers. Reuse active or soft-deleted
    -- logical identities instead of growing tombstone chains.
    select id into v_row_id
    from public.ecommerce_published_wholesale_tiers
    where published_product_id = v_product.id
      and (source_tier_ref = v_ref or min_quantity = v_min)
    order by (deleted_at is null) desc, created_at, id
    limit 1
    for update;

    if v_row_id is null then
      insert into public.ecommerce_published_wholesale_tiers (
        published_product_id, portal_id, license_id, source_tier_ref,
        min_quantity, unit_price, display_order, source_available,
        is_available, metadata
      ) values (
        v_product.id, v_product.portal_id, v_product.license_id, v_ref,
        v_min, v_price, coalesce((v_tier->>'displayOrder')::integer, 0),
        coalesce((v_tier->>'sourceAvailable')::boolean, true)
          and not (v_cost > 0 and v_price < v_cost),
        not (v_cost > 0 and v_price < v_cost),
        jsonb_strip_nulls(jsonb_build_object(
          'warningCode', case when v_cost > 0 and v_price < v_cost
            then 'WHOLESALE_TIER_BELOW_COST' end
        ))
      ) returning id into v_row_id;
      v_changed := true;
    else
      update public.ecommerce_published_wholesale_tiers
      set source_tier_ref = v_ref,
          min_quantity = v_min,
          unit_price = v_price,
          display_order = coalesce((v_tier->>'displayOrder')::integer, 0),
          source_available = coalesce((v_tier->>'sourceAvailable')::boolean, true)
            and not (v_cost > 0 and v_price < v_cost),
          is_available = not (v_cost > 0 and v_price < v_cost),
          metadata = jsonb_strip_nulls(jsonb_build_object(
            'warningCode', case when v_cost > 0 and v_price < v_cost
              then 'WHOLESALE_TIER_BELOW_COST' end
          )),
          deleted_at = null,
          updated_at = now()
      where id = v_row_id
        and (source_tier_ref, min_quantity, unit_price, display_order,
             source_available, is_available, metadata, deleted_at)
          is distinct from
            (v_ref, v_min, v_price,
             coalesce((v_tier->>'displayOrder')::integer, 0),
             coalesce((v_tier->>'sourceAvailable')::boolean, true)
               and not (v_cost > 0 and v_price < v_cost),
             not (v_cost > 0 and v_price < v_cost),
             jsonb_strip_nulls(jsonb_build_object(
               'warningCode', case when v_cost > 0 and v_price < v_cost
                 then 'WHOLESALE_TIER_BELOW_COST' end
             )), null::timestamptz);
      get diagnostics v_count = row_count;
      v_changed := v_changed or v_count > 0;
    end if;
  end loop;

  update public.ecommerce_published_wholesale_tiers
  set deleted_at = now(), updated_at = now()
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_tier_ref = any(v_refs));
  get diagnostics v_count = row_count;
  v_changed := v_changed or v_count > 0;

  update public.ecommerce_published_products
  set wholesale_enabled = exists (
        select 1 from public.ecommerce_published_wholesale_tiers t
        where t.published_product_id = id and t.deleted_at is null
          and t.source_available and t.is_available
      ),
      wholesale_revision = wholesale_revision + 1
  where id = v_product.id
    and (
      wholesale_enabled is distinct from exists (
        select 1 from public.ecommerce_published_wholesale_tiers t
        where t.published_product_id = id and t.deleted_at is null
          and t.source_available and t.is_available
      )
      or v_changed
    );
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'changed', v_changed or v_count > 0);
end;
$$;

create or replace function private.ecommerce_reconcile_published_product_capability(
  p_product_id uuid
) returns public.ecommerce_published_products
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_types text[];
  v_has_source_modifiers boolean := false;
  v_supports_modifiers boolean := false;
  v_supports_wholesale boolean := false;
  v_status text;
  v_reason text;
  v_mode text;
  v_wholesale boolean;
begin
  select * into v_product
  from public.ecommerce_published_products
  where id = p_product_id and deleted_at is null
  for update;
  if v_product.id is null then return v_product; end if;

  v_types := private.ecommerce_normalized_business_types(v_product.license_id);
  v_supports_modifiers := private.ecommerce_business_supports_capability(
    v_product.license_id, 'restaurant_modifiers');
  v_supports_wholesale := private.ecommerce_business_supports_capability(
    v_product.license_id, 'wholesale_pricing');
  select coalesce(jsonb_typeof(p.modifiers) = 'array'
    and jsonb_array_length(p.modifiers) > 0, false)
  into v_has_source_modifiers
  from public.pos_products p
  where p.license_id = v_product.license_id
    and p.id = v_product.local_product_ref and p.deleted_at is null;

  v_wholesale := v_product.wholesale_enabled and v_supports_wholesale;
  if coalesce(array_length(v_types, 1), 0) = 0 then
    v_status := 'requires_review';
    v_reason := 'BUSINESS_TYPE_UNKNOWN';
    v_mode := case when v_product.public_configuration_mode = 'simple_override'
      then 'simple_override' else 'requires_review' end;
    v_wholesale := false;
  elsif v_has_source_modifiers and not v_supports_modifiers
        and v_product.public_configuration_mode <> 'simple_override' then
    v_status := 'requires_review';
    v_reason := 'RESTAURANT_MODIFIERS_NOT_SUPPORTED';
    v_mode := 'requires_review';
  elsif v_product.public_configuration_mode = 'simple_override' then
    v_status := 'simple_override';
    v_reason := case when v_has_source_modifiers and not v_supports_modifiers
      then 'RESTAURANT_MODIFIERS_NOT_SUPPORTED' end;
    v_mode := 'simple_override';
  else
    -- Unsupported wholesale disables only wholesale. It must not hide valid
    -- restaurant option groups or otherwise make the product incompatible.
    v_status := 'compatible';
    v_reason := null;
    v_mode := 'compatible';
  end if;

  update public.ecommerce_published_products
  set business_capability_status = v_status,
      business_capability_reason = v_reason,
      public_configuration_mode = v_mode,
      wholesale_enabled = v_wholesale,
      configuration_type = case when v_mode = 'simple_override'
        and not has_variants then 'simple' else configuration_type end,
      has_option_groups = case when v_mode = 'simple_override'
        then false else has_option_groups end,
      requires_configuration = case when v_mode = 'simple_override'
        then has_variants else requires_configuration end
  where id = v_product.id
    and (business_capability_status, business_capability_reason,
         public_configuration_mode, wholesale_enabled, configuration_type,
         has_option_groups, requires_configuration)
      is distinct from
        (v_status, v_reason, v_mode, v_wholesale,
         case when v_mode = 'simple_override' and not has_variants
           then 'simple' else configuration_type end,
         case when v_mode = 'simple_override' then false else has_option_groups end,
         case when v_mode = 'simple_override' then has_variants
           else requires_configuration end);

  if v_mode in ('simple_override','requires_review','hidden_incompatible') then
    update public.ecommerce_published_option_groups
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
    update public.ecommerce_published_options
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  if not v_wholesale then
    update public.ecommerce_published_wholesale_tiers
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  select * into v_product from public.ecommerce_published_products
  where id = p_product_id;
  return v_product;
end;
$$;

-- v3 must return the revision after its own tier/capability writes, not the
-- intermediate revision returned by v2.
create or replace function public.ecommerce_admin_upsert_published_product_v3(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_product_id uuid;
  v_portal_id uuid;
  v_revision bigint;
  v_mode text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;
  v_mode := coalesce(nullif(p_payload->>'publicConfigurationMode',''),'compatible');
  if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible')
     or jsonb_typeof(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) > 50 then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;
  v_result := public.ecommerce_admin_upsert_published_product_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    p_payload - array['businessCapabilityStatus','businessCapabilityReason',
      'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  v_product_id := (v_result#>>'{product,id}')::uuid;
  update public.ecommerce_published_products
  set public_configuration_mode = v_mode
  where id = v_product_id and public_configuration_mode is distinct from v_mode;
  perform private.ecommerce_apply_wholesale_tiers(v_product_id,
    coalesce((p_payload->>'wholesaleEnabled')::boolean,false),
    coalesce(p_payload->'wholesaleTiers','[]'::jsonb));
  perform private.ecommerce_reconcile_published_product_capability(v_product_id);
  select portal_id into v_portal_id from public.ecommerce_published_products where id=v_product_id;
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_id;
  return jsonb_set(v_result || jsonb_build_object(
    'product',private.ecommerce_admin_product_jsonb(
      (select p from public.ecommerce_published_products p where p.id=v_product_id)
    )), '{catalogRevision}', to_jsonb(v_revision), true);
exception when others then
  return private.ecommerce_admin_error(case
    when sqlerrm like '%ECOMMERCE_WHOLESALE_INVALID_PAYLOAD%'
      then 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD'
    else 'ECOMMERCE_ADMIN_SAVE_FAILED' end);
end;
$$;

create or replace function public.ecommerce_admin_sync_published_catalog_v3(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_projections jsonb,
  p_idempotency_key text,
  p_expected_catalog_revision bigint default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_legacy jsonb;
  v_projection jsonb;
  v_product_id uuid;
  v_portal_id uuid;
  v_revision bigint;
  v_mode text;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections) < 1
     or jsonb_array_length(p_projections) > 200
     or exists (select 1 from jsonb_array_elements(p_projections) p
       where jsonb_typeof(p) <> 'object'
          or jsonb_typeof(coalesce(p->'wholesaleTiers','[]'::jsonb)) <> 'array'
          or jsonb_array_length(coalesce(p->'wholesaleTiers','[]'::jsonb)) > 50) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;
  select jsonb_agg(value - array['businessCapabilityStatus','businessCapabilityReason',
    'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
    order by ordinality) into v_legacy
  from jsonb_array_elements(p_projections) with ordinality;
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    v_legacy,p_idempotency_key,p_expected_catalog_revision);
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  for v_projection in select value from jsonb_array_elements(p_projections)
  loop
    v_product_id := (v_projection->>'publishedProductId')::uuid;
    v_mode := coalesce(nullif(v_projection->>'publicConfigurationMode',''),'compatible');
    if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible') then
      raise exception 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD';
    end if;
    update public.ecommerce_published_products
    set public_configuration_mode = case when public_configuration_mode='simple_override'
      then 'simple_override' else v_mode end
    where id=v_product_id and public_configuration_mode is distinct from
      case when public_configuration_mode='simple_override' then 'simple_override' else v_mode end;
    perform private.ecommerce_apply_wholesale_tiers(v_product_id,
      coalesce((v_projection->>'wholesaleEnabled')::boolean,false),
      coalesce(v_projection->'wholesaleTiers','[]'::jsonb));
    perform private.ecommerce_reconcile_published_product_capability(v_product_id);
    if v_portal_id is null then
      select portal_id into v_portal_id from public.ecommerce_published_products where id=v_product_id;
    end if;
  end loop;
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_id;
  return jsonb_set(v_result, '{catalogRevision}', to_jsonb(v_revision), true);
exception when others then
  return private.ecommerce_admin_error(case when sqlerrm like '%WHOLESALE%'
    then 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD'
    else 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD' end);
end;
$$;

-- Patch the existing checkout in place while preserving its public signature
-- and all prior authentication/idempotency behavior.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition,
    'v_current_configuration_revision text;',
    'v_current_configuration_revision text;
  v_pricing_base numeric;
  v_wholesale_base numeric;
  v_wholesale_tier_ref text;
  v_wholesale_min_quantity integer;');
  v_definition := replace(v_definition,
    'select t.unit_price into v_base_unit_price',
    'select t.unit_price, t.source_tier_ref, t.min_quantity
      into v_wholesale_base, v_wholesale_tier_ref, v_wholesale_min_quantity');
  v_definition := replace(v_definition,
    'if v_product.business_capability_status not in (''compatible'',''simple_override'')',
    'v_wholesale_base := null;
    v_wholesale_tier_ref := null;
    v_wholesale_min_quantity := null;
    v_pricing_base := null;
    if v_product.business_capability_status not in (''compatible'',''simple_override'')');
  v_definition := replace(v_definition,
    'v_base_unit_price:=coalesce(v_base_unit_price,round(v_product.price+v_variant_adjustment,2));
    end if;
    v_final_unit_price:=round(v_base_unit_price+v_options_adjustment,2);',
    'v_pricing_base := coalesce(v_wholesale_base, round(v_product.price, 2));
    end if;
    if v_pricing_base is null then v_pricing_base := round(v_product.price, 2); end if;
    v_final_unit_price:=greatest(0,round(v_pricing_base+v_variant_adjustment+v_options_adjustment,2));');
  v_definition := replace(v_definition,
    'v_line_total:=round(v_final_unit_price*v_quantity,2);',
    'v_snapshot := jsonb_set(v_snapshot, ''{pricing}'',
      jsonb_strip_nulls(jsonb_build_object(
        ''pricingMode'', case when v_wholesale_base is null then ''standard'' else ''wholesale'' end,
        ''baseUnitPrice'', round(v_product.price,2),
        ''wholesaleBaseUnitPrice'', v_wholesale_base,
        ''appliedUnitPrice'', v_final_unit_price,
        ''wholesaleTierRef'', v_wholesale_tier_ref,
        ''wholesaleMinQuantity'', v_wholesale_min_quantity,
        ''variantAdjustment'', v_variant_adjustment,
        ''optionsAdjustment'', v_options_adjustment
      )), true);
    v_line_total:=round(v_final_unit_price*v_quantity,2);');
  execute v_definition;
end
$migration$;

alter function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb) owner to postgres;
alter function private.ecommerce_reconcile_published_product_capability(uuid) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product_v3(text,text,text,text,jsonb) owner to postgres;
alter function public.ecommerce_admin_sync_published_catalog_v3(text,text,text,text,jsonb,text,bigint) owner to postgres;
alter function public.ecommerce_create_order(text,jsonb,jsonb,text) owner to postgres;

revoke all on function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_reconcile_published_product_capability(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_business_capability_parent_guard()
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_configuration_child_guard()
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_wholesale_tier_parent_guard()
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_business_supports_capability(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_normalized_business_types(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_reconcile_license_capabilities(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_profile_capability_reconcile_trigger()
  from public, anon, authenticated, service_role;

grant execute on function public.ecommerce_admin_upsert_published_product_v3(text,text,text,text,jsonb)
  to authenticated, service_role;
grant execute on function public.ecommerce_admin_sync_published_catalog_v3(text,text,text,text,jsonb,text,bigint)
  to authenticated, service_role;
grant execute on function public.ecommerce_create_order(text,jsonb,jsonb,text)
  to anon, authenticated, service_role;

revoke all on table public.ecommerce_published_wholesale_tiers
  from public, anon, authenticated, service_role;
alter table public.ecommerce_published_wholesale_tiers enable row level security;
