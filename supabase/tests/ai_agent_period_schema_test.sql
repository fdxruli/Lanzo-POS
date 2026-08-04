-- OSS.1.5.4 AI period contract regression matrix.
-- Run after all migrations in one synthetic transaction. No real credentials,
-- license keys, devices, staff sessions, prompts, or provider data are used.

begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_pro_plan_id uuid;
  v_free_plan_id uuid;
  v_license_id uuid := extensions.gen_random_uuid();
  v_zero_license_id uuid := extensions.gen_random_uuid();
  v_staff_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_staff_device_id uuid := extensions.gen_random_uuid();
  v_staff_user_id uuid := extensions.gen_random_uuid();
  v_prior_period_id uuid := extensions.gen_random_uuid();
  v_other_period_id uuid := extensions.gen_random_uuid();
  v_period_id uuid;
  v_usage_id uuid;
  v_result jsonb;
  v_definition text;
  v_pro_key text := 'OSS154-PRO-' || v_suffix;
  v_zero_key text := 'OSS154-ZERO-' || v_suffix;
  v_staff_key text := 'OSS154-STAFF-' || v_suffix;
  v_pro_fingerprint text := 'oss154-pro-' || v_suffix;
  v_staff_fingerprint text := 'oss154-staff-' || v_suffix;
  v_pro_token text := 'oss154-pro-token-' || v_suffix;
  v_staff_token text := 'oss154-staff-token-' || v_suffix;
  v_staff_session text := 'oss154-staff-session-' || v_suffix;
  v_period_count integer;
