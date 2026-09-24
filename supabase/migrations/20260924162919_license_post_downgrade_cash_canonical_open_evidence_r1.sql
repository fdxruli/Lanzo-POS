create or replace function private.post_downgrade_cash_session_evidence_v1(
  p_license_id uuid,
  p_cash_session_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_boundary jsonb;
  v_session public.pos_cash_sessions;
  v_license_key text;
  v_opening_plan_event public.license_events;
  v_opening_plan public.plans;
  v_has_open_audit boolean := false;
  v_has_open_sync boolean := false;
begin
  v_boundary := private.post_downgrade_cash_boundary_v1(p_license_id);
  if v_boundary is null then
    return null;
  end if;

  select s.* into v_session
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null
     or v_session.status <> 'open'
     or v_session.opened_at >= (v_boundary->>'downgraded_at')::timestamptz then
    return null;
  end if;

  select l.license_key into v_license_key
  from public.licenses l
  where l.id = p_license_id;

  select e.* into v_opening_plan_event
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'PLAN_CHANGED'
    and e.metadata->>'source' = 'licenses_update_trigger'
    and nullif(e.metadata->>'to_plan', '') is not null
    and e.triggered_at <= v_session.opened_at
  order by e.triggered_at desc, e.id desc
  limit 1;

  if v_opening_plan_event.id is null then
    return null;
  end if;

  select p.* into v_opening_plan
  from public.plans p
  where p.code = v_opening_plan_event.metadata->>'to_plan'
  limit 1;

  if v_opening_plan.id is null
     or coalesce((v_opening_plan.features->>'cloud_cash_sync')::boolean, false) is not true then
    return null;
  end if;

  select exists (
    select 1
    from public.pos_cash_audit_events a
    where a.license_id = p_license_id
      and a.cash_session_id = p_cash_session_id
      and a.event_type = 'OPENED'
  ) into v_has_open_audit;

  select exists (
    select 1
    from public.pos_sync_events e
    where e.license_id = p_license_id
      and e.entity_type = 'cash_session'
      and e.entity_id = p_cash_session_id
      and e.operation = 'open'
  ) into v_has_open_sync;

  if v_has_open_audit is not true or v_has_open_sync is not true then
    return null;
  end if;

  return v_boundary || jsonb_build_object(
    'cash_session_id', v_session.id,
    'opened_at', v_session.opened_at,
    'opening_plan_event_id', v_opening_plan_event.id,
    'opening_plan_event_at', v_opening_plan_event.triggered_at,
    'opening_plan_code', v_opening_plan.code,
    'historical_entitlement_evidence', 'CANONICAL_CLOUD_CASH_OPEN_EVENTS'
  );
end;
$function$;
