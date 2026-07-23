-- ECOM.DB.1 - Base segura del portal publico / ecommerce.
-- Solo prepara contrato de datos. No crea UI, RPCs publicas, pagos,
-- reservas reales, ni efectos en caja, inventario o reportes de venta.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Features por plan y snapshots de licencias actuales
-- ---------------------------------------------------------------------------

create or replace function private.ecommerce_plan_feature_patch(p_plan_code text)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select case p_plan_code
    when 'free_trial' then jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_whatsapp_checkout', true,
      'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', 10,
      'ecommerce_custom_slug', false,
      'ecommerce_branding_customization', 'basic',
      'ecommerce_layout_customization', 'template_only',
      'ecommerce_business_hours', true,
      'ecommerce_delivery_pickup_settings', 'basic',
      'ecommerce_stock_visibility', false,
      'ecommerce_stock_reservation', false,
      'ecommerce_realtime_orders', false,
      'ecommerce_cloud_catalog_source', false,
      'ecommerce_whatsapp_autosend', false
    )
    when 'pro_monthly' then jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_whatsapp_checkout', true,
      'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', -1,
      'ecommerce_custom_slug', true,
      'ecommerce_branding_customization', 'advanced',
      'ecommerce_layout_customization', 'advanced',
      'ecommerce_business_hours', true,
      'ecommerce_delivery_pickup_settings', 'advanced',
      'ecommerce_stock_visibility', true,
      'ecommerce_stock_reservation', true,
      'ecommerce_realtime_orders', true,
      'ecommerce_cloud_catalog_source', true,
      'ecommerce_whatsapp_autosend', false
    )
    else '{}'::jsonb
  end;
$$;

update public.plans p
set features = coalesce(p.features, '{}'::jsonb)
  || private.ecommerce_plan_feature_patch(p.code)
where p.code in ('free_trial', 'pro_monthly');

update public.licenses l
set features = coalesce(l.features, '{}'::jsonb)
  || private.ecommerce_plan_feature_patch(p.code)
from public.plans p
where p.id = l.plan_id
  and p.code in ('free_trial', 'pro_monthly');

create or replace function private.ecommerce_license_feature_text(
  p_license_id uuid,
  p_feature_key text
)
returns text
language sql
security definer
set search_path to ''
as $$
  select (coalesce(p.features, '{}'::jsonb)
    || coalesce(l.features, '{}'::jsonb)) ->> p_feature_key
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  limit 1;
$$;

