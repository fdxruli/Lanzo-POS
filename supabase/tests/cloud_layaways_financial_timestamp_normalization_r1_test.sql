-- CLOUD LAYAWAYS FINANCIAL TIMESTAMP NORMALIZATION R1 contract test.
-- Run after the migration ledger in an authorized isolated database.  The
-- helper calls are pure; the transaction is rolled back and no layaway,
-- payment, reservation, inventory, or cash rows are created.

begin;

do $test$
declare
  v_value text;
begin
  if to_regprocedure('private.layaway_deadline_v1(jsonb)') is null then
    raise exception 'LAYAWAY_DEADLINE_FUNCTION_MISSING';
  end if;

  if private.layaway_deadline_v1(to_jsonb('2026-09-04'::text))
     <> '2026-09-04T00:00:00.000000Z' then
    raise exception 'LAYAWAY_DATE_ONLY_NORMALIZATION_FAILED';
  end if;

  if private.layaway_deadline_v1(to_jsonb('2026-09-04T10:20:30.123456789-06:00'::text))
     <> '2026-09-04T16:20:30.123456Z' then
    raise exception 'LAYAWAY_FULL_TIMESTAMP_NORMALIZATION_FAILED';
  end if;

  if private.layaway_deadline_v1(null::jsonb) is not null
     or private.layaway_deadline_v1('null'::jsonb) is not null then
    raise exception 'LAYAWAY_NULL_DEADLINE_BEHAVIOR_CHANGED';
  end if;

  foreach v_value in array[
    '2026-2-4',
    '2026-02-30',
    '2026-13-01',
    '2026-09-04T00:00:00',
    '2026-09-04T25:00:00.000000Z',
    '2026-09-04T00:00:00.000000+24:00'
  ] loop
    begin
      perform private.layaway_deadline_v1(to_jsonb(v_value));
      raise exception 'LAYAWAY_INVALID_DEADLINE_ACCEPTED:%', v_value;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'FINANCIAL_TIMESTAMP_INVALID' then
        raise;
      end if;
    end;
  end loop;
end;
$test$;

rollback;
