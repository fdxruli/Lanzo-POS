begin;set local statement_timeout='30s';set local lock_timeout='2s';
-- REVIEW CANDIDATE ONLY. Production deployment is held by B-01/B-02.
-- Kept OUTSIDE migrations so normal db push cannot install a blocked candidate.
-- Transactional validation may roll this entire file back. Never enable a
-- commercial sender from this migration: all grants are qa_probe-only.
-- No shared function, existing policy, plan or license is changed here.

do $gate$
begin
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'ECOM_SIGNAL_REALTIME_RLS_REQUIRED';
  end if;
  if to_regprocedure('private.resolve_device_actor_session(uuid,uuid,text,text)') is null
     or to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
    raise exception 'ECOM_SIGNAL_AUTHORITY_DEPENDENCY_MISSING';
  end if;
  if exists (select 1 from pg_roles where rolname = 'lanzo_ecom_signal_receiver') then
    raise exception 'ECOM_SIGNAL_ROLE_ALREADY_EXISTS_REVIEW_REQUIRED';
  end if;
end;
$gate$;

create role lanzo_ecom_signal_receiver nologin noinherit nosuperuser
  nocreatedb nocreaterole noreplication nobypassrls;

-- Do not grant USAGE on private: it contains existing PUBLIC-executable
-- functions. A separate non-exposed schema keeps that surface inaccessible.
create schema lanzo_ecom_signal authorization postgres;
revoke all on schema lanzo_ecom_signal from public, anon, authenticated, service_role;
grant usage on schema lanzo_ecom_signal to lanzo_ecom_signal_receiver;

create table lanzo_ecom_signal.qa_tenants (
  license_id uuid primary key references public.licenses(id),
  created_at timestamptz not null default clock_timestamp()
);
create table lanzo_ecom_signal.grants (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references lanzo_ecom_signal.qa_tenants(license_id),
  device_id uuid not null references public.license_devices(id),
  actor_type text not null check (actor_type in ('admin', 'staff')),
  actor_id uuid not null,
  actor_session_id uuid not null,
  runtime_id uuid not null,
  actor_generation bigint not null check (actor_generation >= 0),
  tenant_generation bigint not null check (tenant_generation >= 0),
  stage text not null default 'qa_probe' check (stage = 'qa_probe'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '300 seconds')
);
create index ecom_signal_grants_runtime_idx on lanzo_ecom_signal.grants
  (license_id, device_id, runtime_id, actor_generation desc, tenant_generation desc);
create index ecom_signal_grants_expiry_idx on lanzo_ecom_signal.grants (expires_at)
  where revoked_at is null;
alter table lanzo_ecom_signal.qa_tenants enable row level security;
alter table lanzo_ecom_signal.grants enable row level security;
revoke all on all tables in schema lanzo_ecom_signal from public, anon, authenticated,
  service_role, lanzo_ecom_signal_receiver;

-- Read-only authority check by canonical identifiers. No session-token hashes
-- or bearer secrets are stored in the grant, and no session is touched here.
create function lanzo_ecom_signal.authority_live(
  p_license_id uuid, p_device_id uuid, p_actor_type text, p_actor_id uuid,
  p_actor_session_id uuid
) returns boolean language sql volatile security definer set search_path = ''
as $function$
  select exists (
    select 1 from lanzo_ecom_signal.qa_tenants q
    join public.licenses l on l.id = q.license_id
    join public.license_devices d on d.license_id = l.id and d.id = p_device_id
    cross join lateral private.license_entitlement_state_v1(l.id) e
    where l.id = p_license_id and l.license_key like 'QA-ECOM-SIGNAL-R2-%'
      and e.is_entitled is true
      and e.effective_features->'ecommerce_portal_enabled' = 'true'::jsonb
      and e.effective_features->'ecommerce_order_inbox' = 'true'::jsonb
      and d.is_active is true and d.security_token is not null
      and (select count(*) from public.license_devices active_device
           where active_device.license_id = l.id and active_device.is_active is true)
          <= l.max_devices
      and (
        (p_actor_type = 'admin' and d.device_mode in ('admin_only','shared') and exists (
          select 1 from public.license_admin_sessions s
          join public.license_admin_users u on u.id = s.admin_user_id and u.license_id = s.license_id
          where s.id = p_actor_session_id and s.license_id = l.id and s.device_id = d.id
            and u.id = p_actor_id and u.is_active is true and u.is_owner is true
            and s.revoked_at is null and s.expires_at > clock_timestamp()
        )) or
        (p_actor_type = 'staff' and d.device_mode in ('staff_only','shared')
          and e.effective_features->'staff_roles' = 'true'::jsonb and exists (
          select 1 from public.license_staff_sessions s
          join public.license_staff_users u on u.id = s.staff_user_id and u.license_id = s.license_id
          where s.id = p_actor_session_id and s.license_id = l.id and s.device_id = d.id
            and u.id = p_actor_id and u.is_active is true
            and u.permissions->'ecommerce' = 'true'::jsonb
            and s.revoked_at is null and s.expires_at > clock_timestamp()
        ))
      )
  );
