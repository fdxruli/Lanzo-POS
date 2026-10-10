-- DISPOSABLE LOOPBACK FIXTURE ONLY. Auth and financial leaves are test doubles.
-- Load after restaurant_origin_cancel_3d13_setup.sql; never on an application DB.
create table public.pos_products(id text);
create table public.pos_product_batches(id text);
create table public.ecommerce_orders(id text);
create table public.pos_customers(id text);
create unique index restaurant_fixture_order_id on public.pos_restaurant_orders(id);
create unique index restaurant_fixture_item_id on public.pos_restaurant_order_items(id);
create or replace function private.validate_pos_sync_context(text,text,text,text)
returns jsonb language plpgsql as $fixture$
declare v_actor uuid; v_session uuid; v_type text; v_license uuid;
begin
  if $1 not in ('fixture-license','fixture-other') or $2 not in ('A','B') or $3 is distinct from 'valid' then raise exception 'DEVICE_AUTH_INVALID'; end if;
  if $4 is null or $4 not in ('admin','staff-a','staff-b','kitchen','no-refunds','no-pos') then raise exception 'ACTOR_SESSION_INVALID'; end if;
  v_license := case when $1='fixture-license' then '00000000-0000-0000-0000-000000000001'::uuid else '00000000-0000-0000-0000-000000000002'::uuid end;
  v_type := case when $4='admin' then 'admin' else 'staff' end;
  v_actor := case when $4='admin' then '00000000-0000-0000-0000-0000000000ad'::uuid when $4='staff-b' then '00000000-0000-0000-0000-0000000000bb'::uuid else '00000000-0000-0000-0000-0000000000aa'::uuid end;
  v_session := case when $4='admin' then '00000000-0000-0000-0000-0000000001ad'::uuid when $4='staff-b' then '00000000-0000-0000-0000-0000000001bb'::uuid else '00000000-0000-0000-0000-0000000001aa'::uuid end;
  return jsonb_build_object('license_id',v_license,'device_id',case when $2='A' then '00000000-0000-0000-0000-00000000000a' else '00000000-0000-0000-0000-00000000000b' end,
    'actor_type',v_type,'actor_id',v_actor,'actor_key',v_type||':'||v_actor,'actor_session_id',v_session,
    'admin_user_id',case when v_type='admin' then v_actor else null end,'admin_session_id',case when v_type='admin' then v_session else null end,
    'staff_user_id',case when v_type='staff' then v_actor else null end,
    'actor_permissions',jsonb_build_object('pos',$4 not in ('no-pos','kitchen'),'refunds',$4 not in ('no-refunds','kitchen'),'orders',$4='kitchen'));
end;
$fixture$;
create function private.pos_restaurant_order_item_to_jsonb(public.pos_restaurant_order_items)
returns jsonb language sql as $$ select to_jsonb($1) $$;
create function private.assert_restaurant_order_write_permission(jsonb)
returns void language plpgsql as $$ begin
  if coalesce(($1->'actor_permissions'->>'orders')::boolean,false) then return; end if;
  perform private.assert_pos_permission($1,'pos');
end $$;
create function private.ensure_default_preparation_station(uuid,uuid,uuid) returns void language sql as $$ select $$;
create function private.normalize_restaurant_order_status(text) returns text language sql as $$ select $1 $$;
create function private.safe_jsonb_numeric(jsonb,text,numeric) returns numeric language sql as $$ select coalesce(($1->>$2)::numeric,$3) $$;
create function private.pos_sale_jsonb_text(jsonb,text[],text default null) returns text language sql as $$
  select coalesce((select nullif(btrim($1->>k),'') from unnest($2) with ordinality as keys(k,position)
    where nullif(btrim($1->>k),'') is not null order by position limit 1),$3)
$$;
create schema extensions;
create function extensions.gen_random_uuid() returns uuid language sql as $$ select pg_catalog.gen_random_uuid() $$;
create function private.resolve_restaurant_order_station(uuid,text,text,uuid,uuid) returns jsonb language sql as $$ select jsonb_build_object('code',$2,'name',$3) $$;
