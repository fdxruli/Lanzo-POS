-- FASE 2 — Productos/catalogo cloud para Lanzo POS
-- Objetivo: catalogo PRO en Supabase como fuente oficial, Dexie como cache/outbox.

create table if not exists public.pos_categories (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  name text not null,
  name_key text not null,
  color text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1 check (server_version >= 1),
  created_by_device_id uuid null references public.license_devices(id),
  updated_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  updated_by_staff_user_id uuid null references public.license_staff_users(id),
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.pos_products (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  category_id text null references public.pos_categories(id) on delete set null,
  name text not null,
  name_key text not null,
  description text null,
  barcode text null,
  barcode_key text null,
  sku text null,
  sku_key text null,
  image_ref text null,
  image_url text null,
  location text null,
  price numeric not null default 0 check (price >= 0),
  cost numeric not null default 0 check (cost >= 0),
  stock numeric not null default 0 check (stock >= 0),
  committed_stock numeric not null default 0 check (committed_stock >= 0),
  min_stock numeric null,
  max_stock numeric null,
  track_stock boolean not null default true,
  is_active boolean not null default true,
  product_type text not null default 'sellable' check (product_type in ('sellable', 'ingredient')),
  sale_type text not null default 'unit' check (sale_type in ('unit', 'bulk')),
  bulk_data jsonb null,
  conversion_factor jsonb null,
  batch_management jsonb null,
  recipe jsonb null,
  modifiers jsonb null,
  wholesale_tiers jsonb null,
  prescription_type text null,
  active_substance text null,
  laboratory text null,
  requires_prescription boolean null,
  presentation text null,
  expiration_mode text not null default 'NONE' check (expiration_mode in ('STRICT', 'SHELF_LIFE', 'NONE')),
  shelf_life_value numeric null,
  shelf_life_unit text null,
  search_tokens text[] null,
  search_ngrams text[] null,
  low_stock_alert_status text null,
  active_stock_status integer not null default 0 check (active_stock_status in (0, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1 check (server_version >= 1),
  created_by_device_id uuid null references public.license_devices(id),
  updated_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  updated_by_staff_user_id uuid null references public.license_staff_users(id),
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.pos_product_batches (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  product_id text not null references public.pos_products(id) on delete cascade,
  sku text null,
  sku_key text null,
  stock numeric not null default 0 check (stock >= 0),
  committed_stock numeric not null default 0 check (committed_stock >= 0),
  cost numeric not null default 0 check (cost >= 0),
  price numeric not null default 0 check (price >= 0),
  track_stock boolean not null default true,
  is_active boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  active_stock_status integer not null default 0 check (active_stock_status in (0, 1)),
  expiry_date timestamptz null,
  alert_target_date timestamptz null,
  alert_type text null,
  manufacturer_batch_id text null,
  supplier text null,
  attributes jsonb null,
  location text null,
  notes text null,
  update_global_price boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1 check (server_version >= 1),
  created_by_device_id uuid null references public.license_devices(id),
  updated_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  updated_by_staff_user_id uuid null references public.license_staff_users(id),
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists pos_categories_license_name_key_active_uidx
  on public.pos_categories (license_id, name_key)
  where deleted_at is null;

create index if not exists pos_categories_license_updated_idx on public.pos_categories (license_id, updated_at);
create index if not exists pos_categories_license_active_idx on public.pos_categories (license_id, is_active);

create index if not exists pos_products_license_updated_idx on public.pos_products (license_id, updated_at);
create index if not exists pos_products_license_category_idx on public.pos_products (license_id, category_id);
create index if not exists pos_products_license_active_idx on public.pos_products (license_id, is_active);
create index if not exists pos_products_license_type_idx on public.pos_products (license_id, product_type);
create index if not exists pos_products_license_active_stock_idx on public.pos_products (license_id, active_stock_status);
create index if not exists pos_products_license_low_stock_idx on public.pos_products (license_id, low_stock_alert_status);
create index if not exists pos_products_license_barcode_idx on public.pos_products (license_id, barcode_key);
create index if not exists pos_products_license_sku_idx on public.pos_products (license_id, sku_key);
create index if not exists pos_products_license_name_key_idx on public.pos_products (license_id, name_key);
create unique index if not exists pos_products_license_barcode_active_uidx
  on public.pos_products (license_id, barcode_key)
  where barcode_key is not null and barcode_key <> '' and deleted_at is null;
create unique index if not exists pos_products_license_sku_active_uidx
  on public.pos_products (license_id, sku_key)
  where sku_key is not null and sku_key <> '' and deleted_at is null;

create index if not exists pos_product_batches_license_product_idx on public.pos_product_batches (license_id, product_id);
create index if not exists pos_product_batches_license_updated_idx on public.pos_product_batches (license_id, updated_at);
create index if not exists pos_product_batches_license_active_stock_idx on public.pos_product_batches (license_id, active_stock_status);
create index if not exists pos_product_batches_license_status_idx on public.pos_product_batches (license_id, status);
create index if not exists pos_product_batches_license_product_status_idx on public.pos_product_batches (license_id, product_id, status);
create index if not exists pos_product_batches_license_product_active_stock_idx on public.pos_product_batches (license_id, product_id, active_stock_status);
create index if not exists pos_product_batches_license_active_alert_idx on public.pos_product_batches (license_id, active_stock_status, alert_target_date);
create index if not exists pos_product_batches_license_manufacturer_batch_idx on public.pos_product_batches (license_id, manufacturer_batch_id);
create index if not exists pos_product_batches_license_sku_idx on public.pos_product_batches (license_id, sku_key);

alter table public.pos_categories enable row level security;
alter table public.pos_products enable row level security;
alter table public.pos_product_batches enable row level security;

revoke all on public.pos_categories from anon, authenticated;
revoke all on public.pos_products from anon, authenticated;
revoke all on public.pos_product_batches from anon, authenticated;

create or replace function private.normalize_pos_product_name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g'), '');
$$;

create or replace function private.normalize_pos_barcode_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p_value, '')), '\s+', '', 'g'), '');
$$;

create or replace function private.normalize_pos_sku_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', '', 'g'), '');
$$;

create or replace function private.has_pos_permission(p_context jsonb, p_permission text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return true;
  end if;

  return coalesce((p_context->'staff_permissions'->>p_permission)::boolean, false) is true;
end;
$$;

create or replace function private.assert_cloud_products_sync_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_products_sync')::boolean, false) is not true then
    raise exception 'CLOUD_PRODUCTS_SYNC_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.assert_pos_products_read_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.has_pos_permission(p_context, 'products')
     or private.has_pos_permission(p_context, 'pos')
     or private.has_pos_permission(p_context, 'inventory') then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:products.read' using errcode = 'P0001';
end;
$$;

create or replace function private.assert_pos_products_write_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.has_pos_permission(p_context, 'products') then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:products.write' using errcode = 'P0001';
end;
$$;

create or replace function private.pos_category_to_jsonb(p_row public.pos_categories)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'name', p_row.name,
    'name_key', p_row.name_key,
    'color', p_row.color,
    'sort_order', p_row.sort_order,
    'is_active', p_row.is_active,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$$;

create or replace function private.pos_product_to_jsonb(p_row public.pos_products)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'category_id', p_row.category_id,
    'name', p_row.name,
    'name_key', p_row.name_key,
    'description', p_row.description,
    'barcode', p_row.barcode,
    'barcode_key', p_row.barcode_key,
    'sku', p_row.sku,
    'sku_key', p_row.sku_key,
    'image_ref', p_row.image_ref,
    'image_url', p_row.image_url,
    'location', p_row.location,
    'price', p_row.price,
    'cost', p_row.cost,
    'stock', p_row.stock,
    'committed_stock', p_row.committed_stock,
    'min_stock', p_row.min_stock,
    'max_stock', p_row.max_stock,
    'track_stock', p_row.track_stock,
    'is_active', p_row.is_active,
    'product_type', p_row.product_type,
    'sale_type', p_row.sale_type,
    'bulk_data', p_row.bulk_data,
    'conversion_factor', p_row.conversion_factor,
    'batch_management', p_row.batch_management,
    'recipe', p_row.recipe,
    'modifiers', p_row.modifiers,
    'wholesale_tiers', p_row.wholesale_tiers,
    'prescription_type', p_row.prescription_type,
    'active_substance', p_row.active_substance,
    'laboratory', p_row.laboratory,
    'requires_prescription', p_row.requires_prescription,
    'presentation', p_row.presentation,
    'expiration_mode', p_row.expiration_mode,
    'shelf_life_value', p_row.shelf_life_value,
    'shelf_life_unit', p_row.shelf_life_unit,
    'search_tokens', p_row.search_tokens,
    'search_ngrams', p_row.search_ngrams,
    'low_stock_alert_status', p_row.low_stock_alert_status,
    'active_stock_status', p_row.active_stock_status,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$$;

create or replace function private.pos_product_batch_to_jsonb(p_row public.pos_product_batches)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'product_id', p_row.product_id,
    'sku', p_row.sku,
    'sku_key', p_row.sku_key,
    'stock', p_row.stock,
    'committed_stock', p_row.committed_stock,
    'cost', p_row.cost,
    'price', p_row.price,
    'track_stock', p_row.track_stock,
    'is_active', p_row.is_active,
    'status', p_row.status,
    'active_stock_status', p_row.active_stock_status,
    'expiry_date', p_row.expiry_date,
    'alert_target_date', p_row.alert_target_date,
    'alert_type', p_row.alert_type,
    'manufacturer_batch_id', p_row.manufacturer_batch_id,
    'supplier', p_row.supplier,
    'attributes', p_row.attributes,
    'location', p_row.location,
    'notes', p_row.notes,
    'update_global_price', p_row.update_global_price,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$$;

create or replace function private.recalculate_pos_product_projection(p_license_id uuid, p_product_id text)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.pos_products;
  v_total_stock numeric := 0;
  v_total_committed numeric := 0;
  v_total_value numeric := 0;
  v_has_variants boolean := false;
  v_new_cost numeric;
begin
  select * into v_product
  from public.pos_products
  where license_id = p_license_id
    and id = p_product_id
  for update;

  if v_product.id is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    coalesce(sum(case when b.is_active and b.status = 'active' and b.deleted_at is null then b.stock else 0 end), 0),
    coalesce(sum(case when b.deleted_at is null then b.committed_stock else 0 end), 0),
    coalesce(sum(case when b.is_active and b.status = 'active' and b.deleted_at is null then b.stock * b.cost else 0 end), 0),
    coalesce(bool_or(b.attributes is not null and b.attributes <> '{}'::jsonb and b.deleted_at is null), false)
  into v_total_stock, v_total_committed, v_total_value, v_has_variants
  from public.pos_product_batches b
  where b.license_id = p_license_id
    and b.product_id = p_product_id;

  v_new_cost := case
    when v_has_variants then v_product.cost
    when v_total_stock > 0 then round((v_total_value / v_total_stock)::numeric, 4)
    else v_product.cost
  end;

  update public.pos_products
  set stock = greatest(v_total_stock, 0),
      committed_stock = greatest(v_total_committed, 0),
      cost = greatest(coalesce(v_new_cost, cost), 0),
      active_stock_status = case when is_active and v_total_stock > 0 and deleted_at is null then 1 else 0 end,
      updated_at = now(),
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('projection_recalculated_at', now())
  where license_id = p_license_id
    and id = p_product_id
  returning * into v_product;

  return v_product;
end;
$$;

create or replace function public.pos_upsert_category(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_category jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_category_id text;
  v_name text;
  v_name_key text;
  v_existing public.pos_categories;
  v_saved public.pos_categories;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_category_id := nullif(btrim(coalesce(p_category->>'id', '')), '');
  if v_category_id is null then
    raise exception 'CATEGORY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_category->>'name', '')), '');
  if v_name is null then
    raise exception 'CATEGORY_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'category.upsert', 'category', v_category_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_categories where license_id = v_license_id and id = v_category_id for update;
  v_is_create := v_existing.id is null;

  if not v_is_create then
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
      values (v_license_id, 'category', v_category_id, 'VERSION_CONFLICT', p_category, private.pos_category_to_jsonb(v_existing), v_device_id, v_staff_user_id);
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La categoria fue modificada en otro dispositivo.', 'category', private.pos_category_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if exists (
    select 1 from public.pos_categories c
    where c.license_id = v_license_id
      and c.name_key = v_name_key
      and c.deleted_at is null
      and c.id <> v_category_id
  ) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_CATEGORY_NAME', 'message', 'Ya existe una categoria activa con este nombre.', 'field', 'name', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_categories (
      id, license_id, name, name_key, color, sort_order, is_active,
      created_at, updated_at, server_version,
      created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id,
      last_idempotency_key, metadata
    ) values (
      v_category_id, v_license_id, v_name, v_name_key,
      nullif(btrim(coalesce(p_category->>'color', '')), ''),
      coalesce(nullif(p_category->>'sort_order', '')::integer, nullif(p_category->>'sortOrder', '')::integer, 0),
      coalesce(nullif(p_category->>'is_active', '')::boolean, nullif(p_category->>'isActive', '')::boolean, true),
      coalesce(nullif(p_category->>'created_at', '')::timestamptz, nullif(p_category->>'createdAt', '')::timestamptz, now()),
      now(), 1,
      v_device_id, v_device_id,
      v_staff_user_id, v_staff_user_id,
      p_idempotency_key,
      coalesce(p_category->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    ) returning * into v_saved;
  else
    update public.pos_categories
    set name = v_name,
        name_key = v_name_key,
        color = nullif(btrim(coalesce(p_category->>'color', color, '')), ''),
        sort_order = coalesce(nullif(p_category->>'sort_order', '')::integer, nullif(p_category->>'sortOrder', '')::integer, sort_order),
        is_active = coalesce(nullif(p_category->>'is_active', '')::boolean, nullif(p_category->>'isActive', '')::boolean, is_active),
        deleted_at = null,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_category->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    where license_id = v_license_id and id = v_category_id
    returning * into v_saved;
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'category', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_category'), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'category', private.pos_category_to_jsonb(v_saved), 'event', to_jsonb(v_event), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_CATEGORY_NAME', 'message', 'Ya existe una categoria activa con este nombre.', 'field', 'name', 'idempotency_key', p_idempotency_key);
    if v_license_id is not null and p_idempotency_key is not null then
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    end if;
    return v_response;
end;
$$;

create or replace function public.pos_delete_category(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_category_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_categories;
  v_saved public.pos_categories;
  v_product public.pos_products;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_affected integer := 0;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_category_id, '')), '') is null then
    raise exception 'CATEGORY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'category.delete', 'category', p_category_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_categories where license_id = v_license_id and id = p_category_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'CATEGORY_NOT_FOUND', 'message', 'La categoria no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'category', p_category_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_category_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La categoria fue modificada en otro dispositivo.', 'category', private.pos_category_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_categories
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_by_phase', 'fase2_products_catalog')
  where license_id = v_license_id and id = p_category_id
  returning * into v_saved;

  for v_product in
    update public.pos_products
    set category_id = null,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('category_deleted_id', p_category_id)
    where license_id = v_license_id
      and category_id = p_category_id
      and deleted_at is null
    returning *
  loop
    v_affected := v_affected + 1;
    v_event := private.record_pos_sync_event(v_license_id, 'product', v_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_category', 'cascade', 'category_null'), v_product.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
  end loop;

  v_event := private.record_pos_sync_event(v_license_id, 'category', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_category', 'affected_products', v_affected), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'category', private.pos_category_to_jsonb(v_saved), 'affected_products', v_affected, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_upsert_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product jsonb default '{}'::jsonb,
  p_initial_batches jsonb default '[]'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product_id text;
  v_category_id text;
  v_name text;
  v_name_key text;
  v_barcode text;
  v_barcode_key text;
  v_sku text;
  v_sku_key text;
  v_product_type text;
  v_sale_type text;
  v_expiration_mode text;
  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_committed_stock numeric;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_saved_batch public.pos_product_batches;
  v_batch_item jsonb;
  v_batch_id text;
  v_batch_sku text;
  v_batch_sku_key text;
  v_batch_stock numeric;
  v_batch_cost numeric;
  v_batch_price numeric;
  v_batch_status text;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
  v_has_initial_batches boolean := false;
  v_search_tokens text[];
  v_search_ngrams text[];
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if coalesce(jsonb_typeof(p_initial_batches), 'array') <> 'array' then
    raise exception 'INITIAL_BATCHES_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;
  v_has_initial_batches := jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0;

  v_product_id := nullif(btrim(coalesce(p_product->>'id', '')), '');
  if v_product_id is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  v_name := nullif(btrim(coalesce(p_product->>'name', '')), '');
  if v_name is null then raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);

  v_category_id := nullif(btrim(coalesce(p_product->>'category_id', p_product->>'categoryId', '')), '');
  if v_category_id is not null and not exists (
    select 1 from public.pos_categories c where c.license_id = v_license_id and c.id = v_category_id and c.deleted_at is null
  ) then
    v_category_id := null;
  end if;

  v_barcode := nullif(btrim(coalesce(p_product->>'barcode', '')), '');
  v_barcode_key := private.normalize_pos_barcode_key(coalesce(p_product->>'barcode_key', p_product->>'barcodeKey', v_barcode));
  v_sku := nullif(btrim(coalesce(p_product->>'sku', '')), '');
  v_sku_key := private.normalize_pos_sku_key(coalesce(p_product->>'sku_key', p_product->>'skuKey', v_sku));
  v_product_type := lower(coalesce(nullif(p_product->>'product_type', ''), nullif(p_product->>'productType', ''), 'sellable'));
  v_sale_type := lower(coalesce(nullif(p_product->>'sale_type', ''), nullif(p_product->>'saleType', ''), 'unit'));
  v_expiration_mode := upper(coalesce(nullif(p_product->>'expiration_mode', ''), nullif(p_product->>'expirationMode', ''), 'NONE'));
  if v_product_type not in ('sellable','ingredient') then raise exception 'INVALID_PRODUCT_TYPE' using errcode = 'P0001'; end if;
  if v_sale_type not in ('unit','bulk') then raise exception 'INVALID_SALE_TYPE' using errcode = 'P0001'; end if;
  if v_expiration_mode not in ('STRICT','SHELF_LIFE','NONE') then raise exception 'INVALID_EXPIRATION_MODE' using errcode = 'P0001'; end if;

  v_price := greatest(coalesce(nullif(p_product->>'price', '')::numeric, 0), 0);
  v_cost := greatest(coalesce(nullif(p_product->>'cost', '')::numeric, 0), 0);
  v_stock := greatest(coalesce(nullif(p_product->>'stock', '')::numeric, 0), 0);
  v_committed_stock := greatest(coalesce(nullif(p_product->>'committed_stock', '')::numeric, nullif(p_product->>'committedStock', '')::numeric, 0), 0);

  if jsonb_typeof(p_product->'search_tokens') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_tokens')) into v_search_tokens;
  else
    v_search_tokens := null;
  end if;
  if jsonb_typeof(p_product->'search_ngrams') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_ngrams')) into v_search_ngrams;
  else
    v_search_ngrams := null;
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.upsert', 'product', v_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = v_product_id for update;
  v_is_create := v_existing.id is null;

  if not v_is_create then
    if v_existing.deleted_at is not null then
      v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_DELETED', 'message', 'El producto ya fue eliminado.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
      values (v_license_id, 'product', v_product_id, 'VERSION_CONFLICT', p_product, private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if v_barcode_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.barcode_key = v_barcode_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BARCODE', 'message', 'El codigo de barras ya esta registrado en otro producto.', 'field', 'barcode', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_sku_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.sku_key = v_sku_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_SKU', 'message', 'El SKU ya esta registrado en otro producto.', 'field', 'sku', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_products (
      id, license_id, category_id, name, name_key, description, barcode, barcode_key, sku, sku_key,
      image_ref, image_url, location, price, cost, stock, committed_stock, min_stock, max_stock,
      track_stock, is_active, product_type, sale_type, bulk_data, conversion_factor, batch_management,
      recipe, modifiers, wholesale_tiers, prescription_type, active_substance, laboratory,
      requires_prescription, presentation, expiration_mode, shelf_life_value, shelf_life_unit,
      search_tokens, search_ngrams, low_stock_alert_status, active_stock_status,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_product_id, v_license_id, v_category_id, v_name, v_name_key,
      nullif(btrim(coalesce(p_product->>'description', '')), ''), v_barcode, v_barcode_key, v_sku, v_sku_key,
      nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', '')), ''),
      nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', '')), ''),
      nullif(btrim(coalesce(p_product->>'location', '')), ''),
      v_price, v_cost,
      case when v_has_initial_batches then 0 else v_stock end,
      case when v_has_initial_batches then 0 else v_committed_stock end,
      nullif(p_product->>'min_stock', '')::numeric,
      nullif(p_product->>'max_stock', '')::numeric,
      coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, true),
      coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true),
      v_product_type, v_sale_type, p_product->'bulk_data', p_product->'conversion_factor', p_product->'batch_management',
      p_product->'recipe', p_product->'modifiers', p_product->'wholesale_tiers',
      nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', '')), ''),
      nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', '')), ''),
      nullif(btrim(coalesce(p_product->>'laboratory', '')), ''),
      coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, null),
      nullif(btrim(coalesce(p_product->>'presentation', '')), ''),
      v_expiration_mode,
      nullif(coalesce(p_product->>'shelf_life_value', p_product->>'shelfLifeValue', ''), '')::numeric,
      nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', '')), ''),
      v_search_tokens, v_search_ngrams,
      nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', '')), ''),
      case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true) and (case when v_has_initial_batches then 0 else v_stock end) > 0 then 1 else 0 end,
      coalesce(nullif(p_product->>'created_at', '')::timestamptz, nullif(p_product->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'images_cloud', false)
    ) returning * into v_saved;
  else
    update public.pos_products
    set category_id = v_category_id,
        name = v_name,
        name_key = v_name_key,
        description = nullif(btrim(coalesce(p_product->>'description', description, '')), ''),
        barcode = v_barcode,
        barcode_key = v_barcode_key,
        sku = v_sku,
        sku_key = v_sku_key,
        image_ref = nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', image_ref, '')), ''),
        image_url = nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', image_url, '')), ''),
        location = nullif(btrim(coalesce(p_product->>'location', location, '')), ''),
        price = v_price,
        cost = v_cost,
        min_stock = coalesce(nullif(p_product->>'min_stock', '')::numeric, nullif(p_product->>'minStock', '')::numeric, min_stock),
        max_stock = coalesce(nullif(p_product->>'max_stock', '')::numeric, nullif(p_product->>'maxStock', '')::numeric, max_stock),
        track_stock = coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, track_stock),
        is_active = coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active),
        product_type = v_product_type,
        sale_type = v_sale_type,
        bulk_data = coalesce(p_product->'bulk_data', bulk_data),
        conversion_factor = coalesce(p_product->'conversion_factor', conversion_factor),
        batch_management = coalesce(p_product->'batch_management', batch_management),
        recipe = coalesce(p_product->'recipe', recipe),
        modifiers = coalesce(p_product->'modifiers', modifiers),
        wholesale_tiers = coalesce(p_product->'wholesale_tiers', wholesale_tiers),
        prescription_type = nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', prescription_type, '')), ''),
        active_substance = nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', active_substance, '')), ''),
        laboratory = nullif(btrim(coalesce(p_product->>'laboratory', laboratory, '')), ''),
        requires_prescription = coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, requires_prescription),
        presentation = nullif(btrim(coalesce(p_product->>'presentation', presentation, '')), ''),
        expiration_mode = v_expiration_mode,
        shelf_life_value = coalesce(nullif(p_product->>'shelf_life_value', '')::numeric, nullif(p_product->>'shelfLifeValue', '')::numeric, shelf_life_value),
        shelf_life_unit = nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', shelf_life_unit, '')), ''),
        search_tokens = coalesce(v_search_tokens, search_tokens),
        search_ngrams = coalesce(v_search_ngrams, search_ngrams),
        low_stock_alert_status = nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', low_stock_alert_status, '')), ''),
        active_stock_status = case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active) and stock > 0 and deleted_at is null then 1 else 0 end,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'stock_not_mutated_by_catalog_edit', true)
    where license_id = v_license_id and id = v_product_id
    returning * into v_saved;
  end if;

  for v_batch_item in select value from jsonb_array_elements(coalesce(p_initial_batches, '[]'::jsonb)) loop
    v_batch_id := nullif(btrim(coalesce(v_batch_item->>'id', '')), '');
    if v_batch_id is null then
      v_batch_id := 'batch-' || gen_random_uuid()::text;
    end if;

    if exists (select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.id = v_batch_id) then
      v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BATCH_ID', 'message', 'El lote inicial ya existe y no se sobreescribira desde catalogo.', 'field', 'batch.id', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if nullif(btrim(coalesce(v_batch_item->>'product_id', v_batch_item->>'productId', v_product_id)), '') <> v_product_id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'Un lote inicial no pertenece al producto.', 'field', 'productId', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    v_batch_stock := greatest(coalesce(nullif(v_batch_item->>'stock', '')::numeric, 0), 0);
    if v_expiration_mode = 'STRICT' and v_batch_stock > 0 and (nullif(v_batch_item->>'expiry_date', '') is null and nullif(v_batch_item->>'expiryDate', '') is null) then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'El modo estricto requiere caducidad para lotes con stock.', 'field', 'expiryDate', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    v_batch_cost := greatest(coalesce(nullif(v_batch_item->>'cost', '')::numeric, v_cost, 0), 0);
    v_batch_price := greatest(coalesce(nullif(v_batch_item->>'price', '')::numeric, v_price, 0), 0);
    v_batch_sku := nullif(btrim(coalesce(v_batch_item->>'sku', '')), '');
    v_batch_sku_key := private.normalize_pos_sku_key(coalesce(v_batch_item->>'sku_key', v_batch_item->>'skuKey', v_batch_sku));
    v_batch_status := lower(coalesce(nullif(v_batch_item->>'status', ''), 'active'));
    if v_batch_status not in ('active','inactive','archived') then v_batch_status := 'active'; end if;

    insert into public.pos_product_batches (
      id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price, track_stock,
      is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type,
      manufacturer_batch_id, supplier, attributes, location, notes, update_global_price,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_batch_id, v_license_id, v_product_id, v_batch_sku, v_batch_sku_key, v_batch_stock,
      greatest(coalesce(nullif(v_batch_item->>'committed_stock', '')::numeric, nullif(v_batch_item->>'committedStock', '')::numeric, 0), 0),
      v_batch_cost, v_batch_price,
      coalesce(nullif(v_batch_item->>'track_stock', '')::boolean, nullif(v_batch_item->>'trackStock', '')::boolean, true),
      coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true),
      v_batch_status,
      case when coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true) and v_batch_status = 'active' and v_batch_stock > 0 then 1 else 0 end,
      coalesce(nullif(v_batch_item->>'expiry_date', '')::timestamptz, nullif(v_batch_item->>'expiryDate', '')::timestamptz, null),
      coalesce(nullif(v_batch_item->>'alert_target_date', '')::timestamptz, nullif(v_batch_item->>'alertTargetDate', '')::timestamptz, nullif(v_batch_item->>'expiry_date', '')::timestamptz, nullif(v_batch_item->>'expiryDate', '')::timestamptz, null),
      nullif(btrim(coalesce(v_batch_item->>'alert_type', v_batch_item->>'alertType', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'manufacturer_batch_id', v_batch_item->>'manufacturerBatchId', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'supplier', '')), ''),
      v_batch_item->'attributes',
      nullif(btrim(coalesce(v_batch_item->>'location', p_product->>'location', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'notes', 'Stock inicial')), ''),
      coalesce(nullif(v_batch_item->>'update_global_price', '')::boolean, nullif(v_batch_item->>'updateGlobalPrice', '')::boolean, false),
      coalesce(nullif(v_batch_item->>'created_at', '')::timestamptz, nullif(v_batch_item->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(v_batch_item->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'source', 'initial_batch')
    ) returning * into v_saved_batch;

    v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product.initial_batches', 'product_id', v_product_id), v_saved_batch.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
    v_batches := v_batches || jsonb_build_array(private.pos_product_batch_to_jsonb(v_saved_batch));
  end loop;

  if v_has_initial_batches then
    v_saved := private.recalculate_pos_product_projection(v_license_id, v_product_id);
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product', 'initial_batches_count', jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb))), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'batches', v_batches, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_PRODUCT_KEY', 'message', 'Codigo de barras o SKU duplicado.', 'idempotency_key', p_idempotency_key);
    if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
    return v_response;
