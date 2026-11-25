-- Advertise the Block 2 keyset snapshot RPCs only after the complete set is
-- installed. Older clients keep seeing the original protocol contract.
begin;

create or replace function public.pos_fin01_sync_contract_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_requested_contract integer default 2,
  p_capabilities text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_policy jsonb;
  v_snapshots_installed boolean;
  v_capabilities jsonb := jsonb_build_array(
    'historical_credit_preservation_v1',
    'customer_projection_safe_apply_v1',
    'financial_operation_result_v1'
  );
  v_families jsonb := jsonb_build_array(
    'customer_directory', 'customer_credit', 'financial_operations'
  );
  v_endpoints jsonb := jsonb_build_array(
    'pos_upsert_customer_v2', 'pos_delete_customer_v2', 'pos_migrate_local_customers_v2',
    'pos_pull_customers_snapshot_v2', 'pos_pull_customer_changes_v2',
    'pos_get_customer_credit_summary_v2', 'pos_pull_customer_credit_snapshot_v2',
    'pos_pull_customer_credit_changes_v2', 'pos_record_customer_payment_v2',
    'pos_execute_financial_operation_v2', 'pos_get_financial_operation_receipt_v2'
  );
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_fin01_sync_contract_v1', 'SYNC_PULL', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    raise exception 'RPC_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_requested_contract is distinct from 2 then
    return jsonb_build_object(
      'contract_version', 2,
      'server_status', 'UPDATE_REQUIRED',
      'tenant_id', v_license_id,
      'requested_contract', p_requested_contract,
      'required_contract', 2
    );
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:' || v_license_id::text, 0));
  select to_jsonb(p) into v_policy
    from private.pos_fin01_qa_pilots_v2 p
   where license_id = v_license_id
   for share;

  if coalesce((v_policy->>'protocol')::integer, 1) <> 2 then
    if nullif(v_policy->>'activated_at', '') is null then
      return jsonb_build_object(
        'contract_version', 2,
        'server_status', 'UPDATE_REQUIRED',
        'tenant_id', v_license_id,
        'active_protocol', 1,
        'reason', 'QA_PILOT_NOT_ENABLED'
      );
    end if;
    return jsonb_build_object(
      'contract_version', 2,
      'server_status', 'SUPPORTED',
      'tenant_id', v_license_id,
      'active_protocol', 1,
      'mode', 'RECOVERY_ONLY',
      'capabilities', v_capabilities,
      'endpoint_families', jsonb_build_array('financial_operations'),
      'endpoints', jsonb_build_array('pos_get_financial_operation_receipt_v2')
    );
  end if;

  v_snapshots_installed :=
    to_regprocedure('public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb)') is not null
    and to_regprocedure('public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb)') is not null
    and to_regprocedure('public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb)') is not null
    and to_regprocedure('public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz)') is not null
    and to_regprocedure('public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb)') is not null;

  if v_snapshots_installed then
    v_capabilities := v_capabilities || jsonb_build_array('snapshot_keyset_reference_v1');
    v_families := v_families || jsonb_build_array('product_catalog', 'sales', 'cash_register');
    v_endpoints := v_endpoints || jsonb_build_array(
      'pos_pull_product_catalog_snapshot_v2',
      'pos_pull_customers_snapshot_v3',
      'pos_pull_customer_credit_snapshot_v3',
      'pos_pull_sales_snapshot_v2',
      'pos_pull_cash_snapshot_v2'
    );
  end if;

  return jsonb_build_object(
    'contract_version', 2,
    'server_status', 'SUPPORTED',
    'tenant_id', v_license_id,
    'capabilities', v_capabilities,
    'endpoint_families', v_families,
    'endpoints', v_endpoints
  );
end;
$function$;

alter function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) owner to postgres;
revoke all on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) from public;
grant execute on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) to anon, authenticated;

comment on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) is
  'FIN-01 protocol discovery; snapshot capability and RPCs are advertised only when all Block 2 snapshot endpoints are installed.';

commit;