create or replace function private.ecommerce_license_feature_bool(
  p_license_id uuid,
  p_feature_key text,
  p_default boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_value text;
begin
  v_value := private.ecommerce_license_feature_text(p_license_id, p_feature_key);

  if v_value is null then
    return p_default;
  end if;

  return v_value::boolean;
exception
  when others then
    return p_default;
end;
$$;

create or replace function private.ecommerce_license_feature_int(
  p_license_id uuid,
  p_feature_key text,
  p_default integer default 0
)
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_value text;
begin
  v_value := private.ecommerce_license_feature_text(p_license_id, p_feature_key);

  if v_value is null then
    return p_default;
  end if;

  return v_value::integer;
exception
  when others then
    return p_default;
end;
$$;

create or replace function private.ecommerce_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal publico
-- ---------------------------------------------------------------------------

create table if not exists public.ecommerce_portals (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  slug text not null,
  slug_source text not null default 'system',
  status text not null default 'draft',
  name text not null,
  headline text,
  description text,
  template_code text not null default 'classic',
  customization_level text not null default 'basic',
  theme jsonb not null default '{}'::jsonb,
  logo_url text,
  cover_image_url text,
  whatsapp_phone text,
  address text,
  business_type text[],
  ordering_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  scheduled_orders_enabled boolean not null default false,
  min_order_total numeric(12,2) not null default 0,
  max_order_items integer not null default 30,
  max_item_quantity numeric(12,3) not null default 99,
  stock_mode text not null default 'hidden',
  settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_portals_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  constraint ecommerce_portals_slug_source_valid check (slug_source in ('system', 'custom')),
  constraint ecommerce_portals_status_valid check (status in ('draft', 'published', 'paused', 'disabled')),
  constraint ecommerce_portals_customization_level_valid check (customization_level in ('basic', 'advanced')),
  constraint ecommerce_portals_stock_mode_valid check (stock_mode in ('hidden', 'status', 'exact', 'reserve_on_confirm')),
  constraint ecommerce_portals_name_not_blank check (length(btrim(name)) > 0),
  constraint ecommerce_portals_order_limits_valid check (max_order_items > 0 and max_item_quantity > 0 and min_order_total >= 0)
);

alter table public.ecommerce_portals enable row level security;
revoke all on table public.ecommerce_portals from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_portals to service_role;

create unique index if not exists ux_ecommerce_portals_license_active
  on public.ecommerce_portals (license_id)
  where deleted_at is null;

create unique index if not exists ux_ecommerce_portals_slug_active
  on public.ecommerce_portals (slug)
  where deleted_at is null;

create index if not exists ix_ecommerce_portals_license_status
  on public.ecommerce_portals (license_id, status)
  where deleted_at is null;

drop trigger if exists trg_ecommerce_portals_touch_updated_at on public.ecommerce_portals;
create trigger trg_ecommerce_portals_touch_updated_at
before update on public.ecommerce_portals
for each row
execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------------

create table if not exists public.ecommerce_portal_hours (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  weekday smallint not null,
  is_open boolean not null default true,
  opens_at time,
  closes_at time,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_portal_hours_weekday_valid check (weekday between 0 and 6),
  constraint ecommerce_portal_hours_range_valid check (
    is_open is false or (opens_at is not null and closes_at is not null and opens_at <> closes_at)
  )
);

alter table public.ecommerce_portal_hours enable row level security;
revoke all on table public.ecommerce_portal_hours from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_portal_hours to service_role;

create unique index if not exists ux_ecommerce_portal_hours_portal_weekday
  on public.ecommerce_portal_hours (portal_id, weekday);

drop trigger if exists trg_ecommerce_portal_hours_touch_updated_at on public.ecommerce_portal_hours;
create trigger trg_ecommerce_portal_hours_touch_updated_at
before update on public.ecommerce_portal_hours
for each row
execute function private.ecommerce_touch_updated_at();

create table if not exists public.ecommerce_portal_hour_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  exception_date date not null,
  is_open boolean not null default false,
  opens_at time,
  closes_at time,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_portal_hour_exceptions_range_valid check (
    is_open is false or (opens_at is not null and closes_at is not null and opens_at <> closes_at)
  )
);

alter table public.ecommerce_portal_hour_exceptions enable row level security;
revoke all on table public.ecommerce_portal_hour_exceptions from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_portal_hour_exceptions to service_role;

create unique index if not exists ux_ecommerce_portal_hour_exceptions_portal_date
  on public.ecommerce_portal_hour_exceptions (portal_id, exception_date);

drop trigger if exists trg_ecommerce_portal_hour_exceptions_touch_updated_at on public.ecommerce_portal_hour_exceptions;
create trigger trg_ecommerce_portal_hour_exceptions_touch_updated_at
before update on public.ecommerce_portal_hour_exceptions
for each row
execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Productos publicados
-- ---------------------------------------------------------------------------

create table if not exists public.ecommerce_published_products (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  source_type text not null default 'local_snapshot',
  product_id text,
  local_product_ref text,
  public_name text not null,
  public_description text,
  category_id text,
  category_name text,
  price numeric(12,2) not null,
  currency text not null default 'MXN',
  image_url text,
  image_ref text,
  is_published boolean not null default true,
  is_available boolean not null default true,
  display_order integer not null default 0,
  track_stock boolean not null default false,
  stock_mode text not null default 'hidden',
  stock_snapshot numeric(12,3),
  stock_updated_at timestamptz,
  options jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ecommerce_published_products_source_type_valid check (source_type in ('local_snapshot', 'cloud_product')),
  constraint ecommerce_published_products_stock_mode_valid check (stock_mode in ('hidden', 'status', 'exact', 'reserve_on_confirm')),
  constraint ecommerce_published_products_name_not_blank check (length(btrim(public_name)) > 0),
  constraint ecommerce_published_products_price_valid check (price >= 0),
  constraint ecommerce_published_products_cloud_product_ref check (source_type <> 'cloud_product' or nullif(product_id, '') is not null)
);

