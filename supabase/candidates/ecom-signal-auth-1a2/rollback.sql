-- First stop QA traffic and delete ONLY tagged Auth identities via collector.
-- Remove this phase's objects selectively, never CASCADE/shared ACL changes.
drop policy lanzo_ecom_bridge_qa_receive on realtime.messages;
-- Include only if the separate QA race instrumentation was installed.
drop function if exists public.lanzo_ecom_bridge_qa_race(uuid,uuid,text);
drop function public.lanzo_ecom_bridge_qa_prepare(jsonb);
drop function public.lanzo_ecom_bridge_qa_finish(jsonb);
drop function public.lanzo_ecom_bridge_qa_abort(jsonb);
drop function public.lanzo_ecom_bridge_qa_revoke(uuid);
drop function public.lanzo_ecom_bridge_qa_publish(uuid,uuid);
drop function public.lanzo_ecom_bridge_qa_collect();
drop function lanzo_ecom_bridge_qa.can_receive(text);
drop function lanzo_ecom_bridge_qa.lock_authority(uuid);
drop function lanzo_ecom_bridge_qa.authority_live(uuid,uuid,text,uuid,uuid);
drop table lanzo_ecom_bridge_qa.device_limits;
drop table lanzo_ecom_bridge_qa.grants;
drop table lanzo_ecom_bridge_qa.identities;
drop table lanzo_ecom_bridge_qa.qa_tenants;
drop schema lanzo_ecom_bridge_qa;
revoke select on realtime.messages from lanzo_ecom_bridge_receiver;
revoke usage on schema realtime from lanzo_ecom_bridge_receiver;
drop role lanzo_ecom_bridge_receiver;
