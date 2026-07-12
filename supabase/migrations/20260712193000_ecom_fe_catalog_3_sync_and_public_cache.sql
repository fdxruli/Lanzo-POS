-- ECOM.FE.CATALOG.3 - Sincronizacion automatica PRO y revision monotona del catalogo.
-- Esta migracion es aditiva. No debe aplicarse a produccion durante la revision del PR.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Modelo de revision y vinculacion source/manual
-- ---------------------------------------------------------------------------

alter table public.ecommerce_portals
  add column if not exists catalog_revision bigint not null default 1;

alter table public.ecommerce_published_products
  add column if not exists sync_config jsonb not null default jsonb_build_object(
    'name', 'manual',
    'description', 'manual',
    'category', 'manual',
    'price', 'manual',
    'image', 'manual'
  ),
  add column if not exists manual_available boolean not null default true,
  add column if not exists source_available boolean not null default true,
  add column if not exists source_state text not null default 'manual',
  add column if not exists sync_status text not null default 'manual',
  add column if not exists sync_error_code text,
  add column if not exists source_revision text,
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_synced_at timestamptz;

update public.ecommerce_portals
set catalog_revision = 1
where catalog_revision is null or catalog_revision < 1;

-- Las filas existentes conservan exactamente su snapshot visual y disponibilidad.
update public.ecommerce_published_products
set sync_config = jsonb_build_object(
      'name', 'manual',
      'description', 'manual',
      'category', 'manual',
      'price', 'manual',
      'image', 'manual'
    ),
    manual_available = is_available,
    source_available = true,
    source_state = case
      when source_state in ('source_missing', 'inactive_source', 'unverified', 'not_tracked', 'in_stock', 'out_of_stock')
        then source_state
      else 'manual'
    end,
    sync_status = case
      when sync_status in ('synced', 'pending', 'review', 'error', 'manual') then sync_status
      else 'manual'
    end
where sync_config is null
   or jsonb_typeof(sync_config) <> 'object'
   or not (sync_config ?& array['name', 'description', 'category', 'price', 'image']);

create or replace function private.ecommerce_normalize_sync_config(
  p_config jsonb,
  p_fallback jsonb default null
)
returns jsonb
language sql
immutable
security definer
set search_path to ''
as $$
  with source as (
    select case
      when jsonb_typeof(p_config) = 'object' then p_config
      when jsonb_typeof(p_fallback) = 'object' then p_fallback
      else '{}'::jsonb
    end as value
  )
  select jsonb_build_object(
    'name', case when value->>'name' = 'source' then 'source' else 'manual' end,
    'description', case when value->>'description' = 'source' then 'source' else 'manual' end,
    'category', case when value->>'category' = 'source' then 'source' else 'manual' end,
    'price', case when value->>'price' = 'source' then 'source' else 'manual' end,
    'image', case when value->>'image' = 'source' then 'source' else 'manual' end
  )
  from source;
$$;

update public.ecommerce_published_products
set sync_config = private.ecommerce_normalize_sync_config(sync_config, null),
    is_available = coalesce(manual_available, is_available, true)
      and coalesce(source_available, true);

alter table public.ecommerce_published_products
  alter column sync_config set default jsonb_build_object(
    'name', 'manual',
    'description', 'manual',
    'category', 'manual',
    'price', 'manual',
    'image', 'manual'
  );

