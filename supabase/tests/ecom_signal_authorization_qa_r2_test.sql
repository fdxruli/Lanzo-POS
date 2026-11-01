-- Run ONLY after the candidate SQL, inside the SAME BEGIN ... ROLLBACK.
-- Every commercial-table row is synthetic and transaction-local.
-- Test runner can SET ROLE only for this transaction; receiver gains no roles.
grant lanzo_ecom_signal_receiver to postgres;
create temp table ecom_r2_results (id text primary key, status text, detail jsonb default '{}');
create function pg_temp.ecom_check(p_id text, p_ok boolean, p_detail jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into ecom_r2_results values (p_id, case when p_ok is true then 'PASS' else 'FAIL' end, p_detail);
  if p_ok is not true then raise exception 'ECOM_QA_ASSERTION_FAILED:%',p_id; end if;
end;
$$;
create function pg_temp.ecom_receive(p_claims jsonb,p_topic text)
returns boolean language plpgsql as $$
declare v_allowed boolean;
begin
  perform set_config('request.jwt.claims',p_claims::text,true);
  execute 'set local role lanzo_ecom_signal_receiver';
  v_allowed := lanzo_ecom_signal.can_receive(p_topic);
  execute 'reset role';
  return v_allowed;
exception when others then
  execute 'reset role';
  raise;
end;
$$;

do $test$
declare
  suffix text := replace(gen_random_uuid()::text,'-','');
  tenant_a uuid := gen_random_uuid(); tenant_b uuid := gen_random_uuid();
  device_a uuid := gen_random_uuid(); device_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid(); staff_a uuid := gen_random_uuid();
  staff_denied uuid := gen_random_uuid();
  session_a uuid := gen_random_uuid(); session_a2 uuid := gen_random_uuid();
  session_staff uuid := gen_random_uuid(); session_denied uuid := gen_random_uuid();
  runtime_a uuid := gen_random_uuid(); runtime_b uuid := gen_random_uuid();
  key_a text := 'QA-ECOM-SIGNAL-R2-A-' || suffix;
  key_b text := 'QA-ECOM-SIGNAL-R2-B-' || suffix;
  fp_a text := 'qa-ecom-r2-a-' || suffix; fp_b text := 'qa-ecom-r2-b-' || suffix;
  device_token text := gen_random_uuid()::text;
  admin_token text := gen_random_uuid()::text; admin_token2 text := gen_random_uuid()::text;
  staff_token text := gen_random_uuid()::text; denied_token text := gen_random_uuid()::text;
  a jsonb; b jsonb; x jsonb; c jsonb; field text; value jsonb;
  v_oid oid; v_signature text; v_public_count integer; v_denied boolean;
  v_before timestamptz; v_after timestamptz;
begin
  insert into public.licenses(id,license_key,license_type,status,max_devices,features)
  values (tenant_a,key_a,'free','active',4,
    '{"ecommerce_portal_enabled":true,"ecommerce_order_inbox":true,"staff_roles":true}'),
    (tenant_b,key_b,'pro','active',4,
    '{"ecommerce_portal_enabled":true,"ecommerce_order_inbox":true,"staff_roles":true}');
  insert into public.license_devices(id,license_id,device_fingerprint,device_name,
    security_token,is_active,device_role,device_mode)
  values (device_a,tenant_a,fp_a,'QA ECOM SIGNAL R2',device_token,true,'admin','shared'),
    (device_b,tenant_b,fp_b,'QA ECOM SIGNAL R2 OTHER',device_token,true,'admin','shared');
  insert into public.license_admin_users(id,license_id,username,display_name,password_hash)
  values (admin_a,tenant_a,'qa-'||suffix,'QA ECOM SIGNAL R2',
    extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf',4)));
  insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
  values (session_a,tenant_a,admin_a,device_a,extensions.crypt(admin_token,extensions.gen_salt('bf',4)),now()+interval '1 hour'),
    (session_a2,tenant_a,admin_a,device_a,extensions.crypt(admin_token2,extensions.gen_salt('bf',4)),now()+interval '1 hour');
  insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions)
  values (staff_a,tenant_a,'qa-ecom-'||suffix,'QA Ecommerce',
    extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf',4)), '{"ecommerce":true,"settings":false}'),
    (staff_denied,tenant_a,'qa-no-ecom-'||suffix,'QA No Ecommerce',
    extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf',4)), '{"ecommerce":false,"settings":true}');
  insert into public.license_staff_sessions(id,license_id,staff_user_id,device_id,session_token_hash,expires_at)
  values (session_staff,tenant_a,staff_a,device_a,extensions.crypt(staff_token,extensions.gen_salt('bf',4)),now()+interval '1 hour'),
    (session_denied,tenant_a,staff_denied,device_a,extensions.crypt(denied_token,extensions.gen_salt('bf',4)),now()+interval '1 hour');
  insert into lanzo_ecom_signal.qa_tenants values (tenant_a,clock_timestamp());

  a := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,1,1,60);
  perform pg_temp.ecom_check('SQL-01-admin-canonical',a->'success'='true'::jsonb
    and a->'claims'->>'actor_session_id'=session_a::text);
  perform pg_temp.ecom_check('SQL-02-receiver-helper',pg_temp.ecom_receive(a->'claims',a->>'topic'));
  perform pg_temp.ecom_check('SQL-03-no-token-in-grant',not exists (
    select 1 from information_schema.columns where table_schema='lanzo_ecom_signal'
      and column_name like '%token%'));
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,staff_token,runtime_b,1,1,120);
  perform pg_temp.ecom_check('SQL-04-staff-ecommerce-without-settings',x->'success'='true'::jsonb
    and pg_temp.ecom_receive(x->'claims',x->>'topic'));
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,denied_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-05-staff-no-ecommerce',x->'success'='false'::jsonb);
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,'invalid',admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-06-device-secret-mismatch',x->'success'='false'::jsonb);
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,'invalid',gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-07-actor-secret-mismatch',x->'success'='false'::jsonb);
  x := public.lanzo_issue_ecom_signal_qa_grant(key_b,fp_b,device_token,admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-08-other-tenant-not-allowlisted',x->'success'='false'::jsonb);
  insert into lanzo_ecom_signal.qa_tenants values (tenant_b,clock_timestamp());
  x := public.lanzo_issue_ecom_signal_qa_grant(key_b,fp_b,device_token,admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-09-other-tenant-session',x->'success'='false'::jsonb);

  for field,value in select * from jsonb_each(jsonb_build_object(
    'tenant_id',tenant_b,'device_id',device_b,'actor_id',staff_a,'sub',staff_a,
    'actor_session_id',session_a2,'runtime_id',runtime_b,'actor_type','staff',
    'actor_generation',2,'tenant_generation',2,'role','authenticated',
    'scope','cloud_pos_sync','v',2,'stage','order_created','iss','https://invalid.example',
    'aud','invalid','grant_id',gen_random_uuid(),'jti',gen_random_uuid(),
    'exp',0,'nbf',9999999999,'iat',9999999999))
  loop
    c := jsonb_set(a->'claims',array[field],value);
    perform pg_temp.ecom_check('CLAIM-wrong-'||field,not pg_temp.ecom_receive(c,a->>'topic'));
    c := (a->'claims')-field;
    perform pg_temp.ecom_check('CLAIM-missing-'||field,not pg_temp.ecom_receive(c,a->>'topic'));
  end loop;
  perform pg_temp.ecom_check('SQL-10-malformed-uuid',not pg_temp.ecom_receive(
    jsonb_set(a->'claims','{grant_id}','"malformed"'),a->>'topic'));
  perform pg_temp.ecom_check('SQL-11-malformed-exp',not pg_temp.ecom_receive(
    jsonb_set(a->'claims','{exp}','"NaN"'),a->>'topic'));
  perform pg_temp.ecom_check('SQL-12-pro-topic',not pg_temp.ecom_receive(a->'claims','pos:qa-ecom-r2'));
  perform pg_temp.ecom_check('SQL-13-license-topic',not pg_temp.ecom_receive(a->'claims','license:qa-ecom-r2'));
  perform pg_temp.ecom_check('SQL-14-other-grant-topic',not pg_temp.ecom_receive(a->'claims','ecom:qa-probe:r2:'||gen_random_uuid()::text));

  b := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token2,gen_random_uuid(),1,1,300);
  perform pg_temp.ecom_check('SQL-15-second-session-same-owner',b->'success'='true'::jsonb
    and b->'claims'->>'actor_id'=a->'claims'->>'actor_id'
    and b->'claims'->>'actor_session_id'<>a->'claims'->>'actor_session_id');
  perform pg_temp.ecom_check('SQL-16-session-topic-isolation',not pg_temp.ecom_receive(a->'claims',b->>'topic'));
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,2,1,60);
  perform pg_temp.ecom_check('SQL-17-renewal-replaces-grant',x->'success'='true'::jsonb
    and not pg_temp.ecom_receive(a->'claims',a->>'topic'));
  a := x;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,1,1,60);
  perform pg_temp.ecom_check('SQL-18-stale-actor-generation',x->>'code'='ECOM_SIGNAL_STALE_RUNTIME');
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,2,0,60);
  perform pg_temp.ecom_check('SQL-19-stale-tenant-generation',x->>'code'='ECOM_SIGNAL_STALE_RUNTIME');
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,2,1,301);
  perform pg_temp.ecom_check('SQL-20-ttl-bounded',x->>'code'='ECOM_SIGNAL_INPUT_INVALID');

  update public.license_staff_users set permissions='{"ecommerce":false}' where id=staff_a;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,staff_token,runtime_b,2,1,60);
  perform pg_temp.ecom_check('SQL-21-permission-revoke-renewal',x->'success'='false'::jsonb);
  update public.license_devices set is_active=false where id=device_a;
  perform pg_temp.ecom_check('SQL-22-inactive-device-receive',not pg_temp.ecom_receive(a->'claims',a->>'topic'));
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,3,1,60);
  perform pg_temp.ecom_check('SQL-23-inactive-device-issue',x->'success'='false'::jsonb);
  update public.license_devices set is_active=true where id=device_a;
  update public.license_admin_sessions set revoked_at=clock_timestamp() where id=session_a;
  perform pg_temp.ecom_check('SQL-24-replaced-session-receive',not pg_temp.ecom_receive(a->'claims',a->>'topic'));
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,runtime_a,3,1,60);
  perform pg_temp.ecom_check('SQL-25-revoked-session-renewal',x->'success'='false'::jsonb);
  perform pg_temp.ecom_check('SQL-26-other-session-still-live',pg_temp.ecom_receive(b->'claims',b->>'topic'));
  update public.license_admin_sessions set expires_at=now()+interval '10 seconds' where id=session_a2;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token2,gen_random_uuid(),1,1,300);
  perform pg_temp.ecom_check('SQL-27-exp-capped-by-session',
    (x->'claims'->>'exp')::numeric <= floor(extract(epoch from now()+interval '10 seconds')));
  v_before:=clock_timestamp();
  perform public.lanzo_revoke_ecom_signal_qa_grant((b->'claims'->>'grant_id')::uuid);
  v_denied:=not pg_temp.ecom_receive(b->'claims',b->>'topic');
  v_after:=clock_timestamp();
  perform pg_temp.ecom_check('SQL-28-grant-revocation',v_denied,
    jsonb_build_object('sql_call_elapsed_ms',extract(epoch from v_after-v_before)*1000,
      'transport_revocation_measured',false));

  perform pg_temp.ecom_check('SQL-29-no-extra-pro-features',not exists (
    select 1 from private.license_entitlement_state_v1(tenant_a) e,
    unnest(array['cloud_notifications','notification_center','support_realtime',
      'cloud_pos_sync','realtime_license_sync','ecommerce_realtime_orders']) feature
    where e.effective_features->feature = 'true'::jsonb));
  update public.license_admin_sessions set expires_at=now()-interval '1 second' where id=session_a2;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token2,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-30-expired-session-issue',x->'success'='false'::jsonb);
  update public.license_admin_sessions set revoked_at=null, expires_at=now()+interval '1 hour' where id=session_a;
  a := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,gen_random_uuid(),1,1,60);
  update lanzo_ecom_signal.grants set issued_at=now()-interval '61 seconds',
    expires_at=now()-interval '1 second' where id=(a->'claims'->>'grant_id')::uuid;
  -- Keep the claims equal to the backdated row: rejection must not rely on
  -- merely comparing a mismatched exp/iat with that row.
  c := (a->'claims') || jsonb_build_object(
    'iat',floor(extract(epoch from now()-interval '61 seconds')),
    'nbf',floor(extract(epoch from now()-interval '61 seconds')),
    'exp',floor(extract(epoch from now()-interval '1 second')));
  perform pg_temp.ecom_check('SQL-31-expired-grant',not pg_temp.ecom_receive(c,a->>'topic'));
  update public.licenses set status='suspended' where id=tenant_a;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-32-license-suspended',x->'success'='false'::jsonb);
  update public.licenses set status='active',expires_at=now()-interval '8 days' where id=tenant_a;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-33-license-expired',x->'success'='false'::jsonb);
  update public.licenses set expires_at=null, features='{"staff_roles":true,"ecommerce_portal_enabled":true,"ecommerce_order_inbox":false}' where id=tenant_a;
  x := public.lanzo_issue_ecom_signal_qa_grant(key_a,fp_a,device_token,admin_token,gen_random_uuid(),1,1,60);
  perform pg_temp.ecom_check('SQL-34-inbox-disabled',x->'success'='false'::jsonb);

  perform pg_temp.ecom_check('ACL-01-role-attributes',exists(select 1 from pg_roles
    where rolname='lanzo_ecom_signal_receiver' and not rolcanlogin and not rolsuper
      and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication));
  perform pg_temp.ecom_check('ACL-02-no-memberships',not exists(select 1 from pg_auth_members
    where member=(select oid from pg_roles where rolname='lanzo_ecom_signal_receiver')));
  perform pg_temp.ecom_check('ACL-03-no-private-schema',not has_schema_privilege('lanzo_ecom_signal_receiver','private','USAGE'));
  perform pg_temp.ecom_check('ACL-04-no-business-table-grants',not exists(select 1
    from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','private')
      and t.relkind in ('r','p','v','m') and has_table_privilege('lanzo_ecom_signal_receiver',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')));
  perform pg_temp.ecom_check('ACL-05-no-broadcast-insert',not has_table_privilege(
    'lanzo_ecom_signal_receiver','realtime.messages','INSERT'));
  perform pg_temp.ecom_check('ACL-06-no-grant-enumeration',not has_table_privilege(
    'lanzo_ecom_signal_receiver','lanzo_ecom_signal.grants','SELECT'));
  perform pg_temp.ecom_check('ACL-07-no-client-issue',not has_function_privilege(
    'lanzo_ecom_signal_receiver','public.lanzo_issue_ecom_signal_qa_grant(text,text,text,text,uuid,bigint,bigint,integer)','EXECUTE'));
  v_denied:=false;
  begin
    execute 'set local role lanzo_ecom_signal_receiver';
    perform 1 from public.licenses limit 1;
  exception when insufficient_privilege then v_denied:=true;
  end;
  execute 'reset role';
  perform pg_temp.ecom_check('ACL-08-actual-business-read-denied',v_denied);

  select count(*) into v_public_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and has_function_privilege('lanzo_ecom_signal_receiver',p.oid,'EXECUTE');
  -- This is an observed failing SECURITY REQUIREMENT, kept visible in results.
  insert into ecom_r2_results values ('B02-strict-no-privileged-rpc-execute',
    case when v_public_count=0 then 'PASS' else 'FAIL' end,
    jsonb_build_object('effective_security_definer_count',v_public_count,'source','PUBLIC'));
  execute 'set local role lanzo_ecom_signal_receiver';
  x := public.admin_list_staff_users('QA-ECOM-SIGNAL-R2-INVALID','invalid','invalid','invalid');
  execute 'reset role';
  perform pg_temp.ecom_check('RPC-01-list-staff-needs-original-auth',x->'success'='false'::jsonb);
  execute 'set local role lanzo_ecom_signal_receiver';
  x := public.admin_create_staff_user('QA-ECOM-SIGNAL-R2-INVALID','invalid','invalid','qa','qa','QA','{}','staff','invalid');
  execute 'reset role';
  perform pg_temp.ecom_check('RPC-02-create-staff-needs-original-auth',x->'success'='false'::jsonb);
  execute 'set local role lanzo_ecom_signal_receiver';
  x := public.admin_update_staff_user('QA-ECOM-SIGNAL-R2-INVALID','invalid','invalid',staff_a,'QA','{}',false,null,'staff','invalid');
  execute 'reset role';
  perform pg_temp.ecom_check('RPC-03-update-staff-needs-original-auth',x->'success'='false'::jsonb);
  foreach v_signature in array array[
    'select public.pos_get_cash_station_state($1,$2,$3,$4)',
    'select public.pos_admin_close_cash_session($1,$2,$3,$4)',
    'select public.pos_admin_adopt_legacy_cash_session($1,$2,$3,$4)']
  loop
    v_denied:=false;
    begin
      execute 'set local role lanzo_ecom_signal_receiver';
      execute v_signature into x using 'QA-ECOM-SIGNAL-R2-INVALID','invalid','invalid','invalid';
      v_denied:=x->'success'='false'::jsonb;
    exception when raise_exception then
      v_denied:= SQLERRM in ('LICENSE_NOT_FOUND','LICENSE_NOT_ACTIVE','ACTOR_SESSION_REQUIRED','ACTOR_SESSION_INVALID');
    end;
    execute 'reset role';
    perform pg_temp.ecom_check('RPC-denied-'||split_part(v_signature,'(',1),v_denied);
  end loop;
end;
$test$;

select jsonb_build_object('production_ref','odlrhijtfyavryeqivaa',
  'sql_only',true,'realtime_transport_certified',false,
  'results',(select jsonb_agg(to_jsonb(r) order by id) from ecom_r2_results r)) as qa;
