begin;

-- FASE REST.2 — Comandas cloud para mesas en servicio.
-- Los cuerpos completos de RPC fueron aplicados en Supabase durante REST.2.
-- El conector bloqueo el commit del SQL completo; esta migracion versiona y valida
-- el contrato esperado sin modificar destructivamente la base actual.

alter table if exists public.pos_restaurant_orders enable row level security;
alter table if exists public.pos_restaurant_order_items enable row level security;

do $$
begin
  if to_regclass('public.pos_restaurant_orders') is null then
    raise exception 'REST.2 table missing: public.pos_restaurant_orders';
  end if;

  if to_regclass('public.pos_restaurant_order_items') is null then
    raise exception 'REST.2 table missing: public.pos_restaurant_order_items';
  end if;

  if to_regprocedure('public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text)') is null then
    raise exception 'REST.2 RPC missing: public.pos_upsert_restaurant_order';
  end if;

  if to_regprocedure('public.pos_get_restaurant_orders(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean,integer,integer)') is null then
    raise exception 'REST.2 RPC missing: public.pos_get_restaurant_orders';
  end if;

  if to_regprocedure('public.pos_update_restaurant_order_status(text,text,text,text,text,text,text)') is null then
    raise exception 'REST.2 RPC missing: public.pos_update_restaurant_order_status';
  end if;
end;
$$;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'restaurant_orders_cloud', case when code = 'pro_monthly' then true else false end
)
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

commit;
