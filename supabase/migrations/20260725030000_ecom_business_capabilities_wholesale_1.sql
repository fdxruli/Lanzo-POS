-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1
-- Additive capability reconciliation and opt-in public wholesale pricing.

alter table public.ecommerce_portals
  add column if not exists business_types_snapshot text[] not null default '{}'::text[];

alter table public.ecommerce_published_products
  add column if not exists business_capability_status text not null default 'compatible',
  add column if not exists business_capability_reason text,
  add column if not exists public_configuration_mode text not null default 'compatible',
  add column if not exists wholesale_enabled boolean not null default false,
  add column if not exists wholesale_revision bigint not null default 1;

alter table public.ecommerce_published_products
  drop constraint if exists ecommerce_published_products_capability_status_check,
  add constraint ecommerce_published_products_capability_status_check
    check (business_capability_status in (
      'compatible', 'requires_review', 'simple_override', 'hidden_incompatible'
    )),
  drop constraint if exists ecommerce_published_products_capability_reason_check,
  add constraint ecommerce_published_products_capability_reason_check
    check (business_capability_reason is null or business_capability_reason in (
      'RESTAURANT_MODIFIERS_NOT_SUPPORTED',
      'WHOLESALE_NOT_SUPPORTED',
      'BUSINESS_TYPE_UNKNOWN',
      'BUSINESS_CAPABILITY_CHANGED'
    )),
  drop constraint if exists ecommerce_published_products_public_configuration_mode_check,
  add constraint ecommerce_published_products_public_configuration_mode_check
    check (public_configuration_mode in (
      'compatible', 'requires_review', 'simple_override', 'hidden_incompatible'
    )),
  drop constraint if exists ecommerce_published_products_wholesale_revision_check,
  add constraint ecommerce_published_products_wholesale_revision_check
    check (wholesale_revision > 0);

create table if not exists public.ecommerce_published_wholesale_tiers (
  id uuid primary key default gen_random_uuid(),
  published_product_id uuid not null,
  portal_id uuid not null,
  license_id uuid not null,
  source_tier_ref text not null,
  min_quantity integer not null,
  unit_price numeric(14,2) not null,
  display_order integer not null default 0,
  manual_available boolean not null default true,
  source_available boolean not null default true,
  is_available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_wholesale_tiers_product_fk
    foreign key (published_product_id)
    references public.ecommerce_published_products (id) on delete restrict,
  constraint ecommerce_wholesale_tiers_portal_fk
    foreign key (portal_id) references public.ecommerce_portals(id) on delete restrict,
  constraint ecommerce_wholesale_tiers_license_fk
    foreign key (license_id) references public.licenses(id) on delete restrict,
  constraint ecommerce_wholesale_tiers_source_ref_check
    check (length(btrim(source_tier_ref)) between 1 and 160),
  constraint ecommerce_wholesale_tiers_quantity_check
    check (min_quantity between 1 and 1000000),
  constraint ecommerce_wholesale_tiers_price_check
    check (unit_price between 0 and 999999999999.99),
  constraint ecommerce_wholesale_tiers_order_check
    check (display_order between 0 and 1000),
  constraint ecommerce_wholesale_tiers_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists ecommerce_wholesale_tiers_active_ref_uidx
  on public.ecommerce_published_wholesale_tiers
  (published_product_id, source_tier_ref)
  where deleted_at is null;
create unique index if not exists ecommerce_wholesale_tiers_active_quantity_uidx
  on public.ecommerce_published_wholesale_tiers
  (published_product_id, min_quantity)
  where deleted_at is null;
create index if not exists ecommerce_wholesale_tiers_public_lookup_idx
  on public.ecommerce_published_wholesale_tiers
  (published_product_id, min_quantity desc)
  where deleted_at is null and manual_available and source_available and is_available;
create index if not exists ecommerce_wholesale_tiers_portal_license_idx
  on public.ecommerce_published_wholesale_tiers (portal_id, license_id);

alter table public.ecommerce_published_wholesale_tiers enable row level security;
revoke all on table public.ecommerce_published_wholesale_tiers
  from public, anon, authenticated, service_role;

create or replace function private.ecommerce_wholesale_tier_parent_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ecommerce_published_products p
    where p.id = new.published_product_id
      and p.portal_id = new.portal_id
      and p.license_id = new.license_id
      and p.deleted_at is null
  ) then
    raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ecommerce_wholesale_tier_parent_guard
  on public.ecommerce_published_wholesale_tiers;
