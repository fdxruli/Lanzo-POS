-- Temporary PostgreSQL 17 test baseline, sourced by SELECT from Production catalog.
-- Loaded only in the disposable GitHub Actions PostgreSQL service.
SET check_function_bodies = off;

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
$function$;

CREATE OR REPLACE FUNCTION private.pos_fin01_cancel_sale_rate_limited_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale_id text, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_cancel_cloud_sale', 'POS_WRITE', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;
  return public.pos_cancel_cloud_sale_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_sale_id, p_reason, p_idempotency_key
  );
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_client_identity_v2(p_context jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'device_id', nullif(p_context->>'device_id', ''),
    'device_role', nullif(p_context->>'device_role', ''),
    'staff_user_id', nullif(p_context->>'staff_user_id', ''),
    'actor_type', case when nullif(p_context->>'staff_user_id', '') is not null then 'staff'
                       when jsonb_typeof(p_context->'admin_user') = 'object' then 'admin'
                       else 'device' end
  ));
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_create_credit_rate_limited_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb, p_cash_session_id text, p_customer_id text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_create_cloud_sale_credit', 'POS_WRITE', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;
  return public.pos_create_cloud_sale_credit_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_sale, p_items, p_payments, p_cash_session_id, p_customer_id, p_idempotency_key
  );
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_customer_ids_v2(p_payload jsonb)
 RETURNS TABLE(customer_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with recursive nodes(value, depth) as (
    select coalesce(p_payload, '{}'::jsonb), 0
    union all
    select child.value, node.depth + 1
      from nodes node
      cross join lateral (
        select object_child.value
          from jsonb_each(case when jsonb_typeof(node.value) = 'object' then node.value else '{}'::jsonb end) object_child
        union all
        select array_child.value
          from jsonb_array_elements(case when jsonb_typeof(node.value) = 'array' then node.value else '[]'::jsonb end) array_child
      ) child
     where node.depth < 32
  )
  select distinct node.value->>'id'
    from nodes node
   where jsonb_typeof(node.value) = 'object'
     and jsonb_typeof(node.value->'id') = 'string'
     and nullif(btrim(node.value->>'id'), '') is not null
     and nullif(btrim(node.value->>'name'), '') is not null
     and node.value ?| array['credit_limit', 'creditLimit'];
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_customer_projections_v2(p_license_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_customer_id text;
  v_customer public.pos_customers;
  v_pending_state text;
  v_entry_status text;
  v_status text;
  v_debt_cents integer;
  v_projection_version integer;
  v_source text;
  v_result jsonb := '[]'::jsonb;
begin
  for v_customer_id in
    select customer_id from private.pos_fin01_customer_ids_v2(p_payload)
     order by customer_id collate "C"
  loop
    v_customer := null;
    v_pending_state := null;
    v_entry_status := null;
    select c.* into v_customer
      from public.pos_customers c
     where c.license_id = p_license_id and c.id = v_customer_id;

    select a.state, entry_result.status
      into v_pending_state, v_entry_status
      from private.pos_historical_credit_authorizations a
      cross join lateral jsonb_array_elements(coalesce(a.manifest->'entries', '[]'::jsonb)) entry(value)
      left join lateral (
        select result.value->>'status' as status
          from jsonb_array_elements(coalesce(a.results, '[]'::jsonb)) result(value)
         where result.value->>'customer_id' = v_customer_id
         order by result.value->>'status'
         limit 1
      ) entry_result on true
     where a.license_id = p_license_id
       and entry.value->>'customer_id' = v_customer_id
       and a.state in ('PENDING', 'CONFLICT', 'PARTIALLY_CONSUMED')
       and coalesce(entry_result.status, '') not in ('IMPORTED', 'ALREADY_IMPORTED_IDENTICAL')
     order by case a.state when 'CONFLICT' then 0 when 'PARTIALLY_CONSUMED' then 1 else 2 end
     limit 1;

    v_debt_cents := null;
    v_projection_version := greatest(coalesce(v_customer.server_version, 1), 1);
    v_source := 'pos_customers.debt_cents';
    if v_pending_state = 'CONFLICT' or v_entry_status like 'CONFLICT%' then
      v_status := 'CONFLICT';
      v_source := 'historical_credit_manifest_conflict';
    elsif v_pending_state is not null then
      v_status := 'HISTORICAL_PENDING';
      v_source := 'historical_credit_manifest_pending';
    elsif v_customer.id is null then
      v_status := 'CONFLICT';
      v_source := 'pos_customers.missing';
    elsif v_customer.debt_cents = 0 and v_customer.debt = 0 then
      v_status := 'KNOWN_ZERO';
      v_debt_cents := 0;
    elsif v_customer.debt_cents between 1 and 2147483647
       and v_customer.debt = v_customer.debt_cents::numeric / 100 then
      v_status := 'KNOWN_POSITIVE';
      v_debt_cents := v_customer.debt_cents;
    else
      v_status := 'CONFLICT';
      v_source := 'pos_customers.debt_cents_mismatch';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'customer_id', v_customer_id,
      'status', v_status,
      'debt_cents', v_debt_cents,
      'source', v_source,
      'projection_version', v_projection_version
    ));
  end loop;
  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_enter_pilot_v2(p_sync_contract jsonb, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_receipt_only boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_context jsonb; v_license_id uuid; v_policy private.pos_fin01_qa_pilots_v2;
begin
  perform private.pos_fin01_validate_sync_contract_v2(p_sync_contract);
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_license_id:=(v_context->>'license_id')::uuid;
  perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id for share;
  if coalesce(v_policy.protocol,1)<>2 then
    if p_receipt_only and v_policy.activated_at is not null then return; end if;
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode='P0001',detail='QA_PILOT_NOT_ENABLED';
  end if;
  -- Only private, authenticated entry code can create this call-scoped witness.
  -- No request parameter, claimed capability or PostgreSQL setting grants it.
  insert into private.pos_fin01_admissions_v2(transaction_id,license_id,depth)
    values(pg_current_xact_id(),v_license_id,1)
    on conflict(transaction_id,license_id) do update set depth=private.pos_fin01_admissions_v2.depth+1;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_guard_qa_write_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_license_id uuid; v_ids uuid[];
begin
  v_ids:=case tg_op when 'INSERT' then array[new.license_id] when 'DELETE' then array[old.license_id]
    else array[old.license_id,new.license_id] end;
  for v_license_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
    perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
    if exists(select 1 from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id and protocol=2)
      and not exists(select 1 from private.pos_fin01_admissions_v2
        where transaction_id=pg_current_xact_id() and license_id=v_license_id and depth>0) then
      raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode='P0001',detail='QA_PILOT_REQUIRES_V2';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_leave_pilot_v2(p_license_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Every v2 return passes through the envelope. An exception rolls the entry
  -- witness back with its statement/subtransaction; successful calls remove it.
  delete from private.pos_fin01_admissions_v2 where transaction_id=pg_current_xact_id() and license_id=p_license_id and depth=1;
  update private.pos_fin01_admissions_v2 set depth=depth-1
    where transaction_id=pg_current_xact_id() and license_id=p_license_id;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_rate_limit_v2(p_license_key text, p_device_fingerprint text, p_staff_session_token text, p_rpc_name text, p_scope text, p_max_attempts integer, p_window_seconds integer, p_block_seconds integer, p_code text DEFAULT 'RPC_RATE_LIMITED'::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    p_rpc_name, p_scope, p_max_attempts, p_window_seconds,
    p_block_seconds, p_code, coalesce(p_metadata, '{}'::jsonb)
  );
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_register_new_tenant_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.pos_fin01_qa_pilots_v2(license_id,creation_xid) values(new.id,pg_current_xact_id());
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_set_clean_qa_protocol_v2(p_license_id uuid, p_protocol integer, p_expected_generation bigint, p_approval_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_policy private.pos_fin01_qa_pilots_v2;
begin
  -- Owner-only administrative SQL, never a public app RPC. The reference is
  -- audit evidence, not authority; EXECUTE and private-table ACLs are authority.
  if p_protocol is null or p_protocol not in (1,2) or nullif(btrim(p_approval_reference),'') is null then
    raise exception 'CLOUD_SYNC_QA_APPROVAL_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin01_qa_protocol:'||p_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=p_license_id for update;
  if not found then raise exception 'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED'; end if;
  if v_policy.generation is distinct from p_expected_generation then raise exception 'CLOUD_SYNC_QA_GENERATION_CONFLICT'; end if;
  if p_protocol=2 then
    if v_policy.creation_xid<>pg_current_xact_id() or v_policy.generation<>1 or v_policy.activated_at is not null then
      raise exception 'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED';
    end if;
    if exists(select 1 from public.license_devices where license_id=p_license_id)
      or exists(select 1 from public.pos_customers where license_id=p_license_id)
      or exists(select 1 from public.pos_customer_ledger where license_id=p_license_id)
      or exists(select 1 from public.pos_sales where license_id=p_license_id)
      or exists(select 1 from public.pos_sale_payments where license_id=p_license_id)
      or exists(select 1 from public.pos_cash_sessions where license_id=p_license_id)
      or exists(select 1 from public.pos_cash_movements where license_id=p_license_id)
      or exists(select 1 from public.pos_inventory_movements where license_id=p_license_id)
      or exists(select 1 from public.pos_financial_operations where license_id=p_license_id)
      or exists(select 1 from public.pos_idempotency_keys where license_id=p_license_id)
      or exists(select 1 from public.pos_sync_events where license_id=p_license_id)
      or exists(select 1 from private.pos_historical_credit_authorizations where license_id=p_license_id)
      or exists(select 1 from private.pos_historical_credit_receipts where license_id=p_license_id) then
      raise exception 'CLOUD_SYNC_QA_TENANT_NOT_EMPTY';
    end if;
  end if;
  update private.pos_fin01_qa_pilots_v2 set protocol=p_protocol,generation=generation+1,
    approval_reference=case when p_protocol=2 then p_approval_reference else approval_reference end,
    change_reference=p_approval_reference,
    activated_at=case when p_protocol=2 then now() else activated_at end,changed_at=now()
    where license_id=p_license_id returning * into v_policy;
  return jsonb_build_object('protocol',v_policy.protocol,'generation',v_policy.generation);
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_sync_envelope_v2(p_license_id uuid, p_endpoint text, p_family text, p_context jsonb, p_payload jsonb, p_customer_id text DEFAULT NULL::text, p_cursor jsonb DEFAULT NULL::jsonb, p_operation jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_envelope jsonb;
begin
  v_envelope := jsonb_build_object(
    'contract_version', 2,
    'tenant_id', p_license_id,
    'endpoint', p_endpoint,
    'family', p_family,
    'client_identity', private.pos_fin01_client_identity_v2(p_context),
    'payload', coalesce(p_payload, '{}'::jsonb),
    -- Financial payloads contain the immutable result, including historical
    -- customer amounts. Current debt is obtained through authorized credit pulls.
    'customer_projection_scope', case when p_family = 'financial_operations' then 'OPERATION_RESULT' else 'CURRENT' end,
    'customer_projections', case when p_family = 'financial_operations' then '[]'::jsonb
      else private.pos_fin01_customer_projections_v2(p_license_id, coalesce(p_payload, '{}'::jsonb)) end
  );
  if p_customer_id is not null then
    v_envelope := v_envelope || jsonb_build_object('customer_id', p_customer_id);
  end if;
  if p_cursor is not null then
    v_envelope := v_envelope || jsonb_build_object('cursor', p_cursor);
  end if;
  if p_operation is not null then
    v_envelope := v_envelope || jsonb_build_object('operation', p_operation);
  end if;
  perform private.pos_fin01_leave_pilot_v2(p_license_id);
  return v_envelope;
end;
$function$;


CREATE OR REPLACE FUNCTION private.pos_fin01_validate_sync_contract_v2(p_sync_contract jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if jsonb_typeof(p_sync_contract) is distinct from 'object' then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if (p_sync_contract - array['contract_version', 'capabilities']) <> '{}'::jsonb
     or p_sync_contract->>'contract_version' is distinct from '2'
     or jsonb_typeof(p_sync_contract->'capabilities') is distinct from 'array' then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if not (p_sync_contract->'capabilities' @> '["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]'::jsonb)
     or exists (
       select 1 from jsonb_array_elements(p_sync_contract->'capabilities') as capability(value)
        where jsonb_typeof(capability.value) is distinct from 'string'
     ) then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  -- Capabilities describe client support only; all authority is checked by the
  -- existing license, device, session, actor, role, and permission validators.
end;
$function$;


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
$function$;


CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb, p_sync_contract jsonb DEFAULT NULL::jsonb)
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
  v_payload jsonb;
  v_operation public.pos_financial_operations;
  v_customer_id text;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  if not (p_sync_contract->'capabilities' @> '["financial_operation_result_v1"]'::jsonb) then
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_payload := private.pos_execute_financial_operation_core_v2(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_idempotency_key, p_request_hash, p_operation_type, coalesce(p_request, '{}'::jsonb)
  );
  select o.* into v_operation
    from public.pos_financial_operations o
   where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  v_customer_id := nullif(btrim(coalesce(p_request->>'customer_id', p_request #>> '{sale,customer_id}', p_request #>> '{sale,customerId}')), '');
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_execute_financial_operation_v2', 'financial_operations', v_context,
    v_payload, v_customer_id, null,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'request_hash', p_request_hash,
      'operation_type', coalesce(v_operation.operation_type, p_operation_type),
      'status', coalesce(v_operation.status, 'unknown'), 'operation_id', v_operation.id));
end;
$function$;


CREATE OR REPLACE FUNCTION public.pos_fin01_sync_contract_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_requested_contract integer DEFAULT 2, p_capabilities text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_policy private.pos_fin01_qa_pilots_v2;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_fin01_sync_contract_v1', 'SYNC_PULL', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    raise exception 'RPC_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_requested_contract is distinct from 2 then
    return jsonb_build_object(
      'contract_version', 2,
      'server_status', 'UPDATE_REQUIRED',
      'tenant_id', v_license_id,
      'requested_contract', p_requested_contract,
      'required_contract', 2
    );
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id for share;
  if coalesce(v_policy.protocol,1)<>2 then
    if v_policy.activated_at is null then
      return jsonb_build_object('contract_version',2,'server_status','UPDATE_REQUIRED',
        'tenant_id',v_license_id,'active_protocol',1,'reason','QA_PILOT_NOT_ENABLED');
    end if;
    -- A stopped QA pilot may still recover its immutable receipts, but cannot
    -- negotiate directory/payment/execute endpoints. No new write admission.
    return jsonb_build_object('contract_version',2,'server_status','SUPPORTED',
      'tenant_id',v_license_id,'active_protocol',1,'mode','RECOVERY_ONLY',
      'capabilities',jsonb_build_array('historical_credit_preservation_v1','customer_projection_safe_apply_v1','financial_operation_result_v1'),
      'endpoint_families',jsonb_build_array('financial_operations'),
      'endpoints',jsonb_build_array('pos_get_financial_operation_receipt_v2'));
  end if;
  return jsonb_build_object(
    'contract_version', 2,
    'server_status', 'SUPPORTED',
    'tenant_id', v_license_id,
    'capabilities', jsonb_build_array('historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'financial_operation_result_v1'),
    'endpoint_families', jsonb_build_array('customer_directory', 'customer_credit', 'financial_operations'),
    'endpoints', jsonb_build_array(
      'pos_upsert_customer_v2', 'pos_delete_customer_v2', 'pos_migrate_local_customers_v2',
      'pos_pull_customers_snapshot_v2', 'pos_pull_customer_changes_v2',
      'pos_get_customer_credit_summary_v2', 'pos_pull_customer_credit_snapshot_v2',
      'pos_pull_customer_credit_changes_v2', 'pos_record_customer_payment_v2',
      'pos_execute_financial_operation_v2', 'pos_get_financial_operation_receipt_v2'
    )
  );
end;
$function$;


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
$function$;


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
$function$;

-- Match the read-only Production catalog ACLs for the four guarded functions.
REVOKE ALL ON FUNCTION public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_get_financial_operation_receipt(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_get_financial_operation_receipt(text,text,text,text,text,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_fin01_register_new_tenant_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_fin01_set_clean_qa_protocol_v2(uuid,integer,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_fin01_enter_pilot_v2(jsonb,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_fin01_leave_pilot_v2(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pos_fin01_guard_qa_write_v2() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION private.enter_restaurant_financial_transition_write_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_request jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; ids text[];
begin
  -- Admission is transaction-scoped and must precede all business locks. This
  -- bridge intentionally does not lock parents from raw aliases: the canonical
  -- dispatcher resolves one coherent parent and locks it before Caja/ledger.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  ids:=array[p_request->>'parent_order_id',p_request->>'parentOrderId',
    p_request#>>'{restaurant_settlement,parent_order_id}',p_request#>>'{restaurant_settlement,parentOrderId}',
    p_request#>>'{sale,id}',p_request#>>'{sale,local_sale_id}',p_request#>>'{sale,localSaleId}',
    p_request#>>'{sale,cloud_sale_id}',p_request#>>'{sale,cloudSaleId}',
    p_request#>>'{sale,metadata,splitParentId}',p_request#>>'{sale,metadata,split_parent_id}',
    p_request#>>'{sale,metadata,restaurant,parentOrderId}',p_request#>>'{sale,metadata,restaurant,parent_order_id}'];
  -- The shared lock is held through COMMIT/ROLLBACK. While paused, inspect the
  -- raw aliases only to reject Restaurant writes; never acquire parent locks
  -- until the dispatcher has canonicalized and reconciled the full request.
  if not (select writes_paused from private.restaurant_cloud_contract_state where singleton) then return; end if;
  if exists(select 1 from public.pos_restaurant_orders where license_id=(c->>'license_id')::uuid
      and (local_order_id=any(ids) or id=any(ids)))
    or nullif(p_request->>'parent_order_id','') is not null
    or nullif(p_request->>'parentOrderId','') is not null
    or p_request ? 'restaurant_settlement' then
    raise exception 'RESTAURANT_CONTRACT_MAINTENANCE' using errcode='P0001';
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
