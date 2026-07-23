create or replace function public.release_device_anon(
  device_id_param uuid,
  license_key_param text,
  requester_fingerprint_param text
)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license_id uuid;
  v_target_device record;
  v_requester_device record;
  v_released_current boolean := false;
  v_revoked_sessions_count integer := 0;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return json_build_object(
      'success', false,
      'message', 'Licencia no encontrada.',
      'code', 'LICENSE_NOT_FOUND'
    );
  end if;

  select * into v_target_device
  from public.license_devices
  where id = device_id_param
    and license_id = v_license_id;

  if v_target_device.id is null then
    return json_build_object(
      'success', false,
      'message', 'Dispositivo no encontrado.',
      'code', 'DEVICE_NOT_FOUND'
    );
  end if;

  -- Seguridad crítica:
  -- Antes bastaba con que el solicitante fuera cualquier dispositivo activo.
  -- Ahora solo un dispositivo administrador activo puede liberar equipos.
  -- Esto evita que un staff libere dispositivos manipulando el frontend o llamando la RPC directo.
  select d.* into v_requester_device
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = requester_fingerprint_param
    and d.is_active = true
    and d.device_role = 'admin'
  limit 1;

  if v_requester_device.id is null then
    return json_build_object(
      'success', false,
      'message', 'Solo el dispositivo administrador puede liberar dispositivos.',
      'code', 'ADMIN_DEVICE_REQUIRED'
    );
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
      'authorization', 'admin_device_required',
      'requester_device_id', v_requester_device.id,
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
$function$;

comment on function public.release_device_anon(uuid, text, text)
is 'Libera dispositivos de una licencia. Requiere que el solicitante sea un dispositivo administrador activo de la misma licencia.';;
