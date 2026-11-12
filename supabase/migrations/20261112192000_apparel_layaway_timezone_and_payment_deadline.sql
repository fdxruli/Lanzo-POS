-- Stage 3A Apparel layaways: prepare business-confirmed IANA timezone without changing financial operations.
-- Prepared only. Not installed; explicit owner authorization and Git/main traceability required.
-- Compatible phase: Cloud layaway create/payment functions and UTC-midnight deadlines remain unchanged.
begin;

alter table public.business_profiles add column if not exists timezone text;

CREATE OR REPLACE FUNCTION public.get_business_profile_anon_unlimited(license_key_param text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid;
  v_data json;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return json_build_object(
      'success', false,
      'code', 'LICENSE_NOT_FOUND',
      'reason', 'LICENSE_NOT_FOUND',
      'message', 'Licencia no encontrada.'
    );
  end if;

  select json_build_object(
    'profile_id', bp.id,
    'license_key', l.license_key,
    'name', bp.business_name,
    'business_name', bp.business_name,
    'phone', bp.phone_number,
    'phone_number', bp.phone_number,
    'address', bp.address,
    'logo', bp.logo_url,
    'logo_url', bp.logo_url,
    'business_type', bp.business_type,
    'timezone', bp.timezone,
    'updated_at', bp.updated_at,
    'profile_revision', floor(
      extract(epoch from coalesce(bp.updated_at, bp.created_at, now())) * 1000
    )::bigint
  ) into v_data
  from public.business_profiles bp
  join public.licenses l on bp.license_id = l.id
  where bp.license_id = v_license_id;

  if v_data is null then
    return json_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'reason', 'PROFILE_NOT_FOUND',
      'message', 'Perfil de negocio no configurado.'
    );
  end if;

  return json_build_object('success', true, 'data', v_data);
end;
$function$;


CREATE OR REPLACE FUNCTION public.save_business_profile_secure(license_key_param text, device_fingerprint_param text, security_token_param text, actor_session_token_param text, profile_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rate jsonb;
  v_context jsonb;
  v_result jsonb;
  v_code text;
  v_timezone text;
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

  -- Only the actor-bound settings_data route may alter the calendar timezone.
  -- The legacy unlimited writer deliberately ignores profile_data.timezone.
  if profile_data ? 'timezone' then
    v_timezone := nullif(btrim(profile_data->>'timezone'), '');
    if v_timezone is null or length(v_timezone) > 128
       or position('/' in v_timezone) = 0
       or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
      return jsonb_build_object('success', false, 'code', 'BUSINESS_TIMEZONE_INVALID', 'error', 'BUSINESS_TIMEZONE_INVALID');
    end if;
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
  if coalesce((v_result->>'success')::boolean, false) and profile_data ? 'timezone' then
    update public.business_profiles
       set timezone = v_timezone, updated_at = clock_timestamp()
     where license_id = (v_context->>'license_id')::uuid;
    if not found then
      raise exception 'BUSINESS_PROFILE_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_result := v_result || jsonb_build_object('timezone', v_timezone);
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

-- No Cloud financial function is altered in this preparatory phase.
commit;
