\set ON_ERROR_STOP on

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create or replace function private.default_staff_permissions()
returns jsonb language sql immutable set search_path to '' as $$ select '{"notifications":true}'::jsonb $$;

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  features jsonb default '{}'::jsonb
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key varchar(255) not null unique,
  plan_id uuid references public.plans(id),
  license_type varchar(50) not null default 'pro',
  max_devices integer not null default 1,
  status varchar(20) default 'active',
  created_at timestamptz default now(),
  expires_at timestamptz,
  features jsonb,
  is_lifetime boolean default false
);

create table public.license_admin_users (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null default 'fixture',
  is_owner boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(id, license_id)
);

create table public.license_staff_users (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  username text not null,
  display_name text not null,
  password_hash text not null default 'fixture',
  role_name text not null default 'staff',
  permissions jsonb not null default private.default_staff_permissions(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique(id, license_id)
);

create table public.license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid references public.licenses(id) on delete cascade,
  device_fingerprint varchar(255) not null,
  is_active boolean default true,
  activated_at timestamptz default now(),
  last_used_at timestamptz default now(),
  security_token text,
  previous_security_token text,
  last_check_at timestamptz default now(),
  realtime_topic text,
  device_role text not null default 'staff' check (device_role in ('admin','staff')),
  staff_user_id uuid references public.license_staff_users(id) on delete set null,
  device_mode text not null default 'shared' check (device_mode in ('shared','admin_only','staff_only')),
  unique(license_id, device_fingerprint)
);