create trigger ecommerce_wholesale_tier_parent_guard
before insert or update on public.ecommerce_published_wholesale_tiers
for each row execute function private.ecommerce_wholesale_tier_parent_guard();

create or replace function private.ecommerce_normalized_business_types(
  p_license_id uuid
) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct normalized order by normalized), '{}'::text[])
  from (
    select case lower(btrim(raw_type::text))
      when 'restaurante' then 'food_service'
      when 'darkitchen' then 'food_service'
      when 'antojitos' then 'food_service'
      when 'food_service' then 'food_service'
      when 'abarrotes' then 'abarrotes'
      when 'hardware' then 'hardware'
      when 'apparel' then 'apparel'
      when 'farmacia' then 'farmacia'
      when 'verduleria/fruteria' then 'verduleria/fruteria'
      else null
    end normalized
    from public.business_profiles bp,
         unnest(coalesce(bp.business_type, '{}'::public.business_category[])) raw_type
    where bp.license_id = p_license_id
  ) values_normalized
  where normalized is not null;
$$;

create or replace function private.ecommerce_business_supports_capability(
  p_license_id uuid,
  p_capability text
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  with types as (
    select unnest(private.ecommerce_normalized_business_types(p_license_id)) value
  )
  select case p_capability
    when 'restaurant_modifiers' then exists (
      select 1 from types where value = 'food_service'
    )
    when 'wholesale_pricing' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','apparel','verduleria/fruteria')
    )
    when 'variants' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','apparel','farmacia')
    )
    when 'bulk_sales' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','verduleria/fruteria')
    )
    when 'prescription_fields' then exists (
      select 1 from types where value = 'farmacia'
    )
    when 'recipes' then exists (
      select 1 from types where value = 'food_service'
    )
    else false
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
begin
  select * into v_product
  from public.ecommerce_published_products
  where id = p_product_id and deleted_at is null
  for update;
  if v_product.id is null then return v_product; end if;

  v_types := private.ecommerce_normalized_business_types(v_product.license_id);
  v_supports_modifiers := private.ecommerce_business_supports_capability(
    v_product.license_id, 'restaurant_modifiers'
  );
  v_supports_wholesale := private.ecommerce_business_supports_capability(
    v_product.license_id, 'wholesale_pricing'
  );
  select coalesce(jsonb_typeof(p.modifiers) = 'array'
    and jsonb_array_length(p.modifiers) > 0, false)
    into v_has_source_modifiers
  from public.pos_products p
  where p.license_id = v_product.license_id
    and p.id = v_product.local_product_ref
    and p.deleted_at is null;

  if coalesce(array_length(v_types, 1), 0) = 0 then
    update public.ecommerce_published_products
    set business_capability_status = 'requires_review',
        business_capability_reason = 'BUSINESS_TYPE_UNKNOWN',
        public_configuration_mode = case
          when public_configuration_mode = 'simple_override' then 'simple_override'
          else 'requires_review'
        end,
        wholesale_enabled = false,
        updated_at = now()
    where id = v_product.id;
  elsif v_has_source_modifiers and not v_supports_modifiers
        and v_product.public_configuration_mode <> 'simple_override' then
    update public.ecommerce_published_products
    set business_capability_status = 'requires_review',
        business_capability_reason = 'RESTAURANT_MODIFIERS_NOT_SUPPORTED',
        public_configuration_mode = 'requires_review',
        wholesale_enabled = wholesale_enabled and v_supports_wholesale,
        updated_at = now()
    where id = v_product.id;
  elsif v_product.public_configuration_mode = 'simple_override' then
    update public.ecommerce_published_products
    set business_capability_status = 'simple_override',
        business_capability_reason = case
          when v_has_source_modifiers and not v_supports_modifiers
            then 'RESTAURANT_MODIFIERS_NOT_SUPPORTED'
          else null
        end,
        configuration_type = 'simple',
        has_option_groups = false,
        requires_configuration = has_variants,
        wholesale_enabled = wholesale_enabled and v_supports_wholesale,
        updated_at = now()
    where id = v_product.id;
  else
    update public.ecommerce_published_products
    set business_capability_status = 'compatible',
        business_capability_reason = null,
        public_configuration_mode = 'compatible',
        wholesale_enabled = wholesale_enabled and v_supports_wholesale,
        updated_at = now()
    where id = v_product.id;
  end if;

  select * into v_product
  from public.ecommerce_published_products where id = p_product_id;

  if v_product.public_configuration_mode in (
    'simple_override','requires_review','hidden_incompatible'
  ) then
    update public.ecommerce_published_option_groups
    set deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
    update public.ecommerce_published_options
    set deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  if v_product.wholesale_enabled is not true then
    update public.ecommerce_published_wholesale_tiers
    set deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  return v_product;
