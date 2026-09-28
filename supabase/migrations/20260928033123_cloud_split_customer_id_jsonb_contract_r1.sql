-- sale.split customer_id must pass JSONB to the existing financial_text_v1(jsonb) helper.
-- Preserve NULL and blank normalization; do not add a text overload.
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
      if jsonb_typeof(v_request->'children') <> 'array'
         or jsonb_array_length(coalesce(v_request->'children', '[]'::jsonb)) < 2 then
        raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'parent_order_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_id','parentOrderId'])),
        'parent_order_version', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['parent_order_version','parentOrderVersion'])),
        'split_group_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['split_group_id','splitGroupId'])),
        'cash_session_id', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(v_request, array['cash_session_id','cashSessionId'])),
        'children', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'label', private.financial_text_v1(private.financial_first_nonblank_scalar_v1(value, array['label'])),
              'sale', private.canonical_financial_sale_v1(
                case
                  when lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', '')) in ('credit','fiado','mixed_credit','partial_credit')
                    then 'sale.credit'
                  when coalesce((value->'sale'->'metadata'->>'cloudInventoryEffects')::boolean, false)
                    then 'sale.cashier_inventory'
                  else 'sale.cashier'
                end,
                value->'sale'
              ),
              'items', (
                select coalesce(jsonb_agg(private.canonical_financial_sale_item_v1(item_value) order by item_ordinality), '[]'::jsonb)
                from jsonb_array_elements(coalesce(value->'items', '[]'::jsonb)) with ordinality as item_rows(item_value, item_ordinality)
              ),
              'payments', (
                select coalesce(jsonb_agg(
                  private.canonical_financial_payment_v1(
                    case
                      when lower(coalesce(value->'sale'->>'payment_method', value->'sale'->>'paymentMethod', '')) in ('credit','fiado','mixed_credit','partial_credit')
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
                    nullif(btrim(value->'sale'->>'customer_id'), ''),
                    nullif(btrim(value->'sale'->>'customerId'), '')
                  )
                )
              )
            ) order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(v_request->'children') with ordinality
        )
      );
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