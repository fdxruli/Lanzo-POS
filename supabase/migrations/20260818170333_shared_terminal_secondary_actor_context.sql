-- SHARED.TERMINAL.2 — route secondary cloud contexts through authenticated actor sessions.
-- These functions keep their public signatures but no longer infer actor identity
-- from the physical device_role on a shared terminal.

create or replace function private.resolve_device_actor_session(
  p_license_id uuid,
  p_device_id uuid,
  p_device_mode text,
  p_actor_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token text := nullif(btrim(coalesce(p_actor_session_token, '')), '');
  v_admin record;
  v_staff record;
  v_admin_valid boolean := false;
  v_staff_valid boolean := false;
begin
  if p_device_mode not in ('admin_only', 'staff_only', 'shared') then
    return jsonb_build_object('success', false, 'code', 'DEVICE_MODE_INVALID');
  end if;

  if v_token is null then
    return jsonb_build_object('success', false, 'code', 'ACTOR_SESSION_REQUIRED');
  end if;

  if p_device_mode in ('admin_only', 'shared') then
    select
      candidate.id as session_id,
      candidate.admin_user_id,
      candidate.expires_at,
      u.username,
      u.display_name
    into v_admin
    from (
      select s.id, s.admin_user_id, s.session_token_hash, s.expires_at, s.created_at
      from public.license_admin_sessions s
      where s.license_id = p_license_id
        and s.device_id = p_device_id
        and s.revoked_at is null
      order by s.created_at desc
      limit 3
    ) candidate
    join public.license_admin_users u on u.id = candidate.admin_user_id
    where u.license_id = p_license_id
      and u.is_owner is true
      and u.is_active is true
      and extensions.crypt(v_token, candidate.session_token_hash) = candidate.session_token_hash
    limit 1;

    if v_admin.session_id is not null then
      if v_admin.expires_at <= now() then
        update public.license_admin_sessions
        set revoked_at = coalesce(revoked_at, now())
        where id = v_admin.session_id;
      else
        v_admin_valid := true;
      end if;
    end if;
  end if;

  if p_device_mode in ('staff_only', 'shared') then
    select
      candidate.id as session_id,
      candidate.staff_user_id,
      candidate.expires_at,
      s.username,
      s.display_name,
      s.role_name,
      s.permissions,
      s.is_active as staff_is_active
    into v_staff
    from (
      select ss.id, ss.staff_user_id, ss.session_token_hash, ss.expires_at, ss.created_at
      from public.license_staff_sessions ss
      where ss.license_id = p_license_id
        and ss.device_id = p_device_id
        and ss.revoked_at is null
      order by ss.created_at desc
      limit 3
    ) candidate
    join public.license_staff_users s on s.id = candidate.staff_user_id
    where s.license_id = p_license_id
      and extensions.crypt(v_token, candidate.session_token_hash) = candidate.session_token_hash
    limit 1;

    if v_staff.session_id is not null then
      if v_staff.expires_at <= now() then
        update public.license_staff_sessions
        set revoked_at = coalesce(revoked_at, now())
        where id = v_staff.session_id;
      elsif v_staff.staff_is_active is not true then
        return jsonb_build_object('success', false, 'code', 'STAFF_USER_INACTIVE');
      else
        v_staff_valid := true;
      end if;
    end if;
  end if;

  if v_admin_valid and v_staff_valid then
    return jsonb_build_object('success', false, 'code', 'ACTOR_SESSION_AMBIGUOUS');
  end if;

  if not v_admin_valid and not v_staff_valid then
    return jsonb_build_object('success', false, 'code', 'ACTOR_SESSION_INVALID');
  end if;

  if v_admin_valid then
    update public.license_admin_sessions
    set last_used_at = now()
    where id = v_admin.session_id
      and last_used_at < now() - interval '30 seconds';

    return jsonb_build_object(
      'success', true,
      'actor_type', 'admin',
      'actor_id', v_admin.admin_user_id,
      'actor_key', 'admin:' || v_admin.admin_user_id::text,
      'actor_session_id', v_admin.session_id,
      'actor_permissions', jsonb_build_object('*', true),
      'admin_user_id', v_admin.admin_user_id,
      'admin_user', jsonb_build_object(
        'id', v_admin.admin_user_id,
        'username', v_admin.username,
        'display_name', v_admin.display_name,
        'is_owner', true
      )
    );
  end if;

  perform private.touch_license_staff_session_seen(v_staff.session_id, '30 seconds'::interval);

  return jsonb_build_object(
    'success', true,
    'actor_type', 'staff',
    'actor_id', v_staff.staff_user_id,
    'actor_key', 'staff:' || v_staff.staff_user_id::text,
    'actor_session_id', v_staff.session_id,
    'actor_permissions', coalesce(v_staff.permissions, '{}'::jsonb),
    'staff_user_id', v_staff.staff_user_id,
    'staff_user', jsonb_build_object(
      'id', v_staff.staff_user_id,
      'username', v_staff.username,
      'display_name', v_staff.display_name,
      'role_name', v_staff.role_name,
      'permissions', coalesce(v_staff.permissions, '{}'::jsonb)
    )
  );
end;
$function$;

revoke all on function private.resolve_device_actor_session(uuid, uuid, text, text) from public;

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
set search_path = ''
as $function$
declare
  v_rate_limit jsonb;
  v_license record;
  v_device record;
  v_actor jsonb;
  v_permissions jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    null,
    coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_admin'),
    'ECOM_ADMIN',
    180,
    600,
    300,
    'ECOMMERCE_RATE_LIMITED',
    jsonb_build_object('actor_partition', 'device')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_RATE_LIMITED');
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
  if private.ecommerce_license_feature_bool(v_license.license_id, 'ecommerce_portal_enabled', false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_DISABLED');
  end if;

  select d.id as device_id, d.device_mode
  into v_device
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and (d.security_token = p_security_token or d.previous_security_token = p_security_token)
  limit 1;

  if v_device.device_id is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
  end if;

  v_actor := private.resolve_device_actor_session(
    v_license.license_id,
    v_device.device_id,
    v_device.device_mode,
    p_staff_session_token
  );
  if coalesce((v_actor->>'success')::boolean, false) is false then
    return private.ecommerce_admin_error(coalesce(v_actor->>'code', 'ECOMMERCE_ADMIN_ACCESS_DENIED'));
  end if;

  if v_actor->>'actor_type' = 'admin' then
    return jsonb_build_object(
      'success', true,
      'license_id', v_license.license_id,
      'device_id', v_device.device_id,
      'device_mode', v_device.device_mode,
      'device_role', 'admin',
      'actor_type', 'admin_owner',
      'actor_id', v_actor->>'actor_id',
      'actor_key', v_actor->>'actor_key',
      'actor_session_id', v_actor->>'actor_session_id',
      'admin_user_id', v_actor->>'admin_user_id',
      'staff_user_id', null,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features
    );
  end if;

  v_permissions := coalesce(v_actor->'actor_permissions', '{}'::jsonb);
  if coalesce((v_permissions->>'settings')::boolean, false) is not true
     or coalesce((v_permissions->>'ecommerce')::boolean, false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_PERMISSION_DENIED');
  end if;

  return jsonb_build_object(
    'success', true,
    'license_id', v_license.license_id,
    'device_id', v_device.device_id,
    'device_mode', v_device.device_mode,
    'device_role', 'staff',
    'actor_type', 'staff',
    'actor_id', v_actor->>'actor_id',
    'actor_key', v_actor->>'actor_key',
    'actor_session_id', v_actor->>'actor_session_id',
    'actor_permissions', v_permissions,
    'admin_user_id', null,
    'staff_user_id', v_actor->>'staff_user_id',
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_license.effective_features
  );
exception
  when others then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
end;
$function$;

create or replace function private.get_support_ticket_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_rpc_name text default 'support_tickets'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_features jsonb;
  v_actor jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_grace_days integer := 7;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    p_rpc_name,
    'support',
    90,
    60,
    120,
    'SUPPORT_RPC_RATE_LIMITED',
    jsonb_build_object('phase', 'SHARED.TERMINAL.2')
  );

  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;
  if v_license.status <> 'active' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;
  if v_license.expires_at is not null and v_license.expires_at < now() - (v_grace_days || ' days')::interval then
    return jsonb_build_object('success', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia expiro.');
  end if;

  select
    d.id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    d.device_mode
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;
  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;
  if v_device.security_token is null or nullif(p_security_token, '') is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);
  if (v_features->>'support_center') is distinct from 'true'
     or (v_features->>'support_tickets') is distinct from 'true'
     or coalesce(v_features->>'support_channel', 'email') <> 'in_app' then
    return jsonb_build_object('success', false, 'code', 'SUPPORT_CENTER_DISABLED', 'message', 'Este plan no incluye soporte interno.');
  end if;

  v_actor := private.resolve_device_actor_session(
    v_license.id,
    v_device.id,
    v_device.device_mode,
    p_staff_session_token
  );
  if coalesce((v_actor->>'success')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(v_actor->>'code', 'ACTOR_SESSION_INVALID'),
      'message', 'No se pudo validar la sesion del actor.'
    );
  end if;

  v_permissions := coalesce(v_actor->'actor_permissions', '{}'::jsonb);
  if v_actor->>'actor_type' = 'staff'
     and coalesce((v_permissions->>'support_center')::boolean, false) is not true then
    return jsonb_build_object('success', false, 'code', 'STAFF_SUPPORT_DISABLED', 'message', 'Tu usuario staff no tiene acceso a soporte Lanzo.');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_fingerprint', v_device.device_fingerprint,
    'device_mode', v_device.device_mode,
    'device_role', v_actor->>'actor_type',
    'actor_type', v_actor->>'actor_type',
    'actor_id', v_actor->>'actor_id',
    'actor_key', v_actor->>'actor_key',
    'actor_session_id', v_actor->>'actor_session_id',
    'actor_permissions', v_permissions,
    'staff_user_id', v_actor->>'staff_user_id',
    'staff_permissions', case when v_actor->>'actor_type' = 'staff' then v_permissions else '{}'::jsonb end,
    'staff_user', v_actor->'staff_user',
    'admin_user_id', v_actor->>'admin_user_id',
    'admin_user', v_actor->'admin_user',
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_features
  ));
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(nullif(sqlerrm, ''), 'SUPPORT_CONTEXT_ERROR'),
      'message', 'No se pudo validar el contexto seguro de soporte.'
    );
