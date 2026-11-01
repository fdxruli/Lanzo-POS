-- Exact 1A.4 inventory. Auth retirement must finish before SQL removal.
do $cleanup$
declare ids uuid[];
begin
 if exists(select 1 from auth.users where role='lanzo_ecom_bridge_receiver'
  or raw_app_meta_data->>'lanzo_bridge'='qa_1a2') then raise exception 'QA_AUTH_CLEANUP_REQUIRED'; end if;
 select array_agg(q.license_id) into ids from lanzo_ecom_bridge_qa.qa_tenants q
 join public.licenses l on l.id=q.license_id where l.license_key like
  'QA-ECOM-SIGNAL-R2-1A2-%43d9fccc-23a8-4e6e-b2a1-fa10ddcba918';
 if cardinality(ids) is distinct from 2 or (select count(*) from lanzo_ecom_bridge_qa.qa_tenants)<>2
 then raise exception 'QA_INVENTORY_CHANGED'; end if;
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
 delete from public.licenses where id=any(ids) and license_key like
  'QA-ECOM-SIGNAL-R2-1A2-%43d9fccc-23a8-4e6e-b2a1-fa10ddcba918';
end $cleanup$;
drop function public.lanzo_ecom_bridge_qa_collect_batch(uuid,integer);
drop function public.lanzo_ecom_bridge_qa_collect_ack(uuid,boolean);
drop function public.lanzo_ecom_bridge_qa_retention(integer);
drop function lanzo_ecom_bridge_qa.quarantine_anomaly(uuid);
drop table lanzo_ecom_bridge_qa.lifecycle_policy;
drop function public.lanzo_ecom_bridge_qa_quarantine(jsonb);
drop function public.lanzo_ecom_bridge_qa_reset_identity(jsonb);
drop function public.lanzo_ecom_bridge_qa_vault_batch();
drop function public.lanzo_ecom_bridge_qa_vault_cas(uuid,text,text);
drop table lanzo_ecom_bridge_qa.publish_receipts;
-- Followed by the exact 1A.2 object rollback in the SAME transaction.
-- Shared ACLs were never applied: do not run their rollback.
