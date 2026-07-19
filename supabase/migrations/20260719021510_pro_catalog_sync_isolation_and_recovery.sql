-- Keep the catalog projection atomic per product while isolating configuration
-- persistence. A malformed configuration must be visible as review/invalid,
-- not roll back valid projections in the same idempotent batch.
create or replace function public.ecommerce_admin_sync_published_catalog_v2(
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
set search_path = ''
as $$
declare
  v_legacy_projections jsonb;
  v_full_hash text;
  v_key_hash text;
  v_internal_key text;
  v_envelope_key text;
  v_result jsonb;
  v_final_result jsonb;
  v_result_item jsonb;
  v_projection jsonb;
  v_product public.ecommerce_published_products%rowtype;
  v_configuration_result jsonb;
  v_configuration_failure jsonb;
  v_final_results jsonb := '[]'::jsonb;
  v_configuration_updated_count integer := 0;
  v_updated_count integer := 0;
  v_skipped_count integer := 0;
  v_review_count integer := 0;
  v_stale_count integer := 0;
  v_conflict_count integer := 0;
  v_catalog_revision bigint;
  v_license_id uuid;
  v_portal_id uuid;
  v_existing private.ecommerce_catalog_sync_requests%rowtype;
  v_status text;
  v_code text;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections) < 1
     or jsonb_array_length(p_projections) > 200
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 240 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_projections) item
    where jsonb_typeof(item) <> 'object'
       or not (item ?& array[
         'publishedProductId', 'localProductRef', 'sourceRevision', 'sourceState',
         'sourceAvailable', 'stockSnapshot', 'fields', 'configuration', 'configurationSourceRevision'
       ])
       or (item - array[
         'publishedProductId', 'localProductRef', 'sourceRevision', 'sourceState',
         'sourceAvailable', 'stockSnapshot', 'fields', 'configuration', 'configurationSourceRevision'
       ]) <> '{}'::jsonb
       or jsonb_typeof(item->'configuration') not in ('object', 'null')
       or jsonb_typeof(item->'configurationSourceRevision') not in ('string', 'null')
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD', 'La proyeccion contiene campos no permitidos.');
  end if;

  select jsonb_agg(value - array['configuration', 'configurationSourceRevision'] order by ordinality)
  into v_legacy_projections
  from jsonb_array_elements(p_projections) with ordinality;

  v_full_hash := encode(extensions.digest(p_projections::text, 'sha256'), 'hex');
  v_key_hash := encode(extensions.digest(p_idempotency_key, 'sha256'), 'hex');
  v_internal_key := 'cfgv2-inner:' || v_key_hash;
  v_envelope_key := 'cfgv2:' || v_key_hash;

  v_result := public.ecommerce_admin_sync_published_catalog(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_legacy_projections, v_internal_key, p_expected_catalog_revision
  );
  if coalesce((v_result->>'success')::boolean, false) is false then return v_result; end if;

  select p.license_id, p.portal_id into v_license_id, v_portal_id
  from public.ecommerce_published_products p
  where p.id::text = p_projections->0->>'publishedProductId'
    and p.deleted_at is null;
  if v_license_id is null or v_portal_id is null then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;

  select r.* into v_existing
  from private.ecommerce_catalog_sync_requests r
  where r.license_id = v_license_id and r.portal_id = v_portal_id and r.idempotency_key = v_envelope_key
  limit 1;
  if v_existing.idempotency_key is not null then
    if v_existing.request_hash <> v_full_hash then
      return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT', 'La llave idempotente ya fue utilizada con otro contenido.');
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  v_updated_count := coalesce((v_result->>'updatedCount')::integer, 0);
  v_skipped_count := coalesce((v_result->>'skippedCount')::integer, 0);
  v_review_count := coalesce((v_result->>'reviewCount')::integer, 0);
  v_stale_count := coalesce((v_result->>'staleCount')::integer, 0);
  v_conflict_count := coalesce((v_result->>'conflictCount')::integer, 0);

  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'results', '[]'::jsonb))
  loop
    select value into v_projection
    from jsonb_array_elements(p_projections)
    where value->>'publishedProductId' = v_result_item->>'publishedProductId'
    limit 1;
    v_result_item := v_result_item || jsonb_build_object('localProductRef', v_projection->>'localProductRef');

    if not (
      v_result_item->>'status' in ('updated', 'idempotent')
      or (v_result_item->>'status' = 'review' and not (v_result_item ? 'code'))
    ) or jsonb_typeof(v_projection->'configuration') <> 'object' then
      v_final_results := v_final_results || jsonb_build_array(v_result_item);
      continue;
    end if;

    select p.* into v_product
    from public.ecommerce_published_products p
    where p.id::text = v_result_item->>'publishedProductId'
      and p.license_id = v_license_id and p.portal_id = v_portal_id and p.deleted_at is null
    for update;

    begin
      v_configuration_result := private.ecommerce_apply_product_configuration_checked(
        v_product.license_id, v_product.id, v_projection->'configuration',
        v_projection->>'configurationSourceRevision',
        v_result_item->>'status' in ('updated', 'review')
      );
      if coalesce((v_configuration_result->>'success')::boolean, false) is false then
        raise exception '%', coalesce(v_configuration_result->>'code', 'ECOMMERCE_CONFIGURATION_SYNC_FAILED');
      end if;
      v_configuration_updated_count := v_configuration_updated_count + 1;
      v_final_results := v_final_results || jsonb_build_array(v_result_item);
    exception when others then
      -- This block is a savepoint: failed child writes are undone while the
      -- already accepted base projection and all sibling products remain valid.
      v_configuration_failure := private.ecommerce_configuration_error_from_message(sqlerrm);
      v_code := coalesce(v_configuration_failure->>'code', 'ECOMMERCE_CONFIGURATION_SYNC_FAILED');
      v_status := case
        when v_code = 'ECOMMERCE_CATALOG_SOURCE_STALE' then 'stale'
        when v_code = 'ECOMMERCE_CATALOG_SOURCE_CONFLICT' then 'conflict'
        else 'invalid'
      end;
      if v_result_item->>'status' = 'updated' then v_updated_count := greatest(v_updated_count - 1, 0); end if;
      if v_result_item->>'status' = 'idempotent' then v_skipped_count := greatest(v_skipped_count - 1, 0); end if;
      if v_result_item->>'status' = 'review' then v_review_count := greatest(v_review_count - 1, 0); end if;
      if v_status = 'stale' then v_stale_count := v_stale_count + 1;
      elsif v_status = 'conflict' then v_conflict_count := v_conflict_count + 1;
      else v_review_count := v_review_count + 1;
      end if;
      update public.ecommerce_published_products p
      set sync_status = 'review', sync_error_code = v_code, last_sync_attempt_at = now()
      where p.id = v_product.id;
      v_final_results := v_final_results || jsonb_build_array(
        (v_result_item - array['status', 'code', 'message']) || jsonb_build_object(
          'status', v_status, 'code', v_code,
          'message', coalesce(v_configuration_failure->>'message', 'No se pudo sincronizar la configuracion del producto.')
        )
      );
    end;
  end loop;

  select p.catalog_revision into v_catalog_revision from public.ecommerce_portals p where p.id = v_portal_id;
  v_final_result := v_result || jsonb_build_object(
    'results', v_final_results,
    'updatedCount', v_updated_count,
    'skippedCount', v_skipped_count,
    'reviewCount', v_review_count,
    'staleCount', v_stale_count,
    'conflictCount', v_conflict_count,
    'configurationUpdatedCount', v_configuration_updated_count,
    'catalogRevision', coalesce(v_catalog_revision, (v_result->>'catalogRevision')::bigint)
  );
  insert into private.ecommerce_catalog_sync_requests(license_id, portal_id, idempotency_key, request_hash, response)
  values (v_license_id, v_portal_id, v_envelope_key, v_full_hash, v_final_result);
  return v_final_result;
exception when unique_violation then
  select r.* into v_existing from private.ecommerce_catalog_sync_requests r
  where r.license_id = v_license_id and r.portal_id = v_portal_id and r.idempotency_key = v_envelope_key;
  if v_existing.request_hash = v_full_hash then return v_existing.response || jsonb_build_object('idempotent', true); end if;
  return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT', 'La llave idempotente ya fue utilizada con otro contenido.');
when others then
  return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$$;

comment on function public.ecommerce_admin_sync_published_catalog_v2(text,text,text,text,jsonb,text,bigint) is
  'Sincroniza catalogo Pro por lote idempotente. Fallos de configuracion se aislan por producto y devuelven resultados accionables sin revertir productos validos.';
