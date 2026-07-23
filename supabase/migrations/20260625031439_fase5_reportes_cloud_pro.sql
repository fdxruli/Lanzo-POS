-- FASE 5 — Reportes cloud PRO
-- Reportes cloud oficiales para clientes, catalogo, caja y credito.
-- Ventas siguen fuera de cloud y se reportan como fuente local/mixta desde frontend.

-- 1) Feature flag: solo PRO.
update public.plans
set features = jsonb_set(
  coalesce(features, '{}'::jsonb),
  '{cloud_reports_sync}',
  to_jsonb(code = 'pro_monthly'),
  true
)
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

-- 2) Helpers privados.
create or replace function private.safe_numeric(value numeric)
returns numeric
language sql
immutable
set search_path to ''
as $$
  select coalesce($1, 0::numeric)
$$;

create or replace function private.reports_is_admin(p_context jsonb)
returns boolean
language sql
stable
set search_path to ''
as $$
  select coalesce($1->>'device_role', 'staff') <> 'staff'
$$;

create or replace function private.reports_has_permission(p_context jsonb, p_permission text)
returns boolean
language sql
stable
set search_path to ''
as $$
  select coalesce(($1->'staff_permissions'->>$2)::boolean, false)
$$;

create or replace function private.reports_allowed(p_context jsonb)
returns boolean
language sql
stable
set search_path to ''
as $$
  select private.reports_is_admin($1)
    or private.reports_has_permission($1, 'reportes')
    or private.reports_has_permission($1, 'reports')
$$;

create or replace function private.reports_audit_allowed(p_context jsonb)
returns boolean
language sql
stable
set search_path to ''
as $$
  select private.reports_is_admin($1)
    or private.reports_has_permission($1, 'reportes_globales')
    or private.reports_has_permission($1, 'reports_global')
    or private.reports_has_permission($1, 'caja_auditoria')
    or private.reports_has_permission($1, 'cash_audit')
$$;

create or replace function private.assert_cloud_reports_sync_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_reports_sync')::boolean, false) is not true then
    raise exception 'CLOUD_REPORTS_SYNC_DISABLED' using errcode = 'P0001';
  end if;

  if not private.reports_allowed(p_context) then
    raise exception 'REPORTS_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.reports_date_range(p_date_from timestamptz, p_date_to timestamptz)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
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
$$;

create or replace function private.reports_scope_allowed(p_context jsonb, scope text)
returns boolean
language sql
stable
set search_path to ''
as $$
  select case
    when coalesce($2, 'license') in ('mine', 'self') then true
    when coalesce($2, 'license') in ('license', 'all', 'staff') then private.reports_audit_allowed($1)
    else false
  end
$$;

create or replace function private.reports_staff_filter(p_context jsonb, requested_staff uuid)
returns uuid
language plpgsql
stable
set search_path to ''
as $$
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
$$;

create or replace function private.reports_source_metadata(p_mode text default 'cloud')
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object(
    'mode', coalesce($1, 'cloud'),
    'official', jsonb_build_array('cash', 'customer_credit', 'customers', 'products'),
    'local', jsonb_build_array('sales', 'waste'),
    'warnings', jsonb_build_array(
      'Ventas cloud completas aun no estan implementadas. Ventas, utilidad real e historial se calculan localmente en este dispositivo.',
      'El valor de inventario es aproximado desde catalogo/lotes cloud; no es utilidad real.'
    )
  )
$$;

-- 3) Indices ligeros para consultas de reportes.
create index if not exists idx_pos_reports_customers_license_debt
  on public.pos_customers (license_id, deleted_at, debt_cents);
create index if not exists idx_pos_reports_ledger_license_created_type
  on public.pos_customer_ledger (license_id, created_at, type)
  where deleted_at is null;
create index if not exists idx_pos_reports_ledger_license_staff_created
  on public.pos_customer_ledger (license_id, actor_staff_user_id, created_at)
  where deleted_at is null;
create index if not exists idx_pos_reports_cash_sessions_license_opened
  on public.pos_cash_sessions (license_id, opened_at, status)
  where deleted_at is null;
