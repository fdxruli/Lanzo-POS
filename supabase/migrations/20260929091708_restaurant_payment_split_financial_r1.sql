-- Phase 3: canonical split identity now distinguishes single-sale monetary splits.
-- Payment rows retain stable T1..T8 payer IDs, never presentation names.
create or replace function private.canonical_financial_split_payer_v1(p_payer jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'payer_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['payer_id','payerId','label','id'])),
    'amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['amount','contribution_amount','contributionAmount'])),
    'payment_method', private.financial_payment_method_v1('sale.credit', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['payment_method','paymentMethod','method']))),
    'initial_payment_method', private.financial_payment_method_v1('sale.credit', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['initial_payment_method','initialPaymentMethod']))),
    'initial_amount_paid', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['initial_amount_paid','initialAmountPaid'])),
    'customer_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payer, array['customer_id','customerId']))
  ))
$$;

revoke all on function private.canonical_financial_split_payer_v1(jsonb) from public, anon, authenticated;

create or replace function private.canonical_financial_payment_v1(p_operation_type text, p_payment jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['id'])),
    'method', private.financial_payment_method_v1(p_operation_type, private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['method','payment_method','paymentMethod']))),
    'amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['amount','total'])),
    'received_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['received_amount','receivedAmount'])),
    'change_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['change_amount','changeAmount'])),
    'reference', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(p_payment, array['reference','ref'])),
    'split_payer_id', private.financial_text_v1(coalesce(
      private.financial_first_nonblank_scalar_v1(p_payment, array['split_payer_id','splitPayerId']),
      private.financial_first_nonblank_scalar_v1(p_payment->'metadata', array['split_payer_id','splitPayerId'])
    ))
  ))