end;
$function$;

create or replace function public.validate_pos_rpc_rate_limit_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_features jsonb := '{}'::jsonb;
  v_actor jsonb;
  v_permissions jsonb := '{}'::jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'LICENSE_KEY_REQUIRED', 'message', 'Licencia requerida.');
  end if;
  if nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED', 'message', 'Dispositivo requerido.');
  end if;

  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;
  if v_license.status <> 'active' then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no está activa.');
  end if;
  if v_license.expires_at is not null and v_license.expires_at < now() then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia expiró.');
  end if;

  select
    d.id,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    d.device_mode,
    d.realtime_topic
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo no autorizado.');
  end if;
  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Dispositivo inactivo.');
  end if;
  if v_device.security_token is null or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Token del dispositivo requerido.');
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'allowed', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token del dispositivo inválido.');
  end if;

  v_actor := private.resolve_device_actor_session(
    v_license.id,
    v_device.id,
    v_device.device_mode,
    p_staff_session_token
  );
  if coalesce((v_actor->>'success')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'allowed', false,
      'code', coalesce(v_actor->>'code', 'ACTOR_SESSION_INVALID'),
      'message', 'Sesion de actor invalida.'
    );
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);
  v_permissions := coalesce(v_actor->'actor_permissions', '{}'::jsonb);

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'allowed', true,
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_mode', v_device.device_mode,
    'device_role', v_actor->>'actor_type',
    'actor_type', v_actor->>'actor_type',
    'actor_id', v_actor->>'actor_id',
    'actor_key', v_actor->>'actor_key',
    'actor_session_id', v_actor->>'actor_session_id',
    'actor_permissions', v_permissions,
    'staff_user_id', v_actor->>'staff_user_id',
    'staff_permissions', case when v_actor->>'actor_type' = 'staff' then v_permissions else '{}'::jsonb end,
    'admin_user_id', v_actor->>'admin_user_id',
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_features,
    'realtime_topic', v_device.realtime_topic
  ));
