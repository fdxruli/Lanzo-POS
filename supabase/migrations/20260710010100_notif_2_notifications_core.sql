-- FASE NOTIF.DB.DRIFT.1
-- NOTIF.2 — Tablas/RPCs core de notificaciones cloud.
-- Replica contrato de producción: tablas cerradas, RLS activo, acceso solo por RPCs públicas aprobadas.

create schema if not exists private;

create table if not exists public.pos_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  target_scope text not null default 'license'::text,
  target_staff_user_id uuid null references public.license_staff_users(id) on delete cascade,
  target_device_role text null,
  type text not null default 'system'::text,
  severity text not null default 'info'::text,
  title text not null,
  body text null,
  action_label text null,
  action_route text null,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'system'::text,
  is_dismissible boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_notifications_type_check check (type = any (array['license','support','inventory','cash','system','commercial','ai','sync']::text[])),
  constraint pos_notifications_severity_check check (severity = any (array['critical','warning','info','success']::text[])),
  constraint pos_notifications_target_scope_check check (target_scope = any (array['license','admin','staff','role','plan','rubro']::text[])),
  constraint pos_notifications_source_check check (source = any (array['system','support','admin','ai','license','sync']::text[])),
  constraint pos_notifications_metadata_object_check check (jsonb_typeof(metadata) = 'object'::text)
);