create index if not exists idx_pos_reports_cash_sessions_license_staff_opened
  on public.pos_cash_sessions (license_id, staff_user_id, opened_at)
  where deleted_at is null;
create index if not exists idx_pos_reports_cash_movements_license_created_type
  on public.pos_cash_movements (license_id, created_at, type)
  where deleted_at is null;
create index if not exists idx_pos_reports_cash_movements_license_staff_created
  on public.pos_cash_movements (license_id, staff_user_id, created_at)
  where deleted_at is null;
create index if not exists idx_pos_reports_products_license_status
  on public.pos_products (license_id, deleted_at, is_active, track_stock);
create index if not exists idx_pos_reports_batches_license_status
  on public.pos_product_batches (license_id, deleted_at, product_id, is_active, stock);

-- 4) RPC overview.
create or replace function public.pos_get_reports_overview(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_scope text default 'license'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'scope', coalesce(p_scope, 'license'),
    'overview', v_customers || v_cash || v_products,
    'source', private.reports_source_metadata('cloud'),
    'data_sources', private.reports_source_metadata('cloud'),
    'warnings', private.reports_source_metadata('cloud')->'warnings'
  );
end;
$$;

-- 5) RPC cash report.
create or replace function public.pos_get_cash_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_staff_user_id uuid default null,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_staff_filter uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sessions jsonb;
  v_by_staff jsonb;
  v_by_device jsonb;
  v_by_type jsonb;
  v_summary jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, p_staff_user_id);

  select coalesce(jsonb_agg(row_payload order by opened_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select
      s.opened_at,
      private.pos_cash_session_to_jsonb(s)
      || jsonb_build_object(
        'staff_display_name', lsu.display_name,
        'staff_username', lsu.username,
        'movement_count', coalesce(m.movement_count, 0),
        'source', 'cloud_official'
      ) as row_payload
    from public.pos_cash_sessions s
    left join public.license_staff_users lsu on lsu.id = s.staff_user_id
    left join lateral (
      select count(*)::integer as movement_count
      from public.pos_cash_movements m
      where m.license_id = s.license_id and m.cash_session_id = s.id and m.deleted_at is null
    ) m on true
    where s.license_id = v_license_id
      and s.deleted_at is null
      and (p_status is null or s.status = p_status)
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      and s.opened_at >= v_from and s.opened_at < v_to
    order by s.opened_at desc
    limit v_limit offset v_offset
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_user_id', staff_user_id,
    'staff_name', staff_name,
    'sessions', sessions,
    'entries', entries,
    'exits', exits,
    'customer_payments', customer_payments,
    'differences', differences
  ) order by staff_name nulls last), '[]'::jsonb)
  into v_by_staff
  from (
    select
      s.staff_user_id,
      coalesce(lsu.display_name, s.responsible_name, 'Admin / dispositivo') as staff_name,
      count(*)::integer as sessions,
      sum(coalesce(s.cash_entries_total,0)) as entries,
      sum(coalesce(s.cash_exits_total,0)) as exits,
      sum(coalesce(s.customer_payments_total,0)) as customer_payments,
      sum(coalesce(s.cash_difference,0)) as differences
    from public.pos_cash_sessions s
    left join public.license_staff_users lsu on lsu.id = s.staff_user_id
    where s.license_id = v_license_id and s.deleted_at is null
      and s.opened_at >= v_from and s.opened_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    group by s.staff_user_id, coalesce(lsu.display_name, s.responsible_name, 'Admin / dispositivo')
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', device_id,
    'sessions', sessions,
    'entries', entries,
    'exits', exits,
    'customer_payments', customer_payments,
    'differences', differences
  ) order by sessions desc), '[]'::jsonb)
  into v_by_device
  from (
    select
      s.device_id,
      count(*)::integer as sessions,
      sum(coalesce(s.cash_entries_total,0)) as entries,
      sum(coalesce(s.cash_exits_total,0)) as exits,
      sum(coalesce(s.customer_payments_total,0)) as customer_payments,
      sum(coalesce(s.cash_difference,0)) as differences
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.deleted_at is null
      and s.opened_at >= v_from and s.opened_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    group by s.device_id
  ) x;

  select coalesce(jsonb_object_agg(type, total), '{}'::jsonb)
  into v_by_type
  from (
    select m.type, sum(m.amount) as total
    from public.pos_cash_movements m
    where m.license_id = v_license_id and m.deleted_at is null
      and m.created_at >= v_from and m.created_at < v_to
      and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    group by m.type
  ) x;

  select jsonb_build_object(
    'open_sessions', count(*) filter (where status = 'open')::integer,
    'closed_sessions', count(*) filter (where status = 'closed')::integer,
    'entries', coalesce(sum(cash_entries_total), 0),
    'exits', coalesce(sum(cash_exits_total), 0),
    'customer_payments', coalesce(sum(customer_payments_total), 0),
    'cash_difference', coalesce(sum(cash_difference), 0),
    'movement_types', coalesce(v_by_type, '{}'::jsonb)
  )
  into v_summary
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.deleted_at is null
    and s.opened_at >= v_from and s.opened_at < v_to
    and (v_staff_filter is null or s.staff_user_id = v_staff_filter);

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'summary', v_summary,
    'sessions', v_sessions,
    'totals_by_staff', v_by_staff,
    'totals_by_device', v_by_device,
    'movements_by_type', coalesce(v_by_type, '{}'::jsonb),
    'source', private.reports_source_metadata('cloud')
  );
