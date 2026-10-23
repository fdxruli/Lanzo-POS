-- Ecom Realtime pilot 1A.5 overlay. Apply only after the reviewed 1A.2-1A.4
-- native-Auth candidate set. This file is a candidate; it is not a migration.
-- It contains no active allowlist entries, Auth users, JWTs, or Vault values.
begin;

do $preflight$
begin
  if to_regclass('lanzo_ecom_bridge_qa.identities') is null
     or to_regclass('lanzo_ecom_bridge_qa.grants') is null
     or to_regclass('lanzo_ecom_bridge_qa.qa_tenants') is null
     or to_regprocedure('private.resolve_device_actor_session(uuid,uuid,text,text)') is null
     or to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
    raise exception 'ECOM_1A5_NATIVE_BRIDGE_REQUIRED';
  end if;
end;
$preflight$;

-- Identity history remains tied to the real license row. The empty synthetic
-- qa_tenants table is kept only so the exact 1A.2 rollback remains available.
alter table lanzo_ecom_bridge_qa.identities
  drop constraint identities_license_id_fkey;
alter table lanzo_ecom_bridge_qa.identities
  add constraint identities_license_id_fkey foreign key (license_id) references public.licenses(id);

create table lanzo_ecom_bridge_qa.pilot_allowlist (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id),
  tenant_id uuid not null references public.licenses(id),
  device_id uuid not null references public.license_devices(id),
  pilot_state text not null check (pilot_state in ('approved','revoked')),
  expires_at timestamptz not null,
  qa_run_id uuid not null,
  authorized_by text not null check (length(btrim(authorized_by)) between 1 and 120),
  approval_ref text not null check (length(btrim(approval_ref)) between 1 and 160),
  authorized_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  authorization_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint pilot_allowlist_tenant_is_license check (tenant_id = license_id),
  constraint pilot_allowlist_state_timestamps check (
    (pilot_state = 'approved' and revoked_at is null)
    or (pilot_state = 'revoked' and revoked_at is not null)
  ),
  constraint pilot_allowlist_metadata_object check (jsonb_typeof(authorization_metadata) = 'object'),
  unique (qa_run_id)
);
create unique index pilot_allowlist_one_approved_device
  on lanzo_ecom_bridge_qa.pilot_allowlist(license_id, device_id)
  where pilot_state = 'approved' and revoked_at is null;
alter table lanzo_ecom_bridge_qa.pilot_allowlist enable row level security;
revoke all on lanzo_ecom_bridge_qa.pilot_allowlist from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;

-- Fail closed until an explicit, server-authenticated owner action turns this
-- off. Missing singleton row is also interpreted as ON by every guard below.
create table lanzo_ecom_bridge_qa.pilot_kill_switch (
  singleton boolean primary key default true check (singleton),
  active boolean not null default true,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null default 'bootstrap',
  change_reason text not null default 'default closed'
);
insert into lanzo_ecom_bridge_qa.pilot_kill_switch(singleton, active) values (true, true);
alter table lanzo_ecom_bridge_qa.pilot_kill_switch enable row level security;
revoke all on lanzo_ecom_bridge_qa.pilot_kill_switch from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;

create function lanzo_ecom_bridge_qa.acl_closed()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare signature text; target oid;
begin
  foreach signature in array array[
    'public.admin_list_staff_users(text,text,text,text)',
    'public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)',
    'public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)',
    'public.pos_get_cash_station_state(text,text,text,text)',
    'public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)',
    'public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)'
  ] loop
    target := to_regprocedure(signature);
    if target is null or exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = target and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function lanzo_ecom_bridge_qa.acl_closed() from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;

create function lanzo_ecom_bridge_qa.pilot_device_eligible(p_license_id uuid, p_tenant_id uuid, p_device_id uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1
    from public.licenses l
    join public.plans p on p.id = l.plan_id
    join public.license_devices d on d.license_id = l.id and d.id = p_device_id
    join public.ecommerce_portals ep on ep.license_id = l.id
    cross join lateral private.license_entitlement_state_v1(l.id) e
    where l.id = p_license_id
      and p_tenant_id = l.id
      and l.license_type = 'free'
      and p.code = 'free_trial'
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at > clock_timestamp())
      and e.is_entitled is true
      and e.effective_features->'ecommerce_portal_enabled' = 'true'::jsonb
      and e.effective_features->'ecommerce_order_inbox' = 'true'::jsonb
      and ep.status = 'published'
      and ep.ordering_enabled is true
      and ep.orders_paused is false
      and ep.deleted_at is null
      and d.is_active is true
      and d.security_token is not null
      and (select count(*) from public.license_devices active_d
           where active_d.license_id = l.id and active_d.is_active is true) <= l.max_devices
  );
