-- LICENSE.DOWNGRADE.SESSION.CONSISTENCY.R1
-- Reconcile actor sessions in the same transaction that removes devices for plan limits.
-- No cash, sales, ledger, balance, or financial mutations.

do $preflight$
begin
  if to_regprocedure('public.enforce_license_plan_limits_after_change()') is null then
    raise exception 'LICENSE_DOWNGRADE_SESSION_CONSISTENCY_DEPENDENCY_MISSING';
  end if;
end;
$preflight$;

create or replace function public.enforce_license_plan_limits_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan_code text;
  v_plan_name text;
  v_features jsonb;
  v_staff_roles_enabled boolean;
  v_max_devices integer;
  v_active_before integer := 0;
  v_active_after integer := 0;
  v_staff_blocked integer := 0;
  v_staff_sessions_revoked integer := 0;
  v_staff_device_sessions_revoked integer := 0;
  v_admin_sessions_revoked integer := 0;
  v_over_limit_blocked integer := 0;
  v_staff_blocked_device_ids uuid[] := array[]::uuid[];
  v_over_limit_device_ids uuid[] := array[]::uuid[];
  v_blocked_device_ids uuid[] := array[]::uuid[];
  v_active_device_ids uuid[] := array[]::uuid[];
  v_now timestamptz := now();
