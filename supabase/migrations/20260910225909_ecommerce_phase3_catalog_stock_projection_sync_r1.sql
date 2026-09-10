-- ECOM.PHASE3.CATALOG.STOCK.PROJECTION.SYNC.R1
--
-- `committed_stock` in public.pos_products is the authoritative reservation
-- quantity. This migration projects its post-transition availability into the
-- e-commerce catalog in the same transaction. It never changes physical stock,
-- order rows, reservation rows, or reservation events.

create or replace function private.ecommerce_sync_published_stock_projection(
  p_license_id uuid,
  p_source_product_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.pos_products%rowtype;
  v_available numeric(12,3);
  v_changed integer := 0;
  v_variant_changed integer := 0;
begin
  if p_license_id is null
     or nullif(btrim(coalesce(p_source_product_id, '')), '') is null then
    raise exception 'ECOMMERCE_STOCK_PROJECTION_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  -- The transition has already locked this product before changing
  -- committed_stock. FOR SHARE preserves that lock order for a direct call and
  -- serializes the bounded migration repair with a concurrent transition.
  select p.*
    into v_product
    from public.pos_products p
   where p.id = p_source_product_id
     and p.license_id = p_license_id
     and p.deleted_at is null
   for share;
  if v_product.id is null then
    raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
  end if;

  -- Untracked inventory preserves its existing publication contract.
  if v_product.track_stock is not true then
    return 0;
  end if;

  if private.product_uses_batches(v_product) then
    select coalesce(sum(greatest(b.stock - b.committed_stock, 0)), 0)
      into v_available
      from public.pos_product_batches b
     where b.license_id = p_license_id
       and b.product_id = v_product.id
       and b.deleted_at is null
       and b.is_active is true
       and b.status = 'active'
       and b.track_stock is true
       and (b.expiry_date is null or b.expiry_date::date >= current_date);
  else
    v_available := greatest(v_product.stock - v_product.committed_stock, 0);
  end if;

  -- A direct publication may be exposed through more than one portal under the
  -- same license. They share the same authoritative POS product, so each is
  -- updated atomically without crossing license boundaries.
  update public.ecommerce_published_products pp
     set stock_snapshot = v_available,
         source_available = v_available > 0,
         source_state = case when v_available > 0 then 'in_stock' else 'out_of_stock' end,
         stock_updated_at = now()
   where pp.license_id = p_license_id
     and pp.local_product_ref = v_product.id
     and pp.deleted_at is null
     and pp.availability_source = 'direct'
     and pp.configuration_type <> 'variant_parent'
     and (
       pp.stock_snapshot,
       pp.source_available,
       pp.source_state
     ) is distinct from (
       v_available,
       v_available > 0,
       case when v_available > 0 then 'in_stock' else 'out_of_stock' end
     );
  get diagnostics v_changed = row_count;

  -- Configured products project the source product into the concrete variant;
  -- the existing child trigger then refreshes its parent aggregate and revision.
  update public.ecommerce_published_product_variants v
     set stock_snapshot = v_available,
         source_available = v_available > 0
   where v.license_id = p_license_id
     and v.source_product_id = v_product.id
     and v.deleted_at is null
     and (
       v.stock_snapshot,
       v.source_available
     ) is distinct from (
       v_available,
       v_available > 0
     );
  get diagnostics v_variant_changed = row_count;
  v_changed := v_changed + v_variant_changed;

  -- Existing guards derive is_available from manual_available AND
  -- source_available. Existing catalog-revision triggers run only when the
  -- public signature changed, invalidating the revision-keyed public cache.
  return v_changed;
end;
$function$;

create or replace function private.ecommerce_sync_published_stock_projection_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.committed_stock is distinct from old.committed_stock then
    perform private.ecommerce_sync_published_stock_projection(new.license_id, new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ecommerce_pos_product_committed_stock_projection
  on public.pos_products;

create trigger trg_ecommerce_pos_product_committed_stock_projection
after update of committed_stock on public.pos_products
for each row
execute function private.ecommerce_sync_published_stock_projection_trigger();

-- Reconcile only products that have participated in e-commerce reservations.
-- The helper itself writes only a stale derived projection and never scans or
-- rewrites the whole catalog.
do $repair$
declare
  v_source record;
begin
  for v_source in
    select distinct r.license_id, r.source_product_id
      from public.ecommerce_order_inventory_reservations r
      join public.pos_products p
        on p.id = r.source_product_id
       and p.license_id = r.license_id
       and p.deleted_at is null
     where exists (
       select 1
         from public.ecommerce_published_products pp
        where pp.license_id = r.license_id
          and pp.local_product_ref = r.source_product_id
          and pp.deleted_at is null
          and pp.availability_source = 'direct'
     )
        or exists (
       select 1
         from public.ecommerce_published_product_variants v
        where v.license_id = r.license_id
          and v.source_product_id = r.source_product_id
          and v.deleted_at is null
     )
  loop
    perform private.ecommerce_sync_published_stock_projection(
      v_source.license_id,
      v_source.source_product_id
    );
  end loop;
end;
$repair$;

alter function private.ecommerce_sync_published_stock_projection(uuid, text)
  owner to postgres;
alter function private.ecommerce_sync_published_stock_projection_trigger()
  owner to postgres;

revoke all on function private.ecommerce_sync_published_stock_projection(uuid, text)
  from public, anon, authenticated;
revoke all on function private.ecommerce_sync_published_stock_projection_trigger()
  from public, anon, authenticated;

comment on function private.ecommerce_sync_published_stock_projection(uuid, text)
  is 'Projects authoritative POS available stock into affected e-commerce publications after committed-stock changes; no physical inventory mutation.';
