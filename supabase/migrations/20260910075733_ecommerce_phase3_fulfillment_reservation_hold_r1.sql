-- ECOM.PHASE3.FULFILLMENT.RESERVATION.HOLD.R1
--
-- Checkout stock holds last 15 minutes. Once an administrator accepts a
-- Pro order, the same reservation moves to fulfillment and uses a portal
-- configurable hold. Historical reservation rows are never rewritten.

alter table public.ecommerce_orders
  add column if not exists stock_reservation_phase text,
  add column if not exists fulfillment_hold_expires_at timestamptz;

alter table public.ecommerce_orders
  drop constraint if exists ecommerce_orders_stock_reservation_phase_valid;

alter table public.ecommerce_orders
  add constraint ecommerce_orders_stock_reservation_phase_valid
  check (stock_reservation_phase is null or stock_reservation_phase in ('checkout', 'fulfillment'));

alter table public.ecommerce_order_inventory_reservations
  add column if not exists reservation_phase text,
  add column if not exists fulfillment_hold_expires_at timestamptz;

alter table public.ecommerce_order_inventory_reservations
  drop constraint if exists ecommerce_order_inventory_reservations_phase_valid;

alter table public.ecommerce_order_inventory_reservations
  add constraint ecommerce_order_inventory_reservations_phase_valid
  check (reservation_phase is null or reservation_phase in ('checkout', 'fulfillment'));

-- The original uniqueness constraint prevented a new, auditable reservation
-- attempt after a prior attempt had expired. Keep at most one ACTIVE row per
-- item/batch, while preserving every terminal reservation row.
alter table public.ecommerce_order_inventory_reservations
  drop constraint if exists ecommerce_order_inventory_reservations_scope_unique;
drop index if exists public.ux_ecommerce_order_inventory_reservations_item_unbatched;

create unique index if not exists ux_ecommerce_order_inventory_reservations_active_unbatched
  on public.ecommerce_order_inventory_reservations (order_item_id)
  where batch_id is null and status = 'reserved';

create unique index if not exists ux_ecommerce_order_inventory_reservations_active_batched
  on public.ecommerce_order_inventory_reservations (order_item_id, batch_id)
  where batch_id is not null and status = 'reserved';

create index if not exists ix_ecommerce_orders_fulfillment_reservation_expiry
  on public.ecommerce_orders (fulfillment_hold_expires_at)
  where stock_reservation_status = 'reserved'
    and stock_reservation_phase = 'fulfillment';

alter table public.ecommerce_order_inventory_reservation_events
  drop constraint if exists ecommerce_order_inventory_reservation_events_transition_check;

alter table public.ecommerce_order_inventory_reservation_events
  add constraint ecommerce_order_inventory_reservation_events_transition_check
  check (transition in (
    'reserved', 'released', 'expired', 'consumed', 'failed',
    'fulfillment_held', 'reservation_reactivated'
  ));

