-- Synthetic-only policy. 600s is a candidate, not commercial enablement.
create table lanzo_ecom_bridge_qa.lifecycle_policy(singleton boolean primary key check(singleton),grant_seconds integer not null check(grant_seconds in (120,300,600,900)));
insert into lanzo_ecom_bridge_qa.lifecycle_policy values(true,600);
alter table lanzo_ecom_bridge_qa.lifecycle_policy enable row level security;
revoke all on lanzo_ecom_bridge_qa.lifecycle_policy from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;
create function lanzo_ecom_bridge_qa.quarantine_anomaly(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare i lanzo_ecom_bridge_qa.identities;
begin
 select * into i from lanzo_ecom_bridge_qa.identities where id=p_id for update;
 if i.auth_user_id is null then return false; end if;
 if exists(select 1 from auth.sessions s where s.user_id=i.auth_user_id and not exists(
  select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.auth_session_id=s.id))
 or exists(select 1 from auth.mfa_factors f where f.user_id=i.auth_user_id) then
  update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),vault=null,lease_id=null,lease_until=null where identity_id=i.id;
  update lanzo_ecom_bridge_qa.identities set retired_at=coalesce(retired_at,clock_timestamp()) where id=i.id;
  return true;
 end if;
 return false;
end $$;
revoke all on function lanzo_ecom_bridge_qa.quarantine_anomaly(uuid) from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;
create or replace function public.lanzo_ecom_bridge_qa_prepare(p jsonb)
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
 if lanzo_ecom_bridge_qa.quarantine_anomaly(i.id) then return jsonb_build_object('code','DENIED'); end if;
 select * into g from lanzo_ecom_bridge_qa.grants where identity_id=i.id and runtime_id=runtime for update;
 if found then
  if g.revoked_at is not null or g.actor_generation<>ag or g.tenant_generation<>tg then
   return jsonb_build_object('code','DENIED'); end if;
  if g.expires_at<=clock_timestamp() then return jsonb_build_object('code','EXPIRED'); end if;
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
create or replace function public.lanzo_ecom_bridge_qa_finish(p jsonb)
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
 select least(clock_timestamp()+make_interval(secs=>(select grant_seconds from lanzo_ecom_bridge_qa.lifecycle_policy where singleton)),session_expiry,coalesce(e.grace_period_ends,'infinity'::timestamptz)) into expiry
 from private.license_entitlement_state_v1(i.license_id) e;
 update lanzo_ecom_bridge_qa.identities set auth_user_id=(p->>'auth_user_id')::uuid where id=i.id;
 update lanzo_ecom_bridge_qa.grants set auth_session_id=(p->>'auth_session_id')::uuid,vault=p->>'vault',expires_at=expiry,
 lease_id=null,lease_until=null where id=g.id;
 return jsonb_build_object('code','READY','expires_at',expiry);
end $$;
-- QA-only incremental collector. No scheduler or commercial users permitted.
alter table lanzo_ecom_bridge_qa.identities add column cleanup_completed_at timestamptz,
 add column cleanup_attempts integer not null default 0,
 add column cleanup_after timestamptz not null default '-infinity';
create index bridge_qa_cleanup_pending on lanzo_ecom_bridge_qa.identities(id)
 where cleanup_completed_at is null;
create index bridge_qa_grant_expiry on lanzo_ecom_bridge_qa.grants(identity_id,expires_at)
 where revoked_at is null;

