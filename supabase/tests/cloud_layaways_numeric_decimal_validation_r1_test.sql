-- CLOUD LAYAWAYS NUMERIC DECIMAL VALIDATION R1 contract test.
-- Run after the migration in an authorized isolated database.  The helper is
-- pure; the transaction is rolled back and no business rows are created.

begin;

do $test$
declare
  v_value text;
begin
  if to_regprocedure('private.layaway_request_numeric_v1(jsonb,text[],numeric)') is null then
    raise exception 'LAYAWAY_NUMERIC_FUNCTION_MISSING';
  end if;

  if private.layaway_request_numeric_v1('{"total_amount":20}'::jsonb, array['total_amount'], null::numeric) <> 20 then
    raise exception 'LAYAWAY_INTEGER_TOTAL_FAILED';
  end if;
  if private.layaway_request_numeric_v1('{"total_amount":20.00}'::jsonb, array['total_amount'], null::numeric) <> 20.00 then
    raise exception 'LAYAWAY_DECIMAL_NUMBER_TOTAL_FAILED';
  end if;
  if private.layaway_request_numeric_v1('{"totalAmount":"20.00"}'::jsonb, array['totalAmount'], null::numeric) <> 20.00 then
    raise exception 'LAYAWAY_DECIMAL_STRING_TOTAL_FAILED';
  end if;
  if private.layaway_request_numeric_v1('{"total":"1750.50"}'::jsonb, array['total'], null::numeric) <> 1750.50 then
    raise exception 'LAYAWAY_LARGE_DECIMAL_TOTAL_FAILED';
  end if;
  if private.layaway_request_numeric_v1('{"total_amount":"0.50"}'::jsonb, array['total_amount'], null::numeric) <> 0.50 then
    raise exception 'LAYAWAY_FRACTION_TOTAL_FAILED';
  end if;

  if private.layaway_request_numeric_v1('{"totalAmount":"-20"}'::jsonb, array['totalAmount'], null::numeric) <> -20
     or private.layaway_request_numeric_v1('{"total":"-0.50"}'::jsonb, array['total'], null::numeric) <> -0.50 then
    raise exception 'LAYAWAY_NEGATIVE_NUMERIC_SEMANTICS_CHANGED';
  end if;

  if private.layaway_request_numeric_v1(null::jsonb, array['total_amount'], 7.50) <> 7.50
     or private.layaway_request_numeric_v1('{}'::jsonb, array['total_amount'], 7.50) <> 7.50
     or private.layaway_request_numeric_v1('{"total_amount":null}'::jsonb, array['total_amount'], 7.50) <> 7.50
     or private.layaway_request_numeric_v1('{"total_amount":""}'::jsonb, array['total_amount'], 7.50) <> 7.50 then
    raise exception 'LAYAWAY_NUMERIC_DEFAULT_SEMANTICS_CHANGED';
  end if;

  foreach v_value in array[
    'abc',
    '20..00',
    '1,000',
    '$20',
    'NaN',
    'Infinity',
    'not-a-timestamp'
  ] loop
    begin
      perform private.layaway_request_numeric_v1(
        jsonb_build_object('totalAmount', v_value),
        array['totalAmount'],
        null::numeric
      );
      raise exception 'LAYAWAY_INVALID_NUMERIC_ACCEPTED:%', v_value;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'LAYAWAY_NUMERIC_INVALID:totalAmount' then
        raise;
      end if;
    end;
  end loop;
end;
$test$;

rollback;