$$;
revoke all on function lanzo_ecom_bridge_qa.pilot_device_eligible(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;

create or replace function lanzo_ecom_bridge_qa.authority_live(
  p_license_id uuid, p_device_id uuid, p_actor_type text, p_actor_id uuid,
  p_actor_session_id uuid
) returns boolean language sql volatile security definer set search_path = ''
as $function$
  select lanzo_ecom_bridge_qa.acl_closed()
    and exists (
      select 1
      from lanzo_ecom_bridge_qa.pilot_kill_switch k
      join lanzo_ecom_bridge_qa.pilot_allowlist a on a.license_id = p_license_id
        and a.tenant_id = p_license_id and a.device_id = p_device_id
      join public.licenses l on l.id = a.license_id
      join public.plans p on p.id = l.plan_id
      join public.license_devices d on d.license_id = l.id and d.id = p_device_id
      cross join lateral private.license_entitlement_state_v1(l.id) e
      where k.singleton is true and k.active is false
        and a.pilot_state = 'approved' and a.revoked_at is null
        and a.expires_at > clock_timestamp()
        and a.tenant_id = l.id
        and l.license_type = 'free' and p.code = 'free_trial'
        and l.status = 'active' and (l.expires_at is null or l.expires_at > clock_timestamp())
        and e.is_entitled is true
        and e.effective_features->'ecommerce_portal_enabled' = 'true'::jsonb
        and e.effective_features->'ecommerce_order_inbox' = 'true'::jsonb
        and exists (select 1 from public.ecommerce_portals ep
          where ep.license_id = l.id and ep.status = 'published'
            and ep.ordering_enabled is true and ep.orders_paused is false and ep.deleted_at is null)
        and d.is_active is true and d.security_token is not null
        and (select count(*) from public.license_devices active_d
             where active_d.license_id = l.id and active_d.is_active is true) <= l.max_devices
        and (
          (p_actor_type = 'admin' and d.device_mode in ('admin_only','shared') and exists (
            select 1 from public.license_admin_sessions s
            join public.license_admin_users u on u.id = s.admin_user_id and u.license_id = s.license_id
            where s.id = p_actor_session_id and s.license_id = l.id and s.device_id = d.id
              and u.id = p_actor_id and u.is_active is true
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
revoke all on function lanzo_ecom_bridge_qa.authority_live(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;

-- Issue and every renewal resolve the Lanzo actor from its canonical session
-- token. Browser-declared license/tenant/actor UUIDs are never authority.
create or replace function public.lanzo_ecom_bridge_qa_prepare(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.license_devices; a jsonb; i lanzo_ecom_bridge_qa.identities;
 g lanzo_ecom_bridge_qa.grants; lease uuid := gen_random_uuid();
 runtime uuid := (p->>'runtime_id')::uuid;
 ag bigint := (p->>'actor_generation')::bigint; tg bigint := (p->>'tenant_generation')::bigint;
begin
 if runtime is null or ag is null or tg is null or ag < 0 or tg < 0
   or not lanzo_ecom_bridge_qa.acl_closed()
   or not exists(select 1 from lanzo_ecom_bridge_qa.pilot_kill_switch k where k.singleton and k.active is false) then
  return jsonb_build_object('code','DENIED');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select x.* into d
 from public.license_devices x
 join public.licenses l on l.id = x.license_id
 join lanzo_ecom_bridge_qa.pilot_allowlist a on a.license_id = l.id and a.tenant_id = l.id and a.device_id = x.id
 where l.license_key = p->>'license_key'
   and a.pilot_state = 'approved' and a.revoked_at is null and a.expires_at > clock_timestamp()
   and x.device_fingerprint = p->>'device_fingerprint' and x.is_active is true
   and nullif(p->>'security_token','') is not null
   and (x.security_token = p->>'security_token' or x.previous_security_token = p->>'security_token');
 if not found then return jsonb_build_object('code','DENIED'); end if;
 if exists(select 1 from lanzo_ecom_bridge_qa.device_limits where device_id = d.id
   and window_start > clock_timestamp() - interval '1 minute' and attempts >= 20) then
  return jsonb_build_object('code','RATE_LIMITED');
 end if;
 insert into lanzo_ecom_bridge_qa.device_limits values(d.id,clock_timestamp(),1)
 on conflict(device_id) do update set
   attempts = case when lanzo_ecom_bridge_qa.device_limits.window_start < clock_timestamp() - interval '1 minute' then 1 else lanzo_ecom_bridge_qa.device_limits.attempts + 1 end,
   window_start = case when lanzo_ecom_bridge_qa.device_limits.window_start < clock_timestamp() - interval '1 minute' then clock_timestamp() else lanzo_ecom_bridge_qa.device_limits.window_start end;
 a := private.resolve_device_actor_session(d.license_id,d.id,d.device_mode,p->>'actor_session_token');
 if a->'success' is distinct from 'true'::jsonb
   or not lanzo_ecom_bridge_qa.authority_live(d.license_id,d.id,a->>'actor_type',(a->>'actor_id')::uuid,(a->>'actor_session_id')::uuid) then
  return jsonb_build_object('code','DENIED');
 end if;
 select * into i from lanzo_ecom_bridge_qa.identities
  where device_id = d.id and actor_session_id = (a->>'actor_session_id')::uuid for update;
 if not found then
  if (select count(*) from lanzo_ecom_bridge_qa.identities) >= 10 then return jsonb_build_object('code','CAPACITY'); end if;
  insert into lanzo_ecom_bridge_qa.identities(license_id,device_id,actor_type,actor_id,actor_session_id)
   values(d.license_id,d.id,a->>'actor_type',(a->>'actor_id')::uuid,(a->>'actor_session_id')::uuid) returning * into i;
 end if;
 if i.retired_at is not null or i.license_id is distinct from d.license_id
   or i.actor_type is distinct from a->>'actor_type' or i.actor_id is distinct from (a->>'actor_id')::uuid then
  return jsonb_build_object('code','DENIED');
 end if;
 if exists(select 1 from lanzo_ecom_bridge_qa.grants where identity_id = i.id and lease_id is not null) then
  return jsonb_build_object('code','BUSY');
 end if;
 select * into g from lanzo_ecom_bridge_qa.grants where identity_id = i.id and runtime_id = runtime for update;
 if found then
  if g.revoked_at is not null or g.expires_at <= clock_timestamp() or g.actor_generation <> ag or g.tenant_generation <> tg then
   return jsonb_build_object('code','DENIED');
  end if;
 else
  if (select count(*) from lanzo_ecom_bridge_qa.grants where identity_id = i.id and revoked_at is null and expires_at > clock_timestamp()) >= 4 then
   return jsonb_build_object('code','CAPACITY');
  end if;
  insert into lanzo_ecom_bridge_qa.grants(identity_id,runtime_id,actor_generation,tenant_generation)
   values(i.id,runtime,ag,tg) returning * into g;
 end if;
 if not lanzo_ecom_bridge_qa.lock_authority(i.id) then return jsonb_build_object('code','DENIED'); end if;
 if g.auth_session_id is not null and not exists(select 1 from auth.sessions where id = g.auth_session_id and user_id = i.auth_user_id) then
  return jsonb_build_object('code','DENIED');
 end if;
 if g.last_attempt > clock_timestamp() - interval '10 seconds' and g.vault is not null then
  return jsonb_build_object('code','CACHED','id',g.id,'identity_id',i.id,'auth_user_id',i.auth_user_id,'auth_session_id',g.auth_session_id,'vault',g.vault,'expires_at',g.expires_at);
 end if;
 if g.attempts >= 120 then return jsonb_build_object('code','CAPACITY'); end if;
 update lanzo_ecom_bridge_qa.grants set lease_id = lease, lease_until = clock_timestamp() + interval '30 seconds',
   last_attempt = clock_timestamp(), attempts = attempts + 1 where id = g.id;
 return jsonb_build_object('code','RESERVED','id',g.id,'identity_id',i.id,'auth_user_id',i.auth_user_id,
   'lease_id',lease,'auth_session_id',g.auth_session_id,'vault',g.vault,'expires_at',g.expires_at);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('code','DENIED');
end;
$$;

-- Recovery remains available after the pilot is disabled/revoked, but still
-- requires a freshly resolved canonical Lanzo session and an inventoried row.
create or replace function public.lanzo_ecom_bridge_qa_quarantine(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.license_devices; a jsonb; i lanzo_ecom_bridge_qa.identities;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select x.* into d from public.license_devices x join public.licenses l on l.id = x.license_id
 where l.license_key = p->>'license_key' and x.device_fingerprint = p->>'device_fingerprint'
   and x.is_active is true and nullif(p->>'security_token','') is not null
   and (x.security_token = p->>'security_token' or x.previous_security_token = p->>'security_token');
 if not found then return jsonb_build_object('code','DENIED'); end if;
 if exists(select 1 from lanzo_ecom_bridge_qa.device_limits where device_id = d.id
   and window_start > clock_timestamp() - interval '1 minute' and attempts >= 20) then
  return jsonb_build_object('code','RATE_LIMITED');
 end if;
 insert into lanzo_ecom_bridge_qa.device_limits values(d.id,clock_timestamp(),1)
 on conflict(device_id) do update set
   attempts = case when lanzo_ecom_bridge_qa.device_limits.window_start < clock_timestamp() - interval '1 minute' then 1 else lanzo_ecom_bridge_qa.device_limits.attempts + 1 end,
   window_start = case when lanzo_ecom_bridge_qa.device_limits.window_start < clock_timestamp() - interval '1 minute' then clock_timestamp() else lanzo_ecom_bridge_qa.device_limits.window_start end;
 a := private.resolve_device_actor_session(d.license_id,d.id,d.device_mode,p->>'actor_session_token');
 if a->'success' is distinct from 'true'::jsonb then return jsonb_build_object('code','DENIED'); end if;
 select * into i from lanzo_ecom_bridge_qa.identities
  where license_id = d.license_id and device_id = d.id
    and actor_session_id = (a->>'actor_session_id')::uuid for update;
 if not found or i.actor_type is distinct from a->>'actor_type' or i.actor_id is distinct from (a->>'actor_id')::uuid then
  return jsonb_build_object('code','DENIED');
 end if;
 update lanzo_ecom_bridge_qa.grants set revoked_at = coalesce(revoked_at,clock_timestamp()), vault = null,
   lease_id = null, lease_until = null where identity_id = i.id;
 update lanzo_ecom_bridge_qa.identities set retired_at = coalesce(retired_at,clock_timestamp()) where id = i.id;
 return jsonb_build_object('code','QUARANTINED','identity_id',i.id,'auth_user_id',i.auth_user_id);
exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('code','DENIED');
end;
$$;

-- The approval RPC is reachable only through the dedicated server control
-- capability. It records approval but leaves the global kill switch ON.
create function public.lanzo_ecom_bridge_qa_approve_pilot(
  p_license_id uuid, p_tenant_id uuid, p_device_id uuid, p_expires_at timestamptz,
  p_qa_run_id uuid, p_authorized_by text, p_approval_ref text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare entry lanzo_ecom_bridge_qa.pilot_allowlist;
begin
 if p_qa_run_id is null or p_expires_at is null or p_expires_at <= clock_timestamp()
   or p_expires_at > clock_timestamp() + interval '24 hours'
   or nullif(btrim(p_authorized_by),'') is null or nullif(btrim(p_approval_ref),'') is null
   or not lanzo_ecom_bridge_qa.acl_closed()
   or not exists(select 1 from lanzo_ecom_bridge_qa.pilot_kill_switch k where k.singleton and k.active is true)
   or not lanzo_ecom_bridge_qa.pilot_device_eligible(p_license_id,p_tenant_id,p_device_id) then
  return jsonb_build_object('code','DENIED');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 insert into lanzo_ecom_bridge_qa.pilot_allowlist(
   license_id,tenant_id,device_id,pilot_state,expires_at,qa_run_id,authorized_by,approval_ref,authorization_metadata
 ) values (
   p_license_id,p_tenant_id,p_device_id,'approved',p_expires_at,p_qa_run_id,
   left(btrim(p_authorized_by),120),left(btrim(p_approval_ref),160),
   jsonb_build_object('scope','free_ecommerce_qa','plan_code','free_trial','approved_by_control_token',true)
 ) returning * into entry;
 return jsonb_build_object('code','APPROVED','allowlist_id',entry.id,'qa_run_id',entry.qa_run_id,
   'expires_at',entry.expires_at,'kill_switch_active',true);
exception when unique_violation or foreign_key_violation then return jsonb_build_object('code','DENIED');
end;
$$;

create function public.lanzo_ecom_bridge_qa_set_kill_switch(p_active boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if p_active is null or nullif(btrim(p_reason),'') is null then return jsonb_build_object('code','DENIED'); end if;
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 if p_active is false and (not lanzo_ecom_bridge_qa.acl_closed() or not exists(
   select 1 from lanzo_ecom_bridge_qa.pilot_allowlist a
   where a.pilot_state = 'approved' and a.revoked_at is null and a.expires_at > clock_timestamp()
     and lanzo_ecom_bridge_qa.pilot_device_eligible(a.license_id,a.tenant_id,a.device_id)
 )) then return jsonb_build_object('code','DENIED'); end if;
 update lanzo_ecom_bridge_qa.pilot_kill_switch set active = p_active,
   changed_at = clock_timestamp(), changed_by = 'server_control', change_reason = left(btrim(p_reason),160)
 where singleton is true;
 if not found then return jsonb_build_object('code','DENIED'); end if;
 if p_active then
   -- Lock each grant row through the revocation commit; the publisher uses the
   -- same grant lock around realtime.send. Auth cleanup is handled by collector.
   update lanzo_ecom_bridge_qa.grants set revoked_at = coalesce(revoked_at,clock_timestamp()),
     vault = null, lease_id = null, lease_until = null where revoked_at is null;
 end if;
 return jsonb_build_object('code','UPDATED','active',p_active);
end;
$$;

create function public.lanzo_ecom_bridge_qa_revoke_pilot(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a lanzo_ecom_bridge_qa.pilot_allowlist;
begin
 perform pg_advisory_xact_lock(hashtextextended('lanzo-ecom-bridge-qa',0));
 select * into a from lanzo_ecom_bridge_qa.pilot_allowlist where id = p_id for update;
 if not found then return jsonb_build_object('code','DENIED'); end if;
 update lanzo_ecom_bridge_qa.grants g set revoked_at = coalesce(g.revoked_at,clock_timestamp()),
   vault = null, lease_id = null, lease_until = null
 from lanzo_ecom_bridge_qa.identities i
 where g.identity_id = i.id and i.license_id = a.license_id and i.device_id = a.device_id;
 update lanzo_ecom_bridge_qa.identities set retired_at = coalesce(retired_at,clock_timestamp())
   where license_id = a.license_id and device_id = a.device_id;
 update lanzo_ecom_bridge_qa.pilot_allowlist set pilot_state = 'revoked', revoked_at = coalesce(revoked_at,clock_timestamp())
   where id = a.id;
 return jsonb_build_object('code','REVOKED','allowlist_id',a.id);
end;
$$;

revoke all on function public.lanzo_ecom_bridge_qa_prepare(jsonb) from public, anon, authenticated, lanzo_ecom_bridge_receiver;
revoke all on function public.lanzo_ecom_bridge_qa_quarantine(jsonb) from public, anon, authenticated, lanzo_ecom_bridge_receiver;
revoke all on function public.lanzo_ecom_bridge_qa_approve_pilot(uuid,uuid,uuid,timestamptz,uuid,text,text)
  from public, anon, authenticated, lanzo_ecom_bridge_receiver;
revoke all on function public.lanzo_ecom_bridge_qa_set_kill_switch(boolean,text)
  from public, anon, authenticated, lanzo_ecom_bridge_receiver;
revoke all on function public.lanzo_ecom_bridge_qa_revoke_pilot(uuid)
  from public, anon, authenticated, lanzo_ecom_bridge_receiver;
grant execute on function public.lanzo_ecom_bridge_qa_approve_pilot(uuid,uuid,uuid,timestamptz,uuid,text,text) to service_role;
grant execute on function public.lanzo_ecom_bridge_qa_set_kill_switch(boolean,text) to service_role;
grant execute on function public.lanzo_ecom_bridge_qa_revoke_pilot(uuid) to service_role;

commit;