end;
$function$;

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

create or replace function public.refresh_operational_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_features jsonb;
  v_actor jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_generation jsonb;
  v_sync_generation jsonb;
  v_cash_generation jsonb;
  v_staff_generation jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    'refresh_operational_notifications',
    'notifications',
    60,
    60,
    120,
    'OPERATIONAL_NOTIFICATIONS_RATE_LIMITED',
    jsonb_build_object('phase', 'SHARED.TERMINAL.2')
  );

  if p_license_key is null or btrim(p_license_key) = '' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED', 'message', 'Falta licencia.');
  end if;
  if p_device_fingerprint is null or btrim(p_device_fingerprint) = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED', 'message', 'Falta identificador del dispositivo.');
  end if;

  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;
  if coalesce(v_license.status, '') not in ('active', 'expired', 'grace', 'blocked') then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  select
    d.id,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    d.device_mode
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;
  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;
  if v_device.security_token is null or nullif(p_security_token, '') is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);
  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true' then
    return jsonb_build_object(
      'success', false,
      'code', 'CLOUD_NOTIFICATIONS_DISABLED',
      'message', 'Este plan no incluye notificaciones cloud.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_actor := private.resolve_device_actor_session(
    v_license.id,
    v_device.id,
    v_device.device_mode,
    p_staff_session_token
  );
  if coalesce((v_actor->>'success')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(v_actor->>'code', 'ACTOR_SESSION_INVALID'),
      'message', 'No se pudo validar la sesion del actor.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_permissions := coalesce(v_actor->'actor_permissions', '{}'::jsonb);
  if v_actor->>'actor_type' = 'staff'
     and coalesce((v_permissions->>'notifications')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_NOTIFICATIONS_DISABLED',
      'message', 'Tu usuario staff no tiene acceso al Centro de Notificaciones.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_generation := private.generate_license_operational_notifications(v_license.id);
  if v_generation->>'success' = 'false' then return v_generation; end if;
  v_generated := v_generated + coalesce((v_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_generation->'events', '[]'::jsonb);

  v_sync_generation := private.generate_sync_operational_notifications(v_license.id);
  if v_sync_generation->>'success' = 'false' then return v_sync_generation; end if;
  v_generated := v_generated + coalesce((v_sync_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_sync_generation->'events', '[]'::jsonb);

  v_cash_generation := private.generate_cash_operational_notifications(v_license.id);
  if v_cash_generation->>'success' = 'false' then return v_cash_generation; end if;
  v_generated := v_generated + coalesce((v_cash_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_cash_generation->'events', '[]'::jsonb);

  v_staff_generation := private.generate_staff_operational_notifications(v_license.id);
  if v_staff_generation->>'success' = 'false' then return v_staff_generation; end if;
  v_generated := v_generated + coalesce((v_staff_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_staff_generation->'events', '[]'::jsonb);

  return jsonb_build_object(
    'success', true,
    'generated', v_generated,
    'events', v_events,
    'actor_type', v_actor->>'actor_type',
    'actor_key', v_actor->>'actor_key'
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        else 'REFRESH_OPERATIONAL_NOTIFICATIONS_ERROR'
      end,
      'message', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        else 'No se pudieron refrescar las notificaciones operativas.'
      end,
      'generated', 0,
      'events', '[]'::jsonb
    );
end;
$function$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ecommerce_admin_authorize_v2',
        'get_support_ticket_context',
        'validate_pos_rpc_rate_limit_context',
        'get_ai_agent_usage_unlimited',
        'refresh_operational_notifications'
      )
      and p.prosrc ilike '%v_device.device_role%'
  ) then
    raise exception 'SECONDARY_CONTEXT_DEVICE_ROLE_AUTHORITY_REMAINS';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ecommerce_admin_authorize_v2',
        'get_support_ticket_context',
        'validate_pos_rpc_rate_limit_context',
        'get_ai_agent_usage_unlimited',
        'refresh_operational_notifications'
      )
      and p.prosrc not ilike '%resolve_device_actor_session%'
  ) then
    raise exception 'SECONDARY_CONTEXT_ACTOR_RESOLVER_MISSING';
  end if;
end;
$$;
