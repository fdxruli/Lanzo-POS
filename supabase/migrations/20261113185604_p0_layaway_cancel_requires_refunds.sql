-- P0 authorization fix for Apparel Cloud layaway cancellation.
-- All four public execution/recovery routes re-check the server-built actor
-- context before effects, idempotent result recovery, or receipt disclosure.
-- CREATE OR REPLACE preserves each function's existing owner, ACL, and comment.

BEGIN;

DO $guard$
DECLARE
  v_signature text;
  v_expected_md5 text;
  v_actual_md5 text;
  v_proc regprocedure;
BEGIN
  FOR v_signature, v_expected_md5 IN
    SELECT * FROM (VALUES
      ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', '503c7cbc2bbc71772649dbf6ff562a57'),
      ('private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)', 'bcaca2181fe248a1f6407380f33bc060'),
      ('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)', '0eb091ed1701ee15559eccc5ba6c3a7f'),
      ('public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb)', '4a1334e1e7b68b35463c160198ae5232')
    ) AS expected(function_signature, definition_md5)
  LOOP
    v_proc := to_regprocedure(v_signature);
    IF v_proc IS NULL THEN
      RAISE EXCEPTION 'P0_CANCEL_AUTH_FUNCTION_MISSING: %', v_signature USING ERRCODE = 'P0001';
    END IF;
    v_actual_md5 := md5(pg_get_functiondef(v_proc));
    IF v_actual_md5 IS DISTINCT FROM v_expected_md5 THEN
      RAISE EXCEPTION 'P0_CANCEL_AUTH_FUNCTION_DRIFT: %', v_signature USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '45s'
 SET lock_timeout TO '20s'
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_canonical jsonb;
  v_execution jsonb;
  v_cash_station_id text;
  v_cash_session_id text;
  v_session_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
  v_requires_cash boolean := false;
  v_layaway_id text;
  v_payment_payload jsonb;
  v_rate_limit jsonb;
  v_restaurant_order_id text;
  v_restaurant_version text;
  v_restaurant_version_at timestamptz;
  v_restaurant_order public.pos_restaurant_orders;
  v_restaurant_row_exists boolean := false;
  v_restaurant_context_supplied boolean := false;
  v_is_restaurant_settlement boolean := false;
  v_sale_total numeric;
  v_restaurant_paid_sale_id text;
  v_restaurant_paid_folio text;
  v_restaurant_close_response jsonb;
  v_restaurant_payment_summary jsonb;
