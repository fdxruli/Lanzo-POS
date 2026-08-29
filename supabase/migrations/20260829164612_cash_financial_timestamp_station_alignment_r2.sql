-- CASH FINANCIAL TIMESTAMP/STATION ALIGNMENT R2
-- Forward-only replacement for the shared timestamp normalizer.  The
-- signature, owner and existing ACLs are preserved by CREATE OR REPLACE.
begin;

create or replace function private.financial_timestamp_v1(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;

  if (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'FINANCIAL_TIMESTAMP_INVALID' using errcode = 'P0001';
  end if;

  return to_char(
    ((p_value #>> '{}')::timestamptz at time zone 'UTC'),
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  );
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'FINANCIAL_TIMESTAMP_INVALID' using errcode = 'P0001';
end;
$$;

commit;
