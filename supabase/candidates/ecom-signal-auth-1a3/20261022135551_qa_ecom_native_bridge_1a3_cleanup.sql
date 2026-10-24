-- Exact QA allowlist created by this run; no CASCADE or shared ACL rollback.
do $cleanup$
declare ids uuid[];
begin
 if exists(select 1 from auth.users where role='lanzo_ecom_bridge_receiver'
 or raw_app_meta_data->>'lanzo_bridge' in ('qa_1a2','qa_1a3_expiry')) then raise exception 'QA_AUTH_CLEANUP_REQUIRED';end if;
 select array_agg(q.license_id) into ids from lanzo_ecom_bridge_qa.qa_tenants q
 join public.licenses l on l.id=q.license_id where l.license_key like 'QA-ECOM-SIGNAL-R2-1A2-%';
 if cardinality(ids) is distinct from 2 or (select count(*) from lanzo_ecom_bridge_qa.qa_tenants)<>2
 then raise exception 'QA_INVENTORY_CHANGED';end if;
 delete from lanzo_ecom_bridge_qa.publish_receipts r using lanzo_ecom_bridge_qa.grants g,lanzo_ecom_bridge_qa.identities i
 where r.grant_id=g.id and g.identity_id=i.id and i.license_id=any(ids);
 delete from lanzo_ecom_bridge_qa.grants g using lanzo_ecom_bridge_qa.identities i where g.identity_id=i.id and i.license_id=any(ids);
 delete from lanzo_ecom_bridge_qa.identities where license_id=any(ids);
 delete from lanzo_ecom_bridge_qa.device_limits d using public.license_devices x where d.device_id=x.id and x.license_id=any(ids);
 delete from lanzo_ecom_bridge_qa.qa_tenants where license_id=any(ids);
 delete from public.license_staff_sessions where license_id=any(ids);
 delete from public.license_admin_sessions where license_id=any(ids);
 delete from public.license_staff_users where license_id=any(ids);
 delete from public.license_admin_users where license_id=any(ids);
 delete from public.license_devices where license_id=any(ids);
 delete from public.licenses where id=any(ids) and license_key like 'QA-ECOM-SIGNAL-R2-1A2-%';
end $cleanup$;
-- After clients stop and ONLY inventoried Auth users/fixtures are deleted.
-- Apply as a new cleanup migration; never remove migration history.
drop policy lanzo_ecom_expiry_qa_1a3_receive on realtime.messages;
drop function public.lanzo_ecom_expiry_qa_1a3_bind(uuid,uuid,text,bigint);
drop function public.lanzo_ecom_expiry_qa_1a3_probe(text,uuid);
drop function lanzo_ecom_expiry_qa_1a3.can_receive(text);
drop table lanzo_ecom_expiry_qa_1a3.bindings;
drop schema lanzo_ecom_expiry_qa_1a3;
drop function public.lanzo_ecom_bridge_qa_quarantine(jsonb);
drop function public.lanzo_ecom_bridge_qa_reset_identity(jsonb);
drop function public.lanzo_ecom_bridge_qa_vault_batch();
drop function public.lanzo_ecom_bridge_qa_vault_cas(uuid,text,text);
drop table lanzo_ecom_bridge_qa.publish_receipts;
-- Then run ../ecom-signal-auth-1a2/rollback.sql in the same transaction.
-- Shared PUBLIC ACLs were not applied, so do not run their rollback.

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
