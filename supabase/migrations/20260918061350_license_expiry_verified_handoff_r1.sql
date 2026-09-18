-- LICENSE.LIFECYCLE.5
-- Close the scheduler interval only for a device that already proves possession
-- of its active (or rotating previous) device secret. The Free transition stays
-- in the existing private, row-locked, idempotent primitive.

do $preflight$
begin
  if to_regprocedure('private.license_entitlement_state_v1(uuid)') is null
     or to_regprocedure('private.materialize_expired_license_to_free_v1(uuid)') is null
     or to_regprocedure('public.verify_device_license_unified_unlimited(text,text,text)') is null then
    raise exception 'LICENSE_EXPIRY_VERIFIED_HANDOFF_DEPENDENCY_MISSING';
  end if;
end;
$preflight$;

create or replace function private.materialize_expired_license_after_verified_device_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_entitlement record;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return jsonb_build_object('attempted', false, 'reason', 'DEVICE_CREDENTIALS_REQUIRED');
  end if;

  select l.id
    into v_license_id
    from public.licenses l
    join public.license_devices d on d.license_id = l.id
   where l.license_key = p_license_key
     and d.device_fingerprint = p_device_fingerprint
     and d.is_active is true
     and d.security_token is not null
     and (d.security_token = p_security_token or d.previous_security_token = p_security_token)
   limit 1;

  if v_license_id is null then
    return jsonb_build_object('attempted', false, 'reason', 'DEVICE_NOT_VERIFIED');
  end if;

  select *
    into v_entitlement
    from private.license_entitlement_state_v1(v_license_id);

  if v_entitlement.lifecycle_state <> 'expired'
     or v_entitlement.is_entitled is true then
    return jsonb_build_object('attempted', false, 'reason', 'LICENSE_NOT_CANONICALLY_EXPIRED');
  end if;

  v_result := private.materialize_expired_license_to_free_v1(v_license_id);

  return jsonb_build_object(
    'attempted', true,
    'changed', coalesce((v_result->>'changed')::boolean, false),
    'code', coalesce(v_result->>'code', 'UNKNOWN_RESULT')
  );
end;
$function$;

revoke all on function private.materialize_expired_license_after_verified_device_v1(text,text,text)
  from public, anon, authenticated;

create or replace function public.verify_device_license_unified(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate_limit jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := 'verify_device_license_unified',
    p_scope := 'AUTH_LICENSE',
    p_max_attempts := 60,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'AUTH_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_license_validation_rate_limited_response(v_rate_limit);
  end if;

  -- No client can call the private primitive. This internal call executes only
  -- after the existing rate limit and a token-bound device preflight.
  perform private.materialize_expired_license_after_verified_device_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token
  );

  return public.verify_device_license_unified_unlimited(
    p_license_key,
    p_device_fingerprint,
    p_security_token
  );
end;
$function$;

revoke all on function public.verify_device_license_unified(text,text,text)
  from public;
grant execute on function public.verify_device_license_unified(text,text,text)
  to anon, authenticated;

comment on function private.materialize_expired_license_after_verified_device_v1(text,text,text) is
  'LICENSE.LIFECYCLE.5 internal on-demand expiry handoff. Requires exact active/previous device token and delegates to the canonical idempotent materializer.';

comment on function public.verify_device_license_unified(text,text,text) is
  'LICENSE.LIFECYCLE.5 rate-limited device verification. At canonical end-of-grace, a token-verified device can trigger only the existing private Free materialization before receiving its current contract.';

do $security_verification$
begin
  if has_function_privilege('public', 'private.materialize_expired_license_after_verified_device_v1(text,text,text)', 'execute')
     or has_function_privilege('anon', 'private.materialize_expired_license_after_verified_device_v1(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.materialize_expired_license_after_verified_device_v1(text,text,text)', 'execute') then
    raise exception 'LICENSE_EXPIRY_VERIFIED_HANDOFF_PRIVATE_EXECUTE_EXPOSED';
  end if;
end;
$security_verification$;