create table public.license_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  admin_user_id uuid not null references public.license_admin_users(id) on delete cascade,
  device_id uuid not null references public.license_devices(id) on delete cascade,
  session_token_hash text not null,
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table public.license_staff_sessions (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  staff_user_id uuid not null references public.license_staff_users(id) on delete cascade,
  device_id uuid not null references public.license_devices(id) on delete cascade,
  session_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.pos_notifications (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  target_scope text not null default 'license' check (target_scope in ('license','admin','staff','role','plan','rubro')),
  target_staff_user_id uuid,
  target_device_role text,
  type text not null default 'system' check (type in ('license','support','inventory','cash','system','commercial','ai','sync','ecommerce')),
  severity text not null default 'info' check (severity in ('critical','warning','info','success')),
  title text not null,
  body text,
  action_label text,
  action_route text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  source text not null default 'system' check (source in ('system','support','admin','ai','license','sync','ecommerce')),
  is_dismissible boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_notifications_id_license_id_key unique(id, license_id),
  constraint pos_notifications_target_staff_license_fkey foreign key(target_staff_user_id,license_id) references public.license_staff_users(id,license_id) on delete cascade
);

create index idx_pos_notifications_license_metadata_event_key on public.pos_notifications(license_id, ((metadata->>'event_key')));

create table public.pos_notification_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.pos_notifications(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  staff_user_id uuid,
  device_fingerprint text,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  admin_user_id uuid,
  constraint pos_notification_reads_actor_check check (num_nonnulls(staff_user_id,admin_user_id,nullif(btrim(coalesce(device_fingerprint,'')),''))=1),
  constraint pos_notification_reads_notification_license_fkey foreign key(notification_id,license_id) references public.pos_notifications(id,license_id) on delete cascade,
  constraint pos_notification_reads_staff_license_fkey foreign key(staff_user_id,license_id) references public.license_staff_users(id,license_id) on delete cascade,
  constraint pos_notification_reads_admin_license_fkey foreign key(admin_user_id,license_id) references public.license_admin_users(id,license_id) on delete cascade
);
create unique index uq_pos_notification_reads_admin on public.pos_notification_reads(notification_id,license_id,admin_user_id) where admin_user_id is not null;
create unique index uq_pos_notification_reads_staff on public.pos_notification_reads(notification_id,license_id,staff_user_id) where staff_user_id is not null;
create unique index uq_pos_notification_reads_device on public.pos_notification_reads(notification_id,license_id,device_fingerprint) where staff_user_id is null and admin_user_id is null;

create table public.license_events (
  id uuid primary key default gen_random_uuid(),
  license_key text not null,
  event_type text not null,
  triggered_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table public.pos_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  conflict_type text not null,
  resolution_status text not null default 'pending' check (resolution_status in ('pending','resolved','ignored')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.pos_notifications enable row level security;
alter table public.pos_notification_reads enable row level security;
alter table public.license_devices enable row level security;
alter table public.license_admin_users enable row level security;
alter table public.license_admin_sessions enable row level security;
alter table public.license_staff_users enable row level security;
alter table public.license_staff_sessions enable row level security;
alter table public.pos_sync_conflicts enable row level security;

revoke all on public.pos_notifications, public.pos_notification_reads, public.license_devices,
  public.license_admin_users, public.license_admin_sessions, public.license_staff_users,
  public.license_staff_sessions, public.pos_sync_conflicts from public, anon, authenticated;
grant all on public.pos_notifications, public.pos_notification_reads, public.license_devices,
  public.license_admin_users, public.license_admin_sessions, public.license_staff_users,
  public.license_staff_sessions, public.pos_sync_conflicts to service_role;

create or replace function public.enforce_pos_rpc_rate_limit_v2(
 p_license_key text,p_device_fingerprint text,p_staff_session_token text,p_rpc_name text,p_scope text,
 p_max_attempts integer,p_window_seconds integer,p_block_seconds integer,p_code text default 'RPC_RATE_LIMITED',p_metadata jsonb default '{}'
) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('allowed',true) $$;

create or replace function private.touch_license_staff_session_seen(p_session_id uuid,p_min_interval interval default interval '30 seconds')
returns void language plpgsql security definer set search_path to '' as $$ begin
 update public.license_staff_sessions set last_seen_at=now() where id=p_session_id; end $$;

create or replace function private.require_active_admin_session(p_license_key text,p_device_fingerprint text,p_device_security_token text,p_admin_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_license_id uuid; v_device_id uuid; v_session record;
begin
 select id into v_license_id from public.licenses where license_key=p_license_key and status='active' and (expires_at is null or expires_at>=now());
 if v_license_id is null then return jsonb_build_object('success',false,'code','LICENSE_NOT_ACTIVE'); end if;
 select id into v_device_id from public.license_devices where license_id=v_license_id and device_fingerprint=p_device_fingerprint and is_active is true and device_mode in ('admin_only','shared') and (security_token=p_device_security_token or previous_security_token=p_device_security_token) limit 1;
 if v_device_id is null then return jsonb_build_object('success',false,'code','ADMIN_DEVICE_REQUIRED'); end if;
 select s.id,s.admin_user_id,s.expires_at,u.username,u.display_name into v_session
 from public.license_admin_sessions s join public.license_admin_users u on u.id=s.admin_user_id
 where s.license_id=v_license_id and s.device_id=v_device_id and s.revoked_at is null and u.license_id=v_license_id and u.is_owner is true and u.is_active is true
 and extensions.crypt(p_admin_session_token,s.session_token_hash)=s.session_token_hash order by s.created_at desc limit 1;
 if v_session.id is null or v_session.expires_at<=now() then return jsonb_build_object('success',false,'code','ADMIN_SESSION_INVALID'); end if;
 return jsonb_build_object('success',true,'valid',true,'admin_user_id',v_session.admin_user_id,'admin_session_id',v_session.id,'admin_user',jsonb_build_object('id',v_session.admin_user_id,'username',v_session.username,'display_name',v_session.display_name));
end $$;

create or replace function private.validate_pos_sync_context(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
 v_license record; v_device record; v_actor_token text:=nullif(btrim(coalesce(p_staff_session_token,'')),'');
 v_admin_auth jsonb; v_admin_valid boolean:=false; v_staff record; v_staff_valid boolean:=false;
 v_actor_type text; v_actor_id uuid; v_actor_session_id uuid; v_actor_permissions jsonb:='{}'::jsonb;
begin
 select l.id,l.license_key,l.status,l.expires_at,coalesce(p.code,l.license_type::text) plan_code,p.name plan_name,coalesce(p.features,'{}'::jsonb)||coalesce(l.features,'{}'::jsonb) features into v_license
 from public.licenses l left join public.plans p on p.id=l.plan_id where l.license_key=p_license_key limit 1;
 if v_license.id is null then raise exception 'LICENSE_NOT_FOUND' using errcode='P0001'; end if;
 if v_license.status<>'active' then raise exception 'LICENSE_NOT_ACTIVE' using errcode='P0001'; end if;
 select d.id,d.license_id,d.device_fingerprint,d.security_token,d.previous_security_token,d.is_active,d.device_mode,d.device_role legacy_device_role,d.realtime_topic into v_device
 from public.license_devices d where d.license_id=v_license.id and d.device_fingerprint=p_device_fingerprint limit 1;
 if v_device.id is null or v_device.is_active is not true then raise exception 'DEVICE_NOT_ALLOWED' using errcode='P0001'; end if;
 if p_security_token is null or (p_security_token<>v_device.security_token and (v_device.previous_security_token is null or p_security_token<>v_device.previous_security_token)) then raise exception 'DEVICE_TOKEN_INVALID' using errcode='P0001'; end if;
 if v_actor_token is null then raise exception 'ACTOR_SESSION_REQUIRED' using errcode='P0001'; end if;
 if v_device.device_mode in ('admin_only','shared') then v_admin_auth:=private.require_active_admin_session(p_license_key,p_device_fingerprint,p_security_token,v_actor_token); v_admin_valid:=coalesce((v_admin_auth->>'success')::boolean,false); end if;
 if v_device.device_mode in ('staff_only','shared') then
   select ss.id session_id,ss.expires_at,s.id staff_user_id,s.username,s.display_name,s.role_name,s.permissions,s.is_active staff_is_active into v_staff
   from public.license_staff_sessions ss join public.license_staff_users s on s.id=ss.staff_user_id
   where ss.license_id=v_license.id and ss.device_id=v_device.id and s.license_id=v_license.id and ss.revoked_at is null and extensions.crypt(v_actor_token,ss.session_token_hash)=ss.session_token_hash order by ss.created_at desc limit 1;
   v_staff_valid:=v_staff.session_id is not null and v_staff.expires_at>now() and v_staff.staff_is_active is true;
 end if;
 if v_admin_valid and v_staff_valid then raise exception 'ACTOR_SESSION_AMBIGUOUS' using errcode='P0001'; end if;
 if not v_admin_valid and not v_staff_valid then raise exception 'ACTOR_SESSION_INVALID' using errcode='P0001'; end if;
 if v_admin_valid then v_actor_type := 'admin'; v_actor_id := (v_admin_auth->>'admin_user_id')::uuid; v_actor_session_id := (v_admin_auth->>'admin_session_id')::uuid; v_actor_permissions:=jsonb_build_object('*',true);
 else v_actor_type := 'staff'; v_actor_id := v_staff.staff_user_id; v_actor_session_id:=v_staff.session_id; v_actor_permissions:=coalesce(v_staff.permissions,'{}'::jsonb); end if;
 return jsonb_strip_nulls(jsonb_build_object('license_id',v_license.id,'license_key',v_license.license_key,'device_id',v_device.id,'device_mode',v_device.device_mode,'actor_type',v_actor_type,'actor_id',v_actor_id,'actor_session_id',v_actor_session_id,'actor_permissions',v_actor_permissions,'device_role',v_actor_type,'staff_user_id',case when v_actor_type='staff' then v_actor_id else null end,'staff_permissions',case when v_actor_type='staff' then v_actor_permissions else '{}'::jsonb end,'admin_user_id',case when v_actor_type='admin' then v_actor_id else null end,'admin_session_id',case when v_actor_type='admin' then v_actor_session_id else null end,'plan_code',v_license.plan_code,'plan_name',v_license.plan_name,'features',v_license.features,'realtime_topic',v_device.realtime_topic));
end $$;

create or replace function private.get_pos_notification_context(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text default null,p_rpc_name text default 'pos_notifications')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_rate_limit jsonb; v_context jsonb; v_features jsonb;
begin
 v_rate_limit:=public.enforce_pos_rpc_rate_limit_v2(p_license_key,p_device_fingerprint,null,p_rpc_name,'POS_NOTIFICATIONS',120,600,120,'POS_NOTIFICATIONS_RATE_LIMITED','{}');
 if coalesce((v_rate_limit->>'allowed')::boolean,false) is false then raise exception 'POS_NOTIFICATIONS_RATE_LIMITED' using errcode='P0001'; end if;
 v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
 v_features:=coalesce(v_context->'features','{}'::jsonb);
 if coalesce((v_features->>'notification_center')::boolean,false) is not true or coalesce((v_features->>'cloud_notifications')::boolean,false) is not true then raise exception 'NOTIFICATION_CENTER_DISABLED' using errcode='P0001'; end if;
 if coalesce(v_context->>'device_role','staff')='staff' and coalesce((v_context->'staff_permissions'->>'notifications')::boolean,false) is not true then raise exception 'STAFF_NOTIFICATIONS_DISABLED' using errcode='P0001'; end if;
 return v_context;
end $$;

create or replace function private.pos_notification_required_permission_allowed_v1(p_metadata jsonb,p_device_role text,p_staff_permissions jsonb)
returns boolean language sql stable security definer set search_path to '' as $$ select true $$;
create or replace function private.pos_notification_category_v1(p_type text,p_metadata jsonb default '{}') returns text language plpgsql stable security definer set search_path to '' as $$ begin
 if lower(coalesce(p_type,''))='ecommerce' or lower(coalesce(p_metadata->>'category',''))='ecommerce' then return 'ecommerce'; end if;
 if lower(coalesce(p_type,''))='support' or lower(coalesce(p_metadata->>'category',''))='support' then return 'support'; end if;
 if lower(coalesce(p_type,''))='license' or lower(coalesce(p_metadata->>'category',''))='license' then return 'license'; end if;
 if lower(coalesce(p_type,'')) in ('cash','sync','inventory') or lower(coalesce(p_metadata->>'category','')) in ('cash','sync','inventory','staff','operation','operations') then return 'operations'; end if; return 'system'; end $$;
create or replace function private.pos_notification_target_allowed_v1(p_target_scope text,p_target_staff_user_id uuid,p_target_device_role text,p_metadata jsonb,p_device_role text,p_staff_user_id uuid,p_staff_permissions jsonb)
returns boolean language sql stable security definer set search_path to '' as $$ select p_target_scope='license' or (p_target_scope='admin' and p_device_role='admin') or (p_target_scope='staff' and p_staff_user_id is not null and (p_target_staff_user_id is null or p_target_staff_user_id=p_staff_user_id)) or (p_target_scope='role' and (p_target_device_role is null or p_target_device_role=p_device_role)) or p_target_scope in ('plan','rubro') $$;
create or replace function private.pos_notification_category_allowed_v1(p_type text,p_metadata jsonb,p_device_role text,p_staff_permissions jsonb)
returns boolean language sql stable security definer set search_path to '' as $$ select case when p_device_role='admin' then true when p_device_role='staff' then coalesce((p_staff_permissions->>'notifications')::boolean,false) else false end $$;

create or replace function private.broadcast_notification_event(p_license_id uuid,p_event text default 'notifications_changed',p_reason text default 'notification_created',p_notification_id uuid default null,p_ticket_id uuid default null,p_metadata jsonb default '{}')
returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'broadcasted',false,'topics_count',0) $$;

create or replace function private.create_pos_notification(p_license_id uuid,p_title text,p_type text default 'system',p_severity text default 'info',p_body text default null,p_action_label text default null,p_action_route text default null,p_metadata jsonb default '{}',p_source text default 'system',p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to '' as $$ declare v_id uuid; begin insert into public.pos_notifications(license_id,type,severity,title,body,action_label,action_route,metadata,source,expires_at) values(p_license_id,p_type,p_severity,p_title,p_body,p_action_label,p_action_route,coalesce(p_metadata,'{}'),p_source,p_expires_at) returning id into v_id; return v_id; end $$;
create or replace function private.create_pos_notification_once(p_license_id uuid,p_event_key text,p_type text,p_severity text,p_title text,p_body text default null,p_action_label text default null,p_action_route text default null,p_metadata jsonb default '{}',p_source text default 'system',p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$ declare v_id uuid; begin select id into v_id from public.pos_notifications where license_id=p_license_id and metadata->>'event_key'=p_event_key order by created_at desc limit 1; if v_id is not null then return jsonb_build_object('success',true,'created',false,'notification_id',v_id,'event_key',p_event_key); end if; v_id:=private.create_pos_notification(p_license_id,p_title,p_type,p_severity,p_body,p_action_label,p_action_route,(coalesce(p_metadata,'{}')-'event_key')||jsonb_build_object('event_key',p_event_key),p_source,p_expires_at); return jsonb_build_object('success',true,'created',true,'notification_id',v_id,'event_key',p_event_key); end $$;

-- Existing public actor-state RPC signatures and semantics before the hotfix.
create or replace function public.list_pos_notifications(p_license_key text,p_device_fingerprint text,p_security_token text,p_limit integer default 30,p_offset integer default 0,p_include_archived boolean default false,p_staff_session_token text default null)
returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'notifications','[]'::jsonb,'unread_count',0) $$;

create or replace function public.mark_pos_notification_read(p_license_key text,p_device_fingerprint text,p_security_token text,p_notification_id uuid,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$ declare c jsonb; lid uuid; sid uuid; aid uuid; begin c:=private.get_pos_notification_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'mark_pos_notification_read'); lid:=(c->>'license_id')::uuid; sid:=nullif(c->>'staff_user_id','')::uuid; aid:=nullif(c->>'admin_user_id','')::uuid; if not exists(select 1 from public.pos_notifications n where n.id=p_notification_id and n.license_id=lid and private.pos_notification_target_allowed_v1(n.target_scope,n.target_staff_user_id,n.target_device_role,n.metadata,c->>'device_role',sid,coalesce(c->'staff_permissions','{}')) and private.pos_notification_category_allowed_v1(n.type,n.metadata,c->>'device_role',coalesce(c->'staff_permissions','{}'))) then return jsonb_build_object('success',false,'code','NOTIFICATION_NOT_FOUND'); end if; if sid is not null then insert into public.pos_notification_reads(notification_id,license_id,staff_user_id,read_at) values(p_notification_id,lid,sid,now()) on conflict(notification_id,license_id,staff_user_id) where staff_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at),updated_at=now(); elsif aid is not null then insert into public.pos_notification_reads(notification_id,license_id,admin_user_id,read_at) values(p_notification_id,lid,aid,now()) on conflict(notification_id,license_id,admin_user_id) where admin_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at),updated_at=now(); else raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if; return jsonb_build_object('success',true,'notification_id',p_notification_id); end $$;

create or replace function public.mark_all_pos_notifications_read(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$ declare c jsonb; lid uuid; sid uuid; aid uuid; n record; cnt int:=0; begin c:=private.get_pos_notification_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'mark_all_pos_notifications_read'); lid:=(c->>'license_id')::uuid; sid:=nullif(c->>'staff_user_id','')::uuid; aid:=nullif(c->>'admin_user_id','')::uuid; for n in select * from public.pos_notifications x where x.license_id=lid and x.starts_at<=now() and (x.expires_at is null or x.expires_at>=now()) and private.pos_notification_target_allowed_v1(x.target_scope,x.target_staff_user_id,x.target_device_role,x.metadata,c->>'device_role',sid,coalesce(c->'staff_permissions','{}')) and private.pos_notification_category_allowed_v1(x.type,x.metadata,c->>'device_role',coalesce(c->'staff_permissions','{}')) loop if sid is not null then insert into public.pos_notification_reads(notification_id,license_id,staff_user_id,read_at) values(n.id,lid,sid,now()) on conflict(notification_id,license_id,staff_user_id) where staff_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at); elsif aid is not null then insert into public.pos_notification_reads(notification_id,license_id,admin_user_id,read_at) values(n.id,lid,aid,now()) on conflict(notification_id,license_id,admin_user_id) where admin_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at); end if; cnt:=cnt+1; end loop; return jsonb_build_object('success',true,'updated_count',cnt); end $$;

create or replace function public.archive_pos_notification(p_license_key text,p_device_fingerprint text,p_security_token text,p_notification_id uuid,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$ declare c jsonb; lid uuid; sid uuid; aid uuid; begin c:=private.get_pos_notification_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'archive_pos_notification'); lid:=(c->>'license_id')::uuid; sid:=nullif(c->>'staff_user_id','')::uuid; aid:=nullif(c->>'admin_user_id','')::uuid; if sid is not null then insert into public.pos_notification_reads(notification_id,license_id,staff_user_id,read_at,archived_at) values(p_notification_id,lid,sid,now(),now()) on conflict(notification_id,license_id,staff_user_id) where staff_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at),archived_at=coalesce(public.pos_notification_reads.archived_at,excluded.archived_at); elsif aid is not null then insert into public.pos_notification_reads(notification_id,license_id,admin_user_id,read_at,archived_at) values(p_notification_id,lid,aid,now(),now()) on conflict(notification_id,license_id,admin_user_id) where admin_user_id is not null do update set read_at=coalesce(public.pos_notification_reads.read_at,excluded.read_at),archived_at=coalesce(public.pos_notification_reads.archived_at,excluded.archived_at); else raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if; return jsonb_build_object('success',true,'notification_id',p_notification_id); end $$;

