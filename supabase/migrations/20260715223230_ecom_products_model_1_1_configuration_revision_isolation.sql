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
  v_current_revision jsonb;
  v_incoming_hash text;
  v_current_hash text;
  v_incoming_normalized text;
  v_current_normalized text;
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
  v_current_revision := private.ecommerce_parse_source_revision(
    v_product.metadata->>'ecommerce_configuration_source_revision'
  );
  v_incoming_normalized := nullif(v_incoming_revision->>'normalized','');
  v_current_normalized := nullif(v_current_revision->>'normalized','');

  if p_revision_already_applied is not true then
    if v_incoming_normalized is null then
      if v_current_hash is not null and v_current_hash <> v_incoming_hash then
        raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';
      end if;
    elsif v_current_normalized is not null then
      v_decision := private.ecommerce_source_revision_decision(
        nullif(v_current_revision->>'kind',''),
        nullif(v_current_revision->>'order','')::numeric,
        v_current_normalized,
        v_current_hash,
        nullif(v_incoming_revision->>'kind',''),
        nullif(v_incoming_revision->>'order','')::numeric,
        v_incoming_normalized,
        v_incoming_hash
      );
      if v_decision = 'stale' then raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE'; end if;
      if v_decision = 'conflict' then raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'; end if;
    end if;
  end if;

  v_result := private.ecommerce_apply_product_configuration(
    p_license_id,
    p_published_product_id,
    p_configuration,
    null
  );

  update public.ecommerce_published_products p
  set metadata = coalesce(p.metadata,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'ecommerce_configuration_payload_hash',v_incoming_hash,
      'ecommerce_configuration_source_revision',v_incoming_normalized
    ))
  where p.id = p_published_product_id;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id;

  return v_result || jsonb_build_object('product',private.ecommerce_admin_product_jsonb(v_product));
end;
$function$;

comment on function private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean) is
  'Revision-aware guard around the canonical writer. Configuration sourceRevision is stored as private metadata and never overwrites the independent catalog/inventory source_revision fields.';;
