-- Append after foundation.sql. QA-only, NOT an approved commercial migration.
create table lanzo_ecom_bridge_qa.identities (
 id uuid primary key default gen_random_uuid(),
 license_id uuid not null references lanzo_ecom_bridge_qa.qa_tenants,
 device_id uuid not null references public.license_devices,
 actor_type text not null check(actor_type in ('admin','staff')),
 actor_id uuid not null, actor_session_id uuid not null,
 auth_user_id uuid unique, created_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz,
 unique(device_id,actor_session_id)
);
create table lanzo_ecom_bridge_qa.grants (
 id uuid primary key default gen_random_uuid(),
 identity_id uuid not null references lanzo_ecom_bridge_qa.identities,
 runtime_id uuid not null, actor_generation bigint not null check(actor_generation>=0),
 tenant_generation bigint not null check(tenant_generation>=0),
 auth_session_id uuid unique, vault text,
 expires_at timestamptz not null default clock_timestamp()+interval '120 seconds',
 revoked_at timestamptz, lease_id uuid, lease_until timestamptz,
 last_attempt timestamptz, attempts integer not null default 0,
 unique(identity_id,runtime_id)
);
alter table lanzo_ecom_bridge_qa.identities enable row level security;
alter table lanzo_ecom_bridge_qa.grants enable row level security;
revoke all on all tables in schema lanzo_ecom_bridge_qa from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;