create or replace function private.generate_staff_operational_notifications(uuid) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'generated',0,'events','[]'::jsonb) $$;
create or replace function private.generate_sync_operational_notifications(uuid) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'generated',0,'events','[]'::jsonb) $$;
create or replace function private.generate_cash_operational_notifications(uuid) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'generated',0,'events','[]'::jsonb) $$;
create or replace function private.generate_license_operational_notifications(uuid default null) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'generated',0,'events','[]'::jsonb) $$;
create or replace function public.refresh_operational_notifications(text,text,text,text default null) returns jsonb language sql security definer set search_path to '' as $$ select jsonb_build_object('success',true,'generated',0,'events','[]'::jsonb) $$;

revoke all on function private.validate_pos_sync_context(text,text,text,text) from public,anon,authenticated;
revoke all on function private.get_pos_notification_context(text,text,text,text,text) from public,anon,authenticated;
revoke all on function private.create_pos_notification_once(uuid,text,text,text,text,text,text,text,jsonb,text,timestamptz) from public,anon,authenticated;
revoke all on function private.generate_staff_operational_notifications(uuid) from public,anon,authenticated;
revoke all on function private.generate_sync_operational_notifications(uuid) from public,anon,authenticated;
revoke all on function private.generate_cash_operational_notifications(uuid) from public,anon,authenticated;
revoke all on function private.generate_license_operational_notifications(uuid) from public,anon,authenticated;

