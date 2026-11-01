-- Executed successfully, selective QA teardown; no CASCADE.
begin;set local lock_timeout='2s';set local statement_timeout='15s';
drop policy qa_ecom_1a1_f748296e_receive on realtime.messages;
drop function qa_ecom_1a1_f748296e.can_receive(text);
drop table qa_ecom_1a1_f748296e.grants;
drop schema qa_ecom_1a1_f748296e;
revoke select on realtime.messages from qa_ecom_1a1_f748296e;
revoke usage on schema realtime from qa_ecom_1a1_f748296e;
drop role qa_ecom_1a1_f748296e;commit;