create or replace function private.ecommerce_fulfillment_hold_minutes(
  p_portal_id uuid,
  p_license_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_value text;
  v_minutes integer := 120;
begin
  select nullif(btrim(coalesce(p.settings ->> 'stock_reservation_fulfillment_hold_minutes', '')), '')
    into v_value
    from public.ecommerce_portals p
   where p.id = p_portal_id
     and p.license_id = p_license_id;

  if v_value ~ '^[0-9]{1,4}$' then
    v_minutes := v_value::integer;
  end if;

  return least(greatest(v_minutes, 30), 1440);
end;
$function$;

-- Creates only checkout reservations. It is also used by the administrative
-- revalidation path, which immediately moves the new rows to fulfillment in
-- the same transaction before they can be observed by Cron.
create or replace function private.ecommerce_reserve_order_item_stock(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_item public.ecommerce_order_items%rowtype;
  v_publication public.ecommerce_published_products%rowtype;
  v_product public.pos_products%rowtype;
  v_batch public.pos_product_batches%rowtype;
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_variant_id uuid;
  v_remaining numeric(12,3);
  v_allocate numeric(12,3);
  v_expires_at timestamptz;
  v_product_committed numeric(12,3);
  v_key text;
begin
  if p_order_item_id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select o.* into v_order
    from public.ecommerce_orders o
    join public.ecommerce_order_items i on i.order_id = o.id
   where i.id = p_order_item_id
   for update of o;
  if v_order.id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_item
    from public.ecommerce_order_items
   where id = p_order_item_id
     and order_id = v_order.id
     and portal_id = v_order.portal_id
     and license_id = v_order.license_id
   for update;
  if v_item.id is null or v_item.quantity <= 0 then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if private.ecommerce_reservation_feature_enabled(v_order.license_id) is not true then
    return;
  end if;

  select pp.* into v_publication
    from public.ecommerce_published_products pp
   where pp.id = v_item.published_product_id
     and pp.portal_id = v_order.portal_id
     and pp.license_id = v_order.license_id
     and pp.deleted_at is null
     and pp.is_published is true
   for share;
  if v_publication.id is null or v_item.source_product_id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_product
    from public.pos_products p
   where p.id = v_item.source_product_id
     and p.license_id = v_order.license_id
     and p.deleted_at is null
     and p.is_active is true
   for update;
  if v_product.id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_product.track_stock is not true then return; end if;

  v_variant_id := private.ecommerce_reservation_variant_id(v_item.options);
  v_expires_at := now() + interval '15 minutes';
  v_key := 'ecommerce:' || v_order.id::text || ':' || v_item.id::text;
  v_remaining := v_item.quantity;

  if private.product_uses_batches(v_product) then
    for v_batch in
      select b.*
        from public.pos_product_batches b
       where b.license_id = v_order.license_id
         and b.product_id = v_product.id
         and b.deleted_at is null
         and b.is_active is true
         and b.status = 'active'
         and b.track_stock is true
         and b.stock > b.committed_stock
         and (b.expiry_date is null or b.expiry_date::date >= current_date)
       order by b.expiry_date nulls last, b.created_at, b.id
       for update
    loop
      exit when v_remaining <= 0;
      v_allocate := least(v_remaining, v_batch.stock - v_batch.committed_stock);
      if v_allocate <= 0 then continue; end if;

      update public.pos_product_batches
         set committed_stock = committed_stock + v_allocate,
             updated_at = now(), server_version = server_version + 1,
             last_idempotency_key = v_key || ':batch:' || v_batch.id
       where id = v_batch.id and license_id = v_order.license_id
       returning * into v_batch;

      insert into public.ecommerce_order_inventory_reservations (
        order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
        source_product_id, batch_id, quantity, status, reservation_phase, stock_before, stock_after,
        committed_before, committed_after, idempotency_key, expires_at, metadata
      ) values (
        v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
        v_product.id, v_batch.id, v_allocate, 'reserved', 'checkout', v_batch.stock, v_batch.stock,
        v_batch.committed_stock - v_allocate, v_batch.committed_stock, v_key || ':batch:' || v_batch.id,
        v_expires_at, jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'batch', 'reservationPhase', 'checkout')
      ) returning * into v_reservation;
      perform private.ecommerce_record_reservation_event(v_reservation, 'reserved', v_reservation.idempotency_key);
      v_remaining := v_remaining - v_allocate;
    end loop;
    if v_remaining > 0 then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;

    select coalesce(sum(b.committed_stock), 0) into v_product_committed
      from public.pos_product_batches b
     where b.license_id = v_order.license_id
       and b.product_id = v_product.id
       and b.deleted_at is null;
    update public.pos_products
       set committed_stock = v_product_committed, updated_at = now(),
           server_version = server_version + 1, last_idempotency_key = v_key
     where id = v_product.id and license_id = v_order.license_id;
  else
    if v_product.stock - v_product.committed_stock < v_remaining then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
    update public.pos_products
       set committed_stock = committed_stock + v_remaining, updated_at = now(),
           server_version = server_version + 1, last_idempotency_key = v_key
     where id = v_product.id
       and license_id = v_order.license_id
       and stock - committed_stock >= v_remaining
     returning * into v_product;
    if v_product.id is null then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
    insert into public.ecommerce_order_inventory_reservations (
      order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
      source_product_id, batch_id, quantity, status, reservation_phase, stock_before, stock_after,
      committed_before, committed_after, idempotency_key, expires_at, metadata
    ) values (
      v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
      v_product.id, null, v_remaining, 'reserved', 'checkout', v_product.stock, v_product.stock,
      v_product.committed_stock - v_remaining, v_product.committed_stock, v_key, v_expires_at,
      jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'product', 'reservationPhase', 'checkout')
    ) returning * into v_reservation;
    perform private.ecommerce_record_reservation_event(v_reservation, 'reserved', v_reservation.idempotency_key);
  end if;

  update public.ecommerce_orders
     set stock_reservation_status = 'reserved',
         stock_reservation_phase = 'checkout',
         fulfillment_hold_expires_at = null,
         stock_reservation_expires_at = greatest(coalesce(stock_reservation_expires_at, v_expires_at), v_expires_at),
         updated_at = now()
   where id = v_order.id and license_id = v_order.license_id;
