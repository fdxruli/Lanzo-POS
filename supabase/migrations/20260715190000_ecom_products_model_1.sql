-- ECOM.PRODUCTS.MODEL.1
-- Canonical configurable-product model, recipe-derived availability metadata,
-- normalized variants/options, and safe pre-PUBLIC.1 configuration synchronization.

alter table public.ecommerce_published_products
  add column if not exists configuration_type text not null default 'simple',
  add column if not exists configuration_version integer not null default 1,
  add column if not exists has_recipe boolean not null default false,
  add column if not exists has_variants boolean not null default false,
  add column if not exists has_option_groups boolean not null default false,
  add column if not exists requires_configuration boolean not null default false,
  add column if not exists availability_source text not null default 'direct',
  add column if not exists availability_reason_code text,
  add column if not exists limiting_source_product_id text,
  add column if not exists limiting_source_name text;

alter table public.ecommerce_published_products
  drop constraint if exists ecommerce_published_products_configuration_type_check,
  add constraint ecommerce_published_products_configuration_type_check
    check (configuration_type in ('simple','recipe','variant_parent','configurable')),
  drop constraint if exists ecommerce_published_products_configuration_version_check,
  add constraint ecommerce_published_products_configuration_version_check
    check (configuration_version >= 1 and configuration_version <= 100),
  drop constraint if exists ecommerce_published_products_availability_source_check,
  add constraint ecommerce_published_products_availability_source_check
    check (availability_source in (
      'direct','recipe','variant_aggregate','not_tracked','manual','unverified'
    ));

comment on column public.ecommerce_published_products.configuration_type is
  'Canonical ECOM.PRODUCTS model: simple, recipe, variant_parent or configurable.';
comment on column public.ecommerce_published_products.requires_configuration is
  'Fail-closed checkout gate until ECOM.PRODUCTS.PUBLIC.1 can collect required selections.';
comment on column public.ecommerce_published_products.limiting_source_product_id is
  'Administrative-only source reference for the limiting recipe ingredient. Never returned publicly.';

