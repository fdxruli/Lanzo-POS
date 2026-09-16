-- LICENSE.LIFECYCLE.1
-- Canonical, derived lifecycle and effective-entitlement contract.
-- Phase 1 deliberately does not mutate plan_id, features, published products,
-- orders, reservations, or any other tenant data when grace ends.

create or replace function private.license_entitlement_state_v1(p_license_id uuid)
returns table (
  license_id uuid,
  plan_code text,
  plan_name text,
  expires_at timestamptz,
  grace_period_ends timestamptz,
  lifecycle_state text,
  is_entitled boolean,
  is_in_grace boolean,
  effective_features jsonb
)
language sql
stable
security definer
set search_path = ''
as $function$
  with source as (
    select
      l.id as license_id,
      coalesce(p.code, l.license_type::text) as plan_code,
      coalesce(p.name, l.product_name::text) as plan_name,
      l.status as administrative_status,
      coalesce(l.is_lifetime, false) as is_lifetime,
      l.expires_at,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as stored_features
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.id = p_license_id
  ), classified as (
    select
      source.*,
      case
        when lower(coalesce(source.administrative_status::text, '')) <> 'active'
          then 'administratively_blocked'
        when source.is_lifetime or source.expires_at is null or now() <= source.expires_at
          then 'active'
        when now() <= source.expires_at + interval '7 days'
          then 'grace_period'
        else 'expired'
      end as derived_state
    from source
  )
  select
    classified.license_id,
    classified.plan_code,
    classified.plan_name,
    classified.expires_at,
    case
      when not classified.is_lifetime and classified.expires_at is not null
        then classified.expires_at + interval '7 days'
      else null
    end as grace_period_ends,
    classified.derived_state as lifecycle_state,
    classified.derived_state in ('active', 'grace_period') as is_entitled,
    classified.derived_state = 'grace_period' as is_in_grace,
    case
      when classified.derived_state in ('active', 'grace_period')
        then classified.stored_features
      else '{}'::jsonb
    end as effective_features
  from classified;
$function$;

revoke all on function private.license_entitlement_state_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.license_entitlement_state_v1(uuid)
  to service_role;

comment on function private.license_entitlement_state_v1(uuid) is
  'LICENSE.LIFECYCLE.1 canonical derived lifecycle. Active and seven-day grace retain plan capabilities; expired or administratively blocked licenses receive no effective features. Does not mutate license or tenant data.';