alter table public.ecommerce_published_products enable row level security;
revoke all on table public.ecommerce_published_products from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_published_products to service_role;

create index if not exists ix_ecommerce_published_products_portal_display
  on public.ecommerce_published_products (portal_id, display_order, public_name)
  where deleted_at is null and is_published is true;

create index if not exists ix_ecommerce_published_products_license_updated
  on public.ecommerce_published_products (license_id, updated_at desc)
  where deleted_at is null;

create unique index if not exists ux_ecommerce_published_products_portal_cloud_product
  on public.ecommerce_published_products (portal_id, product_id)
  where deleted_at is null and source_type = 'cloud_product';

create or replace function private.ecommerce_published_product_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license_id uuid;
  v_limit integer;
  v_current_count integer;
  v_stock_allowed boolean;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND';
  end if;

  new.license_id := v_license_id;

  if new.is_published is true and new.deleted_at is null then
    v_limit := private.ecommerce_license_feature_int(new.license_id, 'ecommerce_max_published_products', 0);

    if v_limit >= 0 then
      select count(*)
      into v_current_count
      from public.ecommerce_published_products pp
      where pp.portal_id = new.portal_id
        and pp.deleted_at is null
        and pp.is_published is true
        and (tg_op = 'INSERT' or pp.id <> new.id);

      if v_current_count >= v_limit then
        raise exception 'ECOMMERCE_PRODUCT_LIMIT_REACHED';
      end if;
    end if;
  end if;

  if new.stock_mode in ('status', 'exact', 'reserve_on_confirm') then
    v_stock_allowed := private.ecommerce_license_feature_bool(new.license_id, 'ecommerce_stock_visibility', false);
    if v_stock_allowed is not true then
      raise exception 'ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ecommerce_published_products_guard on public.ecommerce_published_products;
create trigger trg_ecommerce_published_products_guard
before insert or update on public.ecommerce_published_products
for each row
execute function private.ecommerce_published_product_guard();

drop trigger if exists trg_ecommerce_published_products_touch_updated_at on public.ecommerce_published_products;
create trigger trg_ecommerce_published_products_touch_updated_at
before update on public.ecommerce_published_products
for each row
execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Pedidos online
-- ---------------------------------------------------------------------------

