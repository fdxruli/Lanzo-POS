-- Run after installing the canonical Stage 2 migration in an authorized QA environment.
-- This file performs only catalog assertions. Positive/negative live credential
-- tests (owner, staff, other license) require authorized test sessions.
begin;

do $test$
declare
  v_rpc oid := to_regprocedure('public.pos_get_sync_conflict_diagnostics_v1(text,text,text,text)');
  v_def text;
  v_settings text[];
begin
  if v_rpc is null then
    raise exception 'SYNC-DIAG-11: Cloud diagnostic RPC is not installed';
  end if;

  select pg_get_functiondef(p.oid), p.proconfig
  into v_def, v_settings
  from pg_proc p where p.oid = v_rpc;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_rpc and p.prosecdef and p.provolatile = 's'
  ) then
    raise exception 'SYNC-DIAG: must be STABLE SECURITY DEFINER';
  end if;

  if not ('search_path=""' = any(v_settings)) then
    raise exception 'SYNC-DIAG: unsafe function search_path';
  end if;

  if not has_function_privilege('anon', v_rpc, 'EXECUTE')
     or not has_function_privilege('authenticated', v_rpc, 'EXECUTE') then
    raise exception 'SYNC-DIAG: expected RPC client EXECUTE grants';
  end if;

  if has_table_privilege('anon', 'public.pos_sync_conflicts', 'SELECT')
     or has_table_privilege('authenticated', 'public.pos_sync_conflicts', 'SELECT') then
    raise exception 'SYNC-DIAG-05: direct conflict table read grant exposed';
  end if;

  if position('candidate.expires_at > now()' in v_def) = 0
     or position('a.is_owner is true' in v_def) = 0
     or position('c.license_id = v_license_id' in v_def) = 0
     or position('c.resolved_at is null' in v_def) = 0 then
    raise exception 'SYNC-DIAG: owner/tenant/pending guard missing';
  end if;

  if position('local_payload' in v_def) > 0 or position('server_payload' in v_def) > 0
     or position('resolved_payload' in v_def) > 0 then
    raise exception 'SYNC-DIAG-05: sensitive payload referenced in API';
  end if;
end;
$test$;
rollback;
