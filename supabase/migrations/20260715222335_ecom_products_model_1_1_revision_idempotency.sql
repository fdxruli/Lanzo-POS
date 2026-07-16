-- ECOM.PRODUCTS.MODEL.1.1 compensatory revision and idempotency hardening.

create or replace function private.ecommerce_configuration_error_from_message(
  p_message text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ecommerce_admin_error(
    case
      when p_message like 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED%' then 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED'
      when p_message like 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE%' then 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'
      when p_message like 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND%' then 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND'
      when p_message like 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND%' then 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND'
      when p_message like 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID%' then 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED%' then 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID%' then 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID'
      when p_message like 'ECOMMERCE_PRODUCT_NOT_FOUND%' then 'ECOMMERCE_PRODUCT_NOT_FOUND'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_STALE%' then 'ECOMMERCE_CATALOG_SOURCE_STALE'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_CONFLICT%' then 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'
      when p_message like 'ECOMMERCE_CATALOG_REVISION_CHANGED%' then 'ECOMMERCE_CATALOG_REVISION_CHANGED'
      when p_message like 'ECOMMERCE_IDEMPOTENCY_CONFLICT%' then 'ECOMMERCE_IDEMPOTENCY_CONFLICT'
      when p_message like 'ECOMMERCE_CONFIGURATION_INVALID%' then 'ECOMMERCE_CONFIGURATION_INVALID'
      else 'ECOMMERCE_CONFIGURATION_SYNC_FAILED'
    end,
    case
      when p_message like 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED%' then 'La configuracion supera el limite de opciones permitido.'
      when p_message like 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE%' then 'La configuracion contiene una referencia que no pertenece a esta licencia.'
      when p_message like 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND%' then 'Una variante ya no existe en el catalogo autorizado.'
      when p_message like 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND%' then 'Un ingrediente de una opcion ya no existe en el catalogo autorizado.'
      when p_message like 'ECOMMERCE_OPTION_GROUP_SELECTION_INVALID%' then 'Los limites de seleccion del grupo no son validos.'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED%' then 'Cada variante debe indicar su combinacion de atributos.'
      when p_message like 'ECOMMERCE_VARIANT_OPTION_VALUE_INVALID%' then 'Una variante contiene un atributo invalido.'
      when p_message like 'ECOMMERCE_PRODUCT_NOT_FOUND%' then 'El producto publicado no existe.'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_STALE%' then 'Un dispositivo tiene una version anterior del producto.'
      when p_message like 'ECOMMERCE_CATALOG_SOURCE_CONFLICT%' then 'La revision del producto requiere reconciliacion.'
      when p_message like 'ECOMMERCE_CATALOG_REVISION_CHANGED%' then 'El catalogo cambio durante la sincronizacion.'
      when p_message like 'ECOMMERCE_IDEMPOTENCY_CONFLICT%' then 'La llave idempotente ya fue utilizada con otro contenido.'
      when p_message like 'ECOMMERCE_CONFIGURATION_INVALID%' then 'La configuracion contiene referencias o valores invalidos.'
      else 'No se pudo sincronizar la configuracion del producto.'
    end
  );
$function$;

create or replace function private.ecommerce_apply_product_configuration_checked(
  p_license_id uuid,
  p_published_product_id uuid,
  p_configuration jsonb,
  p_source_revision text default null,
  p_revision_already_applied boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_result jsonb;
  v_incoming_revision jsonb;
  v_incoming_hash text;
  v_current_hash text;
  v_decision text;
begin
  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null
  for update;
  if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  v_incoming_hash := encode(extensions.digest(p_configuration::text,'sha256'),'hex');
  v_current_hash := nullif(v_product.metadata->>'ecommerce_configuration_payload_hash','');
  v_incoming_revision := private.ecommerce_parse_source_revision(p_source_revision);

  if nullif(v_incoming_revision->>'normalized','') is not null
     and p_revision_already_applied is not true then
    v_decision := private.ecommerce_source_revision_decision(
      v_product.source_revision_kind,
      v_product.source_revision_order,
      v_product.source_revision,
      coalesce(v_current_hash,v_incoming_hash),
      nullif(v_incoming_revision->>'kind',''),
      nullif(v_incoming_revision->>'order','')::numeric,
      nullif(v_incoming_revision->>'normalized',''),
      v_incoming_hash
    );
    if v_decision = 'stale' then raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE'; end if;
    if v_decision = 'conflict' then raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'; end if;
  end if;

  v_result := private.ecommerce_apply_product_configuration(
    p_license_id,
    p_published_product_id,
    p_configuration,
    p_source_revision
  );

  update public.ecommerce_published_products p
  set source_revision = case
        when nullif(v_incoming_revision->>'normalized','') is null then p.source_revision
        else v_incoming_revision->>'normalized'
      end,
      source_revision_kind = case
        when nullif(v_incoming_revision->>'normalized','') is null then p.source_revision_kind
        else nullif(v_incoming_revision->>'kind','')
      end,
      source_revision_order = case
        when nullif(v_incoming_revision->>'normalized','') is null then p.source_revision_order
        else nullif(v_incoming_revision->>'order','')::numeric
      end,
      metadata = coalesce(p.metadata,'{}'::jsonb)
        || jsonb_build_object('ecommerce_configuration_payload_hash',v_incoming_hash)
  where p.id = p_published_product_id;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id;

  return v_result || jsonb_build_object('product',private.ecommerce_admin_product_jsonb(v_product));
end;
$function$;

revoke all on function private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean) to service_role;

create or replace function public.ecommerce_admin_sync_product_configuration(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_published_product_id uuid,
  p_configuration jsonb,
  p_source_revision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_sync_product_configuration'
  );
  if coalesce((v_auth->>'success')::boolean,false) is false then return v_auth; end if;

  return private.ecommerce_apply_product_configuration_checked(
    (v_auth->>'license_id')::uuid,
    p_published_product_id,
    p_configuration,
    p_source_revision,
    false
  );
exception
  when others then return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

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
set search_path = ''
as $function$
declare
  v_base_payload jsonb;
  v_base_result jsonb;
  v_configuration_result jsonb;
  v_product_id uuid;
  v_license_id uuid;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'configuration') <> 'object'
     or (p_payload ? 'configurationSourceRevision'
         and jsonb_typeof(p_payload->'configurationSourceRevision') not in ('string','null')) then
    return private.ecommerce_admin_error('ECOMMERCE_CONFIGURATION_INVALID','La configuracion del producto no es valida.');
  end if;

  v_base_payload := p_payload-array['configuration','configurationSourceRevision'];
  v_base_result := public.ecommerce_admin_upsert_published_product(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_base_payload
  );
  if coalesce((v_base_result->>'success')::boolean,false) is false then return v_base_result; end if;

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
as $function$
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
  v_configuration_count integer := 0;
  v_catalog_revision bigint;
  v_license_id uuid;
  v_portal_id uuid;
  v_existing private.ecommerce_catalog_sync_requests%rowtype;
