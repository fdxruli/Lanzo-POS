-- Stage 3, read-only post-install contract checks.
-- Safe for a development database or authorized post-install read-only verification.
-- This intentionally does NOT call the side-effecting operational generator.
begin transaction read only;

do $test$
declare
  v_generator text;
  v_list text;
begin
  v_generator := pg_get_functiondef(
    'private.generate_sync_operational_notifications(uuid)'::regprocedure
  );
  v_list := pg_get_functiondef(
    'public.list_pos_notifications(text,text,text,integer,integer,boolean,text)'::regprocedure
  );

  if position('create_pos_notification_once' in v_generator) = 0
     or position('sync_errors_active:' in v_generator) = 0
     or position('set expires_at = greatest(coalesce(expires_at, now()), now() + interval ''24 hours'')' in v_generator) = 0 then
    raise exception 'NOTIF-LIFE: active incident renewal or deduplication removed';
  end if;

  if position('v_resolution := private.set_pos_operational_incident_state' in v_generator) = 0
     or position('coalesce((v_resolution->>''resolved'')::boolean, false)' in v_generator) = 0
     or position('set expires_at = now() - interval ''1 microsecond''' in v_generator) = 0
     or position('and license_id = p_license_id' in v_generator) = 0
     or position('metadata->>''event'' = ''sync_errors_active''' in v_generator) = 0 then
    raise exception 'NOTIF-LIFE: closed incident must expire only its linked sync notification';
  end if;

  if position('n.expires_at is null or n.expires_at >= now()' in v_list) = 0
     or position('from visible_notifications where read_at is null and archived_at is null' in v_list) = 0
     or position('from visible_notifications where seen_at is null and archived_at is null' in v_list) = 0 then
    raise exception 'NOTIF-LIFE: visible lifecycle and authoritative counts changed';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = 'pos_notification_operational_incidents'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'NOTIF-LIFE: private incident table is exposed';
  end if;
end;
$test$;

rollback;
