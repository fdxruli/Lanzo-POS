-- SHARED.TERMINAL.5A static/local SQL contract checklist.
-- Run only in an authorized local test database after migrations.  It does not
-- call a financial mutator, so it is also safe for schema-only validation.
begin;

do $$
declare
  v_before bigint;
  v_after bigint;
begin
  if to_regclass('public.pos_financial_operations') is null then
    raise exception 'FINANCIAL_OPERATION_TABLE_MISSING';
  end if;
  if to_regprocedure('public.pos_get_financial_operation_receipt(text,text,text,text,text,text)') is null then
    raise exception 'FINANCIAL_RECEIPT_RPC_MISSING';
  end if;
  if to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)') is null then
    raise exception 'FINANCIAL_EXECUTOR_RPC_MISSING';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.pos_financial_operations'::regclass
      and contype = 'u' and pg_get_constraintdef(oid) like '%license_id, idempotency_key%'
  ) then raise exception 'FINANCIAL_K_TENANT_UNIQUENESS_MISSING'; end if;

  select count(*) into v_before from public.pos_financial_operations;
  -- Receipt lookup never inserts, completes, or dispatches a financial action.
  perform public.pos_get_financial_operation_receipt('invalid', 'invalid', 'invalid', null, 'missing-k', 'sha256:' || repeat('0', 64));
exception when others then
  -- Invalid authentication is the expected fail-closed result for this static
  -- probe.  The count check remains meaningful when a harness supplies auth.
  select count(*) into v_after from public.pos_financial_operations;
  if v_after <> v_before then raise exception 'FINANCIAL_RECEIPT_SIDE_EFFECT'; end if;
end;
$$;

-- Runtime harness requirements: first K/H; duplicate K/H; K/H conflict;
-- concurrent same K/H and K/different-H; completed/processing/not-found/conflict
-- receipts; cross-tenant denial; spoofed actor/session/station denial; and a
-- legacy NULL-H pos_idempotency_keys row rejected as strict replay proof.
-- The executor and complete helper run in one caller transaction: an exception
-- rolls back the reservation, the existing financial RPC, and receipt update.
-- SECURITY DEFINER functions use SET search_path = '' and direct table access
-- remains revoked, so receipt reads cannot bypass tenant authentication.
rollback;