DO $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ecommerce_portals_catalog_revision_positive'
  ) then
    alter table public.ecommerce_portals
      add constraint ecommerce_portals_catalog_revision_positive
      check (catalog_revision > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ecommerce_published_products_source_state_valid'
  ) then
    alter table public.ecommerce_published_products
      add constraint ecommerce_published_products_source_state_valid
      check (source_state in (
        'manual', 'source_missing', 'inactive_source', 'unverified',
        'not_tracked', 'in_stock', 'out_of_stock'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ecommerce_published_products_sync_status_valid'
  ) then
    alter table public.ecommerce_published_products
      add constraint ecommerce_published_products_sync_status_valid
      check (sync_status in ('synced', 'pending', 'review', 'error', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ecommerce_published_products_sync_config_object'
  ) then
    alter table public.ecommerce_published_products
      add constraint ecommerce_published_products_sync_config_object
      check (jsonb_typeof(sync_config) = 'object');
  end if;
end;
$$;

create index if not exists ix_ecommerce_published_products_portal_sync_status
  on public.ecommerce_published_products (portal_id, sync_status, last_sync_attempt_at desc)
  where deleted_at is null;

create index if not exists ix_ecommerce_published_products_portal_local_ref
  on public.ecommerce_published_products (portal_id, local_product_ref)
  where deleted_at is null and local_product_ref is not null;

create or replace function private.ecommerce_published_product_sync_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.sync_config := private.ecommerce_normalize_sync_config(
    new.sync_config,
    case when tg_op = 'UPDATE' then old.sync_config else null end
  );

  if tg_op = 'INSERT' then
    -- Compatibilidad con inserciones antiguas que solo escriben is_available.
    new.manual_available := coalesce(new.is_available, new.manual_available, true);
    new.source_available := coalesce(new.source_available, true);
  elsif new.manual_available is not distinct from old.manual_available
        and new.is_available is distinct from old.is_available then
    -- Una escritura administrativa legacy sigue representando disponibilidad manual.
    new.manual_available := coalesce(new.is_available, old.manual_available, true);
  end if;

  new.manual_available := coalesce(new.manual_available, true);
  new.source_available := coalesce(new.source_available, true);
  new.is_available := new.manual_available and new.source_available;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ecommerce_published_products_sync_guard
  on public.ecommerce_published_products;
create trigger trg_ecommerce_published_products_sync_guard
before insert or update on public.ecommerce_published_products
for each row
execute function private.ecommerce_published_product_sync_guard();

-- ---------------------------------------------------------------------------
-- Revision monotona: solo cambia si cambia la proyeccion publica
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_product_public_signature(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_product.id is null
      or p_product.deleted_at is not null
      or p_product.is_published is not true
      then null
    else jsonb_build_object(
      'id', p_product.id,
      'name', p_product.public_name,
      'description', p_product.public_description,
      'categoryName', p_product.category_name,
      'price', p_product.price,
      'currency', p_product.currency,
      'imageUrl', p_product.image_url,
      'isAvailable', p_product.is_available,
      'displayOrder', p_product.display_order,
      'stockMode', p_product.stock_mode,
      'stockSnapshot', p_product.stock_snapshot,
      'options', p_product.options
    )
  end;
$$;

create or replace function private.ecommerce_bump_catalog_revision_on_product_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old_signature jsonb;
  v_new_signature jsonb;
  v_portal_id uuid;
begin
  if tg_op = 'INSERT' then
    v_old_signature := null;
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  elsif tg_op = 'DELETE' then
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := null;
    v_portal_id := old.portal_id;
  else
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  end if;

  if v_old_signature is distinct from v_new_signature then
    update public.ecommerce_portals
    set catalog_revision = catalog_revision + 1
    where id = v_portal_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ecommerce_published_products_catalog_revision
  on public.ecommerce_published_products;
create trigger trg_ecommerce_published_products_catalog_revision
after insert or update or delete on public.ecommerce_published_products
for each row
execute function private.ecommerce_bump_catalog_revision_on_product_change();

-- ---------------------------------------------------------------------------
-- Contratos JSON administrativos con estado de sincronizacion seguro
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_admin_portal_jsonb(
  p_portal public.ecommerce_portals
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_portal.id,
    'slug', p_portal.slug,
    'slugSource', p_portal.slug_source,
    'status', p_portal.status,
    'name', p_portal.name,
    'headline', p_portal.headline,
    'description', p_portal.description,
    'templateCode', p_portal.template_code,
    'customizationLevel', p_portal.customization_level,
    'theme', p_portal.theme,
    'logoUrl', p_portal.logo_url,
    'coverImageUrl', p_portal.cover_image_url,
    'whatsappPhone', p_portal.whatsapp_phone,
    'address', p_portal.address,
    'orderingEnabled', p_portal.ordering_enabled,
    'pickupEnabled', p_portal.pickup_enabled,
    'deliveryEnabled', p_portal.delivery_enabled,
    'minOrderTotal', p_portal.min_order_total,
    'stockMode', p_portal.stock_mode,
    'settings', p_portal.settings,
    'catalogRevision', p_portal.catalog_revision,
    'createdAt', p_portal.created_at,
    'updatedAt', p_portal.updated_at
  );
$$;

create or replace function private.ecommerce_admin_product_jsonb(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
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
    'hasManualFields', exists (
      select 1
      from jsonb_each_text(p_product.sync_config) field
      where field.value = 'manual'
    ),
    'metadata', p_product.metadata,
    'createdAt', p_product.created_at,
    'updatedAt', p_product.updated_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Edicion administrativa: disponibilidad manual y config por campo
-- ---------------------------------------------------------------------------

create or replace function public.ecommerce_admin_upsert_published_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal_id uuid;
  v_existing public.ecommerce_published_products%rowtype;
  v_saved public.ecommerce_published_products%rowtype;
  v_id uuid;
  v_source_type text;
  v_local_ref text;
  v_cloud_ref text;
  v_name text;
  v_price numeric(12,2);
  v_is_published boolean;
  v_manual_available boolean;
  v_stock_mode text;
  v_sync_config jsonb;
  v_cloud_catalog boolean;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_upsert_published_product'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);
  v_cloud_catalog := coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false);

  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1;
  if v_portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;

  if nullif(btrim(coalesce(p_payload->>'id', '')), '') is not null then
    begin
      v_id := (p_payload->>'id')::uuid;
    exception when others then
      return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end;
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.id = v_id and pp.portal_id = v_portal_id and pp.deleted_at is null
    limit 1 for update;
    if v_existing.id is null then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND'); end if;
  end if;

  v_source_type := lower(btrim(coalesce(p_payload->>'sourceType', coalesce(v_existing.source_type, 'local_snapshot'))));
  if v_source_type not in ('local_snapshot', 'cloud_product') then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SOURCE_INVALID', 'La fuente del producto no es valida.');
  end if;
  if v_source_type = 'cloud_product' and v_cloud_catalog is false then
    return private.ecommerce_admin_error('ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO');
  end if;

  v_local_ref := nullif(btrim(coalesce(p_payload->>'localProductRef', coalesce(v_existing.local_product_ref, ''))), '');
  v_cloud_ref := nullif(btrim(coalesce(p_payload->>'productId', coalesce(v_existing.product_id, ''))), '');
  if v_local_ref is null then return private.ecommerce_admin_error('ECOMMERCE_LOCAL_PRODUCT_REF_REQUIRED'); end if;

  if v_existing.id is null then
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal_id
      and pp.deleted_at is null
      and pp.local_product_ref = v_local_ref
    limit 1 for update;
  end if;

  v_name := btrim(coalesce(p_payload->>'publicName', coalesce(v_existing.public_name, '')));
  if v_name = '' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NAME_REQUIRED'); end if;

  begin
    v_price := coalesce(nullif(p_payload->>'price', '')::numeric, v_existing.price, 0);
  exception when others then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PRICE_INVALID');
  end;
  if v_price < 0 then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PRICE_INVALID'); end if;

  v_is_published := coalesce((p_payload->>'isPublished')::boolean, coalesce(v_existing.is_published, true));
  v_manual_available := coalesce(
    (p_payload->>'manualAvailable')::boolean,
    (p_payload->>'isAvailable')::boolean,
    v_existing.manual_available,
    true
  );
  v_stock_mode := lower(btrim(coalesce(p_payload->>'stockMode', coalesce(v_existing.stock_mode, 'hidden'))));
  if coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false) is false then
    v_stock_mode := 'hidden';
  elsif v_stock_mode not in ('hidden', 'status', 'exact') then
    v_stock_mode := 'hidden';
  end if;

  if v_cloud_catalog then
    v_sync_config := private.ecommerce_normalize_sync_config(
      p_payload->'syncConfig',
      coalesce(v_existing.sync_config, jsonb_build_object(
        'name', 'source', 'description', 'source', 'category', 'source', 'price', 'source', 'image', 'source'
      ))
    );
  else
    v_sync_config := private.ecommerce_normalize_sync_config('{}'::jsonb, null);
  end if;

  if v_existing.id is null then
    insert into public.ecommerce_published_products (
      portal_id, license_id, source_type, product_id, local_product_ref,
      public_name, public_description, category_name, price, currency,
      image_url, is_published, is_available, manual_available, source_available,
      display_order, track_stock, stock_mode, sync_config, source_state,
      sync_status, metadata
    ) values (
      v_portal_id, v_license_id, v_source_type, v_cloud_ref, v_local_ref,
      v_name, nullif(btrim(p_payload->>'publicDescription'), ''),
      nullif(btrim(p_payload->>'categoryName'), ''), v_price, 'MXN',
      nullif(btrim(p_payload->>'imageUrl'), ''), v_is_published,
      v_manual_available, v_manual_available, true,
      greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, 0), 0),
      v_stock_mode <> 'hidden', v_stock_mode, v_sync_config,
      case when v_cloud_catalog then 'unverified' else 'manual' end,
      case when v_cloud_catalog and v_sync_config @> '{"name":"source"}'::jsonb then 'pending' else 'manual' end,
      coalesce(p_payload->'metadata', '{}'::jsonb)
        || jsonb_build_object('source', 'admin_ui', 'phase', 'ECOM.FE.CATALOG.3')
    ) returning * into v_saved;
  else
    update public.ecommerce_published_products pp
    set source_type = v_source_type,
        product_id = v_cloud_ref,
        local_product_ref = v_local_ref,
        public_name = v_name,
        public_description = nullif(btrim(p_payload->>'publicDescription'), ''),
        category_name = nullif(btrim(p_payload->>'categoryName'), ''),
        price = v_price,
        image_url = case
          when p_payload ? 'imageUrl' then nullif(btrim(p_payload->>'imageUrl'), '')
          else pp.image_url
        end,
        is_published = v_is_published,
        manual_available = v_manual_available,
        is_available = v_manual_available and pp.source_available,
        display_order = greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, pp.display_order), 0),
        track_stock = v_stock_mode <> 'hidden',
        stock_mode = v_stock_mode,
        sync_config = v_sync_config,
        sync_status = case
          when v_cloud_catalog and v_sync_config <> pp.sync_config then 'pending'
          when v_cloud_catalog then pp.sync_status
          else 'manual'
        end,
        metadata = coalesce(pp.metadata, '{}'::jsonb)
          || coalesce(p_payload->'metadata', '{}'::jsonb)
          || jsonb_build_object('last_admin_source', 'admin_ui')
    where pp.id = v_existing.id
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', case when v_existing.id is null then 'Producto publicado correctamente.' else 'Producto actualizado correctamente.' end,
    'product', private.ecommerce_admin_product_jsonb(v_saved)
  );
