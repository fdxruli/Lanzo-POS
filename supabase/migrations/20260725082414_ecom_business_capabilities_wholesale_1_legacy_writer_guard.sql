create or replace function private.ecommerce_business_capability_parent_guard()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.public_configuration_mode = 'simple_override' and new.public_configuration_mode = 'simple_override' then
    new.configuration_type := 'simple';
    new.has_option_groups := false;
    new.requires_configuration := new.has_variants;
  end if;
  if new.public_configuration_mode in ('requires_review', 'hidden_incompatible') then
    new.wholesale_enabled := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists ecommerce_business_capability_parent_guard on public.ecommerce_published_products;
create trigger ecommerce_business_capability_parent_guard
before update of configuration_type, has_option_groups, requires_configuration, public_configuration_mode, wholesale_enabled
on public.ecommerce_published_products
for each row execute function private.ecommerce_business_capability_parent_guard();

create or replace function private.ecommerce_configuration_child_guard()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_parent record;
  v_group record;
  v_source_license uuid;
begin
  select p.portal_id, p.license_id, p.public_configuration_mode into v_parent
  from public.ecommerce_published_products p
  where p.id = new.published_product_id and p.deleted_at is null;
  if v_parent.portal_id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;
  if new.portal_id <> v_parent.portal_id or new.license_id <> v_parent.license_id then
    raise exception 'ECOMMERCE_CONFIGURATION_SCOPE_MISMATCH';
  end if;
  if tg_table_name = 'ecommerce_published_product_variants' then
    if new.source_product_id is not null then
      select p.license_id into v_source_license from public.pos_products p
      where p.id = new.source_product_id and p.deleted_at is null;
      if v_source_license is null then raise exception 'ECOMMERCE_VARIANT_SOURCE_NOT_FOUND'; end if;
      if v_source_license <> new.license_id then raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'; end if;
    end if;
    new.is_available := new.manual_available and new.source_available;
    return new;
  end if;
  if v_parent.public_configuration_mode in ('simple_override','requires_review','hidden_incompatible') then
    new.deleted_at := coalesce(new.deleted_at, now());
  end if;
  if tg_table_name = 'ecommerce_published_option_groups' then return new; end if;
  if tg_table_name = 'ecommerce_published_options' then
    select g.published_product_id, g.portal_id, g.license_id, g.deleted_at into v_group
    from public.ecommerce_published_option_groups g where g.id = new.group_id;
    if v_group.published_product_id is null or v_group.published_product_id <> new.published_product_id
       or v_group.portal_id <> new.portal_id or v_group.license_id <> new.license_id then
      raise exception 'ECOMMERCE_OPTION_GROUP_SCOPE_MISMATCH';
    end if;
    if new.deleted_at is null and v_group.deleted_at is not null then raise exception 'ECOMMERCE_OPTION_GROUP_INACTIVE'; end if;
    if new.source_ingredient_id is not null then
      select p.license_id into v_source_license from public.pos_products p
      where p.id = new.source_ingredient_id and p.deleted_at is null;
      if v_source_license is null then raise exception 'ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND'; end if;
      if v_source_license <> new.license_id then raise exception 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE'; end if;
    end if;
    new.is_available := case when new.deleted_at is not null then false else new.manual_available and new.source_available end;
    return new;
  end if;
  raise exception 'ECOMMERCE_CONFIGURATION_UNSUPPORTED_CHILD_TABLE';
end;
$function$;

comment on function private.ecommerce_business_capability_parent_guard() is
  'Preserves explicit simple publication and fail-closed wholesale decisions when legacy canonical writers update a published product.';
comment on function private.ecommerce_configuration_child_guard() is
  'Tenant/source guard for normalized ecommerce variants, groups and options. Option children are forced inactive while the parent publication is incompatible or explicitly simple.';