create or replace function public.get_ai_agent_usage(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_device record;
  v_staff_session record;
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
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  if v_license.status is distinct from 'active' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no está activa.', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() then
    return jsonb_build_object('success', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia está expirada.', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  v_features := coalesce(v_license.effective_features, '{}'::jsonb);

  if coalesce((v_features->>'ai_agents')::boolean, false) is not true then
    return jsonb_build_object('success', false, 'code', 'AI_AGENTS_NOT_AVAILABLE', 'message', 'Los agentes de IA no están disponibles para este plan.', 'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name, 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  v_limit := greatest(coalesce((v_features->>'ai_agent_total_limit')::integer, 15), 0);

  if v_limit <= 0 then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_LIMIT_DISABLED', 'message', 'El límite de agentes IA no está configurado.', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  select * into v_device
    from public.license_devices
   where license_id = v_license.id
     and device_fingerprint = p_device_fingerprint
   limit 1;

  if not found or coalesce(v_device.is_active, false) is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo no autorizado para esta licencia.', 'limit', v_limit, 'used', 0, 'remaining', v_limit, 'ai_agents', true);
  end if;

  if v_device.security_token is not null then
    if nullif(p_device_security_token, '') is null then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token de seguridad del dispositivo.', 'limit', v_limit, 'used', 0, 'remaining', v_limit, 'ai_agents', true);
    end if;

    if p_device_security_token is distinct from v_device.security_token and p_device_security_token is distinct from v_device.previous_security_token then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token de dispositivo inválido.', 'limit', v_limit, 'used', 0, 'remaining', v_limit, 'ai_agents', true);
    end if;
  end if;

  if coalesce(v_device.device_role, 'admin') = 'staff' then
    if nullif(p_staff_session_token, '') is null then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Falta sesión staff para este dispositivo.', 'limit', v_limit, 'used', 0, 'remaining', v_limit, 'ai_agents', true);
    end if;

    select ss.id as session_id, ss.staff_user_id, ss.expires_at, ss.revoked_at, s.is_active as staff_is_active
      into v_staff_session
      from public.license_staff_sessions ss
      join public.license_staff_users s on s.id = ss.staff_user_id
     where ss.license_id = v_license.id
       and ss.device_id = v_device.id
       and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
     limit 1;

    if not found or v_staff_session.revoked_at is not null or v_staff_session.expires_at < now() or coalesce(v_staff_session.staff_is_active, false) is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesión staff inválida.', 'limit', v_limit, 'used', 0, 'remaining', v_limit, 'ai_agents', true);
    end if;
  end if;

  select count(*)::integer into v_used
    from public.ai_agent_usage
   where license_id = v_license.id
     and status in ('reserved', 'completed');

  return jsonb_build_object('success', true, 'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0), 'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name, 'ai_agents', true);
end;
$function$;;
