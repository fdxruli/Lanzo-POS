-- LICENSE.LIFECYCLE.4
-- Private Realtime admission consumes the canonical lifecycle contract.
-- The realtime.* wrappers and realtime.messages policies intentionally remain
-- unchanged: they already form the narrow, client-callable policy boundary.

do $preflight$
begin
  if to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
    raise exception 'LICENSE_GRACE_REALTIME_CANONICAL_CONTRACT_MISSING';
  end if;
end;
$preflight$;

create or replace function private.can_access_pos_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.license_devices d
    cross join lateral private.license_entitlement_state_v1(d.license_id) entitlement
    where p_topic like 'pos:%'
      and d.realtime_topic is not null
      and p_topic = ('pos:' || split_part(d.realtime_topic, ':', 2))
      and d.is_active is true
      and d.security_token is not null
      and entitlement.is_entitled is true
      and coalesce((entitlement.effective_features->>'cloud_pos_sync')::boolean, false) is true
  );
$function$;

create or replace function private.can_access_license_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.license_devices d
    cross join lateral private.license_entitlement_state_v1(d.license_id) entitlement
    where p_topic like 'license:%'
      and d.realtime_topic = p_topic
      and d.is_active is true
      and d.security_token is not null
      and entitlement.is_entitled is true
      and coalesce((entitlement.effective_features->>'realtime_license_sync')::boolean, false) is true
  );
$function$;

revoke all on function private.can_access_pos_realtime_topic(text)
  from public, anon, authenticated;
revoke all on function private.can_access_license_realtime_topic(text)
  from public, anon, authenticated;

comment on function private.can_access_pos_realtime_topic(text) is
  'LICENSE.LIFECYCLE.4 private POS Broadcast admission. Requires an active tokenized device plus canonical entitlement and effective cloud_pos_sync.';

comment on function private.can_access_license_realtime_topic(text) is
  'LICENSE.LIFECYCLE.4 private license Broadcast admission. Requires an active tokenized device plus canonical entitlement and effective realtime_license_sync.';

do $security_verification$
begin
  if has_function_privilege('public', 'private.can_access_pos_realtime_topic(text)', 'execute')
     or has_function_privilege('anon', 'private.can_access_pos_realtime_topic(text)', 'execute')
     or has_function_privilege('authenticated', 'private.can_access_pos_realtime_topic(text)', 'execute')
     or has_function_privilege('public', 'private.can_access_license_realtime_topic(text)', 'execute')
     or has_function_privilege('anon', 'private.can_access_license_realtime_topic(text)', 'execute')
     or has_function_privilege('authenticated', 'private.can_access_license_realtime_topic(text)', 'execute') then
    raise exception 'LICENSE_GRACE_REALTIME_PRIVATE_EXECUTE_EXPOSED';
  end if;
end;
$security_verification$;
