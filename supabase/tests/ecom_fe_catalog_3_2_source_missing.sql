-- ECOM.FE.CATALOG.3.2 - source_missing despues de una sincronizacion confirmada.
-- Ejecutar solo en una base local o transaccional segura con las migraciones aplicadas.

begin;

DO $$
declare
  v_confirmed_hash text;
  v_missing_null_hash text;
  v_missing_same_hash text;
  v_missing_old_hash text;
  v_reappeared_hash text;
  v_license_id uuid;
  v_portal_id uuid;
  v_product_id uuid;
  v_suffix text;
  v_saved public.ecommerce_published_products%rowtype;
  v_public jsonb;
begin
  v_confirmed_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'catalog3-2-product',
      'localProductRef', 'catalog3-2-local',
      'sourceRevision', 'version:10',
      'sourceState', 'in_stock',
      'sourceAvailable', true,
      'stockSnapshot', 5,
      'fields', jsonb_build_object(
        'name', 'Nombre confirmado',
        'description', 'Descripcion confirmada',
        'category', 'Categoria confirmada',
        'price', 50,
        'image', 'https://example.com/confirmed.jpg'
      )
    )
  );

  v_missing_null_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'catalog3-2-product',
      'localProductRef', 'catalog3-2-local',
      'sourceRevision', null,
      'sourceState', 'source_missing',
      'sourceAvailable', false,
      'stockSnapshot', null,
      'fields', '{}'::jsonb
    )
  );

  v_missing_same_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'catalog3-2-product',
      'localProductRef', 'catalog3-2-local',
      'sourceRevision', 'version:10',
      'sourceState', 'source_missing',
      'sourceAvailable', false,
      'stockSnapshot', null,
      'fields', '{}'::jsonb
    )
  );

  v_missing_old_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'catalog3-2-product',
      'localProductRef', 'catalog3-2-local',
      'sourceRevision', 'version:9',
      'sourceState', 'source_missing',
      'sourceAvailable', false,
      'stockSnapshot', null,
      'fields', '{}'::jsonb
    )
  );

  v_reappeared_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'catalog3-2-product',
      'localProductRef', 'catalog3-2-local',
      'sourceRevision', 'version:10',
      'sourceState', 'in_stock',
      'sourceAvailable', true,
      'stockSnapshot', 5,
      'fields', jsonb_build_object('price', 50)
    )
  );

  if v_missing_null_hash not like 'source-missing:%'
     or v_missing_same_hash not like 'source-missing:%'
     or v_missing_old_hash not like 'source-missing:%' then
    raise exception 'CATALOG3_2_TEST: source_missing payload was not marked';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    null, null, null, v_missing_null_hash
  ) <> 'apply' then
    raise exception 'CATALOG3_2_TEST: current null-revision absence was not applied';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 10, 'version:10', v_missing_same_hash
  ) <> 'apply' then
    raise exception 'CATALOG3_2_TEST: same-revision absence was not applied';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 9, 'version:9', v_missing_old_hash
  ) <> 'stale' then
    raise exception 'CATALOG3_2_TEST: older absence was not rejected as stale';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_missing_null_hash,
    'version', 10, 'version:10', v_reappeared_hash
  ) <> 'apply' then
    raise exception 'CATALOG3_2_TEST: confirmed source could not recover from source_missing';
  end if;

  select l.id into v_license_id
  from public.licenses l
  limit 1;

  if v_license_id is null then
    raise exception 'CATALOG3_2_TEST: local fixture requires one license';
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
      'catalog3-2-' || v_suffix,
      'Catalog 3.2 source missing test',
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
    sync_error_code,
    source_revision,
    source_revision_kind,
    source_revision_order,
    source_payload_hash
  ) values (
    v_portal_id,
    v_license_id,
    'local_snapshot',
    'catalog3-2-local-' || v_suffix,
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
    null,
    'version:10',
    'version',
    10,
    v_confirmed_hash
  ) returning id into v_product_id;

  -- Simula la rama de UPDATE de la RPC despues de que la decision devolvio apply.
  -- Los valores visuales deliberadamente incorrectos prueban que el guard solo
  -- permite aplicar el estado tecnico de ausencia.
  update public.ecommerce_published_products
  set public_name = 'Nombre que no debe aplicar',
      public_description = 'Descripcion que no debe aplicar',
      category_name = 'Categoria que no debe aplicar',
      price = 1,
      image_url = 'https://example.com/missing.jpg',
      source_available = false,
      stock_snapshot = null,
      stock_updated_at = now() + interval '1 minute',
      source_revision = null,
      source_revision_kind = null,
      source_revision_order = null,
      source_payload_hash = v_missing_null_hash,
      source_state = 'source_missing',
      sync_status = 'review',
      sync_error_code = 'SOURCE_MISSING'
  where id = v_product_id
  returning * into v_saved;

  if not exists (
    select 1 from public.ecommerce_published_products where id = v_product_id
  ) then
    raise exception 'CATALOG3_2_TEST: published row was deleted';
  end if;

  if v_saved.public_name <> 'Nombre confirmado'
     or v_saved.public_description <> 'Descripcion confirmada'
     or v_saved.category_name <> 'Categoria confirmada'
     or v_saved.price <> 50
     or v_saved.image_url <> 'https://example.com/confirmed.jpg' then
    raise exception 'CATALOG3_2_TEST: source_missing overwrote public fields';
  end if;

  if v_saved.source_state <> 'source_missing'
     or v_saved.source_available is not false
     or v_saved.is_available is not false
     or v_saved.sync_status <> 'review'
     or v_saved.sync_error_code <> 'SOURCE_MISSING' then
    raise exception 'CATALOG3_2_TEST: source_missing did not apply effective unavailability';
  end if;

  if v_saved.stock_snapshot <> 5
     or v_saved.source_revision <> 'version:10'
     or v_saved.source_revision_kind <> 'version'
     or v_saved.source_revision_order <> 10
     or v_saved.source_payload_hash <> v_missing_null_hash then
    raise exception 'CATALOG3_2_TEST: historical stock or revision protection is invalid';
  end if;

  if private.ecommerce_source_revision_decision(
    v_saved.source_revision_kind,
    v_saved.source_revision_order,
    v_saved.source_revision,
    v_saved.source_payload_hash,
    'version', 9, 'version:9', v_missing_old_hash
  ) <> 'stale' then
    raise exception 'CATALOG3_2_TEST: stale absence applied after source_missing';
  end if;

  v_public := private.ecommerce_product_public_jsonb(v_saved, true);
  if v_public#>>'{stock,mode}' <> 'hidden'
     or (v_public#>'{stock,quantity}') <> 'null'::jsonb
     or (v_public->>'isAvailable')::boolean is not false then
    raise exception 'CATALOG3_2_TEST: historical stock leaked to the public contract';
  end if;
end;
$$;

rollback;
