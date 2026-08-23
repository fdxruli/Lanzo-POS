\set ON_ERROR_STOP on

begin;

-- Admin A on Device 1 reads N1; same Admin A on Device 2 must converge.
select public.mark_pos_notification_read('FIXTURE-A','device-a1','sec-a1','50000000-0000-0000-0000-000000000001','admin-a-token');
do $$
declare r jsonb; n jsonb; begin
  r := public.list_pos_notifications('FIXTURE-A','device-a2','sec-a2',100,0,false,'admin-a-token');
  select value into n from jsonb_array_elements(r->'notifications') where value->>'id'='50000000-0000-0000-0000-000000000001';
  if coalesce((n->>'is_read')::boolean,false) is not true then raise exception 'admin same-actor cross-device read did not converge'; end if;
  if not exists(select 1 from public.pos_notification_reads where notification_id='50000000-0000-0000-0000-000000000001' and admin_user_id='20000000-0000-0000-0000-000000000001' and read_at is not null) then raise exception 'admin actor read row missing'; end if;
  if exists(select 1 from public.pos_notification_reads where notification_id='50000000-0000-0000-0000-000000000001' and admin_user_id is null and staff_user_id is null) then raise exception 'authenticated admin fell back to device read state'; end if;
end $$;

-- Different Admin B must not inherit Admin A read state.
do $$ declare r jsonb; n jsonb; begin
  r := public.list_pos_notifications('FIXTURE-A','device-b','sec-b',100,0,false,'admin-b-token');
  select value into n from jsonb_array_elements(r->'notifications') where value->>'id'='50000000-0000-0000-0000-000000000001';
  if coalesce((n->>'is_read')::boolean,false) is true then raise exception 'different admin inherited read state'; end if;
end $$;

-- Drawer/seen semantics: seen only, read remains null.
insert into public.pos_notifications(id,license_id,target_scope,type,severity,title,metadata,source)
values('50000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','license','system','info','Seen only','{}','system');
select public.mark_pos_notifications_seen('FIXTURE-A','device-a1','sec-a1','admin-a-token');
do $$ begin
  if not exists(select 1 from public.pos_notification_reads where notification_id='50000000-0000-0000-0000-000000000004' and admin_user_id='20000000-0000-0000-0000-000000000001' and seen_at is not null and read_at is null) then raise exception 'seen operation changed read semantics'; end if;
end $$;

-- Explicit read and archive must imply seen.
select public.mark_pos_notification_read('FIXTURE-A','device-a1','sec-a1','50000000-0000-0000-0000-000000000004','admin-a-token');
select public.archive_pos_notification('FIXTURE-A','device-a1','sec-a1','50000000-0000-0000-0000-000000000004','admin-a-token');
do $$ begin
  if exists(select 1 from public.pos_notification_reads where (read_at is not null or archived_at is not null) and seen_at is null) then raise exception 'read/archive does not imply seen'; end if;
end $$;

-- Same Staff A on two devices shares state.
insert into public.pos_notifications(id,license_id,target_scope,type,severity,title,metadata,source)
values('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','staff','system','info','Staff notification','{}','system');
select public.mark_pos_notification_read('FIXTURE-A','device-s1','sec-s1','50000000-0000-0000-0000-000000000005','staff-a-token');
do $$ declare r jsonb; n jsonb; begin
  r:=public.list_pos_notifications('FIXTURE-A','device-s2','sec-s2',100,0,false,'staff-a-token');
  select value into n from jsonb_array_elements(r->'notifications') where value->>'id'='50000000-0000-0000-0000-000000000005';
  if coalesce((n->>'is_read')::boolean,false) is not true then raise exception 'staff same-actor cross-device read did not converge'; end if;
end $$;

-- A distinct staff actor must not inherit Staff A state.
insert into public.license_devices(id,license_id,device_fingerprint,is_active,security_token,device_role,device_mode)
values('40000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','device-sb',true,'sec-sb','staff','staff_only');
insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash)
values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000006',extensions.crypt('staff-b-token',extensions.gen_salt('bf')));
do $$ declare r jsonb; n jsonb; begin
  r:=public.list_pos_notifications('FIXTURE-A','device-sb','sec-sb',100,0,false,'staff-b-token');
  select value into n from jsonb_array_elements(r->'notifications') where value->>'id'='50000000-0000-0000-0000-000000000005';
  if coalesce((n->>'is_read')::boolean,false) is true then raise exception 'different staff actor inherited read state'; end if;
end $$;

-- Cross-license isolation.
insert into public.license_devices(id,license_id,device_fingerprint,is_active,security_token,device_role,device_mode)
values('40000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002','device-c',true,'sec-c','admin','admin_only');
insert into public.license_admin_sessions(license_id,admin_user_id,device_id,session_token_hash)
values('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000007',extensions.crypt('admin-c-token',extensions.gen_salt('bf')));
do $$ declare r jsonb; begin
  r:=public.list_pos_notifications('FIXTURE-B','device-c','sec-c',100,0,false,'admin-c-token');
  if exists(select 1 from jsonb_array_elements(r->'notifications') x where x->>'id' in ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000004')) then raise exception 'cross-license notification leakage'; end if;
end $$;

-- Unauthorized staff-target row must not be seen/read by Admin A.
insert into public.pos_notifications(id,license_id,target_scope,target_staff_user_id,type,severity,title,metadata,source)
values('50000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','staff','30000000-0000-0000-0000-000000000001','system','info','Targeted staff only','{}','system');
select public.mark_pos_notifications_seen('FIXTURE-A','device-a1','sec-a1','admin-a-token');
do $$ declare r jsonb; begin
  if exists(select 1 from public.pos_notification_reads where notification_id='50000000-0000-0000-0000-000000000006' and admin_user_id='20000000-0000-0000-0000-000000000001') then raise exception 'admin marked unauthorized staff target seen'; end if;
  r:=public.mark_pos_notification_read('FIXTURE-A','device-a1','sec-a1','50000000-0000-0000-0000-000000000006','admin-a-token');
  if coalesce(r->>'success','false')='true' then raise exception 'admin read unauthorized staff target'; end if;
end $$;

-- Legacy device-provenance rows remain valid under exactly-one-actor constraint.
insert into public.pos_notification_reads(notification_id,license_id,device_fingerprint,read_at)
values('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','legacy-device',now());
do $$ begin
  if not exists(select 1 from public.pos_notification_reads where device_fingerprint='legacy-device' and admin_user_id is null and staff_user_id is null and seen_at is not null and read_at is not null) then raise exception 'legacy device read compatibility broken'; end if;
end $$;

-- Structural security assertions.
do $$ declare def text; begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='pos_notification_operational_incidents') then raise exception 'incident table not private'; end if;
  if exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='pos_notification_operational_incidents' and grantee in ('anon','authenticated','PUBLIC')) then raise exception 'incident table exposed'; end if;
  if not exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='pos_notification_operational_incidents' and a.attname='license_id' and a.attnotnull) then raise exception 'incident license_id nullable'; end if;
  def:=pg_get_constraintdef((select oid from pg_constraint where conname='pos_notification_operational_incidents_notification_license_fkey'));
  if position('ON DELETE SET NULL (notification_id)' in def)=0 then raise exception 'incident FK does not preserve license_id'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('list_pos_notifications','mark_pos_notifications_seen','set_pos_operational_incident_state','generate_staff_operational_notifications','generate_sync_operational_notifications') and (p.prosecdef is not true or not ('search_path=""'=any(p.proconfig)))) then raise exception 'security definer/search_path hardening missing'; end if;
end $$;

rollback;