-- Every ecommerce feature resolver now consumes effective entitlement rather
-- than the persisted plan snapshot. bool/int helpers already delegate here.
create or replace function private.ecommerce_license_feature_text(
  p_license_id uuid,
  p_feature_key text
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select entitlement.effective_features ->> p_feature_key
  from private.license_entitlement_state_v1(p_license_id) entitlement
  where entitlement.is_entitled
  limit 1;
$function$;

revoke all on function private.ecommerce_license_feature_text(uuid,text)
  from public, anon, authenticated;
grant execute on function private.ecommerce_license_feature_text(uuid,text)
  to service_role;

-- Period creation is entitlement-aware and can never extend beyond the paid
-- license boundary. Existing ended periods are closed idempotently. During
-- grace no replacement paid period is created: grace retains capabilities but
-- is not a new billing/usage period.
create or replace function public.ensure_current_license_period(p_license_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_entitlement record;
  v_existing_period record;
  v_effective_features jsonb := '{}'::jsonb;
  v_period_type text := 'admin_grant';
  v_limit integer := 0;
  v_start timestamptz := now();
  v_end timestamptz;
  v_new_period_id uuid;
begin
  update public.license_periods lp
     set status = 'expired',
         closed_at = coalesce(lp.closed_at, now()),
         metadata = coalesce(lp.metadata, '{}'::jsonb)
           || jsonb_build_object('auto_expired_at', now())
   where lp.license_id = p_license_id
     and lp.status = 'active'
     and lp.ends_at is not null
     and lp.ends_at <= now();

  select *
    into v_existing_period
    from public.license_periods lp
   where lp.license_id = p_license_id
     and lp.status = 'active'
     and lp.starts_at <= now()
     and (lp.ends_at is null or lp.ends_at > now())
   order by lp.starts_at desc
   limit 1;

  if v_existing_period.id is not null then
    return v_existing_period.id;
  end if;

  select
    l.id,
    l.license_key,
    l.plan_id,
    l.license_type,
    l.is_lifetime,
    p.code as plan_code,
    p.name as plan_name
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  for update of l;

  if v_license.id is null then
    return null;
  end if;

  select * into v_entitlement
  from private.license_entitlement_state_v1(v_license.id);

  if v_entitlement.is_entitled is not true then
    return null;
  end if;

  if v_entitlement.lifecycle_state = 'grace_period' then
    -- Grace extends entitlement, not the commercial period. Reuse the most
    -- recent period for usage accounting without creating a period beyond
    -- licenses.expires_at.
    select lp.id
      into v_new_period_id
      from public.license_periods lp
     where lp.license_id = p_license_id
       and lp.starts_at <= now()
     order by coalesce(lp.ends_at, lp.starts_at) desc, lp.starts_at desc
     limit 1;
    return v_new_period_id;
  end if;

  v_effective_features := coalesce(v_entitlement.effective_features, '{}'::jsonb);
  v_limit := greatest(coalesce((v_effective_features->>'ai_agent_total_limit')::integer, 0), 0);

  v_period_type := case
    when v_license.plan_code = 'free_trial' then 'trial'
    when v_license.plan_code = 'pro_monthly' then 'pro_paid'
    when v_license.plan_code = 'basic_monthly' then 'basic_paid'
    else 'admin_grant'
  end;

  v_start := now();

  if coalesce(v_license.is_lifetime, false) then
    v_end := null;
  elsif v_entitlement.expires_at is not null then
    v_end := least(v_start + interval '1 month', v_entitlement.expires_at);
  else
    v_end := v_start + interval '1 month';
  end if;

  if v_end is not null and v_end <= v_start then
    return null;
  end if;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license.id, v_license.plan_id,
    coalesce(v_license.plan_code, v_license.license_type::text, 'unknown'),
    coalesce(v_license.plan_name, 'Plan no especificado'),
    v_period_type, 'active', v_start, v_end, v_limit,
    jsonb_build_object(
      'source', 'ensure_current_license_period',
      'auto_created', true,
      'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
    )
  ) returning id into v_new_period_id;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license.license_key,
    'PERIOD_CREATED',
    jsonb_build_object(
      'source', 'ensure_current_license_period',
      'period_id', v_new_period_id,
      'plan_code', v_license.plan_code,
      'starts_at', v_start,
      'ends_at', v_end,
      'ai_agent_limit', v_limit,
      'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
    )
  );

  return v_new_period_id;
end;
$function$;

-- Ecommerce administrative capabilities use the same effective entitlement.
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
    p_license_key, p_device_fingerprint, null,
    coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_admin'),
    'ECOM_ADMIN', 180, 600, 300, 'ECOMMERCE_RATE_LIMITED',
    jsonb_build_object('actor_partition', 'device')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_RATE_LIMITED');
  end if;

  select
    l.id as license_id,
    entitlement.plan_code,
    entitlement.plan_name,
    entitlement.lifecycle_state,
    entitlement.is_entitled,
    entitlement.is_in_grace,
    entitlement.grace_period_ends,
    entitlement.effective_features
  into v_license
  from public.licenses l
  cross join lateral private.license_entitlement_state_v1(l.id) entitlement
  where l.license_key = p_license_key
  limit 1;

  if v_license.license_id is null
     or v_license.lifecycle_state = 'administratively_blocked' then
    return private.ecommerce_admin_error('LICENSE_NOT_ACTIVE');
  end if;
  if v_license.is_entitled is not true then
    return private.ecommerce_admin_error('LICENSE_EXPIRED');
  end if;
  if coalesce((v_license.effective_features->>'ecommerce_portal_enabled')::boolean, false) is not true then
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
    v_license.license_id, v_device.device_id, v_device.device_mode, p_staff_session_token
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
      'features', v_license.effective_features,
      'license_lifecycle_state', v_license.lifecycle_state,
      'license_is_in_grace', v_license.is_in_grace,
      'license_grace_period_ends', v_license.grace_period_ends
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
    'features', v_license.effective_features,
    'license_lifecycle_state', v_license.lifecycle_state,
    'license_is_in_grace', v_license.is_in_grace,
    'license_grace_period_ends', v_license.grace_period_ends
  );
exception
  when others then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
end;
$function$;

