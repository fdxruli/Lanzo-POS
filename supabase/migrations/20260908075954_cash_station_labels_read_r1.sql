-- CASH STATION LABELS READ R1
-- Human-readable station copy is projected from the tenant-scoped linked device.
-- This migration changes read projections only; it does not write cash data.
begin;

create or replace function private.pos_cash_session_to_labeled_jsonb(
  p_session public.pos_cash_sessions
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.pos_cash_session_to_jsonb(p_session)
    || jsonb_strip_nulls(jsonb_build_object(
      'device_name', opening_device.device_name,
      'opened_by_device_name', opening_device.device_name,
      'opening_device_name', opening_device.device_name
    ))
    from (values (1)) as anchor(dummy)
    left join public.license_devices opening_device
      on opening_device.id = coalesce(p_session.opened_by_device_id, p_session.device_id)
     and opening_device.license_id = p_session.license_id;
$function$;

revoke all on function private.pos_cash_session_to_labeled_jsonb(public.pos_cash_sessions) from public, anon, authenticated;

create or replace function public.pos_get_current_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_station public.pos_cash_stations;
  v_session public.pos_cash_sessions;
  v_movements jsonb := '[]'::jsonb;
  v_admin_open_sessions jsonb := '[]'::jsonb;
  v_legacy jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_station := private.resolve_cash_station_for_device(v_license_id, v_device_id, true);

  select * into v_session
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.cash_station_id = v_station.id
     and s.actor_key = v_actor_key
     and s.status = 'open'
     and s.deleted_at is null
   order by s.opened_at desc
   limit 1;

  if v_session.id is not null then
    -- CASH_CURRENT_SESSION_READ_PROJECTION_R1: read-only cash projection.
    v_session := private.project_pos_cash_session_totals(v_license_id, v_session.id);
    with limited_movement_ids as (
      select m.id
        from public.pos_cash_movements m
       where m.license_id = v_license_id
         and m.cash_session_id = v_session.id
         and m.deleted_at is null
       order by m.created_at desc
       limit 100
    )
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
      into v_movements
      from public.pos_cash_movements m
      join limited_movement_ids lm on lm.id = m.id;
  end if;

  if coalesce(v_context->>'device_role', 'staff') <> 'staff' then
    select coalesce(jsonb_agg(private.pos_cash_session_to_labeled_jsonb(s) order by s.opened_at desc), '[]'::jsonb)
      into v_admin_open_sessions
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.status = 'open'
       and s.deleted_at is null;

    select coalesce(jsonb_agg(private.pos_cash_session_to_labeled_jsonb(s) order by s.opened_at desc), '[]'::jsonb)
      into v_legacy
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.device_role = 'admin'
       and s.admin_user_id is null
       and s.actor_key like 'admin_device:%'
       and s.status = 'open'
       and s.deleted_at is null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_labeled_jsonb(v_session) end,
    'cash_station', to_jsonb(v_station),
    'cash_station_id', v_station.id,
    'movements', v_movements,
    'admin_open_sessions', v_admin_open_sessions,
    'legacy_admin_cash_sessions', v_legacy,
    'actor_key', v_actor_key,
    'actor_name', private.resolve_cash_actor_name(v_context),
    'sync_context', jsonb_strip_nulls(jsonb_build_object(
      'device_role', v_context->>'device_role',
      'staff_user_id', v_context->>'staff_user_id',
      'admin_user_id', v_context->>'admin_user_id',
      'cash_station_id', v_station.id,
      'cloud_cash_sync', true
    ))
  ));
end;
$function$;

