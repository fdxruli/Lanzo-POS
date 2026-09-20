-- Customer messaging scheduler eligibility must follow the canonical license
-- entitlement contract. This migration is required because the deployed Phase
-- 5 scheduler filtered licenses.expires_at directly, which incorrectly skipped
-- licenses whose canonical lifecycle was still grace_period.
do $preflight$
begin
  if to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
    raise exception 'CUSTOMER_MESSAGE_PHASE5_LICENSE_ENTITLEMENT_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create or replace function private.run_customer_message_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_processed integer := 0;
  v_cloud_enabled boolean;
  v_eligible boolean;
begin
  for v_row in
    select
      r.id,
      r.license_id,
      r.customer_id,
      r.status,
      r.scheduled_for,
      c.debt,
      entitlement.lifecycle_state,
      entitlement.is_entitled,
      entitlement.plan_code,
      entitlement.effective_features,
      coalesce(cfg.enabled, false) as config_enabled
    from public.customer_message_reminders r
    join public.pos_customers c
      on c.license_id = r.license_id
     and c.id = r.customer_id
    join public.licenses l
      on l.id = r.license_id
    cross join lateral private.license_entitlement_state_v1(l.id) entitlement
    left join public.customer_message_reminder_configs cfg
      on cfg.license_id = r.license_id
     and cfg.event_type = r.event_type
    where r.status = 'programado'
      and (
        r.scheduled_for <= now()
        or entitlement.is_entitled is not true
        or coalesce((entitlement.effective_features->>'cloud_pos_sync')::boolean, false) is not true
        or coalesce(cfg.enabled, false) is not true
        or coalesce(c.debt, 0) <= 0
      )
    order by r.scheduled_for
    for update of r skip locked
  loop
    v_cloud_enabled := coalesce(
      (v_row.effective_features->>'cloud_pos_sync')::boolean,
      false
    );
    v_eligible := coalesce(v_row.is_entitled, false)
      and v_cloud_enabled
      and coalesce(v_row.config_enabled, false);

    update public.customer_message_reminders
       set status = case
         when v_eligible
           and coalesce(v_row.debt, 0) > 0
           and v_row.scheduled_for <= now()
           then 'listo_para_preparar'
         else 'cancelado'
       end,
       cancelled_at = case
         when not (v_eligible and coalesce(v_row.debt, 0) > 0)
           then coalesce(cancelled_at, now())
         else null
       end,
       last_error_code = case
         when coalesce(v_row.is_entitled, false) is not true then
           case v_row.lifecycle_state
             when 'expired' then 'LICENSE_EXPIRED'
             when 'administratively_blocked' then 'LICENSE_NOT_ACTIVE'
             else 'LICENSE_NOT_ENTITLED'
           end
         when v_cloud_enabled is not true then 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE'
         when coalesce(v_row.config_enabled, false) is not true then 'REMINDER_CONFIG_DISABLED'
         when coalesce(v_row.debt, 0) <= 0 then 'REMINDER_CUSTOMER_NOT_PENDING'
         else null
       end
     where id = v_row.id;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$function$;

revoke all on function private.run_customer_message_reminders()
  from public, anon, authenticated, service_role;
