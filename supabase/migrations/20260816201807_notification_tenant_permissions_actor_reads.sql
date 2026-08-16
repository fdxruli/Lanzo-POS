-- NOTIF.TENANT.1
-- Harden notification tenant isolation, add granular staff visibility and make
-- read/archive state follow the authenticated actor across devices.

begin;

-- Fail closed before adding structural tenant constraints.
do $preflight$
begin
  if exists (
    select 1
    from public.pos_notification_reads r
    join public.pos_notifications n on n.id = r.notification_id
    where r.license_id <> n.license_id
  ) then
    raise exception 'NOTIF_TENANT_CROSS_LICENSE_READS_PRESENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.pos_notification_reads r
    join public.license_staff_users s on s.id = r.staff_user_id
    where r.staff_user_id is not null
      and r.license_id <> s.license_id
  ) then
    raise exception 'NOTIF_TENANT_CROSS_LICENSE_STAFF_READS_PRESENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.pos_notifications n
    join public.license_staff_users s on s.id = n.target_staff_user_id
    where n.target_staff_user_id is not null
      and n.license_id <> s.license_id
  ) then
    raise exception 'NOTIF_TENANT_CROSS_LICENSE_TARGETS_PRESENT' using errcode = 'P0001';
  end if;
end;
$preflight$;

alter table public.pos_notification_reads
  add column if not exists admin_user_id uuid;

-- Composite uniqueness enables tenant-aware foreign keys instead of relying
-- only on RPC WHERE clauses.
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_notifications'::regclass
      and conname = 'pos_notifications_id_license_id_key'
  ) then
    alter table public.pos_notifications
      add constraint pos_notifications_id_license_id_key unique (id, license_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.license_staff_users'::regclass
      and conname = 'license_staff_users_id_license_id_key'
  ) then
    alter table public.license_staff_users
      add constraint license_staff_users_id_license_id_key unique (id, license_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.license_admin_users'::regclass
      and conname = 'license_admin_users_id_license_id_key'
  ) then
    alter table public.license_admin_users
      add constraint license_admin_users_id_license_id_key unique (id, license_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_notification_reads'::regclass
      and conname = 'pos_notification_reads_notification_license_fkey'
  ) then
    alter table public.pos_notification_reads
      add constraint pos_notification_reads_notification_license_fkey
      foreign key (notification_id, license_id)
      references public.pos_notifications(id, license_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_notification_reads'::regclass
      and conname = 'pos_notification_reads_staff_license_fkey'
  ) then
    alter table public.pos_notification_reads
      add constraint pos_notification_reads_staff_license_fkey
      foreign key (staff_user_id, license_id)
      references public.license_staff_users(id, license_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_notification_reads'::regclass
      and conname = 'pos_notification_reads_admin_license_fkey'
  ) then
    alter table public.pos_notification_reads
      add constraint pos_notification_reads_admin_license_fkey
      foreign key (admin_user_id, license_id)
      references public.license_admin_users(id, license_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pos_notifications'::regclass
      and conname = 'pos_notifications_target_staff_license_fkey'
  ) then
    alter table public.pos_notifications
      add constraint pos_notifications_target_staff_license_fkey
      foreign key (target_staff_user_id, license_id)
      references public.license_staff_users(id, license_id)
      on delete cascade;
  end if;
end;
$constraints$;

alter table public.pos_notification_reads
  drop constraint if exists pos_notification_reads_actor_check;

alter table public.pos_notification_reads
  add constraint pos_notification_reads_actor_check check (
    num_nonnulls(
      staff_user_id,
      admin_user_id,
      nullif(btrim(coalesce(device_fingerprint, '')), '')
    ) = 1
  );

-- Rebuild actor uniqueness so admin rows are not part of the legacy-device key.
drop index if exists public.uq_pos_notification_reads_device;
create unique index uq_pos_notification_reads_device
  on public.pos_notification_reads (notification_id, license_id, device_fingerprint)
  where staff_user_id is null
    and admin_user_id is null;

create unique index if not exists uq_pos_notification_reads_admin
  on public.pos_notification_reads (notification_id, license_id, admin_user_id)
  where admin_user_id is not null;

create index if not exists idx_pos_notification_reads_license_admin
  on public.pos_notification_reads (license_id, admin_user_id, archived_at, read_at)
  where admin_user_id is not null;

