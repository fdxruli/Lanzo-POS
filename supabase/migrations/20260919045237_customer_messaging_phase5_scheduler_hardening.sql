-- Phase 5 hardening: scheduled reminders must not run for inactive or expired
-- licenses. The scheduler only prepares work; it never calls a provider.
create or replace function private.run_customer_message_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_processed integer := 0;
  v_enabled boolean;
begin
  for v_row in
    select r.id, r.license_id, r.customer_id, r.status, r.scheduled_for,
           c.debt, coalesce((p.features || l.features)->>'cloud_pos_sync', 'false')::boolean as cloud_enabled,
           coalesce(cfg.enabled, false) as config_enabled
    from public.customer_message_reminders r
    join public.pos_customers c on c.license_id = r.license_id and c.id = r.customer_id
    join public.licenses l on l.id = r.license_id
    left join public.plans p on p.id = l.plan_id
    left join public.customer_message_reminder_configs cfg on cfg.license_id = r.license_id and cfg.event_type = r.event_type
    where r.status = 'programado' and r.scheduled_for <= now()
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at >= now())
    order by r.scheduled_for
    for update of r skip locked
  loop
    v_enabled := v_row.cloud_enabled and v_row.config_enabled;
    update public.customer_message_reminders
    set status = case when v_enabled and coalesce(v_row.debt, 0) > 0 then 'listo_para_preparar' else 'cancelado' end,
        cancelled_at = case when not (v_enabled and coalesce(v_row.debt, 0) > 0) then coalesce(cancelled_at, now()) else null end,
        last_error_code = case when not v_enabled then 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' when coalesce(v_row.debt, 0) <= 0 then 'REMINDER_CUSTOMER_NOT_PENDING' else null end
    where id = v_row.id;
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$function$;

revoke all on function private.run_customer_message_reminders() from public, anon, authenticated, service_role;
