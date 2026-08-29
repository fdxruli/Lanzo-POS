-- CASH MULTI-ADMIN STATIONS R1 follow-up
-- Enforce the authenticated device station at every cloud-sale boundary and
-- before V1 financial-operation reservation.  This migration is forward-only;
-- all existing effect engines, ACLs, idempotency, audit and tenant checks stay
-- in place and are patched in situ from their current definitions.
begin;

-- The station assertion is the shared server authority for direct sale and
-- cash-session paths.  Locking the session here makes the preflight check use
-- the same row-level serialization as the effect engines.
create or replace function private.assert_cash_session_station(
  p_license_id uuid,
  p_device_id uuid,
  p_cash_session_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_station public.pos_cash_stations;
  v_session public.pos_cash_sessions;
begin
  v_station := private.resolve_cash_station_for_device(p_license_id, p_device_id, false);
  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  for update;

  if v_session.id is null or v_session.cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if v_session.cash_station_id <> v_station.id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;
  return v_station.id;
end;
$function$;

-- Public wrappers and service-role engines do not all have the validated
-- context in scope.  Resolve it through the existing authentication/tenant
-- contract, then delegate to the same station assertion above.  The helper is
-- private and only uses the client session id as a lookup key; station data is
-- always resolved from the authenticated device binding and the session row.
create or replace function private.assert_cash_sale_station_for_request_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_cash_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
begin
  if nullif(btrim(p_cash_session_id), '') is null then
    return;
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  perform private.assert_cash_session_station(v_license_id, v_device_id, p_cash_session_id);
end;
$function$;

revoke all on function private.assert_cash_session_station(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.assert_cash_sale_station_for_request_v1(text, text, text, text, text)
  from public, anon, authenticated;

-- The rate-limited public names are themselves callable RPC boundaries.  Guard
-- them before they delegate so a caller cannot bypass the check by invoking a
-- wrapper directly or by relying on a payload cash_station_id.
do $$
declare
  v_rpc record;
  v_definition text;
  v_anchor text;
  v_guard text := $guard$
-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before sale delegation.
        perform private.assert_cash_sale_station_for_request_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_cash_session_id
        );
        $guard$;
begin
  for v_rpc in
    select * from (values
      ('public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)'::text, 'pos_create_cloud_sale_cashier_unlimited'::text),
      ('public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)'::text, 'pos_create_cloud_sale_cashier_inventory_unlimited'::text),
      ('public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'::text, 'pos_create_cloud_sale_credit_unlimited'::text)
    ) as r(rpc_signature, delegate_name)
  loop
    v_definition := pg_get_functiondef(v_rpc.rpc_signature::regprocedure);
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0 then
      v_anchor := 'RETURN public.' || v_rpc.delegate_name || '(';
      if position(v_anchor in v_definition) = 0 then
        v_anchor := 'return public.' || v_rpc.delegate_name || '(';
      end if;
      if position(v_anchor in v_definition) = 0 then
        raise exception 'CASH_MULTI_ADMIN_PUBLIC_WRAPPER_SHAPE_UNEXPECTED:%', v_rpc.rpc_signature
          using errcode = 'P0001';
      end if;
      v_definition := replace(v_definition, v_anchor, v_guard || v_anchor);
      execute v_definition;
    end if;

    v_definition := pg_get_functiondef(v_rpc.rpc_signature::regprocedure);
    v_anchor := 'RETURN public.' || v_rpc.delegate_name || '(';
    if position(v_anchor in v_definition) = 0 then
      v_anchor := 'return public.' || v_rpc.delegate_name || '(';
    end if;
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0
       or position('private.assert_cash_sale_station_for_request_v1' in v_definition) = 0
       or position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) > position(v_anchor in v_definition) then
      raise exception 'CASH_MULTI_ADMIN_PUBLIC_WRAPPER_GUARD_MISSING:%', v_rpc.rpc_signature
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- Protect the service-role-only R2B engines before server normalization,
-- idempotency lookup and the legacy effect engine.  These functions remain
-- service_role-only; CREATE OR REPLACE preserves their existing ACLs.
do $$
declare
  v_signature text;
  v_definition text;
  v_anchor text := 'v_authorized := private.r2b_authorize_sale_financial_request_v1(';
  v_guard text := $guard$
-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before R2B reservation.
  perform private.assert_cash_sale_station_for_request_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_cash_session_id
  );
  $guard$;
