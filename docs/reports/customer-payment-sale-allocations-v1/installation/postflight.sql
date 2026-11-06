-- READ ONLY. Expected reviewed functions and exact canonical ledger entry.
with expected(signature,sha256,owner_name,definer,config,anon_exec,authenticated_exec,service_exec) as (values
('private.pos_sale_to_jsonb(pos_sales)','4f27ea03d31326b4c256b38f24f3f2dd1f555ea81e64db675c1dda7efb5aa43c','postgres',false,'["search_path=\"\""]'::jsonb,false,false,false),
('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)','d27598d86ea58a94cd1d86aa3e8e30a183fc760e7773d0da790a484a456388bd','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true),
('public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)','7fb8c9717949e8754c686bddfbbfb649908813cecdafcc0799cd95072419f260','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true),
('public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)','eca3d439715f9fd18cae4471ed61f036da8fe5c855bd541884630c2f8fb76b9f','postgres',true,'["search_path=\"\""]'::jsonb,false,false,true)
), checks as (
 select e.signature,p.oid is not null as present,
   encode(extensions.digest(convert_to(replace(pg_get_functiondef(p.oid),E'\r',''),'UTF8'),'sha256'),'hex')=e.sha256 as body_matches,
   pg_get_userbyid(p.proowner)=e.owner_name and p.prosecdef=e.definer and to_jsonb(p.proconfig)=e.config as attributes_match,
   has_function_privilege('anon',p.oid,'EXECUTE')=e.anon_exec
     and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.authenticated_exec
     and has_function_privilege('service_role',p.oid,'EXECUTE')=e.service_exec as permissions_match
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), ledger as (select count(*)=1 and bool_and(name='customer_payment_sale_allocations_v1' and statements=array[$canonical_20261106025114$-- CANDIDATE ONLY. No historical payment is rewritten or allocated.
-- balance_due and amount_paid remain the original checkout amounts.
-- New verified allocation_payload entries are the financial application itself;
-- the live balance is derived from them, never from browser-supplied balances.
begin;

do $guard$
declare v_signature text; v_expected text; v_actual text;
begin
  foreach v_signature in array array[
    'private.pos_sale_to_jsonb(public.pos_sales)',
    'public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)',
    'public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)',
    'public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'CUSTOMER_ALLOCATION_BASE_CONTRACT_MISSING: %', v_signature;
    end if;
  end loop;
  -- These definitions are captured in Git; fail closed on an unreviewed base.
  for v_signature, v_expected in select * from (values
    ('private.pos_sale_to_jsonb(public.pos_sales)', '6395afe3312283501b60a4cebb2d7f2425951843dc89b7007503259e133c2ce9'),
    ('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)', '73ce2f73f985eada337800b1ed18b9242c1f57948a23c48a57542f522ead8bf4'),
    ('public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)', '988743703fbf74423dc308871667582f3f4517f3e0ea2da9ca0099012da90320'),
    ('public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)', 'fd1278d820f6a0ea481534b2ffd7a411a94c54edcac4b46ce166eeb309c19745')
  ) expected(signature, sha256) loop
    select encode(extensions.digest(convert_to(replace(pg_get_functiondef(to_regprocedure(v_signature)), E'\r', ''), 'UTF8'), 'sha256'), 'hex') into v_actual;
    if v_actual is distinct from v_expected then
      raise exception 'CUSTOMER_ALLOCATION_BASE_CONTRACT_DRIFT: %', v_signature;
    end if;
  end loop;
end;
$guard$;

CREATE OR REPLACE FUNCTION private.pos_sale_to_jsonb(p_sale pos_sales)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_sale.id is null then null
    else jsonb_strip_nulls(
      to_jsonb(p_sale)
      ||
      case
        when p_sale.pos_folio is not null then '{}'::jsonb
        when lower(coalesce(p_sale.source_mode, '')) = 'cloud_committed'
             and lower(coalesce(p_sale.sales_channel, 'local')) <> 'ecommerce'
             and p_sale.folio_sequence is not null
        then jsonb_build_object(
          'pos_folio',
          private.format_pos_operational_folio_v1(p_sale.license_id, p_sale.folio_sequence)
        )
        else '{}'::jsonb
      end
    ) || case when p_sale.credit_effect_status = 'applied' then (
      select jsonb_build_object(
        'original_balance_due', p_sale.balance_due,
        'assigned_payments_total', coalesce((
          select sum((a->>'amount_applied')::numeric)
          from public.pos_customer_ledger l
          cross join lateral jsonb_array_elements(l.allocation_payload) a
          where l.license_id = p_sale.license_id and l.customer_id = p_sale.customer_id
            and l.deleted_at is null and l.type = 'PAYMENT' and l.amount < 0
            and l.metadata->>'sale_allocation_version' = '1'
            and a->>'sale_id' = p_sale.id
        ), 0),
        'credit_allocation_status', case when not base_valid then 'unreconciled_sale'
          when historical_unknown then 'historical_unallocated' else 'reconciled' end,
        'current_balance_due', case
          when p_sale.status = 'cancelled' or p_sale.cancelled_at is not null then 0
          when historical_unknown or not base_valid then null
          else greatest(p_sale.balance_due - coalesce((
            select sum((a->>'amount_applied')::numeric)
            from public.pos_customer_ledger l
            cross join lateral jsonb_array_elements(l.allocation_payload) a
            where l.license_id = p_sale.license_id and l.customer_id = p_sale.customer_id
              and l.deleted_at is null and l.type = 'PAYMENT' and l.amount < 0
              and l.metadata->>'sale_allocation_version' = '1'
              and a->>'sale_id' = p_sale.id
          ), 0), 0) end
      ) from (select exists (
        select 1 from public.pos_customer_ledger l
        where l.license_id = p_sale.license_id and l.customer_id = p_sale.customer_id
          and l.deleted_at is null and l.type = 'PAYMENT' and l.amount < 0
          and (l.sale_id is null or l.reference_type = 'customer')
          and (coalesce(l.metadata->>'sale_allocation_version', '') <> '1'
            or l.metadata->>'sale_allocation_status' = 'partial_unallocated')
      ) as historical_unknown,
      -- Validate the checkout base against its immutable ledger lineage too.
      p_sale.total::text not in ('NaN','Infinity','-Infinity')
      and p_sale.amount_paid::text not in ('NaN','Infinity','-Infinity')
      and p_sale.balance_due::text not in ('NaN','Infinity','-Infinity')
      and p_sale.balance_due = p_sale.total - p_sale.amount_paid and exists (
        select 1 from public.pos_customer_ledger l where l.license_id = p_sale.license_id
          and l.customer_id = p_sale.customer_id and l.sale_id = p_sale.id
          and l.id = p_sale.credit_ledger_charge_id and l.type = 'CHARGE'
          and l.amount = p_sale.total and l.deleted_at is null
      ) and (p_sale.amount_paid = 0 or exists (
        select 1 from public.pos_customer_ledger l where l.license_id = p_sale.license_id
          and l.customer_id = p_sale.customer_id and l.sale_id = p_sale.id
          and l.id = p_sale.credit_ledger_payment_id and l.type = 'PAYMENT'
          and l.amount = -p_sale.amount_paid and l.deleted_at is null
      )) as base_valid) h
    ) else '{}'::jsonb end
  end
$function$
;

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
  v_amount numeric := coalesce(p_amount, 0);
  v_payment_method text := lower(nullif(btrim(coalesce(p_payment_method, 'efectivo')), ''));
  v_is_cash boolean;
  v_current_debt numeric := 0;
  v_new_debt numeric := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_initial_exists boolean := false;
  v_sale public.pos_sales;
  v_sale_json jsonb;
  v_item jsonb;
  v_sale_id text;
  v_applied numeric;
  v_balance numeric;
  v_remaining numeric := v_amount;
  v_seen text[] := array[]::text[];
  v_historical_unknown boolean;
  v_changed_sales jsonb := '[]'::jsonb;
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
  if v_amount::text in ('NaN', 'Infinity', '-Infinity') or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'CUSTOMER_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  if v_payment_method is null then
    v_payment_method := 'efectivo';
    v_is_cash := true;
  end if;
  if v_is_cash then
    perform private.assert_cash_permission(v_context);
  end if;

  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    p_idempotency_key,
    'customer_credit.payment',
    'customer_ledger',
    null,
    null
  );

  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El abono ya esta en proceso.', 'idempotency_key', p_idempotency_key);
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

  select coalesce(sum(l.amount), 0)
  into v_current_debt
  from public.pos_customer_ledger l
  where l.license_id = v_license_id
    and l.customer_id = p_customer_id
    and l.deleted_at is null;

  if v_current_debt::text in ('NaN','Infinity','-Infinity') then
    raise exception 'CUSTOMER_DEBT_INVALID' using errcode = 'P0001';
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

  -- The customer row lock serializes payments with credit sales and cancellation.
  -- Do not lock sales in the opposite order to the existing cancellation core.
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'CUSTOMER_PAYMENT_ALLOCATIONS_INVALID' using errcode = 'P0001';
  end if;
  select exists (
    select 1 from public.pos_customer_ledger l
    where l.license_id = v_license_id and l.customer_id = p_customer_id
      and l.deleted_at is null and l.type = 'PAYMENT' and l.amount < 0
      and (l.sale_id is null or l.reference_type = 'customer')
      and (coalesce(l.metadata->>'sale_allocation_version', '') <> '1'
            or l.metadata->>'sale_allocation_status' = 'partial_unallocated')
  ) into v_historical_unknown;

  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    if v_historical_unknown then
      raise exception 'CUSTOMER_SALE_BALANCES_UNRECONCILED' using errcode = 'P0001';
    end if;
    for v_item in select value from jsonb_array_elements(p_allocations) loop
      v_sale_id := nullif(btrim(coalesce(v_item->>'sale_id', v_item->>'saleId')), '');
      v_applied := coalesce(v_item->>'amount_applied', v_item->>'amountApplied')::numeric;
      if v_sale_id is null or v_sale_id = any(v_seen) or v_applied is null
         or v_applied::text in ('NaN','Infinity','-Infinity') or v_applied <= 0
         or v_applied <> round(v_applied, 2) then
        raise exception 'CUSTOMER_PAYMENT_ALLOCATION_INVALID' using errcode = 'P0001';
      end if;
      v_seen := array_append(v_seen, v_sale_id);
      select * into v_sale from public.pos_sales s
      where s.license_id = v_license_id and s.customer_id = p_customer_id
        and s.id = v_sale_id and s.deleted_at is null and s.status = 'closed'
        and s.cancelled_at is null and s.source_mode = 'cloud_committed'
        and s.credit_effect_status = 'applied';
      if v_sale.id is null then
        raise exception 'CUSTOMER_PAYMENT_SALE_NOT_ELIGIBLE' using errcode = 'P0001';
      end if;
      v_sale_json := private.pos_sale_to_jsonb(v_sale);
      v_balance := (v_sale_json->>'current_balance_due')::numeric;
      if v_balance is null or v_balance::text in ('NaN','Infinity','-Infinity') or v_applied > v_balance then
        raise exception 'CUSTOMER_PAYMENT_ALLOCATION_EXCEEDS_SALE' using errcode = 'P0001';
      end if;
      v_remaining := v_remaining - v_applied;
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'sale_id', v_sale.id, 'amount_applied', v_applied,
        'previous_sale_balance', v_balance, 'new_sale_balance', v_balance - v_applied));
    end loop;
    if v_remaining < 0 then
      raise exception 'CUSTOMER_PAYMENT_ALLOCATIONS_EXCEED_AMOUNT' using errcode = 'P0001';
    end if;
  elsif not v_historical_unknown then
    -- FIFO matches Local's timestamp ordering, with a deterministic ID tie-break.
    for v_sale in select s.* from public.pos_sales s
      where s.license_id = v_license_id and s.customer_id = p_customer_id
        and s.deleted_at is null and s.status = 'closed' and s.cancelled_at is null
        and s.source_mode = 'cloud_committed' and s.credit_effect_status = 'applied'
        and s.balance_due > 0
      order by s.sold_at asc, s.id asc
    loop
      exit when v_remaining <= 0;
      v_sale_json := private.pos_sale_to_jsonb(v_sale);
      v_balance := (v_sale_json->>'current_balance_due')::numeric;
      if v_balance is null or v_balance::text in ('NaN','Infinity','-Infinity') then
        raise exception 'CUSTOMER_PAYMENT_SALE_BALANCE_INVALID' using errcode = 'P0001';
      end if;
      v_applied := least(v_remaining, v_balance);
      if v_applied > 0 then
        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
          'sale_id', v_sale.id, 'amount_applied', v_applied,
          'previous_sale_balance', v_balance, 'new_sale_balance', v_balance - v_applied));
        v_remaining := v_remaining - v_applied;
      end if;
    end loop;
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
    jsonb_build_object('source', 'pos_record_customer_payment', 'sale_allocation_version', 1,
      'unallocated_amount', v_remaining,
      'sale_allocation_status', case when v_historical_unknown then 'historical_unallocated'
        when v_remaining > 0 and jsonb_array_length(v_allocations) > 0 then 'partial_unallocated'
        when v_remaining > 0 then 'unallocated_balance' else 'applied' end)
  ) returning * into v_ledger;

  -- Publish changed sales through the existing sales snapshot/change machinery.
  -- Only projection version/timestamp change; no original money is overwritten.
  for v_item in
    select jsonb_build_object('sale_id', affected.id) from (
      select value->>'sale_id' as id from jsonb_array_elements(v_allocations)
      union
      select s.id from public.pos_sales s
      where v_ledger.metadata->>'sale_allocation_status' = 'partial_unallocated'
        and s.license_id = v_license_id and s.customer_id = p_customer_id
        and s.deleted_at is null and s.credit_effect_status = 'applied'
        and s.source_mode = 'cloud_committed'
    ) affected order by affected.id
  loop
    update public.pos_sales s set server_version = s.server_version + 1, updated_at = now()
      where s.license_id = v_license_id and s.id = v_item->>'sale_id'
      returning * into v_sale;
    v_changed_sales := v_changed_sales || jsonb_build_array(private.pos_sale_to_jsonb(v_sale));
    perform private.record_pos_sync_event(v_license_id, 'sale', v_sale.id, 'update',
      v_device_id, v_staff_user_id, p_idempotency_key,
      jsonb_build_object('customer_id', p_customer_id, 'reason', 'customer_payment_allocation', 'ledger_id', v_ledger.id),
      v_sale.server_version::integer);
  end loop;

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
    'sales', v_changed_sales,
    'sale_allocation_version', 1,
    'sale_allocation_status', v_ledger.metadata->>'sale_allocation_status',
    'unallocated_amount', v_remaining,
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
$function$
;

