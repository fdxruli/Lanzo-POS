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
    when 'free_trial' then pg_catalog.jsonb_build_object(
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
    when 'pro_monthly' then pg_catalog.jsonb_build_object(
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
set features = pg_catalog.coalesce(p.features, '{}'::jsonb)
  || private.ecommerce_plan_feature_patch(p.code)
where p.code in ('free_trial', 'pro_monthly');

update public.licenses l
set features = pg_catalog.coalesce(l.features, '{}'::jsonb)
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
  select (pg_catalog.coalesce(p.features, '{}'::jsonb)
    || pg_catalog.coalesce(l.features, '{}'::jsonb)) ->> p_feature_key
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

  if pg_catalog.lower(v_value) in ('true', 't', '1', 'yes', 'on') then
    return true;
  end if;

  if pg_catalog.lower(v_value) in ('false', 'f', '0', 'no', 'off') then
    return false;
  end if;

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
security definer
set search_path to ''
as $$
declare
  v_value text;
begin
  v_value := private.ecommerce_license_feature_text(p_license_id, p_feature_key);

  if v_value is null or v_value !~ '^-?[0-9]+$' then
    return p_default;
  end if;

  return v_value::integer;
end;
$$;

create or replace function private.ecommerce_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal publico
-- ---------------------------------------------------------------------------

create table public.ecommerce_portals (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  slug text not null,
  slug_source text not null default 'system',
  status text not null default 'draft',
  name text not null,
  headline text null,
  description text null,
  template_code text not null default 'classic',
  customization_level text not null default 'basic',
  theme jsonb not null default '{}'::jsonb,
  logo_url text null,
  cover_image_url text null,
  whatsapp_phone text null,
  address text null,
  business_type text[] null,
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
  deleted_at timestamptz null,
  constraint ecommerce_portals_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint ecommerce_portals_status_check
    check (status in ('draft', 'published', 'paused', 'disabled')),
  constraint ecommerce_portals_slug_source_check
    check (slug_source in ('system', 'custom')),
  constraint ecommerce_portals_customization_level_check
    check (customization_level in ('basic', 'advanced')),
  constraint ecommerce_portals_stock_mode_check
    check (stock_mode in ('hidden', 'status', 'exact', 'reserve_on_confirm')),
  constraint ecommerce_portals_name_not_empty
    check (length(btrim(name)) > 0),
  constraint ecommerce_portals_order_limits_positive
    check (min_order_total >= 0 and max_order_items > 0 and max_item_quantity > 0)
);

create unique index ux_ecommerce_portals_license_active
  on public.ecommerce_portals (license_id)
  where deleted_at is null;

create unique index ux_ecommerce_portals_slug_active
  on public.ecommerce_portals (slug)
  where deleted_at is null;

create index idx_ecommerce_portals_license_status
  on public.ecommerce_portals (license_id, status);

create or replace function private.ecommerce_portal_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.stock_mode in ('status', 'exact', 'reserve_on_confirm')
    and private.ecommerce_license_feature_bool(new.license_id, 'ecommerce_stock_visibility', false) is not true then
    raise exception 'ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_ecommerce_portals_guard
  before insert or update on public.ecommerce_portals
  for each row execute function private.ecommerce_portal_guard();

create trigger trg_ecommerce_portals_touch_updated_at
  before update on public.ecommerce_portals
  for each row execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------------

create table public.ecommerce_portal_hours (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  weekday smallint not null,
  is_open boolean not null default true,
  opens_at time null,
  closes_at time null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_portal_hours_weekday_check
    check (weekday between 0 and 6),
  constraint ecommerce_portal_hours_open_requires_times
    check (is_open = false or (opens_at is not null and closes_at is not null))
);

create unique index ux_ecommerce_portal_hours_portal_weekday
  on public.ecommerce_portal_hours (portal_id, weekday);

create trigger trg_ecommerce_portal_hours_touch_updated_at
  before update on public.ecommerce_portal_hours
  for each row execute function private.ecommerce_touch_updated_at();

create table public.ecommerce_portal_hour_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  exception_date date not null,
  is_open boolean not null default false,
  opens_at time null,
  closes_at time null,
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_portal_hour_exceptions_open_requires_times
    check (is_open = false or (opens_at is not null and closes_at is not null))
);

create unique index ux_ecommerce_portal_hour_exceptions_portal_date
  on public.ecommerce_portal_hour_exceptions (portal_id, exception_date);

create trigger trg_ecommerce_portal_hour_exceptions_touch_updated_at
  before update on public.ecommerce_portal_hour_exceptions
  for each row execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Productos publicados
-- ---------------------------------------------------------------------------

create table public.ecommerce_published_products (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  source_type text not null default 'local_snapshot',
  product_id text null,
  local_product_ref text null,
  public_name text not null,
  public_description text null,
  category_id text null,
  category_name text null,
  price numeric(12,2) not null,
  currency text not null default 'MXN',
  image_url text null,
  image_ref text null,
  is_published boolean not null default true,
  is_available boolean not null default true,
  display_order integer not null default 0,
  track_stock boolean not null default false,
  stock_mode text not null default 'hidden',
  stock_snapshot numeric(12,3) null,
  stock_updated_at timestamptz null,
  options jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint ecommerce_published_products_source_type_check
    check (source_type in ('local_snapshot', 'cloud_product')),
  constraint ecommerce_published_products_stock_mode_check
    check (stock_mode in ('hidden', 'status', 'exact', 'reserve_on_confirm')),
  constraint ecommerce_published_products_public_name_not_empty
    check (length(btrim(public_name)) > 0),
  constraint ecommerce_published_products_price_nonnegative
    check (price >= 0),
  constraint ecommerce_published_products_cloud_product_requires_id
    check (source_type <> 'cloud_product' or product_id is not null)
);

create index idx_ecommerce_published_products_listing
  on public.ecommerce_published_products (portal_id, display_order, public_name)
  where deleted_at is null and is_published = true;

create index idx_ecommerce_published_products_license_updated
  on public.ecommerce_published_products (license_id, updated_at desc);

create unique index ux_ecommerce_published_products_cloud_product
  on public.ecommerce_published_products (portal_id, product_id)
  where source_type = 'cloud_product' and deleted_at is null;

create or replace function private.ecommerce_published_product_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license_id uuid;
  v_limit integer;
  v_published_count integer;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null
  limit 1;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND'
      using errcode = 'foreign_key_violation';
  end if;

  new.license_id := v_license_id;

  if new.is_published = true then
    v_limit := private.ecommerce_license_feature_int(
      v_license_id,
      'ecommerce_max_published_products',
      0
    );

    if v_limit >= 0 then
      select count(*)::integer
      into v_published_count
      from public.ecommerce_published_products pp
      where pp.license_id = v_license_id
        and pp.is_published = true
        and pp.deleted_at is null
        and pp.id is distinct from new.id;

      if v_published_count >= v_limit then
        raise exception 'ECOMMERCE_PRODUCT_LIMIT_REACHED'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if (new.stock_mode in ('status', 'exact', 'reserve_on_confirm') or new.track_stock = true)
    and private.ecommerce_license_feature_bool(v_license_id, 'ecommerce_stock_visibility', false) is not true then
    raise exception 'ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_ecommerce_published_products_guard
  before insert or update on public.ecommerce_published_products
  for each row execute function private.ecommerce_published_product_guard();

create trigger trg_ecommerce_published_products_touch_updated_at
  before update on public.ecommerce_published_products
  for each row execute function private.ecommerce_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Pedidos online como solicitud pendiente
-- ---------------------------------------------------------------------------

create table public.ecommerce_orders (
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
  customer_address text null,
  customer_notes text null,
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'MXN',
  payment_method text not null default 'on_delivery',
  payment_status text not null default 'pending',
  whatsapp_phone text null,
  whatsapp_message text null,
  whatsapp_status text not null default 'pending_client_send',
  system_notification_status text not null default 'pending',
  pos_visibility_status text not null default 'pending',
  stock_reservation_status text not null default 'not_applicable',
  idempotency_key text null,
  client_user_agent text null,
  client_ip_hash text null,
  seen_at timestamptz null,
  accepted_at timestamptz null,
  rejected_at timestamptz null,
  cancelled_at timestamptz null,
  converted_sale_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecommerce_orders_status_check
    check (status in (
      'new', 'seen', 'accepted', 'preparing', 'ready', 'completed',
      'rejected', 'cancelled', 'converted_to_sale'
    )),
  constraint ecommerce_orders_customer_name_not_empty
    check (length(btrim(customer_name)) > 0),
  constraint ecommerce_orders_customer_phone_not_empty
    check (length(btrim(customer_phone)) > 0),
  constraint ecommerce_orders_amounts_nonnegative
    check (
      subtotal >= 0 and delivery_fee >= 0 and discount_total >= 0
      and tax_total >= 0 and total >= 0
    )
);

create unique index ux_ecommerce_orders_public_order_code
  on public.ecommerce_orders (public_order_code);

create unique index ux_ecommerce_orders_portal_idempotency_key
  on public.ecommerce_orders (portal_id, idempotency_key)
  where idempotency_key is not null;

create index idx_ecommerce_orders_license_status_created
  on public.ecommerce_orders (license_id, status, created_at desc);

create index idx_ecommerce_orders_portal_created
  on public.ecommerce_orders (portal_id, created_at desc);

create or replace function private.ecommerce_order_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license_id uuid;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null
  limit 1;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND'
      using errcode = 'foreign_key_violation';
  end if;

  new.license_id := v_license_id;

  if new.stock_reservation_status <> 'not_applicable'
    and private.ecommerce_license_feature_bool(v_license_id, 'ecommerce_stock_reservation', false) is not true then
    raise exception 'ECOMMERCE_STOCK_RESERVATION_REQUIRES_PRO'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_ecommerce_orders_guard
  before insert or update on public.ecommerce_orders
  for each row execute function private.ecommerce_order_guard();

create trigger trg_ecommerce_orders_touch_updated_at
  before update on public.ecommerce_orders
  for each row execute function private.ecommerce_touch_updated_at();

create table public.ecommerce_order_items (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  published_product_id uuid null references public.ecommerce_published_products(id) on delete set null,
  source_product_id text null,
  product_name text not null,
  unit_price numeric(12,2) not null,
  quantity numeric(12,3) not null,
  line_total numeric(12,2) not null default 0,
  options jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ecommerce_order_items_product_name_not_empty
    check (length(btrim(product_name)) > 0),
  constraint ecommerce_order_items_unit_price_nonnegative
    check (unit_price >= 0),
  constraint ecommerce_order_items_quantity_positive
    check (quantity > 0),
  constraint ecommerce_order_items_line_total_nonnegative
    check (line_total >= 0)
);

create index idx_ecommerce_order_items_order
  on public.ecommerce_order_items (order_id);

create index idx_ecommerce_order_items_license_created
  on public.ecommerce_order_items (license_id, created_at desc);

create or replace function private.ecommerce_order_item_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_portal_id uuid;
  v_license_id uuid;
begin
  select o.portal_id, o.license_id
  into v_portal_id, v_license_id
  from public.ecommerce_orders o
  where o.id = new.order_id
  limit 1;

  if v_license_id is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND'
      using errcode = 'foreign_key_violation';
  end if;

  new.portal_id := v_portal_id;
  new.license_id := v_license_id;
  new.line_total := round(new.unit_price * new.quantity, 2);

  return new;
end;
$$;

create trigger trg_ecommerce_order_items_guard
  before insert or update on public.ecommerce_order_items
  for each row execute function private.ecommerce_order_item_guard();

create table public.ecommerce_order_events (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_ref text null,
  message text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ecommerce_order_events_event_type_not_empty
    check (length(btrim(event_type)) > 0),
  constraint ecommerce_order_events_actor_type_check
    check (actor_type in ('system', 'public_customer', 'admin', 'staff', 'automation'))
);

create index idx_ecommerce_order_events_order_created
  on public.ecommerce_order_events (order_id, created_at desc);

create index idx_ecommerce_order_events_license_created
  on public.ecommerce_order_events (license_id, created_at desc);

create or replace function private.ecommerce_order_event_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_portal_id uuid;
  v_license_id uuid;
begin
  select o.portal_id, o.license_id
  into v_portal_id, v_license_id
  from public.ecommerce_orders o
  where o.id = new.order_id
  limit 1;

  if v_license_id is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND'
      using errcode = 'foreign_key_violation';
  end if;

  new.portal_id := v_portal_id;
  new.license_id := v_license_id;

  return new;
end;
$$;

create trigger trg_ecommerce_order_events_guard
  before insert or update on public.ecommerce_order_events
  for each row execute function private.ecommerce_order_event_guard();

-- ---------------------------------------------------------------------------
-- RLS y cierre de acceso directo
-- ---------------------------------------------------------------------------

alter table public.ecommerce_portals enable row level security;
alter table public.ecommerce_portal_hours enable row level security;
alter table public.ecommerce_portal_hour_exceptions enable row level security;
alter table public.ecommerce_published_products enable row level security;
alter table public.ecommerce_orders enable row level security;
alter table public.ecommerce_order_items enable row level security;
alter table public.ecommerce_order_events enable row level security;

revoke all on table public.ecommerce_portals from public, anon, authenticated;
revoke all on table public.ecommerce_portal_hours from public, anon, authenticated;
revoke all on table public.ecommerce_portal_hour_exceptions from public, anon, authenticated;
revoke all on table public.ecommerce_published_products from public, anon, authenticated;
revoke all on table public.ecommerce_orders from public, anon, authenticated;
revoke all on table public.ecommerce_order_items from public, anon, authenticated;
revoke all on table public.ecommerce_order_events from public, anon, authenticated;

grant all on table public.ecommerce_portals to service_role;
grant all on table public.ecommerce_portal_hours to service_role;
grant all on table public.ecommerce_portal_hour_exceptions to service_role;
grant all on table public.ecommerce_published_products to service_role;
grant all on table public.ecommerce_orders to service_role;
grant all on table public.ecommerce_order_items to service_role;
grant all on table public.ecommerce_order_events to service_role;

revoke all on sequence public.ecommerce_orders_order_number_seq from public, anon, authenticated;
grant all on sequence public.ecommerce_orders_order_number_seq to service_role;

drop policy if exists "deny direct select" on public.ecommerce_portals;
drop policy if exists "deny direct insert" on public.ecommerce_portals;
drop policy if exists "deny direct update" on public.ecommerce_portals;
drop policy if exists "deny direct delete" on public.ecommerce_portals;
create policy "deny direct select" on public.ecommerce_portals
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_portals
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_portals
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_portals
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_portal_hours;
drop policy if exists "deny direct insert" on public.ecommerce_portal_hours;
drop policy if exists "deny direct update" on public.ecommerce_portal_hours;
drop policy if exists "deny direct delete" on public.ecommerce_portal_hours;
create policy "deny direct select" on public.ecommerce_portal_hours
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_portal_hours
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_portal_hours
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_portal_hours
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_portal_hour_exceptions;
drop policy if exists "deny direct insert" on public.ecommerce_portal_hour_exceptions;
drop policy if exists "deny direct update" on public.ecommerce_portal_hour_exceptions;
drop policy if exists "deny direct delete" on public.ecommerce_portal_hour_exceptions;
create policy "deny direct select" on public.ecommerce_portal_hour_exceptions
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_portal_hour_exceptions
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_portal_hour_exceptions
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_portal_hour_exceptions
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_published_products;
drop policy if exists "deny direct insert" on public.ecommerce_published_products;
drop policy if exists "deny direct update" on public.ecommerce_published_products;
drop policy if exists "deny direct delete" on public.ecommerce_published_products;
create policy "deny direct select" on public.ecommerce_published_products
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_published_products
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_published_products
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_published_products
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_orders;
drop policy if exists "deny direct insert" on public.ecommerce_orders;
drop policy if exists "deny direct update" on public.ecommerce_orders;
drop policy if exists "deny direct delete" on public.ecommerce_orders;
create policy "deny direct select" on public.ecommerce_orders
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_orders
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_orders
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_orders
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_order_items;
drop policy if exists "deny direct insert" on public.ecommerce_order_items;
drop policy if exists "deny direct update" on public.ecommerce_order_items;
drop policy if exists "deny direct delete" on public.ecommerce_order_items;
create policy "deny direct select" on public.ecommerce_order_items
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_order_items
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_order_items
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_order_items
  for delete to anon, authenticated using (false);

drop policy if exists "deny direct select" on public.ecommerce_order_events;
drop policy if exists "deny direct insert" on public.ecommerce_order_events;
drop policy if exists "deny direct update" on public.ecommerce_order_events;
drop policy if exists "deny direct delete" on public.ecommerce_order_events;
create policy "deny direct select" on public.ecommerce_order_events
  for select to anon, authenticated using (false);
create policy "deny direct insert" on public.ecommerce_order_events
  for insert to anon, authenticated with check (false);
create policy "deny direct update" on public.ecommerce_order_events
  for update to anon, authenticated using (false) with check (false);
create policy "deny direct delete" on public.ecommerce_order_events
  for delete to anon, authenticated using (false);

-- Cerrar ejecucion directa de helpers internos.
revoke all on function private.ecommerce_plan_feature_patch(text) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_text(uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_bool(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.ecommerce_license_feature_int(uuid, text, integer) from public, anon, authenticated;
revoke all on function private.ecommerce_touch_updated_at() from public, anon, authenticated;
revoke all on function private.ecommerce_portal_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_published_product_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_item_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_order_event_guard() from public, anon, authenticated;

grant execute on function private.ecommerce_plan_feature_patch(text) to service_role;
grant execute on function private.ecommerce_license_feature_text(uuid, text) to service_role;
grant execute on function private.ecommerce_license_feature_bool(uuid, text, boolean) to service_role;
grant execute on function private.ecommerce_license_feature_int(uuid, text, integer) to service_role;
grant execute on function private.ecommerce_touch_updated_at() to service_role;
grant execute on function private.ecommerce_portal_guard() to service_role;
grant execute on function private.ecommerce_published_product_guard() to service_role;
grant execute on function private.ecommerce_order_guard() to service_role;
grant execute on function private.ecommerce_order_item_guard() to service_role;
grant execute on function private.ecommerce_order_event_guard() to service_role;

comment on table public.ecommerce_portals is
  'ECOM.DB.1: configuracion publica del portal. Acceso cliente directo cerrado; lectura publica futura via RPC.';
comment on table public.ecommerce_published_products is
  'ECOM.DB.1: catalogo publicado. FREE limitado a 10 productos publicados; stock visible reservado para PRO.';
comment on table public.ecommerce_orders is
  'ECOM.DB.1: solicitudes de pedido online pendientes. No afecta caja, inventario ni reportes POS.';

notify pgrst, 'reload schema';