-- Backfill an actor-scoped row only when a legacy device maps to exactly one
-- admin. Legacy device rows stay preserved as provenance/rollback evidence.
with device_admin_map as (
  select
    d.license_id,
    d.device_fingerprint,
    (array_agg(distinct s.admin_user_id))[1] as admin_user_id
  from public.license_devices d
  join public.license_admin_sessions s
    on s.license_id = d.license_id
   and s.device_id = d.id
  where nullif(btrim(coalesce(d.device_fingerprint, '')), '') is not null
    and s.admin_user_id is not null
  group by d.license_id, d.device_fingerprint
  having count(distinct s.admin_user_id) = 1
), actor_reads as (
  select
    r.notification_id,
    r.license_id,
    m.admin_user_id,
    min(r.read_at) filter (where r.read_at is not null) as read_at,
    min(r.archived_at) filter (where r.archived_at is not null) as archived_at
  from public.pos_notification_reads r
  join device_admin_map m
    on m.license_id = r.license_id
   and m.device_fingerprint = r.device_fingerprint
  where r.staff_user_id is null
    and r.admin_user_id is null
  group by r.notification_id, r.license_id, m.admin_user_id
)
insert into public.pos_notification_reads (
  notification_id,
  license_id,
  admin_user_id,
  read_at,
  archived_at
)
select notification_id, license_id, admin_user_id, read_at, archived_at
from actor_reads
on conflict (notification_id, license_id, admin_user_id)
  where admin_user_id is not null
do update set
  read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at),
  archived_at = coalesce(public.pos_notification_reads.archived_at, excluded.archived_at),
  updated_at = now();