CREATE OR REPLACE FUNCTION public.pos_cancel_cloud_sale_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_sale_id text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_preview jsonb;
  v_reasons jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_first_code text;
  v_sale_id text := nullif(btrim(coalesce(p_sale_id, '')), '');
  v_actor jsonb;
  v_context jsonb;
  v_license_id uuid;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  -- Serialize admission, not just effects, with new payments. Recheck after wait.
  perform c.id from public.pos_customers c
    join public.pos_sales s on s.license_id = c.license_id and s.customer_id = c.id
    where s.license_id = v_license_id and s.id = p_sale_id for update of c;
  v_preview := public.pos_preview_cloud_sale_cancellation(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason
  );

  v_reasons := coalesce(v_preview->'block_reasons', '[]'::jsonb);
  if exists (
    select 1 from public.pos_customer_ledger l
      cross join lateral jsonb_array_elements(l.allocation_payload) a
    where l.license_id = v_license_id and l.deleted_at is null
      and l.type = 'PAYMENT' and l.amount < 0
      and l.metadata->>'sale_allocation_version' = '1' and a->>'sale_id' = p_sale_id
  ) then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS',
      'message', 'La venta tiene abonos asignados. No se aplico ningun cambio.'));
  end if;


  if v_reason is null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'CLOUD_SALE_CANCELLATION_REASON_REQUIRED',
      'message', 'Indica el motivo de cancelacion.'
    ));
  end if;

  if coalesce((v_preview->>'success')::boolean, false) is not true
     or coalesce((v_preview->>'can_cancel')::boolean, false) is not true
     or jsonb_array_length(v_reasons) > 0 then
    v_first_code := coalesce(v_reasons #>> '{0,code}', v_preview->>'code', 'CLOUD_SALE_CANCELLATION_BLOCKED');
    v_actor := coalesce(v_preview->'actor', '{}'::jsonb);

    if v_sale_id is not null and coalesce((v_preview->>'success')::boolean, false) is true then
      perform private.record_pos_sale_audit_event(
        ((v_preview->'sale'->>'license_id')::uuid),
        v_sale_id,
        'sale.cancel_blocked',
        nullif(v_actor->>'device_id', '')::uuid,
        nullif(v_actor->>'staff_user_id', '')::uuid,
        v_actor->>'actor_name',
        jsonb_build_object(
          'sale_id', v_sale_id,
          'folio', coalesce(v_preview->>'folio', v_preview->'sale'->>'cloud_folio', v_preview->'sale'->>'folio', v_sale_id),
          'reason', v_reason,
          'block_code', v_first_code,
          'block_reasons', v_reasons,
          'preview', v_preview->'preview',
          'idempotency_key', p_idempotency_key,
          'phase', 'fase6e1_hardening_cancelaciones_cloud'
        )
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', v_first_code,
      'message', case
        when v_first_code = 'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS' then 'La venta fiada tiene abonos posteriores independientes. No se aplico ningun cambio.'
        when v_first_code = 'CLOUD_SALE_CANCELLATION_REASON_REQUIRED' then 'Indica el motivo de cancelacion.'
        else coalesce(v_preview->>'message', 'No se cancelo la venta para evitar descuadres.')
      end,
      'block_reasons', v_reasons,
      'preview', v_preview,
      'mode', 'cloud_sale_cancellation_blocked'
    );
  end if;

  return public.pos_cancel_cloud_sale_apply_fase6e(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason,
    p_idempotency_key
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pos_get_customer_credit_summary_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_customer public.pos_customers;
  v_entries jsonb;
  v_total_paid numeric := 0;
  v_total_charged numeric := 0;
  v_last_payment jsonb := null;
  v_payload jsonb;
  v_sales jsonb;
  v_pending jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_license_id := (v_context->>'license_id')::uuid;

  select * into v_customer from public.pos_customers c where c.license_id = v_license_id and c.id = p_customer_id for update;
  if v_customer.id is null then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_NOT_FOUND', 'message', 'Cliente no encontrado.');
  end if;

  select coalesce(jsonb_agg(private.pos_customer_ledger_to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
  into v_entries
  from (
    select * from public.pos_customer_ledger l
    where l.license_id = v_license_id and l.customer_id = p_customer_id and l.deleted_at is null
    order by l.created_at desc
    limit 100
  ) l;

  select coalesce(sum(case when amount < 0 then abs(amount) else 0 end), 0),
         coalesce(sum(case when amount > 0 then amount else 0 end), 0)
  into v_total_paid, v_total_charged
  from public.pos_customer_ledger l
  where l.license_id = v_license_id and l.customer_id = p_customer_id and l.deleted_at is null;

  select private.pos_customer_ledger_to_jsonb(l) into v_last_payment
  from public.pos_customer_ledger l
  where l.license_id = v_license_id and l.customer_id = p_customer_id and l.type = 'PAYMENT' and l.deleted_at is null
  order by l.created_at desc
  limit 1;

  v_payload := jsonb_build_object(
    'success', true,
    'customer', private.pos_customer_to_jsonb(v_customer),
    'debt', v_customer.debt,
    'debt_cents', v_customer.debt_cents,
    'ledger_entries', v_entries,
    'pending_credit_sales', '[]'::jsonb,
    'total_paid', v_total_paid,
    'total_charged', v_total_charged,
    'last_payment', v_last_payment
  );
  if coalesce((v_payload->>'success')::boolean, false) then
    select coalesce(jsonb_agg(private.pos_sale_to_jsonb(s) order by s.sold_at, s.id), '[]'::jsonb)
      into v_sales from public.pos_sales s
      where s.license_id = v_license_id and s.customer_id = p_customer_id
        and s.deleted_at is null and s.source_mode = 'cloud_committed'
        and s.credit_effect_status = 'applied';
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_pending
      from jsonb_array_elements(v_sales)
      where value->>'status' = 'closed' and value->>'cancelled_at' is null
        and value->>'credit_allocation_status' = 'reconciled'
        and (value->>'current_balance_due')::numeric > 0;
    v_payload := v_payload || jsonb_build_object('credit_sales', v_sales,
      'pending_credit_sales', v_pending, 'sale_allocation_version', 1,
      'sale_balances_authoritative', true,
      'sale_allocation_status', case when exists (
        select 1 from jsonb_array_elements(v_sales) a where a->>'credit_allocation_status' = 'unreconciled_sale'
      ) then 'unreconciled_sale' when exists (
        select 1 from jsonb_array_elements(v_sales) a
        where a->>'credit_allocation_status' = 'historical_unallocated'
      ) then 'historical_unallocated' else 'reconciled' end);
  end if;
  return v_payload;
end;
$function$
;

-- CREATE OR REPLACE retains ownership and EXECUTE privileges. No new grants,
-- tables, RLS policies, repair UPDATEs, or historical idempotency rewrites.
commit;
$canonical_20261106025114$]) as matches
 from supabase_migrations.schema_migrations where version='20261106025114')
select jsonb_build_object('all_ok',coalesce(bool_and(present and body_matches and attributes_match and permissions_match),false) and (select matches from ledger),
 'functions',jsonb_agg(to_jsonb(checks) order by signature),'ledger_matches',(select matches from ledger)) from checks;
