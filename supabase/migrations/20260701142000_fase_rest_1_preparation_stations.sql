begin;

create table if not exists public.pos_preparation_stations (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  code text not null,
  name text not null,
  name_key text not null,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1,
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  updated_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  updated_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_preparation_stations_code_not_blank check (length(btrim(code)) > 0),
  constraint pos_preparation_stations_name_not_blank check (length(btrim(name)) > 0),
  constraint pos_preparation_stations_default_code check (is_default is false or code = 'kitchen')
);

alter table public.pos_preparation_stations enable row level security;
revoke all on table public.pos_preparation_stations from anon, authenticated;

create unique index if not exists pos_preparation_stations_license_code_uidx
  on public.pos_preparation_stations (license_id, code)
  where deleted_at is null;

create unique index if not exists pos_preparation_stations_license_name_key_uidx
  on public.pos_preparation_stations (license_id, name_key)
  where deleted_at is null;

create index if not exists pos_preparation_stations_license_active_idx
  on public.pos_preparation_stations (license_id, is_active)
  where deleted_at is null;

create index if not exists pos_preparation_stations_license_updated_idx
  on public.pos_preparation_stations (license_id, updated_at desc);

create or replace function private.normalize_pos_preparation_station_name_key(p_name text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function private.slugify_pos_preparation_station_code(p_name text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_code text;
begin
  v_code := lower(btrim(coalesce(p_name, '')));
  v_code := translate(v_code, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_code := regexp_replace(v_code, '[^a-z0-9]+', '_', 'g');
  v_code := regexp_replace(v_code, '^_+|_+$', '', 'g');
  if v_code is null or v_code = '' then
    v_code := 'station_' || substr(md5(coalesce(p_name, 'station')), 1, 8);
  end if;
  return left(v_code, 64);
end;
$$;

create or replace function private.pos_preparation_station_to_jsonb(p_row public.pos_preparation_stations)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'name', p_row.name,
    'sortOrder', p_row.sort_order,
    'isDefault', p_row.is_default,
    'isActive', p_row.is_active,
    'serverVersion', p_row.server_version,
    'updatedAt', p_row.updated_at
  )
$$;

create or replace function private.list_pos_preparation_stations_jsonb(p_license_id uuid, p_include_inactive boolean default false)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(private.pos_preparation_station_to_jsonb(s) order by s.sort_order asc, s.name asc), '[]'::jsonb)
  from public.pos_preparation_stations s
  where s.license_id = p_license_id
    and s.deleted_at is null
    and (p_include_inactive is true or s.is_active is true)
$$;

create or replace function private.default_preparation_station_fallback_jsonb()
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_array(jsonb_build_object(
    'id', 'station_kitchen',
    'code', 'kitchen',
    'name', 'Cocina',
    'sortOrder', 0,
    'isDefault', true,
    'isActive', true,
    'serverVersion', 1,
    'updatedAt', null
  ))
$$;

create or replace function private.ensure_default_preparation_station(
  p_license_id uuid,
  p_device_id uuid default null,
  p_staff_user_id uuid default null
)
returns public.pos_preparation_stations
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_station public.pos_preparation_stations;
begin
  select * into v_station
  from public.pos_preparation_stations
  where license_id = p_license_id
    and code = 'kitchen'
    and deleted_at is null
  limit 1
  for update;

  if found then
    if v_station.is_default is not true or v_station.is_active is not true or v_station.name_key is null then
      update public.pos_preparation_stations
      set name = coalesce(nullif(btrim(name), ''), 'Cocina'),
          name_key = private.normalize_pos_preparation_station_name_key(coalesce(nullif(btrim(name), ''), 'Cocina')),
          sort_order = 0,
          is_default = true,
          is_active = true,
          updated_at = now(),
          server_version = server_version + 1,
          updated_by_device_id = p_device_id,
          updated_by_staff_user_id = p_staff_user_id
      where id = v_station.id
      returning * into v_station;
    end if;
    return v_station;
  end if;

  begin
    insert into public.pos_preparation_stations (
      id, license_id, code, name, name_key, sort_order, is_default, is_active,
      created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id,
      metadata
    ) values (
      'station_kitchen_' || replace(gen_random_uuid()::text, '-', ''),
      p_license_id,
      'kitchen',
      'Cocina',
      private.normalize_pos_preparation_station_name_key('Cocina'),
      0,
      true,
      true,
      p_device_id,
      p_device_id,
      p_staff_user_id,
      p_staff_user_id,
      jsonb_build_object('phase', 'REST.1', 'bootstrap', true)
    ) returning * into v_station;
  exception when unique_violation then
    select * into v_station
    from public.pos_preparation_stations
    where license_id = p_license_id
      and code = 'kitchen'
      and deleted_at is null
    limit 1;
  end;

  return v_station;
end;
$$;

create or replace function private.assert_preparation_stations_feature(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce((p_context->'features'->>'preparation_stations')::boolean, false) is not true then
    raise exception 'PREPARATION_STATIONS_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.assert_preparation_station_manage_permission(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $$
begin
  if coalesce(p_context->>'device_role', 'staff') <> 'staff' then
    return;
  end if;

  if coalesce((p_context->'staff_permissions'->>'settings')::boolean, false) is true
     or coalesce((p_context->'staff_permissions'->>'products')::boolean, false) is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:preparation_stations' using errcode = 'P0001';
end;
$$;

create or replace function public.pos_get_preparation_stations(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_stations jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  if coalesce((v_context->'features'->>'preparation_stations')::boolean, false) is not true then
    return jsonb_build_object(
      'success', true,
      'source', 'fallback',
      'stations', private.default_preparation_station_fallback_jsonb()
    );
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.ensure_default_preparation_station(v_license_id, v_device_id, v_staff_user_id);
  v_stations := private.list_pos_preparation_stations_jsonb(v_license_id, p_include_inactive);

  return jsonb_build_object(
    'success', true,
    'source', 'cloud',
    'stations', v_stations
  );
end;
$$;

create or replace function public.pos_upsert_preparation_station(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_station jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_station_id text;
  v_name text;
  v_name_key text;
  v_code text;
  v_sort_order integer;
  v_existing public.pos_preparation_stations;
  v_saved public.pos_preparation_stations;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_preparation_stations_feature(v_context);
  perform private.assert_preparation_station_manage_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.ensure_default_preparation_station(v_license_id, v_device_id, v_staff_user_id);

  v_name := nullif(btrim(coalesce(p_station->>'name', '')), '');
  if v_name is null then
    return jsonb_build_object('success', false, 'code', 'PREPARATION_STATION_NAME_REQUIRED', 'message', 'Indica el nombre del area.');
  end if;

  v_name_key := private.normalize_pos_preparation_station_name_key(v_name);
  v_station_id := nullif(btrim(coalesce(p_station->>'id', '')), '');
  if v_station_id is null then
    v_station_id := 'station_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  select * into v_existing
  from public.pos_preparation_stations
  where license_id = v_license_id
    and id = v_station_id
  limit 1
  for update;

  v_code := nullif(btrim(coalesce(p_station->>'code', '')), '');
  v_code := coalesce(v_code, v_existing.code, private.slugify_pos_preparation_station_code(v_name));
  if v_existing.is_default is true then
    v_code := 'kitchen';
  end if;
  if v_code = '' then
    return jsonb_build_object('success', false, 'code', 'PREPARATION_STATION_CODE_REQUIRED', 'message', 'No se pudo generar el codigo del area.');
  end if;

  if v_existing.id is not null then
    if v_existing.deleted_at is not null then
      v_response := jsonb_build_object('success', false, 'code', 'PREPARATION_STATION_DELETED', 'message', 'El area ya fue eliminada.', 'station', private.pos_preparation_station_to_jsonb(v_existing));
      return v_response;
    end if;
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El area fue modificada en otro dispositivo.', 'station', private.pos_preparation_station_to_jsonb(v_existing), 'serverVersion', v_existing.server_version);
      return v_response;
    end if;
  end if;

  if exists (
    select 1 from public.pos_preparation_stations s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.id <> v_station_id
      and s.name_key = v_name_key
  ) then
    return jsonb_build_object('success', false, 'code', 'DUPLICATE_PREPARATION_STATION_NAME', 'message', 'Ya existe un area con ese nombre.');
  end if;

  if exists (
    select 1 from public.pos_preparation_stations s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.id <> v_station_id
      and s.code = v_code
  ) then
    return jsonb_build_object('success', false, 'code', 'DUPLICATE_PREPARATION_STATION_CODE', 'message', 'Ya existe un area con ese codigo.');
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'preparation_station.upsert', 'preparation_station', v_station_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  v_sort_order := coalesce(
    nullif(p_station->>'sort_order', '')::integer,
    nullif(p_station->>'sortOrder', '')::integer,
    v_existing.sort_order,
    (select coalesce(max(sort_order), 0) + 10 from public.pos_preparation_stations where license_id = v_license_id and deleted_at is null)
  );

  if v_existing.id is null then
    insert into public.pos_preparation_stations (
      id, license_id, code, name, name_key, sort_order, is_default, is_active,
      created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id,
      last_idempotency_key, metadata
    ) values (
      v_station_id, v_license_id, v_code, v_name, v_name_key,
      case when v_code = 'kitchen' then 0 else v_sort_order end,
      v_code = 'kitchen',
      true,
      v_device_id, v_device_id, v_staff_user_id, v_staff_user_id,
      p_idempotency_key,
      coalesce(p_station->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'REST.1')
    ) returning * into v_saved;
  else
    update public.pos_preparation_stations
    set code = case when is_default then 'kitchen' else v_code end,
        name = v_name,
        name_key = v_name_key,
        sort_order = case when is_default then 0 else v_sort_order end,
        is_active = case when is_default then true else coalesce(nullif(p_station->>'isActive', '')::boolean, nullif(p_station->>'is_active', '')::boolean, is_active) end,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_station->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'REST.1')
    where license_id = v_license_id and id = v_station_id
    returning * into v_saved;
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'preparation_station', v_saved.id, 'upsert', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_preparation_station'), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'station', private.pos_preparation_station_to_jsonb(v_saved), 'stations', private.list_pos_preparation_stations_jsonb(v_license_id, true), 'event', to_jsonb(v_event), 'serverVersion', v_saved.server_version, 'changeSeq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_PREPARATION_STATION', 'message', 'Ya existe un area con ese nombre o codigo.', 'idempotency_key', p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
  return v_response;
end;
$$;

create or replace function public.pos_toggle_preparation_station(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_station_id text default null,
  p_is_active boolean default true,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_preparation_stations;
  v_saved public.pos_preparation_stations;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_preparation_stations_feature(v_context);
  perform private.assert_preparation_station_manage_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.ensure_default_preparation_station(v_license_id, v_device_id, v_staff_user_id);

  if nullif(btrim(coalesce(p_station_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'PREPARATION_STATION_ID_REQUIRED', 'message', 'No se encontro el area.');
  end if;

  select * into v_existing
  from public.pos_preparation_stations
  where license_id = v_license_id
    and id = p_station_id
    and deleted_at is null
  limit 1
  for update;

  if v_existing.id is null then
    return jsonb_build_object('success', false, 'code', 'PREPARATION_STATION_NOT_FOUND', 'message', 'No se encontro el area.');
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    return jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El area fue modificada en otro dispositivo.', 'station', private.pos_preparation_station_to_jsonb(v_existing), 'serverVersion', v_existing.server_version);
  end if;

  if v_existing.is_default is true and p_is_active is false then
    return jsonb_build_object('success', false, 'code', 'DEFAULT_STATION_CANNOT_BE_DISABLED', 'message', 'Cocina siempre debe permanecer activa.');
  end if;

  if p_is_active is false and (
    select count(*)
    from public.pos_preparation_stations s
    where s.license_id = v_license_id
      and s.deleted_at is null
      and s.is_active is true
      and s.id <> v_existing.id
  ) <= 0 then
    return jsonb_build_object('success', false, 'code', 'AT_LEAST_ONE_ACTIVE_STATION_REQUIRED', 'message', 'Debe existir al menos un area activa.');
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'preparation_station.toggle', 'preparation_station', p_station_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  update public.pos_preparation_stations
  set is_active = case when is_default then true else p_is_active end,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.1')
  where license_id = v_license_id and id = p_station_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(v_license_id, 'preparation_station', v_saved.id, 'toggle', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_toggle_preparation_station', 'is_active', v_saved.is_active), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'station', private.pos_preparation_station_to_jsonb(v_saved), 'stations', private.list_pos_preparation_stations_jsonb(v_license_id, true), 'event', to_jsonb(v_event), 'serverVersion', v_saved.server_version, 'changeSeq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

revoke all on function public.pos_get_preparation_stations(text, text, text, text, boolean) from public;
revoke all on function public.pos_upsert_preparation_station(text, text, text, text, jsonb, integer, text) from public;
revoke all on function public.pos_toggle_preparation_station(text, text, text, text, text, boolean, integer, text) from public;

grant execute on function public.pos_get_preparation_stations(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.pos_upsert_preparation_station(text, text, text, text, jsonb, integer, text) to anon, authenticated;
grant execute on function public.pos_toggle_preparation_station(text, text, text, text, text, boolean, integer, text) to anon, authenticated;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(
  'preparation_stations', case when code = 'pro_monthly' then true else false end
)
where code in ('free_trial', 'basic_monthly', 'pro_monthly');

commit;
