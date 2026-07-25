-- ECOM.SIMPLE.OVERRIDE.AUTO.SYNC.RECONCILIATION.1
-- Keep automatic catalog sync aligned with an already persisted administrator
-- decision to publish a product without restaurant option groups. The exception
-- is limited to group-free payloads at the current canonical parent revision.

CREATE OR REPLACE FUNCTION private.ecommerce_apply_product_configuration_checked(p_license_id uuid, p_published_product_id uuid, p_configuration jsonb, p_source_revision text DEFAULT NULL::text, p_revision_already_applied boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_source_product public.pos_products%rowtype;
  v_result jsonb;
  v_incoming_revision jsonb;
  v_current_revision jsonb;
  v_canonical_revision jsonb;
  v_incoming_hash text;
  v_current_hash text;
  v_incoming_normalized text;
  v_current_normalized text;
  v_canonical_normalized text;
  v_canonical_source text;
  v_decision text;
  v_incoming_is_content_revision boolean := false;
  v_allow_same_revision_reconciliation boolean := false;
  v_allow_persisted_simple_override_reconciliation boolean := false;
begin
  if private.ecommerce_lock_configuration_writer(
    p_license_id,
    p_published_product_id
  ) is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null
  for update;
  if v_product.id is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;

  select p.* into v_source_product
  from public.pos_products p
  where p.license_id = p_license_id
    and p.id = v_product.local_product_ref
    and p.deleted_at is null
  limit 1;

  if v_source_product.id is not null then
    v_canonical_source := case
      when coalesce(v_source_product.server_version, 0) > 0
        then 'version:' || v_source_product.server_version::text
      when v_source_product.updated_at is not null
        then 'timestamp:' || floor(extract(epoch from v_source_product.updated_at) * 1000)::bigint::text
      else null
    end;
  end if;

  v_incoming_hash := encode(extensions.digest(p_configuration::text, 'sha256'), 'hex');
  v_current_hash := nullif(v_product.metadata->>'ecommerce_configuration_payload_hash', '');
  v_incoming_revision := private.ecommerce_parse_source_revision(p_source_revision);
  v_current_revision := private.ecommerce_parse_source_revision(
    v_product.metadata->>'ecommerce_configuration_source_revision'
  );
  v_canonical_revision := private.ecommerce_parse_source_revision(v_canonical_source);
  v_incoming_normalized := nullif(v_incoming_revision->>'normalized', '');
  v_current_normalized := nullif(v_current_revision->>'normalized', '');
  v_canonical_normalized := nullif(v_canonical_revision->>'normalized', '');
  v_incoming_is_content_revision := (
    nullif(v_incoming_revision->>'kind', '') = 'opaque'
    and v_incoming_normalized like 'opaque:configuration:%'
  );

  -- Only the v3 explicit "publish without extras" path may reconcile a
  -- configuration whose payload changed at the exact canonical parent revision.
  -- Automatic/background writers never set this transaction-local intent.
  v_allow_same_revision_reconciliation := (
    coalesce(current_setting('app.ecommerce_simple_override_reconcile', true), '') = 'true'
    and v_canonical_normalized is not null
    and v_current_normalized is not null
    and v_incoming_normalized = v_canonical_normalized
    and v_current_normalized = v_incoming_normalized
  );

  -- The background v3 path can reconcile a changed, group-free configuration
  -- only for a product that is already persisted as an explicit simple override.
  -- It remains bound to the current canonical parent revision.
  v_allow_persisted_simple_override_reconciliation := (
    coalesce(current_setting('app.ecommerce_persisted_simple_override_sync', true), '') = 'true'
    and v_product.public_configuration_mode = 'simple_override'
    and v_canonical_normalized is not null
    and v_current_normalized = v_canonical_normalized
    and jsonb_typeof(coalesce(p_configuration->'optionGroups', 'null'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_configuration->'optionGroups', '[]'::jsonb)) = 0
  );

  -- Content-addressed revisions are derived from the exact public
  -- configuration payload. They may advance when variants, modifier
  -- availability, or aggregate stock changes without changing the parent
  -- product's canonical revision.
  --
  -- Accept them only when the base catalog projection was already accepted
  -- in this same transaction, or when the payload hash is exactly the one
  -- already stored. A different payload on an idempotent base revision remains
  -- a conflict.
  if v_incoming_is_content_revision then
    if p_revision_already_applied is not true
       and (
         v_current_hash is null
         or v_current_hash <> v_incoming_hash
       ) then
      raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';
    end if;
  else
    if v_canonical_normalized is not null
       and v_incoming_normalized is distinct from v_canonical_normalized then
      if p_revision_already_applied is true then
        update public.ecommerce_published_products p
        set sync_status = 'review',
            sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH',
            last_sync_attempt_at = now(),
            metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
              'ecommerce_configuration_rejected_revision', v_incoming_normalized,
              'ecommerce_configuration_canonical_revision', v_canonical_normalized
            )
        where p.id = p_published_product_id;

        select p.* into v_product
        from public.ecommerce_published_products p
        where p.id = p_published_product_id;

        return jsonb_build_object(
          'success', true,
          'skipped', true,
          'code', 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH',
          'product', private.ecommerce_admin_product_jsonb(v_product)
        );
      end if;
      raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE';
    end if;

    -- Dependency-inflated catalog revisions are technical projection state,
    -- not the canonical revision of the parent product configuration.
    if v_canonical_normalized is not null
       and v_current_normalized is distinct from v_canonical_normalized then
      v_current_normalized := null;
      v_current_hash := null;
    end if;

    if v_incoming_normalized is null then
      if v_current_hash is not null and v_current_hash <> v_incoming_hash then
        raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';
      end if;
    elsif v_current_normalized is not null then
      v_decision := private.ecommerce_source_revision_decision(
        nullif(v_current_revision->>'kind', ''),
        nullif(v_current_revision->>'order', '')::numeric,
        v_current_normalized,
        v_current_hash,
        nullif(v_incoming_revision->>'kind', ''),
        nullif(v_incoming_revision->>'order', '')::numeric,
        v_incoming_normalized,
        v_incoming_hash
      );
      if v_decision = 'stale' then raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE'; end if;
      if v_decision = 'conflict'
         and not v_allow_same_revision_reconciliation
         and not v_allow_persisted_simple_override_reconciliation then
        raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';
      end if;
    end if;
  end if;

  v_result := private.ecommerce_apply_product_configuration(
    p_license_id,
    p_published_product_id,
    p_configuration,
    null
  );

  update public.ecommerce_published_products p
  set metadata = (
        coalesce(p.metadata, '{}'::jsonb)
        - 'ecommerce_configuration_rejected_revision'
        - 'ecommerce_configuration_canonical_revision'
      ) || jsonb_strip_nulls(jsonb_build_object(
        'ecommerce_configuration_payload_hash', v_incoming_hash,
        'ecommerce_configuration_source_revision', coalesce(
          v_canonical_normalized,
          v_incoming_normalized
        )
      )),
      sync_error_code = case
        when p.sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH' then null
        else p.sync_error_code
      end,
      sync_status = case
        when p.sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH' then 'synced'
        else p.sync_status
      end
  where p.id = p_published_product_id;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id;

  return v_result || jsonb_build_object(
    'product', private.ecommerce_admin_product_jsonb(v_product)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ecommerce_admin_sync_published_catalog_v3(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_projections jsonb, p_idempotency_key text, p_expected_catalog_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_legacy jsonb;
  v_projection jsonb;
  v_product_id uuid;
  v_portal_id uuid;
  v_revision bigint;
  v_mode text;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections) < 1
     or jsonb_array_length(p_projections) > 200
     or exists (select 1 from jsonb_array_elements(p_projections) p
       where jsonb_typeof(p) <> 'object'
          or jsonb_typeof(coalesce(p->'wholesaleTiers','[]'::jsonb)) <> 'array'
          or jsonb_array_length(coalesce(p->'wholesaleTiers','[]'::jsonb)) > 50) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;
  -- This is only a transaction-local request marker. The private writer
  -- re-checks that each target row was already saved as simple_override,
  -- still matches its canonical parent revision, and contains no option groups.
  perform set_config('app.ecommerce_persisted_simple_override_sync', 'true', true);

  select jsonb_agg(value - array['businessCapabilityStatus','businessCapabilityReason',
    'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
    order by ordinality) into v_legacy
  from jsonb_array_elements(p_projections) with ordinality;
  v_result := public.ecommerce_admin_sync_published_catalog_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    v_legacy,p_idempotency_key,p_expected_catalog_revision);
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  for v_projection in select value from jsonb_array_elements(p_projections)
  loop
    v_product_id := (v_projection->>'publishedProductId')::uuid;
    v_mode := coalesce(nullif(v_projection->>'publicConfigurationMode',''),'compatible');
    if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible') then
      raise exception 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD';
    end if;
    update public.ecommerce_published_products
    set public_configuration_mode = case when public_configuration_mode='simple_override'
      then 'simple_override' else v_mode end
    where id=v_product_id and public_configuration_mode is distinct from
      case when public_configuration_mode='simple_override' then 'simple_override' else v_mode end;
    perform private.ecommerce_apply_wholesale_tiers(v_product_id,
      coalesce((v_projection->>'wholesaleEnabled')::boolean,false),
      coalesce(v_projection->'wholesaleTiers','[]'::jsonb));
    perform private.ecommerce_reconcile_published_product_capability(v_product_id);
    if v_portal_id is null then
      select portal_id into v_portal_id from public.ecommerce_published_products where id=v_product_id;
    end if;
  end loop;
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_id;
  return jsonb_set(v_result, '{catalogRevision}', to_jsonb(v_revision), true);
exception when others then
  return private.ecommerce_admin_error(case when sqlerrm like '%WHOLESALE%'
    then 'ECOMMERCE_WHOLESALE_INVALID_PAYLOAD'
    else 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD' end);
end;
$function$
;

alter function private.ecommerce_apply_product_configuration_checked(
  uuid,uuid,jsonb,text,boolean
) owner to postgres;
alter function public.ecommerce_admin_sync_published_catalog_v3(
  text,text,text,text,jsonb,text,bigint
) owner to postgres;

revoke all on function private.ecommerce_apply_product_configuration_checked(
  uuid,uuid,jsonb,text,boolean
) from public,anon,authenticated,service_role;

comment on function private.ecommerce_apply_product_configuration_checked(
  uuid,uuid,jsonb,text,boolean
) is 'Applies configuration revisions fail-closed; v3 may reconcile a group-free content revision only for an already persisted simple override at the canonical parent revision.';