$$;
create or replace function private.canonical_financial_request_v1(
  p_operation_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_request jsonb := coalesce(p_request, '{}'::jsonb);
  v_split_intent text;
  v_split_child_count integer;
  v_split_payer_count integer;
  v_split_payer jsonb;
  v_split_child jsonb;
  v_parent_order_version text;
  v_parent_order_version_at timestamptz;
  v_credit_payer_count integer := 0;
  v_credit_customer_id text;
  v_payer_customer_id text;
  v_customer_id_snake text;
  v_customer_id_camel text;
  v_child_customer_id text;
  v_child_sale_customer_id text;
begin
  if jsonb_typeof(v_request) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'cash.open' then
      return jsonb_build_object('opening', jsonb_build_object(
        'opening_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_amount','montoInicial'])),'0'),
        'opening_counted_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_counted_amount','montoContado','montoContadoInicial'])),
        'opening_suggested_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_suggested_amount','montoSugerido'])),
        'opening_policy', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_policy','politicaApertura'])),
        'opening_origin', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['opening_origin','origen'])),
        'is_auto_opening', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['is_auto_opening','esAutoApertura'])),
        'responsible_name', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['responsible_name','responsable']))
      ));
    when 'cash.movement' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'type', v_request->>'type',
        'amount', private.financial_decimal_v1(v_request->'amount'),
        'concept', v_request->>'concept',
        'source', v_request->>'source',
        'reference_type', v_request->>'reference_type',
        'reference_id', v_request->>'reference_id'
      );
    when 'cash.adjust_initial_fund' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'new_opening_amount', private.financial_decimal_v1(v_request->'new_opening_amount'),
        'reason', v_request->>'reason',
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'cash.close' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'closing_counted_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['closing_counted_amount','countedAmount','montoFisicoTotal'])),
        'next_shift_fund', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_request,array['next_shift_fund','nextShiftFund','montoFondoSiguienteTurno'])),
        'comments', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request,array['audit_comments','comments','comentarios'])),
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'cash.admin_close' then
      return jsonb_build_object(
        'cash_session_id', v_request->>'cash_session_id',
        'closing_mode', v_request->>'closing_mode',
        'counted_amount', private.financial_decimal_v1(v_request->'counted_amount'),
        'next_shift_fund', private.financial_decimal_v1(v_request->'next_shift_fund'),
        'reason_code', v_request->>'reason_code',
        'comments', v_request->>'comments',
        'expected_version', private.financial_integer_v1(v_request->'expected_version')
      );
    when 'sale.cashier', 'sale.cashier_inventory', 'sale.credit' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_SALE_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'sale', private.canonical_financial_sale_v1(p_operation_type, v_request->'sale'),
        'items', (
          select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'items') with ordinality
        ),
        'payments', (
          select coalesce(jsonb_agg(private.canonical_financial_payment_v1(p_operation_type, value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'payments') with ordinality
        ),
        'cash_session_id', private.financial_text_v1(v_request->'cash_session_id'),
        'customer_id', private.financial_text_v1(v_request->'customer_id')
      );
    when 'sale.split' then
      v_split_intent := coalesce(
        private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['split_intent','splitIntent'])),
        'by_items'
      );
      if v_split_intent not in ('by_items', 'equal_payment', 'custom_payment')
         or jsonb_typeof(v_request->'children') <> 'array' then
        raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      v_split_child_count := jsonb_array_length(coalesce(v_request->'children', '[]'::jsonb));
      if (v_split_intent = 'by_items' and (v_split_child_count < 2 or v_split_child_count > 8))
         or (v_split_intent in ('equal_payment', 'custom_payment') and v_split_child_count <> 1) then
        raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      v_parent_order_version := nullif(btrim(private.financial_text_v1(
        private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_version','parentOrderVersion'])
      )), '');
      if v_split_intent in ('equal_payment', 'custom_payment') then
        if v_parent_order_version is null
           or v_parent_order_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$' then
          raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
        end if;
        begin
          v_parent_order_version_at := v_parent_order_version::timestamptz;
        exception
          when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
            raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
        end;

        for v_split_payer in
          select value
            from jsonb_array_elements(coalesce(v_request->'split_payers', v_request->'splitPayers', '[]'::jsonb))
        loop
          if private.financial_payment_method_v1(
               'sale.credit',
               private.financial_text_v1(private.financial_first_nonblank_scalar_v1(
                 v_split_payer, array['payment_method','paymentMethod','method']
               ))
             ) in ('credit', 'mixed_credit') then
            v_customer_id_snake := nullif(btrim(v_split_payer->>'customer_id'), '');
            v_customer_id_camel := nullif(btrim(v_split_payer->>'customerId'), '');
            if v_customer_id_snake is not null
               and v_customer_id_camel is not null
               and v_customer_id_snake <> v_customer_id_camel then
              raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
            end if;
            v_payer_customer_id := coalesce(v_customer_id_snake, v_customer_id_camel);
            if v_payer_customer_id is null then
              raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
            end if;
            v_credit_payer_count := v_credit_payer_count + 1;
            if v_credit_payer_count = 1 then
              v_credit_customer_id := v_payer_customer_id;
            end if;
          end if;
        end loop;

        if v_credit_payer_count > 1 then
          raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
        end if;

        if v_credit_payer_count = 1 then
          for v_split_child in
            select value
              from jsonb_array_elements(coalesce(v_request->'children', '[]'::jsonb))
          loop
            v_customer_id_snake := nullif(btrim(v_split_child->>'customer_id'), '');
            v_customer_id_camel := nullif(btrim(v_split_child->>'customerId'), '');
            if v_customer_id_snake is not null
               and v_customer_id_camel is not null
               and v_customer_id_snake <> v_customer_id_camel then
              raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
            end if;
            v_child_customer_id := coalesce(v_customer_id_snake, v_customer_id_camel);

            v_customer_id_snake := nullif(btrim(v_split_child->'sale'->>'customer_id'), '');
            v_customer_id_camel := nullif(btrim(v_split_child->'sale'->>'customerId'), '');
            if v_customer_id_snake is not null
               and v_customer_id_camel is not null
               and v_customer_id_snake <> v_customer_id_camel then
              raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
            end if;
            v_child_sale_customer_id := coalesce(v_customer_id_snake, v_customer_id_camel);

            if (v_child_customer_id is not null and v_child_customer_id <> v_credit_customer_id)
               or (v_child_sale_customer_id is not null and v_child_sale_customer_id <> v_credit_customer_id) then
              raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
            end if;
          end loop;
        end if;
      end if;
      return jsonb_build_object(
        'parent_order_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_id','parentOrderId'])),
        'parent_order_version', v_parent_order_version,
        'split_group_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['split_group_id','splitGroupId'])),
        'cash_session_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['cash_session_id','cashSessionId'])),
        'children', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'label', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(value, array['label'])),
              'sale', private.canonical_financial_sale_v1(
                case
                  when private.financial_payment_method_v1(
                    'sale.credit',
                    lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', ''))
                  ) in ('credit','mixed_credit')
                    then 'sale.credit'
                  when coalesce((value->'sale'->'metadata'->>'cloudInventoryEffects')::boolean, false)
                    then 'sale.cashier_inventory'
                  else 'sale.cashier'
                end,
                value->'sale'
              ) ||
                case
                  when v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1
                    then jsonb_build_object('customer_id', v_credit_customer_id)
                  else '{}'::jsonb
                end,
              'items', (
                select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(item_value) order by item_ordinality), '[]'::jsonb)
                from jsonb_array_elements(coalesce(value->'items', '[]'::jsonb)) with ordinality as item_rows(item_value, item_ordinality)
              ),
              'payments', (
                select coalesce(jsonb_agg(
                  private.canonical_financial_payment_v1(
                    case
                      when private.financial_payment_method_v1(
                        'sale.credit',
                        lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', ''))
                      ) in ('credit','mixed_credit')
                        then 'sale.credit'
                      when coalesce((value->'sale'->'metadata'->>'cloudInventoryEffects')::boolean, false)
                        then 'sale.cashier_inventory'
                      else 'sale.cashier'
                    end,
                    payment_value
                  ) order by payment_ordinality
                ), '[]'::jsonb)
                from jsonb_array_elements(coalesce(value->'payments', '[]'::jsonb)) with ordinality as payment_rows(payment_value, payment_ordinality)
              ),
              'customer_id', private.financial_text_v1(
                to_jsonb(
                  coalesce(
                    nullif(btrim(value->>'customer_id'), ''),
                    nullif(btrim(value->>'customerId'), ''),
                    nullif(btrim(value->'sale'->>'customer_id'), ''),
                    nullif(btrim(value->'sale'->>'customerId'), ''),
                    case
                      when v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1
                        then v_credit_customer_id
                      else null
                    end
                  )
                )
              )
            ) order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(v_request->'children') with ordinality
        )
      ) || case
        when v_split_intent in ('equal_payment', 'custom_payment') then jsonb_build_object(
          'split_intent', v_split_intent,
          'split_payers', (
            select coalesce(jsonb_agg(private.canonical_financial_split_payer_v1(value) order by ordinality), '[]'::jsonb)
            from jsonb_array_elements(coalesce(v_request->'split_payers', v_request->'splitPayers', '[]'::jsonb)) with ordinality
          )
        )
        else '{}'::jsonb
      end;
    when 'sale.layaway_complete' then
      if jsonb_typeof(v_request->'sale') <> 'object'
         or jsonb_typeof(v_request->'items') <> 'array'
         or jsonb_typeof(v_request->'payments') <> 'array' then
        raise exception 'FINANCIAL_LAYAWAY_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'layaway_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['layaway_id','layawayId'])),
        'sale', private.canonical_financial_sale_v1('sale.layaway_complete', v_request->'sale'),
        'items', (
          select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'items') with ordinality
        ),
        'payments', (
          select coalesce(jsonb_agg(private.canonical_financial_payment_v1('sale.layaway_complete', value) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(v_request->'payments') with ordinality
        )
      );
    when 'sale.cancel' then
      return jsonb_build_object('sale_id', v_request->>'sale_id', 'reason', v_request->>'reason');
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$function$;

revoke all on function private.canonical_financial_payment_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.canonical_financial_request_v1(text, jsonb) from public, anon, authenticated;

-- Extend the existing atomic split executor: by-items remains unchanged; a
-- monetary split validates payer tenders and reuses exactly one sale RPC call.
create or replace function private.execute_split_sale_financial_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_split jsonb,
  p_internal_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_parent_order_id text;
  v_split_group_id text;
  v_cash_session_id text;
  v_parent_order_version text;
  v_parent_order_version_at timestamptz;
  v_split_intent text := coalesce(
    private.financial_text_v1(private.financial_first_nonblank_scalar_v1(
      coalesce(p_split, '{}'::jsonb), array['split_intent','splitIntent']
    )),
    'by_items'
  );
  v_split_payers jsonb := coalesce(p_split->'split_payers', p_split->'splitPayers', '[]'::jsonb);
  v_split_payer jsonb;
  v_payment jsonb;
  v_split_payer_count integer := 0;
  v_split_payer_index integer := 0;
  v_equal_base_cents integer := 0;
  v_equal_remainder_cents integer := 0;
  v_credit_payer_count integer := 0;
  v_split_payer_total numeric := 0;
  v_payer_id text;
  v_payer_method text;
  v_payer_customer_id text;
  v_customer_id_snake text;
  v_customer_id_camel text;
  v_child_customer_id text;
  v_child_customer_alias_id text;
  v_sale_customer_id text;
  v_sale_customer_alias_id text;
  v_payer_initial_method text;
  v_payer_amount numeric;
  v_payer_initial_amount numeric;
  v_expected_payment_method text;
  v_expected_payment_amount numeric;
  v_payment_payer_id text;
  v_payment_method_normalized text;
  v_payment_amount numeric;
  v_payer_payment_total numeric;
  v_payer_ids text[] := array[]::text[];
  v_child_count integer;
  v_child_index integer := 0;
  v_child jsonb;
  v_child_sale jsonb;
  v_child_response jsonb;
  v_child_sale_id text;
  v_child_label text;
  v_child_key text;
  v_payment_method text;
  v_is_credit boolean;
  v_inventory boolean;
  v_sales jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_tickets jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_payment_summary jsonb;
  v_close_response jsonb;
  v_order public.pos_restaurant_orders;
  v_labels text[] := array[]::text[];
  v_sale_ids text[] := array[]::text[];
  v_latest_change_seq bigint;
  v_primary_sale_id text;
  v_primary_sale_folio text;
begin
  if jsonb_typeof(coalesce(p_split, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_parent_order_id := nullif(btrim(coalesce(p_split->>'parent_order_id', p_split->>'parentOrderId', '')), '');
  v_split_group_id := nullif(btrim(coalesce(p_split->>'split_group_id', p_split->>'splitGroupId', '')), '');
  v_cash_session_id := nullif(btrim(coalesce(p_split->>'cash_session_id', p_split->>'cashSessionId', '')), '');
  v_parent_order_version := nullif(btrim(coalesce(p_split->>'parent_order_version', p_split->>'parentOrderVersion', '')), '');
  if v_split_intent in ('equal_payment', 'custom_payment')
     and (v_parent_order_version is null
       or v_parent_order_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_parent_order_version is not null then
    begin
      v_parent_order_version_at := v_parent_order_version::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
    end;
  end if;
  if v_parent_order_id is null then
    raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
  end if;
  if v_split_group_id is null then
    raise exception 'SPLIT_GROUP_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_cash_session_id is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_cash_session_station(
    v_license_id,
    v_device_id,
    v_cash_session_id
  );

  -- Per-license + parent advisory lock prevents two devices from settling the
  -- same table concurrently, even before the restaurant row is updated.
  perform pg_advisory_xact_lock(
    hashtext(v_license_id::text),
    hashtext('restaurant_split:' || v_parent_order_id)
  );

  select *
    into v_order
    from public.pos_restaurant_orders o
   where o.license_id = v_license_id
     and o.local_order_id = v_parent_order_id
     and o.deleted_at is null
   order by o.updated_at desc nulls last, o.id
   limit 1
   for update;

  if v_order.id is null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_parent_order_version is not null
     and v_order.updated_at is distinct from v_parent_order_version_at then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_order.payment_status, '')) = 'paid' then
    raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_split->'children', '[]'::jsonb)) <> 'array' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_child_count := jsonb_array_length(p_split->'children');
  if v_split_intent not in ('by_items', 'equal_payment', 'custom_payment') then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if (v_split_intent = 'by_items' and (v_child_count < 2 or v_child_count > 8))
     or (v_split_intent in ('equal_payment', 'custom_payment') and v_child_count <> 1) then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;

  if v_split_intent in ('equal_payment', 'custom_payment') then
    if jsonb_typeof(v_split_payers) <> 'array' then
      raise exception 'FINANCIAL_SPLIT_PAYER_CONTRACT_INVALID' using errcode = 'P0001';
    end if;
    v_split_payer_count := jsonb_array_length(v_split_payers);
    if v_split_payer_count < 2 or v_split_payer_count > 8 then
      raise exception 'FINANCIAL_SPLIT_PAYER_COUNT_INVALID' using errcode = 'P0001';
    end if;
    if v_split_intent = 'equal_payment' then
      v_equal_base_cents := floor(round(coalesce(v_order.total, 0) * 100)::numeric / v_split_payer_count)::integer;
      v_equal_remainder_cents := mod(round(coalesce(v_order.total, 0) * 100)::integer, v_split_payer_count);
    end if;

    for v_split_payer in select value from jsonb_array_elements(v_split_payers)
    loop
      if jsonb_typeof(v_split_payer) <> 'object' then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_payer_id := nullif(btrim(coalesce(v_split_payer->>'payer_id', v_split_payer->>'payerId', v_split_payer->>'label', v_split_payer->>'id', '')), '');
      if v_payer_id is null or v_payer_id !~ '^T[1-8]$' or v_payer_id = any(v_payer_ids) then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_payer_ids := array_append(v_payer_ids, v_payer_id);

      v_payer_amount := private.pos_sale_jsonb_numeric(v_split_payer, array['amount','contribution_amount','contributionAmount'], null);
      v_payer_method := private.normalize_pos_sale_payment_method(coalesce(v_split_payer->>'payment_method', v_split_payer->>'paymentMethod', v_split_payer->>'method'));
      if v_payer_amount is null or v_payer_amount <= 0 or v_payer_amount <> round(v_payer_amount, 2)
         or v_payer_method is null or v_payer_method not in ('cash', 'card', 'transfer', 'credit') then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_split_payer_index := v_split_payer_index + 1;
      v_split_payer_total := v_split_payer_total + v_payer_amount;
      if v_split_intent = 'equal_payment'
         and v_payer_amount <> (v_equal_base_cents + case when v_split_payer_index <= v_equal_remainder_cents then 1 else 0 end)::numeric / 100 then
        raise exception 'FINANCIAL_SPLIT_EQUAL_DISTRIBUTION_INVALID' using errcode = 'P0001';
      end if;

      if v_payer_method = 'credit' then
        v_credit_payer_count := v_credit_payer_count + 1;
        v_payer_initial_amount := coalesce(private.pos_sale_jsonb_numeric(v_split_payer, array['initial_amount_paid','initialAmountPaid'], null), 0);
        v_payer_initial_method := private.normalize_pos_sale_payment_method(coalesce(v_split_payer->>'initial_payment_method', v_split_payer->>'initialPaymentMethod', 'cash'));
        v_customer_id_snake := nullif(btrim(v_split_payer->>'customer_id'), '');
        v_customer_id_camel := nullif(btrim(v_split_payer->>'customerId'), '');
        if v_customer_id_snake is not null
           and v_customer_id_camel is not null
           and v_customer_id_snake <> v_customer_id_camel then
          raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
        end if;
        v_payer_customer_id := coalesce(v_customer_id_snake, v_customer_id_camel);
        if v_credit_payer_count > 1
           or v_payer_customer_id is null
           or v_payer_initial_amount < 0
           or v_payer_initial_amount >= v_payer_amount
           or v_payer_initial_amount <> round(v_payer_initial_amount, 2)
           or v_payer_initial_method not in ('cash', 'card', 'transfer') then
          raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
        end if;
        v_credit_customer_id := v_payer_customer_id;
        v_expected_payment_amount := v_payer_initial_amount;
        v_expected_payment_method := v_payer_initial_method;
      else
        if nullif(btrim(coalesce(v_split_payer->>'customer_id', v_split_payer->>'customerId', '')), '') is not null then
          raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
        end if;
        v_expected_payment_amount := v_payer_amount;
        v_expected_payment_method := v_payer_method;
      end if;

      v_payer_payment_total := 0;
      for v_payment in
        select value from jsonb_array_elements(coalesce((p_split->'children'->0)->'payments', '[]'::jsonb))
      loop
        v_payment_payer_id := nullif(btrim(coalesce(
          v_payment->>'split_payer_id', v_payment->>'splitPayerId',
          v_payment->'metadata'->>'split_payer_id', v_payment->'metadata'->>'splitPayerId', ''
        )), '');
        if v_payment_payer_id = v_payer_id then
          v_payment_method_normalized := private.normalize_pos_sale_payment_method(coalesce(v_payment->>'method', v_payment->>'payment_method', v_payment->>'paymentMethod'));
          v_payment_amount := private.pos_sale_jsonb_numeric(v_payment, array['amount','total'], null);
          if jsonb_typeof(v_payment) <> 'object'
             or v_payment_method_normalized is distinct from v_expected_payment_method
             or v_payment_amount is null or v_payment_amount <= 0 or v_payment_amount <> round(v_payment_amount, 2) then
            raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_INVALID' using errcode = 'P0001';
          end if;
          v_payer_payment_total := v_payer_payment_total + v_payment_amount;
        end if;
      end loop;
      if abs(v_payer_payment_total - v_expected_payment_amount) > 0.005 then
        raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_MISMATCH' using errcode = 'P0001';
      end if;
    end loop;

    if v_credit_payer_count = 1 then
      v_child := coalesce(p_split->'children'->0, '{}'::jsonb);
      v_child_sale := coalesce(v_child->'sale', '{}'::jsonb);
      v_child_customer_id := nullif(btrim(v_child->>'customer_id'), '');
      v_child_customer_alias_id := nullif(btrim(v_child->>'customerId'), '');
      if v_child_customer_id is not null
         and v_child_customer_alias_id is not null
         and v_child_customer_id <> v_child_customer_alias_id then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
      v_child_customer_id := coalesce(v_child_customer_id, v_child_customer_alias_id);

      v_sale_customer_id := nullif(btrim(v_child_sale->>'customer_id'), '');
      v_sale_customer_alias_id := nullif(btrim(v_child_sale->>'customerId'), '');
      if v_sale_customer_id is not null
         and v_sale_customer_alias_id is not null
         and v_sale_customer_id <> v_sale_customer_alias_id then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
      v_sale_customer_id := coalesce(v_sale_customer_id, v_sale_customer_alias_id);

      if (v_child_customer_id is not null and v_child_customer_id <> v_credit_customer_id)
         or (v_sale_customer_id is not null and v_sale_customer_id <> v_credit_customer_id) then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
    end if;

    if abs(v_split_payer_total - coalesce(v_order.total, 0)) > 0.005 then
      raise exception 'FINANCIAL_SPLIT_PAYER_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;

    for v_payment in
      select value from jsonb_array_elements(coalesce((p_split->'children'->0)->'payments', '[]'::jsonb))
    loop
      v_payment_payer_id := nullif(btrim(coalesce(
        v_payment->>'split_payer_id', v_payment->>'splitPayerId',
        v_payment->'metadata'->>'split_payer_id', v_payment->'metadata'->>'splitPayerId', ''
      )), '');
      if v_payment_payer_id is null or not (v_payment_payer_id = any(v_payer_ids)) then
        raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_INVALID' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  for v_child in
    select value
      from jsonb_array_elements(p_split->'children')
  loop
    v_child_index := v_child_index + 1;
    v_child_key := p_internal_idempotency_key || ':child:' || v_child_index::text;
    if jsonb_typeof(v_child) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;

    v_child_label := nullif(btrim(coalesce(v_child->>'label', '')), '');
    v_child_sale := coalesce(v_child->'sale', '{}'::jsonb);
    if v_child_label is null or jsonb_typeof(v_child_sale) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;
    if v_child_label = any(v_labels) then
      raise exception 'FINANCIAL_SPLIT_LABEL_DUPLICATE' using errcode = 'P0001';
    end if;
    v_labels := array_append(v_labels, v_child_label);

    v_child_sale_id := nullif(btrim(coalesce(v_child_sale->>'id', v_child_sale->>'cloud_sale_id', v_child_sale->>'cloudSaleId', '')), '');
    if v_child_sale_id is null then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_child_sale_id = any(v_sale_ids) then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_DUPLICATE' using errcode = 'P0001';
    end if;
    v_sale_ids := array_append(v_sale_ids, v_child_sale_id);

    v_payment_method := lower(coalesce(
      nullif(btrim(coalesce(v_child_sale->>'payment_method', v_child_sale->>'paymentMethod', '')), ''),
      'cash'
    ));
    v_is_credit := private.normalize_pos_sale_payment_method(v_payment_method) = 'credit'
      or private.financial_payment_method_v1('sale.credit', v_payment_method) = 'mixed_credit';
    if v_split_intent in ('equal_payment', 'custom_payment')
       and (v_credit_payer_count = 1) is distinct from v_is_credit then
      raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
    end if;
    if v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1 then
      v_child_sale := jsonb_set(v_child_sale, '{customer_id}', to_jsonb(v_credit_customer_id), true);
    end if;
    v_inventory := coalesce((v_child_sale->'metadata'->>'cloudInventoryEffects')::boolean, false);

    if v_is_credit then
      perform private.assert_cloud_sales_credit_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_credit_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        case
          when v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1
            then v_credit_customer_id
          else coalesce(
            nullif(btrim(v_child->>'customer_id'), ''),
            nullif(btrim(v_child_sale->>'customer_id'), ''),
            nullif(btrim(v_child_sale->>'customerId'), '')
          )
        end,
        v_child_key
      );
    elsif v_inventory then
      perform private.assert_cloud_sales_inventory_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_inventory_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    else
      perform private.assert_cloud_sales_cashier_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    end if;

    if coalesce((v_child_response->>'success')::boolean, false) is not true then
      raise exception 'SALE_SPLIT_CHILD_NOT_CONFIRMED:%', coalesce(v_child_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;

    if v_child_response->'sale' is null
       or v_child_response->'sale'->>'id' is null then
      raise exception 'SALE_SPLIT_CHILD_RESPONSE_INVALID' using errcode = 'P0001';
    end if;

    v_sales := v_sales || jsonb_build_array(v_child_response->'sale');
    v_items := v_items || coalesce(v_child_response->'items', '[]'::jsonb);
    v_payments := v_payments || coalesce(v_child_response->'payments', '[]'::jsonb);
    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'sale', v_child_response->'sale',
      'items', coalesce(v_child_response->'items', '[]'::jsonb),
      'payments', coalesce(v_child_response->'payments', '[]'::jsonb),
      'cash_session', v_child_response->'cash_session',
      'cash_movement', v_child_response->'cash_movement',
      'customer', v_child_response->'customer',
      'ledger_charge', v_child_response->'ledger_charge',
      'ledger_payment', v_child_response->'ledger_payment',
      'inventory_movements', coalesce(v_child_response->'inventory_movements', '[]'::jsonb),
      'event', v_child_response->'event'
    ));

    v_total := v_total + coalesce((v_child_response->'sale'->>'total')::numeric, 0);
    v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'saleId', v_child_response->'sale'->>'id',
      'folio', coalesce(v_child_response->'sale'->>'pos_folio', v_child_response->'sale'->>'folio'),
      'paymentMethod', v_child_response->'sale'->>'payment_method',
      'amountPaid', v_child_response->'sale'->>'amount_paid',
      'saldoPendiente', v_child_response->'sale'->>'balance_due',
      'customerId', v_child_response->'sale'->>'customer_id',
      'total', v_child_response->'sale'->>'total'
    ));
  end loop;

  if v_child_index <> v_child_count then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;
  if abs(round(v_total, 2) - round(coalesce(v_order.total, 0), 2)) > 0.005 then
    raise exception 'RESTAURANT_SPLIT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  select value->>'id', coalesce(value->>'pos_folio', value->>'folio')
    into v_primary_sale_id, v_primary_sale_folio
    from jsonb_array_elements(v_sales)
   limit 1;

  v_payment_summary := jsonb_build_object(
    'source', 'split_bill',
    'splitGroupId', v_split_group_id,
    'parentOrderId', v_parent_order_id,
    'childSaleIds', coalesce((select jsonb_agg(value->>'id') from jsonb_array_elements(v_sales)), '[]'::jsonb),
    'tickets', v_tickets,
    'splitIntent', v_split_intent,
    'splitPayers', case when v_split_intent in ('equal_payment', 'custom_payment') then v_split_payers else '[]'::jsonb end,
    'total', round(v_total, 2),
    'sourceMode', 'cloud_committed'
  );

  v_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_parent_order_id,
    coalesce(v_primary_sale_id, 'SPLIT-' || v_split_group_id),
    coalesce(v_primary_sale_folio, 'SPLIT-' || v_split_group_id),
    round(v_total, 2),
    v_payment_summary,
    p_internal_idempotency_key || ':restaurant-close'
  );

  if coalesce((v_close_response->>'success')::boolean, false) is not true then
    raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
  end if;

  select coalesce(max(change_seq), 0)
    into v_latest_change_seq
    from public.pos_sync_events
   where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_split',
    'parent_order_id', v_parent_order_id,
    'split_group_id', v_split_group_id,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'children', v_children,
    'restaurant_order_close', v_close_response,
    'total', round(v_total, 2),
    'change_seq', coalesce((v_close_response->>'changeSeq')::bigint, 0),
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_internal_idempotency_key
  );
end;
$function$;

revoke all on function private.execute_split_sale_financial_v1(text, text, text, text, jsonb, text) from public, anon, authenticated;