end;
$$;

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
  if p_enabled and not private.ecommerce_business_supports_capability(
    v_product.license_id, 'wholesale_pricing'
  ) then
    raise exception 'ECOMMERCE_WHOLESALE_NOT_SUPPORTED';
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
       or not (v_tier ?& array['sourceTierRef','minQuantity','unitPrice'])
       or (v_tier - array[
         'sourceTierRef','minQuantity','unitPrice','displayOrder',
         'sourceAvailable','warningCode'
       ]) <> '{}'::jsonb then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end if;
    begin
      v_ref := nullif(btrim(v_tier->>'sourceTierRef'), '');
      v_min := (v_tier->>'minQuantity')::integer;
      v_price := round((v_tier->>'unitPrice')::numeric, 2);
    exception when others then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end;
    if v_ref is null or length(v_ref) > 160 or v_min < 1
       or v_min > 1000000 or v_price < 0
       or v_min = any(v_quantities) or v_ref = any(v_refs) then
      raise exception 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD';
    end if;
    v_refs := array_append(v_refs, v_ref);
    v_quantities := array_append(v_quantities, v_min);
    insert into public.ecommerce_published_wholesale_tiers (
      published_product_id, portal_id, license_id, source_tier_ref,
      min_quantity, unit_price, display_order, source_available,
      is_available, metadata, deleted_at
    ) values (
      v_product.id, v_product.portal_id, v_product.license_id, v_ref,
      v_min, v_price, coalesce((v_tier->>'displayOrder')::integer, 0),
      coalesce((v_tier->>'sourceAvailable')::boolean, true) and not (v_cost > 0 and v_price < v_cost),
      not (v_cost > 0 and v_price < v_cost),
      jsonb_strip_nulls(jsonb_build_object(
        'warningCode', case when v_cost > 0 and v_price < v_cost
          then 'WHOLESALE_TIER_BELOW_COST' else null end
      )),
      case when p_enabled then null else now() end
    )
    on conflict (published_product_id, source_tier_ref)
      where deleted_at is null
    do update set
      min_quantity = excluded.min_quantity,
      unit_price = excluded.unit_price,
      display_order = excluded.display_order,
      source_available = excluded.source_available,
      is_available = excluded.is_available,
      metadata = excluded.metadata,
      updated_at = now();
  end loop;

  update public.ecommerce_published_wholesale_tiers
  set deleted_at = now(), updated_at = now()
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_tier_ref = any(v_refs));

  update public.ecommerce_published_products
  set wholesale_enabled = p_enabled
        and private.ecommerce_business_supports_capability(
          license_id, 'wholesale_pricing'
        )
        and exists (
          select 1 from public.ecommerce_published_wholesale_tiers t
          where t.published_product_id = id and t.deleted_at is null
            and t.source_available and t.is_available
        ),
      wholesale_revision = wholesale_revision + 1,
      updated_at = now()
  where id = v_product.id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function private.ecommerce_reconcile_license_capabilities(
  p_license_id uuid
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_portal_id uuid;
  v_product_id uuid;
  v_count integer := 0;
begin
  select id into v_portal_id
  from public.ecommerce_portals
  where license_id = p_license_id and deleted_at is null
  for update;
  if v_portal_id is null then return 0; end if;
  update public.ecommerce_portals
  set business_types_snapshot = private.ecommerce_normalized_business_types(p_license_id),
      updated_at = now()
  where id = v_portal_id;
  for v_product_id in
    select id from public.ecommerce_published_products
    where portal_id = v_portal_id and license_id = p_license_id
      and deleted_at is null
    order by id
    for update
  loop
    perform private.ecommerce_reconcile_published_product_capability(v_product_id);
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    update public.ecommerce_portals
    set catalog_revision = catalog_revision + 1, updated_at = now()
    where id = v_portal_id;
  end if;
  return v_count;
end;
$$;

create or replace function private.ecommerce_profile_capability_reconcile_trigger()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or old.business_type is distinct from new.business_type then
    perform private.ecommerce_reconcile_license_capabilities(new.license_id);
  end if;
  return new;
end;
$$;

drop trigger if exists ecommerce_profile_capability_reconcile
  on public.business_profiles;
create trigger ecommerce_profile_capability_reconcile
after insert or update of business_type on public.business_profiles
for each row execute function private.ecommerce_profile_capability_reconcile_trigger();

create or replace function private.ecommerce_product_publicly_available(
  p_product public.ecommerce_published_products
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_product.id is null or p_product.deleted_at is not null
     or p_product.is_published is not true
     or p_product.manual_available is not true then return false; end if;
  if p_product.business_capability_status not in ('compatible','simple_override')
     or p_product.public_configuration_mode in ('requires_review','hidden_incompatible')
     then return false; end if;
  if p_product.requires_configuration is not true then
    return p_product.is_available is true;
  end if;
  if p_product.availability_source = 'unverified' then return false; end if;
  if p_product.has_variants is true then
    return exists(
      select 1 from public.ecommerce_published_product_variants v
      where v.published_product_id = p_product.id
        and v.portal_id = p_product.portal_id
        and v.license_id = p_product.license_id
        and v.deleted_at is null and v.manual_available
        and v.source_available and v.is_available
    );
  end if;
  if p_product.availability_source = 'not_tracked' then return true; end if;
  if p_product.source_available is not true then return false; end if;
  if p_product.stock_mode in ('status','exact','reserve_on_confirm')
     and p_product.stock_snapshot is not null
     and p_product.stock_snapshot <= 0 then return false; end if;
  return true;
end;
$$;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_product.id,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', private.ecommerce_product_publicly_available(p_product),
    'displayOrder', p_product.display_order,
    'configuration', jsonb_build_object(
      'type', p_product.configuration_type,
      'version', p_product.configuration_version,
      'hasVariants', p_product.has_variants,
      'hasOptionGroups', p_product.has_option_groups,
      'requiresConfiguration', p_product.requires_configuration
    ),
    'wholesaleEnabled', p_product.wholesale_enabled,
    'wholesaleRevision', p_product.wholesale_revision,
    'wholesaleTiers', case when p_product.wholesale_enabled then coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceTierRef', t.source_tier_ref,
        'minQuantity', t.min_quantity,
        'unitPrice', t.unit_price
      ) order by t.min_quantity)
      from public.ecommerce_published_wholesale_tiers t
      where t.published_product_id = p_product.id
        and t.portal_id = p_product.portal_id
        and t.license_id = p_product.license_id
        and t.deleted_at is null and t.manual_available
        and t.source_available and t.is_available
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stock', case
      when p_allow_stock_visibility is not true then
        jsonb_build_object('mode','hidden','status',null,'quantity',null)
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode','status',
        'status',case when private.ecommerce_product_publicly_available(p_product)
          and coalesce(p_product.stock_snapshot,1)>0 then 'available' else 'out_of_stock' end,
        'quantity',null
      )
      when p_product.stock_mode in ('exact','reserve_on_confirm') then jsonb_build_object(
        'mode','exact',
        'status',case when private.ecommerce_product_publicly_available(p_product)
          and coalesce(p_product.stock_snapshot,0)>0 then 'available' else 'out_of_stock' end,
        'quantity',greatest(floor(coalesce(p_product.stock_snapshot,0)),0)
      )
      else jsonb_build_object(
        'mode','hidden',
        'status',case when private.ecommerce_product_publicly_available(p_product)
          then 'available' else 'out_of_stock' end,
        'quantity',null
      )
    end,
    'options', p_product.options
  );
