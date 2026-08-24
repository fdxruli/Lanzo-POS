-- ADMIN.STAFF.SECTION.ISOLATION.R1
-- `reports` is read authority only. Every cloud cancellation preview/execute
-- additionally requires the canonical `refunds` permission. Existing actor,
-- ownership/global, state, cash, inventory, credit, and idempotency checks stay
-- behind these wrappers unchanged.

do $migration$
begin
  if to_regprocedure('public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)') is null then
    if to_regprocedure('public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)') is null then
      raise exception 'R1_EXPECTED_PREVIEW_UNLIMITED_MISSING';
    end if;
    alter function public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)
      rename to pos_preview_cloud_sale_cancellation_legacy_r1;
  end if;

  if to_regprocedure('public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)') is null then
    if to_regprocedure('public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)') is null then
      raise exception 'R1_EXPECTED_CANCEL_ENGINE_MISSING';
    end if;
    alter function public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)
      rename to pos_cancel_cloud_sale_apply_fase6e_legacy_r1;
  end if;
end;
$migration$;

create or replace function public.pos_preview_cloud_sale_cancellation_unlimited(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_sale_staff_user_id uuid;
  v_sale_found boolean := false;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_sales_cancellations_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  if not private.has_pos_permission(v_context, 'refunds') then
    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', 'POS_PERMISSION_DENIED:refunds',
      'message', 'No tienes permiso para cancelar o reembolsar ventas.',
      'block_reasons', jsonb_build_array(jsonb_build_object(
        'code', 'POS_PERMISSION_DENIED:refunds',
        'message', 'No tienes permiso para cancelar o reembolsar ventas.'
      )),
      'mode', 'cloud_sale_cancellation_preview'
    );
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  select true, s.staff_user_id
  into v_sale_found, v_sale_staff_user_id
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = nullif(btrim(coalesce(p_sale_id, '')), '')
  limit 1;

  if coalesce(v_context->>'actor_type', v_context->>'device_role', 'staff') = 'staff'
     and v_sale_found
     and v_sale_staff_user_id is distinct from v_staff_user_id
     and not private.has_pos_permission(v_context, 'sales_cancellations_global') then
    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', 'SALE_CANCELLATION_FORBIDDEN',
      'message', 'No tienes permiso para cancelar esta venta.',
      'block_reasons', jsonb_build_array(jsonb_build_object(
        'code', 'SALE_CANCELLATION_FORBIDDEN',
        'message', 'No tienes permiso para cancelar esta venta.'
      )),
      'mode', 'cloud_sale_cancellation_preview'
    );
  end if;

  return public.pos_preview_cloud_sale_cancellation_legacy_r1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason
  );
end;
$function$;

create or replace function public.pos_cancel_cloud_sale_apply_fase6e(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_sale_staff_user_id uuid;
  v_sale_found boolean := false;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_cloud_sales_cancellations_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  perform private.assert_pos_permission(v_context, 'refunds');

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  select true, s.staff_user_id
  into v_sale_found, v_sale_staff_user_id
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = nullif(btrim(coalesce(p_sale_id, '')), '')
  limit 1;

  if coalesce(v_context->>'actor_type', v_context->>'device_role', 'staff') = 'staff'
     and v_sale_found
     and v_sale_staff_user_id is distinct from v_staff_user_id
     and not private.has_pos_permission(v_context, 'sales_cancellations_global') then
    raise exception 'SALE_CANCELLATION_FORBIDDEN' using errcode = 'P0001';
  end if;

  return public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason,
    p_idempotency_key
  );
end;
$function$;

-- Only the SEC.2 public wrappers and the financial receipt executor remain
-- callable by client roles. The newly named legacy bodies cannot bypass R1.
revoke all on function public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)
  to service_role;

revoke all on function public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)
  to service_role;

revoke all on function public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)
  from public;
grant execute on function public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)
  to anon, authenticated, service_role;
revoke all on function public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)
  from public;
grant execute on function public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)
  to anon, authenticated, service_role;

do $verification$
declare
  v_preview_wrapper text;
  v_cancel_wrapper text;
  v_preview_unlimited text;
  v_cancel_apply text;
  v_preview_config text[];
  v_cancel_config text[];
begin
  select pg_get_functiondef('public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)'::regprocedure)
  into v_preview_wrapper;
  select pg_get_functiondef('public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)'::regprocedure)
  into v_cancel_wrapper;
  select p.proconfig, pg_get_functiondef(p.oid)
  into v_preview_config, v_preview_unlimited
  from pg_proc p
  where p.oid = 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)'::regprocedure;
  select p.proconfig, pg_get_functiondef(p.oid)
  into v_cancel_config, v_cancel_apply
  from pg_proc p
  where p.oid = 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)'::regprocedure;

  if position('enforce_pos_rpc_rate_limit_v2' in v_preview_wrapper) = 0
     or position('pos_preview_cloud_sale_cancellation_unlimited' in v_preview_wrapper) = 0 then
    raise exception 'R1_PREVIEW_RATE_LIMIT_WRAPPER_LOST';
  end if;
  if position('enforce_pos_rpc_rate_limit_v2' in v_cancel_wrapper) = 0
     or position('pos_cancel_cloud_sale_unlimited' in v_cancel_wrapper) = 0 then
    raise exception 'R1_CANCEL_RATE_LIMIT_WRAPPER_LOST';
  end if;

  if not ('search_path=""' = any(coalesce(v_preview_config, array[]::text[])))
     or position('private.validate_pos_sync_context' in v_preview_unlimited) = 0
     or position('private.has_pos_permission(v_context, ''refunds'')' in v_preview_unlimited) = 0
     or position('pos_preview_cloud_sale_cancellation_legacy_r1' in v_preview_unlimited) = 0 then
    raise exception 'R1_PREVIEW_REFUNDS_GATE_INVALID';
  end if;
  if not ('search_path=""' = any(coalesce(v_cancel_config, array[]::text[])))
     or position('private.validate_pos_sync_context' in v_cancel_apply) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_cancel_apply) = 0
     or position('pos_cancel_cloud_sale_apply_fase6e_legacy_r1' in v_cancel_apply) = 0 then
    raise exception 'R1_CANCEL_REFUNDS_GATE_INVALID';
  end if;

  if has_function_privilege('public', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('public', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)', 'execute') then
    raise exception 'R1_SALES_REFUNDS_ACL_INVALID';
  end if;
end;
$verification$;

notify pgrst, 'reload schema';
