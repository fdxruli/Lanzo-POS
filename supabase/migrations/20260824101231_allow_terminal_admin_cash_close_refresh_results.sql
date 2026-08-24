-- Allow the two administrative-close review outcomes to become durable V1
-- receipts. They are terminal, non-closing business responses that tell the
-- caller to refresh before submitting a new K/H request. Every other
-- success=false legacy response remains rejected and rolls back atomically.
begin;

create or replace function private.assert_financial_legacy_result_terminal_v1(
  p_operation_type text,
  p_response jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare v_code text;
begin
  if jsonb_typeof(p_response) <> 'object' then
    raise exception 'FINANCIAL_LEGACY_RESPONSE_INVALID' using errcode = 'P0001';
  end if;
  v_code := nullif(btrim(p_response->>'code'), '');
  if v_code = 'IDEMPOTENCY_PROCESSING' then
    raise exception 'FINANCIAL_LEGACY_RESPONSE_NONTERMINAL' using errcode = 'P0001';
  end if;
  if (p_response->>'success')::boolean is not true then
    if p_response->'success' = 'false'::jsonb
       and p_operation_type = 'cash.admin_close'
       and v_code in ('VERSION_CONFLICT', 'CASH_TOTALS_CHANGED') then
      return;
    end if;
    raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%', coalesce(v_code, 'SUCCESS_FALSE') using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.assert_financial_legacy_result_terminal_v1(text, jsonb) from public, anon, authenticated;

commit;