begin
  foreach v_signature in array array[
    'public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0 then
      if position(v_anchor in v_definition) = 0 then
        raise exception 'CASH_MULTI_ADMIN_UNLIMITED_FUNCTION_SHAPE_UNEXPECTED:%', v_signature
          using errcode = 'P0001';
      end if;
      v_definition := replace(v_definition, v_anchor, v_guard || v_anchor);
      execute v_definition;
    end if;

    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0
       or position('private.assert_cash_sale_station_for_request_v1' in v_definition) = 0
       or position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) > position(v_anchor in v_definition) then
      raise exception 'CASH_MULTI_ADMIN_UNLIMITED_GUARD_MISSING:%', v_signature
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- The legacy effect engines are still callable by service_role and the
-- inventory engine creates its idempotency row before delegating to cashier.
-- Assert against the already authenticated context before that preflight in
-- all three legacy functions.  Existing later status/actor/station checks stay
-- intact as defense in depth.
do $$
declare
  v_signature text;
  v_definition text;
  v_anchor text := 'v_actor_name := private.resolve_cash_actor_name(v_context);';
  v_guard text := $guard$
  -- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: preflight before idempotency/effects.
  if nullif(btrim(p_cash_session_id), '') is not null then
    perform private.assert_cash_session_station(v_license_id, v_device_id, p_cash_session_id);
  end if;
  $guard$;
begin
  foreach v_signature in array array[
    'public.pos_create_cloud_sale_cashier_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0 then
      if position(v_anchor in v_definition) = 0 then
        raise exception 'CASH_MULTI_ADMIN_LEGACY_FUNCTION_SHAPE_UNEXPECTED:%', v_signature
          using errcode = 'P0001';
      end if;
      v_definition := replace(v_definition, v_anchor, v_anchor || chr(10) || v_guard);
      execute v_definition;
    end if;

    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0
       or position('private.assert_cash_session_station' in v_definition) = 0
       or position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) > position('v_idempotency_key :=' in v_definition) then
      raise exception 'CASH_MULTI_ADMIN_LEGACY_GUARD_MISSING:%', v_signature
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- V1 must resolve the station from the current device and compare it with the
-- locked database session before reserve_financial_operation_v1 can create a
-- processing row.  p_request.cash_station_id is intentionally ignored.
do $$
declare
  v_definition text;
  v_decl_anchor text := 'v_cash_station_id text;';
  v_actor_anchor text := 'v_actor_key := private.resolve_cash_actor_key(v_context);';
  v_declarations text := $decl$
  v_cash_session_id text;
  v_session_station_id text;
  $decl$;
  v_guard text := $guard$
  -- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: before financial reservation.
  if p_operation_type in ('sale.cashier','sale.cashier_inventory','sale.credit') then
    v_cash_session_id := nullif(btrim(p_request->>'cash_session_id'), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;

    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id
      into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and s.id = v_cash_session_id
       and s.deleted_at is null
     for update;

    if not found then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_session_station_id is null then
      raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_session_station_id is distinct from v_cash_station_id then
      raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  $guard$;
begin
  v_definition := pg_get_functiondef(
    'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'::regprocedure
  );

  if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0 then
    if position(v_decl_anchor in v_definition) = 0
       or position(v_actor_anchor in v_definition) = 0
       or position('private.reserve_financial_operation_v1' in v_definition) = 0 then
      raise exception 'CASH_MULTI_ADMIN_FINANCIAL_EXECUTOR_SHAPE_UNEXPECTED'
        using errcode = 'P0001';
    end if;
    v_definition := replace(v_definition, v_decl_anchor, v_decl_anchor || chr(10) || v_declarations);
    v_definition := replace(v_definition, v_actor_anchor, v_actor_anchor || chr(10) || v_guard);
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef(
    'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'::regprocedure
  );
  if position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) = 0
     or position('private.resolve_financial_cash_station_v1' in v_definition) = 0
     or position('for update' in v_definition) = 0
     or position('CASH_SESSION_STATION_MISMATCH' in v_definition) = 0
     or position('CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1' in v_definition) > position('private.reserve_financial_operation_v1' in v_definition) then
    raise exception 'CASH_MULTI_ADMIN_FINANCIAL_EXECUTOR_GUARD_MISSING'
      using errcode = 'P0001';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
