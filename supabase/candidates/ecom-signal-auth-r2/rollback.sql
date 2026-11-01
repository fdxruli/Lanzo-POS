-- REVIEW ONLY. Not needed for the executed tests: their final ROLLBACK already
-- removed role, schema, policy and synthetic rows. Run only if these exact
-- candidate objects were later installed, after stopping issuer and publisher.
-- Never CASCADE: unexpected dependencies must stop the rollback for review.
begin;
set local lock_timeout='2s';
set local statement_timeout='25s';
drop policy if exists lanzo_ecom_signal_qa_receive_r2 on realtime.messages;
drop function if exists public.lanzo_revoke_ecom_signal_qa_grant(uuid);
drop function if exists public.lanzo_issue_ecom_signal_qa_grant(text,text,text,text,uuid,bigint,bigint,integer);
drop function if exists lanzo_ecom_signal.can_receive(text);
drop function if exists lanzo_ecom_signal.authority_live(uuid,uuid,text,uuid,uuid);
drop table if exists lanzo_ecom_signal.grants;
drop table if exists lanzo_ecom_signal.qa_tenants;
revoke select on realtime.messages from lanzo_ecom_signal_receiver;
revoke usage on schema realtime from lanzo_ecom_signal_receiver;
drop schema if exists lanzo_ecom_signal;
drop role if exists lanzo_ecom_signal_receiver;
-- If a real migration had been applied, record this rollback as a NEW forward
-- migration; never erase or edit an applied ledger entry.
commit;
