-- ECOM.FE.CATALOG.3 - Correccion de backfill y triggers de compatibilidad.
-- Restaura la disponibilidad legacy capturada antes de agregar source/manual.

update public.ecommerce_published_products pp
set manual_available = legacy.is_available,
    source_available = true,
    is_available = legacy.is_available
from private.ecommerce_catalog_3_legacy_availability legacy
where legacy.product_id = pp.id
  and pp.source_revision is null
  and pp.last_sync_attempt_at is null
  and pp.last_synced_at is null
  and pp.source_state = 'manual'
  and pp.sync_status = 'manual';

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

  new.is_available := new.manual_available and new.source_available;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$$;

create or replace function private.ecommerce_bump_catalog_revision_on_product_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old_signature jsonb;
  v_new_signature jsonb;
  v_portal_id uuid;
begin
  if tg_op = 'INSERT' then
    v_old_signature := null;
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  elsif tg_op = 'DELETE' then
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := null;
    v_portal_id := old.portal_id;
  else
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  end if;

  if v_old_signature is distinct from v_new_signature then
    update public.ecommerce_portals
    set catalog_revision = catalog_revision + 1
    where id = v_portal_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop table if exists private.ecommerce_catalog_3_legacy_availability;
