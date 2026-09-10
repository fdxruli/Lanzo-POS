-- ECOM.PHASE3.STOCK.RESERVATIONS
--
-- The POS inventory tables remain authoritative.  Ecommerce only commits
-- available stock (stock - committed_stock); it never creates a second stock
-- ledger and never decrements stock directly.  A later, authorized POS-sale
-- conversion consumes the physical stock through the existing POS flow.

create schema if not exists private;

do $migration$
begin
  if exists (
    select 1
    from public.ecommerce_orders
    where stock_reservation_status not in ('not_applicable', 'pending', 'reserved', 'released', 'failed')
  ) then
    raise exception 'ECOMMERCE_PHASE3_UNEXPECTED_RESERVATION_STATE';
  end if;
end;
$migration$;

alter table public.ecommerce_orders
  drop constraint if exists ecommerce_orders_stock_reservation_status_valid;

alter table public.ecommerce_orders
  add column if not exists stock_reservation_expires_at timestamptz,
  add constraint ecommerce_orders_stock_reservation_status_valid
    check (stock_reservation_status in (
      'not_applicable', 'reserved', 'released', 'expired', 'consumed', 'failed'
    ));

create index if not exists ix_ecommerce_orders_reservation_expiry
  on public.ecommerce_orders (stock_reservation_expires_at)
  where stock_reservation_status = 'reserved';

create table if not exists public.ecommerce_order_inventory_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  order_item_id uuid not null references public.ecommerce_order_items(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  published_product_id uuid not null references public.ecommerce_published_products(id),
  published_variant_id uuid references public.ecommerce_published_product_variants(id),
  source_product_id text not null,
  batch_id text references public.pos_product_batches(id),
  quantity numeric(12,3) not null check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'released', 'expired', 'consumed', 'failed')),
  stock_before numeric(12,3) not null check (stock_before >= 0),
  stock_after numeric(12,3) not null check (stock_after >= 0),
  committed_before numeric(12,3) not null check (committed_before >= 0),
  committed_after numeric(12,3) not null check (committed_after >= 0),
  idempotency_key text not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_order_inventory_reservations_scope_unique
    unique (order_item_id, batch_id)
);

create unique index if not exists ux_ecommerce_order_inventory_reservations_item_unbatched
  on public.ecommerce_order_inventory_reservations (order_item_id)
  where batch_id is null;
create index if not exists ix_ecommerce_order_inventory_reservations_order_status
  on public.ecommerce_order_inventory_reservations (order_id, status);
create index if not exists ix_ecommerce_order_inventory_reservations_source_status
  on public.ecommerce_order_inventory_reservations (license_id, source_product_id, status);
create index if not exists ix_ecommerce_order_inventory_reservations_expiry
  on public.ecommerce_order_inventory_reservations (expires_at)
  where status = 'reserved';