begin
  -- 1, 2, 3, 8, 20: catalog and permission contract.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_agent_usage'
      and column_name = 'period_id'
      and udt_name = 'uuid'
      and is_nullable = 'YES'
  ) then
    raise exception 'AI_PERIOD_COLUMN_CONTRACT_FAILED';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_agent_usage_license_period_fkey'
      and conrelid = 'public.ai_agent_usage'::regclass
  ) then
    raise exception 'AI_PERIOD_COMPOSITE_FK_MISSING';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'license_periods'
      and indexname = 'uq_license_periods_one_active'
  ) then
    raise exception 'AI_PERIOD_ACTIVE_INDEX_MISSING';
  end if;

  select pg_get_functiondef(
    'public.ensure_current_license_period(uuid)'::regprocedure
  ) into v_definition;
  if position('SECURITY DEFINER' in upper(v_definition)) = 0
     or position('search_path' in lower(v_definition)) = 0 then
    raise exception 'AI_PERIOD_ENSURE_SECURITY_FAILED';
  end if;

  select pg_get_functiondef(
    'public.begin_ai_agent_analysis(text,text,text,text,text,jsonb)'::regprocedure
  ) into v_definition;
  if position('period_id' in v_definition) = 0
     or position('ensure_current_license_period' in v_definition) = 0 then
    raise exception 'AI_PERIOD_BEGIN_CONTRACT_FAILED';
  end if;

  select pg_get_functiondef(
    'public.get_ai_agent_usage(text,text,text,text)'::regprocedure
  ) into v_definition;
  if position('period_id' in v_definition) = 0
     or position('ensure_current_license_period' in v_definition) = 0 then
    raise exception 'AI_PERIOD_GET_CONTRACT_FAILED';
  end if;

  if has_table_privilege('anon', 'public.license_periods', 'select')
     or has_table_privilege('authenticated', 'public.license_periods', 'select') then
    raise exception 'AI_PERIOD_DIRECT_SELECT_GRANT_REMAINS';
  end if;

  if has_function_privilege('anon', 'public.ensure_current_license_period(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ensure_current_license_period(uuid)', 'execute')
     or has_function_privilege('anon', 'public.begin_ai_agent_analysis(text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_ai_agent_analysis(text,text,text,text,text,jsonb)', 'execute') then
    raise exception 'AI_PERIOD_INTERNAL_RPC_GRANT_REMAINS';
  end if;

  if not has_function_privilege('anon', 'public.get_ai_agent_usage(text,text,text,text)', 'execute') then
    raise exception 'AI_PERIOD_GET_PUBLIC_GRANT_MISSING';
  end if;

  -- 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14: period-scoped reservation.
  select id into v_pro_plan_id from public.plans where code = 'pro_monthly' limit 1;
  select id into v_free_plan_id from public.plans where code = 'free_trial' limit 1;
  if v_pro_plan_id is null or v_free_plan_id is null then
    raise exception 'AI_PERIOD_REQUIRED_PLANS_MISSING';
  end if;

  insert into public.licenses(
    id, license_key, plan_id, license_type, status, expires_at,
    max_devices, product_name, features
  ) values (
    v_license_id, v_pro_key, v_pro_plan_id, 'pro', 'active', now() + interval '1 day',
    1, 'OSS.1.5.4 synthetic Pro',
    jsonb_build_object('ai_agents', true, 'ai_agent_total_limit', 2)
  );

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    v_device_id, v_license_id, v_pro_fingerprint, v_pro_token, true, 'admin'
  );

  -- 11: a closed prior period must not contribute to the current count.
  insert into public.license_periods(
    id, license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, closed_at, ai_agent_limit
  ) values (
    v_prior_period_id, v_license_id, v_pro_plan_id, 'pro_monthly', 'Pro',
    'pro_paid', 'closed', now() - interval '3 months', now() - interval '2 months',
    now() - interval '2 months', 2
  );

  insert into public.ai_agent_usage(
    license_id, period_id, device_id, agent_type, status, created_at
  ) values (
    v_license_id, v_prior_period_id, v_device_id, 'prior', 'completed', now() - interval '70 days'
  );

  -- 5: ensure is idempotent and creates exactly one current period.
  v_period_id := public.ensure_current_license_period(v_license_id);
  if v_period_id is null then raise exception 'AI_PERIOD_CURRENT_MISSING'; end if;
  if public.ensure_current_license_period(v_license_id) <> v_period_id then
    raise exception 'AI_PERIOD_ENSURE_NOT_IDEMPOTENT';
  end if;
  select count(*) into v_period_count
  from public.license_periods
  where license_id = v_license_id and status = 'active';
  if v_period_count <> 1 then raise exception 'AI_PERIOD_ACTIVE_COUNT_FAILED: %', v_period_count; end if;

  -- 10 and 13: reservation stores period_id and reserved consumes provisionally.
  v_result := public.begin_ai_agent_analysis(v_pro_key, v_pro_fingerprint, v_pro_token);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or nullif(v_result->>'usage_id', '') is null
     or (v_result->>'period_id')::uuid <> v_period_id then
    raise exception 'AI_PERIOD_RESERVATION_FAILED: %', v_result;
  end if;
  v_usage_id := (v_result->>'usage_id')::uuid;

  if (select period_id from public.ai_agent_usage where id = v_usage_id) <> v_period_id then
    raise exception 'AI_PERIOD_USAGE_LINK_FAILED';
  end if;

  v_result := public.get_ai_agent_usage(v_pro_key, v_pro_fingerprint, v_pro_token);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result->>'used')::integer <> 1 then
    raise exception 'AI_PERIOD_RESERVED_COUNT_FAILED: %', v_result;
  end if;

  -- 12: failed does not consume a period limit.
  v_result := public.complete_ai_agent_analysis(v_usage_id, false);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'status' <> 'failed' then
    raise exception 'AI_PERIOD_FAILED_COMPLETION_FAILED: %', v_result;
  end if;
  v_result := public.get_ai_agent_usage(v_pro_key, v_pro_fingerprint, v_pro_token);
  if (v_result->>'used')::integer <> 0 then
    raise exception 'AI_PERIOD_FAILED_COUNTED';
  end if;

  -- 14: complete changes status only; it does not change period_id.
  v_result := public.begin_ai_agent_analysis(v_pro_key, v_pro_fingerprint, v_pro_token);
  v_usage_id := (v_result->>'usage_id')::uuid;
  v_result := public.complete_ai_agent_analysis(v_usage_id, true, 1, 2, 3);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select period_id from public.ai_agent_usage where id = v_usage_id) <> v_period_id then
    raise exception 'AI_PERIOD_COMPLETE_CHANGED_PERIOD';
  end if;

  -- 9: limit reached counts completed + reserved in the current period only.
  v_result := public.begin_ai_agent_analysis(v_pro_key, v_pro_fingerprint, v_pro_token);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'AI_PERIOD_SECOND_RESERVATION_FAILED: %', v_result;
  end if;
  v_result := public.begin_ai_agent_analysis(v_pro_key, v_pro_fingerprint, v_pro_token);
  if v_result->>'code' <> 'AI_AGENT_LIMIT_REACHED' then
    raise exception 'AI_PERIOD_LIMIT_REACHED_FAILED: %', v_result;
  end if;

  -- 8: zero disables the limit without accepting a reservation.
  insert into public.licenses(
    id, license_key, plan_id, license_type, status, expires_at,
    max_devices, product_name, features
  ) values (
    v_zero_license_id, v_zero_key, v_pro_plan_id, 'pro', 'active', now() + interval '1 day',
    1, 'OSS.1.5.4 synthetic zero',
    jsonb_build_object('ai_agents', true, 'ai_agent_total_limit', 0)
  );
  insert into public.license_devices(
    license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    v_zero_license_id, 'oss154-zero-' || v_suffix, 'oss154-zero-token-' || v_suffix, true, 'admin'
  );
  v_result := public.begin_ai_agent_analysis(
    v_zero_key, 'oss154-zero-' || v_suffix, 'oss154-zero-token-' || v_suffix
  );
  if v_result->>'code' <> 'AI_AGENT_LIMIT_DISABLED' then
    raise exception 'AI_PERIOD_ZERO_LIMIT_FAILED: %', v_result;
  end if;

  -- 6: FREE lifetime is represented as trial, active, no end, zero AI limit.
  insert into public.licenses(
    id, license_key, plan_id, license_type, status, expires_at,
    max_devices, product_name, features
  ) values (
    extensions.gen_random_uuid(), 'OSS154-FREE-' || v_suffix, v_free_plan_id,
    'free', 'active', null, 1, 'OSS.1.5.4 synthetic Free',
    jsonb_build_object('ai_agents', false)
  );
  v_result := jsonb_build_object('period_id', public.ensure_current_license_period(
    (select id from public.licenses where license_key = 'OSS154-FREE-' || v_suffix)
  ));
  if not exists (
    select 1
    from public.license_periods p
    where p.id = (v_result->>'period_id')::uuid
      and p.period_type = 'trial'
      and p.status = 'active'
      and p.ends_at is null
      and p.ai_agent_limit = 0
  ) then
    raise exception 'AI_PERIOD_FREE_LIFETIME_FAILED: %', v_result;
  end if;

  -- 4 and 17: a period cannot be attached to another license.
  begin
    insert into public.ai_agent_usage(license_id, period_id, agent_type, status)
    values (v_zero_license_id, v_period_id, 'cross-license', 'reserved');
    raise exception 'AI_PERIOD_CROSS_LICENSE_ACCEPTED';
  exception when foreign_key_violation then
    null;
  end;

  -- 18: staff session remains device- and license-bound.
  insert into public.licenses(
    id, license_key, plan_id, license_type, status, expires_at,
    max_devices, product_name, features
  ) values (
    v_staff_license_id, v_staff_key, v_pro_plan_id, 'pro', 'active', now() + interval '1 day',
    1, 'OSS.1.5.4 synthetic staff',
    jsonb_build_object('ai_agents', true, 'ai_agent_total_limit', 1)
  );
  insert into public.license_staff_users(
    id, license_id, username, display_name, password_hash
  ) values (
    v_staff_user_id, v_staff_license_id, 'oss154_staff_' || v_suffix,
    'OSS.1.5.4 staff', extensions.crypt('synthetic-password', extensions.gen_salt('bf'))
  );
  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role, staff_user_id
  ) values (
    v_staff_device_id, v_staff_license_id, v_staff_fingerprint, v_staff_token, true, 'staff', v_staff_user_id
  );
  insert into public.license_staff_sessions(
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_staff_license_id, v_staff_user_id, v_staff_device_id,
    extensions.crypt(v_staff_session, extensions.gen_salt('bf')), now() + interval '1 hour'
  );
  v_result := public.begin_ai_agent_analysis(v_staff_key, v_staff_fingerprint, v_staff_token, 'wrong-session');
  if v_result->>'code' <> 'STAFF_SESSION_INVALID' then
    raise exception 'AI_PERIOD_STAFF_SESSION_FAILED: %', v_result;
  end if;
  v_result := public.begin_ai_agent_analysis(v_staff_key, v_staff_fingerprint, v_staff_token, v_staff_session);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'AI_PERIOD_STAFF_RESERVATION_FAILED: %', v_result;
  end if;

  -- 19: the device token is mandatory and bound to the device.
  v_result := public.begin_ai_agent_analysis(v_pro_key, v_pro_fingerprint, 'wrong-token');
  if v_result->>'code' <> 'DEVICE_TOKEN_INVALID' then
    raise exception 'AI_PERIOD_DEVICE_TOKEN_FAILED: %', v_result;
  end if;

  -- 15 and 16: migration backfill keeps nullable legacy rows and records
  -- unmatched/ambiguous cases in metadata; the catalog must permit that state.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_agent_usage'
      and column_name = 'period_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'AI_PERIOD_LEGACY_NULLABILITY_REMOVED';
  end if;
end;
$test$;

rollback;
