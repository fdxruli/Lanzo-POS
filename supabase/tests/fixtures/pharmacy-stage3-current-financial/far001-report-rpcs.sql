-- Read-only report function snapshot from Production for disposable PG17 QA.
-- Loaded by the isolated runner before applying the financial-report migration.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.reports_date_range(p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_to timestamptz := coalesce(p_date_to, now());
  v_from timestamptz := coalesce(p_date_from, coalesce(p_date_to, now()) - interval '30 days');
begin
  if v_from > v_to then
    raise exception 'INVALID_REPORT_DATE_RANGE' using errcode = 'P0001';
  end if;

  if v_to - v_from > interval '400 days' then
    raise exception 'REPORT_DATE_RANGE_TOO_LARGE' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'used_default_from', p_date_from is null,
    'used_default_to', p_date_to is null,
    'max_days', 400
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.reports_staff_filter(p_context jsonb, requested_staff uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_own_staff uuid := nullif(p_context->>'staff_user_id', '')::uuid;
begin
  if private.reports_audit_allowed(p_context) then
    return requested_staff;
  end if;

  if not private.reports_allowed(p_context) then
    raise exception 'REPORTS_PERMISSION_DENIED' using errcode = 'P0001';
  end if;

  if v_own_staff is null then
    return requested_staff;
  end if;

  if requested_staff is not null and requested_staff <> v_own_staff then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;

  return v_own_staff;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sales_final_scope_staff_filter(p_context jsonb, p_scope text, p_requested_staff uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.reports_scope_allowed(p_context jsonb, scope text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce($2, 'license') in ('mine', 'self') then true
    when coalesce($2, 'license') in ('license', 'all', 'staff') then private.reports_audit_allowed($1)
    else false
  end
$function$;

CREATE OR REPLACE FUNCTION private.reports_has_permission(p_context jsonb, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(($1->'staff_permissions'->>$2)::boolean, false)
$function$;

CREATE OR REPLACE FUNCTION private.reports_is_admin(p_context jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin return private.resolve_pos_actor_type(p_context) = 'admin'; end;
$function$;

CREATE OR REPLACE FUNCTION private.reports_allowed(p_context jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.reports_is_admin($1)
    or private.reports_has_permission($1, 'reportes')
    or private.reports_has_permission($1, 'reports')
$function$;

CREATE OR REPLACE FUNCTION private.reports_audit_allowed(p_context jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.reports_is_admin($1)
    or private.reports_has_permission($1, 'reportes_globales')
    or private.reports_has_permission($1, 'reports_global')
    or private.reports_has_permission($1, 'caja_auditoria')
    or private.reports_has_permission($1, 'cash_audit')
$function$;

CREATE OR REPLACE FUNCTION private.assert_cloud_reports_sync_enabled(p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_reports_sync')::boolean, false) is not true then
    raise exception 'CLOUD_REPORTS_SYNC_DISABLED' using errcode = 'P0001';
  end if;

  if not private.reports_allowed(p_context) then
    raise exception 'REPORTS_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_cloud_sales_reports_final_enabled(p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform private.assert_cloud_reports_sync_enabled(p_context);
  perform private.assert_cloud_sales_cashier_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_reports_final')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_REPORTS_FINAL_DISABLED' using errcode = 'P0001';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sales_final_source_metadata(p_profit_status text DEFAULT NULL::text, p_stale boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.sales_final_report_source_metadata($1, $2)
$function$;

CREATE OR REPLACE FUNCTION private.sales_final_report_source_metadata(p_profit_status text DEFAULT NULL::text, p_stale boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'mode', case when coalesce($2, false) then 'cache' else 'cloud' end,
    'official', jsonb_build_array('sales', 'cash', 'customer_credit', 'customers', 'products', 'inventory', 'cancellations', 'profit', 'audit'),
    'local', jsonb_build_array('waste'),
    'final', true,
    'phase', 'fase6f_consolidacion_reportes_finales_cloud',
    'warnings', case
      when coalesce($1, '') = 'incomplete' then jsonb_build_array('Utilidad incompleta: hay ventas o articulos sin costo confiable.')
      when coalesce($1, '') = 'estimated' then jsonb_build_array('Utilidad estimada: se usaron costos snapshot cuando no hubo movimiento de inventario con costo.')
      else jsonb_build_array()
    end
  )
$function$;

CREATE OR REPLACE FUNCTION private.sales_final_payment_family(p_method text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.pos_get_sales_final_overview(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope text DEFAULT 'mine'::text, p_staff_user_id uuid DEFAULT NULL::uuid, p_device_id uuid DEFAULT NULL::uuid, p_cash_session_id text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_get_sales_final_overview',
          p_scope := 'POS_READ_HEAVY',
          p_max_attempts := 60,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'REPORT_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_get_sales_final_overview_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)::jsonb;
      END;
      $function$;

CREATE OR REPLACE FUNCTION public.pos_get_sales_final_overview_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope text DEFAULT 'mine'::text, p_staff_user_id uuid DEFAULT NULL::uuid, p_device_id uuid DEFAULT NULL::uuid, p_cash_session_id text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_overview jsonb := '{}'::jsonb;
  v_breakdowns jsonb := '{}'::jsonb;
  v_profit_status text := 'definitive';
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_reports_final_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_own_staff := nullif(v_context->>'staff_user_id', '')::uuid;
  v_context_device_id := (v_context->>'device_id')::uuid;
  v_staff_filter := private.sales_final_scope_staff_filter(v_context, v_scope, p_staff_user_id);
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;

  with filtered_sales as (
    select s.*
    from public.pos_sales s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.sold_at >= v_from and s.sold_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and (p_device_id is null or s.device_id = p_device_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or s.device_id = v_context_device_id)
      and (p_cash_session_id is null or s.cash_session_id = p_cash_session_id)
      and (p_customer_id is null or s.customer_id = p_customer_id)
      and (
        p_product_id is null or exists (
          select 1 from public.pos_sale_items i
          where i.license_id = s.license_id and i.sale_id = s.id and i.product_id = p_product_id
        )
      )
      and (
        p_category_id is null or exists (
          select 1 from public.pos_sale_items i
          where i.license_id = s.license_id and i.sale_id = s.id and i.category_id = p_category_id
        )
      )
  ), official_sales as (
    select * from filtered_sales
    where source_mode = 'cloud_committed'
      and (status in ('closed','cancelled') or cancelled_at is not null)
  ), net_sales as (
    select * from official_sales
    where status = 'closed' and cancelled_at is null
  ), cancelled_sales as (
    select * from official_sales
    where status = 'cancelled' or cancelled_at is not null
  ), payment_rows as (
    select p.sale_id, private.sales_final_payment_family(p.method) as family, p.amount
    from public.pos_sale_payments p
    join net_sales s on s.license_id = p.license_id and s.id = p.sale_id
    where p.license_id = v_license_id
  ), payment_by_sale as (
    select sale_id,
           sum(amount) filter (where family = 'cash') as cash_total,
           sum(amount) filter (where family = 'card') as card_total,
           sum(amount) filter (where family = 'transfer') as transfer_total,
           sum(amount) filter (where family = 'credit') as credit_total,
           count(distinct family) filter (where family <> 'unknown') as method_count
    from payment_rows
    group by sale_id
  ), item_costs as (
    select i.id,
           i.sale_id,
           i.product_id,
           i.category_id,
           i.quantity,
           i.line_total,
           i.unit_cost,
           im.movement_cost,
           case
             when im.has_movement_cost then 'inventory_movement'
             when i.unit_cost is not null then 'sale_item_snapshot'
             else 'missing'
           end as cost_source,
           case
             when im.has_movement_cost then coalesce(im.movement_cost, 0)
             when i.unit_cost is not null then coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)
             else null
           end as cogs
    from public.pos_sale_items i
    join net_sales s on s.license_id = i.license_id and s.id = i.sale_id
    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true
    where i.license_id = v_license_id
      and (p_product_id is null or i.product_id = p_product_id)
      and (p_category_id is null or i.category_id = p_category_id)
  ), gross_agg as (
    select coalesce(sum(total), 0) as gross_sales_total,
           count(*)::integer as gross_sales_count
    from official_sales
  ), cancelled_agg as (
    select coalesce(sum(total), 0) as cancelled_sales_total,
           count(*)::integer as cancelled_sales_count
    from cancelled_sales
  ), net_agg as (
    select coalesce(sum(total), 0) as net_sales_total,
           count(*)::integer as net_sales_count,
           coalesce(avg(total), 0) as average_ticket
    from net_sales
  ), payment_agg as (
    select coalesce(sum(cash_total), 0) as cash_sales_total,
           coalesce(sum(card_total), 0) as card_sales_total,
           coalesce(sum(transfer_total), 0) as transfer_sales_total,
           coalesce(sum(credit_total), 0) as credit_sales_total,
           coalesce((select sum(s.total) from net_sales s left join payment_by_sale ps on ps.sale_id = s.id where coalesce(ps.method_count, 0) > 1 or private.sales_final_payment_family(s.payment_method) = 'mixed'), 0) as mixed_sales_total
    from payment_by_sale
  ), cost_agg as (
    select coalesce(sum(cogs), 0) as cogs_total,
           count(*) filter (where cost_source = 'missing')::integer as cogs_missing_count,
           coalesce(sum(line_total) filter (where cost_source = 'missing'), 0) as cogs_missing_sales_total,
           count(*)::integer as item_count,
           count(*) filter (where cost_source = 'inventory_movement')::integer as inventory_cost_count,
           count(*) filter (where cost_source = 'sale_item_snapshot')::integer as snapshot_cost_count,
           coalesce(sum(quantity), 0) as items_sold_quantity,
           count(distinct product_id) filter (where product_id is not null)::integer as products_sold_count
    from item_costs
  ), credit_agg as (
    select coalesce(sum(l.amount) filter (where l.type = 'CHARGE'), 0) as credit_charges_total,
           coalesce(sum(abs(l.amount)) filter (where l.type = 'PAYMENT'), 0) as credit_payments_total,
           coalesce(sum(abs(l.amount)) filter (where l.type in ('CANCEL_CHARGE','CANCEL_PAYMENT')), 0) as credit_cancellations_total,
           coalesce(sum(l.amount) filter (where l.type = 'CHARGE' and l.sale_id is not null), 0) as credit_created_total,
           coalesce(sum(abs(l.amount)) filter (where l.type = 'PAYMENT' and l.sale_id is not null), 0) as credit_initial_payments_total,
           greatest(
             coalesce(sum(l.amount) filter (where l.type = 'CHARGE' and l.sale_id is not null), 0)
             - coalesce(sum(abs(l.amount)) filter (where l.type = 'PAYMENT' and l.sale_id is not null), 0),
             0
           ) as credit_balance_created_total
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and l.created_at >= v_from and l.created_at < v_to
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (p_cash_session_id is null or l.cash_session_id = p_cash_session_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or l.actor_device_id = v_context_device_id)
  ), debt_agg as (
    select count(*) filter (where c.debt_cents > 0)::integer as customers_with_debt,
           coalesce(sum(c.debt), 0) as customer_debt_total
    from public.pos_customers c
    where c.license_id = v_license_id
      and c.deleted_at is null
      and (p_customer_id is null or c.id = p_customer_id)
  ), inventory_agg as (
    select coalesce(sum(m.quantity) filter (where m.movement_type = 'sale_out'), 0) as inventory_sale_out_quantity,
           coalesce(sum(m.quantity) filter (where m.movement_type = 'return_in'), 0) as inventory_return_in_quantity,
           coalesce(sum(m.quantity) filter (where m.movement_type = 'sale_out'), 0) - coalesce(sum(m.quantity) filter (where m.movement_type = 'return_in'), 0) as inventory_net_out_quantity,
           coalesce(sum(m.total_cost) filter (where m.movement_type = 'sale_out'), 0) as inventory_sale_out_cost,
           coalesce(sum(m.total_cost) filter (where m.movement_type = 'return_in'), 0) as inventory_return_in_cost,
           coalesce(sum(m.total_cost) filter (where m.movement_type = 'sale_out'), 0) - coalesce(sum(m.total_cost) filter (where m.movement_type = 'return_in'), 0) as inventory_net_cogs
    from public.pos_inventory_movements m
    left join public.pos_sales s on s.license_id = m.license_id and s.id = m.sale_id
    where m.license_id = v_license_id
      and m.created_at >= v_from and m.created_at < v_to
      and (v_staff_filter is null or m.actor_staff_user_id = v_staff_filter)
      and (p_device_id is null or m.actor_device_id = p_device_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or m.actor_device_id = v_context_device_id)
      and (p_product_id is null or m.product_id = p_product_id)
      and (p_cash_session_id is null or s.cash_session_id = p_cash_session_id)
      and (p_customer_id is null or s.customer_id = p_customer_id)
      and (p_category_id is null or exists (
        select 1 from public.pos_sale_items i
        where i.license_id = m.license_id and i.id = m.sale_item_id and i.category_id = p_category_id
      ))
  ), product_inventory_agg as (
    select count(*) filter (where p.is_active is true and p.track_stock is true and available_stock <= 0)::integer as products_without_stock,
           count(*) filter (where p.is_active is true and p.track_stock is true and available_stock > 0 and p.min_stock is not null and available_stock <= p.min_stock)::integer as low_stock_products,
           coalesce(sum(inventory_value), 0) as inventory_value_approx
    from (
      select p.id, p.is_active, p.track_stock, p.min_stock,
             case when bs.active_batches > 0 then bs.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end as available_stock,
             case when bs.active_batches > 0 then bs.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end as inventory_value
      from public.pos_products p
      left join lateral (
        select count(b.id) filter (where b.deleted_at is null and b.is_active is true) as active_batches,
               coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_stock,
               coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_value
        from public.pos_product_batches b
        where b.license_id = p.license_id and b.product_id = p.id
      ) bs on true
      where p.license_id = v_license_id
        and p.deleted_at is null
        and (p_product_id is null or p.id = p_product_id)
        and (p_category_id is null or p.category_id = p_category_id)
    ) p
  ), cash_agg as (
    select coalesce(sum(m.amount) filter (where m.type in ('venta','venta_efectivo')), 0) as cash_sales_movements_total,
           coalesce(sum(m.amount) filter (where m.type = 'abono_cliente' and m.sale_id is not null), 0) as cash_credit_initial_payments_total,
           coalesce(sum(m.amount) filter (where m.type = 'abono_cliente' and m.sale_id is null), 0) as cash_customer_payments_total,
           coalesce(sum(m.amount) filter (where m.type in ('cancelacion','cancelacion_venta','cancelacion_abono_inicial')), 0) as cash_cancellations_total,
           coalesce(sum(m.amount) filter (where m.type in ('cancelacion','cancelacion_venta','cancelacion_abono_inicial')), 0) as cash_reversal_total
    from public.pos_cash_movements m
    where m.license_id = v_license_id
      and m.deleted_at is null
      and m.created_at >= v_from and m.created_at < v_to
      and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
      and (p_device_id is null or m.device_id = p_device_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or m.device_id = v_context_device_id)
      and (p_cash_session_id is null or m.cash_session_id = p_cash_session_id)
  ), cash_session_agg as (
    select coalesce(sum(s.expected_cash_total), 0) as expected_cash_total,
           coalesce(sum(s.closing_counted_amount), 0) as actual_cash_total,
           coalesce(sum(s.cash_difference), 0) as cash_difference
    from public.pos_cash_sessions s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.opened_at >= v_from and s.opened_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and (p_device_id is null or s.device_id = p_device_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or s.device_id = v_context_device_id)
      and (p_cash_session_id is null or s.id = p_cash_session_id)
  )
  select jsonb_build_object(
    'gross_sales_total', g.gross_sales_total,
    'gross_sales_count', g.gross_sales_count,
    'cancelled_sales_total', ca.cancelled_sales_total,
    'cancelled_sales_count', ca.cancelled_sales_count,
    'net_sales_total', n.net_sales_total,
    'net_sales_count', n.net_sales_count,
    'cash_sales_total', p.cash_sales_total,
    'card_sales_total', p.card_sales_total,
    'transfer_sales_total', p.transfer_sales_total,
    'credit_sales_total', p.credit_sales_total,
    'mixed_sales_total', p.mixed_sales_total,
    'cash_reversal_total', ch.cash_reversal_total,
    'credit_reversal_total', cr.credit_cancellations_total,
    'inventory_return_quantity', ia.inventory_return_in_quantity,
    'cogs_total', co.cogs_total,
    'cogs_missing_count', co.cogs_missing_count,
    'cogs_missing_sales_total', co.cogs_missing_sales_total,
    'gross_profit_total', n.net_sales_total - co.cogs_total,
    'gross_margin_percent', case when n.net_sales_total > 0 then round(((n.net_sales_total - co.cogs_total) / n.net_sales_total) * 100, 2) else 0 end,
    'profit_status', case when co.cogs_missing_count > 0 then 'incomplete' when co.item_count = 0 or co.inventory_cost_count = co.item_count then 'definitive' else 'estimated' end,
    'credit_created_total', cr.credit_created_total,
    'credit_initial_payments_total', cr.credit_initial_payments_total,
    'credit_balance_created_total', cr.credit_balance_created_total,
    'credit_charges_total', cr.credit_charges_total,
    'credit_payments_total', cr.credit_payments_total,
    'credit_cancellations_total', cr.credit_cancellations_total,
    'customers_with_debt', d.customers_with_debt,
    'customer_debt_total', d.customer_debt_total,
    'inventory_sale_out_quantity', ia.inventory_sale_out_quantity,
    'inventory_return_in_quantity', ia.inventory_return_in_quantity,
    'inventory_net_out_quantity', ia.inventory_net_out_quantity,
    'inventory_sale_out_cost', ia.inventory_sale_out_cost,
    'inventory_return_in_cost', ia.inventory_return_in_cost,
    'inventory_net_cogs', ia.inventory_net_cogs,
    'products_without_stock', pi.products_without_stock,
    'low_stock_products', pi.low_stock_products,
    'inventory_value_approx', pi.inventory_value_approx,
    'average_ticket', n.average_ticket,
    'products_sold_count', co.products_sold_count,
    'items_sold_quantity', co.items_sold_quantity,
    'cash_sales_movements_total', ch.cash_sales_movements_total,
    'cash_credit_initial_payments_total', ch.cash_credit_initial_payments_total,
    'cash_customer_payments_total', ch.cash_customer_payments_total,
    'cash_cancellations_total', ch.cash_cancellations_total,
    'expected_cash_total', cs.expected_cash_total,
    'actual_cash_total', cs.actual_cash_total,
    'cash_difference', cs.cash_difference
  ),
  case when co.cogs_missing_count > 0 then 'incomplete' when co.item_count = 0 or co.inventory_cost_count = co.item_count then 'definitive' else 'estimated' end
  into v_overview, v_profit_status
  from gross_agg g, cancelled_agg ca, net_agg n, payment_agg p, cost_agg co, credit_agg cr, debt_agg d, inventory_agg ia, product_inventory_agg pi, cash_agg ch, cash_session_agg cs;

  with filtered_sales as (
    select s.*
    from public.pos_sales s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.sold_at >= v_from and s.sold_at < v_to
      and s.source_mode = 'cloud_committed'
      and (s.status in ('closed','cancelled') or s.cancelled_at is not null)
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and (p_device_id is null or s.device_id = p_device_id)
      and (v_scope not in ('mine','self') or v_own_staff is not null or s.device_id = v_context_device_id)
      and (p_cash_session_id is null or s.cash_session_id = p_cash_session_id)
      and (p_customer_id is null or s.customer_id = p_customer_id)
      and (p_product_id is null or exists (select 1 from public.pos_sale_items i where i.license_id = s.license_id and i.sale_id = s.id and i.product_id = p_product_id))
      and (p_category_id is null or exists (select 1 from public.pos_sale_items i where i.license_id = s.license_id and i.sale_id = s.id and i.category_id = p_category_id))
  ), payment_rows as (
    select p.sale_id, private.sales_final_payment_family(p.method) as family, p.amount
    from public.pos_sale_payments p
    join filtered_sales s on s.license_id = p.license_id and s.id = p.sale_id
    where p.license_id = v_license_id
  )
  select jsonb_build_object(
    'by_date', coalesce((
      select jsonb_agg(jsonb_build_object('date', day, 'gross_total', gross_total, 'net_total', net_total, 'cancelled_total', cancelled_total, 'sales_count', sales_count) order by day)
      from (
        select date_trunc('day', sold_at)::date as day,
               sum(total) as gross_total,
               sum(total) filter (where status = 'closed' and cancelled_at is null) as net_total,
               sum(total) filter (where status = 'cancelled' or cancelled_at is not null) as cancelled_total,
               count(*)::integer as sales_count
        from filtered_sales group by 1
      ) x
    ), '[]'::jsonb),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object('staff_user_id', staff_user_id, 'actor_name', actor_name, 'gross_total', gross_total, 'net_total', net_total, 'cancelled_total', cancelled_total, 'sales_count', sales_count) order by net_total desc nulls last)
      from (
        select staff_user_id, coalesce(actor_name, 'Admin / dispositivo') as actor_name,
               sum(total) gross_total,
               sum(total) filter (where status = 'closed' and cancelled_at is null) net_total,
               sum(total) filter (where status = 'cancelled' or cancelled_at is not null) cancelled_total,
               count(*)::integer sales_count
        from filtered_sales group by staff_user_id, coalesce(actor_name, 'Admin / dispositivo')
      ) x
    ), '[]'::jsonb),
    'by_device', coalesce((
      select jsonb_agg(jsonb_build_object('device_id', device_id, 'gross_total', gross_total, 'net_total', net_total, 'sales_count', sales_count) order by net_total desc nulls last)
      from (
        select device_id, sum(total) gross_total, sum(total) filter (where status = 'closed' and cancelled_at is null) net_total, count(*)::integer sales_count
        from filtered_sales group by device_id
      ) x
    ), '[]'::jsonb),
    'by_cash_session', coalesce((
      select jsonb_agg(jsonb_build_object('cash_session_id', cash_session_id, 'gross_total', gross_total, 'net_total', net_total, 'sales_count', sales_count) order by net_total desc nulls last)
      from (
        select cash_session_id, sum(total) gross_total, sum(total) filter (where status = 'closed' and cancelled_at is null) net_total, count(*)::integer sales_count
        from filtered_sales where cash_session_id is not null group by cash_session_id
      ) x
    ), '[]'::jsonb),
    'by_customer', coalesce((
      select jsonb_agg(jsonb_build_object('customer_id', customer_id, 'customer_name', customer_name, 'gross_total', gross_total, 'net_total', net_total, 'sales_count', sales_count) order by net_total desc nulls last)
      from (
        select customer_id, coalesce(customer_name, 'Publico general') customer_name, sum(total) gross_total, sum(total) filter (where status = 'closed' and cancelled_at is null) net_total, count(*)::integer sales_count
        from filtered_sales group by customer_id, coalesce(customer_name, 'Publico general') order by net_total desc nulls last limit 50
      ) x
    ), '[]'::jsonb),
    'by_payment_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', family, 'total', total, 'count', rows_count) order by total desc)
      from (select family, sum(amount) total, count(*)::integer rows_count from payment_rows group by family) x
    ), '[]'::jsonb),
    'by_product', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', product_id, 'product_name', product_name, 'quantity', quantity, 'total', total) order by total desc)
      from (
        select i.product_id, coalesce(i.product_name, 'Producto sin nombre') product_name, sum(i.quantity) quantity, sum(i.line_total) total
        from public.pos_sale_items i join filtered_sales s on s.license_id = i.license_id and s.id = i.sale_id
        where s.status = 'closed' and s.cancelled_at is null and (p_product_id is null or i.product_id = p_product_id) and (p_category_id is null or i.category_id = p_category_id)
        group by i.product_id, coalesce(i.product_name, 'Producto sin nombre') order by total desc limit 50
      ) x
    ), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', category_id, 'category_name', category_name, 'quantity', quantity, 'total', total) order by total desc)
      from (
        select i.category_id, coalesce(i.category_name, 'Sin categoria') category_name, sum(i.quantity) quantity, sum(i.line_total) total
        from public.pos_sale_items i join filtered_sales s on s.license_id = i.license_id and s.id = i.sale_id
        where s.status = 'closed' and s.cancelled_at is null and (p_product_id is null or i.product_id = p_product_id) and (p_category_id is null or i.category_id = p_category_id)
        group by i.category_id, coalesce(i.category_name, 'Sin categoria') order by total desc limit 50
      ) x
    ), '[]'::jsonb)
  ) into v_breakdowns;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', v_scope,
    'overview', coalesce(v_overview, '{}'::jsonb),
    'breakdowns', coalesce(v_breakdowns, '{}'::jsonb),
    'source', private.sales_final_source_metadata(v_profit_status, false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.pos_get_sales_profit_report(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope text DEFAULT 'mine'::text, p_staff_user_id uuid DEFAULT NULL::uuid, p_product_id text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_get_sales_profit_report',
          p_scope := 'POS_READ_HEAVY',
          p_max_attempts := 30,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'REPORT_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_get_sales_profit_report_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)::jsonb;
      END;
      $function$;

CREATE OR REPLACE FUNCTION public.pos_get_sales_profit_report_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope text DEFAULT 'mine'::text, p_staff_user_id uuid DEFAULT NULL::uuid, p_product_id text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_profit_status text := 'definitive';
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_reports_final_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_own_staff := nullif(v_context->>'staff_user_id', '')::uuid;
  v_context_device_id := (v_context->>'device_id')::uuid;
  v_staff_filter := private.sales_final_scope_staff_filter(v_context, v_scope, p_staff_user_id);
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;

  with net_sales as (
    select s.*
    from public.pos_sales s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.source_mode = 'cloud_committed'
      and s.status = 'closed'
      and s.cancelled_at is null
      and s.sold_at >= v_from and s.sold_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and (v_scope not in ('mine','self') or v_own_staff is not null or s.device_id = v_context_device_id)
  ), item_costs as (
    select s.id as sale_id,
           coalesce(s.cloud_folio, s.folio, s.local_folio) as folio,
           s.sold_at,
           i.id as sale_item_id,
           i.product_id,
           coalesce(i.product_name, pr.name) as product_name,
           i.category_id,
           i.quantity,
           i.line_total,
           i.unit_cost,
           im.movement_cost,
           case when im.has_movement_cost then coalesce(im.movement_cost, 0)
                when i.unit_cost is not null then coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)
                else null end as cogs,
           case when im.has_movement_cost then 'inventory_movement'
                when i.unit_cost is not null then 'sale_item_snapshot'
                else 'missing' end as cost_source
    from public.pos_sale_items i
    join net_sales s on s.license_id = i.license_id and s.id = i.sale_id
    left join public.pos_products pr on pr.license_id = i.license_id and pr.id = i.product_id
    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true
    where i.license_id = v_license_id
      and (p_product_id is null or i.product_id = p_product_id)
      and (p_category_id is null or i.category_id = p_category_id)
  ), page_rows as (
    select * from item_costs
    order by sold_at desc, sale_id desc, sale_item_id asc
    limit v_limit offset v_offset
  )
  select
    coalesce((select count(*) from item_costs), 0),
    coalesce((select case when count(*) filter (where cost_source = 'missing') > 0 then 'incomplete'
                          when count(*) = 0 or count(*) filter (where cost_source = 'inventory_movement') = count(*) then 'definitive'
                          else 'estimated' end from item_costs), 'definitive'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sale_id', sale_id,
        'sale_item_id', sale_item_id,
        'folio', folio,
        'sold_at', sold_at,
        'product_id', product_id,
        'product_name', product_name,
        'quantity', quantity,
        'line_total', line_total,
        'unit_cost', unit_cost,
        'movement_cost', movement_cost,
        'cogs', coalesce(cogs, 0),
        'gross_profit', line_total - coalesce(cogs, 0),
        'gross_margin_percent', case when line_total > 0 then round(((line_total - coalesce(cogs, 0)) / line_total) * 100, 2) else 0 end,
        'cost_source', cost_source,
        'profit_status', case when cost_source = 'inventory_movement' then 'definitive' when cost_source = 'sale_item_snapshot' then 'estimated' else 'incomplete' end
      ) order by sold_at desc, sale_id desc, sale_item_id asc)
      from page_rows
    ), '[]'::jsonb)
  into v_total_count, v_profit_status, v_rows;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', v_scope,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_total_count > (v_offset + v_limit),
    'profit_status', v_profit_status,
    'source', private.sales_final_source_metadata(v_profit_status, false)
  );
end;
$function$;

-- Restore the real report RPC execution boundary in the disposable database.
revoke all on function public.pos_get_sales_final_overview_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text),
  public.pos_get_sales_profit_report_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.pos_get_sales_final_overview_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text),
  public.pos_get_sales_profit_report_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,text,text,integer,integer)
  to service_role;
revoke all on function public.pos_get_sales_final_overview(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text),
  public.pos_get_sales_profit_report(text,text,text,text,timestamptz,timestamptz,text,uuid,text,text,integer,integer)
  from public;
grant execute on function public.pos_get_sales_final_overview(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text),
  public.pos_get_sales_profit_report(text,text,text,text,timestamptz,timestamptz,text,uuid,text,text,integer,integer)
  to anon, authenticated, service_role;