end;
$$;

-- 6) RPC customer credit report.
create or replace function public.pos_get_customer_credit_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_customer_id text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_staff_filter uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_summary jsonb;
  v_top_debtors jsonb;
  v_ledger_by_type jsonb;
  v_payments_by_staff jsonb;
  v_payments_by_cash jsonb;
  v_ledger jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  select jsonb_build_object(
    'debt_total', coalesce(sum(c.debt), 0),
    'customers_total', count(*)::integer,
    'customers_with_debt', count(*) filter (where c.debt_cents > 0)::integer,
    'customers_without_debt', count(*) filter (where c.debt_cents <= 0)::integer,
    'customers_over_limit', count(*) filter (where c.credit_limit > 0 and c.debt > c.credit_limit)::integer,
    'payments_period', coalesce((
      select sum(abs(l.amount)) from public.pos_customer_ledger l
      where l.license_id = v_license_id and l.deleted_at is null and l.type = 'PAYMENT'
        and l.created_at >= v_from and l.created_at < v_to
        and (p_customer_id is null or l.customer_id = p_customer_id)
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    ), 0)
  ) into v_summary
  from public.pos_customers c
  where c.license_id = v_license_id and c.deleted_at is null
    and (p_customer_id is null or c.id = p_customer_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', id,
    'name', name,
    'phone', phone,
    'debt', debt,
    'credit_limit', credit_limit,
    'over_limit', credit_limit > 0 and debt > credit_limit
  ) order by debt desc), '[]'::jsonb)
  into v_top_debtors
  from (
    select id, name, phone, debt, credit_limit
    from public.pos_customers
    where license_id = v_license_id and deleted_at is null and debt_cents > 0
      and (p_customer_id is null or id = p_customer_id)
    order by debt desc
    limit least(v_limit, 50)
  ) d;

  select coalesce(jsonb_object_agg(type, jsonb_build_object('count', rows_count, 'total', total)), '{}'::jsonb)
  into v_ledger_by_type
  from (
    select l.type, count(*)::integer rows_count, sum(l.amount) total
    from public.pos_customer_ledger l
    where l.license_id = v_license_id and l.deleted_at is null
      and l.created_at >= v_from and l.created_at < v_to
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    group by l.type
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_user_id', staff_user_id,
    'staff_name', staff_name,
    'payments', payments,
    'total', total
  ) order by total desc), '[]'::jsonb)
  into v_payments_by_staff
  from (
    select
      l.actor_staff_user_id as staff_user_id,
      coalesce(s.display_name, l.actor_name, 'Admin / dispositivo') as staff_name,
      count(*)::integer as payments,
      sum(abs(l.amount)) as total
    from public.pos_customer_ledger l
    left join public.license_staff_users s on s.id = l.actor_staff_user_id
    where l.license_id = v_license_id and l.deleted_at is null and l.type = 'PAYMENT'
      and l.created_at >= v_from and l.created_at < v_to
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    group by l.actor_staff_user_id, coalesce(s.display_name, l.actor_name, 'Admin / dispositivo')
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cash_session_id', cash_session_id,
    'payments', payments,
    'total', total
  ) order by total desc), '[]'::jsonb)
  into v_payments_by_cash
  from (
    select l.cash_session_id, count(*)::integer as payments, sum(abs(l.amount)) as total
    from public.pos_customer_ledger l
    where l.license_id = v_license_id and l.deleted_at is null and l.type = 'PAYMENT'
      and l.created_at >= v_from and l.created_at < v_to
      and l.cash_session_id is not null
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    group by l.cash_session_id
  ) x;

  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
  into v_ledger
  from (
    select l.created_at,
      private.pos_customer_ledger_to_jsonb(l)
      || jsonb_build_object('customer_name', c.name, 'source', 'cloud_official') as row_payload
    from public.pos_customer_ledger l
    left join public.pos_customers c on c.license_id = l.license_id and c.id = l.customer_id
    where l.license_id = v_license_id and l.deleted_at is null
      and l.created_at >= v_from and l.created_at < v_to
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    order by l.created_at desc
    limit v_limit offset v_offset
  ) rows;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'summary', v_summary,
    'top_debtors', v_top_debtors,
    'ledger_by_type', v_ledger_by_type,
    'payments_by_staff', v_payments_by_staff,
    'payments_by_cash', v_payments_by_cash,
    'ledger', v_ledger,
    'source', private.reports_source_metadata('cloud')
  );
