-- ECOMMERCE / POS sale traceability.
-- Additive only: no totals, folios, effects, inventory, cash or credit state changes.

alter table public.pos_sales
  add column if not exists sales_channel text,
  add column if not exists ecommerce_order_id uuid,
  add column if not exists ecommerce_order_code text;

comment on column public.pos_sales.sales_channel is
  'Business channel for the financial sale: local or ecommerce.';
comment on column public.pos_sales.ecommerce_order_id is
  'Canonical ecommerce order linked to this financial POS sale.';
comment on column public.pos_sales.ecommerce_order_code is
  'Public EC-* order reference preserved alongside the financial V-* folio.';

create or replace function private.pos_sale_try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

with metadata_candidates as (
  select
    s.id as sale_id,
    s.license_id,
    private.pos_sale_try_uuid(coalesce(
      s.metadata->>'ecommerceOrderId',
      s.metadata->>'ecommerce_order_id'
    )) as order_id,
    nullif(btrim(coalesce(
      s.metadata->>'ecommerceOrderCode',
      s.metadata->>'ecommerce_order_code'
    )), '') as order_code
  from public.pos_sales s
), relation_candidates as (
  select
    s.id as sale_id,
    s.license_id,
    o.id as order_id,
    o.public_order_code as order_code,
    row_number() over (
      partition by s.license_id, s.id
      order by
        case
          when mc.order_id = o.id then 1
          when mc.order_code = o.public_order_code then 2
          when o.converted_sale_id = s.id or o.pos_conversion_sale_id = s.id then 3
          when o.pos_conversion_key = s.idempotency_key then 4
          else 5
        end,
        o.created_at,
        o.id
    ) as sale_match_rank,
    count(*) over (partition by s.license_id, o.id) as order_sale_matches
  from public.pos_sales s
  left join metadata_candidates mc
    on mc.license_id = s.license_id
   and mc.sale_id = s.id
  join public.ecommerce_orders o
    on o.license_id = s.license_id
   and (
     (mc.order_id is not null and o.id = mc.order_id)
     or (mc.order_code is not null and o.public_order_code = mc.order_code)
     or o.converted_sale_id = s.id
     or o.pos_conversion_sale_id = s.id
     or (
       s.idempotency_key is not null
       and o.pos_conversion_key = s.idempotency_key
     )
     or (
       coalesce(s.metadata->>'ecommerceConversionKey', s.metadata->>'idempotencyKey') is not null
       and o.pos_conversion_key = coalesce(
         s.metadata->>'ecommerceConversionKey',
         s.metadata->>'idempotencyKey'
       )
     )
   )
), safe_relation as (
  select sale_id, license_id, order_id, order_code
  from relation_candidates
  where sale_match_rank = 1
    and order_sale_matches = 1
)
update public.pos_sales s
set ecommerce_order_id = coalesce(s.ecommerce_order_id, r.order_id),
    ecommerce_order_code = coalesce(
      nullif(btrim(s.ecommerce_order_code), ''),
      r.order_code,
      mc.order_code
    )
from metadata_candidates mc
left join safe_relation r
  on r.license_id = mc.license_id
 and r.sale_id = mc.sale_id
where s.license_id = mc.license_id
  and s.id = mc.sale_id
  and (
    s.ecommerce_order_id is null
    or nullif(btrim(s.ecommerce_order_code), '') is null
  );

update public.pos_sales s
set ecommerce_order_id = coalesce(s.ecommerce_order_id, o.id),
    ecommerce_order_code = coalesce(
      nullif(btrim(s.ecommerce_order_code), ''),
      o.public_order_code
    )
from public.ecommerce_orders o
where o.license_id = s.license_id
  and (
    (s.ecommerce_order_id is not null and o.id = s.ecommerce_order_id)
    or (
      s.ecommerce_order_id is null
      and s.ecommerce_order_code is not null
      and o.public_order_code = s.ecommerce_order_code
    )
  );

update public.pos_sales
set sales_channel = case
  when ecommerce_order_id is not null
    or nullif(btrim(ecommerce_order_code), '') is not null
    or coalesce(metadata->>'origin', '') = 'ecommerce'
    or metadata ? 'ecommerceOrderId'
    or metadata ? 'ecommerce_order_id'
    or idempotency_key like 'ecommerce:%'
  then 'ecommerce'
  else 'local'
end
where sales_channel is null
   or sales_channel not in ('local', 'ecommerce');

