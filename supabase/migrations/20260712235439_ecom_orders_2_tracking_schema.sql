-- ECOM.ORDERS.2 / 1
-- Tracking schema and additive fulfillment columns.

create schema if not exists private;

alter table public.ecommerce_orders
  add column if not exists fulfillment_status text,
  add column if not exists fulfillment_version bigint not null default 0,
  add column if not exists fulfillment_updated_at timestamptz,
  add column if not exists public_status_message text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ecommerce_orders'::regclass
      and conname = 'ecommerce_orders_fulfillment_status_check'
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_fulfillment_status_check
      check (
        fulfillment_status is null
        or fulfillment_status in (
          'accepted',
          'preparing',
          'ready',
          'out_for_delivery',
          'completed',
          'cancelled',
          'attention'
        )
      ) not valid;
    alter table public.ecommerce_orders
      validate constraint ecommerce_orders_fulfillment_status_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ecommerce_orders'::regclass
      and conname = 'ecommerce_orders_fulfillment_version_check'
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_fulfillment_version_check
      check (fulfillment_version >= 0) not valid;
    alter table public.ecommerce_orders
      validate constraint ecommerce_orders_fulfillment_version_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ecommerce_orders'::regclass
      and conname = 'ecommerce_orders_public_status_message_check'
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_public_status_message_check
      check (
        public_status_message is null
        or (
          char_length(public_status_message) <= 280
          and public_status_message !~ '[<>]'
        )
      ) not valid;
    alter table public.ecommerce_orders
      validate constraint ecommerce_orders_public_status_message_check;
  end if;
end
$$;

create table if not exists private.ecommerce_order_tracking_keys (
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null,
  token_version integer not null,
  signing_secret bytea not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (portal_id, token_version),
  constraint ecommerce_order_tracking_keys_version_check check (token_version > 0),
  constraint ecommerce_order_tracking_keys_secret_check check (octet_length(signing_secret) >= 32),
  constraint ecommerce_order_tracking_keys_retired_check check (
    (is_active is true and retired_at is null)
    or is_active is false
  )
);

create unique index if not exists ecommerce_order_tracking_keys_one_active_idx
  on private.ecommerce_order_tracking_keys(portal_id)
  where is_active is true;

create table if not exists private.ecommerce_order_tracking_tokens (
  order_id uuid primary key references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null,
  token_version integer not null,
  token_hash bytea not null,
  token_last4 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint ecommerce_order_tracking_tokens_hash_unique unique (token_hash),
  constraint ecommerce_order_tracking_tokens_last4_check check (token_last4 ~ '^[A-Za-z0-9_-]{4}$'),
  constraint ecommerce_order_tracking_tokens_version_fk
    foreign key (portal_id, token_version)
    references private.ecommerce_order_tracking_keys(portal_id, token_version)
    on delete restrict,
  constraint ecommerce_order_tracking_tokens_expiry_check check (
    expires_at is null or expires_at > created_at
  )
);

create index if not exists ecommerce_order_tracking_tokens_portal_idx
  on private.ecommerce_order_tracking_tokens(portal_id, created_at desc);

create index if not exists ecommerce_order_tracking_tokens_license_idx
  on private.ecommerce_order_tracking_tokens(license_id, created_at desc);

create index if not exists ecommerce_order_tracking_tokens_active_lookup_idx
  on private.ecommerce_order_tracking_tokens(token_hash)
  where revoked_at is null;

create table if not exists private.ecommerce_order_fulfillment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  portal_id uuid not null references public.ecommerce_portals(id) on delete cascade,
  license_id uuid not null,
  version bigint not null,
  from_status text,
  to_status text not null,
  event_key text not null,
  public_message text,
  actor_type text not null,
  actor_staff_id text,
  created_at timestamptz not null default now(),
  constraint ecommerce_order_fulfillment_events_version_check check (version > 0),
  constraint ecommerce_order_fulfillment_events_status_check check (
    to_status in (
      'accepted',
      'preparing',
      'ready',
      'out_for_delivery',
      'completed',
      'cancelled',
      'attention'
    )
    and (
      from_status is null
      or from_status in (
        'accepted',
        'preparing',
        'ready',
        'out_for_delivery',
        'completed',
        'cancelled',
        'attention'
      )
    )
  ),
  constraint ecommerce_order_fulfillment_events_message_check check (
    public_message is null
    or (
      char_length(public_message) <= 280
      and public_message !~ '[<>]'
    )
  ),
  constraint ecommerce_order_fulfillment_events_order_version_unique unique (order_id, version),
  constraint ecommerce_order_fulfillment_events_order_key_unique unique (order_id, event_key)
);

create index if not exists ecommerce_order_fulfillment_events_order_idx
  on private.ecommerce_order_fulfillment_events(order_id, version desc);

create index if not exists ecommerce_order_fulfillment_events_license_idx
  on private.ecommerce_order_fulfillment_events(license_id, created_at desc);

create index if not exists ecommerce_orders_fulfillment_status_updated_idx
  on public.ecommerce_orders(license_id, fulfillment_status, fulfillment_updated_at desc)
  where fulfillment_status is not null;

create or replace function private.ecommerce_initialize_order_fulfillment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'accepted' and new.fulfillment_status is null then
    new.fulfillment_status := 'accepted';
    new.fulfillment_version := greatest(coalesce(new.fulfillment_version, 0), 1);
    new.fulfillment_updated_at := coalesce(new.accepted_at, now());
  end if;

  return new;
end;
$function$;

drop trigger if exists ecommerce_orders_initialize_fulfillment on public.ecommerce_orders;
create trigger ecommerce_orders_initialize_fulfillment
before insert or update of status
on public.ecommerce_orders
for each row
execute function private.ecommerce_initialize_order_fulfillment_v1();

update public.ecommerce_orders
set
  fulfillment_status = 'accepted',
  fulfillment_version = 1,
  fulfillment_updated_at = coalesce(accepted_at, updated_at, created_at, now())
where status = 'accepted'
  and fulfillment_status is null;

insert into private.ecommerce_order_fulfillment_events (
  order_id,
  portal_id,
  license_id,
  version,
  from_status,
  to_status,
  event_key,
  public_message,
  actor_type,
  actor_staff_id,
  created_at
)
select
  o.id,
  o.portal_id,
  o.license_id,
  1,
  null,
  'accepted',
  'backfill-accepted-v1',
  null,
  'system',
  null,
  coalesce(o.accepted_at, o.updated_at, o.created_at, now())
from public.ecommerce_orders o
where o.fulfillment_status = 'accepted'
  and o.fulfillment_version = 1
on conflict (order_id, version) do nothing;

alter table private.ecommerce_order_tracking_keys enable row level security;
alter table private.ecommerce_order_tracking_tokens enable row level security;
alter table private.ecommerce_order_fulfillment_events enable row level security;

revoke all on table private.ecommerce_order_tracking_keys from public, anon, authenticated;
revoke all on table private.ecommerce_order_tracking_tokens from public, anon, authenticated;
revoke all on table private.ecommerce_order_fulfillment_events from public, anon, authenticated;

revoke all on function private.ecommerce_initialize_order_fulfillment_v1() from public, anon, authenticated;

comment on table private.ecommerce_order_tracking_keys is
  'Versioned server-side HMAC keys for opaque ecommerce tracking tokens. Never exposed through the Data API.';
comment on table private.ecommerce_order_tracking_tokens is
  'Stores only token hashes and short diagnostic suffixes; never stores the plaintext tracking token.';
comment on table private.ecommerce_order_fulfillment_events is
  'Idempotent operational fulfillment transition journal for ecommerce orders.';;
