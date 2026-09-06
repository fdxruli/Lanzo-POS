-- CLOUD LAYAWAYS READ RPC TRANSACTION MODE R1
-- Run in an isolated test database after the migration is applied.
-- This test is metadata-only; it does not create fixtures or mutate data.

begin;

do $test$
declare
  v_function record;
  v_signature text;
begin
  for v_signature in
    select unnest(array[
      'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_layaway_id text',
      'p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_since_change_seq bigint, p_limit integer'
    ])
  loop
    select
      n.nspname,
      p.proname,
      p.provolatile,
      p.prosecdef,
      p.proconfig,
      pg_get_functiondef(p.oid) as definition
    into v_function
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = case
        when v_signature like '%p_layaway_id text' then 'pos_get_layaway'
        else 'pos_pull_layaway_changes'
      end
      and pg_get_function_identity_arguments(p.oid) = v_signature;

    if v_function.proname is null then
      raise exception 'READ_RPC_NOT_FOUND';
    end if;
    if v_function.provolatile <> 'v' then
      raise exception 'READ_RPC_MUST_BE_VOLATILE';
    end if;
    if v_function.prosecdef is not true then
      raise exception 'READ_RPC_SECURITY_DEFINER_REGRESSION';
    end if;
    if not ('search_path=""' = any(coalesce(v_function.proconfig, array[]::text[]))) then
      raise exception 'READ_RPC_SEARCH_PATH_REGRESSION';
    end if;
    if position('private.validate_pos_sync_context(' in v_function.definition) = 0 then
      raise exception 'READ_RPC_AUTH_CONTEXT_REGRESSION';
    end if;
    if position('private.assert_cloud_layaways_enabled(' in v_function.definition) = 0
       or position('private.assert_pos_permission(v_context, ''pos'')' in v_function.definition) = 0 then
      raise exception 'READ_RPC_AUTHORIZATION_REGRESSION';
    end if;
    if position('to_jsonb(' in lower(v_function.definition)) > 0
       or position('row_to_json(' in lower(v_function.definition)) > 0 then
      raise exception 'READ_RPC_ALLOWLIST_REGRESSION';
    end if;
    if v_function.proname = 'pos_get_layaway' then
      if has_function_privilege(
           'anon',
           'public.pos_get_layaway(text,text,text,text,text)',
           'EXECUTE'
         ) is not true
         or has_function_privilege(
           'authenticated',
           'public.pos_get_layaway(text,text,text,text,text)',
           'EXECUTE'
         ) is not true then
        raise exception 'READ_RPC_GRANT_REGRESSION';
      end if;
    elsif has_function_privilege(
            'anon',
            'public.pos_pull_layaway_changes(text,text,text,text,bigint,integer)',
            'EXECUTE'
          ) is not true
          or has_function_privilege(
            'authenticated',
            'public.pos_pull_layaway_changes(text,text,text,text,bigint,integer)',
            'EXECUTE'
          ) is not true then
      raise exception 'READ_RPC_GRANT_REGRESSION';
    end if;
  end loop;
end;
$test$;

rollback;
