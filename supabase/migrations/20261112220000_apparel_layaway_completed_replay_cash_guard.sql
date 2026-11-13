-- Stage 3B: a completed Cloud layaway charge may replay its authoritative receipt
-- after its original cash session closes. New financial effects still require
-- that same session to be open; no cash, inventory or balance rows are rewritten.
-- This transformation is intentionally anchored to the exact reviewed
-- Production definitions: abort atomically if either dispatcher drifts.
-- Applies independently of the not-yet-activated business deadline guard.
begin;

do $stage3b$
declare
  v_identity text;
  v_expected_md5 text;
  v_definition text;
  v_newline text;
  v_open_guard text;
  v_replay_anchor text;
  v_deferred_guard text;
  v_acl_before aclitem[];
  v_owner_before oid;
  v_config_before text[];
  v_security_before boolean;
  v_oid oid;
begin
  for v_identity, v_expected_md5 in
    select * from (values
      ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
        'd0940c3da4d4a8346be12962ffeb7284'),
      ('private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)',
        '85a8ee90ae77b0267b952a724c4a53bc')
    ) as expected(identity, md5_without_cr)
  loop
    v_oid := to_regprocedure(v_identity);
    if v_oid is null then
      raise exception 'LAYAWAY_3B_DISPATCHER_MISSING: %', v_identity using errcode = 'P0001';
    end if;
    select p.proacl, p.proowner, p.proconfig, p.prosecdef
      into v_acl_before, v_owner_before, v_config_before, v_security_before
      from pg_catalog.pg_proc p where p.oid = v_oid;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if md5(replace(v_definition, chr(13), '')) is distinct from v_expected_md5 then
      raise exception 'LAYAWAY_3B_DISPATCHER_DRIFT: %', v_identity using errcode = 'P0001';
    end if;

    v_newline := case when strpos(v_definition, chr(13) || chr(10)) > 0
      then chr(13) || chr(10) else chr(10) end;
    v_open_guard :=
      '      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> ''open'' then' || v_newline ||
      '        raise exception ''CASH_SESSION_NOT_OPEN'' using errcode = ''P0001'';' || v_newline ||
      '      end if;' || v_newline;
    v_replay_anchor :=
      '  v_internal_idempotency_key := v_operation.legacy_idempotency_key;' || v_newline;
    if length(v_definition) - length(replace(v_definition, v_open_guard, '')) <> length(v_open_guard)
       or length(v_definition) - length(replace(v_definition, v_replay_anchor, '')) <> length(v_replay_anchor) then
      raise exception 'LAYAWAY_3B_GUARD_ANCHOR_MISMATCH: %', v_identity using errcode = 'P0001';
    end if;

    v_deferred_guard :=
      '  -- Completed K/H receipt recovery already returned above, after origin/hash checks.' || v_newline ||
      '  -- The cash-session row was locked earlier; new layaway effects still need it open.' || v_newline ||
      '  if p_operation_type in (''layaway.create'', ''layaway.payment'', ''layaway.cancel'')' || v_newline ||
      '     and v_cash_session_id is not null' || v_newline ||
      '     and (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> ''open'' then' || v_newline ||
      '    raise exception ''CASH_SESSION_NOT_OPEN'' using errcode = ''P0001'';' || v_newline ||
      '  end if;' || v_newline || v_newline;
    v_definition := replace(v_definition, v_open_guard, '');
    v_definition := replace(v_definition, v_replay_anchor, v_deferred_guard || v_replay_anchor);
    execute v_definition;

    -- CREATE OR REPLACE must not alter authority, grants or security settings.
    if not exists (
      select 1 from pg_catalog.pg_proc p where p.oid = v_oid
        and p.proacl is not distinct from v_acl_before
        and p.proowner = v_owner_before
        and p.proconfig is not distinct from v_config_before
        and p.prosecdef = v_security_before
    ) then
      raise exception 'LAYAWAY_3B_DISPATCHER_AUTHORITY_CHANGED: %', v_identity using errcode = 'P0001';
    end if;
  end loop;
end;
$stage3b$;

commit;