end;
$$;

-- 7) RPC product catalog report.
create or replace function public.pos_get_product_catalog_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_range jsonb;
  v_products_summary jsonb;
  v_categories jsonb;
  v_lots jsonb;
  v_inventory jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_products_sync_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);

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
  ) into v_products_summary
  from product_inventory;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', c.id,
    'category_name', c.name,
    'active_products', coalesce(p.active_products, 0),
    'total_products', coalesce(p.total_products, 0)
  ) order by c.sort_order, c.name), '[]'::jsonb)
  into v_categories
  from public.pos_categories c
  left join lateral (
    select count(*)::integer as total_products,
           count(*) filter (where p.is_active is true and p.deleted_at is null)::integer as active_products
    from public.pos_products p
    where p.license_id = c.license_id and p.category_id = c.id and p.deleted_at is null
  ) p on true
  where c.license_id = v_license_id and c.deleted_at is null;

  select jsonb_build_object(
    'active_lots', count(*) filter (where is_active is true and deleted_at is null)::integer,
    'lots_without_stock', count(*) filter (where is_active is true and deleted_at is null and greatest(stock - coalesce(committed_stock, 0), 0) <= 0)::integer,
    'lots_expiring_soon', count(*) filter (where is_active is true and deleted_at is null and coalesce(alert_target_date, expiry_date) is not null and coalesce(alert_target_date, expiry_date) <= now() + interval '30 days')::integer
  ) into v_lots
  from public.pos_product_batches
  where license_id = v_license_id;

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
      p.id,
      p.name,
      p.category_id,
      p.track_stock,
      p.is_active,
      case when bs.active_batches > 0 then bs.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end as available_stock,
      case when bs.active_batches > 0 then bs.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end as inventory_value
    from public.pos_products p
    join batch_summary bs on bs.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', id,
    'name', name,
    'category_id', category_id,
    'available_stock', available_stock,
    'inventory_value_approx', inventory_value,
    'source', 'cloud_official'
  ) order by inventory_value desc), '[]'::jsonb)
  into v_inventory
  from (
    select * from product_inventory order by inventory_value desc limit v_limit offset v_offset
  ) rows;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'date_range', v_range,
    'summary', coalesce(v_products_summary, '{}'::jsonb) || coalesce(v_lots, '{}'::jsonb),
    'products_by_category', v_categories,
    'inventory', v_inventory,
    'source', private.reports_source_metadata('cloud'),
    'warnings', jsonb_build_array('Valor de inventario aproximado desde catalogo/lotes cloud. No representa utilidad real ni ventas cloud.')
  );