grant execute on function public.list_pos_notifications(text,text,text,integer,integer,boolean,text) to anon,authenticated,service_role;
grant execute on function public.mark_pos_notification_read(text,text,text,uuid,text) to anon,authenticated,service_role;
grant execute on function public.mark_all_pos_notifications_read(text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.archive_pos_notification(text,text,text,uuid,text) to anon,authenticated,service_role;
grant execute on function public.refresh_operational_notifications(text,text,text,text) to anon,authenticated,service_role;

-- Seed two licenses, two admins, two staff actors, and three devices for executable actor tests.
insert into public.plans(id,code,name,features) values
 ('00000000-0000-0000-0000-000000000001','pro','Pro','{"notification_center":true,"cloud_notifications":true}'::jsonb);
insert into public.licenses(id,license_key,plan_id,license_type,max_devices,status,created_at) values
 ('10000000-0000-0000-0000-000000000001','FIXTURE-A','00000000-0000-0000-0000-000000000001','pro',10,'active',now()),
 ('10000000-0000-0000-0000-000000000002','FIXTURE-B','00000000-0000-0000-0000-000000000001','pro',10,'active',now());
insert into public.license_admin_users(id,license_id,username,display_name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin-a','Admin A'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','admin-b','Admin B'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','admin-c','Admin C');
insert into public.license_staff_users(id,license_id,username,display_name,permissions) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','staff-a','Staff A','{"notifications":true}'::jsonb),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','staff-b','Staff B','{"notifications":true}'::jsonb);
insert into public.license_devices(id,license_id,device_fingerprint,is_active,security_token,device_role,device_mode) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','device-a1',true,'sec-a1','admin','admin_only'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','device-a2',true,'sec-a2','admin','admin_only'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','device-b',true,'sec-b','admin','admin_only'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','device-s1',true,'sec-s1','staff','staff_only'),
 ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','device-s2',true,'sec-s2','staff','staff_only');
insert into public.license_admin_sessions(license_id,admin_user_id,device_id,session_token_hash) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',extensions.crypt('admin-a-token',extensions.gen_salt('bf'))),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',extensions.crypt('admin-a-token',extensions.gen_salt('bf'))),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',extensions.crypt('admin-b-token',extensions.gen_salt('bf')));
insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004',extensions.crypt('staff-a-token',extensions.gen_salt('bf'))),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000005',extensions.crypt('staff-a-token',extensions.gen_salt('bf')));
insert into public.pos_notifications(id,license_id,target_scope,type,severity,title,metadata,source) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','license','system','info','Fixture notification','{}','system'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','admin','system','info','Admin only','{}','system'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','license','system','info','Other license','{}','system');
