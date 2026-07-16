-- ECOM.PRODUCTS.PUBLIC.1.2
-- Unify application writers on portal -> parent -> child lock order.

create or replace function private.ecommerce_lock_configuration_writer(
  p_license_id uuid,
  p_published_product_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_portal_id uuid;
  v_locked_id uuid;
begin
  select p.portal_id
  into v_portal_id
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null;

  if v_portal_id is null then return null; end if;

  perform 1
  from public.ecommerce_portals portal
  where portal.id = v_portal_id
    and portal.license_id = p_license_id
    and portal.deleted_at is null
  for update;
  if not found then return null; end if;

  select p.id
  into v_locked_id
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.portal_id = v_portal_id
    and p.license_id = p_license_id
    and p.deleted_at is null
  for update;

  if v_locked_id is null then return null; end if;
  return v_portal_id;
end;
$function$;

do $patch$
declare
  v_oid oid;
  v_definition text;
  v_before text;
  v_after text;
begin
  foreach v_oid in array array[
    'private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text)'::regprocedure::oid,
    'private.ecommerce_apply_product_configuration_checked(uuid,uuid,jsonb,text,boolean)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    v_before := 'select p.* into v_product' || chr(10)
      || '  from public.ecommerce_published_products p' || chr(10)
      || '  where p.id = p_published_product_id' || chr(10)
      || '    and p.license_id = p_license_id' || chr(10)
      || '    and p.deleted_at is null' || chr(10)
      || '  for update;';
    v_after := 'if private.ecommerce_lock_configuration_writer(p_license_id,p_published_product_id) is null then raise exception ''ECOMMERCE_PRODUCT_NOT_FOUND''; end if;'
      || chr(10) || chr(10) || '  ' || v_before;
    if strpos(v_definition, v_before) = 0 then
      raise exception 'ECOM_PRODUCTS_PUBLIC_1_2_WRITER_HELPER_DRIFT:%', v_oid::regprocedure;
    end if;
    execute replace(v_definition, v_before, v_after);
  end loop;

  foreach v_oid in array array[
    'public.ecommerce_admin_upsert_published_product(text,text,text,jsonb)'::regprocedure::oid,
    'public.ecommerce_admin_upsert_published_product(text,text,text,text,jsonb)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    v_before := 'select p.id into v_portal_id' || chr(10)
      || '  from public.ecommerce_portals p' || chr(10)
      || '  where p.license_id = v_license_id and p.deleted_at is null' || chr(10)
      || '  limit 1;';
    v_after := replace(v_before, 'limit 1;', 'limit 1 for update;');
    if strpos(v_definition, v_before) = 0 then
      raise exception 'ECOM_PRODUCTS_PUBLIC_1_2_UPSERT_PORTAL_DRIFT:%', v_oid::regprocedure;
    end if;
    execute replace(v_definition, v_before, v_after);
  end loop;

  foreach v_oid in array array[
    'public.ecommerce_admin_set_product_published(text,text,text,uuid,boolean)'::regprocedure::oid,
    'public.ecommerce_admin_set_product_published(text,text,text,text,uuid,boolean)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    v_before := 'update public.ecommerce_published_products pp' || chr(10)
      || '  set is_published = coalesce(p_is_published, false)';
    v_after := 'if private.ecommerce_lock_configuration_writer(v_license_id,p_product_id) is null then return private.ecommerce_admin_error(''ECOMMERCE_PRODUCT_NOT_FOUND''); end if;'
      || chr(10) || chr(10) || '  ' || v_before;
    if strpos(v_definition, v_before) = 0 then
      raise exception 'ECOM_PRODUCTS_PUBLIC_1_2_SET_STATUS_DRIFT:%', v_oid::regprocedure;
    end if;
    execute replace(v_definition, v_before, v_after);
  end loop;
end;
$patch$;

alter function private.ecommerce_lock_configuration_writer(uuid, uuid) owner to postgres;
revoke all on function private.ecommerce_lock_configuration_writer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.ecommerce_lock_configuration_writer(uuid, uuid)
  to service_role;

revoke insert, update, delete, truncate
  on table public.ecommerce_published_products
  from public, anon, authenticated, service_role;

comment on function private.ecommerce_lock_configuration_writer(uuid, uuid) is
  'ECOM.PRODUCTS.PUBLIC.1.2 writer lock protocol: portal FOR UPDATE, then product parent FOR UPDATE, before child or parent mutations.';