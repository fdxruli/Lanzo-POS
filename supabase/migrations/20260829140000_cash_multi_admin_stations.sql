-- CASH MULTI-ADMIN STATIONS R1
-- Admin cash ownership is actor + authenticated device station. Staff keeps
-- the single-open-session policy, while the station partial unique index remains
-- the invariant for every role.
begin;

do $$
declare
  v_conflict record;
begin
  if to_regclass('public.ux_pos_cash_sessions_open_station') is null then
    raise exception 'CASH_STATION_UNIQUE_INDEX_REQUIRED';
  end if;

  select s.license_id, s.cash_station_id, count(*) as session_count
    into v_conflict
    from public.pos_cash_sessions s
   where s.status = 'open'
     and s.deleted_at is null
     and s.cash_station_id is not null
   group by s.license_id, s.cash_station_id
  having count(*) > 1
   limit 1;
  if v_conflict.license_id is not null then
    raise exception 'CASH_STATION_OPEN_SESSION_CONFLICT: license %, station %, sessions %',
      v_conflict.license_id, v_conflict.cash_station_id, v_conflict.session_count;
  end if;

  select s.license_id, s.actor_key, count(*) as session_count
    into v_conflict
    from public.pos_cash_sessions s
   where s.status = 'open'
     and s.deleted_at is null
     and s.device_role = 'staff'
     and s.actor_key is not null
   group by s.license_id, s.actor_key
  having count(*) > 1
   limit 1;
  if v_conflict.license_id is not null then
    raise exception 'CASH_STAFF_OPEN_ACTOR_CONFLICT: license %, actor %, sessions %',
      v_conflict.license_id, v_conflict.actor_key, v_conflict.session_count;
  end if;
end;
$$;

drop index if exists public.ux_pos_cash_sessions_open_actor;
drop index if exists public.ux_pos_cash_sessions_open_admin_identity;

create unique index if not exists ux_pos_cash_sessions_open_staff_actor
  on public.pos_cash_sessions (license_id, actor_key)
  where status = 'open'
    and deleted_at is null
    and device_role = 'staff'
    and actor_key is not null;

-- A new device gets its own deterministic station even when another Admin
-- session is already open. Session occupancy is enforced by the station index
-- and the station row lock in pos_open_cash_session.
create or replace function private.resolve_cash_station_for_device(
  p_license_id uuid,
  p_device_id uuid,
  p_create_default boolean default false
)
returns public.pos_cash_stations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.pos_cash_stations;
  v_active_bindings integer;
  v_station_id text := 'cash_station_device_' || p_device_id::text;
  v_station_key text := 'device_default:' || p_device_id::text;
begin
  if p_license_id is null or p_device_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;

  select count(*) into v_active_bindings
    from public.pos_cash_station_bindings b
   where b.license_id = p_license_id
     and b.device_id = p_device_id
     and b.status = 'active';

  if v_active_bindings > 1 then
    raise exception 'CASH_STATION_BINDING_AMBIGUOUS' using errcode = 'P0001';
  end if;

  select s.* into v_station
    from public.pos_cash_station_bindings b
    join public.pos_cash_stations s
      on s.license_id = b.license_id
     and s.id = b.cash_station_id
   where b.license_id = p_license_id
     and b.device_id = p_device_id
     and b.status = 'active'
   limit 1;

  if v_station.id is not null then
    if v_station.status <> 'active' then
      raise exception 'CASH_STATION_BLOCKED' using errcode = 'P0001';
    end if;
    return v_station;
  end if;

  if not p_create_default then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;

  insert into public.pos_cash_stations (id, license_id, station_key, binding_mode, metadata)
  values (
    v_station_id,
    p_license_id,
    v_station_key,
    'device_default',
    jsonb_build_object('identity_source', 'deterministic-device-bound', 'bound_device_id', p_device_id)
  )
  on conflict (license_id, station_key) do nothing;

  insert into public.pos_cash_station_bindings (
    license_id, cash_station_id, device_id, binding_mode, status, metadata
  ) values (
    p_license_id,
    v_station_id,
    p_device_id,
    'device_default',
    'active',
    jsonb_build_object('identity_source', 'deterministic-device-bound')
  )
  on conflict do nothing;

  select * into v_station
    from public.pos_cash_stations s
   where s.license_id = p_license_id
     and s.station_key = v_station_key
   limit 1;

  if v_station.id is null or v_station.status <> 'active' then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  return v_station;
end;
$$;

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
as $$
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
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
      into v_movements
      from public.pos_cash_movements m
     where m.license_id = v_license_id
       and m.cash_session_id = v_session.id
       and m.deleted_at is null;
  end if;

  if coalesce(v_context->>'device_role', 'staff') <> 'staff' then
    select coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.opened_at desc), '[]'::jsonb)
      into v_admin_open_sessions
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.status = 'open'
       and s.deleted_at is null;

    select coalesce(jsonb_agg(
      private.pos_cash_session_to_jsonb(s)
      || jsonb_strip_nulls(jsonb_build_object('opened_by_device_name', opening_device.device_name))
      order by s.opened_at desc
    ), '[]'::jsonb)
      into v_legacy
      from public.pos_cash_sessions s
      left join public.license_devices opening_device
        on opening_device.id = coalesce(s.opened_by_device_id, s.device_id)
       and opening_device.license_id = s.license_id
     where s.license_id = v_license_id
       and s.device_role = 'admin'
       and s.admin_user_id is null
       and s.actor_key like 'admin_device:%'
       and s.status = 'open'
       and s.deleted_at is null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
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
$$;

