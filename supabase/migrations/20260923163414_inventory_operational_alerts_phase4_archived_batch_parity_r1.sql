-- Phase 4 parity hardening: match the JavaScript SSOT's explicit archived-batch exclusion.

create or replace function private.inventory_operational_alert_candidates_v1(
  p_license_id uuid,
  p_business_date date
)
returns table(
  entity_kind text,
  entity_id text,
  incident_type text,
  classification text,
  severity text,
  product_id text,
  batch_id text,
  product_name text,
  available_stock numeric,
  physical_stock numeric,
  committed_stock numeric,
  min_stock numeric,
  min_stock_source text,
  expiry_date date,
  days_until_expiry integer,
  expires_today boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with product_source as (
    select
      p.id,
      p.name,
      p.stock,
      p.committed_stock,
      p.min_stock,
      p.track_stock,
      p.is_active,
      p.deleted_at,
      case
        when lower(p.stock::text) in ('nan', 'infinity', '-infinity')
          or lower(p.committed_stock::text) in ('nan', 'infinity', '-infinity')
          then null
        else p.stock - p.committed_stock
      end as available_stock,
      case
        when p.min_stock is null then 5::numeric
        when lower(p.min_stock::text) in ('nan', 'infinity', '-infinity') then null
        when p.min_stock < 0 then null
        else p.min_stock
      end as operational_min_stock,
      case
        when p.min_stock is null then 'legacy_fallback'
        when lower(p.min_stock::text) in ('nan', 'infinity', '-infinity') or p.min_stock < 0 then 'invalid'
        else 'configured'
      end as min_stock_source
    from public.pos_products p
    where p.license_id = p_license_id
      and p.deleted_at is null
      and p.is_active is true
      and p.track_stock is true
  ),
  stock_candidates as (
    select
      'product'::text as entity_kind,
      p.id::text as entity_id,
      case
        when p.available_stock <= 0 then 'inventory_out_of_stock'
        else 'inventory_low_stock'
      end::text as incident_type,
      case
        when p.available_stock <= 0 then 'out_of_stock'
        else 'low_stock'
      end::text as classification,
      case
        when p.available_stock <= 0 then 'critical'
        else 'warning'
      end::text as severity,
      p.id::text as product_id,
      null::text as batch_id,
      coalesce(nullif(p.name, ''), 'Producto sin nombre')::text as product_name,
      p.available_stock,
      p.stock as physical_stock,
      p.committed_stock,
      p.operational_min_stock as min_stock,
      p.min_stock_source,
      null::date as expiry_date,
      null::integer as days_until_expiry,
      false as expires_today
    from product_source p
    where p.available_stock is not null
      and (
        p.available_stock <= 0
        or (
          p.available_stock > 0
          and p.operational_min_stock is not null
          and p.available_stock <= p.operational_min_stock
        )
      )
  ),
  expiry_source as (
    select
      b.id::text as batch_id,
      b.product_id::text as product_id,
      coalesce(nullif(p.name, ''), 'Producto sin nombre')::text as product_name,
      b.stock as physical_stock,
      b.committed_stock,
      case
        when lower(b.stock::text) in ('nan', 'infinity', '-infinity')
          or lower(b.committed_stock::text) in ('nan', 'infinity', '-infinity')
          then null
        else b.stock - b.committed_stock
      end as available_stock,
      (
        coalesce(b.alert_target_date, b.expiry_date)
        at time zone 'UTC'
      )::date as expiry_date
    from public.pos_product_batches b
    join public.pos_products p
      on p.license_id = b.license_id
     and p.id = b.product_id
    where b.license_id = p_license_id
      and p_business_date is not null
      and p.deleted_at is null
      and p.is_active is true
      and p.track_stock is true
      and b.deleted_at is null
      and b.is_active is true
      and lower(coalesce(b.status, 'active')) not in ('inactive', 'archived')
      and b.active_stock_status <> 0
      and lower(b.stock::text) not in ('nan', 'infinity', '-infinity')
      and b.stock > 0
      and coalesce(b.alert_target_date, b.expiry_date) is not null
  ),
  expiry_candidates as (
    select
      'batch'::text as entity_kind,
      e.batch_id as entity_id,
      case
        when e.expiry_date < p_business_date then 'inventory_expired'
        when e.expiry_date = p_business_date then 'inventory_expiring_critical'
        else 'inventory_expiring_warning'
      end::text as incident_type,
      case
        when e.expiry_date < p_business_date then 'expired'
        else 'expiring'
      end::text as classification,
      case
        when e.expiry_date <= p_business_date then 'critical'
        else 'warning'
      end::text as severity,
      e.product_id,
      e.batch_id,
      e.product_name,
      e.available_stock,
      e.physical_stock,
      e.committed_stock,
      null::numeric as min_stock,
      null::text as min_stock_source,
      e.expiry_date,
      (e.expiry_date - p_business_date)::integer as days_until_expiry,
      e.expiry_date = p_business_date as expires_today
    from expiry_source e
    where e.expiry_date <= p_business_date + 7
  ),
  all_candidates as (
    select * from stock_candidates
    union all
    select * from expiry_candidates
  )
  select *
  from all_candidates
  order by
    case severity when 'critical' then 0 else 1 end,
    case
      when classification = 'expired' then 0
      when classification = 'out_of_stock' then 1
      when classification = 'expiring' and expires_today then 2
      when classification = 'low_stock' then 3
      when classification = 'expiring' then 4
      else 99
    end,
    coalesce(days_until_expiry, 2147483647),
    product_name,
    entity_id;
$function$;


comment on function private.inventory_operational_alert_candidates_v1(uuid,date) is
  'Phase 4 server-side projection of the Phase 1 JavaScript inventory operational alert contract; archived batches are explicitly excluded.';