create or replace function public.pos_pull_cash_snapshot_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_scope text default 'mine',
  p_limit integer default 100,
  p_offset integer default 0,
  p_include_closed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_scope text := lower(coalesce(nullif(btrim(p_scope), ''), 'mine'));
  v_sessions jsonb;
  v_movements jsonb;
  v_latest bigint;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if coalesce(v_context->>'device_role', 'staff') = 'staff' then
    v_scope := 'mine';
  elsif v_scope not in ('mine', 'open', 'all', 'staff') then
    v_scope := 'mine';
  end if;

  with selected_sessions as (
    select s.*
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.deleted_at is null
       and (p_include_closed is true or s.status = 'open')
       and (
         (v_scope = 'mine' and s.actor_key = v_actor_key)
         or (v_scope = 'open' and s.status = 'open')
         or (v_scope = 'all')
         or (v_scope = 'staff' and s.staff_user_id is not null)
       )
     order by s.opened_at desc
     limit v_limit offset v_offset
  ), selected_ids as (
    select id from selected_sessions
  )
  select
    coalesce((select jsonb_agg(private.pos_cash_session_to_labeled_jsonb(s) order by s.opened_at desc) from selected_sessions s), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc)
      from public.pos_cash_movements m
     where m.license_id = v_license_id
       and m.cash_session_id in (select id from selected_ids)
       and m.deleted_at is null), '[]'::jsonb)
    into v_sessions, v_movements;

  select coalesce(max(change_seq), 0) into v_latest
    from public.pos_sync_events
   where license_id = v_license_id
     and entity_type in ('cash_session', 'cash_movement');

  return jsonb_build_object(
    'success', true,
    'cash_sessions', v_sessions,
    'movements', v_movements,
    'latest_change_seq', v_latest,
    'scope', v_scope
  );
end;
$function$;

create or replace function public.pos_admin_list_cash_sessions_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_staff_user_id uuid default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sessions jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  if not private.cash_audit_allowed(v_context) then
    raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;

  select coalesce(jsonb_agg(row_payload order by opened_at desc), '[]'::jsonb)
    into v_sessions
    from (
      select s.opened_at,
             private.pos_cash_session_to_labeled_jsonb(s)
             || jsonb_strip_nulls(jsonb_build_object(
               'staff_display_name', lsu.display_name,
               'staff_username', lsu.username,
               'closed_by_device_name', closing_device.device_name,
               'closed_by_admin_display_name', admin_user.display_name,
               'movement_count', coalesce(m.movement_count, 0)
             )) as row_payload
        from public.pos_cash_sessions s
        left join public.license_staff_users lsu
          on lsu.id = s.staff_user_id
        left join public.license_devices closing_device
          on closing_device.id = s.closed_by_device_id
         and closing_device.license_id = s.license_id
        left join public.license_admin_users admin_user
          on admin_user.id = s.closed_by_admin_user_id
         and admin_user.license_id = s.license_id
        left join lateral (
          select count(*)::integer as movement_count
            from public.pos_cash_movements m
           where m.license_id = s.license_id
             and m.cash_session_id = s.id
             and m.deleted_at is null
        ) m on true
       where s.license_id = v_license_id
         and s.deleted_at is null
         and (p_status is null or s.status = p_status)
         and (p_staff_user_id is null or s.staff_user_id = p_staff_user_id)
         and (p_date_from is null or s.opened_at >= p_date_from)
         and (p_date_to is null or s.opened_at < p_date_to)
       order by s.opened_at desc
       limit v_limit offset v_offset
    ) q;

  return jsonb_build_object('success', true, 'cash_sessions', v_sessions);
end;
$function$;

create or replace function public.pos_admin_get_cash_session_detail_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_session public.pos_cash_sessions;
  v_movements jsonb;
  v_audit jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  if not private.cash_audit_allowed(v_context) then
    raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;

  select * into v_session
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.id = p_cash_session_id
     and s.deleted_at is null;
  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
    into v_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.cash_session_id = p_cash_session_id
     and m.deleted_at is null;

  select coalesce(jsonb_agg(
      to_jsonb(a)
      || jsonb_strip_nulls(jsonb_build_object(
        'device_name', d.device_name,
        'admin_display_name', au.display_name
      ))
      order by a.created_at desc
    ), '[]'::jsonb)
    into v_audit
    from public.pos_cash_audit_events a
    left join public.license_devices d
      on d.id = a.actor_device_id
     and d.license_id = a.license_id
    left join public.license_admin_users au
      on au.id = a.actor_admin_user_id
     and au.license_id = a.license_id
   where a.license_id = v_license_id
     and a.cash_session_id = p_cash_session_id;

  return jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_labeled_jsonb(v_session),
    'movements', v_movements,
    'audit_events', v_audit
  );
end;
$function$;

commit;