create table if not exists public.pos_notification_reads (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.pos_notifications(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  staff_user_id uuid null references public.license_staff_users(id) on delete cascade,
  device_fingerprint text null,
  read_at timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_notification_reads_actor_check check ((staff_user_id is not null) or (nullif(btrim(coalesce(device_fingerprint, ''::text)), ''::text) is not null))
);

alter table public.pos_notifications
  add column if not exists target_scope text not null default 'license'::text,
  add column if not exists target_staff_user_id uuid null,
  add column if not exists target_device_role text null,
  add column if not exists type text not null default 'system'::text,
  add column if not exists severity text not null default 'info'::text,
  add column if not exists title text,
  add column if not exists body text null,
  add column if not exists action_label text null,
  add column if not exists action_route text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists source text not null default 'system'::text,
  add column if not exists is_dismissible boolean not null default true,
  add column if not exists starts_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.pos_notification_reads
  add column if not exists notification_id uuid,
  add column if not exists license_id uuid,
  add column if not exists staff_user_id uuid null,
  add column if not exists device_fingerprint text null,
  add column if not exists read_at timestamptz null,
  add column if not exists archived_at timestamptz null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_license_id_fkey') then
    alter table public.pos_notifications add constraint pos_notifications_license_id_fkey foreign key (license_id) references public.licenses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_target_staff_user_id_fkey') then
    alter table public.pos_notifications add constraint pos_notifications_target_staff_user_id_fkey foreign key (target_staff_user_id) references public.license_staff_users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_type_check') then
    alter table public.pos_notifications add constraint pos_notifications_type_check check (type = any (array['license','support','inventory','cash','system','commercial','ai','sync']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_severity_check') then
    alter table public.pos_notifications add constraint pos_notifications_severity_check check (severity = any (array['critical','warning','info','success']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_target_scope_check') then
    alter table public.pos_notifications add constraint pos_notifications_target_scope_check check (target_scope = any (array['license','admin','staff','role','plan','rubro']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_source_check') then
    alter table public.pos_notifications add constraint pos_notifications_source_check check (source = any (array['system','support','admin','ai','license','sync']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notifications'::regclass and conname = 'pos_notifications_metadata_object_check') then
    alter table public.pos_notifications add constraint pos_notifications_metadata_object_check check (jsonb_typeof(metadata) = 'object'::text);
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notification_reads'::regclass and conname = 'pos_notification_reads_notification_id_fkey') then
    alter table public.pos_notification_reads add constraint pos_notification_reads_notification_id_fkey foreign key (notification_id) references public.pos_notifications(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notification_reads'::regclass and conname = 'pos_notification_reads_license_id_fkey') then
    alter table public.pos_notification_reads add constraint pos_notification_reads_license_id_fkey foreign key (license_id) references public.licenses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notification_reads'::regclass and conname = 'pos_notification_reads_staff_user_id_fkey') then
    alter table public.pos_notification_reads add constraint pos_notification_reads_staff_user_id_fkey foreign key (staff_user_id) references public.license_staff_users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_notification_reads'::regclass and conname = 'pos_notification_reads_actor_check') then
    alter table public.pos_notification_reads add constraint pos_notification_reads_actor_check check ((staff_user_id is not null) or (nullif(btrim(coalesce(device_fingerprint, ''::text)), ''::text) is not null));
  end if;
end $$;

create index if not exists idx_pos_notifications_license_active_window on public.pos_notifications using btree (license_id, starts_at, expires_at);
create index if not exists idx_pos_notifications_license_created_at on public.pos_notifications using btree (license_id, created_at desc);
create index if not exists idx_pos_notifications_license_metadata_event_key on public.pos_notifications using btree (license_id, ((metadata ->> 'event_key'::text)));
create index if not exists idx_pos_notifications_license_seed on public.pos_notifications using btree (license_id, ((metadata ->> 'phase'::text)), ((metadata ->> 'seed'::text)));
create index if not exists idx_pos_notifications_license_severity on public.pos_notifications using btree (license_id, severity);
create index if not exists idx_pos_notifications_license_type on public.pos_notifications using btree (license_id, type);
create index if not exists idx_pos_notification_reads_license_archived_at on public.pos_notification_reads using btree (license_id, archived_at);
create index if not exists idx_pos_notification_reads_license_id on public.pos_notification_reads using btree (license_id);
create index if not exists idx_pos_notification_reads_license_read_at on public.pos_notification_reads using btree (license_id, read_at);
create index if not exists idx_pos_notification_reads_notification_id on public.pos_notification_reads using btree (notification_id);
create unique index if not exists uq_pos_notification_reads_device on public.pos_notification_reads using btree (notification_id, license_id, device_fingerprint) where (staff_user_id is null);
create unique index if not exists uq_pos_notification_reads_staff on public.pos_notification_reads using btree (notification_id, license_id, staff_user_id) where (staff_user_id is not null);

alter table public.pos_notifications enable row level security;
alter table public.pos_notification_reads enable row level security;

revoke all on table public.pos_notifications from public, anon, authenticated;
revoke all on table public.pos_notification_reads from public, anon, authenticated;

create or replace function private.touch_pos_notification_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.touch_pos_notification_updated_at() from public;
revoke all on function private.touch_pos_notification_updated_at() from anon;
revoke all on function private.touch_pos_notification_updated_at() from authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_pos_notifications_updated_at' and tgrelid = 'public.pos_notifications'::regclass) then
    create trigger trg_pos_notifications_updated_at
    before update on public.pos_notifications
    for each row execute function private.touch_pos_notification_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_pos_notification_reads_updated_at' and tgrelid = 'public.pos_notification_reads'::regclass) then
    create trigger trg_pos_notification_reads_updated_at
    before update on public.pos_notification_reads
    for each row execute function private.touch_pos_notification_updated_at();
  end if;
end $$;

create or replace function private.broadcast_notification_event(
  p_license_id uuid,
  p_event text default 'notifications_changed'::text,
  p_reason text default 'notification_created'::text,
  p_notification_id uuid default null::uuid,
  p_ticket_id uuid default null::uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_features jsonb;
  v_topic text;
  v_topics_count integer := 0;
  v_payload jsonb;
  v_metadata jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  limit 1;

  if v_features is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_NOT_FOUND');
  end if;

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true'
     or (
       (v_features->>'support_realtime') is distinct from 'true'
       and (v_features->>'realtime_license_sync') is distinct from 'true'
     ) then
    return jsonb_build_object('success', true, 'broadcasted', false, 'topics_count', 0, 'code', 'REALTIME_DISABLED');
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'event', coalesce(nullif(p_event, ''), 'notifications_changed'),
    'notification_id', p_notification_id,
    'ticket_id', p_ticket_id,
    'reason', coalesce(nullif(p_reason, ''), 'notification_created'),
    'created_at', now(),
    'metadata', v_metadata
  ));

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(v_payload, 'notification_event', v_topic, true);
    v_topics_count := v_topics_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'broadcasted', v_topics_count > 0,
    'topics_count', v_topics_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', coalesce(v_topics_count, 0),
      'code', 'BROADCAST_NOTIFICATION_EVENT_ERROR'
    );
end;
$function$;

revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from public;
revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from anon;
revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from authenticated;

create or replace function private.create_pos_notification(
  p_license_id uuid,
  p_title text,
  p_type text default 'system'::text,
  p_severity text default 'info'::text,
  p_body text default null::text,
  p_action_label text default null::text,
  p_action_route text default null::text,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system'::text,
  p_expires_at timestamptz default null::timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_metadata jsonb;
  v_metadata_event text;
  v_reason text := 'notification_created';
  v_ticket_id uuid := null;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  insert into public.pos_notifications (
    license_id,
    type,
    severity,
    title,
    body,
    action_label,
    action_route,
    metadata,
    source,
    expires_at
  ) values (
    p_license_id,
    coalesce(nullif(p_type, ''), 'system'),
    coalesce(nullif(p_severity, ''), 'info'),
    btrim(p_title),
    nullif(p_body, ''),
    nullif(p_action_label, ''),
    nullif(p_action_route, ''),
    v_metadata,
    coalesce(nullif(p_source, ''), 'system'),
    p_expires_at
  )
  returning id into v_id;

  v_metadata_event := v_metadata->>'event';

  v_reason := case
    when coalesce(p_source, '') = 'support' and v_metadata_event = 'support_reply' then 'support_reply'
    when coalesce(p_source, '') = 'support' and v_metadata_event = 'status_change' then 'ticket_status_changed'
    when coalesce(p_source, '') = 'support' then 'support_ticket_changed'
    when coalesce(p_source, '') = 'license'
      or v_metadata->>'generated_by' in ('NOTIF.5', 'NOTIF.8')
      or v_metadata->>'phase' in ('NOTIF.5', 'NOTIF.8') then 'operational_refresh'
    else 'notification_created'
  end;

  if coalesce(v_metadata->>'ticket_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_ticket_id := (v_metadata->>'ticket_id')::uuid;
  end if;

  perform private.broadcast_notification_event(
    p_license_id => p_license_id,
    p_event => 'notifications_changed',
    p_reason => v_reason,
    p_notification_id => v_id,
    p_ticket_id => v_ticket_id,
    p_metadata => jsonb_build_object(
      'type', coalesce(nullif(p_type, ''), 'system'),
      'severity', coalesce(nullif(p_severity, ''), 'info'),
      'source', coalesce(nullif(p_source, ''), 'system')
    )
  );

  return v_id;
end;
$function$;

create or replace function private.create_pos_notification_once(
  p_license_id uuid,
  p_event_key text,
  p_type text,
  p_severity text,
  p_title text,
  p_body text default null::text,
  p_action_label text default null::text,
  p_action_route text default null::text,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system'::text,
  p_expires_at timestamptz default null::timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing_id uuid;
  v_created_id uuid;
  v_metadata jsonb;
  v_generated_by text;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_ID_REQUIRED', 'message', 'License id is required.');
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    return jsonb_build_object('success', false, 'code', 'EVENT_KEY_REQUIRED', 'message', 'Event key is required.');
  end if;

  if not exists (select 1 from public.licenses l where l.id = p_license_id) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'License not found.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_license_id::text || ':' || p_event_key, 0));

  select n.id
  into v_existing_id
  from public.pos_notifications n
  where n.license_id = p_license_id
    and n.metadata->>'event_key' = p_event_key
  order by n.created_at desc
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object('success', true, 'created', false, 'notification_id', v_existing_id, 'event_key', p_event_key);
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_generated_by := coalesce(nullif(v_metadata->>'generated_by', ''), 'NOTIF.5');
  v_metadata := (v_metadata - 'event_key' - 'generated_by') || jsonb_build_object('event_key', p_event_key, 'generated_by', v_generated_by);

  v_created_id := private.create_pos_notification(
    p_license_id => p_license_id,
    p_title => p_title,
    p_type => p_type,
    p_severity => p_severity,
    p_body => p_body,
    p_action_label => p_action_label,
    p_action_route => p_action_route,
    p_metadata => v_metadata,
    p_source => p_source,
    p_expires_at => p_expires_at
  );

  return jsonb_build_object('success', true, 'created', true, 'notification_id', v_created_id, 'event_key', p_event_key);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'CREATE_POS_NOTIFICATION_ONCE_ERROR', 'message', 'Could not create operational notification.');
end;
$function$;

revoke all on function private.create_pos_notification(uuid, text, text, text, text, text, text, jsonb, text, timestamptz) from public;
revoke all on function private.create_pos_notification(uuid, text, text, text, text, text, text, jsonb, text, timestamptz) from anon;
revoke all on function private.create_pos_notification(uuid, text, text, text, text, text, text, jsonb, text, timestamptz) from authenticated;
revoke all on function private.create_pos_notification_once(uuid, text, text, text, text, text, text, text, jsonb, text, timestamptz) from public;
revoke all on function private.create_pos_notification_once(uuid, text, text, text, text, text, text, text, jsonb, text, timestamptz) from anon;
revoke all on function private.create_pos_notification_once(uuid, text, text, text, text, text, text, text, jsonb, text, timestamptz) from authenticated;

create or replace function private.get_pos_notification_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_rpc_name text default 'pos_notifications'::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_features jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(p_rpc_name, ''), 'pos_notifications'),
    p_scope := 'POS_NOTIFICATIONS',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 120,
    p_code := 'POS_NOTIFICATIONS_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    raise exception 'POS_NOTIFICATIONS_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  v_features := coalesce(v_context->'features', '{}'::jsonb);

  if coalesce((v_features->>'notification_center')::boolean, false) is not true
     or coalesce((v_features->>'cloud_notifications')::boolean, false) is not true then
    raise exception 'NOTIFICATION_CENTER_DISABLED' using errcode = 'P0001';
  end if;

  if coalesce(v_context->>'device_role', 'staff') = 'staff'
     and coalesce((v_context->'staff_permissions'->>'notifications')::boolean, false) is not true then
    raise exception 'STAFF_NOTIFICATIONS_DISABLED' using errcode = 'P0001';
  end if;

  return v_context;
end;
$function$;

revoke all on function private.get_pos_notification_context(text, text, text, text, text) from public;
revoke all on function private.get_pos_notification_context(text, text, text, text, text) from anon;
revoke all on function private.get_pos_notification_context(text, text, text, text, text) from authenticated;

create or replace function public.list_pos_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_limit integer default 30,
  p_offset integer default 0,
  p_include_archived boolean default false,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_device_role text;
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
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_notifications as (
    select
      n.*,
      r.read_at,
      r.archived_at
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and (
        (v_staff_user_id is not null and r.staff_user_id = v_staff_user_id)
        or (v_staff_user_id is null and r.staff_user_id is null and r.device_fingerprint = p_device_fingerprint)
      )
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and (
        n.target_scope = 'license'
        or (n.target_scope = 'admin' and v_device_role = 'admin')
        or (n.target_scope = 'staff' and v_staff_user_id is not null and (n.target_staff_user_id is null or n.target_staff_user_id = v_staff_user_id))
        or (n.target_scope = 'role' and (n.target_device_role is null or n.target_device_role = v_device_role))
        or n.target_scope in ('plan','rubro')
      )
  ), page_rows as (
    select *
    from visible_notifications
    where (p_include_archived is true or archived_at is null)
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'type', type,
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
  ) order by created_at desc, id desc), '[]'::jsonb)
  into v_notifications
  from page_rows;

  with visible_notifications as (
    select
      n.id,
      r.read_at,
      r.archived_at
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and (
        (v_staff_user_id is not null and r.staff_user_id = v_staff_user_id)
        or (v_staff_user_id is null and r.staff_user_id is null and r.device_fingerprint = p_device_fingerprint)
      )
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and (
        n.target_scope = 'license'
        or (n.target_scope = 'admin' and v_device_role = 'admin')
        or (n.target_scope = 'staff' and v_staff_user_id is not null and (n.target_staff_user_id is null or n.target_staff_user_id = v_staff_user_id))
        or (n.target_scope = 'role' and (n.target_device_role is null or n.target_device_role = v_device_role))
        or n.target_scope in ('plan','rubro')
      )
  )
  select count(*)::integer
  into v_unread_count
  from visible_notifications
  where read_at is null
    and archived_at is null;

  return jsonb_build_object(
    'success', true,
    'notifications', v_notifications,
    'unread_count', coalesce(v_unread_count, 0)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', sqlerrm,
      'message', case sqlerrm
        when 'NOTIFICATION_CENTER_DISABLED' then 'El centro de notificaciones no esta disponible para este plan.'
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
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_notification_id uuid;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'mark_pos_notification_read');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  select id into v_notification_id
  from public.pos_notifications
  where id = p_notification_id
    and license_id = v_license_id
    and starts_at <= now()
    and (expires_at is null or expires_at >= now())
  limit 1;

  if v_notification_id is null then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_FOUND', 'message', 'La notificacion no existe o no pertenece a esta licencia.');
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    values (v_notification_id, v_license_id, v_staff_user_id, now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    values (v_notification_id, v_license_id, p_device_fingerprint, now())
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  return jsonb_build_object('success', true, 'notification_id', v_notification_id);
exception
  when others then
    return jsonb_build_object('success', false, 'code', sqlerrm, 'message', 'No se pudo marcar la notificacion como leida.');
end;
$function$;

create or replace function public.mark_all_pos_notifications_read(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_device_role text;
  v_count integer := 0;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'mark_all_pos_notifications_read');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    select n.id, n.license_id, v_staff_user_id, now()
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and r.staff_user_id = v_staff_user_id
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and r.archived_at is null
      and (
        n.target_scope = 'license'
        or (n.target_scope = 'admin' and v_device_role = 'admin')
        or (n.target_scope = 'staff' and (n.target_staff_user_id is null or n.target_staff_user_id = v_staff_user_id))
        or (n.target_scope = 'role' and (n.target_device_role is null or n.target_device_role = v_device_role))
        or n.target_scope in ('plan','rubro')
      )
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    select n.id, n.license_id, p_device_fingerprint, now()
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and r.staff_user_id is null
      and r.device_fingerprint = p_device_fingerprint
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and r.archived_at is null
      and (
        n.target_scope = 'license'
        or (n.target_scope = 'admin' and v_device_role = 'admin')
        or (n.target_scope = 'role' and (n.target_device_role is null or n.target_device_role = v_device_role))
        or n.target_scope in ('plan','rubro')
      )
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'updated_count', coalesce(v_count, 0));
exception
  when others then
    return jsonb_build_object('success', false, 'code', sqlerrm, 'message', 'No se pudieron marcar las notificaciones como leidas.');
end;
$function$;

create or replace function public.archive_pos_notification(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_notification_id uuid,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_notification record;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'archive_pos_notification');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  select id, is_dismissible into v_notification
  from public.pos_notifications
  where id = p_notification_id
    and license_id = v_license_id
    and starts_at <= now()
    and (expires_at is null or expires_at >= now())
  limit 1;

  if v_notification.id is null then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_FOUND', 'message', 'La notificacion no existe o no pertenece a esta licencia.');
  end if;

  if v_notification.is_dismissible is not true then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_DISMISSIBLE', 'message', 'Esta notificacion no se puede archivar.');
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at, archived_at)
    values (v_notification.id, v_license_id, v_staff_user_id, now(), now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, now()), archived_at = coalesce(public.pos_notification_reads.archived_at, now()), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at, archived_at)
    values (v_notification.id, v_license_id, p_device_fingerprint, now(), now())
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, now()), archived_at = coalesce(public.pos_notification_reads.archived_at, now()), updated_at = now();
  end if;

  return jsonb_build_object('success', true, 'notification_id', v_notification.id);
exception
  when others then
    return jsonb_build_object('success', false, 'code', sqlerrm, 'message', 'No se pudo archivar la notificacion.');
end;
$function$;

revoke all on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) from public;
revoke all on function public.mark_pos_notification_read(text, text, text, uuid, text) from public;
revoke all on function public.mark_all_pos_notifications_read(text, text, text, text) from public;
revoke all on function public.archive_pos_notification(text, text, text, uuid, text) from public;

grant execute on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) to anon, authenticated;
grant execute on function public.mark_pos_notification_read(text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.mark_all_pos_notifications_read(text, text, text, text) to anon, authenticated;
grant execute on function public.archive_pos_notification(text, text, text, uuid, text) to anon, authenticated;
