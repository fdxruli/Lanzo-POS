-- SHARED.TERMINAL.2-R1 — Staff occupancy compatibility fix.
--
-- Active Staff sessions remain the primary evidence that a Staff actor is
-- currently in use. Legacy license_devices.staff_user_id is retained as a
-- dedicated-device reservation only when device_mode = 'staff_only'.
-- Shared terminals may preserve historical device_role/staff_user_id metadata,
-- but that metadata must not reserve the Staff actor after the Staff session
-- is revoked or expires.

-- Fail closed rather than cleaning or reconciling data implicitly if the new
-- dedicated-device uniqueness contract is already violated.
do $preflight$
begin
  if exists (
    select d.staff_user_id
    from public.license_devices d
    where d.is_active is true
      and d.device_mode = 'staff_only'
      and d.staff_user_id is not null
    group by d.staff_user_id
    having count(*) > 1
  ) then
    raise exception 'STAFF_ONLY_DUPLICATE_RESERVATION'
      using errcode = 'P0001';
  end if;
end;
$preflight$;

-- Preserve the existing staff_login_on_device_unlimited implementation byte
-- for byte except for the legacy reservation predicate. Using the installed
-- definition avoids duplicating unrelated auth/rate/device/session behavior in
-- this corrective migration while still enforcing an exact expected source
-- contract from the already-applied SHARED.TERMINAL.2 foundation.
do $replace_staff_occupancy$
declare
  v_definition text;
  v_old_guard constant text :=
    'and d.staff_user_id = v_staff_user.id and d.device_role = ''staff'' and d.is_active is true';
  v_new_guard constant text :=
    'and d.staff_user_id = v_staff_user.id and d.device_mode = ''staff_only'' and d.is_active is true';
  v_occurrences integer;
begin
  select pg_get_functiondef(
    'public.staff_login_on_device_unlimited(text,text,text,jsonb,text,text)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'STAFF_LOGIN_UNLIMITED_MISSING' using errcode = 'P0001';
  end if;

  -- Idempotent re-application: if the new guard is already installed, leave
  -- the function unchanged after still validating the old guard is absent.
  if position(v_new_guard in v_definition) = 0 then
    if position(v_old_guard in v_definition) = 0 then
      raise exception 'STAFF_OCCUPANCY_LEGACY_GUARD_UNEXPECTED'
        using errcode = 'P0001';
    end if;

    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_old_guard, ''))
    ) / length(v_old_guard);

    if v_occurrences <> 1 then
      raise exception 'STAFF_OCCUPANCY_LEGACY_GUARD_AMBIGUOUS'
        using errcode = 'P0001';
    end if;

    execute replace(v_definition, v_old_guard, v_new_guard);
  end if;

  select pg_get_functiondef(
    'public.staff_login_on_device_unlimited(text,text,text,jsonb,text,text)'::regprocedure
  ) into v_definition;

  if position(v_new_guard in v_definition) = 0
     or position(v_old_guard in v_definition) > 0 then
    raise exception 'STAFF_OCCUPANCY_FUNCTION_POSTCONDITION_FAILED'
      using errcode = 'P0001';
  end if;

  -- The active-session check must remain the primary occupancy authority.
  if position('from public.license_staff_sessions ss join public.license_devices d on d.id = ss.device_id' in v_definition) = 0
     or position('ss.revoked_at is null and ss.expires_at > now()' in v_definition) = 0 then
    raise exception 'STAFF_ACTIVE_SESSION_GUARD_MISSING'
      using errcode = 'P0001';
  end if;
end;
$replace_staff_occupancy$;

-- The old unique index encoded legacy device_role as global Staff ownership.
-- Keep the same index name, but reserve a Staff actor only for an active
-- dedicated staff_only terminal. Shared historical metadata is intentionally
-- outside the predicate.
drop index if exists public.uq_license_devices_one_active_device_per_staff;

create unique index uq_license_devices_one_active_device_per_staff
  on public.license_devices (staff_user_id)
  where is_active is true
    and device_mode = 'staff_only'
    and staff_user_id is not null;

-- Permanent postconditions: no shared auto-promotion, no data cleanup, and no
-- legacy role authority in the dedicated reservation index.
do $postconditions$
declare
  v_indexdef text;
  v_functiondef text;
begin
  select pg_get_functiondef(
    'public.staff_login_on_device_unlimited(text,text,text,jsonb,text,text)'::regprocedure
  ) into v_functiondef;

  if position('d.device_mode = ''staff_only''' in v_functiondef) = 0 then
    raise exception 'STAFF_ONLY_OCCUPANCY_GUARD_MISSING' using errcode = 'P0001';
  end if;

  select lower(i.indexdef)
  into v_indexdef
  from pg_indexes i
  where i.schemaname = 'public'
    and i.indexname = 'uq_license_devices_one_active_device_per_staff';

  if v_indexdef is null
     or position('device_mode = ''staff_only''::text' in v_indexdef) = 0
     or position('device_role' in v_indexdef) > 0 then
    raise exception 'STAFF_ONLY_RESERVATION_INDEX_UNEXPECTED'
      using errcode = 'P0001';
  end if;
end;
$postconditions$;
