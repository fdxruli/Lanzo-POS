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
