-- READ ONLY: Pro -> Free lifecycle diagnostic for one synthetic or authorized license.
-- Replace the all-zero UUID below with the target public.licenses.id before running.
-- Output omits license keys, credentials, session tokens, and device fingerprints.
with requested as (
  select '00000000-0000-0000-0000-000000000000'::uuid as license_id
),
resolved as (
  select
    r.license_id as requested_license_id,
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    l.max_devices,
    l.features,
    p.code as plan_code,
    p.max_devices as plan_max_devices,
    p.features as plan_features
  from requested r
  left join public.licenses l on l.id = r.license_id
  left join public.plans p on p.id = l.plan_id
)
select
  t.requested_license_id,
  case when t.id is null then 'LICENSE_NOT_FOUND_REPLACE_UUID' else 'OK' end as diagnostic_status,
  t.status as license_status,
  t.plan_code as current_plan,
  coalesce(t.max_devices, t.plan_max_devices, 1) as max_devices,
  t.expires_at,
  ent.lifecycle_state,
  ent.grace_period_ends,
  case
    when lower(t.features->>'cloud_cash_sync') = 'true' then true
    when lower(t.features->>'cloud_cash_sync') = 'false' then false
    when lower(t.plan_features->>'cloud_cash_sync') = 'true' then true
    else false
  end as cloud_cash_sync,
  (select count(*) from public.license_devices d
    where d.license_id = t.id and d.is_active is true) as active_devices,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'device_id', d.id,
      'device_role', d.device_role,
      'device_mode', d.device_mode,
      'activated_at', d.activated_at,
      'block_reason', d.device_info #>> '{license_block,reason}'
    ) order by d.activated_at asc nulls last, d.id), '[]'::jsonb)
   from public.license_devices d
   where d.license_id = t.id and d.is_active is true) as active_device_details,
  (select count(*)
     from public.license_admin_sessions s
     join public.license_devices d on d.id = s.device_id and d.license_id = s.license_id
    where s.license_id = t.id
      and s.revoked_at is null and s.expires_at > now()
      and d.is_active is false) as live_admin_sessions_on_inactive_devices,
  (select count(*)
     from public.license_staff_sessions s
     join public.license_devices d on d.id = s.device_id and d.license_id = s.license_id
    where s.license_id = t.id
      and s.revoked_at is null and s.expires_at > now()
      and d.is_active is false) as live_staff_sessions_on_inactive_devices,
  (select count(*)
     from public.license_staff_sessions s
    where s.license_id = t.id
      and s.revoked_at is null and s.expires_at > now()
      and t.plan_code = 'free_trial'
      and case
        when lower(t.features->>'staff_roles') = 'true' then true
        when lower(t.plan_features->>'staff_roles') = 'true' then true
        else false
      end is false) as live_staff_sessions_on_incompatible_free,
  (select count(*)
     from public.pos_cash_sessions c
    where c.license_id = t.id and c.status = 'open' and c.deleted_at is null) as open_cash_sessions,
  (select count(*)
     from public.pos_cash_sessions c
    where c.license_id = t.id
      and c.status = 'open' and c.deleted_at is null
      and private.post_downgrade_cash_session_evidence_v1(t.id, c.id) is not null
  ) as eligible_post_downgrade_cash_sessions,
  (select count(*)
     from public.pos_cash_audit_events a
    where a.license_id = t.id
      and a.payload->>'reconciliation_source' = 'POST_DOWNGRADE_CASH_RECONCILIATION'
  ) as post_downgrade_reconciliation_events,
  private.post_downgrade_cash_boundary_v1(t.id) as current_free_bridge_boundary,
  coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'event_type', e.event_type,
      'triggered_at', e.triggered_at,
      'from_plan', e.metadata->>'from_plan',
      'to_plan', e.metadata->>'to_plan',
      'previous_plan', e.metadata->>'previous_plan',
      'new_plan', e.metadata->>'new_plan',
      'reason', e.metadata->>'reason',
      'max_devices', e.metadata->>'max_devices',
      'active_devices_after', e.metadata->>'active_devices_after',
      'admin_sessions_revoked', e.metadata->>'admin_sessions_revoked',
      'staff_sessions_revoked', e.metadata->>'staff_sessions_revoked',
      'previous_device_id', e.metadata->>'previous_device_id',
      'new_device_id', e.metadata->>'new_device_id',
      'downgrade_event_id', e.metadata->>'downgrade_event_id',
      'result', e.metadata->>'result'
    )) order by e.triggered_at, e.id)
    from public.license_events e
    where e.license_key = t.license_key
      and e.event_type in (
        'PLAN_CHANGED',
        'PLAN_EXPIRED_DOWNGRADED_TO_FREE',
        'LICENSE_UPDATE',
        'FREE_PRIMARY_DEVICE_TAKEOVER'
      )
  ), '[]'::jsonb) as lifecycle_audit_events
from resolved t
left join lateral private.license_entitlement_state_v1(t.id) ent on true;
