create or replace function public.get_ai_agent_usage(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license record;
  v_device record;
  v_staff record;
  v_features jsonb := '{}'::jsonb;
  v_limit integer := 0;
  v_used integer := 0;
begin
  select l.id,
         l.license_key,
         l.status,
         l.expires_at,
         p.code as plan_code,
         p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) as features
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status is distinct from 'active' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no está activa.');
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() then
    return jsonb_build_object('success', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia está expirada.');
  end if;

  v_features := coalesce(v_license.features, '{}'::jsonb);

  if coalesce((v_features->>'ai_agents')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENTS_NOT_AVAILABLE',
      'message', 'Los agentes de IA no están disponibles para este plan.',
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'limit', 0,
      'used', 0,
      'remaining', 0
    );
  end if;

  v_limit := coalesce((v_features->>'ai_agent_total_limit')::integer, 0);

  if v_limit <= 0 then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_LIMIT_DISABLED', 'message', 'El límite de agentes IA no está configurado.', 'limit', 0, 'used', 0, 'remaining', 0);
  end if;

  select *
    into v_device
    from public.license_devices
   where license_id = v_license.id
     and device_fingerprint = p_device_fingerprint
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo no autorizado para esta licencia.');
  end if;

  if coalesce(v_device.is_active, false) is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo desactivado.');
  end if;

  if nullif(p_device_security_token, '') is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token de seguridad del dispositivo.');
  end if;

  if p_device_security_token is distinct from v_device.security_token
     and p_device_security_token is distinct from v_device.previous_security_token then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token de dispositivo inválido.');
  end if;

  if coalesce(v_device.device_role, 'admin') = 'staff' then
    if nullif(p_staff_session_token, '') is null then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Falta sesión staff para este dispositivo.');
    end if;

    select *
      into v_staff
      from public.license_staff_users
     where license_id = v_license.id
       and id = v_device.staff_user_id
       and session_token = p_staff_session_token
       and coalesce(is_active, true) is true
     limit 1;

    if not found then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesión staff inválida.');
    end if;
  end if;

  select count(*)::integer
    into v_used
    from public.ai_agent_usage
   where license_id = v_license.id
     and status in ('reserved', 'completed');

  return jsonb_build_object(
    'success', true,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'ai_agents', true
  );
end;
$$;

revoke all on function public.get_ai_agent_usage(text, text, text, text) from public;
revoke all on function public.get_ai_agent_usage(text, text, text, text) from anon;
revoke all on function public.get_ai_agent_usage(text, text, text, text) from authenticated;
grant execute on function public.get_ai_agent_usage(text, text, text, text) to service_role;;
