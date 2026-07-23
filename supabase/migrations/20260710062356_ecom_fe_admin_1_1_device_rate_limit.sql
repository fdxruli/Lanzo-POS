create or replace function private.ecommerce_admin_authorize_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rate_limit jsonb;
  v_license record;
  v_device record;
  v_staff_verification jsonb;
  v_permissions jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return private.ecommerce_admin_error(
      'ECOMMERCE_ADMIN_ACCESS_DENIED',
      'No tienes permiso para administrar el portal online.'
    );
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_admin'),
    p_scope := 'ECOM_ADMIN',
    p_max_attempts := 180,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'phase', 'ECOM.FE.ADMIN.1.1.1',
      'actor_partition', 'device'
    )
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_admin_error(
      'ECOMMERCE_RATE_LIMITED',
      null,
      jsonb_build_object(
        'retryAfterSeconds',
        nullif(v_rate_limit->>'retry_after_seconds', '')::integer
      )
    );
  end if;

  select
    l.id as license_id,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at >= now())
  limit 1;

  if v_license.license_id is null then
    return private.ecommerce_admin_error('LICENSE_NOT_ACTIVE');
  end if;

  if private.ecommerce_license_feature_bool(
    p_license_id := v_license.license_id,
    p_feature_key := 'ecommerce_portal_enabled',
    p_default := false
  ) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_DISABLED');
  end if;

  select
    d.id as device_id,
    d.device_role,
    d.staff_user_id
  into v_device
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and (
      d.security_token = p_security_token
      or d.previous_security_token = p_security_token
    )
  limit 1;

  if v_device.device_id is null then
    return private.ecommerce_admin_error(
      'ECOMMERCE_ADMIN_ACCESS_DENIED',
      'No tienes permiso para administrar el portal online.'
    );
  end if;

  if v_device.device_role = 'admin' then
    return jsonb_build_object(
      'success', true,
      'license_id', v_license.license_id,
      'device_id', v_device.device_id,
      'device_role', 'admin',
      'actor_type', 'admin_device',
      'staff_user_id', null,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features
    );
  end if;

  if v_device.device_role <> 'staff' then
    return private.ecommerce_admin_error(
      'ECOMMERCE_ADMIN_ACCESS_DENIED',
      'No tienes permiso para administrar el portal online.'
    );
  end if;

  if nullif(btrim(coalesce(p_staff_session_token, '')), '') is null then
    return private.ecommerce_admin_error(
      'ECOMMERCE_STAFF_SESSION_REQUIRED',
      'Inicia sesion como personal para administrar el portal online.'
    );
  end if;

  v_staff_verification := public.verify_staff_session_unlimited(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_staff_session_token
  );

  if coalesce((v_staff_verification->>'valid')::boolean, false) is false then
    return private.ecommerce_admin_error(
      'ECOMMERCE_STAFF_SESSION_INVALID',
      'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
    );
  end if;

  if v_device.staff_user_id is null
     or coalesce(v_staff_verification #>> '{staff_user,id}', '') <> v_device.staff_user_id::text then
    return private.ecommerce_admin_error(
      'ECOMMERCE_STAFF_SESSION_INVALID',
      'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
    );
  end if;

  select s.permissions
  into v_permissions
  from public.license_staff_users s
  where s.id = v_device.staff_user_id
    and s.license_id = v_license.license_id
    and s.is_active is true
  limit 1;

  if v_permissions is null then
    return private.ecommerce_admin_error(
      'ECOMMERCE_STAFF_SESSION_INVALID',
      'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
    );
  end if;

  if coalesce((v_permissions->>'settings')::boolean, false) is not true
     or coalesce((v_permissions->>'ecommerce')::boolean, false) is not true then
    return private.ecommerce_admin_error(
      'ECOMMERCE_STAFF_PERMISSION_DENIED',
      'No tienes permiso para administrar el portal online.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'license_id', v_license.license_id,
    'device_id', v_device.device_id,
    'device_role', 'staff',
    'actor_type', 'staff',
    'staff_user_id', v_device.staff_user_id,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_license.effective_features
  );
exception
  when others then
    return private.ecommerce_admin_error(
      'ECOMMERCE_ADMIN_ACCESS_DENIED',
      'No tienes permiso para administrar el portal online.'
    );
end;
$$;

revoke all on function private.ecommerce_admin_authorize_v2(
  text, text, text, text, text
) from public, anon, authenticated;

grant execute on function private.ecommerce_admin_authorize_v2(
  text, text, text, text, text
) to service_role;;
