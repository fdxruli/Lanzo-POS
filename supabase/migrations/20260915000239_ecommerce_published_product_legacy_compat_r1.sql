-- ECOMMERCE PUBLISHED PRODUCT LEGACY COMPATIBILITY R1
--
-- Legacy callers may omit configuration.  That means that the caller is not
-- managing configuration; it must not be represented as a NULL configuration
-- sent to the checked configuration writer.  The public legacy aliases still
-- route through v3 so publication eligibility cannot be bypassed.

create or replace function public.ecommerce_admin_upsert_published_product_v2(
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
as $function$
declare
  v_base_payload jsonb;
  v_base_result jsonb;
  v_configuration_result jsonb;
  v_product_id uuid;
  v_license_id uuid;
  v_manages_configuration boolean := false;
begin
  -- JSONB field absence is distinct from an explicit null/invalid value.
  -- Only the former is the supported legacy/simple compatibility path.
  v_manages_configuration := coalesce(p_payload ? 'configuration', false);
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or (v_manages_configuration
         and jsonb_typeof(p_payload->'configuration') <> 'object')
     or (p_payload ? 'configurationSourceRevision'
         and jsonb_typeof(p_payload->'configurationSourceRevision') not in ('string','null')) then
    return private.ecommerce_admin_error('ECOMMERCE_CONFIGURATION_INVALID','La configuracion del producto no es valida.');
  end if;

  v_base_payload := p_payload-array['configuration','configurationSourceRevision'];
  v_base_result := private.ecommerce_admin_upsert_published_product_core(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_base_payload
  );
  if coalesce((v_base_result->>'success')::boolean,false) is false then return v_base_result; end if;

  -- A missing configuration means the caller is not administering variants or
  -- options.  Return the persisted product without fabricating a simple
  -- configuration and without deleting existing configuration children.
  if not v_manages_configuration then
    return v_base_result;
  end if;

  v_product_id := nullif(v_base_result#>>'{product,id}','')::uuid;
  select p.license_id into v_license_id
  from public.ecommerce_published_products p
  where p.id=v_product_id and p.deleted_at is null;
  if v_license_id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  v_configuration_result := private.ecommerce_apply_product_configuration_checked(
    v_license_id,v_product_id,p_payload->'configuration',p_payload->>'configurationSourceRevision',false
  );

  return v_base_result || jsonb_build_object(
    'product',v_configuration_result->'product',
    'configuration',v_configuration_result->'configuration'
  );
exception
  when others then return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

create or replace function public.ecommerce_admin_upsert_published_product_v3(
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
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_result jsonb;
  v_product_id uuid;
  v_portal_id uuid;
  v_revision bigint;
  v_mode text;
  v_product public.ecommerce_published_products%rowtype;
  v_eligibility jsonb;
  v_has_configuration boolean := false;
  v_existing_product_id uuid;
  v_existing_mode text;
  v_preserve_existing_configuration boolean := false;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;
  v_has_configuration := coalesce(p_payload ? 'configuration', false);
  v_mode := coalesce(nullif(p_payload->>'publicConfigurationMode',''),'compatible');
  if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible')
     or jsonb_typeof(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) > 50 then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;

  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_upsert_published_product'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  -- Preserve the existing capability/configuration mode when a legacy caller
  -- updates metadata only.  In particular, absence of configuration must not
  -- turn an existing simple_override into compatible or trigger its cleanup.
  if not v_has_configuration
     and nullif(p_payload->>'publicConfigurationMode','') is null then
    if nullif(btrim(p_payload->>'id'),'') is not null then
      begin
        v_existing_product_id := (p_payload->>'id')::uuid;
      exception when others then
        v_existing_product_id := null;
      end;
    end if;
    select p.id, p.public_configuration_mode
      into v_existing_product_id, v_existing_mode
    from public.ecommerce_published_products p
    where p.license_id = v_license_id
      and p.deleted_at is null
      and (
        (v_existing_product_id is not null and p.id = v_existing_product_id)
        or (v_existing_product_id is null
            and p.local_product_ref = nullif(p_payload->>'localProductRef',''))
      )
    limit 1;
    if v_existing_product_id is not null then
      v_preserve_existing_configuration := true;
      v_mode := coalesce(nullif(v_existing_mode,''),'compatible');
    end if;
  end if;

  if coalesce((p_payload->>'isPublished')::boolean, false) then
    v_eligibility := private.ecommerce_publication_eligibility(
      v_license_id, nullif(p_payload->>'localProductRef', ''), v_mode
    );
    if coalesce((v_eligibility->>'eligible')::boolean, false) is not true then
      return private.ecommerce_admin_error(
        coalesce(v_eligibility->>'code', 'ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE')
      );
    end if;
  end if;

  perform set_config(
    'app.ecommerce_simple_override_reconcile',
    case when v_mode = 'simple_override' then 'true' else 'false' end,
    true
  );
  v_result := public.ecommerce_admin_upsert_published_product_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    p_payload - array['businessCapabilityStatus','businessCapabilityReason',
      'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  v_product_id := (v_result#>>'{product,id}')::uuid;
  select * into v_product from public.ecommerce_published_products
  where id = v_product_id and license_id = v_license_id and deleted_at is null
  for update;
  if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;
  if v_product.is_published then
    v_eligibility := private.ecommerce_publication_eligibility(
      v_license_id, v_product.local_product_ref, v_mode
    );
    if coalesce((v_eligibility->>'eligible')::boolean, false) is not true then
      raise exception '%', coalesce(v_eligibility->>'code', 'ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE');
    end if;
  end if;

  -- New products still need the normal capability reconciliation so their
  -- publication status satisfies the Phase 1 invariant.  An existing product
  -- updated without configuration keeps its children, wholesale tiers, and
  -- mode untouched because this caller is metadata-only.
  if not v_preserve_existing_configuration then
    update public.ecommerce_published_products
    set public_configuration_mode = v_mode
    where id = v_product_id and public_configuration_mode is distinct from v_mode;
    perform private.ecommerce_apply_wholesale_tiers(v_product_id,
      coalesce((p_payload->>'wholesaleEnabled')::boolean,false),
      coalesce(p_payload->'wholesaleTiers','[]'::jsonb));
    perform private.ecommerce_reconcile_published_product_capability(v_product_id);
  end if;
  select portal_id into v_portal_id from public.ecommerce_published_products where id=v_product_id;
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_id;
  return jsonb_set(v_result || jsonb_build_object(
    'product',private.ecommerce_admin_product_jsonb(
      (select p from public.ecommerce_published_products p where p.id=v_product_id)
    )), '{catalogRevision}', to_jsonb(v_revision), true);
exception when others then
  if sqlerrm like '%ECOMMERCE_PRODUCT_REQUIRES_REVIEW%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_REQUIRES_REVIEW');
  end if;
  if sqlerrm like '%ECOMMERCE_PRODUCT_HIDDEN_INCOMPATIBLE%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_HIDDEN_INCOMPATIBLE');
  end if;
  if sqlerrm like '%ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE');
  end if;
  if sqlerrm like '%ECOMMERCE_WHOLESALE_INVALID_PAYLOAD%' then
    return private.ecommerce_admin_error('ECOMMERCE_WHOLESALE_INVALID_PAYLOAD');
  end if;
  return private.ecommerce_admin_error('ECOMMERCE_ADMIN_SAVE_FAILED');
end;
$function$;

alter function public.ecommerce_admin_upsert_published_product_v2(
  text,text,text,text,jsonb
) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product_v3(
  text,text,text,text,jsonb
) owner to postgres;

revoke all on function public.ecommerce_admin_upsert_published_product_v2(
  text,text,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product_v2(
  text,text,text,text,jsonb
) to service_role;

comment on function public.ecommerce_admin_upsert_published_product_v2(
  text,text,text,text,jsonb
) is
  'Internal published-product writer. A missing configuration is metadata-only legacy compatibility; explicit configuration uses the checked canonical writer.';
