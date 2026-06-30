-- FASE CAD.4 — Prevencion operativa de caducidad y rotacion FEFO.
-- Objetivo: exponer recomendaciones FEFO de solo lectura sin tocar checkout, caja ni mutaciones de merma.

create index if not exists idx_pos_product_batches_fefo_recommendations
on public.pos_product_batches (license_id, product_id, expiry_date asc, created_at asc)
where deleted_at is null
  and is_active is true
  and track_stock is true
  and status = 'active';

comment on index public.idx_pos_product_batches_fefo_recommendations
is 'CAD.4: acelera recomendaciones FEFO por licencia/producto/lote activo con stock.';

create or replace function public.pos_get_expiration_fefo_recommendations(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_days_ahead integer default 30,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_days_ahead integer := least(greatest(coalesce(p_days_ahead, 30), 1), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_summary jsonb;
  v_items jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_pos_permission(v_context, 'reports');
  v_license_id := (v_context->>'license_id')::uuid;

  with candidate_batches as (
    select
      p.id as product_id,
      p.name as product_name,
      coalesce(p.expiration_mode, 'NONE') as expiration_mode,
      b.id as batch_id,
      coalesce(nullif(b.sku, ''), nullif(b.manufacturer_batch_id, ''), 'Lote') as batch_sku,
      b.expiry_date::date as expiry_date,
      greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0)::numeric as available_stock,
      coalesce(b.cost, p.cost, 0)::numeric as unit_cost,
      coalesce(
        nullif(p.bulk_data #>> '{purchase,unit}', ''),
        nullif(p.bulk_data #>> '{sale,unit}', ''),
        nullif(p.bulk_data #>> '{stock,unit}', ''),
        nullif(p.bulk_data->>'unit', ''),
        'u'
      ) as unit,
      b.created_at,
      case
        when b.expiry_date is null then null
        else (b.expiry_date::date - current_date)
      end as days_remaining
    from public.pos_products p
    join public.pos_product_batches b
      on b.license_id = p.license_id
     and b.product_id = p.id
    where p.license_id = v_license_id
      and p.deleted_at is null
      and p.is_active is true
      and b.deleted_at is null
      and b.is_active is true
      and b.status = 'active'
      and b.track_stock is true
      and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
  ),
  scored as (
    select
      c.*,
      case
        when c.days_remaining is null then 'ok'
        when c.days_remaining < 0 then 'expired'
        when c.days_remaining <= 3 then 'critical'
        when c.days_remaining <= 7 then 'warning'
        when c.days_remaining <= v_days_ahead then 'watch'
        else 'ok'
      end as risk_level,
      round((c.available_stock * c.unit_cost)::numeric, 4) as value_at_risk
    from candidate_batches c
  ),
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.product_id
        order by s.expiry_date asc nulls last, s.created_at asc, s.batch_id asc
      ) as rn
    from scored s
  ),
  recommended as (
    select
      r.*,
      (
        select count(*)
        from scored older
        where older.product_id = r.product_id
          and older.batch_id <> r.batch_id
          and r.expiry_date is not null
          and older.expiry_date is not null
          and older.expiry_date < r.expiry_date
      ) as older_batches_count,
      (
        select count(*)
        from scored newer
        where newer.product_id = r.product_id
          and newer.batch_id <> r.batch_id
          and r.expiry_date is not null
          and (
            newer.expiry_date is null
            or newer.expiry_date > r.expiry_date
            or (
              newer.expiry_date = r.expiry_date
              and (newer.created_at, newer.batch_id) > (r.created_at, r.batch_id)
            )
          )
      ) as newer_batches_count
    from ranked r
    where r.rn = 1
      and r.risk_level <> 'ok'
  ),
  limited as (
    select *
    from recommended
    order by
      case risk_level
        when 'expired' then 0
        when 'critical' then 1
        when 'warning' then 2
        when 'watch' then 3
        else 4
      end,
      days_remaining asc nulls last,
      product_name asc
    limit v_limit
  ),
  summary as (
    select jsonb_build_object(
      'products_with_risk', count(distinct product_id) filter (where risk_level <> 'ok'),
      'batches_at_risk', count(*) filter (where risk_level <> 'ok'),
      'expired_batches', count(*) filter (where risk_level = 'expired'),
      'critical_batches', count(*) filter (where risk_level = 'critical'),
      'warning_batches', count(*) filter (where risk_level = 'warning'),
      'stock_at_risk', coalesce(sum(available_stock) filter (where risk_level <> 'ok'), 0),
      'value_at_risk', coalesce(sum(value_at_risk) filter (where risk_level <> 'ok'), 0)
    ) as payload
    from scored
  ),
  items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId', product_id,
      'productName', product_name,
      'expirationMode', expiration_mode,
      'recommendedBatchId', batch_id,
      'recommendedBatchSku', batch_sku,
      'recommendedExpiryDate', expiry_date,
      'daysRemaining', days_remaining,
      'riskLevel', risk_level,
      'availableStock', available_stock,
      'unitCost', unit_cost,
      'valueAtRisk', value_at_risk,
      'unit', unit,
      'olderBatchesCount', older_batches_count,
      'newerBatchesCount', newer_batches_count,
      'recommendation',
        case
          when risk_level = 'expired' then 'Revisa este lote hoy; ya está vencido o requiere merma.'
          when newer_batches_count > 0 then 'Vende primero este lote antes de usar lotes nuevos.'
          when risk_level = 'critical' then 'Prioriza este lote hoy; está a punto de vencer.'
          when risk_level = 'warning' then 'Considera promoción o rotación interna para evitar pérdida.'
          when risk_level = 'watch' then 'Este producto tiene lote próximo a vencer; priorízalo en exhibición.'
          else 'Sin acción preventiva inmediata.'
        end,
      'source', 'cloud'
    ) order by
      case risk_level
        when 'expired' then 0
        when 'critical' then 1
        when 'warning' then 2
        when 'watch' then 3
        else 4
      end,
      days_remaining asc nulls last,
      product_name asc), '[]'::jsonb) as payload
    from limited
  )
  select summary.payload, items.payload
  into v_summary, v_items
  from summary cross join items;

  return jsonb_build_object(
    'success', true,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb),
    'daysAhead', v_days_ahead,
    'source', 'cloud'
  );
end;
$$;

comment on function public.pos_get_expiration_fefo_recommendations(text,text,text,text,integer,integer)
is 'CAD.4: recomendaciones FEFO cloud de solo lectura. Valida contexto POS y permiso reports; filtra por license_id; no expone ventas/clientes.';

revoke all on function public.pos_get_expiration_fefo_recommendations(text,text,text,text,integer,integer) from public;
grant execute on function public.pos_get_expiration_fefo_recommendations(text,text,text,text,integer,integer) to anon, authenticated;
