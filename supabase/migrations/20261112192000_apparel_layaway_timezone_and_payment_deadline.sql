-- Stage 3 Apparel layaways: business-confirmed IANA timezone and server-side due-date checks.
-- Prepared only. Never apply without explicit owner authorization, version/hash verification.
-- Previous UTC-midnight deadline convention is retained as a calendar-date encoding.
begin;

alter table public.business_profiles add column if not exists timezone text;

CREATE OR REPLACE FUNCTION public.get_business_profile_anon_unlimited(license_key_param text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid;
  v_data json;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return json_build_object(
      'success', false,
      'code', 'LICENSE_NOT_FOUND',
      'reason', 'LICENSE_NOT_FOUND',
      'message', 'Licencia no encontrada.'
    );
  end if;

  select json_build_object(
    'profile_id', bp.id,
    'license_key', l.license_key,
    'name', bp.business_name,
    'business_name', bp.business_name,
    'phone', bp.phone_number,
    'phone_number', bp.phone_number,
    'address', bp.address,
    'logo', bp.logo_url,
    'logo_url', bp.logo_url,
    'business_type', bp.business_type,
    'timezone', bp.timezone,
    'updated_at', bp.updated_at,
    'profile_revision', floor(
      extract(epoch from coalesce(bp.updated_at, bp.created_at, now())) * 1000
    )::bigint
  ) into v_data
  from public.business_profiles bp
  join public.licenses l on bp.license_id = l.id
  where bp.license_id = v_license_id;

  if v_data is null then
    return json_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'reason', 'PROFILE_NOT_FOUND',
      'message', 'Perfil de negocio no configurado.'
    );
  end if;

  return json_build_object('success', true, 'data', v_data);
end;
$function$


CREATE OR REPLACE FUNCTION public.save_business_profile_secure(license_key_param text, device_fingerprint_param text, security_token_param text, actor_session_token_param text, profile_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rate jsonb;
  v_context jsonb;
  v_result jsonb;
  v_code text;
  v_timezone text;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    license_key_param,
    device_fingerprint_param,
    null,
    'save_business_profile_secure',
    'PROFILE',
    30,
    600,
    600,
    'AUTH_RATE_LIMITED',
    '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  if nullif(btrim(coalesce(actor_session_token_param, '')), '') is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ACTOR_SESSION_REQUIRED',
      'error', 'ACTOR_SESSION_REQUIRED'
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      license_key_param,
      device_fingerprint_param,
      security_token_param,
      actor_session_token_param
    );
  exception
    when sqlstate 'P0001' then
      v_code := case sqlerrm
        when 'LICENSE_NOT_FOUND' then 'LICENSE_NOT_FOUND'
        when 'LICENSE_NOT_ACTIVE' then 'LICENSE_NOT_ACTIVE'
        when 'LICENSE_EXPIRED' then 'LICENSE_EXPIRED'
        when 'DEVICE_NOT_ALLOWED' then 'DEVICE_NOT_ALLOWED'
        when 'DEVICE_NOT_ACTIVE' then 'DEVICE_NOT_ACTIVE'
        when 'DEVICE_TOKEN_REQUIRED' then 'DEVICE_TOKEN_REQUIRED'
        when 'DEVICE_TOKEN_INVALID' then 'DEVICE_TOKEN_INVALID'
        when 'ACTOR_SESSION_REQUIRED' then 'ACTOR_SESSION_REQUIRED'
        when 'STAFF_SESSION_EXPIRED' then 'STAFF_SESSION_EXPIRED'
        when 'STAFF_USER_INACTIVE' then 'STAFF_USER_INACTIVE'
        when 'ACTOR_SESSION_AMBIGUOUS' then 'ACTOR_SESSION_AMBIGUOUS'
        else 'ACTOR_SESSION_INVALID'
      end;
      return jsonb_build_object('success', false, 'code', v_code, 'error', v_code);
  end;

  if private.has_pos_permission(v_context, 'settings_data') is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'SETTINGS_PERMISSION_DENIED',
      'error', 'SETTINGS_PERMISSION_DENIED'
    );
  end if;

  -- Only the actor-bound settings_data route may alter the calendar timezone.
  -- The legacy unlimited writer deliberately ignores profile_data.timezone.
  if profile_data ? 'timezone' then
    v_timezone := nullif(btrim(profile_data->>'timezone'), '');
    if v_timezone is null or length(v_timezone) > 128
       or position('/' in v_timezone) = 0
       or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
      return jsonb_build_object('success', false, 'code', 'BUSINESS_TIMEZONE_INVALID', 'error', 'BUSINESS_TIMEZONE_INVALID');
    end if;
  end if;

  v_result := public.save_business_profile_secure_unlimited(
    license_key_param,
    device_fingerprint_param,
    security_token_param,
    profile_data
  );

  if coalesce((v_result->>'success')::boolean, false) is false
     and not (v_result ? 'code') then
    v_result := v_result || jsonb_build_object(
      'code', coalesce(v_result->>'error', 'BUSINESS_PROFILE_SAVE_FAILED')
    );
  end if;
  if coalesce((v_result->>'success')::boolean, false) and profile_data ? 'timezone' then
    update public.business_profiles
       set timezone = v_timezone, updated_at = clock_timestamp()
     where license_id = (v_context->>'license_id')::uuid;
    if not found then
      raise exception 'BUSINESS_PROFILE_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_result := v_result || jsonb_build_object('timezone', v_timezone);
  end if;
  return v_result;
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'BUSINESS_PROFILE_SAVE_FAILED',
      'error', 'BUSINESS_PROFILE_SAVE_FAILED'
    );