exception
  when others then
    if sqlerrm like '%ECOMMERCE_PRODUCT_LIMIT_REACHED%' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_LIMIT_REACHED'); end if;
    if sqlerrm like '%ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO%' then return private.ecommerce_admin_error('ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO'); end if;
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SAVE_FAILED');
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotencia y RPC batch transaccional
-- ---------------------------------------------------------------------------

create table if not exists private.ecommerce_catalog_sync_requests (
  license_id uuid not null,
  portal_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (license_id, portal_id, idempotency_key)
);

revoke all on table private.ecommerce_catalog_sync_requests from public, anon, authenticated;
grant select, insert, update, delete on table private.ecommerce_catalog_sync_requests to service_role;

create index if not exists ix_ecommerce_catalog_sync_requests_created
  on private.ecommerce_catalog_sync_requests (created_at);

create or replace function public.ecommerce_admin_sync_published_catalog(
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
set search_path to ''
as $$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_portal public.ecommerce_portals%rowtype;
  v_batch_size integer;
  v_request_hash text;
  v_existing_request private.ecommerce_catalog_sync_requests%rowtype;
  v_item jsonb;
  v_fields jsonb;
  v_product public.ecommerce_published_products%rowtype;
  v_saved public.ecommerce_published_products%rowtype;
  v_source_state text;
  v_source_available boolean;
  v_stock_snapshot numeric(12,3);
  v_public_before jsonb;
  v_public_after jsonb;
  v_updated_count integer := 0;
  v_skipped_count integer := 0;
  v_review_count integer := 0;
  v_response jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_sync_published_catalog'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  if coalesce((v_auth#>>'{features,ecommerce_cloud_catalog_source}')::boolean, false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO');
  end if;

  if jsonb_typeof(p_projections) <> 'array' then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD', 'La proyeccion del catalogo no es valida.');
  end if;
  v_batch_size := jsonb_array_length(p_projections);
  if v_batch_size < 1 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_EMPTY', 'No hay productos para sincronizar.');
  end if;
  if v_batch_size > 200 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_BATCH_TOO_LARGE', 'El lote supera 200 productos.');
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null or length(p_idempotency_key) > 200 then
    return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select p.* into v_portal
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1 for update;
  if v_portal.id is null then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;

  v_request_hash := encode(extensions.digest(p_projections::text, 'sha256'), 'hex');
  select r.* into v_existing_request
  from private.ecommerce_catalog_sync_requests r
  where r.license_id = v_license_id
    and r.portal_id = v_portal.id
    and r.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing_request.idempotency_key is not null then
    if v_existing_request.request_hash <> v_request_hash then
      return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT', 'La llave idempotente ya fue utilizada con otro lote.');
    end if;
    return v_existing_request.response || jsonb_build_object('idempotent', true);
  end if;

  if p_expected_catalog_revision is not null
     and p_expected_catalog_revision <> v_portal.catalog_revision then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_REVISION_CHANGED',
      'El catalogo cambio durante la sincronizacion.',
      jsonb_build_object('catalogRevision', v_portal.catalog_revision)
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_projections) item
    where jsonb_typeof(item) <> 'object'
       or (item - array[
         'publishedProductId', 'localProductRef', 'sourceRevision',
         'sourceState', 'sourceAvailable', 'stockSnapshot', 'fields'
       ]) <> '{}'::jsonb
       or jsonb_typeof(item->'fields') <> 'object'
       or ((item->'fields') - array['name', 'description', 'category', 'price', 'image']) <> '{}'::jsonb
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD', 'La proyeccion contiene campos no permitidos.');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_projections) item
    where nullif(btrim(item->>'publishedProductId'), '') is null
       or nullif(btrim(item->>'localProductRef'), '') is null
       or item->>'sourceState' not in (
         'source_missing', 'inactive_source', 'unverified',
         'not_tracked', 'in_stock', 'out_of_stock'
       )
       or jsonb_typeof(item->'sourceAvailable') not in ('boolean', 'null')
       or jsonb_typeof(item->'stockSnapshot') not in ('number', 'null')
       or jsonb_typeof(item#>'{fields,name}') not in ('string', 'null')
       or jsonb_typeof(item#>'{fields,description}') not in ('string', 'null')
       or jsonb_typeof(item#>'{fields,category}') not in ('string', 'null')
       or jsonb_typeof(item#>'{fields,price}') not in ('number', 'null')
       or jsonb_typeof(item#>'{fields,image}') not in ('string', 'null')
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD', 'La proyeccion contiene valores no validos.');
  end if;

  if (
    select count(*) <> count(distinct item->>'publishedProductId')
      or count(*) <> count(distinct item->>'localProductRef')
    from jsonb_array_elements(p_projections) item
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_DUPLICATE_REF', 'El lote contiene referencias duplicadas.');
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_projections) item
    join public.ecommerce_published_products pp
      on pp.id::text = item->>'publishedProductId'
     and pp.local_product_ref = item->>'localProductRef'
     and pp.portal_id = v_portal.id
     and pp.license_id = v_license_id
     and pp.deleted_at is null
  ) <> v_batch_size then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND', 'Una referencia no pertenece al portal autorizado.');
  end if;

  for v_item in select value from jsonb_array_elements(p_projections) loop
    v_fields := v_item->'fields';
    select pp.* into v_product
    from public.ecommerce_published_products pp
    where pp.id::text = v_item->>'publishedProductId'
      and pp.portal_id = v_portal.id
      and pp.license_id = v_license_id
      and pp.local_product_ref = v_item->>'localProductRef'
      and pp.deleted_at is null
    limit 1 for update;

    v_source_state := v_item->>'sourceState';
    v_source_available := case
      when jsonb_typeof(v_item->'sourceAvailable') = 'boolean'
        then (v_item->>'sourceAvailable')::boolean
      else null
    end;
    v_stock_snapshot := case
      when jsonb_typeof(v_item->'stockSnapshot') = 'number'
        then greatest((v_item->>'stockSnapshot')::numeric, 0)
      else null
    end;
    v_public_before := private.ecommerce_product_public_signature(v_product);

    update public.ecommerce_published_products pp
    set public_name = case
          when pp.sync_config->>'name' = 'source' and v_fields ? 'name'
            then coalesce(nullif(btrim(v_fields->>'name'), ''), pp.public_name)
          else pp.public_name
        end,
        public_description = case
          when pp.sync_config->>'description' = 'source' and v_fields ? 'description'
            then nullif(btrim(v_fields->>'description'), '')
          else pp.public_description
        end,
        category_name = case
          when pp.sync_config->>'category' = 'source' and v_fields ? 'category'
            then nullif(btrim(v_fields->>'category'), '')
          else pp.category_name
        end,
        price = case
          when pp.sync_config->>'price' = 'source'
               and jsonb_typeof(v_fields->'price') = 'number'
            then greatest((v_fields->>'price')::numeric, 0)
          else pp.price
        end,
        image_url = case
          when pp.sync_config->>'image' = 'source' and v_fields ? 'image'
            then nullif(btrim(v_fields->>'image'), '')
          else pp.image_url
        end,
        source_available = case
          when v_source_state = 'unverified' or v_source_available is null
            then pp.source_available
          else v_source_available
        end,
        stock_snapshot = case
          when v_source_state = 'unverified' or v_stock_snapshot is null
            then pp.stock_snapshot
          else v_stock_snapshot
        end,
        stock_updated_at = case
          when v_source_state in ('in_stock', 'out_of_stock') and v_stock_snapshot is not null
            then now()
          else pp.stock_updated_at
        end,
        source_state = v_source_state,
        source_revision = left(nullif(btrim(v_item->>'sourceRevision'), ''), 160),
        sync_status = case
          when v_source_state in ('source_missing', 'inactive_source', 'unverified') then 'review'
          else 'synced'
        end,
        sync_error_code = case v_source_state
          when 'source_missing' then 'SOURCE_MISSING'
          when 'inactive_source' then 'INACTIVE_SOURCE'
          when 'unverified' then 'SOURCE_UNVERIFIED'
          else null
        end,
        last_sync_attempt_at = now(),
        last_synced_at = case
          when v_source_state in ('source_missing', 'inactive_source', 'unverified') then pp.last_synced_at
          else now()
        end,
        is_available = pp.manual_available and case
          when v_source_state = 'unverified' or v_source_available is null
            then pp.source_available
          else v_source_available
        end
    where pp.id = v_product.id
    returning * into v_saved;

    v_public_after := private.ecommerce_product_public_signature(v_saved);
    if v_public_before is distinct from v_public_after
       or v_product.source_revision is distinct from v_saved.source_revision
       or v_product.source_state is distinct from v_saved.source_state then
      v_updated_count := v_updated_count + 1;
    else
      v_skipped_count := v_skipped_count + 1;
    end if;
    if v_saved.sync_status = 'review' then
      v_review_count := v_review_count + 1;
    end if;
  end loop;

  select p.* into v_portal
  from public.ecommerce_portals p
  where p.id = v_portal.id;

  v_response := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'updatedCount', v_updated_count,
    'skippedCount', v_skipped_count,
    'reviewCount', v_review_count,
    'catalogRevision', v_portal.catalog_revision
  );

  insert into private.ecommerce_catalog_sync_requests (
    license_id, portal_id, idempotency_key, request_hash, response
  ) values (
    v_license_id, v_portal.id, p_idempotency_key, v_request_hash, v_response
  );

  delete from private.ecommerce_catalog_sync_requests
  where created_at < now() - interval '7 days';

  return v_response;
exception
  when unique_violation then
    select r.* into v_existing_request
    from private.ecommerce_catalog_sync_requests r
    where r.license_id = v_license_id
      and r.portal_id = v_portal.id
      and r.idempotency_key = p_idempotency_key;
    if v_existing_request.request_hash = v_request_hash then
      return v_existing_request.response || jsonb_build_object('idempotent', true);
    end if;
    return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT');
  when others then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_FAILED', 'No se pudo sincronizar el catalogo publicado.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Contrato publico versionado
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_public_error(p_code text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'success', false,
    'error', jsonb_build_object(
      'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR'),
      'message', case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_UNKNOWN_ERROR')
        when 'ECOMMERCE_PORTAL_NOT_FOUND' then 'La tienda no esta disponible.'
        when 'ECOMMERCE_CATALOG_REVISION_CHANGED' then 'El catalogo cambio mientras se cargaba.'
        when 'ECOMMERCE_ORDERING_DISABLED' then 'Este negocio no esta recibiendo pedidos en este momento.'
        when 'ECOMMERCE_CUSTOMER_NAME_REQUIRED' then 'Escribe tu nombre para continuar.'
        when 'ECOMMERCE_CUSTOMER_PHONE_REQUIRED' then 'Escribe un telefono valido para continuar.'
        when 'ECOMMERCE_DELIVERY_NOT_AVAILABLE' then 'Este negocio no tiene entrega a domicilio disponible.'
        when 'ECOMMERCE_PICKUP_NOT_AVAILABLE' then 'Este negocio no tiene recoleccion disponible.'
        when 'ECOMMERCE_EMPTY_CART' then 'Agrega al menos un producto para continuar.'
        when 'ECOMMERCE_TOO_MANY_ITEMS' then 'El pedido tiene demasiados productos.'
        when 'ECOMMERCE_PRODUCT_NOT_FOUND' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_PRODUCT_NOT_AVAILABLE' then 'Uno de los productos ya no esta disponible.'
        when 'ECOMMERCE_INVALID_QUANTITY' then 'Revisa la cantidad de productos.'
        when 'ECOMMERCE_MIN_ORDER_NOT_REACHED' then 'El pedido no alcanza el minimo requerido.'
        when 'ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_IDEMPOTENCY_CONFLICT' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        when 'ECOMMERCE_RATE_LIMITED' then 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
        when 'ECOMMERCE_DAILY_ORDER_LIMIT_REACHED' then 'Este negocio no puede recibir mas pedidos por ahora.'
        when 'ECOMMERCE_ORDER_CREATE_FAILED' then 'No se pudo confirmar el pedido. Intentalo de nuevo.'
        else 'No se pudo completar la solicitud.'
      end
    )
  );
$$;

create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_portal public.ecommerce_portals%rowtype;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'success', true,
    'portal', private.ecommerce_portal_public_jsonb(v_portal),
    'hours', private.ecommerce_portal_hours_jsonb(v_portal.id),
    'features', jsonb_build_object(
      'whatsappCheckout', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_whatsapp_checkout', false),
      'orderInbox', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false),
      'customSlug', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_custom_slug', false),
      'brandingCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_branding_customization'), 'basic'),
      'layoutCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_layout_customization'), 'template_only'),
      'businessHours', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_business_hours', true),
      'deliveryPickupSettings', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_delivery_pickup_settings'), 'basic'),
      'stockVisibility', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false),
      'realtimeOrders', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_realtime_orders', false)
    ),
    'catalogRevision', v_portal.catalog_revision,
    'cachePolicy', jsonb_build_object(
      'schemaVersion', 1,
      'freshSeconds', 300,
      'maxStaleSeconds', 86400
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$$;

create or replace function public.ecommerce_get_catalog(
  p_slug text,
  p_limit integer,
  p_offset integer,
  p_catalog_revision bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_limit integer;
  v_offset integer;
  v_plan_limit integer;
  v_effective_limit integer;
  v_allow_stock_visibility boolean;
  v_items jsonb;
  v_count integer;
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  if p_catalog_revision is not null and p_catalog_revision <> v_portal.catalog_revision then
    return private.ecommerce_public_error('ECOMMERCE_CATALOG_REVISION_CHANGED');
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_plan_limit := private.ecommerce_license_feature_int(v_portal.license_id, 'ecommerce_max_published_products', 0);
  v_effective_limit := v_limit;
  if v_plan_limit >= 0 then
    v_effective_limit := least(v_effective_limit, greatest(v_plan_limit - v_offset, 0));
  end if;

  v_allow_stock_visibility := private.ecommerce_license_feature_bool(
    v_portal.license_id,
    'ecommerce_stock_visibility',
    false
  );

  select count(*) into v_count
  from public.ecommerce_published_products pp
  where pp.portal_id = v_portal.id
    and pp.deleted_at is null
    and pp.is_published is true;

  select coalesce(
    jsonb_agg(
      private.ecommerce_product_public_jsonb(x, v_allow_stock_visibility)
      order by x.display_order, x.public_name, x.id
    ),
    '[]'::jsonb
  ) into v_items
  from (
    select pp.*
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal.id
      and pp.deleted_at is null
      and pp.is_published is true
    order by pp.display_order, pp.public_name, pp.id
    limit v_effective_limit
    offset v_offset
  ) x;

  return jsonb_build_object(
    'success', true,
    'catalogRevision', v_portal.catalog_revision,
    'items', coalesce(v_items, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'hasMore', case
        when v_plan_limit >= 0 then (v_offset + v_effective_limit) < least(v_count, v_plan_limit)
        else (v_offset + v_effective_limit) < v_count
      end
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$$;

-- Conserva la firma publica anterior sin cambio destructivo.
create or replace function public.ecommerce_get_catalog(
  p_slug text,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select public.ecommerce_get_catalog(p_slug, p_limit, p_offset, null::bigint);
$$;

-- ---------------------------------------------------------------------------
-- Grants: solo ejecucion de RPC, nunca acceso directo a tablas ecommerce
-- ---------------------------------------------------------------------------

revoke all on function private.ecommerce_normalize_sync_config(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_product_public_signature(public.ecommerce_published_products) from public, anon, authenticated;
revoke all on function private.ecommerce_published_product_sync_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_bump_catalog_revision_on_product_change() from public, anon, authenticated;

grant execute on function private.ecommerce_normalize_sync_config(jsonb, jsonb) to service_role;
grant execute on function private.ecommerce_product_public_signature(public.ecommerce_published_products) to service_role;
grant execute on function private.ecommerce_published_product_sync_guard() to service_role;
grant execute on function private.ecommerce_bump_catalog_revision_on_product_change() to service_role;

revoke all on function public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_sync_published_catalog(text, text, text, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_sync_published_catalog(text, text, text, text, jsonb, text, bigint) to anon, authenticated, service_role;

revoke all on function public.ecommerce_get_portal_by_slug(text) from public, anon, authenticated;
grant execute on function public.ecommerce_get_portal_by_slug(text) to anon, authenticated, service_role;

revoke all on function public.ecommerce_get_catalog(text, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.ecommerce_get_catalog(text, integer, integer) from public, anon, authenticated;
grant execute on function public.ecommerce_get_catalog(text, integer, integer, bigint) to anon, authenticated, service_role;
grant execute on function public.ecommerce_get_catalog(text, integer, integer) to anon, authenticated, service_role;

revoke all on table public.ecommerce_portals from public, anon, authenticated;
revoke all on table public.ecommerce_published_products from public, anon, authenticated;
