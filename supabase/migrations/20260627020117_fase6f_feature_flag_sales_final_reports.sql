-- FASE 6F - Feature flag final de reportes de ventas cloud
update public.plans
set features = jsonb_set(coalesce(features, '{}'::jsonb), '{cloud_sales_reports_final}', 'true'::jsonb, true)
where code = 'pro_monthly';

update public.plans
set features = jsonb_set(coalesce(features, '{}'::jsonb), '{cloud_sales_reports_final}', 'false'::jsonb, true)
where code in ('free_trial', 'basic_monthly');

create or replace function private.assert_cloud_sales_reports_final_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_cloud_reports_sync_enabled(p_context);
  perform private.assert_cloud_sales_cashier_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_reports_final')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_REPORTS_FINAL_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;;