end;
$$;

create or replace function public.pos_delete_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_batch public.pos_product_batches;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_batch_count integer := 0;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_product_id, '')), '') is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.delete', 'product', p_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = p_product_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product', p_product_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  for v_batch in
    update public.pos_product_batches
    set deleted_at = coalesce(deleted_at, now()),
        is_active = false,
        status = 'archived',
        active_stock_status = 0,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_with_product', p_product_id)
    where license_id = v_license_id
      and product_id = p_product_id
      and deleted_at is null
    returning *
  loop
    v_batch_count := v_batch_count + 1;
    v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_batch.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product', 'product_id', p_product_id), v_batch.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
  end loop;

  update public.pos_products
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      active_stock_status = 0,
      barcode_key = null,
      sku_key = null,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_by_phase', 'fase2_products_catalog')
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product', 'batches_archived', v_batch_count), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'batches_archived', v_batch_count, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_toggle_product_status(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_is_active boolean default true,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_product_id, '')), '') is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.toggle_status', 'product', p_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = p_product_id for update;
  if v_existing.id is null or v_existing.deleted_at is not null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product', p_product_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'toggle_status', 'expected_version', p_expected_version), private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_products
  set is_active = coalesce(p_is_active, true),
      active_stock_status = case when coalesce(p_is_active, true) and stock > 0 and deleted_at is null then 1 else 0 end,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_toggle_product_status'), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'event', to_jsonb(v_event), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_upsert_product_batch(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_batch jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_batch_id text;
  v_product_id text;
  v_parent public.pos_products;
  v_existing public.pos_product_batches;
  v_saved public.pos_product_batches;
  v_saved_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
  v_stock numeric;
  v_status text;
  v_sku text;
  v_sku_key text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_batch_id := nullif(btrim(coalesce(p_batch->>'id', '')), '');
  if v_batch_id is null then raise exception 'BATCH_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_product_id := nullif(btrim(coalesce(p_batch->>'product_id', p_batch->>'productId', '')), '');
  if v_product_id is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_parent from public.pos_products where license_id = v_license_id and id = v_product_id for update;
  if v_parent.id is null or v_parent.deleted_at is not null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto padre no existe o fue eliminado.', 'idempotency_key', p_idempotency_key);
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product_batch.upsert', 'product_batch', v_batch_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_product_batches where license_id = v_license_id and id = v_batch_id for update;
  v_is_create := v_existing.id is null;
  if not v_is_create and v_existing.product_id <> v_product_id then
    v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'No se puede mover un lote a otro producto.', 'field', 'productId', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if not v_is_create and p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product_batch', v_batch_id, 'VERSION_CONFLICT', p_batch, private.pos_product_batch_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El lote fue modificado en otro dispositivo.', 'batch', private.pos_product_batch_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_stock := greatest(coalesce(nullif(p_batch->>'stock', '')::numeric, 0), 0);
  if v_parent.expiration_mode = 'STRICT' and v_stock > 0 and (nullif(p_batch->>'expiry_date', '') is null and nullif(p_batch->>'expiryDate', '') is null) then
    v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'El modo estricto requiere caducidad para lotes con stock.', 'field', 'expiryDate', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_sku := nullif(btrim(coalesce(p_batch->>'sku', '')), '');
  v_sku_key := private.normalize_pos_sku_key(coalesce(p_batch->>'sku_key', p_batch->>'skuKey', v_sku));
  v_status := lower(coalesce(nullif(p_batch->>'status', ''), v_existing.status, 'active'));
  if v_status not in ('active','inactive','archived') then v_status := 'active'; end if;

  if v_is_create then
    insert into public.pos_product_batches (
      id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price, track_stock,
      is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type,
      manufacturer_batch_id, supplier, attributes, location, notes, update_global_price,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_batch_id, v_license_id, v_product_id, v_sku, v_sku_key, v_stock,
      greatest(coalesce(nullif(p_batch->>'committed_stock', '')::numeric, nullif(p_batch->>'committedStock', '')::numeric, 0), 0),
      greatest(coalesce(nullif(p_batch->>'cost', '')::numeric, v_parent.cost, 0), 0),
      greatest(coalesce(nullif(p_batch->>'price', '')::numeric, v_parent.price, 0), 0),
      coalesce(nullif(p_batch->>'track_stock', '')::boolean, nullif(p_batch->>'trackStock', '')::boolean, true),
      coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, true),
      v_status,
      case when coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, true) and v_status = 'active' and v_stock > 0 then 1 else 0 end,
      coalesce(nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, null),
      coalesce(nullif(p_batch->>'alert_target_date', '')::timestamptz, nullif(p_batch->>'alertTargetDate', '')::timestamptz, nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, null),
      nullif(btrim(coalesce(p_batch->>'alert_type', p_batch->>'alertType', '')), ''),
      nullif(btrim(coalesce(p_batch->>'manufacturer_batch_id', p_batch->>'manufacturerBatchId', '')), ''),
      nullif(btrim(coalesce(p_batch->>'supplier', '')), ''),
      p_batch->'attributes',
      nullif(btrim(coalesce(p_batch->>'location', v_parent.location, '')), ''),
      nullif(btrim(coalesce(p_batch->>'notes', '')), ''),
      coalesce(nullif(p_batch->>'update_global_price', '')::boolean, nullif(p_batch->>'updateGlobalPrice', '')::boolean, false),
      coalesce(nullif(p_batch->>'created_at', '')::timestamptz, nullif(p_batch->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(p_batch->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    ) returning * into v_saved;
  else
    update public.pos_product_batches
    set sku = v_sku,
        sku_key = v_sku_key,
        stock = v_stock,
        committed_stock = greatest(coalesce(nullif(p_batch->>'committed_stock', '')::numeric, nullif(p_batch->>'committedStock', '')::numeric, committed_stock, 0), 0),
        cost = greatest(coalesce(nullif(p_batch->>'cost', '')::numeric, cost, 0), 0),
        price = greatest(coalesce(nullif(p_batch->>'price', '')::numeric, price, 0), 0),
        track_stock = coalesce(nullif(p_batch->>'track_stock', '')::boolean, nullif(p_batch->>'trackStock', '')::boolean, track_stock),
        is_active = coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, is_active),
        status = v_status,
        active_stock_status = case when coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, is_active) and v_status = 'active' and v_stock > 0 then 1 else 0 end,
        expiry_date = coalesce(nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, expiry_date),
        alert_target_date = coalesce(nullif(p_batch->>'alert_target_date', '')::timestamptz, nullif(p_batch->>'alertTargetDate', '')::timestamptz, nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, alert_target_date),
        alert_type = nullif(btrim(coalesce(p_batch->>'alert_type', p_batch->>'alertType', alert_type, '')), ''),
        manufacturer_batch_id = nullif(btrim(coalesce(p_batch->>'manufacturer_batch_id', p_batch->>'manufacturerBatchId', manufacturer_batch_id, '')), ''),
        supplier = nullif(btrim(coalesce(p_batch->>'supplier', supplier, '')), ''),
        attributes = coalesce(p_batch->'attributes', attributes),
        location = nullif(btrim(coalesce(p_batch->>'location', location, '')), ''),
        notes = nullif(btrim(coalesce(p_batch->>'notes', notes, '')), ''),
        update_global_price = coalesce(nullif(p_batch->>'update_global_price', '')::boolean, nullif(p_batch->>'updateGlobalPrice', '')::boolean, update_global_price),
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_batch->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    where license_id = v_license_id and id = v_batch_id
    returning * into v_saved;
  end if;

  v_saved_product := private.recalculate_pos_product_projection(v_license_id, v_product_id);
  if v_saved.update_global_price is true then
    update public.pos_products
    set price = v_saved.price,
        updated_at = now(),
        server_version = server_version + 1
    where license_id = v_license_id and id = v_product_id
    returning * into v_saved_product;
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product_batch', 'product_id', v_product_id), v_saved.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product_batch.recalculate', 'batch_id', v_saved.id), v_saved_product.server_version);
  v_response := jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved), 'product', private.pos_product_to_jsonb(v_saved_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'server_version', v_saved.server_version, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq), 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_delete_product_batch(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_batch_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_product_batches;
  v_saved public.pos_product_batches;
  v_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_batch_id, '')), '') is null then raise exception 'BATCH_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product_batch.delete', 'product_batch', p_batch_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_product_batches where license_id = v_license_id and id = p_batch_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND', 'message', 'El lote no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product_batch', p_batch_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_product_batch_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El lote fue modificado en otro dispositivo.', 'batch', private.pos_product_batch_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_product_batches
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      status = 'archived',
      active_stock_status = 0,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = p_batch_id
  returning * into v_saved;

  v_product := private.recalculate_pos_product_projection(v_license_id, v_saved.product_id);
  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product_batch', 'product_id', v_saved.product_id), v_saved.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product_batch.recalculate', 'batch_id', v_saved.id), v_product.server_version);
  v_response := jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved), 'product', private.pos_product_to_jsonb(v_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'server_version', v_saved.server_version, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq), 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_pull_product_catalog_snapshot(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_entity_type text default 'all',
  p_limit integer default 500,
  p_offset integer default 0,
  p_include_deleted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer;
  v_offset integer;
  v_entity text;
  v_categories jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_latest bigint := 0;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_entity := lower(coalesce(nullif(p_entity_type, ''), 'all'));

  if v_entity in ('all', 'category', 'categories') then
    select count(*)::integer into v_total from public.pos_categories c where c.license_id = v_license_id and (p_include_deleted is true or c.deleted_at is null);
    with page as (
      select c.* from public.pos_categories c where c.license_id = v_license_id and (p_include_deleted is true or c.deleted_at is null) order by c.updated_at asc, c.id asc offset v_offset limit v_limit
    ) select coalesce(jsonb_agg(private.pos_category_to_jsonb(page.*) order by page.updated_at asc, page.id asc), '[]'::jsonb) into v_categories from page;
  end if;

  if v_entity in ('all', 'product', 'products') then
    select count(*)::integer into v_total from public.pos_products p where p.license_id = v_license_id and (p_include_deleted is true or p.deleted_at is null);
    with page as (
      select p.* from public.pos_products p where p.license_id = v_license_id and (p_include_deleted is true or p.deleted_at is null) order by p.updated_at asc, p.id asc offset v_offset limit v_limit
    ) select coalesce(jsonb_agg(private.pos_product_to_jsonb(page.*) order by page.updated_at asc, page.id asc), '[]'::jsonb) into v_products from page;
  end if;

  if v_entity in ('all', 'batch', 'batches', 'product_batch', 'product_batches') then
    select count(*)::integer into v_total from public.pos_product_batches b where b.license_id = v_license_id and (p_include_deleted is true or b.deleted_at is null);
    with page as (
      select b.* from public.pos_product_batches b where b.license_id = v_license_id and (p_include_deleted is true or b.deleted_at is null) order by b.updated_at asc, b.id asc offset v_offset limit v_limit
    ) select coalesce(jsonb_agg(private.pos_product_batch_to_jsonb(page.*) order by page.updated_at asc, page.id asc), '[]'::jsonb) into v_batches from page;
  end if;

  select coalesce(max(e.change_seq), 0) into v_latest
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type in ('category','product','product_batch');

  return jsonb_build_object(
    'success', true,
    'entity_type', v_entity,
    'categories', v_categories,
    'products', v_products,
    'batches', v_batches,
    'limit', v_limit,
    'offset', v_offset,
    'total', v_total,
    'has_more', (v_offset + v_limit) < v_total,
    'latest_change_seq', v_latest
  );
end;
$$;

create or replace function public.pos_pull_product_catalog_changes(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_since_change_seq bigint default 0,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer;
  v_events jsonb;
  v_categories jsonb;
  v_products jsonb;
  v_batches jsonb;
  v_deleted_categories jsonb;
  v_deleted_products jsonb;
  v_deleted_batches jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);

  with pulled as (
    select e.* from public.pos_sync_events e
    where e.license_id = v_license_id
      and e.entity_type in ('category','product','product_batch')
      and e.change_seq > coalesce(p_since_change_seq, 0)
    order by e.change_seq asc
    limit v_limit
  ), category_ids as (
    select distinct entity_id from pulled where entity_type = 'category'
  ), product_ids as (
    select distinct entity_id from pulled where entity_type = 'product'
  ), batch_ids as (
    select distinct entity_id from pulled where entity_type = 'product_batch'
  )
  select
    coalesce((select jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc) from pulled), '[]'::jsonb),
    coalesce((select max(pulled.change_seq) from pulled), coalesce(p_since_change_seq, 0)),
    coalesce((select jsonb_agg(private.pos_category_to_jsonb(c) order by c.updated_at asc, c.id asc) from public.pos_categories c join category_ids on category_ids.entity_id = c.id where c.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_product_to_jsonb(p) order by p.updated_at asc, p.id asc) from public.pos_products p join product_ids on product_ids.entity_id = p.id where p.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_product_batch_to_jsonb(b) order by b.updated_at asc, b.id asc) from public.pos_product_batches b join batch_ids on batch_ids.entity_id = b.id where b.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(c.id) from public.pos_categories c join category_ids on category_ids.entity_id = c.id where c.license_id = v_license_id and c.deleted_at is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(p.id) from public.pos_products p join product_ids on product_ids.entity_id = p.id where p.license_id = v_license_id and p.deleted_at is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(b.id) from public.pos_product_batches b join batch_ids on batch_ids.entity_id = b.id where b.license_id = v_license_id and b.deleted_at is not null), '[]'::jsonb)
  into v_events, v_latest_returned, v_categories, v_products, v_batches, v_deleted_categories, v_deleted_products, v_deleted_batches;

  select coalesce(max(e.change_seq), coalesce(p_since_change_seq, 0)) into v_server_latest
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type in ('category','product','product_batch');

  return jsonb_build_object(
    'success', true,
    'events', v_events,
    'categories', v_categories,
    'products', v_products,
    'batches', v_batches,
    'deleted_ids', jsonb_build_object('categories', v_deleted_categories, 'products', v_deleted_products, 'batches', v_deleted_batches),
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned
  );