end;
$function$


CREATE OR REPLACE FUNCTION private.execute_layaway_create_financial_v1(p_context jsonb, p_request jsonb, p_idempotency_key text, p_request_hash text, p_cash_station_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_payload jsonb;
  v_initial_payment jsonb;
  v_items jsonb;
  v_normalized jsonb;
  v_layaway_id text;
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_currency text;
  v_deadline timestamptz;
  v_business_timezone text;
  v_total numeric;
  v_payment_amount numeric := 0;
  v_payment_id text;
  v_payment_method text;
  v_cash_session_id text;
  v_layaway public.pos_layaways;
  v_session public.pos_cash_sessions;
  v_payment public.pos_layaway_payments;
  v_cash_movement public.pos_cash_movements;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_event public.pos_sync_events;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');

  v_layaway_payload := private.layaway_record_v1(p_request);
  if jsonb_typeof(v_layaway_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  v_layaway_id := private.layaway_request_text_v1(v_layaway_payload, array['id','layaway_id','layawayId']);
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_total := private.layaway_request_numeric_v1(v_layaway_payload, array['total_amount','totalAmount','total']);
  v_normalized := private.normalize_layaway_items_v1(
    coalesce(v_layaway_payload->'items', '[]'::jsonb), v_total
  );
  select coalesce(
    jsonb_agg(
      value || jsonb_build_object(
        'id', coalesce(nullif(btrim(value->>'id'), ''), v_layaway_id || ':item:' || ordinality::text)
      ) order by ordinality
    ),
    '[]'::jsonb
  )
    into v_items
    from jsonb_array_elements(v_normalized->'items') with ordinality;
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item
     where private.layaway_request_numeric_v1(item.value, array['discount_amount','discountAmount'], 0) > 0
  ) then
    perform private.assert_pos_permission(p_context, 'discounts');
  end if;
  v_currency := upper(coalesce(private.layaway_request_text_v1(v_layaway_payload, array['currency']), 'MXN'));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'LAYAWAY_CURRENCY_INVALID' using errcode = 'P0001';
  end if;

  begin
    if private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) ~ '^\d{4}-\d{2}-\d{2}$' then
      v_deadline := (private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate']) || 'T00:00:00+00')::timestamptz;
    else
      v_deadline := private.layaway_request_text_v1(v_layaway_payload, array['deadline','due_date','dueDate'])::timestamptz;
    end if;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'LAYAWAY_DEADLINE_INVALID' using errcode = 'P0001';
  end;
  if v_deadline is null then
    raise exception 'LAYAWAY_DEADLINE_REQUIRED' using errcode = 'P0001';
  end if;
  -- deadline remains a UTC-midnight calendar-date encoding for legacy readers.
  -- The timezone is a per-business IANA rule, never inferred from the client.
  select bp.timezone into v_business_timezone
    from public.business_profiles bp
   where bp.license_id = v_license_id for share;
  if v_business_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_business_timezone) then
    raise exception 'LAYAWAY_BUSINESS_TIMEZONE_REQUIRED' using errcode = 'P0001';
  end if;
  if (v_deadline at time zone 'UTC')::date < (clock_timestamp() at time zone v_business_timezone)::date then
    raise exception 'LAYAWAY_DEADLINE_IN_PAST' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is not null then
    raise exception 'LAYAWAY_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_initial_payment := private.layaway_payment_payload_v1(p_request);
  v_payment_amount := coalesce(private.layaway_request_numeric_v1(v_initial_payment, array['amount','total'], 0), 0);
  if v_payment_amount < 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_amount > v_total + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001';
  end if;
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_initial_payment, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount > 0 and v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
  if v_payment_amount > 0 then
    v_session := private.layaway_cash_session_v1(
      v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
    );
  end if;

  v_customer_id := private.layaway_request_text_v1(v_layaway_payload, array['customer_id','customerId']);
  v_customer_name := private.layaway_request_text_v1(v_layaway_payload, array['customer_name','customerName']);
  v_customer_phone := private.layaway_request_text_v1(v_layaway_payload, array['customer_phone','customerPhone']);

  insert into public.pos_layaways (
    id, license_id, customer_id, customer_name, customer_phone, total_amount,
    paid_amount, balance_due, currency, deadline, status, items, cash_station_id,
    created_by_device_id, created_by_staff_user_id, actor_key, actor_name,
    created_at, updated_at, server_version, last_idempotency_key, metadata
  ) values (
    v_layaway_id, v_license_id, v_customer_id, v_customer_name, v_customer_phone, round(v_total, 2),
    0, round(v_total, 2), v_currency, v_deadline, 'active', v_items, p_cash_station_id,
    v_device_id, v_staff_user_id, v_actor_key, v_actor_name,
    now(), now(), 1, p_idempotency_key,
    coalesce(v_layaway_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source_mode', 'cloud_committed',
      'cash_station_id', p_cash_station_id,
      'business_timezone', v_business_timezone
    )
  ) returning * into v_layaway;

  v_reservations := private.reserve_layaway_stock_v1(
    v_license_id, v_layaway_id, v_items, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name, p_idempotency_key
  );

  if v_payment_amount > 0 then
    v_payment_id := coalesce(
      private.layaway_request_text_v1(v_initial_payment, array['id','payment_id','paymentId']),
      v_layaway_id || ':payment:initial'
    );
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name,
      cash_station_id, performed_by_actor_key, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
      v_session.device_id, v_session.staff_user_id, v_session.actor_key,
      'entrada', round(v_payment_amount, 2), 'Abono inicial Apartado ' || v_layaway_id,
      'layaway_payment', 'layaway', v_layaway_id,
      v_device_id, v_staff_user_id, v_actor_name,
      v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
      jsonb_build_object(
        'phase', 'cloud_layaways_server_contract_r1',
        'source', 'layaway_payment',
        'layaway_id', v_layaway_id,
        'payment_id', v_payment_id,
        'payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'),
        'idempotency_key', p_idempotency_key
      )
    ) returning * into v_cash_movement;

    insert into public.pos_layaway_payments (
      id, license_id, layaway_id, payment_method, amount, status,
      cash_session_id, cash_station_id, cash_movement_id, reference,
      request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
      actor_key, actor_name, metadata
    ) values (
      v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
      v_session.id, v_session.cash_station_id, v_cash_movement.id,
      private.layaway_request_text_v1(v_initial_payment, array['reference','ref']),
      p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
      v_actor_key, v_actor_name,
      jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_initial_payment, array['payment_type','paymentType','type']), 'initial_deposit'))
    ) returning * into v_payment;

    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
    update public.pos_layaways
       set paid_amount = round(v_payment_amount, 2),
           balance_due = greatest(round(total_amount - v_payment_amount, 2), 0),
           status = case when v_payment_amount >= total_amount - 0.005 then 'ready' else 'active' end,
           updated_at = now(), server_version = server_version + 1,
           last_idempotency_key = p_idempotency_key
     where license_id = v_license_id and id = v_layaway_id
     returning * into v_layaway;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('status', v_layaway.status, 'total_amount', v_layaway.total_amount,
      'paid_amount', v_layaway.paid_amount, 'cash_station_id', p_cash_station_id,
      'payment_id', case when v_payment.id is null then null else v_payment.id end),
    v_layaway.server_version::integer
  );
  if v_payment.id is not null then
    perform private.record_pos_sync_event(
      v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_payment.cash_movement_id),
      v_payment.server_version::integer
    );
    perform private.record_pos_sync_event(
      v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
      p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
      v_cash_movement.server_version
    );
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'payments', v_payments,
    'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(v_reservations),
    'cash_movements', v_cash_movements,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_layaway_cash_movement_financial_to_jsonb_v2(v_cash_movement) end,
    'cash_session', null,
    'folio', null,
    'sale', null,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$


