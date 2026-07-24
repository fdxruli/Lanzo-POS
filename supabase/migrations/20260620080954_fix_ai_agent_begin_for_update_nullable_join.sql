create or replace function public.begin_ai_agent_analysis(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_staff_session_token text default null::text,
  p_agent_type text default 'unknown'::text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_device record;
  v_staff_user_id uuid;
  v_effective_features jsonb;
  v_limit integer;
  v_used_count integer;
  v_usage_id uuid;
  v_staff_session record;
begin
  select
    l.id,
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
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no está activa.');
  end if;

  v_effective_features := coalesce(v_license.effective_features, '{}'::jsonb);

  if coalesce((v_effective_features->>'ai_agents')::boolean, false) = false then
    return jsonb_build_object('success', false, 'code', 'AI_AGENTS_NOT_AVAILABLE', 'message', 'Los agentes de IA solo están disponibles en el plan Pro.', 'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name);
  end if;

  v_limit := greatest(coalesce((v_effective_features->>'ai_agent_total_limit')::integer, 15), 0);

  if v_limit <= 0 then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_LIMIT_DISABLED', 'message', 'Esta licencia no tiene análisis de IA disponibles.');
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null or v_device.is_active = false then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no está autorizado para esta licencia.');
  end if;

  if v_device.security_token is not null then
    if coalesce(p_device_security_token, '') = '' then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Se requiere token de dispositivo.');
    elsif p_device_security_token <> v_device.security_token and p_device_security_token <> coalesce(v_device.previous_security_token, '') then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token de dispositivo inválido.');
    end if;
  end if;

  if coalesce(v_device.device_role, 'admin') = 'staff' then
    if coalesce(p_staff_session_token, '') = '' then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Se requiere sesión staff válida.');
    end if;

    select ss.id as session_id, ss.staff_user_id, ss.expires_at, ss.revoked_at, s.is_active as staff_is_active
    into v_staff_session
    from public.license_staff_sessions ss
    join public.license_staff_users s on s.id = ss.staff_user_id
    where ss.license_id = v_license.id
      and ss.device_id = v_device.id
      and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    limit 1;

    if v_staff_session.session_id is null or v_staff_session.revoked_at is not null or v_staff_session.expires_at < now() or v_staff_session.staff_is_active = false then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesión staff inválida o expirada.');
    end if;

    v_staff_user_id := v_staff_session.staff_user_id;
  end if;

  select count(*) into v_used_count
  from public.ai_agent_usage u
  where u.license_id = v_license.id
    and u.status in ('reserved', 'completed');

  if v_used_count >= v_limit then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_LIMIT_REACHED', 'message', 'Ya se alcanzó el límite total de análisis de IA para esta licencia.', 'limit', v_limit, 'used', v_used_count, 'remaining', 0);
  end if;

  insert into public.ai_agent_usage (license_id, device_id, staff_user_id, agent_type, status, metadata)
  values (v_license.id, v_device.id, v_staff_user_id, coalesce(nullif(trim(p_agent_type), ''), 'unknown'), 'reserved', coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('plan_code', v_license.plan_code, 'plan_name', v_license.plan_name))
  returning id into v_usage_id;

  return jsonb_build_object('success', true, 'usage_id', v_usage_id, 'limit', v_limit, 'used', v_used_count + 1, 'remaining', greatest(v_limit - (v_used_count + 1), 0), 'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name);
end;
$function$;;
