-- FIN-01 PAY-N01 release migration.
-- Static reviewed definitions below replace the lab-only pg_get_functiondef rewrite.
-- Existing functions are accepted only when their exact signatures, security
-- contracts, ACLs, and known behavior anchors match the reviewed source shape.
-- CREATE OR REPLACE preserves existing owners and ACLs; grants below establish
-- the documented ACL only when creating a missing function on a clean install.
-- No Production catalog access or function hash is embedded in this migration.

do $fin01_pay_n01_preflight$
declare
  v_unlimited oid := to_regprocedure('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)');
  v_wrapper oid := to_regprocedure('public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text)');
  v_source text;
  v_args text;
  v_acl text[];
begin
  if to_regprocedure('private.insert_pos_idempotency_processing(uuid,text,text,text,text,text)') is null then
    raise exception 'FIN01_PAY_N01_IDEMPOTENCY_HELPER_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.pos_idempotency_keys'::regclass
      and a.attname = 'request_hash' and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'FIN01_PAY_N01_REQUEST_HASH_COLUMN_MISSING';
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'FIN01_PAY_N01_SHA256_DEPENDENCY_MISSING';
  end if;

  if v_unlimited is not null then
    select p.prosrc, regexp_replace(pg_catalog.pg_get_function_arguments(p.oid), '\s+', '', 'g')
      into v_source, v_args
    from pg_catalog.pg_proc p where p.oid = v_unlimited;
    if (select prosecdef from pg_catalog.pg_proc where oid=v_unlimited) is not true
       or (select pg_catalog.pg_get_function_result(oid) from pg_catalog.pg_proc where oid=v_unlimited) <> 'jsonb'
       or not ('search_path=""' = any(coalesce((select proconfig from pg_catalog.pg_proc where oid=v_unlimited), array[]::text[]))) then
      raise exception 'FIN01_PAY_N01_UNLIMITED_SECURITY_OR_RESULT_DRIFT';
    end if;
    if v_args <> 'p_license_keytext,p_device_fingerprinttext,p_security_tokentext,p_staff_session_tokentextDEFAULTNULL::text,p_customer_idtextDEFAULTNULL::text,p_amountnumericDEFAULT0,p_payment_methodtextDEFAULT''efectivo''::text,p_cash_session_idtextDEFAULTNULL::text,p_notetextDEFAULTNULL::text,p_allocationsjsonbDEFAULT''[]''::jsonb,p_idempotency_keytextDEFAULTNULL::text' then
      raise exception 'FIN01_PAY_N01_UNLIMITED_DEFAULT_ARGUMENT_DRIFT';
    end if;
    if length(v_source)-length(replace(v_source,'auto_initial_balance_before_payment','')) <> length('auto_initial_balance_before_payment')
       or position('PAYMENT_EXCEEDS_DEBT' in v_source)=0
       or position('CASH_SESSION_REQUIRED' in v_source)=0
       or position('CASH_SESSION_CLOSED' in v_source)=0
       or position('CASH_SESSION_NOT_OWNED_BY_ACTOR' in v_source)=0
       or position('private.validate_customer_payment_allocations' in v_source)=0
       or position('private.insert_pos_idempotency_processing' in v_source)=0 then
      raise exception 'FIN01_PAY_N01_UNLIMITED_BEHAVIOR_ANCHOR_DRIFT';
    end if;
    select array_agg(case when a.grantee=0 then 'PUBLIC' else r.rolname end || ':' || a.privilege_type || ':' || a.is_grantable order by case when a.grantee=0 then 'PUBLIC' else r.rolname end)
      into v_acl
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid=v_unlimited and a.grantee<>p.proowner;
    if coalesce(v_acl,array[]::text[]) is distinct from array['service_role:EXECUTE:false']::text[] then
      raise exception 'FIN01_PAY_N01_UNLIMITED_ACL_DRIFT';
    end if;
  end if;

  if v_wrapper is not null then
    select p.prosrc, regexp_replace(pg_catalog.pg_get_function_arguments(p.oid), '\s+', '', 'g')
      into v_source, v_args from pg_catalog.pg_proc p where p.oid=v_wrapper;
    if not (select prosecdef from pg_catalog.pg_proc where oid=v_wrapper)
       or (select pg_catalog.pg_get_function_result(oid) from pg_catalog.pg_proc where oid=v_wrapper) <> 'jsonb'
       or not ('search_path=""' = any(coalesce((select proconfig from pg_catalog.pg_proc where oid=v_wrapper), array[]::text[]))) then
      raise exception 'FIN01_PAY_N01_WRAPPER_SECURITY_OR_RESULT_DRIFT';
    end if;
    if v_args <> 'p_license_keytext,p_device_fingerprinttext,p_security_tokentext,p_staff_session_tokentextDEFAULTNULL::text,p_customer_idtextDEFAULTNULL::text,p_amountnumericDEFAULT0,p_payment_methodtextDEFAULT''efectivo''::text,p_cash_session_idtextDEFAULTNULL::text,p_notetextDEFAULTNULL::text,p_allocationsjsonbDEFAULT''[]''::jsonb,p_idempotency_keytextDEFAULTNULL::text' then
      raise exception 'FIN01_PAY_N01_WRAPPER_DEFAULT_ARGUMENT_DRIFT';
    end if;
    if position('enforce_pos_rpc_rate_limit_v2' in v_source)=0
       or position('build_pos_rpc_rate_limited_response' in v_source)=0
       or position('pos_record_customer_payment_unlimited' in v_source)=0 then
      raise exception 'FIN01_PAY_N01_WRAPPER_BEHAVIOR_ANCHOR_DRIFT';
    end if;
    select array_agg(case when a.grantee=0 then 'PUBLIC' else r.rolname end || ':' || a.privilege_type || ':' || a.is_grantable order by case when a.grantee=0 then 'PUBLIC' else r.rolname end)
      into v_acl
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid=v_wrapper and a.grantee<>p.proowner;
    if coalesce(v_acl,array[]::text[]) is distinct from array['anon:EXECUTE:false','authenticated:EXECUTE:false','service_role:EXECUTE:false']::text[] then
      raise exception 'FIN01_PAY_N01_WRAPPER_ACL_DRIFT';
    end if;
  end if;