create function public.lanzo_ecom_bridge_qa_collect_batch(p_after uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'COLLECTION_BUDGET'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select array_agg(id) into ids from (
  select i.id from lanzo_ecom_bridge_qa.identities i
  where (p_after is null or i.id>p_after) and i.cleanup_completed_at is null
  and i.cleanup_after<=clock_timestamp()
  and (i.retired_at is not null or not lanzo_ecom_bridge_qa.authority_live(i.license_id,i.device_id,i.actor_type,i.actor_id,i.actor_session_id)
   or not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.revoked_at is null and g.expires_at>clock_timestamp()))
  and not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.lease_until>clock_timestamp()-interval '2 minutes')
  -- Timed-out creates get a 3 minute grace before retiring their inventory.
  and i.created_at<clock_timestamp()-interval '3 minutes'
  order by i.id limit p_limit for update
 ) q;
 update lanzo_ecom_bridge_qa.identities set retired_at=coalesce(retired_at,clock_timestamp()) where id=any(ids);
 -- Shared with publisher/revoke: no new emissions after this commit.
 update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),vault=null,lease_id=null,lease_until=null where identity_id=any(ids);
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'auth_user_ids',(
   select coalesce(jsonb_agg(u.id order by u.id),'[]'::jsonb) from auth.users u
   where u.id=i.auth_user_id or (u.role='lanzo_ecom_bridge_receiver'
    and u.raw_app_meta_data->>'lanzo_bridge'='qa_1a2' and u.raw_app_meta_data->>'binding_id'=i.id::text
    and u.created_at<clock_timestamp()-interval '3 minutes')) ) order by i.id)
   from lanzo_ecom_bridge_qa.identities i where i.id=any(ids)),'[]'::jsonb);
end $$;

create function public.lanzo_ecom_bridge_qa_collect_ack(p_id uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 update lanzo_ecom_bridge_qa.identities i set
  cleanup_attempts=cleanup_attempts+1,
  cleanup_after=clock_timestamp()+least(interval '1 hour',interval '1 minute'*power(2,least(cleanup_attempts,6))),
  cleanup_completed_at=case when p_success and not exists(select 1 from auth.users u where u.id=i.auth_user_id
    or (u.role='lanzo_ecom_bridge_receiver' and u.raw_app_meta_data->>'lanzo_bridge'='qa_1a2' and u.raw_app_meta_data->>'binding_id'=i.id::text))
   then clock_timestamp() else null end
 where i.id=p_id and i.retired_at is not null;
 return found;
end $$;
revoke all on function public.lanzo_ecom_bridge_qa_collect_batch(uuid,integer),public.lanzo_ecom_bridge_qa_collect_ack(uuid,boolean) from public,anon,authenticated,lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_collect_batch(uuid,integer),public.lanzo_ecom_bridge_qa_collect_ack(uuid,boolean) to service_role;
create function public.lanzo_ecom_bridge_qa_retention(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; receipts integer; grants integer; identities integer;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'RETENTION_BUDGET'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select array_agg(id) into ids from (select i.id from lanzo_ecom_bridge_qa.identities i
  where i.retired_at is not null and i.cleanup_completed_at<clock_timestamp()-interval '30 days'
  and not exists(select 1 from auth.users u where u.id=i.auth_user_id or
   (u.role='lanzo_ecom_bridge_receiver' and u.raw_app_meta_data->>'lanzo_bridge'='qa_1a2' and u.raw_app_meta_data->>'binding_id'=i.id::text))
  and not exists(select 1 from public.license_admin_sessions s where s.id=i.actor_session_id and s.revoked_at is null and s.expires_at>clock_timestamp())
  and not exists(select 1 from public.license_staff_sessions s where s.id=i.actor_session_id and s.revoked_at is null and s.expires_at>clock_timestamp())
  and not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and (g.revoked_at is null or g.vault is not null or g.lease_id is not null))
  order by i.id limit p_limit for update) q;
 delete from lanzo_ecom_bridge_qa.publish_receipts r using lanzo_ecom_bridge_qa.grants g where r.grant_id=g.id and g.identity_id=any(ids);
 get diagnostics receipts=row_count;
 delete from lanzo_ecom_bridge_qa.grants where identity_id=any(ids); get diagnostics grants=row_count;
 delete from lanzo_ecom_bridge_qa.identities where id=any(ids); get diagnostics identities=row_count;
 return jsonb_build_object('identities',identities,'grants',grants,'receipts',receipts);
end $$;
revoke all on function public.lanzo_ecom_bridge_qa_retention(integer) from public,anon,authenticated,lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_retention(integer) to service_role;
-- No purge while a Lanzo session can still be valid. Tombstones and receipts
-- survive at least 30 days after Auth cleanup. No cron is installed.