-- Support uses the canonical POS actor context rather than maintaining a
-- third independent seven-day calculation.
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
  v_context jsonb;
  v_features jsonb;
  v_permissions jsonb := '{}'::jsonb;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token, p_rpc_name,
    'support', 90, 60, 120, 'SUPPORT_RPC_RATE_LIMITED',
    jsonb_build_object('phase', 'LICENSE.LIFECYCLE.1')
  );

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_features := coalesce(v_context->'features', '{}'::jsonb);

  if (v_features->>'support_center') is distinct from 'true'
     or (v_features->>'support_tickets') is distinct from 'true'
     or coalesce(v_features->>'support_channel', 'email') <> 'in_app' then
    return jsonb_build_object(
      'success', false,
      'code', 'SUPPORT_CENTER_DISABLED',
      'message', 'Este plan no incluye soporte interno.'
    );
  end if;

  v_permissions := coalesce(v_context->'actor_permissions', '{}'::jsonb);
  if v_context->>'actor_type' = 'staff'
     and coalesce((v_permissions->>'support_center')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_SUPPORT_DISABLED',
      'message', 'Tu usuario staff no tiene acceso a soporte Lanzo.'
    );
  end if;

  return v_context || jsonb_build_object('success', true);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(nullif(sqlerrm, ''), 'SUPPORT_CONTEXT_ERROR'),
      'message', 'No se pudo validar el contexto seguro de soporte.'
    );
end;
$function$;

revoke all on function public.ensure_current_license_period(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_current_license_period(uuid)
  to service_role;

-- Admin-session validation participates in the same lifecycle contract so a
-- valid owner session remains usable during grace and fails after grace.
create or replace function private.require_active_admin_session(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_admin_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_session record;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_device_security_token, '')), '') is null
     or nullif(btrim(coalesce(p_admin_session_token, '')), '') is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_REQUIRED');
  end if;

  select
    l.id as license_id,
    l.license_key,
    entitlement.lifecycle_state,
    entitlement.is_entitled,
    entitlement.is_in_grace,
    entitlement.grace_period_ends
  into v_license
  from public.licenses l
  cross join lateral private.license_entitlement_state_v1(l.id) entitlement
  where l.license_key = p_license_key
  limit 1;

  if v_license.license_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;
  if v_license.lifecycle_state = 'administratively_blocked' then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;
  if v_license.is_entitled is not true then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_EXPIRED');
  end if;

  select d.id as device_id, d.device_mode, d.device_role as legacy_device_role
  into v_device
  from public.license_devices d
  where d.license_id = v_license.license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared')
    and (d.security_token = p_device_security_token or d.previous_security_token = p_device_security_token)
  limit 1;

  if v_device.device_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_DEVICE_REQUIRED');
  end if;

  select candidate.id as session_id, candidate.admin_user_id, candidate.expires_at,
         u.username, u.display_name
  into v_session
  from (
    select s.id, s.admin_user_id, s.session_token_hash, s.expires_at, s.created_at
    from public.license_admin_sessions s
    where s.license_id = v_license.license_id
      and s.device_id = v_device.device_id
      and s.revoked_at is null
    order by s.created_at desc
    limit 3
  ) candidate
  join public.license_admin_users u on u.id = candidate.admin_user_id
  where u.license_id = v_license.license_id
    and u.is_owner is true
    and u.is_active is true
    and extensions.crypt(p_admin_session_token, candidate.session_token_hash) = candidate.session_token_hash
  limit 1;

  if v_session.session_id is null then
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_INVALID');
  end if;

  if v_session.expires_at <= now() then
    update public.license_admin_sessions
    set revoked_at = coalesce(revoked_at, now())
    where id = v_session.session_id;
    return jsonb_build_object('success', false, 'valid', false, 'code', 'ADMIN_SESSION_EXPIRED');
  end if;

  update public.license_admin_sessions
  set last_used_at = now()
  where id = v_session.session_id
    and last_used_at < now() - interval '30 seconds';

  return jsonb_build_object(
    'success', true,
    'valid', true,
    'license_id', v_license.license_id,
    'device_id', v_device.device_id,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.legacy_device_role,
    'admin_session_id', v_session.session_id,
    'admin_user_id', v_session.admin_user_id,
    'admin_user', jsonb_build_object(
      'id', v_session.admin_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'is_owner', true
    ),
    'expires_at', v_session.expires_at,
    'license_lifecycle_state', v_license.lifecycle_state,
    'license_is_in_grace', v_license.is_in_grace,
    'license_grace_period_ends', v_license.grace_period_ends
  );