end;
$fin01_pay_n01_preflight$;

CREATE OR REPLACE FUNCTION public.pos_record_customer_payment_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'efectivo'::text, p_cash_session_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_customer public.pos_customers;
  v_customer_after public.pos_customers;
  v_session public.pos_cash_sessions;
  v_movement public.pos_cash_movements;
  v_ledger public.pos_customer_ledger;
  v_initial_ledger public.pos_customer_ledger;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
  v_amount numeric := coalesce(p_amount, 0);
  v_payment_method text := lower(nullif(btrim(coalesce(p_payment_method, 'efectivo')), ''));
  v_is_cash boolean;
  v_current_debt numeric := 0;
  v_new_debt numeric := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_initial_exists boolean := false;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_is_cash := v_payment_method in ('efectivo', 'cash');

  if p_customer_id is null or btrim(p_customer_id) = '' then
    raise exception 'CUSTOMER_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_amount <= 0 then
    raise exception 'CUSTOMER_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_method is null then
    v_payment_method := 'efectivo';
    v_is_cash := true;
  end if;
  if v_is_cash then
    perform private.assert_cash_permission(v_context);
  end if;

  v_request_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'customer_id', p_customer_id,
          'amount', trim_scale(v_amount)::text,
          'payment_method', v_payment_method,
          'cash_session_id', nullif(btrim(p_cash_session_id), ''),
          'note', nullif(btrim(coalesce(p_note, '')), ''),
          'allocations', coalesce(p_allocations, '[]'::jsonb),
          'device_id', v_device_id,
          'staff_user_id', v_staff_user_id,
          'actor_key', v_actor_key
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  begin
    v_inserted_idem := private.insert_pos_idempotency_processing(
      v_license_id,
      p_idempotency_key,
      'customer_credit.payment',
      'customer_ledger',
      null,
      v_request_hash
    );
  exception when sqlstate 'P0001' then
    if sqlerrm = 'IDEMPOTENCY_CONFLICT' then
      return jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'La clave de idempotencia ya fue usada con otros datos.',
        'idempotency_key', p_idempotency_key
      );
    end if;
    raise;
  end;

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.request_hash is not null and v_idem.request_hash is distinct from v_request_hash then
      return jsonb_build_object(
        'success', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'La clave de idempotencia ya fue usada con otros datos.',
        'idempotency_key', p_idempotency_key
      );
    end if;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El abono ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  if v_is_cash then
    if p_cash_session_id is null or btrim(p_cash_session_id) = '' then
      select * into v_session
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.actor_key = v_actor_key
        and s.status = 'open'
        and s.deleted_at is null
      order by s.opened_at desc
      limit 1
      for update;
    else
      select * into v_session
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.id = p_cash_session_id
        and s.deleted_at is null
      for update;
    end if;
  end if;

  select * into v_customer
  from public.pos_customers c
  where c.license_id = v_license_id
    and c.id = p_customer_id
  for update;

  if v_customer.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'CUSTOMER_NOT_FOUND', 'message', 'Cliente no encontrado.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_customer.deleted_at is not null then
    v_response := jsonb_build_object('success', false, 'code', 'CUSTOMER_DELETED', 'message', 'El cliente fue eliminado.', 'customer', private.pos_customer_to_jsonb(v_customer), 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  select coalesce(sum(l.amount), 0)
  into v_current_debt
  from public.pos_customer_ledger l
  where l.license_id = v_license_id
    and l.customer_id = p_customer_id
    and l.deleted_at is null;

  if v_current_debt <= 0 then
    v_current_debt := coalesce(v_customer.debt, 0);
  end if;

  if v_amount > v_current_debt then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'PAYMENT_EXCEEDS_DEBT',
      'message', 'El abono excede la deuda actual.',
      'current_debt', v_current_debt,
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_cash then
    if v_session.id is null then
      v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_REQUIRED', 'message', 'Debes abrir tu caja antes de registrar abonos.', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if v_session.status <> 'open' then
      v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_CLOSED', 'message', 'La caja ya no esta abierta.', 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if v_session.actor_key <> v_actor_key then
      v_response := jsonb_build_object('success', false, 'code', 'CASH_SESSION_NOT_OWNED_BY_ACTOR', 'message', 'El abono debe registrarse en la caja del actor actual.', 'cash_session', private.pos_cash_session_to_jsonb(v_session), 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  v_allocations := private.validate_customer_payment_allocations(coalesce(p_allocations, '[]'::jsonb), v_amount);

  select exists(
    select 1 from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.customer_id = p_customer_id
      and l.deleted_at is null
  ) into v_initial_exists;

  if not v_initial_exists and coalesce(v_customer.debt, 0) > 0 then
    insert into public.pos_customer_ledger (
      id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
      payment_method, note, reference_type, reference_id, actor_device_id,
      actor_staff_user_id, actor_name, idempotency_key, metadata
    ) values (
      'ldg_' || replace(gen_random_uuid()::text, '-', ''),
      v_license_id,
      p_customer_id,
      'INITIAL_BALANCE',
      v_customer.debt,
      v_customer.debt,
      round(v_customer.debt * 100)::integer,
      null,
      'Saldo inicial creado automaticamente al primer abono cloud.',
      'customer',
      p_customer_id,
      v_device_id,
      v_staff_user_id,
      v_actor_name,
      'customer_credit.initial_balance:auto:' || p_customer_id,
      jsonb_build_object('source', 'auto_initial_balance_before_payment')
    )
    on conflict (license_id, idempotency_key) where idempotency_key is not null do nothing
    returning * into v_initial_ledger;

    if v_initial_ledger.id is not null then
      perform private.record_pos_customer_credit_event(
        v_license_id,
        'customer_ledger',
        v_initial_ledger.id,
        'initial_balance',
        v_device_id,
        v_staff_user_id,
        v_initial_ledger.idempotency_key,
        jsonb_build_object('customer_id', p_customer_id),
        v_initial_ledger.server_version
      );
    end if;
  end if;

  v_new_debt := v_current_debt - v_amount;

  insert into public.pos_customer_ledger (
    id, license_id, customer_id, type, amount, balance_after, debt_cents_after,
    payment_method, note, cash_session_id, reference_type, reference_id, sale_id,
    allocation_payload, actor_device_id, actor_staff_user_id, actor_name,
    idempotency_key, metadata
  ) values (
    'ldg_' || replace(gen_random_uuid()::text, '-', ''),
    v_license_id,
    p_customer_id,
    'PAYMENT',
    -v_amount,
    v_new_debt,
    round(v_new_debt * 100)::integer,
    v_payment_method,
    nullif(btrim(coalesce(p_note, '')), ''),
    case when v_is_cash then v_session.id else null end,
    'customer',
    p_customer_id,
    null,
    v_allocations,
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_record_customer_payment')
  ) returning * into v_ledger;

  v_customer_after := private.recalculate_pos_customer_debt(v_license_id, p_customer_id);

  if v_is_cash then
    insert into public.pos_cash_movements (
      id, license_id, cash_session_id, device_id, staff_user_id, actor_key,
      type, amount, concept, source, reference_type, reference_id,
      created_by_device_id, created_by_staff_user_id, actor_name, idempotency_key, metadata
    ) values (
      'mov_' || replace(gen_random_uuid()::text, '-', ''),
      v_license_id,
      v_session.id,
      v_session.device_id,
      v_session.staff_user_id,
      v_session.actor_key,
      'abono_cliente',
      v_amount,
      'Abono de cliente: ' || v_customer.name,
      'customer_payment',
      'customer_ledger',
      v_ledger.id,
      v_device_id,
      v_staff_user_id,
      v_actor_name,
      p_idempotency_key,
      jsonb_build_object('customer_id', p_customer_id, 'customer_name', v_customer.name, 'ledger_id', v_ledger.id)
    ) returning * into v_movement;

    update public.pos_customer_ledger
    set cash_movement_id = v_movement.id
    where license_id = v_license_id and id = v_ledger.id
    returning * into v_ledger;

    update public.pos_cash_sessions s
    set customer_payments_total = coalesce(s.customer_payments_total, 0) + v_amount,
        updated_at = now(),
        server_version = s.server_version + 1
    where s.license_id = v_license_id and s.id = v_session.id
    returning * into v_session;

    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
  end if;

  v_event := private.record_pos_customer_credit_event(
    v_license_id,
    'customer_ledger',
    v_ledger.id,
    'payment',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'cash_session_id', v_session.id),
    v_ledger.server_version
  );

  perform private.record_pos_customer_credit_event(
    v_license_id,
    'customer',
    p_customer_id,
    'credit_update',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'reason', 'customer_payment'),
    v_customer_after.server_version
  );

  if v_movement.id is not null then
    perform private.record_pos_customer_credit_event(
      v_license_id,
      'cash_movement',
      v_movement.id,
      'customer_payment',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key, 'movement_type', 'abono_cliente'),
      v_movement.server_version
    );

    perform private.record_pos_customer_credit_event(
      v_license_id,
      'cash_session',
      v_session.id,
      'update',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('cash_session_id', v_session.id, 'reason', 'customer_payment'),
      v_session.server_version
    );
  end if;

  v_response := jsonb_build_object(
    'success', true,
    'customer', private.pos_customer_to_jsonb(v_customer_after),
    'ledger_entry', private.pos_customer_ledger_to_jsonb(v_ledger),
    'cash_movement', case when v_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_movement) end,
    'cash_session', case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
    'new_debt', v_customer_after.debt,
    'change_seq', v_event.change_seq,
    'receipt', jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', v_customer.name,
      'amount', v_amount,
      'previous_debt', v_current_debt,
      'new_debt', v_customer_after.debt,
      'payment_method', v_payment_method,
      'cash_session_id', v_session.id,
      'ledger_id', v_ledger.id,
      'created_at', v_ledger.created_at,
      'actor_name', v_actor_name
    ),
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pos_record_customer_payment(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text, p_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'efectivo'::text, p_cash_session_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
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
          p_rpc_name := 'pos_record_customer_payment',
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

        RETURN public.pos_record_customer_payment_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)::jsonb;
      END;
      $function$;