end;
$function$;

create or replace function private.ecommerce_hold_order_reservations_for_fulfillment(
  p_order_id uuid,
  p_license_id uuid,
  p_hold_expires_at timestamptz,
  p_idempotency_key text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_product public.pos_products%rowtype;
  v_batch public.pos_product_batches%rowtype;
  v_count integer := 0;
  v_previous_phase text;
begin
  if p_hold_expires_at is null or p_hold_expires_at <= now() then
    raise exception 'ECOMMERCE_FULFILLMENT_HOLD_INVALID' using errcode = 'P0001';
  end if;

  select * into v_order from public.ecommerce_orders
   where id = p_order_id and license_id = p_license_id
   for update;
  if v_order.id is null then return 0; end if;

  for v_reservation in
    select * from public.ecommerce_order_inventory_reservations
     where order_id = p_order_id
       and license_id = p_license_id
       and status = 'reserved'
     order by source_product_id, coalesce(batch_id, ''), id
     for update
  loop
    -- Match the established finalization lock order: order, reservation,
    -- product, batch. This serializes accept, Cron and another checkout.
    select * into v_product from public.pos_products
     where id = v_reservation.source_product_id and license_id = p_license_id
     for update;
    if v_product.id is null then
      raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
    end if;
    if v_reservation.batch_id is not null then
      select * into v_batch from public.pos_product_batches
       where id = v_reservation.batch_id
         and product_id = v_product.id
         and license_id = p_license_id
       for update;
      if v_batch.id is null then
        raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
      end if;
    end if;

    v_previous_phase := coalesce(v_reservation.reservation_phase, 'checkout');
    update public.ecommerce_order_inventory_reservations
       set reservation_phase = 'fulfillment',
           fulfillment_hold_expires_at = p_hold_expires_at,
           metadata = metadata || jsonb_build_object(
             'reservationPhase', 'fulfillment',
             'fulfillmentHoldExpiresAt', p_hold_expires_at,
             'fulfillmentHoldReason', p_reason
           ),
           updated_at = now()
     where id = v_reservation.id
     returning * into v_reservation;
    perform private.ecommerce_record_reservation_event(
      v_reservation, 'fulfillment_held', p_idempotency_key || ':' || v_reservation.id::text,
      jsonb_build_object(
        'fromPhase', v_previous_phase,
        'toPhase', 'fulfillment',
        'checkoutExpiresAt', v_reservation.expires_at,
        'fulfillmentHoldExpiresAt', p_hold_expires_at,
        'reason', p_reason
      )
    );
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.ecommerce_orders
       set stock_reservation_status = 'reserved',
           stock_reservation_phase = 'fulfillment',
           fulfillment_hold_expires_at = p_hold_expires_at,
           stock_reservation_expires_at = null,
           updated_at = now()
     where id = p_order_id and license_id = p_license_id;
  end if;
  return v_count;
end;
$function$;

create or replace function private.ecommerce_revalidate_order_stock_for_fulfillment(
  p_order_id uuid,
  p_license_id uuid,
  p_hold_expires_at timestamptz,
  p_idempotency_key text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_item public.ecommerce_order_items%rowtype;
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_count integer;
begin
  select * into v_order from public.ecommerce_orders
   where id = p_order_id and license_id = p_license_id
   for update;
  if v_order.id is null or v_order.stock_reservation_status <> 'expired' then
    raise exception 'ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED' using errcode = 'P0001';
  end if;
  if private.ecommerce_reservation_feature_enabled(p_license_id) is not true then
    raise exception 'ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in
    select * from public.ecommerce_order_items
     where order_id = p_order_id and portal_id = v_order.portal_id and license_id = p_license_id
     order by source_product_id, id
     for update
  loop
    perform private.ecommerce_reserve_order_item_stock(v_item.id);
  end loop;

  for v_reservation in
    select * from public.ecommerce_order_inventory_reservations
     where order_id = p_order_id and license_id = p_license_id and status = 'reserved'
     order by source_product_id, coalesce(batch_id, ''), id
     for update
  loop
    perform private.ecommerce_record_reservation_event(
      v_reservation, 'reservation_reactivated', p_idempotency_key || ':reactivated:' || v_reservation.id::text,
      jsonb_build_object(
        'fromStatus', 'expired', 'toStatus', 'reserved',
        'fromPhase', 'checkout', 'toPhase', 'fulfillment',
        'reason', p_reason
      )
    );
  end loop;

  v_count := private.ecommerce_hold_order_reservations_for_fulfillment(
    p_order_id, p_license_id, p_hold_expires_at, p_idempotency_key, p_reason
  );
  if v_count = 0 then
    raise exception 'ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED' using errcode = 'P0001';
  end if;
  return v_count;
end;
$function$;

create or replace function private.ecommerce_finalize_order_stock_reservations(
  p_order_id uuid,
  p_license_id uuid,
  p_transition text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_product public.pos_products%rowtype;
  v_batch public.pos_product_batches%rowtype;
  v_product_committed numeric(12,3);
  v_order public.ecommerce_orders%rowtype;
  v_key text;
begin
  if p_transition not in ('released', 'expired', 'consumed') then
    raise exception 'ECOMMERCE_RESERVATION_TRANSITION_INVALID' using errcode = 'P0001';
  end if;
  select * into v_order from public.ecommerce_orders
   where id = p_order_id and license_id = p_license_id for update;
  if v_order.id is null then return; end if;

  if p_transition = 'consumed' and exists (
    select 1 from public.ecommerce_order_inventory_reservations r
     where r.order_id = p_order_id and r.license_id = p_license_id
       and r.status = 'reserved'
       and coalesce(r.reservation_phase, 'checkout') <> 'fulfillment'
  ) then
    raise exception 'ECOMMERCE_FULFILLMENT_RESERVATION_REQUIRED' using errcode = 'P0001';
  end if;

  for v_reservation in
    select * from public.ecommerce_order_inventory_reservations
     where order_id = p_order_id and license_id = p_license_id and status = 'reserved'
     order by source_product_id, coalesce(batch_id, ''), id
     for update
  loop
    v_key := p_idempotency_key || ':' || v_reservation.id::text;
    select * into v_product from public.pos_products
     where id = v_reservation.source_product_id and license_id = p_license_id for update;
    if v_product.id is null then raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001'; end if;
    if v_reservation.batch_id is not null then
      select * into v_batch from public.pos_product_batches
       where id = v_reservation.batch_id and product_id = v_product.id and license_id = p_license_id for update;
      if v_batch.id is null then raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001'; end if;
      update public.pos_product_batches
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_batch.id and license_id = p_license_id;
      select coalesce(sum(committed_stock), 0) into v_product_committed
        from public.pos_product_batches
       where product_id = v_product.id and license_id = p_license_id and deleted_at is null;
      update public.pos_products
         set committed_stock = v_product_committed, updated_at = now(),
             server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    else
      update public.pos_products
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    end if;
    update public.ecommerce_order_inventory_reservations
       set status = p_transition,
           released_at = case when p_transition in ('released', 'expired') then now() else released_at end,
           consumed_at = case when p_transition = 'consumed' then now() else consumed_at end,
           updated_at = now(),
           metadata = metadata || jsonb_build_object('finalizationKey', v_key, 'finalizationPhase', coalesce(v_reservation.reservation_phase, 'checkout'))
     where id = v_reservation.id;
    select * into v_reservation from public.ecommerce_order_inventory_reservations where id = v_reservation.id;
    perform private.ecommerce_record_reservation_event(v_reservation, p_transition, v_key);
  end loop;
  update public.ecommerce_orders
     set stock_reservation_status = p_transition, stock_reservation_phase = null,
         stock_reservation_expires_at = null, fulfillment_hold_expires_at = null, updated_at = now()
   where id = p_order_id and license_id = p_license_id and stock_reservation_status = 'reserved';
end;
$function$;

create or replace function private.ecommerce_expire_abandoned_stock_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_count integer := 0;
  v_phase text;
begin
  for v_order in
    select * from public.ecommerce_orders
     where stock_reservation_status = 'reserved'
       and status not in ('rejected', 'cancelled', 'converted_to_sale', 'completed')
       and case coalesce(stock_reservation_phase, 'checkout')
         when 'fulfillment' then fulfillment_hold_expires_at <= now()
         else stock_reservation_expires_at <= now()
       end
     order by coalesce(fulfillment_hold_expires_at, stock_reservation_expires_at), id
     for update skip locked
  loop
    v_phase := coalesce(v_order.stock_reservation_phase, 'checkout');
    perform private.ecommerce_finalize_order_stock_reservations(
      v_order.id, v_order.license_id, 'expired', 'ecommerce:expire:' || v_order.id::text
    );
    insert into public.ecommerce_order_events(
      order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload
    ) values (
      v_order.id, v_order.portal_id, v_order.license_id, 'stock_reservation_expired', 'automation',
      'pg_cron', 'La reserva de inventario venció y requiere revalidación.',
      jsonb_build_object('reservationPhase', v_phase)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function private.ecommerce_order_reservation_lifecycle_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.stock_reservation_status <> 'reserved' then return new; end if;
  if new.status in ('rejected', 'cancelled') or new.fulfillment_status = 'cancelled' then
    perform private.ecommerce_finalize_order_stock_reservations(new.id, new.license_id, 'released', 'ecommerce:cancel:' || new.id::text);
  elsif (new.status = 'converted_to_sale' and new.pos_conversion_status = 'completed' and new.converted_sale_id is not null)
     or (new.fulfillment_status = 'completed' and old.fulfillment_status is distinct from 'completed') then
    perform private.ecommerce_finalize_order_stock_reservations(
      new.id, new.license_id, 'consumed',
      'ecommerce:consume:' || coalesce(new.converted_sale_id, new.id::text)
    );
  end if;
  return new;
end;
$function$;

-- Stops preparation, delivery and conversion if an accepted order has no
-- active fulfillment reservation. Cancellation remains allowed so it can
-- release an active hold. The public RPCs convert this exception to a safe
-- error response; no business record is changed.
create or replace function private.ecommerce_require_fulfillment_reservation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requires_reservation boolean;
  v_operational_transition boolean;
begin
  v_operational_transition := (
    new.status = 'converted_to_sale'
    or (new.fulfillment_status is distinct from old.fulfillment_status
      and new.fulfillment_status not in ('cancelled', null))
  );
  if not v_operational_transition then return new; end if;
  v_requires_reservation := private.ecommerce_reservation_feature_enabled(new.license_id)
    and exists (
      select 1 from public.ecommerce_order_inventory_reservations r
       where r.order_id = new.id and r.license_id = new.license_id
    );
  if v_requires_reservation
     and (old.stock_reservation_status <> 'reserved'
       or coalesce(old.stock_reservation_phase, 'checkout') <> 'fulfillment'
       or old.fulfillment_hold_expires_at is null
       or old.fulfillment_hold_expires_at <= now()) then
    raise exception 'ECOMMERCE_FULFILLMENT_RESERVATION_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists ecommerce_orders_require_fulfillment_reservation on public.ecommerce_orders;
create trigger ecommerce_orders_require_fulfillment_reservation
before update of status, fulfillment_status, pos_conversion_status, converted_sale_id on public.ecommerce_orders
for each row execute function private.ecommerce_require_fulfillment_reservation_trigger();

create or replace function public.ecommerce_admin_accept_order(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_order_id uuid, p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_from_status text;
  v_hold_minutes integer;
  v_hold_expires_at timestamptz;
  v_reservation_count integer := 0;
  v_reactivated boolean := false;
  v_key text;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_accept_order');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  select o.* into v_order from public.ecommerce_orders o
   where o.id = p_order_id and o.license_id = v_license_id and o.pos_visibility_status in ('pending', 'visible') for update;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status = 'accepted' then
    return jsonb_build_object('success', true, 'changed', false, 'order', jsonb_build_object(
      'id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status,
      'acceptedAt', v_order.accepted_at, 'stockReservationStatus', v_order.stock_reservation_status,
      'stockReservationPhase', v_order.stock_reservation_phase, 'fulfillmentHoldExpiresAt', v_order.fulfillment_hold_expires_at
    ));
  end if;
  if v_order.status not in ('new', 'seen') then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION'); end if;

  v_hold_minutes := private.ecommerce_fulfillment_hold_minutes(v_order.portal_id, v_license_id);
  v_hold_expires_at := now() + make_interval(mins => v_hold_minutes);
  v_key := 'ecommerce:accept:' || v_order.id::text;
  if private.ecommerce_reservation_feature_enabled(v_license_id) then
    if v_order.stock_reservation_status = 'reserved' then
      v_reservation_count := private.ecommerce_hold_order_reservations_for_fulfillment(v_order.id, v_license_id, v_hold_expires_at, v_key, 'admin_accept_active_checkout_reservation');
    elsif v_order.stock_reservation_status = 'expired' then
      v_reservation_count := private.ecommerce_revalidate_order_stock_for_fulfillment(v_order.id, v_license_id, v_hold_expires_at, v_key, 'admin_accept_after_expiry');
      v_reactivated := true;
    elsif v_order.stock_reservation_status not in ('not_applicable', null) then
      return private.ecommerce_orders_error_v1('ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED');
    end if;
    if v_order.stock_reservation_status in ('reserved', 'expired') and v_reservation_count = 0 then
      return private.ecommerce_orders_error_v1('ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED');
    end if;
  end if;

  v_from_status := v_order.status;
  update public.ecommerce_orders
     set status = 'accepted', accepted_at = coalesce(accepted_at, now()), seen_at = coalesce(seen_at, now()),
         pos_visibility_status = 'visible', updated_at = now()
   where id = v_order.id returning * into v_order;
  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (
    v_order.id, v_order.portal_id, v_order.license_id, 'order_accepted', v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), nullif(v_auth->>'device_id', '')), 'Pedido aceptado',
    jsonb_build_object('fromStatus', v_from_status, 'toStatus', 'accepted', 'actorLabel', v_auth->>'actor_label',
      'reservationReactivated', v_reactivated, 'fulfillmentHoldMinutes', case when v_reservation_count > 0 then v_hold_minutes else null end,
      'fulfillmentHoldExpiresAt', case when v_reservation_count > 0 then v_hold_expires_at else null end,
      'idempotencyKey', v_key)
  );
  perform private.broadcast_ecommerce_order_change_v1(v_order.license_id, v_order.id, v_order.status, 'order_accepted');
  return jsonb_build_object('success', true, 'changed', true, 'reservationReactivated', v_reactivated,
    'fulfillmentHoldMinutes', case when v_reservation_count > 0 then v_hold_minutes else null end,
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status,
      'seenAt', v_order.seen_at, 'acceptedAt', v_order.accepted_at, 'stockReservationStatus', v_order.stock_reservation_status,
      'stockReservationPhase', v_order.stock_reservation_phase, 'fulfillmentHoldExpiresAt', v_order.fulfillment_hold_expires_at));
exception when sqlstate 'P0001' then
  if SQLERRM = 'ECOMMERCE_INSUFFICIENT_STOCK' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ACCEPT_RESERVATION_STOCK_UNAVAILABLE', 'No se puede aceptar el pedido porque la reserva expiró y el producto ya no tiene existencia disponible.');
  end if;
  return private.ecommerce_orders_error_v1('ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED');
when others then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_revalidate_order_stock(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_order_id uuid, p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_hold_minutes integer;
  v_hold_expires_at timestamptz;
  v_count integer;
  v_key text;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_revalidate_order_stock');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  select * into v_order from public.ecommerce_orders
   where id = p_order_id and license_id = v_license_id and pos_visibility_status in ('pending','visible') for update;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status not in ('accepted', 'preparing', 'ready') or v_order.stock_reservation_status <> 'expired' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED');
  end if;
  v_hold_minutes := private.ecommerce_fulfillment_hold_minutes(v_order.portal_id, v_license_id);
  v_hold_expires_at := now() + make_interval(mins => v_hold_minutes);
  v_key := 'ecommerce:revalidate:' || v_order.id::text;
  v_count := private.ecommerce_revalidate_order_stock_for_fulfillment(v_order.id, v_license_id, v_hold_expires_at, v_key, 'admin_operational_revalidation');
  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (v_order.id, v_order.portal_id, v_order.license_id, 'stock_reservation_revalidated', v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), nullif(v_auth->>'device_id', '')),
    'Stock revalidado y reservado nuevamente para fulfillment.',
    jsonb_build_object('fulfillmentHoldMinutes', v_hold_minutes, 'fulfillmentHoldExpiresAt', v_hold_expires_at,
      'idempotencyKey', v_key, 'actorLabel', v_auth->>'actor_label'));
  perform private.broadcast_ecommerce_order_change_v1(v_order.license_id, v_order.id, v_order.status, 'stock_reservation_revalidated');
  return jsonb_build_object('success', true, 'changed', true, 'fulfillmentHoldMinutes', v_hold_minutes,
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status,
      'stockReservationStatus', 'reserved', 'stockReservationPhase', 'fulfillment', 'fulfillmentHoldExpiresAt', v_hold_expires_at));