end;
$function$;

-- Canonical cloud/ActorRuntime authorization boundary. All feature assertions
-- downstream consume the entitlement-filtered features returned here.
create or replace function private.validate_pos_sync_context(
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
  v_actor_token text := nullif(btrim(coalesce(p_staff_session_token, '')), '');
  v_admin_auth jsonb := null;
  v_admin_valid boolean := false;
  v_staff_session record;
  v_staff_valid boolean := false;
  v_actor_type text;
  v_actor_id uuid;
  v_actor_session_id uuid;
  v_actor_permissions jsonb := '{}'::jsonb;
  v_staff_payload jsonb := null;
  v_admin_payload jsonb := null;
begin
  select
    l.id,
    l.license_key,
    entitlement.plan_code,
    entitlement.plan_name,
    entitlement.expires_at,
    entitlement.grace_period_ends,
    entitlement.lifecycle_state,
    entitlement.is_entitled,
    entitlement.is_in_grace,
    entitlement.effective_features
  into v_license
  from public.licenses l
  cross join lateral private.license_entitlement_state_v1(l.id) entitlement
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    raise exception 'LICENSE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_license.lifecycle_state = 'administratively_blocked' then
    raise exception 'LICENSE_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_license.is_entitled is not true then
    raise exception 'LICENSE_EXPIRED' using errcode = 'P0001';
  end if;

  select d.id, d.license_id, d.device_fingerprint, d.security_token,
         d.previous_security_token, d.is_active, d.device_mode,
         d.device_role as legacy_device_role,
         d.staff_user_id as legacy_staff_user_id, d.realtime_topic
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then raise exception 'DEVICE_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v_device.is_active is not true then raise exception 'DEVICE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  if v_device.security_token is null or nullif(p_security_token, '') is null then
    raise exception 'DEVICE_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    raise exception 'DEVICE_TOKEN_INVALID' using errcode = 'P0001';
  end if;
  if v_actor_token is null then raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001'; end if;

  v_features := coalesce(v_license.effective_features, '{}'::jsonb);

  if v_device.device_mode in ('admin_only', 'shared') then
    v_admin_auth := private.require_active_admin_session(
      p_license_key, p_device_fingerprint, p_security_token, v_actor_token
    );
    v_admin_valid := coalesce((v_admin_auth->>'success')::boolean, false);
  end if;

  if v_device.device_mode in ('staff_only', 'shared') then
    select ss.id as session_id, ss.expires_at, s.id as staff_user_id,
           s.username, s.display_name, s.role_name, s.permissions,
           s.is_active as staff_is_active
    into v_staff_session
    from public.license_staff_sessions ss
    join public.license_staff_users s on s.id = ss.staff_user_id
    where ss.license_id = v_license.id
      and ss.device_id = v_device.id
      and s.license_id = v_license.id
      and ss.revoked_at is null
      and extensions.crypt(v_actor_token, ss.session_token_hash) = ss.session_token_hash
    order by ss.created_at desc
    limit 1;

    if v_staff_session.session_id is not null then
      if v_staff_session.expires_at <= now() then
        update public.license_staff_sessions
        set revoked_at = coalesce(revoked_at, now())
        where id = v_staff_session.session_id;
        raise exception 'STAFF_SESSION_EXPIRED' using errcode = 'P0001';
      end if;
      if v_staff_session.staff_is_active is not true then
        raise exception 'STAFF_USER_INACTIVE' using errcode = 'P0001';
      end if;
      v_staff_valid := true;
    end if;
  end if;

  if v_admin_valid and v_staff_valid then
    raise exception 'ACTOR_SESSION_AMBIGUOUS' using errcode = 'P0001';
  end if;
  if not v_admin_valid and not v_staff_valid then
    raise exception 'ACTOR_SESSION_INVALID' using errcode = 'P0001';
  end if;

  if v_admin_valid then
    v_actor_type := 'admin';
    v_actor_id := (v_admin_auth->>'admin_user_id')::uuid;
    v_actor_session_id := (v_admin_auth->>'admin_session_id')::uuid;
    v_actor_permissions := jsonb_build_object('*', true);
    v_admin_payload := v_admin_auth->'admin_user';
  else
    v_actor_type := 'staff';
    v_actor_id := v_staff_session.staff_user_id;
    v_actor_session_id := v_staff_session.session_id;
    v_actor_permissions := coalesce(v_staff_session.permissions, '{}'::jsonb);
    v_staff_payload := jsonb_build_object(
      'id', v_staff_session.staff_user_id,
      'username', v_staff_session.username,
      'display_name', v_staff_session.display_name,
      'role_name', v_staff_session.role_name,
      'permissions', v_actor_permissions
    );
    perform private.touch_license_staff_session_seen(v_staff_session.session_id, '30 seconds'::interval);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.legacy_device_role,
    'actor_type', v_actor_type,
    'actor_id', v_actor_id,
    'actor_key', v_actor_type || ':' || v_actor_id::text,
    'actor_session_id', v_actor_session_id,
    'actor_permissions', v_actor_permissions,
    'device_role', v_actor_type,
    'staff_user_id', case when v_actor_type = 'staff' then v_actor_id else null end,
    'staff_permissions', case when v_actor_type = 'staff' then v_actor_permissions else '{}'::jsonb end,
    'staff_user', v_staff_payload,
    'admin_user_id', case when v_actor_type = 'admin' then v_actor_id else null end,
    'admin_session_id', case when v_actor_type = 'admin' then v_actor_session_id else null end,
    'admin_user', v_admin_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', v_features,
    'realtime_topic', v_device.realtime_topic,
    'license_lifecycle_state', v_license.lifecycle_state,
    'license_is_in_grace', v_license.is_in_grace,
    'license_expires_at', v_license.expires_at,
    'license_grace_period_ends', v_license.grace_period_ends
  ));
