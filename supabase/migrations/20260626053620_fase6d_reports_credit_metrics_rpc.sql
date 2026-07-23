create or replace function public.pos_get_reports_credit_overview(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_date_from timestamp with time zone default null,
  p_date_to timestamp with time zone default null,
  p_scope text default 'license'
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
  v_overview jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_cloud_sales_credit_enabled(v_context);

  if not private.reports_scope_allowed(v_context, p_scope) then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_range := private.reports_date_range(p_date_from, p_date_to);
  v_from := (v_range->>'date_from')::timestamptz;
  v_to := (v_range->>'date_to')::timestamptz;
  v_staff_filter := private.reports_staff_filter(v_context, null);

  select jsonb_build_object(
    'cloud_credit_sales_total', coalesce(sum(s.total) filter (where s.credit_effect_status = 'applied' and s.balance_due > 0), 0),
    'cloud_credit_sales_count', count(*) filter (where s.credit_effect_status = 'applied' and s.balance_due > 0)::integer,
    'cloud_credit_balance_created', coalesce(sum(s.balance_due) filter (where s.credit_effect_status = 'applied' and s.balance_due > 0), 0),
    'cloud_credit_initial_payments_total', coalesce(sum(s.amount_paid) filter (where s.credit_effect_status = 'applied' and s.balance_due > 0), 0),
    'customers_with_debt', coalesce((select count(*)::integer from public.pos_customers c where c.license_id = v_license_id and c.deleted_at is null and c.debt_cents > 0), 0),
    'debt_total', coalesce((select sum(c.debt) from public.pos_customers c where c.license_id = v_license_id and c.deleted_at is null), 0),
    'payments_period', coalesce((select sum(abs(l.amount)) from public.pos_customer_ledger l where l.license_id = v_license_id and l.deleted_at is null and l.type = 'PAYMENT' and l.created_at >= v_from and l.created_at < v_to and (v_staff_filter is null or l.actor_staff_user_id = v_staff_filter)), 0)
  ) into v_overview
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
    'overview', coalesce(v_overview, '{}'::jsonb),
    'source', 'cloud_credit_6d'
  );
end;
$function$;

grant execute on function public.pos_get_reports_credit_overview(text, text, text, text, timestamp with time zone, timestamp with time zone, text) to anon, authenticated;;
