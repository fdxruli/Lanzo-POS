-- LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1.1
-- Prevent reuse of recovery evidence across a later transition to a non-Free plan.
create or replace function private.resolve_free_device_takeover_evidence_v1(
  p_license_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with candidate as (
    select
      e.id,
      e.triggered_at,
      e.metadata
    from public.license_events e
    where e.license_key = p_license_key
      and e.event_type = 'LICENSE_UPDATE'
      and e.metadata->>'source' = 'enforce_license_plan_limits_after_change'
      and e.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'
      and e.metadata->>'plan' = 'free_trial'
      and e.metadata->>'max_devices' = '1'
      and coalesce(e.metadata->>'over_limit_devices_blocked', '') ~ '^[1-9][0-9]*$'
    order by e.triggered_at desc, e.id desc
    limit 1
  )
  select jsonb_build_object(
    'event_id', c.id,
    'triggered_at', c.triggered_at,
    'reason', c.metadata->>'reason',
    'plan', c.metadata->>'plan',
    'max_devices', c.metadata->>'max_devices'
  )
  from candidate c
  where not exists (
    select 1
    from public.license_events later
    where later.license_key = p_license_key
      and later.event_type = 'LICENSE_UPDATE'
      and later.metadata->>'source' = 'enforce_license_plan_limits_after_change'
      and later.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'
      and later.triggered_at > c.triggered_at
      and coalesce(later.metadata->>'plan', '') <> 'free_trial'
  )
$function$;

revoke all on function private.resolve_free_device_takeover_evidence_v1(text)
  from public, anon, authenticated, service_role;

comment on function private.resolve_free_device_takeover_evidence_v1(text) is
  'LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1.1: latest qualifying one-device Free reduction evidence, invalidated by any later plan-limit enforcement to a non-Free plan.';
