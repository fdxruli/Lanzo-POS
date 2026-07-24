-- FASE CAD.6.1 — Reporte cloud extendido: lotes + productos operativos sin lote/vida útil.
create or replace function public.pos_get_expiring_batches_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_days_ahead integer default 30,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_days integer := greatest(coalesce(p_days_ahead, 30), 0);
  v_summary jsonb;
  v_items jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_pos_permission(v_context, 'reports');
  v_license_id := (v_context->>'license_id')::uuid;

  with batch_items as (
    select
      'batch:' || b.id as id,
      'batch'::text as record_type,
      'Lote'::text as type,
      b.id as batch_id,
      b.product_id,
      p.name as product_name,
      b.sku as batch_sku,
      b.expiry_date::date as expiry_date,
      coalesce(b.alert_target_date, b.expiry_date)::date as alert_target_date,
      b.alert_type,
      case
        when b.expiry_date is null and coalesce(b.alert_target_date, b.expiry_date) is null then 'missing'
        when private.is_pos_batch_expired_for_sale(b.expiry_date) then 'expired'
        when b.alert_target_date is not null and b.alert_target_date::date < current_date then 'shelf_life_expired'
        when b.expiry_date is not null and b.expiry_date::date = current_date then 'expires_today'
        when b.expiry_date is not null and b.expiry_date::date <= current_date + v_days then 'upcoming'
        when b.alert_target_date is not null and b.alert_target_date::date <= current_date + v_days then 'upcoming'
        else 'valid'
      end as expiry_status,
      case
        when private.is_pos_batch_expired_for_sale(b.expiry_date) then 'vencido'
        when b.alert_target_date is not null and b.alert_target_date::date < current_date then 'vida_util_vencida'
        when ((b.expiry_date is not null and b.expiry_date::date <= current_date + v_days) or (b.alert_target_date is not null and b.alert_target_date::date <= current_date + v_days)) then 'proximo_vencer'
        else 'vigente'
      end as operational_category,
      case
        when private.is_pos_batch_expired_for_sale(b.expiry_date) then 'Lote vencido'
        when b.alert_target_date is not null and b.alert_target_date::date < current_date then 'Vida útil vencida'
        when ((b.expiry_date is not null and b.expiry_date::date <= current_date + v_days) or (b.alert_target_date is not null and b.alert_target_date::date <= current_date + v_days)) then 'Próximo a vencer'
        else 'Vigente'
      end as status_label,
      case
        when private.is_pos_batch_expired_for_sale(b.expiry_date) then 'Lote vencido'
        when b.alert_target_date is not null and b.alert_target_date::date < current_date then 'Vida útil vencida'
        when ((b.expiry_date is not null and b.expiry_date::date <= current_date + v_days) or (b.alert_target_date is not null and b.alert_target_date::date <= current_date + v_days)) then 'Próximo a vencer'
        else 'Vigente'
      end as message,
      b.stock,
      b.committed_stock,
      greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) as available_stock,
      greatest(coalesce(p.stock, 0) - coalesce(p.committed_stock, 0), 0) as parent_available_stock,
      coalesce(b.cost, p.cost, 0) as unit_cost,
      greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, p.cost, 0) as stock_value,
      b.is_active,
      b.status,
      p.expiration_mode,
      (greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0 and (private.is_pos_batch_expired_for_sale(b.expiry_date) or (b.alert_target_date is not null and b.alert_target_date::date < current_date))) as can_move_to_waste,
      false as can_create_batch_from_stock,
      false as can_adjust_stock,
      b.location,
      null::text as product_regularization_reason
    from public.pos_product_batches b
    join public.pos_products p on p.license_id = b.license_id and p.id = b.product_id
    where b.license_id = v_license_id
      and b.deleted_at is null
      and p.deleted_at is null
      and (p_include_inactive is true or (b.is_active is true and b.status = 'active'))
      and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
  ),
  product_stock_health as (
    select
      p.*,
      greatest(coalesce(p.stock, 0) - coalesce(p.committed_stock, 0), 0) as parent_available_stock,
      private.pos_cad6_product_shelf_life_target_date(p) as shelf_life_target_date,
      private.pos_cad6_shelf_life_expired_for_sale(p) as shelf_life_expired_for_sale,
      (private.product_uses_batches(p) or coalesce(p.expiration_mode, 'NONE') = 'STRICT') as requires_current_batch,
      exists (
        select 1 from public.pos_product_batches b
        where b.license_id = p.license_id and b.product_id = p.id and b.deleted_at is null and b.is_active is true and b.status = 'active' and b.track_stock is true
          and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
          and (coalesce(p.expiration_mode, 'NONE') <> 'STRICT' or (b.expiry_date is not null and private.is_pos_batch_expired_for_sale(b.expiry_date) is not true))
      ) as has_current_active_batch
    from public.pos_products p
    where p.license_id = v_license_id
      and p.deleted_at is null
      and (p_include_inactive is true or p.is_active is true)
      and p.track_stock is true
      and greatest(coalesce(p.stock, 0) - coalesce(p.committed_stock, 0), 0) > 0
  ),
  product_items as (
    select
      'product:' || p.id as id,
      'product'::text as record_type,
      'Producto'::text as type,
      null::text as batch_id,
      p.id as product_id,
      p.name as product_name,
      null::text as batch_sku,
      p.shelf_life_target_date as expiry_date,
      p.shelf_life_target_date as alert_target_date,
      case when p.shelf_life_expired_for_sale then 'VIDA_UTIL_ESTIMADA' when p.expiration_mode = 'STRICT' then 'CADUCIDAD_LEGAL' else 'REGULARIZACION_STOCK' end as alert_type,
      case when p.shelf_life_expired_for_sale then 'shelf_life_expired' when p.requires_current_batch and p.has_current_active_batch is not true then 'no_current_batch' else 'stock_without_batch' end as expiry_status,
      case when p.shelf_life_expired_for_sale then 'vida_util_vencida' when p.expiration_mode = 'STRICT' and p.has_current_active_batch is not true then 'sin_lote_vigente' else 'requiere_regularizacion' end as operational_category,
      case when p.shelf_life_expired_for_sale then 'Vida útil vencida' when p.expiration_mode = 'STRICT' and p.has_current_active_batch is not true then 'Sin lote vigente' else 'Stock sin lote registrado' end as status_label,
      case when p.shelf_life_expired_for_sale then 'Vida útil vencida' when p.expiration_mode = 'STRICT' and p.has_current_active_batch is not true then 'Requiere lote vigente para vender' else 'Stock sin lote registrado' end as message,
      p.stock,
      p.committed_stock,
      p.parent_available_stock as available_stock,
      p.parent_available_stock,
      coalesce(p.cost, 0) as unit_cost,
      p.parent_available_stock * coalesce(p.cost, 0) as stock_value,
      p.is_active,
      case when p.is_active then 'active' else 'inactive' end as status,
      p.expiration_mode,
      false as can_move_to_waste,
      true as can_create_batch_from_stock,
      true as can_adjust_stock,
      p.location,
      case when p.shelf_life_expired_for_sale then 'shelf_life_expired' when p.expiration_mode = 'STRICT' and p.has_current_active_batch is not true then 'strict_without_current_batch' else 'stock_without_batch' end as product_regularization_reason
    from product_stock_health p
    where p.shelf_life_expired_for_sale or (p.requires_current_batch and p.has_current_active_batch is not true)
  ),
  items as (
    select * from batch_items
    where operational_category in ('vencido', 'vida_util_vencida', 'proximo_vencer') or (expiry_status = 'missing' and expiration_mode = 'STRICT')
    union all
    select * from product_items
  ),
  ordered_items as (
    select * from items
    order by case operational_category when 'vencido' then 1 when 'vida_util_vencida' then 2 when 'sin_lote_vigente' then 3 when 'requiere_regularizacion' then 4 when 'proximo_vencer' then 5 else 9 end,
      alert_target_date asc nulls last, product_name asc, batch_sku asc nulls last
  )
  select jsonb_build_object(
      'expired_active_batches', count(*) filter (where record_type = 'batch' and operational_category = 'vencido' and is_active is true and status = 'active'),
      'expired_batches', count(*) filter (where record_type = 'batch' and operational_category = 'vencido'),
      'shelf_life_expired_batches', count(*) filter (where record_type = 'batch' and operational_category = 'vida_util_vencida'),
      'upcoming_batches', count(*) filter (where record_type = 'batch' and operational_category = 'proximo_vencer'),
      'missing_expiry_strict_batches', count(*) filter (where record_type = 'batch' and expiry_status = 'missing' and expiration_mode = 'STRICT'),
      'shelf_life_expired_products', count(*) filter (where record_type = 'product' and operational_category = 'vida_util_vencida'),
      'strict_products_without_current_batch', count(*) filter (where record_type = 'product' and operational_category = 'sin_lote_vigente'),
      'products_requiring_regularization', count(*) filter (where record_type = 'product' and operational_category = 'requiere_regularizacion'),
      'product_records', count(*) filter (where record_type = 'product'),
      'batch_records', count(*) filter (where record_type = 'batch'),
      'total_items', count(*),
      'current_stock', coalesce(sum(available_stock) filter (where operational_category <> 'vencido'), 0),
      'expired_stock', coalesce(sum(available_stock) filter (where operational_category = 'vencido'), 0),
      'expired_value', coalesce(sum(stock_value) filter (where operational_category = 'vencido'), 0),
      'risk_value', coalesce(sum(stock_value) filter (where operational_category in ('vida_util_vencida','proximo_vencer','sin_lote_vigente','requiere_regularizacion')), 0),
      'days_ahead', v_days
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'record_type', record_type, 'type', type, 'batch_id', batch_id, 'product_id', product_id, 'product_name', product_name,
      'batch_sku', batch_sku, 'expiry_date', expiry_date, 'alert_target_date', alert_target_date, 'alert_type', alert_type,
      'expiry_status', expiry_status, 'operational_category', operational_category, 'status_label', status_label, 'message', message,
      'stock', stock, 'committed_stock', committed_stock, 'available_stock', available_stock, 'parent_available_stock', parent_available_stock,
      'unit_cost', unit_cost, 'stock_value', stock_value, 'is_active', is_active, 'status', status, 'expiration_mode', expiration_mode,
      'can_move_to_waste', can_move_to_waste, 'can_create_batch_from_stock', can_create_batch_from_stock, 'can_adjust_stock', can_adjust_stock,
      'location', location, 'product_regularization_reason', product_regularization_reason
    )), '[]'::jsonb)
  into v_summary, v_items
  from ordered_items;

  return jsonb_build_object('success', true, 'summary', coalesce(v_summary, '{}'::jsonb), 'batches', coalesce(v_items, '[]'::jsonb), 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean)
is 'CAD.6.1: reporte de caducidad extendido. Mantiene batches y agrega items con productos sin lote/vida util vencida; no toca caja ni ventas.';;