$function$;
revoke all on function lanzo_ecom_signal.authority_live(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role, lanzo_ecom_signal_receiver;

-- Server-only grant API. Canonical identity comes from the existing online
-- verifier, never from untrusted request IDs or local GRANTED/offline evidence.
create function public.lanzo_issue_ecom_signal_qa_grant(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_actor_session_token text, p_runtime_id uuid, p_actor_generation bigint,
  p_tenant_generation bigint, p_ttl_seconds integer default 60
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_device public.license_devices;
  v_actor jsonb;
  v_grant lanzo_ecom_signal.grants;
  v_now timestamptz := clock_timestamp();
  v_session_expiry timestamptz;
  v_license_expiry timestamptz;
begin
  if p_runtime_id is null or p_actor_generation is null or p_actor_generation < 0
     or p_tenant_generation is null or p_tenant_generation < 0
     or p_ttl_seconds is null or p_ttl_seconds not between 1 and 300 then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_INPUT_INVALID');
  end if;
  select d.* into v_device from public.license_devices d
  join public.licenses l on l.id = d.license_id
  join lanzo_ecom_signal.qa_tenants q on q.license_id = l.id
  where l.license_key = p_license_key and l.license_key like 'QA-ECOM-SIGNAL-R2-%'
    and d.device_fingerprint = p_device_fingerprint and d.is_active is true
    and d.security_token is not null and nullif(p_security_token,'') is not null
    and (d.security_token = p_security_token or d.previous_security_token = p_security_token);
  if not found then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_DENIED');
  end if;
  v_actor := private.resolve_device_actor_session(v_device.license_id, v_device.id,
    v_device.device_mode, p_actor_session_token);
  if (v_actor->>'success')::boolean is not true or
     lanzo_ecom_signal.authority_live(v_device.license_id, v_device.id,
       v_actor->>'actor_type', (v_actor->>'actor_id')::uuid,
       (v_actor->>'actor_session_id')::uuid) is not true then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_DENIED');
  end if;
  -- Serializes only this synthetic runtime, not a tenant-wide/commercial lock.
  perform pg_advisory_xact_lock(hashtextextended(
    v_device.license_id::text || ':' || v_device.id::text || ':' || p_runtime_id::text, 0));
  -- Recheck after waiting for the runtime lock. Transport revocation remains
  -- a separate gate; SQL validation never promises to close existing sockets.
  if lanzo_ecom_signal.authority_live(v_device.license_id,v_device.id,
       v_actor->>'actor_type',(v_actor->>'actor_id')::uuid,
       (v_actor->>'actor_session_id')::uuid) is not true then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_DENIED');
  end if;
  if exists (select 1 from lanzo_ecom_signal.grants g
      where g.license_id = v_device.license_id and g.device_id = v_device.id
        and g.runtime_id = p_runtime_id and (g.actor_generation > p_actor_generation
          or g.tenant_generation > p_tenant_generation)) then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_STALE_RUNTIME');
  end if;
  if v_actor->>'actor_type' = 'admin' then
    select expires_at into v_session_expiry from public.license_admin_sessions
      where id = (v_actor->>'actor_session_id')::uuid;
  else
    select expires_at into v_session_expiry from public.license_staff_sessions
      where id = (v_actor->>'actor_session_id')::uuid;
  end if;
  select case when e.grace_period_ends is null then 'infinity'::timestamptz
    else e.grace_period_ends end into v_license_expiry
    from private.license_entitlement_state_v1(v_device.license_id) e;
  v_now := clock_timestamp();
  if least(v_session_expiry,v_license_expiry) <= v_now then
    return jsonb_build_object('success',false,'code','ECOM_SIGNAL_DENIED');
  end if;
  update lanzo_ecom_signal.grants set revoked_at = v_now
    where license_id = v_device.license_id and device_id = v_device.id
      and runtime_id = p_runtime_id and revoked_at is null;
  insert into lanzo_ecom_signal.grants (license_id,device_id,actor_type,actor_id,
    actor_session_id,runtime_id,actor_generation,tenant_generation,issued_at,expires_at)
  values (v_device.license_id,v_device.id,v_actor->>'actor_type',(v_actor->>'actor_id')::uuid,
    (v_actor->>'actor_session_id')::uuid,p_runtime_id,p_actor_generation,p_tenant_generation,
    v_now,least(v_now + make_interval(secs => p_ttl_seconds),v_session_expiry,v_license_expiry))
  returning * into v_grant;
  return jsonb_build_object('success',true,'topic','ecom:qa-probe:r2:' || v_grant.id::text,
    'claims',jsonb_build_object('iss',
      'https://odlrhijtfyavryeqivaa.supabase.co/functions/v1/lanzo-ecom-signal-issuer',
      'aud','lanzo-ecom-signal','role','lanzo_ecom_signal_receiver',
      'scope','ecommerce_new_order_signal','v',1,'stage','qa_probe',
      'sub',v_grant.actor_id,'jti',v_grant.id,'grant_id',v_grant.id,
      'tenant_id',v_grant.license_id,'device_id',v_grant.device_id,
      'actor_type',v_grant.actor_type,'actor_id',v_grant.actor_id,
      'actor_session_id',v_grant.actor_session_id,'runtime_id',v_grant.runtime_id,
      'actor_generation',v_grant.actor_generation,'tenant_generation',v_grant.tenant_generation,
      'iat',floor(extract(epoch from v_now)), 'nbf',floor(extract(epoch from v_now)),
      'exp',floor(extract(epoch from v_grant.expires_at))));
end;
$function$;
revoke all on function public.lanzo_issue_ecom_signal_qa_grant(text,text,text,text,uuid,bigint,bigint,integer)
  from public, anon, authenticated, lanzo_ecom_signal_receiver;
grant execute on function public.lanzo_issue_ecom_signal_qa_grant(text,text,text,text,uuid,bigint,bigint,integer)
  to service_role;

create function lanzo_ecom_signal.can_receive(p_topic text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $function$
declare
  c jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  g lanzo_ecom_signal.grants;
  v_now numeric := extract(epoch from clock_timestamp());
begin
  -- Fail closed for malformed claims as well as correctly signed wrong claims.
  if c is null or c->>'role' is distinct from 'lanzo_ecom_signal_receiver'
     or c->>'scope' is distinct from 'ecommerce_new_order_signal'
     or c->'v' is distinct from '1'::jsonb or c->>'stage' is distinct from 'qa_probe'
     or c->>'iss' is distinct from
       'https://odlrhijtfyavryeqivaa.supabase.co/functions/v1/lanzo-ecom-signal-issuer'
     or c->>'aud' is distinct from 'lanzo-ecom-signal'
     or jsonb_typeof(c->'exp') is distinct from 'number'
     or jsonb_typeof(c->'iat') is distinct from 'number'
     or jsonb_typeof(c->'nbf') is distinct from 'number'
     or (c->>'exp')::numeric <= v_now or (c->>'nbf')::numeric > v_now
     or (c->>'iat')::numeric > v_now
     or jsonb_typeof(c->'actor_generation') is distinct from 'number'
     or jsonb_typeof(c->'tenant_generation') is distinct from 'number' then
    return false;
  end if;
  select * into g from lanzo_ecom_signal.grants where id = (c->>'grant_id')::uuid;
  if not found or g.revoked_at is not null or g.expires_at <= clock_timestamp()
     or p_topic is distinct from 'ecom:qa-probe:r2:' || g.id::text
     or c->>'jti' is distinct from g.id::text
     or c->>'sub' is distinct from g.actor_id::text
     or c->>'tenant_id' is distinct from g.license_id::text
     or c->>'device_id' is distinct from g.device_id::text
     or c->>'actor_type' is distinct from g.actor_type
     or c->>'actor_id' is distinct from g.actor_id::text
     or c->>'actor_session_id' is distinct from g.actor_session_id::text
     or c->>'runtime_id' is distinct from g.runtime_id::text
     or c->'actor_generation' is distinct from to_jsonb(g.actor_generation)
     or c->'tenant_generation' is distinct from to_jsonb(g.tenant_generation)
     or (c->>'exp')::numeric <> floor(extract(epoch from g.expires_at))
     or (c->>'iat')::numeric <> floor(extract(epoch from g.issued_at))
     or (c->>'nbf')::numeric <> floor(extract(epoch from g.issued_at)) then
    return false;
  end if;
  return lanzo_ecom_signal.authority_live(g.license_id,g.device_id,g.actor_type,g.actor_id,g.actor_session_id);
exception when others then
  return false;
end;
$function$;
revoke all on function lanzo_ecom_signal.can_receive(text) from public, anon, authenticated, service_role;
grant execute on function lanzo_ecom_signal.can_receive(text) to lanzo_ecom_signal_receiver;

create function public.lanzo_revoke_ecom_signal_qa_grant(p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $function$
begin
  update lanzo_ecom_signal.grants set revoked_at = coalesce(revoked_at,clock_timestamp())
    where id = p_grant_id;
  return found;
end;
$function$;
revoke all on function public.lanzo_revoke_ecom_signal_qa_grant(uuid)
  from public, anon, authenticated, lanzo_ecom_signal_receiver;
grant execute on function public.lanzo_revoke_ecom_signal_qa_grant(uuid) to service_role;

-- No INSERT policy, Presence access, table writes, or legacy role membership.
grant usage on schema realtime to lanzo_ecom_signal_receiver;
grant select on realtime.messages to lanzo_ecom_signal_receiver;
create policy lanzo_ecom_signal_qa_receive_r2 on realtime.messages for select
  to lanzo_ecom_signal_receiver using (extension = 'broadcast'
    and (select lanzo_ecom_signal.can_receive((select realtime.topic()))));

-- PUBLIC's six legacy public RPC grants intentionally remain unchanged.
-- This is a known B-02 deployment HOLD, not a claim of strict ACL isolation.

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

create temp table acl_before as select r.rolname,p.oid as function_oid,p.oid::regprocedure::text as signature,has_function_privilege(r.oid,p.oid,'EXECUTE') as allowed from pg_roles r cross join pg_proc p where p.oid in ('public.admin_list_staff_users(text,text,text,text)'::regprocedure,'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)'::regprocedure,'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)'::regprocedure,'public.pos_get_cash_station_state(text,text,text,text)'::regprocedure,'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'::regprocedure,'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'::regprocedure);
-- SEPARATE SHARED-ACL PROPOSAL. NOT AUTHORIZED FOR PERSISTENT APPLICATION.
-- Consumers anon/authenticated/service_role have explicit EXECUTE already.
-- Preserve these grants and internal function bodies; remove only PUBLIC.
-- Review other platform/custom-role consumers before any actual deployment.
do $gate$
declare signature text; f oid; r text;
begin
  foreach signature in array array[
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)']
  loop
    f := signature::regprocedure;
    foreach r in array array['anon','authenticated','service_role'] loop
      if not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
          join pg_roles grantee on grantee.oid=a.grantee
          where p.oid=f and grantee.rolname=r and a.privilege_type='EXECUTE') then
        raise exception 'ECOM_ACL_EXPLICIT_CONSUMER_GRANT_REQUIRED';
      end if;
    end loop;
  end loop;
end;
$gate$;
revoke execute on function public.admin_list_staff_users(text,text,text,text) from public;
revoke execute on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text) from public;
revoke execute on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text) from public;
revoke execute on function public.pos_get_cash_station_state(text,text,text,text) from public;
revoke execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public;
revoke execute on function public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text) from public;

select jsonb_build_object('r2_results',(select jsonb_agg(to_jsonb(r) order by id) from ecom_r2_results r),'acl_all_roles',(select jsonb_agg(jsonb_build_object('role',b.rolname,'signature',b.signature,'before',b.allowed,'after',has_function_privilege(b.rolname,b.function_oid,'EXECUTE')) order by b.rolname,b.signature) from acl_before b),'receiver_sd_remaining',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('lanzo_ecom_signal_receiver',p.oid,'EXECUTE')),'bodies',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid)))) from pg_proc p where p.oid in ('public.admin_list_staff_users(text,text,text,text)'::regprocedure,'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)'::regprocedure,'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)'::regprocedure,'public.pos_get_cash_station_state(text,text,text,text)'::regprocedure,'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)'::regprocedure,'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'::regprocedure)));
rollback;