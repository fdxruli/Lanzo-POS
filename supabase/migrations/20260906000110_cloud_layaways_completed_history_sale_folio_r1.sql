-- Adds the operational POS folio to the already-authorized final-sales
-- history payload. No business rows, financial state, or historical migration
-- are modified. The underlying unlimited function remains the authority for
-- actor, license, device, staff scope, and tenant isolation.

begin;

create or replace function public.pos_get_sales_final_history(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_scope text default 'mine',
  p_staff_user_id uuid default null,
  p_device_id uuid default null,
  p_cash_session_id text default null,
  p_customer_id text default null,
  p_product_id text default null,
  p_category_id text default null,
  p_status text default null,
  p_payment_method text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_license_id uuid;
  v_history jsonb;
  v_rows jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := $1,
    p_device_fingerprint := $2,
    p_staff_session_token := $4,
    p_rpc_name := 'pos_get_sales_final_history',
    p_scope := 'POS_READ_HEAVY',
    p_max_attempts := 30,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'REPORT_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
  end if;

  -- This call validates the requested scope against the canonical actor
  -- context before any row is returned. The browser-provided p_scope is never
  -- treated as an authorization grant.
  v_history := public.pos_get_sales_final_history_unlimited(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  );

  if coalesce((v_history->>'success')::boolean, false) is false then
    return v_history;
  end if;

  v_context := private.validate_pos_sync_context($1, $2, $3, $4);
  v_license_id := (v_context->>'license_id')::uuid;

  -- Decorate only rows the unlimited function already selected. This is an
  -- explicit scalar allowlist; it never serializes a pos_sales row.
  select coalesce(
    jsonb_agg(
      case
        when s.pos_folio is null then row_data
        else row_data || jsonb_build_object('pos_folio', s.pos_folio)
      end
      order by ordinal
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_history->'rows', '[]'::jsonb))
       with ordinality as history_row(row_data, ordinal)
  join public.pos_sales s
    on s.license_id = v_license_id
   and s.id = history_row.row_data->>'id';

  return v_history || jsonb_build_object(
    'rows', v_rows,
    'sales', v_rows
  );
end;
$function$;

commit;
