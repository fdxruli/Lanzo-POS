-- ECOM.PRODUCTS.MODEL.1 compensatory fix.
-- Avoid referencing table-specific NEW fields from a shared trigger branch.

create or replace function private.ecommerce_configuration_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent record;
  v_group record;
  v_source_license uuid;
begin
  select p.portal_id, p.license_id
  into v_parent
  from public.ecommerce_published_products p
  where p.id = new.published_product_id
    and p.deleted_at is null;

  if v_parent.portal_id is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;
  if new.portal_id <> v_parent.portal_id or new.license_id <> v_parent.license_id then
    raise exception 'ECOMMERCE_CONFIGURATION_SCOPE_MISMATCH';
  end if;

  if tg_table_name = 'ecommerce_published_product_variants' then
    if new.source_product_id is not null then
      select p.license_id into v_source_license
      from public.pos_products p
      where p.id = new.source_product_id
        and p.deleted_at is null;

      if v_source_license is null then
        raise exception 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND';
      end if;
      if v_source_license <> new.license_id then
        raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE';
      end if;
    end if;

    new.is_available := new.manual_available and new.source_available;
    return new;
  end if;

  if tg_table_name = 'ecommerce_published_option_groups' then
    return new;
  end if;

  if tg_table_name = 'ecommerce_published_options' then
    select g.published_product_id, g.portal_id, g.license_id
    into v_group
    from public.ecommerce_published_option_groups g
    where g.id = new.group_id
      and g.deleted_at is null;

    if v_group.published_product_id is null
       or v_group.published_product_id <> new.published_product_id
       or v_group.portal_id <> new.portal_id
       or v_group.license_id <> new.license_id then
      raise exception 'ECOMMERCE_OPTION_GROUP_SCOPE_MISMATCH';
    end if;

    if new.source_ingredient_id is not null then
      select p.license_id into v_source_license
      from public.pos_products p
      where p.id = new.source_ingredient_id
        and p.deleted_at is null;

      if v_source_license is null then
        raise exception 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND';
      end if;
      if v_source_license <> new.license_id then
        raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE';
      end if;
    end if;

    new.is_available := new.manual_available and new.source_available;
    return new;
  end if;

  raise exception 'ECOMMERCE_CONFIGURATION_UNSUPPORTED_CHILD_TABLE';
end;
$function$;

comment on function private.ecommerce_configuration_child_guard() is
  'Tenant/source guard for normalized ecommerce variants, groups and options. Table-specific fields are evaluated only inside their corresponding trigger branch.';