$$;

create or replace function private.ecommerce_admin_product_jsonb(
  p_product public.ecommerce_published_products
) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_product.id,'sourceType',p_product.source_type,
    'productId',p_product.product_id,'localProductRef',p_product.local_product_ref,
    'publicName',p_product.public_name,'publicDescription',p_product.public_description,
    'categoryName',p_product.category_name,'price',p_product.price,
    'currency',p_product.currency,'imageUrl',p_product.image_url,
    'isPublished',p_product.is_published,'isAvailable',p_product.is_available,
    'manualAvailable',p_product.manual_available,'sourceAvailable',p_product.source_available,
    'displayOrder',p_product.display_order,'stockMode',p_product.stock_mode,
    'stockSnapshot',p_product.stock_snapshot,'syncConfig',p_product.sync_config,
    'syncStatus',p_product.sync_status,'syncErrorCode',p_product.sync_error_code,
    'sourceState',p_product.source_state,'sourceRevision',p_product.source_revision,
    'lastSyncAttemptAt',p_product.last_sync_attempt_at,'lastSyncedAt',p_product.last_synced_at,
    'configurationType',p_product.configuration_type,
    'configurationVersion',p_product.configuration_version,
    'hasRecipe',p_product.has_recipe,'hasVariants',p_product.has_variants,
    'hasOptionGroups',p_product.has_option_groups,
    'requiresConfiguration',p_product.requires_configuration,
    'availabilitySource',p_product.availability_source,
    'availabilityReasonCode',p_product.availability_reason_code,
    'businessCapabilityStatus',p_product.business_capability_status,
    'businessCapabilityReason',p_product.business_capability_reason,
    'publicConfigurationMode',p_product.public_configuration_mode,
    'wholesaleEnabled',p_product.wholesale_enabled,
    'wholesaleRevision',p_product.wholesale_revision,
    'wholesaleTiers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceTierRef',t.source_tier_ref,'minQuantity',t.min_quantity,
        'unitPrice',t.unit_price,'displayOrder',t.display_order,
        'sourceAvailable',t.source_available,'isAvailable',t.is_available
      ) order by t.min_quantity)
      from public.ecommerce_published_wholesale_tiers t
      where t.published_product_id=p_product.id and t.deleted_at is null
    ),'[]'::jsonb),
    'limitingSource',jsonb_strip_nulls(jsonb_build_object(
      'productId',p_product.limiting_source_product_id,'name',p_product.limiting_source_name
    )),
    'variantCount',(select count(*) from public.ecommerce_published_product_variants v
      where v.published_product_id=p_product.id and v.deleted_at is null),
    'optionGroupCount',(select count(*) from public.ecommerce_published_option_groups g
      where g.published_product_id=p_product.id and g.deleted_at is null),
    'optionCount',(select count(*) from public.ecommerce_published_options o
      where o.published_product_id=p_product.id and o.deleted_at is null),
    'hasManualFields',exists(select 1 from jsonb_each_text(p_product.sync_config) field
      where field.value='manual'),
    'metadata',p_product.metadata,'createdAt',p_product.created_at,
    'updatedAt',p_product.updated_at
  );
