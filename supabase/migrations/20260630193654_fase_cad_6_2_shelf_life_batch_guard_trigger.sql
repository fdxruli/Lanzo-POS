create or replace function private.pos_product_batch_shelf_life_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_product public.pos_products;
  v_target_date timestamptz;
begin
  if greatest(coalesce(new.stock, 0) - coalesce(new.committed_stock, 0), 0) <= 0 then
    return new;
  end if;

  select * into v_product
  from public.pos_products
  where license_id = new.license_id
    and id = new.product_id;

  if v_product.expiration_mode <> 'SHELF_LIFE' then
    return new;
  end if;

  if new.expiry_date is not null or new.alert_target_date is not null then
    new.expiry_date := coalesce(new.expiry_date, new.alert_target_date);
    new.alert_target_date := coalesce(new.alert_target_date, new.expiry_date);
    return new;
  end if;

  v_target_date := private.calculate_pos_shelf_life_target(
    coalesce(new.created_at, now()),
    v_product.shelf_life_value,
    v_product.shelf_life_unit
  );

  if v_target_date is null then
    raise exception 'SHELF_LIFE_VALUE_REQUIRED: Indica una vida util valida para crear inventario con caducidad estimada.'
      using errcode = 'P0001';
  end if;

  new.expiry_date := v_target_date;
  new.alert_target_date := v_target_date;
  new.alert_type := 'VIDA_UTIL_ESTIMADA';
  return new;
end;
$function$;

drop trigger if exists trg_pos_product_batches_shelf_life_guard on public.pos_product_batches;
create trigger trg_pos_product_batches_shelf_life_guard
before insert or update of stock, committed_stock, expiry_date, alert_target_date, product_id, license_id, created_at
on public.pos_product_batches
for each row
execute function private.pos_product_batch_shelf_life_guard();
