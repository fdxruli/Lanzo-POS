-- ECOM.FE.CATALOG.3.1 - RPC de sincronizacion con revision e idempotencia completa.
-- Depende de 20260712210000_ecom_fe_catalog_3_1_source_revision_schema.sql.
-- No aplicar a produccion durante la revision del PR.

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
  v_revision jsonb;
  v_revision_normalized text;
  v_revision_kind text;
  v_revision_order numeric;
  v_payload_hash text;
  v_decision text;
  v_public_before jsonb;
  v_public_after jsonb;
  v_updated_count integer := 0;
  v_skipped_count integer := 0;
  v_review_count integer := 0;
  v_stale_count integer := 0;
  v_conflict_count integer := 0;
  v_results jsonb := '[]'::jsonb;
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
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD',
      'La proyeccion del catalogo no es valida.'
    );
  end if;
  v_batch_size := jsonb_array_length(p_projections);
  if v_batch_size < 1 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_EMPTY', 'No hay productos para sincronizar.');
  end if;
  if v_batch_size > 200 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_BATCH_TOO_LARGE', 'El lote supera 200 productos.');
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 240 then
    return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select p.* into v_portal
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1 for update;
  if v_portal.id is null then return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;

  -- jsonb::text ofrece orden estable de propiedades; el orden del array ya es estable en el cliente.
  v_request_hash := encode(extensions.digest(p_projections::text, 'sha256'), 'hex');
  select r.* into v_existing_request
  from private.ecommerce_catalog_sync_requests r
  where r.license_id = v_license_id
    and r.portal_id = v_portal.id
    and r.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing_request.idempotency_key is not null then
    if v_existing_request.request_hash <> v_request_hash then
      return private.ecommerce_admin_error(
        'ECOMMERCE_IDEMPOTENCY_CONFLICT',
        'La llave idempotente ya fue utilizada con otro lote.'
      );
    end if;
    return v_existing_request.response || jsonb_build_object(
      'idempotent', true,
      'catalogRevision', v_portal.catalog_revision
    );
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
       or not (item ?& array[
         'publishedProductId', 'localProductRef', 'sourceRevision',
         'sourceState', 'sourceAvailable', 'stockSnapshot', 'fields'
       ])
       or (item - array[
         'publishedProductId', 'localProductRef', 'sourceRevision',
         'sourceState', 'sourceAvailable', 'stockSnapshot', 'fields'
       ]) <> '{}'::jsonb
       or coalesce(jsonb_typeof(item->'fields'), '') <> 'object'
       or ((item->'fields') - array['name', 'description', 'category', 'price', 'image']) <> '{}'::jsonb
  ) then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD',
      'La proyeccion contiene campos no permitidos.'
    );
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
       or (item ? 'sourceRevision' and jsonb_typeof(item->'sourceRevision') not in ('string', 'null'))
       or jsonb_typeof(item->'sourceAvailable') not in ('boolean', 'null')
       or jsonb_typeof(item->'stockSnapshot') not in ('number', 'null')
       or (item->'fields' ? 'name' and jsonb_typeof(item#>'{fields,name}') not in ('string', 'null'))
       or (item->'fields' ? 'description' and jsonb_typeof(item#>'{fields,description}') not in ('string', 'null'))
       or (item->'fields' ? 'category' and jsonb_typeof(item#>'{fields,category}') not in ('string', 'null'))
       or (item->'fields' ? 'price' and jsonb_typeof(item#>'{fields,price}') not in ('number', 'null'))
       or (item->'fields' ? 'image' and jsonb_typeof(item#>'{fields,image}') not in ('string', 'null'))
       or (
         item->>'sourceState' = 'unverified'
         and (
           jsonb_typeof(item->'sourceAvailable') <> 'null'
           or jsonb_typeof(item->'stockSnapshot') <> 'null'
         )
       )
       or (
         item->>'sourceState' in ('source_missing', 'inactive_source')
         and (
           item->'sourceAvailable' <> 'false'::jsonb
           or jsonb_typeof(item->'stockSnapshot') <> 'null'
         )
       )
       or (
         item->>'sourceState' = 'not_tracked'
         and (
           item->'sourceAvailable' <> 'true'::jsonb
           or jsonb_typeof(item->'stockSnapshot') <> 'null'
         )
       )
       or (
         item->>'sourceState' = 'in_stock'
         and (
           item->'sourceAvailable' <> 'true'::jsonb
           or jsonb_typeof(item->'stockSnapshot') <> 'number'
           or (item->>'stockSnapshot')::numeric <= 0
         )
       )
       or (
         item->>'sourceState' = 'out_of_stock'
         and (
           item->'sourceAvailable' <> 'false'::jsonb
           or jsonb_typeof(item->'stockSnapshot') <> 'number'
           or (item->>'stockSnapshot')::numeric <> 0
         )
       )
  ) then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD',
      'La proyeccion contiene valores no validos.'
    );
  end if;

  if (
    select count(*) <> count(distinct item->>'publishedProductId')
      or count(*) <> count(distinct item->>'localProductRef')
    from jsonb_array_elements(p_projections) item
  ) then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_DUPLICATE_REF',
      'El lote contiene referencias duplicadas.'
    );
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
    return private.ecommerce_admin_error(
      'ECOMMERCE_PRODUCT_NOT_FOUND',
      'Una referencia no pertenece al portal autorizado.'
    );
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_projections)
    order by value->>'publishedProductId', value->>'localProductRef'
  loop
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
    v_revision := private.ecommerce_parse_source_revision(v_item->>'sourceRevision');
    v_revision_normalized := nullif(v_revision->>'normalized', '');
    v_revision_kind := nullif(v_revision->>'kind', '');
    v_revision_order := nullif(v_revision->>'order', '')::numeric;
    v_payload_hash := private.ecommerce_projection_payload_hash(v_item);
    v_decision := private.ecommerce_source_revision_decision(
      v_product.source_revision_kind,
      v_product.source_revision_order,
      v_product.source_revision,
      v_product.source_payload_hash,
      v_revision_kind,
      v_revision_order,
      v_revision_normalized,
      v_payload_hash
    );

    if v_decision = 'stale' then
      update public.ecommerce_published_products pp
      set sync_status = 'review',
          sync_error_code = 'ECOMMERCE_CATALOG_SOURCE_STALE',
          last_sync_attempt_at = now()
      where pp.id = v_product.id;
      v_stale_count := v_stale_count + 1;
      v_review_count := v_review_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status', 'stale',
        'publishedProductId', v_product.id,
        'code', 'ECOMMERCE_CATALOG_SOURCE_STALE'
      ));
      continue;
    end if;

    if v_decision = 'conflict' then
      update public.ecommerce_published_products pp
      set sync_status = 'review',
          sync_error_code = 'ECOMMERCE_CATALOG_SOURCE_CONFLICT',
          last_sync_attempt_at = now()
      where pp.id = v_product.id;
      v_conflict_count := v_conflict_count + 1;
      v_review_count := v_review_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status', 'review',
        'publishedProductId', v_product.id,
        'code', 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'
      ));
      continue;
    end if;

    if v_decision = 'idempotent' then
      update public.ecommerce_published_products pp
      set last_sync_attempt_at = now()
      where pp.id = v_product.id;
      v_skipped_count := v_skipped_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status', 'idempotent',
        'publishedProductId', v_product.id
      ));
      continue;
    end if;

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
        source_revision = case
          when v_source_state = 'unverified' then pp.source_revision
          else v_revision_normalized
        end,
        source_revision_kind = case
          when v_source_state = 'unverified' then pp.source_revision_kind
          else v_revision_kind
        end,
        source_revision_order = case
          when v_source_state = 'unverified' then pp.source_revision_order
          else v_revision_order
        end,
        source_payload_hash = case
          when v_source_state = 'unverified' then pp.source_payload_hash
          else v_payload_hash
        end,
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
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'status', case when v_saved.sync_status = 'review' then 'review' else 'updated' end,
      'publishedProductId', v_saved.id
    ));
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
    'staleCount', v_stale_count,
    'conflictCount', v_conflict_count,
    'results', v_results,
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
      return v_existing_request.response || jsonb_build_object(
        'idempotent', true,
        'catalogRevision', coalesce(
          (select p.catalog_revision from public.ecommerce_portals p where p.id = v_portal.id),
          v_portal.catalog_revision
        )
      );
    end if;
    return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT');
  when others then
    return private.ecommerce_admin_error(
      'ECOMMERCE_CATALOG_SYNC_FAILED',
      'No se pudo sincronizar el catalogo publicado.'
    );
end;
$$;

revoke all on function public.ecommerce_admin_sync_published_catalog(
  text, text, text, text, jsonb, text, bigint
) from public;
grant execute on function public.ecommerce_admin_sync_published_catalog(
  text, text, text, text, jsonb, text, bigint
) to anon, authenticated, service_role;
