create or replace function public.admin_change_license_plan(
  p_license_key text,
  p_target_plan_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan public.plans%rowtype;
  v_before record;
  v_after record;
  v_now timestamptz := now();
  v_end timestamptz;
  v_duration_months integer;
  v_period_type text;
  v_is_free_target boolean := false;
  v_ai_limit integer := 0;
  v_period_id uuid;
  v_period_metadata jsonb;
  v_plan_changed_metadata jsonb;
  v_period_created_metadata jsonb;
  v_active_devices integer := 0;
  v_staff_devices integer := 0;
begin
  if nullif(trim(p_license_key),'') is null then
    return jsonb_build_object('success',false,'code','LICENSE_KEY_REQUIRED');
  end if;

  if nullif(trim(p_target_plan_code),'') is null then
    return jsonb_build_object('success',false,'code','TARGET_PLAN_REQUIRED');
  end if;

  select * into v_plan
    from public.plans p
   where p.code = p_target_plan_code
     and p.is_active = true
   limit 1;

  if v_plan.id is null then
    return jsonb_build_object('success',false,'code','TARGET_PLAN_NOT_FOUND');
  end if;

  select
    l.id,
    l.license_key,
    l.plan_id,
    p.code plan_code,
    p.name plan_name,
    l.expires_at,
    l.duration_months,
    l.is_lifetime,
    l.license_type,
    l.product_name
    into v_before
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   for update of l;

  if v_before.id is null then
    return jsonb_build_object('success',false,'code','LICENSE_NOT_FOUND');
  end if;

  v_is_free_target := v_plan.code = 'free_trial';

  v_period_type := case
    when v_is_free_target then 'trial'
    when v_plan.code = 'pro_monthly' then 'pro_paid'
    when v_plan.code = 'basic_monthly' then 'basic_paid'
    else 'admin_grant'
  end;

  if v_is_free_target then
    v_end := null;
    v_duration_months := null;
    v_ai_limit := 0;
  else
    v_end := v_now + interval '1 month';
    v_duration_months := 1;
    v_ai_limit := greatest(coalesce((coalesce(v_plan.features,'{}'::jsonb)->>'ai_agent_total_limit')::integer,0),0);
  end if;

  update public.license_periods lp
     set status = 'closed',
         closed_at = v_now,
         metadata = coalesce(lp.metadata,'{}'::jsonb) || jsonb_build_object('closed_by','admin_change_license_plan','to_plan',v_plan.code)
   where lp.license_id = v_before.id
     and lp.status = 'active';

  update public.licenses l
     set plan_id = v_plan.id,
         expires_at = v_end,
         duration_months = v_duration_months,
         is_lifetime = v_is_free_target,
         status = 'active'
   where l.id = v_before.id
   returning
     l.id,
     l.license_key,
     l.license_type,
     l.product_name,
     l.max_devices,
     l.features,
     l.expires_at,
     l.duration_months,
     l.is_lifetime,
     l.status
   into v_after;

  if v_is_free_target then
    update public.licenses l
       set license_type = 'free',
           product_name = 'Lanzo POS Free',
           expires_at = null,
           duration_months = null,
           is_lifetime = true,
           status = 'active'
     where l.id = v_before.id
     returning
       l.id,
       l.license_key,
       l.license_type,
       l.product_name,
       l.max_devices,
       l.features,
       l.expires_at,
       l.duration_months,
       l.is_lifetime,
       l.status
     into v_after;
  end if;

  v_period_metadata := jsonb_build_object(
    'source', 'admin_change_license_plan',
    'reason', coalesce(p_reason,'manual_admin_plan_change'),
    'from_plan', v_before.plan_code,
    'to_plan', v_plan.code
  );

  v_plan_changed_metadata := jsonb_build_object(
    'source', 'admin_change_license_plan',
    'reason', coalesce(p_reason,'manual_admin_plan_change'),
    'from_plan', v_before.plan_code,
    'to_plan', v_plan.code,
    'period_start', v_now,
    'period_end', v_end,
    'ai_agent_limit', v_ai_limit
  );

  v_period_created_metadata := jsonb_build_object(
    'source', 'admin_change_license_plan',
    'period_type', v_period_type,
    'starts_at', v_now,
    'ends_at', v_end,
    'ai_agent_limit', v_ai_limit,
    'plan_code', v_plan.code
  );

  if v_is_free_target then
    v_period_metadata := v_period_metadata || jsonb_build_object(
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'period_end', null
    );

    v_plan_changed_metadata := v_plan_changed_metadata || jsonb_build_object(
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null,
      'duration_months', null,
      'period_end', null
    );

    v_period_created_metadata := v_period_created_metadata || jsonb_build_object(
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'period_end', null
    );
  end if;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_before.id, v_plan.id, v_plan.code, v_plan.name,
    v_period_type, 'active', v_now, v_end, v_ai_limit, v_period_metadata
  ) returning id into v_period_id;

  v_plan_changed_metadata := v_plan_changed_metadata || jsonb_build_object('period_id', v_period_id);
  v_period_created_metadata := v_period_created_metadata || jsonb_build_object('period_id', v_period_id);

  select count(*) into v_active_devices
    from public.license_devices d
   where d.license_id = v_before.id
     and d.is_active = true;

  select count(*) into v_staff_devices
    from public.license_devices d
   where d.license_id = v_before.id
     and d.is_active = true
     and coalesce(d.device_role,'staff') = 'staff';

  insert into public.license_events (license_key,event_type,metadata)
  values (
    p_license_key,
    'PLAN_CHANGED',
    v_plan_changed_metadata
  );

  insert into public.license_events (license_key,event_type,metadata)
  values (
    p_license_key,
    'PERIOD_CREATED',
    v_period_created_metadata
  );

  return jsonb_build_object(
    'success', true,
    'license_key', p_license_key,
    'from_plan', v_before.plan_code,
    'to_plan', v_plan.code,
    'plan_name', v_plan.name,
    'product_name', v_after.product_name,
    'license_type', v_after.license_type,
    'duration_months', v_after.duration_months,
    'is_lifetime', v_after.is_lifetime,
    'status', v_after.status,
    'max_devices', v_after.max_devices,
    'features', v_after.features,
    'expires_at', v_after.expires_at,
    'period_id', v_period_id,
    'period_start', v_now,
    'period_end', v_end,
    'ai_agent_limit', v_ai_limit,
    'active_devices_after_enforcement', v_active_devices,
    'active_staff_devices_after_enforcement', v_staff_devices
  );
end;
$function$;;
