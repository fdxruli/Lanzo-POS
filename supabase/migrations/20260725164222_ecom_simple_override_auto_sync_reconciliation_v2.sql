-- ECOM.SIMPLE.OVERRIDE.AUTO.SYNC.RECONCILIATION.2
-- Normalize legacy automatic catalog payloads against the persisted public
-- configuration mode before the guarded configuration writer receives them.

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

  -- Persisted publication policy is authoritative during the automatic writer.
  -- Keep variants, but never re-send restaurant option groups for a saved
  -- simple override. Review-only publications do not send hidden configuration.
  select jsonb_agg(
    case
      when current_product.public_configuration_mode = 'simple_override'
        and jsonb_typeof(value->'configuration') = 'object'
        then jsonb_set(
          value - array['businessCapabilityStatus','businessCapabilityReason',
            'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings'],
          '{configuration}',
          jsonb_set(
            jsonb_set(value->'configuration','{optionGroups}','[]'::jsonb,true),
            '{type}',
            to_jsonb(case
              when jsonb_array_length(coalesce(value->'configuration'->'variants','[]'::jsonb)) > 0
                then 'variant_parent'
              else 'simple'
            end),
            true
          ),
          true
        )
      when current_product.public_configuration_mode in ('requires_review','hidden_incompatible')
        or current_product.business_capability_status in ('requires_review','hidden_incompatible')
        then jsonb_set(
          jsonb_set(
            value - array['businessCapabilityStatus','businessCapabilityReason',
              'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings'],
            '{configuration}','null'::jsonb,true
          ),
          '{configurationSourceRevision}','null'::jsonb,true
        )
      else value - array['businessCapabilityStatus','businessCapabilityReason',
        'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
    end
    order by ordinality
  ) into v_legacy
  from jsonb_array_elements(p_projections) with ordinality
  left join public.ecommerce_published_products current_product
    on current_product.id = (value->>'publishedProductId')::uuid
   and current_product.deleted_at is null;
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

alter function public.ecommerce_admin_sync_published_catalog_v3(
  text,text,text,text,jsonb,text,bigint
) owner to postgres;