exception when sqlstate 'P0001' then
  if SQLERRM = 'ECOMMERCE_INSUFFICIENT_STOCK' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ACCEPT_RESERVATION_STOCK_UNAVAILABLE', 'No se puede aceptar el pedido porque la reserva expiró y el producto ya no tiene existencia disponible.');
  end if;
  return private.ecommerce_orders_error_v1('ECOMMERCE_RESERVATION_REVALIDATION_REQUIRED');
when others then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function private.ecommerce_order_pos_snapshot_v1(
  p_order_id uuid, p_license_id uuid, p_auth jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_items jsonb;
  v_events jsonb;
  v_whatsapp_url text;
  v_is_owner boolean := false;
  v_can_pos boolean := false;
begin
  select o.* into v_order from public.ecommerce_orders o where o.id = p_order_id and o.license_id = p_license_id limit 1;
  if v_order.id is null then return null; end if;
  v_can_pos := p_auth->>'actor_type' = 'admin' or coalesce((p_auth->'staff_permissions'->>'pos')::boolean, false) is true;
  v_is_owner := v_can_pos and v_order.pos_claim_token is not null and v_order.pos_claim_actor_ref = nullif(p_auth->>'device_id', '');
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'sourceProductId', coalesce(i.source_product_id, pp.product_id, pp.local_product_ref), 'publishedProductId', i.published_product_id, 'productName', i.product_name, 'unitPrice', i.unit_price, 'quantity', i.quantity, 'lineTotal', i.line_total, 'options', case when jsonb_typeof(i.options) = 'object' then i.options else '{}'::jsonb end) order by i.created_at, i.id), '[]'::jsonb)
    into v_items from public.ecommerce_order_items i left join public.ecommerce_published_products pp on pp.id = i.published_product_id and pp.portal_id = i.portal_id and pp.license_id = i.license_id where i.order_id = v_order.id and i.portal_id = v_order.portal_id and i.license_id = p_license_id;
  select coalesce(jsonb_agg(jsonb_build_object('eventType', e.event_type, 'actorType', e.actor_type, 'actorLabel', case e.actor_type when 'admin' then 'Administrador' when 'staff' then coalesce(nullif(left(btrim(e.payload->>'actorLabel'), 80), ''), 'Personal') when 'public_customer' then 'Cliente' when 'automation' then 'Automatización' else 'Sistema' end, 'message', case e.event_type when 'order_created' then 'Pedido creado desde la tienda online.' when 'order_seen' then 'Pedido marcado como visto.' when 'order_accepted' then 'Pedido aceptado.' when 'order_rejected' then 'Pedido rechazado.' else nullif(left(btrim(coalesce(e.message, '')), 200), '') end, 'payload', private.ecommerce_order_event_public_payload_v1(e.event_type, e.payload), 'createdAt', e.created_at) order by e.created_at, e.id), '[]'::jsonb)
    into v_events from public.ecommerce_order_events e where e.order_id = v_order.id and e.license_id = p_license_id;
  v_whatsapp_url := private.ecommerce_build_whatsapp_url(v_order.customer_phone, 'Hola, te contactamos sobre tu pedido ' || coalesce(v_order.public_order_code, 'online') || '.');
  if v_whatsapp_url is not null and left(v_whatsapp_url, 14) <> 'https://wa.me/' then v_whatsapp_url := null; end if;
  return jsonb_build_object(
    'id', v_order.id, 'code', v_order.public_order_code, 'licenseIdentity', v_order.license_id, 'status', v_order.status, 'channel', v_order.channel, 'fulfillmentMethod', v_order.fulfillment_method,
    'customer', jsonb_build_object('name', v_order.customer_name, 'phone', v_order.customer_phone, 'address', v_order.customer_address, 'notes', v_order.customer_notes),
    'totals', jsonb_build_object('subtotal', v_order.subtotal, 'deliveryFee', v_order.delivery_fee, 'discountTotal', v_order.discount_total, 'taxTotal', v_order.tax_total, 'total', v_order.total, 'currency', v_order.currency),
    'payment', jsonb_build_object('method', v_order.payment_method, 'status', v_order.payment_status),
    'timestamps', jsonb_build_object('createdAt', v_order.created_at, 'updatedAt', v_order.updated_at, 'seenAt', v_order.seen_at, 'acceptedAt', v_order.accepted_at, 'rejectedAt', v_order.rejected_at),
    'stockReservation', jsonb_strip_nulls(jsonb_build_object('status', v_order.stock_reservation_status, 'phase', v_order.stock_reservation_phase, 'checkoutExpiresAt', case when coalesce(v_order.stock_reservation_phase, 'checkout') = 'checkout' then v_order.stock_reservation_expires_at else null end, 'fulfillmentHoldExpiresAt', v_order.fulfillment_hold_expires_at, 'fulfillmentHoldMinutes', case when v_order.stock_reservation_phase = 'fulfillment' then private.ecommerce_fulfillment_hold_minutes(v_order.portal_id, v_order.license_id) else null end)),
    'items', coalesce(v_items, '[]'::jsonb), 'events', coalesce(v_events, '[]'::jsonb), 'contact', jsonb_build_object('whatsappUrl', v_whatsapp_url),
    'posDraft', jsonb_strip_nulls(jsonb_build_object('status', v_order.pos_draft_status, 'draftId', v_order.pos_draft_id, 'claimedAt', v_order.pos_claimed_at, 'expiresAt', v_order.pos_claim_expires_at, 'preparedAt', v_order.pos_draft_prepared_at, 'isClaimedByCurrentActor', v_is_owner, 'claimToken', case when v_is_owner then v_order.pos_claim_token else null end))
  );
