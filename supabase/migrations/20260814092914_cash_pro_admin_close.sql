-- CASH PRO FASE 2: cierre administrativo auditable.
-- Historical rows intentionally retain NULL metadata: their reconciliation cannot be inferred safely.
begin;

alter table public.pos_cash_sessions
  add column if not exists closing_mode text null,
  add column if not exists reconciliation_status text null,
  add column if not exists closure_reason_code text null,
  add column if not exists closed_by_admin_user_id uuid null references public.license_admin_users(id);

alter table public.pos_cash_audit_events
  add column if not exists actor_admin_user_id uuid null references public.license_admin_users(id);

alter table public.pos_cash_sessions
  drop constraint if exists pos_cash_sessions_closing_mode_chk,
  add constraint pos_cash_sessions_closing_mode_chk
    check (closing_mode is null or closing_mode in ('normal', 'admin_audited', 'admin_unverified')),
  drop constraint if exists pos_cash_sessions_reconciliation_status_chk,
  add constraint pos_cash_sessions_reconciliation_status_chk
    check (reconciliation_status is null or reconciliation_status in ('verified', 'verified_with_difference', 'unverified')),
  drop constraint if exists pos_cash_sessions_closure_reason_code_chk,
  add constraint pos_cash_sessions_closure_reason_code_chk
    check (closure_reason_code is null or closure_reason_code in (
      'historical_test', 'device_replaced', 'device_lost', 'abandoned_session', 'operational_error', 'other'
    ));

create index if not exists idx_pos_cash_sessions_license_closing_mode_closed
  on public.pos_cash_sessions (license_id, closing_mode, closed_at desc)
  where deleted_at is null and closing_mode is not null;
create index if not exists idx_pos_cash_sessions_closed_by_admin_user
  on public.pos_cash_sessions (closed_by_admin_user_id)
  where closed_by_admin_user_id is not null;
create index if not exists idx_pos_cash_audit_events_actor_admin_user
  on public.pos_cash_audit_events (actor_admin_user_id)
  where actor_admin_user_id is not null;

create or replace function private.pos_cash_session_to_jsonb(p_session public.pos_cash_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_session.id,
    'license_id', p_session.license_id,
    'device_id', p_session.device_id,
    'staff_user_id', p_session.staff_user_id,
    'device_role', p_session.device_role,
    'scope', p_session.scope,
    'actor_key', p_session.actor_key,
    'status', p_session.status,
    'opened_at', p_session.opened_at,
    'closed_at', p_session.closed_at,
    'opening_amount', p_session.opening_amount,
    'opening_counted_amount', p_session.opening_counted_amount,
    'opening_suggested_amount', p_session.opening_suggested_amount,
    'opening_difference', p_session.opening_difference,
    'opening_policy', p_session.opening_policy,
    'opening_origin', p_session.opening_origin,
    'is_auto_opening', p_session.is_auto_opening,
    'closing_counted_amount', p_session.closing_counted_amount,
    'next_shift_fund', p_session.next_shift_fund,
    'cash_sales_total', p_session.cash_sales_total,
    'customer_payments_total', p_session.customer_payments_total,
    'cash_entries_total', p_session.cash_entries_total,
    'cash_exits_total', p_session.cash_exits_total,
    'expected_cash_total', p_session.expected_cash_total,
    'cash_difference', p_session.cash_difference,
    'responsible_name', p_session.responsible_name,
    'opened_by_device_id', p_session.opened_by_device_id,
    'opened_by_staff_user_id', p_session.opened_by_staff_user_id,
    'closed_by_device_id', p_session.closed_by_device_id,
    'closed_by_staff_user_id', p_session.closed_by_staff_user_id,
    'closed_by_admin_user_id', p_session.closed_by_admin_user_id,
    'closing_mode', p_session.closing_mode,
    'reconciliation_status', p_session.reconciliation_status,
    'closure_reason_code', p_session.closure_reason_code,
    'audit_comments', p_session.audit_comments,
    'close_detail', p_session.close_detail,
    'metadata', p_session.metadata,
    'created_at', p_session.created_at,
    'updated_at', p_session.updated_at,
    'server_version', p_session.server_version,
    'deleted_at', p_session.deleted_at
  ))
