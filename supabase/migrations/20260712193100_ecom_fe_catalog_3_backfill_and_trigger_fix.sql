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
        and new.source_available is not distinct from old.source_available
        and new.is_available is distinct from old.is_available then
    -- Compatibilidad exclusiva con escritores legacy que solo cambian is_available.
    -- Una sincronizacion de source_available nunca se convierte en cambio manual.
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

create or replace function private.ecommerce_product_public_signature(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_product.id is null
      or p_product.deleted_at is not null
      or p_product.is_published is not true
      then null
    else jsonb_build_object(
      'id', p_product.id,
      'name', p_product.public_name,
      'description', p_product.public_description,
      'categoryName', p_product.category_name,
      'price', p_product.price,
      'currency', p_product.currency,
      'imageUrl', p_product.image_url,
      'isAvailable', p_product.is_available,
      'displayOrder', p_product.display_order,
      'stock', case
        when private.ecommerce_license_feature_bool(
          p_product.license_id,
          'ecommerce_stock_visibility',
          false
        ) is not true then jsonb_build_object(
          'mode', 'hidden', 'status', null, 'quantity', null
        )
        when p_product.stock_mode = 'status' then jsonb_build_object(
          'mode', 'status',
          'status', case
            when coalesce(p_product.stock_snapshot, 1) > 0 then 'available'
            else 'out_of_stock'
          end,
          'quantity', null
        )
        when p_product.stock_mode = 'exact' then jsonb_build_object(
          'mode', 'exact',
          'status', case
            when coalesce(p_product.stock_snapshot, 0) > 0 then 'available'
            else 'out_of_stock'
          end,
          'quantity', greatest(coalesce(p_product.stock_snapshot, 0), 0)
        )
        else jsonb_build_object(
          'mode', 'hidden', 'status', null, 'quantity', null
        )
      end,
      'options', p_product.options
    )
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
;