grant execute on function public.pos_get_current_cash_session(text, text, text, text) to anon, authenticated;

create or replace function public.pos_get_cash_station_state(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_role text;
  v_station public.pos_cash_stations;
  v_own_session public.pos_cash_sessions;
  v_station_open public.pos_cash_sessions;
  v_other_station_session public.pos_cash_sessions;
  v_status text;
  v_code text;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_station := private.resolve_cash_station_for_device(v_license_id, v_device_id, true);

  select * into v_own_session
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.cash_station_id = v_station.id
     and s.actor_key = v_actor_key
     and s.status = 'open'
     and s.deleted_at is null
   order by s.opened_at desc
   limit 1;

  select * into v_station_open
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.cash_station_id = v_station.id
     and s.status = 'open'
     and s.deleted_at is null
   order by s.opened_at desc
   limit 1;

  select * into v_other_station_session
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.actor_key = v_actor_key
     and s.status = 'open'
     and s.deleted_at is null
     and s.cash_station_id is distinct from v_station.id
   order by s.opened_at desc
   limit 1;

  if v_station_open.id is not null and v_station_open.actor_key <> v_actor_key then
    v_status := 'HANDOFF_REQUIRED';
    v_code := 'CASH_HANDOFF_REQUIRED';
  elsif v_own_session.id is not null then
    v_status := 'OWN_SESSION_OPEN';
    v_code := null;
  elsif v_role = 'staff' and v_other_station_session.id is not null then
    v_status := 'BLOCKED';
    v_code := 'CASH_SESSION_ALREADY_OPEN';
  else
    v_status := 'NO_SESSION';
    v_code := null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'financial_status', v_status,
    'financial_code', v_code,
    'cash_station', to_jsonb(v_station),
    'cash_session', case when v_own_session.id is null then null else private.pos_cash_session_to_jsonb(v_own_session) end,
    'station_open_cash_session', case when v_station_open.id is null then null else private.pos_cash_session_to_jsonb(v_station_open) end,
    'actor_key', v_actor_key,
    'cash_station_id', v_station.id,
    'sync_context', jsonb_strip_nulls(jsonb_build_object(
      'device_role', v_context->>'device_role',
      'staff_user_id', v_context->>'staff_user_id',
      'admin_user_id', v_context->>'admin_user_id',
      'cash_station_id', v_station.id
    ))
  ));
end;
$$;

grant execute on function public.pos_get_cash_station_state(text, text, text, text) to anon, authenticated;

