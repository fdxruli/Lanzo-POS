-- LICENSE.LIFECYCLE.4.1
--
-- A paid activation is idempotent by default.  This dedicated administrative
-- operation is the explicit intent for extending an already active paid term;
-- callers supply an opaque idempotency key so retried requests cannot mint a
-- second period.

begin;

create or replace function private.renew_active_paid_license_v1(
  p_license_id uuid,
  p_duration_months integer,
  p_idempotency_key text,
  p_reason text default null,
  p_actor jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_entitlement record;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_previous_period_id uuid;
  v_new_period_id uuid;
  v_actor jsonb;
  v_existing_event record;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  if coalesce(p_duration_months, 0) < 1
     or coalesce(p_duration_months, 0) > 120 then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'INVALID_DURATION_MONTHS');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
  end if;

  select l.id,
         l.license_key,
         l.plan_id,
         l.status,
         l.is_lifetime,
         l.license_type,
         l.features,
         l.max_devices,
         p.code as plan_code,
         p.name as plan_name,
         p.price,
         p.features as plan_features
    into v_license
    from public.licenses l
    join public.plans p on p.id = l.plan_id
   where l.id = p_license_id
   for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  if lower(coalesce(v_license.status::text, '')) <> 'active' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ADMINISTRATIVELY_BLOCKED',
      'license_id', v_license.id,
      'administrative_status', v_license.status
    );
  end if;

  if coalesce(v_license.is_lifetime, false)
     or v_license.plan_code = 'free_trial'
     or coalesce(v_license.price, 0) <= 0 then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'CURRENT_PLAN_NOT_PAID');
  end if;

  -- The license row lock serializes this check with another renewal using the
  -- same key, and with the Phase 2/4 transition primitives.
  select e.metadata
    into v_existing_event
    from public.license_events e
   where e.license_key = v_license.license_key
     and e.event_type = 'PLAN_CHANGED'
     and e.metadata->>'operation' = 'explicit_paid_renewal'
     and e.metadata->>'idempotency_key' = btrim(p_idempotency_key)
   order by e.triggered_at desc, e.id desc
   limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ALREADY_RENEWED',
      'license_id', v_license.id,
      'plan_code', v_license.plan_code,
      'period_id', v_existing_event.metadata->>'new_period_id'
    );
  end if;

  select *
    into v_entitlement
    from private.license_entitlement_state_v1(v_license.id);

  if v_entitlement.lifecycle_state <> 'active'
     or v_entitlement.is_entitled is not true then
    return jsonb_build_object(
      'success', false,
      'changed', false,
      'code', 'LICENSE_NOT_ACTIVE_FOR_RENEWAL',
      'license_id', v_license.id,
      'lifecycle_state', v_entitlement.lifecycle_state
    );
  end if;

  v_expires_at := v_now + make_interval(months => p_duration_months);
  v_actor := coalesce(
    p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'service_role',
      'request_subject', nullif(current_setting('request.jwt.claim.sub', true), '')
    ))
  );

  select lp.id
    into v_previous_period_id
    from public.license_periods lp
   where lp.license_id = v_license.id
     and lp.status = 'active'
   order by lp.starts_at desc, lp.id desc
   limit 1
   for update;

  update public.license_periods lp
     set status = 'closed',
         ends_at = case
           when lp.ends_at is null or lp.ends_at > v_now then v_now
           else lp.ends_at
         end,
         closed_at = coalesce(lp.closed_at, v_now),
         metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
           'closed_by', 'renew_active_paid_license_v1',
           'closed_reason', 'explicit_paid_renewal',
           'closed_at', v_now,
           'renewal_idempotency_key', btrim(p_idempotency_key)
         )
   where lp.license_id = v_license.id
     and lp.status = 'active';

  -- No plan is changed here: the current paid snapshot remains authoritative
  -- and its feature payload is intentionally preserved exactly.
  update public.licenses l
     set expires_at = v_expires_at,
         duration_months = p_duration_months,
         is_lifetime = false,
         status = 'active'
   where l.id = v_license.id;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license.id, v_license.plan_id, v_license.plan_code, v_license.plan_name,
    case
      when v_license.plan_code = 'pro_monthly' then 'pro_paid'
      when v_license.plan_code = 'basic_monthly' then 'basic_paid'
      else 'admin_grant'
    end,
    'active', v_now, v_expires_at,
    greatest(coalesce((coalesce(v_license.plan_features, '{}'::jsonb)->>'ai_agent_total_limit')::integer, 0), 0),
    jsonb_build_object(
      'source', 'renew_active_paid_license_v1',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'administrative_paid_renewal'),
      'previous_period_id', v_previous_period_id,
      'actor', v_actor,
      'duration_months', p_duration_months,
      'idempotency_key', btrim(p_idempotency_key),
      'renewed_at', v_now
    )
  )
  returning id into v_new_period_id;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license.license_key,
    'PLAN_CHANGED',
    jsonb_build_object(
      'source', 'renew_active_paid_license_v1',
      'operation', 'explicit_paid_renewal',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'administrative_paid_renewal'),
      'previous_plan', v_license.plan_code,
      'new_plan', v_license.plan_code,
      'previous_period_id', v_previous_period_id,
      'new_period_id', v_new_period_id,
      'idempotency_key', btrim(p_idempotency_key),
      'actor', v_actor,
      'renewed_at', v_now
    )
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'code', 'LICENSE_RENEWED',
    'license_id', v_license.id,
    'plan_code', v_license.plan_code,
    'duration_months', p_duration_months,
    'expires_at', v_expires_at,
    'previous_period_id', v_previous_period_id,
    'period_id', v_new_period_id
  );
end;
$function$;

alter function private.renew_active_paid_license_v1(uuid, integer, text, text, jsonb) owner to postgres;
revoke all on function private.renew_active_paid_license_v1(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.renew_active_paid_license_v1(uuid, integer, text, text, jsonb)
  to service_role;

create or replace function public.admin_renew_active_paid_license_v1(
  p_license_key text,
  p_duration_months integer,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_KEY_REQUIRED');
  end if;

  select l.id
    into v_license_id
    from public.licenses l
   where l.license_key = p_license_key;

  if v_license_id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  return private.renew_active_paid_license_v1(
    v_license_id,
    p_duration_months,
    p_idempotency_key,
    p_reason,
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'service_role',
      'request_subject', nullif(current_setting('request.jwt.claim.sub', true), '')
    ))
  );
end;
$function$;

alter function public.admin_renew_active_paid_license_v1(text, integer, text, text) owner to postgres;
revoke all on function public.admin_renew_active_paid_license_v1(text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_renew_active_paid_license_v1(text, integer, text, text)
  to service_role;

do $preflight$
begin
  if has_function_privilege('public', 'private.renew_active_paid_license_v1(uuid,integer,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.renew_active_paid_license_v1(uuid,integer,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.renew_active_paid_license_v1(uuid,integer,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'private.renew_active_paid_license_v1(uuid,integer,text,text,jsonb)', 'execute') then
    raise exception 'LICENSE_LIFECYCLE_4_RENEWAL_ACL_INVALID';
  end if;
end;
$preflight$;

commit;
