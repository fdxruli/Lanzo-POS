-- LICENSE.IDENTITY.1
-- Neutral, plan-independent license identity for Lanzo businesses.
--
-- Contract:
-- - New licenses use LANZO-XXXX-XXXX-XXXX-XXXX.
-- - The key never encodes Free/Trial/Pro state.
-- - Existing keys remain valid and are not rewritten.
-- - plans.code = 'free_trial' and license_periods.period_type = 'trial' remain
--   internal compatibility values in this phase because the PRO->Free lifecycle
--   still depends on them.
-- - create_free_trial_license remains as a backwards-compatible RPC alias.

create or replace function public.create_free_license_unlimited(
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  existing_count integer;
  new_license_id uuid;
  new_key text;
  v_key_payload text;
  free_plan record;
  v_security_token text;
  v_period_id uuid;
  v_now timestamptz := now();
  v_effective_features jsonb;
  free_features jsonb := jsonb_build_object(
    'full_access', true,
    'max_rubros', 1,
    'allowed_rubros', jsonb_build_array('*'),
    'realtime_license_sync', false,
    'staff_roles', false,
    'cloud_pos_sync', false,
    'cloud_cash_sync', false,
    'cloud_products_sync', false,
    'cloud_reports_sync', false,
    'restaurant_orders_cloud', false,
    'ai_agents', false
  );
  attempts integer := 0;
begin
  if device_fingerprint_param is null or length(trim(device_fingerprint_param)) < 8 then
    return jsonb_build_object('success', false, 'error', 'DEVICE_FINGERPRINT_INVALID');
  end if;

  select count(*) into existing_count
    from public.license_devices
   where device_fingerprint = device_fingerprint_param;

  if existing_count > 0 then
    return jsonb_build_object(
      'success',
      false,
      'error',
      'Este dispositivo ya ha utilizado una licencia anteriormente.'
    );
  end if;

  -- Compatibility boundary. The public identity is now neutral, while the
  -- current lifecycle continues to use free_trial as its internal plan code.
  select * into free_plan
    from public.plans
   where code = 'free_trial'
     and is_active = true
   limit 1;

  if free_plan.id is null then
    return jsonb_build_object('success', false, 'error', 'FREE_PLAN_NOT_AVAILABLE');
  end if;

  loop
    attempts := attempts + 1;
    v_key_payload := upper(encode(extensions.gen_random_bytes(8), 'hex'));
    new_key :=
      'LANZO-' ||
      substr(v_key_payload, 1, 4) || '-' ||
      substr(v_key_payload, 5, 4) || '-' ||
      substr(v_key_payload, 9, 4) || '-' ||
      substr(v_key_payload, 13, 4);

    begin
      insert into public.licenses (
        license_key,
        plan_id,
        license_type,
        max_devices,
        duration_months,
        status,
        expires_at,
        is_lifetime,
        product_name,
        features
      ) values (
        new_key,
        free_plan.id,
        'free',
        1,
        null,
        'active',
        null,
        true,
        'Lanzo POS Free',
        free_features
      ) returning id into new_license_id;

      exit;
    exception when unique_violation then
      if attempts >= 5 then
        return jsonb_build_object('success', false, 'error', 'LICENSE_KEY_GENERATION_FAILED');
      end if;
    end;
  end loop;

  -- period_type='trial' is intentionally retained for lifecycle compatibility
  -- in this phase. license_kind is the canonical semantic value.
  insert into public.license_periods (
    license_id,
    plan_id,
    plan_code_snapshot,
    plan_name_snapshot,
    period_type,
    status,
    starts_at,
    ends_at,
    ai_agent_limit,
    metadata
  ) values (
    new_license_id,
    free_plan.id,
    free_plan.code,
    free_plan.name,
    'trial',
    'active',
    v_now,
    null,
    0,
    jsonb_build_object(
      'source', 'create_free_license',
      'license_kind', 'free_lifetime',
      'license_type', 'free',
      'is_lifetime', true,
      'expires_at', null,
      'identity_version', 'LANZO.IDENTITY.1'
    )
  ) returning id into v_period_id;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      last_check_at,
      device_role
    ) values (
      new_license_id,
      device_fingerprint_param,
      device_name_param,
      coalesce(device_info_param, '{}'::jsonb),
      true,
      v_security_token,
      now(),
      'admin'
    );
  exception when unique_violation then
    delete from public.licenses where id = new_license_id;
    return jsonb_build_object(
      'success',
      false,
      'error',
      'Este dispositivo ya ha utilizado una licencia anteriormente.'
    );
  end;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (
    new_license_id,
    device_fingerprint_param,
    'CREATE_FREE_LICENSE',
    coalesce(device_info_param, '{}'::jsonb) || jsonb_build_object(
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null,
      'identity_version', 'LANZO.IDENTITY.1'
    )
  );

  insert into public.license_events (license_key, event_type, metadata)
  values (
    new_key,
    'FREE_LICENSE_CREATED',
    jsonb_build_object(
      'fingerprint', device_fingerprint_param,
      'created_at', v_now,
      'period_id', v_period_id,
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null,
      'identity_version', 'LANZO.IDENTITY.1'
    )
  );

  insert into public.license_events (license_key, event_type, metadata)
  values (
    new_key,
    'PERIOD_CREATED',
    jsonb_build_object(
      'source', 'create_free_license',
      'period_id', v_period_id,
      'starts_at', v_now,
      'ends_at', null,
      'ai_agent_limit', 0,
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null,
      'identity_version', 'LANZO.IDENTITY.1'
    )
  );

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
    into v_effective_features
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.id = new_license_id;

  return jsonb_build_object(
    'success', true,
    'license_key', new_key,
    'expires_at', null,
    'is_lifetime', true,
    'license_type', 'free',
    'license_kind', 'free_lifetime',
    'identity_version', 'LANZO.IDENTITY.1',
    'features', v_effective_features,
    'product_name', 'Lanzo POS Free',
    'max_devices', 1,
    'plan_code', free_plan.code,
    'plan_name', free_plan.name,
    'period_id', v_period_id,
    'period_start', v_now,
    'period_end', null,
    'device_security_token', v_security_token,
    'security_token', v_security_token,
    'device_role', 'admin',
    'details', jsonb_build_object(
      'license_key', new_key,
      'expires_at', null,
      'is_lifetime', true,
      'license_type', 'free',
      'license_kind', 'free_lifetime',
      'identity_version', 'LANZO.IDENTITY.1',
      'features', v_effective_features,
      'product_name', 'Lanzo POS Free',
      'max_devices', 1,
      'plan_code', free_plan.code,
      'plan_name', free_plan.name,
      'period_id', v_period_id,
      'period_start', v_now,
      'period_end', null,
      'security_token', v_security_token,
      'token', v_security_token,
      'device_role', 'admin'
    )
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'FREE_LICENSE_CREATION_FAILED');
end;
$function$;

