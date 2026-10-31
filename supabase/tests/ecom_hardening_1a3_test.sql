-- Installed synthetic QA bindings only. Always rollback. Each negative case is
-- isolated: license triggers can revoke OTHER actor sessions.
begin;
set local statement_timeout='25s';set local lock_timeout='2s';
create temp table hardening_results(id text primary key,pass boolean);
create function pg_temp.excluded_case(p_label text,p_grant uuid,p_mutation text)
returns void language plpgsql as $$
declare r jsonb;pass boolean;
begin
 begin
  execute p_mutation;
  r:=public.lanzo_ecom_bridge_qa_publish(p_grant,gen_random_uuid());pass:=r->>'code'='EXCLUDED';
  raise exception 'ROLLBACK_CASE' using errcode='PZ001';
 exception when sqlstate 'PZ001' then null;
 end;
 insert into hardening_results values(p_label,pass);
end $$;
do $$
declare g lanzo_ecom_bridge_qa.grants;i record;
begin
 for i in select x.* from lanzo_ecom_bridge_qa.identities x join lanzo_ecom_bridge_qa.qa_tenants q on q.license_id=x.license_id
 where x.auth_user_id is not null loop
  select x.* into g from lanzo_ecom_bridge_qa.grants x join auth.sessions a on a.id=x.auth_session_id and a.user_id=i.auth_user_id
  where x.identity_id=i.id order by x.expires_at desc limit 1;
  if not found then continue;end if;
  update lanzo_ecom_bridge_qa.identities set retired_at=null where id=i.id;
  update lanzo_ecom_bridge_qa.grants set revoked_at=null,expires_at=clock_timestamp()+interval '120 seconds' where id=g.id;
  insert into hardening_results values('LIVE-'||i.actor_type||'-'||i.id,lanzo_ecom_bridge_qa.lock_authority(i.id));
  perform pg_temp.excluded_case('DEVICE-RELEASE-'||i.id,g.id,format('update public.license_devices set is_active=false where id=%L',i.device_id));
  perform pg_temp.excluded_case('GRANT-EXPIRED-'||i.id,g.id,format('update lanzo_ecom_bridge_qa.grants set expires_at=clock_timestamp()-interval ''1 second'' where id=%L',g.id));
  perform pg_temp.excluded_case('LICENSE-SUSPENDED-'||i.id,g.id,format('update public.licenses set status=''suspended'' where id=%L',i.license_id));
  perform pg_temp.excluded_case('PLAN-CAPABILITY-REMOVED-'||i.id,g.id,format('update public.licenses set features=features||''{"ecommerce_order_inbox":false}''::jsonb where id=%L',i.license_id));
  if i.actor_type='admin' then
   perform pg_temp.excluded_case('ADMIN-REVOKED-OR-REPLACED-'||i.id,g.id,format('update public.license_admin_sessions set revoked_at=clock_timestamp() where id=%L',i.actor_session_id));
   perform pg_temp.excluded_case('ADMIN-EXPIRED-'||i.id,g.id,format('update public.license_admin_sessions set expires_at=clock_timestamp()-interval ''1 second'' where id=%L',i.actor_session_id));
  else
   perform pg_temp.excluded_case('STAFF-PERMISSION-REVOKED-'||i.id,g.id,format('update public.license_staff_users set permissions=permissions||''{"ecommerce":false}''::jsonb where id=%L',i.actor_id));
   perform pg_temp.excluded_case('STAFF-SESSION-REVOKED-'||i.id,g.id,format('update public.license_staff_sessions set revoked_at=clock_timestamp() where id=%L',i.actor_session_id));
  end if;
 end loop;
end $$;
select jsonb_build_object('checks',jsonb_agg(to_jsonb(r)),'count',count(*),'passed',count(*) filter(where pass)) from hardening_results r;
rollback;
