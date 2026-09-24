-- LICENSE POST-DOWNGRADE CASH RECONCILIATION R1
-- Historical bridge only: never enables cloud_cash_sync for Free and never auto-closes cash.
begin;

create or replace function private.require_post_downgrade_cash_owner_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_owner public.license_admin_users;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_actor_session_token
  );

  if coalesce(v_context->>'actor_type', '') <> 'admin'
     or nullif(v_context->>'admin_user_id', '') is null then
    raise exception 'POST_DOWNGRADE_CASH_OWNER_REQUIRED' using errcode = 'P0001';
  end if;

  select u.* into v_owner
  from public.license_admin_users u
  where u.id = (v_context->>'admin_user_id')::uuid
    and u.license_id = (v_context->>'license_id')::uuid
    and u.is_active is true
    and u.is_owner is true
  limit 1;

  if v_owner.id is null then
    raise exception 'POST_DOWNGRADE_CASH_OWNER_REQUIRED' using errcode = 'P0001';
  end if;

  return v_context || jsonb_build_object(
    'owner_admin_user_id', v_owner.id,
    'owner_display_name', coalesce(nullif(btrim(v_owner.display_name), ''), nullif(btrim(v_owner.username), ''), 'Propietario')
  );
end;
$function$;

revoke all on function private.require_post_downgrade_cash_owner_v1(text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.post_downgrade_cash_boundary_v1(
  p_license_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_license public.licenses;
  v_current_plan public.plans;
  v_transition public.license_events;
  v_previous_plan public.plans;
  v_expiry public.license_events;
  v_current_cloud_cash boolean := false;
begin
  select * into v_license
  from public.licenses l
  where l.id = p_license_id
  limit 1;

  if v_license.id is null then
    return null;
  end if;

  select * into v_current_plan
  from public.plans p
  where p.id = v_license.plan_id
  limit 1;

  if v_current_plan.id is null
     or v_current_plan.code <> 'free_trial'
     or v_license.status <> 'active' then
    return null;
  end if;

  v_current_cloud_cash := coalesce(
    (v_license.features->>'cloud_cash_sync')::boolean,
    (v_current_plan.features->>'cloud_cash_sync')::boolean,
    false
  );

  if v_current_cloud_cash is true then
    return null;
  end if;

  select e.* into v_transition
  from public.license_events e
  join public.plans prior_plan
    on prior_plan.code = nullif(e.metadata->>'from_plan', '')
  where e.license_key = v_license.license_key
    and e.event_type = 'PLAN_CHANGED'
    and e.metadata->>'source' = 'licenses_update_trigger'
    and e.metadata->>'to_plan' = v_current_plan.code
    and coalesce((prior_plan.features->>'cloud_cash_sync')::boolean, false) is true
    and not exists (
      select 1
      from public.license_events later
      where later.license_key = e.license_key
        and later.event_type = 'PLAN_CHANGED'
        and later.triggered_at > e.triggered_at
    )
  order by e.triggered_at desc, e.id desc
  limit 1;

  if v_transition.id is null then
    return null;
  end if;

  select * into v_previous_plan
  from public.plans p
  where p.code = v_transition.metadata->>'from_plan'
  limit 1;

  if v_previous_plan.id is null
     or coalesce((v_previous_plan.features->>'cloud_cash_sync')::boolean, false) is not true then
    return null;
  end if;

  select e.* into v_expiry
  from public.license_events e
  where e.license_key = v_license.license_key
    and e.event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
    and e.metadata->>'previous_plan' = v_previous_plan.code
    and e.metadata->>'new_plan' = v_current_plan.code
    and abs(extract(epoch from (e.triggered_at - v_transition.triggered_at))) < 1
  order by e.triggered_at desc, e.id desc
  limit 1;

  return jsonb_strip_nulls(jsonb_build_object(
    'license_id', v_license.id,
    'downgraded_at', v_transition.triggered_at,
    'plan_change_event_id', v_transition.id,
    'downgrade_event_id', coalesce(v_expiry.id, v_transition.id),
    'boundary_source', case
      when v_expiry.id is not null then 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
      else 'PLAN_CHANGED:licenses_update_trigger'
    end,
    'previous_plan_code', v_previous_plan.code,
    'current_plan_code', v_current_plan.code,
    'expired_at', v_expiry.metadata->>'expired_at',
    'grace_ended_at', v_expiry.metadata->>'grace_ended_at'
  ));
end;
$function$;

revoke all on function private.post_downgrade_cash_boundary_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.post_downgrade_cash_session_evidence_v1(
  p_license_id uuid,
  p_cash_session_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_boundary jsonb;
  v_session public.pos_cash_sessions;
  v_license_key text;
  v_opening_plan_event public.license_events;
  v_opening_plan public.plans;
begin
  v_boundary := private.post_downgrade_cash_boundary_v1(p_license_id);
  if v_boundary is null then
    return null;
  end if;

  select s.* into v_session
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null
     or v_session.status <> 'open'
     or v_session.opened_at >= (v_boundary->>'downgraded_at')::timestamptz then
    return null;
  end if;

  select l.license_key into v_license_key
  from public.licenses l
  where l.id = p_license_id;

  select e.* into v_opening_plan_event
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'PLAN_CHANGED'
    and e.metadata->>'source' = 'licenses_update_trigger'
    and nullif(e.metadata->>'to_plan', '') is not null
    and e.triggered_at <= v_session.opened_at
  order by e.triggered_at desc, e.id desc
  limit 1;

  if v_opening_plan_event.id is null then
    return null;
  end if;

  select p.* into v_opening_plan
  from public.plans p
  where p.code = v_opening_plan_event.metadata->>'to_plan'
  limit 1;

  if v_opening_plan.id is null
     or coalesce((v_opening_plan.features->>'cloud_cash_sync')::boolean, false) is not true then
    return null;
  end if;

  return v_boundary || jsonb_build_object(
    'cash_session_id', v_session.id,
    'opened_at', v_session.opened_at,
    'opening_plan_event_id', v_opening_plan_event.id,
    'opening_plan_event_at', v_opening_plan_event.triggered_at,
    'opening_plan_code', v_opening_plan.code
  );
end;
$function$;

revoke all on function private.post_downgrade_cash_session_evidence_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.post_downgrade_cash_session_public_json_v1(
  p_session public.pos_cash_sessions,
  p_evidence jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_strip_nulls(
    (
      private.pos_cash_session_to_labeled_jsonb(p_session)
      - 'license_id'
      - 'device_id'
      - 'staff_user_id'
      - 'admin_user_id'
      - 'actor_key'
      - 'opened_by_actor_key'
      - 'closed_by_actor_key'
      - 'opened_by_device_id'
      - 'opened_by_staff_user_id'
      - 'closed_by_device_id'
      - 'closed_by_staff_user_id'
      - 'closed_by_admin_user_id'
      - 'opening_device_id'
      - 'cash_station_id'
      - 'metadata'
      - 'close_detail'
      - 'last_idempotency_key'
    )
    || jsonb_build_object(
      'post_downgrade_reconciliation', true,
      'downgraded_at', p_evidence->>'downgraded_at',
      'opening_plan_code', p_evidence->>'opening_plan_code',
      'previous_plan_code', p_evidence->>'previous_plan_code'
    )
  );
$function$;

revoke all on function private.post_downgrade_cash_session_public_json_v1(public.pos_cash_sessions,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.execute_admin_cash_close_v2(
  p_license_id uuid,
  p_device_id uuid,
  p_admin_user_id uuid,
  p_admin_session_id uuid,
  p_admin_name text,
  p_actor_key text,
  p_cash_session_id text,
  p_closing_mode text,
  p_counted_amount numeric,
  p_next_shift_fund numeric,
  p_reason_code text,
  p_comments text,
  p_expected_version integer,
  p_idempotency_key text,
  p_operation_type text,
  p_reconciliation_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
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
  v_request_hash text := null;
  v_bridge_evidence jsonb := null;
  v_audit_extra jsonb := '{}'::jsonb;
begin
  if p_license_id is null or p_device_id is null or p_admin_user_id is null or p_admin_session_id is null then
    raise exception 'ADMIN_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
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

  if p_reconciliation_source = 'POST_DOWNGRADE_CASH_RECONCILIATION' then
    v_request_hash := encode(extensions.digest(
      jsonb_build_object(
        'cash_session_id', p_cash_session_id,
        'closing_mode', v_mode,
        'counted_amount', v_counted,
        'next_shift_fund', v_next_fund,
        'reason_code', v_reason,
        'comments', v_comments,
        'expected_version', p_expected_version,
        'operation_type', p_operation_type
      )::text,
      'sha256'
    ), 'hex');
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    p_license_id,
    p_idempotency_key,
    p_operation_type,
    'cash_session',
    p_cash_session_id,
    v_request_hash
  );

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = p_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if p_reconciliation_source = 'POST_DOWNGRADE_CASH_RECONCILIATION'
       and (
         v_idem.operation_type is distinct from p_operation_type
         or v_idem.entity_type is distinct from 'cash_session'
         or v_idem.entity_id is distinct from p_cash_session_id
       ) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'El cierre administrativo ya esta en proceso.',
      'idempotency_key', p_idempotency_key
    );
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = p_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null
  for update;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_session.status <> 'open' then
    if p_reconciliation_source = 'POST_DOWNGRADE_CASH_RECONCILIATION' then
      raise exception 'POST_DOWNGRADE_CASH_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_reconciliation_source = 'POST_DOWNGRADE_CASH_RECONCILIATION' then
    v_bridge_evidence := private.post_downgrade_cash_session_evidence_v1(p_license_id, p_cash_session_id);
    if v_bridge_evidence is null then
      raise exception 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;

    v_audit_extra := jsonb_build_object(
      'reconciliation_source', 'POST_DOWNGRADE_CASH_RECONCILIATION',
      'downgraded_at', v_bridge_evidence->>'downgraded_at',
      'boundary_source', v_bridge_evidence->>'boundary_source',
      'previous_plan_code', v_bridge_evidence->>'previous_plan_code',
      'opening_plan_code', v_bridge_evidence->>'opening_plan_code',
      'downgrade_event_id', v_bridge_evidence->>'downgrade_event_id',
      'opening_plan_event_id', v_bridge_evidence->>'opening_plan_event_id'
    );
  end if;

  if p_expected_version is null or p_expected_version <> v_session.server_version then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'VERSION_CONFLICT',
      'message', 'La caja cambio desde que la revisaste. Actualizamos los datos; vuelve a confirmar el cierre.',
      'cash_session', private.pos_cash_session_to_jsonb(v_session),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(p_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_expected_before := v_session.expected_cash_total;
  v_entries_before := v_session.cash_entries_total;
  v_exits_before := v_session.cash_exits_total;
  v_session := private.recalculate_pos_cash_session_totals(p_license_id, v_session.id, false);

  if v_session.expected_cash_total is distinct from v_expected_before
     or v_session.cash_entries_total is distinct from v_entries_before
     or v_session.cash_exits_total is distinct from v_exits_before then
    update public.pos_cash_sessions
    set server_version = server_version + 1,
        updated_at = now()
    where license_id = p_license_id
      and id = v_session.id
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
    perform private.complete_pos_idempotency(p_license_id, p_idempotency_key, v_response);
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
      closed_by_device_id = p_device_id,
      closed_by_staff_user_id = null,
      closed_by_admin_user_id = p_admin_user_id,
      closed_by_actor_key = p_actor_key,
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
        'closed_by_admin_user_id', p_admin_user_id,
        'closed_by_admin_session_id', p_admin_session_id,
        'closed_by_device_id', p_device_id,
        'closed_from_server_version', v_session.server_version
      ) || v_audit_extra,
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key
  where license_id = p_license_id
    and id = v_session.id
  returning * into v_session;

  insert into public.pos_cash_audit_events (
    license_id,
    cash_session_id,
    event_type,
    actor_device_id,
    actor_staff_user_id,
    actor_admin_user_id,
    actor_name,
    payload
  ) values (
    p_license_id,
    v_session.id,
    v_event_type,
    p_device_id,
    null,
    p_admin_user_id,
    p_admin_name,
    jsonb_strip_nulls(jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'admin_session_id', p_admin_session_id,
      'device_id', p_device_id,
      'expected_cash_total', v_session.expected_cash_total,
      'counted_amount', v_counted,
      'cash_difference', v_difference,
      'next_shift_fund', v_next_fund,
      'reason_code', v_reason,
      'comment', v_comments,
      'closing_mode', v_mode,
      'reconciliation_status', v_reconciliation,
      'closed_from_server_version', v_session.server_version - 1
    ) || v_audit_extra)
  );

  v_event := private.record_pos_sync_event(
    p_license_id,
    'cash_session',
    v_session.id,
    'close',
    p_device_id,
    null,
    p_idempotency_key,
    jsonb_build_object(
      'cash_session_id', v_session.id,
      'actor_key', v_session.actor_key,
      'closing_mode', v_mode,
      'admin_user_id', p_admin_user_id
    ) || v_audit_extra,
    v_session.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'cash_session', private.pos_cash_session_to_jsonb(v_session),
    'event', to_jsonb(v_event),
    'change_seq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(p_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

revoke all on function private.execute_admin_cash_close_v2(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,text,integer,text,text,text)
  from public, anon, authenticated, service_role;

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
as $function$
declare
  v_context jsonb;
  v_admin_auth jsonb;
  v_actor_key text;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_cash_sync_enabled(v_context);

  v_admin_auth := private.require_active_admin_session(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  if coalesce((v_admin_auth->>'success')::boolean, false) is not true then
    raise exception '%', coalesce(v_admin_auth->>'code', 'ADMIN_SESSION_REQUIRED') using errcode = 'P0001';
  end if;

  v_actor_key := private.resolve_cash_actor_key(v_context);

  return private.execute_admin_cash_close_v2(
    (v_admin_auth->>'license_id')::uuid,
    (v_admin_auth->>'device_id')::uuid,
    (v_admin_auth->>'admin_user_id')::uuid,
    (v_admin_auth->>'admin_session_id')::uuid,
    coalesce(
      nullif(btrim(v_admin_auth->'admin_user'->>'display_name'), ''),
      nullif(btrim(v_admin_auth->'admin_user'->>'username'), ''),
      'Administrador'
    ),
    v_actor_key,
    p_cash_session_id,
    p_closing_mode,
    p_counted_amount,
    p_next_shift_fund,
    p_reason_code,
    p_comments,
    p_expected_version,
    p_idempotency_key,
    'cash.admin_close',
    null
  );
end;
$function$;

create or replace function public.pos_list_post_downgrade_cash_sessions_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_boundary jsonb;
  v_sessions jsonb := '[]'::jsonb;
begin
  v_context := private.require_post_downgrade_cash_owner_v1(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_boundary := private.post_downgrade_cash_boundary_v1(v_license_id);

  if v_boundary is null then
    return jsonb_build_object('success', true, 'cash_sessions', '[]'::jsonb, 'pending_count', 0);
  end if;

  select coalesce(jsonb_agg(row_payload order by opened_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select
      s.opened_at,
      private.post_downgrade_cash_session_public_json_v1(s, evidence.payload)
      || jsonb_build_object(
        'opening_device_name', opening_device.device_name,
        'original_device_active', coalesce(opening_device.is_active, false)
      ) as row_payload
    from public.pos_cash_sessions s
    cross join lateral (
      select private.post_downgrade_cash_session_evidence_v1(v_license_id, s.id) as payload
    ) evidence
    left join public.license_devices opening_device
      on opening_device.id = coalesce(s.opened_by_device_id, s.device_id)
     and opening_device.license_id = s.license_id
    where s.license_id = v_license_id
      and s.status = 'open'
      and s.deleted_at is null
      and evidence.payload is not null
  ) q;

  return jsonb_build_object(
    'success', true,
    'cash_sessions', v_sessions,
    'pending_count', jsonb_array_length(v_sessions),
    'downgraded_at', v_boundary->>'downgraded_at',
    'previous_plan_code', v_boundary->>'previous_plan_code',
    'current_plan_code', v_boundary->>'current_plan_code'
  );
end;
$function$;

create or replace function public.pos_get_post_downgrade_cash_session_detail_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null,
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
  v_evidence jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_audit jsonb := '[]'::jsonb;
begin
  v_context := private.require_post_downgrade_cash_owner_v1(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_evidence := private.post_downgrade_cash_session_evidence_v1(v_license_id, p_cash_session_id);

  if v_evidence is null then
    if exists (
      select 1
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.id = p_cash_session_id
        and s.deleted_at is null
        and s.status <> 'open'
    ) then
      raise exception 'POST_DOWNGRADE_CASH_ALREADY_CLOSED' using errcode = 'P0001';
    end if;
    raise exception 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null;

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'concept', m.concept,
      'created_at', m.created_at
    ))
    order by m.created_at desc
  ), '[]'::jsonb)
  into v_movements
  from public.pos_cash_movements m
  where m.license_id = v_license_id
    and m.cash_session_id = p_cash_session_id
    and m.deleted_at is null;

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', a.id,
      'event_type', a.event_type,
      'actor_name', a.actor_name,
      'created_at', a.created_at
    ))
    order by a.created_at desc
  ), '[]'::jsonb)
  into v_audit
  from public.pos_cash_audit_events a
  where a.license_id = v_license_id
    and a.cash_session_id = p_cash_session_id;

  return jsonb_build_object(
    'success', true,
    'cash_session', private.post_downgrade_cash_session_public_json_v1(v_session, v_evidence),
    'movements', v_movements,
    'audit_events', v_audit
  );