create table if not exists public.ecommerce_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_number bigint generated always as identity,
  public_order_code text generated always as ('EC-' || lpad(order_number::text, 8, '0')) stored,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  status text not null default 'new',
  channel text not null default 'public_store',
  fulfillment_method text not null default 'pickup',
  customer_name text not null,
  customer_phone text not null,
  customer_address text,
  customer_notes text,
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'MXN',
  payment_method text not null default 'on_delivery',
  payment_status text not null default 'pending',
  whatsapp_phone text,
  whatsapp_message text,
  whatsapp_status text not null default 'pending_client_send',
  system_notification_status text not null default 'pending',
  pos_visibility_status text not null default 'pending',
  stock_reservation_status text not null default 'not_applicable',
  idempotency_key text,
  client_user_agent text,
  client_ip_hash text,
  seen_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  converted_sale_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_orders_status_valid check (status in ('new', 'seen', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled', 'converted_to_sale')),
  constraint ecommerce_orders_channel_valid check (channel in ('public_store', 'whatsapp_checkout', 'manual')),
  constraint ecommerce_orders_fulfillment_method_valid check (fulfillment_method in ('pickup', 'delivery')),
  constraint ecommerce_orders_payment_status_valid check (payment_status in ('pending', 'paid', 'failed', 'refunded', 'not_required')),
  constraint ecommerce_orders_whatsapp_status_valid check (whatsapp_status in ('pending_client_send', 'opened', 'sent_by_api', 'failed', 'not_available')),
  constraint ecommerce_orders_system_notification_status_valid check (system_notification_status in ('pending', 'notified', 'read', 'failed')),
  constraint ecommerce_orders_pos_visibility_status_valid check (pos_visibility_status in ('pending', 'visible', 'hidden', 'archived')),
  constraint ecommerce_orders_stock_reservation_status_valid check (stock_reservation_status in ('not_applicable', 'pending', 'reserved', 'released', 'failed')),
  constraint ecommerce_orders_customer_name_not_blank check (length(btrim(customer_name)) > 0),
  constraint ecommerce_orders_customer_phone_not_blank check (length(btrim(customer_phone)) > 0),
  constraint ecommerce_orders_totals_valid check (subtotal >= 0 and delivery_fee >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0)
);

alter table public.ecommerce_orders enable row level security;
revoke all on table public.ecommerce_orders from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_orders to service_role;

create unique index if not exists ux_ecommerce_orders_public_order_code
  on public.ecommerce_orders (public_order_code);

create unique index if not exists ux_ecommerce_orders_portal_idempotency_key
  on public.ecommerce_orders (portal_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists ix_ecommerce_orders_license_status_created
  on public.ecommerce_orders (license_id, status, created_at desc);

create index if not exists ix_ecommerce_orders_portal_created
  on public.ecommerce_orders (portal_id, created_at desc);

create or replace function private.ecommerce_order_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license_id uuid;
  v_stock_reservation_allowed boolean;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND';
  end if;

  new.license_id := v_license_id;

  if new.stock_reservation_status <> 'not_applicable' then
    v_stock_reservation_allowed := private.ecommerce_license_feature_bool(new.license_id, 'ecommerce_stock_reservation', false);
    if v_stock_reservation_allowed is not true then
      raise exception 'ECOMMERCE_STOCK_RESERVATION_REQUIRES_PRO';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ecommerce_orders_guard on public.ecommerce_orders;
create trigger trg_ecommerce_orders_guard
before insert or update on public.ecommerce_orders
for each row
execute function private.ecommerce_order_guard();

drop trigger if exists trg_ecommerce_orders_touch_updated_at on public.ecommerce_orders;
create trigger trg_ecommerce_orders_touch_updated_at
before update on public.ecommerce_orders
for each row
execute function private.ecommerce_touch_updated_at();

create table if not exists public.ecommerce_order_items (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  published_product_id uuid references public.ecommerce_published_products(id) on delete set null,
  source_product_id text,
  product_name text not null,
  unit_price numeric(12,2) not null,
  quantity numeric(12,3) not null,
  line_total numeric(12,2) not null default 0,
  options jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ecommerce_order_items_product_name_not_blank check (length(btrim(product_name)) > 0),
  constraint ecommerce_order_items_amounts_valid check (unit_price >= 0 and quantity > 0 and line_total >= 0)
);

alter table public.ecommerce_order_items enable row level security;
revoke all on table public.ecommerce_order_items from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_order_items to service_role;

create index if not exists ix_ecommerce_order_items_order
  on public.ecommerce_order_items (order_id);

create index if not exists ix_ecommerce_order_items_license_created
  on public.ecommerce_order_items (license_id, created_at desc);

create or replace function private.ecommerce_order_item_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order record;
begin
  select o.license_id, o.portal_id
  into v_order
  from public.ecommerce_orders o
  where o.id = new.order_id;

  if v_order.license_id is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND';
  end if;

  new.license_id := v_order.license_id;
  new.portal_id := v_order.portal_id;
  new.line_total := round((new.unit_price * new.quantity)::numeric, 2);

  return new;
end;
$$;

drop trigger if exists trg_ecommerce_order_items_guard on public.ecommerce_order_items;
create trigger trg_ecommerce_order_items_guard
before insert or update on public.ecommerce_order_items
for each row
execute function private.ecommerce_order_item_guard();

create table if not exists public.ecommerce_order_events (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_ref text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ecommerce_order_events_event_type_not_blank check (length(btrim(event_type)) > 0),
  constraint ecommerce_order_events_actor_type_valid check (actor_type in ('system', 'public_customer', 'admin', 'staff', 'automation'))
);

alter table public.ecommerce_order_events enable row level security;
revoke all on table public.ecommerce_order_events from anon, authenticated, public;

grant select, insert, update, delete on table public.ecommerce_order_events to service_role;

create index if not exists ix_ecommerce_order_events_order_created
  on public.ecommerce_order_events (order_id, created_at desc);

create index if not exists ix_ecommerce_order_events_license_created
  on public.ecommerce_order_events (license_id, created_at desc);

create or replace function private.ecommerce_order_event_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order record;
begin
  select o.license_id, o.portal_id
  into v_order
  from public.ecommerce_orders o
  where o.id = new.order_id;

  if v_order.license_id is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND';
  end if;

  new.license_id := v_order.license_id;
  new.portal_id := v_order.portal_id;

  return new;
end;
$$;

drop trigger if exists trg_ecommerce_order_events_guard on public.ecommerce_order_events;
create trigger trg_ecommerce_order_events_guard
before insert or update on public.ecommerce_order_events
for each row
execute function private.ecommerce_order_event_guard();

-- ---------------------------------------------------------------------------
-- Politicas defensivas cerradas
-- ---------------------------------------------------------------------------

drop policy if exists ecommerce_portals_no_direct_client_select on public.ecommerce_portals;
create policy ecommerce_portals_no_direct_client_select
  on public.ecommerce_portals for select to anon, authenticated using (false);

drop policy if exists ecommerce_portals_no_direct_client_insert on public.ecommerce_portals;
create policy ecommerce_portals_no_direct_client_insert
  on public.ecommerce_portals for insert to anon, authenticated with check (false);

drop policy if exists ecommerce_portals_no_direct_client_update on public.ecommerce_portals;
create policy ecommerce_portals_no_direct_client_update
  on public.ecommerce_portals for update to anon, authenticated using (false) with check (false);

drop policy if exists ecommerce_published_products_no_direct_client_select on public.ecommerce_published_products;
create policy ecommerce_published_products_no_direct_client_select
  on public.ecommerce_published_products for select to anon, authenticated using (false);

drop policy if exists ecommerce_published_products_no_direct_client_insert on public.ecommerce_published_products;
create policy ecommerce_published_products_no_direct_client_insert
  on public.ecommerce_published_products for insert to anon, authenticated with check (false);

drop policy if exists ecommerce_published_products_no_direct_client_update on public.ecommerce_published_products;
create policy ecommerce_published_products_no_direct_client_update
  on public.ecommerce_published_products for update to anon, authenticated using (false) with check (false);

drop policy if exists ecommerce_orders_no_direct_client_select on public.ecommerce_orders;
create policy ecommerce_orders_no_direct_client_select
  on public.ecommerce_orders for select to anon, authenticated using (false);

drop policy if exists ecommerce_orders_no_direct_client_insert on public.ecommerce_orders;
create policy ecommerce_orders_no_direct_client_insert
  on public.ecommerce_orders for insert to anon, authenticated with check (false);

drop policy if exists ecommerce_orders_no_direct_client_update on public.ecommerce_orders;
create policy ecommerce_orders_no_direct_client_update
  on public.ecommerce_orders for update to anon, authenticated using (false) with check (false);

drop policy if exists ecommerce_order_items_no_direct_client_select on public.ecommerce_order_items;
create policy ecommerce_order_items_no_direct_client_select
  on public.ecommerce_order_items for select to anon, authenticated using (false);

drop policy if exists ecommerce_order_items_no_direct_client_insert on public.ecommerce_order_items;
create policy ecommerce_order_items_no_direct_client_insert
  on public.ecommerce_order_items for insert to anon, authenticated with check (false);

drop policy if exists ecommerce_order_events_no_direct_client_select on public.ecommerce_order_events;
create policy ecommerce_order_events_no_direct_client_select
  on public.ecommerce_order_events for select to anon, authenticated using (false);

drop policy if exists ecommerce_order_events_no_direct_client_insert on public.ecommerce_order_events;
create policy ecommerce_order_events_no_direct_client_insert
  on public.ecommerce_order_events for insert to anon, authenticated with check (false);

-- Helpers privados cerrados a roles cliente.
revoke all on function private.ecommerce_plan_feature_patch(text) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_text(uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_bool(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_int(uuid, text, integer) from public, anon, authenticated;
revoke all on function private.ecommerce_touch_updated_at() from public, anon, authenticated;
revoke all on function private.ecommerce_published_product_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_item_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_event_guard() from public, anon, authenticated;

grant execute on function private.ecommerce_plan_feature_patch(text) to service_role;
grant execute on function private.ecommerce_license_feature_text(uuid, text) to service_role;
grant execute on function private.ecommerce_license_feature_bool(uuid, text, boolean) to service_role;
grant execute on function private.ecommerce_license_feature_int(uuid, text, integer) to service_role;
;
