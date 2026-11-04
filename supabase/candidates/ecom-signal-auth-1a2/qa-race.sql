create function public.lanzo_ecom_bridge_qa_race(p_id uuid,p_probe uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_action not in ('publish','revoke') then raise exception 'QA_ACTION';end if;
 perform set_config('application_name','lanzo_qa_1a2_'||p_action,true);
 perform 1 from lanzo_ecom_bridge_qa.grants where id=p_id for update;
 if p_action='publish' then result:=public.lanzo_ecom_bridge_qa_publish(p_id,p_probe);
 else result:=public.lanzo_ecom_bridge_qa_revoke(p_id);end if;
 perform pg_sleep(3);
 return result;
end $$;
revoke all on function public.lanzo_ecom_bridge_qa_race(uuid,uuid,text) from public,anon,authenticated,lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_race(uuid,uuid,text) to service_role;