create or replace function public.pos_open_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_opening jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_role text;
  v_actor_key text;
  v_actor_name text;
  v_station public.pos_cash_stations;
  v_station_open public.pos_cash_sessions;
  v_existing public.pos_cash_sessions;
  v_session public.pos_cash_sessions;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted boolean;
  v_opening numeric;
  v_counted numeric;
  v_suggested numeric;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_role := coalesce(v_context->>'device_role', 'staff');
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_station := private.resolve_cash_station_for_device(v_license_id, v_device_id, true);

  v_opening := greatest(coalesce(
    nullif(p_opening->>'opening_amount', '')::numeric,
    nullif(p_opening->>'montoInicial', '')::numeric,
    0
  ), 0);
  v_counted := greatest(coalesce(
    nullif(p_opening->>'opening_counted_amount', '')::numeric,
    nullif(p_opening->>'montoContado', '')::numeric,
    v_opening
  ), 0);
  v_suggested := greatest(coalesce(
    nullif(p_opening->>'opening_suggested_amount', '')::numeric,
    nullif(p_opening->>'montoSugerido', '')::numeric,
    0
  ), 0);

  v_inserted := private.insert_pos_idempotency_processing(
    v_license_id, p_idempotency_key, 'cash.open', 'cash_session', null, null
  );
  if not v_inserted then
    select * into v_idem
      from public.pos_idempotency_keys
     where license_id = v_license_id
       and idempotency_key = p_idempotency_key
     limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'idempotency_key', p_idempotency_key
    );
  end if;

  -- Serialize opens for this station, not for the actor across all stations.
  select * into v_station
    from public.pos_cash_stations s
   where s.license_id = v_license_id
     and s.id = v_station.id
   for update;

  select * into v_station_open
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.cash_station_id = v_station.id
     and s.status = 'open'
     and s.deleted_at is null
   order by s.opened_at desc
   limit 1
   for update;

  if v_station_open.id is not null then
    if v_station_open.actor_key = v_actor_key then
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CASH_SESSION_ALREADY_OPEN',
        'cash_session', private.pos_cash_session_to_jsonb(v_station_open),
        'idempotency_key', p_idempotency_key
      );
    else
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CASH_HANDOFF_REQUIRED',
        'message', 'La estación tiene una sesión abierta de otro actor; requiere cierre y reconciliación.',
        'cash_session', private.pos_cash_session_to_jsonb(v_station_open),
        'cash_station_id', v_station.id,
        'idempotency_key', p_idempotency_key
      );
    end if;
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  -- Staff retains one open session per actor. Admin identity is intentionally
  -- not checked here because the station is the financial boundary.
  if v_role = 'staff' then
    select * into v_existing
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.actor_key = v_actor_key
       and s.status = 'open'
       and s.deleted_at is null
     order by s.opened_at desc
     limit 1;

    if v_existing.id is not null then
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CASH_SESSION_ALREADY_OPEN',
        'message', 'El actor ya tiene una sesión de caja abierta en otra estación.',
        'cash_session', private.pos_cash_session_to_jsonb(v_existing),
        'idempotency_key', p_idempotency_key
      );
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  insert into public.pos_cash_sessions (
    id, license_id, device_id, staff_user_id, admin_user_id, device_role, scope, actor_key, status,
    cash_station_id, opened_by_actor_key,
    opening_amount, opening_counted_amount, opening_suggested_amount, opening_difference,
    opening_policy, opening_origin, is_auto_opening, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    'cash_' || replace(gen_random_uuid()::text, '-', ''),
    v_license_id, v_device_id, v_staff_user_id, v_admin_user_id, v_role, 'actor', v_actor_key, 'open',
    v_station.id, v_actor_key,
    v_opening, v_counted, v_suggested, v_counted - v_suggested,
    nullif(btrim(coalesce(p_opening->>'opening_policy', p_opening->>'politicaApertura', 'manual')), ''),
    nullif(btrim(coalesce(p_opening->>'opening_origin', p_opening->>'origen', 'manual')), ''),
    coalesce((p_opening->>'is_auto_opening')::boolean, (p_opening->>'esAutoApertura')::boolean, false),
    v_opening,
    case
      when v_role = 'staff' then v_actor_name
      else coalesce(
        nullif(btrim(p_opening->>'responsible_name'), ''),
        nullif(btrim(p_opening->>'responsable'), ''),
        v_actor_name,
        'Administrador'
      )
    end,
    v_device_id, v_staff_user_id, p_idempotency_key,
    coalesce(p_opening->'metadata', '{}'::jsonb)
      || jsonb_build_object(
        'phase', 'cash_multi_admin_stations_r1',
        'cash_station_id', v_station.id,
        'origin_actor_key', v_actor_key
      )
  ) returning * into v_session;

  perform private.record_pos_cash_event(
    v_license_id,
    v_session.id,
    'OPENED',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object('actor_key', v_actor_key, 'cash_station_id', v_station.id)
  );
  v_event := private.record_pos_sync_event(
    v_license_id,
    'cash_session',
    v_session.id,
    'open',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'cash_session_id', v_session.id,
      'cash_station_id', v_station.id,
      'actor_key', v_actor_key
    ),
    v_session.server_version
  );
  v_response := jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'cash_station', to_jsonb(v_station),
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  select * into v_station_open
    from public.pos_cash_sessions s
   where s.license_id = v_license_id
     and s.cash_station_id = v_station.id
     and s.status = 'open'
     and s.deleted_at is null
   order by s.opened_at desc
   limit 1;

  if v_station_open.id is not null then
    if v_station_open.actor_key = v_actor_key then
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CASH_SESSION_ALREADY_OPEN',
        'cash_session', private.pos_cash_session_to_jsonb(v_station_open),
        'idempotency_key', p_idempotency_key
      );
    else
      v_response := jsonb_build_object(
        'success', false,
        'code', 'CASH_HANDOFF_REQUIRED',
        'message', 'La estación tiene una sesión abierta de otro actor; requiere cierre y reconciliación.',
        'cash_session', private.pos_cash_session_to_jsonb(v_station_open),
        'cash_station_id', v_station.id,
        'idempotency_key', p_idempotency_key
      );
    end if;
  elsif v_role = 'staff' then
    select * into v_existing
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.actor_key = v_actor_key
       and s.status = 'open'
       and s.deleted_at is null
     order by s.opened_at desc
     limit 1;
    v_response := jsonb_build_object(
      'success', false,
      'code', 'CASH_SESSION_ALREADY_OPEN',
      'cash_session', case when v_existing.id is null then null else private.pos_cash_session_to_jsonb(v_existing) end,
      'idempotency_key', p_idempotency_key
    );
  else
    raise;
  end if;

  if v_license_id is not null and p_idempotency_key is not null then
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  end if;
  return v_response;
end;
$$;

grant execute on function public.pos_open_cash_session(text, text, text, text, jsonb, text) to anon, authenticated;

commit;
