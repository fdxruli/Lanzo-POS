-- CLOUD LAYAWAYS FINANCIAL TIMESTAMP NORMALIZATION R1
--
-- The layaway deadline is a domain date when it arrives from the HTML
-- date-picker.  Keep financial_timestamp_v1 strict for real financial
-- timestamps and normalize a validated date-only value to the existing UTC
-- midnight representation used by the timestamptz deadline column.
begin;

create or replace function private.layaway_deadline_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_raw text;
begin
  v_raw := private.financial_text_v1(p_value);
  if v_raw is null then
    return null;
  end if;

  -- Use an explicit digit class.  The previous \\d spelling was over-escaped
  -- in the SQL string and failed to recognize HTML date-picker values.
  if v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    -- financial_timestamp_v1 performs the strict calendar validation, so
    -- impossible dates such as 2026-02-30 are rejected instead of normalized.
    return private.financial_timestamp_v1(to_jsonb(v_raw || 'T00:00:00.000000Z'));
  end if;

  -- Full timestamps remain subject to the existing strict financial contract:
  -- ISO date/time, explicit timezone, valid calendar fields, and UTC output.
  return private.financial_timestamp_v1(to_jsonb(v_raw));
end;
$function$;

commit;
