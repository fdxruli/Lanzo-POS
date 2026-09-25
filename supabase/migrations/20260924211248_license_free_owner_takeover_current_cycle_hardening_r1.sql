-- LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1.2
-- Bind owner-recovery evidence to the CURRENT Free transition.
--
-- Why: R1.1 invalidated old evidence only when a later non-Free
-- PLAN_LIMITS_ENFORCED event existed. A normal Free -> Pro upgrade that did
-- not need to prune/revoke anything could emit no such enforcement event,
-- allowing an old downgrade event to become visible again after a later
-- Pro -> Free cycle that did not itself prune a device.
--
-- This helper is read-only. Public takeover keeps its existing row lock,
-- credential validation, consumed-event idempotency and rate limits.

create or replace function private.resolve_free_device_takeover_evidence_v1(
  p_license_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with current_license as (
    select
      l.id,
      l.license_key,
      p.code as plan_code,
      coalesce(l.max_devices, p.max_devices, 1) as max_devices
    from public.licenses l
    join public.plans p on p.id = l.plan_id
    where l.license_key = p_license_key
      and l.status = 'active'
      and p.code = 'free_trial'
      and coalesce(l.max_devices, p.max_devices, 1) = 1
    limit 1
  ), current_free_transition as (
    select
      e.triggered_at
    from public.license_events e
    join current_license l on l.license_key = e.license_key
    where e.event_type = 'PLAN_CHANGED'
      and e.metadata->>'source' = 'licenses_update_trigger'
      and e.metadata->>'to_plan' = 'free_trial'
      and coalesce(e.metadata->>'from_plan', '') <> 'free_trial'
    order by e.triggered_at desc, e.id desc
    limit 1
  ), candidate as (
    select
      e.id,
      e.triggered_at,
      e.metadata
    from public.license_events e
    join current_license l on l.license_key = e.license_key
    join current_free_transition transition
      on transition.triggered_at = e.triggered_at
    where e.event_type = 'LICENSE_UPDATE'
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
$function$;

revoke all on function private.resolve_free_device_takeover_evidence_v1(text)
  from public, anon, authenticated, service_role;

comment on function private.resolve_free_device_takeover_evidence_v1(text) is
  'LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1.2: resolves qualifying device-pruning evidence only when it belongs to the current active one-device Free transition; prior-cycle evidence cannot revive after upgrade/re-downgrade.';