end;
$function$;

alter function private.ecommerce_fulfillment_hold_minutes(uuid, uuid) owner to postgres;
alter function private.ecommerce_reserve_order_item_stock(uuid) owner to postgres;
alter function private.ecommerce_hold_order_reservations_for_fulfillment(uuid, uuid, timestamptz, text, text) owner to postgres;
alter function private.ecommerce_revalidate_order_stock_for_fulfillment(uuid, uuid, timestamptz, text, text) owner to postgres;
alter function private.ecommerce_finalize_order_stock_reservations(uuid, uuid, text, text) owner to postgres;
alter function private.ecommerce_expire_abandoned_stock_reservations() owner to postgres;
alter function private.ecommerce_order_reservation_lifecycle_trigger() owner to postgres;
alter function private.ecommerce_require_fulfillment_reservation_trigger() owner to postgres;
alter function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) owner to postgres;
alter function public.ecommerce_admin_accept_order(text, text, text, uuid, text) owner to postgres;
alter function public.ecommerce_admin_revalidate_order_stock(text, text, text, uuid, text) owner to postgres;

revoke all on function private.ecommerce_fulfillment_hold_minutes(uuid, uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_reserve_order_item_stock(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_hold_order_reservations_for_fulfillment(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_revalidate_order_stock_for_fulfillment(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_finalize_order_stock_reservations(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_expire_abandoned_stock_reservations() from public, anon, authenticated;
revoke all on function private.ecommerce_order_reservation_lifecycle_trigger() from public, anon, authenticated;
revoke all on function private.ecommerce_require_fulfillment_reservation_trigger() from public, anon, authenticated;
revoke all on function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) from public, anon;
revoke all on function public.ecommerce_admin_revalidate_order_stock(text, text, text, uuid, text) from public, anon;
grant execute on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) to authenticated;
grant execute on function public.ecommerce_admin_revalidate_order_stock(text, text, text, uuid, text) to authenticated;
