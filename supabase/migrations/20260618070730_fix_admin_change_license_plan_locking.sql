create or replace function public.admin_change_license_plan(
  p_license_key text,
  p_target_plan_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_target_plan public.plans%rowtype;
  v_license_before record;
  v_license_after record;
  v_active_devices integer;
  v_staff_devices integer;
begin
  if nullif(trim(p_license_key), '') is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED');
  end if;

  if nullif(trim(p_target_plan_code), '') is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_REQUIRED');
  end if;

  select *
  into v_target_plan
  from public.plans p
  where p.code = p_target_plan_code
    and p.is_active = true
  limit 1;

  if v_target_plan.id is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_NOT_FOUND');
  end if;

  select
    l.id,
    l.license_key,
    l.plan_id,
    p.code as plan_code,
    p.name as plan_name,
    l.license_type,
    l.product_name,
    l.max_devices,
    l.features
  into v_license_before
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license_before.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  update public.licenses l
  set plan_id = v_target_plan.id
  where l.id = v_license_before.id
  returning
    l.id,
    l.license_key,
    l.plan_id,
    l.license_type,
    l.product_name,
    l.max_devices,
    l.features
  into v_license_after;

  select count(*)
  into v_active_devices
  from public.license_devices d
  where d.license_id = v_license_before.id
    and d.is_active = true;

  select count(*)
  into v_staff_devices
  from public.license_devices d
  where d.license_id = v_license_before.id
    and d.is_active = true
    and coalesce(d.device_role, 'staff') = 'staff';

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'PLAN_CHANGED',
    jsonb_build_object(
      'source', 'admin_change_license_plan',
      'reason', coalesce(p_reason, 'manual_admin_plan_change'),
      'from_plan', v_license_before.plan_code,
      'from_plan_name', v_license_before.plan_name,
      'to_plan', v_target_plan.code,
      'to_plan_name', v_target_plan.name,
      'active_devices_after_enforcement', v_active_devices,
      'active_staff_devices_after_enforcement', v_staff_devices,
      'max_devices', v_license_after.max_devices
    )
  );

  return jsonb_build_object(
    'success', true,
    'license_key', p_license_key,
    'from_plan', v_license_before.plan_code,
    'to_plan', v_target_plan.code,
    'product_name', v_license_after.product_name,
    'license_type', v_license_after.license_type,
    'max_devices', v_license_after.max_devices,
    'features', v_license_after.features,
    'active_devices_after_enforcement', v_active_devices,
    'active_staff_devices_after_enforcement', v_staff_devices
  );
end;
$$;

revoke all on function public.admin_change_license_plan(text, text, text) from public;
revoke all on function public.admin_change_license_plan(text, text, text) from anon;
revoke all on function public.admin_change_license_plan(text, text, text) from authenticated;
;