-- Keep the externally callable wrapper limited to its rate-limited public
-- contract. The unlimited implementation remains service_role-only.
revoke all on function public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text) to anon, authenticated, service_role;
revoke all on function public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text) to service_role;

do $fin01_pay_n01_postflight$
declare
  v_unlimited oid := to_regprocedure('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)');
  v_wrapper oid := to_regprocedure('public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text)');
  v_acl text[];
begin
  if v_unlimited is null or v_wrapper is null then raise exception 'FIN01_PAY_N01_FUNCTION_INSTALL_FAILED'; end if;
  if not (select prosecdef and pg_catalog.pg_get_function_result(oid)='jsonb' and 'search_path=""'=any(coalesce(proconfig,array[]::text[])) from pg_catalog.pg_proc where oid=v_unlimited)
     or not (select prosecdef and pg_catalog.pg_get_function_result(oid)='jsonb' and 'search_path=""'=any(coalesce(proconfig,array[]::text[])) from pg_catalog.pg_proc where oid=v_wrapper) then
    raise exception 'FIN01_PAY_N01_POST_INSTALL_SECURITY_DRIFT';
  end if;
  select array_agg(case when a.grantee=0 then 'PUBLIC' else r.rolname end || ':' || a.privilege_type || ':' || a.is_grantable order by case when a.grantee=0 then 'PUBLIC' else r.rolname end)
    into v_acl from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=v_wrapper and a.grantee<>p.proowner;
  if coalesce(v_acl,array[]::text[]) is distinct from array['anon:EXECUTE:false','authenticated:EXECUTE:false','service_role:EXECUTE:false']::text[] then
    raise exception 'FIN01_PAY_N01_POST_INSTALL_WRAPPER_ACL_DRIFT';
  end if;
  select array_agg(case when a.grantee=0 then 'PUBLIC' else r.rolname end || ':' || a.privilege_type || ':' || a.is_grantable order by case when a.grantee=0 then 'PUBLIC' else r.rolname end)
    into v_acl from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=v_unlimited and a.grantee<>p.proowner;
  if coalesce(v_acl,array[]::text[]) is distinct from array['service_role:EXECUTE:false']::text[] then
    raise exception 'FIN01_PAY_N01_POST_INSTALL_UNLIMITED_ACL_DRIFT';
  end if;
end;
$fin01_pay_n01_postflight$;