create table if not exists public.ecommerce_order_inventory_reservation_events (
  id uuid primary key default extensions.gen_random_uuid(),
  reservation_id uuid not null references public.ecommerce_order_inventory_reservations(id) on delete cascade,
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  transition text not null check (transition in ('reserved', 'released', 'expired', 'consumed', 'failed')),
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.ecommerce_order_inventory_reservations enable row level security;
alter table public.ecommerce_order_inventory_reservation_events enable row level security;
revoke all on public.ecommerce_order_inventory_reservations from public, anon, authenticated;
revoke all on public.ecommerce_order_inventory_reservation_events from public, anon, authenticated;
grant select, insert, update on public.ecommerce_order_inventory_reservations to service_role;
grant select, insert on public.ecommerce_order_inventory_reservation_events to service_role;

create policy ecommerce_order_inventory_reservations_no_direct_client_access
  on public.ecommerce_order_inventory_reservations for select to anon, authenticated using (false);
create policy ecommerce_order_inventory_reservation_events_no_direct_client_access
  on public.ecommerce_order_inventory_reservation_events for select to anon, authenticated using (false);

-- The source resolver is server-owned.  For a configured line, the selected
-- variant takes precedence over its parent publication.  All identifiers are
-- constrained to the same product, portal and license before being accepted.
create or replace function private.ecommerce_resolve_order_item_source_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_variant_id uuid;
begin
  new.source_product_id := null;

  if new.published_product_id is null
     or new.portal_id is null
     or new.license_id is null then
    return new;
  end if;

  begin
    v_variant_id := nullif(btrim(coalesce(new.options #>> '{variant,id}', '')), '')::uuid;
  exception when invalid_text_representation then
    v_variant_id := null;
  end;

  if v_variant_id is not null then
    select coalesce(v.source_product_id, v.local_product_ref)
      into new.source_product_id
      from public.ecommerce_published_product_variants v
     where v.id = v_variant_id
       and v.published_product_id = new.published_product_id
       and v.portal_id = new.portal_id
       and v.license_id = new.license_id
       and v.deleted_at is null;
  end if;

  if new.source_product_id is null then
    select coalesce(pp.product_id, pp.local_product_ref)
      into new.source_product_id
      from public.ecommerce_published_products pp
     where pp.id = new.published_product_id
       and pp.portal_id = new.portal_id
       and pp.license_id = new.license_id
       and pp.deleted_at is null;
  end if;

  return new;
end;
$function$;

create or replace function private.ecommerce_reservation_feature_enabled(p_license_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ecommerce_license_feature_bool($1, 'ecommerce_stock_reservation', false)
$function$;

create or replace function private.ecommerce_reservation_variant_id(p_options jsonb)
returns uuid
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_options) <> 'object' then return null; end if;
  return nullif(btrim(coalesce(p_options #>> '{variant,id}', '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$function$;

create or replace function private.ecommerce_record_reservation_event(
  p_reservation public.ecommerce_order_inventory_reservations,
  p_transition text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into public.ecommerce_order_inventory_reservation_events (
    reservation_id, order_id, portal_id, license_id, transition, idempotency_key, payload
  ) values (
    $1.id, $1.order_id, $1.portal_id, $1.license_id, $2, $3, coalesce($4, '{}'::jsonb)
  )
$function$;

-- Called only from an AFTER INSERT trigger on a server-created order item.
-- Locking the POS product first serializes all checkout attempts for that SKU;
-- batch allocation then remains deterministic and cannot over-commit stock.
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

  -- Free is deliberately a no-op: it retains its existing basic availability
  -- validation but can never reserve or consume inventory from this trigger.
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

  if v_product.track_stock is not true then
    return;
  end if;

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
             updated_at = now(),
             server_version = server_version + 1,
             last_idempotency_key = v_key || ':batch:' || v_batch.id
       where id = v_batch.id
         and license_id = v_order.license_id
       returning * into v_batch;

      insert into public.ecommerce_order_inventory_reservations (
        order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
        source_product_id, batch_id, quantity, status, stock_before, stock_after,
        committed_before, committed_after, idempotency_key, expires_at, metadata
      ) values (
        v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
        v_product.id, v_batch.id, v_allocate, 'reserved', v_batch.stock, v_batch.stock,
        v_batch.committed_stock - v_allocate, v_batch.committed_stock, v_key || ':batch:' || v_batch.id,
        v_expires_at, jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'batch')
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
       set committed_stock = v_product_committed,
           updated_at = now(),
           server_version = server_version + 1,
           last_idempotency_key = v_key
     where id = v_product.id
       and license_id = v_order.license_id;
  else
    if v_product.stock - v_product.committed_stock < v_remaining then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;

    update public.pos_products
       set committed_stock = committed_stock + v_remaining,
           updated_at = now(),
           server_version = server_version + 1,
           last_idempotency_key = v_key
     where id = v_product.id
       and license_id = v_order.license_id
       and stock - committed_stock >= v_remaining
     returning * into v_product;
    if v_product.id is null then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;

    insert into public.ecommerce_order_inventory_reservations (
      order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
      source_product_id, batch_id, quantity, status, stock_before, stock_after,
      committed_before, committed_after, idempotency_key, expires_at, metadata
    ) values (
      v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
      v_product.id, null, v_remaining, 'reserved', v_product.stock, v_product.stock,
      v_product.committed_stock - v_remaining, v_product.committed_stock, v_key, v_expires_at,
      jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'product')
    ) returning * into v_reservation;
    perform private.ecommerce_record_reservation_event(v_reservation, 'reserved', v_reservation.idempotency_key);
  end if;

  update public.ecommerce_orders
     set stock_reservation_status = 'reserved',
         stock_reservation_expires_at = greatest(coalesce(stock_reservation_expires_at, v_expires_at), v_expires_at),
         updated_at = now()
   where id = v_order.id
     and license_id = v_order.license_id;
end;
$function$;

create or replace function private.ecommerce_order_item_reservation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.ecommerce_reserve_order_item_stock(new.id);
  return new;
end;
$function$;

drop trigger if exists ecommerce_order_items_stock_reservation on public.ecommerce_order_items;
create trigger ecommerce_order_items_stock_reservation
after insert on public.ecommerce_order_items
for each row execute function private.ecommerce_order_item_reservation_trigger();

-- Release only committed stock.  `consumed` is used once the existing POS
-- sale has been authoritatively confirmed; this intentionally does not create
-- a second sale or a second inventory movement.
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

  select * into v_order
    from public.ecommerce_orders
   where id = p_order_id and license_id = p_license_id
   for update;
  if v_order.id is null then return; end if;

  for v_reservation in
    select * from public.ecommerce_order_inventory_reservations
     where order_id = p_order_id
       and license_id = p_license_id
       and status = 'reserved'
     order by source_product_id, coalesce(batch_id, ''), id
     for update
  loop
    v_key := p_idempotency_key || ':' || v_reservation.id::text;
    select * into v_product
      from public.pos_products
     where id = v_reservation.source_product_id
       and license_id = p_license_id
     for update;
    if v_product.id is null then
      raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
    end if;

    if v_reservation.batch_id is not null then
      select * into v_batch
        from public.pos_product_batches
       where id = v_reservation.batch_id
         and product_id = v_product.id
         and license_id = p_license_id
       for update;
      if v_batch.id is null then
        raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
      end if;
      update public.pos_product_batches
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             last_idempotency_key = v_key
       where id = v_batch.id and license_id = p_license_id;
      select coalesce(sum(committed_stock), 0) into v_product_committed
        from public.pos_product_batches
       where product_id = v_product.id and license_id = p_license_id and deleted_at is null;
      update public.pos_products
         set committed_stock = v_product_committed,
             updated_at = now(), server_version = server_version + 1,
             last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    else
      update public.pos_products
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1,
             last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    end if;

    update public.ecommerce_order_inventory_reservations
       set status = p_transition,
           released_at = case when p_transition in ('released', 'expired') then now() else released_at end,
           consumed_at = case when p_transition = 'consumed' then now() else consumed_at end,
           updated_at = now(),
           metadata = metadata || jsonb_build_object('finalizationKey', v_key)
     where id = v_reservation.id;
    select * into v_reservation from public.ecommerce_order_inventory_reservations where id = v_reservation.id;
    perform private.ecommerce_record_reservation_event(v_reservation, p_transition, v_key);
  end loop;

  update public.ecommerce_orders
     set stock_reservation_status = p_transition,
         stock_reservation_expires_at = null,
         updated_at = now()
   where id = p_order_id and license_id = p_license_id
     and stock_reservation_status = 'reserved';
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
    perform private.ecommerce_finalize_order_stock_reservations(
      new.id, new.license_id, 'released', 'ecommerce:cancel:' || new.id::text
    );
  elsif new.status = 'converted_to_sale'
     and new.pos_conversion_status = 'completed'
     and new.converted_sale_id is not null then
    perform private.ecommerce_finalize_order_stock_reservations(
      new.id, new.license_id, 'consumed', 'ecommerce:consume:' || new.converted_sale_id
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists ecommerce_orders_stock_reservation_lifecycle on public.ecommerce_orders;
create trigger ecommerce_orders_stock_reservation_lifecycle
after update of status, fulfillment_status, pos_conversion_status on public.ecommerce_orders
for each row execute function private.ecommerce_order_reservation_lifecycle_trigger();

create or replace function private.ecommerce_expire_abandoned_stock_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select * from public.ecommerce_orders
     where stock_reservation_status = 'reserved'
       and stock_reservation_expires_at <= now()
       and status not in ('rejected', 'cancelled', 'converted_to_sale', 'completed')
     order by stock_reservation_expires_at, id
     for update skip locked
  loop
    perform private.ecommerce_finalize_order_stock_reservations(
      v_order.id, v_order.license_id, 'expired', 'ecommerce:expire:' || v_order.id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- pg_cron is optional.  When installed, this creates a five-minute cleanup
-- job; when absent, the private function remains available to a trusted
-- scheduler.  Existing orders are untouched because none can have rows in
-- this new reservation table before this migration.
do $cron$
declare
  v_has_job boolean;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $$select exists (select 1 from cron.job where jobname = 'ecommerce-stock-reservation-expiry-v1')$$ into v_has_job;
    if v_has_job is not true then
      execute $$select cron.schedule('ecommerce-stock-reservation-expiry-v1', '*/5 * * * *', 'select private.ecommerce_expire_abandoned_stock_reservations()')$$;
    end if;
  end if;
end;
$cron$;

-- Product cards show a coarse low-stock state without revealing a quantity in
-- status mode.  Exact mode continues to expose a floored quantity only to Pro.
create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
) returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_product.id, 'name', p_product.public_name,
    'description', p_product.public_description, 'categoryName', p_product.category_name,
    'price', p_product.price, 'currency', p_product.currency, 'imageUrl', p_product.image_url,
    'isAvailable', private.ecommerce_product_publicly_available(p_product),
    'displayOrder', p_product.display_order,
    'configuration', jsonb_build_object(
      'type', p_product.configuration_type, 'version', p_product.configuration_version,
      'hasVariants', p_product.has_variants, 'hasOptionGroups', p_product.has_option_groups,
      'requiresConfiguration', p_product.requires_configuration
    ),
    'wholesaleEnabled', p_product.wholesale_enabled,
    'wholesaleRevision', p_product.wholesale_revision,
    'wholesaleTiers', case when p_product.wholesale_enabled then coalesce((
      select jsonb_agg(jsonb_build_object('sourceTierRef', t.source_tier_ref, 'minQuantity', t.min_quantity, 'unitPrice', t.unit_price) order by t.min_quantity)
      from public.ecommerce_published_wholesale_tiers t
      where t.published_product_id = p_product.id and t.portal_id = p_product.portal_id
        and t.license_id = p_product.license_id and t.deleted_at is null
        and t.manual_available and t.source_available and t.is_available
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status', 'status', case
          when not private.ecommerce_product_publicly_available(p_product) or coalesce(p_product.stock_snapshot, 0) <= 0 then 'out_of_stock'
          when p_product.stock_snapshot <= 3 then 'low_stock' else 'available' end, 'quantity', null)
      when p_product.stock_mode in ('exact', 'reserve_on_confirm') then jsonb_build_object(
        'mode', 'exact', 'status', case
          when not private.ecommerce_product_publicly_available(p_product) or coalesce(p_product.stock_snapshot, 0) <= 0 then 'out_of_stock'
          when p_product.stock_snapshot <= 3 then 'low_stock' else 'available' end,
        'quantity', greatest(floor(coalesce(p_product.stock_snapshot, 0)), 0))
      else jsonb_build_object('mode', 'hidden', 'status', case when private.ecommerce_product_publicly_available(p_product) then 'available' else 'out_of_stock' end, 'quantity', null)
    end,
    'options', p_product.options
  )
$function$;

alter function private.ecommerce_resolve_order_item_source_product_v1() owner to postgres;
alter function private.ecommerce_reservation_feature_enabled(uuid) owner to postgres;
alter function private.ecommerce_reservation_variant_id(jsonb) owner to postgres;
alter function private.ecommerce_record_reservation_event(public.ecommerce_order_inventory_reservations, text, text, jsonb) owner to postgres;
alter function private.ecommerce_reserve_order_item_stock(uuid) owner to postgres;
alter function private.ecommerce_order_item_reservation_trigger() owner to postgres;
alter function private.ecommerce_finalize_order_stock_reservations(uuid, uuid, text, text) owner to postgres;
alter function private.ecommerce_order_reservation_lifecycle_trigger() owner to postgres;
alter function private.ecommerce_expire_abandoned_stock_reservations() owner to postgres;

revoke all on function private.ecommerce_resolve_order_item_source_product_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_reservation_feature_enabled(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_reservation_variant_id(jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_record_reservation_event(public.ecommerce_order_inventory_reservations, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_reserve_order_item_stock(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_order_item_reservation_trigger() from public, anon, authenticated;
revoke all on function private.ecommerce_finalize_order_stock_reservations(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_order_reservation_lifecycle_trigger() from public, anon, authenticated;
revoke all on function private.ecommerce_expire_abandoned_stock_reservations() from public, anon, authenticated;

comment on table public.ecommerce_order_inventory_reservations is
  'Phase 3 ecommerce committed-stock reservations. POS stock remains authoritative; direct client access is denied.';
comment on function private.ecommerce_expire_abandoned_stock_reservations() is
  'Expires only Phase 3 reservation rows. pg_cron invokes it every five minutes when available.';