end;
$function$;

create or replace function public.pos_close_post_downgrade_cash_session_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null,
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
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_admin_user_id uuid;
  v_admin_session_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_admin_name text;
  v_core jsonb;
  v_session public.pos_cash_sessions;
  v_evidence jsonb;
begin
  v_context := private.require_post_downgrade_cash_owner_v1(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_admin_user_id := (v_context->>'admin_user_id')::uuid;
  v_admin_session_id := (v_context->>'admin_session_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_admin_name := coalesce(
    nullif(btrim(v_context->>'owner_display_name'), ''),
    'Propietario'
  );

  perform 1
  from public.licenses l
  where l.id = v_license_id
  for share;

  v_core := private.execute_admin_cash_close_v2(
    v_license_id,
    v_device_id,
    v_admin_user_id,
    v_admin_session_id,
    v_admin_name,
    v_actor_key,
    p_cash_session_id,
    p_closing_mode,
    p_counted_amount,
    p_next_shift_fund,
    p_reason_code,
    p_comments,
    p_expected_version,
    p_idempotency_key,
    'cash.post_downgrade_reconciliation',
    'POST_DOWNGRADE_CASH_RECONCILIATION'
  );

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id
    and s.id = p_cash_session_id
    and s.deleted_at is null;

  v_evidence := private.post_downgrade_cash_session_evidence_v1(v_license_id, p_cash_session_id);
  if v_evidence is null then
    v_evidence := private.post_downgrade_cash_boundary_v1(v_license_id)
      || jsonb_build_object('opening_plan_code', null);
  end if;

  return (v_core - 'event' - 'cash_total_snapshot_before_recalculation')
    || case
      when v_session.id is not null then
        jsonb_build_object(
          'cash_session',
          private.post_downgrade_cash_session_public_json_v1(v_session, coalesce(v_evidence, '{}'::jsonb))
        )
      else '{}'::jsonb
    end;
end;
$function$;

create or replace function public.pos_list_post_downgrade_cash_sessions(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_actor_session_token,
    p_rpc_name := 'pos_list_post_downgrade_cash_sessions',
    p_scope := 'POS_READ_HEAVY',
    p_max_attempts := 60,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'REPORT_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb;
  end if;
  return public.pos_list_post_downgrade_cash_sessions_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token
  );
end;
$function$;

create or replace function public.pos_get_post_downgrade_cash_session_detail(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null,
  p_cash_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_actor_session_token,
    p_rpc_name := 'pos_get_post_downgrade_cash_session_detail',
    p_scope := 'POS_READ_HEAVY',
    p_max_attempts := 60,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'REPORT_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb;
  end if;
  return public.pos_get_post_downgrade_cash_session_detail_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token, p_cash_session_id
  );
end;
$function$;

create or replace function public.pos_close_post_downgrade_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text default null,
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
as $function$
declare
  v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_actor_session_token,
    p_rpc_name := 'pos_close_post_downgrade_cash_session',
    p_scope := 'POS_WRITE',
    p_max_attempts := 20,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'RPC_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb;
  end if;
  return public.pos_close_post_downgrade_cash_session_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token,
    p_cash_session_id, p_closing_mode, p_counted_amount, p_next_shift_fund,
    p_reason_code, p_comments, p_expected_version, p_idempotency_key
  );
end;
$function$;

revoke all on function public.pos_list_post_downgrade_cash_sessions_unlimited(text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pos_get_post_downgrade_cash_session_detail_unlimited(text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pos_close_post_downgrade_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)
  from public, anon, authenticated, service_role;

revoke all on function public.pos_list_post_downgrade_cash_sessions(text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pos_get_post_downgrade_cash_session_detail(text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pos_close_post_downgrade_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)
  from public, anon, authenticated, service_role;

grant execute on function public.pos_list_post_downgrade_cash_sessions(text,text,text,text)
  to anon, authenticated;
grant execute on function public.pos_get_post_downgrade_cash_session_detail(text,text,text,text,text)
  to anon, authenticated;
grant execute on function public.pos_close_post_downgrade_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)
  to anon, authenticated;

commit;