begin
  select p.code, p.name, coalesce(p.features, '{}'::jsonb) || coalesce(new.features, '{}'::jsonb)
    into v_plan_code, v_plan_name, v_features
    from public.plans p
   where p.id = new.plan_id;

  v_staff_roles_enabled := coalesce((v_features->>'staff_roles')::boolean, false);
  v_max_devices := greatest(coalesce(new.max_devices, 1), 0);

  select count(*)
    into v_active_before
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if not v_staff_roles_enabled then
    with blocked as (
      update public.license_devices d
         set is_active = false,
             security_token = null,
             previous_security_token = null,
             last_check_at = v_now,
             device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
               'license_block', jsonb_build_object(
                 'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
                 'message', 'Esta licencia cambio a un plan que no incluye usuarios staff.',
                 'plan_code', v_plan_code,
                 'plan_name', v_plan_name,
                 'blocked_at', v_now
               )
             )
       where d.license_id = new.id
         and d.is_active is true
         and d.device_mode = 'staff_only'
      returning d.id
    )
    select coalesce(array_agg(id order by id), array[]::uuid[]), count(*)
      into v_staff_blocked_device_ids, v_staff_blocked
      from blocked;

    with revoked as (
      update public.license_staff_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
       where s.license_id = new.id
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_staff_sessions_revoked from revoked;
  end if;

  with ranked_devices as (
    select d.id,
           row_number() over (
             order by
               case d.device_mode
                 when 'admin_only' then 0
                 when 'shared' then 1
                 else 2
               end,
               d.activated_at asc nulls last,
               d.last_used_at desc nulls last,
               d.id asc
           ) as keep_rank
      from public.license_devices d
     where d.license_id = new.id
       and d.is_active is true
  ), blocked as (
    update public.license_devices d
       set is_active = false,
           security_token = null,
           previous_security_token = null,
           last_check_at = v_now,
           device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
             'license_block', jsonb_build_object(
               'reason', 'PLAN_DOWNGRADE_DEVICE_LIMIT',
               'message', 'Esta licencia cambio a un plan con menos dispositivos permitidos.',
               'plan_code', v_plan_code,
               'plan_name', v_plan_name,
               'max_devices', v_max_devices,
               'blocked_at', v_now
             )
           )
      from ranked_devices ranked
     where d.id = ranked.id
       and ranked.keep_rank > v_max_devices
    returning d.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[]), count(*)
    into v_over_limit_device_ids, v_over_limit_blocked
    from blocked;

  select coalesce(array_agg(distinct blocked_id order by blocked_id), array[]::uuid[])
    into v_blocked_device_ids
    from unnest(v_staff_blocked_device_ids || v_over_limit_device_ids) as blocked(blocked_id);

  if coalesce(cardinality(v_blocked_device_ids), 0) > 0 then
    with revoked as (
      update public.license_admin_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
        from public.license_devices d
       where s.license_id = new.id
         and s.device_id = d.id
         and d.license_id = new.id
         and d.id = any(v_blocked_device_ids)
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_admin_sessions_revoked from revoked;

    with revoked as (
      update public.license_staff_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
        from public.license_devices d
       where s.license_id = new.id
         and s.device_id = d.id
         and d.license_id = new.id
         and d.id = any(v_blocked_device_ids)
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_staff_device_sessions_revoked from revoked;

    v_staff_sessions_revoked := v_staff_sessions_revoked + v_staff_device_sessions_revoked;
  end if;

  select count(*),
         coalesce(array_agg(d.id order by d.id), array[]::uuid[])
    into v_active_after, v_active_device_ids
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if v_staff_blocked > 0
     or v_staff_sessions_revoked > 0
     or v_admin_sessions_revoked > 0
     or v_over_limit_blocked > 0 then
    insert into public.license_events (license_key, event_type, metadata)
    values (
      new.license_key,
      'LICENSE_UPDATE',
      jsonb_build_object(
        'source', 'enforce_license_plan_limits_after_change',
        'reason', 'PLAN_LIMITS_ENFORCED',
        'plan', v_plan_code,
        'plan_name', v_plan_name,
        'staff_devices_blocked', v_staff_blocked,
        'staff_sessions_revoked', v_staff_sessions_revoked,
        'admin_sessions_revoked', v_admin_sessions_revoked,
        'over_limit_devices_blocked', v_over_limit_blocked,
        'blocked_device_ids', to_jsonb(v_blocked_device_ids),
        'active_device_ids_after', to_jsonb(v_active_device_ids),
        'active_devices_before', v_active_before,
        'active_devices_after', v_active_after,
        'max_devices', v_max_devices
      )
    );
  end if;

  return null;
end;
$function$;

revoke all on function public.enforce_license_plan_limits_after_change()
  from public, anon, authenticated;
grant execute on function public.enforce_license_plan_limits_after_change()
  to service_role;

comment on function public.enforce_license_plan_limits_after_change() is
  'LICENSE.DOWNGRADE.SESSION.CONSISTENCY.R1: deterministically enforces plan device/staff limits, invalidates device tokens, revokes actor sessions on removed devices in the same transaction, and emits auditable counts/IDs without touching cash.';

-- Historical repair: only live, unrevoked actor sessions attached to devices that
-- are already inactive for an unequivocal plan-downgrade security reason.
with revoked_admin as (
  update public.license_admin_sessions s
     set revoked_at = now(),
         metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
           'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
           'revoked_at', now(),
           'reconciled_by', 'license_downgrade_session_consistency_r1'
         )
    from public.license_devices d
   where s.license_id = d.license_id
     and s.device_id = d.id
     and s.revoked_at is null
     and s.expires_at > now()
     and d.is_active is false
     and d.device_info #>> '{license_block,reason}' in (
       'PLAN_DOWNGRADE_DEVICE_LIMIT',
       'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED'
     )
  returning s.license_id, s.device_id
), revoked_staff as (
  update public.license_staff_sessions s
     set revoked_at = now(),
         metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
           'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
           'revoked_at', now(),
           'reconciled_by', 'license_downgrade_session_consistency_r1'
         )
    from public.license_devices d
   where s.license_id = d.license_id
     and s.device_id = d.id
     and s.revoked_at is null
     and s.expires_at > now()
     and d.is_active is false
     and d.device_info #>> '{license_block,reason}' in (
       'PLAN_DOWNGRADE_DEVICE_LIMIT',
       'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED'
     )
  returning s.license_id, s.device_id
), affected as (
  select license_id, device_id, 1 as admin_revoked, 0 as staff_revoked from revoked_admin
  union all
  select license_id, device_id, 0 as admin_revoked, 1 as staff_revoked from revoked_staff
), grouped as (
  select license_id,
         sum(admin_revoked)::integer as admin_sessions_revoked,
         sum(staff_revoked)::integer as staff_sessions_revoked,
         array_agg(distinct device_id order by device_id) as affected_device_ids
    from affected
   group by license_id
)
insert into public.license_events (license_key, event_type, metadata)
select l.license_key,
       'LICENSE_UPDATE',
       jsonb_build_object(
         'source', 'license_downgrade_session_consistency_r1_backfill',
         'reason', 'PLAN_DOWNGRADE_SESSION_RECONCILED',
         'admin_sessions_revoked', g.admin_sessions_revoked,
         'staff_sessions_revoked', g.staff_sessions_revoked,
         'affected_device_ids', to_jsonb(g.affected_device_ids),
         'reconciled_at', now()
       )
  from grouped g
  join public.licenses l on l.id = g.license_id;