create or replace function public.create_free_license(
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate_limit jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := '__free_license_creation__',
    p_device_fingerprint := device_fingerprint_param,
    p_staff_session_token := null,
    p_rpc_name := 'create_free_license',
    p_scope := 'AUTH_LICENSE',
    p_max_attempts := 3,
    p_window_seconds := 86400,
    p_block_seconds := 86400,
    p_code := 'LICENSE_ACTIVATION_RATE_LIMITED',
    p_metadata := jsonb_build_object('identity_version', 'LANZO.IDENTITY.1')
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
  end if;

  return public.create_free_license_unlimited(
    device_fingerprint_param,
    device_name_param,
    device_info_param
  );
end;
$function$;

-- Backwards compatibility for installed clients that still use the old RPC name.
create or replace function public.create_free_trial_license(
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return public.create_free_license(
    device_fingerprint_param,
    device_name_param,
    device_info_param
  );
end;
$function$;

-- Backwards compatibility for database tests/admin tooling only.
create or replace function public.create_free_trial_license_unlimited(
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return public.create_free_license_unlimited(
    device_fingerprint_param,
    device_name_param,
    device_info_param
  );
end;
$function$;

revoke execute on function public.create_free_license(text, text, jsonb) from public;
revoke execute on function public.create_free_license_unlimited(text, text, jsonb) from public;
revoke execute on function public.create_free_license_unlimited(text, text, jsonb) from anon, authenticated;
revoke execute on function public.create_free_trial_license(text, text, jsonb) from public;
revoke execute on function public.create_free_trial_license_unlimited(text, text, jsonb) from public;
revoke execute on function public.create_free_trial_license_unlimited(text, text, jsonb) from anon, authenticated;

grant execute on function public.create_free_license(text, text, jsonb) to anon, authenticated;
grant execute on function public.create_free_trial_license(text, text, jsonb) to anon, authenticated;

comment on function public.create_free_license(text, text, jsonb)
  is 'Canonical rate-limited creation RPC for lifetime Lanzo Local licenses. New keys are plan-neutral.';
comment on function public.create_free_trial_license(text, text, jsonb)
  is 'Deprecated compatibility alias. Use public.create_free_license.';
