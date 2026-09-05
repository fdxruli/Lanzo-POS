-- CLOUD LAYAWAYS NUMERIC DECIMAL VALIDATION R1
--
-- The historical helper accidentally handed PostgreSQL's regex engine a
-- backslash-escaped dot. With standard_conforming_strings enabled, that
-- pattern does not match ordinary decimal values such as 20.00. Replace only
-- the helper so the existing financial boundary and all downstream guards stay
-- unchanged.

begin;

create or replace function private.layaway_request_numeric_v1(
  p_payload jsonb,
  p_keys text[],
  p_default numeric default null
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_key text;
  v_value text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return p_default;
  end if;

  foreach v_key in array p_keys loop
    v_value := nullif(btrim(coalesce(p_payload->>v_key, '')), '');
    if v_value is not null then
      if v_value !~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$' then
        raise exception 'LAYAWAY_NUMERIC_INVALID:%', v_key using errcode = 'P0001';
      end if;
      return v_value::numeric;
    end if;
  end loop;

  return p_default;
end;
$function$;

commit;
