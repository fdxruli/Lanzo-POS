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
