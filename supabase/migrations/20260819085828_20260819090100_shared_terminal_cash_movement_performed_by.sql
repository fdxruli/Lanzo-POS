-- SHARED.TERMINAL.4 follow-up
-- Complete movement provenance without changing session ownership. The actor
-- that performs a normal movement is recorded separately from the session
-- owner; the cash session remains the source of truth for ownership/station.
begin;

create or replace function private.pos_cash_movement_station_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.pos_cash_sessions;
begin
  if tg_op = 'UPDATE' then
    if new.cash_session_id <> old.cash_session_id
       or coalesce(new.cash_station_id, '') <> coalesce(old.cash_station_id, '')
       or new.license_id <> old.license_id
       or coalesce(new.performed_by_actor_key, '') <> coalesce(old.performed_by_actor_key, '') then
      raise exception 'CASH_SESSION_STATION_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = new.license_id
    and s.id = new.cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null or v_session.cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if new.cash_station_id is not null and new.cash_station_id <> v_session.cash_station_id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;

  new.cash_station_id := v_session.cash_station_id;
  new.actor_key := coalesce(new.actor_key, v_session.actor_key);
  new.performed_by_actor_key := coalesce(
    new.performed_by_actor_key,
    nullif(new.metadata->>'performed_by_actor_key', ''),
    nullif(new.metadata->>'performedByActorKey', ''),
    new.actor_key,
    v_session.actor_key
  );
  return new;
end;
$$;

comment on function private.pos_cash_movement_station_guard() is
  'SHARED.TERMINAL.4: inherits station and records performed_by_actor_key without rewriting session ownership.';

commit;
