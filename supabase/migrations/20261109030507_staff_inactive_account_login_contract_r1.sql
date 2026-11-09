-- Migration version: 20261109030507
-- Patch the installed Staff login credential gate while preserving the existing
-- rate limiter, device checks, sessions, permissions, grants, and RLS behavior.
-- SHA-256 is recorded in the associated Draft PR description.

do $staff_inactive_account_contract$
declare
  v_signature constant text := 'public.staff_login_on_device_unlimited(text,text,text,jsonb,text,text)';
  v_definition text;
  v_replaced text;
  v_user_active_filter constant text := 'and s.is_active = true';
  v_credential_gate_start constant text := 'if v_staff_user.id is null';
  v_credential_gate_end constant text := 'end if;';
  v_replacement_gate constant text := trim(both E'\n' from $replacement_gate$
  if v_staff_user.id is null then
    perform extensions.crypt(
      coalesce(p_password, ''),
      extensions.gen_salt('bf', 12)
    );
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_STAFF_CREDENTIALS',
      'message', 'Usuario o contraseña incorrectos.'
    );
  end if;

  if extensions.crypt(coalesce(p_password, ''), v_staff_user.password_hash) <> v_staff_user.password_hash then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_STAFF_CREDENTIALS',
      'message', 'Usuario o contraseña incorrectos.'
    );
  end if;

  if v_staff_user.is_active is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_ACCOUNT_INACTIVE',
      'message', 'Esta cuenta de personal está desactivada. Solicita al administrador que la habilite para poder ingresar.'
    );
  end if;
$replacement_gate$);
  v_occurrences integer;
  v_credential_gate_at integer;
  v_gate_end_relative integer;
  v_gate_end_at integer;
  v_user_query_at integer;
  v_password_check_at integer;
  v_inactive_result_at integer;
  v_device_check_at integer;
  v_login_wrapper text;
begin
  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'STAFF_LOGIN_UNLIMITED_MISSING' using errcode = 'P0001';
  end if;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_user_active_filter, ''))
  ) / length(v_user_active_filter);
  if v_occurrences <> 1 then
    raise exception 'STAFF_LOGIN_ACTIVE_FILTER_UNEXPECTED' using errcode = 'P0001';
  end if;
  v_replaced := replace(v_definition, v_user_active_filter, '');

  v_occurrences := (
    length(v_replaced) - length(replace(v_replaced, v_credential_gate_start, ''))
  ) / length(v_credential_gate_start);
  if v_occurrences <> 1 then
    raise exception 'STAFF_LOGIN_CREDENTIAL_GATE_UNEXPECTED' using errcode = 'P0001';
  end if;

  v_credential_gate_at := position(v_credential_gate_start in v_replaced);
  v_gate_end_relative := position(
    v_credential_gate_end in substring(v_replaced from v_credential_gate_at)
  );
  if v_gate_end_relative = 0 then
    raise exception 'STAFF_LOGIN_CREDENTIAL_GATE_END_MISSING' using errcode = 'P0001';
  end if;

  v_gate_end_at := v_credential_gate_at + v_gate_end_relative + length(v_credential_gate_end) - 1;
  v_replaced :=
    substring(v_replaced from 1 for v_credential_gate_at - 1)
    || v_replacement_gate
    || substring(v_replaced from v_gate_end_at + 1);

  execute v_replaced;

  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;
  select pg_get_functiondef(
    'public.staff_login_on_device(text,text,text,jsonb,text,text)'::regprocedure
  ) into v_login_wrapper;

  v_user_query_at := position('select s.* into v_staff_user' in v_definition);
  v_password_check_at := position(
    'extensions.crypt(coalesce(p_password, ''''), v_staff_user.password_hash) <> v_staff_user.password_hash'
    in v_definition
  );
  v_inactive_result_at := position('STAFF_ACCOUNT_INACTIVE' in v_definition);
  v_device_check_at := position('select * into v_device' in v_definition);

  if v_user_query_at = 0
     or v_password_check_at <= v_user_query_at
     or v_inactive_result_at <= v_password_check_at
     or v_device_check_at <= v_inactive_result_at
     or position('and s.is_active = true' in substring(v_definition from v_user_query_at for v_device_check_at - v_user_query_at)) > 0
     or position('STAFF_LOGIN_RATE_LIMITED' in v_login_wrapper) = 0
     or position('staff_login_on_device_unlimited' in v_login_wrapper) = 0 then
    raise exception 'STAFF_LOGIN_INACTIVE_POSTCONDITION_FAILED' using errcode = 'P0001';
  end if;
end;
$staff_inactive_account_contract$;
