-- Fix FASE 5 report exports pagination.
-- public.pos_export_report_data kept the same public signature/response shape,
-- but each branch now filters/orders/limits rows before jsonb_agg.

create or replace function public.pos_export_report_data(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_report_type text default 'cash_movements',
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 1000,
  p_offset integer default 0
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
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  if p_report_type = 'cash_movements' then
    perform private.assert_cloud_cash_sync_enabled(v_context);

    select coalesce(jsonb_agg(row_payload order by sort_created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'id', m.id,
        'cash_session_id', m.cash_session_id,
        'type', m.type,
        'amount', m.amount,
        'concept', m.concept,
        'actor_name', m.actor_name,
        'staff_user_id', m.staff_user_id,
        'created_at', m.created_at
      ) as row_payload,
      m.created_at as sort_created_at
      from public.pos_cash_movements m
      where m.license_id = v_license_id
        and m.deleted_at is null
        and m.created_at >= v_from
        and m.created_at < v_to
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
      order by m.created_at desc
      limit v_limit offset v_offset
    ) rows;

  elsif p_report_type = 'cash_sessions' then
    perform private.assert_cloud_cash_sync_enabled(v_context);

    select coalesce(jsonb_agg(row_payload order by sort_opened_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'id', s.id,
        'status', s.status,
        'responsible_name', s.responsible_name,
        'staff_user_id', s.staff_user_id,
        'opened_at', s.opened_at,
        'closed_at', s.closed_at,
        'opening_amount', s.opening_amount,
        'expected_cash_total', s.expected_cash_total,
        'cash_difference', s.cash_difference
      ) as row_payload,
      s.opened_at as sort_opened_at
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.deleted_at is null
        and s.opened_at >= v_from
        and s.opened_at < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      order by s.opened_at desc
      limit v_limit offset v_offset
    ) rows;

  elsif p_report_type = 'customer_ledger' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);

    select coalesce(jsonb_agg(row_payload order by sort_created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'id', l.id,
        'customer_id', l.customer_id,
        'customer_name', c.name,
        'type', l.type,
        'amount', l.amount,
        'balance_after', l.balance_after,
        'payment_method', l.payment_method,
        'cash_session_id', l.cash_session_id,
        'actor_name', l.actor_name,
        'created_at', l.created_at
      ) as row_payload,
      l.created_at as sort_created_at
      from public.pos_customer_ledger l
      left join public.pos_customers c
        on c.license_id = l.license_id
       and c.id = l.customer_id
      where l.license_id = v_license_id
        and l.deleted_at is null
        and l.created_at >= v_from
        and l.created_at < v_to
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
      order by l.created_at desc
      limit v_limit offset v_offset
    ) rows;

  elsif p_report_type = 'customer_debts' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);

    select coalesce(jsonb_agg(row_payload order by sort_debt desc, sort_name asc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'customer_id', c.id,
        'name', c.name,
        'phone', c.phone,
        'debt', c.debt,
        'credit_limit', c.credit_limit,
        'over_limit', c.credit_limit > 0 and c.debt > c.credit_limit
      ) as row_payload,
      c.debt as sort_debt,
      c.name as sort_name
      from public.pos_customers c
      where c.license_id = v_license_id
        and c.deleted_at is null
      order by c.debt desc, c.name asc
      limit v_limit offset v_offset
    ) rows;

  elsif p_report_type = 'product_inventory' then
    perform private.assert_cloud_products_sync_enabled(v_context);

    with batch_summary as (
      select p.id as product_id,
             count(b.id) filter (where b.deleted_at is null and b.is_active is true) as active_batches,
             coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_stock,
             coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_value
      from public.pos_products p
      left join public.pos_product_batches b
        on b.license_id = p.license_id
       and b.product_id = p.id
      where p.license_id = v_license_id
        and p.deleted_at is null
      group by p.id
    ), paginated_products as (
      select p.id,
             p.name,
             p.category_id,
             p.stock,
             p.committed_stock,
             p.cost,
             bs.active_batches,
             bs.batch_stock,
             bs.batch_value
      from public.pos_products p
      join batch_summary bs on bs.product_id = p.id
      where p.license_id = v_license_id
        and p.deleted_at is null
      order by p.name asc
      limit v_limit offset v_offset
    )
    select coalesce(jsonb_agg(row_payload order by sort_name asc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'category_id', p.category_id,
        'stock', case when p.active_batches > 0 then p.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end,
        'cost', p.cost,
        'inventory_value_approx', case when p.active_batches > 0 then p.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end
      ) as row_payload,
      p.name as sort_name
      from paginated_products p
    ) rows;

  else
    raise exception 'REPORT_EXPORT_TYPE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'report_type', p_report_type,
    'date_range', v_range,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'source', private.reports_source_metadata('cloud')
  );
end;
$function$;
