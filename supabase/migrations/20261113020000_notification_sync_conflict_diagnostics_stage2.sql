-- NOTIF SYNC DIAG STAGE 2: read-only, owner-only, tenant-scoped summary.
-- The existing admin session validator updates session heartbeat. This RPC
-- independently checks the same license/device/owner session without writes.
create function public.pos_get_sync_conflict_diagnostics_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_device_id uuid;
  v_admin_session_id uuid;
  v_pending integer;
  v_latest timestamptz;
  v_entities jsonb;
  v_types jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null
     or nullif(btrim(coalesce(p_staff_session_token, '')), '') is null then
    raise exception 'SYNC_DIAG_ACCESS_DENIED' using errcode = '42501';
  end if;

  select l.id into v_license_id
  from public.licenses l
  cross join lateral private.license_entitlement_state_v1(l.id) entitlement
  where l.license_key = p_license_key
    and entitlement.is_entitled is true
    and entitlement.lifecycle_state <> 'administratively_blocked'
    and coalesce((entitlement.effective_features->>'notification_center')::boolean, false)
    and coalesce((entitlement.effective_features->>'cloud_notifications')::boolean, false)
  limit 1;

  if v_license_id is null then
    raise exception 'SYNC_DIAG_ACCESS_DENIED' using errcode = '42501';
  end if;

  select d.id into v_device_id
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = p_device_fingerprint
    and d.is_active is true
    and d.device_mode in ('admin_only', 'shared')
    and (d.security_token = p_security_token
         or d.previous_security_token = p_security_token)
  limit 1;

  if v_device_id is null then
    raise exception 'SYNC_DIAG_ACCESS_DENIED' using errcode = '42501';
  end if;

  -- Match the latest-three session candidate rule of
  -- private.require_active_admin_session, without its heartbeat UPDATE.
  select candidate.id into v_admin_session_id
  from (
    select s.id, s.admin_user_id, s.session_token_hash, s.expires_at
    from public.license_admin_sessions s
    where s.license_id = v_license_id
      and s.device_id = v_device_id
      and s.revoked_at is null
    order by s.created_at desc
    limit 3
  ) candidate
  join public.license_admin_users a on a.id = candidate.admin_user_id
  where a.license_id = v_license_id
    and a.is_owner is true
    and a.is_active is true
    and candidate.expires_at > now()
    and extensions.crypt(p_staff_session_token, candidate.session_token_hash)
        = candidate.session_token_hash
  limit 1;

  if v_admin_session_id is null then
    raise exception 'SYNC_DIAG_ACCESS_DENIED' using errcode = '42501';
  end if;

  with pending as materialized (
    select c.entity_type, c.conflict_type, c.created_at
    from public.pos_sync_conflicts c
    where c.license_id = v_license_id and c.resolved_at is null
  )
  select
    (select count(*)::integer from pending),
    (select max(created_at) from pending),
    (select coalesce(jsonb_agg(jsonb_build_object('type', entity_type, 'count', n) order by entity_type), '[]'::jsonb)
     from (select entity_type, count(*)::integer as n from pending group by entity_type) by_entity),
    (select coalesce(jsonb_agg(jsonb_build_object('type', conflict_type, 'count', n) order by conflict_type), '[]'::jsonb)
     from (select conflict_type, count(*)::integer as n from pending group by conflict_type) by_type)
  into v_pending, v_latest, v_entities, v_types;

  return jsonb_build_object(
    'success', true,
    'pending_count', v_pending,
    'entities', v_entities,
    'conflict_types', v_types,
    'last_incident_at', v_latest,
    'checked_at', now()
  );
end;
$function$;

revoke all on function public.pos_get_sync_conflict_diagnostics_v1(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.pos_get_sync_conflict_diagnostics_v1(text,text,text,text)
  to anon, authenticated, service_role;

comment on function public.pos_get_sync_conflict_diagnostics_v1(text,text,text,text)
  is 'Read-only Cloud sync conflict summary for a verified active owner session and its license. No payloads or cross-tenant access.';
