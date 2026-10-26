-- 3D.14: prevent a legacy direct sale from settling a restaurant parent outside
-- the financial dispatcher, and reject historical sale-before-close orphans.
-- Forward-only patch. Review Production function hashes before selective apply.
begin;
do $guard$
declare
  v_function text;
  v_hash text;
begin
  for v_function, v_hash in
    select * from (values
      ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', '148918104b257982e3809a880bda7177'),
      ('public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '653ad817084920aa6adc1a60266ef37c'),
      ('public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '0c9dd22833c208dc20d78dd14bfd005d'),
      ('public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', '59977522691c4008711e4361bcb1e0bd')
    ) as expected(function_name, body_hash)
  loop
    -- The installed wrappers contain isolated CR characters in a comment.
    if md5(replace(pg_get_functiondef(to_regprocedure(v_function)), chr(13), '')) is distinct from v_hash then
      raise exception 'RESTAURANT_3D14_FUNCTION_DRIFT: %', v_function using errcode = 'P0001';
    end if;
  end loop;
end;
$guard$;

create or replace function private.assert_restaurant_sale_dispatcher_context_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_sale jsonb,
  p_cash_session_id text,
  p_internal_idempotency_key text,
  p_operation_type text
) returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_sale_id text := coalesce(
    nullif(btrim(p_sale->>'id'), ''), nullif(btrim(p_sale->>'cloud_sale_id'), ''),
    nullif(btrim(p_sale->>'cloudSaleId'), '')
  );
  v_local_sale_id text := coalesce(
    nullif(btrim(p_sale->>'local_sale_id'), ''), nullif(btrim(p_sale->>'localSaleId'), ''),
    nullif(btrim(p_sale->>'id'), ''), nullif(btrim(p_sale->>'cloud_sale_id'), ''),
    nullif(btrim(p_sale->>'cloudSaleId'), '')
  );
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_legacy_idempotency_key text;
  v_legacy_operation_type text;
begin
  if v_sale_id is null and v_local_sale_id is null then return; end if;
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if not exists (
    select 1 from public.pos_restaurant_orders r
    where r.license_id = v_license_id
      and r.local_order_id in (v_sale_id, v_local_sale_id)
  ) then return; end if;

  if not exists (
    select 1 from public.pos_financial_operations f
    where f.license_id = v_license_id
      and f.legacy_idempotency_key = p_internal_idempotency_key
      and f.operation_type = p_operation_type
      and f.status = 'processing'
      and f.canonical_request #>> '{sale,id}' = v_sale_id
      and f.verified_actor_key = private.resolve_cash_actor_key(v_context)
      and f.verified_device_id is not distinct from nullif(v_context->>'device_id', '')::uuid
      and f.verified_cash_session_id is not distinct from p_cash_session_id
  ) then
    v_legacy_operation_type := case
      when p_operation_type = 'sale.cashier_inventory'
        or (p_operation_type = 'sale.cashier'
          and coalesce((p_sale->'metadata'->>'cloudInventoryEffects')::boolean, false))
        then 'sales.cloud_commit.inventory'
      when p_operation_type = 'sale.cashier' then 'sales.cloud_commit'
      when p_operation_type = 'sale.credit' then 'sales.cloud_credit'
      else null
    end;
    v_legacy_idempotency_key := coalesce(
      nullif(btrim(p_internal_idempotency_key), ''),
      case v_legacy_operation_type
        when 'sales.cloud_commit.inventory' then 'sales.cloud_commit.inventory:' || v_local_sale_id || ':' || v_device_id::text
        when 'sales.cloud_commit' then 'sales.cloud_commit:' || v_local_sale_id || ':' || v_device_id::text
        when 'sales.cloud_credit' then 'sales.cloud_credit:' || v_local_sale_id || ':' || v_device_id::text
      end
    );

    -- Legacy R2B still owns canonical request hashing and receipt replay. Let
    -- only an exact, completed, actor/device/session-bound receipt reach it;
    -- changed payloads continue to fail with IDEMPOTENCY_CONFLICT there.
    if v_legacy_operation_type is null or v_legacy_idempotency_key is null or not exists (
      select 1
      from public.pos_idempotency_keys k
      join public.pos_sales s
        on s.license_id = k.license_id
       and s.id = k.entity_id
      join public.pos_restaurant_orders r
        on r.license_id = s.license_id
       and r.local_order_id in (s.id, s.local_sale_id)
      where k.license_id = v_license_id
        and k.idempotency_key = v_legacy_idempotency_key
        and k.operation_type = v_legacy_operation_type
        and k.entity_type = 'sale'
        and k.status = 'completed'
        and k.request_hash is not null
        and k.response_payload is not null
        and s.idempotency_key = k.idempotency_key
        and (v_sale_id is null or s.id = v_sale_id)
        and (coalesce(
              nullif(btrim(p_sale->>'local_sale_id'), ''),
              nullif(btrim(p_sale->>'localSaleId'), '')
            ) is null
          or s.local_sale_id = coalesce(
              nullif(btrim(p_sale->>'local_sale_id'), ''),
              nullif(btrim(p_sale->>'localSaleId'), '')
            ))
        and s.device_id is not distinct from v_device_id
        and s.actor_key is not distinct from v_actor_key
        and s.cash_session_id is not distinct from p_cash_session_id
    ) then
      raise exception 'RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
end;
$function$;
revoke all on function private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text) from public, anon, authenticated, service_role;




CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_create_cloud_sale_cashier',
          p_scope := 'POS_WRITE',
          p_max_attempts := 60,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;


-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before sale delegation.
        perform private.assert_cash_sale_station_for_request_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_cash_session_id
        );
        perform private.assert_restaurant_sale_dispatcher_context_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_sale, p_cash_session_id, p_idempotency_key, 'sale.cashier'
        );
        RETURN public.pos_create_cloud_sale_cashier_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9)::jsonb;
      END;
      $function$;




CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier_inventory(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_create_cloud_sale_cashier_inventory',
          p_scope := 'POS_WRITE',
          p_max_attempts := 60,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;


-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before sale delegation.
        perform private.assert_cash_sale_station_for_request_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_cash_session_id
        );
        perform private.assert_restaurant_sale_dispatcher_context_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_sale, p_cash_session_id, p_idempotency_key, 'sale.cashier_inventory'
        );
        RETURN public.pos_create_cloud_sale_cashier_inventory_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9)::jsonb;
      END;
      $function$;




CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_credit(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_cash_session_id text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_create_cloud_sale_credit',
          p_scope := 'POS_WRITE',
          p_max_attempts := 60,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;


-- CASH_MULTI_ADMIN_STATION_SERVER_GUARD_R1: validate before sale delegation.
        perform private.assert_cash_sale_station_for_request_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_cash_session_id
        );
        perform private.assert_restaurant_sale_dispatcher_context_v1(
          p_license_key, p_device_fingerprint, p_security_token,
          p_staff_session_token, p_sale, p_cash_session_id, p_idempotency_key, 'sale.credit'
        );
        RETURN public.pos_create_cloud_sale_credit_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)::jsonb;
      END;
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
      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
        raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
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


commit;
