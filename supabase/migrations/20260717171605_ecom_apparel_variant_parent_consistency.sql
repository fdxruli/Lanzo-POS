-- FASE ECOM.PRODUCTS.APPAREL.1 residual blockers
-- Keep commercial apparel identity on source_variant_ref/local_product_ref and
-- reconcile the published parent from active child variants.

create or replace function private.ecommerce_refresh_variant_parent_state(
  p_published_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_count integer := 0;
  v_source_available boolean := false;
  v_stock_snapshot numeric := 0;
begin
  if p_published_product_id is null then
    return;
  end if;

  select
    count(*)::integer,
    coalesce(bool_or(
      v.manual_available is true
      and v.source_available is true
      and v.is_available is true
    ), false),
    coalesce(sum(
      case
        when v.manual_available is true
         and v.source_available is true
         and v.is_available is true
          then greatest(coalesce(v.stock_snapshot, 0), 0)
        else 0
      end
    ), 0)
  into
    v_active_count,
    v_source_available,
    v_stock_snapshot
  from public.ecommerce_published_product_variants v
  where v.published_product_id = p_published_product_id
    and v.deleted_at is null;

  update public.ecommerce_published_products p
  set has_variants = v_active_count > 0,
      requires_configuration = true,
      availability_source = 'variant_aggregate',
      availability_reason_code = case
        when v_active_count = 0 then 'APPAREL_VARIANTS_UNAVAILABLE'
        else 'CONFIGURATION_REQUIRED'
      end,
      source_available = v_source_available,
      source_state = case
        when v_source_available then 'in_stock'
        else 'out_of_stock'
      end,
      stock_snapshot = greatest(v_stock_snapshot, 0),
      stock_updated_at = now(),
      is_available = false
  where p.id = p_published_product_id
    and p.deleted_at is null
    and p.configuration_type = 'variant_parent'
    and (
      p.has_variants,
      p.requires_configuration,
      p.availability_source,
      p.availability_reason_code,
      p.source_available,
      p.source_state,
      p.stock_snapshot,
      p.is_available
    ) is distinct from (
      v_active_count > 0,
      true,
      'variant_aggregate'::text,
      case
        when v_active_count = 0 then 'APPAREL_VARIANTS_UNAVAILABLE'
        else 'CONFIGURATION_REQUIRED'
      end,
      v_source_available,
      case when v_source_available then 'in_stock' else 'out_of_stock' end,
      greatest(v_stock_snapshot, 0),
      false
    );
end;
$function$;

revoke all on function private.ecommerce_refresh_variant_parent_state(uuid) from public;
revoke all on function private.ecommerce_refresh_variant_parent_state(uuid) from anon;
revoke all on function private.ecommerce_refresh_variant_parent_state(uuid) from authenticated;

create or replace function private.ecommerce_variant_parent_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_count integer := 0;
  v_source_available boolean := false;
  v_stock_snapshot numeric := 0;
begin
  if new.deleted_at is not null or new.configuration_type <> 'variant_parent' then
    return new;
  end if;

  select
    count(*)::integer,
    coalesce(bool_or(
      v.manual_available is true
      and v.source_available is true
      and v.is_available is true
    ), false),
    coalesce(sum(
      case
        when v.manual_available is true
         and v.source_available is true
         and v.is_available is true
          then greatest(coalesce(v.stock_snapshot, 0), 0)
        else 0
      end
    ), 0)
  into
    v_active_count,
    v_source_available,
    v_stock_snapshot
  from public.ecommerce_published_product_variants v
  where v.published_product_id = new.id
    and v.deleted_at is null;

  new.has_variants := v_active_count > 0;
  new.requires_configuration := true;
  new.availability_source := 'variant_aggregate';
  new.availability_reason_code := case
    when v_active_count = 0 then 'APPAREL_VARIANTS_UNAVAILABLE'
    else 'CONFIGURATION_REQUIRED'
  end;
  new.source_available := v_source_available;
  new.source_state := case
    when v_source_available then 'in_stock'
    else 'out_of_stock'
  end;
  new.stock_snapshot := greatest(v_stock_snapshot, 0);
  new.stock_updated_at := now();
  new.is_available := false;
  return new;
end;
$function$;

revoke all on function private.ecommerce_variant_parent_guard() from public;
revoke all on function private.ecommerce_variant_parent_guard() from anon;
revoke all on function private.ecommerce_variant_parent_guard() from authenticated;

drop trigger if exists zzz_ecommerce_variant_parent_guard
  on public.ecommerce_published_products;

create trigger zzz_ecommerce_variant_parent_guard
before insert or update
on public.ecommerce_published_products
for each row
execute function private.ecommerce_variant_parent_guard();

create or replace function private.ecommerce_variant_parent_child_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform private.ecommerce_refresh_variant_parent_state(old.published_product_id);
    return old;
  end if;

  perform private.ecommerce_refresh_variant_parent_state(new.published_product_id);
  if tg_op = 'UPDATE'
     and old.published_product_id is distinct from new.published_product_id then
    perform private.ecommerce_refresh_variant_parent_state(old.published_product_id);
  end if;
  return new;
end;
$function$;

revoke all on function private.ecommerce_variant_parent_child_refresh() from public;
revoke all on function private.ecommerce_variant_parent_child_refresh() from anon;
revoke all on function private.ecommerce_variant_parent_child_refresh() from authenticated;

drop trigger if exists trg_ecommerce_variant_parent_child_refresh
  on public.ecommerce_published_product_variants;

create trigger trg_ecommerce_variant_parent_child_refresh
after insert or delete or update of
  published_product_id,
  source_available,
  manual_available,
  is_available,
  stock_snapshot,
  deleted_at
on public.ecommerce_published_product_variants
for each row
execute function private.ecommerce_variant_parent_child_refresh();

comment on function private.ecommerce_refresh_variant_parent_state(uuid) is
  'Reconciles variant_parent availability from active commercial variants.';

comment on function private.ecommerce_variant_parent_guard() is
  'Keeps empty apparel parents fail-closed and requiring a commercial variant.';;