end;
$$;

-- 8) RPC timeseries.
create or replace function public.pos_get_report_timeseries(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_metric text default 'cash_entries',
  p_granularity text default 'day',
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_staff_filter uuid;
  v_bucket text;
  v_rows jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  if p_metric not in ('cash_entries', 'cash_exits', 'customer_payments', 'customer_debt', 'cash_difference') then
    raise exception 'REPORT_METRIC_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  v_bucket := case when p_granularity in ('day','week','month') then p_granularity else 'day' end;

  if p_metric in ('cash_entries', 'cash_exits') then
    perform private.assert_cloud_cash_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object('period', bucket, 'value', value) order by bucket), '[]'::jsonb)
    into v_rows
    from (
      select date_trunc(v_bucket, m.created_at) as bucket, sum(m.amount) as value
      from public.pos_cash_movements m
      where m.license_id = v_license_id and m.deleted_at is null
        and m.created_at >= v_from and m.created_at < v_to
        and ((p_metric = 'cash_entries' and m.type in ('entrada','ajuste_entrada'))
          or (p_metric = 'cash_exits' and m.type in ('salida','ajuste_salida')))
        and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
      group by 1
    ) x;
  elsif p_metric = 'customer_payments' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object('period', bucket, 'value', value) order by bucket), '[]'::jsonb)
    into v_rows
    from (
      select date_trunc(v_bucket, l.created_at) as bucket, sum(abs(l.amount)) as value
      from public.pos_customer_ledger l
      where l.license_id = v_license_id and l.deleted_at is null and l.type = 'PAYMENT'
        and l.created_at >= v_from and l.created_at < v_to
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
      group by 1
    ) x;
  elsif p_metric = 'customer_debt' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object('period', bucket, 'value', value) order by bucket), '[]'::jsonb)
    into v_rows
    from (
      select date_trunc(v_bucket, l.created_at) as bucket,
             sum(case when l.type = 'PAYMENT' then -abs(l.amount) else l.amount end) as value
      from public.pos_customer_ledger l
      where l.license_id = v_license_id and l.deleted_at is null
        and l.created_at >= v_from and l.created_at < v_to
        and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
      group by 1
    ) x;
  else
    perform private.assert_cloud_cash_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object('period', bucket, 'value', value) order by bucket), '[]'::jsonb)
    into v_rows
    from (
      select date_trunc(v_bucket, coalesce(s.closed_at, s.opened_at)) as bucket,
             sum(coalesce(s.cash_difference, 0)) as value
      from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.deleted_at is null and s.status = 'closed'
        and coalesce(s.closed_at, s.opened_at) >= v_from and coalesce(s.closed_at, s.opened_at) < v_to
        and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
      group by 1
    ) x;
  end if;

  return jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'metric', p_metric,
    'granularity', v_bucket,
    'date_range', v_range,
    'rows', v_rows,
    'source', private.reports_source_metadata('cloud')
  );
end;
$$;

