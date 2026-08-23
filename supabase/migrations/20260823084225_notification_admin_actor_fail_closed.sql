-- Authenticated admin notification state must never silently fall back to a device row.

begin;

create or replace function private.get_pos_notification_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_rpc_name text default 'pos_notifications'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_features jsonb;
  v_device_role text;
  v_admin_user_id uuid;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(p_rpc_name, ''), 'pos_notifications'),
    p_scope := 'POS_NOTIFICATIONS',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 120,
    p_code := 'POS_NOTIFICATIONS_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    raise exception 'POS_NOTIFICATIONS_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;

  if v_device_role = 'admin' and v_admin_user_id is null then
    raise exception 'POS_NOTIFICATION_ADMIN_ACTOR_REQUIRED' using errcode = 'P0001';
  end if;

  v_features := coalesce(v_context->'features', '{}'::jsonb);

  if coalesce((v_features->>'notification_center')::boolean, false) is not true
     or coalesce((v_features->>'cloud_notifications')::boolean, false) is not true then
    raise exception 'NOTIFICATION_CENTER_DISABLED' using errcode = 'P0001';
  end if;

  if v_device_role = 'staff'
     and coalesce((v_context->'staff_permissions'->>'notifications')::boolean, false) is not true then
    raise exception 'STAFF_NOTIFICATIONS_DISABLED' using errcode = 'P0001';
  end if;

  return v_context;
end;
$function$;

revoke all on function private.get_pos_notification_context(text, text, text, text, text)
  from public, anon, authenticated;

commit;