end;
$function$;

-- AI shares the cloud/ActorRuntime entitlement boundary. Grace reuses the
-- latest commercial period for counters; no new paid period is minted.
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
  v_context jsonb;
  v_license_id uuid;
  v_f jsonb;
  v_pid uuid;
  v_p record;
  v_used integer := 0;
  v_limit integer := 0;
begin
  begin
    v_context := private.validate_pos_sync_context(
      p_license_key,
      p_device_fingerprint,
      p_device_security_token,
      p_staff_session_token
    );
  exception
    when others then
      return jsonb_build_object(
        'success', false,
        'code', coalesce(nullif(sqlerrm, ''), 'LICENSE_NOT_ACTIVE'),
        'limit', 0,
        'used', 0,
        'remaining', 0,
        'ai_agents', false
      );
  end;

  v_license_id := nullif(v_context->>'license_id', '')::uuid;
  v_f := coalesce(v_context->'features', '{}'::jsonb);

  if coalesce((v_f->>'ai_agents')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENTS_NOT_AVAILABLE',
      'plan_code', v_context->>'plan_code',
      'plan_name', v_context->>'plan_name',
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'ai_agents', false
    );
  end if;

  if v_context->>'actor_type' = 'staff'
     and not coalesce(
       jsonb_typeof((v_context->'actor_permissions')->'ai_agents') = 'boolean'
       and (v_context->'actor_permissions')->'ai_agents' = 'true'::jsonb,
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
      'actor_key', v_context->>'actor_key'
    );
  end if;

  v_pid := public.ensure_current_license_period(v_license_id);
  if v_pid is null then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENT_PERIOD_NOT_FOUND',
      'plan_code', v_context->>'plan_code',
      'plan_name', v_context->>'plan_name',
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'ai_agents', true
    );
  end if;

  select * into v_p
  from public.license_periods
  where id = v_pid;

  v_limit := greatest(coalesce(v_p.ai_agent_limit, 0), 0);
  select count(*)::integer into v_used
  from public.ai_agent_usage u
  where u.license_id = v_license_id
    and u.period_id = v_pid
    and u.status in ('reserved', 'completed');

  return jsonb_build_object(
    'success', v_limit > 0,
    'code', case when v_limit > 0 then null else 'AI_AGENT_LIMIT_DISABLED' end,
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'plan_code', v_context->>'plan_code',
    'plan_name', v_context->>'plan_name',
    'ai_agents', true,
    'period_id', v_pid,
    'period_type', v_p.period_type,
    'period_status', v_p.status,
    'period_start', v_p.starts_at,
    'period_end', v_p.ends_at,
    'actor_type', v_context->>'actor_type',
    'actor_key', v_context->>'actor_key',
    'license_lifecycle_state', v_context->>'license_lifecycle_state',
    'license_is_in_grace', coalesce((v_context->>'license_is_in_grace')::boolean, false)
  );