-- Locks the canonical mutable rows as well as the grant. Updates that commit
-- before these locks are acquired are visible to the subsequent live check.
create function lanzo_ecom_bridge_qa.lock_authority(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare i lanzo_ecom_bridge_qa.identities;
begin
 select * into i from lanzo_ecom_bridge_qa.identities where id=p_id;
 if not found or i.retired_at is not null then return false; end if;
 perform 1 from public.licenses where id=i.license_id for share;
 perform 1 from public.plans where id=(select plan_id from public.licenses where id=i.license_id) for share;
 perform 1 from public.license_devices where id=i.device_id for share;
 if i.actor_type='admin' then
  perform 1 from public.license_admin_users where id=i.actor_id for share;
  perform 1 from public.license_admin_sessions where id=i.actor_session_id for share;
 else
  perform 1 from public.license_staff_users where id=i.actor_id for share;
  perform 1 from public.license_staff_sessions where id=i.actor_session_id for share;
 end if;
 return lanzo_ecom_bridge_qa.authority_live(i.license_id,i.device_id,i.actor_type,i.actor_id,i.actor_session_id);
end $$;
revoke all on function lanzo_ecom_bridge_qa.lock_authority(uuid) from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;

create function public.lanzo_ecom_bridge_qa_prepare(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.license_devices; a jsonb; i lanzo_ecom_bridge_qa.identities;
 g lanzo_ecom_bridge_qa.grants; lease uuid:=gen_random_uuid();
 runtime uuid:=(p->>'runtime_id')::uuid;
 ag bigint:=(p->>'actor_generation')::bigint; tg bigint:=(p->>'tenant_generation')::bigint;
begin
 if runtime is null or ag is null or tg is null or ag<0 or tg<0 then
  return jsonb_build_object('code','DENIED'); end if;
 -- Global QA cap and identity creation are serialized, not commercial traffic.
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select x.* into d from public.license_devices x join public.licenses l on l.id=x.license_id
 join lanzo_ecom_bridge_qa.qa_tenants q on q.license_id=l.id
 where l.license_key=p->>'license_key' and l.license_key like 'QA-ECOM-SIGNAL-R2-%'
 and x.device_fingerprint=p->>'device_fingerprint' and x.is_active
 and nullif(p->>'security_token','') is not null
 and (x.security_token=p->>'security_token' or x.previous_security_token=p->>'security_token');
 if not found then return jsonb_build_object('code','DENIED'); end if;
 -- Bound expensive password-hash verification, including invalid actor tokens.
 -- Canonical device proof is required before this bucket can be consumed.
 if exists(select 1 from lanzo_ecom_bridge_qa.device_limits where device_id=d.id
   and window_start>clock_timestamp()-interval '1 minute' and attempts>=20) then
  return jsonb_build_object('code','RATE_LIMITED'); end if;
 insert into lanzo_ecom_bridge_qa.device_limits values(d.id,clock_timestamp(),1)
 on conflict(device_id) do update set
 attempts=case when lanzo_ecom_bridge_qa.device_limits.window_start<clock_timestamp()-interval '1 minute' then 1 else lanzo_ecom_bridge_qa.device_limits.attempts+1 end,
 window_start=case when lanzo_ecom_bridge_qa.device_limits.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else lanzo_ecom_bridge_qa.device_limits.window_start end;
 a:=private.resolve_device_actor_session(d.license_id,d.id,d.device_mode,p->>'actor_session_token');
 if a->'success' is distinct from 'true'::jsonb or not lanzo_ecom_bridge_qa.authority_live(
 d.license_id,d.id,a->>'actor_type',(a->>'actor_id')::uuid,(a->>'actor_session_id')::uuid) then
  return jsonb_build_object('code','DENIED'); end if;
 select * into i from lanzo_ecom_bridge_qa.identities where device_id=d.id and actor_session_id=(a->>'actor_session_id')::uuid for update;
 if not found then
  if (select count(*) from lanzo_ecom_bridge_qa.identities)>=10 then return jsonb_build_object('code','CAPACITY'); end if;
  insert into lanzo_ecom_bridge_qa.identities(license_id,device_id,actor_type,actor_id,actor_session_id)
   values(d.license_id,d.id,a->>'actor_type',(a->>'actor_id')::uuid,(a->>'actor_session_id')::uuid) returning * into i;
 end if;
 if i.retired_at is not null then return jsonb_build_object('code','DENIED'); end if;
 -- One outstanding Auth operation per identity also protects createUser.
 if exists(select 1 from lanzo_ecom_bridge_qa.grants where identity_id=i.id and lease_id is not null) then
  -- An expired lease is quarantined, never blindly stolen after a crash.
  return jsonb_build_object('code','BUSY'); end if;
 select * into g from lanzo_ecom_bridge_qa.grants where identity_id=i.id and runtime_id=runtime for update;
 if found then
  if g.revoked_at is not null or g.expires_at<=clock_timestamp() or g.actor_generation<>ag or g.tenant_generation<>tg then
   return jsonb_build_object('code','DENIED'); end if;
 else
  if (select count(*) from lanzo_ecom_bridge_qa.grants where identity_id=i.id and revoked_at is null and expires_at>clock_timestamp())>=4 then return jsonb_build_object('code','CAPACITY'); end if;
  insert into lanzo_ecom_bridge_qa.grants(identity_id,runtime_id,actor_generation,tenant_generation)
   values(i.id,runtime,ag,tg) returning * into g;
 end if;
 if not lanzo_ecom_bridge_qa.lock_authority(i.id) then return jsonb_build_object('code','DENIED'); end if;
 if g.auth_session_id is not null and not exists(select 1 from auth.sessions where id=g.auth_session_id and user_id=i.auth_user_id) then return jsonb_build_object('code','DENIED'); end if;
 if g.last_attempt>clock_timestamp()-interval '10 seconds' and g.vault is not null then
  return jsonb_build_object('code','CACHED','id',g.id,'identity_id',i.id,'auth_user_id',i.auth_user_id,'auth_session_id',g.auth_session_id,'vault',g.vault,'expires_at',g.expires_at); end if;
 if g.attempts>=120 then return jsonb_build_object('code','CAPACITY'); end if;
 update lanzo_ecom_bridge_qa.grants set lease_id=lease,lease_until=clock_timestamp()+interval '30 seconds',last_attempt=clock_timestamp(),attempts=attempts+1 where id=g.id;
 return jsonb_build_object('code','RESERVED','id',g.id,'identity_id',i.id,'auth_user_id',i.auth_user_id,
  'lease_id',lease,'auth_session_id',g.auth_session_id,'vault',g.vault,'expires_at',g.expires_at);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('code','DENIED');
end $$;

create table lanzo_ecom_bridge_qa.device_limits(device_id uuid primary key references public.license_devices,window_start timestamptz not null,attempts integer not null);
alter table lanzo_ecom_bridge_qa.device_limits enable row level security;
revoke all on lanzo_ecom_bridge_qa.device_limits from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;

create function public.lanzo_ecom_bridge_qa_finish(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g lanzo_ecom_bridge_qa.grants; i lanzo_ecom_bridge_qa.identities; expiry timestamptz; session_expiry timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select * into g from lanzo_ecom_bridge_qa.grants where id=(p->>'id')::uuid for update;
 if not found or g.lease_id is distinct from (p->>'lease_id')::uuid or g.lease_until<=clock_timestamp()
 or g.revoked_at is not null or g.expires_at<=clock_timestamp() then return jsonb_build_object('code','DENIED'); end if;
 select * into i from lanzo_ecom_bridge_qa.identities where id=g.identity_id for update;
 if not lanzo_ecom_bridge_qa.lock_authority(i.id) then return jsonb_build_object('code','DENIED'); end if;
 if i.auth_user_id is not null and i.auth_user_id<>(p->>'auth_user_id')::uuid then return jsonb_build_object('code','DENIED'); end if;
 if g.auth_session_id is not null and g.auth_session_id<>(p->>'auth_session_id')::uuid then return jsonb_build_object('code','DENIED'); end if;
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=(p->>'auth_user_id')::uuid and s.id=(p->>'auth_session_id')::uuid
 and u.role='lanzo_ecom_bridge_receiver' and u.raw_app_meta_data->>'lanzo_bridge'='qa_1a2'
 and u.raw_app_meta_data->>'binding_id'=i.id::text) then return jsonb_build_object('code','DENIED'); end if;
 if i.actor_type='admin' then select expires_at into session_expiry from public.license_admin_sessions where id=i.actor_session_id;
 else select expires_at into session_expiry from public.license_staff_sessions where id=i.actor_session_id; end if;
 select least(clock_timestamp()+interval '120 seconds',session_expiry,coalesce(e.grace_period_ends,'infinity'::timestamptz)) into expiry
 from private.license_entitlement_state_v1(i.license_id) e;
 update lanzo_ecom_bridge_qa.identities set auth_user_id=(p->>'auth_user_id')::uuid where id=i.id;
 update lanzo_ecom_bridge_qa.grants set auth_session_id=(p->>'auth_session_id')::uuid,vault=p->>'vault',expires_at=expiry,
 lease_id=null,lease_until=null where id=g.id;
 return jsonb_build_object('code','READY','expires_at',expiry);
end $$;

create function public.lanzo_ecom_bridge_qa_abort(p jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),lease_id=null,lease_until=null,vault=null
 where id=(p->>'id')::uuid and lease_id=(p->>'lease_id')::uuid;
 return found;
end $$;

create function public.lanzo_ecom_bridge_qa_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g lanzo_ecom_bridge_qa.grants;
begin
 -- Same row lock as publish. Never unlock before realtime.send is enqueued.
 select * into g from lanzo_ecom_bridge_qa.grants where id=p_id for update;
 if not found then return jsonb_build_object('code','DENIED'); end if;
 update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
 return jsonb_build_object('code','REVOKED','barrier_at',clock_timestamp());
end $$;

create function public.lanzo_ecom_bridge_qa_publish(p_id uuid,p_probe uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g lanzo_ecom_bridge_qa.grants; i lanzo_ecom_bridge_qa.identities;
begin
 select * into g from lanzo_ecom_bridge_qa.grants where id=p_id for update;
 if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp() or g.auth_session_id is null then
  return jsonb_build_object('code','EXCLUDED'); end if;
 select * into i from lanzo_ecom_bridge_qa.identities where id=g.identity_id;
 if not lanzo_ecom_bridge_qa.lock_authority(i.id) or not exists(select 1 from auth.sessions where id=g.auth_session_id and user_id=i.auth_user_id) then
  return jsonb_build_object('code','EXCLUDED'); end if;
 -- Fixed event, topic derived from grant, no caller-controlled payload or topic.
 perform realtime.send(jsonb_build_object('probe_id',p_probe),'qa_probe','ecom:qa-probe:1a2:'||g.id::text,true);
 return jsonb_build_object('code','ENQUEUED','probe_id',p_probe,'enqueued_at',clock_timestamp());
end $$;

create function lanzo_ecom_bridge_qa.can_receive(p_topic text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare c jsonb:=auth.jwt();
begin
 if c->>'role' is distinct from 'lanzo_ecom_bridge_receiver'
 or c->>'iss' is distinct from 'https://odlrhijtfyavryeqivaa.supabase.co/auth/v1'
 or c->>'aud' is distinct from 'authenticated'
 or c->'app_metadata'->>'lanzo_bridge' is distinct from 'qa_1a2'
 or jsonb_typeof(c->'exp') is distinct from 'number' or (c->>'exp')::numeric<=extract(epoch from clock_timestamp()) then return false; end if;
 return exists(select 1 from lanzo_ecom_bridge_qa.grants g
 join lanzo_ecom_bridge_qa.identities i on i.id=g.identity_id
 join auth.sessions s on s.id=g.auth_session_id and s.user_id=i.auth_user_id
 where p_topic='ecom:qa-probe:1a2:'||g.id::text and i.auth_user_id=(c->>'sub')::uuid
 and g.auth_session_id=(c->>'session_id')::uuid and c->'app_metadata'->>'binding_id'=i.id::text
 and i.retired_at is null and g.revoked_at is null and g.expires_at>clock_timestamp()
 and lanzo_ecom_bridge_qa.authority_live(i.license_id,i.device_id,i.actor_type,i.actor_id,i.actor_session_id));
exception when others then return false;
end $$;
revoke all on function lanzo_ecom_bridge_qa.can_receive(text) from public,anon,authenticated,service_role;
grant usage on schema lanzo_ecom_bridge_qa,realtime to lanzo_ecom_bridge_receiver;
grant select on realtime.messages to lanzo_ecom_bridge_receiver;
grant execute on function lanzo_ecom_bridge_qa.can_receive(text) to lanzo_ecom_bridge_receiver;
create policy lanzo_ecom_bridge_qa_receive on realtime.messages for select to lanzo_ecom_bridge_receiver
 using(extension='broadcast' and (select lanzo_ecom_bridge_qa.can_receive((select realtime.topic()))));

-- Server cleanup retires identity before deleting Auth users. No new operations
-- can race collection. Quarantined leases require a grace period for in-flight IO.
create function public.lanzo_ecom_bridge_qa_collect()
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 with retired as(update lanzo_ecom_bridge_qa.identities i set retired_at=coalesce(retired_at,clock_timestamp())
 where (i.retired_at is not null or not lanzo_ecom_bridge_qa.authority_live(i.license_id,i.device_id,i.actor_type,i.actor_id,i.actor_session_id)
 or not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.revoked_at is null and g.expires_at>clock_timestamp()))
 and not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.lease_until>clock_timestamp()-interval '2 minutes')
 returning id) select array_agg(id) into ids from retired;
 update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),vault=null,lease_id=null,lease_until=null where identity_id=any(ids);
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'auth_user_id',auth_user_id)) from lanzo_ecom_bridge_qa.identities where id=any(ids)),'[]'::jsonb);
end $$;

do $$ declare signature text; begin
 foreach signature in array array[
  'public.lanzo_ecom_bridge_qa_prepare(jsonb)',
  'public.lanzo_ecom_bridge_qa_finish(jsonb)',
  'public.lanzo_ecom_bridge_qa_abort(jsonb)',
  'public.lanzo_ecom_bridge_qa_revoke(uuid)',
  'public.lanzo_ecom_bridge_qa_publish(uuid,uuid)',
  'public.lanzo_ecom_bridge_qa_collect()'] loop
 perform signature::regprocedure;
 execute 'revoke all on function '||signature||' from public,anon,authenticated,lanzo_ecom_bridge_receiver';
 execute 'grant execute on function '||signature||' to service_role';
 end loop;
end $$;
