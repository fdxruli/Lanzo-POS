create or replace function public.get_license_devices_anon(
  license_key_param text,
  current_fingerprint_param text
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_is_authorized boolean := false;
  v_devices json;
begin
  select l.id
  into v_license_id
  from public.licenses l
  where l.license_key = license_key_param;

  if v_license_id is null then
    return json_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'No autorizado'
    );
  end if;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license_id
      and d.device_fingerprint = current_fingerprint_param
      and d.is_active = true
  )
  into v_is_authorized;

  if not v_is_authorized then
    return json_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'No autorizado'
    );
  end if;

  select coalesce(
    json_agg(
      json_build_object(
        'device_id', d.id,
        'device_name', d.device_name,
        'last_used_at', d.last_used_at,
        'activated_at', d.activated_at,
        'is_active', d.is_active,
        'is_current_device', (d.device_fingerprint = current_fingerprint_param),
        'device_role', coalesce(d.device_role, 'staff'),
        'staff_user_id', d.staff_user_id,
        'staff_username', s.username,
        'staff_display_name', s.display_name,
        'staff_role_name', s.role_name,
        'staff_is_active', s.is_active
      )
      order by
        (d.device_fingerprint = current_fingerprint_param) desc,
        d.is_active desc,
        case when coalesce(d.device_role, 'staff') = 'admin' then 0 else 1 end,
        d.last_used_at desc nulls last,
        d.activated_at asc nulls last
    ),
    '[]'::json
  )
  into v_devices
  from public.license_devices d
  left join public.license_staff_users s
    on s.id = d.staff_user_id
   and s.license_id = d.license_id
  where d.license_id = v_license_id;

  return json_build_object(
    'success', true,
    'data', v_devices
  );
end;
$function$;;