begin
  perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_request);
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key, p_device_fingerprint, p_staff_session_token,
      'pos_execute_financial_operation_v1.layaway', 'POS_WRITE',
      120, 600, 300, 'RPC_RATE_LIMITED',
      jsonb_build_object('operation_type', p_operation_type)
    );
    if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
      return public.build_pos_rpc_rate_limited_response(v_rate_limit);
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    perform private.assert_cloud_layaways_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'pos');
    if p_operation_type = 'layaway.cancel' then
      perform private.assert_pos_permission(v_context, 'refunds');
    end if;
  end if;

  -- Canonicalize first so restaurant settlement takes its shared lock before
  -- the cash-session row and the financial-operation ledger.
  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);

    if p_operation_type = 'sale.split' then
      v_restaurant_order_id := nullif(btrim(v_execution->>'parent_order_id'), '');
      v_restaurant_version := nullif(btrim(v_canonical->>'parent_order_version'), '');
    else
      v_restaurant_order_id := coalesce(
        nullif(btrim(v_execution->'sale'->>'id'), ''),
        nullif(btrim(v_execution->'sale'->>'cloud_sale_id'), ''),
        nullif(btrim(v_execution->'sale'->>'cloudSaleId'), '')
      );
      if exists (
        select 1 from public.pos_restaurant_orders o
        where o.license_id = v_license_id
          and o.local_order_id = coalesce(
            nullif(btrim(v_execution->'sale'->>'local_sale_id'), ''),
            nullif(btrim(v_execution->'sale'->>'localSaleId'), '')
          )
          and o.local_order_id is distinct from v_restaurant_order_id
      ) then
        raise exception 'RESTAURANT_ORDER_CONTEXT_MISMATCH' using errcode = 'P0001';
      end if;
      v_restaurant_context_supplied := p_request ? 'restaurant_settlement';
      if v_restaurant_context_supplied then
        if v_restaurant_order_id is distinct from nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_id}'), '') then
          raise exception 'RESTAURANT_ORDER_CONTEXT_MISMATCH' using errcode = 'P0001';
        end if;
        v_restaurant_version := nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_version}'), '');
      end if;
    end if;

    if v_restaurant_order_id is not null then
      select exists (
        select 1 from public.pos_restaurant_orders o
         where o.license_id = v_license_id
           and o.local_order_id = v_restaurant_order_id
      ) into v_restaurant_row_exists;

      if p_operation_type = 'sale.split' or v_restaurant_context_supplied or v_restaurant_row_exists then
        v_restaurant_order := private.lock_restaurant_order_settlement_v1(v_license_id, v_restaurant_order_id);
        if v_restaurant_order.id is null then
          raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
        end if;
        v_is_restaurant_settlement := true;
      end if;
    elsif p_operation_type = 'sale.split' or v_restaurant_context_supplied then
      raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
    if p_operation_type = 'layaway.payment' then
      v_requires_cash := true;
    elsif p_operation_type = 'layaway.create' then
      v_payment_payload := private.layaway_payment_payload_v1(p_request);
      v_requires_cash := coalesce(private.layaway_request_numeric_v1(v_payment_payload, array['amount', 'total'], 0), 0) > 0;
    else
      v_layaway_id := private.layaway_request_id_v1(p_request);
      v_requires_cash := not private.layaway_request_bool_v1(p_request, array['retain_money', 'retainMoney', 'retained_money'])
        and exists (
          select 1 from public.pos_layaways l
           where l.license_id = v_license_id and l.id = v_layaway_id and l.paid_amount > 0
        );
    end if;

    if v_requires_cash and v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_cash_session_id is not null then
      select s.cash_station_id into v_session_station_id
        from public.pos_cash_sessions s
       where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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
      if (select actor_key from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) is distinct from v_actor_key then
        raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation_type in ('cash.open', 'sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_canonical := private.canonical_layaway_request_v1(p_operation_type, p_request);
    v_execution := private.layaway_execution_request_v1(p_request);
  else
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);
  end if;

  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );
  if v_operation.status = 'completed' then
    return private.public_financial_response_v1(
      p_operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    );
  end if;
  -- Completed K/H receipt recovery already returned above, after origin/hash checks.
  -- The cash-session row was locked earlier; new layaway effects still need it open.
  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel')
     and v_cash_session_id is not null
     and (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  -- Completed K/H retries returned above. Validate new attempts before sale effects.
  if v_is_restaurant_settlement then
    if v_restaurant_order.deleted_at is not null or v_restaurant_order.archived_at is not null or v_restaurant_order.checkout_closed_at is not null then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_order.status = 'cancelled' or v_restaurant_order.cancelled_at is not null then
      raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) = 'paid' then
      raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) <> 'unpaid'
       or v_restaurant_order.status not in ('pending', 'preparing', 'ready', 'delivered')
       or v_restaurant_order.fulfillment_status not in ('pending', 'preparing', 'ready', 'delivered') then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_version is not null then
      begin
        v_restaurant_version_at := v_restaurant_version::timestamptz;
      exception
        when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
          raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end;
      if v_restaurant_order.updated_at is distinct from v_restaurant_version_at then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end if;
    end if;

    if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
      begin
        v_sale_total := nullif(v_canonical #>> '{sale,total}', '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end;
      if v_sale_total is null or round(v_sale_total, 2) <> round(coalesce(v_restaurant_order.total, 0), 2) then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- A legacy normal checkout may have committed its sale before the separate
  -- restaurant close. A new key must never settle that parent again.
  if v_is_restaurant_settlement and exists (
    select 1 from public.pos_sales s
    where s.license_id = v_license_id
      and (s.id = v_restaurant_order_id or s.local_sale_id = v_restaurant_order_id)
  ) then
    raise exception 'RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric,
        v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source', 'reference_type', v_execution->>'reference_type',
          'reference_id', v_execution->>'reference_id'
        ))
      );
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric,
        v_execution->>'reason', (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.close' then
      v_response := public.pos_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode',
        (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments',
        (v_execution->>'expected_version')::integer, v_internal_idempotency_key
      );
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key
      );
    when 'sale.split' then
      v_response := private.execute_split_sale_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'sale.layaway_complete' then
      v_response := private.execute_layaway_completion_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, p_idempotency_key
      );
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key
      );
    when 'layaway.create' then
      v_response := private.execute_layaway_create_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.payment' then
      v_response := private.execute_layaway_payment_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.cancel' then
      v_response := private.execute_layaway_cancel_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;

  if v_is_restaurant_settlement and p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
    if coalesce((v_response->>'success')::boolean, false) is not true then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_NOT_CONFIRMED:%',
        coalesce(v_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_restaurant_paid_sale_id := nullif(btrim(coalesce(v_response->'sale'->>'id', v_response->'sale'->>'cloud_sale_id', v_response->'sale'->>'cloudSaleId')), '');
    v_restaurant_paid_folio := nullif(btrim(coalesce(v_response->'sale'->>'pos_folio', v_response->'sale'->>'folio')), '');
    if v_restaurant_paid_sale_id is null then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_RESPONSE_INVALID' using errcode = 'P0001';
    end if;
    v_restaurant_payment_summary := jsonb_build_object('source', 'restaurant_normal_checkout', 'operation_type', p_operation_type, 'payment_method', v_canonical #>> '{sale,payment_method}', 'total', round(v_sale_total, 2), 'sourceMode', 'cloud_committed');
    v_restaurant_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      v_restaurant_order_id, v_restaurant_paid_sale_id, v_restaurant_paid_folio,
      round(v_sale_total, 2), v_restaurant_payment_summary, v_internal_idempotency_key || ':restaurant-close'
    );
    if coalesce((v_restaurant_close_response->>'success')::boolean, false) is not true or coalesce((v_restaurant_close_response->>'found')::boolean, false) is not true then
      raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_restaurant_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_response := v_response || jsonb_build_object('restaurant_settlement', jsonb_build_object('success', true, 'parent_order_id', v_restaurant_order_id, 'payment_status', 'paid', 'paid_sale_id', v_restaurant_paid_sale_id, 'paid_sale_folio', v_restaurant_paid_folio, 'total', round(v_sale_total, 2), 'status', v_restaurant_close_response #>> '{order,status}', 'fulfillment_status', v_restaurant_close_response #>> '{order,fulfillment_status}'));
  end if;

  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$


CREATE OR REPLACE FUNCTION private.pos_execute_financial_operation_core_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '45s'
 SET lock_timeout TO '20s'
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_canonical jsonb;
  v_execution jsonb;
  v_cash_station_id text;
  v_cash_session_id text;
  v_session_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
  v_requires_cash boolean := false;
  v_layaway_id text;
  v_payment_payload jsonb;
  v_rate_limit jsonb;
  v_restaurant_order_id text;
  v_restaurant_version text;
  v_restaurant_version_at timestamptz;
  v_restaurant_order public.pos_restaurant_orders;
  v_restaurant_row_exists boolean := false;
  v_restaurant_context_supplied boolean := false;
  v_is_restaurant_settlement boolean := false;
  v_sale_total numeric;
  v_restaurant_paid_sale_id text;
  v_restaurant_paid_folio text;
  v_restaurant_close_response jsonb;
  v_restaurant_payment_summary jsonb;
begin
  perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_request);
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key, p_device_fingerprint, p_staff_session_token,
      'pos_execute_financial_operation_v1.layaway', 'POS_WRITE',
      120, 600, 300, 'RPC_RATE_LIMITED',
      jsonb_build_object('operation_type', p_operation_type)
    );
    if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
      return public.build_pos_rpc_rate_limited_response(v_rate_limit);
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    perform private.assert_cloud_layaways_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'pos');
    if p_operation_type = 'layaway.cancel' then
      perform private.assert_pos_permission(v_context, 'refunds');
    end if;
  end if;

  -- Canonicalize first so restaurant settlement takes its shared lock before
  -- the cash-session row and the financial-operation ledger.
  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);

    if p_operation_type = 'sale.split' then
      v_restaurant_order_id := nullif(btrim(v_execution->>'parent_order_id'), '');
      v_restaurant_version := nullif(btrim(v_canonical->>'parent_order_version'), '');
    else
      v_restaurant_order_id := coalesce(
        nullif(btrim(v_execution->'sale'->>'id'), ''),
        nullif(btrim(v_execution->'sale'->>'cloud_sale_id'), ''),
        nullif(btrim(v_execution->'sale'->>'cloudSaleId'), '')
      );
      if exists (
        select 1 from public.pos_restaurant_orders o
        where o.license_id = v_license_id
          and o.local_order_id = coalesce(
            nullif(btrim(v_execution->'sale'->>'local_sale_id'), ''),
            nullif(btrim(v_execution->'sale'->>'localSaleId'), '')
          )
          and o.local_order_id is distinct from v_restaurant_order_id
      ) then
        raise exception 'RESTAURANT_ORDER_CONTEXT_MISMATCH' using errcode = 'P0001';
      end if;
      v_restaurant_context_supplied := p_request ? 'restaurant_settlement';
      if v_restaurant_context_supplied then
        if v_restaurant_order_id is distinct from nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_id}'), '') then
          raise exception 'RESTAURANT_ORDER_CONTEXT_MISMATCH' using errcode = 'P0001';
        end if;
        v_restaurant_version := nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_version}'), '');
      end if;
    end if;

    if v_restaurant_order_id is not null then
      select exists (
        select 1 from public.pos_restaurant_orders o
         where o.license_id = v_license_id
           and o.local_order_id = v_restaurant_order_id
      ) into v_restaurant_row_exists;

      if p_operation_type = 'sale.split' or v_restaurant_context_supplied or v_restaurant_row_exists then
        v_restaurant_order := private.lock_restaurant_order_settlement_v1(v_license_id, v_restaurant_order_id);
        if v_restaurant_order.id is null then
          raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
        end if;
        v_is_restaurant_settlement := true;
      end if;
    elsif p_operation_type = 'sale.split' or v_restaurant_context_supplied then
      raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
    if p_operation_type = 'layaway.payment' then
      v_requires_cash := true;
    elsif p_operation_type = 'layaway.create' then
      v_payment_payload := private.layaway_payment_payload_v1(p_request);
      v_requires_cash := coalesce(private.layaway_request_numeric_v1(v_payment_payload, array['amount', 'total'], 0), 0) > 0;
    else
      v_layaway_id := private.layaway_request_id_v1(p_request);
      v_requires_cash := not private.layaway_request_bool_v1(p_request, array['retain_money', 'retainMoney', 'retained_money'])
        and exists (
          select 1 from public.pos_layaways l
           where l.license_id = v_license_id and l.id = v_layaway_id and l.paid_amount > 0
        );
    end if;

    if v_requires_cash and v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_cash_session_id is not null then
      select s.cash_station_id into v_session_station_id
        from public.pos_cash_sessions s
       where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
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
      if (select actor_key from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) is distinct from v_actor_key then
        raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation_type in ('cash.open', 'sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_canonical := private.canonical_layaway_request_v1(p_operation_type, p_request);
    v_execution := private.layaway_execution_request_v1(p_request);
  else
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);
  end if;

  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );
  if v_operation.status = 'completed' then
    return private.public_financial_response_v1(
      p_operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    );
  end if;
  -- Completed K/H receipt recovery already returned above, after origin/hash checks.
  -- The cash-session row was locked earlier; new layaway effects still need it open.
  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel')
     and v_cash_session_id is not null
     and (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
    raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  -- Completed K/H retries returned above. Validate new attempts before sale effects.
  if v_is_restaurant_settlement then
    if v_restaurant_order.deleted_at is not null or v_restaurant_order.archived_at is not null or v_restaurant_order.checkout_closed_at is not null then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_order.status = 'cancelled' or v_restaurant_order.cancelled_at is not null then
      raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) = 'paid' then
      raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) <> 'unpaid'
       or v_restaurant_order.status not in ('pending', 'preparing', 'ready', 'delivered')
       or v_restaurant_order.fulfillment_status not in ('pending', 'preparing', 'ready', 'delivered') then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_version is not null then
      begin
        v_restaurant_version_at := v_restaurant_version::timestamptz;
      exception
        when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
          raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end;
      if v_restaurant_order.updated_at is distinct from v_restaurant_version_at then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end if;
    end if;

    if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
      begin
        v_sale_total := nullif(v_canonical #>> '{sale,total}', '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end;
      if v_sale_total is null or round(v_sale_total, 2) <> round(coalesce(v_restaurant_order.total, 0), 2) then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- A legacy normal checkout may have committed its sale before the separate
  -- restaurant close. A new key must never settle that parent again.
  if v_is_restaurant_settlement and exists (
    select 1 from public.pos_sales s
    where s.license_id = v_license_id
      and (s.id = v_restaurant_order_id or s.local_sale_id = v_restaurant_order_id)
  ) then
    raise exception 'RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric,
        v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source', 'reference_type', v_execution->>'reference_type',
          'reference_id', v_execution->>'reference_id'
        ))
      );
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric,
        v_execution->>'reason', (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.close' then
      v_response := public.pos_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode',
        (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments',
        (v_execution->>'expected_version')::integer, v_internal_idempotency_key
      );
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.credit' then
      v_response := private.pos_fin01_create_credit_rate_limited_v2(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key
      );
    when 'sale.split' then
      v_response := private.execute_split_sale_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'sale.layaway_complete' then
      v_response := private.execute_layaway_completion_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, p_idempotency_key
      );
    when 'sale.cancel' then
      v_response := private.pos_fin01_cancel_sale_rate_limited_v2(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key
      );
    when 'layaway.create' then
      v_response := private.execute_layaway_create_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.payment' then
      v_response := private.execute_layaway_payment_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.cancel' then
      v_response := private.execute_layaway_cancel_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;

  if v_is_restaurant_settlement and p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
    if coalesce((v_response->>'success')::boolean, false) is not true then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_NOT_CONFIRMED:%',
        coalesce(v_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_restaurant_paid_sale_id := nullif(btrim(coalesce(v_response->'sale'->>'id', v_response->'sale'->>'cloud_sale_id', v_response->'sale'->>'cloudSaleId')), '');
    v_restaurant_paid_folio := nullif(btrim(coalesce(v_response->'sale'->>'pos_folio', v_response->'sale'->>'folio')), '');
    if v_restaurant_paid_sale_id is null then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_RESPONSE_INVALID' using errcode = 'P0001';
    end if;
    v_restaurant_payment_summary := jsonb_build_object('source', 'restaurant_normal_checkout', 'operation_type', p_operation_type, 'payment_method', v_canonical #>> '{sale,payment_method}', 'total', round(v_sale_total, 2), 'sourceMode', 'cloud_committed');
    v_restaurant_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      v_restaurant_order_id, v_restaurant_paid_sale_id, v_restaurant_paid_folio,
      round(v_sale_total, 2), v_restaurant_payment_summary, v_internal_idempotency_key || ':restaurant-close'
    );
    if coalesce((v_restaurant_close_response->>'success')::boolean, false) is not true or coalesce((v_restaurant_close_response->>'found')::boolean, false) is not true then
      raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_restaurant_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_response := v_response || jsonb_build_object('restaurant_settlement', jsonb_build_object('success', true, 'parent_order_id', v_restaurant_order_id, 'payment_status', 'paid', 'paid_sale_id', v_restaurant_paid_sale_id, 'paid_sale_folio', v_restaurant_paid_folio, 'total', round(v_sale_total, 2), 'status', v_restaurant_close_response #>> '{order,status}', 'fulfillment_status', v_restaurant_close_response #>> '{order,fulfillment_status}'));
  end if;

  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$


CREATE OR REPLACE FUNCTION public.pos_get_financial_operation_receipt(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_operation public.pos_financial_operations;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  perform private.assert_financial_request_hash_v1(p_request_hash);
  -- Wait for an in-flight executor with this tenant/K to commit or roll back,
  -- then read a fresh statement snapshot.  A committed unresolved row is the
  -- only legitimate PROCESSING response; transient in-flight work is never
  -- misreported as a permanent NOT_FOUND.
  perform private.lock_financial_operation_v1(v_license_id, p_idempotency_key);
  select * into v_operation from public.pos_financial_operations o
  where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then return jsonb_build_object('status', 'NOT_FOUND'); end if;
  begin
    perform private.assert_financial_operation_origin_v1(v_operation, v_actor_key, v_device_id, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('status', 'NOT_FOUND');
  end;
  if v_operation.operation_type = 'layaway.cancel' then
    perform private.assert_pos_permission(v_context, 'pos');
    perform private.assert_pos_permission(v_context, 'refunds');
  end if;
  if v_operation.request_hash is distinct from p_request_hash then
    return jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  if v_operation.status = 'processing' then
    return jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
  end if;
  return jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', private.public_financial_response_v1(
      v_operation.operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    ));
end;
$function$


CREATE OR REPLACE FUNCTION public.pos_get_financial_operation_receipt_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_sync_contract jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_operation public.pos_financial_operations;
  v_payload jsonb;
  v_operation_identity jsonb;
  v_operation_status text := 'NOT_FOUND';
  v_origin_authorized boolean := false;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,true);
  if not (p_sync_contract->'capabilities' @> '["financial_operation_result_v1"]'::jsonb) then
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  perform private.assert_financial_request_hash_v1(p_request_hash);
  perform private.lock_financial_operation_v1(v_license_id, p_idempotency_key);
  select * into v_operation from public.pos_financial_operations o
   where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then
    v_payload := jsonb_build_object('status', 'NOT_FOUND');
  else
    begin
      perform private.assert_financial_operation_origin_v1(v_operation, v_actor_key, v_device_id, null);
      v_origin_authorized := true;
    exception when sqlstate 'P0001' then
      v_payload := jsonb_build_object('status', 'NOT_FOUND');
      v_origin_authorized := false;
    end;
    if v_payload is null then
      if v_operation.operation_type = 'layaway.cancel' then
        perform private.assert_pos_permission(v_context, 'pos');
        perform private.assert_pos_permission(v_context, 'refunds');
      end if;
      if v_operation.request_hash is distinct from p_request_hash then
        v_payload := jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
      elsif v_operation.status = 'processing' then
        v_payload := jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
      else
        v_payload := jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', v_operation.response_payload);
      end if;
    end if;
  end if;
  v_operation_status := coalesce(v_payload->>'status', 'NOT_FOUND');
  v_operation_identity := jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'request_hash', p_request_hash,
    'status', v_operation_status
  );
  if v_origin_authorized then
    v_operation_identity := v_operation_identity || jsonb_build_object(
      'operation_type', v_operation.operation_type,
      'operation_id', v_operation.id
    );
  end if;
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_get_financial_operation_receipt_v2', 'financial_operations', v_context,
    v_payload, null, null, v_operation_identity);
end;
$function$


COMMIT;