$$;

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
begin
  -- validate_pos_sync_context establishes active license/device/feature context;
  -- require_active_admin_session then binds the privileged action to a stable owner identity.
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
  if v_reason = 'other' and v_comments is null then
    raise exception 'ADMIN_CLOSE_COMMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_unverified' and v_comments is null then
    raise exception 'ADMIN_CLOSE_COMMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_audited' and (v_counted is null or v_counted < 0) then
    raise exception 'ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_unverified' and v_counted is not null then
    raise exception 'ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_next_fund < 0 then raise exception 'NEXT_SHIFT_FUND_INVALID' using errcode = 'P0001'; end if;
  if v_mode = 'admin_unverified' and v_next_fund <> 0 then
    raise exception 'ADMIN_CLOSE_UNVERIFIED_NEXT_FUND_FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_mode = 'admin_audited' and v_next_fund > v_counted then
    raise exception 'NEXT_SHIFT_FUND_EXCEEDS_COUNTED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.admin_close', 'cash_session', p_cash_session_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cierre administrativo ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = p_cash_session_id and s.deleted_at is null
  for update;

  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if p_expected_version is null or p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La caja cambio desde que la revisaste. Actualizamos los datos; vuelve a confirmar el cierre.', 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
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
  v_event := private.record_pos_sync_event(v_license_id, 'cash_session', v_session.id, 'close', v_device_id, null, p_idempotency_key, jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key, 'closing_mode', v_mode, 'admin_user_id', v_admin_user_id), v_session.server_version);

  v_response := jsonb_build_object('success', true, 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'event', to_jsonb(v_event), 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_admin_close_cash_session(
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
  v_rate_limit jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'pos_admin_close_cash_session',
    p_scope := 'POS_WRITE',
    p_max_attempts := 20,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'RPC_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;
  return public.pos_admin_close_cash_session_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_cash_session_id, p_closing_mode, p_counted_amount, p_next_shift_fund,
    p_reason_code, p_comments, p_expected_version, p_idempotency_key
  );
end;
$$;

-- Enrich list/detail only; data remains tenant-scoped and loaded on demand.
create or replace function public.pos_admin_list_cash_sessions_unlimited(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text default null,
  p_status text default null, p_staff_user_id uuid default null, p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_limit integer default 100, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_license_id uuid; v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500); v_offset integer := greatest(coalesce(p_offset, 0), 0); v_sessions jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  if not private.cash_audit_allowed(v_context) then raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode = 'P0001'; end if;
  v_license_id := (v_context->>'license_id')::uuid;
  select coalesce(jsonb_agg(row_payload order by opened_at desc), '[]'::jsonb) into v_sessions from (
    select s.opened_at, private.pos_cash_session_to_jsonb(s) || jsonb_strip_nulls(jsonb_build_object(
      'staff_display_name', lsu.display_name, 'staff_username', lsu.username,
      'device_name', opening_device.device_name, 'closed_by_device_name', closing_device.device_name,
      'closed_by_admin_display_name', admin_user.display_name,
      'movement_count', coalesce(m.movement_count, 0)
    )) as row_payload
    from public.pos_cash_sessions s
    left join public.license_staff_users lsu on lsu.id = s.staff_user_id
    left join public.license_devices opening_device on opening_device.id = s.device_id and opening_device.license_id = s.license_id
    left join public.license_devices closing_device on closing_device.id = s.closed_by_device_id and closing_device.license_id = s.license_id
    left join public.license_admin_users admin_user on admin_user.id = s.closed_by_admin_user_id and admin_user.license_id = s.license_id
    left join lateral (select count(*)::integer as movement_count from public.pos_cash_movements m where m.license_id=s.license_id and m.cash_session_id=s.id and m.deleted_at is null) m on true
    where s.license_id=v_license_id and s.deleted_at is null and (p_status is null or s.status=p_status)
      and (p_staff_user_id is null or s.staff_user_id=p_staff_user_id) and (p_date_from is null or s.opened_at>=p_date_from) and (p_date_to is null or s.opened_at<p_date_to)
    order by s.opened_at desc limit v_limit offset v_offset
  ) q;
  return jsonb_build_object('success', true, 'cash_sessions', v_sessions);
end; $$;

create or replace function public.pos_admin_get_cash_session_detail_unlimited(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text default null, p_cash_session_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_license_id uuid; v_session public.pos_cash_sessions; v_movements jsonb; v_audit jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  if not private.cash_audit_allowed(v_context) then raise exception 'CASH_AUDIT_PERMISSION_DENIED' using errcode='P0001'; end if;
  v_license_id := (v_context->>'license_id')::uuid;
  select * into v_session from public.pos_cash_sessions s where s.license_id=v_license_id and s.id=p_cash_session_id and s.deleted_at is null;
  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode='P0001'; end if;
  select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc),'[]'::jsonb) into v_movements from public.pos_cash_movements m where m.license_id=v_license_id and m.cash_session_id=p_cash_session_id and m.deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_strip_nulls(jsonb_build_object('device_name', d.device_name, 'admin_display_name', au.display_name)) order by a.created_at desc),'[]'::jsonb) into v_audit from public.pos_cash_audit_events a left join public.license_devices d on d.id=a.actor_device_id and d.license_id=a.license_id left join public.license_admin_users au on au.id=a.actor_admin_user_id and au.license_id=a.license_id where a.license_id=v_license_id and a.cash_session_id=p_cash_session_id;
  return jsonb_build_object('success',true,'cash_session',private.pos_cash_session_to_jsonb(v_session),'movements',v_movements,'audit_events',v_audit);
end; $$;

revoke all on function public.pos_admin_close_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) to anon, authenticated;

commit;
