create or replace function public.pos_get_reports_overview(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_date_from timestamp with time zone default null::timestamp with time zone,
  p_date_to timestamp with time zone default null::timestamp with time zone,
  p_scope text default 'license'::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_staff_filter uuid;
  v_customers jsonb;
  v_cash jsonb;
  v_products jsonb;
  v_cloud_sales jsonb;
  v_inventory jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_cloud_products_sync_enabled(v_context);

  if not private.reports_scope_allowed(v_context, p_scope) then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  select jsonb_build_object(
    'customers_total', count(*)::integer,
    'customers_with_debt', count(*) filter (where debt_cents > 0)::integer,
    'customers_without_debt', count(*) filter (where debt_cents <= 0)::integer,
    'customers_over_limit', count(*) filter (where credit_limit > 0 and debt > credit_limit)::integer,
    'debt_total', private.safe_numeric(sum(debt)),
    'payments_period', coalesce((
      select sum(abs(l.amount))
      from public.pos_customer_ledger l
      where l.license_id = v_license_id
        and l.deleted_at is null
        and l.type = 'PAYMENT'
        and l.created_at >= v_from and l.created_at < v_to
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    ), 0)
  )
  into v_customers
  from public.pos_customers c
  where c.license_id = v_license_id
    and c.deleted_at is null;

  select jsonb_build_object(
    'cash_sessions_open', coalesce((
      select count(*)::integer from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'open'
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0),
    'cash_sessions_closed', coalesce((
      select count(*)::integer from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'closed'
        and s.opened_at >= v_from and s.opened_at < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0),
    'cash_entries', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type in ('entrada', 'ajuste_entrada')
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'cash_exits', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type in ('salida', 'ajuste_salida')
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'customer_payments_in_cash', coalesce((
      select sum(m.amount) from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.type = 'abono_cliente'
        and m.created_at >= v_from and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    ), 0),
    'cash_difference', coalesce((
      select sum(abs(coalesce(s.cash_difference, 0))) from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'closed'
        and s.opened_at >= v_from and s.opened_at < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    ), 0)
  ) into v_cash;

  with batch_summary as (
    select
      p.id as product_id,
      count(b.id) filter (where b.deleted_at is null and b.is_active is true) as active_batches,
      coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_stock,
      coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_value
    from public.pos_products p
    left join public.pos_product_batches b on b.license_id = p.license_id and b.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
    group by p.id
  ), product_inventory as (
    select
      p.*,
      case when bs.active_batches > 0 then bs.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end as available_stock,
      case when bs.active_batches > 0 then bs.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end as inventory_value
    from public.pos_products p
    join batch_summary bs on bs.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
  )
  select jsonb_build_object(
    'products_active', count(*) filter (where is_active is true)::integer,
    'products_inactive', count(*) filter (where is_active is not true)::integer,
    'products_without_stock', count(*) filter (where is_active is true and track_stock is true and available_stock <= 0)::integer,
    'products_low_stock', count(*) filter (where is_active is true and track_stock is true and available_stock > 0 and min_stock is not null and available_stock <= min_stock)::integer,
    'inventory_value_approx', coalesce(sum(inventory_value), 0)
  ) into v_products
  from product_inventory;

  select jsonb_build_object(
    'cloud_inventory_movements_count', count(*) filter (where m.movement_type = 'sale_out')::integer,
    'cloud_inventory_sale_out_total_cost', coalesce(sum(m.total_cost) filter (where m.movement_type = 'sale_out'), 0),
    'cloud_cogs_estimated', coalesce(sum(m.total_cost) filter (where m.movement_type = 'sale_out'), 0)
  ) into v_inventory
  from public.pos_inventory_movements m
  where m.license_id = v_license_id
    and m.source = 'sale'
    and m.created_at >= v_from and m.created_at < v_to
    and (v_staff_filter is null or m.actor_staff_user_id = v_staff_filter);

  select jsonb_build_object(
    'cloud_sales_total', coalesce(sum(s.total), 0),
    'cloud_sales_count', count(*)::integer,
    'cloud_cash_sales_total', coalesce(sum(coalesce((s.metadata->'payment_summary'->>'cash_component')::numeric, 0)), 0),
    'cloud_non_cash_sales_total', coalesce(sum(coalesce((s.metadata->'payment_summary'->>'non_cash_component')::numeric, 0)), 0),
    'cloud_gross_profit_estimated', coalesce(sum(s.total), 0) - coalesce((v_inventory->>'cloud_cogs_estimated')::numeric, 0)
  ) into v_cloud_sales
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.deleted_at is null
    and s.source_mode = 'cloud_committed'
    and s.status = 'closed'
    and s.sold_at >= v_from and s.sold_at < v_to
    and (v_staff_filter is null or s.staff_user_id = v_staff_filter);

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', coalesce(p_scope, 'license'),
    'overview', v_customers || v_cash || v_products || v_cloud_sales || v_inventory,
    'source', private.reports_source_metadata('cloud') || jsonb_build_object('experimental', jsonb_build_array('Ventas cloud caja 6B', 'Inventario cloud venta 6C')),
    'data_sources', private.reports_source_metadata('cloud') || jsonb_build_object('experimental', jsonb_build_array('Ventas cloud caja 6B', 'Inventario cloud venta 6C')),
    'warnings', (private.reports_source_metadata('cloud')->'warnings') || jsonb_build_array('Utilidad cloud estimada: no definitiva hasta consolidacion 6F.', 'Credito cloud de venta fiada y cancelaciones/devoluciones siguen pendientes para 6D/6E.')
  );
end;
$function$;;