-- One canonical classifier shared by authorization and client presentation.
create or replace function private.pos_notification_category_v1(
  p_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_type text := lower(coalesce(nullif(btrim(p_type), ''), 'system'));
  v_metadata_category text := lower(coalesce(nullif(btrim(coalesce(p_metadata->>'category', '')), ''), ''));
begin
  if v_type = 'ecommerce' or v_metadata_category = 'ecommerce' then
    return 'ecommerce';
  end if;
  if v_type = 'support' or v_metadata_category = 'support' then
    return 'support';
  end if;
  if v_type = 'license' or v_metadata_category = 'license' then
    return 'license';
  end if;
  if v_type in ('cash', 'sync', 'inventory')
     or v_metadata_category in ('cash', 'sync', 'inventory', 'staff', 'operation', 'operations') then
    return 'operations';
  end if;
  return 'system';
end;
$function$;

create or replace function private.pos_notification_category_allowed_v1(
  p_type text,
  p_metadata jsonb,
  p_device_role text,
  p_staff_permissions jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_category text;
  v_permission text;
  v_permissions jsonb := coalesce(p_staff_permissions, '{}'::jsonb);
begin
  if coalesce(p_device_role, '') = 'admin' then
    return true;
  end if;
  if coalesce(p_device_role, '') <> 'staff' then
    return false;
  end if;
  if coalesce((v_permissions->>'notifications')::boolean, false) is not true then
    return false;
  end if;

  v_category := private.pos_notification_category_v1(p_type, p_metadata);
  v_permission := case v_category
    when 'ecommerce' then 'notifications_ecommerce'
    when 'support' then 'notifications_support'
    when 'license' then 'notifications_license'
    when 'operations' then 'notifications_operations'
    else 'notifications_system'
  end;

  -- Backward compatible: old staff rows have only notifications=true.
  if not (v_permissions ? v_permission) then
    return true;
  end if;

  return coalesce((v_permissions->>v_permission)::boolean, false);
exception
  when others then
    return false;
end;
$function$;

revoke all on function private.pos_notification_category_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.pos_notification_category_allowed_v1(text, jsonb, text, jsonb) from public, anon, authenticated;

create or replace function public.list_pos_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_limit integer default 30,
  p_offset integer default 0,
  p_include_archived boolean default false,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_limit integer;
  v_offset integer;
  v_notifications jsonb;
  v_unread_count integer;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'list_pos_notifications'
  );

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_notifications as (
    select n.*, r.read_at, r.archived_at
    from public.pos_notifications n
    left join lateral (
      select
        min(pr.read_at) filter (where pr.read_at is not null) as read_at,
        min(pr.archived_at) filter (where pr.archived_at is not null) as archived_at
      from public.pos_notification_reads pr
      where pr.notification_id = n.id
        and pr.license_id = n.license_id
        and (
          (v_staff_user_id is not null and pr.staff_user_id = v_staff_user_id)
          or (v_staff_user_id is null and v_admin_user_id is not null and pr.admin_user_id = v_admin_user_id)
          or (
            v_staff_user_id is null
            and v_admin_user_id is null
            and pr.staff_user_id is null
            and pr.admin_user_id is null
            and pr.device_fingerprint = p_device_fingerprint
          )
        )
    ) r on true
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope,
        n.target_staff_user_id,
        n.target_device_role,
        n.metadata,
        v_device_role,
        v_staff_user_id,
        v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(
        n.type,
        n.metadata,
        v_device_role,
        v_staff_permissions
      )
  ), page_rows as (
    select *
    from visible_notifications
    where p_include_archived is true or archived_at is null
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'type', type,
        'category', private.pos_notification_category_v1(type, metadata),
        'severity', severity,
        'title', title,
        'body', body,
        'action_label', action_label,
        'action_route', action_route,
        'metadata', metadata,
        'source', source,
        'created_at', created_at,
        'starts_at', starts_at,
        'expires_at', expires_at,
        'read_at', read_at,
        'archived_at', archived_at,
        'is_read', read_at is not null,
        'is_archived', archived_at is not null,
        'is_dismissible', is_dismissible
      ) order by created_at desc, id desc)
      from page_rows
    ), '[]'::jsonb),
    (select count(*)::integer
       from visible_notifications
      where read_at is null and archived_at is null)
  into v_notifications, v_unread_count;

  return jsonb_build_object(
    'success', true,
    'notifications', v_notifications,
    'unread_count', coalesce(v_unread_count, 0)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case sqlerrm
        when 'NOTIFICATION_CENTER_DISABLED' then 'NOTIFICATION_CENTER_DISABLED'
        when 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        when 'POS_NOTIFICATIONS_RATE_LIMITED' then 'POS_NOTIFICATIONS_RATE_LIMITED'
        else 'LIST_POS_NOTIFICATIONS_FAILED'
      end,
      'message', case sqlerrm
        when 'NOTIFICATION_CENTER_DISABLED' then 'El centro de notificaciones no esta disponible para este plan.'
        when 'STAFF_NOTIFICATIONS_DISABLED' then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        when 'POS_NOTIFICATIONS_RATE_LIMITED' then 'Demasiadas solicitudes de notificaciones. Intenta de nuevo en unos minutos.'
        else 'No se pudieron cargar las notificaciones.'
      end,
      'notifications', '[]'::jsonb,
      'unread_count', 0
    );
end;
$function$;

create or replace function public.mark_pos_notification_read(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_notification_id uuid,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_notification_id uuid;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'mark_pos_notification_read'
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  select n.id into v_notification_id
  from public.pos_notifications n
  where n.id = p_notification_id
    and n.license_id = v_license_id
    and n.starts_at <= now()
    and (n.expires_at is null or n.expires_at >= now())
    and private.pos_notification_target_allowed_v1(
      n.target_scope,
      n.target_staff_user_id,
      n.target_device_role,
      n.metadata,
      v_device_role,
      v_staff_user_id,
      v_staff_permissions
    )
    and private.pos_notification_category_allowed_v1(
      n.type,
      n.metadata,
      v_device_role,
      v_staff_permissions
    )
  limit 1;

  if v_notification_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'NOTIFICATION_NOT_FOUND',
      'message', 'La notificacion no existe o no esta autorizada para este actor.'
    );
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    values (v_notification_id, v_license_id, v_staff_user_id, now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  elsif v_admin_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, admin_user_id, read_at)
    values (v_notification_id, v_license_id, v_admin_user_id, now())
    on conflict (notification_id, license_id, admin_user_id) where admin_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    values (v_notification_id, v_license_id, p_device_fingerprint, now())
    on conflict (notification_id, license_id, device_fingerprint)
      where staff_user_id is null and admin_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  perform private.broadcast_notification_event(
    p_license_id => v_license_id,
    p_event => 'notifications_changed',
    p_reason => 'notification_read_changed',
    p_notification_id => v_notification_id,
    p_metadata => jsonb_build_object('actor_state', 'read')
  );

  return jsonb_build_object('success', true, 'notification_id', v_notification_id);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'MARK_NOTIFICATION_READ_FAILED',
      'message', 'No se pudo marcar la notificacion como leida.'
    );