$$;

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
    p_payload - array[
      'businessCapabilityStatus','businessCapabilityReason',
      'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings'
    ]
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  v_product_id := (v_result#>>'{product,id}')::uuid;
  update public.ecommerce_published_products
  set public_configuration_mode = v_mode,
      updated_at = now()
  where id = v_product_id;
  perform private.ecommerce_apply_wholesale_tiers(
    v_product_id,
    coalesce((p_payload->>'wholesaleEnabled')::boolean,false),
    coalesce(p_payload->'wholesaleTiers','[]'::jsonb)
  );
  perform private.ecommerce_reconcile_published_product_capability(v_product_id);
  return v_result || jsonb_build_object(
    'product',private.ecommerce_admin_product_jsonb(
      (select p from public.ecommerce_published_products p where p.id=v_product_id)
    )
  );
exception when others then
  return private.ecommerce_admin_error(
    case
      when sqlerrm like '%ECOMMERCE_WHOLESALE_NOT_SUPPORTED%'
        then 'ECOMMERCE_WHOLESALE_NOT_SUPPORTED'
      when sqlerrm like '%ECOMMERCE_WHOLESALE_INVALID_PAYLOAD%'
        then 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD'
      else 'ECOMMERCE_ADMIN_SAVE_FAILED'
    end
  );
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
  v_mode text;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections) < 1
     or jsonb_array_length(p_projections) > 200
     or exists (
       select 1 from jsonb_array_elements(p_projections) p
       where jsonb_typeof(p) <> 'object'
          or jsonb_typeof(coalesce(p->'wholesaleTiers','[]'::jsonb)) <> 'array'
          or jsonb_array_length(coalesce(p->'wholesaleTiers','[]'::jsonb)) > 50
     ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;
  select jsonb_agg(
    value - array[
      'businessCapabilityStatus','businessCapabilityReason',
      'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings'
    ] order by ordinality
  ) into v_legacy
  from jsonb_array_elements(p_projections) with ordinality;
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    v_legacy,p_idempotency_key,p_expected_catalog_revision
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  for v_projection in select value from jsonb_array_elements(p_projections)
  loop
    begin
      v_product_id := (v_projection->>'publishedProductId')::uuid;
      v_mode := coalesce(nullif(v_projection->>'publicConfigurationMode',''),'compatible');
      if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible') then
        raise exception 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD';
      end if;
      update public.ecommerce_published_products
      set public_configuration_mode = case
            when public_configuration_mode = 'simple_override'
              then 'simple_override'
            else v_mode
          end,
          updated_at = now()
      where id = v_product_id;
      perform private.ecommerce_apply_wholesale_tiers(
        v_product_id,
        coalesce((v_projection->>'wholesaleEnabled')::boolean,false),
        coalesce(v_projection->'wholesaleTiers','[]'::jsonb)
      );
      perform private.ecommerce_reconcile_published_product_capability(v_product_id);
    exception when others then
      return private.ecommerce_admin_error(
        case when sqlerrm like '%WHOLESALE%'
          then 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD'
          else 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD' end
      );
    end;
  end loop;
  return v_result;
end;
$$;

-- Preserve existing signatures while filtering fail-closed rows from public catalog.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_get_catalog(text,integer,integer,bigint)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'and pp.is_published is true;',
    'and pp.is_published is true
    and pp.business_capability_status in (''compatible'',''simple_override'')
    and pp.public_configuration_mode not in (''requires_review'',''hidden_incompatible'');'
  );
  v_definition := replace(
    v_definition,
    'and pp.is_published is true
    order by pp.display_order',
    'and pp.is_published is true
      and pp.business_capability_status in (''compatible'',''simple_override'')
      and pp.public_configuration_mode not in (''requires_review'',''hidden_incompatible'')
    order by pp.display_order'
  );
  execute v_definition;
