begin;
set local lock_timeout='2s'; set local statement_timeout='15s';
create role qa_ecom_1a1_f748296e nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create schema qa_ecom_1a1_f748296e authorization postgres;
revoke all on schema qa_ecom_1a1_f748296e from public,anon,authenticated,service_role;
create table qa_ecom_1a1_f748296e.grants(id uuid primary key,topic text not null unique,user_id uuid not null,session_id uuid not null,scope text not null,tenant_id uuid not null,revoked_at timestamptz,expires_at timestamptz not null);
alter table qa_ecom_1a1_f748296e.grants enable row level security;
revoke all on qa_ecom_1a1_f748296e.grants from public,anon,authenticated,service_role,qa_ecom_1a1_f748296e;
insert into qa_ecom_1a1_f748296e.grants values ('f748296e-1fba-4c89-b3e3-c2a4a489bc06','ecom:qa-probe:1a1:f748296e-1fba-4c89-b3e3-c2a4a489bc06','7fbeaf5b-d4d5-4119-acad-eb0a66ee33fb','18d098cb-82de-4021-b29e-fbcdbd8525d6','qa_probe','f748296e-1fba-4c89-b3e3-c2a4a489bc06',null,clock_timestamp()+interval '1 hour');
create function qa_ecom_1a1_f748296e.can_receive(p_topic text) returns boolean language sql volatile security definer set search_path='' as $fn$
select exists (select 1 from qa_ecom_1a1_f748296e.grants g join auth.sessions s on s.id=g.session_id and s.user_id=g.user_id
where g.topic=p_topic and g.user_id::text=auth.jwt()->>'sub' and g.session_id::text=auth.jwt()->>'session_id'
and auth.jwt()->>'role'='qa_ecom_1a1_f748296e'
and auth.jwt()->>'iss'='https://odlrhijtfyavryeqivaa.supabase.co/auth/v1'
and auth.jwt()->>'aud'='authenticated'
and auth.jwt()->'app_metadata'->>'qa_run'='f748296e-1fba-4c89-b3e3-c2a4a489bc06'
and auth.jwt()->'app_metadata'->>'scope'=g.scope
and g.revoked_at is null and g.expires_at>clock_timestamp());
$fn$;
revoke all on function qa_ecom_1a1_f748296e.can_receive(text) from public,anon,authenticated,service_role;
grant usage on schema qa_ecom_1a1_f748296e,realtime to qa_ecom_1a1_f748296e;
grant execute on function qa_ecom_1a1_f748296e.can_receive(text) to qa_ecom_1a1_f748296e;
grant select on realtime.messages to qa_ecom_1a1_f748296e;
create policy qa_ecom_1a1_f748296e_receive on realtime.messages for select to qa_ecom_1a1_f748296e using (extension='broadcast' and qa_ecom_1a1_f748296e.can_receive((select realtime.topic())));
commit;
select jsonb_build_object('qa_role','qa_ecom_1a1_f748296e','policy_count',(select count(*) from pg_policies where schemaname='realtime' and tablename='messages'),'memberships',(select count(*) from pg_auth_members where member=(select oid from pg_roles where rolname='qa_ecom_1a1_f748296e') or roleid=(select oid from pg_roles where rolname='qa_ecom_1a1_f748296e')));