-- Optimiza la validación de uso de agentes IA para staff.
-- Problema detectado: get_ai_agent_usage ejecutaba crypt() contra sesiones históricas
-- del mismo dispositivo antes de filtrar revoked_at/expires_at. En móviles con muchas
-- sesiones, eso podía detonar "canceling statement due to statement timeout".

create index if not exists idx_license_staff_sessions_ai_usage_active
  on public.license_staff_sessions (license_id, device_id, created_at desc)
  where revoked_at is null;

create index if not exists idx_ai_agent_usage_license_period_status
  on public.ai_agent_usage (license_id, period_id, status);

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
  v_l record;
  v_d record;
  v_s record;
  v_f jsonb;
  v_pid uuid;
  v_p record;
  v_used integer := 0;
  v_limit integer := 0;
begin
  select l.id, l.status, l.expires_at, p.code plan_code, p.name plan_name,
         coalesce(p.features,'{}'::jsonb) || coalesce(l.features,'{}'::jsonb) features
    into v_l
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   limit 1;

  if v_l.id is null then
    return jsonb_build_object('success',false,'code','LICENSE_NOT_FOUND','limit',0,'used',0,'remaining',0,'ai_agents',false);
  end if;

  if v_l.status <> 'active' or (v_l.expires_at is not null and v_l.expires_at < now()) then
    return jsonb_build_object('success',false,'code','LICENSE_NOT_ACTIVE','limit',0,'used',0,'remaining',0,'ai_agents',false);
  end if;

  v_f := coalesce(v_l.features,'{}'::jsonb);
  if coalesce((v_f->>'ai_agents')::boolean,false) = false then
    return jsonb_build_object('success',false,'code','AI_AGENTS_NOT_AVAILABLE','plan_code',v_l.plan_code,'plan_name',v_l.plan_name,'limit',0,'used',0,'remaining',0,'ai_agents',false);
  end if;

  select d.id, d.license_id, d.device_fingerprint, d.is_active, d.security_token,
         d.previous_security_token, d.device_role, d.staff_user_id
    into v_d
    from public.license_devices d
   where d.license_id = v_l.id
     and d.device_fingerprint = p_device_fingerprint
   limit 1;

  if v_d.id is null or coalesce(v_d.is_active,false) = false then
    return jsonb_build_object('success',false,'code','DEVICE_NOT_ALLOWED','limit',0,'used',0,'remaining',0,'ai_agents',true);
  end if;

  if v_d.security_token is not null and (
    coalesce(p_device_security_token,'') = '' or
    (p_device_security_token <> v_d.security_token and p_device_security_token <> coalesce(v_d.previous_security_token,''))
  ) then
    return jsonb_build_object('success',false,'code','DEVICE_TOKEN_INVALID','limit',0,'used',0,'remaining',0,'ai_agents',true);
  end if;

  if coalesce(v_d.device_role,'admin') = 'staff' then
    if coalesce(p_staff_session_token,'') = '' then
      return jsonb_build_object('success',false,'code','STAFF_SESSION_REQUIRED','limit',0,'used',0,'remaining',0,'ai_agents',true);
    end if;

    -- IMPORTANTE: filtrar primero solo sesiones activas y recientes antes de ejecutar crypt().
    -- staff_login_on_device revoca las sesiones anteriores del mismo dispositivo, por lo que
    -- normalmente esta subconsulta trae 1 fila. El límite evita comparar hashes históricos.
    select candidate.id, candidate.expires_at, candidate.revoked_at, s.is_active staff_active
      into v_s
      from (
        select ss.id, ss.staff_user_id, ss.session_token_hash, ss.expires_at, ss.revoked_at, ss.created_at
          from public.license_staff_sessions ss
         where ss.license_id = v_l.id
           and ss.device_id = v_d.id
           and ss.revoked_at is null
           and ss.expires_at > now()
         order by ss.created_at desc
         limit 3
      ) candidate
      join public.license_staff_users s on s.id = candidate.staff_user_id
     where s.license_id = v_l.id
       and extensions.crypt(coalesce(p_staff_session_token,''), candidate.session_token_hash) = candidate.session_token_hash
     limit 1;

    if v_s.id is null or v_s.revoked_at is not null or v_s.expires_at < now() or coalesce(v_s.staff_active,false) = false then
      return jsonb_build_object('success',false,'code','STAFF_SESSION_INVALID','limit',0,'used',0,'remaining',0,'ai_agents',true);
    end if;
  end if;

  v_pid := public.ensure_current_license_period(v_l.id);
  if v_pid is null then
    return jsonb_build_object('success',false,'code','AI_AGENT_PERIOD_NOT_FOUND','plan_code',v_l.plan_code,'plan_name',v_l.plan_name,'limit',0,'used',0,'remaining',0,'ai_agents',true);
  end if;

  select * into v_p from public.license_periods where id = v_pid;
  v_limit := greatest(coalesce(v_p.ai_agent_limit,0),0);

  select count(*)::integer into v_used
    from public.ai_agent_usage u
   where u.license_id = v_l.id
     and u.period_id = v_pid
     and u.status in ('reserved','completed');

  return jsonb_build_object(
    'success', v_limit > 0,
    'code', case when v_limit > 0 then null else 'AI_AGENT_LIMIT_DISABLED' end,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used,0),
    'plan_code', v_l.plan_code,
    'plan_name', v_l.plan_name,
    'ai_agents', true,
    'period_id', v_pid,
    'period_type', v_p.period_type,
    'period_status', v_p.status,
    'period_start', v_p.starts_at,
    'period_end', v_p.ends_at
  );
end;
$function$;

grant execute on function public.get_ai_agent_usage(text,text,text,text) to anon, authenticated, service_role;;
