-- QA ONLY: native Auth bridge. Outside migrations; no commercial activation.
do $$ begin
 if not (select relrowsecurity from pg_class where oid='realtime.messages'::regclass) then
  raise exception 'QA_REALTIME_RLS_REQUIRED';
 end if;
 if to_regprocedure('private.resolve_device_actor_session(uuid,uuid,text,text)') is null
 or to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
  raise exception 'QA_CANONICAL_AUTHORITY_REQUIRED';
 end if;
end $$;
create role lanzo_ecom_bridge_receiver nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create schema lanzo_ecom_bridge_qa authorization postgres;
revoke all on schema lanzo_ecom_bridge_qa from public,anon,authenticated,service_role;
create table lanzo_ecom_bridge_qa.qa_tenants(license_id uuid primary key references public.licenses(id));
alter table lanzo_ecom_bridge_qa.qa_tenants enable row level security;
create function lanzo_ecom_bridge_qa.authority_live(
  p_license_id uuid, p_device_id uuid, p_actor_type text, p_actor_id uuid,
  p_actor_session_id uuid
) returns boolean language sql volatile security definer set search_path = ''
as $function$
  select exists (
    select 1 from lanzo_ecom_bridge_qa.qa_tenants q
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
revoke all on function lanzo_ecom_bridge_qa.authority_live(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role, lanzo_ecom_bridge_receiver;
