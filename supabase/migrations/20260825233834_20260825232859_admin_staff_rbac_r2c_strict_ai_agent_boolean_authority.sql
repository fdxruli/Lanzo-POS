-- ADMIN.STAFF.RBAC.R2C
-- Make ai_agents a canonical Staff permission and enforce it at the shared
-- service-role AI usage authority before period/quota work can begin.

begin;

create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_build_object(
    'pos', true,
    'orders', true,
    'products', false,
    'customers', false,
    'reports', false,
    'settings', false,
    'devices', false,
    'license', false,
    'inventory', false,
    'cash_register', true,
    'discounts', false,
    'refunds', false,
    'ecommerce', false,
    'sync', false,
    'notifications', false,
    -- Category defaults stay true behind the master switch for compatibility
    -- with older clients that only persist notifications=true.
    'notifications_ecommerce', true,
    'notifications_support', true,
    'notifications_license', true,
    'notifications_operations', true,
    'notifications_system', true,
    'support_center', false,
    'ai_agents', false
  );
$function$;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync', 'notifications',
    'notifications_ecommerce', 'notifications_support',
    'notifications_license', 'notifications_operations',
    'notifications_system', 'support_center', 'ai_agents'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return v_result;
  end if;

  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;

  return v_result;
end;
$function$;

-- This helper is the service-role boundary used by the Edge Function. It must
-- resolve the current actor/session on every request and require an explicit
-- boolean true for Staff. Missing, null, and malformed values fail closed.
create or replace function public.get_ai_agent_usage_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_l record;
  v_d record;
  v_actor jsonb;
  v_f jsonb;
  v_pid uuid;
  v_p record;
  v_used integer := 0;
  v_limit integer := 0;
begin
  select
    l.id,
    l.status,
    l.expires_at,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as features
  into v_l
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_l.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  if v_l.status <> 'active' or (v_l.expires_at is not null and v_l.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  v_f := coalesce(v_l.features, '{}'::jsonb);
  if coalesce((v_f->>'ai_agents')::boolean, false) = false then
    return jsonb_build_object('success', false, 'code', 'AI_AGENTS_NOT_AVAILABLE', 'plan_code', v_l.plan_code, 'plan_name', v_l.plan_name, 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', false);
  end if;

  select
    d.id,
    d.is_active,
    d.security_token,
    d.previous_security_token,
    d.device_mode
  into v_d
  from public.license_devices d
  where d.license_id = v_l.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_d.id is null or coalesce(v_d.is_active, false) = false then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  if v_d.security_token is not null and (
    coalesce(p_device_security_token, '') = ''
    or (
      p_device_security_token <> v_d.security_token
      and p_device_security_token <> coalesce(v_d.previous_security_token, '')
    )
  ) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  v_actor := private.resolve_device_actor_session(
    v_l.id,
    v_d.id,
    v_d.device_mode,
    p_staff_session_token
  );

  if coalesce((v_actor->>'success')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(v_actor->>'code', 'ACTOR_SESSION_INVALID'),
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'ai_agents', true
    );
  end if;

  if v_actor->>'actor_type' = 'staff'
     and not coalesce(
       jsonb_typeof((v_actor->'actor_permissions')->'ai_agents') = 'boolean'
       and (v_actor->'actor_permissions')->'ai_agents' = 'true'::jsonb,
       false
     ) then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENT_PERMISSION_REQUIRED',
      'message', 'El usuario staff no tiene permiso para usar agentes de IA.',
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'ai_agents', true,
      'actor_type', 'staff',
      'actor_key', v_actor->>'actor_key'
    );
  end if;

  v_pid := public.ensure_current_license_period(v_l.id);
  if v_pid is null then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_PERIOD_NOT_FOUND', 'plan_code', v_l.plan_code, 'plan_name', v_l.plan_name, 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  select * into v_p from public.license_periods where id = v_pid;
  v_limit := greatest(coalesce(v_p.ai_agent_limit, 0), 0);

  select count(*)::integer into v_used
  from public.ai_agent_usage u
  where u.license_id = v_l.id
    and u.period_id = v_pid
    and u.status in ('reserved', 'completed');

  return jsonb_build_object(
    'success', v_limit > 0,
    'code', case when v_limit > 0 then null else 'AI_AGENT_LIMIT_DISABLED' end,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'plan_code', v_l.plan_code,
    'plan_name', v_l.plan_name,
    'ai_agents', true,
    'period_id', v_pid,
    'period_type', v_p.period_type,
    'period_status', v_p.status,
    'period_start', v_p.starts_at,
    'period_end', v_p.ends_at,
    'actor_type', v_actor->>'actor_type',
    'actor_key', v_actor->>'actor_key'
  );
end;
$function$;

-- The unlimited/internal helper is never a client entry point. Keep its ACL
-- closed even if a historical overload or default grant is present.
revoke all on function public.get_ai_agent_usage_unlimited(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_agent_usage_unlimited(text, text, text, text)
  to service_role;

commit;