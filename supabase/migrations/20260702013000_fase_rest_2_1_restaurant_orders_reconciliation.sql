begin;

-- FASE REST.2.1 — Reconciliación versionada de REST.2
-- Seguridad: no borra tablas, no borra filas, no reinicia IDs y no toca frontend.
-- Esta migración asegura el contrato persistente y valida que las RPCs aplicadas
-- en Supabase sigan siendo SECURITY DEFINER y coincidan con el hash actual auditado.

create table if not exists public.pos_restaurant_orders (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  local_order_id text null,
  sale_id text null,
  table_label text null,
  customer_id text null,
  customer_name text null,
  status text not null default 'pending',
  fulfillment_status text not null default 'pending',
  source text not null default 'pos',
  notes text null,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  currency text not null default 'MXN',
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  updated_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  updated_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_to_kitchen_at timestamptz null,
  ready_at timestamptz null,
  delivered_at timestamptz null,
  cancelled_at timestamptz null,
  deleted_at timestamptz null,
  server_version integer not null default 1,
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_restaurant_orders_status_check check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_orders_fulfillment_status_check check (fulfillment_status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_orders_local_or_sale_required check (
    length(btrim(coalesce(local_order_id, ''))) > 0
    or length(btrim(coalesce(sale_id, ''))) > 0
  )
);

create table if not exists public.pos_restaurant_order_items (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  restaurant_order_id text not null references public.pos_restaurant_orders(id) on delete cascade,
  local_line_id text null,
  product_id text null,
  product_name text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  notes text null,
  selected_modifiers jsonb not null default '[]'::jsonb,
  station_code text not null default 'kitchen',
  station_name text not null default 'Cocina',
  status text not null default 'pending',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_restaurant_order_items_status_check check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  constraint pos_restaurant_order_items_product_name_not_blank check (length(btrim(product_name)) > 0),
  constraint pos_restaurant_order_items_station_code_not_blank check (length(btrim(station_code)) > 0)
);

alter table public.pos_restaurant_orders enable row level security;
alter table public.pos_restaurant_order_items enable row level security;

revoke all on table public.pos_restaurant_orders from anon, authenticated;
revoke all on table public.pos_restaurant_order_items from anon, authenticated;

create index if not exists pos_restaurant_orders_license_status_idx
  on public.pos_restaurant_orders (license_id, status)
  where deleted_at is null;

create index if not exists pos_restaurant_orders_license_fulfillment_idx
  on public.pos_restaurant_orders (license_id, fulfillment_status)
  where deleted_at is null;

create index if not exists pos_restaurant_orders_license_updated_idx
  on public.pos_restaurant_orders (license_id, updated_at desc);

create unique index if not exists pos_restaurant_orders_license_local_order_uidx
  on public.pos_restaurant_orders (license_id, local_order_id)
  where deleted_at is null and local_order_id is not null;

create unique index if not exists pos_restaurant_orders_license_sale_uidx
  on public.pos_restaurant_orders (license_id, sale_id)
  where deleted_at is null and sale_id is not null;

create index if not exists pos_restaurant_order_items_license_order_idx
  on public.pos_restaurant_order_items (license_id, restaurant_order_id)
  where deleted_at is null;

create index if not exists pos_restaurant_order_items_license_station_status_idx
  on public.pos_restaurant_order_items (license_id, station_code, status)
  where deleted_at is null;

do $$
declare
  v_missing text[];
  v_bad_security text[];
  v_bad_hash text[];
begin
  select array_agg(required_name)
  into v_missing
  from unnest(array[
    'pos_upsert_restaurant_order',
    'pos_get_restaurant_orders',
    'pos_update_restaurant_order_status'
  ]) as required_name
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = required_name
  );

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'REST.2 RPCs faltantes: %', v_missing;
  end if;

  select array_agg(p.proname)
  into v_bad_security
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'pos_upsert_restaurant_order',
      'pos_get_restaurant_orders',
      'pos_update_restaurant_order_status'
    )
    and p.prosecdef is not true;

  if coalesce(array_length(v_bad_security, 1), 0) > 0 then
    raise exception 'REST.2 RPCs sin SECURITY DEFINER: %', v_bad_security;
  end if;

  select array_agg(name)
  into v_bad_hash
  from (values
    ('pos_upsert_restaurant_order', '91c773356a93c9e9882458e15a7ee1fe'),
    ('pos_get_restaurant_orders', 'be2390d5ecd4dea6509189f95d810822'),
    ('pos_update_restaurant_order_status', 'd111a7b286f156ddd899c464022ff58e')
  ) as expected(name, expected_hash)
  join pg_proc p on p.proname = expected.name
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where md5(pg_get_functiondef(p.oid)) <> expected.expected_hash;

  if coalesce(array_length(v_bad_hash, 1), 0) > 0 then
    raise exception 'REST.2 RPCs difieren del contrato auditado: %', v_bad_hash;
  end if;
end;
$$;

revoke all on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) from public;
revoke all on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, boolean, integer, integer) from public;
revoke all on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) from public;

grant execute on function public.pos_upsert_restaurant_order(text, text, text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.pos_get_restaurant_orders(text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, boolean, integer, integer) to anon, authenticated;
grant execute on function public.pos_update_restaurant_order_status(text, text, text, text, text, text, text) to anon, authenticated;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'restaurant_orders_cloud', case when code = 'pro_monthly' then true else false end
)
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

commit;
