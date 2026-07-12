-- ECOM.POS.3 — Esquema de conversión POS
-- Alineado con la migración aplicada en producción: 20260712032309.

alter table public.ecommerce_orders
  add column if not exists converted_at timestamptz,
  add column if not exists pos_conversion_key text,
  add column if not exists pos_conversion_status text not null default 'idle',
  add column if not exists pos_conversion_attempt_id text,
  add column if not exists pos_conversion_sale_id text,
  add column if not exists pos_conversion_actor_ref text,
  add column if not exists pos_conversion_started_at timestamptz;

update public.ecommerce_orders
set pos_conversion_status = case
  when converted_sale_id is not null then 'completed'
  else 'idle'
end
where pos_conversion_status is null
   or pos_conversion_status not in ('idle', 'reserved', 'completed');

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname = 'ecommerce_orders_pos_conversion_status_valid'
      and c.conrelid = 'public.ecommerce_orders'::regclass
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_pos_conversion_status_valid
      check (pos_conversion_status in ('idle', 'reserved', 'completed'));
  end if;
end;
$block$;

create unique index if not exists ux_ecommerce_orders_license_pos_conversion_key
  on public.ecommerce_orders (license_id, pos_conversion_key)
  where pos_conversion_key is not null;
