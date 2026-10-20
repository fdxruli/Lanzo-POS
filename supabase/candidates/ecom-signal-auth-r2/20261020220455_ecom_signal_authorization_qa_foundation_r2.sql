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
