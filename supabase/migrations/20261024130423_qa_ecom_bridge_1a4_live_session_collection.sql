create or replace function public.lanzo_ecom_bridge_qa_collect_batch(p_after uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'COLLECTION_BUDGET'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 -- Expired grants cannot renew. Clear only their unused vaults in a bounded
 -- batch, preserving session binding and the reason/identity of each tombstone.
 update lanzo_ecom_bridge_qa.grants set vault=null where id in (
  select id from lanzo_ecom_bridge_qa.grants where expires_at<=clock_timestamp()
   and vault is not null and lease_id is null order by id limit p_limit for update);
 select array_agg(id) into ids from (
  select i.id from lanzo_ecom_bridge_qa.identities i
  where (p_after is null or i.id>p_after) and i.cleanup_completed_at is null
  and i.cleanup_after<=clock_timestamp()
  and (i.retired_at is not null or not lanzo_ecom_bridge_qa.authority_live(i.license_id,i.device_id,i.actor_type,i.actor_id,i.actor_session_id)
   or (i.auth_user_id is null and not exists(select 1 from lanzo_ecom_bridge_qa.grants g where g.identity_id=i.id and g.revoked_at is null and g.expires_at>clock_timestamp())))
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


