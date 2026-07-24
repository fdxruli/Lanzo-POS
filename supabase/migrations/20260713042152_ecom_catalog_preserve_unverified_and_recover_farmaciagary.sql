-- Avoid treating a per-device IndexedDB cache miss as an authoritative deletion.
-- New clients submit this condition as `unverified`. This guard also normalizes
-- source_missing from older deployed clients, so a stale browser cannot disable
-- a public product merely because its local cache does not contain it.
create or replace function private.ecommerce_published_product_sync_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.sync_config := private.ecommerce_normalize_sync_config(
    new.sync_config,
    case when tg_op = 'UPDATE' then old.sync_config else null end
  );

  if tg_op = 'INSERT' then
    new.manual_available := coalesce(new.is_available, new.manual_available, true);
    new.source_available := coalesce(new.source_available, true);
  elsif new.manual_available is not distinct from old.manual_available
        and new.source_available is not distinct from old.source_available
        and new.is_available is distinct from old.is_available then
    new.manual_available := coalesce(new.is_available, old.manual_available, true);
  end if;

  new.manual_available := coalesce(new.manual_available, true);
  new.source_available := coalesce(new.source_available, true);

  if new.source_state = 'not_tracked' then
    new.track_stock := false;
    new.stock_mode := 'hidden';
    new.stock_snapshot := null;
  end if;

  if tg_op = 'UPDATE' and new.source_state in ('unverified', 'source_missing') then
    new.public_name := old.public_name;
    new.public_description := old.public_description;
    new.category_name := old.category_name;
    new.price := old.price;
    new.image_url := old.image_url;
    new.stock_snapshot := old.stock_snapshot;
    new.stock_updated_at := old.stock_updated_at;
  end if;

  if tg_op = 'UPDATE' and new.source_state = 'unverified' then
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
  elsif tg_op = 'UPDATE' and new.source_state = 'source_missing' then
    new.source_state := 'unverified';
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
    new.last_synced_at := old.last_synced_at;
  end if;

  new.is_available := new.manual_available and new.source_available;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$$;

-- Recover the five products that were incorrectly marked SOURCE_MISSING by the
-- previous client reconciliation. The source rows are joined live so this migration
-- only changes current, active source products for this portal.
with affected_refs(local_product_ref) as (
  values
    ('prod_mr19t48e_2e2fe73c'),
    ('prod_mr19ldsc_7f0dc64e'),
    ('TEST_SYS_PROD_GENERICO'),
    ('1783579984629'),
    ('prod_rest_taco_pastor')
), live_source as (
  select
    pp.id,
    case
      when product.track_stock is false then 'not_tracked'
      when greatest(coalesce(product.stock, 0) - coalesce(product.committed_stock, 0), 0) > 0
        then 'in_stock'
      else 'out_of_stock'
    end as source_state,
    case
      when product.track_stock is false then true
      when greatest(coalesce(product.stock, 0) - coalesce(product.committed_stock, 0), 0) > 0
        then true
      else false
    end as source_available,
    case
      when product.track_stock is false then null
      else greatest(coalesce(product.stock, 0) - coalesce(product.committed_stock, 0), 0)
    end as stock_snapshot
  from public.ecommerce_published_products pp
  join public.ecommerce_portals portal
    on portal.id = pp.portal_id
  join affected_refs ref
    on ref.local_product_ref = pp.local_product_ref
  join public.pos_products product
    on product.id::text = pp.local_product_ref
   and product.license_id = pp.license_id
  where portal.slug = 'farmaciagary'
    and portal.deleted_at is null
    and pp.deleted_at is null
    and pp.source_state = 'source_missing'
    and pp.sync_error_code = 'SOURCE_MISSING'
    and pp.source_available is false
    and product.is_active is true
)
update public.ecommerce_published_products pp
set
  source_state = source.source_state,
  source_available = source.source_available,
  stock_snapshot = source.stock_snapshot,
  sync_status = 'synced',
  sync_error_code = null,
  last_sync_attempt_at = now(),
  last_synced_at = now()
from live_source source
where pp.id = source.id;;
