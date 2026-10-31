-- Reset cleanup progress only after the inventoried compromised user is absent.
create or replace function public.lanzo_ecom_bridge_qa_reset_identity(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i lanzo_ecom_bridge_qa.identities;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select * into i from lanzo_ecom_bridge_qa.identities where id=(p->>'identity_id')::uuid for update;
 if not found or i.retired_at is null or i.auth_user_id is distinct from (p->>'auth_user_id')::uuid
 or exists(select 1 from auth.users where id=i.auth_user_id)
 or exists(select 1 from lanzo_ecom_bridge_qa.grants where identity_id=i.id and revoked_at is null)
 then return jsonb_build_object('code','DENIED'); end if;
 update lanzo_ecom_bridge_qa.identities set auth_user_id=null,retired_at=null,
  cleanup_completed_at=null,cleanup_attempts=0,cleanup_after='-infinity' where id=i.id;
 return jsonb_build_object('code','RECOVERED');
end $$;

-- Temporary, service-only concurrent-transaction measurement; qa_probe only.
create function public.lanzo_ecom_bridge_qa_race(p_id uuid,p_probe uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_action not in ('publish','revoke') then raise exception 'QA_ACTION';end if;
 perform 1 from lanzo_ecom_bridge_qa.grants where id=p_id for update;
 if p_action='publish' then result:=public.lanzo_ecom_bridge_qa_publish(p_id,p_probe);
 else result:=public.lanzo_ecom_bridge_qa_revoke(p_id);end if;
 perform pg_sleep(3);
 return result;
end $$;
revoke all on function public.lanzo_ecom_bridge_qa_race(uuid,uuid,text) from public,anon,authenticated,lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_race(uuid,uuid,text) to service_role;
