-- LANZO POS Etapa 3: permisos independientes para Configuración.
-- La migración preserva la normalización de permisos previos y sólo cambia
-- las autorizaciones de perfil y estaciones para exigir su permiso granular,
-- conservando las autorizaciones legacy y de Productos.

begin;

create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'pos', true,
    'orders', true,
    'products', false,
    'customers', false,
    'reports', false,
    'settings', false,
    'settings_data', false,
    'settings_controls', false,
    'settings_maintenance', false,
    'settings_backup', false,
    'devices', false,
    'license', false,
    'inventory', false,
    'cash_register', true,
    'discounts', false,
    'refunds', false,
    'ecommerce', false,
    'sync', false,
    'notifications', false,
    'notifications_ecommerce', true,
    'notifications_support', true,
    'notifications_license', true,
    'notifications_inventory', true,
    'notifications_operations', true,
    'notifications_system', true,
    'support_center', false,
    'ai_agents', false
  );
$function$;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync', 'notifications',
    'notifications_ecommerce', 'notifications_support',
    'notifications_license', 'notifications_inventory', 'notifications_operations',
    'notifications_system', 'support_center', 'ai_agents'
  ];
  v_granular_settings_keys text[] := array[
    'settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return v_result;
  end if;

  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;

  if p_permissions ? 'notifications_inventory' then
    if jsonb_typeof(p_permissions -> 'notifications_inventory') <> 'boolean' then
      v_result := jsonb_set(v_result, '{notifications_inventory}', 'false'::jsonb, true);
    end if;
  elsif p_permissions ? 'notifications_operations' then
    if jsonb_typeof(p_permissions -> 'notifications_operations') = 'boolean' then
      v_result := jsonb_set(
        v_result,
        '{notifications_inventory}',
        p_permissions -> 'notifications_operations',
        true
      );
    else
      v_result := jsonb_set(v_result, '{notifications_inventory}', 'false'::jsonb, true);
    end if;
  elsif p_permissions ? 'notifications'
        and jsonb_typeof(p_permissions -> 'notifications') = 'boolean' then
    v_result := jsonb_set(
      v_result,
      '{notifications_inventory}',
      p_permissions -> 'notifications',
      true
    );
  end if;

  -- Legacy rows get exactly their previous Settings reach. As soon as one
  -- granular key is present, missing and explicit false values fail closed.
  if not (p_permissions ?| v_granular_settings_keys) then
    v_result := jsonb_set(v_result, '{settings_data}', v_result->'settings', true);
    v_result := jsonb_set(v_result, '{settings_controls}', v_result->'settings', true);
    v_result := jsonb_set(
      v_result,
      '{settings_maintenance}',
      to_jsonb(
        coalesce((v_result->>'sync')::boolean, false)
        or coalesce((v_result->>'inventory')::boolean, false)
      ),
      true
    );
    v_result := jsonb_set(v_result, '{settings_backup}', v_result->'sync', true);
  end if;

  return v_result;
end;
$function$;

create or replace function private.assert_preparation_station_manage_permission(
  p_context jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_actor_permissions jsonb := coalesce(
    p_context->'actor_permissions',
    p_context->'staff_permissions',
    '{}'::jsonb
  );
  v_granular_settings_keys text[] := array[
    'settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup'
  ];
begin
  -- has_pos_permission resolves the verified actor (Admin or Staff); the
  -- device's physical role is not an authority source.
  if private.has_pos_permission(p_context, 'products') is true
     or private.has_pos_permission(p_context, 'settings_controls') is true then
    return;
  end if;

  -- Only rows with no granular Settings keys inherit their former Settings
  -- access. This reads the raw verified actor map, before normalization adds
  -- default false values for newly introduced keys.
  if not (v_actor_permissions ?| v_granular_settings_keys)
     and private.has_pos_permission(p_context, 'settings') is true then
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:preparation_stations' using errcode = 'P0001';
end;
$function$;

do $preflight$
declare
  v_profile_definition text;
begin
  if to_regprocedure('private.validate_pos_sync_context(text,text,text,text)') is null
     or to_regprocedure('private.has_pos_permission(jsonb,text)') is null
     or to_regprocedure('private.assert_preparation_station_manage_permission(jsonb)') is null
     or to_regprocedure('public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)') is null
     or to_regprocedure('public.save_business_profile_secure(text,text,text,text,jsonb)') is null
     or to_regprocedure('public.save_business_profile_secure_unlimited(text,text,text,jsonb)') is null then
    raise exception 'STAFF_SETTINGS_STAGE3_PROFILE_PREREQUISITE_MISSING';
  end if;

  select pg_get_functiondef(
    'public.save_business_profile_secure(text,text,text,text,jsonb)'::regprocedure
  ) into v_profile_definition;

  if position('has_pos_permission' in v_profile_definition) = 0
     or position('settings' in v_profile_definition) = 0
     or position('validate_pos_sync_context' in v_profile_definition) = 0 then
    raise exception 'STAFF_SETTINGS_STAGE3_PROFILE_CONTRACT_MISMATCH';
  end if;
end;
$preflight$;

create or replace function public.save_business_profile_secure(
  license_key_param text,
  device_fingerprint_param text,
  security_token_param text,
  actor_session_token_param text,
  profile_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_context jsonb;
  v_result jsonb;
  v_code text;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    license_key_param,
    device_fingerprint_param,
    null,
    'save_business_profile_secure',
    'PROFILE',
    30,
    600,
    600,
    'AUTH_RATE_LIMITED',
    '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  if nullif(btrim(coalesce(actor_session_token_param, '')), '') is null then
    return jsonb_build_object(
      'success', false,
      'code', 'ACTOR_SESSION_REQUIRED',
      'error', 'ACTOR_SESSION_REQUIRED'
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      license_key_param,
      device_fingerprint_param,
      security_token_param,
      actor_session_token_param
    );
  exception
    when sqlstate 'P0001' then
      v_code := case sqlerrm
        when 'LICENSE_NOT_FOUND' then 'LICENSE_NOT_FOUND'
        when 'LICENSE_NOT_ACTIVE' then 'LICENSE_NOT_ACTIVE'
        when 'LICENSE_EXPIRED' then 'LICENSE_EXPIRED'
        when 'DEVICE_NOT_ALLOWED' then 'DEVICE_NOT_ALLOWED'
        when 'DEVICE_NOT_ACTIVE' then 'DEVICE_NOT_ACTIVE'
        when 'DEVICE_TOKEN_REQUIRED' then 'DEVICE_TOKEN_REQUIRED'
        when 'DEVICE_TOKEN_INVALID' then 'DEVICE_TOKEN_INVALID'
        when 'ACTOR_SESSION_REQUIRED' then 'ACTOR_SESSION_REQUIRED'
        when 'STAFF_SESSION_EXPIRED' then 'STAFF_SESSION_EXPIRED'
        when 'STAFF_USER_INACTIVE' then 'STAFF_USER_INACTIVE'
        when 'ACTOR_SESSION_AMBIGUOUS' then 'ACTOR_SESSION_AMBIGUOUS'
        else 'ACTOR_SESSION_INVALID'
      end;
      return jsonb_build_object('success', false, 'code', v_code, 'error', v_code);
  end;

  if private.has_pos_permission(v_context, 'settings_data') is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'SETTINGS_PERMISSION_DENIED',
      'error', 'SETTINGS_PERMISSION_DENIED'
    );
  end if;

  v_result := public.save_business_profile_secure_unlimited(
    license_key_param,
    device_fingerprint_param,
    security_token_param,
    profile_data
  );

  if coalesce((v_result->>'success')::boolean, false) is false
     and not (v_result ? 'code') then
    v_result := v_result || jsonb_build_object(
      'code', coalesce(v_result->>'error', 'BUSINESS_PROFILE_SAVE_FAILED')
    );
  end if;
  return v_result;
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'BUSINESS_PROFILE_SAVE_FAILED',
      'error', 'BUSINESS_PROFILE_SAVE_FAILED'
    );
end;
$function$;

revoke all on function public.save_business_profile_secure(text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_business_profile_secure(text,text,text,text,jsonb)
  to anon, authenticated, service_role;

comment on function public.save_business_profile_secure(text,text,text,text,jsonb) is
  'R1 actor-aware profile writer. Requires canonical Admin or Staff settings_data authority and preserves the SEC.2 device-scoped PROFILE throttle.';

commit;
