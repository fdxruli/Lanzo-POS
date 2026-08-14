-- CASH PRO FASE 2: prevent an administrative close from using a stale financial snapshot.
begin;

create or replace function public.pos_admin_close_cash_session_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_cash_session_id text default null,
  p_closing_mode text default null,
  p_counted_amount numeric default null,
  p_next_shift_fund numeric default null,
  p_reason_code text default null,
  p_comments text default null,
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
  v_admin_auth jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_admin_user_id uuid;
  v_admin_session_id uuid;
  v_admin_name text;
  v_session public.pos_cash_sessions;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_mode text := lower(nullif(btrim(coalesce(p_closing_mode, '')), ''));
  v_reason text := lower(nullif(btrim(coalesce(p_reason_code, '')), ''));
  v_comments text := nullif(btrim(coalesce(p_comments, '')), '');
  v_counted numeric := p_counted_amount;
  v_next_fund numeric := coalesce(p_next_shift_fund, 0);
  v_difference numeric := null;
  v_reconciliation text;
  v_event_type text;
  v_expected_before numeric;
  v_entries_before numeric;
  v_exits_before numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  v_admin_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  if coalesce((v_admin_auth->>'success')::boolean, false) is not true then
    raise exception '%', coalesce(v_admin_auth->>'code', 'ADMIN_SESSION_REQUIRED') using errcode = 'P0001';
  end if;

  v_license_id := (v_admin_auth->>'license_id')::uuid;
  v_device_id := (v_admin_auth->>'device_id')::uuid;
  v_admin_user_id := (v_admin_auth->>'admin_user_id')::uuid;
  v_admin_session_id := (v_admin_auth->>'admin_session_id')::uuid;
  v_admin_name := coalesce(nullif(btrim(v_admin_auth->'admin_user'->>'display_name'), ''), nullif(btrim(v_admin_auth->'admin_user'->>'username'), ''), 'Administrador');

  if v_mode not in ('admin_audited', 'admin_unverified') then
    raise exception 'ADMIN_CLOSE_MODE_INVALID' using errcode = 'P0001';
  end if;
  if v_reason not in ('historical_test', 'device_replaced', 'device_lost', 'abandoned_session', 'operational_error', 'other') then
    raise exception 'ADMIN_CLOSE_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if (v_reason = 'other' or v_mode = 'admin_unverified') and v_comments is null then
    raise exception 'ADMIN_CLOSE_COMMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_audited' and (v_counted is null or v_counted < 0) then
    raise exception 'ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_unverified' and v_counted is not null then
    raise exception 'ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_next_fund < 0 then
    raise exception 'NEXT_SHIFT_FUND_INVALID' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_unverified' and v_next_fund <> 0 then
    raise exception 'ADMIN_CLOSE_UNVERIFIED_NEXT_FUND_FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_audited' and v_next_fund > v_counted then
    raise exception 'NEXT_SHIFT_FUND_EXCEEDS_COUNTED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.admin_close', 'cash_session', p_cash_session_id, null);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key
    limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cierre administrativo ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null
  for update;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if p_expected_version is null or p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'VERSION_CONFLICT',
      'message', 'La caja cambio desde que la revisaste. Actualizamos los datos; vuelve a confirmar el cierre.',
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  -- Reconciliation may discover totals that were not yet projected into the session.
  -- Do not let a confirmation close against those newly discovered amounts.
  v_expected_before := v_session.expected_cash_total;
  v_entries_before := v_session.cash_entries_total;
  v_exits_before := v_session.cash_exits_total;
  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
  if v_session.expected_cash_total is distinct from v_expected_before
     or v_session.cash_entries_total is distinct from v_entries_before
     or v_session.cash_exits_total is distinct from v_exits_before then
    update public.pos_cash_sessions
    set server_version = server_version + 1,
        updated_at = now()
    where license_id = v_license_id and id = v_session.id
    returning * into v_session;
    v_response := jsonb_build_object(
      'success', false,
      'code', 'CASH_TOTALS_CHANGED',
      'message', 'La caja cambio mientras la revisabas. Actualizamos el efectivo esperado; revisa nuevamente los datos antes de confirmar.',
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'cash_total_snapshot_before_recalculation', jsonb_build_object(
        'expected_cash_total', v_expected_before,
        'cash_entries_total', v_entries_before,
        'cash_exits_total', v_exits_before
      ),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_mode = 'admin_audited' then
    v_difference := v_counted - v_session.expected_cash_total;
    v_reconciliation := case when v_difference = 0 then 'verified' else 'verified_with_difference' end;
    v_event_type := 'ADMIN_CLOSED_AUDITED';
  else
    v_counted := null;
    v_next_fund := 0;
    v_reconciliation := 'unverified';
    v_event_type := 'ADMIN_CLOSED_UNVERIFIED';
  end if;

  update public.pos_cash_sessions
  set status = 'closed',
      closed_at = now(),
      closing_counted_amount = v_counted,
      next_shift_fund = v_next_fund,
      cash_difference = v_difference,
      closing_mode = v_mode,
      reconciliation_status = v_reconciliation,
      closure_reason_code = v_reason,
      closed_by_device_id = v_device_id,
      closed_by_staff_user_id = null,
      closed_by_admin_user_id = v_admin_user_id,
      audit_comments = v_comments,
      close_detail = jsonb_build_object(
        'closing_mode', v_mode,
        'reconciliation_status', v_reconciliation,
        'reason_code', v_reason,
        'comments', v_comments,
        'expected_cash_total', v_session.expected_cash_total,
        'closing_counted_amount', v_counted,
        'cash_difference', v_difference,
        'next_shift_fund', v_next_fund,
        'closed_by_admin_user_id', v_admin_user_id,
        'closed_by_admin_session_id', v_admin_session_id,
        'closed_by_device_id', v_device_id,
        'closed_from_server_version', v_session.server_version
      ),
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = v_session.id
  returning * into v_session;

  insert into public.pos_cash_audit_events (
    license_id, cash_session_id, event_type, actor_device_id, actor_staff_user_id, actor_admin_user_id, actor_name, payload
  ) values (
    v_license_id, v_session.id, v_event_type, v_device_id, null, v_admin_user_id, v_admin_name,
    jsonb_strip_nulls(jsonb_build_object(
      'admin_user_id', v_admin_user_id,
      'admin_session_id', v_admin_session_id,
      'device_id', v_device_id,
      'expected_cash_total', v_session.expected_cash_total,
      'counted_amount', v_counted,
      'cash_difference', v_difference,
      'next_shift_fund', v_next_fund,
      'reason_code', v_reason,
      'comment', v_comments,
      'closing_mode', v_mode,
      'reconciliation_status', v_reconciliation,
      'closed_from_server_version', v_session.server_version - 1
    ))
  );
  v_event := private.record_pos_sync_event(
    v_license_id, 'cash_session', v_session.id, 'close', v_device_id, null,
    p_idempotency_key,
    jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key, 'closing_mode', v_mode, 'admin_user_id', v_admin_user_id),
    v_session.server_version
  );

  v_response := jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'event', to_jsonb(v_event), 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

revoke all on function public.pos_admin_close_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) to anon, authenticated;

commit;