end;
$$;

-- Explicitly reject incompatible configuration reads.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_get_product_configuration(text,uuid)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'if v_product.id is null then
    return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_FOUND'');
  end if;',
    'if v_product.id is null then
    return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_FOUND'');
  end if;
  if v_product.business_capability_status not in (''compatible'',''simple_override'')
     or v_product.public_configuration_mode in (''requires_review'',''hidden_incompatible'') then
    return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_FOUND'');
  end if;'
  );
  execute v_definition;
end;
$$;

-- Authoritative wholesale selection occurs after variant price and before extras.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'v_final_unit_price:=round(v_base_unit_price+v_options_adjustment,2);',
    'if v_product.business_capability_status not in (''compatible'',''simple_override'')
       or v_product.public_configuration_mode in (''requires_review'',''hidden_incompatible'') then
      return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_FOUND'');
    end if;
    if v_product.wholesale_enabled
       and private.ecommerce_business_supports_capability(v_product.license_id,''wholesale_pricing'') then
      select t.unit_price into v_base_unit_price
      from public.ecommerce_published_wholesale_tiers t
      where t.published_product_id=v_product.id
        and t.portal_id=v_product.portal_id and t.license_id=v_product.license_id
        and t.deleted_at is null and t.manual_available and t.source_available and t.is_available
        and t.min_quantity<=v_quantity
      order by t.min_quantity desc limit 1;
      v_base_unit_price:=coalesce(v_base_unit_price,round(v_product.price+v_variant_adjustment,2));
    end if;
    v_final_unit_price:=round(v_base_unit_price+v_options_adjustment,2);'
  );
  v_definition := replace(
    v_definition,
    '''finalUnitPrice'',v_final_unit_price)',
    '''finalUnitPrice'',v_final_unit_price,
      ''pricingMode'',case when v_product.wholesale_enabled and v_base_unit_price < round(v_product.price+v_variant_adjustment,2) then ''wholesale'' else ''standard'' end,
      ''baseUnitPrice'',round(v_product.price+v_variant_adjustment,2),
      ''appliedUnitPrice'',v_final_unit_price,
      ''wholesaleMinQuantity'',case when v_product.wholesale_enabled then (
        select max(t.min_quantity) from public.ecommerce_published_wholesale_tiers t
        where t.published_product_id=v_product.id and t.deleted_at is null
          and t.manual_available and t.source_available and t.is_available
          and t.min_quantity<=v_quantity
      ) else null end,
      ''wholesaleTierRef'',case when v_product.wholesale_enabled then (
        select t.source_tier_ref from public.ecommerce_published_wholesale_tiers t
        where t.published_product_id=v_product.id and t.deleted_at is null
          and t.manual_available and t.source_available and t.is_available
          and t.min_quantity<=v_quantity order by t.min_quantity desc limit 1
      ) else null end)'
  );
  execute v_definition;
