-- QA only. Append to the 1A.2 foundation; never enables commercial signals.
create table lanzo_ecom_bridge_qa.publish_receipts(
 grant_id uuid references lanzo_ecom_bridge_qa.grants, probe_id uuid,
 enqueued_at timestamptz not null default clock_timestamp(), primary key(grant_id,probe_id));
alter table lanzo_ecom_bridge_qa.publish_receipts enable row level security;
revoke all on lanzo_ecom_bridge_qa.publish_receipts from public,anon,authenticated,service_role,lanzo_ecom_bridge_receiver;

create or replace function public.lanzo_ecom_bridge_qa_publish(p_id uuid,p_probe uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g lanzo_ecom_bridge_qa.grants; i lanzo_ecom_bridge_qa.identities;
begin
 if p_probe is null then return jsonb_build_object('code','DENIED'); end if;
 select * into g from lanzo_ecom_bridge_qa.grants where id=p_id for update;
 if not found or g.revoked_at is not null or g.expires_at<=clock_timestamp() or g.auth_session_id is null then
  return jsonb_build_object('code','EXCLUDED'); end if;
 select * into i from lanzo_ecom_bridge_qa.identities where id=g.identity_id;
 if not lanzo_ecom_bridge_qa.lock_authority(i.id) or not exists(select 1 from auth.sessions where id=g.auth_session_id and user_id=i.auth_user_id) then
  return jsonb_build_object('code','EXCLUDED'); end if;
 if exists(select 1 from lanzo_ecom_bridge_qa.publish_receipts where grant_id=g.id and probe_id=p_probe) then
  return jsonb_build_object('code','ALREADY_ENQUEUED','probe_id',p_probe); end if;
 perform realtime.send(jsonb_build_object('probe_id',p_probe),'qa_probe','ecom:qa-probe:1a2:'||g.id::text,true);
 insert into lanzo_ecom_bridge_qa.publish_receipts(grant_id,probe_id) values(g.id,p_probe);
 return jsonb_build_object('code','ENQUEUED','probe_id',p_probe,'enqueued_at',clock_timestamp());
end $$;

-- Explicit owner recovery, independent of the runtime/grant cap. Does not trust
-- the receiver JWT, public IDs, user_metadata or mutable Auth email.
create function public.lanzo_ecom_bridge_qa_quarantine(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.license_devices; a jsonb; i lanzo_ecom_bridge_qa.identities;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select x.* into d from public.license_devices x join public.licenses l on l.id=x.license_id
 join lanzo_ecom_bridge_qa.qa_tenants q on q.license_id=l.id
 where l.license_key=p->>'license_key' and l.license_key like 'QA-ECOM-SIGNAL-R2-%'
 and x.device_fingerprint=p->>'device_fingerprint' and x.is_active
 and nullif(p->>'security_token','') is not null
 and (x.security_token=p->>'security_token' or x.previous_security_token=p->>'security_token');
 if not found then return jsonb_build_object('code','DENIED'); end if;
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
 if not found then return jsonb_build_object('code','DENIED'); end if;
 -- UPDATE takes the same per-grant lock held through realtime.send by publish.
 update lanzo_ecom_bridge_qa.grants set revoked_at=coalesce(revoked_at,clock_timestamp()),vault=null,lease_id=null,lease_until=null where identity_id=i.id;
 update lanzo_ecom_bridge_qa.identities set retired_at=coalesce(retired_at,clock_timestamp()) where id=i.id;
 return jsonb_build_object('code','QUARANTINED','identity_id',i.id,'auth_user_id',i.auth_user_id);
end $$;

create function public.lanzo_ecom_bridge_qa_reset_identity(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i lanzo_ecom_bridge_qa.identities;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select * into i from lanzo_ecom_bridge_qa.identities where id=(p->>'identity_id')::uuid for update;
 if not found or i.retired_at is null or i.auth_user_id is distinct from (p->>'auth_user_id')::uuid
 or exists(select 1 from auth.users where id=i.auth_user_id)
 or exists(select 1 from lanzo_ecom_bridge_qa.grants where identity_id=i.id and revoked_at is null)
 then return jsonb_build_object('code','DENIED'); end if;
 update lanzo_ecom_bridge_qa.identities set auth_user_id=null,retired_at=null where id=i.id;
 return jsonb_build_object('code','RECOVERED');
end $$;

create function public.lanzo_ecom_bridge_qa_vault_batch()
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'vault',g.vault)),'[]'::jsonb) from
 (select id,vault from lanzo_ecom_bridge_qa.grants where vault is not null and revoked_at is null
 and expires_at>clock_timestamp() and lease_id is null order by id limit 40) g
$$;
create function public.lanzo_ecom_bridge_qa_vault_cas(p_id uuid,p_previous text,p_next text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_next not like 'v2.%' or length(p_next)>32768 then return false; end if;
 update lanzo_ecom_bridge_qa.grants set vault=p_next where id=p_id and vault=p_previous
 and revoked_at is null and expires_at>clock_timestamp() and lease_id is null;
 return found;
end $$;
revoke all on function public.lanzo_ecom_bridge_qa_quarantine(jsonb),public.lanzo_ecom_bridge_qa_reset_identity(jsonb),public.lanzo_ecom_bridge_qa_vault_batch(),public.lanzo_ecom_bridge_qa_vault_cas(uuid,text,text) from public,anon,authenticated,lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_quarantine(jsonb),public.lanzo_ecom_bridge_qa_reset_identity(jsonb),public.lanzo_ecom_bridge_qa_vault_batch(),public.lanzo_ecom_bridge_qa_vault_cas(uuid,text,text) to service_role;
