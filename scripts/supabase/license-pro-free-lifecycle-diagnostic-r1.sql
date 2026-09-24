-- LICENSE.PRO_FREE.LIFECYCLE.DIAGNOSTIC.R1
-- READ ONLY. Replace NULL::text below with a license key when investigating a
-- specific tenant. Do not commit a real license key, token or fingerprint.
--
-- Example for a temporary SQL editor session only:
--   select 'YOUR-LICENSE-KEY'::text as license_key
--
-- This script intentionally performs no INSERT/UPDATE/DELETE/DDL.

with params as (
  select null::text as license_key
), target as (
  select
    l.id,
    l.license_key,
    l.status,
    l.max_devices,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  from params x
  join public.licenses l on l.license_key = x.license_key
  left join public.plans p on p.id = l.plan_id
), lifecycle as (
  select
    t.id,
    e.lifecycle_state,
    e.is_entitled,
    e.is_in_grace,
    e.expires_at,
    e.grace_period_ends
  from target t
  left join lateral private.license_entitlement_state_v1(t.id) e on true
), device_state as (
  select
    t.id,
    count(d.id) filter (where d.is_active) as active_devices,
    count(d.id) filter (
      where d.is_active is false
        and d.device_info #>> '{license_block,reason}' in (
          'PLAN_DOWNGRADE_DEVICE_LIMIT',
          'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED'
        )
    ) as retired_by_downgrade
  from target t
  left join public.license_devices d on d.license_id = t.id
  group by t.id
), actor_state as (
  select
    t.id,
    (
      select count(*)
      from public.license_admin_sessions s
      join public.license_devices d on d.id = s.device_id
      where s.license_id = t.id
        and s.revoked_at is null
        and s.expires_at > now()
        and d.is_active is false
    ) as stale_admin_sessions,
    (
      select count(*)
      from public.license_staff_sessions s
      join public.license_devices d on d.id = s.device_id
      where s.license_id = t.id
        and s.revoked_at is null
        and s.expires_at > now()
        and d.is_active is false
    ) as stale_staff_sessions,
    (
      select count(*)
      from public.license_staff_sessions s
      where s.license_id = t.id
        and s.revoked_at is null
        and s.expires_at > now()
    ) as live_staff_sessions
  from target t
), cash_state as (
  select
    t.id,
    count(c.id) filter (
      where c.status = 'open' and c.deleted_at is null
    ) as open_cash,
    count(c.id) filter (
      where c.status = 'open'
        and c.deleted_at is null
        and private.post_downgrade_cash_session_evidence_v1(t.id, c.id) is not null
    ) as eligible_post_downgrade_cash,
    (
      select count(*)
      from public.pos_cash_audit_events a
      where a.license_id = t.id
        and a.payload->>'reconciliation_source' = 'POST_DOWNGRADE_CASH_RECONCILIATION'
    ) as post_downgrade_reconciliations
  from target t
  left join public.pos_cash_sessions c on c.license_id = t.id
  group by t.id
), recent_events as (
  select
    t.id,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'event_type', e.event_type,
        'triggered_at', e.triggered_at,
        'reason', e.metadata->>'reason',
        'from_plan', e.metadata->>'from_plan',
        'to_plan', e.metadata->>'to_plan',
        'plan', e.metadata->>'plan',
        'active_devices_after', e.metadata->>'active_devices_after',
        'over_limit_devices_blocked', e.metadata->>'over_limit_devices_blocked',
        'admin_sessions_revoked', e.metadata->>'admin_sessions_revoked',
        'staff_sessions_revoked', e.metadata->>'staff_sessions_revoked'
      )
      order by e.triggered_at desc
    ) filter (where e.id is not null), '[]'::jsonb) as lifecycle_events
  from target t
  left join lateral (
    select e.*
    from public.license_events e
    where e.license_key = t.license_key
      and (
        e.event_type in (
          'PLAN_CHANGED',
          'PLAN_EXPIRED_DOWNGRADED_TO_FREE',
          'FREE_PRIMARY_DEVICE_TAKEOVER'
        )
        or (
          e.event_type = 'LICENSE_UPDATE'
          and e.metadata->>'source' = 'enforce_license_plan_limits_after_change'
        )
      )
    order by e.triggered_at desc, e.id desc
    limit 30
  ) e on true
  group by t.id
)
select jsonb_build_object(
  'configured', true,
  'status', t.status,
  'plan_code', t.plan_code,
  'plan_name', t.plan_name,
  'max_devices', t.max_devices,
  'cloud_cash_sync', coalesce((t.effective_features->>'cloud_cash_sync')::boolean, false),
  'lifecycle_state', l.lifecycle_state,
  'is_entitled', l.is_entitled,
  'is_in_grace', l.is_in_grace,
  'expires_at', l.expires_at,
  'grace_period_ends', l.grace_period_ends,
  'active_devices', d.active_devices,
  'retired_by_downgrade', d.retired_by_downgrade,
  'stale_admin_sessions', a.stale_admin_sessions,
  'stale_staff_sessions', a.stale_staff_sessions,
  'live_staff_sessions', a.live_staff_sessions,
  'open_cash', c.open_cash,
  'eligible_post_downgrade_cash', c.eligible_post_downgrade_cash,
  'post_downgrade_reconciliations', c.post_downgrade_reconciliations,
  'lifecycle_events', r.lifecycle_events
) as lifecycle_diagnostic
from target t
join lifecycle l on l.id = t.id
join device_state d on d.id = t.id
join actor_state a on a.id = t.id
join cash_state c on c.id = t.id
join recent_events r on r.id = t.id

union all

select jsonb_build_object(
  'configured', false,
  'message', 'Set params.license_key temporarily in your SQL session; do not commit tenant credentials.'
)
where not exists (select 1 from target);