end;
$function$;

create or replace function public.archive_pos_notification(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_notification_id uuid,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_notification record;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'archive_pos_notification'
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  select n.id, n.is_dismissible into v_notification
  from public.pos_notifications n
  where n.id = p_notification_id
    and n.license_id = v_license_id
    and n.starts_at <= now()
    and (n.expires_at is null or n.expires_at >= now())
    and private.pos_notification_target_allowed_v1(
      n.target_scope,
      n.target_staff_user_id,
      n.target_device_role,
      n.metadata,
      v_device_role,
      v_staff_user_id,
      v_staff_permissions
    )
    and private.pos_notification_category_allowed_v1(
      n.type,
      n.metadata,
      v_device_role,
      v_staff_permissions
    )
  limit 1;

  if v_notification.id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'NOTIFICATION_NOT_FOUND',
      'message', 'La notificacion no existe o no esta autorizada para este actor.'
    );
  end if;

  if v_notification.is_dismissible is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'NOTIFICATION_NOT_DISMISSIBLE',
      'message', 'Esta notificacion no se puede archivar.'
    );
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at, archived_at)
    values (v_notification.id, v_license_id, v_staff_user_id, now(), now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set
      read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at),
      archived_at = coalesce(public.pos_notification_reads.archived_at, excluded.archived_at),
      updated_at = now();
  elsif v_admin_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, admin_user_id, read_at, archived_at)
    values (v_notification.id, v_license_id, v_admin_user_id, now(), now())
    on conflict (notification_id, license_id, admin_user_id) where admin_user_id is not null
    do update set
      read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at),
      archived_at = coalesce(public.pos_notification_reads.archived_at, excluded.archived_at),
      updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at, archived_at)
    values (v_notification.id, v_license_id, p_device_fingerprint, now(), now())
    on conflict (notification_id, license_id, device_fingerprint)
      where staff_user_id is null and admin_user_id is null
    do update set
      read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at),
      archived_at = coalesce(public.pos_notification_reads.archived_at, excluded.archived_at),
      updated_at = now();
  end if;

  perform private.broadcast_notification_event(
    p_license_id => v_license_id,
    p_event => 'notifications_changed',
    p_reason => 'notification_archive_changed',
    p_notification_id => v_notification.id,
    p_metadata => jsonb_build_object('actor_state', 'archived')
  );

  return jsonb_build_object('success', true, 'notification_id', v_notification.id);
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'ARCHIVE_NOTIFICATION_FAILED',
      'message', 'No se pudo archivar la notificacion.'
    );
end;
$function$;

create or replace function public.mark_all_pos_notifications_read(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_count integer := 0;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'mark_all_pos_notifications_read'
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    select n.id, n.license_id, v_staff_user_id, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id
          and r.license_id = n.license_id
          and r.staff_user_id = v_staff_user_id
          and r.archived_at is not null
      )
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  elsif v_admin_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, admin_user_id, read_at)
    select n.id, n.license_id, v_admin_user_id, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id
          and r.license_id = n.license_id
          and r.admin_user_id = v_admin_user_id
          and r.archived_at is not null
      )
    on conflict (notification_id, license_id, admin_user_id) where admin_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    select n.id, n.license_id, p_device_fingerprint, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id
          and r.license_id = n.license_id
          and r.staff_user_id is null
          and r.admin_user_id is null
          and r.device_fingerprint = p_device_fingerprint
          and r.archived_at is not null
      )
    on conflict (notification_id, license_id, device_fingerprint)
      where staff_user_id is null and admin_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.broadcast_notification_event(
      p_license_id => v_license_id,
      p_event => 'notifications_changed',
      p_reason => 'notifications_read_all_changed',
      p_metadata => jsonb_build_object('actor_state', 'read_all')
    );
  end if;

  return jsonb_build_object('success', true, 'updated_count', coalesce(v_count, 0));
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'MARK_ALL_NOTIFICATIONS_READ_FAILED',
      'message', 'No se pudieron marcar las notificaciones como leidas.'
    );
end;
$function$;

commit;