end;
$function$;

-- Device verification now reports the canonical lifecycle instead of owning a
-- separate grace-day calculation.
create or replace function public.verify_device_license_unified_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_staff_user record;
  v_new_token text;
  v_latest_term_id uuid;
  v_latest_term_version text;
  v_terms_accepted boolean := true;
  v_realtime_topic text;
  v_staff_roles_enabled boolean;
  v_staff_user_payload jsonb;
  v_block jsonb;
  v_block_reason text;
  v_block_message text;
begin
  select
    l.id,
    l.status,
    l.product_name,
    l.license_key,
    coalesce(l.max_devices, p.max_devices, 1) as max_devices,
    entitlement.plan_code,
    entitlement.plan_name,
    entitlement.expires_at,
    entitlement.grace_period_ends,
    entitlement.lifecycle_state,
    entitlement.is_entitled,
    entitlement.is_in_grace,
    entitlement.effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  cross join lateral private.license_entitlement_state_v1(l.id) entitlement
  where l.license_key = p_license_key;

  if v_license.id is null then
    return jsonb_build_object('valid', false, 'status', 'not_found', 'reason', 'LICENSE_NOT_FOUND');
  end if;
  if v_license.lifecycle_state = 'administratively_blocked' then
    return jsonb_build_object('valid', false, 'status', 'suspended', 'reason', 'LICENSE_SUSPENDED');
  end if;
  if v_license.is_entitled is not true then
    return jsonb_build_object(
      'valid', false,
      'status', 'expired',
      'reason', 'LICENSE_EXPIRED',
      'expires_at', v_license.expires_at,
      'grace_period_ends', v_license.grace_period_ends,
      'max_devices', v_license.max_devices,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name
    );
  end if;

  v_staff_roles_enabled := coalesce((v_license.effective_features->>'staff_roles')::boolean, false);

  select id, device_name, security_token, previous_security_token, is_active,
         realtime_topic, device_role, device_mode, staff_user_id, device_info
  into v_device
  from public.license_devices
  where license_id = v_license.id
    and device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object(
      'valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED',
      'message', 'Este dispositivo no esta autorizado para esta licencia.',
      'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name
    );
  end if;

  v_block := coalesce(v_device.device_info->'license_block', '{}'::jsonb);
  v_block_reason := nullif(v_block->>'reason', '');
  v_block_message := nullif(v_block->>'message', '');

  if v_device.is_active = false then
    return jsonb_build_object(
      'valid', false,
      'status', 'device_banned',
      'reason', 'DEVICE_NOT_ALLOWED',
      'block_reason', coalesce(v_block_reason, 'DEVICE_NOT_ALLOWED'),
      'message', coalesce(v_block_message, 'Este dispositivo fue desactivado o ya no esta permitido en esta licencia.'),
      'license_key', v_license.license_key,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'device_mode', v_device.device_mode,
      'device_role', v_device.device_role
    );
  end if;

  if v_device.device_mode = 'staff_only' and not v_staff_roles_enabled then
    update public.license_devices d
    set is_active = false,
        security_token = null,
        previous_security_token = null,
        last_check_at = now(),
        device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
          'license_block', jsonb_build_object(
            'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
            'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia o pide al administrador actualizar el plan.',
            'plan_code', v_license.plan_code,
            'plan_name', v_license.plan_name,
            'blocked_at', now()
          )
        )
    where d.id = v_device.id;

    update public.license_staff_sessions s
    set revoked_at = coalesce(s.revoked_at, now()),
        metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
          'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
          'revoked_at', now(),
          'plan_code', v_license.plan_code,
          'plan_name', v_license.plan_name
        )
    where s.license_id = v_license.id
      and s.device_id = v_device.id
      and s.revoked_at is null;

    return jsonb_build_object(
      'valid', false,
      'status', 'device_banned',
      'reason', 'DEVICE_NOT_ALLOWED',
      'block_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
      'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia para continuar en este equipo.',
      'license_key', v_license.license_key,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'device_mode', v_device.device_mode,
      'device_role', v_device.device_role
    );
  end if;

  if v_device.device_mode = 'staff_only' and v_staff_roles_enabled then
    select id, username, display_name, role_name, permissions, is_active
    into v_staff_user
    from public.license_staff_users
    where id = v_device.staff_user_id
      and license_id = v_license.id;

    if v_device.staff_user_id is null
       or v_staff_user.id is null
       or v_staff_user.is_active = false then
      return jsonb_build_object(
        'valid', false,
        'status', 'staff_login_required',
        'reason', 'STAFF_LOGIN_REQUIRED',
        'staff_login_required', true,
        'device_mode', v_device.device_mode,
        'device_role', 'staff'
      );
    end if;

    v_staff_user_payload := jsonb_build_object(
      'id', v_staff_user.id,
      'username', v_staff_user.username,
      'display_name', v_staff_user.display_name,
      'role_name', v_staff_user.role_name,
      'permissions', v_staff_user.permissions
    );
  else
    v_staff_user_payload := null;
  end if;

  if v_device.realtime_topic is null then
    update public.license_devices
    set realtime_topic = private.generate_license_realtime_topic()
    where id = v_device.id
    returning realtime_topic into v_realtime_topic;
  else
    v_realtime_topic := v_device.realtime_topic;
  end if;

  select id, version
  into v_latest_term_id, v_latest_term_version
  from public.legal_terms
  where type = 'terms_of_use'
    and is_active = true
  order by published_at desc
  limit 1;

  if v_latest_term_id is not null then
    select exists (
      select 1
      from public.legal_acceptances
      where license_id = v_license.id
        and term_id = v_latest_term_id
    ) into v_terms_accepted;
  end if;

  if v_device.security_token is not null then
    if p_security_token is null or p_security_token = '' then
      return jsonb_build_object('valid', false, 'status', 'token_required', 'reason', 'DEVICE_TOKEN_REQUIRED');
    elsif p_security_token <> v_device.security_token
       and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
      return jsonb_build_object('valid', false, 'status', 'cloned', 'reason', 'CLONING_DETECTED');
    end if;

    update public.license_devices
    set last_used_at = now(), last_check_at = now()
    where id = v_device.id;
    v_new_token := v_device.security_token;
  else
    v_new_token := extensions.gen_random_uuid()::text;
    update public.license_devices
    set previous_security_token = security_token,
        security_token = v_new_token,
        last_used_at = now(),
        last_check_at = now()
    where id = v_device.id;
  end if;

  return jsonb_build_object(
    'valid', true,
    'status', case when v_license.is_in_grace then 'grace_period' else 'active' end,
    'license_status', v_license.status,
    'license_key', v_license.license_key,
    'product_name', v_license.product_name,
    'max_devices', v_license.max_devices,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_license.effective_features, '{}'::jsonb),
    'device_name', v_device.device_name,
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
    'device_role', v_device.device_role,
    'actor_auth_required', v_device.device_mode = 'shared',
    'staff_user', v_staff_user_payload,
    'expires_at', v_license.expires_at,
    'grace_period_ends', case when v_license.is_in_grace then v_license.grace_period_ends else null end,
    'new_security_token', v_new_token,
    'realtime_topic', case
      when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false)
        then v_realtime_topic
      else null
    end,
    'legal_status', jsonb_build_object(
      'has_updated_terms', not v_terms_accepted,
      'latest_version', v_latest_term_version,
      'term_id', v_latest_term_id
    )
  );