begin
  if jsonb_typeof(p_projections) <> 'array'
     or jsonb_array_length(p_projections)<1
     or jsonb_array_length(p_projections)>200
     or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null
     or length(p_idempotency_key)>240 then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD');
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_projections) item
    where jsonb_typeof(item)<>'object'
       or not (item ?& array[
         'publishedProductId','localProductRef','sourceRevision','sourceState',
         'sourceAvailable','stockSnapshot','fields','configuration','configurationSourceRevision'
       ])
       or (item-array[
         'publishedProductId','localProductRef','sourceRevision','sourceState',
         'sourceAvailable','stockSnapshot','fields','configuration','configurationSourceRevision'
       ])<>'{}'::jsonb
       or jsonb_typeof(item->'configuration') not in ('object','null')
       or jsonb_typeof(item->'configurationSourceRevision') not in ('string','null')
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD','La proyeccion contiene campos no permitidos.');
  end if;

  select jsonb_agg(value-array['configuration','configurationSourceRevision'] order by ordinality)
  into v_legacy_projections
  from jsonb_array_elements(p_projections) with ordinality;

  v_full_hash := encode(extensions.digest(p_projections::text,'sha256'),'hex');
  v_key_hash := encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  v_internal_key := 'cfgv2-inner:'||v_key_hash;
  v_envelope_key := 'cfgv2:'||v_key_hash;

  v_result := public.ecommerce_admin_sync_published_catalog(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    v_legacy_projections,v_internal_key,p_expected_catalog_revision
  );
  if coalesce((v_result->>'success')::boolean,false) is false then return v_result; end if;

  select p.license_id,p.portal_id into v_license_id,v_portal_id
  from public.ecommerce_published_products p
  where p.id::text=p_projections->0->>'publishedProductId'
    and p.deleted_at is null;
  if v_license_id is null or v_portal_id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  select r.* into v_existing
  from private.ecommerce_catalog_sync_requests r
  where r.license_id=v_license_id and r.portal_id=v_portal_id and r.idempotency_key=v_envelope_key
  limit 1;
  if v_existing.idempotency_key is not null then
    if v_existing.request_hash<>v_full_hash then raise exception 'ECOMMERCE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response||jsonb_build_object('idempotent',true);
  end if;

  for v_result_item in select value from jsonb_array_elements(coalesce(v_result->'results','[]'::jsonb))
  loop
    if not (
      v_result_item->>'status' in ('updated','idempotent')
      or (v_result_item->>'status'='review' and not (v_result_item?'code'))
    ) then continue; end if;

    select value into v_projection
    from jsonb_array_elements(p_projections)
    where value->>'publishedProductId'=v_result_item->>'publishedProductId'
    limit 1;
    if jsonb_typeof(v_projection->'configuration')<>'object' then continue; end if;

    select p.* into v_product
    from public.ecommerce_published_products p
    where p.id::text=v_result_item->>'publishedProductId'
      and p.license_id=v_license_id
      and p.portal_id=v_portal_id
      and p.deleted_at is null
    for update;
    if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

    v_configuration_result := private.ecommerce_apply_product_configuration_checked(
      v_product.license_id,
      v_product.id,
      v_projection->'configuration',
      v_projection->>'configurationSourceRevision',
      v_result_item->>'status' in ('updated','review')
    );
    if coalesce((v_configuration_result->>'success')::boolean,false) is false then
      raise exception 'ECOMMERCE_CONFIGURATION_SYNC_FAILED';
    end if;
    v_configuration_count := v_configuration_count+1;
  end loop;

  select p.catalog_revision into v_catalog_revision
  from public.ecommerce_portals p where p.id=v_portal_id;

  v_final_result := v_result||jsonb_build_object(
    'configurationUpdatedCount',v_configuration_count,
    'catalogRevision',coalesce(v_catalog_revision,(v_result->>'catalogRevision')::bigint)
  );

  insert into private.ecommerce_catalog_sync_requests(
    license_id,portal_id,idempotency_key,request_hash,response
  ) values (v_license_id,v_portal_id,v_envelope_key,v_full_hash,v_final_result);

  return v_final_result;
exception
  when unique_violation then
    select r.* into v_existing
    from private.ecommerce_catalog_sync_requests r
    where r.license_id=v_license_id and r.portal_id=v_portal_id and r.idempotency_key=v_envelope_key;
    if v_existing.request_hash=v_full_hash then return v_existing.response||jsonb_build_object('idempotent',true); end if;
    return private.ecommerce_admin_error('ECOMMERCE_IDEMPOTENCY_CONFLICT','La llave idempotente ya fue utilizada con otro contenido.');
  when others then return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

comment on function private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean) is
  'Revision-aware guard around the canonical normalized configuration writer. Reuses sourceRevision and stores only a private payload hash for equal-revision conflict detection.';
comment on function public.ecommerce_admin_sync_published_catalog_v2(text,text,text,text,jsonb,text,bigint) is
  'Atomic PRO catalog/configuration sync with strict full-payload idempotency and stale revision protection.';
