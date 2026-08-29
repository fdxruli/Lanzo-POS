-- CASH FINANCIAL TIMESTAMP/STATION ALIGNMENT R2 contract test
-- The transaction is intentionally rolled back; this test does not mutate
-- production data when run in an isolated database transaction.
begin;

do $test$
declare
  v_value text;
begin
  if to_regprocedure('private.financial_timestamp_v1(jsonb)') is null then
    raise exception 'FINANCIAL_TIMESTAMP_FUNCTION_MISSING';
  end if;

  if private.financial_timestamp_v1(to_jsonb('2026-08-29T16:21:06.000Z'::text))
     <> '2026-08-29T16:21:06.000000Z' then
    raise exception 'FINANCIAL_TIMESTAMP_UTC_FORMAT_MISMATCH';
  end if;

  v_value := private.financial_timestamp_v1(to_jsonb('2026-08-29T10:21:06.000-06:00'::text));
  if v_value <> '2026-08-29T16:21:06.000000Z' then
    raise exception 'FINANCIAL_TIMESTAMP_OFFSET_NORMALIZATION_MISMATCH';
  end if;

  if private.financial_timestamp_v1(null::jsonb) is not null
     or private.financial_timestamp_v1('null'::jsonb) is not null then
    raise exception 'FINANCIAL_TIMESTAMP_NULL_BEHAVIOR_CHANGED';
  end if;

  begin
    perform private.financial_timestamp_v1(to_jsonb('2026-08-29 16:21:06.000Z'::text));
    raise exception 'FINANCIAL_TIMESTAMP_SPACE_SEPARATOR_ACCEPTED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FINANCIAL_TIMESTAMP_INVALID' then
      raise;
    end if;
  end;

  begin
    perform private.financial_timestamp_v1(to_jsonb('2026-02-29T16:21:06.000Z'::text));
    raise exception 'FINANCIAL_TIMESTAMP_IMPOSSIBLE_DATE_ACCEPTED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'FINANCIAL_TIMESTAMP_INVALID' then
      raise;
    end if;
  end;
end;
$test$;

rollback;