-- 9) Export plano opcional para CSV.
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
as $$
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
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'cash_session_id', m.cash_session_id, 'type', m.type, 'amount', m.amount,
      'concept', m.concept, 'actor_name', m.actor_name, 'staff_user_id', m.staff_user_id,
      'created_at', m.created_at
    ) order by m.created_at desc), '[]'::jsonb)
    into v_rows
    from public.pos_cash_movements m
    where m.license_id = v_license_id and m.deleted_at is null
      and m.created_at >= v_from and m.created_at < v_to
      and (v_staff_filter is null or m.staff_user_id = v_staff_filter)
    limit v_limit offset v_offset;
  elsif p_report_type = 'cash_sessions' then
    perform private.assert_cloud_cash_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'status', s.status, 'responsible_name', s.responsible_name,
      'staff_user_id', s.staff_user_id, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opening_amount', s.opening_amount, 'expected_cash_total', s.expected_cash_total,
      'cash_difference', s.cash_difference
    ) order by s.opened_at desc), '[]'::jsonb)
    into v_rows
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.deleted_at is null
      and s.opened_at >= v_from and s.opened_at < v_to
      and (v_staff_filter is null or s.staff_user_id = v_staff_filter)
    limit v_limit offset v_offset;
  elsif p_report_type = 'customer_ledger' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'customer_id', l.customer_id, 'customer_name', c.name, 'type', l.type,
      'amount', l.amount, 'balance_after', l.balance_after, 'payment_method', l.payment_method,
      'cash_session_id', l.cash_session_id, 'actor_name', l.actor_name, 'created_at', l.created_at
    ) order by l.created_at desc), '[]'::jsonb)
    into v_rows
    from public.pos_customer_ledger l
    left join public.pos_customers c on c.license_id = l.license_id and c.id = l.customer_id
    where l.license_id = v_license_id and l.deleted_at is null
      and l.created_at >= v_from and l.created_at < v_to
      and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)
    limit v_limit offset v_offset;
  elsif p_report_type = 'customer_debts' then
    perform private.assert_cloud_customer_credit_sync_enabled(v_context);
    select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', c.id, 'name', c.name, 'phone', c.phone, 'debt', c.debt,
      'credit_limit', c.credit_limit, 'over_limit', c.credit_limit > 0 and c.debt > c.credit_limit
    ) order by c.debt desc), '[]'::jsonb)
    into v_rows
    from public.pos_customers c
    where c.license_id = v_license_id and c.deleted_at is null
    limit v_limit offset v_offset;
  elsif p_report_type = 'product_inventory' then
    perform private.assert_cloud_products_sync_enabled(v_context);
    with batch_summary as (
      select p.id as product_id,
             count(b.id) filter (where b.deleted_at is null and b.is_active is true) as active_batches,
             coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_stock,
             coalesce(sum(greatest(b.stock - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0)) filter (where b.deleted_at is null and b.is_active is true), 0) as batch_value
      from public.pos_products p
      left join public.pos_product_batches b on b.license_id = p.license_id and b.product_id = p.id
      where p.license_id = v_license_id and p.deleted_at is null
      group by p.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', p.id, 'name', p.name, 'category_id', p.category_id,
      'stock', case when bs.active_batches > 0 then bs.batch_stock else greatest(p.stock - coalesce(p.committed_stock, 0), 0) end,
      'cost', p.cost,
      'inventory_value_approx', case when bs.active_batches > 0 then bs.batch_value else greatest(p.stock - coalesce(p.committed_stock, 0), 0) * coalesce(p.cost, 0) end
    ) order by p.name), '[]'::jsonb)
    into v_rows
    from public.pos_products p
    join batch_summary bs on bs.product_id = p.id
    where p.license_id = v_license_id and p.deleted_at is null
    limit v_limit offset v_offset;
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
$$;

grant execute on function public.pos_get_reports_overview(text,text,text,text,timestamptz,timestamptz,text) to anon, authenticated;
grant execute on function public.pos_get_cash_report(text,text,text,text,timestamptz,timestamptz,uuid,text,integer,integer) to anon, authenticated;
grant execute on function public.pos_get_customer_credit_report(text,text,text,text,timestamptz,timestamptz,text,integer,integer) to anon, authenticated;
grant execute on function public.pos_get_product_catalog_report(text,text,text,text,timestamptz,timestamptz,integer,integer) to anon, authenticated;
grant execute on function public.pos_get_report_timeseries(text,text,text,text,text,text,timestamptz,timestamptz) to anon, authenticated;
grant execute on function public.pos_export_report_data(text,text,text,text,text,timestamptz,timestamptz,integer,integer) to anon, authenticated;;
