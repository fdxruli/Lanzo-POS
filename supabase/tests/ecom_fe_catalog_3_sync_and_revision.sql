-- ECOM.FE.CATALOG.3 / 3.1 - Pruebas SQL para entorno local o transaccional seguro.
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
  v_signature jsonb;
  v_public_product jsonb;
  v_hash_a text;
  v_hash_b text;
begin
  -- 1. Columnas source/manual y proteccion de revision.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecommerce_published_products'
      and column_name = 'sync_config'
  ) then
    raise exception 'CATALOG3_TEST: sync_config missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecommerce_published_products'
      and column_name in ('source_revision_kind', 'source_revision_order', 'source_payload_hash')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'CATALOG3_TEST: source revision guard columns missing';
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

  -- 3. Normalizacion de revisiones comparables y opacas.
  if private.ecommerce_parse_source_revision('version:10')->>'kind' <> 'version'
     or (private.ecommerce_parse_source_revision('version:10')->>'order')::numeric <> 10 then
    raise exception 'CATALOG3_TEST: numeric revision normalization failed';
  end if;
  if private.ecommerce_parse_source_revision('timestamp:1783872000000')->>'kind' <> 'timestamp'
     or (private.ecommerce_parse_source_revision('timestamp:1783872000000')->>'order')::numeric <> 1783872000000 then
    raise exception 'CATALOG3_TEST: timestamp revision normalization failed';
  end if;
  if private.ecommerce_parse_source_revision('legacy-local')->>'kind' <> 'opaque' then
    raise exception 'CATALOG3_TEST: opaque revision normalization failed';
  end if;

  -- 4-8. Reglas de concurrencia entre dispositivos.
  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', 'hash-a',
    'version', 9, 'version:9', 'hash-b'
  ) <> 'stale' then
    raise exception 'CATALOG3_TEST: revision 9 overwrote revision 10';
  end if;
  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', 'hash-a',
    'version', 10, 'version:10', 'hash-a'
  ) <> 'idempotent' then
    raise exception 'CATALOG3_TEST: equal revision/equal payload is not idempotent';
  end if;
  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', 'hash-a',
    'version', 10, 'version:10', 'hash-b'
  ) <> 'conflict' then
    raise exception 'CATALOG3_TEST: equal revision/different payload was accepted';
  end if;
  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', 'hash-a',
    'version', 11, 'version:11', 'hash-b'
  ) <> 'apply' then
    raise exception 'CATALOG3_TEST: revision 11 did not update revision 10';
  end if;
  if private.ecommerce_source_revision_decision(
    'opaque', null, 'opaque:device-a', 'hash-a',
    'opaque', null, 'opaque:device-b', 'hash-b'
  ) <> 'conflict' then
    raise exception 'CATALOG3_TEST: incomparable device revisions were accepted';
  end if;

  -- 9. Hash JSONB estable por orden de propiedades y sensible al contenido completo.
  v_hash_a := private.ecommerce_projection_payload_hash(
    '{"publishedProductId":"1","stockSnapshot":5,"fields":{"price":50}}'::jsonb
  );
  if v_hash_a <> private.ecommerce_projection_payload_hash(
    '{"fields":{"price":50},"stockSnapshot":5,"publishedProductId":"1"}'::jsonb
  ) then
    raise exception 'CATALOG3_TEST: property order changed semantic hash';
  end if;
  v_hash_b := private.ecommerce_projection_payload_hash(
    '{"publishedProductId":"1","stockSnapshot":4,"fields":{"price":50}}'::jsonb
  );
  if v_hash_a = v_hash_b then
    raise exception 'CATALOG3_TEST: stock-only change did not change hash';
  end if;
  if v_hash_a = private.ecommerce_projection_payload_hash(
    '{"publishedProductId":"1","stockSnapshot":5,"fields":{"price":55}}'::jsonb
  ) then
    raise exception 'CATALOG3_TEST: price-only change did not change hash';
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

  -- 10. Cambio publico incrementa revision.
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

  -- 11. Metadata interna no incrementa revision.
  v_revision_before := v_revision_after;
  update public.ecommerce_published_products
  set last_sync_attempt_at = now(), sync_error_code = 'SAFE_TEST_CODE'
  where id = v_product_id;
  select catalog_revision into v_revision_after
  from public.ecommerce_portals where id = v_portal_id;
  if v_revision_after <> v_revision_before then
    raise exception 'CATALOG3_TEST: internal metadata incremented revision';
  end if;

  -- 12. Disponibilidad efectiva requiere manual y source.
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

  -- 13. not_tracked fuerza stock oculto.
  update public.ecommerce_published_products
  set source_state = 'not_tracked', stock_mode = 'exact', stock_snapshot = 9
  where id = v_product_id;
  if exists (
    select 1 from public.ecommerce_published_products
    where id = v_product_id
      and (stock_mode <> 'hidden' or stock_snapshot is not null or track_stock is true)
  ) then
    raise exception 'CATALOG3_TEST: not_tracked did not force hidden stock';
  end if;

  -- 14. unverified/source_missing/inactive_source no inventan cantidad cero publica.
  update public.ecommerce_published_products
  set source_state = 'unverified', stock_mode = 'exact', stock_snapshot = 0
  where id = v_product_id;
  select private.ecommerce_product_public_signature(pp)
  into v_signature
  from public.ecommerce_published_products pp
  where pp.id = v_product_id;
  if v_signature#>>'{stock,mode}' <> 'hidden'
     or v_signature#>'{stock,quantity}' <> 'null'::jsonb then
    raise exception 'CATALOG3_TEST: unverified signature exposed invented stock';
  end if;
  select private.ecommerce_product_public_jsonb(pp, true)
  into v_public_product
  from public.ecommerce_published_products pp
  where pp.id = v_product_id;
  if v_public_product#>>'{stock,mode}' <> 'hidden'
     or v_public_product#>'{stock,quantity}' <> 'null'::jsonb then
    raise exception 'CATALOG3_TEST: unverified public catalog exposed invented stock';
  end if;

  -- 15. RPC batch conserva autorizacion, aislamiento, row locks y resultados stale/conflict.
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_admin_sync_published_catalog'
    and pg_get_function_identity_arguments(p.oid) like '%p_expected_catalog_revision bigint%'
  limit 1;
  if v_definition is null
     or v_definition not like '%ecommerce_admin_authorize_v2%'
     or v_definition not like '%ecommerce_cloud_catalog_source%'
     or v_definition not like '%for update%'
     or v_definition not like '%ecommerce_source_revision_decision%'
     or v_definition not like '%ECOMMERCE_CATALOG_SOURCE_STALE%'
     or v_definition not like '%ECOMMERCE_CATALOG_SOURCE_CONFLICT%'
     or v_definition not like '%staleCount%'
     or v_definition not like '%conflictCount%'
     or v_definition not like '%source_payload_hash%'
     or v_definition not like '%when v_source_state = ''unverified'' then pp.source_revision%'
     or v_definition not like '%v_fields ? ''category''%'
     or v_definition not like '%p_expected_catalog_revision%'
     or v_definition not like '%ECOMMERCE_IDEMPOTENCY_CONFLICT%' then
    raise exception 'CATALOG3_TEST: batch concurrency/idempotency contract missing';
  end if;

  -- 16. Upsert valida stock mode y feature server-side.
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_admin_upsert_published_product'
  limit 1;
  if v_definition is null
     or v_definition not like '%ecommerce_stock_visibility%'
     or v_definition not like '%(''hidden'', ''status'', ''exact'')%'
     or v_definition not like '%v_stock_mode := ''hidden''%' then
    raise exception 'CATALOG3_TEST: server-side stock mode validation missing';
  end if;

  -- 17. Paginacion publica versionada y determinista.
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

  -- 18. Helpers SECURITY DEFINER privados no quedan ejecutables por clientes.
  if has_function_privilege('anon', 'private.ecommerce_parse_source_revision(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_projection_payload_hash(jsonb)', 'EXECUTE')
     or has_function_privilege(
       'anon',
       'private.ecommerce_source_revision_decision(text,numeric,text,text,text,numeric,text,text)',
       'EXECUTE'
     ) then
    raise exception 'CATALOG3_TEST: private helper grant detected';
  end if;

  -- 19. Sin grants directos sobre tablas ecommerce.
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('ecommerce_portals', 'ecommerce_published_products')
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'CATALOG3_TEST: direct ecommerce table grant detected';
  end if;

  -- Restauracion local dentro de la transaccion de prueba.
  update public.ecommerce_published_products
  set public_name = v_original_name,
      manual_available = v_original_available,
      source_available = true,
      is_available = v_original_available,
      source_state = 'manual',
      sync_status = 'manual',
      sync_error_code = null,
      stock_mode = 'hidden',
      stock_snapshot = null,
      source_revision = null,
      source_revision_kind = null,
      source_revision_order = null,
      source_payload_hash = null
  where id = v_product_id;
end;
$$;

rollback;