create table if not exists public.ecommerce_published_product_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  published_product_id uuid not null references public.ecommerce_published_products(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  source_variant_ref text not null,
  source_product_id text,
  local_product_ref text,
  sku text,
  public_name text,
  option_values jsonb not null default '{}'::jsonb,
  price_mode text not null default 'base',
  price_value numeric(12,2) not null default 0,
  image_url text,
  image_ref text,
  track_stock boolean not null default true,
  stock_mode text not null default 'hidden',
  stock_snapshot numeric(12,3),
  source_available boolean not null default true,
  manual_available boolean not null default true,
  is_available boolean not null default true,
  display_order integer not null default 0,
  source_revision text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_variant_source_ref_required check (btrim(source_variant_ref) <> ''),
  constraint ecommerce_variant_source_required check (
    source_product_id is not null or local_product_ref is not null
  ),
  constraint ecommerce_variant_option_values_object check (
    jsonb_typeof(option_values) = 'object' and option_values <> '{}'::jsonb
  ),
  constraint ecommerce_variant_price_mode_check check (
    price_mode in ('base','delta','absolute')
  ),
  constraint ecommerce_variant_price_nonnegative check (price_value >= 0),
  constraint ecommerce_variant_display_order_check check (display_order >= 0),
  constraint ecommerce_variant_stock_mode_check check (
    stock_mode in ('hidden','status','exact')
  ),
  constraint ecommerce_variant_stock_snapshot_check check (
    stock_snapshot is null or stock_snapshot >= 0
  ),
  constraint ecommerce_variant_sku_normalized check (
    sku is null or sku = upper(btrim(sku))
  ),
  constraint ecommerce_variant_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.ecommerce_published_option_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  published_product_id uuid not null references public.ecommerce_published_products(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  source_group_ref text not null,
  public_name text not null,
  selection_type text not null default 'single',
  required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_option_group_source_ref_required check (btrim(source_group_ref) <> ''),
  constraint ecommerce_option_group_public_name_required check (btrim(public_name) <> ''),
  constraint ecommerce_option_group_selection_type_check check (
    selection_type in ('single','multiple')
  ),
  constraint ecommerce_option_group_min_check check (min_select >= 0),
  constraint ecommerce_option_group_max_check check (max_select >= min_select),
  constraint ecommerce_option_group_single_max_check check (
    selection_type <> 'single' or max_select <= 1
  ),
  constraint ecommerce_option_group_required_min_check check (
    required is false or min_select >= 1
  ),
  constraint ecommerce_option_group_display_order_check check (display_order >= 0),
  constraint ecommerce_option_group_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.ecommerce_published_options (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.ecommerce_published_option_groups(id) on delete cascade,
  published_product_id uuid not null references public.ecommerce_published_products(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  source_option_ref text not null,
  public_name text not null,
  price_delta numeric(12,2) not null default 0,
  source_ingredient_id text,
  ingredient_quantity numeric(14,4),
  ingredient_unit text,
  tracks_inventory boolean not null default false,
  manual_available boolean not null default true,
  source_available boolean not null default true,
  is_available boolean not null default true,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_option_source_ref_required check (btrim(source_option_ref) <> ''),
  constraint ecommerce_option_public_name_required check (btrim(public_name) <> ''),
  constraint ecommerce_option_price_nonnegative check (price_delta >= 0),
  constraint ecommerce_option_inventory_consistency check (
    (
      tracks_inventory is false
      and source_ingredient_id is null
      and ingredient_quantity is null
      and ingredient_unit is null
    )
    or
    (
      tracks_inventory is true
      and source_ingredient_id is not null
      and ingredient_quantity > 0
      and ingredient_unit in ('pza','kg','g','lt','ml')
    )
  ),
  constraint ecommerce_option_display_order_check check (display_order >= 0),
  constraint ecommerce_option_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists uq_ecommerce_variant_active_source
  on public.ecommerce_published_product_variants(published_product_id, source_variant_ref)
  where deleted_at is null;
create unique index if not exists uq_ecommerce_variant_active_source_product
  on public.ecommerce_published_product_variants(published_product_id, source_product_id)
  where deleted_at is null and source_product_id is not null;
create unique index if not exists uq_ecommerce_variant_active_combination
  on public.ecommerce_published_product_variants(
    published_product_id,
    (extensions.digest(option_values::text, 'sha256'))
  )
  where deleted_at is null;
create index if not exists idx_ecommerce_variants_portal_product_order
  on public.ecommerce_published_product_variants(portal_id, published_product_id, display_order)
  where deleted_at is null;
create index if not exists idx_ecommerce_variants_license_source
  on public.ecommerce_published_product_variants(license_id, source_product_id)
  where deleted_at is null and source_product_id is not null;

create unique index if not exists uq_ecommerce_option_group_active_source
  on public.ecommerce_published_option_groups(published_product_id, source_group_ref)
  where deleted_at is null;
create index if not exists idx_ecommerce_option_groups_product_order
  on public.ecommerce_published_option_groups(published_product_id, display_order)
  where deleted_at is null;

create unique index if not exists uq_ecommerce_option_active_source
  on public.ecommerce_published_options(group_id, source_option_ref)
  where deleted_at is null;
create index if not exists idx_ecommerce_options_group_order
  on public.ecommerce_published_options(group_id, display_order)
  where deleted_at is null;
create index if not exists idx_ecommerce_options_license_ingredient
  on public.ecommerce_published_options(license_id, source_ingredient_id)
  where deleted_at is null and source_ingredient_id is not null;

alter table public.ecommerce_published_product_variants enable row level security;
alter table public.ecommerce_published_option_groups enable row level security;
alter table public.ecommerce_published_options enable row level security;

revoke all on table public.ecommerce_published_product_variants from anon, authenticated;
revoke all on table public.ecommerce_published_option_groups from anon, authenticated;
revoke all on table public.ecommerce_published_options from anon, authenticated;
grant all on table public.ecommerce_published_product_variants to service_role;
grant all on table public.ecommerce_published_option_groups to service_role;
grant all on table public.ecommerce_published_options to service_role;

drop policy if exists ecommerce_variants_no_direct_client_select
  on public.ecommerce_published_product_variants;
create policy ecommerce_variants_no_direct_client_select
  on public.ecommerce_published_product_variants for select
  to anon, authenticated using (false);
drop policy if exists ecommerce_variants_no_direct_client_insert
  on public.ecommerce_published_product_variants;
create policy ecommerce_variants_no_direct_client_insert
  on public.ecommerce_published_product_variants for insert
  to anon, authenticated with check (false);
drop policy if exists ecommerce_variants_no_direct_client_update
  on public.ecommerce_published_product_variants;
create policy ecommerce_variants_no_direct_client_update
  on public.ecommerce_published_product_variants for update
  to anon, authenticated using (false) with check (false);
drop policy if exists ecommerce_variants_no_direct_client_delete
  on public.ecommerce_published_product_variants;
create policy ecommerce_variants_no_direct_client_delete
  on public.ecommerce_published_product_variants for delete
  to anon, authenticated using (false);

drop policy if exists ecommerce_option_groups_no_direct_client_select
  on public.ecommerce_published_option_groups;
create policy ecommerce_option_groups_no_direct_client_select
  on public.ecommerce_published_option_groups for select
  to anon, authenticated using (false);
drop policy if exists ecommerce_option_groups_no_direct_client_insert
  on public.ecommerce_published_option_groups;
create policy ecommerce_option_groups_no_direct_client_insert
  on public.ecommerce_published_option_groups for insert
  to anon, authenticated with check (false);
drop policy if exists ecommerce_option_groups_no_direct_client_update
  on public.ecommerce_published_option_groups;
create policy ecommerce_option_groups_no_direct_client_update
  on public.ecommerce_published_option_groups for update
  to anon, authenticated using (false) with check (false);
drop policy if exists ecommerce_option_groups_no_direct_client_delete
  on public.ecommerce_published_option_groups;
create policy ecommerce_option_groups_no_direct_client_delete
  on public.ecommerce_published_option_groups for delete
  to anon, authenticated using (false);

drop policy if exists ecommerce_options_no_direct_client_select
  on public.ecommerce_published_options;
create policy ecommerce_options_no_direct_client_select
  on public.ecommerce_published_options for select
  to anon, authenticated using (false);
drop policy if exists ecommerce_options_no_direct_client_insert
  on public.ecommerce_published_options;
create policy ecommerce_options_no_direct_client_insert
  on public.ecommerce_published_options for insert
  to anon, authenticated with check (false);
drop policy if exists ecommerce_options_no_direct_client_update
  on public.ecommerce_published_options;
create policy ecommerce_options_no_direct_client_update
  on public.ecommerce_published_options for update
  to anon, authenticated using (false) with check (false);
drop policy if exists ecommerce_options_no_direct_client_delete
  on public.ecommerce_published_options;
create policy ecommerce_options_no_direct_client_delete
  on public.ecommerce_published_options for delete
  to anon, authenticated using (false);

create or replace function private.ecommerce_configuration_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent record;
  v_group record;
  v_source_license uuid;
begin
  select p.portal_id, p.license_id
  into v_parent
  from public.ecommerce_published_products p
  where p.id = new.published_product_id
    and p.deleted_at is null;

  if v_parent.portal_id is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;
  if new.portal_id <> v_parent.portal_id or new.license_id <> v_parent.license_id then
    raise exception 'ECOMMERCE_CONFIGURATION_SCOPE_MISMATCH';
  end if;

  if tg_table_name = 'ecommerce_published_product_variants'
     and new.source_product_id is not null then
    select p.license_id into v_source_license
    from public.pos_products p
    where p.id = new.source_product_id and p.deleted_at is null;
    if v_source_license is null then
      raise exception 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND';
    end if;
    if v_source_license <> new.license_id then
      raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE';
    end if;
  end if;

  if tg_table_name = 'ecommerce_published_options' then
    select g.published_product_id, g.portal_id, g.license_id
    into v_group
    from public.ecommerce_published_option_groups g
    where g.id = new.group_id and g.deleted_at is null;
    if v_group.published_product_id is null
       or v_group.published_product_id <> new.published_product_id
       or v_group.portal_id <> new.portal_id
       or v_group.license_id <> new.license_id then
      raise exception 'ECOMMERCE_OPTION_GROUP_SCOPE_MISMATCH';
    end if;

    if new.source_ingredient_id is not null then
      select p.license_id into v_source_license
      from public.pos_products p
      where p.id = new.source_ingredient_id and p.deleted_at is null;
      if v_source_license is null then
        raise exception 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND';
      end if;
      if v_source_license <> new.license_id then
        raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE';
      end if;
    end if;
  end if;

  if tg_table_name in (
    'ecommerce_published_product_variants',
    'ecommerce_published_options'
  ) then
    new.is_available := new.manual_available and new.source_available;
  end if;
  return new;
end;
$function$;

create or replace function private.ecommerce_bump_catalog_revision_on_configuration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_portal_id uuid;
begin
  v_portal_id := coalesce(new.portal_id, old.portal_id);
  update public.ecommerce_portals
  set catalog_revision = catalog_revision + 1
  where id = v_portal_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists trg_ecommerce_variants_guard
  on public.ecommerce_published_product_variants;
create trigger trg_ecommerce_variants_guard
  before insert or update on public.ecommerce_published_product_variants
  for each row execute function private.ecommerce_configuration_child_guard();
drop trigger if exists trg_ecommerce_variants_touch
  on public.ecommerce_published_product_variants;
create trigger trg_ecommerce_variants_touch
  before update on public.ecommerce_published_product_variants
  for each row execute function private.ecommerce_touch_updated_at();
drop trigger if exists trg_ecommerce_variants_catalog_revision
  on public.ecommerce_published_product_variants;
create trigger trg_ecommerce_variants_catalog_revision
  after insert or update or delete on public.ecommerce_published_product_variants
  for each row execute function private.ecommerce_bump_catalog_revision_on_configuration_change();

drop trigger if exists trg_ecommerce_option_groups_guard
  on public.ecommerce_published_option_groups;
create trigger trg_ecommerce_option_groups_guard
  before insert or update on public.ecommerce_published_option_groups
  for each row execute function private.ecommerce_configuration_child_guard();
drop trigger if exists trg_ecommerce_option_groups_touch
  on public.ecommerce_published_option_groups;
create trigger trg_ecommerce_option_groups_touch
  before update on public.ecommerce_published_option_groups
  for each row execute function private.ecommerce_touch_updated_at();
drop trigger if exists trg_ecommerce_option_groups_catalog_revision
  on public.ecommerce_published_option_groups;
create trigger trg_ecommerce_option_groups_catalog_revision
  after insert or update or delete on public.ecommerce_published_option_groups
  for each row execute function private.ecommerce_bump_catalog_revision_on_configuration_change();

drop trigger if exists trg_ecommerce_options_guard
  on public.ecommerce_published_options;
create trigger trg_ecommerce_options_guard
  before insert or update on public.ecommerce_published_options
  for each row execute function private.ecommerce_configuration_child_guard();
drop trigger if exists trg_ecommerce_options_touch
  on public.ecommerce_published_options;
create trigger trg_ecommerce_options_touch
  before update on public.ecommerce_published_options
  for each row execute function private.ecommerce_touch_updated_at();
drop trigger if exists trg_ecommerce_options_catalog_revision
  on public.ecommerce_published_options;
create trigger trg_ecommerce_options_catalog_revision
  after insert or update or delete on public.ecommerce_published_options
  for each row execute function private.ecommerce_bump_catalog_revision_on_configuration_change();

create or replace function private.ecommerce_admin_product_jsonb(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_product.id,
    'sourceType', p_product.source_type,
    'productId', p_product.product_id,
    'localProductRef', p_product.local_product_ref,
    'publicName', p_product.public_name,
    'publicDescription', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isPublished', p_product.is_published,
    'isAvailable', p_product.is_available,
    'manualAvailable', p_product.manual_available,
    'sourceAvailable', p_product.source_available,
    'displayOrder', p_product.display_order,
    'stockMode', p_product.stock_mode,
    'stockSnapshot', p_product.stock_snapshot,
    'syncConfig', p_product.sync_config,
    'syncStatus', p_product.sync_status,
    'syncErrorCode', p_product.sync_error_code,
    'sourceState', p_product.source_state,
    'sourceRevision', p_product.source_revision,
    'lastSyncAttemptAt', p_product.last_sync_attempt_at,
    'lastSyncedAt', p_product.last_synced_at,
    'configurationType', p_product.configuration_type,
    'configurationVersion', p_product.configuration_version,
    'hasRecipe', p_product.has_recipe,
    'hasVariants', p_product.has_variants,
    'hasOptionGroups', p_product.has_option_groups,
    'requiresConfiguration', p_product.requires_configuration,
    'availabilitySource', p_product.availability_source,
    'availabilityReasonCode', p_product.availability_reason_code,
    'limitingSource', jsonb_strip_nulls(jsonb_build_object(
      'productId', p_product.limiting_source_product_id,
      'name', p_product.limiting_source_name
    )),
    'variantCount', (
      select count(*) from public.ecommerce_published_product_variants v
      where v.published_product_id = p_product.id and v.deleted_at is null
    ),
    'optionGroupCount', (
      select count(*) from public.ecommerce_published_option_groups g
      where g.published_product_id = p_product.id and g.deleted_at is null
    ),
    'optionCount', (
      select count(*) from public.ecommerce_published_options o
      where o.published_product_id = p_product.id and o.deleted_at is null
    ),
    'hasManualFields', exists (
      select 1
      from jsonb_each_text(p_product.sync_config) field
      where field.value = 'manual'
    ),
    'metadata', p_product.metadata,
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$function$;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_product.id,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', p_product.is_available,
    'displayOrder', p_product.display_order,
    'configuration', jsonb_build_object(
      'type', p_product.configuration_type,
      'version', p_product.configuration_version,
      'hasVariants', p_product.has_variants,
      'hasOptionGroups', p_product.has_option_groups,
      'requiresConfiguration', p_product.requires_configuration
    ),
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
      when p_product.source_state not in ('in_stock', 'out_of_stock')
        or p_product.stock_snapshot is null then jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status',
        'status', case
          when p_product.source_available is true and p_product.stock_snapshot > 0
            then 'available' else 'out_of_stock' end,
        'quantity', null
      )
      when p_product.stock_mode = 'exact' then jsonb_build_object(
        'mode', 'exact',
        'status', case
          when p_product.source_available is true and p_product.stock_snapshot > 0
            then 'available' else 'out_of_stock' end,
        'quantity', greatest(p_product.stock_snapshot, 0)
      )
      else jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
    end,
    'options', p_product.options
  );
$function$;

create or replace function private.ecommerce_product_public_signature(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_product.id is null
      or p_product.deleted_at is not null
      or p_product.is_published is not true then null
    else private.ecommerce_product_public_jsonb(
      p_product,
      private.ecommerce_license_feature_bool(
        p_product.license_id,
        'ecommerce_stock_visibility',
        false
      )
    )
  end;
$function$;

create or replace function private.ecommerce_normalize_inventory_unit(p_unit text)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select case lower(btrim(coalesce(p_unit,'')))
    when 'pza' then 'pza' when 'pzas' then 'pza'
    when 'pieza' then 'pza' when 'piezas' then 'pza'
    when 'unidad' then 'pza' when 'unidades' then 'pza'
    when 'kg' then 'kg' when 'kgs' then 'kg'
    when 'kilo' then 'kg' when 'kilos' then 'kg'
    when 'kilogramo' then 'kg' when 'kilogramos' then 'kg'
    when 'g' then 'g' when 'gr' then 'g' when 'grs' then 'g'
    when 'gramo' then 'g' when 'gramos' then 'g'
    when 'l' then 'lt' when 'lt' then 'lt' when 'lts' then 'lt'
    when 'litro' then 'lt' when 'litros' then 'lt'
    when 'ml' then 'ml' when 'mililitro' then 'ml' when 'mililitros' then 'ml'
    else null
  end;
$function$;

create or replace function private.ecommerce_inventory_unit_family(p_unit text)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select case private.ecommerce_normalize_inventory_unit(p_unit)
    when 'pza' then 'count'
    when 'kg' then 'mass'
    when 'g' then 'mass'
    when 'lt' then 'volume'
    when 'ml' then 'volume'
    else null
  end;
$function$;

create or replace function private.ecommerce_convert_inventory_quantity(
  p_quantity numeric,
  p_from_unit text,
  p_to_unit text
)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_from text := private.ecommerce_normalize_inventory_unit(p_from_unit);
  v_to text := private.ecommerce_normalize_inventory_unit(p_to_unit);
  v_base numeric;
begin
  if p_quantity is null or v_from is null or v_to is null
     or private.ecommerce_inventory_unit_family(v_from)
        is distinct from private.ecommerce_inventory_unit_family(v_to) then
    return null;
  end if;
  v_base := case v_from
    when 'kg' then p_quantity * 1000
    when 'lt' then p_quantity * 1000
    else p_quantity
  end;
  return case v_to
    when 'kg' then v_base / 1000
    when 'lt' then v_base / 1000
    else v_base
  end;
end;
$function$;

create or replace function private.ecommerce_recipe_capacity(
  p_license_id uuid,
  p_recipe jsonb,
  p_evaluation_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_component jsonb;
  v_ingredient public.pos_products%rowtype;
  v_ingredient_id text;
  v_ingredient_name text;
  v_quantity numeric;
  v_recipe_unit text;
  v_inventory_unit text;
  v_inventory_available numeric;
  v_available_in_recipe_unit numeric;
  v_capacity bigint;
  v_min_capacity bigint;
  v_limiting_id text;
  v_limiting_name text;
  v_components jsonb := '[]'::jsonb;
  v_diagnostics text[] := '{}'::text[];
  v_has_tracked boolean := false;
  v_has_unverified boolean := false;
  v_has_zero boolean := false;
  v_zero_id text;
  v_zero_name text;
begin
  if jsonb_typeof(p_recipe) <> 'array' or jsonb_array_length(p_recipe) = 0 then
    return jsonb_build_object(
      'verified', false, 'status', 'not_recipe', 'availableStock', null,
      'reasonCode', 'RECIPE_EMPTY', 'components', '[]'::jsonb
    );
  end if;

  for v_component in select value from jsonb_array_elements(p_recipe)
  loop
    v_ingredient_id := nullif(btrim(coalesce(
      v_component->>'ingredientId',
      v_component->>'ingredient_id',
      v_component->>'productId'
    )), '');
    v_quantity := nullif(coalesce(
      v_component->>'quantity',
      v_component->>'ingredientQuantity',
      v_component->>'ingredient_quantity'
    ), '')::numeric;

    if v_ingredient_id is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_MISSING');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', null, 'verified', false,
        'reasonCode', 'RECIPE_INGREDIENT_MISSING'
      ));
      continue;
    end if;
    if v_quantity is null or v_quantity <= 0 then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_QUANTITY_INVALID');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'verified', false,
        'reasonCode', 'RECIPE_QUANTITY_INVALID'
      ));
      continue;
    end if;

    select p.* into v_ingredient
    from public.pos_products p
    where p.id = v_ingredient_id
      and p.license_id = p_license_id
      and p.deleted_at is null
    limit 1;

    if v_ingredient.id is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_MISSING');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'verified', false,
        'reasonCode', 'RECIPE_INGREDIENT_MISSING'
      ));
      continue;
    end if;

    v_ingredient_name := v_ingredient.name;
    if v_ingredient.is_active is not true then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_INACTIVE');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_INGREDIENT_INACTIVE'
      ));
      continue;
    end if;

    if v_ingredient.track_stock is false then
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', true, 'tracked', false, 'capacity', null,
        'reasonCode', 'RECIPE_INGREDIENT_UNTRACKED'
      ));
      continue;
    end if;
    v_has_tracked := true;

    v_inventory_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      v_ingredient.bulk_data #>> '{purchase,unit}',
      v_ingredient.bulk_data->>'unit',
      v_ingredient.metadata->>'unit',
      'pza'
    ));
    v_recipe_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      v_component->>'unit',
      v_component->>'ingredientUnit',
      v_component->>'ingredient_unit',
      v_inventory_unit
    ));
    if v_inventory_unit is null or v_recipe_unit is null
       or private.ecommerce_inventory_unit_family(v_inventory_unit)
          is distinct from private.ecommerce_inventory_unit_family(v_recipe_unit) then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_UNIT_INCOMPATIBLE');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_UNIT_INCOMPATIBLE'
      ));
      continue;
    end if;

    if coalesce((v_ingredient.batch_management->>'enabled')::boolean, false) then
      select coalesce(sum(greatest(b.stock - b.committed_stock, 0)),0)
      into v_inventory_available
      from public.pos_product_batches b
      where b.license_id = p_license_id
        and b.product_id = v_ingredient_id
        and b.deleted_at is null
        and b.is_active is true
        and lower(coalesce(b.status,'active')) not in (
          'inactive','blocked','quarantined','deleted','removed','archived'
        )
        and (b.expiry_date is null or b.expiry_date::date >= p_evaluation_date);
    else
      v_inventory_available := greatest(
        v_ingredient.stock - v_ingredient.committed_stock,
        0
      );
    end if;

    if v_inventory_available is null or v_inventory_available < 0 then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_STOCK_INVALID');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_STOCK_INVALID'
      ));
      continue;
    end if;

    v_available_in_recipe_unit := private.ecommerce_convert_inventory_quantity(
      v_inventory_available, v_inventory_unit, v_recipe_unit
    );
    if v_available_in_recipe_unit is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_UNIT_INCOMPATIBLE');
      continue;
    end if;

    v_capacity := greatest(floor(v_available_in_recipe_unit / v_quantity),0)::bigint;
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'ingredientId', v_ingredient_id,
      'ingredientName', v_ingredient_name,
      'verified', true,
      'tracked', true,
      'inventoryUnit', v_inventory_unit,
      'recipeUnit', v_recipe_unit,
      'requiredPerUnit', v_quantity,
      'availableInventory', v_inventory_available,
      'capacity', v_capacity,
      'reasonCode', 'RECIPE_COMPONENT_CALCULATED'
    ));
    if v_capacity = 0 and not v_has_zero then
      v_has_zero := true;
      v_zero_id := v_ingredient_id;
      v_zero_name := v_ingredient_name;
    end if;
    if v_min_capacity is null or v_capacity < v_min_capacity then
      v_min_capacity := v_capacity;
      v_limiting_id := v_ingredient_id;
      v_limiting_name := v_ingredient_name;
    end if;
  end loop;

  if not v_has_tracked and not v_has_unverified then
    return jsonb_build_object(
      'verified', true, 'status', 'not_tracked', 'availableStock', null,
      'reasonCode', 'RECIPE_ALL_INGREDIENTS_UNTRACKED',
      'components', v_components
    );
  end if;
  if v_has_zero then
    return jsonb_build_object(
      'verified', true, 'status', 'out_of_stock', 'availableStock', 0,
      'limitingIngredientId', v_zero_id,
      'limitingIngredientName', v_zero_name,
      'reasonCode', 'RECIPE_CAPACITY_ZERO',
      'components', v_components,
      'diagnostics', to_jsonb(v_diagnostics)
    );
  end if;
  if v_has_unverified then
    return jsonb_build_object(
      'verified', false, 'status', 'unverified', 'availableStock', null,
      'reasonCode', coalesce(v_diagnostics[1], 'RECIPE_UNVERIFIED'),
      'components', v_components,
      'diagnostics', to_jsonb(v_diagnostics)
    );
  end if;
  return jsonb_build_object(
    'verified', true,
    'status', case when coalesce(v_min_capacity,0) > 0 then 'in_stock' else 'out_of_stock' end,
    'availableStock', greatest(coalesce(v_min_capacity,0),0),
    'limitingIngredientId', v_limiting_id,
    'limitingIngredientName', v_limiting_name,
    'reasonCode', 'RECIPE_CAPACITY_CALCULATED',
    'components', v_components
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object(
      'verified', false, 'status', 'unverified', 'availableStock', null,
      'reasonCode', 'RECIPE_QUANTITY_INVALID', 'components', v_components
    );
end;
$function$;

revoke all on function private.ecommerce_recipe_capacity(uuid,jsonb,date) from public;
revoke all on function private.ecommerce_normalize_inventory_unit(text) from public;
revoke all on function private.ecommerce_inventory_unit_family(text) from public;
revoke all on function private.ecommerce_convert_inventory_quantity(numeric,text,text) from public;

create or replace function private.ecommerce_jsonb_depth(p_value jsonb)
returns integer
language sql
immutable
security definer
set search_path = ''
as $function$
  with recursive walk(value, depth) as (
    select p_value, 1
    union all
    select child.value, walk.depth + 1
    from walk
    cross join lateral (
      select value from jsonb_array_elements(
        case when jsonb_typeof(walk.value) = 'array' then walk.value else '[]'::jsonb end
      )
      union all
      select value from jsonb_each(
        case when jsonb_typeof(walk.value) = 'object' then walk.value else '{}'::jsonb end
      )
    ) child
  )
  select coalesce(max(depth), 0) from walk;
$function$;

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
  v_license_id uuid;
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
  v_option_refs text[] := '{}'::text[];
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
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_sync_product_configuration'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  if p_configuration is null
     or jsonb_typeof(p_configuration) <> 'object'
     or pg_column_size(p_configuration) > 524288
     or private.ecommerce_jsonb_depth(p_configuration) > 6 then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_INVALID',
      'La configuracion del producto no es valida.'
    );
  end if;

  if (p_configuration - array[
    'type','version','hasRecipe','variants','optionGroups',
    'availabilitySource','availabilityReasonCode','limitingSource'
  ]) <> '{}'::jsonb then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_INVALID',
      'La configuracion contiene campos no permitidos.'
    );
  end if;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = v_license_id
    and p.deleted_at is null
  for update;
  if v_product.id is null then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;

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
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_INVALID',
      'La configuracion excede los limites permitidos.'
    );
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(g->'options','[]'::jsonb))),0)::integer
  into v_total_options
  from jsonb_array_elements(v_groups) g;
  if v_total_options > 100 then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED',
      'La configuracion supera 100 opciones.'
    );
  end if;

  v_requires_configuration := v_has_variants;
  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    if jsonb_typeof(v_group) <> 'object' then
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
    return private.ecommerce_admin_error('ECOMMERCE_CONFIGURATION_INVALID');
  end if;
  v_reason := nullif(btrim(p_configuration->>'availabilityReasonCode'),'');
  v_limiting := coalesce(p_configuration->'limitingSource','{}'::jsonb);

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
    v_option_values := coalesce(v_variant->'optionValues','{}'::jsonb);
    v_source_product_id := nullif(btrim(v_variant->>'sourceProductId'),'');
    v_variant_ref := coalesce(
      nullif(btrim(v_variant->>'sourceVariantRef'),''),
      v_source_product_id,
      nullif(btrim(v_variant->>'sku'),''),
      encode(extensions.digest(v_option_values::text,'sha256'),'hex')
    );
    if v_option_values = '{}'::jsonb or jsonb_typeof(v_option_values) <> 'object' then
      raise exception 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED';
    end if;
    if exists (
      select 1 from jsonb_each_text(v_option_values)
      where length(key) > 50 or length(value) > 50 or btrim(key) = '' or btrim(value) = ''
    ) then
      raise exception 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID';
    end if;

    insert into public.ecommerce_published_product_variants(
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
      coalesce(v_variant->'metadata','{}'::jsonb),
      null
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
      deleted_at = null;
    v_variant_refs := array_append(v_variant_refs, v_variant_ref);
  end loop;

  update public.ecommerce_published_product_variants
  set deleted_at = now(), is_available = false
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_variant_ref = any(v_variant_refs));

  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    v_group_ref := coalesce(
      nullif(btrim(v_group->>'sourceGroupRef'),''),
      encode(extensions.digest(coalesce(v_group->>'publicName','')::text,'sha256'),'hex')
    );
    v_selection_type := coalesce(nullif(v_group->>'selectionType',''),'single');
    v_required := coalesce((v_group->>'required')::boolean,false);
    v_min := coalesce(nullif(v_group->>'minSelect','')::integer,case when v_required then 1 else 0 end);
    v_max := coalesce(nullif(v_group->>'maxSelect','')::integer,case when v_selection_type='single' then 1 else greatest(v_min,1) end);
    if v_selection_type not in ('single','multiple')
       or v_min < 0 or v_max < v_min
       or (v_selection_type='single' and v_max > 1)
       or (v_required and v_min < 1) then
      raise exception 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID';
    end if;

    insert into public.ecommerce_published_option_groups(
      published_product_id, portal_id, license_id, source_group_ref,
      public_name, selection_type, required, min_select, max_select,
      display_order, metadata, deleted_at
    ) values (
      v_product.id, v_product.portal_id, v_product.license_id, v_group_ref,
      coalesce(nullif(btrim(v_group->>'publicName'),''),'Opciones'),
      v_selection_type, v_required, v_min, v_max,
      greatest(coalesce(nullif(v_group->>'displayOrder','')::integer,0),0),
      coalesce(v_group->'metadata','{}'::jsonb), null
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
    returning id into v_group_id;

    v_group_refs := array_append(v_group_refs, v_group_ref);
    v_option_refs := '{}'::text[];

    for v_option in
      select value from jsonb_array_elements(coalesce(v_group->'options','[]'::jsonb))
    loop
      v_option_ref := coalesce(
        nullif(btrim(v_option->>'sourceOptionRef'),''),
        encode(extensions.digest(coalesce(v_option->>'publicName','')::text,'sha256'),'hex')
      );
      insert into public.ecommerce_published_options(
        group_id, published_product_id, portal_id, license_id, source_option_ref,
        public_name, price_delta, source_ingredient_id, ingredient_quantity,
        ingredient_unit, tracks_inventory, manual_available, source_available,
        display_order, metadata, deleted_at
      ) values (
        v_group_id, v_product.id, v_product.portal_id, v_product.license_id, v_option_ref,
        coalesce(nullif(btrim(v_option->>'publicName'),''),'Opcion'),
        coalesce(nullif(v_option->>'priceDelta','')::numeric,0),
        case when coalesce((v_option->>'tracksInventory')::boolean,false)
          then nullif(btrim(v_option->>'sourceIngredientId'),'') else null end,
        case when coalesce((v_option->>'tracksInventory')::boolean,false)
          then nullif(v_option->>'ingredientQuantity','')::numeric else null end,
        case when coalesce((v_option->>'tracksInventory')::boolean,false)
          then nullif(btrim(v_option->>'ingredientUnit'),'') else null end,
        coalesce((v_option->>'tracksInventory')::boolean,false),
        coalesce((v_option->>'manualAvailable')::boolean,true),
        coalesce((v_option->>'sourceAvailable')::boolean,true),
        greatest(coalesce(nullif(v_option->>'displayOrder','')::integer,0),0),
        coalesce(v_option->'metadata','{}'::jsonb), null
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
        deleted_at = null;
      v_option_refs := array_append(v_option_refs, v_option_ref);
    end loop;

    update public.ecommerce_published_options
    set deleted_at = now(), is_available = false
    where group_id = v_group_id
      and deleted_at is null
      and not (source_option_ref = any(v_option_refs));
  end loop;

  update public.ecommerce_published_option_groups
  set deleted_at = now()
  where published_product_id = v_product.id
    and deleted_at is null
    and not (source_group_ref = any(v_group_refs));

  update public.ecommerce_published_options o
  set deleted_at = now(), is_available = false
  where o.published_product_id = v_product.id
    and o.deleted_at is null
    and not exists (
      select 1 from public.ecommerce_published_option_groups g
      where g.id = o.group_id and g.deleted_at is null
    );

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
      source_available = case
        when v_requires_configuration then false else p.source_available end,
      is_available = case
        when v_requires_configuration then false
        else p.manual_available and p.source_available end,
      source_revision = coalesce(nullif(btrim(p_source_revision),''),p.source_revision)
  where p.id = v_product.id
  returning * into v_product;

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
  when check_violation or foreign_key_violation or unique_violation then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CONFIGURATION_INVALID',
      'La configuracion contiene referencias o valores invalidos.'
    );
  when others then
    return private.ecommerce_admin_error(
      case
        when sqlerrm like 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE%'
          then 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'
        else 'ECOMMERCE_CONFIGURATION_SYNC_FAILED'
      end,
      'No se pudo sincronizar la configuracion del producto.'
    );
end;
$function$;

revoke all on function public.ecommerce_admin_sync_product_configuration(
  text,text,text,text,uuid,jsonb,text
) from public;
grant execute on function public.ecommerce_admin_sync_product_configuration(
  text,text,text,text,uuid,jsonb,text
) to anon, authenticated, service_role;

comment on function public.ecommerce_admin_sync_product_configuration(
  text,text,text,text,uuid,jsonb,text
) is
  'ECOM.PRODUCTS.MODEL.1 atomic, tenant-scoped configuration sync. Does not create orders or mutate POS inventory.';

comment on table public.ecommerce_published_product_variants is
  'Concrete sellable SKU combinations. Inventory remains authoritative in public.pos_products.';
comment on table public.ecommerce_published_option_groups is
  'Normalized public option/modifier groups prepared for ECOM.PRODUCTS.PUBLIC.1.';
comment on table public.ecommerce_published_options is
  'Normalized options, price deltas and optional ingredient consumption. Not exposed directly to public clients.';
