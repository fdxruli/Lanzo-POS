-- Fixture for an empty, disposable PostgreSQL database.
create role anon;
create role authenticated;
create role service_role;
create schema private;
create type public.business_category as enum ('farmacia', 'food_service');
create table public.business_profiles (license_id uuid, business_type public.business_category[]);
create table public.pos_inventory_movements (
  id text,
  license_id uuid,
  product_id text,
  batch_id text,
  sale_id text,
  sale_item_id text,
  movement_type text,
  quantity numeric,
  previous_stock numeric,
  new_stock numeric,
  previous_batch_stock numeric,
  new_batch_stock numeric,
  unit_cost numeric,
  total_cost numeric,
  reason text,
  source text,
  actor_device_id uuid,
  actor_staff_user_id uuid,
  actor_key text,
  actor_name text,
  idempotency_key text,
  metadata jsonb,
  created_at timestamp with time zone default now(),
  server_version bigint,
  primary key (license_id, id)
);
create table public.pos_product_batches (
  id text,
  license_id uuid,
  product_id text,
  sku text,
  sku_key text,
  stock numeric,
  committed_stock numeric,
  cost numeric,
  price numeric,
  track_stock boolean,
  is_active boolean,
  status text,
  active_stock_status integer,
  expiry_date timestamp with time zone,
  alert_target_date timestamp with time zone,
  alert_type text,
  manufacturer_batch_id text,
  supplier text,
  attributes jsonb,
  location text,
  notes text,
  update_global_price boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  deleted_at timestamp with time zone,
  server_version integer,
  created_by_device_id uuid,
  updated_by_device_id uuid,
  created_by_staff_user_id uuid,
  updated_by_staff_user_id uuid,
  last_idempotency_key text,
  metadata jsonb,
  primary key (license_id, id)
);
create table public.pos_products (
  id text,
  license_id uuid,
  category_id text,
  name text,
  name_key text,
  description text,
  barcode text,
  barcode_key text,
  sku text,
  sku_key text,
  image_ref text,
  image_url text,
  location text,
  price numeric,
  cost numeric,
  stock numeric,
  committed_stock numeric,
  min_stock numeric,
  max_stock numeric,
  track_stock boolean,
  is_active boolean,
  product_type text,
  sale_type text,
  bulk_data jsonb,
  conversion_factor jsonb,
  batch_management jsonb,
  recipe jsonb,
  modifiers jsonb,
  wholesale_tiers jsonb,
  prescription_type text,
  active_substance text,
  laboratory text,
  requires_prescription boolean,
  presentation text,
  expiration_mode text,
  shelf_life_value numeric,
  shelf_life_unit text,
  search_tokens text[],
  search_ngrams text[],
  low_stock_alert_status text,
  active_stock_status integer,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  deleted_at timestamp with time zone,
  server_version integer,
  created_by_device_id uuid,
  updated_by_device_id uuid,
  created_by_staff_user_id uuid,
  updated_by_staff_user_id uuid,
  last_idempotency_key text,
  metadata jsonb,
  primary key (license_id, id)
);
create table public.pos_sale_items (
  id text,
  license_id uuid,
  sale_id text,
  product_id text,
  product_name text,
  product_sku text,
  barcode text,
  category_id text,
  category_name text,
  quantity numeric,
  unit_price numeric,
  unit_cost numeric,
  discount_amount numeric,
  tax_amount numeric,
  line_total numeric,
  batch_id text,
  batch_sku text,
  batch_expiry_date date,
  rubro text,
  metadata jsonb,
  created_at timestamp with time zone,
  server_version bigint,
  inventory_effect_status text,
  inventory_movement_id text,
  stock_source text,
  stock_before numeric,
  stock_after numeric,
  batch_stock_before numeric,
  batch_stock_after numeric,
  inventory_reversal_status text,
  primary key (license_id, id)
);
create table public.pos_idempotency_keys (
  license_id uuid, idempotency_key text, request_hash text, status text, response_payload jsonb,
  primary key (license_id, idempotency_key)
);
create table public.pos_sync_events (id text default gen_random_uuid()::text, server_version integer);
create function public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,int,int,int,text,jsonb)
returns jsonb language sql as $$ select '{"allowed":true}'::jsonb $$;
create function public.build_pos_rpc_rate_limited_response(jsonb)
returns jsonb language sql as $$ select $1 $$;
create function private.validate_product_inventory_actor(text,text,text,text)
returns jsonb language sql as $$
  select jsonb_build_object('license_id', $1::uuid, 'device_id', $2::uuid, 'permission', $3)
$$;
create function private.assert_cloud_products_sync_enabled(jsonb)
returns void language plpgsql as $$ begin return; end $$;
create function private.assert_inventory_actor_authority(jsonb)
returns void language plpgsql as $$ begin
  if $1->>'permission' is distinct from 'allowed' then raise exception 'PERMISSION_DENIED'; end if;
end $$;
create function private.product_uses_batches(public.pos_products)
returns boolean language sql as $$ select coalesce(($1.batch_management->>'enabled')::boolean, false) $$;
create function private.insert_pos_idempotency_processing(uuid,text,text,text,text,text)
returns boolean language sql as $$
  with created as (
    insert into public.pos_idempotency_keys values ($1,$2,$6,'processing',null)
    on conflict do nothing returning true
  ) select exists(select 1 from created)
$$;
create function private.complete_pos_idempotency(uuid,text,jsonb)
returns void language sql as $$
  update public.pos_idempotency_keys set status='completed', response_payload=$3
  where license_id=$1 and idempotency_key=$2
$$;
create function private.recalculate_pos_product_projection(uuid,text)
returns public.pos_products language sql as $$
  update public.pos_products p set server_version=server_version+1, stock=(
    select coalesce(sum(stock),0) from public.pos_product_batches b
    where b.license_id=$1 and b.product_id=$2 and b.is_active and b.deleted_at is null
  ) where p.license_id=$1 and p.id=$2 returning p.*
$$;
create function private.record_pos_inventory_movement(uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,uuid,uuid,text,text,text,jsonb)
returns public.pos_inventory_movements language sql as $$
  insert into public.pos_inventory_movements
    (id,license_id,product_id,batch_id,sale_id,sale_item_id,movement_type,quantity,
     previous_stock,new_stock,previous_batch_stock,new_batch_stock,source,idempotency_key,metadata,server_version)
  values (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$14,$19,$20,1)
  returning *
$$;
create function private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,int)
returns public.pos_sync_events language sql as $$
  insert into public.pos_sync_events(server_version) values ($9) returning *
$$;
create function private.resolve_cash_actor_key(jsonb) returns text language sql as $$ select 'test-actor'::text $$;
create function private.resolve_cash_actor_name(jsonb) returns text language sql as $$ select 'QA'::text $$;
create function private.pos_product_to_jsonb(public.pos_products) returns jsonb language sql as $$ select to_jsonb($1) $$;
create function private.pos_product_batch_to_jsonb(public.pos_product_batches) returns jsonb language sql as $$ select to_jsonb($1) $$;
create function private.pos_inventory_movement_to_jsonb(public.pos_inventory_movements) returns jsonb language sql as $$ select to_jsonb($1) $$;