end;
$$;

create or replace function public.pos_migrate_local_product_catalog(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_categories jsonb default '[]'::jsonb,
  p_products jsonb default '[]'::jsonb,
  p_batches jsonb default '[]'::jsonb,
  p_batch_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_item jsonb;
  v_results jsonb := jsonb_build_object('categories', '[]'::jsonb, 'products', '[]'::jsonb, 'batches', '[]'::jsonb);
  v_result jsonb;
  v_index integer := 0;
  v_key text;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);

  if coalesce(jsonb_typeof(p_categories), 'array') <> 'array' then raise exception 'CATEGORIES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_products), 'array') <> 'array' then raise exception 'PRODUCTS_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_batches), 'array') <> 'array' then raise exception 'BATCHES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':category:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_category(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), null, v_key);
    v_results := jsonb_set(v_results, '{categories}', (v_results->'categories') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':product:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), '[]'::jsonb, null, v_key);
    v_results := jsonb_set(v_results, '{products}', (v_results->'products') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_batches, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':batch:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product_batch(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), null, v_key);
    v_results := jsonb_set(v_results, '{batches}', (v_results->'batches') || jsonb_build_array(v_result));
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', jsonb_build_object(
      'categories', jsonb_array_length(coalesce(p_categories, '[]'::jsonb)),
      'products', jsonb_array_length(coalesce(p_products, '[]'::jsonb)),
      'batches', jsonb_array_length(coalesce(p_batches, '[]'::jsonb))
    ),
    'results', v_results
  );
end;
$$;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_products_sync', true)
where code = 'pro_monthly';

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_products_sync', false)
where code in ('free_trial', 'basic_monthly');

grant execute on function public.pos_upsert_category(text,text,text,text,jsonb,integer,text) to anon, authenticated;
grant execute on function public.pos_delete_category(text,text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text) to anon, authenticated;
grant execute on function public.pos_delete_product(text,text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.pos_toggle_product_status(text,text,text,text,text,boolean,integer,text) to anon, authenticated;
grant execute on function public.pos_upsert_product_batch(text,text,text,text,jsonb,integer,text) to anon, authenticated;
grant execute on function public.pos_delete_product_batch(text,text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.pos_pull_product_catalog_snapshot(text,text,text,text,text,integer,integer,boolean) to anon, authenticated;
grant execute on function public.pos_pull_product_catalog_changes(text,text,text,text,bigint,integer) to anon, authenticated;
grant execute on function public.pos_migrate_local_product_catalog(text,text,text,text,jsonb,jsonb,jsonb,text) to anon, authenticated;;
