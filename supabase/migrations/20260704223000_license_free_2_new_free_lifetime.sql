-- FASE LICENSE.FREE.2
-- Nuevas licencias FREE sin vencimiento tecnico.
-- Mantiene compatibilidad con:
-- - plans.code = 'free_trial'
-- - RPC public.create_free_trial_license(...)
-- - frontend createFreeTrial / handleFreeTrial
--
-- Fuera de alcance en esta fase:
-- - migrar licencias existentes
-- - renombrar free_trial globalmente
-- - cambiar admin_change_license_plan
-- - cambiar renew_license_free
-- - activar staff/cloud/IA para FREE

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
declare
  existing_count integer;
  new_license_id uuid;
  new_key text;
  free_plan record;
  v_security_token text;
  v_period_id uuid;
  v_now timestamptz := now();
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
    return jsonb_build_object('success', false, 'error', 'Este dispositivo ya ha utilizado una licencia anteriormente.');
  end if;

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
    new_key := 'LANZO-FREE-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));

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
      'source', 'create_free_trial_license',
      'license_kind', 'free_lifetime',
      'license_type', 'free',
      'is_lifetime', true,
      'expires_at', null
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
    return jsonb_build_object('success', false, 'error', 'Este dispositivo ya ha utilizado una licencia anteriormente.');
  end;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (
    new_license_id,
    device_fingerprint_param,
    'CREATE_FREE_LICENSE',
    coalesce(device_info_param, '{}'::jsonb) || jsonb_build_object(
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null
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
      'expires_at', null
    )
  );

  insert into public.license_events (license_key, event_type, metadata)
  values (
    new_key,
    'PERIOD_CREATED',
    jsonb_build_object(
      'source', 'create_free_trial_license',
      'period_id', v_period_id,
      'starts_at', v_now,
      'ends_at', null,
      'ai_agent_limit', 0,
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'expires_at', null
    )
  );

  return jsonb_build_object(
    'success', true,
    'license_key', new_key,
    'expires_at', null,
    'is_lifetime', true,
    'license_type', 'free',
    'features', free_features,
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
      'features', free_features,
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
