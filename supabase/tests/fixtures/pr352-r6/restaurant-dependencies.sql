-- Synthetic-only reconstruction of the current Production Cocina dependency.
-- Schema metadata and the six function bodies were read from pg_catalog on
-- 2026-10-31; no Production rows or credentials were read or copied.
-- The fixed synthetic rows are created by the PostgreSQL runner.

CREATE TABLE public.pos_preparation_stations (
  id text NOT NULL,
  license_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  name_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  server_version integer NOT NULL DEFAULT 1,
  created_by_device_id uuid,
  updated_by_device_id uuid,
  created_by_staff_user_id uuid,
  updated_by_staff_user_id uuid,
  last_idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT pos_preparation_stations_pkey PRIMARY KEY (id),
  CONSTRAINT pos_preparation_stations_code_not_blank CHECK (length(btrim(code)) > 0),
  CONSTRAINT pos_preparation_stations_created_by_device_id_fkey
    FOREIGN KEY (created_by_device_id) REFERENCES public.license_devices(id) ON DELETE SET NULL,
  CONSTRAINT pos_preparation_stations_created_by_staff_user_id_fkey
    FOREIGN KEY (created_by_staff_user_id) REFERENCES public.license_staff_users(id) ON DELETE SET NULL,
  CONSTRAINT pos_preparation_stations_default_code CHECK (is_default IS FALSE OR code = 'kitchen'),
  CONSTRAINT pos_preparation_stations_license_id_fkey
    FOREIGN KEY (license_id) REFERENCES public.licenses(id) ON DELETE CASCADE,
  CONSTRAINT pos_preparation_stations_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT pos_preparation_stations_updated_by_device_id_fkey
    FOREIGN KEY (updated_by_device_id) REFERENCES public.license_devices(id) ON DELETE SET NULL,
  CONSTRAINT pos_preparation_stations_updated_by_staff_user_id_fkey
    FOREIGN KEY (updated_by_staff_user_id) REFERENCES public.license_staff_users(id) ON DELETE SET NULL
);

CREATE INDEX pos_preparation_stations_license_active_idx
  ON public.pos_preparation_stations USING btree (license_id, is_active)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX pos_preparation_stations_license_code_uidx
  ON public.pos_preparation_stations USING btree (license_id, code)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX pos_preparation_stations_license_name_key_uidx
  ON public.pos_preparation_stations USING btree (license_id, name_key)
  WHERE deleted_at IS NULL;
CREATE INDEX pos_preparation_stations_license_updated_idx
  ON public.pos_preparation_stations USING btree (license_id, updated_at DESC);

ALTER TABLE public.pos_preparation_stations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.pos_preparation_stations TO service_role;

CREATE OR REPLACE FUNCTION private.normalize_pos_preparation_station_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$function$;

CREATE OR REPLACE FUNCTION private.is_restaurant_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  select lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')
$function$;

CREATE OR REPLACE FUNCTION private.normalize_restaurant_order_status(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  select case
    when lower(btrim(coalesce(p_status, ''))) in ('pending', 'preparing', 'ready', 'delivered', 'cancelled') then lower(btrim(coalesce(p_status, '')))
    when lower(btrim(coalesce(p_status, ''))) in ('open', 'sent', 'sent_to_kitchen') then 'pending'
    else 'pending'
  end
$function$;

CREATE OR REPLACE FUNCTION private.safe_jsonb_numeric(p_payload jsonb, p_key text, p_default numeric DEFAULT 0)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
declare v_value text;
begin
  v_value := nullif(btrim(coalesce(p_payload->>p_key, '')), '');
  if v_value is null then return coalesce(p_default, 0); end if;
  return v_value::numeric;
exception when others then
  return coalesce(p_default, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION private.ensure_default_preparation_station(
  p_license_id uuid,
  p_device_id uuid DEFAULT NULL::uuid,
  p_staff_user_id uuid DEFAULT NULL::uuid
)
RETURNS public.pos_preparation_stations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.resolve_restaurant_order_station(
  p_license_id uuid,
  p_station_code text,
  p_station_name text,
  p_device_id uuid DEFAULT NULL::uuid,
  p_staff_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_code text;
  v_station public.pos_preparation_stations;
begin
  perform private.ensure_default_preparation_station(p_license_id, p_device_id, p_staff_user_id);
  v_code := lower(btrim(coalesce(p_station_code, '')));
  if v_code is null or v_code = '' then v_code := 'kitchen'; end if;

  select * into v_station
  from public.pos_preparation_stations
  where license_id = p_license_id
    and code = v_code
    and is_active is true
    and deleted_at is null
  limit 1;

  if v_station.id is null then
    select * into v_station
    from public.pos_preparation_stations
    where license_id = p_license_id
      and code = 'kitchen'
      and is_active is true
      and deleted_at is null
    limit 1;
  end if;

  return jsonb_build_object(
    'code', coalesce(v_station.code, 'kitchen'),
    'name', coalesce(nullif(btrim(p_station_name), ''), v_station.name, 'Cocina')
  );
end;
$function$;

REVOKE ALL ON FUNCTION private.normalize_pos_preparation_station_name_key(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_restaurant_order_status(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.normalize_restaurant_order_status(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.safe_jsonb_numeric(jsonb,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ensure_default_preparation_station(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.resolve_restaurant_order_station(uuid,text,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
