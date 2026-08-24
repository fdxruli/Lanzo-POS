-- POS Notification Center hotfix: durable operational incidents.
-- State-based operational alerts use one open incident per license/type/entity.

begin;

create table if not exists private.pos_notification_operational_incidents (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  incident_type text not null,
  entity_id text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  current_state jsonb not null default '{}'::jsonb,
  notification_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_notification_operational_incidents_notification_license_fkey
    foreign key (notification_id, license_id)
    references public.pos_notifications(id, license_id)
    on delete set null,
  constraint pos_notification_operational_incidents_resolution_check
    check (resolved_at is null or resolved_at >= opened_at)
);

create unique index if not exists uq_pos_notification_operational_incidents_open
  on private.pos_notification_operational_incidents (
    license_id,
    incident_type,
    (coalesce(entity_id, ''))
  )
  where resolved_at is null;

create index if not exists idx_pos_notification_operational_incidents_license_state
  on private.pos_notification_operational_incidents (license_id, incident_type, resolved_at, opened_at desc);

revoke all on table private.pos_notification_operational_incidents from public, anon, authenticated;

create or replace function private.set_pos_operational_incident_state(
  p_license_id uuid,
  p_incident_type text,
  p_entity_id text,
  p_active boolean,
  p_current_state jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_incident private.pos_notification_operational_incidents%rowtype;
  v_entity_key text := coalesce(nullif(btrim(coalesce(p_entity_id, '')), ''), '');
  v_state jsonb := coalesce(p_current_state, '{}'::jsonb);
begin
  if p_license_id is null or nullif(btrim(coalesce(p_incident_type, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'OPERATIONAL_INCIDENT_CONTEXT_REQUIRED');
  end if;

  if not exists (select 1 from public.licenses l where l.id = p_license_id) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_license_id::text || ':' || p_incident_type || ':' || v_entity_key, 0)
  );

  select i.*
  into v_incident
  from private.pos_notification_operational_incidents i
  where i.license_id = p_license_id
    and i.incident_type = p_incident_type
    and coalesce(i.entity_id, '') = v_entity_key
    and i.resolved_at is null
  order by i.opened_at desc, i.id desc
  limit 1
  for update;

  if coalesce(p_active, false) is false then
    if v_incident.id is null then
      return jsonb_build_object('success', true, 'active', false, 'resolved', false, 'newly_opened', false);
    end if;

    update private.pos_notification_operational_incidents
    set resolved_at = now(),
        current_state = v_state || jsonb_build_object('active', false),
        updated_at = now()
    where id = v_incident.id;

    return jsonb_build_object(
      'success', true,
      'active', false,
      'resolved', true,
      'newly_opened', false,
      'incident_id', v_incident.id,
      'notification_id', v_incident.notification_id
    );
  end if;

  if v_incident.id is not null then
    update private.pos_notification_operational_incidents
    set current_state = v_state || jsonb_build_object('active', true),
        updated_at = now()
    where id = v_incident.id
    returning * into v_incident;

    return jsonb_build_object(
      'success', true,
      'active', true,
      'resolved', false,
      'newly_opened', false,
      'incident_id', v_incident.id,
      'opened_at', v_incident.opened_at,
      'notification_id', v_incident.notification_id
    );
  end if;

  insert into private.pos_notification_operational_incidents (
    license_id,
    incident_type,
    entity_id,
    current_state
  ) values (
    p_license_id,
    p_incident_type,
    nullif(v_entity_key, ''),
    v_state || jsonb_build_object('active', true)
  )
  returning * into v_incident;

  return jsonb_build_object(
    'success', true,
    'active', true,
    'resolved', false,
    'newly_opened', true,
    'incident_id', v_incident.id,
    'opened_at', v_incident.opened_at,
    'notification_id', v_incident.notification_id
  );
end;
$function$;

revoke all on function private.set_pos_operational_incident_state(uuid, text, text, boolean, jsonb)
  from public, anon, authenticated;

-- Seed current device incidents from authoritative transition events. This does
-- not infer ownership from device identity; it only establishes incident identity.
with latest_device_transition as (
  select distinct on (d.license_id, d.id)
    d.license_id,
    d.id as device_id,
    e.triggered_at as opened_at,
    e.event_type
  from public.license_devices d
  join public.licenses l on l.id = d.license_id
  join public.license_events e
    on e.license_key = l.license_key
   and e.event_type in ('DEVICE_RELEASED', 'DEVICE_BANNED')
   and e.metadata->>'device_id' = d.id::text
  where d.is_active is false
  order by d.license_id, d.id, e.triggered_at desc, e.id desc
), device_seed as (
  select t.*,
         (
           select n.id
           from public.pos_notifications n
           where n.license_id = t.license_id
             and n.source = 'license'
             and n.metadata->>'generated_by' = 'NOTIF.8'
             and n.metadata->>'event' = 'device_disabled'
             and n.metadata->>'entity_id' = t.device_id::text
             and n.created_at >= t.opened_at
             and n.metadata->>'event_key' ~ ('^device_disabled:' || t.device_id::text || ':[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           order by n.created_at desc, n.id desc
           limit 1
         ) as canonical_notification_id
  from latest_device_transition t
)
insert into private.pos_notification_operational_incidents (
  license_id, incident_type, entity_id, opened_at, current_state, notification_id
)
select
  s.license_id,
  'device_disabled',
  s.device_id::text,
  s.opened_at,
  jsonb_build_object('active', true, 'seeded_by', 'migration', 'transition_source', s.event_type),
  s.canonical_notification_id
from device_seed s
where not exists (
  select 1
  from private.pos_notification_operational_incidents i
  where i.license_id = s.license_id
    and i.incident_type = 'device_disabled'
    and coalesce(i.entity_id, '') = s.device_id::text
    and i.resolved_at is null
);

-- Seed other current states with the newest matching legacy notification when
-- available. No historical rows are collapsed for these states because there
-- is no equally strong transition source for proving episode boundaries.
with inactive_staff as (
  select
    s.license_id,
    s.id as staff_user_id,
    coalesce(s.updated_at, now()) as opened_at,
    (
      select n.id
      from public.pos_notifications n
      where n.license_id = s.license_id
        and n.source = 'system'
        and n.metadata->>'generated_by' = 'NOTIF.8'
        and n.metadata->>'event' = 'staff_disabled'
        and n.metadata->>'entity_id' = s.id::text
      order by n.created_at desc, n.id desc
      limit 1
    ) as notification_id
  from public.license_staff_users s
  where s.is_active is false
)
insert into private.pos_notification_operational_incidents (
  license_id, incident_type, entity_id, opened_at, current_state, notification_id
)
select
  s.license_id,
  'staff_disabled',
  s.staff_user_id::text,
  s.opened_at,
  jsonb_build_object('active', true, 'seeded_by', 'migration'),
  s.notification_id
from inactive_staff s
where not exists (
  select 1 from private.pos_notification_operational_incidents i
  where i.license_id = s.license_id
    and i.incident_type = 'staff_disabled'
    and coalesce(i.entity_id, '') = s.staff_user_id::text
    and i.resolved_at is null
);

with active_limits as (
  select
    l.id as license_id,
    l.max_devices,
    count(d.id) filter (where d.is_active is true)::integer as active_devices
  from public.licenses l
  left join public.license_devices d on d.license_id = l.id
  group by l.id, l.max_devices
  having coalesce(l.max_devices, 0) > 0
     and count(d.id) filter (where d.is_active is true) >= l.max_devices
), seeded as (
  select x.*,
         (
           select n.id from public.pos_notifications n
           where n.license_id = x.license_id
             and n.source = 'license'
             and n.metadata->>'generated_by' = 'NOTIF.8'
             and n.metadata->>'event' = 'device_limit_reached'
           order by n.created_at desc, n.id desc limit 1
         ) as notification_id
  from active_limits x
)
insert into private.pos_notification_operational_incidents (
  license_id, incident_type, entity_id, opened_at, current_state, notification_id
)
select
  s.license_id,
  'device_limit_reached',
  null,
  coalesce(n.created_at, now()),
  jsonb_build_object('active', true, 'active_devices', s.active_devices, 'max_devices', s.max_devices, 'seeded_by', 'migration'),
  s.notification_id
from seeded s
left join public.pos_notifications n on n.id = s.notification_id
where not exists (
  select 1 from private.pos_notification_operational_incidents i
  where i.license_id = s.license_id
    and i.incident_type = 'device_limit_reached'
    and coalesce(i.entity_id, '') = ''
    and i.resolved_at is null
);

with active_sync as (
  select c.license_id, count(*)::integer as unresolved_count
  from public.pos_sync_conflicts c
  where c.resolved_at is null
  group by c.license_id
), seeded as (
  select x.*,
         (
           select n.id from public.pos_notifications n
           where n.license_id = x.license_id
             and n.source = 'sync'
             and n.metadata->>'generated_by' = 'NOTIF.8'
             and n.metadata->>'event' = 'sync_errors_active'
           order by n.created_at desc, n.id desc limit 1
         ) as notification_id
  from active_sync x
  where x.unresolved_count > 0
)
insert into private.pos_notification_operational_incidents (
  license_id, incident_type, entity_id, opened_at, current_state, notification_id
)
select
  s.license_id,
  'sync_errors_active',
  null,
  coalesce(n.created_at, now()),
  jsonb_build_object('active', true, 'unresolved_count', s.unresolved_count, 'seeded_by', 'migration'),
  s.notification_id
from seeded s
left join public.pos_notifications n on n.id = s.notification_id
where not exists (
  select 1 from private.pos_notification_operational_incidents i
  where i.license_id = s.license_id
    and i.incident_type = 'sync_errors_active'
    and coalesce(i.entity_id, '') = ''
    and i.resolved_at is null
);

-- Safe cleanup for proven current device incidents only. The newest row is the
-- canonical current notification; all actor read/seen/archive provenance from
-- duplicate rows is merged into it before duplicates are superseded/expired.
create temporary table notif_device_current_incident_members on commit drop as
with latest_transition as (
  select distinct on (d.license_id, d.id)
    d.license_id,
    d.id as device_id,
    e.triggered_at as opened_at
  from public.license_devices d
  join public.licenses l on l.id = d.license_id
  join public.license_events e
    on e.license_key = l.license_key
   and e.event_type in ('DEVICE_RELEASED', 'DEVICE_BANNED')
   and e.metadata->>'device_id' = d.id::text
  where d.is_active is false
  order by d.license_id, d.id, e.triggered_at desc, e.id desc
), members as (
  select
    t.license_id,
    t.device_id,
    n.id as member_notification_id,
    first_value(n.id) over (
      partition by t.license_id, t.device_id
      order by n.created_at desc, n.id desc
    ) as canonical_notification_id
  from latest_transition t
  join public.pos_notifications n
    on n.license_id = t.license_id
   and n.source = 'license'
   and n.metadata->>'generated_by' = 'NOTIF.8'
   and n.metadata->>'event' = 'device_disabled'
   and n.metadata->>'entity_id' = t.device_id::text
   and n.created_at >= t.opened_at
   and n.metadata->>'event_key' ~ ('^device_disabled:' || t.device_id::text || ':[0-9]{4}-[0-9]{2}-[0-9]{2}$')
)
select * from members;

insert into public.pos_notification_reads (
  notification_id, license_id, admin_user_id, seen_at, read_at, archived_at
)
select
  m.canonical_notification_id,
  m.license_id,
  r.admin_user_id,
  min(r.seen_at),
  min(r.read_at),
  min(r.archived_at)
from notif_device_current_incident_members m
join public.pos_notification_reads r
  on r.notification_id = m.member_notification_id and r.license_id = m.license_id
where r.admin_user_id is not null
group by m.canonical_notification_id, m.license_id, r.admin_user_id
on conflict (notification_id, license_id, admin_user_id) where admin_user_id is not null
do update set
  seen_at = coalesce(least(public.pos_notification_reads.seen_at, excluded.seen_at), public.pos_notification_reads.seen_at, excluded.seen_at),
  read_at = coalesce(least(public.pos_notification_reads.read_at, excluded.read_at), public.pos_notification_reads.read_at, excluded.read_at),
  archived_at = coalesce(least(public.pos_notification_reads.archived_at, excluded.archived_at), public.pos_notification_reads.archived_at, excluded.archived_at),
  updated_at = now();

insert into public.pos_notification_reads (
  notification_id, license_id, staff_user_id, seen_at, read_at, archived_at
)
select
  m.canonical_notification_id,
  m.license_id,
  r.staff_user_id,
  min(r.seen_at),
  min(r.read_at),
  min(r.archived_at)
from notif_device_current_incident_members m
join public.pos_notification_reads r
  on r.notification_id = m.member_notification_id and r.license_id = m.license_id
where r.staff_user_id is not null
group by m.canonical_notification_id, m.license_id, r.staff_user_id
on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
do update set
  seen_at = coalesce(least(public.pos_notification_reads.seen_at, excluded.seen_at), public.pos_notification_reads.seen_at, excluded.seen_at),
  read_at = coalesce(least(public.pos_notification_reads.read_at, excluded.read_at), public.pos_notification_reads.read_at, excluded.read_at),
  archived_at = coalesce(least(public.pos_notification_reads.archived_at, excluded.archived_at), public.pos_notification_reads.archived_at, excluded.archived_at),
  updated_at = now();

insert into public.pos_notification_reads (
  notification_id, license_id, device_fingerprint, seen_at, read_at, archived_at
)
select
  m.canonical_notification_id,
  m.license_id,
  r.device_fingerprint,
  min(r.seen_at),
  min(r.read_at),
  min(r.archived_at)
from notif_device_current_incident_members m
join public.pos_notification_reads r
  on r.notification_id = m.member_notification_id and r.license_id = m.license_id
where r.staff_user_id is null
  and r.admin_user_id is null
  and nullif(btrim(coalesce(r.device_fingerprint, '')), '') is not null
group by m.canonical_notification_id, m.license_id, r.device_fingerprint
on conflict (notification_id, license_id, device_fingerprint)
  where staff_user_id is null and admin_user_id is null
do update set
  seen_at = coalesce(least(public.pos_notification_reads.seen_at, excluded.seen_at), public.pos_notification_reads.seen_at, excluded.seen_at),
  read_at = coalesce(least(public.pos_notification_reads.read_at, excluded.read_at), public.pos_notification_reads.read_at, excluded.read_at),
  archived_at = coalesce(least(public.pos_notification_reads.archived_at, excluded.archived_at), public.pos_notification_reads.archived_at, excluded.archived_at),
  updated_at = now();

update public.pos_notifications n
set metadata = n.metadata || jsonb_build_object(
      'superseded_by', m.canonical_notification_id,
      'superseded_at', now(),
      'superseded_reason', 'legacy_operational_daily_snapshot'
    ),
    expires_at = least(coalesce(n.expires_at, now() - interval '1 second'), now() - interval '1 second')
from notif_device_current_incident_members m
where n.id = m.member_notification_id
  and n.license_id = m.license_id
  and m.member_notification_id <> m.canonical_notification_id;

commit;
