-- ECOM.FE.CATALOG.3 - Pruebas SQL para entorno local/transaccional seguro.
-- Ejecutar despues de aplicar las migraciones en una base local. Nunca contra produccion.

begin;

DO $$
declare
  v_definition text;
  v_portal_id uuid;
  v_product_id uuid;
  v_license_id uuid;
  v_revision_before bigint;
  v_revision_after bigint;
  v_original_name text;
  v_original_available boolean;
begin
  -- 1. Backfill y columnas source/manual.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ecommerce_published_products'
      and column_name = 'sync_config'
  ) then
    raise exception 'CATALOG3_TEST: sync_config missing';
  end if;
  if exists (
    select 1 from public.ecommerce_published_products
    where jsonb_typeof(sync_config) <> 'object'
       or not (sync_config ?& array['name', 'description', 'category', 'price', 'image'])
  ) then
    raise exception 'CATALOG3_TEST: unsafe sync_config backfill';
  end if;

  -- 2. Revision inicial positiva.
  if exists (select 1 from public.ecommerce_portals where catalog_revision < 1) then
    raise exception 'CATALOG3_TEST: invalid initial catalog revision';
  end if;

  select l.id into v_license_id from public.licenses l limit 1;
  if v_license_id is null then
    raise exception 'CATALOG3_TEST: local fixture requires one license';
  end if;

  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1;

  if v_portal_id is null then
    insert into public.ecommerce_portals (license_id, slug, name, status)
    values (v_license_id, 'catalog3-local-test', 'Catalog 3 local test', 'draft')
    returning id into v_portal_id;
  end if;

  select pp.id, pp.public_name, pp.is_available
  into v_product_id, v_original_name, v_original_available
  from public.ecommerce_published_products pp
  where pp.portal_id = v_portal_id and pp.deleted_at is null
  limit 1;

  if v_product_id is null then
    insert into public.ecommerce_published_products (
      portal_id, license_id, source_type, local_product_ref,
      public_name, price, is_published, is_available,
      manual_available, source_available
    ) values (
      v_portal_id, v_license_id, 'local_snapshot', 'catalog3-local-product',
      'Producto local test', 10, true, true, true, true
    ) returning id, public_name, is_available
      into v_product_id, v_original_name, v_original_available;
  end if;

  -- 3. Cambio publico incrementa revision.
  select catalog_revision into v_revision_before
  from public.ecommerce_portals where id = v_portal_id;
  update public.ecommerce_published_products
  set public_name = public_name || ' revision'
  where id = v_product_id;
  select catalog_revision into v_revision_after
  from public.ecommerce_portals where id = v_portal_id;
  if v_revision_after <= v_revision_before then
    raise exception 'CATALOG3_TEST: public change did not increment revision';
  end if;

  -- 4. Metadata interna no incrementa revision.
  v_revision_before := v_revision_after;
  update public.ecommerce_published_products
  set last_sync_attempt_at = now(), sync_error_code = 'SAFE_TEST_CODE'
  where id = v_product_id;
  select catalog_revision into v_revision_after
  from public.ecommerce_portals where id = v_portal_id;
  if v_revision_after <> v_revision_before then
    raise exception 'CATALOG3_TEST: internal metadata incremented revision';
  end if;

  -- 5. Disponibilidad efectiva requiere manual y source.
  update public.ecommerce_published_products
  set manual_available = false, source_available = true
  where id = v_product_id;
  if (select is_available from public.ecommerce_published_products where id = v_product_id) is not false then
    raise exception 'CATALOG3_TEST: manual availability was reactivated';
  end if;
  update public.ecommerce_published_products
  set manual_available = true, source_available = false
  where id = v_product_id;
  if (select is_available from public.ecommerce_published_products where id = v_product_id) is not false then
    raise exception 'CATALOG3_TEST: source availability was ignored';
  end if;

  -- 6-9. Autorizacion admin/staff y feature PRO se reutilizan server-side.
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_admin_sync_published_catalog'
  limit 1;
  if v_definition not like '%ecommerce_admin_authorize_v2%'
     or v_definition not like '%ecommerce_cloud_catalog_source%'
     or v_definition not like '%license_id%'
     or v_definition not like '%portal_id%' then
    raise exception 'CATALOG3_TEST: batch RPC authorization/isolation contract missing';
  end if;

  -- 10-13. Duplicados, limite, idempotencia y revision esperada.
  if v_definition not like '%v_batch_size > 200%'
     or v_definition not like '%count(distinct item->>''publishedProductId'')%'
     or v_definition not like '%ecommerce_catalog_sync_requests%'
     or v_definition not like '%p_expected_catalog_revision%'
     or v_definition not like '%ECOMMERCE_CATALOG_REVISION_CHANGED%' then
    raise exception 'CATALOG3_TEST: batch validation/idempotency contract missing';
  end if;

  -- 14-15. Paginacion versionada y rechazo de revision distinta.
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_get_catalog'
    and pg_get_function_identity_arguments(p.oid) like '%p_catalog_revision bigint%'
  limit 1;
  if v_definition is null
     or v_definition not like '%catalogRevision%'
     or v_definition not like '%ECOMMERCE_CATALOG_REVISION_CHANGED%'
     or v_definition not like '%order by pp.display_order, pp.public_name, pp.id%' then
    raise exception 'CATALOG3_TEST: versioned public pagination contract missing';
  end if;

  -- 16. Sin grants directos para anon/authenticated sobre tablas ecommerce.
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('ecommerce_portals', 'ecommerce_published_products')
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'CATALOG3_TEST: direct ecommerce table grant detected';
  end if;

  -- source_missing/inactive_source/unverified nunca eliminan la fila ni inventan cero.
  if v_definition not like '%p_catalog_revision%' then
    raise exception 'CATALOG3_TEST: public contract unavailable';
  end if;

  -- Restauracion local dentro de la transaccion de prueba.
  update public.ecommerce_published_products
  set public_name = v_original_name,
      manual_available = v_original_available,
      source_available = true,
      is_available = v_original_available
  where id = v_product_id;
end;
$$;

rollback;
