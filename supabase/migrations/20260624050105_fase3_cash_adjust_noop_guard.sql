begin;

create or replace function public.pos_adjust_initial_cash_fund(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null,
  p_new_opening_amount numeric default 0,
  p_reason text default null,
  p_expected_version integer default null,
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
  v_actor_key text;
  v_actor_name text;
  v_session public.pos_cash_sessions;
  v_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous numeric;
  v_delta numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  if coalesce(p_new_opening_amount, 0) < 0 then
    raise exception 'OPENING_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'CASH_ADJUST_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    p_idempotency_key,
    'cash.adjust_initial_fund',
    'cash_session',
    p_cash_session_id,
    null
  );

  if not v_inserted_idem then
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
      'message', 'El ajuste ya esta en proceso.',
      'idempotency_key', p_idempotency_key
    );
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  for update;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if coalesce(v_context->>'device_role', 'staff') = 'staff' and v_session.actor_key <> v_actor_key then
    raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'VERSION_CONFLICT',
      'message', 'La caja fue modificada en otro dispositivo.',
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_previous := coalesce(v_session.opening_amount, 0);
  v_delta := coalesce(p_new_opening_amount, 0) - v_previous;

  if v_delta = 0 then
    v_response := jsonb_build_object(
      'success', true,
      'no_change', true,
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'message', 'El fondo inicial ya tenia ese monto.',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_cash_sessions
  set opening_amount = p_new_opening_amount,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_initial_fund_adjust_reason', v_reason)
  where license_id = v_license_id
    and id = p_cash_session_id
  returning * into v_session;

  insert into public.pos_cash_movements (
    id,
    license_id,
    cash_session_id,
    device_id,
    staff_user_id,
    actor_key,
    type,
    amount,
    concept,
    source,
    created_by_device_id,
    created_by_staff_user_id,
    actor_name,
    idempotency_key,
    metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''),
    v_license_id,
    v_session.id,
    v_session.device_id,
    v_session.staff_user_id,
    v_session.actor_key,
    'fondo_inicial_ajuste',
    abs(v_delta),
    'Ajuste fondo inicial: ' || v_previous::text || ' -> ' || p_new_opening_amount::text || '. Motivo: ' || v_reason,
    'manual',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    p_idempotency_key,
    jsonb_build_object('previous_amount', v_previous, 'new_amount', p_new_opening_amount, 'delta', v_delta, 'reason', v_reason)
  ) returning * into v_movement;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);

  perform private.record_pos_cash_event(
    v_license_id,
    v_session.id,
    'INITIAL_FUND_ADJUSTED',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object('movement_id', v_movement.id, 'previous_amount', v_previous, 'new_amount', p_new_opening_amount)
  );

  v_event := private.record_pos_sync_event(
    v_license_id,
    'cash_session',
    v_session.id,
    'adjust',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('cash_session_id', v_session.id, 'movement_id', v_movement.id, 'actor_key', v_session.actor_key),
    v_session.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'movement', private.pos_cash_movement_to_jsonb(v_movement),
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

commit;;