CREATE OR REPLACE FUNCTION private.execute_layaway_payment_financial_v1(p_context jsonb, p_request jsonb, p_idempotency_key text, p_request_hash text, p_cash_station_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := nullif(p_context->>'device_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_actor_key text := private.resolve_cash_actor_key(p_context);
  v_actor_name text := private.resolve_cash_actor_name(p_context);
  v_layaway_id text := private.layaway_request_id_v1(p_request);
  v_payment_payload jsonb := coalesce(p_request->'payment', '{}'::jsonb);
  v_payment_id text;
  v_payment_amount numeric;
  v_payment_method text;
  v_cash_session_id text := private.layaway_request_cash_session_id_v1(p_request);
  v_layaway public.pos_layaways;
  v_business_timezone text;
  v_existing_payment public.pos_layaway_payments;
  v_payment public.pos_layaway_payments;
  v_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_event public.pos_sync_events;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_latest_change_seq bigint;
begin
  perform private.assert_cloud_layaways_enabled(p_context);
  perform private.assert_pos_permission(p_context, 'pos');
  if v_layaway_id is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_payment_payload) <> 'object' then
    raise exception 'LAYAWAY_PAYMENT_INVALID' using errcode = 'P0001';
  end if;

  v_payment_id := private.layaway_request_text_v1(v_payment_payload, array['id','payment_id','paymentId']);
  if v_payment_id is null then
    raise exception 'LAYAWAY_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;
  v_payment_amount := private.layaway_request_numeric_v1(v_payment_payload, array['amount','total']);
  v_payment_method := lower(coalesce(private.layaway_request_text_v1(v_payment_payload, array['method','payment_method','paymentMethod']), 'cash'));
  if v_payment_method = 'efectivo' then v_payment_method := 'cash'; end if;
  if v_payment_amount is null or v_payment_amount <= 0 then
    raise exception 'LAYAWAY_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_method <> 'cash' then
    raise exception 'LAYAWAY_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id and l.id = v_layaway_id
   for update;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'cancelled' then
    raise exception 'LAYAWAY_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_layaway.status = 'completed' then
    raise exception 'LAYAWAY_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;

  select * into v_existing_payment
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id and p.id = v_payment_id
   for update;
  if v_existing_payment.id is not null then
    if abs(v_existing_payment.amount - v_payment_amount) > 0.005
       or v_existing_payment.payment_method <> v_payment_method then
      raise exception 'LAYAWAY_PAYMENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    raise exception 'LAYAWAY_PAYMENT_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  if v_layaway.status <> 'active' or v_layaway.balance_due <= 0.005 then
    raise exception 'LAYAWAY_NOT_PAYABLE' using errcode = 'P0001';
  end if;
  -- The calendar timezone used when the layaway was created is immutable
  -- for that layaway. Older rows use the business-confirmed timezone.
  v_business_timezone := nullif(btrim(v_layaway.metadata->>'business_timezone'), '');
  if v_business_timezone is null then
    select bp.timezone into v_business_timezone
      from public.business_profiles bp
     where bp.license_id = v_license_id for share;
  end if;
  if v_business_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_business_timezone) then
    raise exception 'LAYAWAY_BUSINESS_TIMEZONE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_layaway.deadline is null then
    raise exception 'LAYAWAY_DEADLINE_INVALID' using errcode = 'P0001';
  end if;
  if (v_layaway.deadline at time zone 'UTC')::date < (clock_timestamp() at time zone v_business_timezone)::date then
    raise exception 'LAYAWAY_OVERDUE' using errcode = 'P0001';
  end if;

  if v_payment_amount > v_layaway.balance_due + 0.005 then
    raise exception 'LAYAWAY_PAYMENT_EXCEEDS_BALANCE' using errcode = 'P0001';
  end if;
  v_session := private.layaway_cash_session_v1(
    v_license_id, v_device_id, v_actor_key, v_cash_session_id, p_cash_station_id
  );

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
    type, amount, concept, source, reference_type, reference_id,
    created_by_device_id, created_by_staff_user_id, actor_name,
    cash_station_id, performed_by_actor_key, idempotency_key, metadata
  ) values (
    'mov_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, v_session.id,
    v_session.device_id, v_session.staff_user_id, v_session.actor_key,
    'entrada', round(v_payment_amount, 2), 'Abono Apartado ' || v_layaway_id,
    'layaway_payment', 'layaway', v_layaway_id,
    v_device_id, v_staff_user_id, v_actor_name,
    v_session.cash_station_id, v_actor_key, p_idempotency_key || ':cash',
    jsonb_build_object(
      'phase', 'cloud_layaways_server_contract_r1',
      'source', 'layaway_payment',
      'layaway_id', v_layaway_id,
      'payment_id', v_payment_id,
      'payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'),
      'idempotency_key', p_idempotency_key
    )
  ) returning * into v_cash_movement;

  insert into public.pos_layaway_payments (
    id, license_id, layaway_id, payment_method, amount, status,
    cash_session_id, cash_station_id, cash_movement_id, reference,
    request_hash, idempotency_key, created_by_device_id, created_by_staff_user_id,
    actor_key, actor_name, metadata
  ) values (
    v_payment_id, v_license_id, v_layaway_id, 'cash', round(v_payment_amount, 2), 'confirmed',
    v_session.id, v_session.cash_station_id, v_cash_movement.id,
    private.layaway_request_text_v1(v_payment_payload, array['reference','ref']),
    p_request_hash, p_idempotency_key, v_device_id, v_staff_user_id,
    v_actor_key, v_actor_name,
    jsonb_build_object('payment_type', coalesce(private.layaway_request_text_v1(v_payment_payload, array['payment_type','paymentType','type']), 'installment'))
  ) returning * into v_payment;

  v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, true);
  update public.pos_layaways
     set paid_amount = round(paid_amount + v_payment_amount, 2),
         balance_due = greatest(round(total_amount - (paid_amount + v_payment_amount), 2), 0),
         status = case when paid_amount + v_payment_amount >= total_amount - 0.005 then 'ready' else status end,
         updated_at = now(), server_version = server_version + 1,
         last_idempotency_key = p_idempotency_key
   where license_id = v_license_id and id = v_layaway_id
   returning * into v_layaway;

  v_event := private.record_pos_sync_event(
    v_license_id, 'layaway', v_layaway_id, 'update', v_device_id, v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('reason', 'layaway_payment_confirmed', 'payment_id', v_payment.id,
      'cash_movement_id', v_cash_movement.id, 'paid_amount', v_layaway.paid_amount,
      'balance_due', v_layaway.balance_due),
    v_layaway.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'layaway_payment', v_payment.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'cash_movement_id', v_cash_movement.id),
    v_payment.server_version::integer
  );
  perform private.record_pos_sync_event(
    v_license_id, 'cash_movement', v_cash_movement.id, 'create', v_device_id, v_staff_user_id,
    p_idempotency_key, jsonb_build_object('layaway_id', v_layaway_id, 'payment_id', v_payment.id),
    v_cash_movement.server_version
  );

  select coalesce(jsonb_agg(private.pos_layaway_payment_financial_to_jsonb_v2(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id and p.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_financial_to_jsonb_v2(r) order by r.item_index), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id and r.layaway_id = v_layaway_id;
  select coalesce(jsonb_agg(private.pos_layaway_cash_movement_financial_to_jsonb_v2(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id and m.reference_type = 'layaway' and m.reference_id = v_layaway_id;
  select coalesce(max(change_seq), 0) into v_latest_change_seq
    from public.pos_sync_events where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_layaway',
    'layaway', private.pos_layaway_financial_to_jsonb_v2(v_layaway),
    'payment', private.pos_layaway_payment_financial_to_jsonb_v2(v_payment),
    'payments', v_payments,
    'inventory_reservations', private.financial_layaway_reservations_allowlist_v2(v_reservations),
    'cash_movements', v_cash_movements,
    'cash_movement', private.pos_layaway_cash_movement_financial_to_jsonb_v2(v_cash_movement),
    'cash_session', null,
    'folio', null,
    'sale', null,
    'event', private.pos_layaway_event_financial_to_jsonb_v2(v_event),
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_idempotency_key
  );
end;
$function$


commit;