alter table public.pos_sales
  alter column sales_channel set default 'local',
  alter column sales_channel set not null;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.pos_sales'::regclass
      and c.conname = 'pos_sales_sales_channel_check'
  ) then
    alter table public.pos_sales
      add constraint pos_sales_sales_channel_check
      check (sales_channel in ('local', 'ecommerce'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ecommerce_orders'::regclass
      and c.conname = 'ecommerce_orders_license_id_unique'
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_license_id_unique
      unique (license_id, id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.pos_sales'::regclass
      and c.conname = 'pos_sales_ecommerce_order_fk'
  ) then
    alter table public.pos_sales
      add constraint pos_sales_ecommerce_order_fk
      foreign key (license_id, ecommerce_order_id)
      references public.ecommerce_orders (license_id, id)
      not valid;
  end if;
end;
$block$;

alter table public.pos_sales
  validate constraint pos_sales_ecommerce_order_fk;

create unique index if not exists pos_sales_license_ecommerce_order_uidx
  on public.pos_sales (license_id, ecommerce_order_id)
  where ecommerce_order_id is not null;

create index if not exists pos_sales_license_ecommerce_code_idx
  on public.pos_sales (license_id, ecommerce_order_code)
  where ecommerce_order_code is not null;

create or replace function private.pos_sales_normalize_ecommerce_traceability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_order_id uuid;
  v_order_code text;
  v_conversion_key text;
begin
  v_order_id := coalesce(
    new.ecommerce_order_id,
    private.pos_sale_try_uuid(v_metadata->>'ecommerceOrderId'),
    private.pos_sale_try_uuid(v_metadata->>'ecommerce_order_id')
  );
  v_order_code := coalesce(
    nullif(btrim(new.ecommerce_order_code), ''),
    nullif(btrim(v_metadata->>'ecommerceOrderCode'), ''),
    nullif(btrim(v_metadata->>'ecommerce_order_code'), '')
  );
  v_conversion_key := coalesce(
    nullif(btrim(new.idempotency_key), ''),
    nullif(btrim(v_metadata->>'ecommerceConversionKey'), ''),
    nullif(btrim(v_metadata->>'idempotencyKey'), '')
  );

  if v_order_id is null
     and v_conversion_key like 'ecommerce:%' then
    v_order_id := private.pos_sale_try_uuid(substring(v_conversion_key from 11));
  end if;

  if v_order_id is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.id = v_order_id
    limit 1;
  elsif v_order_code is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.public_order_code = v_order_code
    limit 1;
  elsif v_conversion_key is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.pos_conversion_key = v_conversion_key
    limit 1;
  end if;

  new.ecommerce_order_id := v_order_id;
  new.ecommerce_order_code := v_order_code;
  new.sales_channel := case
    when v_order_id is not null
      or v_order_code is not null
      or coalesce(new.sales_channel, '') = 'ecommerce'
      or coalesce(v_metadata->>'origin', '') = 'ecommerce'
    then 'ecommerce'
    else 'local'
  end;

  if new.sales_channel = 'ecommerce' then
    new.metadata := v_metadata
      || jsonb_build_object('origin', 'ecommerce')
      || case when v_order_id is not null
        then jsonb_build_object('ecommerceOrderId', v_order_id)
        else '{}'::jsonb
      end
      || case when v_order_code is not null
        then jsonb_build_object('ecommerceOrderCode', v_order_code)
        else '{}'::jsonb
      end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pos_sales_normalize_ecommerce_traceability
  on public.pos_sales;
create trigger trg_pos_sales_normalize_ecommerce_traceability
before insert or update of
  license_id,
  sales_channel,
  ecommerce_order_id,
  ecommerce_order_code,
  metadata,
  idempotency_key
on public.pos_sales
for each row
execute function private.pos_sales_normalize_ecommerce_traceability();

create or replace function private.pos_sale_to_jsonb(p_sale public.pos_sales)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_sale.id is null then null
    else jsonb_strip_nulls(to_jsonb(p_sale))
  end
$$;

create or replace function private.pos_ecommerce_sale_integrity_issues(
  p_license_id uuid default null
)
returns table (
  code text,
  severity text,
  ecommerce_order_id uuid,
  ecommerce_order_code text,
  sale_id text,
  details jsonb
)
language sql
stable
set search_path = ''
as $$
  select
    'CONVERTED_ORDER_WITHOUT_POS_SALE',
    'warning',
    o.id,
    o.public_order_code,
    coalesce(o.converted_sale_id, o.pos_conversion_sale_id),
    jsonb_build_object(
      'status', o.status,
      'pos_conversion_status', o.pos_conversion_status,
      'pos_conversion_key', o.pos_conversion_key
    )
  from public.ecommerce_orders o
  where (p_license_id is null or o.license_id = p_license_id)
    and (
      o.status = 'converted_to_sale'
      or o.converted_sale_id is not null
      or o.pos_conversion_status = 'completed'
    )
    and not exists (
      select 1
      from public.pos_sales s
      where s.license_id = o.license_id
        and (
          s.ecommerce_order_id = o.id
          or s.id = o.converted_sale_id
          or s.id = o.pos_conversion_sale_id
          or (
            o.pos_conversion_key is not null
            and s.idempotency_key = o.pos_conversion_key
          )
        )
    )

  union all

  select
    'ECOMMERCE_SALE_WITHOUT_ORDER',
    'error',
    s.ecommerce_order_id,
    s.ecommerce_order_code,
    s.id,
    jsonb_build_object('folio', coalesce(s.cloud_folio, s.folio, s.local_folio))
  from public.pos_sales s
  where (p_license_id is null or s.license_id = p_license_id)
    and s.sales_channel = 'ecommerce'
    and not exists (
      select 1
      from public.ecommerce_orders o
      where o.license_id = s.license_id
        and (
          (s.ecommerce_order_id is not null and o.id = s.ecommerce_order_id)
          or (
            s.ecommerce_order_id is null
            and s.ecommerce_order_code is not null
            and o.public_order_code = s.ecommerce_order_code
          )
        )
    )

  union all

  select
    'ORDER_LINKED_TO_MULTIPLE_SALES',
    'error',
    s.ecommerce_order_id,
    min(s.ecommerce_order_code),
    null,
    jsonb_build_object('sale_ids', jsonb_agg(s.id order by s.id), 'count', count(*))
  from public.pos_sales s
  where (p_license_id is null or s.license_id = p_license_id)
    and s.ecommerce_order_id is not null
  group by s.license_id, s.ecommerce_order_id
  having count(*) > 1

  union all

  select
    'ECOMMERCE_REFERENCE_MISMATCH',
    'error',
    s.ecommerce_order_id,
    s.ecommerce_order_code,
    s.id,
    jsonb_build_object(
      'expected_order_code', o.public_order_code,
      'converted_sale_id', o.converted_sale_id,
      'pos_conversion_sale_id', o.pos_conversion_sale_id
    )
  from public.pos_sales s
  join public.ecommerce_orders o
    on o.license_id = s.license_id
   and o.id = s.ecommerce_order_id
  where (p_license_id is null or s.license_id = p_license_id)
    and (
      s.ecommerce_order_code is distinct from o.public_order_code
      or (
        coalesce(o.converted_sale_id, o.pos_conversion_sale_id) is not null
        and coalesce(o.converted_sale_id, o.pos_conversion_sale_id) <> s.id
      )
    )

  union all

  select
    'ECOMMERCE_ORDER_SALE_TOTAL_MISMATCH',
    'warning',
    o.id,
    o.public_order_code,
    s.id,
    jsonb_build_object(
      'order_total', o.total,
      'sale_total', s.total,
      'difference', s.total - o.total
    )
  from public.pos_sales s
  join public.ecommerce_orders o
    on o.license_id = s.license_id
   and o.id = s.ecommerce_order_id
  where (p_license_id is null or s.license_id = p_license_id)
    and abs(s.total - o.total) > 0.01
$$;

-- Reconcile helpers used by the live final-history contract but absent from
-- older repository migration snapshots.
create or replace function private.sales_final_payment_family(p_method text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce($1, '')) in ('cash', 'efectivo', 'venta_efectivo') then 'cash'
    when lower(coalesce($1, '')) in (
      'card', 'tarjeta', 'debit', 'debit_card', 'credit_card',
      'tarjeta_debito', 'tarjeta_credito'
    ) then 'card'
    when lower(coalesce($1, '')) in (
      'transfer', 'transferencia', 'spei', 'bank_transfer'
    ) then 'transfer'
    when lower(coalesce($1, '')) in (
      'credit', 'credito', 'fiado', 'customer_credit'
    ) then 'credit'
    when lower(coalesce($1, '')) in ('mixed', 'mixto') then 'mixed'
    else lower(coalesce(nullif($1, ''), 'unknown'))
  end
$$;

create or replace function private.sales_final_scope_staff_filter(
  p_context jsonb,
  p_scope text,
  p_requested_staff uuid
)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_scope text := lower(coalesce(nullif(p_scope, ''), 'mine'));
  v_own_staff uuid := nullif(p_context->>'staff_user_id', '')::uuid;
begin
  if not private.reports_scope_allowed(p_context, v_scope) then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;

  if v_scope in ('mine', 'self') then
    perform private.reports_staff_filter(p_context, null);
    return v_own_staff;
  end if;

  return private.reports_staff_filter(p_context, p_requested_staff);
end;
$$;

create or replace function private.sales_final_source_metadata(
  p_profit_status text default null,
  p_stale boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.sales_final_report_source_metadata($1, $2)
$$;

create or replace function public.pos_get_sales_final_history_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_scope text default 'mine',
  p_staff_user_id uuid default null,
  p_device_id uuid default null,
  p_cash_session_id text default null,
  p_customer_id text default null,
  p_product_id text default null,
  p_category_id text default null,
  p_status text default null,
  p_payment_method text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_scope text := lower(coalesce(nullif(p_scope, ''), 'mine'));
  v_staff_filter uuid;
  v_own_staff uuid;
  v_context_device_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb := '[]'::jsonb;
  v_total_count integer := 0;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_sales_reports_final_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_own_staff := nullif(v_context->>'staff_user_id', '')::uuid;
  v_context_device_id := (v_context->>'device_id')::uuid;
  v_staff_filter := private.sales_final_scope_staff_filter(
    v_context,
    v_scope,
    p_staff_user_id
  );
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;

  with visible_sales as (
    select s.*
    from public.pos_sales s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.sold_at >= v_from
      and s.sold_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and (p_device_id is null or s.device_id = p_device_id)
      and (
        v_scope not in ('mine', 'self')
        or v_own_staff is not null
        or s.device_id = v_context_device_id
      )
      and (p_cash_session_id is null or s.cash_session_id = p_cash_session_id)
      and (p_customer_id is null or s.customer_id = p_customer_id)
      and (p_status is null or s.status = p_status)
      and (
        p_payment_method is null
        or private.sales_final_payment_family(s.payment_method)
          = private.sales_final_payment_family(p_payment_method)
      )
      and (
        p_product_id is null
        or exists (
          select 1
          from public.pos_sale_items i
          where i.license_id = s.license_id
            and i.sale_id = s.id
            and i.product_id = p_product_id
        )
      )
      and (
        p_category_id is null
        or exists (
          select 1
          from public.pos_sale_items i
          where i.license_id = s.license_id
            and i.sale_id = s.id
            and i.category_id = p_category_id
        )
      )
      and (
        p_search is null
        or p_search = ''
        or s.id ilike '%' || p_search || '%'
        or coalesce(s.cloud_folio, s.folio, s.local_folio, '') ilike '%' || p_search || '%'
        or coalesce(s.ecommerce_order_code, '') ilike '%' || p_search || '%'
        or coalesce(s.ecommerce_order_id::text, '') ilike '%' || p_search || '%'
        or coalesce(s.customer_name, '') ilike '%' || p_search || '%'
        or coalesce(s.actor_name, '') ilike '%' || p_search || '%'
      )
  ), page_sales as (
    select *
    from visible_sales
    order by sold_at desc, id desc
    limit v_limit
    offset v_offset
  )
  select
    coalesce((select count(*) from visible_sales), 0),
    coalesce((
      select jsonb_agg(row_payload order by sort_sold_at desc, sort_id desc)
      from (
        select
          s.sold_at as sort_sold_at,
          s.id as sort_id,
          jsonb_build_object(
            'id', s.id,
            'cloud_folio', s.cloud_folio,
            'folio', coalesce(s.cloud_folio, s.folio, s.local_folio),
            'sales_channel', s.sales_channel,
            'ecommerce_order_id', s.ecommerce_order_id,
            'ecommerce_order_code', s.ecommerce_order_code,
            'sold_at', s.sold_at,
            'source_mode', s.source_mode,
            'status', s.status,
            'customer_id', s.customer_id,
            'customer_name', coalesce(s.customer_name, c.name),
            'payment_method', s.payment_method,
            'payment_status', s.payment_status,
            'total', s.total,
            'amount_paid', s.amount_paid,
            'balance_due', s.balance_due,
            'actor_name', s.actor_name,
            'staff_user_id', s.staff_user_id,
            'device_id', s.device_id,
            'cash_session_id', s.cash_session_id,
            'cash_effect_status', s.cash_effect_status,
            'inventory_effect_status', s.inventory_effect_status,
            'credit_effect_status', s.credit_effect_status,
            'cash_reversal_status', s.cash_reversal_status,
            'inventory_reversal_status', s.inventory_reversal_status,
            'credit_reversal_status', s.credit_reversal_status,
            'cancellation_id', coalesce(s.cancellation_id, sc.id),
            'cancelled_at', coalesce(s.cancelled_at, sc.created_at),
            'cancel_reason', coalesce(s.cancel_reason, sc.reason),
            'items_count', coalesce(it.items_count, 0),
            'items_quantity', coalesce(it.items_quantity, 0),
            'payments', coalesce(pay.payments, '[]'::jsonb),
            'effects', jsonb_build_object(
              'cash', s.cash_effect_status,
              'inventory', s.inventory_effect_status,
              'credit', s.credit_effect_status,
              'cash_reversal', s.cash_reversal_status,
              'inventory_reversal', s.inventory_reversal_status,
              'credit_reversal', s.credit_reversal_status
            ),
            'badges', (
              case
                when s.sales_channel = 'ecommerce'
                  then jsonb_build_array('Ecommerce')
                else '[]'::jsonb
              end
              || case
                when s.source_mode = 'cloud_committed'
                  then jsonb_build_array('Cloud oficial')
                else '[]'::jsonb
              end
              || case
                when s.status = 'cancelled' or s.cancelled_at is not null
                  then jsonb_build_array('Cancelada')
                else '[]'::jsonb
              end
              || case
                when s.source_mode = 'shadow'
                  then jsonb_build_array('Shadow')
                else '[]'::jsonb
              end
              || case
                when s.source_mode in ('legacy_imported', 'shadow_history')
                  then jsonb_build_array('Historico local importado')
                else '[]'::jsonb
              end
              || case
                when s.cash_effect_status in ('applied', 'cash_applied')
                  then jsonb_build_array('Caja aplicada')
                else '[]'::jsonb
              end
              || case
                when s.inventory_effect_status = 'applied'
                  then jsonb_build_array('Inventario aplicado')
                else '[]'::jsonb
              end
              || case
                when s.credit_effect_status = 'applied'
                  then jsonb_build_array('Credito aplicado')
                else '[]'::jsonb
              end
              || case
                when coalesce(s.cash_reversal_status, 'not_required') in ('applied', 'not_required')
                  and coalesce(s.inventory_reversal_status, 'not_required') in ('applied', 'not_required')
                  and coalesce(s.credit_reversal_status, 'not_required') in ('applied', 'not_required')
                  and (s.status = 'cancelled' or s.cancelled_at is not null)
                  then jsonb_build_array('Reversas aplicadas')
                else '[]'::jsonb
              end
            )
          ) as row_payload
        from page_sales s
        left join public.pos_customers c
          on c.license_id = s.license_id
         and c.id = s.customer_id
        left join public.pos_sale_cancellations sc
          on sc.license_id = s.license_id
         and sc.sale_id = s.id
        left join lateral (
          select
            count(*)::integer as items_count,
            coalesce(sum(i.quantity), 0) as items_quantity
          from public.pos_sale_items i
          where i.license_id = s.license_id
            and i.sale_id = s.id
        ) it on true
        left join lateral (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'method', p.method,
                'amount', p.amount,
                'cash_session_id', p.cash_session_id,
                'cash_movement_id', p.cash_movement_id,
                'customer_ledger_id', p.customer_ledger_id
              )
              order by p.created_at, p.id
            ),
            '[]'::jsonb
          ) as payments
          from public.pos_sale_payments p
          where p.license_id = s.license_id
            and p.sale_id = s.id
        ) pay on true
      ) rows
    ), '[]'::jsonb)
  into v_total_count, v_rows;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', v_scope,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'sales', coalesce(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_total_count > (v_offset + v_limit),
    'source', private.sales_final_source_metadata(null, false)
  );
end;
$$;

revoke all on function private.pos_sale_try_uuid(text) from public, anon, authenticated;
revoke all on function private.pos_sales_normalize_ecommerce_traceability() from public, anon, authenticated;
revoke all on function private.pos_ecommerce_sale_integrity_issues(uuid) from public, anon, authenticated;
revoke all on function private.sales_final_payment_family(text) from public, anon, authenticated;
revoke all on function private.sales_final_scope_staff_filter(jsonb,text,uuid) from public, anon, authenticated;
revoke all on function private.sales_final_source_metadata(text,boolean) from public, anon, authenticated;