end;
$$;

-- Conservative backfill: snapshot profile types, opt out wholesale, reconcile all rows.
update public.ecommerce_portals p
set business_types_snapshot = private.ecommerce_normalized_business_types(p.license_id),
    updated_at = now()
where p.deleted_at is null;

update public.ecommerce_published_products
set wholesale_enabled = false
where wholesale_enabled is distinct from false;

do $$
declare
  v_license_id uuid;
begin
  for v_license_id in
    select distinct license_id from public.ecommerce_portals where deleted_at is null
  loop
    perform private.ecommerce_reconcile_license_capabilities(v_license_id);
  end loop;
end;
$$;

alter function private.ecommerce_normalized_business_types(uuid) owner to postgres;
alter function private.ecommerce_business_supports_capability(uuid,text) owner to postgres;
alter function private.ecommerce_reconcile_published_product_capability(uuid) owner to postgres;
alter function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb) owner to postgres;
alter function private.ecommerce_reconcile_license_capabilities(uuid) owner to postgres;
alter function private.ecommerce_profile_capability_reconcile_trigger() owner to postgres;
alter function private.ecommerce_wholesale_tier_parent_guard() owner to postgres;
alter function public.ecommerce_admin_upsert_published_product_v3(
  text,text,text,text,jsonb
) owner to postgres;
alter function public.ecommerce_admin_sync_published_catalog_v3(
  text,text,text,text,jsonb,text,bigint
) owner to postgres;

revoke all on function private.ecommerce_normalized_business_types(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_business_supports_capability(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_reconcile_published_product_capability(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_apply_wholesale_tiers(uuid,boolean,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_reconcile_license_capabilities(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_profile_capability_reconcile_trigger()
  from public,anon,authenticated,service_role;
revoke all on function private.ecommerce_wholesale_tier_parent_guard()
  from public,anon,authenticated,service_role;
revoke all on function public.ecommerce_admin_upsert_published_product_v3(
  text,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product_v3(
  text,text,text,text,jsonb
) to anon,authenticated,service_role;
revoke all on function public.ecommerce_admin_sync_published_catalog_v3(
  text,text,text,text,jsonb,text,bigint
) from public,anon,authenticated;
grant execute on function public.ecommerce_admin_sync_published_catalog_v3(
  text,text,text,text,jsonb,text,bigint
) to anon,authenticated,service_role;

comment on table public.ecommerce_published_wholesale_tiers is
  'Normalized opt-in public wholesale tiers. No direct application DML; canonical writers only.';
comment on function public.ecommerce_admin_upsert_published_product_v3(
  text,text,text,text,jsonb
) is
  'ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1 additive admin writer with capability and wholesale enforcement.';
