-- =========================================================
-- Corrección: un dispositivo staff existente no puede reactivarse solo con licencia.
-- Además, liberar un dispositivo staff revoca sus sesiones staff.
-- =========================================================

create or replace function public.activate_license_on_device(
  license_key_param text,
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_record public.licenses%rowtype;
  v_device_record record;
  v_current_count int;
  v_security_token text;
  v_profile_required boolean;
  v_effective_features jsonb;
  v_staff_roles_enabled boolean;
  v_realtime_topic text;
  v_has_active_admin boolean;
  v_device_role text;
begin
  select * into v_license_record
  from public.licenses
  where license_key = license_key_param
  for update;

  if v_license_record.id is null then
    return json_build_object('success', false, 'error', 'Licencia no encontrada.', 'code', 'LICENSE_NOT_FOUND');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_effective_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = v_license_record.id;

  v_staff_roles_enabled := coalesce((v_effective_features->>'staff_roles')::boolean, false);

  if v_license_record.status <> 'active' then
    return json_build_object('success', false, 'error', 'La licencia no esta activa o ha sido suspendida.', 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  if v_license_record.expires_at is not null and v_license_record.expires_at < now() then
    return json_build_object('success', false, 'error', 'La licencia ha caducado.', 'code', 'LICENSE_EXPIRED');
  end if;

  if v_license_record.expires_at is null
     and coalesce(v_license_record.is_lifetime, false) = false
     and v_license_record.duration_months is not null then
    update public.licenses
    set expires_at = now() + (v_license_record.duration_months || ' months')::interval
    where id = v_license_record.id;

    v_license_record.expires_at := now() + (v_license_record.duration_months || ' months')::interval;
  end if;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license_record.id
      and nullif(trim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license_record.id
      and d.is_active = true
      and d.device_role = 'admin'
  ) into v_has_active_admin;

  select * into v_device_record
  from public.license_devices
  where license_id = v_license_record.id
    and device_fingerprint = device_fingerprint_param;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  if v_device_record.id is not null then
    v_device_role := coalesce(
      v_device_record.device_role,
      case when v_has_active_admin then 'staff' else 'admin' end
    );

    -- Regla crítica:
    -- Si la licencia usa staff_roles y ya existe un admin activo, un equipo staff
    -- NO puede reactivarse solo con la licencia. Debe pasar por staff_login_on_device().
    if v_staff_roles_enabled and v_has_active_admin and v_device_role = 'staff' then
      return json_build_object(
        'success', false,
        'code', 'STAFF_LOGIN_REQUIRED',
        'staff_login_required', true,
        'message', 'Este dispositivo requiere inicio de sesion staff.',
        'details', json_build_object(
          'license_key', license_key_param,
          'product_name', v_license_record.product_name,
          'profile_required', false,
          'features', coalesce(v_effective_features, '{}'::jsonb),
          'device_role', 'staff'
        )
      );
    end if;

    -- Si no hay admin activo, este dispositivo existente puede asumir/recuperar rol admin.
    if v_staff_roles_enabled and not v_has_active_admin then
      v_device_role := 'admin';
    end if;

    update public.license_devices
    set device_name = device_name_param,
        device_info = coalesce(device_info_param, '{}'::jsonb),
        is_active = true,
        security_token = v_security_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_used_at = now(),
        last_check_at = now(),
        device_role = v_device_role,
        staff_user_id = case when v_device_role = 'admin' then null else staff_user_id end
    where id = v_device_record.id
    returning realtime_topic, device_role into v_realtime_topic, v_device_role;
  else
    if v_has_active_admin and v_staff_roles_enabled then
      return json_build_object(
        'success', false,
        'code', 'STAFF_LOGIN_REQUIRED',
        'staff_login_required', true,
        'message', 'Esta licencia ya tiene un dispositivo administrador. Para agregar este equipo, inicia sesion con un usuario staff autorizado.',
        'details', json_build_object(
          'license_key', license_key_param,
          'product_name', v_license_record.product_name,
          'profile_required', false,
          'features', coalesce(v_effective_features, '{}'::jsonb),
          'device_role', 'staff'
        )
      );
    end if;

    select count(*) into v_current_count
    from public.license_devices
    where license_id = v_license_record.id
      and is_active = true;

    if (v_current_count + 1) > v_license_record.max_devices then
      return json_build_object('success', false, 'error', 'Limite de dispositivos alcanzado para esta licencia.', 'code', 'DEVICE_LIMIT_REACHED');
    end if;

    v_realtime_topic := private.generate_license_realtime_topic();
    v_device_role := case when v_has_active_admin then 'staff' else 'admin' end;

    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      realtime_topic,
      last_check_at,
      device_role
    ) values (
      v_license_record.id,
      device_fingerprint_param,
      device_name_param,
      coalesce(device_info_param, '{}'::jsonb),
      true,
      v_security_token,
      v_realtime_topic,
      now(),
      v_device_role
    );
  end if;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (v_license_record.id, device_fingerprint_param, 'ACTIVATE', coalesce(device_info_param, '{}'::jsonb));

  return json_build_object(
    'success', true,
    'message', 'Licencia activada correctamente',
    'device_security_token', v_security_token,
    'profile_required', v_profile_required,
    'device_role', v_device_role,
    'details', json_build_object(
      'license_key', license_key_param,
      'product_name', v_license_record.product_name,
      'expires_at', v_license_record.expires_at,
      'max_devices', v_license_record.max_devices,
      'features', coalesce(v_effective_features, '{}'::jsonb),
      'profile_required', v_profile_required,
      'security_token', v_security_token,
      'token', v_security_token,
      'device_role', v_device_role,
      'staff_user', null,
      'realtime_topic', case
        when coalesce((v_effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
        else null
      end
    )
  );
exception when unique_violation then
  return json_build_object(
    'success', false,
    'error', 'Error: este dispositivo ya esta registrado o ya existe un administrador activo.',
    'code', 'UNIQUE_VIOLATION'
  );
end;
$function$;

create or replace function public.release_device_anon(
  device_id_param uuid,
  license_key_param text,
  requester_fingerprint_param text
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_target_device record;
  v_requester_valid boolean;
  v_released_current boolean := false;
  v_revoked_sessions_count integer := 0;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return json_build_object('success', false, 'message', 'Licencia no encontrada.', 'code', 'LICENSE_NOT_FOUND');
  end if;

  select * into v_target_device
  from public.license_devices
  where id = device_id_param
    and license_id = v_license_id;

  if v_target_device.id is null then
    return json_build_object('success', false, 'message', 'Dispositivo no encontrado.', 'code', 'DEVICE_NOT_FOUND');
  end if;

  select exists (
    select 1
    from public.license_devices
    where license_id = v_license_id
      and device_fingerprint = requester_fingerprint_param
      and is_active = true
  ) into v_requester_valid;

  if not v_requester_valid then
    return json_build_object('success', false, 'message', 'No autorizado', 'code', 'NOT_AUTHORIZED');
  end if;

  v_released_current := v_target_device.device_fingerprint = requester_fingerprint_param;

  update public.license_devices
  set is_active = false,
      security_token = null,
      previous_security_token = null,
      last_used_at = now(),
      last_check_at = now()
  where id = v_target_device.id;

  if v_target_device.device_role = 'staff' then
    update public.license_staff_sessions
    set revoked_at = coalesce(revoked_at, now())
    where device_id = v_target_device.id
      and revoked_at is null;
    get diagnostics v_revoked_sessions_count = row_count;
  end if;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    license_key_param,
    'DEVICE_RELEASED',
    jsonb_build_object(
      'source', 'release_device_anon',
      'device_id', device_id_param,
      'device_role', v_target_device.device_role,
      'staff_user_id', v_target_device.staff_user_id,
      'target_fingerprint', v_target_device.device_fingerprint,
      'requester_fingerprint', requester_fingerprint_param,
      'released_current_device', v_released_current,
      'revoked_sessions_count', v_revoked_sessions_count,
      'released_at', now()
    )
  );

  return json_build_object(
    'success', true,
    'released_current_device', v_released_current,
    'revoked_sessions_count', v_revoked_sessions_count,
    'message', 'Dispositivo liberado correctamente.'
  );
end;
$function$;;
