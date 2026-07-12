-- ECOM.FE.CATALOG.3.1 - Pruebas de los bloqueantes residuales.
-- Ejecutar solo en una base local o transaccional segura con las migraciones aplicadas.

begin;

DO $$
declare
  v_confirmed_hash text;
  v_unverified_same text;
  v_unverified_old text;
  v_definition text;
  v_guard_definition text;
  v_license_id uuid;
  v_portal_id uuid;
  v_product_id uuid;
  v_suffix text;
  v_saved public.ecommerce_published_products%rowtype;
begin
  v_confirmed_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:10',
      'sourceState', 'in_stock',
      'sourceAvailable', true,
      'stockSnapshot', 5,
      'fields', jsonb_build_object('price', 50)
    )
  );

  v_unverified_same := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:10',
      'sourceState', 'unverified',
      'sourceAvailable', null,
      'stockSnapshot', null,
      'fields', jsonb_build_object('price', 50)
    )
  );

  v_unverified_old := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:9',
      'sourceState', 'unverified',
      'sourceAvailable', null,
      'stockSnapshot', null,
      'fields', jsonb_build_object('price', 49)
    )
  );

  if v_confirmed_hash like 'unverified:%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: confirmed payload received technical hash';
  end if;

  if v_unverified_same not like 'unverified:%'
     or v_unverified_old not like 'unverified:%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: unverified payload was not marked';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 10, 'version:10', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: same revision unverified was intercepted as conflict';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 9, 'version:9', v_unverified_old
  ) <> 'stale' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: old unverified revision was not rejected as stale';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 11, 'version:11', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: newer unverified revision was not accepted fail-closed';
  end if;

  if private.ecommerce_source_revision_decision(
    'opaque', null, 'opaque:device-a', v_confirmed_hash,
    'opaque', null, 'opaque:device-a', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: same opaque revision unverified was not accepted';
  end if;

  if private.ecommerce_source_revision_decision(
    'opaque', null, 'opaque:device-a', v_confirmed_hash,
    'opaque', null, 'opaque:device-b', v_unverified_same
  ) <> 'conflict' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: different opaque revision bypassed review';
  end if;

  select l.id into v_license_id
  from public.licenses l
  limit 1;

  if v_license_id is null then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: local fixture requires one license';
  end if;

  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id
    and p.deleted_at is null
  limit 1;

  v_suffix := substring(md5(clock_timestamp()::text || random()::text), 1, 12);
  if v_portal_id is null then
    insert into public.ecommerce_portals (license_id, slug, name, status)
    values (
      v_license_id,
      'catalog3-residual-' || v_suffix,
      'Catalog 3 residual test',
      'draft'
    ) returning id into v_portal_id;
  end if;

  insert into public.ecommerce_published_products (
    portal_id,
    license_id,
    source_type,
    local_product_ref,
    public_name,
    public_description,
    category_name,
    price,
    image_url,
    is_published,
    is_available,
    manual_available,
    source_available,
    display_order,
    track_stock,
    stock_mode,
    stock_snapshot,
    stock_updated_at,
    sync_config,
    source_state,
    sync_status,
    source_revision,
    source_revision_kind,
    source_revision_order,
    source_payload_hash
  ) values (
    v_portal_id,
    v_license_id,
    'local_snapshot',
    'catalog3-residual-product-' || v_suffix,
    'Nombre confirmado',
    'Descripcion confirmada',
    'Categoria confirmada',
    50,
    'https://example.com/confirmed.jpg',
    true,
    true,
    true,
    true,
    0,
    true,
    'exact',
    5,
    now(),
    jsonb_build_object(
      'name', 'source',
      'description', 'source',
      'category', 'source',
      'price', 'source',
      'image', 'source'
    ),
    'in_stock',
    'synced',
    'version:10',
    'version',
    10,
    v_confirmed_hash
  ) returning id into v_product_id;

  update public.ecommerce_published_products
  set public_name = 'Nombre obsoleto',
      public_description = 'Descripcion obsoleta',
      category_name = 'Categoria obsoleta',
      price = 1,
      image_url = 'https://example.com/stale.jpg',
      source_available = false,
      stock_snapshot = 0,
      stock_updated_at = now() + interval '1 minute',
      source_revision = 'version:10',
      source_revision_kind = 'version',
      source_revision_order = 10,
      source_payload_hash = v_unverified_same,
      source_state = 'unverified',
      sync_status = 'review',
      sync_error_code = 'SOURCE_UNVERIFIED'
  where id = v_product_id
  returning * into v_saved;

  if v_saved.public_name <> 'Nombre confirmado'
     or v_saved.public_description <> 'Descripcion confirmada'
     or v_saved.category_name <> 'Categoria confirmada'
     or v_saved.price <> 50
     or v_saved.image_url <> 'https://example.com/confirmed.jpg'
     or v_saved.source_available is not true
     or v_saved.stock_snapshot <> 5
     or v_saved.source_revision <> 'version:10'
     or v_saved.source_revision_kind <> 'version'
     or v_saved.source_revision_order <> 10
     or v_saved.source_payload_hash <> v_confirmed_hash
     or v_saved.is_available is not true
     or v_saved.source_state <> 'unverified'
     or v_saved.sync_status <> 'review'
     or v_saved.sync_error_code <> 'SOURCE_UNVERIFIED' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: unverified update changed the confirmed snapshot';
  end if;

  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_admin_sync_published_catalog'
    and pg_get_function_identity_arguments(p.oid) like '%p_expected_catalog_revision bigint%'
  limit 1;

  if v_definition is null
     or v_definition not like '%ecommerce_projection_payload_hash%'
     or v_definition not like '%ecommerce_source_revision_decision%'
     or v_definition not like '%when v_source_state = ''unverified'' or v_source_available is null%then pp.source_available%'
     or v_definition not like '%when v_source_state = ''unverified'' or v_stock_snapshot is null%then pp.stock_snapshot%'
     or v_definition not like '%when v_source_state = ''unverified'' then pp.source_revision%'
     or v_definition not like '%when v_source_state = ''unverified'' then pp.source_payload_hash%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: RPC no longer preserves confirmed unverified snapshot';
  end if;

  select pg_get_functiondef(p.oid) into v_guard_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'ecommerce_published_product_sync_guard'
  limit 1;

  if v_guard_definition is null
     or v_guard_definition not like '%new.source_state = ''unverified''%'
     or v_guard_definition not like '%new.public_name := old.public_name%'
     or v_guard_definition not like '%new.public_description := old.public_description%'
     or v_guard_definition not like '%new.category_name := old.category_name%'
     or v_guard_definition not like '%new.price := old.price%'
     or v_guard_definition not like '%new.image_url := old.image_url%'
     or v_guard_definition not like '%new.source_available := old.source_available%'
     or v_guard_definition not like '%new.stock_snapshot := old.stock_snapshot%'
     or v_guard_definition not like '%new.source_revision := old.source_revision%'
     or v_guard_definition not like '%new.source_payload_hash := old.source_payload_hash%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: unverified trigger does not preserve confirmed fields';
  end if;
end;
$$;

rollback;