end;
$function$;

-- Product/inventory actor authorization historically consumed this context.
-- Delegate to the canonical cloud boundary to avoid another expiry formula.
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
  v_context jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null then
    return jsonb_build_object(
      'success', false, 'allowed', false, 'code', 'LICENSE_KEY_REQUIRED',
      'message', 'Licencia requerida.'
    );
  end if;
  if nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null then
    return jsonb_build_object(
      'success', false, 'allowed', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED',
      'message', 'Dispositivo requerido.'
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
    );
  exception
    when others then
      return jsonb_build_object(
        'success', false,
        'allowed', false,
        'code', coalesce(nullif(sqlerrm, ''), 'POS_CONTEXT_INVALID'),
        'message', 'No se pudo validar el contexto seguro del dispositivo y actor.'
      );
  end;

  return v_context || jsonb_build_object('success', true, 'allowed', true);
end;
$function$;

-- NOTIF.5 intentionally reads the stored notification flags so it can emit
-- the terminal expired notice, but its grace/expired classification comes from
-- the canonical lifecycle contract. This is notification delivery, not a Pro
-- capability grant.
create or replace function private.generate_license_operational_notifications(
  p_license_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_now timestamptz := now();
  v_expiry_date text;
  v_days_until integer;
  v_event_key text;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  for v_license in
    select
      l.id,
      entitlement.expires_at,
      entitlement.grace_period_ends,
      entitlement.lifecycle_state,
      entitlement.plan_code,
      entitlement.plan_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as notification_features
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    cross join lateral private.license_entitlement_state_v1(l.id) entitlement
    where (p_license_id is null or l.id = p_license_id)
      and coalesce(l.is_lifetime, false) is false
      and l.expires_at is not null
      and entitlement.lifecycle_state <> 'administratively_blocked'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'notification_center') = 'true'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'cloud_notifications') = 'true'
  loop
    v_expiry_date := to_char(v_license.expires_at::date, 'YYYY-MM-DD');

    if v_license.lifecycle_state = 'active'
       and v_license.expires_at >= v_now
       and v_license.expires_at <= v_now + interval '7 days' then
      v_days_until := greatest(ceil(extract(epoch from (v_license.expires_at - v_now)) / 86400.0)::integer, 1);
      v_event_key := 'license_expiring_7d:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'warning',
        p_title => 'Lanzo Nube vence pronto',
        p_body => 'Tu plan Lanzo Nube vence en ' || v_days_until || ' días. Renueva para evitar interrupciones.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.5', 'event', 'license_expiring_7d',
          'expires_at', v_license.expires_at,
          'days_until_expiration', v_days_until,
          'plan_code', v_license.plan_code,
          'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
        ),
        p_source => 'license',
        p_expires_at => v_license.expires_at + interval '1 day'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expiring_7d'));
    end if;

    if v_license.lifecycle_state = 'active'
       and v_license.expires_at >= v_now
       and v_license.expires_at <= v_now + interval '3 days' then
      v_days_until := greatest(ceil(extract(epoch from (v_license.expires_at - v_now)) / 86400.0)::integer, 1);
      v_event_key := 'license_expiring_3d:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'warning',
        p_title => 'Lanzo Nube vence en pocos días',
        p_body => 'Tu plan Lanzo Nube vence en ' || v_days_until || ' días. El cloud, staff y soporte interno dependen de la renovación.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.5', 'event', 'license_expiring_3d',
          'expires_at', v_license.expires_at,
          'days_until_expiration', v_days_until,
          'plan_code', v_license.plan_code,
          'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
        ),
        p_source => 'license',
        p_expires_at => v_license.expires_at + interval '1 day'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expiring_3d'));
    end if;

    if v_license.lifecycle_state = 'grace_period' then
      v_event_key := 'license_grace_period:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'critical',
        p_title => 'Lanzo Nube está en periodo de gracia',
        p_body => 'Tu plan venció. El sistema puede bloquearse si no renuevas antes de terminar el periodo de gracia.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.5', 'event', 'license_grace_period',
          'expires_at', v_license.expires_at,
          'grace_period_ends', v_license.grace_period_ends,
          'plan_code', v_license.plan_code,
          'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
        ),
        p_source => 'license',
        p_expires_at => v_license.grace_period_ends + interval '1 day'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_grace_period'));
    end if;

    if v_license.lifecycle_state = 'expired' then
      v_event_key := 'license_expired:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'critical',
        p_title => 'Lanzo Nube expiró',
        p_body => 'Tu plan Lanzo Nube expiró y requiere renovación para recuperar el servicio cloud.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.5', 'event', 'license_expired',
          'expires_at', v_license.expires_at,
          'grace_period_ends', v_license.grace_period_ends,
          'plan_code', v_license.plan_code,
          'lifecycle_contract', 'LICENSE.LIFECYCLE.1'
        ),
        p_source => 'license',
        p_expires_at => v_now + interval '30 days'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expired'));
    end if;
  end loop;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'GENERATE_OPERATIONAL_NOTIFICATIONS_ERROR',
      'message', 'Could not generate operational notifications.'
    );
end;
$function$;
